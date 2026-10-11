<script lang="ts">

  let {
    value = { l: 0.7, a: 0.0, b: 0.0 },
    onChange = () => {}
  }: {
    value?: { l: number; a: number; b: number };
    onChange?: (val: { l: number; a: number; b: number }) => void;
  } = $props();

  let canvasRef = $state<HTMLCanvasElement | null>(null);
  let isDragging = $state(false);
  const size = 150;
  const radius = size / 2;

  let currentA = $derived(value.a ?? 0.0);
  let currentB = $derived(value.b ?? 0.0);
  let currentL = $derived(value.l ?? 0.7);

  // Oklab to sRGB conversion for display
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

        // Map x,y to a,b in Oklab space (-0.4 to 0.4)
        const a = (dx / radius) * 0.4;
        const b = (dy / radius) * 0.4;

        const rgb = oklabToSrgb(currentL, a, b);
        
        data[idx] = rgb.r;
        data[idx + 1] = rgb.g;
        data[idx + 2] = rgb.b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  $effect(() => {
    // Render on mount and whenever Lightness changes
    if (currentL !== undefined && canvasRef) {
      renderWheel();
    }
  });

  function handlePointerDown(e: PointerEvent) {
    if (!canvasRef) return;
    isDragging = true;
    updateFromPointer(e);
    canvasRef.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    updateFromPointer(e);
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isDragging || !canvasRef) return;
    isDragging = false;
    try {
      canvasRef.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }

  function updateFromPointer(e: PointerEvent) {
    if (!canvasRef) return;
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

    onChange({ l: currentL, a: newA, b: newB });
  }

  let thumbX = $derived(radius + (currentA / 0.4) * radius);
  let thumbY = $derived(radius + (currentB / 0.4) * radius);
</script>

<div class="flex flex-col items-center gap-3 select-none">
  <div class="relative" style="width: {size}px; height: {size}px;">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <canvas
      bind:this={canvasRef}
      width={size}
      height={size}
      class="rounded-full shadow-[0_0_20px_rgba(0,0,0,0.6)] border border-white/10 cursor-crosshair touch-none"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
    ></canvas>
    
    <!-- Active color pointer indicator -->
    <div 
      class="absolute w-4 h-4 -ml-2 -mt-2 border-2 border-white rounded-full shadow-[0_0_8px_rgba(0,0,0,0.8)] pointer-events-none transition-transform duration-75"
      style="left: {thumbX}px; top: {thumbY}px; background-color: rgba(255,255,255,0.4);"
    ></div>
  </div>

  <div class="w-full max-w-[200px] px-1 space-y-1">
    <div class="flex justify-between text-[10px] text-neutral-400 font-mono">
      <span>Açıklık / Işık (L)</span>
      <span class="text-cyan-400 font-semibold">{Math.round(currentL * 100)}%</span>
    </div>
    <input 
      type="range" 
      min="0.2" 
      max="1" 
      step="0.01" 
      value={currentL}
      oninput={(e) => onChange({ l: parseFloat((e.target as HTMLInputElement).value), a: currentA, b: currentB })}
      class="w-full accent-cyan-400 h-1.5 bg-neutral-800 rounded appearance-none cursor-pointer"
    />
  </div>
</div>
