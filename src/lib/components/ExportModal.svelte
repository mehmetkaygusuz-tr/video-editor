<script lang="ts">
  import { Exporter, type ExportOptions, type ExportResult } from '../engine/Exporter';
  import { Dialog } from 'bits-ui';
  import { X, Download, Film, CircleCheck as CheckCircle2, CircleAlert as AlertCircle, Sparkles, LoaderCircle as Loader2 } from '@lucide/svelte';

  let { isOpen = $bindable(false) } = $props<{ isOpen: boolean }>();

  let preset = $state<'tiktok_9_16' | 'youtube_16_9' | 'square_1_1'>('tiktok_9_16');
  let fps = $state<number>(30);
  let format = $state<'mp4' | 'webm'>('mp4');
  let quality = $state<'high' | 'medium'>('high');
  let isExporting = $state(false);
  let progress = $state(0);
  let statusMessage = $state('Dışa aktarmaya hazır');
  let exportResult = $state<ExportResult | null>(null);
  let errorMessage = $state<string | null>(null);
  let abortController = $state<AbortController | null>(null);

  async function handleStartExport() {
    isExporting = true;
    progress = 0;
    errorMessage = null;
    exportResult = null;
    statusMessage = 'Dışa aktarma başlatılıyor...';
    abortController = new AbortController();

    try {
      const result = await Exporter.exportProject({
        preset,
        fps,
        format,
        quality,
        abortSignal: abortController.signal,
        onProgress: (pct, msg) => {
          progress = pct;
          statusMessage = msg;
        }
      });

      exportResult = result;
      isExporting = false;
      abortController = null;

      // Auto trigger download
      triggerDownload(result.url, result.filename);
    } catch (err: any) {
      if (err?.message?.includes('iptal')) {
        statusMessage = 'Dışa aktarma iptal edildi.';
      } else {
        console.error('[ExportModal] Export failed:', err);
        errorMessage = err?.message || 'Dışa aktarma sırasında bir hata oluştu.';
      }
      isExporting = false;
      abortController = null;
    }
  }

  function handleCancelExport() {
    if (abortController) {
      abortController.abort();
      statusMessage = 'İptal ediliyor...';
    }
  }

  function triggerDownload(url: string, filename: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function closeModal() {
    if (!isExporting) {
      isOpen = false;
      errorMessage = null;
    }
  }
</script>

<Dialog.Root bind:open={isOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <Dialog.Content 
      onEscapeKeydown={(e) => { if (isExporting) e.preventDefault(); }}
      onInteractOutside={(e) => { if (isExporting) e.preventDefault(); }}
      class="fixed left-1/2 bottom-0 sm:bottom-auto sm:top-1/2 z-50 w-full max-w-md -translate-x-1/2 sm:-translate-y-1/2 bg-neutral-900 border-t sm:border border-neutral-800 rounded-t-3xl sm:rounded-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom,0px)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
    >
      <!-- Mobile drag indicator bar -->
      <div class="w-12 h-1.5 bg-neutral-700 rounded-full mx-auto mt-2.5 sm:hidden flex-none"></div>

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3.5 sm:py-4 border-b border-neutral-800">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
            <Film size={18} />
          </div>
          <div>
            <Dialog.Title class="text-sm font-bold text-white">Videoyu Dışa Aktar</Dialog.Title>
            <Dialog.Description class="text-[11px] text-neutral-400">Tarayıcıda donanım hızlandırmalı yerel render</Dialog.Description>
          </div>
        </div>
        <Dialog.Close
          disabled={isExporting}
          class="text-neutral-400 hover:text-white transition-colors disabled:opacity-40 p-1 rounded-lg hover:bg-neutral-800 focus:outline-none"
        >
          <X size={18} />
        </Dialog.Close>
      </div>

      <!-- Body -->
      <div class="p-5 space-y-4">
        {#if !isExporting && !exportResult}
          <!-- Preset Selector -->
          <div class="space-y-1.5">
            <div class="text-xs font-semibold text-neutral-300">Format & Çözünürlük</div>
            <div class="grid grid-cols-3 gap-2">
              <button
                onclick={() => preset = 'tiktok_9_16'}
                class="p-2.5 rounded-xl border text-center transition-all {preset === 'tiktok_9_16' ? 'bg-blue-600/20 border-blue-500 text-white font-medium' : 'bg-neutral-800/60 border-neutral-700 text-neutral-400 hover:bg-neutral-800'}"
              >
                <div class="text-xs font-bold">9:16 Dikey</div>
                <div class="text-[10px] text-neutral-400">TikTok / Reels</div>
                <div class="text-[9px] text-neutral-500">1080x1920</div>
              </button>

              <button
                onclick={() => preset = 'youtube_16_9'}
                class="p-2.5 rounded-xl border text-center transition-all {preset === 'youtube_16_9' ? 'bg-blue-600/20 border-blue-500 text-white font-medium' : 'bg-neutral-800/60 border-neutral-700 text-neutral-400 hover:bg-neutral-800'}"
              >
                <div class="text-xs font-bold">16:9 Yatay</div>
                <div class="text-[10px] text-neutral-400">YouTube / TV</div>
                <div class="text-[9px] text-neutral-500">1920x1080</div>
              </button>

              <button
                onclick={() => preset = 'square_1_1'}
                class="p-2.5 rounded-xl border text-center transition-all {preset === 'square_1_1' ? 'bg-blue-600/20 border-blue-500 text-white font-medium' : 'bg-neutral-800/60 border-neutral-700 text-neutral-400 hover:bg-neutral-800'}"
              >
                <div class="text-xs font-bold">1:1 Kare</div>
                <div class="text-[10px] text-neutral-400">Instagram</div>
                <div class="text-[9px] text-neutral-500">1080x1080</div>
              </button>
            </div>
          </div>

          <!-- FPS and Codec -->
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <div class="text-xs font-semibold text-neutral-300">Kare Hızı (FPS)</div>
              <div class="flex rounded-xl bg-neutral-800 p-1 border border-neutral-700">
                <button
                  onclick={() => fps = 30}
                  class="flex-1 py-1 text-xs rounded-lg font-medium transition-all {fps === 30 ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}"
                >
                  30 FPS
                </button>
                <button
                  onclick={() => fps = 60}
                  class="flex-1 py-1 text-xs rounded-lg font-medium transition-all {fps === 60 ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}"
                >
                  60 FPS
                </button>
              </div>
            </div>

            <div class="space-y-1.5">
              <div class="text-xs font-semibold text-neutral-300">Konteyner</div>
              <div class="flex rounded-xl bg-neutral-800 p-1 border border-neutral-700">
                <button
                  onclick={() => format = 'mp4'}
                  class="flex-1 py-1 text-xs rounded-lg font-medium transition-all {format === 'mp4' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}"
                >
                  MP4 (H.264)
                </button>
                <button
                  onclick={() => format = 'webm'}
                  class="flex-1 py-1 text-xs rounded-lg font-medium transition-all {format === 'webm' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}"
                >
                  WebM (VP9)
                </button>
              </div>
            </div>
          </div>

          <!-- Quality Selector -->
          <div class="space-y-1.5">
            <div class="text-xs font-semibold text-neutral-300">Kodlama Kalitesi (Bitrate)</div>
            <div class="flex rounded-xl bg-neutral-800 p-1 border border-neutral-700">
              <button
                onclick={() => quality = 'high'}
                class="flex-1 py-1 text-xs rounded-lg font-medium transition-all {quality === 'high' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}"
              >
                Yüksek Kalite (Yüksek Bitrate)
              </button>
              <button
                onclick={() => quality = 'medium'}
                class="flex-1 py-1 text-xs rounded-lg font-medium transition-all {quality === 'medium' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}"
              >
                Dengeli (Hızlı / Düşük Boyut)
              </button>
            </div>
          </div>

          <!-- Feature Note -->
          <div class="p-3 bg-neutral-800/40 rounded-xl border border-neutral-700/50 flex items-start gap-2.5 text-[11px] text-neutral-300">
            <Sparkles size={16} class="text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <span class="font-semibold text-white">Akıllı Render:</span> Zaman çizelgesindeki video kesitleri, 9:16 dinamik kadrajlar, ritim senkronu ve otomatik oluşturulan altyazılar doğrudan kareye gömülecektir.
            </div>
          </div>
        {:else if isExporting}
          <!-- Progress view -->
          <div class="py-6 flex flex-col items-center justify-center text-center space-y-4">
            <div class="relative w-16 h-16 flex items-center justify-center">
              <Loader2 size={40} class="text-blue-500 animate-spin" />
              <span class="absolute text-xs font-bold text-white">{progress}%</span>
            </div>
            <div>
              <h3 class="text-sm font-bold text-white">Video İşleniyor</h3>
              <p class="text-xs text-neutral-400 mt-1">{statusMessage}</p>
            </div>
            <div class="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
              <div
                class="bg-gradient-to-r from-blue-500 to-indigo-500 h-full transition-all duration-200"
                style="width: {progress}%;"
              ></div>
            </div>
          </div>
        {:else if exportResult}
          <!-- Success view -->
          <div class="py-4 flex flex-col items-center justify-center text-center space-y-3">
            <div class="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <h3 class="text-sm font-bold text-white">Dışa Aktarma Başarılı!</h3>
              <p class="text-xs text-neutral-400 mt-1">{exportResult.filename} başarıyla üretildi.</p>
              <p class="text-[11px] text-neutral-500">Boyut: {(exportResult.blob.size / 1024 / 1024).toFixed(2)} MB • Süre: {exportResult.durationSec}s</p>
            </div>
            <button
              onclick={() => triggerDownload(exportResult!.url, exportResult!.filename)}
              class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30"
            >
              <Download size={16} /> Tekrar İndir
            </button>
          </div>
        {/if}

        {#if errorMessage}
          <div class="p-3 bg-red-950/40 border border-red-500/30 rounded-xl flex items-start gap-2 text-xs text-red-300">
            <AlertCircle size={16} class="text-red-400 shrink-0 mt-0.5" />
            <div>{errorMessage}</div>
          </div>
        {/if}
      </div>

      <!-- Footer Actions -->
      <div class="px-5 py-3.5 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-end gap-2">
        {#if isExporting}
          <button
            onclick={handleCancelExport}
            class="px-4 py-1.5 rounded-xl text-xs font-medium bg-red-950/40 border border-red-500/40 text-red-300 hover:bg-red-900/50 transition-colors"
          >
            Dışa Aktarmayı İptal Et
          </button>
        {:else if !exportResult}
          <button
            onclick={closeModal}
            class="px-3.5 py-1.5 rounded-xl text-xs font-medium text-neutral-400 hover:text-white transition-colors"
          >
            Vazgeç
          </button>
          <button
            onclick={handleStartExport}
            class="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-neutral-200 transition-all shadow-md flex items-center gap-1.5"
          >
            <Download size={14} /> Render & İndir
          </button>
        {:else if exportResult}
          <button
            onclick={() => { exportResult = null; closeModal(); }}
            class="px-4 py-1.5 rounded-xl text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-white transition-colors"
          >
            Kapat
          </button>
        {/if}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
