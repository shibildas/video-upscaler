import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { FileData } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type {
  UploadedVideo,
  VideoMetadata,
  UpscaleConfig,
  WatermarkBox,
  JobState,
  TransitionType,
  Vr360Metadata,
} from '../types';

/**
 * In-memory registry of browser-selected File/Blob objects keyed by `fileId` and `url`
 * so standalone deployments (e.g. Vercel static hosting) can process videos without a Node backend.
 */
const browserFileStore = new Map<string, File | Blob>();

export function registerBrowserFile(key: string, file: File | Blob): void {
  browserFileStore.set(key, file);
}

export function getBrowserFile(keyOrUrl: string): File | Blob | undefined {
  return browserFileStore.get(keyOrUrl);
}

function toEven(num: number): number {
  const n = Math.max(2, Math.round(Number(num) || 2));
  return n % 2 === 0 ? n : n + 1;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function formatAspectRatio(w: number, h: number): string {
  if (!w || !h) return '16:9';
  const divisor = gcd(w, h);
  return `${w / divisor}:${h / divisor}`;
}

/**
 * Converts FFmpeg `readFile` output (`FileData` = `Uint8Array | string`) into a `Blob`.
 * In TypeScript 5.7+, `Uint8Array` defaults to `Uint8Array<ArrayBufferLike>`, which includes
 * `SharedArrayBuffer` and is not directly assignable to DOM `BlobPart` (`ArrayBufferView<ArrayBuffer>`).
 */
function fileDataToMp4Blob(data: FileData, mimeType = 'video/mp4'): Blob {
  if (typeof data === 'string') {
    return new Blob([data], { type: mimeType });
  }
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeType });
}

export type VideoInputSource = File | Blob | string;

export interface TrimOptions {
  /** Start timestamp in seconds (e.g. 2.5) */
  startTime: number;
  /** End timestamp in seconds (e.g. 12.0) */
  endTime: number;
  /**
   * When true (default), uses `-c copy` stream copy for ultra-fast lossless trimming.
   * When false, re-encodes with `libx264` + `aac` for frame-exact precision on non-keyframes.
   */
  fastCopy?: boolean;
  /** Optional progress callback (0..100) */
  onProgress?: (pct: number) => void;
}

export interface SplitResult {
  part1: Blob;
  part2: Blob;
  part1Url: string;
  part2Url: string;
}

export interface MergeOptions {
  /**
   * When true (default), uses the FFmpeg concat demuxer (`-f concat -safe 0 -c copy -movflags +faststart`)
   * without re-encoding. Automatically falls back to re-encoding if stream parameters differ.
   */
  copyCodec?: boolean;
  /** Optional progress callback (0..100) */
  onProgress?: (pct: number) => void;
}

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

/**
 * Formats seconds (e.g. 65.42) into FFmpeg timestamp `HH:MM:SS.mmm`
 */
export function formatFfmpegTime(seconds: number): string {
  const clamped = Math.max(0, Number(seconds) || 0);
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${secs
    .toFixed(3)
    .padStart(6, '0')}`;
}

/**
 * Singleton loader for @ffmpeg/ffmpeg WebAssembly core in the browser.
 * Loads `@ffmpeg/core` from jsDelivr / unpkg via `toBlobURL` so it works without special COOP/COEP headers.
 */
export async function getBrowserFFmpeg(
  onLog?: (msg: string) => void
): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();

    if (onLog) {
      ffmpeg.on('log', ({ message }) => onLog(message));
    }

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}

/**
 * Safely deletes virtual files from FFmpeg MEMFS after operations complete
 */
async function cleanupVirtualFiles(ffmpeg: FFmpeg, filenames: string[]): Promise<void> {
  for (const name of filenames) {
    try {
      await ffmpeg.deleteFile(name);
    } catch {
      // ignore if file does not exist
    }
  }
}

/**
 * 1. Trim / Cut Video Clip in Browser
 * Takes a video source (`File | Blob | URL`), `startTime` (seconds), and `endTime` (seconds),
 * crops the clip temporally in FFmpeg WASM, and returns the resulting MP4 `Blob`.
 */
export async function trimVideoClip(
  source: VideoInputSource,
  options: TrimOptions
): Promise<Blob> {
  const { startTime, endTime, fastCopy = true, onProgress } = options;
  if (endTime <= startTime) {
    throw new Error('endTime must be greater than startTime');
  }

  const ffmpeg = await getBrowserFFmpeg();
  const id = Math.random().toString(36).slice(2, 9);
  const inputName = `trim_in_${id}.mp4`;
  const outputName = `trim_out_${id}.mp4`;

  const progressHandler = ({ progress }: { progress: number }) => {
    if (onProgress) {
      onProgress(Math.min(99, Math.max(0, Math.round(progress * 100))));
    }
  };

  if (onProgress) ffmpeg.on('progress', progressHandler);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(source));

    const startStr = formatFfmpegTime(startTime);
    const durationStr = formatFfmpegTime(endTime - startTime);

    const args = fastCopy
      ? [
          '-ss',
          startStr,
          '-i',
          inputName,
          '-t',
          durationStr,
          '-c',
          'copy',
          '-avoid_negative_ts',
          'make_zero',
          '-movflags',
          '+faststart',
          outputName,
        ]
      : [
          '-ss',
          startStr,
          '-i',
          inputName,
          '-t',
          durationStr,
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '20',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          outputName,
        ];

    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg trim exited with code ${exitCode}`);
    }

    const data = await ffmpeg.readFile(outputName);
    if (onProgress) onProgress(100);
    return fileDataToMp4Blob(data);
  } finally {
    if (onProgress) ffmpeg.off('progress', progressHandler);
    await cleanupVirtualFiles(ffmpeg, [inputName, outputName]);
  }
}

/**
 * 2. Split Video at Timestamp in Browser
 * Splits a video file into two separate MP4 chunks (`part1`: `0 -> splitTime`, `part2`: `splitTime -> duration`)
 * at a specific timestamp using FFmpeg WASM.
 */
export async function splitVideoAtTimestamp(
  source: VideoInputSource,
  splitTime: number,
  totalDuration?: number,
  onProgress?: (pct: number) => void
): Promise<SplitResult> {
  if (splitTime <= 0) {
    throw new Error('splitTime must be greater than 0 seconds');
  }
  if (totalDuration !== undefined && splitTime >= totalDuration) {
    throw new Error('splitTime must be less than the total video duration');
  }

  const ffmpeg = await getBrowserFFmpeg();
  const id = Math.random().toString(36).slice(2, 9);
  const inputName = `split_in_${id}.mp4`;
  const outPart1 = `split_part1_${id}.mp4`;
  const outPart2 = `split_part2_${id}.mp4`;

  try {
    if (onProgress) onProgress(5);
    await ffmpeg.writeFile(inputName, await fetchFile(source));
    const splitStr = formatFfmpegTime(splitTime);

    // Extract Part 1: 0 -> splitTime
    const code1 = await ffmpeg.exec([
      '-i',
      inputName,
      '-t',
      splitStr,
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      outPart1,
    ]);
    if (code1 !== 0) {
      throw new Error(`FFmpeg split part 1 failed with code ${code1}`);
    }
    if (onProgress) onProgress(50);

    // Extract Part 2: splitTime -> end (or totalDuration)
    const part2Args = [
      '-ss',
      splitStr,
      '-i',
      inputName,
      ...(totalDuration && totalDuration > splitTime
        ? ['-t', formatFfmpegTime(totalDuration - splitTime)]
        : []),
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      outPart2,
    ];

    const code2 = await ffmpeg.exec(part2Args);
    if (code2 !== 0) {
      throw new Error(`FFmpeg split part 2 failed with code ${code2}`);
    }

    const [data1, data2] = await Promise.all([
      ffmpeg.readFile(outPart1),
      ffmpeg.readFile(outPart2),
    ]);

    const part1 = fileDataToMp4Blob(data1);
    const part2 = fileDataToMp4Blob(data2);

    if (onProgress) onProgress(100);

    return {
      part1,
      part2,
      part1Url: URL.createObjectURL(part1),
      part2Url: URL.createObjectURL(part2),
    };
  } finally {
    await cleanupVirtualFiles(ffmpeg, [inputName, outPart1, outPart2]);
  }
}

/**
 * 3. Merge (Concatenate) Video Segments in Browser
 * Takes an array of video file segments/blobs, writes an FFmpeg concat demuxer list (`concat_list.txt`),
 * and merges them into a single continuous MP4 file without re-encoding (`-c copy -movflags +faststart`),
 * with automatic fallback to re-encoding if codec streams are incompatible.
 */
export async function mergeVideoSegments(
  segments: VideoInputSource[],
  options: MergeOptions = {}
): Promise<Blob> {
  const { copyCodec = true, onProgress } = options;
  if (!segments || segments.length === 0) {
    throw new Error('At least one video segment is required to merge');
  }

  const ffmpeg = await getBrowserFFmpeg();
  const id = Math.random().toString(36).slice(2, 9);
  const concatListName = `concat_list_${id}.txt`;
  const outputName = `merged_${id}.mp4`;
  const segmentNames: string[] = [];

  try {
    // 1. Write each segment into FFmpeg virtual filesystem
    const listLines: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segFile = `seg_${id}_${i}.mp4`;
      segmentNames.push(segFile);
      await ffmpeg.writeFile(segFile, await fetchFile(segments[i]));
      listLines.push(`file '${segFile}'`);
      if (onProgress) {
        onProgress(Math.round(((i + 1) / segments.length) * 35));
      }
    }

    // 2. Write FFmpeg concat demuxer text file (`file 'seg_0.mp4'\nfile 'seg_1.mp4'...`)
    const concatListContent = listLines.join('\n');
    await ffmpeg.writeFile(concatListName, new TextEncoder().encode(concatListContent));

    // 3. Run fast stream-copy concatenation first
    let exitCode = -1;
    if (copyCodec) {
      exitCode = await ffmpeg.exec([
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListName,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outputName,
      ]);
    }

    // 4. Fallback to re-encoding if copyCodec is false or if stream parameters mismatched
    if (exitCode !== 0) {
      exitCode = await ffmpeg.exec([
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListName,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '20',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        outputName,
      ]);
    }

    if (exitCode !== 0) {
      throw new Error(`FFmpeg concat failed with exit code ${exitCode}`);
    }

    const mergedData = await ffmpeg.readFile(outputName);
    if (onProgress) onProgress(100);
    return fileDataToMp4Blob(mergedData);
  } finally {
    await cleanupVirtualFiles(ffmpeg, [...segmentNames, concatListName, outputName]);
  }
}

/**
 * Convenience helper to render a list of timeline clip ranges (in-point / out-point)
 * from a source video into individual trimmed segments and concatenate them into a single MP4.
 */
export async function renderTimelineClipsInBrowser(
  source: VideoInputSource,
  ranges: Array<{ startTime: number; endTime: number }>,
  onProgress?: (pct: number, stage: string) => void
): Promise<Blob> {
  if (!ranges.length) {
    throw new Error('No timeline clip ranges to render');
  }

  if (ranges.length === 1) {
    if (onProgress) onProgress(10, 'Trimming clip in browser (FFmpeg WASM)...');
    const single = await trimVideoClip(source, {
      startTime: ranges[0].startTime,
      endTime: ranges[0].endTime,
      fastCopy: true,
      onProgress: (p) => onProgress?.(p, 'Trimming clip...'),
    });
    return single;
  }

  const trimmedBlobs: Blob[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const basePct = Math.round((i / ranges.length) * 65);
    if (onProgress) {
      onProgress(basePct, `Trimming segment ${i + 1} of ${ranges.length}...`);
    }
    const blob = await trimVideoClip(source, {
      startTime: r.startTime,
      endTime: r.endTime,
      fastCopy: true,
    });
    trimmedBlobs.push(blob);
  }

  if (onProgress) {
    onProgress(70, `Merging ${trimmedBlobs.length} segments with FFmpeg concat demuxer...`);
  }

  const merged = await mergeVideoSegments(trimmedBlobs, {
    copyCodec: true,
    onProgress: (p) => onProgress?.(70 + Math.round(p * 0.3), 'Concatenating MP4 stream...'),
  });

  return merged;
}

/**
 * Detect 360° / VR spherical projection & stereo mode from filename and frame dimensions
 */
function detectBrowserVr360(name: string, width: number, height: number): Vr360Metadata {
  const lower = (name || '').toLowerCase();
  const ratio = height > 0 ? width / height : 1.777;

  let stereoMode: 'mono' | 'sbs' | 'tb' = 'mono';
  if (/(^|[_\-\s])(sbs|3dh|lr|side[_\-]?by[_\-]?side)($|[_\-\s.])/.test(lower)) {
    stereoMode = 'sbs';
  } else if (/(^|[_\-\s])(tb|ou|3dv|over[_\-]?under|top[_\-]?bottom)($|[_\-\s.])/.test(lower)) {
    stereoMode = 'tb';
  }

  if (/(vr180|180x180|180vr|hequirect)/.test(lower)) {
    return {
      isVr360: true,
      projection: 'hequirectangular',
      stereoMode: stereoMode === 'mono' && Math.abs(ratio - 2.0) < 0.08 ? 'sbs' : stereoMode,
      confidence: 'high',
      reason: 'Detected VR180 filename tag',
    };
  }

  if (/(360|equirect|spherical|insta360|gopromax|theta|vuze)/.test(lower)) {
    return {
      isVr360: true,
      projection: 'equirectangular',
      stereoMode,
      confidence: 'high',
      reason: 'Detected 360° VR filename metadata',
    };
  }

  // Exact 2:1 equirectangular aspect ratio check for typical 360° resolutions (e.g. 3840x1920, 4096x2048, 5760x2880)
  if (Math.abs(ratio - 2.0) < 0.015 && width >= 1920) {
    return {
      isVr360: true,
      projection: 'equirectangular',
      stereoMode: 'mono',
      confidence: 'medium',
      reason: `2:1 Equirectangular aspect ratio (${width}×${height})`,
    };
  }

  return {
    isVr360: false,
    projection: 'none',
    stereoMode: 'mono',
    confidence: 'low',
    reason: 'Standard rectilinear 2D video',
  };
}

/**
 * Probe a File or Blob directly in the browser using an offscreen HTML5 <video> element.
 * Works 100% client-side on Vercel or static hosts without ffprobe.
 */
export async function probeVideoFileInBrowser(
  file: File | Blob,
  originalName?: string
): Promise<UploadedVideo> {
  const name =
    originalName || (file instanceof File ? file.name : `clip_${Date.now()}.mp4`);
  const objectUrl = URL.createObjectURL(file);
  const fileId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name.replace(
    /[^a-zA-Z0-9._-]/g,
    '_'
  )}`;

  registerBrowserFile(fileId, file);
  registerBrowserFile(objectUrl, file);

  const meta = await new Promise<VideoMetadata>((resolve, reject) => {
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.muted = true;
    vid.playsInline = true;

    const cleanup = () => {
      vid.removeAttribute('src');
      vid.load();
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out reading video metadata for "${name}"`));
    }, 12000);

    vid.onloadedmetadata = () => {
      clearTimeout(timeout);
      const width = vid.videoWidth || 1920;
      const height = vid.videoHeight || 1080;
      const rawDuration = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 5;
      const duration = Number(rawDuration.toFixed(2));
      const sizeBytes = file.size || 0;
      const bitRate = duration > 0 ? Math.round((sizeBytes * 8) / duration) : 4_000_000;
      const ext = (name.split('.').pop() || 'mp4').toLowerCase();
      const vr360 = detectBrowserVr360(name, width, height);

      cleanup();
      resolve({
        width,
        height,
        rawWidth: width,
        rawHeight: height,
        sourceRotation: 0,
        vr360,
        codec: ext === 'webm' ? 'vp9' : 'h264',
        codecLong:
          ext === 'webm'
            ? 'Google VP9 (Browser Decoded)'
            : 'H.264 / AVC / MPEG-4 AVC (Browser Decoded)',
        profile: 'High',
        pixFmt: 'yuv420p',
        colorSpace: 'bt709',
        fps: 30,
        duration,
        sizeBytes,
        bitRate,
        displayAspectRatio: formatAspectRatio(width, height),
        hasAudio: true,
        audioCodec: ext === 'webm' ? 'opus' : 'aac',
        audioChannels: 2,
        audioSampleRate: '48000',
        formatName: ext,
      });
    };

    vid.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`Browser could not decode video file "${name}"`));
    };

    vid.src = objectUrl;
  });

  return {
    fileId,
    originalName: name,
    url: objectUrl,
    metadata: meta,
  };
}

/**
 * Build the `-vf` filter array for both CLI preview and browser WASM execution.
 * When `wasmSafe` is true, filters that may not exist in minimal @ffmpeg/core builds
 * (such as `cas` or `vibrance`) are mapped to universally available `unsharp` / `eq` equivalents.
 */
export function buildBrowserVfFilterList(
  config: UpscaleConfig,
  sourceMeta: VideoMetadata | null = null,
  options: { previewCapWidth?: number; wasmSafe?: boolean } = {}
): string[] {
  const {
    width = 1920,
    height = 1080,
    rotation = 0,
    flipHorizontal = false,
    flipVertical = false,
    watermarkEnabled = false,
    watermarkMode = 'delogo',
    watermarkBoxes = [],
    vrNormalizeEnabled = false,
    vrInputProjection = 'e',
    vrStereoMode = 'mono',
    vrFov = 95,
    vrYaw = 0,
    vrPitch = 0,
    vrRoll = 0,
    aspectMode = 'fit',
    scaleAlgorithm = 'lanczos',
    sharpenPreset = 'none',
    sharpenAmount = 0.8,
    denoise = 'none',
    casStrength = 0,
    debandEnabled = false,
    deinterlaceEnabled = false,
    brightness = 0,
    contrast = 1,
    saturation = 1,
    gamma = 1,
    vibrance = 0,
  } = config;

  let targetW = toEven(width);
  let targetH = toEven(height);

  if (options.previewCapWidth && targetW > options.previewCapWidth) {
    const ratio = options.previewCapWidth / targetW;
    targetW = toEven(options.previewCapWidth);
    targetH = toEven(targetH * ratio);
  }

  const flags = `flags=${scaleAlgorithm}+accurate_rnd+full_chroma_int`;
  const vfFilters: string[] = [];

  // 0. VR / 360° & Stereo3D Normalization
  if (vrNormalizeEnabled) {
    if (vrStereoMode === 'sbs') {
      vfFilters.push('crop=iw/2:ih:0:0');
    } else if (vrStereoMode === 'tb') {
      vfFilters.push('crop=iw:ih/2:0:0');
    }

    const inProj = vrInputProjection || 'e';
    const hFov = Math.max(40, Math.min(150, Number(vrFov) || 95));
    const vFov = Math.max(25, Math.min(120, Math.round(hFov * (targetH / targetW))));
    const yaw = Math.max(-180, Math.min(180, Number(vrYaw) || 0));
    const pitch = Math.max(-90, Math.min(90, Number(vrPitch) || 0));
    const roll = Math.max(-180, Math.min(180, Number(vrRoll) || 0));

    vfFilters.push(
      `v360=input=${inProj}:output=flat:h_fov=${hFov}:v_fov=${vFov}:yaw=${yaw}:pitch=${pitch}:roll=${roll}:w=${targetW}:h=${targetH}:interp=${
        options.previewCapWidth ? 'linear' : 'lanczos'
      }`
    );
  }

  // 0a. Watermark / Logo Removal
  if (watermarkEnabled && Array.isArray(watermarkBoxes) && watermarkBoxes.length > 0) {
    const srcW = Number(sourceMeta?.width) || 1920;
    const srcH = Number(sourceMeta?.height) || 1080;

    for (const box of watermarkBoxes) {
      const rawX = Math.round((Number(box.xPct) || 0) * srcW);
      const rawY = Math.round((Number(box.yPct) || 0) * srcH);
      const rawW = Math.round((Number(box.wPct) || 0.15) * srcW);
      const rawH = Math.round((Number(box.hPct) || 0.1) * srcH);

      const x = Math.max(2, Math.min(srcW - 10, rawX));
      const y = Math.max(2, Math.min(srcH - 10, rawY));
      const w = Math.max(8, Math.min(srcW - x - 2, rawW));
      const h = Math.max(8, Math.min(srcH - y - 2, rawH));

      vfFilters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0`);
      if (watermarkMode === 'blur') {
        const innerX = Math.max(2, x + 2);
        const innerY = Math.max(2, y + 2);
        const innerW = Math.max(6, w - 4);
        const innerH = Math.max(6, h - 4);
        vfFilters.push(`delogo=x=${innerX}:y=${innerY}:w=${innerW}:h=${innerH}:show=0`);
      }
    }
  }

  // 0b. Rotation & Flip
  const rot = Number(rotation) || 0;
  if (rot === 90) {
    vfFilters.push('transpose=1');
  } else if (rot === 180) {
    vfFilters.push('hflip', 'vflip');
  } else if (rot === 270) {
    vfFilters.push('transpose=2');
  }

  if (flipHorizontal) vfFilters.push('hflip');
  if (flipVertical) vfFilters.push('vflip');

  // 1. Deinterlace & Denoise
  if (deinterlaceEnabled) {
    vfFilters.push('bwdif=mode=send_frame:parity=auto:deint=all');
  }

  if (denoise === 'light') {
    vfFilters.push('hqdn3d=1.5:1.5:3:3');
  } else if (denoise === 'medium') {
    vfFilters.push('hqdn3d=3:3:6:6');
  } else if (denoise === 'nlmeans') {
    vfFilters.push(options.wasmSafe ? 'hqdn3d=4:4:7:7' : 'nlmeans=s=2.0:p=5:r=9');
  }

  if (debandEnabled && !options.wasmSafe) {
    vfFilters.push('deband');
  }

  // 2. Scaling & Aspect Mode
  if (!vrNormalizeEnabled) {
    if (aspectMode === 'stretch') {
      vfFilters.push(`scale=${targetW}:${targetH}:${flags}`, 'setsar=1');
    } else if (aspectMode === 'pad') {
      vfFilters.push(
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease:${flags}`,
        `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`,
        'setsar=1'
      );
    } else if (aspectMode === 'crop') {
      vfFilters.push(
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase:${flags}`,
        `crop=${targetW}:${targetH}`,
        'setsar=1'
      );
    } else {
      vfFilters.push(
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease:${flags}`,
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        'setsar=1'
      );
    }
  }

  // 3. Sharpening & CAS
  const casVal = Math.max(0, Math.min(1, Number(casStrength) || 0));
  if (sharpenPreset !== 'none' || (options.wasmSafe && casVal > 0.01)) {
    let lumaAmount = 0;
    if (sharpenPreset === 'light') lumaAmount = 0.5;
    else if (sharpenPreset === 'medium') lumaAmount = 1.0;
    else if (sharpenPreset === 'strong') lumaAmount = 1.6;
    else if (sharpenPreset === 'custom') {
      lumaAmount = Math.max(0.1, Math.min(3.0, Number(sharpenAmount) || 0.8));
    }
    if (options.wasmSafe && casVal > 0.01) {
      lumaAmount = Math.min(2.5, lumaAmount + casVal * 0.65);
    }
    if (lumaAmount > 0.01) {
      vfFilters.push(`unsharp=5:5:${lumaAmount.toFixed(2)}:5:5:0.0`);
    }
  }

  if (!options.wasmSafe && casVal > 0.01) {
    vfFilters.push(`cas=${casVal.toFixed(2)}`);
  }

  // 4. Color Grading (eq & vibrance)
  const bVal = Number(brightness) || 0;
  const cVal = Number(contrast) ?? 1;
  const vVal = Number(vibrance) || 0;
  const sVal =
    (Number(saturation) ?? 1) + (options.wasmSafe && Math.abs(vVal) > 0.01 ? vVal * 0.35 : 0);
  const gVal = Number(gamma) ?? 1;

  if (
    Math.abs(bVal) > 0.01 ||
    Math.abs(cVal - 1) > 0.01 ||
    Math.abs(sVal - 1) > 0.01 ||
    Math.abs(gVal - 1) > 0.01
  ) {
    vfFilters.push(
      `eq=brightness=${bVal.toFixed(2)}:contrast=${cVal.toFixed(2)}:saturation=${Math.max(
        0,
        sVal
      ).toFixed(2)}:gamma=${gVal.toFixed(2)}`
    );
  }

  if (!options.wasmSafe && Math.abs(vVal) > 0.01) {
    vfFilters.push(`vibrance=intensity=${vVal.toFixed(2)}`);
  }

  return vfFilters;
}

/**
 * Generate the full FFmpeg CLI string locally in the browser
 */
export function buildBrowserCliCommand(
  fileName: string,
  config: UpscaleConfig,
  sourceMeta: VideoMetadata | null = null
): string {
  const vfFilters = buildBrowserVfFilterList(config, sourceMeta);
  const ext = config.container || 'mp4';
  const outName = `upscaled_${config.width}x${config.height}.${ext}`;
  const parts: string[] = ['ffmpeg', '-y', '-hide_banner', '-i', `"${fileName}"`];

  if (vfFilters.length > 0) {
    parts.push('-vf', `"${vfFilters.join(',')}"`);
  }
  if (config.fps && config.fps !== 'source') {
    parts.push('-r', String(config.fps));
  }
  parts.push('-c:v', config.codec);

  if (config.codec === 'libx264' || config.codec === 'libx265') {
    parts.push('-preset', config.preset);
    if (config.rateControl === 'bitrate') {
      parts.push('-b:v', `${config.targetBitrateMbps}M`);
    } else {
      parts.push('-crf', String(config.crf));
    }
  } else {
    parts.push('-crf', String(config.crf));
  }

  parts.push('-pix_fmt', config.pixelFormat);

  if (config.audioMode === 'mute') {
    parts.push('-an');
  } else if (config.audioMode === 'aac_192') {
    parts.push('-c:a', 'aac', '-b:a', '192k');
  } else if (config.audioMode === 'aac_320') {
    parts.push('-c:a', 'aac', '-b:a', '320k');
  } else {
    parts.push('-c:a', 'copy');
  }

  if (ext === 'mp4' || ext === 'mov') {
    parts.push('-movflags', '+faststart');
  }

  parts.push(`"${outName}"`);
  return parts.join(' ');
}

/**
 * Fast client-side HTML5 <canvas> live frame preview when running on Vercel without a backend.
 * Applies geometry (rotation, flip, aspectMode), color grading (brightness/contrast/saturation/gamma/vibrance),
 * watermark delogo blur boxes, and 360° VR viewport crop in <20ms.
 */
let cachedPreviewVideoEl: HTMLVideoElement | null = null;
let cachedPreviewVideoSrc = '';

export async function renderBrowserLivePreviewFrame(
  videoUrl: string,
  timestamp: number,
  config: UpscaleConfig,
  sourceMeta: VideoMetadata | null = null
): Promise<string | null> {
  if (!videoUrl) return null;

  try {
    if (!cachedPreviewVideoEl) {
      cachedPreviewVideoEl = document.createElement('video');
      cachedPreviewVideoEl.muted = true;
      cachedPreviewVideoEl.playsInline = true;
      cachedPreviewVideoEl.crossOrigin = 'anonymous';
      cachedPreviewVideoEl.preload = 'auto';
    }

    const vid = cachedPreviewVideoEl;
    if (cachedPreviewVideoSrc !== videoUrl) {
      cachedPreviewVideoSrc = videoUrl;
      vid.src = videoUrl;
      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          vid.removeEventListener('loadeddata', onLoaded);
          vid.removeEventListener('error', onErr);
          resolve();
        };
        const onErr = () => {
          vid.removeEventListener('loadeddata', onLoaded);
          vid.removeEventListener('error', onErr);
          reject(new Error('Preview video load failed'));
        };
        vid.addEventListener('loadeddata', onLoaded);
        vid.addEventListener('error', onErr);
      });
    }

    const targetTime = Math.max(
      0,
      Math.min((vid.duration || sourceMeta?.duration || 10) - 0.05, Number(timestamp) || 0)
    );
    if (Math.abs(vid.currentTime - targetTime) > 0.08) {
      vid.currentTime = targetTime;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250);
        const onSeeked = () => {
          clearTimeout(timer);
          vid.removeEventListener('seeked', onSeeked);
          resolve();
        };
        vid.addEventListener('seeked', onSeeked);
      });
    }

    const srcW = vid.videoWidth || sourceMeta?.width || 1920;
    const srcH = vid.videoHeight || sourceMeta?.height || 1080;

    // 1. Draw raw frame (with optional watermark blur & VR crop) onto an intermediate canvas
    const stageCanvas = document.createElement('canvas');
    stageCanvas.width = srcW;
    stageCanvas.height = srcH;
    const sCtx = stageCanvas.getContext('2d');
    if (!sCtx) return null;

    sCtx.drawImage(vid, 0, 0, srcW, srcH);

    // Apply watermark delogo / blur boxes on the unrotated frame
    if (
      config.watermarkEnabled &&
      Array.isArray(config.watermarkBoxes) &&
      config.watermarkBoxes.length > 0
    ) {
      for (const box of config.watermarkBoxes) {
        const bx = Math.max(0, Math.round(box.xPct * srcW));
        const by = Math.max(0, Math.round(box.yPct * srcH));
        const bw = Math.max(8, Math.min(srcW - bx, Math.round(box.wPct * srcW)));
        const bh = Math.max(8, Math.min(srcH - by, Math.round(box.hPct * srcH)));

        sCtx.save();
        sCtx.beginPath();
        sCtx.rect(bx, by, bw, bh);
        sCtx.clip();
        sCtx.filter = config.watermarkMode === 'blur' ? 'blur(14px)' : 'blur(9px)';
        sCtx.drawImage(stageCanvas, 0, 0);
        sCtx.restore();
      }
    }

    // 2. Compute output preview dimensions (capped at 960px wide for instant response)
    const previewCap = 960;
    const isSideways = config.rotation === 90 || config.rotation === 270;
    const rotSrcW = isSideways ? srcH : srcW;
    const rotSrcH = isSideways ? srcW : srcH;

    let outW = toEven(config.width);
    let outH = toEven(config.height);
    if (config.aspectMode === 'fit' && !config.vrNormalizeEnabled && rotSrcW > 0 && rotSrcH > 0) {
      const r = Math.min(outW / rotSrcW, outH / rotSrcH);
      outW = toEven(rotSrcW * r);
      outH = toEven(rotSrcH * r);
    }
    if (outW > previewCap) {
      const r = previewCap / outW;
      outW = toEven(previewCap);
      outH = toEven(outH * r);
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, outW, outH);

    // Build CSS filter approximation for color grading
    const brightnessPct = Math.max(10, Math.round((1 + (config.brightness || 0)) * 100));
    const contrastPct = Math.max(20, Math.round((config.contrast ?? 1) * 100));
    const effectiveSat = Math.max(
      0,
      (config.saturation ?? 1) + (config.vibrance || 0) * 0.45
    );
    const saturatePct = Math.round(effectiveSat * 100);
    ctx.filter = `brightness(${brightnessPct}%) contrast(${contrastPct}%) saturate(${saturatePct}%)`;

    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    if (config.rotation) {
      ctx.rotate((config.rotation * Math.PI) / 180);
    }
    const scaleX = config.flipHorizontal ? -1 : 1;
    const scaleY = config.flipVertical ? -1 : 1;
    ctx.scale(scaleX, scaleY);

    const destBoxW = isSideways ? outH : outW;
    const destBoxH = isSideways ? outW : outH;

    if (config.vrNormalizeEnabled) {
      // Simulate 360° VR viewport extraction from equirectangular / stereo frame
      let eyeW = srcW;
      let eyeH = srcH;
      if (config.vrStereoMode === 'sbs') eyeW = Math.floor(srcW / 2);
      if (config.vrStereoMode === 'tb') eyeH = Math.floor(srcH / 2);

      const fovRatio = Math.max(0.25, Math.min(0.85, (config.vrFov || 95) / 180));
      const cropW = Math.round(eyeW * fovRatio);
      const cropH = Math.round(eyeH * fovRatio);
      const normYaw = ((config.vrYaw || 0) + 180) / 360;
      const normPitch = (90 - (config.vrPitch || 0)) / 180;
      const cx = Math.max(0, Math.min(eyeW - cropW, Math.round(normYaw * eyeW - cropW / 2)));
      const cy = Math.max(0, Math.min(eyeH - cropH, Math.round(normPitch * eyeH - cropH / 2)));

      ctx.drawImage(stageCanvas, cx, cy, cropW, cropH, -destBoxW / 2, -destBoxH / 2, destBoxW, destBoxH);
    } else if (config.aspectMode === 'pad') {
      const r = Math.min(destBoxW / srcW, destBoxH / srcH);
      const dw = srcW * r;
      const dh = srcH * r;
      ctx.drawImage(stageCanvas, -dw / 2, -dh / 2, dw, dh);
    } else if (config.aspectMode === 'crop') {
      const r = Math.max(destBoxW / srcW, destBoxH / srcH);
      const dw = srcW * r;
      const dh = srcH * r;
      ctx.drawImage(stageCanvas, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.drawImage(stageCanvas, -destBoxW / 2, -destBoxH / 2, destBoxW, destBoxH);
    }

    ctx.restore();

    return await new Promise<string | null>((resolve) => {
      outCanvas.toBlob(
        (blob) => {
          resolve(blob ? URL.createObjectURL(blob) : null);
        },
        'image/jpeg',
        0.88
      );
    });
  } catch {
    return null;
  }
}

/**
 * Multi-frame static watermark / logo detector running 100% in the browser via HTML5 <video> + <canvas>.
 */
export async function detectWatermarksInBrowser(
  videoUrl: string,
  duration: number
): Promise<WatermarkBox[]> {
  const safeDur = Math.max(0.5, Number(duration) || 4);
  const sampleCount = 5;
  const W = 320;
  const H = 180;
  const frameSize = W * H;

  const vid = document.createElement('video');
  vid.muted = true;
  vid.playsInline = true;
  vid.crossOrigin = 'anonymous';
  vid.src = videoUrl;

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Watermark scan video load timeout')), 8000);
    vid.onloadeddata = () => {
      clearTimeout(t);
      resolve();
    };
    vid.onerror = () => {
      clearTimeout(t);
      reject(new Error('Could not decode video for watermark detection'));
    };
  });

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const grayFrames: Uint8Array[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const time = Math.min(safeDur - 0.05, ((i + 0.5) / sampleCount) * safeDur);
    vid.currentTime = Math.max(0, time);
    await new Promise<void>((r) => {
      const timer = setTimeout(r, 250);
      vid.onseeked = () => {
        clearTimeout(timer);
        r();
      };
    });
    ctx.drawImage(vid, 0, 0, W, H);
    const rgba = ctx.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(frameSize);
    for (let p = 0; p < frameSize; p++) {
      const idx = p * 4;
      gray[p] = Math.round(0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2]);
    }
    grayFrames.push(gray);
  }

  vid.removeAttribute('src');
  vid.load();

  const numFrames = grayFrames.length;
  if (numFrames < 1) return [];

  const mean = new Float32Array(frameSize);
  const variance = new Float32Array(frameSize);

  for (let f = 0; f < numFrames; f++) {
    const frame = grayFrames[f];
    for (let i = 0; i < frameSize; i++) {
      mean[i] += frame[i];
    }
  }
  for (let i = 0; i < frameSize; i++) {
    mean[i] /= numFrames;
  }

  if (numFrames > 1) {
    for (let f = 0; f < numFrames; f++) {
      const frame = grayFrames[f];
      for (let i = 0; i < frameSize; i++) {
        const diff = frame[i] - mean[i];
        variance[i] += diff * diff;
      }
    }
    for (let i = 0; i < frameSize; i++) {
      variance[i] = Math.sqrt(variance[i] / numFrames);
    }
  }

  const scoreMap = new Float32Array(frameSize);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const idx = y * W + x;
      const gx = Math.abs(mean[idx + 1] - mean[idx - 1]);
      const gy = Math.abs(mean[idx + W] - mean[idx - W]);
      const grad = gx + gy;
      if (grad > 22) {
        const temporalPenalty = numFrames > 1 ? 1 / (1 + variance[idx] * 0.15) : 1;
        scoreMap[idx] = grad * temporalPenalty;
      }
    }
  }

  const sectors = [
    { name: 'Bottom-Right Logo', x0: Math.floor(W * 0.62), y0: Math.floor(H * 0.68), x1: W - 3, y1: H - 3 },
    { name: 'Top-Right Logo', x0: Math.floor(W * 0.62), y0: 3, x1: W - 3, y1: Math.floor(H * 0.32) },
    { name: 'Bottom-Left Logo', x0: 3, y0: Math.floor(H * 0.68), x1: Math.floor(W * 0.38), y1: H - 3 },
    { name: 'Top-Left Logo', x0: 3, y0: 3, x1: Math.floor(W * 0.38), y1: Math.floor(H * 0.32) },
  ];

  const candidates: Array<WatermarkBox & { score: number }> = [];

  for (const sec of sectors) {
    let sumScore = 0;
    let activePixels = 0;
    let minX = sec.x1;
    let maxX = sec.x0;
    let minY = sec.y1;
    let maxY = sec.y0;

    for (let y = sec.y0; y < sec.y1; y++) {
      for (let x = sec.x0; x < sec.x1; x++) {
        const s = scoreMap[y * W + x];
        if (s > 18) {
          sumScore += s;
          activePixels++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (activePixels >= 14 && maxX > minX + 4 && maxY > minY + 3) {
      const bx0 = Math.max(1, minX - 4);
      const by0 = Math.max(1, minY - 3);
      const bx1 = Math.min(W - 2, maxX + 4);
      const by1 = Math.min(H - 2, maxY + 3);
      const boxArea = (bx1 - bx0) * (by1 - by0);
      const sectorArea = (sec.x1 - sec.x0) * (sec.y1 - sec.y0);
      const density = activePixels / Math.max(1, boxArea);

      if (boxArea <= sectorArea * 0.85 && density > 0.08) {
        candidates.push({
          id: Math.random().toString(36).slice(2, 10),
          label: sec.name,
          xPct: Number((bx0 / W).toFixed(4)),
          yPct: Number((by0 / H).toFixed(4)),
          wPct: Number(((bx1 - bx0) / W).toFixed(4)),
          hPct: Number(((by1 - by0) / H).toFixed(4)),
          confidence: Math.min(98, Math.round(55 + Math.min(43, sumScore / 180))),
          score: sumScore * density,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 0) {
    return candidates.slice(0, 2).map(({ score: _s, ...rest }) => rest);
  }

  return [
    {
      id: Math.random().toString(36).slice(2, 10),
      label: 'Bottom-Right Corner (Default)',
      xPct: 0.76,
      yPct: 0.82,
      wPct: 0.2,
      hPct: 0.12,
      confidence: 60,
    },
  ];
}

/**
 * Generate a 640x360 synthetic demo video clip directly in the browser using FFmpeg WASM
 * so "Load 360p Demo Clip" works on Vercel without any backend server.
 */
export async function generateDemoVideoInBrowser(): Promise<UploadedVideo> {
  const ffmpeg = await getBrowserFFmpeg();
  const outName = `demo_360p_${Date.now()}.mp4`;

  try {
    const code = await ffmpeg.exec([
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=4:size=640x360:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '22',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      '-movflags',
      '+faststart',
      outName,
    ]);

    if (code !== 0) {
      throw new Error(`FFmpeg demo generation exited with code ${code}`);
    }

    const data = await ffmpeg.readFile(outName);
    const blob = fileDataToMp4Blob(data, 'video/mp4');
    return await probeVideoFileInBrowser(blob, 'sample_360p_test_clip.mp4');
  } finally {
    await cleanupVirtualFiles(ffmpeg, [outName]);
  }
}

/**
 * Full client-side video upscale & filter render in @ffmpeg/ffmpeg WASM.
 * Automatically falls back to WASM-compatible encoders (`libx264` / `libvpx-vp9`)
 * and reports real-time progress to the UI job state.
 */
export async function processVideoInBrowser(
  video: UploadedVideo,
  config: UpscaleConfig,
  onUpdate: (partial: Partial<JobState>) => void
): Promise<{
  outputUrl: string;
  outputFilename: string;
  outputMetadata: VideoMetadata;
  command: string;
}> {
  const logs: string[] = [];
  const ffmpeg = await getBrowserFFmpeg((msg) => {
    logs.push(msg);
    if (logs.length > 60) logs.shift();
  });

  const id = Math.random().toString(36).slice(2, 9);
  const ext = config.container === 'webm' ? 'webm' : config.container === 'mkv' ? 'mkv' : config.container === 'mov' ? 'mov' : 'mp4';
  const inputExt = (video.originalName.split('.').pop() || 'mp4').toLowerCase();
  const inputName = `in_${id}.${inputExt}`;
  const outputName = `out_${id}.${ext}`;
  const totalDur = Math.max(0.5, video.metadata.duration || 5);
  const startedAt = Date.now();

  const progressHandler = ({ progress, time }: { progress: number; time: number }) => {
    const timeSec = time > 0 ? time / 1_000_000 : progress * totalDur;
    const pct = Math.min(99, Math.max(1, Math.round(progress * 100)));
    const elapsedSec = Math.max(0.2, (Date.now() - startedAt) / 1000);
    const speed = `${(timeSec / elapsedSec).toFixed(2)}x`;
    onUpdate({
      progress: pct,
      currentTimeSec: Number(Math.min(totalDur, timeSec).toFixed(2)),
      speed,
      logs: [...logs],
    });
  };

  ffmpeg.on('progress', progressHandler);

  try {
    const sourceFile = getBrowserFile(video.fileId) || getBrowserFile(video.url) || video.url;
    await ffmpeg.writeFile(inputName, await fetchFile(sourceFile));

    const vfFilters = buildBrowserVfFilterList(config, video.metadata, { wasmSafe: true });
    // Map hardware or unsupported encoders to WASM-built encoders
    const wasmCodec =
      config.codec === 'libvpx-vp9' || ext === 'webm' ? 'libvpx-vp9' : 'libx264';
    const wasmPreset =
      config.preset === 'slow' || config.preset === 'medium' ? 'fast' : config.preset || 'ultrafast';

    const buildArgs = (filters: string[], useCopyAudio: boolean): string[] => {
      const a: string[] = ['-y', '-i', inputName];
      if (filters.length > 0) {
        a.push('-vf', filters.join(','));
      }
      if (config.fps && config.fps !== 'source') {
        a.push('-r', String(config.fps));
      }
      a.push('-c:v', wasmCodec);
      if (wasmCodec === 'libx264') {
        a.push('-preset', wasmPreset, '-crf', String(config.crf || 20));
      } else {
        a.push('-crf', String(config.crf || 24), '-b:v', '0');
      }
      a.push('-pix_fmt', 'yuv420p');

      if (config.audioMode === 'mute') {
        a.push('-an');
      } else if (!useCopyAudio || config.audioMode === 'aac_192' || config.audioMode === 'aac_320') {
        a.push('-c:a', ext === 'webm' ? 'libvorbis' : 'aac', '-b:a', '192k');
      } else {
        a.push('-c:a', 'copy');
      }

      if (ext === 'mp4' || ext === 'mov') {
        a.push('-movflags', '+faststart');
      }
      a.push(outputName);
      return a;
    };

    let args = buildArgs(vfFilters, ext !== 'webm');
    const cliString = `ffmpeg ${args.join(' ')}`;
    onUpdate({ command: cliString, progress: 3 });

    let exitCode = await ffmpeg.exec(args);

    // Fallback if stream-copy audio or a specialized filter like v360/delogo failed in WASM
    if (exitCode !== 0) {
      const basicScaleFilters = vfFilters.filter(
        (f) =>
          f.startsWith('scale=') ||
          f.startsWith('pad=') ||
          f.startsWith('crop=') ||
          f.startsWith('transpose=') ||
          f === 'hflip' ||
          f === 'vflip' ||
          f === 'setsar=1' ||
          f.startsWith('eq=') ||
          f.startsWith('unsharp=')
      );
      args = buildArgs(basicScaleFilters, false);
      exitCode = await ffmpeg.exec(args);
    }

    if (exitCode !== 0) {
      throw new Error(`Browser FFmpeg WASM render exited with code ${exitCode}`);
    }

    const outData = await ffmpeg.readFile(outputName);
    const mimeType =
      ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4';
    const outBlob = fileDataToMp4Blob(outData, mimeType);
    const outFilename = `framescale_${config.width}x${config.height}_${Date.now()}.${ext}`;
    const probed = await probeVideoFileInBrowser(outBlob, outFilename);

    return {
      outputUrl: probed.url,
      outputFilename: outFilename,
      outputMetadata: probed.metadata,
      command: cliString,
    };
  } finally {
    ffmpeg.off('progress', progressHandler);
    await cleanupVirtualFiles(ffmpeg, [inputName, outputName]);
  }
}

/**
 * Multi-clip merge with transitions in @ffmpeg/ffmpeg WASM.
 * Uses `xfade` when supported and automatically falls back to normalized resolution concatenation.
 */
export async function mergeClipsWithTransitionsInBrowser(
  clips: UploadedVideo[],
  options: {
    transition: TransitionType;
    transitionDuration: number;
    width: number;
    height: number;
    fps: number;
    crf: number;
  },
  onUpdate: (partial: Partial<JobState>) => void
): Promise<{
  outputUrl: string;
  outputFilename: string;
  outputMetadata: VideoMetadata;
  command: string;
}> {
  const ffmpeg = await getBrowserFFmpeg();
  const id = Math.random().toString(36).slice(2, 9);
  const targetW = toEven(options.width || 1920);
  const targetH = toEven(options.height || 1080);
  const targetFps = options.fps || 30;
  const transDur = Math.max(0.2, Math.min(3.5, Number(options.transitionDuration) || 1.0));
  const inputNames: string[] = [];
  const normNames: string[] = [];
  const concatListName = `concat_${id}.txt`;
  const outputName = `merged_xfade_${id}.mp4`;

  try {
    // 1. Write and normalize each clip to identical resolution, SAR, pixel format, and frame rate
    const listLines: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const rawName = `raw_${id}_${i}.mp4`;
      const normName = `norm_${id}_${i}.mp4`;
      inputNames.push(rawName);
      normNames.push(normName);

      const src = getBrowserFile(c.fileId) || getBrowserFile(c.url) || c.url;
      await ffmpeg.writeFile(rawName, await fetchFile(src));

      onUpdate({
        progress: Math.round(((i + 0.5) / clips.length) * 55),
        logs: [`Normalizing clip ${i + 1} of ${clips.length} to ${targetW}×${targetH}...`],
      });

      const normCode = await ffmpeg.exec([
        '-y',
        '-i',
        rawName,
        '-vf',
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${targetFps},format=yuv420p`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        String(options.crf || 20),
        '-c:a',
        'aac',
        '-ar',
        '48000',
        '-ac',
        '2',
        normName,
      ]);

      if (normCode !== 0) {
        throw new Error(`Failed normalizing clip ${i + 1} in Browser FFmpeg WASM`);
      }
      listLines.push(`file '${normName}'`);
    }

    // 2. Try xfade filtergraph across normalized clips if 2+ clips have sufficient duration
    let xfadeSuccess = false;
    const cmdPreview = `ffmpeg ${normNames.map((n) => `-i ${n}`).join(' ')} -filter_complex "xfade=transition=${options.transition}:duration=${transDur}" -c:v libx264 ${outputName}`;
    onUpdate({ command: cmdPreview, progress: 65 });

    if (clips.length >= 2) {
      const inputsArgs: string[] = ['-y'];
      for (const n of normNames) {
        inputsArgs.push('-i', n);
      }

      const vFilters: string[] = [];
      let cumulativeOffset = 0;
      let prevLabel = '[0:v]';

      for (let i = 1; i < clips.length; i++) {
        const prevDur = Math.max(transDur + 0.5, clips[i - 1].metadata.duration || 4);
        cumulativeOffset += prevDur - transDur;
        const outLabel = i === clips.length - 1 ? '[vout]' : `[vx${i}]`;
        vFilters.push(
          `${prevLabel}[${i}:v]xfade=transition=${options.transition}:duration=${transDur.toFixed(
            2
          )}:offset=${Math.max(0.1, cumulativeOffset).toFixed(2)}${outLabel}`
        );
        prevLabel = outLabel;
      }

      const xfadeCode = await ffmpeg.exec([
        ...inputsArgs,
        '-filter_complex',
        vFilters.join(';'),
        '-map',
        '[vout]',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        String(options.crf || 20),
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outputName,
      ]);

      if (xfadeCode === 0) {
        xfadeSuccess = true;
      }
    }

    // 3. Fallback to concat demuxer on the already-normalized clips if xfade filter wasn't supported
    if (!xfadeSuccess) {
      await ffmpeg.writeFile(concatListName, new TextEncoder().encode(listLines.join('\n')));
      const concatCode = await ffmpeg.exec([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListName,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outputName,
      ]);
      if (concatCode !== 0) {
        throw new Error(`Browser FFmpeg merge exited with code ${concatCode}`);
      }
    }

    onUpdate({ progress: 98 });
    const outData = await ffmpeg.readFile(outputName);
    const outBlob = fileDataToMp4Blob(outData, 'video/mp4');
    const outFilename = `merged_${clips.length}clips_${targetW}x${targetH}_${Date.now()}.mp4`;
    const probed = await probeVideoFileInBrowser(outBlob, outFilename);

    return {
      outputUrl: probed.url,
      outputFilename: outFilename,
      outputMetadata: probed.metadata,
      command: cmdPreview,
    };
  } finally {
    await cleanupVirtualFiles(ffmpeg, [...inputNames, ...normNames, concatListName, outputName]);
  }
}

