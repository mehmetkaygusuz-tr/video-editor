<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { editor } from './lib/editor.svelte';
  import type { TimelineClip } from './lib/types';
  import { updateAudioEngine, ensureAudioUnlocked } from './lib/audio';
  import { masterAudioClock } from './lib/engine/audioClock';
  import { getFileFromOPFS } from './lib/opfs';
  import { engine } from './lib/engine/orchestrator.svelte';
  import { engineState } from './lib/engine/engineState.svelte';
  import { aiService } from './lib/engine/aiService.svelte';
  import { appState } from './lib/appState.svelte';
  import StudioSidebar from './lib/components/StudioSidebar.svelte';
  import BottomSheet from './lib/components/BottomSheet.svelte';
  import Timeline from './lib/components/Timeline.svelte';
  import BottomBar from './lib/components/BottomBar.svelte';
  import ExportModal from './lib/components/ExportModal.svelte';
  import TransitionsPicker from './lib/components/TransitionsPicker.svelte';
  import SubtitleStyleSheet from './lib/components/SubtitleStyleSheet.svelte';
  import SpeedCurveSheet from './lib/components/SpeedCurveSheet.svelte';
  import AudioEnvelopeSheet from './lib/components/AudioEnvelopeSheet.svelte';
  import Omnibar from './lib/components/Omnibar.svelte';
  import SettingsModal from './lib/components/SettingsModal.svelte';
  import FiltersSheet from './lib/components/FiltersSheet.svelte';
  import AIControlCenter from './lib/components/AIControlCenter.svelte';
  import { 
    Sparkles, Download, Play, Pause, 
    SkipBack, SkipForward, Image as ImageIcon, Scissors, 
    Trash as Trash2, X, Undo2, Redo2, FastForward, Volume2, Layers, Crop, FolderClosed,
    SlidersHorizontal as Sliders, Monitor, CircleQuestionMark as HelpCircle, RefreshCw,
    Maximize2, Minimize2, Type, Zap, Cpu, RotateCcw, Magnet, ZoomIn, ZoomOut, Music,
    ChevronDown, ChevronUp, ChevronLeft, ChevronRight
  } from '@lucide/svelte';

  let canvasRef = $state<HTMLCanvasElement | undefined>();

  let timelineHeightClass = $derived.by(() => {
    if (editor.isTimelineCollapsed) {
      return 'h-0 min-h-0 border-t-0 lg:border-none opacity-0';
    }
    if (editor.mobileWorkspace === 'filters') {
      return editor.isBottomPanelExpanded
        ? 'h-[48vh] lg:h-[42vh] min-h-[310px] opacity-100 flex flex-col'
        : 'h-[32vh] lg:h-[28vh] min-h-[190px] opacity-100 flex flex-col';
    }
    const count = editor.tracks.length;
    if (count === 0) {
      return 'h-[125px] min-h-[125px] opacity-100 flex flex-col';
    }
    if (count === 1) {
      return 'h-[140px] min-h-[140px] opacity-100 flex flex-col';
    }
    if (count === 2) {
      return 'h-[185px] min-h-[185px] opacity-100 flex flex-col';
    }
    if (count === 3) {
      return 'h-[235px] min-h-[235px] opacity-100 flex flex-col';
    }
    return 'h-[280px] lg:h-[30vh] min-h-[240px] max-h-[35vh] opacity-100 flex flex-col';
  });

  let selectedClip = $derived(editor.getSelectedClip());

  // Real-time active subtitle overlay based on playhead with word highlighting
  let activeSubtitleInfo = $derived.by(() => {
    for (const track of editor.tracks) {
      for (const clip of track.clips) {
        if (editor.playhead >= clip.startAt && editor.playhead <= clip.startAt + clip.duration) {
          if (clip.subtitles && clip.subtitles.length > 0) {
            const timeInClip = editor.playhead - clip.startAt;
            const sub = clip.subtitles.find(s => timeInClip >= s.start && timeInClip <= s.end);
            if (sub) {
              const subDuration = Math.max(0.1, sub.end - sub.start);
              const progress = Math.max(0, Math.min(1, (timeInClip - sub.start) / subDuration));
              const words = sub.words || sub.text.split(' ').map((w, idx, arr) => {
                const wDuration = subDuration / arr.length;
                return {
                  word: w,
                  start: sub.start + idx * wDuration,
                  end: sub.start + (idx + 1) * wDuration
                };
              });
              const activeWordIndex = Math.min(words.length - 1, Math.floor(progress * words.length));
              return {
                clipId: clip.id,
                sub,
                words,
                activeWordIndex,
                style: { ...editor.globalSubtitleStyle, ...clip.subtitleStyle }
              };
            }
          }
        }
      }
    }
    return null;
  });

  let activeSubtitleText = $derived(activeSubtitleInfo?.sub.text || '');

  let isFullscreen = $state(false);
  let monitorContainerRef = $state<HTMLDivElement | undefined>();
  let monitorFeedback = $state<'play' | 'pause' | null>(null);

  // Touch gesture states for monitor
  let lastTapTime = 0;
  let singleTapTimeout: any;
  let isPinchingMonitor = false;
  let initialMonitorPinchDist = 0;
  let initialCanvasScale = 1;
  let canvasScale = $state(1);
  let activeMonitorPointers = new Map<number, PointerEvent>();

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    editor.triggerHaptic('medium');
    editor.announce(isFullscreen ? 'Tam ekran önizleme açık' : 'Tam ekrandan çıkıldı');
  }

  function handleMonitorPointerDown(e: PointerEvent) {
    if (!monitorContainerRef) return;
    monitorContainerRef.setPointerCapture(e.pointerId);
    activeMonitorPointers.set(e.pointerId, e);

    if (activeMonitorPointers.size === 2) {
      // 2 fingers: pinch to scale
      clearTimeout(singleTapTimeout);
      isPinchingMonitor = true;
      const pts = Array.from(activeMonitorPointers.values());
      initialMonitorPinchDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      initialCanvasScale = canvasScale;
    }
  }

  function handleMonitorPointerMove(e: PointerEvent) {
    if (!activeMonitorPointers.has(e.pointerId)) return;
    activeMonitorPointers.set(e.pointerId, e);

    if (isPinchingMonitor && activeMonitorPointers.size === 2) {
      const pts = Array.from(activeMonitorPointers.values());
      const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      if (initialMonitorPinchDist > 0) {
        const factor = dist / initialMonitorPinchDist;
        canvasScale = Math.max(0.5, Math.min(3, initialCanvasScale * factor));
      }
    }
  }

  function handleMonitorPointerUp(e: PointerEvent) {
    activeMonitorPointers.delete(e.pointerId);
    if (monitorContainerRef && monitorContainerRef.hasPointerCapture(e.pointerId)) {
      try { monitorContainerRef.releasePointerCapture(e.pointerId); } catch (_) {}
    }

    if (isPinchingMonitor) {
      if (activeMonitorPointers.size < 2) {
        isPinchingMonitor = false;
        editor.triggerHaptic('light');
      }
      return;
    }

    // Double-tap vs single-tap detection
    const now = performance.now();
    const timeDiff = now - lastTapTime;

    if (timeDiff < 280) {
      // DOUBLE TAP: Toggle Fullscreen
      clearTimeout(singleTapTimeout);
      lastTapTime = 0;
      toggleFullscreen();
    } else {
      // SINGLE TAP: Toggle Play/Pause after debounce
      lastTapTime = now;
      singleTapTimeout = setTimeout(() => {
        editor.togglePlayback();
        editor.triggerHaptic('light');
        monitorFeedback = editor.isPlaying ? 'play' : 'pause';
        setTimeout(() => { monitorFeedback = null; }, 500);
      }, 290);
    }
  }

  function resetCanvasScale() {
    canvasScale = 1;
    editor.triggerHaptic('light');
  }

  function formatTimecode(seconds: number, fps = 30): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * fps);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    const target = document.activeElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as HTMLElement).isContentEditable)) {
      return;
    }

    // Ctrl+K / Cmd+K: Open AI Command Palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      editor.isCommandPaletteOpen = !editor.isCommandPaletteOpen;
      return;
    }

    // Ctrl+Z / Cmd+Z / Ctrl+Y
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      editor.redo();
      return;
    }

    // Space: Play / Pause
    if (e.code === 'Space') {
      e.preventDefault();
      editor.togglePlayback();
      return;
    }

    // J-K-L Shuttle
    if (e.key.toLowerCase() === 'j') {
      e.preventDefault();
      editor.stepPlayhead(-0.5);
      editor.triggerHaptic('light');
      return;
    }
    if (e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (editor.isPlaying) editor.togglePlayback();
      return;
    }
    if (e.key.toLowerCase() === 'l') {
      e.preventDefault();
      editor.stepPlayhead(0.5);
      editor.triggerHaptic('light');
      return;
    }

    // C: Split / Razor at playhead
    if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      editor.splitClipAtPlayhead();
      return;
    }

    // Q: Ripple trim head
    if (e.key.toLowerCase() === 'q') {
      e.preventDefault();
      editor.rippleTrimHead();
      return;
    }

    // W: Ripple trim tail
    if (e.key.toLowerCase() === 'w') {
      e.preventDefault();
      editor.rippleTrimTail();
      return;
    }

    // Escape: Exit fullscreen or deselect
    if (e.key === 'Escape') {
      if (isFullscreen) {
        isFullscreen = false;
        return;
      }
      editor.selectClip(null);
      return;
    }

    // Delete / Backspace: delete clip
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editor.selectedClipId) {
        e.preventDefault();
        editor.deleteClip();
      }
      return;
    }
  }

  $effect(() => {
    // Evict deleted assets from timelineFileCache to free RAM
    const activeAssetNames = new Set(editor.assets.map(a => a.name));
    for (const name of timelineFileCache.keys()) {
      if (!activeAssetNames.has(name)) {
        timelineFileCache.delete(name);
      }
    }
  });

  let lastTime = performance.now();
  let playLoopId: number;
  const timelineFileCache = new Map<string, File>();
  let isSeekingVideo = false;
  let lastVideoSeekTime = -1;
  let pendingSeek: { pts: number; isPlaying: boolean } | null = null;

  async function seekAndRenderVideoFrame(videoPTS: number, isPlaying: boolean) {
    if (isSeekingVideo) {
      pendingSeek = { pts: videoPTS, isPlaying };
      return;
    }

    // Advanced Multi-Track & Transition Search
    let activeClips: TimelineClip[] = [];
    for (const track of editor.tracks) {
      for (const clip of track.clips) {
        if (clip.type === 'video' || clip.type === 'image' || (!clip.type && !track.name.startsWith('A'))) {
          if (videoPTS >= clip.startAt && videoPTS <= clip.startAt + clip.duration) {
            activeClips.push(clip);
          }
        }
      }
    }

    if (activeClips.length === 1) {
      const clip = activeClips[0];
      const track = editor.tracks.find(t => t.id === clip.trackId);
      if (track) {
        if (clip.transitionOut && videoPTS > clip.startAt + clip.duration - clip.transitionOut.duration) {
          const nextClip = track.clips.find(c => c.startAt === clip.startAt + clip.duration);
          if (nextClip) activeClips.unshift(nextClip);
        } else if (clip.transitionIn && videoPTS < clip.startAt + clip.transitionIn.duration) {
          const prevClip = track.clips.find(c => c.startAt + c.duration === clip.startAt);
          if (prevClip) activeClips.push(prevClip);
        }
      }
    }

    activeClips = activeClips.reverse();
    const topClip = activeClips[0];
    const bottomClip = activeClips[1];

    if (topClip) {
      const speed1 = topClip.speed ?? 1.0;
      const targetTime1 = (topClip.sourceOffset || 0) + (videoPTS - topClip.startAt) * speed1;

      let targetTime2 = 0;
      let transition: { type: string; progress: number } | null = null;

      if (bottomClip) {
        const speed2 = bottomClip.speed ?? 1.0;
        targetTime2 = (bottomClip.sourceOffset || 0) + (videoPTS - bottomClip.startAt) * speed2;
        if (topClip.transitionIn && videoPTS < topClip.startAt + topClip.transitionIn.duration) {
          const p = (videoPTS - topClip.startAt) / topClip.transitionIn.duration;
          transition = { type: topClip.transitionIn.type, progress: Math.max(0, Math.min(1, p)) };
        } else if (bottomClip.transitionOut && videoPTS > bottomClip.startAt + bottomClip.duration - bottomClip.transitionOut.duration) {
          const p = 1.0 - ((bottomClip.startAt + bottomClip.duration - videoPTS) / bottomClip.transitionOut.duration);
          transition = { type: bottomClip.transitionOut.type, progress: Math.max(0, Math.min(1, p)) };
        }
      }

      if (Math.abs(targetTime1 - lastVideoSeekTime) >= (isPlaying ? 0.025 : 0.002) || lastVideoSeekTime < 0) {
        const asset1 = editor.assets.find(a => a.id === topClip.assetId) || editor.assets.find(a => a.name === topClip.name);
        const asset2 = bottomClip ? (editor.assets.find(a => a.id === bottomClip.assetId) || editor.assets.find(a => a.name === bottomClip.name)) : null;

        if (asset1) {
          isSeekingVideo = true;
          try {
            const getFile = async (asset: any) => {
              if (!asset) return null;
              let f = editor.getCachedFile(asset.name) || timelineFileCache.get(asset.name) || null;
              if (!f && asset.fileHandle) {
                try {
                  f = await asset.fileHandle.getFile();
                  if (f) {
                    timelineFileCache.set(asset.name, f);
                    editor.setCachedFile(asset.name, f);
                  }
                } catch (_) {}
              }
              if (!f) {
                f = (await getFileFromOPFS(asset.name)) || null;
                if (f) {
                  timelineFileCache.set(asset.name, f);
                  editor.setCachedFile(asset.name, f);
                }
              }
              if (!f && asset.blobUrl) {
                try {
                  const res = await fetch(asset.blobUrl);
                  const blob = await res.blob();
                  f = new File([blob], asset.name, { type: 'video/mp4' });
                  timelineFileCache.set(asset.name, f);
                  editor.setCachedFile(asset.name, f);
                } catch (_) {}
              }
              return f;
            };

            const [file1, file2] = await Promise.all([getFile(asset1), getFile(asset2)]);
            if (file1) {
              lastVideoSeekTime = targetTime1;
              const clip1Info = { file: file1, time: targetTime1, grading: topClip.colorGrading };
              const clip2Info = (file2 && bottomClip) ? { file: file2, time: targetTime2, grading: bottomClip.colorGrading } : null;
              const seekMode = isPlaying ? 'exact' : (editor.isScrubbing && editor.scrubbingMode === 'adaptive' ? 'fast_keyframe' : editor.scrubbingMode);
              await engine.seekFrameWithTransition(clip1Info, clip2Info, transition, { mode: seekMode });
              if (isPlaying) {
                masterAudioClock.recordVideoDrift(videoPTS);
              }
            }
          } finally {
            isSeekingVideo = false;
            if (pendingSeek) {
              const next = pendingSeek;
              pendingSeek = null;
              seekAndRenderVideoFrame(next.pts, next.isPlaying);
            }
          }
        }
      }
    }
  }

  function playLoop() {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    
    if (editor.isPlaying) {
      const masterTime = masterAudioClock.getCurrentTime();
      editor.playhead = masterTime;
      if (editor.playhead >= editor.duration) {
        editor.playhead = editor.duration;
        editor.togglePlayback();
      }
      
      // Hardware latency-compensated video presentation time (Master Audio Clock)
      const videoPTS = masterAudioClock.getVideoPresentationTime(editor.playhead);
      editor.updateAudioClockTelemetry(masterAudioClock.getTelemetry());
      seekAndRenderVideoFrame(videoPTS, true);
    } else {
      editor.updateAudioClockTelemetry(masterAudioClock.getTelemetry());
      // Render frame when paused so canvas displays image accurately without needing to play
      seekAndRenderVideoFrame(editor.playhead, false);
    }
    
    playLoopId = requestAnimationFrame(playLoop);
  }

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeydown);
    lastTime = performance.now();
    playLoopId = requestAnimationFrame(playLoop);

    // Mobile WebKit / Chromium Audio Unlock on first touch/pointer
    const unlockAudio = () => {
      ensureAudioUnlocked();
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalKeydown);
    if (playLoopId) cancelAnimationFrame(playLoopId);
  });

  $effect(() => {
    const canvas = canvasRef;
    if (canvas) {
      untrack(() => {
        engine.initWorkers();
        engine.setupCanvas(canvas);
      });
      
      let w = 1920;
      let h = 1080;
      if (editor.aspectRatio === 'original') {
        w = editor.originalWidth || 1920;
        h = editor.originalHeight || 1080;
      } else if (editor.aspectRatio === '9:16') {
        w = 1080;
        h = 1920;
      } else if (editor.aspectRatio === '16:9') {
        w = 1920;
        h = 1080;
      } else if (editor.aspectRatio === '1:1') {
        w = 1080;
        h = 1080;
      }
      engine.resizeCanvas(w, h);
    }
  });

  function resetProject() {
    if (confirm('Projeyi sıfırlamak ve tüm medyaları temizlemek istediğinize emin misiniz?')) {
      editor.assets.forEach(a => {
        if (a.blobUrl) URL.revokeObjectURL(a.blobUrl);
      });
      editor.tracks = [];
      editor.assets = [];
      editor.playhead = 0;
      editor.addTrack('V1');
      editor.addTrack('A1');
      editor.saveState();
      editor.announce('Yeni boş proje oluşturuldu.');
    }
  }
</script>

<main class="w-screen h-[100dvh] spatial-bg text-neutral-200 flex flex-col font-sans overflow-hidden select-none lg:p-2.5 lg:gap-2.5" data-theme={editor.activeTheme}>
  <!-- 2026 Spatial Glass Studio Header & Dynamic Island -->
  <header 
    data-tauri-drag-region
    class="flex-none flex items-center justify-between px-3 sm:px-4 min-h-[52px] sm:min-h-[56px] py-1.5 lg:rounded-2xl spatial-glass z-30 transition-all"
    style="padding-top: max(6px, env(safe-area-inset-top, 0px));"
  >
    <!-- Brand / Studio Identity -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2.5">
        <button type="button" class="relative group cursor-pointer focus:outline-none" onclick={() => editor.isSettingsModalOpen = true} title="Proje Ayarları">
          <img src="logo-icon.png" alt="Logo" class="h-8 w-8 sm:h-9 sm:w-9 object-contain rounded-xl p-0.5 bg-neutral-900/90 border border-white/15 shadow-[0_0_16px_rgba(139,92,246,0.35)] transition-transform group-hover:scale-105" />
          <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 border-2 border-neutral-900 rounded-full shadow-[0_0_8px_#34d399]"></div>
        </button>
        <div class="flex flex-col">
          <div class="flex items-center gap-1.5">
            <span class="font-extrabold text-xs sm:text-sm tracking-tight text-white font-mono">TOOLX</span>
            <span class="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold uppercase tracking-wider">2026 PRO</span>
          </div>
          <span class="text-[9px] font-mono text-neutral-400 hidden xs:inline tracking-tight">Yerel WebGPU Stüdyo</span>
        </div>
      </div>

      <!-- Quick Action: Project Reset -->
      <button
        onclick={resetProject}
        class="hidden 2xl:flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all cursor-pointer"
        title="Projeyi Temizle & Yeni Boş Proje Başlat"
      >
        <RotateCcw size={11} />
        <span>Yeni</span>
      </button>
    </div>

    <!-- Center: Omni AI Dynamic Island (Autonomous Copilot Capsule) -->
    <div class="hidden md:flex items-center">
      {#if aiService.isRunning}
        <div class="flex items-center gap-2.5 px-4 py-1.5 rounded-full spatial-glass-active dynamic-island-glow transition-all">
          <div class="relative flex items-center justify-center">
            <Sparkles size={14} class="text-purple-400 animate-spin" />
            <div class="absolute -inset-1 rounded-full bg-purple-500/30 blur-sm animate-pulse"></div>
          </div>
          <div class="flex flex-col">
            <span class="text-[11px] font-semibold text-purple-200 tracking-wide leading-none">{aiService.statusMessage || 'AI İşleniyor...'}</span>
            <span class="text-[9px] font-mono text-purple-400/80 mt-0.5">Yerel WebGPU Sinir Ağı</span>
          </div>
          <div class="w-16 h-1.5 bg-neutral-950/80 rounded-full overflow-hidden border border-white/10 ml-1">
            <div class="h-full bg-gradient-to-r from-purple-500 to-cyan-400 rounded-full transition-all duration-200" style="width: {aiService.progress}%"></div>
          </div>
          <span class="text-[10px] font-mono text-purple-300 font-bold">{aiService.progress}%</span>
        </div>
      {:else}
        <div class="flex items-center gap-1.5">
          <button
            onclick={() => editor.isCommandPaletteOpen = true}
            class="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full spatial-glass hover:spatial-glass-active transition-all duration-200 group cursor-pointer dynamic-island-glow"
            title="AI Stüdyo Direktörü (⌘K veya Ctrl+K)"
          >
            <div class="w-6 h-6 rounded-full bg-gradient-to-tr from-purple-600 to-cyan-500 flex items-center justify-center text-white shadow-sm group-hover:scale-105 transition-transform">
              <Sparkles size={12} class="animate-pulse" />
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span class="font-medium text-neutral-200 group-hover:text-white transition-colors">AI Direktör</span>
              <span class="text-neutral-500 text-[11px] hidden xl:inline">"Sessizlikleri sil", "Altyazı üret", "Ritim kesimi"</span>
            </div>
            <div class="flex items-center gap-1 pl-1">
              <kbd class="px-1.5 py-0.5 text-[9px] font-mono font-semibold bg-white/10 border border-white/10 rounded text-neutral-300 shadow-sm">⌘K</kbd>
            </div>
          </button>

          <button
            onclick={() => { aiService.isPanelOpen = true; editor.triggerHaptic('light'); }}
            class="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-full spatial-glass hover:spatial-glass-active text-purple-300 hover:text-white text-xs transition-all cursor-pointer dynamic-island-glow"
            title="Yapay Zeka Üretim Merkezi (Yerel Modeller & Lisanslar)"
          >
            <Cpu size={12} class="text-purple-400" />
            <span class="text-[11px] font-medium">Model Hub</span>
          </button>
        </div>
      {/if}
    </div>

    <!-- Right Actions: Undo/Redo + Mode Toggles + Export -->
    <div class="flex items-center gap-2 sm:gap-2.5">
      <!-- Undo / Redo Glass Pill -->
      <div class="flex items-center spatial-glass rounded-xl p-0.5">
        <button
          onclick={() => editor.undo()}
          disabled={!editor.canUndo}
          class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 hover:text-white disabled:opacity-20 text-neutral-400 transition-colors"
          title="Geri Al (Ctrl+Z)"
        >
          <Undo2 size={13} />
        </button>
        <div class="w-px h-3.5 bg-white/10 mx-0.5"></div>
        <button
          onclick={() => editor.redo()}
          disabled={!editor.canRedo}
          class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 hover:text-white disabled:opacity-20 text-neutral-400 transition-colors"
          title="Yinele (Ctrl+Y)"
        >
          <Redo2 size={13} />
        </button>
      </div>

      <!-- Desktop Production Pipeline Toggles (Fluid Glass Pill) -->
      <div class="hidden lg:flex items-center spatial-glass rounded-xl p-1 gap-1">
        <button 
          onclick={() => { editor.activeSidebarTab = 'media'; appState.isInspectorOpen = true; }}
          class="px-2.5 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1.5 {editor.activeSidebarTab === 'media' && appState.isInspectorOpen ? 'bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30 shadow-[0_0_12px_rgba(56,189,248,0.25)]' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'}"
          title="1. Aşama: Medya Dosyaları ve Varlıklar"
        >
          <FolderClosed size={13} />
          <span>Medya</span>
        </button>
        <button 
          onclick={() => { editor.activeSidebarTab = 'ai'; appState.isInspectorOpen = true; }}
          class="px-2.5 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1.5 {editor.activeSidebarTab === 'ai' && appState.isInspectorOpen ? 'bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/30 shadow-[0_0_12px_rgba(168,85,247,0.25)]' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'}"
          title="2. Aşama: Otonom AI Araçları (Sessizlik, Arka Plan, Reframe)"
        >
          <Sparkles size={13} />
          <span>AI Kurgu</span>
        </button>
        <button 
          onclick={() => { editor.activeSidebarTab = 'templates'; appState.isInspectorOpen = true; }}
          class="px-2.5 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1.5 {editor.activeSidebarTab === 'templates' && appState.isInspectorOpen ? 'bg-pink-500/20 text-pink-300 font-semibold border border-pink-500/30 shadow-[0_0_12px_rgba(244,114,182,0.25)]' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'}"
          title="3. Aşama: Ritmik Şablonlar & Viral Kancalar"
        >
          <Zap size={13} />
          <span>Şablon</span>
        </button>
        <button 
          onclick={() => { editor.activeSidebarTab = 'filters'; appState.isInspectorOpen = true; }}
          class="px-2.5 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1.5 {editor.activeSidebarTab === 'filters' && appState.isInspectorOpen ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.25)]' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'}"
          title="4. Aşama: Oklab Sinematik Renk Filtreleri"
        >
          <Sliders size={13} />
          <span>Renk</span>
        </button>
        <button 
          onclick={() => { editor.activeSidebarTab = 'captions'; appState.isInspectorOpen = true; }}
          class="px-2.5 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1.5 {editor.activeSidebarTab === 'captions' && appState.isInspectorOpen ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.25)]' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'}"
          title="5. Aşama: Dinamik Altyazı & Kokoro Seslendirme"
        >
          <Type size={13} />
          <span>Altyazı</span>
        </button>

        <div class="w-px h-4 bg-white/10 mx-0.5"></div>

        <button 
          onclick={() => { appState.isInspectorOpen = !appState.isInspectorOpen; }}
          class="p-1.5 rounded-lg text-xs transition-colors flex items-center text-neutral-400 hover:text-white hover:bg-white/10"
          title={appState.isInspectorOpen ? "Yan Paneli Kapat" : "Yan Paneli Aç"}
        >
          <X size={13} class={appState.isInspectorOpen ? '' : 'rotate-45'} />
        </button>
      </div>

      <!-- Settings Icon Pill -->
      <button
        onclick={() => editor.isSettingsModalOpen = true}
        class="spatial-glass hover:bg-white/10 text-neutral-300 hover:text-white p-2 sm:px-2.5 sm:py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs"
        title="Donanım ve Proje Ayarları"
      >
        <Sliders size={14} class="text-neutral-400" />
        <span class="hidden 2xl:inline font-medium">Ayarlar</span>
      </button>

      <!-- Neon 4K Export Button -->
      <button 
        onclick={() => editor.isExportOpen = true}
        class="neon-btn-export text-white px-3.5 sm:px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-lg"
      >
        <Download size={14} />
        <span>Dışa Aktar</span>
        <span class="hidden sm:inline text-[9px] font-mono bg-white/20 px-1 py-0.2 rounded font-bold">4K</span>
      </button>
    </div>
  </header>

  <!-- Workspace: Unified Workspace Layout (Center Monitor + Dynamic Right Panel) + Dynamic Bottom Timeline/Panel -->
  <div class="flex-1 flex flex-col min-h-0 relative lg:gap-2">
    
    <!-- Top Row: Monitor + Right Inspector/Panel (Desktop) -->
    <div class="flex-1 flex min-h-0 overflow-hidden lg:gap-2">
      
      <!-- Center Pane: Viewer / Cinema Stage 2026 -->
      <section class="flex-1 relative flex flex-col items-center justify-center spatial-glass lg:rounded-2xl p-4 min-h-0 overflow-hidden cinema-stage-glow transition-all">
        
        <!-- Ambient Top Cinema HUD Pill -->
        <div class="absolute top-3 inset-x-0 flex items-center justify-between px-6 {isFullscreen ? 'fixed z-[60]' : 'z-20'} pointer-events-none">
          <!-- Aspect ratio selector with modern glass design -->
          <div class="flex items-center gap-1 spatial-glass p-1 rounded-xl pointer-events-auto shadow-xl">
            <button
              onclick={() => editor.aspectRatio = 'original'}
              class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer {editor.aspectRatio === 'original' ? 'bg-white/20 text-white font-bold shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}"
              title="Videonun Orijinal En-Boy Oranı"
            >
              📐 Orijinal
            </button>
            <button
              onclick={() => editor.aspectRatio = '16:9'}
              class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer {editor.aspectRatio === '16:9' ? 'bg-white/20 text-white font-bold shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}"
            >
              🖥️ 16:9
            </button>
            <button
              onclick={() => editor.aspectRatio = '9:16'}
              class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer {editor.aspectRatio === '9:16' ? 'bg-purple-600/80 text-white font-bold shadow-[0_0_12px_rgba(168,85,247,0.4)]' : 'text-neutral-400 hover:text-neutral-200'}"
            >
              📱 9:16
            </button>
            <button
              onclick={() => editor.aspectRatio = '1:1'}
              class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer {editor.aspectRatio === '1:1' ? 'bg-white/20 text-white font-bold shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}"
            >
              ⏹️ 1:1
            </button>
          </div>

          <!-- Video Engine Status + Timecode + Fullscreen -->
          <div class="flex items-center gap-2 pointer-events-auto">
            <div class="hidden sm:flex items-center gap-1.5 spatial-glass px-2.5 py-1 rounded-xl text-[10px] font-mono text-emerald-400 border border-emerald-500/20 shadow-md">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>WebGPU 60 FPS</span>
            </div>
            <div class="spatial-glass px-3 py-1 rounded-xl text-neutral-200 font-mono text-xs font-semibold tracking-wider border border-white/10 shadow-lg">
              {formatTimecode(editor.playhead)}
            </div>
            <button 
              onpointerdown={(e) => e.stopPropagation()}
              onpointerup={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation();
                toggleFullscreen();
              }}
              class="p-2 spatial-glass hover:bg-white/15 text-neutral-300 hover:text-white rounded-xl transition-all cursor-pointer shadow-lg active:scale-95"
              title={isFullscreen ? "Tam Ekrandan Çık (Esc)" : "Tam Ekran Önizleme"}
            >
              {#if isFullscreen}
                <Minimize2 size={15} />
              {:else}
                <Maximize2 size={15} />
              {/if}
            </button>
          </div>
        </div>

        <!-- Video Canvas Container (Gesture Area: Double tap for Fullscreen, Pinch to Scale, Tap to Play) -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div 
          bind:this={monitorContainerRef}
          role="region"
          aria-label="Video Önizleme Monitörü (Oynat/Durdur için dokun, Tam ekran için çift dokun)"
          onpointerdown={handleMonitorPointerDown}
          onpointermove={handleMonitorPointerMove}
          onpointerup={handleMonitorPointerUp}
          onpointercancel={handleMonitorPointerUp}
          class="relative w-full cursor-pointer select-none touch-none flex items-center justify-center transition-all duration-300 border border-white/10 shadow-2xl overflow-hidden bg-neutral-950 rounded-2xl {isFullscreen ? 'fixed inset-0 z-50 max-w-none max-h-none rounded-none border-none' : (editor.isTimelineCollapsed ? 'max-h-[94%]' : 'max-h-[88%]') + ' ' + (editor.aspectRatio === '9:16' ? (editor.isTimelineCollapsed ? 'max-w-[440px] aspect-[9/16]' : 'max-w-[340px] aspect-[9/16]') : editor.aspectRatio === '16:9' ? (editor.isTimelineCollapsed ? 'max-w-[850px] aspect-[16/9]' : 'max-w-[620px] aspect-[16/9]') : editor.aspectRatio === '1:1' ? (editor.isTimelineCollapsed ? 'max-w-[540px] aspect-square' : 'max-w-[420px] aspect-square') : (editor.isTimelineCollapsed ? 'max-w-[850px]' : 'max-w-[620px]'))}"
          style={editor.aspectRatio === 'original' && !isFullscreen ? `aspect-ratio: ${editor.originalWidth} / ${editor.originalHeight};` : ''}
        >
          {#if isFullscreen}
            <button
              onpointerdown={(e) => e.stopPropagation()}
              onpointerup={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation();
                toggleFullscreen();
              }}
              class="absolute top-4 right-4 z-[70] px-3.5 py-2 bg-neutral-900/90 hover:bg-neutral-800 text-white rounded-xl border border-white/20 shadow-2xl backdrop-blur-md transition-all active:scale-95 cursor-pointer pointer-events-auto flex items-center gap-1.5 text-xs font-semibold"
              title="Tam Ekrandan Çık (Esc)"
            >
              <Minimize2 size={14} />
              <span>Tam Ekrandan Çık</span>
            </button>
          {/if}
          <!-- Scaling wrapper -->
          <div 
            class="w-full h-full flex items-center justify-center transition-transform duration-75 origin-center pointer-events-none"
            style="transform: scale({canvasScale});"
          >
            <canvas bind:this={canvasRef} class="w-full h-full object-contain pointer-events-none"></canvas>
          </div>

          <!-- Visual Tap Feedback Indicator (Play / Pause Ripple) -->
          {#if monitorFeedback}
            <div class="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-in zoom-in-75 fade-in duration-150">
              <div class="w-16 h-16 rounded-full bg-neutral-950/75 backdrop-blur-md border border-white/25 flex items-center justify-center text-white shadow-2xl">
                {#if monitorFeedback === 'play'}
                  <Play size={28} class="fill-white ml-1" />
                {:else}
                  <Pause size={28} class="fill-white" />
                {/if}
              </div>
            </div>
          {/if}
          
          {#if engineState.status === 'idle' && !editor.isPlaying && editor.tracks.every(t => t.clips.length === 0)}
            <div class="absolute inset-0 flex flex-col items-center justify-center text-neutral-600 gap-2 pointer-events-none">
              <ImageIcon size={40} strokeWidth={1.5} />
              <span class="text-xs tracking-wide uppercase font-medium">Medya Bekleniyor</span>
            </div>
          {/if}

          {#if activeSubtitleInfo}
            {@const style = activeSubtitleInfo.style}
            <div 
              class="absolute inset-x-4 text-center z-10 select-none pointer-events-auto transition-all"
              style="top: {style.positionY}%; transform: translateY(-50%);"
            >
              <button
                onclick={(e) => {
                  e.stopPropagation();
                  editor.openBottomSheet('subtitle_style');
                }}
                class="inline-block px-3.5 py-1.5 rounded-xl transition-transform active:scale-95 group/sub relative cursor-pointer {style.animation === 'pop' ? 'animate-in zoom-in-95 duration-150' : ''}"
                style="background-color: {style.backgroundColor}; box-shadow: 0 4px 20px rgba(0,0,0,0.5);"
                title="Yazı ve Tipografi Stilini Değiştirmek İçin Dokun"
              >
                <!-- Words container with karaoke highlighting -->
                <div class="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
                  {#each activeSubtitleInfo.words as w, idx}
                    {@const isCurrentWord = idx === activeSubtitleInfo.activeWordIndex}
                    {@const isPastWord = idx < activeSubtitleInfo.activeWordIndex}
                    <span 
                      class="transition-all duration-100 {style.preset === 'tiktok-bold' ? 'font-black tracking-wide uppercase' : style.preset === 'karaoke-glow' ? 'font-extrabold' : 'font-bold'}"
                      style="
                        font-size: {style.fontSize}px;
                        color: {isCurrentWord ? style.highlightColor : style.textColor};
                        -webkit-text-stroke: {style.strokeWidth}px {style.strokeColor};
                        text-shadow: {isCurrentWord ? `0 0 10px ${style.highlightColor}` : '0 2px 4px rgba(0,0,0,0.8)'};
                        transform: {isCurrentWord && style.animation !== 'none' ? 'scale(1.12)' : 'scale(1)'};
                        display: inline-block;
                      "
                    >
                      {w.word}
                    </span>
                  {/each}
                </div>

                <!-- Hover/touch indicator pill -->
                <div class="absolute -top-3 right-1/2 translate-x-1/2 opacity-0 group-hover/sub:opacity-100 transition-opacity bg-purple-600 text-white text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full shadow pointer-events-none whitespace-nowrap">
                  Stili Değiştir ✎
                </div>
              </button>
            </div>
          {/if}

          <!-- Zoom scale indicator badge when zoomed in/out -->
          {#if Math.abs(canvasScale - 1) > 0.05}
            <div class="absolute top-4 left-4 z-20 flex items-center gap-1.5 spatial-glass rounded-full px-2.5 py-1 text-[10px] font-mono text-neutral-300">
              <span>{Math.round(canvasScale * 100)}%</span>
              <button 
                onclick={(e) => { e.stopPropagation(); resetCanvasScale(); }}
                class="hover:text-white ml-1 text-neutral-400"
                title="Ölçeği Sıfırla (%100)"
              >
                <RefreshCw size={11} />
              </button>
            </div>
          {/if}

          <!-- Fullscreen Floating Exit Button (Always visible when in Fullscreen) -->
          {#if isFullscreen}
            <button 
              onclick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              class="absolute top-6 right-6 z-30 p-2.5 rounded-full spatial-glass text-white shadow-2xl transition-all active:scale-95 flex items-center gap-1.5 text-xs"
            >
              <Minimize2 size={16} />
              <span>Kapat</span>
            </button>
          {/if}
        </div>
      </section>

      <!-- Right Panel: Unified Contextual Workspace (Desktop) -->
      {#if appState.isInspectorOpen}
        <div class="hidden lg:flex w-[350px] flex-col flex-none spatial-glass lg:rounded-2xl overflow-hidden shadow-2xl border border-white/10">
          {#if editor.activeSidebarTab === 'filters'}
            <FiltersSheet isBottomDocked={false} />
          {:else}
            <StudioSidebar isMobileSheet={false} hideTabs={true} />
          {/if}
        </div>
      {/if}

    </div>

    <!-- Minimized Transport Control Bar (Pinned Directly Above Timeline) -->
    <div class="flex-none px-3 sm:px-4 py-1.5 flex items-center justify-between spatial-glass lg:rounded-xl border-t lg:border border-white/10 z-20 transition-all select-none shadow-lg">
      <!-- Left: Razor Cut & Magnet Snapping & Beat Snapping -->
      <div class="flex items-center gap-1.5">
        <button
          onclick={() => { editor.splitClipAtPlayhead(); editor.triggerHaptic('medium'); }}
          class="px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
          title="Klibi İğne Konumundan Kes / Böl (C)"
        >
          <Scissors size={13} />
          <span>Böl</span>
        </button>

        <button
          onclick={() => {
            editor.isMagnetic = !editor.isMagnetic;
            editor.triggerHaptic('light');
          }}
          class="p-1.5 rounded-lg transition-colors cursor-pointer {editor.isMagnetic ? 'text-amber-400 bg-amber-500/15 border border-amber-500/25' : 'text-neutral-500 hover:text-neutral-300'}"
          title={editor.isMagnetic ? "Manyetik Yapışma Açık" : "Manyetik Yapışma Kapalı"}
        >
          <Magnet size={13} />
        </button>

        <button
          onclick={() => {
            editor.snapToBeat = !editor.snapToBeat;
            editor.triggerHaptic('light');
          }}
          class="p-1.5 rounded-lg transition-colors cursor-pointer {editor.snapToBeat ? 'text-pink-400 bg-pink-500/15 border border-pink-500/25' : 'text-neutral-500 hover:text-neutral-300'}"
          title={editor.snapToBeat ? "Ritmik Vuruşlara Yapışma Açık" : "Ritmik Vuruşlara Yapışma Kapalı"}
        >
          <Music size={13} />
        </button>
      </div>

      <!-- Center: Minimized Ergonomic Transport (J-K-L Shuttle & Play/Pause) -->
      <div class="flex items-center gap-2">
        <button
          onclick={() => { editor.stepPlayhead(-0.5); editor.triggerHaptic('light'); }}
          class="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center transition-all text-neutral-400 hover:text-white active:scale-90 cursor-pointer"
          title="Geri Sar / 0.5s Geri Git (J)"
        >
          <SkipBack size={14} />
        </button>
        
        <button
          onclick={() => editor.togglePlayback()}
          class="w-9 h-9 rounded-full bg-gradient-to-tr from-white to-neutral-200 text-neutral-950 hover:brightness-110 flex items-center justify-center transition-all active:scale-95 shadow-[0_0_16px_rgba(255,255,255,0.35)] cursor-pointer"
          title="Oynat / Durdur (Space)"
        >
          {#if editor.isPlaying}
            <Pause size={16} class="fill-neutral-950" />
          {:else}
            <Play size={16} class="fill-neutral-950 ml-0.5" />
          {/if}
        </button>
        
        <button
          onclick={() => { editor.stepPlayhead(0.5); editor.triggerHaptic('light'); }}
          class="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center transition-all text-neutral-400 hover:text-white active:scale-90 cursor-pointer"
          title="İleri Sar / 0.5s İleri Git (L)"
        >
          <SkipForward size={14} />
        </button>
      </div>

      <!-- Right: Playhead Timecode, Zoom Controls & Focus Mode Toggle -->
      <div class="flex items-center gap-1.5">
        <div class="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-white/5 border border-white/10 text-neutral-400">
          <button 
            onclick={() => editor.zoom = Math.max(10, Math.round(editor.zoom * 0.8))}
            class="p-1 hover:text-white rounded transition-colors cursor-pointer"
            title="Uzaklaş"
          >
            <ZoomOut size={12} />
          </button>
          <span class="text-[10px] font-mono min-w-[28px] text-center select-none text-neutral-300">{Math.round(editor.zoom)}x</span>
          <button 
            onclick={() => editor.zoom = Math.min(200, Math.round(editor.zoom * 1.25))}
            class="p-1 hover:text-white rounded transition-colors cursor-pointer"
            title="Yakınlaş"
          >
            <ZoomIn size={12} />
          </button>
        </div>

        <div class="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 font-mono text-[11px] text-neutral-300 shadow-inner flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full {editor.isPlaying ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'}"></span>
          <span>{formatTimecode(editor.playhead)}</span>
        </div>

        <button
          onclick={() => {
            editor.isTimelineCollapsed = !editor.isTimelineCollapsed;
            editor.triggerHaptic('light');
          }}
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-all text-xs cursor-pointer {editor.isTimelineCollapsed ? 'bg-purple-500/15 border border-purple-500/30 text-purple-300' : 'bg-white/5 border border-white/10'}"
          title={editor.isTimelineCollapsed ? "Alt Paneli / Zaman Çizelgesini Genişlet" : "Alt Paneli / Zaman Çizelgesini Gizle (Odak Önizleme Modu)"}
        >
          {#if editor.isTimelineCollapsed}
            <ChevronUp size={14} class="text-purple-400" />
            <span class="text-[10px] font-semibold text-purple-300">Paneli Aç</span>
          {:else}
            <ChevronDown size={14} class="text-neutral-400" />
            <span class="text-[10px] font-semibold text-neutral-300">Paneli Gizle</span>
          {/if}
        </button>
      </div>
    </div>

    <!-- Timeline Section or Mobile Panel Swap (With collapsible Focus Mode) -->
    <section 
      aria-label="Zaman Çizelgesi" 
      id="timeline-section" 
      class="transition-all duration-300 ease-in-out flex-none spatial-glass lg:rounded-2xl border-t lg:border border-white/10 relative z-10 overflow-hidden shadow-2xl {timelineHeightClass}"
    >
      {#if editor.mobileWorkspace === 'timeline'}
        <Timeline />
      {:else if editor.mobileWorkspace === 'filters'}
        <div class="flex-1 overflow-hidden flex flex-col h-full w-full">
          <FiltersSheet isBottomDocked={true} onClose={() => { editor.mobileWorkspace = 'timeline'; }} />
        </div>
      {:else}
        <!-- Mobile workspace panel swapping logic (hidden on lg, takes timeline spot) -->
        <div class="flex-1 lg:hidden spatial-glass overflow-hidden flex flex-col h-full w-full">
          <StudioSidebar isMobileSheet={false} hideTabs={true} />
        </div>
        <!-- On desktop, if timeline is "swapped", show timeline -->
        <div class="hidden lg:flex flex-1 w-full h-full">
          <Timeline />
        </div>
      {/if}
    </section>

    <!-- Contextual Bottom Action Bar (Thumb Zone) - Hidden on Desktop -->
    <div class="lg:hidden">
      <BottomBar />
    </div>

  </div>

  <BottomSheet isOpen={editor.activeBottomSheet !== null} onClose={() => editor.closeBottomSheet()}>
    {#if editor.activeBottomSheet === 'transitions'}
      <TransitionsPicker />
    {:else if editor.activeBottomSheet === 'subtitle_style'}
      <SubtitleStyleSheet />
    {:else if editor.activeBottomSheet === 'speed_curve'}
      <SpeedCurveSheet />
    {:else if editor.activeBottomSheet === 'audio_envelope'}
      <AudioEnvelopeSheet />
    {:else if editor.activeBottomSheet === 'filters'}
      <FiltersSheet onClose={() => editor.closeBottomSheet()} />
    {:else if editor.activeBottomSheet}
      <StudioSidebar isMobileSheet={true} onClose={() => editor.closeBottomSheet()} />
    {/if}
  </BottomSheet>

  <ExportModal bind:isOpen={editor.isExportOpen} />
  <!-- Studio Settings Modal -->
  <SettingsModal />
  <!-- AI Control Center & Model Hub Modal -->
  <AIControlCenter />
  <!-- Global Command Palette Modal (Cmd+K) -->
  <Omnibar />
</main>


