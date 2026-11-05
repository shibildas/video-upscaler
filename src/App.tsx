import React, { useEffect, useState, useRef } from 'react';
import {
  Upload,
  Sparkles,
  Sliders,
  Cpu,
  Film,
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
} from 'lucide-react';
import { ResolutionPreset, UploadedVideo, UpscaleConfig, JobState, WatermarkBox } from './types';
import { VideoComparePlayer } from './components/VideoComparePlayer';
import { getBrowserFingerprint } from './utils/fingerprint';

const RESOLUTION_PRESETS: ResolutionPreset[] = [
  {
    id: '720p',
    label: '720p HD',
    badge: 'HD',
    width: 1280,
    height: 720,
    desc: 'Standard High Definition (1280×720)',
    recommendedBitrateMbps: 6,
  },
  {
    id: '1080p',
    label: '1080p Full HD',
    badge: 'FHD',
    width: 1920,
    height: 1080,
    desc: 'Crisp Full HD 16:9 (1920×1080)',
    recommendedBitrateMbps: 12,
  },
  {
    id: '2k',
    label: '2K QHD (1440p)',
    badge: '2K',
    width: 2560,
    height: 1440,
    desc: 'Quad HD Studio Master (2560×1440)',
    recommendedBitrateMbps: 24,
  },
  {
    id: '4k',
    label: '4K Ultra HD',
    badge: '4K UHD',
    width: 3840,
    height: 2160,
    desc: 'Cinema 4K UHD (3840×2160)',
    recommendedBitrateMbps: 45,
  },
  {
    id: '7200w',
    label: '7200px Ultra-Wide / 8K Class',
    badge: '7200px',
    width: 7200,
    height: 4050,
    desc: 'Extreme 7200×4050 Super-Resolution Frame',
    recommendedBitrateMbps: 85,
  },
  {
    id: 'custom',
    label: 'Custom Dimensions',
    badge: 'W×H',
    width: 1920,
    height: 1080,
    desc: 'Specify exact frame width & height',
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

export default function App() {
  const [systemInfo, setSystemInfo] = useState<{
    available: boolean;
    version?: string;
    capabilities?: Record<string, boolean>;
  } | null>(null);
  const [fingerprint, setFingerprint] = useState<string>('');

  const [video, setVideo] = useState<UploadedVideo | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDetectingWatermark, setIsDetectingWatermark] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
    aspectMode: 'fit',
    scaleAlgorithm: 'lanczos',
    sharpenPreset: 'medium',
    sharpenAmount: 1.0,
    denoise: 'none',
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

  // Fetch FFmpeg capabilities & initialize Browser Fingerprint on mount
  useEffect(() => {
    getBrowserFingerprint().then((fp) => setFingerprint(fp));
    fetch('/api/system-info')
      .then((r) => r.json())
      .then((data) => setSystemInfo(data))
      .catch(() => setSystemInfo({ available: false }));
  }, []);

  // Update live FFmpeg CLI preview whenever config or video changes
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
        // ignore transient poll error
      }
    }, 500);

    return () => clearInterval(timer);
  }, [job?.jobId, job?.status]);

  const handleSelectPreset = (preset: ResolutionPreset) => {
    setConfig((prev) => {
      // Determine whether the post-rotation video is portrait
      const srcW = video?.metadata.width || 1920;
      const srcH = video?.metadata.height || 1080;
      const isRotatedSideways = prev.rotation === 90 || prev.rotation === 270;
      const effectiveSrcW = isRotatedSideways ? srcH : srcW;
      const effectiveSrcH = isRotatedSideways ? srcW : srcH;
      const isPortrait = effectiveSrcH > effectiveSrcW;

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
        // Automatically switch to VideoToolbox or libx265 if user picks 7200px because H.264 max width is 4096px
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

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    const prevFileId = video?.fileId;
    const prevJobId = job?.jobId;
    setJob(null);

    try {
      const fp = fingerprint || (await getBrowserFingerprint());
      const formData = new FormData();
      if (prevFileId) formData.append('previousFileId', prevFileId);
      if (prevJobId) formData.append('previousJobId', prevJobId);
      formData.append('fingerprint', fp);
      formData.append('video', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'x-browser-fingerprint': fp,
        },
        body: formData,
      });
      const data: UploadedVideo = await res.json();
      if (!res.ok) throw new Error((data as any).error || 'Upload failed');
      setVideo(data);
      // Reset input value so selecting the same filename again still triggers onChange
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Auto-orient target preset dimensions to match uploaded video's orientation (portrait vs landscape)
      if (data.metadata.width && data.metadata.height) {
        const isSourcePortrait = data.metadata.height > data.metadata.width;
        setConfig((prev) => {
          const isTargetPortrait = prev.height > prev.width;
          if (isSourcePortrait !== isTargetPortrait) {
            return {
              ...prev,
              rotation: 0,
              watermarkBoxes: [],
              width: prev.height,
              height: prev.width,
            };
          }
          return { ...prev, rotation: 0, watermarkBoxes: [] };
        });
      }
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload video');
    } finally {
      setIsUploading(false);
    }
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

  const handleAddCornerWatermarkPreset = (
    corner: 'bottom-right' | 'top-right' | 'bottom-left' | 'top-left'
  ) => {
    const presets: Record<
      typeof corner,
      { label: string; xPct: number; yPct: number; wPct: number; hPct: number }
    > = {
      'bottom-right': { label: 'Bottom-Right', xPct: 0.76, yPct: 0.82, wPct: 0.21, hPct: 0.13 },
      'top-right': { label: 'Top-Right', xPct: 0.76, yPct: 0.05, wPct: 0.21, hPct: 0.13 },
      'bottom-left': { label: 'Bottom-Left', xPct: 0.03, yPct: 0.82, wPct: 0.21, hPct: 0.13 },
      'top-left': { label: 'Top-Left', xPct: 0.03, yPct: 0.05, wPct: 0.21, hPct: 0.13 },
    };
    const p = presets[corner];
    setConfig((prev) => ({
      ...prev,
      watermarkEnabled: true,
      watermarkBoxes: [
        ...prev.watermarkBoxes,
        {
          id: `wm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: p.label,
          xPct: p.xPct,
          yPct: p.yPct,
          wPct: p.wPct,
          hPct: p.hPct,
        },
      ],
    }));
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
  if (video && config.aspectMode === 'fit' && rotatedSourceW > 0 && rotatedSourceH > 0) {
    const ratio = Math.min(targetBoxW / rotatedSourceW, targetBoxH / rotatedSourceH);
    effectiveOutW = toEven(rotatedSourceW * ratio);
    effectiveOutH = toEven(rotatedSourceH * ratio);
  }

  const outputAspectRatio = formatAspectRatio(effectiveOutW, effectiveOutH);
  const scaleFactor =
    video && rotatedSourceH > 0 ? (effectiveOutH / rotatedSourceH).toFixed(2) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  FrameScale Studio
                </h1>
                <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  FFmpeg Engine
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Upscale & transcode video frames to 720p, 1080p, 2K, 4K & 7200px with MP4 / HEVC / Apple VideoToolbox codecs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {fingerprint && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/80 text-slate-300 text-xs font-mono"
                title={`Browser Session Fingerprint: ${fingerprint} (isolates your uploads & output files)`}
              >
                <Fingerprint className="w-3.5 h-3.5 text-indigo-400" />
                <span>ID: {fingerprint.slice(0, 8)}</span>
              </div>
            )}
            {systemInfo?.available ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono truncate max-w-[260px]" title={systemInfo.version}>
                  {systemInfo.version?.split('Copyright')[0] || 'FFmpeg Ready'}
                </span>
                {systemInfo.capabilities?.hasVideoToolbox && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-[10px] font-semibold">
                    Apple GPU
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                <AlertCircle className="w-4 h-4" />
                <span>Checking FFmpeg backend...</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* Left Column: Video Upload, Preview, Metadata, Progress */}
        <div className="lg:col-span-7 space-y-6">
          {/* Upload Dropzone or Active Video Card */}
          {!video ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleFileUpload(f);
              }}
              className="border-2 border-dashed border-slate-800 hover:border-indigo-500/60 bg-slate-900/40 rounded-2xl p-10 text-center transition flex flex-col items-center justify-center min-h-[340px]"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                }}
              />
              <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mb-4 text-indigo-400">
                {isUploading ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : (
                  <Upload className="w-8 h-8" />
                )}
              </div>
              <h2 className="text-lg font-semibold text-white mb-1">
                Drop a video file here, or browse
              </h2>
              <p className="text-sm text-slate-400 max-w-md mb-6">
                Supports MP4, MOV, MKV, WebM, AVI. Inspect frame resolution and upscale up to 4K UHD or 7200px with Lanczos & Unsharp filters.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm shadow-lg shadow-indigo-600/25 transition cursor-pointer"
                >
                  {isUploading ? 'Loading Video...' : 'Select Video File'}
                </button>

                <button
                  type="button"
                  disabled={isUploading}
                  onClick={handleGenerateSample}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-medium text-sm border border-slate-700 transition cursor-pointer"
                >
                  <Wand2 className="w-4 h-4 text-indigo-400" />
                  Load 360p Demo Test Video
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File Header Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 px-4 py-3 rounded-xl">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-indigo-500/15 text-indigo-400">
                    <FileVideo className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {video.originalName}
                    </p>
                    <p className="text-xs text-slate-400">
                      {video.metadata.width}×{video.metadata.height} • {video.metadata.fps} fps •{' '}
                      {video.metadata.codec.toUpperCase()} • {formatBytes(video.metadata.sizeBytes)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition cursor-pointer"
                  >
                    Change Video
                  </button>
                </div>
              </div>

              {/* Interactive Before/After Video Player */}
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
              />

              {/* Source & Output Stream Comparison Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-900/70 border border-slate-800/90 rounded-xl p-3">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 block">
                    {isSidewaysRotation ? 'Rotated Input' : 'Source Frame'}
                  </span>
                  <span className="text-sm font-bold text-white font-mono">
                    {rotatedSourceW} × {rotatedSourceH}
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    AR {formatAspectRatio(rotatedSourceW, rotatedSourceH)}
                    {video.metadata.sourceRotation
                      ? ` (Meta ${video.metadata.sourceRotation}°)`
                      : ''}
                  </span>
                </div>

                <div className="bg-slate-900/70 border border-indigo-500/30 rounded-xl p-3">
                  <span className="text-[11px] uppercase tracking-wider text-indigo-300 block">
                    Final Output
                  </span>
                  <span className="text-sm font-bold text-indigo-300 font-mono">
                    {effectiveOutW} × {effectiveOutH}
                  </span>
                  <span className="text-[11px] text-indigo-400/90 block mt-0.5">
                    AR {outputAspectRatio} • {scaleFactor ? `${scaleFactor}×` : config.presetId.toUpperCase()}
                  </span>
                </div>

                <div className="bg-slate-900/70 border border-slate-800/90 rounded-xl p-3">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 block">
                    Codec / PixFmt
                  </span>
                  <span className="text-sm font-bold text-white font-mono">
                    {config.codec.replace('_videotoolbox', ' (HW)')}
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    {config.pixelFormat} • {config.container.toUpperCase()}
                  </span>
                </div>

                <div className="bg-slate-900/70 border border-slate-800/90 rounded-xl p-3">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 block">
                    Scaler & Filter
                  </span>
                  <span className="text-sm font-bold text-white capitalize">
                    {config.scaleAlgorithm}
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    Sharpen: {config.sharpenPreset}
                  </span>
                </div>
              </div>
            </div>
          )}

          {uploadError && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Error</p>
                <p className="text-xs opacity-90">{uploadError}</p>
              </div>
            </div>
          )}

          {/* Active / Completed Job Status Card */}
          {job && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  {job.status === 'processing' && (
                    <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                  )}
                  {job.status === 'completed' && (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  )}
                  {(job.status === 'failed' || job.status === 'cancelled') && (
                    <XCircle className="w-5 h-5 text-rose-400" />
                  )}
                  <h3 className="text-sm font-semibold text-white">
                    {job.status === 'processing' && 'Upscaling & Encoding in Progress...'}
                    {job.status === 'completed' && 'Upscaling Complete!'}
                    {job.status === 'failed' && 'Encoding Failed'}
                    {job.status === 'cancelled' && 'Job Cancelled'}
                  </h3>
                </div>

                <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                  {job.fps > 0 && <span>{job.fps.toFixed(1)} fps</span>}
                  {job.speed && job.speed !== '0x' && <span>Speed: {job.speed}</span>}
                  {job.bitrate && <span>{job.bitrate}</span>}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    job.status === 'completed'
                      ? 'bg-emerald-500'
                      : job.status === 'failed'
                      ? 'bg-rose-500'
                      : 'bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-400'
                  }`}
                  style={{ width: `${job.progress}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  {job.progress}% • {job.currentTimeSec.toFixed(1)}s /{' '}
                  {job.totalDurationSec.toFixed(1)}s
                </span>

                {job.status === 'processing' && (
                  <button
                    type="button"
                    onClick={handleCancelJob}
                    className="text-rose-400 hover:text-rose-300 font-medium cursor-pointer"
                  >
                    Cancel Process
                  </button>
                )}
              </div>

              {job.status === 'failed' && job.error && (
                <pre className="p-3 rounded-lg bg-slate-950 border border-rose-500/30 text-rose-300 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                  {job.error}
                </pre>
              )}

              {job.status === 'completed' && job.outputUrl && (
                <div className="pt-2 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800">
                  <div className="text-xs text-slate-300 space-y-0.5">
                    <p className="font-semibold text-emerald-300">
                      Output Verified: {job.outputMetadata?.width}×{job.outputMetadata?.height} (
                      {job.outputMetadata?.codec?.toUpperCase()})
                    </p>
                    <p className="text-slate-400">
                      File Size: {formatBytes(job.outputMetadata?.sizeBytes || 0)} • Duration:{' '}
                      {job.outputMetadata?.duration?.toFixed(2)}s
                    </p>
                  </div>

                  <a
                    href={job.outputUrl}
                    download={job.outputFilename}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/25 transition"
                  >
                    <Download className="w-4 h-4" />
                    Download {job.outputMetadata?.width}×{job.outputMetadata?.height} Video
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Live FFmpeg Command Inspector */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <Terminal className="w-4 h-4 text-indigo-400" />
                <span>Generated FFmpeg Command</span>
              </div>
              <button
                type="button"
                onClick={copyCommand}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition cursor-pointer"
              >
                {copiedCli ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy CLI
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800/90 text-xs font-mono text-indigo-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              {cliCommand}
            </pre>
          </div>
        </div>

        {/* Right Column: Resolution, Scaler, Codec & Audio Controls */}
        <div className="lg:col-span-5 space-y-5">
          {/* 1. Target Frame Resolution Card */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-semibold text-white">
                  1. Target Frame Resolution
                </h2>
              </div>
              <span className="text-xs font-mono text-indigo-400">
                {config.width} × {config.height}
              </span>
            </div>

            {/* Preset Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {RESOLUTION_PRESETS.map((p) => {
                const active = config.presetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPreset(p)}
                    className={`text-left p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                      active
                        ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950/70 border-slate-800/90 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-xs font-bold">{p.badge}</span>
                      {active && <span className="w-2 h-2 rounded-full bg-indigo-400" />}
                    </div>
                    <div className="text-[11px] font-medium text-slate-200 truncate">
                      {p.label}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                      {p.id === 'custom' ? 'Custom W×H' : `${p.width}×${p.height}`}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom Width / Height Inputs */}
            <div className="grid grid-cols-11 gap-2 items-end pt-1">
              <div className="col-span-5">
                <label className="block text-xs text-slate-400 mb-1">
                  Frame Width (px)
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
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="col-span-1 flex justify-center">
                <button
                  type="button"
                  title="Swap Width & Height (Landscape ↔ Portrait)"
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      width: prev.height,
                      height: prev.width,
                    }))
                  }
                  className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-indigo-400 text-xs font-bold transition cursor-pointer"
                >
                  ⇄
                </button>
              </div>

              <div className="col-span-5">
                <label className="block text-xs text-slate-400 mb-1">
                  Frame Height (px)
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
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Video Rotation & Flip Controls */}
            <div className="pt-1 border-t border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">
                  Video Rotation & Orientation
                </label>
                <span className="text-[11px] font-mono text-indigo-400">
                  {config.rotation}°
                  {config.flipHorizontal ? ' + FlipH' : ''}
                  {config.flipVertical ? ' + FlipV' : ''}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {([
                  { deg: 0, label: '0° Normal' },
                  { deg: 90, label: '90° CW' },
                  { deg: 180, label: '180° Upside' },
                  { deg: 270, label: '270° CCW' },
                ] as const).map((item) => (
                  <button
                    key={item.deg}
                    type="button"
                    onClick={() => handleSetRotation(item.deg)}
                    className={`py-2 px-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                      config.rotation === item.deg
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {item.deg === 270 ? (
                      <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                    ) : (
                      <RotateCw className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      flipHorizontal: !prev.flipHorizontal,
                    }))
                  }
                  className={`py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-2 transition cursor-pointer ${
                    config.flipHorizontal
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <FlipHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Flip Horizontal (Mirror)</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      flipVertical: !prev.flipVertical,
                    }))
                  }
                  className={`py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-2 transition cursor-pointer ${
                    config.flipVertical
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <FlipVertical className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Flip Vertical</span>
                </button>
              </div>
            </div>

            {/* Aspect Ratio Handling */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                Aspect Ratio & Framing Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'fit', label: 'Fit (Keep Aspect)', desc: 'Scale cleanly inside box' },
                  { id: 'pad', label: 'Letterbox Pad', desc: 'Exact W×H with black bars' },
                  { id: 'crop', label: 'Center Crop', desc: 'Fill W×H & crop edges' },
                  { id: 'stretch', label: 'Stretch Exact', desc: 'Force exact W×H' },
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
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      config.aspectMode === mode.id
                        ? 'bg-indigo-600/15 border-indigo-500 text-white'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold">{mode.label}</div>
                    <div className="text-[10px] text-slate-400">{mode.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Watermark Detection & Removal Card */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eraser className="w-4 h-4 text-rose-400" />
                <h2 className="text-sm font-semibold text-white">
                  Watermark Detection & Removal
                </h2>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer">
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
                <span className="text-xs font-medium text-slate-300">
                  Enable Delogo Filter
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!video || isDetectingWatermark}
                onClick={handleAutoDetectWatermarks}
                className="flex-1 py-2 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-40 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
              >
                {isDetectingWatermark ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Scanning Video Frames...
                  </>
                ) : (
                  <>
                    <ScanSearch className="w-4 h-4 text-rose-400" />
                    Auto-Detect Watermark
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
                  className="py-2 px-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-rose-300 text-xs flex items-center gap-1 transition cursor-pointer"
                  title="Clear all watermark zones"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear
                </button>
              )}
            </div>

            {config.watermarkEnabled && (
              <div className="space-y-3 pt-1">
                {/* Quick Corner Presets */}
                <div>
                  <span className="block text-[11px] text-slate-400 mb-1.5">
                    Add Quick Corner Zone (or drag directly on the video player):
                  </span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { id: 'top-left', label: '↖ Top-L' },
                        { id: 'top-right', label: '↗ Top-R' },
                        { id: 'bottom-left', label: '↙ Bot-L' },
                        { id: 'bottom-right', label: '↘ Bot-R' },
                      ] as const
                    ).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleAddCornerWatermarkPreset(c.id)}
                        className="py-1.5 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 font-medium transition cursor-pointer"
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Removal Mode */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Inpainting Strength</span>
                  <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({ ...prev, watermarkMode: 'delogo' }))
                      }
                      className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                        config.watermarkMode === 'delogo'
                          ? 'bg-rose-600 text-white'
                          : 'text-slate-400'
                      }`}
                    >
                      Standard Delogo
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({ ...prev, watermarkMode: 'blur' }))
                      }
                      className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                        config.watermarkMode === 'blur'
                          ? 'bg-rose-600 text-white'
                          : 'text-slate-400'
                      }`}
                    >
                      Deep Multi-Pass
                    </button>
                  </div>
                </div>

                {/* Active Watermark Zones List */}
                {config.watermarkBoxes.length > 0 && (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {config.watermarkBoxes.map((b, i) => {
                      const srcW = video?.metadata.width || 1920;
                      const srcH = video?.metadata.height || 1080;
                      const pxX = Math.round(b.xPct * srcW);
                      const pxY = Math.round(b.yPct * srcH);
                      const pxW = Math.round(b.wPct * srcW);
                      const pxH = Math.round(b.hPct * srcH);
                      return (
                        <div
                          key={b.id}
                          className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/90 border border-rose-500/30 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-rose-400 font-semibold">
                              #{i + 1} {b.label || 'Zone'}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400">
                              x:{pxX} y:{pxY} ({pxW}×{pxH}px)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setConfig((prev) => ({
                                ...prev,
                                watermarkBoxes: prev.watermarkBoxes.filter(
                                  (item) => item.id !== b.id
                                ),
                              }))
                            }
                            className="text-slate-500 hover:text-rose-400 transition cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 2. Upscaling Algorithm & Detail Enhancement */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-white">
                2. Upscaling Algorithm & Detail Enhancement
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  FFmpeg Swscale Kernel
                </label>
                <select
                  value={config.scaleAlgorithm}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      scaleAlgorithm: e.target.value as UpscaleConfig['scaleAlgorithm'],
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="lanczos">Lanczos (Recommended - Sharpest edges)</option>
                  <option value="spline">Bicubic Spline (Smooth natural upscale)</option>
                  <option value="bicubic">Bicubic (Balanced standard scaler)</option>
                  <option value="bilinear">Bilinear (Fast, softer gradients)</option>
                  <option value="neighbor">Nearest Neighbor (Pixel Art / Retro crisp)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Pre-Denoise Filter (hqdn3d)
                </label>
                <select
                  value={config.denoise}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      denoise: e.target.value as UpscaleConfig['denoise'],
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="none">Disabled (Preserve all grain)</option>
                  <option value="light">Light Spatial-Temporal Denoise</option>
                  <option value="medium">Medium Compression Artifact Cleanup</option>
                </select>
              </div>
            </div>

            {/* Unsharp Mask Sharpening */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-slate-400">
                  Unsharp Mask (Edge & Texture Sharpening)
                </label>
                <span className="text-xs font-mono text-indigo-400 capitalize">
                  {config.sharpenPreset}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {(['none', 'light', 'medium', 'strong', 'custom'] as const).map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, sharpenPreset: sp }))}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium capitalize border transition cursor-pointer ${
                      config.sharpenPreset === sp
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sp}
                  </button>
                ))}
              </div>

              {config.sharpenPreset === 'custom' && (
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="range"
                    min={0.1}
                    max={2.5}
                    step={0.1}
                    value={config.sharpenAmount}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        sharpenAmount: parseFloat(e.target.value),
                      }))
                    }
                    className="flex-1 accent-indigo-500"
                  />
                  <span className="text-xs font-mono text-slate-300 w-12 text-right">
                    {config.sharpenAmount.toFixed(1)}×
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* 3. Video Codec, MP4 Container & Hardware Acceleration */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-white">
                3. MP4 / Video Codec & Quality Controls
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Video Encoder / Codec
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
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="libx264">H.264 / AVC (libx264 - Universal MP4)</option>
                  <option value="libx265">H.265 / HEVC (libx265 - Best for 4K / 7200px)</option>
                  {systemInfo?.capabilities?.hasVideoToolbox && (
                    <>
                      <option value="h264_videotoolbox">
                        H.264 Apple VideoToolbox (GPU Hardware)
                      </option>
                      <option value="hevc_videotoolbox">
                        HEVC Apple VideoToolbox (GPU 4K/8K Fast)
                      </option>
                    </>
                  )}
                  <option value="libsvtav1">AV1 (SVT-AV1 Next-Gen Compression)</option>
                  <option value="libvpx-vp9">VP9 (WebM 4K YouTube Codec)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Container Format
                </label>
                <select
                  value={config.container}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      container: e.target.value as UpscaleConfig['container'],
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="mp4">MP4 (.mp4 - Faststart Web Ready)</option>
                  <option value="mov">QuickTime (.mov)</option>
                  <option value="mkv">Matroska (.mkv)</option>
                  <option value="webm">WebM (.webm)</option>
                </select>
              </div>
            </div>

            {config.width > 4096 &&
              (config.codec === 'libx264' || config.codec === 'h264_videotoolbox') && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-2">
                  <span>
                    H.264 max width is 4096px. Use HEVC (H.265) or AV1 for {config.width}px.
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, codec: 'libx265' }))}
                    className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 font-semibold shrink-0 cursor-pointer"
                  >
                    Switch to H.265
                  </button>
                </div>
              )}

            {/* Rate Control Mode: CRF vs Bitrate */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">Rate Control</label>
                <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, rateControl: 'crf' }))}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                      config.rateControl === 'crf'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400'
                    }`}
                  >
                    Constant Quality (CRF)
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, rateControl: 'bitrate' }))}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                      config.rateControl === 'bitrate'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400'
                    }`}
                  >
                    Target Bitrate (Mbps)
                  </button>
                </div>
              </div>

              {config.rateControl === 'crf' ? (
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">
                      CRF Quality:{' '}
                      <strong className="text-indigo-400">{config.crf}</strong>{' '}
                      {config.crf <= 16
                        ? '(Visually Lossless)'
                        : config.crf <= 20
                        ? '(High Quality)'
                        : config.crf <= 24
                        ? '(Balanced)'
                        : '(Smaller File)'}
                    </span>
                    <span className="text-slate-500 font-mono">Lower = Higher Quality</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={34}
                    step={1}
                    value={config.crf}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, crf: Number(e.target.value) }))
                    }
                    className="w-full accent-indigo-500"
                  />
                </div>
              ) : (
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">Target Video Bitrate</span>
                    <span className="text-indigo-400 font-mono font-bold">
                      {config.targetBitrateMbps} Mbps
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={120}
                    step={1}
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

            {/* Frame Rate, Speed Preset, Pixel Format & Audio */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Frame Rate (FPS)</label>
                <select
                  value={config.fps}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      fps: e.target.value as UpscaleConfig['fps'],
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  <option value="source">Keep Source FPS</option>
                  <option value="24">24 fps (Cinema)</option>
                  <option value="30">30 fps (Standard)</option>
                  <option value="60">60 fps (Smooth 60p)</option>
                  <option value="120">120 fps (High Frame Rate)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Encoder Speed Preset</label>
                <select
                  value={config.preset}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      preset: e.target.value as UpscaleConfig['preset'],
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  <option value="ultrafast">Ultrafast (Lowest CPU)</option>
                  <option value="veryfast">Veryfast</option>
                  <option value="fast">Fast (Recommended)</option>
                  <option value="medium">Medium (Balanced)</option>
                  <option value="slow">Slow (Best Compression)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Color Depth / PixFmt</label>
                <select
                  value={config.pixelFormat}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      pixelFormat: e.target.value as UpscaleConfig['pixelFormat'],
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  <option value="yuv420p">8-bit YUV 4:2:0 (Universal compatibility)</option>
                  <option value="yuv420p10le">10-bit YUV 4:2:0 (HDR / Smooth Gradients)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Audio Track</label>
                <select
                  value={config.audioMode}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      audioMode: e.target.value as UpscaleConfig['audioMode'],
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  <option value="copy">Stream Copy (Lossless Fast)</option>
                  <option value="aac_192">AAC 192 kbps Stereo</option>
                  <option value="aac_320">AAC 320 kbps Studio</option>
                  <option value="mute">Remove Audio (-an)</option>
                </select>
              </div>
            </div>

            {/* Primary Action Button */}
            <button
              type="button"
              disabled={!video || job?.status === 'processing'}
              onClick={handleStartUpscale}
              className="w-full py-3.5 px-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition cursor-pointer"
            >
              {job?.status === 'processing' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Rendering {config.width}×{config.height} ({job.progress}%)...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Upscale & Render to {config.width}×{config.height} ({config.container.toUpperCase()})
                </>
              )}
            </button>
          </section>
        </div>
      </main>
    </div>
  );
}
