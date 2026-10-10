import type { TimelineMemory } from './TimelineMemory';

export class TimelineRenderer {
  canvas: HTMLCanvasElement;
  memory: TimelineMemory;
  worker: Worker | null = null;
  
  dpr: number = 1;
  logicalWidth: number = 0;
  logicalHeight: number = 0;
  hasTransferredControl = false;
  isSharedMemory = false;
  syncRafId = 0;

  constructor(canvas: HTMLCanvasElement, memory: TimelineMemory) {
    this.canvas = canvas;
    this.memory = memory;
    this.isSharedMemory = typeof SharedArrayBuffer !== 'undefined' && memory.buffer instanceof SharedArrayBuffer;
    
    this.handleWindowResize = this.handleWindowResize.bind(this);
    this.resize = this.resize.bind(this);
    this.syncLoop = this.syncLoop.bind(this);
    
    window.addEventListener('resize', this.handleWindowResize);
    
    // Initialize Web Worker for OffscreenCanvas rendering
    try {
      this.worker = new Worker(new URL('../workers/timeline.worker.ts', import.meta.url), { type: 'module' });
      const offscreen = this.canvas.transferControlToOffscreen();
      
      // If not shared memory, we will send a copy initially, then sync on raf
      this.worker.postMessage({ 
        type: 'init', 
        payload: { 
          offscreen, 
          buffer: this.isSharedMemory ? this.memory.buffer : this.memory.buffer.slice(0)
        } 
      }, [offscreen]);
      this.hasTransferredControl = true;
      
      if (!this.isSharedMemory) {
        this.syncLoop();
      }
    } catch(e) {
      console.warn("OffscreenCanvas worker initialization failed:", e);
    }
  }

  syncLoop() {
    if (this.worker && !this.isSharedMemory) {
      // Create a fast copy of the buffer to send to worker
      const copy = this.memory.buffer.slice(0);
      this.worker.postMessage({ type: 'sync', payload: { buffer: copy } });
      this.syncRafId = requestAnimationFrame(this.syncLoop);
    }
  }

  handleWindowResize() {
    this.resize();
  }

  resize(width?: number, height?: number) {
    this.logicalWidth = Math.floor(width || this.canvas.parentElement?.clientWidth || 1000);
    this.logicalHeight = Math.floor(height || this.canvas.parentElement?.clientHeight || 400);
    
    this.dpr = window.devicePixelRatio || 1;
    
    if (this.worker && this.hasTransferredControl) {
      this.worker.postMessage({
        type: 'resize',
        payload: {
          width: this.logicalWidth,
          height: this.logicalHeight,
          dpr: this.dpr
        }
      });
    } else if (!this.hasTransferredControl) {
      this.canvas.width = Math.floor(this.logicalWidth * this.dpr);
      this.canvas.height = Math.floor(this.logicalHeight * this.dpr);
      this.canvas.style.width = `${this.logicalWidth}px`;
      this.canvas.style.height = `${this.logicalHeight}px`;
    }
  }

  start() {}

  stop() {
    if (this.syncRafId) {
      cancelAnimationFrame(this.syncRafId);
      this.syncRafId = 0;
    }
    if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
      this.worker.terminate();
      this.worker = null;
    }
    window.removeEventListener('resize', this.handleWindowResize);
  }
}
