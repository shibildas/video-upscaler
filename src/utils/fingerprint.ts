/**
 * Generates and caches a deterministic Browser Fingerprint ID (16-char hex)
 * using Canvas rendering, WebGL renderer metadata, screen geometry, hardware
 * concurrency, timezone, language, and a persistent client salt.
 */

const STORAGE_KEY = 'framescale_browser_fp_v1';

async function sha256Hex(input: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const buf = new TextEncoder().encode(input);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buf);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback FNV-1a 64-bit style hash if crypto.subtle is unavailable (e.g. non-HTTPS LAN)
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0, ch; i < input.length; i++) {
    ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function getCanvasSignal(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-canvas';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(10, 10, 100, 30);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '15px monospace';
    ctx.fillText('FrameScale-FP-4K', 16, 32);
    return canvas.toDataURL().slice(-64);
  } catch {
    return 'canvas-err';
  }
}

function getWebGLSignal(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) return 'no-webgl';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'webgl-basic';
    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
    return `${vendor}::${renderer}`;
  } catch {
    return 'webgl-err';
  }
}

export async function getBrowserFingerprint(): Promise<string> {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached && /^[a-f0-9]{16}$/.test(cached)) {
      return cached;
    }
  } catch {
    // ignore storage errors
  }

  const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator);
  const scr = typeof screen !== 'undefined' ? screen : ({} as Screen);

  const components = [
    nav.userAgent || '',
    nav.language || '',
    (nav.languages || []).join(','),
    String(nav.hardwareConcurrency || 0),
    String((nav as any).deviceMemory || 0),
    String(nav.maxTouchPoints || 0),
    `${scr.width || 0}x${scr.height || 0}x${scr.colorDepth || 0}`,
    String(window.devicePixelRatio || 1),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    getCanvasSignal(),
    getWebGLSignal(),
  ];

  const fullHash = await sha256Hex(components.join('|'));
  const fp = fullHash.slice(0, 16);

  try {
    localStorage.setItem(STORAGE_KEY, fp);
  } catch {
    // ignore storage errors
  }

  return fp;
}
