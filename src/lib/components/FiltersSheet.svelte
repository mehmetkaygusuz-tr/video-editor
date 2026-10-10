<script lang="ts">
  import { editor } from '../editor.svelte';
  import { FILTER_PRESETS } from '../filters';
  import { aiService } from '../engine/aiService.svelte';
  import { Sliders, Sparkles, Check, X, RotateCcw } from '@lucide/svelte';

  let selectedCategory = $state<'all' | 'cinematic' | 'creative' | 'vintage' | 'clean'>('all');
  let selectedClip = $derived(editor.getSelectedClip());

  let filteredPresets = $derived.by(() => {
    if (selectedCategory === 'all') return FILTER_PRESETS;
    return FILTER_PRESETS.filter(p => p.category === selectedCategory);
  });

  function applyPreset(presetId: string) {
    if (selectedClip) {
      editor.applyFilterToClip(selectedClip.id, presetId);
    } else {
      editor.applyFilterToAllClips(presetId);
    }
  }

  function resetGrading() {
    if (selectedClip) {
      editor.updateClip(selectedClip.id, {
        colorGrading: {
          brightness: 0,
          contrast: 1,
          saturation: 1,
          temperature: 0,
          tint: 0
        }
      });
      editor.announce('Klip renk ayarları sıfırlandı.');
    }
  }
</script>

<div class="w-full flex flex-col p-4 md:p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar select-none">
  <!-- Header -->
  <div class="flex items-center justify-between pb-3 border-b border-white/10">
    <div class="flex items-center gap-2">
      <div class="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
        <Sliders size={18} />
      </div>
      <div>
        <h3 class="text-sm font-bold text-white">Sinematik Renk Filtreleri & LUT</h3>
        <p class="text-[11px] text-neutral-400">Oklab renk uzayında kayıpsız donanım hızlandırmalı filtreler</p>
      </div>
    </div>

    <!-- AI Auto-Color Button -->
    <button
      onclick={() => aiService.autoColorEnhance()}
      disabled={aiService.isRunning}
      class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-900/30 transition-all cursor-pointer disabled:opacity-50"
      title="Yapay zeka ile sahne ışığını analiz et ve sinematik renk uygula"
    >
      <Sparkles size={13} class={aiService.isRunning ? 'animate-spin' : ''} />
      <span>AI Akıllı Renk</span>
    </button>
  </div>

  <!-- Category Pills -->
  <div class="flex items-center gap-1.5 overflow-x-auto pb-1">
    {#each [
      { id: 'all', label: 'Tümü' },
      { id: 'cinematic', label: 'Sinematik' },
      { id: 'creative', label: 'Yaratıcı' },
      { id: 'vintage', label: 'Nostalji 90s' },
      { id: 'clean', label: 'Temiz / Reklam' }
    ] as cat}
      <button
        onclick={() => selectedCategory = cat.id as any}
        class="px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap cursor-pointer {selectedCategory === cat.id ? 'bg-white text-neutral-950 font-bold' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
      >
        {cat.label}
      </button>
    {/each}
  </div>

  <!-- Presets Grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    {#each filteredPresets as preset}
      {@const isCurrent = selectedClip?.colorGrading?.lut === preset.grading.lut}
      <button
        onclick={() => applyPreset(preset.id)}
        class="p-3.5 rounded-2xl border text-left transition-all cursor-pointer group relative overflow-hidden flex flex-col justify-between {isCurrent ? 'border-purple-500 bg-purple-950/20 shadow-lg shadow-purple-950/20' : 'border-white/5 bg-neutral-950 hover:border-white/20'}"
      >
        <div>
          <!-- Gradient visual bar -->
          <div class="w-full h-8 rounded-xl mb-2.5 shadow-inner transition-transform group-hover:scale-[1.02]" style="background: {preset.previewGradient};"></div>
          
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-white group-hover:text-purple-300 transition-colors">{preset.name}</span>
            {#if isCurrent}
              <Check size={14} class="text-purple-400" />
            {/if}
          </div>
          <p class="text-[11px] text-neutral-400 mt-1 leading-snug line-clamp-2">{preset.description}</p>
        </div>

        <div class="flex items-center justify-between mt-3 pt-2 border-t border-white/5 text-[10px] text-neutral-500 font-mono">
          <span>Kontrast: {preset.grading.contrast}x</span>
          <span class="text-purple-400 group-hover:underline">Uygula →</span>
        </div>
      </button>
    {/each}
  </div>

  <!-- Footer Actions -->
  {#if selectedClip}
    <div class="flex items-center justify-between pt-2 border-t border-white/5">
      <span class="text-xs text-neutral-400 font-mono truncate max-w-xs">Seçili Klip: {selectedClip.name}</span>
      <button
        onclick={resetGrading}
        class="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
      >
        <RotateCcw size={12} />
        <span>Rengi Sıfırla</span>
      </button>
    </div>
  {/if}
</div>
