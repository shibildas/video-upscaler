import React, { useState, useRef, useEffect } from 'react';
import {
  Scissors,
  Tag,
  Merge,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Trash2,
  Download,
  Loader2,
  Sparkles,
  Check,
  X,
  Film,
  Magnet,
} from 'lucide-react';
import { TimelineClip, SceneTag } from '../types';
import {
  renderTimelineClipsInBrowser,
  splitVideoAtTimestamp,
  formatFfmpegTime,
} from '../utils/ffmpegBrowser';

interface VideoTimelineEditorProps {
  sourceUrl: string;
  duration: number;
  currentTime: number;
  onSeek: (timeSec: number) => void;
  onApplyEditedVideo?: (blobUrl: string, newDuration: number) => void;
}

const CLIP_COLORS = [
  'from-indigo-600/80 to-indigo-700/80 border-indigo-400',
  'from-violet-600/80 to-purple-700/80 border-violet-400',
  'from-emerald-600/80 to-teal-700/80 border-emerald-400',
  'from-sky-600/80 to-blue-700/80 border-sky-400',
  'from-amber-600/80 to-orange-700/80 border-amber-400',
];

const TAG_COLORS: Record<NonNullable<SceneTag['category']>, string> = {
  scene: 'bg-indigo-500 text-white',
  highlight: 'bg-amber-500 text-slate-950',
  'b-roll': 'bg-emerald-500 text-slate-950',
  cut: 'bg-rose-500 text-white',
  note: 'bg-sky-500 text-slate-950',
};

const SNAP_THRESHOLD_SEC = 0.22;

export const VideoTimelineEditor: React.FC<VideoTimelineEditorProps> = ({
  sourceUrl,
  duration,
  currentTime,
  onSeek,
  onApplyEditedVideo,
}) => {
  const safeDuration = Math.max(1, duration || 10);

  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [zoomPxPerSec, setZoomPxPerSec] = useState<number>(64);
  const [snapMagnetic, setSnapMagnetic] = useState<boolean>(true);
  const [snapNotice, setSnapNotice] = useState<string | null>(null);

  // Tag Scene Modal State
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [tagLabel, setTagLabel] = useState('');
  const [tagCategory, setTagCategory] = useState<NonNullable<SceneTag['category']>>('scene');
  const [tagNotes, setTagNotes] = useState('');
  const [tagTimestamp, setTagTimestamp] = useState<number>(0);

  // Browser @ffmpeg/ffmpeg WASM processing state
  const [isProcessingWasm, setIsProcessingWasm] = useState(false);
  const [wasmStatus, setWasmStatus] = useState<string>('');
  const [wasmProgress, setWasmProgress] = useState<number>(0);
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);
  const [splitPartsUrls, setSplitPartsUrls] = useState<{ part1Url: string; part2Url: string } | null>(
    null
  );

  // Dragging state for left/right trim handles or moving a clip block
  const [dragState, setDragState] = useState<{
    type: 'trim-left' | 'trim-right' | 'move' | 'playhead';
    clipId?: string;
    startX: number;
    initialSourceStart?: number;
    initialSourceEnd?: number;
    initialTrackStart?: number;
  } | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);

  // Initialize single full-length clip whenever sourceUrl or duration changes
  useEffect(() => {
    const initialClip: TimelineClip = {
      id: `clip_${Date.now()}`,
      name: 'Clip 1 (Master)',
      sourceStart: 0,
      sourceEnd: Number(safeDuration.toFixed(2)),
      trackStart: 0,
      color: CLIP_COLORS[0],
      tags: [],
    };
    setClips([initialClip]);
    setSelectedClipId(initialClip.id);
    setExportedUrl(null);
    setSplitPartsUrls(null);
    setWasmError(null);
  }, [sourceUrl, safeDuration]);

  // Adjust initial zoom so track fits nicely
  useEffect(() => {
    if (safeDuration > 0) {
      const ideal = Math.max(24, Math.min(140, Math.round(680 / safeDuration)));
      setZoomPxPerSec(ideal);
    }
  }, [safeDuration]);

  const trackWidthPx = Math.max(640, Math.ceil(safeDuration * zoomPxPerSec) + 80);

  /**
   * Convert mouse clientX to timeline seconds
   */
  const clientXToSeconds = (clientX: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(safeDuration, x / zoomPxPerSec));
  };

  /**
   * Handle mouse move for trimming left/right handles, dragging clips with snap-to-edge auto-merge, or scrubbing playhead
   */
  useEffect(() => {
    if (!dragState) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaPx = e.clientX - dragState.startX;
      const deltaSec = deltaPx / zoomPxPerSec;

      if (dragState.type === 'playhead') {
        const sec = clientXToSeconds(e.clientX);
        onSeek(Number(sec.toFixed(2)));
        return;
      }

      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== dragState.clipId) return c;

          if (dragState.type === 'trim-left') {
            const rawStart = (dragState.initialSourceStart ?? c.sourceStart) + deltaSec;
            const clampedStart = Math.max(0, Math.min(c.sourceEnd - 0.25, rawStart));
            const shift = clampedStart - (dragState.initialSourceStart ?? c.sourceStart);
            return {
              ...c,
              sourceStart: Number(clampedStart.toFixed(2)),
              trackStart: Number(Math.max(0, (dragState.initialTrackStart ?? c.trackStart) + shift).toFixed(2)),
            };
          }

          if (dragState.type === 'trim-right') {
            const rawEnd = (dragState.initialSourceEnd ?? c.sourceEnd) + deltaSec;
            const clampedEnd = Math.max(c.sourceStart + 0.25, Math.min(safeDuration, rawEnd));
            return {
              ...c,
              sourceEnd: Number(clampedEnd.toFixed(2)),
            };
          }

          if (dragState.type === 'move') {
            const clipLen = c.sourceEnd - c.sourceStart;
            let nextTrackStart = Math.max(
              0,
              Math.min(safeDuration - clipLen, (dragState.initialTrackStart ?? c.trackStart) + deltaSec)
            );

            // Magnetic snap to adjacent clip edges
            if (snapMagnetic) {
              for (const other of prev) {
                if (other.id === c.id) continue;
                const otherStart = other.trackStart;
                const otherEnd = other.trackStart + (other.sourceEnd - other.sourceStart);

                // Snap left edge of current clip to right edge of other clip
                if (Math.abs(nextTrackStart - otherEnd) <= SNAP_THRESHOLD_SEC) {
                  nextTrackStart = otherEnd;
                }
                // Snap right edge of current clip to left edge of other clip
                else if (Math.abs(nextTrackStart + clipLen - otherStart) <= SNAP_THRESHOLD_SEC) {
                  nextTrackStart = otherStart - clipLen;
                }
              }
            }

            return {
              ...c,
              trackStart: Number(Math.max(0, nextTrackStart).toFixed(2)),
            };
          }

          return c;
        })
      );
    };

    const handleWindowMouseUp = () => {
      // If user was dragging a clip and magnetic snap-to-edge is enabled,
      // check if two contiguous clips touched edges and auto-merge them!
      if (dragState.type === 'move' && snapMagnetic) {
        setClips((prev) => {
          const sorted = [...prev].sort((a, b) => a.trackStart - b.trackStart);
          const merged: TimelineClip[] = [];

          for (const clip of sorted) {
            const last = merged[merged.length - 1];
            if (last) {
              const lastTrackEnd = last.trackStart + (last.sourceEnd - last.sourceStart);
              const isTouchingOnTrack = Math.abs(clip.trackStart - lastTrackEnd) <= 0.08;
              const isContiguousMedia = Math.abs(clip.sourceStart - last.sourceEnd) <= 0.35;

              if (isTouchingOnTrack && isContiguousMedia) {
                // Auto-merge snapped clips into a single continuous block
                const combined: TimelineClip = {
                  ...last,
                  name: `${last.name.split(' + ')[0]} + Merged`,
                  sourceEnd: Math.max(last.sourceEnd, clip.sourceEnd),
                  tags: [...last.tags, ...clip.tags],
                };
                merged[merged.length - 1] = combined;
                setSelectedClipId(combined.id);
                setSnapNotice(`Snapped & merged "${last.name}" + "${clip.name}"`);
                setTimeout(() => setSnapNotice(null), 2800);
                continue;
              }
            }
            merged.push(clip);
          }
          return merged;
        });
      }

      setDragState(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [dragState, zoomPxPerSec, safeDuration, snapMagnetic, onSeek]);

  /**
   * Split the clip under the current playhead into two independent timeline blocks
   */
  const handleSplitAtPlayhead = () => {
    const targetClip = clips.find((c) => {
      const clipEndOnTrack = c.trackStart + (c.sourceEnd - c.sourceStart);
      return currentTime > c.trackStart + 0.15 && currentTime < clipEndOnTrack - 0.15;
    });

    if (!targetClip) {
      setWasmError(
        'Move the playhead inside a clip (away from its very edges) before clicking Split.'
      );
      return;
    }

    setWasmError(null);
    const offsetIntoClip = Number((currentTime - targetClip.trackStart).toFixed(2));
    const splitMediaTime = Number((targetClip.sourceStart + offsetIntoClip).toFixed(2));

    const leftTags = targetClip.tags.filter((t) => t.timestamp < splitMediaTime);
    const rightTags = targetClip.tags.filter((t) => t.timestamp >= splitMediaTime);

    const leftClip: TimelineClip = {
      id: `clip_${Date.now()}_a`,
      name: `${targetClip.name.replace(/ \(.*\)/, '')} (Part A)`,
      sourceStart: targetClip.sourceStart,
      sourceEnd: splitMediaTime,
      trackStart: targetClip.trackStart,
      color: targetClip.color,
      tags: leftTags,
    };

    const rightClip: TimelineClip = {
      id: `clip_${Date.now()}_b`,
      name: `${targetClip.name.replace(/ \(.*\)/, '')} (Part B)`,
      sourceStart: splitMediaTime,
      sourceEnd: targetClip.sourceEnd,
      // Place slightly separated by 0.05s visually or touching so user can drag/trim independently
      trackStart: Number((targetClip.trackStart + offsetIntoClip).toFixed(2)),
      color: CLIP_COLORS[(clips.length + 1) % CLIP_COLORS.length],
      tags: rightTags,
    };

    setClips((prev) =>
      prev.flatMap((c) => (c.id === targetClip.id ? [leftClip, rightClip] : [c]))
    );
    setSelectedClipId(rightClip.id);
  };

  /**
   * Open Tag Scene modal for the active playhead timestamp
   */
  const openTagSceneModal = () => {
    setTagTimestamp(Number(currentTime.toFixed(2)));
    setTagLabel('');
    setTagNotes('');
    setIsTagModalOpen(true);
  };

  /**
   * Attach scene tag metadata to the clip containing the timestamp (or selected clip)
   */
  const handleSaveSceneTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagLabel.trim()) return;

    const newTag: SceneTag = {
      id: `tag_${Date.now()}`,
      label: tagLabel.trim(),
      category: tagCategory,
      color: TAG_COLORS[tagCategory],
      timestamp: tagTimestamp,
      notes: tagNotes.trim() || undefined,
    };

    setClips((prev) => {
      // Find clip covering this timestamp, or fallback to selectedClipId / first clip
      const target =
        prev.find((c) => {
          const end = c.trackStart + (c.sourceEnd - c.sourceStart);
          return tagTimestamp >= c.trackStart && tagTimestamp <= end;
        }) ||
        prev.find((c) => c.id === selectedClipId) ||
        prev[0];

      if (!target) return prev;

      return prev.map((c) =>
        c.id === target.id ? { ...c, tags: [...c.tags, newTag] } : c
      );
    });

    setIsTagModalOpen(false);
  };

  const handleRemoveTag = (clipId: string, tagId: string) => {
    setClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? { ...c, tags: c.tags.filter((t) => t.id !== tagId) } : c
      )
    );
  };

  const handleDeleteSelectedClip = () => {
    if (!selectedClipId || clips.length <= 1) return;
    setClips((prev) => prev.filter((c) => c.id !== selectedClipId));
    setSelectedClipId(clips.find((c) => c.id !== selectedClipId)?.id || null);
  };

  const handleResetTimeline = () => {
    const initial: TimelineClip = {
      id: `clip_${Date.now()}`,
      name: 'Clip 1 (Master)',
      sourceStart: 0,
      sourceEnd: Number(safeDuration.toFixed(2)),
      trackStart: 0,
      color: CLIP_COLORS[0],
      tags: [],
    };
    setClips([initial]);
    setSelectedClipId(initial.id);
    setExportedUrl(null);
    setSplitPartsUrls(null);
    setWasmError(null);
  };

  /**
   * Browser @ffmpeg/ffmpeg WASM: Trim & Merge all timeline clips into a single continuous MP4
   */
  const handleRenderTimelineWasm = async () => {
    if (!clips.length) return;
    setIsProcessingWasm(true);
    setWasmError(null);
    setSplitPartsUrls(null);
    setWasmProgress(5);
    setWasmStatus('Loading @ffmpeg/ffmpeg WebAssembly core...');

    try {
      const sortedClips = [...clips].sort((a, b) => a.trackStart - b.trackStart);
      const ranges = sortedClips.map((c) => ({
        startTime: c.sourceStart,
        endTime: c.sourceEnd,
      }));

      const mergedBlob = await renderTimelineClipsInBrowser(
        sourceUrl,
        ranges,
        (pct, stage) => {
          setWasmProgress(pct);
          setWasmStatus(stage);
        }
      );

      const url = URL.createObjectURL(mergedBlob);
      setExportedUrl(url);
      setWasmStatus('Browser FFmpeg Trim & Concat complete!');
      setWasmProgress(100);

      const totalEditedDuration = ranges.reduce(
        (acc, r) => acc + (r.endTime - r.startTime),
        0
      );
      if (onApplyEditedVideo) {
        onApplyEditedVideo(url, totalEditedDuration);
      }
    } catch (err: any) {
      setWasmError(err.message || 'Browser FFmpeg processing failed');
    } finally {
      setIsProcessingWasm(false);
    }
  };

  /**
   * Browser @ffmpeg/ffmpeg WASM: Export 2 separate MP4 files split at the current playhead timestamp
   */
  const handleExportSplitChunksWasm = async () => {
    if (currentTime <= 0.2 || currentTime >= safeDuration - 0.2) {
      setWasmError('Move the playhead inside the video duration to export split chunks.');
      return;
    }

    setIsProcessingWasm(true);
    setWasmError(null);
    setExportedUrl(null);
    setWasmProgress(10);
    setWasmStatus(`Splitting video at ${currentTime.toFixed(2)}s in browser (FFmpeg WASM)...`);

    try {
      const res = await splitVideoAtTimestamp(
        sourceUrl,
        currentTime,
        safeDuration,
        (pct) => setWasmProgress(pct)
      );
      setSplitPartsUrls({ part1Url: res.part1Url, part2Url: res.part2Url });
      setWasmStatus('Split into 2 MP4 chunks complete!');
    } catch (err: any) {
      setWasmError(err.message || 'Browser FFmpeg split failed');
    } finally {
      setIsProcessingWasm(false);
    }
  };

  // Generate ruler tick marks
  const tickStepSec =
    safeDuration <= 15 ? 1 : safeDuration <= 45 ? 2 : safeDuration <= 120 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= safeDuration; t += tickStepSec) {
    ticks.push(t);
  }

  const selectedClip = clips.find((c) => c.id === selectedClipId) || clips[0];
  const allTags = clips.flatMap((c) =>
    c.tags.map((t) => ({ ...t, clipId: c.id, clipName: c.name }))
  );

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-xl">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-500/15 text-indigo-400">
            <Film className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">
                Non-Linear Timeline & Scene Editor
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                @ffmpeg/wasm Browser Engine
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Drag handles to trim • Split at playhead • Tag scenes • Drag clips together to auto-snap & merge
            </p>
          </div>
        </div>

        {/* Timeline Editing Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSplitAtPlayhead}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white border border-slate-700 transition cursor-pointer"
            title="Split clip at current playhead timestamp"
          >
            <Scissors className="w-3.5 h-3.5 text-indigo-400" />
            Split at {currentTime.toFixed(1)}s
          </button>

          <button
            type="button"
            onClick={openTagSceneModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white border border-slate-700 transition cursor-pointer"
            title="Attach scene label/metadata at playhead"
          >
            <Tag className="w-3.5 h-3.5 text-amber-400" />
            Tag Scene
          </button>

          <button
            type="button"
            onClick={() => setSnapMagnetic((s) => !s)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition cursor-pointer ${
              snapMagnetic
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
            title="Toggle magnetic snap-to-edge auto-merge when dragging clips together"
          >
            <Magnet className="w-3.5 h-3.5" />
            Snap Merge
          </button>

          {clips.length > 1 && (
            <button
              type="button"
              onClick={handleDeleteSelectedClip}
              className="p-1.5 rounded-xl bg-slate-950 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-800 transition cursor-pointer"
              title="Delete selected clip block"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={handleResetTimeline}
            className="p-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition cursor-pointer"
            title="Reset timeline"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setZoomPxPerSec((z) => Math.max(20, Math.round(z * 0.75)))}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomPxPerSec((z) => Math.min(220, Math.round(z * 1.35)))}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Snap-to-Edge Notification Toast */}
      {snapNotice && (
        <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{snapNotice}</span>
        </div>
      )}

      {/* Horizontal Scrollable Track Container */}
      <div className="overflow-x-auto rounded-xl bg-slate-950 border border-slate-800/90 p-3 select-none">
        <div
          ref={trackRef}
          style={{ width: `${trackWidthPx}px` }}
          className="relative h-32"
          onMouseDown={(e) => {
            // Clicking on empty ruler/track moves the playhead
            if ((e.target as HTMLElement).dataset.trackBg === 'true') {
              const sec = clientXToSeconds(e.clientX);
              onSeek(Number(sec.toFixed(2)));
              setDragState({ type: 'playhead', startX: e.clientX });
            }
          }}
        >
          {/* Time Ruler */}
          <div
            data-track-bg="true"
            className="h-6 border-b border-slate-800 flex items-end relative cursor-pointer"
          >
            {ticks.map((t) => (
              <div
                key={t}
                style={{ left: `${t * zoomPxPerSec}px` }}
                className="absolute bottom-0 flex flex-col items-start pointer-events-none"
              >
                <span className="text-[10px] font-mono text-slate-500 pl-1">
                  {t}s
                </span>
                <div className="w-px h-2 bg-slate-700" />
              </div>
            ))}
          </div>

          {/* Clips Track Lane */}
          <div
            data-track-bg="true"
            className="relative h-20 mt-3 rounded-lg bg-slate-900/70 border border-slate-800/70 overflow-visible"
          >
            {clips.map((clip) => {
              const clipDuration = Math.max(0.2, clip.sourceEnd - clip.sourceStart);
              const leftPx = clip.trackStart * zoomPxPerSec;
              const widthPx = Math.max(28, clipDuration * zoomPxPerSec);
              const isSelected = clip.id === selectedClipId;

              return (
                <div
                  key={clip.id}
                  style={{
                    left: `${leftPx}px`,
                    width: `${widthPx}px`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedClipId(clip.id);
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setSelectedClipId(clip.id);
                    setDragState({
                      type: 'move',
                      clipId: clip.id,
                      startX: e.clientX,
                      initialTrackStart: clip.trackStart,
                    });
                  }}
                  className={`absolute top-1.5 bottom-1.5 rounded-xl bg-gradient-to-r ${
                    clip.color
                  } border-2 transition-shadow cursor-grab active:cursor-grabbing flex flex-col justify-between px-3 py-1.5 overflow-hidden ${
                    isSelected
                      ? 'ring-2 ring-white/80 shadow-[0_0_16px_rgba(99,102,241,0.5)] z-10'
                      : 'opacity-90 hover:opacity-100'
                  }`}
                >
                  {/* Left Draggable Trim Handle */}
                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSelectedClipId(clip.id);
                      setDragState({
                        type: 'trim-left',
                        clipId: clip.id,
                        startX: e.clientX,
                        initialSourceStart: clip.sourceStart,
                        initialTrackStart: clip.trackStart,
                      });
                    }}
                    title="Drag to trim clip In-Point"
                    className="absolute left-0 top-0 bottom-0 w-3 bg-black/40 hover:bg-indigo-400 cursor-ew-resize flex items-center justify-center group z-20"
                  >
                    <div className="w-0.5 h-6 bg-white/70 group-hover:bg-slate-950 rounded-full" />
                  </div>

                  {/* Clip Title & In/Out Timestamps */}
                  <div className="flex items-center justify-between gap-2 pointer-events-none pl-1 pr-1">
                    <span className="text-xs font-bold text-white truncate">
                      {clip.name}
                    </span>
                    <span className="text-[10px] font-mono text-white/85 shrink-0">
                      {clip.sourceStart.toFixed(1)}s – {clip.sourceEnd.toFixed(1)}s (
                      {clipDuration.toFixed(1)}s)
                    </span>
                  </div>

                  {/* Scene Tag Pills on Clip */}
                  <div className="flex items-center gap-1 overflow-x-auto pointer-events-none pl-1">
                    {clip.tags.map((t) => (
                      <span
                        key={t.id}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${t.color} shadow-sm truncate max-w-[110px]`}
                      >
                        🏷 {t.label}
                      </span>
                    ))}
                  </div>

                  {/* Right Draggable Trim Handle */}
                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSelectedClipId(clip.id);
                      setDragState({
                        type: 'trim-right',
                        clipId: clip.id,
                        startX: e.clientX,
                        initialSourceEnd: clip.sourceEnd,
                      });
                    }}
                    title="Drag to trim clip Out-Point"
                    className="absolute right-0 top-0 bottom-0 w-3 bg-black/40 hover:bg-indigo-400 cursor-ew-resize flex items-center justify-center group z-20"
                  >
                    <div className="w-0.5 h-6 bg-white/70 group-hover:bg-slate-950 rounded-full" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Vertical Playhead Marker */}
          <div
            style={{ left: `${currentTime * zoomPxPerSec}px` }}
            onMouseDown={(e) => {
              e.stopPropagation();
              setDragState({ type: 'playhead', startX: e.clientX });
            }}
            className="absolute top-0 bottom-0 w-0.5 bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.9)] z-30 cursor-ew-resize"
          >
            <div className="absolute -top-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-rose-500 text-[10px] font-mono font-bold text-white shadow">
              {currentTime.toFixed(2)}s
            </div>
          </div>
        </div>
      </div>

      {/* Selected Clip Trim Readout & Tagged Scenes List */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        {selectedClip && (
          <div className="flex flex-wrap items-center gap-3 text-slate-300">
            <span className="font-semibold text-white">{selectedClip.name}:</span>
            <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono">
              In: {formatFfmpegTime(selectedClip.sourceStart)}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono">
              Out: {formatFfmpegTime(selectedClip.sourceEnd)}
            </span>
            <span className="text-indigo-400 font-mono">
              Duration: {(selectedClip.sourceEnd - selectedClip.sourceStart).toFixed(2)}s
            </span>
          </div>
        )}

        {/* Browser FFmpeg Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isProcessingWasm}
            onClick={handleExportSplitChunksWasm}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-medium text-slate-200 border border-slate-700 transition cursor-pointer"
            title="Use @ffmpeg/ffmpeg in browser to split video into 2 separate downloadable MP4 chunks at the playhead"
          >
            <Scissors className="w-3.5 h-3.5 text-violet-400" />
            Export Split Chunks (WASM)
          </button>

          <button
            type="button"
            disabled={isProcessingWasm}
            onClick={handleRenderTimelineWasm}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 transition cursor-pointer"
            title="Trim and concatenate all timeline clips in the browser using @ffmpeg/ffmpeg"
          >
            {isProcessingWasm ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{wasmProgress}%</span>
              </>
            ) : (
              <>
                <Merge className="w-3.5 h-3.5" />
                <span>
                  {clips.length > 1
                    ? `Trim & Merge ${clips.length} Clips (WASM)`
                    : 'Apply Trim in Browser (WASM)'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Scene Tags Bar */}
      {allTags.length > 0 && (
        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Scene Tags:
          </span>
          {allTags.map((tag) => (
            <div
              key={tag.id}
              onClick={() => onSeek(tag.timestamp)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-500/50 text-xs cursor-pointer transition"
              title={tag.notes ? `${tag.notes} (Click to seek)` : 'Click to seek to scene'}
            >
              <span className={`w-2 h-2 rounded-full ${tag.color.split(' ')[0]}`} />
              <span className="font-medium text-white">{tag.label}</span>
              <span className="font-mono text-[10px] text-slate-400">
                @{tag.timestamp.toFixed(1)}s
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveTag(tag.clipId, tag.id);
                }}
                className="text-slate-500 hover:text-rose-400 ml-1 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Browser WASM Status / Download Results */}
      {(isProcessingWasm || wasmError || exportedUrl || splitPartsUrls) && (
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
          {isProcessingWasm && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-violet-300">
                <span>{wasmStatus}</span>
                <span className="font-mono">{wasmProgress}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 transition-all duration-200"
                  style={{ width: `${wasmProgress}%` }}
                />
              </div>
            </div>
          )}

          {wasmError && <p className="text-xs text-rose-400">{wasmError}</p>}

          {exportedUrl && !isProcessingWasm && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-emerald-300">
                <Check className="w-4 h-4" />
                <span>{wasmStatus}</span>
              </div>
              <a
                href={exportedUrl}
                download={`edited_timeline_${Date.now()}.mp4`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
              >
                <Download className="w-3.5 h-3.5" />
                Download Edited MP4
              </a>
            </div>
          )}

          {splitPartsUrls && !isProcessingWasm && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-emerald-300 font-medium">
                {wasmStatus}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={splitPartsUrls.part1Url}
                  download={`split_part1_${Date.now()}.mp4`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                >
                  <Download className="w-3 h-3" />
                  Part 1 MP4
                </a>
                <a
                  href={splitPartsUrls.part2Url}
                  download={`split_part2_${Date.now()}.mp4`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium"
                >
                  <Download className="w-3 h-3" />
                  Part 2 MP4
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tag Scene Modal */}
      {isTagModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-amber-400" />
                <h4 className="text-sm font-bold text-white">
                  Tag Scene at {tagTimestamp.toFixed(2)}s
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setIsTagModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSceneTag} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Scene Label / Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g., Intro Hook, Product Closeup, Action Shot"
                  value={tagLabel}
                  onChange={(e) => setTagLabel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Category Badge
                  </label>
                  <select
                    value={tagCategory}
                    onChange={(e) =>
                      setTagCategory(e.target.value as NonNullable<SceneTag['category']>)
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  >
                    <option value="scene">Scene Marker</option>
                    <option value="highlight">Highlight ★</option>
                    <option value="b-roll">B-Roll</option>
                    <option value="cut">Cut / Transition</option>
                    <option value="note">Director Note</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Timestamp (sec)
                  </label>
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    max={safeDuration}
                    value={tagTimestamp}
                    onChange={(e) => setTagTimestamp(Number(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Metadata Notes (optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Add camera notes, upscale instructions, or shot description..."
                  value={tagNotes}
                  onChange={(e) => setTagNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTagModalOpen(false)}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
                >
                  Attach Scene Tag
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
