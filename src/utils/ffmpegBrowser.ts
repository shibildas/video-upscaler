import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { FileData } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

/**
 * Converts FFmpeg `readFile` output (`FileData` = `Uint8Array | string`) into a `Blob`.
 * In TypeScript 5.7+, `Uint8Array` defaults to `Uint8Array<ArrayBufferLike>`, which includes
 * `SharedArrayBuffer` and is not directly assignable to DOM `BlobPart` (`ArrayBufferView<ArrayBuffer>`).
 */
function fileDataToMp4Blob(data: FileData): Blob {
  if (typeof data === 'string') {
    return new Blob([data], { type: 'video/mp4' });
  }
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
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
