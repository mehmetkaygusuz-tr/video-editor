<script lang="ts">
  import { editor } from '../editor.svelte';
  import type { SubtitlePresetStyle } from '../types';
  import { 
    Type, Sparkles, Sliders, Check, X, Palette, 
    Layers, Sun, Music, MoveVertical, RotateCcw
  } from '@lucide/svelte';

  const presets: {
    id: SubtitlePresetStyle;
    name: string;
    description: string;
    previewText: string;
    tag: string;
    bgPreview: string;
    textColor: string;
    borderStyle: string;
  }[] = [
    {
      id: 'tiktok-bold',
      name: 'TikTok Bold',
      description: 'Kalın beyaz yazı, siyah kontur ve sarı kelime vurgusu.',
      previewText: 'VİRAL VİDEO',
      tag: 'Popüler',
      bgPreview: 'bg-black/90',
      textColor: 'text-yellow-300 font-black',
      borderStyle: 'border-yellow-400/40'
    },
    {
      id: 'karaoke-glow',
      name: 'Karaoke Neon',
      description: 'Mavi neon ışıltı ve ritmik kelime aydınlatması.',
      previewText: 'CANLI RİTİM',
      tag: 'Müzik & Reels',
      bgPreview: 'bg-indigo-950/90',
      textColor: 'text-sky-300 font-extrabold',
      borderStyle: 'border-sky-400/50 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
    },
    {
      id: 'minimal-pill',
      name: 'Minimal Kapsül',
      description: 'Şeffaf koyu zemin üzerinde modern sade tipografi.',
      previewText: 'temiz & sade',
      tag: 'Vlog & Estetik',
      bgPreview: 'bg-zinc-900/80',
      textColor: 'text-white font-medium',
      borderStyle: 'border-white/20'
    },
    {
      id: 'neon-reels',
      name: 'Neon Reels',
      description: 'Canlı pembe/eflatun parıltılı dinamik metin stili.',
      previewText: 'ENERJİK',
      tag: 'Trend',
      bgPreview: 'bg-rose-950/80',
      textColor: 'text-pink-400 font-black',
      borderStyle: 'border-pink-500/50 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
    },
    {
      id: 'classic-sub',
      name: 'Klasik Sinema',
      description: 'Arka plansız sarı sinematik altyazı ve derin gölge.',
      previewText: 'Sinematik Altyazı',
      tag: 'Klasik',
      bgPreview: 'bg-black/40',
      textColor: 'text-yellow-400 font-bold',
      borderStyle: 'border-yellow-500/20'
    }
  ];

  const animations: { id: 'none' | 'pop' | 'typewriter' | 'wave' | 'karaoke'; name: string }[] = [
    { id: 'pop', name: 'Pop-in (Dinamik Zıplama)' },
    { id: 'karaoke', name: 'Karaoke (Kelime Vurgusu)' },
    { id: 'typewriter', name: 'Daktilo (Typewriter)' },
    { id: 'wave', name: 'Dalgalanma (Wave)' },
    { id: 'none', name: 'Sabit (Animasyonsuz)' }
  ];

  const colorPalettes = [
    { text: '#ffffff', highlight: '#fde047', bg: 'rgba(0,0,0,0.8)', name: 'Sarı Vurgu' },
    { text: '#38bdf8', highlight: '#f43f5e', bg: 'rgba(15,23,42,0.85)', name: 'Mavi/Pembe' },
    { text: '#4ade80', highlight: '#ffffff', bg: 'rgba(5,46,22,0.85)', name: 'Neon Yeşil' },
    { text: '#ffffff', highlight: '#a855f7', bg: 'rgba(30,10,50,0.85)', name: 'Mor Glow' },
    { text: '#ffffff', highlight: '#fb923c', bg: 'rgba(20,20,20,0.85)', name: 'Turuncu' },
  ];
</script>

<div class="flex flex-col gap-4 text-white pb-6">
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-white/10 pb-3">
    <div class="flex items-center gap-2">
      <div class="p-2 bg-purple-500/20 rounded-xl text-purple-400 border border-purple-500/30">
        <Type size={18} />
      </div>
      <div>
        <h3 class="text-sm font-semibold tracking-wide">Altyazı & Tipografi Stilleri</h3>
        <p class="text-[11px] text-neutral-400">Canlı önizlemeli CapCut & Reels tarzı yazı şablonları</p>
      </div>
    </div>
    <button
      onclick={() => editor.closeBottomSheet()}
      class="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white"
    >
      <X size={16} />
    </button>
  </div>

  <!-- Style Presets Carousel / Grid -->
  <div class="space-y-2">
    <span class="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
      <Sparkles size={13} class="text-purple-400" />
      Hazır Stil Şablonları (Presets)
    </span>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {#each presets as p (p.id)}
        {@const isSelected = editor.globalSubtitleStyle.preset === p.id}
        <button
          onclick={() => editor.setSubtitlePreset(p.id)}
          class="flex flex-col p-3 rounded-2xl border transition-all text-left relative overflow-hidden group {isSelected ? 'border-purple-500 bg-purple-950/30 shadow-lg shadow-purple-500/10' : 'border-white/10 bg-neutral-900/60 hover:bg-neutral-900 hover:border-white/20'}"
        >
          <div class="flex items-center justify-between w-full mb-2">
            <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-neutral-300 font-semibold">{p.tag}</span>
            {#if isSelected}
              <div class="w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center">
                <Check size={12} strokeWidth={3} />
              </div>
            {/if}
          </div>

          <!-- Live Visual Miniature Simulation -->
          <div class="w-full py-2.5 px-3 rounded-xl {p.bgPreview} {p.borderStyle} flex items-center justify-center border my-1">
            <span class="text-xs {p.textColor} tracking-wide text-center truncate">{p.previewText}</span>
          </div>

          <span class="text-xs font-semibold text-neutral-200 group-hover:text-white mt-1">{p.name}</span>
          <p class="text-[10px] text-neutral-400 leading-tight mt-0.5">{p.description}</p>
        </button>
      {/each}
    </div>
  </div>

  <!-- Real-time Fine Tuning Controls -->
  <div class="bg-neutral-900/80 p-3.5 rounded-2xl border border-white/10 space-y-3">
    <span class="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
      <Sliders size={13} class="text-sky-400" />
      Canlı Boyut & Konum Ayarı
    </span>

    <!-- Font Size -->
    <div class="space-y-1">
      <div class="flex justify-between text-xs">
        <span class="text-neutral-400">Yazı Boyutu</span>
        <span class="font-mono text-white">{editor.globalSubtitleStyle.fontSize}px</span>
      </div>
      <input 
        type="range"
        min="18"
        max="48"
        step="2"
        value={editor.globalSubtitleStyle.fontSize}
        oninput={(e) => editor.updateGlobalSubtitleStyle({ fontSize: e.currentTarget.valueAsNumber })}
        class="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
      />
    </div>

    <!-- Vertical Position (Y) -->
    <div class="space-y-1">
      <div class="flex justify-between text-xs">
        <span class="text-neutral-400 flex items-center gap-1">
          <MoveVertical size={12} /> Dikey Konum
        </span>
        <span class="font-mono text-white">%{editor.globalSubtitleStyle.positionY}</span>
      </div>
      <input 
        type="range"
        min="20"
        max="90"
        step="2"
        value={editor.globalSubtitleStyle.positionY}
        oninput={(e) => editor.updateGlobalSubtitleStyle({ positionY: e.currentTarget.valueAsNumber })}
        class="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
      />
    </div>

    <!-- Animation selector -->
    <div class="space-y-1 pt-1">
      <span class="text-xs text-neutral-400">Animasyon Türü</span>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
        {#each animations as anim (anim.id)}
          <button
            onclick={() => editor.updateGlobalSubtitleStyle({ animation: anim.id })}
            class="py-1.5 px-2 rounded-lg border text-[11px] font-medium transition-all {editor.globalSubtitleStyle.animation === anim.id ? 'bg-purple-600 border-purple-400 text-white' : 'bg-neutral-800 border-white/5 text-neutral-300 hover:bg-neutral-750'}"
          >
            {anim.name}
          </button>
        {/each}
      </div>
    </div>

    <!-- Quick Color Themes -->
    <div class="space-y-1 pt-1">
      <span class="text-xs text-neutral-400 flex items-center gap-1">
        <Palette size={12} /> Renk Paleti
      </span>
      <div class="flex items-center gap-2 pt-1">
        {#each colorPalettes as col (col.name)}
          <button
            onclick={() => editor.updateGlobalSubtitleStyle({ 
              textColor: col.text, 
              highlightColor: col.highlight, 
              backgroundColor: col.bg 
            })}
            class="flex items-center gap-1 px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-[10px] text-neutral-300 transition-all active:scale-95"
          >
            <div class="w-3 h-3 rounded-full border border-white/20" style="background-color: {col.highlight};"></div>
            <span>{col.name}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- Bottom Done button -->
  <div class="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
    <button
      onclick={() => editor.closeBottomSheet()}
      class="w-full py-2.5 px-6 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition-all active:scale-98"
    >
      Stili Uygula ve Kapat
    </button>
  </div>
</div>
