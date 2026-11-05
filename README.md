# FrameScale Studio — FFmpeg Video Upscaler & Resolution Editor

**FrameScale Studio** is a full-stack React + Node.js/Express video processing application powered by native **FFmpeg** and **FFprobe**. It lets you inspect video streams, remove watermarks, rotate/flip orientation, and upscale or transcode video frames to **720p HD**, **1080p Full HD**, **2K QHD (1440p)**, **4K UHD (2160p)**, **7200px (8K-class)**, or any custom `Width × Height` resolution.

---

## ✨ Key Features

- **Resolution Presets & Custom Dimensions**
  - One-click presets for **720p** (`1280×720`), **1080p** (`1920×1080`), **2K QHD** (`2560×1440`), **4K UHD** (`3840×2160`), **7200px Ultra-Wide** (`7200×4050`), and arbitrary custom `W × H` (automatically aligned to even pixel boundaries for YUV420p compatibility).
- **Advanced FFmpeg Swscale & Detail Filters**
  - **Scaling Kernels**: `lanczos` (`accurate_rnd+full_chroma_int`), `spline`, `bicubic`, `bilinear`, and `neighbor` (pixel-art).
  - **Unsharp Mask Sharpening**: Light, Medium, Strong, or custom luma sharpening (`0.1× – 2.5×`) to restore crisp edge definition after upscaling.
  - **Pre-Denoising**: Optional `hqdn3d` spatial-temporal denoise filter to clean compression artifacts before upscaling.
- **Watermark Detection & Removal (`delogo`)**
  - **Auto-Detect Watermark**: Multi-frame temporal variance + Sobel spatial edge scanner automatically locates static corner/edge logos and badges.
  - **Interactive Bounding-Box Canvas**: Draw custom removal zones directly over the video preview or add quick corner presets (`Top-Left`, `Top-Right`, `Bottom-Left`, `Bottom-Right`).
  - **Single & Multi-Pass Inpainting**: Supports standard `delogo` boundary interpolation and deep multi-pass smoothing.
- **Video Rotation, Orientation & Aspect Ratio Modes**
  - Rotate `0°`, `90° CW`, `180°`, `270° CCW`, plus **Horizontal Mirror** (`hflip`) and **Vertical Flip** (`vflip`).
  - Automatically reads mobile `displaymatrix` / `rotate` metadata tags, swaps target portrait/landscape dimensions on `90°`/`270°` rotation, and resets container rotation metadata (`rotate=0`) on output.
  - **Framing Modes**: `Fit (Keep Aspect Ratio)`, `Letterbox / Pillarbox Pad`, `Center Crop to Fill`, and `Exact Stretch`.
- **MP4, HEVC, AV1, VP9 & Apple Silicon GPU Hardware Encoding**
  - **Codecs**: `libx264` (H.264), `libx265` (HEVC with `hvc1` tag), `h264_videotoolbox` & `hevc_videotoolbox` (macOS Apple Silicon GPU acceleration), `libsvtav1` (AV1), and `libvpx-vp9` (WebM).
  - **Rate Control**: Constant Rate Factor (`CRF`) or Target Video Bitrate (`Mbps`), custom frame rate (`Source`, `24`, `30`, `60`, `120` fps), `8-bit yuv420p` / `10-bit yuv420p10le`, and audio stream copy / AAC transcoding / mute.
- **Interactive Before/After Video Inspector**
  - Synchronized video playback with **Split-Wipe Slider**, **Side-by-Side**, and **Upscaled Only** comparison modes.
- **Browser Fingerprint Isolation & Auto-Cleanup**
  - Generates a deterministic client fingerprint (`x-browser-fingerprint`) to namespace uploaded and rendered filenames, prevent filename collisions, and automatically clean up previous uploads and outputs when switching videos.

---

## 🚀 Quick Start

### Option 1: Run as a Single App with Docker Compose (Recommended)

The included multi-stage [`Dockerfile`](./Dockerfile) and [`docker-compose.yml`](./docker-compose.yml) bundle the React frontend, Node/Express API, and native `ffmpeg` into a single container on port `3001`.

```bash
docker compose up --build -d
```

Open **http://localhost:3001** in your browser.

To stop the container:
```bash
docker compose down
```

---

### Option 2: Run Locally (Node.js + Native FFmpeg)

#### Prerequisites
- **Node.js** `v20+` (or `v22+` / `v24+`)
- **FFmpeg & FFprobe** installed on your system `PATH`:
  - **macOS**: `brew install ffmpeg`
  - **Ubuntu/Debian**: `sudo apt-get install ffmpeg`
  - **Windows**: `winget install Gyan.FFmpeg`

#### Install & Run Development Mode
```bash
npm install
npm run dev
```
- **Frontend UI (Vite)**: http://localhost:5173
- **Backend API (Express)**: http://localhost:3001

#### Build & Run Unified Single-Port Production Server Locally
```bash
npm run build
npm start
```
Then open **http://localhost:3001**.

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/system-info` | Returns installed FFmpeg version and available codec capabilities (`libx264`, `libx265`, `videotoolbox`, `libsvtav1`, `libvpx-vp9`). |
| `POST` | `/api/upload` | Uploads a video file (`multipart/form-data`), cleans up previous files for the browser fingerprint, and returns `ffprobe` stream metadata. |
| `POST` | `/api/generate-sample` | Generates a 5-second `640×360` (`360p`) synthetic test video with a sample corner watermark for instant testing. |
| `POST` | `/api/detect-watermark` | Scans frames across the video duration to detect static corner/edge watermarks and returns normalized bounding boxes. |
| `POST` | `/api/preview-command` | Returns the exact `ffmpeg` CLI command string for the active configuration. |
| `POST` | `/api/process` | Spawns an asynchronous FFmpeg job with live progress tracking (`-progress pipe:1`). |
| `GET` | `/api/jobs/:jobId` | Polls real-time encoding progress (`%`, `fps`, `speed`, `bitrate`, and final output metadata). |
| `POST` | `/api/jobs/:jobId/cancel` | Cancels an active FFmpeg job (`SIGTERM`). |
| `POST` | `/api/cleanup` | Cleans up uploaded and rendered files scoped to the caller's `x-browser-fingerprint`. |

---

## 📁 Project Structure

```text
convertor/
├── Dockerfile                        # Multi-stage single-app Docker build (Node 22 + FFmpeg)
├── docker-compose.yml                # Single-container compose service on port 3001
├── index.html                        # App entry HTML
├── package.json                      # Scripts & dependencies
├── public/
│   └── favicon.svg                   # Custom FrameScale Studio vector icon
├── server/
│   └── index.js                      # Express API, ffprobe inspector, watermark detector & FFmpeg runner
└── src/
    ├── App.tsx                       # Main studio UI & configuration controls
    ├── main.tsx                      # React root mount
    ├── index.css                     # Tailwind CSS v4 styles
    ├── types.ts                      # TypeScript interfaces
    ├── components/
    │   └── VideoComparePlayer.tsx    # Split-wipe slider, side-by-side player & watermark box drawer
    └── utils/
        └── fingerprint.ts            # Deterministic browser fingerprint generator
```

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.
