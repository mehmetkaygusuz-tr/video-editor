<script lang="ts">
  import { editor } from '../editor.svelte';
  import { SPEED_CURVE_PRESETS, evaluateSpeedCurve } from '../engine/speedCurve';
  import type { SpeedCurvePoint } from '../types';
  import { 
    Gauge, Zap, Sparkles, Check, X, RotateCcw, 
    Volume2, Sliders, Play, Info
  } from '@lucide/svelte';

  let selectedClip = $derived(editor.getSelectedClip());

  let activePreset = $state<string>('none');
  let keepPitch = $state<boolean>(true);
  
  // Custom curve editable control points
  let points = $state<SpeedCurvePoint[]>([
    { time: 0.0, speed: 1.0 },
    { time: 0.25, speed: 1.0 },
    { time: 0.5, speed: 1.0 },
    { time: 0.75, speed: 1.0 },
    { time: 1.0, speed: 1.0 }
  ]);

  let selectedPointIndex = $state<number>(0);

  $effect(() => {
    if (selectedClip) {
      activePreset = selectedClip.speedCurve?.preset || 'none';
      keepPitch = selectedClip.speedCurve?.keepPitch ?? true;
      if (selectedClip.speedCurve?.points && selectedClip.speedCurve.points.length > 0) {
        points = JSON.parse(JSON.stringify(selectedClip.speedCurve.points));
      }
    }
  });

  function selectPreset(presetId: string) {
    if (!selectedClip) return;
    activePreset = presetId;

    if (presetId === 'none') {
      editor.setClipSpeedCurve(selectedClip.id, undefined);
      editor.setClipSpeed(selectedClip.id, 1.0);
      points = [
        { time: 0.0, speed: 1.0 },
        { time: 0.5, speed: 1.0 },
        { time: 1.0, speed: 1.0 }
      ];
      return;
    }

    const found = SPEED_CURVE_PRESETS.find(p => p.id === presetId);
    if (found) {
      points = JSON.parse(JSON.stringify(found.points));
      editor.setClipSpeedCurve(selectedClip.id, {
        preset: presetId as any,
        points: points,
        keepPitch
      });
    }
  }

  function updateSelectedPointSpeed(newSpeed: number) {
    if (!selectedClip) return;
    points[selectedPointIndex].speed = Number(newSpeed.toFixed(1));
    activePreset = 'custom';
    editor.setClipSpeedCurve(selectedClip.id, {
      preset: 'custom',
      points: points,
      keepPitch
    });
  }

  function toggleKeepPitch() {
    if (!selectedClip) return;
    keepPitch = !keepPitch;
    if (selectedClip.speedCurve) {
      editor.setClipSpeedCurve(selectedClip.id, {
        ...selectedClip.speedCurve,
        keepPitch
      });
    }
    editor.triggerHaptic('light');
  }

  // Draw interactive SVG curve path
  let svgWidth = 280;
  let svgHeight = 110;

  function getX(time: number): number {
    return 16 + time * (svgWidth - 32);
  }

  function getY(speed: number): number {
    // Map speed (0.1x to 5.0x) into height
    const normalized = Math.max(0, Math.min(1, (speed - 0.1) / 4.9));
    return (svgHeight - 16) - normalized * (svgHeight - 32);
  }

  let curvePathD = $derived.by(() => {
    if (points.length === 0) return '';
    const sorted = [...points].sort((a, b) => a.time - b.time);
    let d = `M ${getX(sorted[0].time)} ${getY(sorted[0].speed)}`;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const midX = (getX(prev.time) + getX(curr.time)) / 2;
      d += ` C ${midX} ${getY(prev.speed)}, ${midX} ${getY(curr.speed)}, ${getX(curr.time)} ${getY(curr.speed)}`;
    }
    return d;
  });
</script>

<div class="flex flex-col gap-3.5 text-white pb-6 select-none">
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-white/10 pb-3">
    <div class="flex items-center gap-2">
      <div class="p-2 bg-amber-500/20 rounded-xl text-amber-400 border border-amber-500/30">
        <Gauge size={18} />
      </div>
      <div>
        <h3 class="text-sm font-semibold tracking-wide">Hız Eğrisi (Speed Ramping)</h3>
        <p class="text-[11px] text-neutral-400">CapCut & VN tarzı dinamik kavisli hız efektleri</p>
      </div>
    </div>
    <button
      onclick={() => editor.closeBottomSheet()}
      class="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white"
    >
      <X size={16} />
    </button>
  </div>

  {#if !selectedClip}
    <div class="py-8 text-center text-xs text-neutral-400">
      Lütfen hız eğrisi uygulamak için önce bir klip seçin.
    </div>
  {:else}
    <!-- Interactive Curve Visualizer -->
    <div class="bg-neutral-900/90 border border-white/10 rounded-2xl p-3 flex flex-col items-center relative overflow-hidden">
      <div class="w-full flex items-center justify-between text-[11px] text-neutral-400 mb-1 px-1">
        <span class="font-mono text-amber-300 flex items-center gap-1">
          <Zap size={12} /> Seçili Nokta: {points[selectedPointIndex]?.speed ?? 1.0}x
        </span>
        <button 
          onclick={() => selectPreset('none')}
          class="flex items-center gap-1 text-[10px] text-neutral-400 hover:text-white hover:underline"
        >
          <RotateCcw size={10} /> Sıfırla (1.0x Sabit)
        </button>
      </div>

      <!-- SVG Curve Canvas -->
      <svg 
        viewBox="0 0 {svgWidth} {svgHeight}" 
        class="w-full h-28 bg-neutral-950/80 rounded-xl border border-white/5 overflow-visible my-1 cursor-crosshair"
      >
        <!-- Grid Reference Lines -->
        <line x1="16" y1={getY(1.0)} x2={svgWidth - 16} y2={getY(1.0)} stroke="rgba(255,255,255,0.15)" stroke-dasharray="4 4" stroke-width="1" />
        <line x1="16" y1={getY(2.5)} x2={svgWidth - 16} y2={getY(2.5)} stroke="rgba(255,255,255,0.08)" stroke-width="1" />
        <line x1="16" y1={getY(0.3)} x2={svgWidth - 16} y2={getY(0.3)} stroke="rgba(255,255,255,0.08)" stroke-width="1" />

        <!-- Reference labels -->
        <text x="18" y={getY(1.0) - 3} fill="rgba(255,255,255,0.4)" font-size="8" font-family="monospace">1.0x</text>
        <text x="18" y={getY(2.5) - 3} fill="rgba(255,255,255,0.25)" font-size="8" font-family="monospace">2.5x</text>
        <text x="18" y={getY(0.3) - 3} fill="rgba(255,255,255,0.25)" font-size="8" font-family="monospace">0.3x</text>

        <!-- Dynamic Curve Area Under -->
        <path 
          d="{curvePathD} L {getX(points[points.length - 1].time)} {svgHeight - 16} L {getX(points[0].time)} {svgHeight - 16} Z"
          fill="url(#curveGlow)"
          opacity="0.3"
        />

        <defs>
          <linearGradient id="curveGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.8" />
            <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- Curve Line -->
        <path 
          d={curvePathD} 
          fill="none" 
          stroke="#f59e0b" 
          stroke-width="3.5" 
          stroke-linecap="round"
        />

        <!-- Control Point Knobs -->
        {#each points as pt, idx}
          {@const cx = getX(pt.time)}
          {@const cy = getY(pt.speed)}
          {@const isSelected = idx === selectedPointIndex}
          <g 
            role="button"
            tabindex="0"
            aria-label="Kontrol noktası {idx + 1}, hız {pt.speed.toFixed(1)}x"
            onclick={() => { selectedPointIndex = idx; editor.triggerHaptic('light'); }}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectedPointIndex = idx;
                editor.triggerHaptic('light');
              }
            }}
            class="cursor-pointer focus:outline-none"
          >
            <circle 
              cx={cx} 
              cy={cy} 
              r={isSelected ? 8 : 5} 
              fill={isSelected ? '#ffffff' : '#f59e0b'} 
              stroke="#000000" 
              stroke-width="2"
              class="transition-all active:scale-125"
            />
            {#if isSelected}
              <circle cx={cx} cy={cy} r="12" fill="none" stroke="#f59e0b" stroke-width="1.5" opacity="0.6" />
            {/if}
          </g>
        {/each}
      </svg>

      <!-- Real-time Speed Knob Slider for Selected Point -->
      <div class="w-full flex items-center justify-between gap-3 pt-2 px-1">
        <span class="text-[11px] text-neutral-400 font-medium">Hız Ayarı:</span>
        <input 
          type="range"
          min="0.2"
          max="5.0"
          step="0.1"
          value={points[selectedPointIndex]?.speed ?? 1.0}
          oninput={(e) => updateSelectedPointSpeed(parseFloat((e.target as HTMLInputElement).value))}
          class="flex-1 h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
        />
        <span class="font-mono text-xs font-bold text-amber-400 min-w-[40px] text-right">
          {points[selectedPointIndex]?.speed ?? 1.0}x
        </span>
      </div>
    </div>

    <!-- Presets Grid -->
    <div class="space-y-1.5">
      <span class="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
        <Sparkles size={13} class="text-amber-400" />
        Popüler Hız Şablonları (Presets)
      </span>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <button
          onclick={() => selectPreset('none')}
          class="flex flex-col p-2.5 rounded-xl border text-left transition-all {activePreset === 'none' ? 'border-amber-500 bg-amber-500/10' : 'border-white/10 bg-neutral-900/60 hover:bg-neutral-800'}"
        >
          <span class="text-xs font-semibold text-neutral-200">Normal (Sabit)</span>
          <span class="text-[10px] text-neutral-400">1.0x standart hız</span>
        </button>

        {#each SPEED_CURVE_PRESETS as preset}
          {@const isSelected = activePreset === preset.id}
          <button
            onclick={() => selectPreset(preset.id)}
            class="flex flex-col p-2.5 rounded-xl border text-left transition-all {isSelected ? 'border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/10' : 'border-white/10 bg-neutral-900/60 hover:bg-neutral-800'}"
          >
            <div class="flex items-center justify-between w-full">
              <span class="text-xs font-semibold text-neutral-200">{preset.name}</span>
              {#if isSelected}
                <Check size={12} class="text-amber-400" />
              {/if}
            </div>
            <span class="text-[10px] text-neutral-400 line-clamp-1 mt-0.5">{preset.description}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Audio Pitch Correction & Options -->
    <div class="bg-neutral-900/80 p-3 rounded-xl border border-white/10 flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="p-1.5 rounded-lg bg-neutral-800 text-amber-400">
          <Volume2 size={16} />
        </div>
        <div>
          <span class="text-xs font-medium text-neutral-200">Ses Tonunu Koru (Pitch Correction)</span>
          <p class="text-[10px] text-neutral-400">Hızlandığında sesin incelmesini / kalınlaşmasını önler</p>
        </div>
      </div>
      <button 
        type="button"
        aria-label="Ses Tonunu Koru Aç/Kapat"
        onclick={toggleKeepPitch}
        class="w-11 h-6 rounded-full p-0.5 transition-colors {keepPitch ? 'bg-amber-500' : 'bg-neutral-700'}"
      >
        <div class="w-5 h-5 rounded-full bg-white transition-transform {keepPitch ? 'translate-x-5' : 'translate-x-0'}"></div>
      </button>
    </div>

    <!-- Done button -->
    <button
      onclick={() => editor.closeBottomSheet()}
      class="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg shadow-amber-600/30 transition-all active:scale-98 mt-1"
    >
      Hız Eğrisini Onayla
    </button>
  {/if}
</div>
