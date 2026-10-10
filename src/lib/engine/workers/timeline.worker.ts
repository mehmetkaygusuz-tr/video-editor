/// <reference lib="webworker" />
export {};

let ctx: OffscreenCanvasRenderingContext2D | null = null;
let canvas: OffscreenCanvas | null = null;
let buffer: ArrayBuffer | SharedArrayBuffer | null = null;
let f32: Float32Array | null = null;
let i32: Int32Array | null = null;
let rafId = 0;
let logicalWidth = 1000;
let logicalHeight = 400;
let dpr = 1;

const MEMORY_STRUCT = {
  PLAYHEAD: 0,
  ZOOM: 1,
  SCROLL_X: 2,
  SCROLL_Y: 3,
  DURATION: 4,
  IS_PLAYING: 5,
  CLIP_COUNT: 6,
  HEADER_SIZE: 10,
  CLIP_BLOCK_SIZE: 10
};

function render() {
  if (!ctx || !canvas || !f32 || !i32) {
    rafId = requestAnimationFrame(render);
    return;
  }

  if (logicalWidth <= 0 || logicalHeight <= 0) {
    rafId = requestAnimationFrame(render);
    return;
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  
  // Clear canvas
  ctx.clearRect(0, 0, logicalWidth, logicalHeight);
  
  const TRACK_HEIGHT = 56;
  const RULER_HEIGHT = 28;
  
  const zoom = f32[MEMORY_STRUCT.ZOOM];
  const scrollX = f32[MEMORY_STRUCT.SCROLL_X];
  const scrollY = f32[MEMORY_STRUCT.SCROLL_Y];
  const clipCount = i32[MEMORY_STRUCT.CLIP_COUNT];
  
  const viewStartSec = zoom > 0 ? scrollX / zoom : 0;
  const viewEndSec = zoom > 0 ? (scrollX + logicalWidth) / zoom : 1000;
  
  for (let i = 0; i < clipCount; i++) {
    const offset = MEMORY_STRUCT.HEADER_SIZE + (i * MEMORY_STRUCT.CLIP_BLOCK_SIZE);
    
    // Minimal read to check culling
    const startAt = f32[offset + 2];
    const duration = f32[offset + 3];
    
    // Culling
    if (startAt > viewEndSec || (startAt + duration) < viewStartSec) {
      continue;
    }
    
    const trackIdx = i32[offset + 1];
    const colorInt = i32[offset + 5];
    
    const x = (startAt * zoom) - scrollX;
    const width = duration * zoom;
    
    const y = RULER_HEIGHT + (trackIdx * TRACK_HEIGHT) - scrollY + 6;
    const height = TRACK_HEIGHT - 12; // bottom-1.5 => 12px padding
    
    // Only background, no text
    ctx.fillStyle = '#' + colorInt.toString(16).padStart(6, '0');
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, width, height, 4);
    } else {
      ctx.rect(x, y, width, height);
    }
    ctx.fill();
  }
  
  ctx.restore();
  rafId = requestAnimationFrame(render);
}

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    canvas = payload.offscreen as OffscreenCanvas;
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    buffer = payload.buffer;
    f32 = new Float32Array(buffer as ArrayBuffer);
    i32 = new Int32Array(buffer as ArrayBuffer);
    
    if (!rafId) {
      render();
    }
  } 
  else if (type === 'sync') {
    // When SharedArrayBuffer is not available, we receive a copied buffer on every frame
    buffer = payload.buffer;
    f32 = new Float32Array(buffer as ArrayBuffer);
    i32 = new Int32Array(buffer as ArrayBuffer);
  }
  else if (type === 'resize') {
    logicalWidth = payload.width;
    logicalHeight = payload.height;
    dpr = payload.dpr || 1;
    
    if (canvas) {
      canvas.width = logicalWidth * dpr;
      canvas.height = logicalHeight * dpr;
    }
  }
  else if (type === 'stop') {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }
};
