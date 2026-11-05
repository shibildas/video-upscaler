import React, { useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Columns,
  SplitSquareHorizontal,
  Eye,
  X,
  Crosshair,
} from 'lucide-react';
import { VideoMetadata, WatermarkBox } from '../types';

interface VideoComparePlayerProps {
  sourceUrl: string;
  outputUrl: string | null;
  sourceMeta: VideoMetadata;
  outputMeta: VideoMetadata | null;
  previewRotation?: 0 | 90 | 180 | 270;
  previewFlipH?: boolean;
  previewFlipV?: boolean;
  watermarkEnabled?: boolean;
  watermarkBoxes?: WatermarkBox[];
  onChangeWatermarkBoxes?: (boxes: WatermarkBox[]) => void;
}

export const VideoComparePlayer: React.FC<VideoComparePlayerProps> = ({
  sourceUrl,
  outputUrl,
  sourceMeta,
  outputMeta,
  previewRotation = 0,
  previewFlipH = false,
  previewFlipV = false,
  watermarkEnabled = false,
  watermarkBoxes = [],
  onChangeWatermarkBoxes,
}) => {
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [viewMode, setViewMode] = useState<'slider' | 'side-by-side' | 'single'>('slider');
  const [sliderPos, setSliderPos] = useState(50);
  const [currentTime, setCurrentTime] = useState(0);

  // Interactive drawing / dragging state for watermark regions
  const [drawStart, setDrawStart] = useState<{ xPct: number; yPct: number } | null>(null);
  const [draftBox, setDraftBox] = useState<WatermarkBox | null>(null);

  const togglePlay = () => {
    const v1 = sourceVideoRef.current;
    const v2 = outputVideoRef.current;
    if (!v1) return;

    if (v1.paused) {
      v1.play();
      if (v2) {
        v2.currentTime = v1.currentTime;
        v2.play();
      }
      setIsPlaying(true);
    } else {
      v1.pause();
      if (v2) v2.pause();
      setIsPlaying(false);
    }
  };

  const resetPlayback = () => {
    const v1 = sourceVideoRef.current;
    const v2 = outputVideoRef.current;
    if (v1) {
      v1.currentTime = 0;
      v1.pause();
    }
    if (v2) {
      v2.currentTime = 0;
      v2.pause();
    }
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    setCurrentTime(t);
    if (sourceVideoRef.current) sourceVideoRef.current.currentTime = t;
    if (outputVideoRef.current) outputVideoRef.current.currentTime = t;
  };

  /**
   * Compute actual rendered video content rect inside object-contain container
   */
  const getVideoContentRect = () => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const vidW = sourceMeta.width || 16;
    const vidH = sourceMeta.height || 9;
    const containerRatio = rect.width / rect.height;
    const videoRatio = vidW / vidH;

    let renderW = rect.width;
    let renderH = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (videoRatio > containerRatio) {
      renderW = rect.width;
      renderH = rect.width / videoRatio;
      offsetY = (rect.height - renderH) / 2;
    } else {
      renderH = rect.height;
      renderW = rect.height * videoRatio;
      offsetX = (rect.width - renderW) / 2;
    }

    return { left: rect.left + offsetX, top: rect.top + offsetY, width: renderW, height: renderH };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (watermarkEnabled && !outputUrl && onChangeWatermarkBoxes) {
      const vRect = getVideoContentRect();
      if (!vRect) return;
      const xPct = Math.max(0.01, Math.min(0.98, (e.clientX - vRect.left) / vRect.width));
      const yPct = Math.max(0.01, Math.min(0.98, (e.clientY - vRect.top) / vRect.height));
      setDrawStart({ xPct, yPct });
      setDraftBox({
        id: `wm_${Date.now()}`,
        label: 'Custom Region',
        xPct,
        yPct,
        wPct: 0.01,
        hPct: 0.01,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // 1. If drawing a watermark box
    if (drawStart && watermarkEnabled && !outputUrl) {
      const vRect = getVideoContentRect();
      if (!vRect) return;
      const curX = Math.max(0.01, Math.min(0.99, (e.clientX - vRect.left) / vRect.width));
      const curY = Math.max(0.01, Math.min(0.99, (e.clientY - vRect.top) / vRect.height));
      const x0 = Math.min(drawStart.xPct, curX);
      const y0 = Math.min(drawStart.yPct, curY);
      const w = Math.max(0.02, Math.abs(curX - drawStart.xPct));
      const h = Math.max(0.02, Math.abs(curY - drawStart.yPct));
      setDraftBox({
        id: `wm_${Date.now()}`,
        label: 'Custom Region',
        xPct: Number(x0.toFixed(4)),
        yPct: Number(y0.toFixed(4)),
        wPct: Number(Math.min(0.98 - x0, w).toFixed(4)),
        hPct: Number(Math.min(0.98 - y0, h).toFixed(4)),
      });
      return;
    }

    // 2. Otherwise handle split-wipe slider
    if (viewMode !== 'slider' || !outputUrl || !containerRef.current) return;
    if (e.buttons !== 1) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setSliderPos((x / rect.width) * 100);
  };

  const handleMouseUp = () => {
    if (drawStart && draftBox && onChangeWatermarkBoxes) {
      if (draftBox.wPct >= 0.025 && draftBox.hPct >= 0.025) {
        onChangeWatermarkBoxes([...watermarkBoxes, draftBox]);
      }
    }
    setDrawStart(null);
    setDraftBox(null);
  };

  const handleClickSlider = (e: React.MouseEvent<HTMLDivElement>) => {
    if (watermarkEnabled && !outputUrl) return;
    if (viewMode !== 'slider' || !outputUrl || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setSliderPos((x / rect.width) * 100);
  };

  const removeBox = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onChangeWatermarkBoxes) return;
    onChangeWatermarkBoxes(watermarkBoxes.filter((b) => b.id !== id));
  };

  // Live CSS transform preview for source video before rendering
  const isSideways = previewRotation === 90 || previewRotation === 270;
  const scaleAdjust = isSideways ? 0.5625 : 1;
  const liveSourceTransform = !outputUrl
    ? `rotate(${previewRotation}deg) scale(${previewFlipH ? -scaleAdjust : scaleAdjust}, ${
        previewFlipV ? -scaleAdjust : scaleAdjust
      })`
    : undefined;

  const allBoxes = draftBox ? [...watermarkBoxes, draftBox] : watermarkBoxes;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Frame Inspector
          </span>
          <span className="px-2 py-0.5 text-xs rounded-md bg-slate-800 text-slate-300 font-mono">
            Original: {sourceMeta.width}×{sourceMeta.height}
          </span>
          {outputMeta && (
            <>
              <span className="text-slate-500">→</span>
              <span className="px-2 py-0.5 text-xs rounded-md bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 font-mono font-semibold">
                Upscaled: {outputMeta.width}×{outputMeta.height}
              </span>
            </>
          )}
        </div>

        {watermarkEnabled && !outputUrl && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
            <Crosshair className="w-3.5 h-3.5" />
            <span>Drag on video frame to mark watermark region</span>
          </div>
        )}

        {outputUrl && (
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('slider')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                viewMode === 'slider'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <SplitSquareHorizontal className="w-3.5 h-3.5" />
              Split Wipe
            </button>
            <button
              type="button"
              onClick={() => setViewMode('side-by-side')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                viewMode === 'side-by-side'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              Side-by-Side
            </button>
            <button
              type="button"
              onClick={() => setViewMode('single')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                viewMode === 'single'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Upscaled Only
            </button>
          </div>
        )}
      </div>

      {/* Video Canvas */}
      {viewMode === 'side-by-side' && outputUrl ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-slate-950">
          <div className="relative rounded-xl overflow-hidden bg-black border border-slate-800 aspect-video flex items-center justify-center">
            <video
              ref={sourceVideoRef}
              src={sourceUrl}
              className="max-h-full max-w-full object-contain"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onEnded={() => setIsPlaying(false)}
              playsInline
            />
            <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-sm text-xs font-medium text-slate-200 border border-white/10">
              Original ({sourceMeta.width}×{sourceMeta.height})
            </div>
          </div>
          <div className="relative rounded-xl overflow-hidden bg-black border border-indigo-500/40 aspect-video flex items-center justify-center">
            <video
              ref={outputVideoRef}
              src={outputUrl}
              className="max-h-full max-w-full object-contain"
              muted
              playsInline
            />
            <div className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-md bg-indigo-600/90 backdrop-blur-sm text-xs font-semibold text-white shadow">
              Upscaled ({outputMeta?.width}×{outputMeta?.height})
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleClickSlider}
          className={`relative bg-slate-950 aspect-video max-h-[460px] w-full flex items-center justify-center overflow-hidden select-none ${
            outputUrl && viewMode === 'slider'
              ? 'cursor-ew-resize'
              : watermarkEnabled && !outputUrl
              ? 'cursor-crosshair'
              : ''
          }`}
        >
          {/* Base Layer: Either Output (when available) or Source */}
          <video
            ref={outputUrl ? outputVideoRef : sourceVideoRef}
            src={outputUrl || sourceUrl}
            style={{ transform: liveSourceTransform }}
            className="w-full h-full object-contain transition-transform duration-300 pointer-events-none"
            onTimeUpdate={(e) => {
              if (!outputUrl) setCurrentTime(e.currentTarget.currentTime);
            }}
            onEnded={() => setIsPlaying(false)}
            muted={Boolean(outputUrl)}
            playsInline
          />

          {/* Watermark Bounding Box Overlays (shown on Source preview when Watermark Removal is enabled) */}
          {watermarkEnabled && !outputUrl && allBoxes.length > 0 && (
            <div className="absolute inset-0 pointer-events-none">
              {allBoxes.map((box, idx) => (
                <div
                  key={box.id}
                  style={{
                    left: `${box.xPct * 100}%`,
                    top: `${box.yPct * 100}%`,
                    width: `${box.wPct * 100}%`,
                    height: `${box.hPct * 100}%`,
                  }}
                  className="absolute border-2 border-rose-500 bg-rose-500/20 backdrop-blur-[2px] rounded-md shadow-[0_0_12px_rgba(244,63,94,0.45)] flex items-start justify-between p-1 pointer-events-auto"
                >
                  <span className="px-1.5 py-0.5 rounded bg-rose-600/90 text-[10px] font-semibold text-white leading-none shadow">
                    #{idx + 1} {box.label || 'Watermark'}
                    {box.confidence ? ` (${box.confidence}%)` : ''}
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => removeBox(box.id, e)}
                    className="w-4 h-4 rounded bg-black/80 hover:bg-rose-600 text-white flex items-center justify-center transition cursor-pointer"
                    title="Remove this watermark zone"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Top Clipped Layer for Split Wipe Comparison */}
          {outputUrl && viewMode === 'slider' && (
            <>
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
              >
                <video
                  ref={sourceVideoRef}
                  src={sourceUrl}
                  className="w-full h-full object-contain"
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onEnded={() => setIsPlaying(false)}
                  playsInline
                />
              </div>

              {/* Vertical Divider Handle */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.9)] pointer-events-none"
                style={{ left: `${sliderPos}%` }}
              >
                <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-indigo-600 border-2 border-white shadow-lg flex items-center justify-center text-white text-xs font-bold">
                  ⇄
                </div>
              </div>

              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-sm text-xs font-medium text-slate-200 border border-white/10 pointer-events-none">
                BEFORE • {sourceMeta.width}×{sourceMeta.height}
              </div>
              <div className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-indigo-600/90 backdrop-blur-sm text-xs font-semibold text-white shadow pointer-events-none">
                AFTER • {outputMeta?.width}×{outputMeta?.height}
              </div>
            </>
          )}

          {!outputUrl && (
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-sm text-xs font-medium text-slate-300 border border-white/10 pointer-events-none">
              Source Preview • {sourceMeta.width}×{sourceMeta.height} @ {sourceMeta.fps} fps
              {previewRotation ? ` • Rotated ${previewRotation}°` : ''}
              {previewFlipH ? ' • Flip H' : ''}
              {previewFlipV ? ' • Flip V' : ''}
              {watermarkEnabled && watermarkBoxes.length > 0
                ? ` • ${watermarkBoxes.length} Watermark Zone(s)`
                : ''}
            </div>
          )}
        </div>
      )}

      {/* Playback Controls Bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-900 border-t border-slate-800">
        <button
          type="button"
          onClick={togglePlay}
          className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer"
          title={isPlaying ? 'Pause' : 'Play synchronized preview'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={resetPlayback}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
          title="Restart"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <input
          type="range"
          min={0}
          max={sourceMeta.duration || 10}
          step={0.05}
          value={currentTime}
          onChange={handleSeek}
          className="flex-1 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
        />

        <span className="text-xs font-mono text-slate-400 min-w-[85px] text-right">
          {currentTime.toFixed(1)}s / {(sourceMeta.duration || 0).toFixed(1)}s
        </span>
      </div>
    </div>
  );
};
