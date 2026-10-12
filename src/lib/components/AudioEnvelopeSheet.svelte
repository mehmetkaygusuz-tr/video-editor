<script lang="ts">
  import { editor } from '../editor.svelte';
  import { 
    Volume2, VolumeX, Mic, Disc3, Sliders, 
    Sparkles, Check, X, ArrowUpRight, ArrowDownRight, Layers
  } from '@lucide/svelte';

  let selectedClip = $derived(editor.selectedClip);

  let fadeIn = $state<number>(0);
  let fadeOut = $state<number>(0);
  let ducking = $state<boolean>(false);
  let pitchShift = $state<number>(0);
  let eqPreset = $state<'flat' | 'voice-boost' | 'bass-boost' | 'podcast'>('flat');
  let lastSyncedClipId = $state<string | null>(null);

  $effect(() => {
    const currentId = selectedClip?.id ?? null;
    if (currentId !== lastSyncedClipId) {
      lastSyncedClipId = currentId;
      if (selectedClip) {
        fadeIn = selectedClip.audioEnvelope?.fadeIn ?? 0;
        fadeOut = selectedClip.audioEnvelope?.fadeOut ?? 0;
        ducking = selectedClip.audioEnvelope?.ducking ?? false;
        pitchShift = selectedClip.audioEnvelope?.pitchShift ?? 0;
        eqPreset = selectedClip.audioEnvelope?.eqPreset ?? 'flat';
      }
    }
  });

  function updateEnvelope() {
    if (!selectedClip) return;
    editor.updateClipAudioEnvelope(selectedClip.id, {
      fadeIn,
      fadeOut,
      ducking,
      pitchShift,
      eqPreset
    });
  }

  function handleFadeIn(val: number) {
    fadeIn = Number(val.toFixed(1));
    updateEnvelope();
  }

  function handleFadeOut(val: number) {
    fadeOut = Number(val.toFixed(1));
    updateEnvelope();
  }

  function toggleDucking() {
    ducking = !ducking;
    updateEnvelope();
    editor.triggerHaptic('light');
  }

  function setPitch(semitones: number) {
    pitchShift = semitones;
    updateEnvelope();
    editor.triggerHaptic('light');
  }

  function setEq(preset: 'flat' | 'voice-boost' | 'bass-boost' | 'podcast') {
    eqPreset = preset;
    updateEnvelope();
    editor.triggerHaptic('light');
  }
</script>

<div class="flex flex-col gap-3.5 text-white pb-6 select-none">
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-white/10 pb-3">
    <div class="flex items-center gap-2">
      <div class="p-2 bg-emerald-500/20 rounded-xl text-emerald-400 border border-emerald-500/30">
        <Volume2 size={18} />
      </div>
      <div>
        <h3 class="text-sm font-semibold tracking-wide">Gelişmiş Ses Zarfı & Mikser</h3>
        <p class="text-[11px] text-neutral-400">Fade In/Out, Akıllı Ducking ve Ses İyileştirme</p>
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
      Lütfen ses ayarlarını düzenlemek için önce bir klip seçin.
    </div>
  {:else}
    <!-- Volume Slider Main -->
    <div class="bg-neutral-900/80 p-3.5 rounded-2xl border border-white/10 space-y-2">
      <div class="flex justify-between text-xs">
        <span class="text-neutral-300 font-medium flex items-center gap-1.5">
          <Volume2 size={14} class="text-emerald-400" />
          Klip Ses Düzeyi
        </span>
        <span class="font-mono text-emerald-300 font-bold">{Math.round((selectedClip.volume ?? 1) * 100)}%</span>
      </div>
      <input 
        type="range"
        min="0"
        max="2.0"
        step="0.05"
        value={selectedClip.volume ?? 1}
        oninput={(e) => editor.setClipVolume(selectedClip.id, parseFloat((e.target as HTMLInputElement).value))}
        class="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
      />
    </div>

    <!-- Fade In / Fade Out Envelopes -->
    <div class="grid grid-cols-2 gap-2">
      <!-- Fade In -->
      <div class="bg-neutral-900/80 p-3 rounded-xl border border-white/10 space-y-1.5">
        <div class="flex justify-between items-center text-xs">
          <span class="text-neutral-300 flex items-center gap-1">
            <ArrowUpRight size={13} class="text-sky-400" /> Fade In
          </span>
          <span class="font-mono text-neutral-200">{fadeIn}s</span>
        </div>
        <input 
          type="range"
          min="0"
          max="3.0"
          step="0.1"
          value={fadeIn}
          oninput={(e) => handleFadeIn(parseFloat((e.target as HTMLInputElement).value))}
          class="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
        />
        <p class="text-[9px] text-neutral-400">Girişte yumuşak açılma</p>
      </div>

      <!-- Fade Out -->
      <div class="bg-neutral-900/80 p-3 rounded-xl border border-white/10 space-y-1.5">
        <div class="flex justify-between items-center text-xs">
          <span class="text-neutral-300 flex items-center gap-1">
            <ArrowDownRight size={13} class="text-amber-400" /> Fade Out
          </span>
          <span class="font-mono text-neutral-200">{fadeOut}s</span>
        </div>
        <input 
          type="range"
          min="0"
          max="3.0"
          step="0.1"
          value={fadeOut}
          oninput={(e) => handleFadeOut(parseFloat((e.target as HTMLInputElement).value))}
          class="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
        />
        <p class="text-[9px] text-neutral-400">Çıkışta yumuşak kapanma</p>
      </div>
    </div>

    <!-- Smart Auto-Ducking Switch -->
    <div class="bg-neutral-900/80 p-3 rounded-xl border border-white/10 flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="p-1.5 rounded-lg bg-neutral-800 text-indigo-400">
          <Mic size={16} />
        </div>
        <div>
          <span class="text-xs font-medium text-neutral-200">Akıllı Ducking (Konuşmada Arka Planı Kıs)</span>
          <p class="text-[10px] text-neutral-400">Konuşma algılandığında bu müziği otomatik -12dB kısar</p>
        </div>
      </div>
      <button 
        type="button"
        aria-label="Akıllı Ducking Aç/Kapat"
        onclick={toggleDucking}
        class="w-11 h-6 rounded-full p-0.5 transition-colors {ducking ? 'bg-indigo-500' : 'bg-neutral-700'}"
      >
        <div class="w-5 h-5 rounded-full bg-white transition-transform {ducking ? 'translate-x-5' : 'translate-x-0'}"></div>
      </button>
    </div>

    <!-- EQ Equalizer Presets -->
    <div class="space-y-1.5">
      <span class="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
        <Sliders size={13} class="text-emerald-400" />
        Ekolayzır & Ses Karakteri (EQ)
      </span>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {#each [
          { id: 'flat', name: 'Standart (Flat)' },
          { id: 'voice-boost', name: 'Net Vokal' },
          { id: 'bass-boost', name: 'Derin Bas' },
          { id: 'podcast', name: 'Podcast Stüdyo' }
        ] as eq}
          <button
            onclick={() => setEq(eq.id as any)}
            class="py-2 px-2.5 rounded-xl border text-[11px] font-medium transition-all text-center {eqPreset === eq.id ? 'bg-emerald-600 border-emerald-400 text-white font-semibold shadow-md' : 'bg-neutral-900/80 border-white/5 text-neutral-300 hover:bg-neutral-800'}"
          >
            {eq.name}
          </button>
        {/each}
      </div>
    </div>

    <!-- Done Button -->
    <button
      onclick={() => editor.closeBottomSheet()}
      class="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all active:scale-98 mt-1"
    >
      Ses Ayarlarını Tamamla
    </button>
  {/if}
</div>
