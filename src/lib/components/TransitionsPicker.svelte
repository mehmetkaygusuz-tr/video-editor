<script lang="ts">
  import { editor } from '../editor.svelte';
  import type { TransitionType } from '../types';
  import { 
    Shuffle, Check, Sliders, Sparkles, X, 
    ArrowRight, ArrowLeft, Maximize2, Eye, Sun
  } from '@lucide/svelte';

  let transitionDuration = $state(0.5);

  const availableTransitions: {
    id: TransitionType;
    name: string;
    description: string;
    icon: any;
    color: string;
  }[] = [
    {
      id: 'none',
      name: 'Yok (Düz Kesim)',
      description: 'Herhangi bir efekt olmadan doğrudan geçiş.',
      icon: X,
      color: 'bg-neutral-800 text-neutral-400'
    },
    {
      id: 'fade',
      name: 'Karartma (Fade)',
      description: 'Siyah üzerinden yumuşak solma ve aydınlanma.',
      icon: Sun,
      color: 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
    },
    {
      id: 'dissolve',
      name: 'Çapraz Çözünme (Dissolve)',
      description: 'İki klip birbirinin içine pürüzsüz karışır.',
      icon: Eye,
      color: 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
    },
    {
      id: 'wipe-left',
      name: 'Sola Süpürme (Wipe Left)',
      description: 'Yeni klip sağdan sola doğru kayarak açılır.',
      icon: ArrowLeft,
      color: 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
    },
    {
      id: 'wipe-right',
      name: 'Sağa Süpürme (Wipe Right)',
      description: 'Yeni klip soldan sağa doğru kayarak açılır.',
      icon: ArrowRight,
      color: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
    },
    {
      id: 'zoom-in',
      name: 'Yakınlaşma (Zoom In)',
      description: 'Dinamik ölçek büyüyerek yeni kareye geçer.',
      icon: Maximize2,
      color: 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
    }
  ];

  // Derive current transition of active cut
  const currentTransitionType = $derived.by(() => {
    if (!editor.activeTransitionCut) return 'none';
    const { trackId, nextClipId, prevClipId } = editor.activeTransitionCut;
    const track = editor.tracks.find(t => t.id === trackId);
    if (!track) return 'none';
    const nextClip = track.clips.find(c => c.id === nextClipId);
    const prevClip = track.clips.find(c => c.id === prevClipId);
    return nextClip?.transitionIn?.type || prevClip?.transitionOut?.type || 'none';
  });

  function selectTransition(type: TransitionType) {
    if (!editor.activeTransitionCut) return;
    const { trackId, prevClipId, nextClipId } = editor.activeTransitionCut;
    editor.applyTransitionToCut(trackId, prevClipId, nextClipId, type, transitionDuration);
  }

  function applyToAll() {
    if (!editor.activeTransitionCut) return;
    const { trackId } = editor.activeTransitionCut;
    editor.applyTransitionToAllCuts(trackId, currentTransitionType, transitionDuration);
  }
</script>

<div class="flex flex-col gap-4 text-white pb-6">
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-white/10 pb-3">
    <div class="flex items-center gap-2">
      <div class="p-2 bg-indigo-500/20 rounded-xl text-indigo-400 border border-indigo-500/30">
        <Shuffle size={18} />
      </div>
      <div>
        <h3 class="text-sm font-semibold tracking-wide">Görsel Geçiş Efektleri</h3>
        <p class="text-[11px] text-neutral-400">İki klip arasındaki kesme noktası için geçiş seçin</p>
      </div>
    </div>
    <button
      onclick={() => editor.closeBottomSheet()}
      class="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white"
    >
      <X size={16} />
    </button>
  </div>

  <!-- Duration Slider (CapCut / VN style slider) -->
  <div class="flex flex-col gap-1.5 bg-neutral-900/80 p-3 rounded-2xl border border-white/10">
    <div class="flex items-center justify-between text-xs">
      <span class="text-neutral-400 flex items-center gap-1.5 font-medium">
        <Sliders size={13} class="text-indigo-400" />
        Geçiş Süresi
      </span>
      <span class="font-mono text-white font-semibold">{transitionDuration.toFixed(1)} saniye</span>
    </div>
    <input 
      type="range"
      min="0.2"
      max="2.0"
      step="0.1"
      bind:value={transitionDuration}
      oninput={() => {
        if (currentTransitionType !== 'none') {
          selectTransition(currentTransitionType);
        }
      }}
      class="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
    />
    <div class="flex justify-between text-[9px] font-mono text-neutral-500">
      <span>0.2s</span>
      <span>1.0s</span>
      <span>2.0s</span>
    </div>
  </div>

  <!-- Transitions Grid -->
  <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
    {#each availableTransitions as t}
      {@const isSelected = currentTransitionType === t.id}
      <button
        onclick={() => selectTransition(t.id)}
        class="flex flex-col items-start p-3 rounded-2xl border transition-all text-left group relative {isSelected ? 'border-indigo-500 bg-indigo-950/40 shadow-lg shadow-indigo-500/10' : 'border-white/10 bg-neutral-900/50 hover:bg-neutral-900 hover:border-white/20'}"
      >
        <div class="flex items-center justify-between w-full mb-2">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center {t.color}">
            <t.icon size={16} />
          </div>
          {#if isSelected}
            <div class="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center">
              <Check size={12} strokeWidth={3} />
            </div>
          {/if}
        </div>
        <span class="text-xs font-semibold text-neutral-200 group-hover:text-white mb-0.5">{t.name}</span>
        <p class="text-[10px] text-neutral-400 leading-tight">{t.description}</p>
      </button>
    {/each}
  </div>

  <!-- Bottom Global Actions (CapCut style "Tümüne Uygula") -->
  <div class="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
    <button
      onclick={applyToAll}
      class="flex-1 py-2.5 px-4 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-xs font-medium text-neutral-200 hover:text-white transition-all flex items-center justify-center gap-1.5 active:scale-98"
    >
      <Sparkles size={14} class="text-amber-400" />
      <span>Tüm Kesimlere Uygula</span>
    </button>
    <button
      onclick={() => editor.closeBottomSheet()}
      class="py-2.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-98"
    >
      Tamam
    </button>
  </div>
</div>
