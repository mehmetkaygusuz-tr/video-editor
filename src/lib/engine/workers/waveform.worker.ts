/// <reference lib="webworker" />
export {};

let ctx: OffscreenCanvasRenderingContext2D | null = null;
let canvas: OffscreenCanvas | null = null;
let currentPeaks: Float32Array | null = null;
let currentTotalDuration: number = 0;
let currentSourceOffset: number = 0;
let currentDuration: number = 0;

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    canvas = payload.offscreen as OffscreenCanvas;
    ctx = canvas.getContext('2d');
  } 
  else if (type === 'update_data') {
    currentPeaks = payload.peaks;
    currentTotalDuration = payload.totalDuration;
  }
  else if (type === 'draw') {
    if (!ctx || !canvas || !currentPeaks) return;
    
    currentSourceOffset = payload.sourceOffset;
    currentDuration = payload.duration;
    const width = payload.width;
    const height = payload.height;
    const dpr = payload.dpr;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const peaksPerSecond = currentPeaks.length / (currentTotalDuration || 60);
    const startPeak = Math.floor(currentSourceOffset * peaksPerSecond);
    const endPeak = Math.ceil((currentSourceOffset + currentDuration) * peaksPerSecond);
    
    // Safety check boundaries
    const safeStart = Math.max(0, startPeak);
    const safeEnd = Math.min(currentPeaks.length, endPeak);
    
    const visiblePeaks = currentPeaks.slice(safeStart, safeEnd);
    
    if (visiblePeaks.length > 0) {
      const step = width / visiblePeaks.length;
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      
      for (let i = 0; i < visiblePeaks.length; i++) {
         const x = i * step;
         const h = visiblePeaks[i] * height;
         const y = (height - h) / 2;
         ctx.fillRect(x, y, step - 0.5, h);
      }
    }
    
    ctx.restore();
  }
};
