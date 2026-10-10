<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { editor } from '../editor.svelte';
  import { TimelineMemory } from '../engine/timeline/TimelineMemory';
  import { TimelineRenderer } from '../engine/timeline/TimelineRenderer';

  let container: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  
  let memory = new TimelineMemory(1000);
  let renderer: TimelineRenderer;
  let resizeObserver: ResizeObserver;
  
  let nextIntId = 1;

  function hexToInt(hex: string) {
    if (!hex) return 0x1e293b;
    return parseInt(hex.replace('#', ''), 16) || 0x1e293b;
  }

  function hashString(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // 1. Viewport & Navigation state
  $effect(() => {
    memory.zoom = editor.zoom;
    memory.scrollX = editor.scrollX;
    memory.scrollY = editor.scrollY;
  });

  // 2. Playback state
  $effect(() => {
    memory.playhead = editor.playhead;
    memory.isPlaying = editor.isPlaying;
  });

  // 3. Clip Geometry & Attributes (runs only when tracks or selection changes)
  $effect(() => {
    const tracks = editor.tracks;
    const selectedId = editor.selectedClipId;
    let flatIndex = 0;
    
    for (let t = 0; t < tracks.length; t++) {
       const track = tracks[t];
       for (const clip of track.clips) {
          memory.writeClip(flatIndex, {
             intId: hashString(clip.id),
             trackIdx: t,
             startAt: clip.startAt,
             duration: clip.duration,
             sourceOffset: clip.sourceOffset,
             colorInt: hexToInt(clip.color),
             volume: clip.volume || 1,
             selected: selectedId === clip.id
          });
          flatIndex++;
       }
    }
    memory.clipCount = flatIndex;
  });

  onMount(() => {
    if (!canvas || !container) return;
    renderer = new TimelineRenderer(canvas, memory);
    
    resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
         renderer.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    
    resizeObserver.observe(container);
    renderer.start();
  });

  onDestroy(() => {
    if (renderer) renderer.stop();
    if (resizeObserver) resizeObserver.disconnect();
  });
</script>

<div bind:this={container} class="absolute inset-0 pointer-events-none z-0">
  <canvas bind:this={canvas} class="absolute top-0 left-0 outline-none block"></canvas>
</div>
