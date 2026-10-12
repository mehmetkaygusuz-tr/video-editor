<script lang="ts">
  import { editor } from '../editor.svelte';
  import { FILTER_PRESETS } from '../filters';
  import { aiService } from '../engine/aiService.svelte';
  import OklabColorWheel from './controls/OklabColorWheel.svelte';
  import { 
    Sliders, Sparkles, Check, X, RotateCcw, ArrowLeft, 
    Sun, Contrast, Droplets, Thermometer, Copy, ChevronLeft, 
    ChevronRight, CircleDot, Palette 
  } from '@lucide/svelte';

  let { isBottomDocked = false, onClose } = $props<{ isBottomDocked?: boolean; onClose?: () => void }>();

  let categoryScrollRef = $state<HTMLDivElement | null>(null);
  let viewMode = $state<'presets' | 'color_wheel'>('presets');
  let selectedCategory = $state<'all' | 'cinematic' | 'creative' | 'vintage' | 'clean'>('all');
  let applyScope = $state<'selected' | 'all'>('selected');
  let selectedClip = $derived(editor.selectedClip);

  function scrollCategories(delta: number) {
    if (categoryScrollRef) {
      categoryScrollRef.scrollBy({ left: delta, behavior: 'smooth' });
      editor.triggerHaptic('light');
    }
  }

  let filteredPresets = $derived.by(() => {
    if (selectedCategory === 'all') return FILTER_PRESETS;
    return FILTER_PRESETS.filter(p => p.category === selectedCategory);
  });

  function applyPreset(presetId: string) {
    if (applyScope === 'all' || !selectedClip) {
      editor.applyFilterToAllClips(presetId);
    } else {
      editor.applyFilterToClip(selectedClip.id, presetId);
    }
    editor.triggerHaptic('light');
  }

  function resetGrading() {
    if (applyScope === 'all' || !selectedClip) {
      for (const track of editor.tracks) {
        for (const clip of track.clips) {
          if (clip.type !== 'audio' && clip.type !== 'text') {
            clip.colorGrading = {
              brightness: 0,
              contrast: 1,
              saturation: 1,
              temperature: 0,
              tint: 0
            };
          }
        }
      }
      editor.renderFrameDirty = true;
      editor.saveState();
      editor.announce('Tüm kliplerin renk ayarları sıfırlandı.');
    } else {
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
    editor.triggerHaptic('medium');
  }

  function updateColorParam(param: 'brightness' | 'contrast' | 'saturation' | 'temperature' | 'tint', val: number) {
    if (applyScope === 'all' || !selectedClip) {
      for (const track of editor.tracks) {
        for (const clip of track.clips) {
          if (clip.type !== 'audio' && clip.type !== 'text') {
            const current = clip.colorGrading || {
              brightness: 0,
              contrast: 1,
              saturation: 1,
              temperature: 0,
              tint: 0
            };
            clip.colorGrading = {
              ...current,
              [param]: val
            };
          }
        }
      }
      editor.renderFrameDirty = true;
    } else {
      const current = selectedClip.colorGrading || {
        brightness: 0,
        contrast: 1,
        saturation: 1,
        temperature: 0,
        tint: 0
      };
      // Real-time visual update without history flooding (save = false)
      editor.updateClip(selectedClip.id, {
        colorGrading: {
          ...current,
          [param]: val
        }
      }, false);
    }
  }

  function commitColorParam() {
    editor.saveState();
  }

  function copySelectedGradeToAll() {
    if (!selectedClip || !selectedClip.colorGrading) return;
    const grading = { ...selectedClip.colorGrading };
    for (const track of editor.tracks) {
      for (const clip of track.clips) {
        if (clip.type !== 'audio' && clip.type !== 'text') {
          clip.colorGrading = { ...grading };
        }
      }
    }
    editor.saveState();
    editor.announce('Seçili klibin renk ayarı tüm video sahnelerine uygulandı.');
    editor.triggerHaptic('medium');
  }

  function handleClose() {
    editor.mobileWorkspace = 'timeline';
    if (editor.activeSidebarTab === 'filters') {
      editor.activeSidebarTab = 'media';
    }
    if (editor.activeBottomSheet === 'filters') {
      editor.activeBottomSheet = null;
    }
    if (onClose) onClose();
  }
</script>

<div class="w-full h-full flex flex-col {isBottomDocked ? 'p-2 sm:p-3 overflow-hidden bg-neutral-950/70 backdrop-blur-md' : 'p-4 md:p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar select-none'}">
  <!-- Top Navigation & Control Bar (Streamlined) -->
  <div class="flex-none flex items-center justify-between gap-1.5 pb-2 border-b border-white/10 flex-wrap sm:flex-nowrap">
    <div class="flex items-center gap-1.5 flex-wrap">
      <div class="flex items-center spatial-glass rounded-xl p-0.5 border border-white/10 text-[10px]">
        <button
          onclick={() => applyScope = 'selected'}
          class="px-2.5 py-1 rounded-lg transition-all font-semibold cursor-pointer {applyScope === 'selected' ? 'bg-cyan-500/25 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-neutral-400 hover:text-white'}"
          title="Filtre ve ayarları sadece seçili klibe uygula"
        >
          Seçili Klip
        </button>
        <button
          onclick={() => applyScope = 'all'}
          class="px-2.5 py-1 rounded-lg transition-all font-semibold cursor-pointer {applyScope === 'all' ? 'bg-cyan-500/25 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-neutral-400 hover:text-white'}"
          title="Filtre ve renk ayarlarını tüm kesilmiş video sahnelerine aynı anda uygula"
        >
          Tüm Klipler
        </button>
      </div>

      {#if selectedClip && applyScope === 'selected'}
        <button
          onclick={copySelectedGradeToAll}
          class="flex items-center gap-1 px-2 py-1 rounded-xl bg-white/5 hover:bg-white/15 text-neutral-300 hover:text-white border border-white/10 text-[10px] font-medium transition-all cursor-pointer"
          title="Bu klibin renk ayarlarını diğer tüm kesilmiş video parçalarına tek tıkla kopyala"
        >
          <Copy size={11} />
          <span class="hidden xs:inline">Tümüne Yay</span>
        </button>
      {/if}
    </div>

    <div class="flex items-center gap-1.5 ml-auto">
      <button
        onclick={() => aiService.autoColorEnhance()}
        disabled={aiService.isRunning}
        class="px-2.5 py-1 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-[10px] sm:text-[11px] font-semibold flex items-center gap-1 shadow-md shadow-purple-900/30 transition-all cursor-pointer disabled:opacity-50"
        title="Yapay zeka ile sahne ışığını analiz et ve sinematik renk uygula"
      >
        <Sparkles size={11} class={aiService.isRunning ? 'animate-spin' : ''} />
        <span>AI Renk</span>
      </button>

      <button
        onclick={resetGrading}
        class="p-1 rounded-xl bg-neutral-800/80 hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors cursor-pointer"
        title="Renkleri Sıfırla"
      >
        <RotateCcw size={13} />
      </button>

      <button
        onclick={handleClose}
        class="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-neutral-200 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 font-medium text-xs shadow-sm"
        title="Filtreleri Kapat (Panele Dön)"
      >
        <X size={14} />
        <span>Kapat</span>
      </button>
    </div>
  </div>

  <!-- View Mode Switcher: Presets vs Oklab Color Wheel -->
  <div class="flex-none flex items-center justify-between gap-2 py-1 border-b border-white/5">
    <div class="flex items-center gap-1 spatial-glass p-0.5 rounded-xl border border-white/10 text-[10px]">
      <button
        type="button"
        onclick={() => viewMode = 'presets'}
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all font-semibold cursor-pointer {viewMode === 'presets' ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm' : 'text-neutral-400 hover:text-white'}"
      >
        <Palette size={12} />
        <span>Hazır LUT / Filtre</span>
      </button>
      <button
        type="button"
        onclick={() => viewMode = 'color_wheel'}
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all font-semibold cursor-pointer {viewMode === 'color_wheel' ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm' : 'text-neutral-400 hover:text-white'}"
      >
        <CircleDot size={12} />
        <span>Oklab Renk Çarkı</span>
      </button>
    </div>
  </div>

  {#if viewMode === 'presets'}
    <!-- Category Pills (Horizontal scroll with Smooth Left/Right Arrow Navigation) -->
    <div class="flex-none flex items-center gap-1 py-1.5 relative w-full">
      <button
        type="button"
        onclick={() => scrollCategories(-120)}
        class="flex-none p-1 rounded-lg bg-neutral-900/90 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-white/10 active:scale-95 transition-all shadow-sm cursor-pointer"
        title="Sola Kaydır"
      >
        <ChevronLeft size={13} />
      </button>

      <div 
        bind:this={categoryScrollRef}
        class="flex-1 flex items-center gap-1.5 overflow-x-auto scroll-smooth no-scrollbar [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-0.5"
      >
        {#each [
          { id: 'all', label: 'Tümü' },
          { id: 'cinematic', label: 'Sinematik' },
          { id: 'creative', label: 'Yaratıcı' },
          { id: 'vintage', label: 'Nostalji 90s' },
          { id: 'clean', label: 'Temiz / Reklam' }
        ] as cat}
          <button
            onclick={() => selectedCategory = cat.id as any}
            class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer {selectedCategory === cat.id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold shadow-sm' : 'bg-neutral-900 border border-white/5 text-neutral-400 hover:text-white'}"
          >
            {cat.label}
          </button>
        {/each}
      </div>

      <button
        type="button"
        onclick={() => scrollCategories(120)}
        class="flex-none p-1 rounded-lg bg-neutral-900/90 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-white/10 active:scale-95 transition-all shadow-sm cursor-pointer"
        title="Sağa Kaydır"
      >
        <ChevronRight size={13} />
      </button>
    </div>
  {/if}

  <!-- Main Scrollable Area: Presets or Color Wheel & Live Fine-Tuning Sliders -->
  <div class="flex-1 overflow-y-auto space-y-3 custom-scrollbar min-h-0 pr-1 transition-all">
    {#if viewMode === 'color_wheel'}
      <!-- Oklab Color Wheel Interactive Section -->
      {#if selectedClip}
        {@const grading = selectedClip.colorGrading || { brightness: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0 }}
        {@const wheelVal = {
          l: Math.max(0.2, Math.min(1, 0.5 + (grading.brightness || 0) / 0.8)),
          a: grading.tint || 0,
          b: grading.temperature || 0
        }}
        <div class="p-3.5 rounded-2xl bg-neutral-900/60 border border-white/10 flex flex-col sm:flex-row items-center justify-around gap-4 animate-in fade-in duration-200">
          <OklabColorWheel 
            value={wheelVal}
            onChange={(val) => {
              updateColorParam('temperature', Number(val.b.toFixed(3)));
              updateColorParam('tint', Number(val.a.toFixed(3)));
              updateColorParam('brightness', Number(((val.l - 0.5) * 0.8).toFixed(3)));
            }}
          />
          <div class="w-full sm:max-w-xs space-y-2 text-xs">
            <span class="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold block">Oklab Renk Koordinatları</span>
            <div class="flex items-center justify-between p-2 rounded-xl bg-neutral-950/70 border border-white/5 font-mono text-[11px]">
              <span class="text-neutral-400">Yeşil / Magenta (a):</span>
              <span class="text-purple-300 font-bold font-mono">{(grading.tint || 0).toFixed(3)}</span>
            </div>
            <div class="flex items-center justify-between p-2 rounded-xl bg-neutral-950/70 border border-white/5 font-mono text-[11px]">
              <span class="text-neutral-400">Mavi / Sarı Sıcaklık (b):</span>
              <span class="text-amber-300 font-bold font-mono">{(grading.temperature || 0).toFixed(3)}</span>
            </div>
            <div class="flex items-center justify-between p-2 rounded-xl bg-neutral-950/70 border border-white/5 font-mono text-[11px]">
              <span class="text-neutral-400">Pozlama / Işık (L):</span>
              <span class="text-cyan-300 font-bold font-mono">{(grading.brightness || 0).toFixed(2)}</span>
            </div>
            <p class="text-[10px] text-neutral-500 italic">Çark üzerinde noktayı kaydırarak sinematik renk derecelendirmesini canlı uygulayın.</p>
          </div>
        </div>
      {:else}
        <div class="p-6 text-center text-neutral-400 text-xs rounded-xl bg-neutral-900/40 border border-white/5">
          Oklab Renk Çarkı ile canlı derecelendirme yapmak için lütfen zaman çizelgesinden bir video klibi seçin.
        </div>
      {/if}
    {:else}
      <!-- Presets Grid / Horizontal Scroll for Mobile -->
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
      {#each filteredPresets as preset (preset.id)}
        {@const isCurrent = selectedClip?.colorGrading?.lut === preset.grading.lut}
        <button
          onclick={() => applyPreset(preset.id)}
          class="p-2.5 rounded-xl border text-left transition-all cursor-pointer group relative overflow-hidden flex flex-col justify-between {isCurrent ? 'border-cyan-400 bg-cyan-950/30 shadow-[0_0_12px_rgba(34,211,238,0.25)]' : 'border-white/5 bg-neutral-950/80 hover:border-white/20'}"
        >
          <div>
            <!-- Gradient visual preview bar -->
            <div class="w-full h-7 rounded-lg mb-1.5 shadow-inner transition-transform group-hover:scale-[1.02]" style="background: {preset.previewGradient};"></div>
            
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-white group-hover:text-cyan-300 transition-colors truncate">{preset.name}</span>
              {#if isCurrent}
                <Check size={13} class="text-cyan-400 flex-none" />
              {/if}
            </div>
            <p class="text-[9px] text-neutral-400 mt-0.5 line-clamp-1">{preset.description}</p>
          </div>
        </button>
      {/each}
    </div>
    {/if}

    <!-- Quick Live Adjustment Sliders (When a clip is selected) -->
    {#if selectedClip}
      {@const grading = selectedClip.colorGrading || { brightness: 0, contrast: 1, saturation: 1, temperature: 0 }}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="p-2.5 rounded-xl bg-neutral-900/60 border border-white/5 space-y-2"
        onpointerup={commitColorParam}
        onpointercancel={commitColorParam}
      >
        <span class="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold block">Manuel İnce Ayar (Canlı Önizleme)</span>
        
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <!-- Exposure / Brightness -->
          <div class="flex flex-col gap-1 bg-neutral-950/60 p-2 rounded-lg border border-white/5">
            <div class="flex items-center justify-between text-[10px]">
              <span class="text-neutral-400 flex items-center gap-1"><Sun size={11} /> Pozlama</span>
              <span class="font-mono text-cyan-400">{(grading.brightness || 0).toFixed(2)}</span>
            </div>
            <input 
              type="range" 
              min="-0.5" 
              max="0.5" 
              step="0.02" 
              value={grading.brightness || 0}
              oninput={(e) => updateColorParam('brightness', parseFloat((e.target as HTMLInputElement).value))}
              class="accent-cyan-400 h-1 bg-neutral-800 rounded appearance-none cursor-pointer"
            />
          </div>

          <!-- Contrast -->
          <div class="flex flex-col gap-1 bg-neutral-950/60 p-2 rounded-lg border border-white/5">
            <div class="flex items-center justify-between text-[10px]">
              <span class="text-neutral-400 flex items-center gap-1"><Contrast size={11} /> Kontrast</span>
              <span class="font-mono text-purple-400">{(grading.contrast ?? 1).toFixed(2)}</span>
            </div>
            <input 
              type="range" 
              min="0.5" 
              max="1.8" 
              step="0.05" 
              value={grading.contrast ?? 1}
              oninput={(e) => updateColorParam('contrast', parseFloat((e.target as HTMLInputElement).value))}
              class="accent-purple-400 h-1 bg-neutral-800 rounded appearance-none cursor-pointer"
            />
          </div>

          <!-- Saturation -->
          <div class="flex flex-col gap-1 bg-neutral-950/60 p-2 rounded-lg border border-white/5">
            <div class="flex items-center justify-between text-[10px]">
              <span class="text-neutral-400 flex items-center gap-1"><Droplets size={11} /> Doygunluk</span>
              <span class="font-mono text-emerald-400">{(grading.saturation ?? 1).toFixed(2)}</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="2" 
              step="0.05" 
              value={grading.saturation ?? 1}
              oninput={(e) => updateColorParam('saturation', parseFloat((e.target as HTMLInputElement).value))}
              class="accent-emerald-400 h-1 bg-neutral-800 rounded appearance-none cursor-pointer"
            />
          </div>

          <!-- Temperature -->
          <div class="flex flex-col gap-1 bg-neutral-950/60 p-2 rounded-lg border border-white/5">
            <div class="flex items-center justify-between text-[10px]">
              <span class="text-neutral-400 flex items-center gap-1"><Thermometer size={11} /> Sıcaklık</span>
              <span class="font-mono text-amber-400">{(grading.temperature || 0).toFixed(2)}</span>
            </div>
            <input 
              type="range" 
              min="-0.5" 
              max="0.5" 
              step="0.02" 
              value={grading.temperature || 0}
              oninput={(e) => updateColorParam('temperature', parseFloat((e.target as HTMLInputElement).value))}
              class="accent-amber-400 h-1 bg-neutral-800 rounded appearance-none cursor-pointer"
            />
          </div>
        </div>
      </div>
    {/if}

  </div>
</div>
