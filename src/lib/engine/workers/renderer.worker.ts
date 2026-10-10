import type { TimelineClip } from '../../types';
import { WebGPURenderer } from '../WebGPURenderer';

let offscreenCanvas: OffscreenCanvas | null = null;
let webgpuRenderer: WebGPURenderer | null = null;
let ctx2d: OffscreenCanvasRenderingContext2D | null = null;
let isWebGPUReady = false;

self.onmessage = async (e: MessageEvent) => {
  const { type, taskId, payload } = e.data;

  // 1. WebGPU / Offscreen Canvas Initialization
  if (type === 'init_webgpu') {
    try {
      offscreenCanvas = payload.canvas as OffscreenCanvas;
      if (offscreenCanvas) {
        let gpuSuccess = false;
        try {
          webgpuRenderer = new WebGPURenderer(offscreenCanvas);
          gpuSuccess = await webgpuRenderer.init();
        } catch (e) {
          console.warn('[RendererWorker] WebGPU init exception:', e);
          gpuSuccess = false;
        }

        if (gpuSuccess && webgpuRenderer?.isReady()) {
          isWebGPUReady = true;
          console.log('[RendererWorker] WebGPU pipeline initialized with zero-copy texture import.');
        } else {
          isWebGPUReady = false;
          webgpuRenderer = null;
          try {
            ctx2d = offscreenCanvas.getContext('2d');
            console.log('[RendererWorker] WebGPU unavailable; initialized 2D OffscreenCanvas fallback.');
          } catch (e) {
            console.warn('[RendererWorker] 2D context fallback error:', e);
          }
        }
        self.postMessage({ 
          type: 'webgpu_ready', 
          payload: { isHardwareAccelerated: isWebGPUReady } 
        });
      }
    } catch (err) {
      console.warn('[RendererWorker] Canvas init error, using 2D fallback:', err);
      if (offscreenCanvas && !ctx2d) {
        try { ctx2d = offscreenCanvas.getContext('2d'); } catch (_) {}
      }
    }
    return;
  }

  // 2. Canvas Resize
  if (type === 'resize_canvas') {
    const { width, height } = payload;
    if (offscreenCanvas) {
      if (webgpuRenderer && isWebGPUReady) {
        webgpuRenderer.resize(width, height);
      } else {
        offscreenCanvas.width = width;
        offscreenCanvas.height = height;
      }
    }
    return;
  }

  // 3. Render Frame from WebCodecs / Two-Tier Scrubbing
  if (type === 'render_frame') {
    const { frame, grading, frame1, grading1, frame2, grading2, transition } = payload || {};
    const primaryFrame: VideoFrame | undefined = frame1 || frame;
    
    if (!primaryFrame) {
      try { frame?.close(); } catch (_) {}
      try { frame1?.close(); } catch (_) {}
      try { frame2?.close(); } catch (_) {}
      return;
    }

    try {
      if (offscreenCanvas) {
        // Adjust canvas dimensions if frame aspect or size differs
        if (offscreenCanvas.width !== primaryFrame.displayWidth || offscreenCanvas.height !== primaryFrame.displayHeight) {
          if (webgpuRenderer && isWebGPUReady) {
            webgpuRenderer.resize(primaryFrame.displayWidth, primaryFrame.displayHeight);
          } else {
            offscreenCanvas.width = primaryFrame.displayWidth;
            offscreenCanvas.height = primaryFrame.displayHeight;
          }
        }

        if (webgpuRenderer && isWebGPUReady && webgpuRenderer.isReady()) {
          // Hardware-accelerated WebGPU rendering (zero CPU memory copy)
          if (frame2 && transition && transition.progress > 0) {
            webgpuRenderer.renderTransition(
              primaryFrame,
              frame2,
              transition,
              grading1 || grading,
              grading2
            );
          } else {
            webgpuRenderer.render(primaryFrame, grading1 || grading);
          }
        } else if (ctx2d) {
          // 2D OffscreenCanvas fallback
          ctx2d.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
          
          if (grading1?.brightness || grading1?.contrast || grading?.brightness || grading?.contrast) {
            const b = (grading1?.brightness ?? grading?.brightness ?? 0) + 1;
            const c = (grading1?.contrast ?? grading?.contrast ?? 1);
            const s = (grading1?.saturation ?? grading?.saturation ?? 1);
            ctx2d.filter = `brightness(${b}) contrast(${c}) saturate(${s})`;
          } else {
            ctx2d.filter = 'none';
          }

          ctx2d.drawImage(primaryFrame, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

          // If transition with second frame is active
          if (frame2 && transition && transition.progress > 0) {
            ctx2d.globalAlpha = transition.progress;
            ctx2d.drawImage(frame2, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
            ctx2d.globalAlpha = 1.0;
          }
        }
      }

      const isDualTexturePass = !!(frame2 && transition && transition.progress > 0 && isWebGPUReady);

      self.postMessage({
        type: 'frame_rendered',
        payload: {
          timestamp: primaryFrame.timestamp / 1000000,
          isHardwareAccelerated: isWebGPUReady,
          isDualTexturePass,
          activeTransition: (transition && transition.progress > 0) ? transition.type : null,
          pipelineStatus: isWebGPUReady ? 'webgpu_active' : 'canvas2d_fallback'
        }
      });
    } catch (err) {
      console.warn('[RendererWorker] Frame render error:', err);
    } finally {
      // Free VideoFrame GPU handles immediately to avoid VRAM / decoder stalls
      try { primaryFrame.close(); } catch (_) {}
      try { frame?.close(); } catch (_) {}
      try { frame2?.close(); } catch (_) {}
    }
    return;
  }

  // 4. Destroy / Dispose
  if (type === 'destroy') {
    try {
      webgpuRenderer?.destroy();
      webgpuRenderer = null;
      ctx2d = null;
      offscreenCanvas = null;
      isWebGPUReady = false;
    } catch (e) {
      console.warn('[RendererWorker] Error during destroy:', e);
    }
    return;
  }
};
