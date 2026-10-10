<script lang="ts">
  import { editor } from '../editor.svelte';
  import { aiService } from '../engine/aiService.svelte';
  import { 
    Scissors, Trash2, Volume2, FastForward, Sparkles, Layers, 
    Crop, FolderClosed, Music, Type, X, ChevronUp, ChevronDown,
    SlidersHorizontal, Copy, RefreshCw, ZoomIn, Eye, EyeOff, Shuffle,
    Gauge, Sliders, Palette, Zap, Undo2, Redo2, Magnet, Play, Pause
  } from '@lucide/svelte';

  let selectedClip = $derived(editor.getSelectedClip());

  // Quick speed options
  const speeds = [0.5, 1, 1.5, 2];

  let showVolumeSlider = $state(false);
  let showSpeedPicker = $state(false);

  // Close menus when selection changes
  $effect(() => {
    if (!editor.selectedClipId) {
      showVolumeSlider = false;
      showSpeedPicker = false;
    }
  });

  function handleSplit() {
    editor.splitClipAtPlayhead(editor.selectedClipId || undefined);
    editor.triggerHaptic('medium');
  }

  function handleDelete() {
    if (editor.selectedClipId) {
      editor.deleteClip(editor.selectedClipId);
      editor.triggerHaptic('heavy');
    }
  }

  function handleDuplicate() {
    editor.duplicateClip();
    editor.triggerHaptic('medium');
  }

  function handleVolumeChange(val: number) {
    if (editor.selectedClipId) {
      editor.setClipVolume(editor.selectedClipId, val);
    }
  }

  function handleSpeedSelect(speed: number) {
    if (editor.selectedClipId) {
      editor.setClipSpeed(editor.selectedClipId, speed);
      editor.triggerHaptic('light');
      showSpeedPicker = false;
    }
  }

  function toggleFocusMode() {
    editor.isTimelineCollapsed = !editor.isTimelineCollapsed;
    editor.triggerHaptic('light');
    editor.announce(editor.isTimelineCollapsed ? 'Odak Önizleme Modu Aktif' : 'Zaman Çizelgesi Genişletildi');
  }

  function toggleMagnetic() {
    editor.isMagnetic = !editor.isMagnetic;
    editor.triggerHaptic('light');
    editor.announce(editor.isMagnetic ? 'Manyetik kurgu açık' : 'Manyetik kurgu kapalı');
  }

  function formatTimecode(seconds: number): string {
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * 30);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }
</script>

<!-- 2026 Mobile Contextual Bottom Production Bar & Thumb Zone -->
<nav 
  class="@container w-full spatial-glass border-t border-white/10 flex flex-col items-center select-none z-30 transition-all duration-200 shadow-[0_-8px_32px_rgba(0,0,0,0.6)]"
  style="padding-bottom: max(8px, env(safe-area-inset-bottom, 0px));"
  aria-label="Mobil Kurgu ve Eylem Çubuğu"
>
  <!-- 1. Mobile Quick Utility Bar (Undo, Redo, Quick Split, Timecode, Snap, AI Director) -->
  <div class="w-full flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-neutral-950/40 text-xs">
    <!-- Left: Undo / Redo & Quick Split -->
    <div class="flex items-center gap-1">
      <button
        type="button"
        onclick={() => { editor.undo(); editor.triggerHaptic('light'); }}
        disabled={!editor.canUndo}
        class="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white disabled:opacity-25 active:scale-90 transition-all cursor-pointer"
        title="Geri Al"
      >
        <Undo2 size={14} />
      </button>

      <button
        type="button"
        onclick={() => { editor.redo(); editor.triggerHaptic('light'); }}
        disabled={!editor.canRedo}
        class="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white disabled:opacity-25 active:scale-90 transition-all cursor-pointer"
        title="Yinele"
      >
        <Redo2 size={14} />
      </button>

      <div class="w-px h-3.5 bg-white/10 mx-0.5"></div>

      <!-- Quick Razor Split at current playhead -->
      <button
        type="button"
        onclick={handleSplit}
        class="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/25 text-[11px] font-medium active:scale-95 transition-all cursor-pointer"
        title="İğne Konumundan Kes"
      >
        <Scissors size={12} />
        <span>Böl</span>
      </button>
    </div>

    <!-- Center: Timecode Badge with Live Indicator -->
    <div class="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 font-mono text-[11px] text-neutral-300 shadow-inner">
      <span class="w-1.5 h-1.5 rounded-full {editor.isPlaying ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'}"></span>
      <span>{formatTimecode(editor.playhead)}</span>
    </div>

    <!-- Right: Magnet Snap, AI Director & Focus Mode -->
    <div class="flex items-center gap-1">
      <!-- Magnetic Snapping -->
      <button
        type="button"
        onclick={toggleMagnetic}
        class="p-1.5 rounded-lg transition-colors cursor-pointer {editor.isMagnetic ? 'text-amber-400 bg-amber-500/15' : 'text-neutral-500 hover:text-neutral-300'}"
        title={editor.isMagnetic ? "Manyetik Yapışma Açık" : "Manyetik Yapışma Kapalı"}
      >
        <Magnet size={13} />
      </button>

      <!-- AI Copilot Trigger -->
      <button
        type="button"
        onclick={() => { editor.isCommandPaletteOpen = true; editor.triggerHaptic('light'); }}
        class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-purple-600/30 to-cyan-500/30 border border-purple-500/40 text-purple-200 text-[10px] font-semibold active:scale-95 transition-all cursor-pointer"
        title="AI Kurgu Asistanı (⌘K)"
      >
        <Sparkles size={11} class="text-purple-300" />
        <span>AI</span>
      </button>

      <!-- Focus Mode Toggle (Expand/Collapse Timeline) -->
      <button
        type="button"
        onclick={toggleFocusMode}
        class="p-1.5 rounded-lg transition-colors cursor-pointer {editor.isTimelineCollapsed ? 'text-purple-400 bg-purple-500/15' : 'text-neutral-500 hover:text-neutral-300'}"
        title={editor.isTimelineCollapsed ? "Zaman Çizelgesini Göster" : "Odak Önizleme Modu (Zaman Çizelgesini Gizle)"}
      >
        <Layers size={13} />
      </button>
    </div>
  </div>

  <!-- 2. Popover Sub-controls (Volume Slider & Speed Picker) -->
  {#if selectedClip && showVolumeSlider}
    <div class="w-full px-4 sm:px-6 py-2.5 bg-neutral-900/95 border-b border-white/10 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div class="flex items-center gap-2 text-xs font-medium text-neutral-300">
        <Volume2 size={15} class="text-emerald-400" />
        <span>Ses: {Math.round((selectedClip.volume ?? 1) * 100)}%</span>
      </div>
      <input 
        type="range" 
        min="0" 
        max="2" 
        step="0.05" 
        value={selectedClip.volume ?? 1}
        oninput={(e) => handleVolumeChange(parseFloat((e.target as HTMLInputElement).value))}
        class="flex-1 max-w-xs accent-emerald-500 h-1.5 bg-neutral-800 rounded appearance-none cursor-pointer"
      />
      <button
        onclick={() => {
          showVolumeSlider = false;
          editor.openBottomSheet('audio_envelope');
        }}
        class="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-emerald-500/30 bg-neutral-800 text-emerald-300 hover:bg-neutral-700 transition-colors"
        title="Fade In/Out ve Akıllı Ducking"
      >
        <Sliders size={12} />
        <span>Gelişmiş Zarf</span>
      </button>
      <button 
        onclick={() => showVolumeSlider = false}
        class="p-1 rounded-full text-neutral-500 hover:text-white"
        title="Kapat"
      >
        <X size={14} />
      </button>
    </div>
  {/if}

  {#if selectedClip && showSpeedPicker}
    <div class="w-full px-4 sm:px-6 py-2.5 bg-neutral-900/95 border-b border-white/10 flex items-center justify-between gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div class="flex items-center gap-2 text-xs font-medium text-neutral-300">
        <FastForward size={15} class="text-amber-400" />
        <span>Hız:</span>
      </div>
      <div class="flex items-center gap-1.5 overflow-x-auto">
        {#each speeds as spd}
          <button 
            onclick={() => handleSpeedSelect(spd)}
            class="px-3 py-1 rounded-full text-xs font-mono font-medium transition-colors {(selectedClip.speed ?? 1) === spd && !selectedClip.speedCurve ? 'bg-amber-400 text-neutral-950 font-bold' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}"
          >
            {spd}x
          </button>
        {/each}
        <button
          onclick={() => {
            showSpeedPicker = false;
            editor.openBottomSheet('speed_curve');
          }}
          class="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors {selectedClip.speedCurve ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-bold' : 'bg-neutral-800 border-amber-500/30 text-amber-300 hover:bg-neutral-700'}"
          title="Kavisli Hız Eğrisi (Speed Ramping)"
        >
          <Gauge size={13} />
          <span>Eğri {selectedClip.speedCurve ? `(${selectedClip.speedCurve.preset})` : ''}</span>
        </button>
      </div>
      <button 
        onclick={() => showSpeedPicker = false}
        class="p-1 rounded-full text-neutral-500 hover:text-white"
        title="Kapat"
      >
        <X size={14} />
      </button>
    </div>
  {/if}

  <!-- 3. Main Horizontal Thumb-Zone Strip with Horizontal Edge Fade Mask -->
  <div 
    class="w-full max-w-3xl flex items-center justify-between px-2 sm:px-4 py-1.5 overflow-hidden relative"
    style="mask-image: linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent); -webkit-mask-image: linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent);"
  >
    {#if selectedClip && editor.mobileWorkspace === 'timeline'}
      <!-- MODE A: CLIP SELECTED ACTIONS (Contextual Editing) -->
      <div class="flex items-center gap-1 overflow-x-auto w-full px-2 py-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] touch-pan-x">
        <!-- 1. Deselect button -->
        <button 
          onclick={() => { editor.selectClip(null); editor.triggerHaptic('light'); }}
          class="flex flex-col items-center justify-center min-w-[54px] h-12 rounded-xl text-neutral-400 hover:text-white hover:bg-white/5 active:scale-95 transition-all flex-none"
          title="Seçimi Kaldır"
        >
          <X size={18} />
          <span class="text-[10px] mt-1 font-medium">Bitti</span>
        </button>

        <div class="w-px h-6 bg-white/10 mx-0.5 flex-none"></div>

        <!-- 2. Split / Razor -->
        <button 
          onclick={handleSplit}
          class="flex flex-col items-center justify-center min-w-[56px] h-12 rounded-xl text-neutral-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all flex-none"
          title="Klibi İğne Konumundan Böl (C)"
        >
          <Scissors size={18} class="text-sky-400" />
          <span class="text-[10px] mt-1 font-medium">Böl</span>
        </button>

        <!-- 3. Inspector Sheet Trigger -->
        <button 
          onclick={() => { editor.openBottomSheet('inspector'); editor.triggerHaptic('medium'); }}
          class="flex flex-col items-center justify-center min-w-[58px] h-12 rounded-xl text-purple-300 hover:text-white hover:bg-purple-500/10 active:scale-95 transition-all flex-none"
          title="Tüm Klip Detayları & Müfettiş"
        >
          <Sliders size={18} class="text-purple-400" />
          <span class="text-[10px] mt-1 font-medium">Müfettiş</span>
        </button>

        <!-- 4. Speed control popover toggle -->
        <button 
          onclick={() => { showSpeedPicker = !showSpeedPicker; showVolumeSlider = false; editor.triggerHaptic('light'); }}
          class="flex flex-col items-center justify-center min-w-[56px] h-12 rounded-xl transition-all active:scale-95 flex-none {showSpeedPicker ? 'bg-white/10 text-white' : 'text-neutral-200 hover:text-white hover:bg-white/5'}"
          title="Oynatma Hızı"
        >
          <FastForward size={18} class="text-amber-400" />
          <span class="text-[10px] mt-1 font-medium font-mono">{selectedClip.speed ?? 1}x</span>
        </button>

        <!-- 5. Volume control popover toggle -->
        <button 
          onclick={() => { showVolumeSlider = !showVolumeSlider; showSpeedPicker = false; editor.triggerHaptic('light'); }}
          class="flex flex-col items-center justify-center min-w-[56px] h-12 rounded-xl transition-all active:scale-95 flex-none {showVolumeSlider ? 'bg-white/10 text-white' : 'text-neutral-200 hover:text-white hover:bg-white/5'}"
          title="Ses Seviyesi"
        >
          <Volume2 size={18} class="text-emerald-400" />
          <span class="text-[10px] mt-1 font-medium font-mono">{Math.round((selectedClip.volume ?? 1) * 100)}%</span>
        </button>

        <!-- 6. Speed Curve (Direct Sheet Trigger) -->
        <button 
          onclick={() => {
            showSpeedPicker = false;
            showVolumeSlider = false;
            editor.openBottomSheet('speed_curve');
            editor.triggerHaptic('light');
          }}
          class="flex flex-col items-center justify-center min-w-[58px] h-12 rounded-xl text-neutral-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all flex-none"
          title="Hız Eğrisi (Speed Ramping)"
        >
          <Gauge size={17} class="text-amber-400" />
          <span class="text-[10px] mt-1 font-medium">Hız Eğrisi</span>
        </button>

        <!-- 7. Audio Envelope (Direct Sheet Trigger) -->
        <button 
          onclick={() => {
            showSpeedPicker = false;
            showVolumeSlider = false;
            editor.openBottomSheet('audio_envelope');
            editor.triggerHaptic('light');
          }}
          class="flex flex-col items-center justify-center min-w-[58px] h-12 rounded-xl text-neutral-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all flex-none"
          title="Ses Zarfı & Ducking (Fade In/Out)"
        >
          <Sliders size={17} class="text-emerald-400" />
          <span class="text-[10px] mt-1 font-medium">Ses Zarfı</span>
        </button>

        <!-- 8. Subtitle Style -->
        <button 
          onclick={() => {
            editor.openBottomSheet('subtitle_style');
            editor.triggerHaptic('light');
          }}
          class="flex flex-col items-center justify-center min-w-[58px] h-12 rounded-xl text-neutral-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all flex-none"
          title="Altyazı & Tipografi Stili (TikTok / Karaoke / Reels)"
        >
          <Type size={17} class="text-purple-400" />
          <span class="text-[10px] mt-1 font-medium">Yazı Stili</span>
        </button>

        <!-- 9. Transitions -->
        <button 
          onclick={() => {
            const track = editor.tracks.find(t => t.id === selectedClip.trackId);
            if (track) {
              const sorted = [...track.clips].sort((a, b) => a.startAt - b.startAt);
              const idx = sorted.findIndex(c => c.id === selectedClip.id);
              const nextClip = sorted[idx + 1];
              const prevClip = sorted[idx - 1];
              if (nextClip) {
                editor.openTransitionPicker(track.id, selectedClip.id, nextClip.id);
              } else if (prevClip) {
                editor.openTransitionPicker(track.id, prevClip.id, selectedClip.id);
              } else {
                editor.openBottomSheet('transitions');
              }
            } else {
              editor.openBottomSheet('transitions');
            }
            editor.triggerHaptic('light');
          }}
          class="flex flex-col items-center justify-center min-w-[56px] h-12 rounded-xl text-neutral-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all flex-none"
          title="Geçiş Efekti Ekle"
        >
          <Shuffle size={17} class="text-indigo-400" />
          <span class="text-[10px] mt-1 font-medium">Geçiş</span>
        </button>

        <!-- 10. Filter Presets (Oklab LUT) -->
        <button
          onclick={() => { editor.openBottomSheet('filters'); editor.triggerHaptic('light'); }}
          class="flex flex-col items-center justify-center min-w-[56px] h-12 rounded-xl text-neutral-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all flex-none"
          title="Renk Filtreleri & LUT"
        >
          <Palette size={17} class="text-cyan-400" />
          <span class="text-[10px] mt-1 font-medium">Filtre</span>
        </button>

        <!-- 11. Duplicate -->
        <button 
          onclick={handleDuplicate}
          class="flex flex-col items-center justify-center min-w-[56px] h-12 rounded-xl text-neutral-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all flex-none"
          title="Klibi Çoğalt"
        >
          <Copy size={17} class="text-indigo-400" />
          <span class="text-[10px] mt-1 font-medium">Çoğalt</span>
        </button>

        <!-- 12. AI BG Remove -->
        <button 
          onclick={() => { aiService.removeBackground(selectedClip.id); editor.triggerHaptic('medium'); }}
          class="flex flex-col items-center justify-center min-w-[66px] h-12 rounded-xl text-neutral-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all flex-none"
          title="Arka Planı Kaldır (WebGPU)"
        >
          <Layers size={18} class={selectedClip.isBgRemoved ? 'text-emerald-400' : 'text-indigo-400'} />
          <span class="text-[10px] mt-1 font-medium">{selectedClip.isBgRemoved ? 'Arka Plan ✓' : 'Arka Plan'}</span>
        </button>

        <!-- 13. AI Auto Reframe -->
        <button 
          onclick={() => { aiService.autoReframe(selectedClip.id); editor.triggerHaptic('medium'); }}
          class="flex flex-col items-center justify-center min-w-[62px] h-12 rounded-xl text-neutral-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all flex-none"
          title="9:16 Odaklama (Auto Reframe)"
        >
          <Crop size={18} class="text-rose-400" />
          <span class="text-[10px] mt-1 font-medium">Reframe</span>
        </button>

        <!-- 14. Delete -->
        <button 
          onclick={handleDelete}
          class="flex flex-col items-center justify-center min-w-[56px] h-12 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-500/10 active:scale-95 transition-all ml-auto flex-none"
          title="Klibi Sil"
        >
          <Trash2 size={18} />
          <span class="text-[10px] mt-1 font-medium">Sil</span>
        </button>
      </div>

    {:else}
      <!-- MODE B: GLOBAL PRODUCTION DOCK (No Clip Selected) -->
      <div class="flex items-center gap-1.5 overflow-x-auto w-full px-2 py-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] touch-pan-x">
        <!-- 1. Kurgu / Timeline -->
        <button 
          onclick={() => { editor.mobileWorkspace = 'timeline'; editor.selectClip(null); editor.triggerHaptic('light'); }}
          class="relative flex flex-col items-center justify-center min-w-[58px] h-12 rounded-xl transition-all active:scale-95 flex-none {editor.mobileWorkspace === 'timeline' ? 'text-white bg-white/10 font-bold' : 'text-neutral-400 hover:text-white hover:bg-white/5'}"
          title="Zaman Çizelgesine Dön"
        >
          <Layers size={18} class={editor.mobileWorkspace === 'timeline' ? 'text-sky-400' : ''} />
          <span class="text-[10px] mt-1 font-medium">Kurgu</span>
          {#if editor.mobileWorkspace === 'timeline'}
            <div class="absolute bottom-1 w-3 h-0.5 bg-sky-400 rounded-full shadow-[0_0_6px_#38bdf8]"></div>
          {/if}
        </button>

        <!-- 2. Medya Havuzu -->
        <button 
          onclick={() => { editor.mobileWorkspace = 'media'; editor.activeSidebarTab = 'media'; editor.triggerHaptic('light'); }}
          class="relative flex flex-col items-center justify-center min-w-[58px] h-12 rounded-xl transition-all active:scale-95 flex-none {editor.mobileWorkspace === 'media' ? 'text-white bg-blue-500/15 border border-blue-500/25 font-bold' : 'text-neutral-400 hover:text-white hover:bg-white/5'}"
          title="Medya Ekle / Yönet"
        >
          <FolderClosed size={18} class={editor.mobileWorkspace === 'media' ? 'text-blue-400' : ''} />
          <span class="text-[10px] mt-1 font-medium">Medya</span>
          {#if editor.mobileWorkspace === 'media'}
            <div class="absolute bottom-1 w-3 h-0.5 bg-blue-400 rounded-full shadow-[0_0_6px_#60a5fa]"></div>
          {/if}
        </button>

        <!-- 3. AI Sihirbazı / Üretim Merkezi -->
        <button 
          onclick={() => { editor.mobileWorkspace = 'ai'; editor.activeSidebarTab = 'ai'; editor.triggerHaptic('medium'); }}
          class="relative flex flex-col items-center justify-center min-w-[64px] h-12 rounded-xl transition-all active:scale-95 flex-none {editor.mobileWorkspace === 'ai' ? 'text-white bg-purple-500/20 border border-purple-500/35 font-bold shadow-[0_0_12px_rgba(168,85,247,0.3)]' : 'text-purple-300 hover:text-white hover:bg-purple-500/10'}"
          title="Yapay Zeka Araçları (WebGPU)"
        >
          <Sparkles size={18} class="text-purple-400" />
          <span class="text-[10px] mt-1 font-semibold">AI Stüdyo</span>
          {#if editor.mobileWorkspace === 'ai'}
            <div class="absolute bottom-1 w-3 h-0.5 bg-purple-400 rounded-full shadow-[0_0_6px_#c084fc]"></div>
          {/if}
        </button>

        <!-- 4. Sinematik Renk Filtreleri (Oklab LUT) -->
        <button 
          onclick={() => { editor.openBottomSheet('filters'); editor.triggerHaptic('light'); }}
          class="relative flex flex-col items-center justify-center min-w-[58px] h-12 rounded-xl transition-all active:scale-95 text-neutral-400 hover:text-white hover:bg-white/5 flex-none"
          title="Renk Filtreleri & LUT Kütüphanesi"
        >
          <Palette size={18} class="text-cyan-400" />
          <span class="text-[10px] mt-1 font-medium">Filtre</span>
        </button>

        <!-- 5. Altyazı & Metin -->
        <button 
          onclick={() => { editor.mobileWorkspace = 'captions'; editor.activeSidebarTab = 'captions'; editor.triggerHaptic('light'); }}
          class="relative flex flex-col items-center justify-center min-w-[58px] h-12 rounded-xl transition-all active:scale-95 flex-none {editor.mobileWorkspace === 'captions' ? 'text-white bg-amber-500/15 border border-amber-500/25 font-bold' : 'text-neutral-400 hover:text-white hover:bg-white/5'}"
          title="Otomatik Altyazı & Seslendirme"
        >
          <Type size={18} class={editor.mobileWorkspace === 'captions' ? 'text-amber-400' : ''} />
          <span class="text-[10px] mt-1 font-medium">Altyazı</span>
          {#if editor.mobileWorkspace === 'captions'}
            <div class="absolute bottom-1 w-3 h-0.5 bg-amber-400 rounded-full shadow-[0_0_6px_#fbbf24]"></div>
          {/if}
        </button>

        <!-- 6. Kurgu Şablonları -->
        <button 
          onclick={() => { editor.mobileWorkspace = 'templates'; editor.activeSidebarTab = 'templates'; editor.triggerHaptic('light'); }}
          class="relative flex flex-col items-center justify-center min-w-[60px] h-12 rounded-xl transition-all active:scale-95 flex-none {editor.mobileWorkspace === 'templates' ? 'text-white bg-pink-500/15 border border-pink-500/25 font-bold' : 'text-neutral-400 hover:text-white hover:bg-white/5'}"
          title="Sihirli Kurgu Şablonları (TikTok, Beats, Sinematik)"
        >
          <Zap size={18} class={editor.mobileWorkspace === 'templates' ? 'text-pink-400' : ''} />
          <span class="text-[10px] mt-1 font-medium">Şablonlar</span>
          {#if editor.mobileWorkspace === 'templates'}
            <div class="absolute bottom-1 w-3 h-0.5 bg-pink-400 rounded-full shadow-[0_0_6px_#f472b6]"></div>
          {/if}
        </button>

        <!-- 7. Ayarlar -->
        <button 
          onclick={() => { editor.isSettingsModalOpen = true; editor.triggerHaptic('light'); }}
          class="relative flex flex-col items-center justify-center min-w-[56px] h-12 rounded-xl text-neutral-400 hover:text-white hover:bg-white/5 transition-all active:scale-95 ml-auto flex-none"
          title="Proje ve Donanım Ayarları"
        >
          <SlidersHorizontal size={18} class="text-emerald-400" />
          <span class="text-[10px] mt-1 font-medium">Ayarlar</span>
        </button>
      </div>
    {/if}
  </div>
</nav>
