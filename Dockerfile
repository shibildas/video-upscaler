# Stage 1: Build React Frontend
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src

RUN npm run build

# Stage 2: Single-App Production Runtime with FFmpeg
FROM node:22-bookworm-slim

# Install FFmpeg (includes libx264, libx265, libsvtav1, libvpx-vp9, aac, libopus, ffprobe)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Copy backend server and built React frontend
COPY server ./server
COPY --from=builder /app/dist ./dist

# Create persistent directories for uploaded and upscaled videos
RUN mkdir -p /app/uploads /app/outputs

EXPOSE 3001

CMD ["node", "server/index.js"]
