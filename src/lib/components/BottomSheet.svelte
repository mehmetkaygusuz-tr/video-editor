<script lang="ts">
  import { editor } from '../editor.svelte';
  
  let { isOpen = false, onClose, children } = $props();

  let sheetRef = $state<HTMLDivElement | undefined>();
  let dragStartY = $state(0);
  let currentY = $state(0);
  let isDragging = $state(false);
  let dragStartTime = 0;

  $effect(() => {
    if (isOpen) {
      currentY = 0;
    }
  });

  function close() {
    editor.triggerHaptic('light');
    if (onClose) onClose();
  }

  function handlePointerDown(e: PointerEvent) {
    if (!sheetRef) return;
    isDragging = true;
    dragStartY = e.clientY - currentY;
    dragStartTime = performance.now();
    sheetRef.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    const y = e.clientY - dragStartY;
    // Only allow dragging downwards with slight elastic resistance upwards
    currentY = Math.max(-15, y);
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isDragging || !sheetRef) return;
    isDragging = false;
    sheetRef.releasePointerCapture(e.pointerId);

    const elapsed = Math.max(1, performance.now() - dragStartTime);
    const velocity = currentY / elapsed;

    // Dismiss if dragged down by > 80px or flicked downwards (velocity > 0.45 px/ms)
    if (currentY > 80 || velocity > 0.45 || currentY > (sheetRef.clientHeight * 0.25)) {
      close();
    } else {
      currentY = 0;
    }
  }
</script>

{#if isOpen}
  <!-- Backdrop with native tap dismiss -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div 
    class="fixed inset-0 bg-black/60 z-40 transition-opacity backdrop-blur-md animate-in fade-in duration-200"
    onclick={close}
  ></div>

  <!-- Sheet: Expanded Height (up to 85dvh) with Spatial Glass & Touch ergonomics -->
  <div
    bind:this={sheetRef}
    class="fixed bottom-0 inset-x-0 max-h-[85dvh] min-h-[46dvh] h-auto spatial-glass rounded-t-3xl z-50 flex flex-col shadow-[0_-16px_48px_rgba(0,0,0,0.7)] transition-transform will-change-transform border-t border-white/15 {isDragging ? 'duration-0' : 'duration-300 ease-out'}"
    style="transform: translateY({Math.max(0, currentY)}px); padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));"
  >
    <!-- Tactile Drag Handle Area (48px comfortable hit target) -->
    <div 
      class="w-full h-12 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing flex-none touch-none select-none py-2"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
      role="presentation"
    >
      <div class="w-14 h-1.5 bg-white/30 rounded-full hover:bg-white/50 transition-colors"></div>
    </div>

    <!-- Content Area with native smooth momentum scrolling -->
    <div class="flex-1 overflow-y-auto overscroll-contain px-4 pb-4 custom-scrollbar">
      {@render children?.()}
    </div>
  </div>
{/if}
