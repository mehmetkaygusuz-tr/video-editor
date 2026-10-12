<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { editor } from '../editor.svelte';
  import { appState } from '../appState.svelte';
  import { aiService } from '../engine/aiService.svelte';
  import { masterAudioClock } from '../engine/audioClock';
  import Waveform from './Waveform.svelte';
  import type { TimelineClip, TimelineTrack, SeekOptions } from '../types';
  import { quantizeToFrame } from '../engine/timeline/timecode';
  import { 
    ZoomIn, ZoomOut, Sparkles, Volume2, VolumeX, Lock, LockOpen as Unlock,
    Magnet, Music, Scissors, Trash2, Plus, Shuffle, Gauge, Sliders, X,
    Film, Type, FolderClosed, Wand2
  } from '@lucide/svelte';
  
  const TRACK_HEIGHT = 56;
  const RULER_HEIGHT = 28;

  let container = $state<HTMLDivElement>();
  let containerWidth = $state<number>(1920);
  let containerHeight = $state<number>(240);
  let isDraggingPlayhead = false;
  let isPanning = false;
  let lastPanX = 0;
  let lastPanY = 0;
  
  let activePointers = new SvelteMap<number, PointerEvent>();
  let initialPinchDistance = 0;
  let initialZoom = 100;
  let initialPinchCentroidTime = 0;
  let activeSnapGuide = $state<{ time: number; type: 'edge' | 'beat' } | null>(null);

  const isMobileMode = $derived(containerWidth < 768);
  const effectiveHeaderWidth = $derived(isMobileMode ? 44 : 96);
  const viewportStart = $derived(editor.scrollX / editor.zoom);
  const viewportEnd = $derived((editor.scrollX + containerWidth) / editor.zoom);

  // Strict media end: Timeline duration strictly matches the end of media clips via reactive getter
  const dynamicTimelineDuration = $derived(editor.duration);

  // Clamp vertical scroll so timeline never scrolls down into empty space
  const maxScrollY = $derived.by(() => {
    const totalTracksHeight = editor.tracks.length * 56;
    const availableHeight = Math.max(80, containerHeight - 28);
    return Math.max(0, totalTracksHeight - availableHeight);
  });

  $effect(() => {
    if (editor.scrollY > maxScrollY) {
      untrack(() => {
        editor.scrollY = maxScrollY;
      });
    }
  });

  // Adaptive NLE Ruler calculations with viewport virtualization (Prevents DOM bloat and 60fps lag)
  const rulerTicks = $derived.by(() => {
    const minPixelSpacing = 75;
    const standardIntervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    
    // Find smallest interval where major tick labels don't collide
    const interval = standardIntervals.find(sec => sec * editor.zoom >= minPixelSpacing) || 60;
    
    let subInterval = interval / 5;
    if (interval <= 0.5) subInterval = interval / 2;
    else if (interval === 1) subInterval = 0.25;
    else if (interval === 2) subInterval = 0.5;
    else if (interval === 5) subInterval = 1;
    else if (interval === 10) subInterval = 2;
    else if (interval === 15) subInterval = 5;
    else if (interval === 30) subInterval = 5;
    else if (interval === 60) subInterval = 10;

    const totalDuration = dynamicTimelineDuration;
    // Viewport-aware bounds (+ 150px buffer on each side for smooth scrolling)
    const bufferSec = 150 / editor.zoom;
    const renderStartSec = Math.max(0, viewportStart - bufferSec);
    const renderEndSec = Math.min(totalDuration, viewportEnd + bufferSec);

    const startIdx = Math.max(0, Math.floor(renderStartSec / subInterval));
    const endIdx = Math.min(Math.ceil(totalDuration / subInterval), Math.ceil(renderEndSec / subInterval));
    const ticks: { time: number; label: string; left: number; isMajor: boolean }[] = [];
    
    for (let j = startIdx; j <= endIdx; j++) {
      const t = j * subInterval;
      if (t > totalDuration) break;
      const isMajor = Math.abs(t % interval) < 0.001 || Math.abs((t % interval) - interval) < 0.001;
      
      let label = '';
      if (isMajor) {
        if (interval < 1) {
          label = `${t.toFixed(1)}s`;
        } else {
          const m = Math.floor(t / 60);
          const s = Math.floor(t % 60);
          if (m > 0) {
            label = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          } else {
            label = `00:${String(s).padStart(2, '0')}`;
          }
        }
      }

      ticks.push({
        time: t,
        label,
        left: t * editor.zoom,
        isMajor
      });
    }

    return ticks;
  });

  let activeClipDrag: {
    clipId: string;
    mode: 'move' | 'trim-left' | 'trim-right';
    startX: number;
    startY: number;
    initialStartAt: number;
    initialDuration: number;
    initialSourceOffset: number;
    isThresholdMet: boolean;
  } | null = null;
  
  let radialMenuContext = $state<{ clipId: string, x: number, y: number } | null>(null);

  function handleClipContextMenu(e: MouseEvent, clip: TimelineClip) {
    e.preventDefault();
    e.stopPropagation();
    editor.selectClip(clip.id);
    editor.triggerHaptic('medium');
    radialMenuContext = { clipId: clip.id, x: e.clientX, y: e.clientY };
  }
  
  // Need reference to trigger decode when a video clip is dropped or clicked
  import { getFileFromOPFS } from '../opfs';
  
  import { engine } from '../engine/orchestrator.svelte';

  let timelineFileCache = new Map<string, File>();

  async function triggerPreview(assetId: string) {
    const asset = editor.assets.find(a => a.id === assetId);
    if (!asset || asset.type !== 'video') return;
    try {
      let file: File | null | undefined = timelineFileCache.get(asset.name);
      if (!file) {
         file = await getFileFromOPFS(asset.name);
         if (file) timelineFileCache.set(asset.name, file);
      }
      if (file) {
        engine.processVideoTask(file);
      }
    } catch (e) {
      console.error(e);
    }
  }

  let lastClipTapId = '';
  let lastClipTapTime = 0;

  function handleClipPointerDown(e: PointerEvent, clip: TimelineClip, mode: 'move' | 'trim-left' | 'trim-right') {
    e.stopPropagation(); // Prevent panning
    editor.selectClip(clip.id);
    
    // Tap-to-seek on clip: seek playhead immediately to tapped timestamp
    if (mode === 'move' && container) {
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - effectiveHeaderWidth;
      const clickTime = Math.max(0, (mouseX + editor.scrollX) / editor.zoom);
      editor.seekTo(clickTime);
      scheduleSettleSeek();
      editor.renderFrameDirty = true;
    }

    // Double tap / double click detection on clip to seek playhead to clip start (NLE Standard)
    const now = performance.now();
    if (lastClipTapId === clip.id && (now - lastClipTapTime) < 300) {
      editor.seekTo(clip.startAt);
      scheduleSettleSeek();
      editor.renderFrameDirty = true;
      editor.triggerHaptic('light');
      lastClipTapId = '';
      lastClipTapTime = 0;
    } else {
      lastClipTapId = clip.id;
      lastClipTapTime = now;
    }

    if (container) {
       container.setPointerCapture(e.pointerId);
       activePointers.set(e.pointerId, e); // Register as active pointer to route moves
    }
    
    // Trigger subtle mobile haptic feedback if supported
    editor.triggerHaptic('light');

    activeClipDrag = {
      clipId: clip.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      initialStartAt: clip.startAt,
      initialDuration: clip.duration,
      initialSourceOffset: clip.sourceOffset,
      isThresholdMet: mode !== 'move'
    };

    // Auto-preview the clip frame when clicked/dragged
    if (clip.assetId) {
      editor.renderFrameDirty = true;
    }
  }

  function getPinchDistance() {
    const pointers = Array.from(activePointers.values());
    if (pointers.length < 2) return 0;
    const dx = pointers[0].clientX - pointers[1].clientX;
    const dy = pointers[0].clientY - pointers[1].clientY;
    return Math.hypot(dx, dy);
  }

  function getPinchCentroidX() {
    const pointers = Array.from(activePointers.values());
    if (pointers.length < 2) return 0;
    return (pointers[0].clientX + pointers[1].clientX) / 2;
  }

  function setTimelineZoom(targetZoom: number) {
    const newZoom = Math.max(2, Math.min(300, targetZoom));
    editor.zoom = newZoom;
    // Sol 0 sabit kalsın: kullanıcı büyütüp küçülttükçe sola/sağa kayıp gitmez, sol 00:00 başlangıcı daima sabit kalır.
    editor.scrollX = 0;
  }

  function handleWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      // Zoom anchored to left 0
      e.preventDefault();
      const zoomFactor = Math.exp(-e.deltaY * 0.005);
      setTimelineZoom(editor.zoom * zoomFactor);
    } else {
      // Pan with strict boundary clamping
      const maxScrollX = Math.max(0, (dynamicTimelineDuration * editor.zoom) - (containerWidth - effectiveHeaderWidth));
      editor.scrollX = Math.max(0, Math.min(maxScrollX, editor.scrollX + e.deltaX));
      editor.scrollY = Math.max(0, Math.min(maxScrollY, editor.scrollY + e.deltaY));
    }
  }

  // Svelte 5 Effect: Bind non-passive wheel listener with automatic teardown
  $effect(() => {
    const el = container;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  });

  function handlePointerDown(e: PointerEvent) {
    if (!container) return;

    if (radialMenuContext && !(e.target as HTMLElement).closest('.radial-menu-container')) {
       radialMenuContext = null;
    }

    const target = e.target as HTMLElement | null;
    // Butonlara, araç çubuklarına veya kontrollere basıldığında oynatma çizgisinin (kırmızı çizgi) oraya sıçramasını engelle
    if (target && target.closest('button, input, [data-no-scrub], .floating-controls')) {
      return;
    }
    container.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, e);

    if (activePointers.size === 1) {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        // Mouse pan (middle click or alt+click)
        isPanning = true;
        isDraggingPlayhead = false;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
      } else if (x > effectiveHeaderWidth) {
        // Scrub playhead anywhere on timeline background, tracks or ruler
        beginPlayheadScrub(e.clientX);
      }
    } else if (activePointers.size === 2) {
      // Pinch to zoom started
      isPanning = false;
      isDraggingPlayhead = false;
      editor.isScrubbing = false;
      initialPinchDistance = getPinchDistance();
      initialZoom = editor.zoom;
      
      const centroidX = getPinchCentroidX();
      const rect = container?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = centroidX - rect.left - effectiveHeaderWidth;
      initialPinchCentroidTime = (mouseX + editor.scrollX) / editor.zoom;
    }
  }

  let wasPlayingBeforeScrub = false;

  function beginPlayheadScrub(clientX: number) {
    isDraggingPlayhead = true;
    editor.isScrubbing = true;
    isPanning = false;
    activeClipDrag = null;
    if (editor.isPlaying) {
      wasPlayingBeforeScrub = true;
      editor.isPlaying = false;
      masterAudioClock.pause();
    }
    updatePlayhead(clientX);
    scheduleSettleSeek();
    editor.renderFrameDirty = true;
  }

  let settleSeekTimer: any;
  function scheduleSettleSeek() {
    clearTimeout(settleSeekTimer);
    settleSeekTimer = setTimeout(() => {
      editor.renderFrameDirty = true;
      masterAudioClock.seek(editor.playhead, editor.tracks);
    }, 40);
  }

  function handlePlayheadPointerDown(e: PointerEvent) {
    e.stopPropagation();
    if (!container) return;
    container.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, e);
    beginPlayheadScrub(e.clientX);
    editor.triggerHaptic('light');
  }

  function handleRulerPointerDown(e: PointerEvent) {
    e.stopPropagation();
    if (!container) return;
    container.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, e);
    beginPlayheadScrub(e.clientX);
    editor.triggerHaptic('light');
  }

  function handlePointerMove(e: PointerEvent) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, e);
    
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const lastEvent = events[events.length - 1];

    if (activeClipDrag) {
      if (!activeClipDrag.isThresholdMet) {
        const dist = Math.hypot(lastEvent.clientX - activeClipDrag.startX, lastEvent.clientY - activeClipDrag.startY);
        if (dist > 6) {
          activeClipDrag.isThresholdMet = true;
        } else {
          return; // Sub-threshold jitter: tap-to-seek without moving clip
        }
      }

      const dx = lastEvent.clientX - activeClipDrag.startX;
      let timeDelta = dx / editor.zoom;
      
      let seekAssetId: string | undefined;
      let seekTime: number = -1;

      // Find boundaries to prevent overlapping
      const clipTrack = editor.tracks.find(t => t.clips.some(c => c.id === activeClipDrag!.clipId));
      let minStart = 0;
      let maxEnd = Infinity;
      if (clipTrack) {
         const otherClips = clipTrack.clips.filter(c => c.id !== activeClipDrag!.clipId);
         for (const other of otherClips) {
            const otherEnd = other.startAt + other.duration;
            if (otherEnd <= activeClipDrag.initialStartAt && otherEnd > minStart) {
               minStart = otherEnd;
            }
            if (other.startAt >= (activeClipDrag.initialStartAt + activeClipDrag.initialDuration) && other.startAt < maxEnd) {
               maxEnd = other.startAt;
            }
         }
      }

      // Collect Snap Points
      const snapThreshold = 10 / editor.zoom;
      let snapPoints: {time: number, type: 'edge' | 'beat'}[] = [];
      snapPoints.push({time: editor.playhead, type: 'edge'});
      
      if (editor.isMagnetic) {
         editor.tracks.forEach(t => t.clips.forEach(c => {
             if (c.id !== activeClipDrag!.clipId) {
                 snapPoints.push({time: c.startAt, type: 'edge'});
                 snapPoints.push({time: c.startAt + c.duration, type: 'edge'});
             }
         }));
      }
      if (editor.snapToBeat) {
         editor.beatMarkers.forEach(b => snapPoints.push({time: b.time, type: 'beat'}));
      }

      let activeGuide: { time: number; type: 'beat' | 'edge' } | null = null;

      if (activeClipDrag.mode === 'move') {
         let newStart = activeClipDrag.initialStartAt + timeDelta;
         
         // Snapping
         let bestSnapStart = newStart;
         let minSnapDist = snapThreshold;

         for (const p of snapPoints) {
             const distStart = Math.abs(newStart - p.time);
             if (distStart < minSnapDist) {
                 minSnapDist = distStart;
                 bestSnapStart = p.time;
                 activeGuide = { time: p.time, type: p.type };
             }
             const distEnd = Math.abs((newStart + activeClipDrag.initialDuration) - p.time);
             if (distEnd < minSnapDist) {
                 minSnapDist = distEnd;
                 bestSnapStart = p.time - activeClipDrag.initialDuration;
                 activeGuide = { time: p.time, type: p.type };
             }
         }
         newStart = bestSnapStart;

         // Clamp start so it doesn't overlap
         newStart = Math.max(minStart, Math.min(newStart, maxEnd - activeClipDrag.initialDuration));
         
         editor.updateClipBounds(
             activeClipDrag.clipId, 
             newStart, 
             activeClipDrag.initialDuration, 
             activeClipDrag.initialSourceOffset, 
             false
         );
      } else if (activeClipDrag.mode === 'trim-left') {
         const maxDelta = activeClipDrag.initialDuration - 0.1;
         let clampedDelta = Math.min(timeDelta, maxDelta);
         const availableOffset = activeClipDrag.initialSourceOffset;
         let finalDelta = Math.max(-availableOffset, clampedDelta);
         
         let newStartTentative = activeClipDrag.initialStartAt + finalDelta;
         
         // Snapping
         let bestSnapStart = newStartTentative;
         let minSnapDist = snapThreshold;
         for (const p of snapPoints) {
             const dist = Math.abs(newStartTentative - p.time);
             if (dist < minSnapDist) {
                 minSnapDist = dist;
                 bestSnapStart = p.time;
                 activeGuide = { time: p.time, type: p.type };
             }
         }
         newStartTentative = bestSnapStart;
         finalDelta = newStartTentative - activeClipDrag.initialStartAt;

         // Collision clamp
         if (activeClipDrag.initialStartAt + finalDelta < minStart) {
             finalDelta = minStart - activeClipDrag.initialStartAt;
         }
         
         const newSourceOffset = activeClipDrag.initialSourceOffset + finalDelta;
         editor.updateClipBounds(
             activeClipDrag.clipId,
             activeClipDrag.initialStartAt + finalDelta,
             activeClipDrag.initialDuration - finalDelta,
             newSourceOffset,
             false
         );
         
         const clip = editor.tracks.flatMap(t => t.clips).find(c => c.id === activeClipDrag!.clipId);
         if (clip && clip.assetId) {
            seekAssetId = clip.assetId;
            seekTime = newSourceOffset;
         }
      } else if (activeClipDrag.mode === 'trim-right') {
         const minDuration = 0.1;
         let finalDelta = Math.max(minDuration - activeClipDrag.initialDuration, timeDelta);
         let newDuration = activeClipDrag.initialDuration + finalDelta;
         
         let newEndTentative = activeClipDrag.initialStartAt + newDuration;

         // Snapping
         let bestSnapEnd = newEndTentative;
         let minSnapDist = snapThreshold;
         for (const p of snapPoints) {
             const dist = Math.abs(newEndTentative - p.time);
             if (dist < minSnapDist) {
                 minSnapDist = dist;
                 bestSnapEnd = p.time;
                 activeGuide = { time: p.time, type: p.type };
             }
         }
         newDuration = bestSnapEnd - activeClipDrag.initialStartAt;

         // Collision clamp
         if (activeClipDrag.initialStartAt + newDuration > maxEnd) {
             newDuration = maxEnd - activeClipDrag.initialStartAt;
         }

         const clipToTrim = editor.tracks.flatMap(t => t.clips).find(c => c.id === activeClipDrag!.clipId);
         if (clipToTrim && clipToTrim.assetId) {
            const asset = editor.assets.find(a => a.id === clipToTrim.assetId);
            if (asset && asset.duration && asset.duration > 0) {
               const maxAllowed = Math.max(0.1, asset.duration - activeClipDrag.initialSourceOffset);
               if (newDuration > maxAllowed) {
                  newDuration = maxAllowed;
               }
            }
         }
         
         editor.updateClipBounds(
             activeClipDrag.clipId,
             activeClipDrag.initialStartAt,
             newDuration,
             activeClipDrag.initialSourceOffset,
             false
         );
         
         const clip = editor.tracks.flatMap(t => t.clips).find(c => c.id === activeClipDrag!.clipId);
         if (clip && clip.assetId) {
            seekAssetId = clip.assetId;
            seekTime = clip.sourceOffset + newDuration;
         }
      }

      if (activeSnapGuide?.time !== activeGuide?.time || activeSnapGuide?.type !== activeGuide?.type) {
         activeSnapGuide = activeGuide;
      }
      
      if (seekAssetId && seekTime >= 0) {
         editor.renderFrameDirty = true;
      }
      return; // Skip normal panning
    }

    if (activePointers.size === 1) {
      if (isDraggingPlayhead) {
        updatePlayhead(lastEvent.clientX);
      } else if (isPanning) {
        const dx = lastEvent.clientX - lastPanX;
        const dy = lastEvent.clientY - lastPanY;
        editor.scrollX = Math.max(0, editor.scrollX - dx);
        editor.scrollY = Math.max(0, editor.scrollY - dy);
        lastPanX = lastEvent.clientX;
        lastPanY = lastEvent.clientY;
      }
    } else if (activePointers.size === 2) {
      const currentDistance = getPinchDistance();
      if (initialPinchDistance > 0) {
        const scale = currentDistance / initialPinchDistance;
        editor.zoom = Math.max(2, Math.min(500, initialZoom * scale));
        
        const centroidX = getPinchCentroidX();
        const rect = container?.getBoundingClientRect();
        if (!rect) return;
        const mouseX = centroidX - rect.left - effectiveHeaderWidth;
        
        if (mouseX >= 0) {
           editor.scrollX = Math.max(0, (initialPinchCentroidTime * editor.zoom) - mouseX);
        }
      }
    }
  }

  function handlePointerUp(e: PointerEvent) {
    activePointers.delete(e.pointerId);
    if (container && container.hasPointerCapture(e.pointerId)) {
      try { container.releasePointerCapture(e.pointerId); } catch(err) {}
    }
    
    if (activeClipDrag) {
      if (activeClipDrag.isThresholdMet) {
        editor.saveState();
      }
      activeClipDrag = null;
      activeSnapGuide = null;
    }

    if (activePointers.size === 0) {
      if (isDraggingPlayhead) {
        editor.isScrubbing = false;
        masterAudioClock.seek(editor.playhead, editor.tracks);
        editor.renderFrameDirty = true;
        if (wasPlayingBeforeScrub) {
          wasPlayingBeforeScrub = false;
          editor.togglePlayback();
        }
      }
      isDraggingPlayhead = false;
      isPanning = false;
      activeSnapGuide = null;
    } else if (activePointers.size === 1) {
      // Reset panning origin for remaining pointer
      const remaining = Array.from(activePointers.values())[0];
      lastPanX = remaining.clientX;
      lastPanY = remaining.clientY;
    }
  }

  let lastSnapTime = -1;

  function updatePlayhead(clientX: number) {
    const rect = container?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = clientX - rect.left - effectiveHeaderWidth;
    let newTime = Math.max(0, (mouseX + editor.scrollX) / editor.zoom);

    // Auto-scroll when scrubbing near viewport edges
    const edgeMargin = 35;
    if (mouseX > containerWidth - effectiveHeaderWidth - edgeMargin) {
      editor.scrollX = Math.max(0, editor.scrollX + 6);
    } else if (mouseX < edgeMargin && editor.scrollX > 0) {
      editor.scrollX = Math.max(0, editor.scrollX - 6);
    }
    
    // Magnetic Snapping Logic
    const snapThreshold = 12 / editor.zoom; // 12 pixels snapping threshold
    let snapped = false;

    // Check clip edge snaps
    let snapType: 'edge' | 'beat' = 'edge';
    if (editor.isMagnetic) {
      for (const track of editor.tracks) {
        for (const clip of track.clips) {
          if (Math.abs(newTime - clip.startAt) < snapThreshold) {
            newTime = clip.startAt;
            snapped = true;
            snapType = 'edge';
            break;
          }
          if (Math.abs(newTime - (clip.startAt + clip.duration)) < snapThreshold) {
            newTime = clip.startAt + clip.duration;
            snapped = true;
            snapType = 'edge';
            break;
          }
        }
        if (snapped) break;
      }
    }

    // Check beat marker snaps
    if (!snapped && editor.snapToBeat && editor.beatMarkers.length > 0) {
      for (const marker of editor.beatMarkers) {
        if (Math.abs(newTime - marker.time) < snapThreshold) {
          newTime = marker.time;
          snapped = true;
          snapType = 'beat';
          break;
        }
      }
    }

    if (snapped) {
      activeSnapGuide = { time: newTime, type: snapType };
      if (newTime !== lastSnapTime) {
        editor.triggerHaptic('medium');
        lastSnapTime = newTime;
      }
    } else {
      activeSnapGuide = null;
      lastSnapTime = -1;
    }

    editor.playhead = Number(newTime.toFixed(3));
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault(); // allow drop
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleDrop(e: DragEvent, trackId: string) {
    e.preventDefault();
    if (!e.dataTransfer) return;
    
    const assetId = e.dataTransfer.getData('application/x-editor-asset');
    if (!assetId) return;

    const asset = editor.assets.find(a => a.id === assetId);
    if (!asset) return;

    // Calculate drop time based on X coordinate
    const rect = container?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left - effectiveHeaderWidth;
    let dropTime = Math.max(0, (mouseX + editor.scrollX) / editor.zoom);
    
    // Magnetic & Beat Snapping for Drop
    const snapThreshold = Math.max(0.35, 18 / editor.zoom);
    let snapPoints: number[] = [editor.playhead];
    
    if (editor.isMagnetic) {
         editor.tracks.forEach(t => t.clips.forEach(c => {
             snapPoints.push(c.startAt);
             snapPoints.push(c.startAt + c.duration);
         }));
    }
    if (editor.snapToBeat) {
         editor.beatMarkers.forEach(b => snapPoints.push(b.time));
    }
    
    let bestSnap = dropTime;
    let minDist = snapThreshold;
    for (const p of snapPoints) {
        const d = Math.abs(dropTime - p);
        if (d < minDist) {
             minDist = d;
             bestSnap = p;
        }
    }
    dropTime = bestSnap;
    
    // Create a new clip based on the dropped asset
    editor.addClip(trackId, asset.name, dropTime, asset.duration || 10, asset.color, asset.id, { type: asset.type });
    
    // If dropped asset is a video, also create associated audio clip on track A1 (matching StudioSidebar behavior)
    if (asset.type === 'video') {
      let aTrack = editor.tracks.find(t => t.type === 'audio' || t.name === 'A1' || t.name.startsWith('A'));
      if (!aTrack) {
        aTrack = editor.addTrack('A1', 'audio');
      }
      editor.addClip(
        aTrack.id,
        `${asset.name} (Ses)`,
        dropTime,
        asset.duration || 10,
        '#10b981',
        asset.id,
        { type: 'audio' }
      );
      triggerPreview(asset.id);
    }
  }

  let showAddTrackModal = $state(false);

  function addNewTrack(type: 'video' | 'subtitle' | 'effect' | 'audio') {
    const counts = {
      video: editor.tracks.filter(t => t.type === 'video' || t.name.startsWith('V')).length + 1,
      subtitle: editor.tracks.filter(t => t.type === 'subtitle' || t.name.startsWith('T') || t.name.includes('Altyazı')).length + 1,
      effect: editor.tracks.filter(t => t.type === 'effect' || t.name.startsWith('FX') || t.name.includes('Efekt')).length + 1,
      audio: editor.tracks.filter(t => t.type === 'audio' || t.name.startsWith('A')).length + 1,
    };
    const prefix = type === 'video' ? 'V' : type === 'subtitle' ? 'T' : type === 'effect' ? 'FX' : 'A';
    editor.addTrack(`${prefix}${counts[type]}`, type);
    showAddTrackModal = false;
  }

  function handleGlobalDrop(e: DragEvent) {
    e.preventDefault();
    if (!e.dataTransfer) return;
    const assetId = e.dataTransfer.getData('application/x-editor-asset');
    if (!assetId) return;
    const asset = editor.assets.find(a => a.id === assetId);
    if (!asset) return;

    const rect = container?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left - effectiveHeaderWidth;
    let dropTime = Math.max(0, (mouseX + editor.scrollX) / editor.zoom);

    if (editor.tracks.length === 0) {
      if (asset.type === 'video') {
        const vTrack = editor.addTrack('V1', 'video');
        editor.addClip(vTrack.id, asset.name, dropTime, asset.duration || 10, asset.color, asset.id, { type: 'video' });
        const aTrack = editor.addTrack('A1', 'audio');
        editor.addClip(aTrack.id, `${asset.name} (Ses)`, dropTime, asset.duration || 10, '#10b981', asset.id, { type: 'audio' });
        triggerPreview(asset.id);
      } else if (asset.type === 'audio') {
        const aTrack = editor.addTrack('A1', 'audio');
        editor.addClip(aTrack.id, asset.name, dropTime, asset.duration || 10, asset.color, asset.id, { type: 'audio' });
      } else {
        const vTrack = editor.addTrack('V1', 'video');
        editor.addClip(vTrack.id, asset.name, dropTime, asset.duration || 10, asset.color, asset.id, { type: asset.type });
      }
      editor.announce(`"${asset.name}" zaman çizelgesine eklendi.`);
      return;
    }

    let targetTrack: TimelineTrack | undefined;
    if (asset.type === 'video' || asset.type === 'image') {
      targetTrack = editor.tracks.find(t => t.type === 'video' || t.name.startsWith('V'));
      if (!targetTrack) targetTrack = editor.addTrack('V1', 'video');
    } else if (asset.type === 'audio') {
      targetTrack = editor.tracks.find(t => t.type === 'audio' || t.name.startsWith('A'));
      if (!targetTrack) targetTrack = editor.addTrack('A1', 'audio');
    } else {
      targetTrack = editor.tracks[0];
    }

    if (targetTrack) {
      handleDrop(e, targetTrack.id);
    }
  }

  // Calculate visible ticks (very basic virtualization for ruler)
  let visibleDuration = $derived(
    containerWidth > 0 ? containerWidth / editor.zoom : editor.duration
  );

  function handleKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const isEditingText = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (isEditingText) return;

    if (e.code === 'Space') {
      e.preventDefault();
      editor.togglePlayback();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      editor.stepPlayhead(e.shiftKey ? -1.0 : -0.033);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      editor.stepPlayhead(e.shiftKey ? 1.0 : 0.033);
    } else if (e.code === 'Home') {
      e.preventDefault();
      editor.seekTo(0);
    } else if (e.code === 'End') {
      e.preventDefault();
      editor.seekTo(editor.duration);
    } else if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      editor.splitClipAtPlayhead();
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      if (editor.selectedClipId) {
        e.preventDefault();
        editor.deleteClip();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) {
        editor.redo();
      } else {
        editor.undo();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      editor.redo();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
      e.preventDefault();
      editor.duplicateClip();
    } else if (e.code === 'KeyM') {
      e.preventDefault();
      editor.isMagnetic = !editor.isMagnetic;
      editor.announce(editor.isMagnetic ? 'Manyetik mod açık' : 'Manyetik mod kapalı');
    } else if (e.code === 'Escape') {
      editor.selectClip(null);
    }
  }

  // Auto-scroll timeline to follow playhead smoothly during playback
  $effect(() => {
    if (editor.isPlaying && !isDraggingPlayhead && !isPanning && activePointers.size === 0) {
      const currentPlayhead = editor.playhead;
      const currentZoom = editor.zoom;
      untrack(() => {
        const playheadPx = currentPlayhead * currentZoom;
        if (isMobileMode && containerWidth > 0) {
          const targetScroll = Math.max(0, playheadPx - (containerWidth / 2));
          const diff = targetScroll - editor.scrollX;
          if (Math.abs(diff) > 2) {
            // Smoothly interpolate scroll position to follow playhead without stepped jumps
            editor.scrollX = Math.round(editor.scrollX + diff * 0.2);
          }
        } else if (containerWidth > 0) {
          const visibleLeft = editor.scrollX;
          const visibleRight = editor.scrollX + containerWidth - effectiveHeaderWidth;
          if (playheadPx > visibleRight - 40) {
            editor.scrollX = Math.max(0, playheadPx - 80);
          } else if (playheadPx < visibleLeft) {
            editor.scrollX = Math.max(0, playheadPx - 40);
          }
        }
      });
    }
  });
</script>

<svelte:window 
  onkeydown={handleKeyDown}
  onresize={() => {
    if (isMobileMode && containerWidth > 0 && !isDraggingPlayhead) {
       editor.scrollX = Math.max(0, editor.playhead * editor.zoom - (containerWidth / 2));
    }
  }} 
/>

<div 
  class="relative w-full h-full bg-transparent flex flex-col select-none overflow-hidden" 
  bind:this={container}
  bind:clientWidth={containerWidth}
  bind:clientHeight={containerHeight}
  style="touch-action: none;"
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  role="region"
  aria-label="Zaman Çizelgesi Düzenleyici"
>
  <!-- Timeline Body -->
  <div class="relative flex-1 flex overflow-hidden">
    
    <!-- Track Headers (Sticky Left Rail) -->
    <div 
      class="h-full spatial-glass-subtle border-r border-white/10 z-10 flex flex-col flex-none select-none transition-all duration-200"
      style="width: {effectiveHeaderWidth}px;"
    >
      <!-- Ruler Spacer -->
      <div class="h-7 border-b border-white/10 bg-neutral-950/40 flex items-center justify-center">
        {#if !isMobileMode}
          <span class="text-[9px] font-mono font-bold text-neutral-400 uppercase tracking-widest">Kanallar</span>
        {/if}
      </div>
      
      <div class="relative flex-1" style="transform: translate3d(0, -{editor.scrollY}px, 0)">
        {#each editor.tracks as track, trackIndex (track.id)}
          <div class="h-14 border-b border-white/5 flex items-center justify-between px-2 bg-neutral-950/40 hover:bg-white/[0.03] transition-colors">
            <div class="flex items-center gap-1.5 min-w-0">
              {#if track.type === 'video' || track.name.startsWith('V')}
                <span class="px-1.5 py-0.5 rounded-lg text-[10px] font-extrabold font-mono bg-sky-500/20 text-sky-300 border border-sky-500/35 shadow-[0_0_8px_rgba(56,189,248,0.2)] select-none flex items-center gap-1">
                  <Film size={10} />
                  <span>{track.name}</span>
                </span>
              {:else if track.type === 'subtitle' || track.name.startsWith('T') || track.name.includes('Altyazı')}
                <span class="px-1.5 py-0.5 rounded-lg text-[10px] font-extrabold font-mono bg-amber-500/20 text-amber-300 border border-amber-500/35 shadow-[0_0_8px_rgba(245,158,11,0.2)] select-none flex items-center gap-1">
                  <Type size={10} />
                  <span>{track.name}</span>
                </span>
              {:else if track.type === 'effect' || track.name.startsWith('FX') || track.name.includes('Efekt')}
                <span class="px-1.5 py-0.5 rounded-lg text-[10px] font-extrabold font-mono bg-purple-500/20 text-purple-300 border border-purple-500/35 shadow-[0_0_8px_rgba(168,85,247,0.2)] select-none flex items-center gap-1">
                  <Sparkles size={10} />
                  <span>{track.name}</span>
                </span>
              {:else if track.type === 'audio' || track.name.startsWith('A')}
                <span class="px-1.5 py-0.5 rounded-lg text-[10px] font-extrabold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 shadow-[0_0_8px_rgba(16,185,129,0.2)] select-none flex items-center gap-1">
                  <Volume2 size={10} />
                  <span>{track.name}</span>
                </span>
              {:else}
                <span class="px-1.5 py-0.5 rounded-lg text-[10px] font-bold font-mono bg-purple-500/20 text-purple-300 border border-purple-500/35 select-none truncate">
                  {track.name}
                </span>
              {/if}
            </div>
            
            {#if !isMobileMode}
            <div class="flex items-center gap-0.5">
              <button 
                class="w-5 h-5 rounded-md flex items-center justify-center transition-all cursor-pointer {track.isMuted ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-neutral-500 hover:text-white hover:bg-white/10'}" 
                onclick={() => { track.isMuted = !track.isMuted; editor.saveState(); }}
                title={track.isMuted ? "Sesi Aç" : "Sesi Kapat (Mute)"}
              >
                {#if track.isMuted}
                  <VolumeX size={11} />
                {:else}
                  <Volume2 size={11} />
                {/if}
              </button>
              <button 
                class="w-5 h-5 rounded-md flex items-center justify-center transition-all cursor-pointer {track.isLocked ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'text-neutral-500 hover:text-white hover:bg-white/10'}" 
                onclick={() => { track.isLocked = !track.isLocked; editor.saveState(); }}
                title={track.isLocked ? "Kilidi Aç" : "Kanalı Kilitle"}
              >
                {#if track.isLocked}
                  <Lock size={11} />
                {:else}
                  <Unlock size={11} />
                {/if}
              </button>
              {#if track.clips.length === 0}
                <button 
                  class="w-5 h-5 rounded-md flex items-center justify-center transition-all text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer" 
                  onclick={() => editor.deleteTrack(track.id)}
                  title="Boş Kanalı Sil"
                >
                  <Trash2 size={11} />
                </button>
              {/if}
            </div>
            {/if}
          </div>
        {/each}

        <!-- Add Track Button in Rail -->
        {#if !isMobileMode}
          <div class="p-1 relative">
            <button
              onclick={() => showAddTrackModal = !showAddTrackModal}
              class="w-full py-1 rounded-lg border border-dashed border-white/15 hover:border-white/30 text-[10px] font-mono text-neutral-400 hover:text-white flex items-center justify-center gap-1 transition-all cursor-pointer hover:bg-white/5"
              title="Yeni Video, Altyazı, Efekt veya Ses Kanalı Ekle"
            >
              <Plus size={11} />
              <span>Kanal</span>
            </button>

            {#if showAddTrackModal}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                class="absolute left-full top-0 ml-2 z-50 w-36 spatial-glass rounded-xl p-1 shadow-2xl border border-white/15 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100"
                onclick={(e) => e.stopPropagation()}
              >
                <button 
                  onclick={() => addNewTrack('video')}
                  class="w-full px-2 py-1.5 rounded-lg text-left text-[11px] font-medium text-sky-300 hover:bg-sky-500/20 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Film size={12} />
                  <span>+ Video (V)</span>
                </button>
                <button 
                  onclick={() => addNewTrack('subtitle')}
                  class="w-full px-2 py-1.5 rounded-lg text-left text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Type size={12} />
                  <span>+ Altyazı (T)</span>
                </button>
                <button 
                  onclick={() => addNewTrack('effect')}
                  class="w-full px-2 py-1.5 rounded-lg text-left text-[11px] font-medium text-purple-300 hover:bg-purple-500/20 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Sparkles size={12} />
                  <span>+ Efekt (FX)</span>
                </button>
                <button 
                  onclick={() => addNewTrack('audio')}
                  class="w-full px-2 py-1.5 rounded-lg text-left text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Volume2 size={12} />
                  <span>+ Ses (A)</span>
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- Tracks Canvas (Scrollable) -->
    <div class="relative flex-1 h-full overflow-hidden bg-neutral-900/50">
      <!-- Adaptive NLE Ruler (Spatial Glass) -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="absolute top-0 left-0 right-0 h-7 border-b border-white/10 spatial-glass-subtle z-20 select-none overflow-hidden cursor-pointer"
        onpointerdown={handleRulerPointerDown}
      >
        <div class="relative w-full h-full pointer-events-none" style="transform: translate3d(-{editor.scrollX}px, 0, 0)">
          {#each rulerTicks as tick (tick.left)}
            {#if tick.isMajor}
              <div 
                class="absolute top-1 font-mono text-[10px] text-neutral-300 font-semibold whitespace-nowrap select-none pointer-events-none"
                style="left: {tick.left + 4}px;"
              >
                {tick.label}
              </div>
              <div 
                class="absolute bottom-0 w-px bg-white/40 h-3 pointer-events-none" 
                style="left: {tick.left}px;"
              ></div>
            {:else}
              <div 
                class="absolute bottom-0 w-px bg-white/15 h-1.5 pointer-events-none" 
                style="left: {tick.left}px;"
              ></div>
            {/if}
          {/each}

          <!-- Beat Markers along ruler -->
          {#if editor.beatMarkers.length > 0}
            {#each editor.beatMarkers as marker (marker.time)}
              <div 
                class="absolute bottom-0 w-1.5 h-3 -translate-x-1/2 flex flex-col items-center pointer-events-none z-10"
                style="left: {marker.time * editor.zoom}px;"
                title="{marker.label || 'Vuruş'} ({marker.time.toFixed(2)}s)"
              >
                <div class="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)] animate-pulse"></div>
                <div class="w-0.5 h-1.5 bg-amber-400/80"></div>
              </div>
            {/each}
          {/if}

          <!-- SMPTE In / Out Selected Range Highlight on Ruler -->
          {#if editor.inPoint !== null || editor.outPoint !== null}
            {@const startX = (editor.inPoint ?? 0) * editor.zoom}
            {@const endX = (editor.outPoint ?? editor.duration) * editor.zoom}
            {@const rangeWidth = Math.max(2, endX - startX)}
            <div 
              class="absolute top-0 bottom-0 bg-indigo-500/25 border-x-2 border-indigo-400 z-10 pointer-events-none shadow-[0_0_12px_rgba(99,102,241,0.3)]"
              style="left: {startX}px; width: {rangeWidth}px;"
            >
              {#if editor.inPoint !== null}
                <div class="absolute top-0.5 left-0.5 text-[8px] font-bold text-indigo-200 font-mono bg-indigo-950/90 px-1 rounded-xs border border-indigo-500/50">
                  [IN]
                </div>
              {/if}
              {#if editor.outPoint !== null}
                <div class="absolute top-0.5 right-0.5 text-[8px] font-bold text-indigo-200 font-mono bg-indigo-950/90 px-1 rounded-xs border border-indigo-500/50">
                  [OUT]
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Tracks Container -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="absolute top-7 left-0 right-0 bottom-0"
        style="transform: translate3d(-{editor.scrollX}px, -{editor.scrollY}px, 0); width: {Math.max(containerWidth, (editor.duration * editor.zoom) + 120)}px;"
        ondragover={handleDragOver}
        ondrop={handleGlobalDrop}
      >
        {#if editor.tracks.length === 0 || editor.tracks.every(t => t.clips.length === 0)}
          <div class="hidden sm:flex absolute inset-0 flex-col items-center justify-center pointer-events-none text-neutral-500 gap-2 select-none z-0">
            <div class="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-neutral-400">
              <FolderClosed size={20} />
            </div>
            <p class="text-xs font-semibold text-neutral-300">Zaman Çizelgesi Hazır</p>
            <p class="text-[11px] text-neutral-500 font-mono">Medya havuzundan video veya ses sürükleyip bırakın</p>
          </div>
        {/if}

        <!-- Visual End of Video Cap (Only rendered when timeline contains actual media clips) -->
        {#if editor.tracks.some(t => t.clips.length > 0) && editor.duration > 0}
          <div 
            class="absolute top-0 bottom-0 w-[2px] bg-rose-500/80 z-20 pointer-events-none shadow-[0_0_10px_rgba(244,63,94,0.6)]"
            style="transform: translate3d({editor.duration * editor.zoom}px, 0, 0);"
          >
            <div class="absolute -top-6 -left-3 px-1.5 py-0.5 rounded bg-rose-600/90 text-white text-[8px] font-mono font-bold uppercase shadow tracking-tight">
              Bitiş
            </div>
          </div>
        {/if}

        {#each editor.tracks as track, trackIndex (track.id)}
          {@const visibleClips = track.clips.filter(clip => clip.startAt <= viewportEnd && (clip.startAt + clip.duration) >= viewportStart)}
          <div 
            role="region"
            aria-label="Kanal {trackIndex + 1}"
            class="absolute left-0 right-0 h-14 border-b border-white/5 flex items-center group {track.isLocked ? 'opacity-50 pointer-events-none' : ''}"
            style="top: {trackIndex * TRACK_HEIGHT}px;"
            ondragover={handleDragOver}
            ondrop={(e) => handleDrop(e, track.id)}
          >
            <!-- Background grid subtle markers -->
            <div class="absolute inset-0 pointer-events-none opacity-10" 
                 style="background-image: repeating-linear-gradient(to right, transparent, transparent {editor.zoom - 1}px, #888888 {editor.zoom}px);">
            </div>
            
            {#each visibleClips as clip (clip.id)}
              {@render timelineClip(clip)}
            {/each}
          </div>
        {/each}

        <!-- Magnetic / Beat Snap Indicator Line -->
        {#if activeSnapGuide}
          <div 
            class="absolute top-0 bottom-0 w-[2px] z-25 pointer-events-none transition-opacity duration-150 animate-pulse {activeSnapGuide.type === 'beat' ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.9)]' : 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)]'}"
            style="transform: translate3d({activeSnapGuide.time * editor.zoom}px, 0, 0);"
          >
            <div class="absolute -top-6 -left-2 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase {activeSnapGuide.type === 'beat' ? 'bg-amber-500 text-black shadow-md' : 'bg-cyan-500 text-black shadow-md'}">
              {activeSnapGuide.type === 'beat' ? 'Ritim' : 'Snap'}
            </div>
          </div>
        {/if}
      </div>

      <!-- Independent Top-Level Playhead & Scrubber Overlay Layer (z-40) -->
      <div class="absolute inset-0 pointer-events-none z-40 overflow-hidden">
        <div class="relative w-full h-full pointer-events-none" style="transform: translate3d(-{editor.scrollX}px, 0, 0);">
          <!-- 28px Touch Corridor with pointer-events-auto -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div 
            class="absolute top-0 bottom-0 pointer-events-auto cursor-ew-resize select-none touch-none flex flex-col items-center group/playhead"
            style="left: 0; transform: translate3d({(editor.playhead * editor.zoom) - 14}px, 0, 0); width: 28px; outline: none !important; border: none !important; box-shadow: none !important;"
            onpointerdown={handlePlayheadPointerDown}
            role="slider"
            tabindex="-1"
            aria-label="Oynatma Çizgisi"
            aria-valuenow={editor.playhead}
            aria-valuemin={0}
            aria-valuemax={editor.duration}
          >
            <!-- Ruby Diamond Head Marker in Ruler Area (Height 28px) -->
            <div class="w-full h-7 flex flex-col items-center justify-center pointer-events-auto group-active/playhead:scale-110">
              <div class="w-5 h-4 bg-gradient-to-b from-rose-500 to-rose-600 rounded-t-md shadow-[0_0_12px_rgba(244,63,94,0.95)] flex items-center justify-center border border-white/50">
                <div class="w-1 h-2 bg-white rounded-full shadow-sm"></div>
              </div>
              <div class="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[8px] border-t-rose-600"></div>
            </div>

            <!-- Vertical Neon Laser Line across all tracks -->
            <div class="w-[2px] flex-1 bg-gradient-to-b from-rose-500 via-purple-500 to-indigo-500 shadow-[0_0_12px_rgba(244,63,94,0.9)] pointer-events-none group-hover/playhead:w-[3px] group-hover/playhead:brightness-125"></div>
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- Radial Context Menu -->
  {#if radialMenuContext}
    {@const ctx = radialMenuContext}
    <!-- Transparent backdrop to dismiss radial menu on outside click without triggering underlying tools -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div 
      class="fixed inset-0 z-[99] bg-transparent cursor-default pointer-events-auto"
      onclick={(e) => { e.stopPropagation(); radialMenuContext = null; }}
      oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); radialMenuContext = null; }}
    ></div>
    <div 
      class="radial-menu-container fixed z-[100]"
      style="left: {ctx.x}px; top: {ctx.y}px;"
    >
      <div class="absolute -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full pointer-events-none animate-in zoom-in-50 duration-200">
        <!-- Close Center -->
        <button 
          class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-neutral-900/90 border border-white/20 text-white flex items-center justify-center pointer-events-auto shadow-2xl active:scale-95 transition-all backdrop-blur-md"
          onclick={() => radialMenuContext = null}
        >
          <X size={20} />
        </button>
        
        <!-- Action 1: Split (Top) -->
        <button 
          class="absolute w-10 h-10 rounded-full bg-neutral-800/95 border border-white/10 text-sky-400 flex items-center justify-center pointer-events-auto shadow-xl hover:bg-neutral-700 hover:scale-110 active:scale-95 transition-all backdrop-blur-md"
          style="left: calc(50% - 20px); top: calc(50% - 20px - 68px);"
          onclick={() => { editor.splitClipAtPlayhead(ctx.clipId); radialMenuContext = null; }}
          title="Böl"
        >
          <Scissors size={18} />
        </button>

        <!-- Action 2: Duplicate (Right) -->
        <button 
          class="absolute w-10 h-10 rounded-full bg-neutral-800/95 border border-white/10 text-indigo-400 flex items-center justify-center pointer-events-auto shadow-xl hover:bg-neutral-700 hover:scale-110 active:scale-95 transition-all backdrop-blur-md"
          style="left: calc(50% - 20px + 68px); top: calc(50% - 20px);"
          onclick={() => { editor.duplicateClip(ctx.clipId); radialMenuContext = null; }}
          title="Çoğalt"
        >
          <Plus size={18} />
        </button>

        <!-- Action 3: Delete (Bottom) -->
        <button 
          class="absolute w-10 h-10 rounded-full bg-rose-900/80 border border-rose-500/30 text-rose-300 flex items-center justify-center pointer-events-auto shadow-xl hover:bg-rose-800 hover:scale-110 active:scale-95 transition-all backdrop-blur-md"
          style="left: calc(50% - 20px); top: calc(50% - 20px + 68px);"
          onclick={() => { editor.deleteClip(ctx.clipId); radialMenuContext = null; }}
          title="Sil"
        >
          <Trash2 size={18} />
        </button>

        <!-- Action 4: Filters (Left) -->
        <button 
          class="absolute w-10 h-10 rounded-full bg-neutral-800/95 border border-white/10 text-neutral-300 flex items-center justify-center pointer-events-auto shadow-xl hover:bg-neutral-700 hover:scale-110 active:scale-95 transition-all backdrop-blur-md"
          style="left: calc(50% - 20px - 68px); top: calc(50% - 20px);"
          onclick={() => { 
            if (window.innerWidth >= 1024) {
              editor.activeSidebarTab = 'filters';
              appState.isInspectorOpen = true;
            } else {
              editor.mobileWorkspace = 'filters';
            }
            radialMenuContext = null; 
          }}
          title="Renk Filtreleri"
        >
          <Sliders size={18} />
        </button>
      </div>
    </div>
  {/if}

  <!-- Screen Reader Announcements (WCAG 2.2 Live Region) -->
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {editor.announcement}
  </div>
</div>

{#snippet timelineClip(clip: TimelineClip)}
  <!-- Outer Clip Container (2026 Spatial Glass Capsule) -->
  <div 
    role="button"
    tabindex="0"
    aria-label="{clip.name}, Başlangıç: {clip.startAt.toFixed(2)}s, Süre: {clip.duration.toFixed(2)}s."
    aria-pressed={editor.selectedClipId === clip.id}
    class="absolute top-1 bottom-1 rounded-xl shadow-md border cursor-pointer select-none transition-[box-shadow,ring-color,border-color,filter] duration-150 group/clip overflow-hidden focus-visible:outline-none {editor.selectedClipId === clip.id ? 'ring-2 ring-purple-400 border-white shadow-[0_0_16px_rgba(168,85,247,0.45)] brightness-110 z-20' : 'border-white/10 hover:border-white/25 brightness-100'}"
    style="left: {clip.startAt * editor.zoom}px; width: {clip.duration * editor.zoom}px; background: {clip.type === 'audio' ? 'linear-gradient(135deg, rgba(6, 78, 59, 0.85) 0%, rgba(16, 185, 129, 0.5) 100%)' : clip.type === 'text' ? 'linear-gradient(135deg, rgba(120, 53, 15, 0.85) 0%, rgba(245, 158, 11, 0.5) 100%)' : 'linear-gradient(135deg, rgba(30, 58, 138, 0.85) 0%, rgba(37, 99, 235, 0.5) 100%)'};"
    onpointerdown={(e) => handleClipPointerDown(e, clip, 'move')}
    ondblclick={(e) => {
      e.stopPropagation();
      e.preventDefault();
      editor.selectClip(clip.id);
      editor.seekTo(clip.startAt);
      scheduleSettleSeek();
      editor.renderFrameDirty = true;
    }}
    oncontextmenu={(e) => handleClipContextMenu(e, clip)}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        editor.selectClip(clip.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        editor.deleteClip(clip.id);
      }
    }}
  >
    <!-- Top inner highlight specular glass line -->
    <div class="absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-white/40 via-white/80 to-white/40 pointer-events-none"></div>

    <!-- Connected Clip Anchor Pin (Primary Storyline Link) -->
    {#if clip.parentClipId}
      <div 
        class="absolute -top-1 left-2 w-2 h-2 rounded-full bg-cyan-400 border border-neutral-900 shadow-sm z-20 pointer-events-none"
        title="Ana Kurgu Omurgasına Bağlı Klip (Connected Clip)"
      ></div>
    {/if}

    <!-- Clip Inner Content -->
    <div class="w-full h-full relative pointer-events-none overflow-hidden">
      {#if clip.assetId}
        <div class="opacity-70">
          <svelte:boundary>
            <Waveform 
               assetId={clip.assetId} 
               color={clip.color} 
               sourceOffset={clip.sourceOffset} 
               duration={clip.duration} 
               zoom={editor.zoom} 
            />
            {#snippet failed(error, reset)}
              <div class="absolute inset-0 flex items-center justify-center text-[9px] text-amber-300 bg-amber-950/30">
                <span>Dalga yüklenemedi</span>
              </div>
            {/snippet}
          </svelte:boundary>
        </div>
      {/if}

      <!-- VAD Silences (Context-Aware) -->
      {#if clip.vadSilences}
        {#each clip.vadSilences as silence (silence.start)}
          {@const silenceStart = Math.max(0, silence.start - clip.sourceOffset)}
          {@const silenceEnd = Math.min(clip.duration, silence.end - clip.sourceOffset)}
          {#if silenceEnd > 0 && silenceStart < clip.duration && silenceEnd > silenceStart}
            <div 
              class="absolute top-0 bottom-0 pointer-events-none z-0 border-l border-r border-rose-500/30"
              style="left: {silenceStart * editor.zoom}px; width: {(silenceEnd - silenceStart) * editor.zoom}px; background-image: repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(244, 63, 94, 0.15) 4px, rgba(244, 63, 94, 0.15) 8px);"
            >
               <div class="absolute top-1 left-1 bg-rose-500/80 text-[8px] font-mono font-bold text-white px-1 rounded-sm shadow-sm opacity-60 truncate">SESSİZ</div>
            </div>
          {/if}
        {/each}
      {/if}

      <!-- Whisper Transcripts (Context-Aware) -->
      {#if clip.subtitles}
        {#each clip.subtitles as sub (sub.start)}
          {#if sub.words}
            {#each sub.words as word, wIdx (wIdx)}
              {@const wordStart = Math.max(0, word.start - clip.sourceOffset)}
              {@const wordEnd = Math.min(clip.duration, word.end - clip.sourceOffset)}
              {#if wordEnd > 0 && wordStart < clip.duration && wordEnd > wordStart}
                <div 
                  class="absolute bottom-1 h-3.5 bg-neutral-900/80 border border-white/10 rounded-sm flex items-center justify-center overflow-hidden z-10"
                  style="left: {wordStart * editor.zoom}px; width: {(wordEnd - wordStart) * editor.zoom}px;"
                >
                  <span class="text-[8px] text-white/90 whitespace-nowrap truncate px-0.5 pointer-events-none select-none">{word.word}</span>
                </div>
              {/if}
            {/each}
          {/if}
        {/each}
      {/if}
      
      <div class="absolute inset-0 px-2 flex items-center justify-between z-10 pointer-events-none">
        <div class="flex items-center gap-1.5 min-w-0">
          {#if clip.isBgRemoved || clip.cropRect || clip.name.startsWith('TTS:') || clip.name.includes('[Parça')}
            <span class="p-0.5 rounded bg-black/40 text-amber-300 flex-none" title="AI Destekli Klip">
              <Sparkles size={9} />
            </span>
          {/if}
          {#if clip.transitionIn || clip.transitionOut}
            <span class="px-1 py-0.2 bg-indigo-900/80 border border-indigo-400/40 text-indigo-200 rounded text-[9px] font-mono flex-none" title="Geçiş Aktif">
              {clip.transitionIn?.type || clip.transitionOut?.type}
            </span>
          {/if}
          {#if clip.speedCurve}
            <span class="px-1 py-0.2 bg-amber-900/80 border border-amber-400/50 text-amber-200 rounded text-[9px] font-mono flex items-center gap-0.5 flex-none" title="Hız Eğrisi: {clip.speedCurve.preset}">
              <Gauge size={8} />
              <span>{clip.speedCurve.preset}</span>
            </span>
          {:else if clip.speed && clip.speed !== 1.0}
            <span class="px-1 py-0.2 bg-neutral-900/80 border border-white/20 text-amber-300 rounded text-[9px] font-mono flex-none">
              {clip.speed}x
            </span>
          {/if}
          {#if clip.audioEnvelope && (clip.audioEnvelope.fadeIn > 0 || clip.audioEnvelope.fadeOut > 0 || clip.audioEnvelope.ducking)}
            <span class="px-1 py-0.2 bg-emerald-900/80 border border-emerald-400/50 text-emerald-200 rounded text-[9px] font-mono flex items-center gap-0.5 flex-none" title="Ses Zarfı / Ducking Aktif">
              <Sliders size={8} />
              <span>{clip.audioEnvelope.ducking ? 'Ducking' : 'Fade'}</span>
            </span>
          {/if}
          <span class="text-[11px] font-medium text-white/95 truncate block">{clip.name}</span>
        </div>
        <span class="text-[10px] font-mono text-white/60 ml-1.5 flex-none select-none">{clip.duration.toFixed(1)}s</span>
      </div>
    </div>
      
    <!-- Sleek Trim Handles (Internal touch-friendly edges with 44px+ mobile touch tap area) -->
    <div 
       role="slider"
       tabindex="0"
       aria-label="{clip.name} sol kırpma tutamacı"
       aria-valuenow={clip.startAt}
       class="absolute left-0 top-0 bottom-0 w-7 sm:w-4 cursor-ew-resize flex items-center justify-center z-20 pointer-events-auto transition-colors hover:bg-white/30 active:bg-white/40 touch-none {editor.selectedClipId === clip.id ? 'bg-white/20 opacity-100 shadow-[inset_2px_0_0_#fff]' : 'opacity-40 md:opacity-0 md:group-hover/clip:opacity-100'}"
       onpointerdown={(e) => handleClipPointerDown(e, clip, 'trim-left')}
       onkeydown={(e) => {
         if (e.key === 'ArrowLeft') {
           e.preventDefault();
           editor.updateClipBounds(clip.id, clip.startAt - 0.1, clip.duration + 0.1, clip.sourceOffset - 0.1);
         } else if (e.key === 'ArrowRight') {
           e.preventDefault();
           editor.updateClipBounds(clip.id, clip.startAt + 0.1, clip.duration - 0.1, clip.sourceOffset + 0.1);
         }
       }}
    >
       <div class="w-1.5 sm:w-1 h-7 sm:h-5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.9)] flex items-center justify-center">
         <div class="w-0.5 h-3 bg-neutral-900/60 rounded-full sm:hidden"></div>
       </div>
    </div>
    <div 
       role="slider"
       tabindex="0"
       aria-label="{clip.name} sağ kırpma tutamacı"
       aria-valuenow={clip.startAt + clip.duration}
       class="absolute right-0 top-0 bottom-0 w-7 sm:w-4 cursor-ew-resize flex items-center justify-center z-20 pointer-events-auto transition-colors hover:bg-white/30 active:bg-white/40 touch-none {editor.selectedClipId === clip.id ? 'bg-white/20 opacity-100 shadow-[inset_-2px_0_0_#fff]' : 'opacity-40 md:opacity-0 md:group-hover/clip:opacity-100'}"
       onpointerdown={(e) => handleClipPointerDown(e, clip, 'trim-right')}
       onkeydown={(e) => {
         if (e.key === 'ArrowLeft') {
           e.preventDefault();
           editor.updateClipBounds(clip.id, clip.startAt, clip.duration - 0.1, clip.sourceOffset);
         } else if (e.key === 'ArrowRight') {
           e.preventDefault();
           editor.updateClipBounds(clip.id, clip.startAt, clip.duration + 0.1, clip.sourceOffset);
         }
       }}
    >
       <div class="w-1.5 sm:w-1 h-7 sm:h-5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.9)] flex items-center justify-center">
         <div class="w-0.5 h-3 bg-neutral-900/60 rounded-full sm:hidden"></div>
       </div>
    </div>
  </div>
{/snippet}
