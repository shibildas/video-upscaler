import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const OUTPUTS_DIR = path.join(ROOT_DIR, 'outputs');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/outputs', express.static(OUTPUTS_DIR));

/**
 * Sanitize client browser fingerprint (8-32 lowercase hex/alphanumeric chars)
 */
function sanitizeFingerprint(raw) {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
  return cleaned.length >= 6 ? cleaned : 'anon0000';
}

function getRequestFingerprint(req) {
  return sanitizeFingerprint(
    req.headers['x-browser-fingerprint'] || req.body?.fingerprint || req.query?.fingerprint
  );
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const fp = getRequestFingerprint(req);
    const uniqueSuffix = crypto.randomUUID().slice(0, 8);
    const ext = (path.extname(file.originalname) || '.mp4').toLowerCase();
    const base = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 36);
    cb(null, `${fp}_${Date.now()}_${uniqueSuffix}_${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB max
});

// Active jobs registry
const jobs = new Map();

/**
 * Safely delete a file inside a given directory (prevents path traversal)
 */
function safeUnlink(baseDir, filename) {
  if (!filename) return false;
  const safeName = path.basename(filename);
  const fullPath = path.join(baseDir, safeName);
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return true;
    }
  } catch (_err) {
    // ignore unlink error
  }
  return false;
}

/**
 * Cancel and remove jobs, uploads, and output files scoped to a specific browser fingerprint
 * (or specific fileId/jobId) when switching videos, avoiding any filename/session conflict.
 */
function cleanupClientResources({
  fingerprint,
  fileId,
  jobId,
  keepUploadFilename = null,
  clearOutputsOnly = false,
} = {}) {
  const fpPrefix = fingerprint ? `${sanitizeFingerprint(fingerprint)}_` : null;

  // 1. If a specific jobId is provided, cancel and delete its output
  if (jobId && jobs.has(jobId)) {
    const job = jobs.get(jobId);
    if (job.process) {
      job.status = 'cancelled';
      job.process.kill('SIGTERM');
    }
    safeUnlink(OUTPUTS_DIR, job.outputFilename);
    jobs.delete(jobId);
  }

  // 2. Clean up any jobs belonging to this browser fingerprint or matching fileId
  const safeFileId = fileId ? path.basename(fileId) : null;
  for (const [id, job] of jobs.entries()) {
    const matchesFp = fingerprint && job.fingerprint === sanitizeFingerprint(fingerprint);
    const matchesFile = safeFileId && job.sourceFileId === safeFileId;
    if (matchesFp || matchesFile) {
      if (job.process) {
        job.status = 'cancelled';
        job.process.kill('SIGTERM');
      }
      safeUnlink(OUTPUTS_DIR, job.outputFilename);
      jobs.delete(id);
    }
  }

  // 3. Delete output files on disk belonging to this browser fingerprint
  if (fpPrefix) {
    try {
      for (const file of fs.readdirSync(OUTPUTS_DIR)) {
        if (file.startsWith(fpPrefix) && file !== '.gitkeep') {
          safeUnlink(OUTPUTS_DIR, file);
        }
      }
    } catch (_e) {
      // ignore
    }
  }

  // 4. Delete old uploaded source files belonging to this browser fingerprint (unless clearOutputsOnly)
  if (!clearOutputsOnly) {
    if (safeFileId && safeFileId !== keepUploadFilename) {
      safeUnlink(UPLOADS_DIR, safeFileId);
    }
    if (fpPrefix) {
      try {
        for (const file of fs.readdirSync(UPLOADS_DIR)) {
          if (
            file.startsWith(fpPrefix) &&
            file !== keepUploadFilename &&
            file !== '.gitkeep'
          ) {
            safeUnlink(UPLOADS_DIR, file);
          }
        }
      } catch (_e) {
        // ignore
      }
    }
  }
}

/**
 * Probe video file with ffprobe and return structured metadata
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const raw = JSON.parse(stdout);
          const videoStream = (raw.streams || []).find((s) => s.codec_type === 'video') || {};
          const audioStream = (raw.streams || []).find((s) => s.codec_type === 'audio') || null;
          const format = raw.format || {};

          // Parse frame rate (e.g., "30000/1001" or "60/1")
          let fps = 30;
          if (videoStream.r_frame_rate) {
            const parts = videoStream.r_frame_rate.split('/').map(Number);
            if (parts.length === 2 && parts[1] > 0) {
              fps = Math.round((parts[0] / parts[1]) * 100) / 100;
            } else if (parts[0]) {
              fps = parts[0];
            }
          }

          const duration = parseFloat(format.duration || videoStream.duration || '0') || 0;
          const sizeBytes = parseInt(format.size || '0', 10) || 0;
          const bitRate = parseInt(format.bit_rate || videoStream.bit_rate || '0', 10) || 0;

          // Detect container/stream rotation metadata (common on mobile MP4/MOV recordings)
          let sourceRotation = 0;
          if (videoStream.tags && videoStream.tags.rotate) {
            sourceRotation = ((parseInt(videoStream.tags.rotate, 10) % 360) + 360) % 360;
          } else if (Array.isArray(videoStream.side_data_list)) {
            const dispMatrix = videoStream.side_data_list.find(
              (sd) => sd.rotation !== undefined
            );
            if (dispMatrix) {
              // Display matrix rotation in ffprobe is negative for CW, normalize to 0/90/180/270
              sourceRotation = (((-Math.round(Number(dispMatrix.rotation))) % 360) + 360) % 360;
            }
          }

          const rawW = videoStream.width || 0;
          const rawH = videoStream.height || 0;
          const isRotatedSideways = sourceRotation === 90 || sourceRotation === 270;
          // FFmpeg auto-rotates based on displaymatrix before -vf filters run, so effective dimensions are swapped
          const effectiveW = isRotatedSideways ? rawH : rawW;
          const effectiveH = isRotatedSideways ? rawW : rawH;

          // Detect VR / 360° Spherical & Stereoscopic 3D Metadata + Aspect Ratio Heuristics
          const sideDataList = Array.isArray(videoStream.side_data_list)
            ? videoStream.side_data_list
            : [];
          const streamTags = { ...(format.tags || {}), ...(videoStream.tags || {}) };
          const tagString = JSON.stringify(streamTags).toLowerCase();
          const fileBaseName = path.basename(filePath).toLowerCase();

          let isVr360 = false;
          let projection = 'none';
          let stereoMode = 'mono';
          let confidence = 'low';
          const reasons = [];

          // 1. Check FFprobe Spherical Mapping side_data
          const sphericalSd = sideDataList.find(
            (sd) =>
              (sd.side_data_type && sd.side_data_type.toLowerCase().includes('spherical')) ||
              sd.projection !== undefined
          );
          if (sphericalSd) {
            isVr360 = true;
            confidence = 'high';
            const projRaw = String(sphericalSd.projection || 'equirectangular').toLowerCase();
            if (projRaw.includes('cubemap')) projection = 'cubemap';
            else if (projRaw.includes('half') || projRaw.includes('tilted'))
              projection = 'hequirectangular';
            else projection = 'equirectangular';
            reasons.push(`Spherical metadata (${sphericalSd.projection || 'equirectangular'})`);
          }

          // 2. Check FFprobe Stereo3D side_data or Matroska/MP4 stereo_mode tags
          const stereoSd = sideDataList.find(
            (sd) =>
              (sd.side_data_type && sd.side_data_type.toLowerCase().includes('stereo')) ||
              sd.type === 'side by side' ||
              sd.type === 'top and bottom'
          );
          if (stereoSd) {
            isVr360 = true;
            confidence = 'high';
            const stType = String(stereoSd.type || '').toLowerCase();
            if (stType.includes('side')) stereoMode = 'sbs';
            else if (stType.includes('top') || stType.includes('bottom')) stereoMode = 'tb';
            reasons.push(`Stereo3D metadata (${stereoSd.type})`);
          }

          // 3. Check container/stream tags & filename markers (GSpherical, ProjectionType, VR180, 360, SBS, TB)
          if (
            tagString.includes('spherical') ||
            tagString.includes('equirectangular') ||
            fileBaseName.includes('360') ||
            fileBaseName.includes('vr180') ||
            fileBaseName.includes('_vr')
          ) {
            isVr360 = true;
            if (confidence === 'low') confidence = 'high';
            if (projection === 'none') {
              projection = fileBaseName.includes('180') ? 'hequirectangular' : 'equirectangular';
            }
            reasons.push('VR/360 stream tag or filename signature');
          }

          if (
            tagString.includes('side_by_side') ||
            tagString.includes('left_right') ||
            fileBaseName.includes('sbs') ||
            fileBaseName.includes('lr')
          ) {
            stereoMode = 'sbs';
          } else if (
            tagString.includes('top_bottom') ||
            fileBaseName.includes('_tb') ||
            fileBaseName.includes('ou')
          ) {
            stereoMode = 'tb';
          }

          // 4. Aspect Ratio Heuristics:
          // - Exact 2:1 (e.g. 3840x1920, 4096x2048, 5760x2880, 7680x3840) is standard 360° Equirectangular (or VR180 SBS)
          // - Exact 1:1 (e.g. 2048x2048, 3840x3840, 4096x4096) is standard 360° Top-Bottom Stereo
          // - Exact 32:9 (e.g. 3840x1080) is Full SBS 3D
          if (effectiveW > 0 && effectiveH > 0) {
            const ar = effectiveW / effectiveH;
            if (Math.abs(ar - 2.0) < 0.02) {
              isVr360 = true;
              if (projection === 'none') projection = 'equirectangular';
              if (confidence === 'low') confidence = 'medium';
              reasons.push(`2:1 Equirectangular aspect ratio (${effectiveW}×${effectiveH})`);
            } else if (Math.abs(ar - 1.0) < 0.02 && effectiveW >= 1920) {
              isVr360 = true;
              if (projection === 'none') projection = 'equirectangular';
              if (stereoMode === 'mono') stereoMode = 'tb';
              if (confidence === 'low') confidence = 'medium';
              reasons.push(`1:1 Top-Bottom 360° Stereo aspect ratio (${effectiveW}×${effectiveH})`);
            } else if (Math.abs(ar - 32 / 9) < 0.03) {
              isVr360 = true;
              if (stereoMode === 'mono') stereoMode = 'sbs';
              if (projection === 'none') projection = 'hequirectangular';
              if (confidence === 'low') confidence = 'medium';
              reasons.push(`32:9 Side-by-Side Stereo aspect ratio (${effectiveW}×${effectiveH})`);
            }
          }

          const vr360 = {
            isVr360,
            projection,
            stereoMode,
            confidence,
            reason:
              reasons.length > 0
                ? reasons.join(' • ')
                : 'Standard flat rectilinear video stream',
          };

          resolve({
            width: effectiveW,
            height: effectiveH,
            rawWidth: rawW,
            rawHeight: rawH,
            sourceRotation,
            vr360,
            codec: videoStream.codec_name || 'unknown',
            codecLong: videoStream.codec_long_name || '',
            profile: videoStream.profile || '',
            pixFmt: videoStream.pix_fmt || 'yuv420p',
            colorSpace: videoStream.color_space || 'bt709',
            fps,
            duration,
            sizeBytes,
            bitRate,
            displayAspectRatio:
              isRotatedSideways && videoStream.display_aspect_ratio
                ? videoStream.display_aspect_ratio.split(':').reverse().join(':')
                : videoStream.display_aspect_ratio || `${effectiveW}:${effectiveH}`,
            hasAudio: Boolean(audioStream),
            audioCodec: audioStream ? audioStream.codec_name : null,
            audioChannels: audioStream ? audioStream.channels : null,
            audioSampleRate: audioStream ? audioStream.sample_rate : null,
            formatName: format.format_name || 'mp4',
          });
        } catch (parseErr) {
          reject(parseErr);
        }
      }
    );
  });
}

/**
 * Ensure dimensions are even integers (required by yuv420p / H.264 / H.265)
 */
function toEven(num) {
  const n = Math.max(2, Math.round(Number(num) || 2));
  return n % 2 === 0 ? n : n + 1;
}

/**
 * Multi-frame static watermark / logo detector.
 * Samples up to 6 frames across the video duration in grayscale at 320x180,
 * computes pixel-wise temporal stability & spatial edge contrast in typical logo zones,
 * and returns normalized bounding boxes (xPct, yPct, wPct, hPct).
 */
async function detectWatermarksInVideo(filePath, metadata) {
  const duration = Math.max(0.5, Number(metadata.duration) || 4);
  const sampleCount = 6;
  const W = 320;
  const H = 180;
  const frameSize = W * H;

  return new Promise((resolve) => {
    const fpsFilter = `fps=${Math.max(0.5, (sampleCount / duration).toFixed(3))}`;
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-vf',
      `${fpsFilter},scale=${W}:${H}:flags=bilinear,format=gray`,
      '-frames:v',
      String(sampleCount),
      '-f',
      'rawvideo',
      'pipe:1',
    ];

    const child = spawn('ffmpeg', args);
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      const buf = Buffer.concat(chunks);
      const numFrames = Math.floor(buf.length / frameSize);
      if (numFrames < 1) {
        return resolve([]);
      }

      // Compute pixel-wise mean intensity, temporal variance, and horizontal/vertical Sobel edge gradient
      const mean = new Float32Array(frameSize);
      const variance = new Float32Array(frameSize);

      for (let f = 0; f < numFrames; f++) {
        const offset = f * frameSize;
        for (let i = 0; i < frameSize; i++) {
          mean[i] += buf[offset + i];
        }
      }
      for (let i = 0; i < frameSize; i++) {
        mean[i] /= numFrames;
      }

      if (numFrames > 1) {
        for (let f = 0; f < numFrames; f++) {
          const offset = f * frameSize;
          for (let i = 0; i < frameSize; i++) {
            const diff = buf[offset + i] - mean[i];
            variance[i] += diff * diff;
          }
        }
        for (let i = 0; i < frameSize; i++) {
          variance[i] = Math.sqrt(variance[i] / numFrames);
        }
      }

      // Compute static high-contrast edge score per pixel (watermarks have high edge gradient + low temporal variance)
      const scoreMap = new Float32Array(frameSize);
      for (let y = 2; y < H - 2; y++) {
        for (let x = 2; x < W - 2; x++) {
          const idx = y * W + x;
          const gx = Math.abs(mean[idx + 1] - mean[idx - 1]);
          const gy = Math.abs(mean[idx + W] - mean[idx - W]);
          const grad = gx + gy;
          if (grad > 22) {
            // Static score rewards high spatial edge contrast and penalizes high temporal motion variance
            const temporalPenalty = numFrames > 1 ? 1 / (1 + variance[idx] * 0.15) : 1;
            scoreMap[idx] = grad * temporalPenalty;
          }
        }
      }

      // Evaluate candidate corner/edge sectors where watermarks typically reside
      const sectors = [
        { name: 'Bottom-Right Logo', x0: Math.floor(W * 0.62), y0: Math.floor(H * 0.68), x1: W - 3, y1: H - 3 },
        { name: 'Top-Right Logo', x0: Math.floor(W * 0.62), y0: 3, x1: W - 3, y1: Math.floor(H * 0.32) },
        { name: 'Bottom-Left Logo', x0: 3, y0: Math.floor(H * 0.68), x1: Math.floor(W * 0.38), y1: H - 3 },
        { name: 'Top-Left Logo', x0: 3, y0: 3, x1: Math.floor(W * 0.38), y1: Math.floor(H * 0.32) },
      ];

      const candidates = [];

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
          // Pad bounding box slightly for clean delogo interpolation
          const padX = 4;
          const padY = 3;
          const bx0 = Math.max(1, minX - padX);
          const by0 = Math.max(1, minY - padY);
          const bx1 = Math.min(W - 2, maxX + padX);
          const by1 = Math.min(H - 2, maxY + padY);

          // Avoid selecting the entire corner sector if full-frame texture is noisy
          const boxArea = (bx1 - bx0) * (by1 - by0);
          const sectorArea = (sec.x1 - sec.x0) * (sec.y1 - sec.y0);
          const density = activePixels / Math.max(1, boxArea);

          if (boxArea <= sectorArea * 0.85 && density > 0.08) {
            candidates.push({
              id: crypto.randomUUID().slice(0, 8),
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

      // Return top detected region (or fallback bottom-right suggestion if none exceeded threshold)
      if (candidates.length > 0) {
        resolve(candidates.slice(0, 2).map(({ score: _s, ...rest }) => rest));
      } else {
        resolve([
          {
            id: crypto.randomUUID().slice(0, 8),
            label: 'Bottom-Right Corner (Default)',
            xPct: 0.76,
            yPct: 0.82,
            wPct: 0.20,
            hPct: 0.12,
            confidence: 60,
          },
        ]);
      }
    });
  });
}

/**
 * Build the -vf video filter array for both full rendering and live single-frame preview
 */
function buildVfFilterList(config = {}, sourceMeta = null, options = { previewCapWidth: 0 }) {
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

  // When rendering a fast live preview frame, cap the preview bounding box so 4K/7200px renders in <80ms
  // while preserving the exact target aspect ratio and filter chain!
  if (options.previewCapWidth && targetW > options.previewCapWidth) {
    const ratio = options.previewCapWidth / targetW;
    targetW = toEven(options.previewCapWidth);
    targetH = toEven(targetH * ratio);
  }

  const flags = `flags=${scaleAlgorithm}+accurate_rnd+full_chroma_int`;
  const vfFilters = [];

  // 0. VR / 360° & Stereo3D Normalization (unwraps spherical 360°/180° & extracts 2D eye view into standard flat rectilinear video)
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

  // 0a. Watermark / Logo Removal (applied on the original source frame before rotation & upscaling)
  if (watermarkEnabled && Array.isArray(watermarkBoxes) && watermarkBoxes.length > 0) {
    const srcW = Number(sourceMeta?.width || config?.sourceWidth) || 1920;
    const srcH = Number(sourceMeta?.height || config?.sourceHeight) || 1080;

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

  // 0b. Rotation & Flip filters (applied before scaling to target frame)
  const rot = Number(rotation) || 0;
  if (rot === 90) {
    vfFilters.push('transpose=1');
  } else if (rot === 180) {
    vfFilters.push('hflip', 'vflip');
  } else if (rot === 270) {
    vfFilters.push('transpose=2');
  }

  if (flipHorizontal) {
    vfFilters.push('hflip');
  }
  if (flipVertical) {
    vfFilters.push('vflip');
  }

  // 1. Optional Deinterlacing (bwdif) & Pre-Denoise filter before upscaling
  if (deinterlaceEnabled) {
    vfFilters.push('bwdif=mode=send_frame:parity=auto:deint=all');
  }

  if (denoise === 'light') {
    vfFilters.push('hqdn3d=1.5:1.5:3:3');
  } else if (denoise === 'medium') {
    vfFilters.push('hqdn3d=3:3:6:6');
  } else if (denoise === 'nlmeans') {
    // Non-local means denoiser (use fast atadenoise in live preview for instant response)
    vfFilters.push(options.previewCapWidth ? 'hqdn3d=2.5:2.5:4:4' : 'nlmeans=s=2.0:p=5:r=9');
  }

  if (debandEnabled) {
    vfFilters.push('deband');
  }

  // 2. Resolution scaling & aspect mode (skip if v360 already scaled to targetW x targetH)
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

  // 3. Unsharp mask / detail enhancement for upscaled video
  if (sharpenPreset !== 'none') {
    let lumaAmount = 0.6;
    if (sharpenPreset === 'light') lumaAmount = 0.5;
    else if (sharpenPreset === 'medium') lumaAmount = 1.0;
    else if (sharpenPreset === 'strong') lumaAmount = 1.6;
    else if (sharpenPreset === 'custom')
      lumaAmount = Math.max(0.1, Math.min(3.0, Number(sharpenAmount) || 0.8));

    vfFilters.push(`unsharp=5:5:${lumaAmount.toFixed(2)}:5:5:0.0`);
  }

  // 4. Contrast Adaptive Sharpening (CAS)
  const casVal = Math.max(0, Math.min(1, Number(casStrength) || 0));
  if (casVal > 0.01) {
    vfFilters.push(`cas=${casVal.toFixed(2)}`);
  }

  // 5. Color Grading & Tone Enhancement (eq & vibrance)
  const bVal = Number(brightness) || 0;
  const cVal = Number(contrast) ?? 1;
  const sVal = Number(saturation) ?? 1;
  const gVal = Number(gamma) ?? 1;
  const vVal = Number(vibrance) || 0;

  if (
    Math.abs(bVal) > 0.01 ||
    Math.abs(cVal - 1) > 0.01 ||
    Math.abs(sVal - 1) > 0.01 ||
    Math.abs(gVal - 1) > 0.01
  ) {
    vfFilters.push(
      `eq=brightness=${bVal.toFixed(2)}:contrast=${cVal.toFixed(2)}:saturation=${sVal.toFixed(
        2
      )}:gamma=${gVal.toFixed(2)}`
    );
  }

  if (Math.abs(vVal) > 0.01) {
    vfFilters.push(`vibrance=intensity=${vVal.toFixed(2)}`);
  }

  return vfFilters;
}

/**
 * Build FFmpeg arguments & CLI preview string from user configuration
 */
function buildFfmpegArgs(inputPath, outputPath, config, sourceMeta = null) {
  const {
    codec = 'libx264', // 'libx264', 'libx265', 'h264_videotoolbox', 'hevc_videotoolbox', 'libsvtav1', 'libvpx-vp9'
    rateControl = 'crf', // 'crf' | 'bitrate'
    crf = 18, // 0 - 51
    targetBitrateMbps = 16, // Mbps
    preset = 'medium', // ultrafast, superfast, veryfast, faster, fast, medium, slow, slower
    fps = 'source', // 'source', '24', '30', '60', '120'
    pixelFormat = 'yuv420p', // 'yuv420p', 'yuv420p10le'
    audioMode = 'copy', // 'copy', 'aac_192', 'aac_320', 'mute'
    container = 'mp4', // 'mp4', 'mov', 'mkv', 'webm'
  } = config;

  const vfFilters = buildVfFilterList(config, sourceMeta, { previewCapWidth: 0 });

  const args = ['-y', '-hide_banner', '-i', inputPath];

  // Video filter chain
  if (vfFilters.length > 0) {
    args.push('-vf', vfFilters.join(','));
  }

  // Frame rate override
  if (fps && fps !== 'source') {
    args.push('-r', String(fps));
  }

  // Video codec & encoding settings
  args.push('-c:v', codec);

  const isHardware = codec.includes('videotoolbox');

  if (isHardware) {
    // Apple Silicon VideoToolbox uses -b:v or -q:v
    const mbps = rateControl === 'bitrate' ? Number(targetBitrateMbps) || 20 : Math.max(4, Math.round((36 - Number(crf)) * 1.4));
    args.push('-b:v', `${mbps}M`, '-maxrate', `${Math.round(mbps * 1.4)}M`, '-bufsize', `${Math.round(mbps * 2)}M`);
    if (codec === 'hevc_videotoolbox') {
      args.push('-tag:v', 'hvc1');
    }
  } else if (codec === 'libx264' || codec === 'libx265') {
    args.push('-preset', preset);
    if (rateControl === 'bitrate') {
      const mbps = Number(targetBitrateMbps) || 16;
      args.push('-b:v', `${mbps}M`, '-maxrate', `${Math.round(mbps * 1.4)}M`, '-bufsize', `${Math.round(mbps * 2)}M`);
    } else {
      args.push('-crf', String(crf));
    }
    if (codec === 'libx265') {
      args.push('-tag:v', 'hvc1');
    }
  } else if (codec === 'libsvtav1') {
    args.push('-crf', String(crf), '-preset', '6');
  } else if (codec === 'libvpx-vp9') {
    args.push('-crf', String(crf), '-b:v', '0', '-row-mt', '1');
  }

  // Pixel format
  args.push('-pix_fmt', pixelFormat);

  // Audio settings
  if (audioMode === 'mute') {
    args.push('-an');
  } else if (audioMode === 'aac_192') {
    args.push('-c:a', 'aac', '-b:a', '192k');
  } else if (audioMode === 'aac_320') {
    args.push('-c:a', 'aac', '-b:a', '320k');
  } else if (container === 'webm') {
    args.push('-c:a', 'libopus', '-b:a', '192k');
  } else {
    args.push('-c:a', 'copy');
  }

  // Clear any residual container rotation metadata since pixels are now physically oriented
  args.push('-metadata:s:v:0', 'rotate=0');

  // Faststart for MP4/MOV web streaming
  if (container === 'mp4' || container === 'mov') {
    args.push('-movflags', '+faststart');
  }

  // Progress output to stdout for real-time parsing
  args.push('-progress', 'pipe:1', '-nostats', outputPath);

  return args;
}

/**
 * GET /api/system-info
 * Returns FFmpeg version & available hardware/software encoders
 */
app.get('/api/system-info', (_req, res) => {
  execFile('ffmpeg', ['-version'], (err, stdout) => {
    if (err) {
      return res.status(500).json({ available: false, error: err.message });
    }
    const firstLine = (stdout.split('\n')[0] || '').trim();
    const hasVideoToolbox = stdout.includes('--enable-videotoolbox');
    const hasX264 = stdout.includes('--enable-libx264');
    const hasX265 = stdout.includes('--enable-libx265');
    const hasSvtAv1 = stdout.includes('--enable-libsvtav1');
    const hasVp9 = stdout.includes('--enable-libvpx');

    res.json({
      available: true,
      version: firstLine,
      capabilities: {
        hasVideoToolbox,
        hasX264,
        hasX265,
        hasSvtAv1,
        hasVp9,
      },
    });
  });
});

/**
 * POST /api/upload
 * Upload a video file and return its ffprobe metadata (cleans up previous uploads & outputs for this browser fingerprint)
 */
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const fp = getRequestFingerprint(req);
    const prevFileId = req.body?.previousFileId;
    const prevJobId = req.body?.previousJobId;

    // Clean up previous video and rendered outputs scoped to this browser fingerprint
    cleanupClientResources({
      fingerprint: fp,
      fileId: prevFileId,
      jobId: prevJobId,
      keepUploadFilename: req.file.filename,
    });

    const filePath = req.file.path;
    const metadata = await probeVideo(filePath);

    res.json({
      fileId: req.file.filename,
      originalName: req.file.originalname,
      fingerprint: fp,
      url: `/uploads/${req.file.filename}`,
      metadata,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to inspect uploaded video' });
  }
});

/**
 * POST /api/cleanup
 * Explicitly cleans up previous uploads, active/completed jobs, and output files for this browser fingerprint
 */
app.post('/api/cleanup', (req, res) => {
  const fp = getRequestFingerprint(req);
  const { fileId, jobId, clearOutputsOnly = false } = req.body || {};
  cleanupClientResources({ fingerprint: fp, fileId, jobId, clearOutputsOnly });
  res.json({ status: 'cleaned', fingerprint: fp });
});

/**
 * POST /api/detect-watermark
 * Scans video frames to automatically detect static corner/edge watermarks and logos
 */
app.post('/api/detect-watermark', async (req, res) => {
  try {
    const { fileId } = req.body || {};
    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }
    const inputPath = path.join(UPLOADS_DIR, path.basename(fileId));
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: 'Source video file not found' });
    }
    const metadata = await probeVideo(inputPath);
    const boxes = await detectWatermarksInVideo(inputPath, metadata);
    res.json({ boxes });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Watermark detection failed' });
  }
});

/**
 * POST /api/generate-sample
 * Generates a crisp 640x360 (360p) synthetic test pattern video with FFmpeg testsrc2
 * AND a simulated corner watermark badge so users can test both watermark detection/removal and upscaling!
 */
app.post('/api/generate-sample', async (req, res) => {
  const fp = getRequestFingerprint(req);
  const prevFileId = req.body?.previousFileId;
  const prevJobId = req.body?.previousJobId;

  const uniqueSuffix = crypto.randomUUID().slice(0, 8);
  const filename = `${fp}_${Date.now()}_${uniqueSuffix}_sample_360p.mp4`;
  const filePath = path.join(UPLOADS_DIR, filename);

  cleanupClientResources({
    fingerprint: fp,
    fileId: prevFileId,
    jobId: prevJobId,
    keepUploadFilename: filename,
  });

  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=5',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=5',
    '-vf',
    'drawbox=x=496:y=302:w=128:h=42:color=white@0.85:t=fill,drawbox=x=502:y=308:w=116:h=30:color=black@0.75:t=2',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    filePath,
  ];

  execFile('ffmpeg', args, async (err) => {
    if (err) {
      return res.status(500).json({ error: `Failed to generate sample video: ${err.message}` });
    }
    try {
      const metadata = await probeVideo(filePath);
      res.json({
        fileId: filename,
        originalName: 'demo_test_pattern_360p.mp4',
        url: `/uploads/${filename}`,
        metadata,
      });
    } catch (probeErr) {
      res.status(500).json({ error: probeErr.message });
    }
  });
});

/**
 * POST /api/live-preview-frame
 * Extracts and filters a single JPEG frame at `timestamp` through the exact active FFmpeg `-vf` filtergraph
 * (`v360`, `delogo`, `transpose`, `hqdn3d`, `scale`, `pad`/`crop`, `unsharp`) and returns it directly as `image/jpeg`.
 */
let activePreviewProc = null;
app.post('/api/live-preview-frame', async (req, res) => {
  try {
    const { fileId, timestamp = 0, config = {}, sourceMeta = null } = req.body || {};
    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const inputPath = path.join(UPLOADS_DIR, path.basename(fileId));
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: 'Source video file not found' });
    }

    // Kill any superseded in-flight preview process so rapid slider dragging stays instant
    if (activePreviewProc) {
      try {
        activePreviewProc.kill('SIGKILL');
      } catch (_e) {
        // ignore
      }
      activePreviewProc = null;
    }

    const meta = sourceMeta || (await probeVideo(inputPath));
    const vfFilters = buildVfFilterList(config, meta, { previewCapWidth: 1280 });
    const seekSec = Math.max(0, Number(timestamp) || 0).toFixed(3);

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      seekSec,
      '-i',
      inputPath,
      ...(vfFilters.length > 0 ? ['-vf', vfFilters.join(',')] : []),
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-f',
      'image2',
      '-c:v',
      'mjpeg',
      'pipe:1',
    ];

    const child = spawn('ffmpeg', args);
    activePreviewProc = child;

    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', (err) => {
      if (activePreviewProc === child) activePreviewProc = null;
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    child.on('close', (code) => {
      if (activePreviewProc === child) activePreviewProc = null;
      if (res.headersSent) return;
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length > 0) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.send(buf);
      } else {
        res.status(500).json({ error: 'Failed to render live preview frame' });
      }
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Live preview error' });
    }
  }
});

/**
 * POST /api/preview-command
 * Returns the exact FFmpeg CLI command string for the current settings
 */
app.post('/api/preview-command', (req, res) => {
  const { fileId = 'input.mp4', config = {}, sourceMeta = null } = req.body || {};
  const ext = config.container || 'mp4';
  const args = buildFfmpegArgs(
    fileId,
    `output_${config.width || 1920}x${config.height || 1080}.${ext}`,
    config,
    sourceMeta
  );
  const filteredArgs = args.filter((a) => a !== '-progress' && a !== 'pipe:1' && a !== '-nostats');
  const command = `ffmpeg ${filteredArgs.map((arg) => (arg.includes(' ') || arg.includes('(') ? `"${arg}"` : arg)).join(' ')}`;
  res.json({ command });
});

/**
 * POST /api/process
 * Starts an asynchronous FFmpeg upscaling/transcoding job
 */
app.post('/api/process', async (req, res) => {
  try {
    const { fileId, config } = req.body;
    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const inputPath = path.join(UPLOADS_DIR, path.basename(fileId));
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: 'Source video file not found on server' });
    }

    const fp = getRequestFingerprint(req);

    // Clean up any previous rendered outputs for this browser fingerprint (keep current input file)
    cleanupClientResources({
      fingerprint: fp,
      keepUploadFilename: path.basename(fileId),
      clearOutputsOnly: true,
    });

    const sourceMeta = await probeVideo(inputPath);
    const ext = config?.container || 'mp4';
    const jobId = crypto.randomUUID();
    const shortId = jobId.slice(0, 8);
    const outputFilename = `${fp}_upscaled_${config.width}x${config.height}_${Date.now()}_${shortId}.${ext}`;
    const outputPath = path.join(OUTPUTS_DIR, outputFilename);

    const args = buildFfmpegArgs(inputPath, outputPath, config, sourceMeta);
    const cliPreview = `ffmpeg ${args
      .filter((a) => a !== '-progress' && a !== 'pipe:1' && a !== '-nostats')
      .map((a) => (a.includes(' ') || a.includes('(') ? `"${a}"` : a))
      .join(' ')}`;

    const child = spawn('ffmpeg', args);

    const jobState = {
      jobId,
      fingerprint: fp,
      sourceFileId: path.basename(fileId),
      status: 'processing',
      progress: 0,
      fps: 0,
      speed: '0x',
      bitrate: '',
      currentTimeSec: 0,
      totalDurationSec: sourceMeta.duration || 1,
      command: cliPreview,
      startedAt: Date.now(),
      completedAt: null,
      outputUrl: null,
      outputFilename,
      outputMetadata: null,
      error: null,
      logs: [],
      process: child,
    };

    jobs.set(jobId, jobState);

    let stdoutBuffer = '';
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const [key, val] = line.trim().split('=');
        if (!key || val === undefined) continue;

        if (key === 'out_time_us' || key === 'out_time_ms') {
          const us = parseInt(val, 10);
          if (!Number.isNaN(us) && us >= 0) {
            const sec = us / 1_000_000;
            jobState.currentTimeSec = sec;
            if (jobState.totalDurationSec > 0) {
              jobState.progress = Math.min(99, Math.round((sec / jobState.totalDurationSec) * 100));
            }
          }
        } else if (key === 'fps') {
          jobState.fps = parseFloat(val) || 0;
        } else if (key === 'speed') {
          jobState.speed = val.trim();
        } else if (key === 'bitrate') {
          jobState.bitrate = val.trim();
        } else if (key === 'progress' && val.trim() === 'end') {
          jobState.progress = 100;
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        jobState.logs.push(text);
        if (jobState.logs.length > 60) jobState.logs.shift();
      }
    });

    child.on('close', async (code) => {
      jobState.process = null;
      if (code === 0 && fs.existsSync(outputPath)) {
        try {
          const outMeta = await probeVideo(outputPath);
          jobState.outputMetadata = outMeta;
        } catch (_e) {
          // ignore probe error if any
        }
        jobState.status = 'completed';
        jobState.progress = 100;
        jobState.completedAt = Date.now();
        jobState.outputUrl = `/outputs/${outputFilename}`;
      } else if (jobState.status !== 'cancelled') {
        jobState.status = 'failed';
        jobState.error = jobState.logs.slice(-4).join('\n') || `FFmpeg exited with code ${code}`;
      }
    });

    res.json({
      jobId,
      status: 'processing',
      command: cliPreview,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to start FFmpeg job' });
  }
});

/**
 * GET /api/jobs/:jobId
 * Returns current job progress or final output metadata
 */
app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { process: _proc, ...safeJob } = job;
  res.json(safeJob);
});

/**
 * POST /api/jobs/:jobId/cancel
 * Cancels an active FFmpeg process
 */
app.post('/api/jobs/:jobId/cancel', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.process) {
    job.status = 'cancelled';
    job.process.kill('SIGTERM');
  }
  res.json({ status: job.status });
});

// Serve built React SPA in single-app / Docker mode
if (fs.existsSync(DIST_DIR)) {
  app.get('/favicon.ico', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'favicon.svg'), {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' },
    });
  });
  app.use(express.static(DIST_DIR));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/outputs')) {
      return next();
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FFmpeg Upscaler Single App running at http://localhost:${PORT}`);
});
