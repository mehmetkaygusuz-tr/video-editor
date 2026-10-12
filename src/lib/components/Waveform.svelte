<script lang="ts">
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

  let canvasEl = $state<HTMLCanvasElement>();
  let canvasWidth = $state<number>(0);
  let canvasHeight = $state<number>(0);
  let peaks = $state.raw<Float32Array | null>(null);
  let totalDuration = $state<number>(60);

  function renderWaveform() {
    if (!canvasEl || !peaks || peaks.length === 0) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const width = canvasWidth || canvasEl.clientWidth;
    const height = canvasHeight || canvasEl.clientHeight;
    if (width <= 0 || height <= 0) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvasEl.width !== Math.floor(width * dpr) || canvasEl.height !== Math.floor(height * dpr)) {
      canvasEl.width = Math.floor(width * dpr);
      canvasEl.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const peaksPerSec = peaks.length / (totalDuration || 60);
    const startPeak = Math.floor(sourceOffset * peaksPerSec);
    const endPeak = Math.ceil((sourceOffset + duration) * peaksPerSec);

    const safeStart = Math.max(0, startPeak);
    const safeEnd = Math.min(peaks.length, endPeak);
    const visibleCount = safeEnd - safeStart;

    if (visibleCount > 0) {
      const step = width / visibleCount;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      
      for (let i = 0; i < visibleCount; i++) {
        const peakVal = peaks[safeStart + i];
        const barH = Math.max(1, peakVal * height * 0.9);
        const y = (height - barH) / 2;
        ctx.fillRect(i * step, y, Math.max(0.5, step - 0.5), barH);
      }
    }

    ctx.restore();
  }

  // Svelte 5 Effect: Load peaks when assetId changes with cancellation teardown
  $effect(() => {
    const currentAssetId = assetId;
    const asset = editor.assets.find(a => a.id === currentAssetId);
    if (!asset || asset.type === 'image') return;

    let isCancelled = false;

    (async () => {
      try {
        let file: File | null | undefined = editor.getCachedFile(asset.name);
        if (!file) {
          file = await getFileFromOPFS(asset.name);
        }
        if (!file && asset.blobUrl) {
          try {
            const resp = await fetch(asset.blobUrl);
            const blob = await resp.blob();
            file = new File([blob], asset.name, { type: asset.type === 'video' ? 'video/mp4' : 'audio/wav' });
          } catch (_) {}
        }
        if (file && !isCancelled) {
          totalDuration = asset.duration || 60;
          const p = await generateWaveformPeaks(file, 1000);
          if (!isCancelled) {
            peaks = p;
            renderWaveform();
          }
        }
      } catch (e) {
        console.warn('[Waveform] Generation error:', e);
      }
    })();

    return () => {
      isCancelled = true;
    };
  });

  // Svelte 5 Effect: Re-render when geometry, canvas dimensions, or peaks change
  $effect(() => {
    const _w = canvasWidth;
    const _h = canvasHeight;
    const _z = zoom;
    const _o = sourceOffset;
    const _d = duration;
    const _p = peaks;
    if (canvasEl && _p && (_w > 0 || canvasEl.clientWidth > 0)) {
      renderWaveform();
    }
  });
</script>

<canvas 
  bind:this={canvasEl} 
  bind:clientWidth={canvasWidth}
  bind:clientHeight={canvasHeight}
  class="absolute inset-0 w-full h-full pointer-events-none opacity-50 mix-blend-plus-lighter"
></canvas>
