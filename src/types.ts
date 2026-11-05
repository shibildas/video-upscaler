export interface VideoMetadata {
  width: number;
  height: number;
  rawWidth?: number;
  rawHeight?: number;
  sourceRotation?: number;
  codec: string;
  codecLong: string;
  profile: string;
  pixFmt: string;
  colorSpace: string;
  fps: number;
  duration: number;
  sizeBytes: number;
  bitRate: number;
  displayAspectRatio: string;
  hasAudio: boolean;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRate: string | null;
  formatName: string;
}

export interface UploadedVideo {
  fileId: string;
  originalName: string;
  url: string;
  metadata: VideoMetadata;
}

export interface WatermarkBox {
  id: string;
  label?: string;
  /** Normalized 0..1 coordinates relative to the unrotated source video frame */
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  confidence?: number;
}

export interface UpscaleConfig {
  presetId: string;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
  watermarkEnabled: boolean;
  watermarkMode: 'delogo' | 'blur';
  watermarkBoxes: WatermarkBox[];
  aspectMode: 'fit' | 'pad' | 'crop' | 'stretch';
  scaleAlgorithm: 'lanczos' | 'bicubic' | 'spline' | 'bilinear' | 'neighbor';
  sharpenPreset: 'none' | 'light' | 'medium' | 'strong' | 'custom';
  sharpenAmount: number;
  denoise: 'none' | 'light' | 'medium';
  codec: 'libx264' | 'libx265' | 'h264_videotoolbox' | 'hevc_videotoolbox' | 'libsvtav1' | 'libvpx-vp9';
  rateControl: 'crf' | 'bitrate';
  crf: number;
  targetBitrateMbps: number;
  preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow';
  fps: 'source' | '24' | '30' | '60' | '120';
  pixelFormat: 'yuv420p' | 'yuv420p10le';
  audioMode: 'copy' | 'aac_192' | 'aac_320' | 'mute';
  container: 'mp4' | 'mov' | 'mkv' | 'webm';
}

export interface ResolutionPreset {
  id: string;
  label: string;
  badge: string;
  width: number;
  height: number;
  desc: string;
  recommendedBitrateMbps: number;
}

export interface JobState {
  jobId: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  fps: number;
  speed: string;
  bitrate: string;
  currentTimeSec: number;
  totalDurationSec: number;
  command: string;
  startedAt: number;
  completedAt: number | null;
  outputUrl: string | null;
  outputFilename: string;
  outputMetadata: VideoMetadata | null;
  error: string | null;
  logs: string[];
}
