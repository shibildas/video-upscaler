import React, { useEffect, useState, useRef } from 'react';
import {
  Upload,
  Sparkles,
  Sliders,
  Cpu,
  Download,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Maximize2,
  Wand2,
  Zap,
  FileVideo,
  Copy,
  Check,
  XCircle,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Fingerprint,
  Eraser,
  ScanSearch,
  Trash2,
  Globe,
  Compass,
  Film,
  ChevronDown,
  ChevronUp,
  SunMedium,
  Layers,
  Plus,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import {
  ResolutionPreset,
  UploadedVideo,
  UpscaleConfig,
  JobState,
  WatermarkBox,
  TransitionType,
} from './types';
import { VideoComparePlayer } from './components/VideoComparePlayer';
import { VideoTimelineEditor } from './components/VideoTimelineEditor';
import { getBrowserFingerprint } from './utils/fingerprint';

const RESOLUTION_PRESETS: ResolutionPreset[] = [
  {
    id: '720p',
    label: '720p HD',
    badge: 'HD',
    width: 1280,
    height: 720,
    desc: '1280×720',
    recommendedBitrateMbps: 6,
  },
  {
    id: '1080p',
    label: '1080p FHD',
    badge: 'FHD',
    width: 1920,
    height: 1080,
    desc: '1920×1080',
    recommendedBitrateMbps: 12,
  },
  {
    id: '2k',
    label: '2K QHD',
    badge: '2K',
    width: 2560,
    height: 1440,
    desc: '2560×1440',
    recommendedBitrateMbps: 24,
  },
  {
    id: '4k',
    label: '4K UHD',
    badge: '4K',
    width: 3840,
    height: 2160,
    desc: '3840×2160',
    recommendedBitrateMbps: 45,
  },
  {
    id: '7200w',
    label: '7200px 8K',
    badge: '7200p',
    width: 7200,
    height: 4050,
    desc: '7200×4050',
    recommendedBitrateMbps: 85,
  },
  {
    id: 'custom',
    label: 'Custom',
    badge: 'W×H',
    width: 1920,
    height: 1080,
    desc: 'Custom W×H',
    recommendedBitrateMbps: 16,
  },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function formatAspectRatio(w: number, h: number): string {
  if (!w || !h) return '16:9';
  const divisor = gcd(w, h);
  return `${w / divisor}:${h / divisor}`;
}

function toEven(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

type InspectorTab = 'geometry' | 'enhance' | 'cleanup' | 'merge' | 'export';

export default function App() {
  const [systemInfo, setSystemInfo] = useState<{
    available: boolean;
    version?: string;
    capabilities?: Record<string, boolean>;
  } | null>(null);
  const [fingerprint, setFingerprint] = useState<string>('');

  const [video, setVideo] = useState<UploadedVideo | null>(null);
  const [clipQueue, setClipQueue] = useState<UploadedVideo[]>([]);
  const [transitionType, setTransitionType] = useState<TransitionType>('fade');
  const [transitionDuration, setTransitionDuration] = useState<number>(1.0);
  const [playheadTime, setPlayheadTime] = useState<number>(0);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDetectingWatermark, setIsDetectingWatermark] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Studio Workspace UI States
  const [activeTab, setActiveTab] = useState<InspectorTab>('geometry');
  const [showTimelineDrawer, setShowTimelineDrawer] = useState<boolean>(true);
  const [showCliDrawer, setShowCliDrawer] = useState<boolean>(false);

  // Real-Time Live FFmpeg Frame Preview State
  const [livePreviewEnabled, setLivePreviewEnabled] = useState<boolean>(true);
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
  const [isLivePreviewLoading, setIsLivePreviewLoading] = useState<boolean>(false);

  const [config, setConfig] = useState<UpscaleConfig>({
    presetId: '1080p',
    width: 1920,
    height: 1080,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    watermarkEnabled: false,
    watermarkMode: 'delogo',
    watermarkBoxes: [],
    vrNormalizeEnabled: false,
    vrInputProjection: 'e',
    vrStereoMode: 'mono',
    vrFov: 95,
    vrYaw: 0,
    vrPitch: 0,
    vrRoll: 0,
    aspectMode: 'fit',
    scaleAlgorithm: 'lanczos',
    sharpenPreset: 'medium',
    sharpenAmount: 1.0,
    denoise: 'none',
    enhancePreset: 'none',
    casStrength: 0,
    debandEnabled: false,
    deinterlaceEnabled: false,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    gamma: 1,
    vibrance: 0,
    codec: 'libx264',
    rateControl: 'crf',
    crf: 18,
    targetBitrateMbps: 16,
    preset: 'fast',
    fps: 'source',
    pixelFormat: 'yuv420p',
    audioMode: 'copy',
    container: 'mp4',
  });

  const [cliCommand, setCliCommand] = useState<string>('');
  const [copiedCli, setCopiedCli] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addClipsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getBrowserFingerprint().then((fp) => setFingerprint(fp));
    fetch('/api/system-info')
      .then((r) => r.json())
      .then((data) => setSystemInfo(data))
      .catch(() => setSystemInfo({ available: false }));
  }, []);

  // Update live FFmpeg CLI preview
  useEffect(() => {
    fetch('/api/preview-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: video?.originalName || 'input.mp4',
        config,
        sourceMeta: video?.metadata || null,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.command) setCliCommand(data.command);
      })
      .catch(() => {});
  }, [config, video]);

  // Real-time debounced FFmpeg live frame preview whenever filter settings or playhead changes
  useEffect(() => {
    if (!video || !livePreviewEnabled || job?.outputUrl) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLivePreviewLoading(true);
      try {
        const res = await fetch('/api/live-preview-frame', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            fileId: video.fileId,
            timestamp: playheadTime,
            config,
            sourceMeta: video.metadata,
          }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const nextUrl = URL.createObjectURL(blob);
          setLivePreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return nextUrl;
          });
        }
      } catch (_e) {
        // ignore aborted preview requests
      } finally {
        setIsLivePreviewLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    video?.fileId,
    livePreviewEnabled,
    job?.outputUrl,
    playheadTime,
    config.width,
    config.height,
    config.rotation,
    config.flipHorizontal,
    config.flipVertical,
    config.aspectMode,
    config.scaleAlgorithm,
    config.sharpenPreset,
    config.sharpenAmount,
    config.denoise,
    config.casStrength,
    config.debandEnabled,
    config.deinterlaceEnabled,
    config.brightness,
    config.contrast,
    config.saturation,
    config.gamma,
    config.vibrance,
    config.watermarkEnabled,
    config.watermarkMode,
    config.watermarkBoxes,
    config.vrNormalizeEnabled,
    config.vrInputProjection,
    config.vrStereoMode,
    config.vrFov,
    config.vrYaw,
    config.vrPitch,
    config.vrRoll,
  ]);

  // Poll active FFmpeg job progress
  useEffect(() => {
    if (!job || job.status !== 'processing') return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.jobId}`);
        if (res.ok) {
          const updated: JobState = await res.json();
          setJob(updated);
          if (updated.status !== 'processing') {
            clearInterval(timer);
          }
        }
      } catch (_err) {
        // ignore
      }
    }, 500);

    return () => clearInterval(timer);
  }, [job?.jobId, job?.status]);

  const handleSelectPreset = (preset: ResolutionPreset) => {
    setConfig((prev) => {
      const srcW = video?.metadata.width || 1920;
      const srcH = video?.metadata.height || 1080;
      const isRotatedSideways = prev.rotation === 90 || prev.rotation === 270;
      const effectiveSrcW = isRotatedSideways ? srcH : srcW;
      const effectiveSrcH = isRotatedSideways ? srcW : srcH;
      const isPortrait = effectiveSrcH > effectiveSrcW && !prev.vrNormalizeEnabled;

      const baseW = preset.id === 'custom' ? prev.width : preset.width;
      const baseH = preset.id === 'custom' ? prev.height : preset.height;
      const nextW = isPortrait && preset.id !== 'custom' ? baseH : baseW;
      const nextH = isPortrait && preset.id !== 'custom' ? baseW : baseH;
      return {
        ...prev,
        presetId: preset.id,
        width: nextW,
        height: nextH,
        targetBitrateMbps: preset.recommendedBitrateMbps,
        codec:
          Math.max(nextW, nextH) > 4096 &&
          (prev.codec === 'libx264' || prev.codec === 'h264_videotoolbox')
            ? 'libx265'
            : prev.codec,
      };
    });
  };

  const handleSetRotation = (newRotation: 0 | 90 | 180 | 270) => {
    setConfig((prev) => {
      const wasSideways = prev.rotation === 90 || prev.rotation === 270;
      const isNowSideways = newRotation === 90 || newRotation === 270;
      const shouldSwapDimensions = wasSideways !== isNowSideways;
      return {
        ...prev,
        rotation: newRotation,
        width: shouldSwapDimensions ? prev.height : prev.width,
        height: shouldSwapDimensions ? prev.width : prev.height,
      };
    });
  };

  const applyEnhancePreset = (
    preset: UpscaleConfig['enhancePreset']
  ) => {
    if (preset === 'none') {
      setConfig((prev) => ({
        ...prev,
        enhancePreset: 'none',
        sharpenPreset: 'none',
        denoise: 'none',
        casStrength: 0,
        debandEnabled: false,
        brightness: 0,
        contrast: 1,
        saturation: 1,
        gamma: 1,
        vibrance: 0,
      }));
    } else if (preset === 'cinema') {
      setConfig((prev) => ({
        ...prev,
        enhancePreset: 'cinema',
        sharpenPreset: 'light',
        casStrength: 0.45,
        debandEnabled: true,
        brightness: 0.0,
        contrast: 1.12,
        saturation: 1.08,
        gamma: 0.96,
        vibrance: 0.25,
      }));
    } else if (preset === 'vivid') {
      setConfig((prev) => ({
        ...prev,
        enhancePreset: 'vivid',
        sharpenPreset: 'medium',
        casStrength: 0.6,
        debandEnabled: false,
        brightness: 0.02,
        contrast: 1.16,
        saturation: 1.28,
        gamma: 1.0,
        vibrance: 0.45,
      }));
    } else if (preset === 'restore') {
      setConfig((prev) => ({
        ...prev,
        enhancePreset: 'restore',
        sharpenPreset: 'strong',
        denoise: 'medium',
        casStrength: 0.7,
        debandEnabled: true,
        brightness: 0.02,
        contrast: 1.1,
        saturation: 1.05,
        gamma: 1.02,
        vibrance: 0.15,
      }));
    } else if (preset === 'lowlight') {
      setConfig((prev) => ({
        ...prev,
        enhancePreset: 'lowlight',
        sharpenPreset: 'light',
        denoise: 'medium',
        casStrength: 0.35,
        debandEnabled: true,
        brightness: 0.08,
        contrast: 1.08,
        saturation: 1.1,
        gamma: 1.28,
        vibrance: 0.2,
      }));
    }
  };

  const handleFilesSelected = async (
    fileList: FileList | File[],
    appendToQueue = false
  ) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);
    setJob(null);

    try {
      const fp = fingerprint || (await getBrowserFingerprint());

      if (files.length > 1 || appendToQueue) {
        const formData = new FormData();
        const keepIds = appendToQueue ? clipQueue.map((c) => c.fileId) : [];
        formData.append('keepFileIds', JSON.stringify(keepIds));
        formData.append('fingerprint', fp);
        for (const f of files) {
          formData.append('videos', f);
        }

        const res = await fetch('/api/upload-multiple', {
          method: 'POST',
          headers: { 'x-browser-fingerprint': fp },
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Multi-file upload failed');
        const uploadedClips: UploadedVideo[] = data.clips || [];
        if (uploadedClips.length > 0) {
          const nextQueue = appendToQueue
            ? [...clipQueue, ...uploadedClips]
            : uploadedClips;
          setClipQueue(nextQueue);
          setVideo(nextQueue[0]);
          setPlayheadTime(0);
          if (nextQueue.length >= 2) {
            setActiveTab('merge');
          }
        }
      } else {
        const file = files[0];
        const prevFileId = video?.fileId;
        const prevJobId = job?.jobId;
        const formData = new FormData();
        if (prevFileId) formData.append('previousFileId', prevFileId);
        if (prevJobId) formData.append('previousJobId', prevJobId);
        formData.append('fingerprint', fp);
        formData.append('video', file);

        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'x-browser-fingerprint': fp },
          body: formData,
        });
        const data: UploadedVideo = await res.json();
        if (!res.ok) throw new Error((data as any).error || 'Upload failed');
        setVideo(data);
        setClipQueue([data]);
        setPlayheadTime(0);

        if (data.metadata.width && data.metadata.height) {
          const isSourcePortrait = data.metadata.height > data.metadata.width;
          const vrInfo = data.metadata.vr360;
          const detectedProj =
            vrInfo?.projection === 'hequirectangular'
              ? 'hequirect'
              : vrInfo?.projection === 'cubemap'
              ? 'cubemap'
              : vrInfo?.projection === 'fisheye'
              ? 'fisheye'
              : 'e';
          const detectedStereo = vrInfo?.stereoMode || 'mono';

          setConfig((prev) => {
            const isTargetPortrait = prev.height > prev.width;
            return {
              ...prev,
              rotation: 0,
              watermarkBoxes: [],
              vrNormalizeEnabled: Boolean(vrInfo?.isVr360),
              vrInputProjection: detectedProj,
              vrStereoMode: detectedStereo,
              vrYaw: 0,
              vrPitch: 0,
              vrRoll: 0,
              width: isSourcePortrait !== isTargetPortrait ? prev.height : prev.width,
              height: isSourcePortrait !== isTargetPortrait ? prev.width : prev.height,
            };
          });

          if (vrInfo?.isVr360) {
            setActiveTab('cleanup');
          }
        }
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
      if (addClipsInputRef.current) addClipsInputRef.current.value = '';
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload video(s)');
    } finally {
      setIsUploading(false);
    }
  };

  const handleMergeWithTransitions = async () => {
    if (clipQueue.length < 2) return;
    setUploadError(null);

    try {
      const fp = fingerprint || (await getBrowserFingerprint());
      const res = await fetch('/api/merge-transitions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-browser-fingerprint': fp,
        },
        body: JSON.stringify({
          fingerprint: fp,
          fileIds: clipQueue.map((c) => c.fileId),
          transition: transitionType,
          transitionDuration,
          width: effectiveOutW,
          height: effectiveOutH,
          fps: config.fps === 'source' ? 30 : Number(config.fps) || 30,
          codec: config.codec,
          crf: config.crf,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start transition merge');

      const totalDur = clipQueue.reduce((s, c) => s + (c.metadata.duration || 0), 0);
      setJob({
        jobId: data.jobId,
        status: 'processing',
        progress: 0,
        fps: 0,
        speed: '0x',
        bitrate: '',
        currentTimeSec: 0,
        totalDurationSec: Math.max(1, totalDur),
        command: data.command,
        startedAt: Date.now(),
        completedAt: null,
        outputUrl: null,
        outputFilename: '',
        outputMetadata: null,
        error: null,
        logs: [],
      });
    } catch (err: any) {
      setUploadError(err.message || 'Merge with transitions failed');
    }
  };

  const moveClipInQueue = (index: number, direction: -1 | 1) => {
    setClipQueue((prev) => {
      const next = [...prev];
      const targetIdx = index + direction;
      if (targetIdx < 0 || targetIdx >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(targetIdx, 0, item);
      return next;
    });
  };

  const removeClipFromQueue = (fileId: string) => {
    setClipQueue((prev) => {
      const next = prev.filter((c) => c.fileId !== fileId);
      if (video?.fileId === fileId && next.length > 0) {
        setVideo(next[0]);
      } else if (next.length === 0) {
        setVideo(null);
      }
      return next;
    });
  };

  const handleAutoDetectWatermarks = async () => {
    if (!video) return;
    setIsDetectingWatermark(true);
    setUploadError(null);
    try {
      const res = await fetch('/api/detect-watermark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: video.fileId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Watermark scan failed');
      const boxes: WatermarkBox[] = data.boxes || [];
      setConfig((prev) => ({
        ...prev,
        watermarkEnabled: true,
        watermarkBoxes: boxes,
      }));
    } catch (err: any) {
      setUploadError(err.message || 'Failed to auto-detect watermark');
    } finally {
      setIsDetectingWatermark(false);
    }
  };

  const handleGenerateSample = async () => {
    setIsUploading(true);
    setUploadError(null);
    const prevFileId = video?.fileId;
    const prevJobId = job?.jobId;
    setJob(null);
    try {
      const fp = fingerprint || (await getBrowserFingerprint());
      const res = await fetch('/api/generate-sample', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-browser-fingerprint': fp,
        },
        body: JSON.stringify({
          fingerprint: fp,
          previousFileId: prevFileId,
          previousJobId: prevJobId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate sample video');
      setVideo(data);
      setClipQueue([data]);
      setPlayheadTime(0);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to generate sample video');
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartUpscale = async () => {
    if (!video) return;
    setUploadError(null);

    try {
      const fp = fingerprint || (await getBrowserFingerprint());
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-browser-fingerprint': fp,
        },
        body: JSON.stringify({
          fingerprint: fp,
          fileId: video.fileId,
          config,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start FFmpeg job');

      setJob({
        jobId: data.jobId,
        status: 'processing',
        progress: 0,
        fps: 0,
        speed: '0x',
        bitrate: '',
        currentTimeSec: 0,
        totalDurationSec: video.metadata.duration || 1,
        command: data.command,
        startedAt: Date.now(),
        completedAt: null,
        outputUrl: null,
        outputFilename: '',
        outputMetadata: null,
        error: null,
        logs: [],
      });
    } catch (err: any) {
      setUploadError(err.message);
    }
  };

  const handleCancelJob = async () => {
    if (!job) return;
    await fetch(`/api/jobs/${job.jobId}/cancel`, { method: 'POST' });
  };

  const copyCommand = () => {
    navigator.clipboard.writeText(cliCommand);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 1800);
  };

  // Compute post-rotation source dimensions and exact final output resolution
  const isSidewaysRotation = config.rotation === 90 || config.rotation === 270;
  const rotatedSourceW = video
    ? isSidewaysRotation
      ? video.metadata.height
      : video.metadata.width
    : config.width;
  const rotatedSourceH = video
    ? isSidewaysRotation
      ? video.metadata.width
      : video.metadata.height
    : config.height;

  const targetBoxW = toEven(config.width);
  const targetBoxH = toEven(config.height);

  let effectiveOutW = targetBoxW;
  let effectiveOutH = targetBoxH;
  if (
    video &&
    config.aspectMode === 'fit' &&
    !config.vrNormalizeEnabled &&
    rotatedSourceW > 0 &&
    rotatedSourceH > 0
  ) {
    const ratio = Math.min(targetBoxW / rotatedSourceW, targetBoxH / rotatedSourceH);
    effectiveOutW = toEven(rotatedSourceW * ratio);
    effectiveOutH = toEven(rotatedSourceH * ratio);
  }

  const outputAspectRatio = formatAspectRatio(effectiveOutW, effectiveOutH);
  const scaleFactor =
    video && rotatedSourceH > 0 ? (effectiveOutH / rotatedSourceH).toFixed(2) : null;

  return (
    <div className="min-h-screen bg-[#090b10] text-slate-100 flex flex-col">
      {/* Sleek Studio Top Bar (DaVinci / CapCut Pro Inspired) */}
      <header className="h-14 border-b border-slate-800/80 bg-[#0d1117]/90 backdrop-blur-md sticky top-0 z-30 px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight text-white shrink-0">
            FrameScale Studio
          </span>

          {video && (
            <>
              <span className="text-slate-700">/</span>
              <div className="flex items-center gap-2 min-w-0">
                <FileVideo className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="text-xs font-medium text-slate-200 truncate max-w-[200px] sm:max-w-[300px]">
                  {video.originalName}
                </span>
                <span className="hidden md:inline-block px-2 py-0.5 rounded bg-slate-800/90 text-[11px] font-mono text-slate-300">
                  {video.metadata.width}×{video.metadata.height} • {video.metadata.fps}fps •{' '}
                  {formatBytes(video.metadata.sizeBytes)}
                </span>
                {video.metadata.vr360?.isVr360 && (
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 flex items-center gap-1 shrink-0"
                    title={video.metadata.vr360.reason}
                  >
                    <Globe className="w-3 h-3" />
                    360° VR
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right Top Toolbar Actions */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleFilesSelected(e.target.files, false);
            }}
          />
          <input
            ref={addClipsInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleFilesSelected(e.target.files, true);
            }}
          />

          {video && (
            <>
              <button
                type="button"
                onClick={() => addClipsInputRef.current?.click()}
                className="px-2.5 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 text-indigo-200 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                title="Add more video files to merge with transitions"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-400" />
                <span>Add Clips ({clipQueue.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShowTimelineDrawer((s) => !s)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition cursor-pointer ${
                  showTimelineDrawer
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Timeline</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCliDrawer((s) => !s)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition cursor-pointer ${
                  showCliDrawer
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="View generated FFmpeg CLI command"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">CLI</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition cursor-pointer"
              >
                Replace Video
              </button>
            </>
          )}

          {fingerprint && (
            <div
              className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-400 text-[11px] font-mono"
              title={`Session Fingerprint: ${fingerprint}`}
            >
              <Fingerprint className="w-3 h-3 text-indigo-400" />
              <span>{fingerprint.slice(0, 6)}</span>
            </div>
          )}

          {systemInfo?.available && (
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px]"
              title={systemInfo.version}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>FFmpeg Ready</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Studio Workspace: 8-Col Cinema Stage + 4-Col Tabbed Inspector */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left 8 Columns: Cinema Viewport, Status Ribbon & Collapsible Timeline */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {!video ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.length) {
                  handleFilesSelected(e.dataTransfer.files, false);
                }
              }}
              className="border-2 border-dashed border-slate-800 hover:border-indigo-500/60 bg-[#0d1117]/80 rounded-2xl p-12 text-center transition flex flex-col items-center justify-center min-h-[480px]"
            >
              <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mb-4 text-indigo-400">
                {isUploading ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : (
                  <Upload className="w-8 h-8" />
                )}
              </div>
              <h2 className="text-xl font-bold text-white mb-1.5">
                Drop one or multiple videos into FrameScale Studio
              </h2>
              <p className="text-sm text-slate-400 max-w-md mb-6">
                Select multiple files to merge with smooth transitions (`xfade`), upscale up to 4K UHD & 7200px, enhance clarity & color, or unwrap 360° VR footage.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 transition cursor-pointer"
                >
                  {isUploading ? 'Loading Media...' : 'Select Video File(s)'}
                </button>

                <button
                  type="button"
                  disabled={isUploading}
                  onClick={handleGenerateSample}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-medium text-sm border border-slate-700 transition cursor-pointer"
                >
                  <Wand2 className="w-4 h-4 text-indigo-400" />
                  Load 360p Demo Clip
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Large Cinema Monitor with Live FFmpeg Frame Preview */}
              <VideoComparePlayer
                sourceUrl={video.url}
                outputUrl={job?.outputUrl || null}
                sourceMeta={video.metadata}
                outputMeta={job?.outputMetadata || null}
                previewRotation={config.rotation}
                previewFlipH={config.flipHorizontal}
                previewFlipV={config.flipVertical}
                watermarkEnabled={config.watermarkEnabled}
                watermarkBoxes={config.watermarkBoxes}
                onChangeWatermarkBoxes={(boxes) =>
                  setConfig((prev) => ({ ...prev, watermarkBoxes: boxes }))
                }
                externalSeekTime={seekTarget}
                onTimeChange={(t) => setPlayheadTime(t)}
                livePreviewFrameUrl={livePreviewUrl}
                isLivePreviewLoading={isLivePreviewLoading}
                livePreviewEnabled={livePreviewEnabled}
                onToggleLivePreview={() => setLivePreviewEnabled((v) => !v)}
                vrNormalizeEnabled={config.vrNormalizeEnabled}
                vrYaw={config.vrYaw}
                vrPitch={config.vrPitch}
                onChangeVrAngles={(yaw, pitch) =>
                  setConfig((prev) => ({ ...prev, vrYaw: yaw, vrPitch: pitch }))
                }
              />

              {/* Compact Pipeline Telemetry Pill Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-[#0d1117] border border-slate-800/80 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-400">Pipeline:</span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-slate-200">
                    {rotatedSourceW}×{rotatedSourceH} →{' '}
                    <strong className="text-indigo-300">
                      {effectiveOutW}×{effectiveOutH}
                    </strong>{' '}
                    ({outputAspectRatio}{scaleFactor ? ` • ${scaleFactor}×` : ''})
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 capitalize">
                    {config.scaleAlgorithm}
                  </span>
                  {config.enhancePreset !== 'none' && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 capitalize">
                      Look: {config.enhancePreset}
                    </span>
                  )}
                  {config.vrNormalizeEnabled && (
                    <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                      360°→2D ({config.vrFov}° FOV)
                    </span>
                  )}
                  {config.watermarkEnabled && config.watermarkBoxes.length > 0 && (
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300">
                      Delogo ({config.watermarkBoxes.length})
                    </span>
                  )}
                </div>

                <span className="font-mono text-slate-400">
                  {config.codec.replace('_videotoolbox', ' HW')} • {config.container.toUpperCase()}
                </span>
              </div>

              {/* Multi-Clip Storyboard & Transition Merge Bar */}
              {clipQueue.length > 0 && (
                <div className="bg-[#0d1117] border border-slate-800/90 rounded-2xl p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-violet-400" />
                      <span className="text-xs font-semibold text-white">
                        Multi-Clip Storyboard ({clipQueue.length}{' '}
                        {clipQueue.length === 1 ? 'clip' : 'clips'})
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Total:{' '}
                        {clipQueue
                          .reduce((acc, c) => acc + (c.metadata.duration || 0), 0)
                          .toFixed(1)}
                        s
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {clipQueue.length >= 2 && (
                        <>
                          <select
                            value={transitionType}
                            onChange={(e) =>
                              setTransitionType(e.target.value as TransitionType)
                            }
                            className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                            title="FFmpeg xfade transition style between clips"
                          >
                            <option value="fade">Transition: Crossfade</option>
                            <option value="fadeblack">Dip to Black</option>
                            <option value="fadewhite">Dip to White</option>
                            <option value="dissolve">Film Dissolve</option>
                            <option value="wipeleft">Wipe Left</option>
                            <option value="wiperight">Wipe Right</option>
                            <option value="slideleft">Slide Left</option>
                            <option value="slideright">Slide Right</option>
                            <option value="smoothleft">Smooth Push Left</option>
                            <option value="smoothright">Smooth Push Right</option>
                            <option value="circleopen">Circle Iris Open</option>
                            <option value="circleclose">Circle Iris Close</option>
                            <option value="radial">Radial Clock Wipe</option>
                            <option value="pixelize">Pixelize Morph</option>
                          </select>

                          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-xs">
                            <span className="text-slate-400">Dur:</span>
                            <input
                              type="number"
                              min={0.2}
                              max={3.5}
                              step={0.2}
                              value={transitionDuration}
                              onChange={(e) =>
                                setTransitionDuration(
                                  Math.max(0.2, Math.min(3.5, Number(e.target.value) || 1.0))
                                )
                              }
                              className="w-12 bg-transparent font-mono text-indigo-300 text-right focus:outline-none"
                            />
                            <span className="text-slate-500">s</span>
                          </div>

                          <button
                            type="button"
                            disabled={job?.status === 'processing'}
                            onClick={handleMergeWithTransitions}
                            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow-md shadow-violet-600/20 flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Merge {clipQueue.length} Clips ({transitionType})
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => addClipsInputRef.current?.click()}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 flex items-center gap-1 transition cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 text-indigo-400" />
                        Add File
                      </button>
                    </div>
                  </div>

                  {/* Horizontal Storyboard Strip */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {clipQueue.map((item, idx) => {
                      const isActive = item.fileId === video.fileId;
                      return (
                        <React.Fragment key={item.fileId}>
                          <div
                            onClick={() => {
                              setVideo(item);
                              setPlayheadTime(0);
                            }}
                            className={`group relative shrink-0 w-48 p-2.5 rounded-xl border transition cursor-pointer ${
                              isActive
                                ? 'bg-indigo-600/15 border-indigo-500 text-white'
                                : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-indigo-300">
                                #{idx + 1}
                              </span>
                              <div className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100">
                                {idx > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      moveClipInQueue(idx, -1);
                                    }}
                                    className="p-0.5 hover:text-indigo-400 cursor-pointer"
                                    title="Move Left"
                                  >
                                    <ArrowLeft className="w-3 h-3" />
                                  </button>
                                )}
                                {idx < clipQueue.length - 1 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      moveClipInQueue(idx, 1);
                                    }}
                                    className="p-0.5 hover:text-indigo-400 cursor-pointer"
                                    title="Move Right"
                                  >
                                    <ArrowRight className="w-3 h-3" />
                                  </button>
                                )}
                                {clipQueue.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeClipFromQueue(item.fileId);
                                    }}
                                    className="p-0.5 hover:text-rose-400 cursor-pointer"
                                    title="Remove Clip"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-xs font-medium truncate">
                              {item.originalName}
                            </p>
                            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                              {item.metadata.width}×{item.metadata.height} •{' '}
                              {(item.metadata.duration || 0).toFixed(1)}s
                            </p>
                          </div>

                          {/* Transition Connector Pill Between Clips */}
                          {idx < clipQueue.length - 1 && (
                            <div className="shrink-0 px-2 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-[10px] font-mono text-violet-300 flex items-center gap-1">
                              <span>⚡ {transitionType}</span>
                              <span>({transitionDuration}s)</span>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Active / Completed Render Progress Banner */}
              {job && (
                <div className="bg-[#0d1117] border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {job.status === 'processing' && (
                        <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                      )}
                      {job.status === 'completed' && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      )}
                      {(job.status === 'failed' || job.status === 'cancelled') && (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      )}
                      <span className="text-xs font-semibold text-white">
                        {job.status === 'processing' &&
                          `Rendering ${effectiveOutW}×${effectiveOutH} (${job.progress}%)...`}
                        {job.status === 'completed' &&
                          `Render Complete • ${job.outputMetadata?.width}×${job.outputMetadata?.height} (${formatBytes(
                            job.outputMetadata?.sizeBytes || 0
                          )})`}
                        {job.status === 'failed' && 'Encoding Failed'}
                        {job.status === 'cancelled' && 'Render Cancelled'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                      {job.fps > 0 && <span>{job.fps.toFixed(1)} fps</span>}
                      {job.speed && job.speed !== '0x' && <span>{job.speed}</span>}
                      {job.status === 'processing' && (
                        <button
                          type="button"
                          onClick={handleCancelJob}
                          className="text-rose-400 hover:text-rose-300 font-sans font-medium cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                      {job.status === 'completed' && job.outputUrl && (
                        <a
                          href={job.outputUrl}
                          download={job.outputFilename}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-semibold shadow transition"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download MP4
                        </a>
                      )}
                    </div>
                  </div>

                  {job.status === 'processing' && (
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  )}

                  {job.status === 'failed' && job.error && (
                    <pre className="p-2.5 rounded-lg bg-slate-950 border border-rose-500/30 text-rose-300 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                      {job.error}
                    </pre>
                  )}
                </div>
              )}

              {/* Collapsible Non-Linear Timeline Drawer */}
              {showTimelineDrawer && (
                <VideoTimelineEditor
                  sourceUrl={video.url}
                  duration={video.metadata.duration || 10}
                  currentTime={playheadTime}
                  onSeek={(t) => {
                    setPlayheadTime(t);
                    setSeekTarget(t);
                  }}
                />
              )}

              {/* Collapsible FFmpeg CLI Command Drawer */}
              {showCliDrawer && (
                <div className="bg-[#0d1117] border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                      FFmpeg Pipeline Command
                    </span>
                    <button
                      type="button"
                      onClick={copyCommand}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
                    >
                      {copiedCli ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-2.5 rounded-lg bg-slate-950 text-[11px] font-mono text-indigo-300 overflow-x-auto whitespace-pre-wrap break-all">
                    {cliCommand}
                  </pre>
                </div>
              )}
            </>
          )}

          {uploadError && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}
        </div>

        {/* Right 4 Columns: Unified Tabbed Inspector Panel */}
        <aside className="lg:col-span-4 bg-[#0d1117] border border-slate-800/90 rounded-2xl overflow-hidden shadow-2xl flex flex-col lg:sticky lg:top-18">
          {/* 5-Tab Segmented Navigation */}
          <div className="grid grid-cols-5 p-1.5 bg-slate-950/90 border-b border-slate-800/80 gap-1">
            {(
              [
                { id: 'geometry', label: 'Scale', icon: Maximize2 },
                { id: 'enhance', label: 'Enhance', icon: SunMedium },
                {
                  id: 'cleanup',
                  label: 'VR / Clean',
                  icon: Compass,
                  alert: Boolean(
                    video?.metadata.vr360?.isVr360 || config.watermarkEnabled
                  ),
                },
                {
                  id: 'merge',
                  label: 'Merge',
                  icon: Layers,
                  alert: clipQueue.length >= 2,
                },
                { id: 'export', label: 'Codec', icon: Cpu },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative py-2 px-2 rounded-xl text-xs font-semibold flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
                    active
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {'alert' in tab && tab.alert && !active && (
                    <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab Body */}
          <div className="p-4 space-y-4 max-h-[calc(100vh-210px)] overflow-y-auto">
            {/* TAB 1: SCALE, ASPECT & ROTATION */}
            {activeTab === 'geometry' && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300">
                      Resolution Preset
                    </span>
                    <span className="text-xs font-mono text-indigo-400">
                      {effectiveOutW} × {effectiveOutH}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {RESOLUTION_PRESETS.map((p) => {
                      const active = config.presetId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleSelectPreset(p)}
                          className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                            active
                              ? 'bg-indigo-600/20 border-indigo-500 text-white'
                              : 'bg-slate-950/70 border-slate-800/90 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="text-xs font-bold">{p.badge}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {p.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Width ↔ Height Inputs */}
                <div className="grid grid-cols-11 gap-2 items-end">
                  <div className="col-span-5">
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Width (px)
                    </label>
                    <input
                      type="number"
                      min={64}
                      max={15360}
                      step={2}
                      value={config.width}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          presetId: 'custom',
                          width: Number(e.target.value) || 1920,
                        }))
                      }
                      className="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white"
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button
                      type="button"
                      title="Swap Width & Height"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          width: prev.height,
                          height: prev.width,
                        }))
                      }
                      className="p-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-indigo-400 text-xs font-bold cursor-pointer"
                    >
                      ⇄
                    </button>
                  </div>
                  <div className="col-span-5">
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Height (px)
                    </label>
                    <input
                      type="number"
                      min={64}
                      max={15360}
                      step={2}
                      value={config.height}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          presetId: 'custom',
                          height: Number(e.target.value) || 1080,
                        }))
                      }
                      className="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white"
                    />
                  </div>
                </div>

                {/* Aspect Ratio Mode */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Framing & Aspect Ratio
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'fit', label: 'Fit Inside', desc: 'Keep aspect ratio' },
                      { id: 'pad', label: 'Letterbox Pad', desc: 'Add black bars' },
                      { id: 'crop', label: 'Center Crop', desc: 'Fill & crop edges' },
                      { id: 'stretch', label: 'Stretch Exact', desc: 'Force W×H' },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            aspectMode: mode.id as UpscaleConfig['aspectMode'],
                          }))
                        }
                        className={`p-2 rounded-xl border text-left transition cursor-pointer ${
                          config.aspectMode === mode.id
                            ? 'bg-indigo-600/20 border-indigo-500 text-white'
                            : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="text-xs font-semibold">{mode.label}</div>
                        <div className="text-[10px] text-slate-400">{mode.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rotation & Flip Strip */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Orientation & Mirror
                  </label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {([0, 90, 180, 270] as const).map((deg) => (
                      <button
                        key={deg}
                        type="button"
                        onClick={() => handleSetRotation(deg)}
                        className={`py-2 rounded-xl border text-xs font-mono font-semibold flex items-center justify-center transition cursor-pointer ${
                          config.rotation === deg
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                        title={`Rotate ${deg}°`}
                      >
                        {deg}°
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          flipHorizontal: !prev.flipHorizontal,
                        }))
                      }
                      className={`py-2 rounded-xl border flex items-center justify-center transition cursor-pointer ${
                        config.flipHorizontal
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300'
                      }`}
                      title="Flip Horizontal (Mirror)"
                    >
                      <FlipHorizontal className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          flipVertical: !prev.flipVertical,
                        }))
                      }
                      className={`py-2 rounded-xl border flex items-center justify-center transition cursor-pointer ${
                        config.flipVertical
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300'
                      }`}
                      title="Flip Vertical"
                    >
                      <FlipVertical className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: VIDEO ENHANCING, CLARITY & COLOR GRADING */}
            {activeTab === 'enhance' && (
              <div className="space-y-4">
                {/* 1-Click Enhancement Profiles */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-300">
                      1-Click Enhancement Profile
                    </span>
                    {config.enhancePreset !== 'none' && (
                      <button
                        type="button"
                        onClick={() => applyEnhancePreset('none')}
                        className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                      >
                        Reset All
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'none', label: 'Neutral' },
                        { id: 'cinema', label: 'Cinema Crisp' },
                        { id: 'vivid', label: 'Vivid HDR' },
                        { id: 'restore', label: 'AI-Style Restore' },
                        { id: 'lowlight', label: 'Night Boost' },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyEnhancePreset(p.id)}
                        className={`py-2 px-2.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                          config.enhancePreset === p.id
                            ? 'bg-indigo-600/25 border-indigo-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Upscale Kernel & Denoise */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Upscale Kernel
                    </label>
                    <select
                      value={config.scaleAlgorithm}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          scaleAlgorithm: e.target.value as UpscaleConfig['scaleAlgorithm'],
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      <option value="lanczos">Lanczos (Sharpest)</option>
                      <option value="spline">Spline (Natural)</option>
                      <option value="bicubic">Bicubic</option>
                      <option value="bilinear">Bilinear</option>
                      <option value="neighbor">Nearest (Pixel Art)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Noise Reduction
                    </label>
                    <select
                      value={config.denoise}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          enhancePreset: 'custom',
                          denoise: e.target.value as UpscaleConfig['denoise'],
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      <option value="none">Off</option>
                      <option value="light">Light (hqdn3d)</option>
                      <option value="medium">Medium (hqdn3d)</option>
                      <option value="nlmeans">Deep Studio (nlmeans)</option>
                    </select>
                  </div>
                </div>

                {/* Detail & Contrast Adaptive Sharpening (CAS + Unsharp) */}
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300">
                        Contrast Adaptive Sharpen (`cas`)
                      </span>
                      <span className="font-mono text-indigo-400">
                        {Math.round(config.casStrength * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={config.casStrength}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          enhancePreset: 'custom',
                          casStrength: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-indigo-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300">Unsharp Edge Micro-Detail</span>
                      <span className="font-mono text-indigo-400 capitalize">
                        {config.sharpenPreset}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {(['none', 'light', 'medium', 'strong'] as const).map((sp) => (
                        <button
                          key={sp}
                          type="button"
                          onClick={() =>
                            setConfig((prev) => ({
                              ...prev,
                              enhancePreset: 'custom',
                              sharpenPreset: sp,
                            }))
                          }
                          className={`py-1 rounded-lg text-[11px] font-medium capitalize border cursor-pointer ${
                            config.sharpenPreset === sp
                              ? 'bg-indigo-600 border-indigo-500 text-white'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          {sp}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.debandEnabled}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            enhancePreset: 'custom',
                            debandEnabled: e.target.checked,
                          }))
                        }
                        className="accent-indigo-500 rounded"
                      />
                      <span>Deband Sky/Gradients</span>
                    </label>

                    <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.deinterlaceEnabled}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            deinterlaceEnabled: e.target.checked,
                          }))
                        }
                        className="accent-indigo-500 rounded"
                      />
                      <span>Deinterlace (`bwdif`)</span>
                    </label>
                  </div>
                </div>

                {/* Color & Tone Grading Sliders */}
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Color & Tone Grading (`eq` + `vibrance`)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          brightness: 0,
                          contrast: 1,
                          saturation: 1,
                          gamma: 1,
                          vibrance: 0,
                        }))
                      }
                      className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                    >
                      Reset Color
                    </button>
                  </div>

                  {[
                    {
                      label: 'Brightness',
                      key: 'brightness' as const,
                      min: -0.35,
                      max: 0.35,
                      step: 0.02,
                      fmt: (v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
                    },
                    {
                      label: 'Contrast',
                      key: 'contrast' as const,
                      min: 0.6,
                      max: 1.6,
                      step: 0.02,
                      fmt: (v: number) => `${v.toFixed(2)}×`,
                    },
                    {
                      label: 'Saturation',
                      key: 'saturation' as const,
                      min: 0,
                      max: 2.0,
                      step: 0.05,
                      fmt: (v: number) => `${v.toFixed(2)}×`,
                    },
                    {
                      label: 'Vibrance',
                      key: 'vibrance' as const,
                      min: -0.8,
                      max: 1.2,
                      step: 0.05,
                      fmt: (v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
                    },
                    {
                      label: 'Gamma (Shadows)',
                      key: 'gamma' as const,
                      min: 0.6,
                      max: 1.8,
                      step: 0.02,
                      fmt: (v: number) => v.toFixed(2),
                    },
                  ].map((slider) => (
                    <div key={slider.key}>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-slate-400">{slider.label}</span>
                        <span className="font-mono text-indigo-300">
                          {slider.fmt(config[slider.key])}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={slider.min}
                        max={slider.max}
                        step={slider.step}
                        value={config[slider.key]}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            enhancePreset: 'custom',
                            [slider.key]: parseFloat(e.target.value),
                          }))
                        }
                        className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 3: VR / 360° NORMALIZATION & WATERMARK CLEANUP */}
            {activeTab === 'cleanup' && (
              <div className="space-y-4">
                {/* VR / 360 Section */}
                <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Compass className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-semibold text-white">
                        VR / 360° Flat Normalization
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.vrNormalizeEnabled}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          vrNormalizeEnabled: e.target.checked,
                        }))
                      }
                      className="accent-cyan-500 w-4 h-4 rounded cursor-pointer"
                    />
                  </div>

                  {video?.metadata.vr360?.isVr360 && (
                    <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-[11px] text-cyan-200">
                      Detected: {video.metadata.vr360.reason}
                    </div>
                  )}

                  {config.vrNormalizeEnabled && (
                    <div className="space-y-2.5 pt-1">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Input Projection
                          </label>
                          <select
                            value={config.vrInputProjection}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                vrInputProjection: e.target
                                  .value as UpscaleConfig['vrInputProjection'],
                              }))
                            }
                            className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                          >
                            <option value="e">360° Equirectangular</option>
                            <option value="hequirect">VR180 Half-Equirect</option>
                            <option value="dfisheye">Dual Fisheye</option>
                            <option value="fisheye">Single Fisheye</option>
                            <option value="cubemap">Cubemap</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Stereo 3D Eye
                          </label>
                          <select
                            value={config.vrStereoMode}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                vrStereoMode: e.target
                                  .value as UpscaleConfig['vrStereoMode'],
                              }))
                            }
                            className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                          >
                            <option value="mono">Mono (2D)</option>
                            <option value="sbs">Side-by-Side (Left Eye)</option>
                            <option value="tb">Top-Bottom (Top Eye)</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <div className="flex justify-between text-[11px]">
                            <span className="text-slate-400">FOV Zoom</span>
                            <span className="font-mono text-cyan-300">{config.vrFov}°</span>
                          </div>
                          <input
                            type="range"
                            min={50}
                            max={135}
                            value={config.vrFov}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                vrFov: Number(e.target.value),
                              }))
                            }
                            className="w-full accent-cyan-500"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-[11px]">
                            <span className="text-slate-400">Yaw (Pan)</span>
                            <span className="font-mono text-cyan-300">{config.vrYaw}°</span>
                          </div>
                          <input
                            type="range"
                            min={-180}
                            max={180}
                            value={config.vrYaw}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                vrYaw: Number(e.target.value),
                              }))
                            }
                            className="w-full accent-cyan-500"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-[11px]">
                            <span className="text-slate-400">Pitch (Tilt)</span>
                            <span className="font-mono text-cyan-300">{config.vrPitch}°</span>
                          </div>
                          <input
                            type="range"
                            min={-90}
                            max={90}
                            value={config.vrPitch}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                vrPitch: Number(e.target.value),
                              }))
                            }
                            className="w-full accent-cyan-500"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-[11px]">
                            <span className="text-slate-400">Roll (Level)</span>
                            <span className="font-mono text-cyan-300">{config.vrRoll}°</span>
                          </div>
                          <input
                            type="range"
                            min={-180}
                            max={180}
                            value={config.vrRoll}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                vrRoll: Number(e.target.value),
                              }))
                            }
                            className="w-full accent-cyan-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Watermark Detection & Delogo Removal Section */}
                <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Eraser className="w-4 h-4 text-rose-400" />
                      <span className="text-xs font-semibold text-white">
                        Watermark Removal (`delogo`)
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.watermarkEnabled}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          watermarkEnabled: e.target.checked,
                          watermarkBoxes:
                            e.target.checked && prev.watermarkBoxes.length === 0
                              ? [
                                  {
                                    id: `wm_${Date.now()}`,
                                    label: 'Bottom-Right',
                                    xPct: 0.76,
                                    yPct: 0.82,
                                    wPct: 0.21,
                                    hPct: 0.13,
                                  },
                                ]
                              : prev.watermarkBoxes,
                        }))
                      }
                      className="accent-rose-500 w-4 h-4 rounded cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!video || isDetectingWatermark}
                      onClick={handleAutoDetectWatermarks}
                      className="flex-1 py-2 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-40 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      {isDetectingWatermark ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Scanning...
                        </>
                      ) : (
                        <>
                          <ScanSearch className="w-3.5 h-3.5 text-rose-400" />
                          Auto-Detect Logo
                        </>
                      )}
                    </button>

                    {config.watermarkBoxes.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            watermarkBoxes: [],
                            watermarkEnabled: false,
                          }))
                        }
                        className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-rose-300 cursor-pointer"
                        title="Clear all watermark boxes"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {config.watermarkEnabled && (
                    <div className="space-y-2 text-[11px] text-slate-400">
                      <p>
                        Tip: Drag directly on the video monitor to draw custom removal boxes.
                      </p>
                      <div className="flex items-center justify-between pt-1">
                        <span>Inpaint Mode</span>
                        <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                          <button
                            type="button"
                            onClick={() =>
                              setConfig((prev) => ({ ...prev, watermarkMode: 'delogo' }))
                            }
                            className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                              config.watermarkMode === 'delogo'
                                ? 'bg-rose-600 text-white'
                                : 'text-slate-400'
                            }`}
                          >
                            Standard
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfig((prev) => ({ ...prev, watermarkMode: 'blur' }))
                            }
                            className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                              config.watermarkMode === 'blur'
                                ? 'bg-rose-600 text-white'
                                : 'text-slate-400'
                            }`}
                          >
                            Deep Multi-Pass
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: MULTI-FILE MERGE & TRANSITIONS */}
            {activeTab === 'merge' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-white">
                      Multi-File Merge & Transitions
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Combine multiple clips with FFmpeg `xfade` & `acrossfade`
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addClipsInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Files
                  </button>
                </div>

                {/* Transition Style & Duration Controls */}
                <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3.5 space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Transition Effect (`xfade`)
                    </label>
                    <select
                      value={transitionType}
                      onChange={(e) =>
                        setTransitionType(e.target.value as TransitionType)
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white"
                    >
                      <option value="fade">Crossfade (Smooth Blend)</option>
                      <option value="fadeblack">Dip to Black</option>
                      <option value="fadewhite">Dip to White</option>
                      <option value="dissolve">Film Dissolve</option>
                      <option value="wipeleft">Wipe Left</option>
                      <option value="wiperight">Wipe Right</option>
                      <option value="slideleft">Slide Left</option>
                      <option value="slideright">Slide Right</option>
                      <option value="smoothleft">Smooth Push Left</option>
                      <option value="smoothright">Smooth Push Right</option>
                      <option value="circleopen">Circle Iris Open</option>
                      <option value="circleclose">Circle Iris Close</option>
                      <option value="radial">Radial Clock Wipe</option>
                      <option value="pixelize">Pixelize Morph</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300">Transition Overlap Duration</span>
                      <span className="font-mono text-indigo-400">
                        {transitionDuration.toFixed(1)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={3.5}
                      step={0.1}
                      value={transitionDuration}
                      onChange={(e) =>
                        setTransitionDuration(parseFloat(e.target.value) || 1.0)
                      }
                      className="w-full accent-indigo-500"
                    />
                  </div>
                </div>

                {/* Selected Clips Queue List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Selected Clips ({clipQueue.length})</span>
                    <span>
                      Total:{' '}
                      {clipQueue
                        .reduce((acc, c) => acc + (c.metadata.duration || 0), 0)
                        .toFixed(1)}
                      s
                    </span>
                  </div>

                  {clipQueue.length === 0 ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="p-6 rounded-xl border border-dashed border-slate-800 hover:border-indigo-500/50 text-center cursor-pointer"
                    >
                      <p className="text-xs text-slate-400">
                        Click to select 2 or more video files to merge
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                      {clipQueue.map((item, idx) => (
                        <div
                          key={item.fileId}
                          onClick={() => {
                            setVideo(item);
                            setPlayheadTime(0);
                          }}
                          className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                            item.fileId === video?.fileId
                              ? 'bg-indigo-600/15 border-indigo-500 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-indigo-300 shrink-0">
                              #{idx + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{item.originalName}</p>
                              <p className="text-[10px] font-mono text-slate-400">
                                {item.metadata.width}×{item.metadata.height} •{' '}
                                {(item.metadata.duration || 0).toFixed(1)}s
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {idx > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveClipInQueue(idx, -1);
                                }}
                                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                                title="Move Up"
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                            )}
                            {idx < clipQueue.length - 1 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveClipInQueue(idx, 1);
                                }}
                                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                                title="Move Down"
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            )}
                            {clipQueue.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeClipFromQueue(item.fileId);
                                }}
                                className="p-1 rounded bg-slate-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 cursor-pointer"
                                title="Remove Clip"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {clipQueue.length === 1 && (
                    <p className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                      Add at least 1 more video clip using <strong>+ Add Files</strong> above to enable transition merging.
                    </p>
                  )}

                  {clipQueue.length >= 2 && (
                    <button
                      type="button"
                      disabled={job?.status === 'processing'}
                      onClick={handleMergeWithTransitions}
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 text-white font-semibold text-xs shadow-lg shadow-violet-600/25 flex items-center justify-center gap-2 transition cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
                      Merge {clipQueue.length} Clips with {transitionType} ({transitionDuration}s)
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* TAB 5: CODEC, BITRATE & CONTAINER */}
            {activeTab === 'export' && (
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Video Encoder
                  </label>
                  <select
                    value={config.codec}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        codec: e.target.value as UpscaleConfig['codec'],
                        container:
                          e.target.value === 'libvpx-vp9'
                            ? 'webm'
                            : prev.container === 'webm'
                            ? 'mp4'
                            : prev.container,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  >
                    <option value="libx264">H.264 / AVC (libx264 Universal MP4)</option>
                    <option value="libx265">H.265 / HEVC (libx265 4K / 8K)</option>
                    {systemInfo?.capabilities?.hasVideoToolbox && (
                      <>
                        <option value="h264_videotoolbox">
                          H.264 Apple VideoToolbox (GPU)
                        </option>
                        <option value="hevc_videotoolbox">
                          HEVC Apple VideoToolbox (GPU)
                        </option>
                      </>
                    )}
                    <option value="libsvtav1">AV1 (SVT-AV1 Next-Gen)</option>
                    <option value="libvpx-vp9">VP9 (WebM 4K)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Container</label>
                    <select
                      value={config.container}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          container: e.target.value as UpscaleConfig['container'],
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      <option value="mp4">MP4 (.mp4)</option>
                      <option value="mov">QuickTime (.mov)</option>
                      <option value="mkv">Matroska (.mkv)</option>
                      <option value="webm">WebM (.webm)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Frame Rate</label>
                    <select
                      value={config.fps}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          fps: e.target.value as UpscaleConfig['fps'],
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      <option value="source">Source FPS</option>
                      <option value="24">24 fps</option>
                      <option value="30">30 fps</option>
                      <option value="60">60 fps</option>
                      <option value="120">120 fps</option>
                    </select>
                  </div>
                </div>

                {/* Quality Control */}
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Rate Control</span>
                    <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setConfig((prev) => ({ ...prev, rateControl: 'crf' }))}
                        className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                          config.rateControl === 'crf'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400'
                        }`}
                      >
                        CRF Quality
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfig((prev) => ({ ...prev, rateControl: 'bitrate' }))
                        }
                        className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                          config.rateControl === 'bitrate'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400'
                        }`}
                      >
                        Bitrate (Mbps)
                      </button>
                    </div>
                  </div>

                  {config.rateControl === 'crf' ? (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300">CRF {config.crf}</span>
                        <span className="text-indigo-400 text-[11px]">
                          {config.crf <= 16
                            ? 'Lossless Master'
                            : config.crf <= 20
                            ? 'High Quality'
                            : 'Balanced'}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={34}
                        value={config.crf}
                        onChange={(e) =>
                          setConfig((prev) => ({ ...prev, crf: Number(e.target.value) }))
                        }
                        className="w-full accent-indigo-500"
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300">Target Bitrate</span>
                        <span className="text-indigo-400 font-mono">
                          {config.targetBitrateMbps} Mbps
                        </span>
                      </div>
                      <input
                        type="range"
                        min={2}
                        max={120}
                        value={config.targetBitrateMbps}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            targetBitrateMbps: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-indigo-500"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Color Depth</label>
                    <select
                      value={config.pixelFormat}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          pixelFormat: e.target.value as UpscaleConfig['pixelFormat'],
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      <option value="yuv420p">8-bit YUV420p</option>
                      <option value="yuv420p10le">10-bit HDR</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Audio</label>
                    <select
                      value={config.audioMode}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          audioMode: e.target.value as UpscaleConfig['audioMode'],
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      <option value="copy">Copy Original</option>
                      <option value="aac_192">AAC 192k</option>
                      <option value="aac_320">AAC 320k</option>
                      <option value="mute">Mute (-an)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Persistent Bottom Render CTA Footer */}
          <div className="p-4 border-t border-slate-800/80 bg-slate-950/90">
            <button
              type="button"
              disabled={!video || job?.status === 'processing'}
              onClick={
                activeTab === 'merge' && clipQueue.length >= 2
                  ? handleMergeWithTransitions
                  : handleStartUpscale
              }
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition cursor-pointer"
            >
              {job?.status === 'processing' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Rendering {effectiveOutW}×{effectiveOutH} ({job.progress}%)...
                </>
              ) : activeTab === 'merge' && clipQueue.length >= 2 ? (
                <>
                  <Layers className="w-4 h-4" />
                  Merge {clipQueue.length} Clips ({transitionType} • {effectiveOutW}×{effectiveOutH})
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Render {effectiveOutW}×{effectiveOutH} ({config.container.toUpperCase()})
                </>
              )}
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}
