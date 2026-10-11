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
  let peaks = $state<Float32Array | null>(null);
  let totalDuration = $state<number>(60);
  let resizeObserver: ResizeObserver | null = null;

  function renderWaveform() {
    if (!canvasEl || !peaks || peaks.length === 0) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const width = canvasEl.clientWidth;
    const height = canvasEl.clientHeight;
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

  $effect(() => {
    // Re-render when geometry or peaks change
    const _z = zoom;
    const _o = sourceOffset;
    const _d = duration;
    const _p = peaks;
    if (canvasEl && peaks) {
      renderWaveform();
    }
  });

  onMount(async () => {
    if (!canvasEl) return;

    resizeObserver = new ResizeObserver(() => {
      renderWaveform();
    });
    resizeObserver.observe(canvasEl);

    const asset = editor.assets.find(a => a.id === assetId);
    if (!asset || asset.type === 'image') return;

    try {
      let file: File | null | undefined = editor.getCachedFile(asset.name);
      if (!file) {
        file = await getFileFromOPFS(asset.name);
      }
      if (file) {
        totalDuration = asset.duration || 60;
        peaks = await generateWaveformPeaks(file, 1000);
        renderWaveform();
      }
    } catch (e) {
      console.warn('[Waveform] Generation error:', e);
    }
  });

  onDestroy(() => {
    if (resizeObserver && canvasEl) {
      resizeObserver.unobserve(canvasEl);
      resizeObserver.disconnect();
    }
  });
</script>

<canvas bind:this={canvasEl} class="absolute inset-0 w-full h-full pointer-events-none opacity-50 mix-blend-plus-lighter"></canvas>
