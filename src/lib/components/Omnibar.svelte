<script lang="ts">
  import { Sparkles, ArrowUp, Loader2, CheckCircle2, AlertCircle, X, Command } from '@lucide/svelte';
  import { aiService } from '../engine/aiService.svelte';
  import { editor } from '../editor.svelte';
  import { agenticEditor } from '../engine/AgenticEditor';

  let prompt = $state('');
  let isFocused = $state(false);
  let statusState = $state<'idle' | 'running' | 'success' | 'error'>('idle');
  let statusMessage = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (editor.isCommandPaletteOpen && inputEl) {
      setTimeout(() => inputEl?.focus(), 50);
    }
  });

  function closePalette() {
    if (statusState === 'running') return;
    editor.isCommandPaletteOpen = false;
  }

  async function handleSubmit(e?: SubmitEvent) {
    if (e) e.preventDefault();
    const currentPrompt = prompt.trim();
    if (!currentPrompt || aiService.isRunning || editor.isProcessing) return;

    statusState = 'running';
    statusMessage = 'Komut analiz ediliyor ve uygulanıyor...';

    const res = await agenticEditor.executeNaturalLanguageCommand(currentPrompt);

    if (res.success) {
      statusState = 'success';
      statusMessage = res.message;
      prompt = '';
      setTimeout(() => {
        statusState = 'idle';
        statusMessage = '';
        editor.isCommandPaletteOpen = false;
      }, 1800);
    } else {
      statusState = 'error';
      statusMessage = res.message;
      setTimeout(() => {
        if (statusState === 'error') {
          statusState = 'idle';
          statusMessage = '';
        }
      }, 4000);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closePalette();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if editor.isCommandPaletteOpen}
  <!-- Command Palette Modal Backdrop (Descript / Runway Style) -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div 
    class="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150"
    onclick={closePalette}
    role="presentation"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div 
      class="w-full max-w-xl flex flex-col pointer-events-auto"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex={-1}
      aria-label="AI Video Komut Asistanı"
    >
      <!-- Dynamic AI Feedback Pill -->
      {#if statusState !== 'idle'}
        <div class="mb-2 px-3.5 py-2 rounded-xl text-xs font-medium backdrop-blur-xl border flex items-center justify-between shadow-2xl transition-all animate-in fade-in duration-200 {statusState === 'running' ? 'bg-indigo-950/90 border-indigo-500/40 text-indigo-200' : statusState === 'success' ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200' : 'bg-red-950/90 border-red-500/40 text-red-200'}">
          <div class="flex items-center gap-2">
            {#if statusState === 'running'}
              <Loader2 size={14} class="animate-spin text-indigo-400" />
            {:else if statusState === 'success'}
              <CheckCircle2 size={14} class="text-emerald-400" />
            {:else}
              <AlertCircle size={14} class="text-red-400" />
            {/if}
            <span class="truncate max-w-[400px]">{statusMessage}</span>
          </div>
          <span class="text-[10px] opacity-80 font-mono">
            {#if editor.agentTelemetry.executionTimeMs > 0 && statusState !== 'running'}
              {editor.agentTelemetry.executionTimeMs}ms
            {/if}
          </span>
        </div>
      {/if}

      <!-- Command Palette Bar -->
      <form 
        onsubmit={handleSubmit}
        class="relative group bg-neutral-900 border border-white/20 shadow-2xl rounded-2xl overflow-hidden flex items-center p-2 transition-all"
      >
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center flex-none">
          <Sparkles size={16} class="text-indigo-400 {aiService.isRunning || editor.isProcessing ? 'animate-spin' : ''}" />
        </div>
        
        <input 
          bind:this={inputEl}
          type="text" 
          bind:value={prompt}
          onfocus={() => isFocused = true}
          onblur={() => isFocused = false}
          disabled={aiService.isRunning || editor.isProcessing}
          placeholder={aiService.isRunning || editor.isProcessing ? "AI İşlemi Yürütülüyor..." : "AI Video Asistanı (Örn: 'Sessizlikleri sil', 'Altyazı üret', '2x hızlandır', '9:16 dikey yap')"}
          class="flex-1 bg-transparent border-none text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-0 px-3 min-w-0"
        />
        
        <div class="flex items-center gap-1.5 flex-none">
          <button 
            type="submit"
            disabled={!prompt.trim() || aiService.isRunning || editor.isProcessing}
            class="w-8 h-8 rounded-xl bg-white text-black flex items-center justify-center hover:bg-neutral-200 active:scale-95 disabled:opacity-30 disabled:hover:bg-white transition-all cursor-pointer"
            title="Komutu Çalıştır (Enter)"
          >
            <ArrowUp size={15} />
          </button>
          <button 
            type="button"
            onclick={closePalette}
            class="w-8 h-8 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
            title="Kapat (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        {#if aiService.isRunning || editor.isProcessing}
          <div class="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 animate-pulse w-full"></div>
        {/if}
      </form>

      <!-- Quick Action Suggestion Chips -->
      <div class="flex items-center gap-1.5 overflow-x-auto py-2 px-1 no-scrollbar [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {#each [
          { label: '🎙️ Sessizlikleri Sil', cmd: 'Sessizlikleri sil ve akıcı bağla' },
          { label: '💬 Altyazı Üret', cmd: 'Otomatik altyazı üret' },
          { label: '🎵 Ritim Senkronu', cmd: 'Müzik ritmine göre kesim yap' },
          { label: '✨ Arka Planı Sil', cmd: 'Arka planı sil' },
          { label: '📱 9:16 Dikey Kadraj', cmd: 'Yüz takibiyle 9:16 dikey yap' },
          { label: '🎨 Sinematik Renk', cmd: 'Sinematik renk iyileştirme uygula' },
          { label: '🧹 Dip Gürültü Temizle', cmd: 'Dip gürültüyü temizle' },
          { label: '🔥 Viral Kanca', cmd: 'Viral kanca üret' },
          { label: '📤 4K Dışa Aktar', cmd: 'Dışa aktar' },
          { label: '🔇 Sessize Al', cmd: 'Sessize al' },
          { label: '🤖 AI Kontrol Merkezi', cmd: 'AI kontrol merkezini aç' }
        ] as chip}
          <button
            type="button"
            onclick={() => {
              prompt = chip.cmd;
              handleSubmit();
            }}
            disabled={aiService.isRunning || editor.isProcessing}
            class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-neutral-900/90 hover:bg-neutral-800 border border-white/10 hover:border-purple-500/40 text-neutral-300 hover:text-white transition-all whitespace-nowrap cursor-pointer active:scale-95 disabled:opacity-40"
          >
            {chip.label}
          </button>
        {/each}
      </div>

      <!-- Quick Shortcuts Guide -->
      <div class="mt-1 px-3 flex items-center justify-between text-[11px] text-neutral-400">
        <div class="flex items-center gap-3">
          <span class="flex items-center gap-1"><kbd class="px-1.5 py-0.5 bg-neutral-800 border border-white/10 rounded font-mono text-[10px]">Enter</kbd> Çalıştır</span>
          <span class="flex items-center gap-1"><kbd class="px-1.5 py-0.5 bg-neutral-800 border border-white/10 rounded font-mono text-[10px]">Esc</kbd> Kapat</span>
        </div>
        <span class="text-neutral-500">AI Video Komut Asistanı</span>
      </div>
    </div>
  </div>
{/if}
