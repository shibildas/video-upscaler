export interface Vr360Metadata {
  isVr360: boolean;
  projection: 'none' | 'equirectangular' | 'hequirectangular' | 'cubemap' | 'fisheye';
  stereoMode: 'mono' | 'sbs' | 'tb';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface VideoMetadata {
  width: number;
  height: number;
  rawWidth?: number;
  rawHeight?: number;
  sourceRotation?: number;
  vr360?: Vr360Metadata;
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

export interface SceneTag {
  id: string;
  label: string;
  category?: 'scene' | 'highlight' | 'b-roll' | 'cut' | 'note';
  color: string;
  timestamp: number;
  notes?: string;
}

export interface TimelineClip {
  id: string;
  name: string;
  /** Source media in-point in seconds */
  sourceStart: number;
  /** Source media out-point in seconds */
  sourceEnd: number;
  /** Position on the horizontal timeline track in seconds */
  trackStart: number;
  color: string;
  tags: SceneTag[];
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
  vrNormalizeEnabled: boolean;
  vrInputProjection: 'e' | 'hequirect' | 'dfisheye' | 'fisheye' | 'cubemap';
  vrStereoMode: 'mono' | 'sbs' | 'tb';
  vrFov: number;
  vrYaw: number;
  vrPitch: number;
  vrRoll: number;
  aspectMode: 'fit' | 'pad' | 'crop' | 'stretch';
  scaleAlgorithm: 'lanczos' | 'bicubic' | 'spline' | 'bilinear' | 'neighbor';
  sharpenPreset: 'none' | 'light' | 'medium' | 'strong' | 'custom';
  sharpenAmount: number;
  denoise: 'none' | 'light' | 'medium' | 'nlmeans';
  // Video Enhancement & Color Grading Controls
  enhancePreset: 'none' | 'cinema' | 'vivid' | 'restore' | 'lowlight' | 'custom';
  casStrength: number; // 0..1 Contrast Adaptive Sharpening
  debandEnabled: boolean;
  deinterlaceEnabled: boolean;
  brightness: number; // -0.5 .. 0.5 (default 0)
  contrast: number; // 0.5 .. 1.8 (default 1)
  saturation: number; // 0 .. 2.5 (default 1)
  gamma: number; // 0.5 .. 2.0 (default 1)
  vibrance: number; // -1.0 .. 1.5 (default 0)
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
