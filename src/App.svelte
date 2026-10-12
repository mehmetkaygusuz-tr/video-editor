<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { editor } from './lib/editor.svelte';
  import type { TimelineClip } from './lib/types';
  import { ensureAudioUnlocked } from './lib/audio';
  import { masterAudioClock } from './lib/engine/audioClock';
  import { getFileFromOPFS, saveFileToOPFS } from './lib/opfs';
  import { evaluateSpeedCurve } from './lib/engine/speedCurve';
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
  import { 
    Sparkles, Download, Play, Pause, 
    SkipBack, SkipForward, Image as ImageIcon, Scissors, 
    Trash as Trash2, X, Undo2, Redo2, FastForward, Volume2, Layers, Crop, FolderClosed,
    SlidersHorizontal as Sliders, Monitor, CircleQuestionMark as HelpCircle, RefreshCw,
    Maximize2, Minimize2, Type, Zap, RotateCcw, Magnet, ZoomIn, ZoomOut, Music,
    ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Square, Check, Upload
  } from '@lucide/svelte';

  let canvasRef = $state<HTMLCanvasElement | undefined>();
  let isAspectRatioDropdownOpen = $state(false);

  let timelineHeightClass = $derived.by(() => {
    if (editor.isTimelineCollapsed) {
      return 'h-0 min-h-0 border-t-0 lg:border-none opacity-0';
    }
    // Mobile docked panels: Filters, Media, AI, Templates, Captions
    if (editor.mobileWorkspace !== 'timeline') {
      return 'h-[34vh] lg:h-[30vh] min-h-[220px] opacity-100 flex flex-col';
    }
    // Timeline mode: on mobile, provide stable standard room, on desktop adapt to tracks
    const count = editor.tracks.length;
    if (count > 3) {
      return 'h-[32vh] lg:h-[30vh] min-h-[240px] max-h-[38vh] opacity-100 flex flex-col';
    }
    return 'h-[26vh] lg:h-[22vh] min-h-[180px] opacity-100 flex flex-col';
  });

  let selectedClip = $derived(editor.selectedClip);

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
  let activeMonitorPointers = new SvelteMap<number, PointerEvent>();

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

    // Arrow Left / Right: Exact SMPTE frame step (Shift for 5 frames)
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      editor.stepFrame(e.shiftKey ? -5 : -1);
      editor.triggerHaptic('light');
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      editor.stepFrame(e.shiftKey ? 5 : 1);
      editor.triggerHaptic('light');
      return;
    }

    // Arrow Up / Down: Jump to Previous / Next Edit Point (Premiere / DaVinci Standard)
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      editor.jumpToEditPoint(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      editor.jumpToEditPoint(1);
      return;
    }

    // Space: Play / Pause
    if (e.code === 'Space') {
      e.preventDefault();
      editor.togglePlayback();
      return;
    }

    // J-K-L Shuttle (SMPTE Standard 1x -> 2x -> 4x -> 8x / Stop / Reverse)
    if (e.key.toLowerCase() === 'j') {
      e.preventDefault();
      editor.shuttleReverse();
      return;
    }
    if (e.key.toLowerCase() === 'k') {
      e.preventDefault();
      editor.shuttleStop();
      return;
    }
    if (e.key.toLowerCase() === 'l') {
      e.preventDefault();
      editor.shuttleForward();
      return;
    }

    // I / O / X: SMPTE In & Out Points (3-Point Editing)
    if (e.key.toLowerCase() === 'i') {
      e.preventDefault();
      editor.setInPoint();
      return;
    }
    if (e.key.toLowerCase() === 'o') {
      e.preventDefault();
      editor.setOutPoint();
      return;
    }
    if (e.altKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      editor.clearInOutPoints();
      return;
    }
    if (e.key.toLowerCase() === 'x' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      editor.markClip();
      return;
    }

    // C: Split / Razor at playhead (Blade All across unlocked tracks)
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
  let lastRenderedTimelinePTS = -1;
  let pendingSeek: { pts: number; isPlaying: boolean } | null = null;
  let lastVideoLookaheadTime = 0;

  const getAssetFile = async (asset: any): Promise<File | null> => {
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

  async function checkVideoLookahead(masterTime: number) {
    if (Math.abs(masterTime - lastVideoLookaheadTime) < 0.25) return;
    lastVideoLookaheadTime = masterTime;

    const lookaheadHorizon = masterTime + 2.0;
    for (const track of editor.tracks) {
      if (track.isMuted) continue;
      const isTrackAudio = track.type === 'audio' || track.name.startsWith('A');
      if (isTrackAudio) continue;

      for (const clip of track.clips) {
        const isVideo = clip.type === 'video' || clip.type === 'image' || (!clip.type && !isTrackAudio);
        if (!isVideo) continue;

        if (clip.startAt > masterTime && clip.startAt <= lookaheadHorizon) {
          const asset = editor.assets.find(a => a.id === clip.assetId) || editor.assets.find(a => a.name === clip.name);
          if (asset) {
            getAssetFile(asset).then(f => {
              if (f) engine.preloadClip(f);
            }).catch(() => {});
          }
        }
      }
    }
  }

  async function seekAndRenderVideoFrame(videoPTS: number, isPlaying: boolean) {
    if (isSeekingVideo) {
      pendingSeek = { pts: videoPTS, isPlaying };
      return;
    }

    // Advanced Multi-Track & Transition Search
    let activeClips: TimelineClip[] = [];
    for (const track of editor.tracks) {
      if (track.isMuted) continue;
      const isTrackAudio = track.type === 'audio' || track.name.startsWith('A');
      for (const clip of track.clips) {
        const isVideo = clip.type === 'video' || clip.type === 'image' || (!clip.type && !isTrackAudio);
        if (isVideo) {
          if (videoPTS >= clip.startAt && videoPTS <= clip.startAt + clip.duration) {
            activeClips.push(clip);
          }
        }
      }
    }

    let clipA: TimelineClip | null = null;
    let clipB: TimelineClip | null = null;
    let transition: { type: string; progress: number } | null = null;

    if (activeClips.length === 1) {
      const clip = activeClips[0];
      const track = editor.tracks.find(t => t.id === clip.trackId);
      if (track) {
        if (clip.transitionOut && videoPTS > clip.startAt + clip.duration - clip.transitionOut.duration) {
          const nextClip = track.clips.find(c => Math.abs(c.startAt - (clip.startAt + clip.duration)) < 0.05);
          if (nextClip) {
            clipA = clip;
            clipB = nextClip;
            const p = (videoPTS - (clip.startAt + clip.duration - clip.transitionOut.duration)) / clip.transitionOut.duration;
            transition = { type: clip.transitionOut.type, progress: Math.max(0, Math.min(1, p)) };
          } else {
            clipA = clip;
          }
        } else if (clip.transitionIn && videoPTS < clip.startAt + clip.transitionIn.duration) {
          const prevClip = track.clips.find(c => Math.abs(c.startAt + c.duration - clip.startAt) < 0.05);
          if (prevClip) {
            clipA = prevClip;
            clipB = clip;
            const p = (videoPTS - clip.startAt) / clip.transitionIn.duration;
            transition = { type: clip.transitionIn.type, progress: Math.max(0, Math.min(1, p)) };
          } else {
            clipA = clip;
          }
        } else {
          clipA = clip;
        }
      } else {
        clipA = clip;
      }
    } else if (activeClips.length > 1) {
      clipA = activeClips[0];
      clipB = activeClips[1];
    }

    // Frame Holding: Only clear canvas if playhead is truly in an empty region far from any clip
    if (!clipA) {
      const hasNearbyVideoClip = editor.tracks.some(t => 
        !t.isMuted && (t.type !== 'audio' && !t.name.startsWith('A')) &&
        t.clips.some(c => 
          (c.type === 'video' || c.type === 'image' || (!c.type && t.type !== 'audio')) &&
          videoPTS >= c.startAt - 0.08 && videoPTS <= c.startAt + c.duration + 0.08
        )
      );

      if (!hasNearbyVideoClip && canvasRef) {
        lastVideoSeekTime = -1;
        lastRenderedTimelinePTS = -1;
        const ctx = canvasRef.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#090a0f';
          ctx.fillRect(0, 0, canvasRef.width, canvasRef.height);
        }
      }
      return;
    }

    if (clipA) {
      const relTime1 = videoPTS - clipA.startAt;
      const normT1 = Math.max(0, Math.min(1, clipA.duration > 0 ? relTime1 / clipA.duration : 0));
      const speed1 = clipA.speedCurve ? evaluateSpeedCurve(clipA.speedCurve, normT1) : (clipA.speed ?? 1.0);
      const targetTime1 = (clipA.sourceOffset || 0) + relTime1 * speed1;

      let targetTime2 = 0;
      if (clipB) {
        const relTime2 = videoPTS - clipB.startAt;
        const normT2 = Math.max(0, Math.min(1, clipB.duration > 0 ? relTime2 / clipB.duration : 0));
        const speed2 = clipB.speedCurve ? evaluateSpeedCurve(clipB.speedCurve, normT2) : (clipB.speed ?? 1.0);
        targetTime2 = (clipB.sourceOffset || 0) + relTime2 * speed2;
      }

      if (editor.renderFrameDirty || Math.abs(targetTime1 - lastVideoSeekTime) >= (isPlaying ? 0.008 : 0.0005) || lastVideoSeekTime < 0) {
        editor.renderFrameDirty = false;
        const asset1 = editor.assets.find(a => a.id === clipA.assetId) || editor.assets.find(a => a.name === clipA.name);
        const asset2 = clipB ? (editor.assets.find(a => a.id === clipB.assetId) || editor.assets.find(a => a.name === clipB.name)) : null;

        if (asset1) {
          isSeekingVideo = true;
          try {
            const [file1, file2] = await Promise.all([getAssetFile(asset1), getAssetFile(asset2)]);
            if (file1) {
              lastVideoSeekTime = targetTime1;
              lastRenderedTimelinePTS = videoPTS;
              const clip1Info = { 
                file: file1, 
                time: targetTime1, 
                grading: clipA.colorGrading,
                cropRect: clipA.cropRect,
                isBgRemoved: clipA.isBgRemoved
              };
              const clip2Info = (file2 && clipB) ? { 
                file: file2, 
                time: targetTime2, 
                grading: clipB.colorGrading,
                cropRect: clipB.cropRect,
                isBgRemoved: clipB.isBgRemoved
              } : null;
              const seekMode = isPlaying ? ('adaptive' as const) : ('exact' as const);
              await engine.seekFrameWithTransition(clip1Info, clip2Info, transition, { mode: seekMode, isPlaying });
              if (isPlaying) {
                masterAudioClock.recordVideoDrift(videoPTS);
              }
            }
          } finally {
            isSeekingVideo = false;
            // Only process pendingSeek when paused (e.g. scrubber settling).
            // During playback, playLoop's RAF directly delivers the freshest videoPTS without recursive ping-pong.
            if (pendingSeek && !isPlaying) {
              const next = pendingSeek;
              pendingSeek = null;
              if (Math.abs(next.pts - lastRenderedTimelinePTS) >= 0.0005) {
                seekAndRenderVideoFrame(next.pts, false);
              }
            } else {
              pendingSeek = null;
            }
          }
        }
      }
    }
  }

  let lastRenderedPlayhead = -1;

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
      
      // Periodically schedule upcoming audio clips within the lookahead window
      masterAudioClock.checkLookahead(masterTime, editor.tracks);

      // Periodically preload upcoming video decoders within lookahead window
      checkVideoLookahead(masterTime);

      // Hardware latency-compensated video presentation time (Master Audio Clock)
      const videoPTS = masterAudioClock.getVideoPresentationTime(editor.playhead);
      editor.updateAudioClockTelemetry(masterAudioClock.getTelemetry());
      seekAndRenderVideoFrame(videoPTS, true);
    } else {
      // Render frame when paused only when playhead changed or frame is dirty (eliminates 60 FPS idle invalidations)
      if (editor.renderFrameDirty || Math.abs(editor.playhead - lastRenderedPlayhead) > 0.0005) {
        lastRenderedPlayhead = editor.playhead;
        editor.updateAudioClockTelemetry(masterAudioClock.getTelemetry());
        seekAndRenderVideoFrame(editor.playhead, false);
      }
    }
    
    playLoopId = requestAnimationFrame(playLoop);
  }

  onMount(() => {
    lastTime = performance.now();
    playLoopId = requestAnimationFrame(playLoop);

    // Mobile WebKit / Chromium Audio Unlock on first touch/pointer
    const unlockAudio = () => {
      ensureAudioUnlocked();
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });

    return () => {
      if (playLoopId) cancelAnimationFrame(playLoopId);
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      engine.destroy();
      masterAudioClock.dispose();
    };
  });

  $effect(() => {
    if (!editor.isPlaying) {
      engine.stopPlaybackStreaming();
    }
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
      } else if (editor.aspectRatio === '21:9') {
        w = 2560;
        h = 1080;
      }
      engine.resizeCanvas(w, h);
    }
  });

  let headerFileInputRef = $state<HTMLInputElement | undefined>();

  async function handleMediaUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    for (let i = 0; i < target.files.length; i++) {
      const file = target.files[i];
      let type: 'video' | 'audio' | 'image' = 'video';
      if (file.type.startsWith('audio/')) type = 'audio';
      if (file.type.startsWith('image/')) type = 'image';

      try {
        const handle = await saveFileToOPFS(file, file.name);
        const blobUrl = URL.createObjectURL(file);
        let duration: number | undefined = undefined;
        if (type === 'video' || type === 'audio') {
          try {
            const mediaEl = document.createElement(type === 'video' ? 'video' : 'audio');
            mediaEl.preload = 'metadata';
            mediaEl.src = blobUrl;
            await new Promise((res) => {
              const cleanup = () => {
                mediaEl.onloadedmetadata = null;
                mediaEl.onerror = null;
                mediaEl.removeAttribute('src');
                mediaEl.load();
                res(null);
              };
              mediaEl.onloadedmetadata = () => {
                if (Number.isFinite(mediaEl.duration)) {
                  duration = mediaEl.duration;
                }
                cleanup();
              };
              mediaEl.onerror = () => cleanup();
            });
          } catch (_) {}
        }
        editor.addAsset(file.name, type, handle, duration, blobUrl);
        editor.announce(`Medya yüklendi: ${file.name}`);
      } catch (err) {
        console.error("Failed to import asset:", err);
      }
    }
    target.value = '';
  }

  function resetProject() {
    if (confirm('Projeyi sıfırlamak ve tüm medyaları temizlemek istediğinize emin misiniz?')) {
      editor.assets.forEach(a => {
        if (a.blobUrl) URL.revokeObjectURL(a.blobUrl);
      });
      engine.clearMediaCache();
      editor.tracks = [];
      editor.assets = [];
      editor.playhead = 0;
      editor.saveState();
      editor.announce('Yeni boş proje oluşturuldu.');
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<main class="w-screen h-[100dvh] spatial-bg text-neutral-200 flex flex-col font-sans overflow-hidden select-none lg:p-2.5 lg:gap-2.5" data-theme={editor.activeTheme}>
  <!-- 2026 Spatial Glass Studio Header & Dynamic Island -->
  <header 
    data-tauri-drag-region
    class="flex-none flex items-center justify-between px-3 sm:px-4 min-h-[52px] sm:min-h-[56px] py-1.5 lg:rounded-2xl spatial-glass z-30 transition-all"
    style="padding-top: max(6px, env(safe-area-inset-top, 0px));"
  >
    <!-- Brand / Studio Identity -->
    <div class="flex items-center gap-3">
      <div class="flex items-end gap-2">
        <button type="button" class="relative group cursor-pointer focus:outline-none" onclick={() => editor.isSettingsModalOpen = true} title="Proje Ayarları">
          <img src="logo-icon.png" alt="Logo" class="h-8 w-8 sm:h-9 sm:w-9 object-contain rounded-xl p-0.5 bg-neutral-900/90 border border-white/15 shadow-[0_0_16px_rgba(139,92,246,0.35)] transition-transform group-hover:scale-105" />
          <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 border-2 border-neutral-900 rounded-full shadow-[0_0_8px_#34d399]"></div>
        </button>
        <span class="hidden sm:inline-flex text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold uppercase tracking-wider mb-0.5 leading-none">2026 PRO</span>
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
            title="AI Stüdyo Direktörü (Ctrl+K)"
          >
            <div class="w-6 h-6 rounded-full bg-gradient-to-tr from-purple-600 to-cyan-500 flex items-center justify-center text-white shadow-sm group-hover:scale-105 transition-transform">
              <Sparkles size={12} class="animate-pulse" />
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span class="font-medium text-neutral-200 group-hover:text-white transition-colors">AI Direktör</span>
              <span class="text-neutral-500 text-[11px] hidden xl:inline">"Sessizlikleri sil", "Altyazı üret", "Ritim kesimi"</span>
            </div>
            <div class="flex items-center gap-1 pl-1">
              <kbd class="px-1.5 py-0.5 text-[9px] font-mono font-semibold bg-white/10 border border-white/10 rounded text-neutral-300 shadow-sm">Ctrl + K</kbd>
            </div>
          </button>
        </div>
      {/if}
    </div>

    <!-- Right Actions: Undo/Redo + Mode Toggles + Export -->
    <div class="flex items-center gap-2 sm:gap-2.5">
      <!-- Undo / Redo Glass Pill -->
      <div class="flex items-center spatial-glass rounded-xl p-0.5 h-9">
        <button
          onclick={() => editor.undo()}
          disabled={!editor.canUndo}
          class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 hover:text-white disabled:opacity-20 text-neutral-400 transition-colors cursor-pointer"
          title="Geri Al (Ctrl+Z)"
        >
          <Undo2 size={13} />
        </button>
        <div class="w-px h-3.5 bg-white/10 mx-0.5"></div>
        <button
          onclick={() => editor.redo()}
          disabled={!editor.canRedo}
          class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 hover:text-white disabled:opacity-20 text-neutral-400 transition-colors cursor-pointer"
          title="Yinele (Ctrl+Y)"
        >
          <Redo2 size={13} />
        </button>
      </div>

      <!-- Hidden file input for direct media upload from header -->
      <input 
        type="file" 
        multiple 
        accept="video/*,audio/*,image/*" 
        class="hidden" 
        bind:this={headerFileInputRef} 
        onchange={handleMediaUpload} 
      />

      <!-- Desktop Production Pipeline Toggles (Fluid Glass Pill) -->
      <div class="hidden lg:flex items-center spatial-glass rounded-xl p-0.5 gap-1 h-9">
        <button 
          onclick={() => { editor.activeSidebarTab = 'media'; appState.isInspectorOpen = true; }}
          class="px-2.5 h-7 rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer {editor.activeSidebarTab === 'media' && appState.isInspectorOpen ? 'bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30 shadow-[0_0_12px_rgba(56,189,248,0.25)]' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'}"
          title="1. Aşama: Medya Dosyaları ve Varlıklar"
        >
          <FolderClosed size={13} />
          <span>Medya</span>
        </button>
        <button 
          onclick={() => { editor.activeSidebarTab = 'ai'; appState.isInspectorOpen = true; }}
          class="px-2.5 h-7 rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer {editor.activeSidebarTab === 'ai' && appState.isInspectorOpen ? 'bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/30 shadow-[0_0_12px_rgba(168,85,247,0.25)]' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'}"
          title="2. Aşama: Otonom AI Araçları (Sessizlik, Arka Plan, Reframe)"
        >
          <Sparkles size={13} />
          <span>AI Paneli</span>
        </button>
        <button 
          onclick={() => { editor.activeSidebarTab = 'templates'; appState.isInspectorOpen = true; }}
          class="px-2.5 h-7 rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer {editor.activeSidebarTab === 'templates' && appState.isInspectorOpen ? 'bg-pink-500/20 text-pink-300 font-semibold border border-pink-500/30 shadow-[0_0_12px_rgba(244,114,182,0.25)]' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'}"
          title="3. Aşama: Ritmik Şablonlar & Viral Kancalar"
        >
          <Zap size={13} />
          <span>Şablon</span>
        </button>
        <button 
          onclick={() => { editor.activeSidebarTab = 'filters'; appState.isInspectorOpen = true; }}
          class="px-2.5 h-7 rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer {editor.activeSidebarTab === 'filters' && appState.isInspectorOpen ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.25)]' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'}"
          title="4. Aşama: Oklab Sinematik Renk Filtreleri"
        >
          <Sliders size={13} />
          <span>Renk</span>
        </button>
        <button 
          onclick={() => { editor.activeSidebarTab = 'captions'; appState.isInspectorOpen = true; }}
          class="px-2.5 h-7 rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer {editor.activeSidebarTab === 'captions' && appState.isInspectorOpen ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.25)]' : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'}"
          title="5. Aşama: Dinamik Altyazı & Kokoro Seslendirme"
        >
          <Type size={13} />
          <span>Altyazı</span>
        </button>

        <div class="w-px h-4 bg-white/10 mx-0.5"></div>

        <button 
          onclick={() => { appState.isInspectorOpen = !appState.isInspectorOpen; }}
          class="w-7 h-7 rounded-lg text-xs transition-colors flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
          title={appState.isInspectorOpen ? "Yan Paneli Kapat" : "Yan Paneli Aç"}
        >
          <X size={13} class={appState.isInspectorOpen ? '' : 'rotate-45'} />
        </button>
      </div>

      <!-- Settings Icon Pill -->
      <button
        onclick={() => editor.isSettingsModalOpen = true}
        class="spatial-glass hover:bg-white/10 text-neutral-300 hover:text-white h-9 px-2.5 sm:px-3 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-medium"
        title="Donanım ve Proje Ayarları"
      >
        <Sliders size={14} class="text-neutral-400" />
        <span class="hidden 2xl:inline">Ayarlar</span>
      </button>

      <!-- Neon 4K Export Button -->
      <button 
        onclick={() => editor.isExportOpen = true}
        class="neon-btn-export text-white h-9 px-3.5 sm:px-4 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-lg active:scale-95 transition-all"
      >
        <Download size={14} />
        <span>Dışa Aktar</span>
        <span class="hidden sm:inline text-[9px] font-mono bg-white/20 px-1 py-0.5 rounded font-bold">4K</span>
      </button>
    </div>
  </header>

  <!-- Workspace: Unified Workspace Layout (Center Monitor + Dynamic Right Panel) + Dynamic Bottom Timeline/Panel -->
  <div class="flex-1 flex flex-col min-h-0 relative lg:gap-2">
    
    <!-- Top Row: Monitor + Right Inspector/Panel (Desktop) -->
    <div class="flex-1 flex min-h-0 overflow-hidden lg:gap-2">
      
      <!-- Center Pane: Professional Reference Cinema Monitor Stage -->
      <section class="flex-1 relative flex flex-col items-center justify-center bg-[#090a0f] border border-white/5 lg:rounded-2xl p-4 min-h-0 overflow-hidden transition-all">

        <!-- Ambient Top Cinema HUD Pill -->
        <div class="absolute top-3 inset-x-0 flex items-center justify-between px-6 {isFullscreen ? 'fixed z-[60]' : 'z-20'} pointer-events-none">
          <!-- Aspect ratio selector: Mobile single-box dropdown + Desktop modern vector icon pill -->
          <!-- Desktop Bar (sm:flex) -->
          <div class="hidden sm:flex items-center gap-1 spatial-glass p-1 rounded-xl pointer-events-auto shadow-xl">
            <button
              onclick={() => editor.aspectRatio = 'original'}
              class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 {editor.aspectRatio === 'original' ? 'bg-white/20 text-white font-bold shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}"
              title="Videonun Orijinal En-Boy Oranı"
            >
              <div class="w-3.5 h-3.5 border border-current border-dashed rounded-xs opacity-80"></div>
              <span>Orijinal</span>
            </button>
            <button
              onclick={() => editor.aspectRatio = '16:9'}
              class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 {editor.aspectRatio === '16:9' ? 'bg-white/20 text-white font-bold shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}"
              title="Yatay 16:9 (YouTube / Masaüstü)"
            >
              <div class="w-4 h-2.5 border border-current rounded-xs"></div>
              <span>16:9</span>
            </button>
            <button
              onclick={() => editor.aspectRatio = '9:16'}
              class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 {editor.aspectRatio === '9:16' ? 'bg-purple-600/80 text-white font-bold shadow-[0_0_12px_rgba(168,85,247,0.4)]' : 'text-neutral-400 hover:text-neutral-200'}"
              title="Dikey 9:16 (TikTok / Reels / Shorts)"
            >
              <div class="w-2.5 h-4 border border-current rounded-xs"></div>
              <span>9:16</span>
            </button>
            <button
              onclick={() => editor.aspectRatio = '1:1'}
              class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 {editor.aspectRatio === '1:1' ? 'bg-white/20 text-white font-bold shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}"
              title="Kare 1:1 (Instagram Gönderisi)"
            >
              <div class="w-3 h-3 border border-current rounded-xs"></div>
              <span>1:1</span>
            </button>
            <button
              onclick={() => editor.aspectRatio = '21:9'}
              class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 {editor.aspectRatio === '21:9' ? 'bg-indigo-600/80 text-white font-bold shadow-[0_0_12px_rgba(99,102,241,0.4)]' : 'text-neutral-400 hover:text-neutral-200'}"
              title="Sinematik Ultra-Geniş (21:9)"
            >
              <div class="w-4.5 h-2 border border-current rounded-xs"></div>
              <span>21:9</span>
            </button>
          </div>

          <!-- Mobile Single-Box Dropdown (sm:hidden) -->
          <div class="relative sm:hidden pointer-events-auto">
            <button
              onclick={() => isAspectRatioDropdownOpen = !isAspectRatioDropdownOpen}
              class="flex items-center gap-1.5 spatial-glass px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-neutral-200 border border-white/15 shadow-xl active:scale-95 transition-all cursor-pointer"
              title="En-Boy Oranı Değiştir"
            >
              {#if editor.aspectRatio === '16:9'}
                <div class="w-3.5 h-2 border border-current rounded-xs"></div>
                <span>16:9</span>
              {:else if editor.aspectRatio === '9:16'}
                <div class="w-2 h-3.5 border border-purple-400 rounded-xs"></div>
                <span class="text-purple-300 font-bold">9:16</span>
              {:else if editor.aspectRatio === '1:1'}
                <div class="w-2.5 h-2.5 border border-current rounded-xs"></div>
                <span>1:1</span>
              {:else if editor.aspectRatio === '21:9'}
                <div class="w-4 h-1.5 border border-indigo-400 rounded-xs"></div>
                <span class="text-indigo-300">21:9</span>
              {:else}
                <div class="w-3 h-3 border border-current border-dashed rounded-xs opacity-80"></div>
                <span>Orijinal</span>
              {/if}
              <ChevronDown size={12} class="text-neutral-400 transition-transform {isAspectRatioDropdownOpen ? 'rotate-180' : ''}" />
            </button>

            {#if isAspectRatioDropdownOpen}
              <!-- Dropdown Menu Popover -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div 
                class="absolute left-0 top-full mt-1.5 w-36 spatial-glass border border-white/15 rounded-xl p-1 shadow-2xl z-50 flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-1 duration-150 backdrop-blur-xl bg-neutral-950/90"
              >
                <button
                  onclick={() => { editor.aspectRatio = 'original'; isAspectRatioDropdownOpen = false; editor.triggerHaptic('light'); }}
                  class="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer {editor.aspectRatio === 'original' ? 'bg-white/15 text-white font-bold' : 'text-neutral-300 hover:bg-white/5'}"
                >
                  <div class="flex items-center gap-2">
                    <div class="w-3.5 h-3.5 border border-current border-dashed rounded-xs opacity-75"></div>
                    <span>Orijinal</span>
                  </div>
                  {#if editor.aspectRatio === 'original'}<Check size={12} class="text-cyan-400" />{/if}
                </button>
                <button
                  onclick={() => { editor.aspectRatio = '16:9'; isAspectRatioDropdownOpen = false; editor.triggerHaptic('light'); }}
                  class="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer {editor.aspectRatio === '16:9' ? 'bg-white/15 text-white font-bold' : 'text-neutral-300 hover:bg-white/5'}"
                >
                  <div class="flex items-center gap-2">
                    <div class="w-3.5 h-2 border border-current rounded-xs"></div>
                    <span>16:9 Yatay</span>
                  </div>
                  {#if editor.aspectRatio === '16:9'}<Check size={12} class="text-cyan-400" />{/if}
                </button>
                <button
                  onclick={() => { editor.aspectRatio = '9:16'; isAspectRatioDropdownOpen = false; editor.triggerHaptic('light'); }}
                  class="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer {editor.aspectRatio === '9:16' ? 'bg-purple-600/30 text-purple-200 font-bold border border-purple-500/30' : 'text-neutral-300 hover:bg-white/5'}"
                >
                  <div class="flex items-center gap-2">
                    <div class="w-2 h-3.5 border border-purple-400 rounded-xs"></div>
                    <span>9:16 Dikey</span>
                  </div>
                  {#if editor.aspectRatio === '9:16'}<Check size={12} class="text-purple-400" />{/if}
                </button>
                <button
                  onclick={() => { editor.aspectRatio = '1:1'; isAspectRatioDropdownOpen = false; editor.triggerHaptic('light'); }}
                  class="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer {editor.aspectRatio === '1:1' ? 'bg-white/15 text-white font-bold' : 'text-neutral-300 hover:bg-white/5'}"
                >
                  <div class="flex items-center gap-2">
                    <div class="w-2.5 h-2.5 border border-current rounded-xs"></div>
                    <span>1:1 Kare</span>
                  </div>
                  {#if editor.aspectRatio === '1:1'}<Check size={12} class="text-cyan-400" />{/if}
                </button>
                <button
                  onclick={() => { editor.aspectRatio = '21:9'; isAspectRatioDropdownOpen = false; editor.triggerHaptic('light'); }}
                  class="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer {editor.aspectRatio === '21:9' ? 'bg-indigo-600/30 text-indigo-200 font-bold border border-indigo-500/30' : 'text-neutral-300 hover:bg-white/5'}"
                >
                  <div class="flex items-center gap-2">
                    <div class="w-4 h-1.5 border border-indigo-400 rounded-xs"></div>
                    <span>21:9 Sinema</span>
                  </div>
                  {#if editor.aspectRatio === '21:9'}<Check size={12} class="text-indigo-400" />{/if}
                </button>
              </div>
            {/if}
          </div>

          <!-- Video Engine Status + Timecode + Fullscreen -->
          <div class="flex items-center gap-2 pointer-events-auto">
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
          class="relative w-full cursor-pointer select-none touch-none flex items-center justify-center transition-all duration-300 border border-white/10 shadow-2xl overflow-hidden bg-neutral-950 rounded-2xl {isFullscreen ? 'fixed inset-0 z-50 max-w-none max-h-none rounded-none border-none' : (editor.isTimelineCollapsed ? 'max-h-[94%]' : 'max-h-[88%]') + ' ' + (editor.aspectRatio === '9:16' ? (editor.isTimelineCollapsed ? 'max-w-[440px] aspect-[9/16]' : 'max-w-[340px] aspect-[9/16]') : editor.aspectRatio === '16:9' ? (editor.isTimelineCollapsed ? 'max-w-[850px] aspect-[16/9]' : 'max-w-[620px] aspect-[16/9]') : editor.aspectRatio === '21:9' ? (editor.isTimelineCollapsed ? 'max-w-[950px] aspect-[21/9]' : 'max-w-[720px] aspect-[21/9]') : editor.aspectRatio === '1:1' ? (editor.isTimelineCollapsed ? 'max-w-[540px] aspect-square' : 'max-w-[420px] aspect-square') : (editor.isTimelineCollapsed ? 'max-w-[850px]' : 'max-w-[620px]'))}"
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
          <!-- Scaling wrapper with Svelte 5 Error Boundary -->
          <svelte:boundary>
            <div 
              class="w-full h-full flex items-center justify-center transition-transform duration-75 origin-center pointer-events-none"
              style="transform: scale({canvasScale});"
            >
              <canvas bind:this={canvasRef} class="w-full h-full object-contain pointer-events-none"></canvas>
            </div>
            {#snippet failed(error, reset)}
              <div class="flex flex-col items-center justify-center p-6 text-center text-red-400 gap-3">
                <span class="text-sm font-semibold">Video Monitörü Hatası</span>
                <p class="text-xs text-neutral-400 max-w-xs">{error instanceof Error ? error.message : 'Görüntü oluşturulamadı'}</p>
                <button 
                  onclick={() => reset()} 
                  class="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-medium cursor-pointer transition-colors"
                >
                  Monitörü Yenile
                </button>
              </div>
            {/snippet}
          </svelte:boundary>

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
                  {#each activeSubtitleInfo.words as w, idx (idx)}
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
            <FiltersSheet 
              isBottomDocked={false} 
              onClose={() => { 
                editor.activeSidebarTab = 'media'; 
                appState.isInspectorOpen = false; 
              }} 
            />
          {:else}
            <StudioSidebar isMobileSheet={false} hideTabs={true} />
          {/if}
        </div>
      {/if}

    </div>

    <!-- Minimized Transport Control Bar (Pinned Directly Above Timeline) -->
    <div class="flex-none px-3 sm:px-4 py-1.5 grid grid-cols-3 items-center spatial-glass lg:rounded-xl border-t lg:border border-white/10 z-20 transition-all select-none shadow-lg">
      <!-- Left: Razor Cut & Magnet Snapping & Beat Snapping -->
      <div class="flex items-center gap-1.5 justify-self-start">
        <button
          onclick={() => { editor.splitClipAtPlayhead(); editor.triggerHaptic('medium'); }}
          class="px-2 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
          title="Klibi İğne Konumundan Böl (C / Blade All)"
        >
          <Scissors size={15} />
          <span class="hidden sm:inline">Böl</span>
        </button>

        <button
          onclick={() => {
            editor.isMagnetic = !editor.isMagnetic;
            editor.triggerHaptic('light');
          }}
          class="p-1.5 rounded-lg transition-colors cursor-pointer {editor.isMagnetic ? 'text-amber-400 bg-amber-500/15 border border-amber-500/25' : 'text-neutral-500 hover:text-neutral-300'}"
          title={editor.isMagnetic ? "Manyetik Yapışma Açık" : "Manyetik Yapışma Kapalı"}
        >
          <Magnet size={14} />
        </button>

        <button
          onclick={() => {
            editor.snapToBeat = !editor.snapToBeat;
            editor.triggerHaptic('light');
          }}
          class="p-1.5 rounded-lg transition-colors cursor-pointer {editor.snapToBeat ? 'text-pink-400 bg-pink-500/15 border border-pink-500/25' : 'text-neutral-500 hover:text-neutral-300'}"
          title={editor.snapToBeat ? "Ritmik Vuruşlara Yapışma Açık" : "Ritmik Vuruşlara Yapışma Kapalı"}
        >
          <Music size={14} />
        </button>
      </div>

      <!-- Center: True Centered Ergonomic Transport (Başa Al / 1 Kare Geri / Oynat / 1 Kare İleri) -->
      <div class="flex items-center justify-center gap-2 justify-self-center">
        <!-- Başa Al (Jump to Start - 00:00:00 - Kare Buton) -->
        <button
          onclick={() => {
            editor.playhead = 0;
            if (editor.isPlaying) editor.togglePlayback();
            editor.triggerHaptic('medium');
            editor.announce('Başa alındı: 00:00:00');
          }}
          class="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-all text-neutral-300 hover:text-white active:scale-90 cursor-pointer shadow-sm"
          title="Videonun En Başına Al (00:00:00)"
        >
          <Square size={11} class="fill-current text-white/90" />
        </button>

        <button
          onclick={() => { editor.stepFrame(-1); editor.triggerHaptic('light'); }}
          class="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center transition-all text-neutral-400 hover:text-white active:scale-90 cursor-pointer"
          title="1 Kare Geri (Sol Ok / J)"
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
          onclick={() => { editor.stepFrame(1); editor.triggerHaptic('light'); }}
          class="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center transition-all text-neutral-400 hover:text-white active:scale-90 cursor-pointer"
          title="1 Kare İleri (Sağ Ok / L)"
        >
          <SkipForward size={14} />
        </button>
      </div>

      <!-- Right: Zoom Controls & Focus Mode Toggle (Timeline Timecode Removed - already in stage HUD) -->
      <div class="flex items-center gap-1.5 justify-self-end">
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
      <svelte:boundary>
        {#if editor.mobileWorkspace === 'timeline'}
          <Timeline />
        {:else if editor.mobileWorkspace === 'filters'}
          <div class="flex-1 lg:hidden overflow-hidden flex flex-col h-full w-full">
            <FiltersSheet isBottomDocked={true} onClose={() => { editor.mobileWorkspace = 'timeline'; }} />
          </div>
          <!-- On desktop, always show timeline -->
          <div class="hidden lg:flex flex-1 w-full h-full">
            <Timeline />
          </div>
        {:else}
          <!-- Mobile workspace panel swapping logic (hidden on lg, takes timeline spot) -->
          <div class="flex-1 lg:hidden spatial-glass overflow-hidden flex flex-col h-full w-full">
            <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              <StudioSidebar isMobileSheet={false} hideTabs={true} onClose={() => { editor.mobileWorkspace = 'timeline'; }} />
            </div>
          </div>
          <!-- On desktop, show timeline -->
          <div class="hidden lg:flex flex-1 w-full h-full">
            <Timeline />
          </div>
        {/if}
        {#snippet failed(error, reset)}
          <div class="h-full w-full flex flex-col items-center justify-center p-6 text-center text-amber-400 gap-2">
            <span class="text-xs font-semibold">Zaman Çizelgesi Yükleme Hatası</span>
            <p class="text-[11px] text-neutral-400">{error instanceof Error ? error.message : 'Hata oluştu'}</p>
            <button 
              onclick={() => reset()} 
              class="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium rounded-lg cursor-pointer transition-colors"
            >
              Yeniden Başlat
            </button>
          </div>
        {/snippet}
      </svelte:boundary>
    </section>

    <!-- Contextual Bottom Action Bar (Thumb Zone) - Hidden on Desktop -->
    <div class="lg:hidden">
      <BottomBar />
    </div>

  </div>

  <BottomSheet isOpen={editor.activeBottomSheet !== null} onClose={() => editor.closeBottomSheet()}>
    <svelte:boundary>
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
      {#snippet failed(error, reset)}
        <div class="p-6 text-center space-y-3">
          <p class="text-sm font-medium text-red-400">Panel içeriği yüklenirken hata oluştu.</p>
          <p class="text-xs text-neutral-400">{error instanceof Error ? error.message : 'Bilinmeyen hata'}</p>
          <button 
            onclick={() => reset()} 
            class="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold rounded-xl cursor-pointer transition-colors"
          >
            Yeniden Dene
          </button>
        </div>
      {/snippet}
    </svelte:boundary>
  </BottomSheet>

  <ExportModal bind:isOpen={editor.isExportOpen} />
  <!-- Studio Settings Modal -->
  <SettingsModal />
  <!-- Global Command Palette Modal (Ctrl+K) -->
  <Omnibar />
</main>


