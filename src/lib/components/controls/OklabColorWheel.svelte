<script lang="ts">
  import { onMount } from 'svelte';

  // Props
  export let value = { l: 0.7, a: 0.0, b: 0.0 };
  export let onChange: (val: { l: number; a: number; b: number }) => void = () => {};

  let canvasRef: HTMLCanvasElement;
  let isDragging = false;
  const size = 160;
  const radius = size / 2;

  // Oklab to sRGB conversion (approximate for display)
  function oklabToSrgb(l: number, a: number, b: number) {
    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

    const l3 = l_ * l_ * l_;
    const m3 = m_ * m_ * m_;
    const s3 = s_ * s_ * s_;

    const r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
    const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
    const b_ = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    const gamma = (x: number) => x >= 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : 12.92 * x;

    return {
      r: Math.round(clamp(gamma(r)) * 255),
      g: Math.round(clamp(gamma(g)) * 255),
      b: Math.round(clamp(gamma(b_)) * 255)
    };
  }

  function renderWheel() {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - radius;
        const dy = y - radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        const idx = (y * size + x) * 4;
        
        if (dist > radius) {
          data[idx + 3] = 0; // transparent
          continue;
        }

        // Map x,y to a,b in Oklab space (a,b typically range -0.4 to 0.4)
        const a = (dx / radius) * 0.4;
        const b = (dy / radius) * 0.4;

        const rgb = oklabToSrgb(value.l, a, b);
        
        data[idx] = rgb.r;
        data[idx + 1] = rgb.g;
        data[idx + 2] = rgb.b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  onMount(() => {
    renderWheel();
  });

  // Re-render when Lightness (l) changes
  $: if (value.l !== undefined) {
    renderWheel();
  }

  function handlePointerDown(e: PointerEvent) {
    isDragging = true;
    updateFromPointer(e);
    canvasRef.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    updateFromPointer(e);
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isDragging) return;
    isDragging = false;
    canvasRef.releasePointerCapture(e.pointerId);
  }

  function updateFromPointer(e: PointerEvent) {
    const rect = canvasRef.getBoundingClientRect();
    let x = e.clientX - rect.left - radius;
    let y = e.clientY - rect.top - radius;

    const dist = Math.sqrt(x * x + y * y);
    if (dist > radius) {
      x = (x / dist) * radius;
      y = (y / dist) * radius;
    }

    const newA = (x / radius) * 0.4;
    const newB = (y / radius) * 0.4;

    value = { ...value, a: newA, b: newB };
    onChange(value);
  }

  // Thumb position
  $: thumbX = radius + (value.a / 0.4) * radius;
  $: thumbY = radius + (value.b / 0.4) * radius;
</script>

<div class="flex flex-col items-center gap-4">
  <div class="relative" style="width: {size}px; height: {size}px;">
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <canvas
      bind:this={canvasRef}
      width={size}
      height={size}
      class="rounded-full shadow-inner cursor-crosshair"
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:pointercancel={handlePointerUp}
    ></canvas>
    <div 
      class="absolute w-4 h-4 -ml-2 -mt-2 border-2 border-white rounded-full shadow-md pointer-events-none"
      style="left: {thumbX}px; top: {thumbY}px; background-color: rgba(255,255,255,0.2);"
    ></div>
  </div>

  <div class="w-full px-2">
    <div class="flex justify-between text-[10px] text-neutral-400 mb-1">
      <span>Parlaklık (Luminance)</span>
      <span class="font-mono">{Math.round(value.l * 100)}%</span>
    </div>
    <input 
      type="range" 
      min="0" max="1" step="0.01" 
      bind:value={value.l}
      on:input={() => onChange(value)}
      class="w-full accent-blue-500 h-1.5 bg-neutral-800 rounded outline-none"
    />
  </div>
</div>
