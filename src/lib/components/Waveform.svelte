<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getFileFromOPFS } from '../opfs';
  import { generateWaveformPeaks } from '../audio';
  import { editor } from '../editor.svelte';

  let { assetId, color, sourceOffset, duration, zoom } = $props<{
    assetId: string;
    color: string;
    sourceOffset: number;
    duration: number;
    zoom: number; // pixels per second
  }>();

  let canvasEl = $state<HTMLCanvasElement | undefined>();
  let worker: Worker | null = null;
  let hasTransferredControl = false;
  let resizeObserver: ResizeObserver | null = null;

  $effect(() => {
     // Re-trigger draw on the worker when reactive props change
     // We use untrack to ensure we don't accidentally re-run on worker reference change
     const currentZoom = zoom;
     const currentOffset = sourceOffset;
     const currentDur = duration;
     
     if (worker && canvasEl && hasTransferredControl) {
        const width = canvasEl.clientWidth;
        const height = canvasEl.clientHeight;
        if (width > 0 && height > 0) {
            worker.postMessage({
              type: 'draw',
              payload: {
                sourceOffset: currentOffset,
                duration: currentDur,
                width,
                height,
                dpr: window.devicePixelRatio || 1
              }
            });
        }
     }
  });

  onMount(async () => {
    if (!canvasEl) return;
    
    // 1. Setup Worker
    worker = new Worker(new URL('../engine/workers/waveform.worker.ts', import.meta.url), { type: 'module' });
    
    // Transfer control
    const offscreen = canvasEl.transferControlToOffscreen();
    worker.postMessage({ type: 'init', payload: { offscreen } }, [offscreen]);
    hasTransferredControl = true;

    // Handle resize observation
    resizeObserver = new ResizeObserver((entries) => {
        if (!worker) return;
        const entry = entries[0];
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            worker.postMessage({
              type: 'draw',
              payload: {
                sourceOffset,
                duration,
                width: entry.contentRect.width,
                height: entry.contentRect.height,
                dpr: window.devicePixelRatio || 1
              }
            });
        }
    });
    resizeObserver.observe(canvasEl);

    // 2. Fetch and generate audio data
    const asset = editor.assets.find(a => a.id === assetId);
    if (!asset || asset.type === 'image') return;
    
    try {
      const file = await getFileFromOPFS(asset.name);
      if (file) {
         // Create 2000 peaks to have enough resolution
         const peaks = await generateWaveformPeaks(file, 2000);
         const totalDuration = asset.duration || 60; 
         
         if (worker) {
             worker.postMessage({
               type: 'update_data',
               payload: { peaks, totalDuration }
             });
             
             // Initial draw trigger
             if (canvasEl.clientWidth > 0) {
                 worker.postMessage({
                   type: 'draw',
                   payload: {
                     sourceOffset,
                     duration,
                     width: canvasEl.clientWidth,
                     height: canvasEl.clientHeight,
                     dpr: window.devicePixelRatio || 1
                   }
                 });
             }
         }
      }
    } catch(e) {
      console.warn("Waveform generation failed", e);
    }
  });
  
  onDestroy(() => {
    if (resizeObserver && canvasEl) {
        resizeObserver.unobserve(canvasEl);
        resizeObserver.disconnect();
    }
    if (worker) {
        worker.terminate();
    }
  });
</script>

<canvas bind:this={canvasEl} class="absolute inset-0 w-full h-full pointer-events-none opacity-50 mix-blend-plus-lighter"></canvas>
