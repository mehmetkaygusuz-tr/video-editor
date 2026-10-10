<script lang="ts">
  import { aiService } from '../engine/aiService.svelte';
  import { editor } from '../editor.svelte';
  import { Dialog, Accordion } from 'bits-ui';
  import {
    Sparkles,
    TypeOutline,
    Scissors,
    Volume2,
    Music,
    Layers,
    Crop,
    ShieldCheck,
    Cpu,
    X,
    Play,
    CircleCheck as CheckCircle2,
    CircleAlert as AlertCircle,
    LoaderCircle as Loader2,
    ChevronDown,
    ChevronUp,
    Trash as Trash2
  } from '@lucide/svelte';

  let ttsInput = $state('Merhaba, yerel yapay zeka ile hazırlanan videoma hoş geldiniz.');
  let selectedVoice = $state('af_bella');
  let accordionValue = $state<string[]>([]);

  function toggleLicense() {
    if (accordionValue.includes('license')) {
      accordionValue = accordionValue.filter(v => v !== 'license');
    } else {
      accordionValue = [...accordionValue, 'license'];
    }
  }

  const voices = [
    { id: 'af_bella', name: 'Bella (Kadın - Doğal Stüdyo)' },
    { id: 'af_sarah', name: 'Sarah (Kadın - Sıcak Anlatım)' },
    { id: 'af_nicole', name: 'Nicole (Kadın - Akıcı & Net)' },
    { id: 'am_michael', name: 'Michael (Erkek - Enerjik Anlatıcı)' },
    { id: 'am_adam', name: 'Adam (Erkek - Derin Belgesel Tonu)' },
    { id: 'bf_emma', name: 'Emma (Kadın - İngiliz Aksanı)' },
    { id: 'bm_george', name: 'George (Erkek - İngiliz Stüdyo)' }
  ];

  async function handleCaptions() {
    await aiService.generateCaptionsForClip();
  }

  async function handleSilenceCut() {
    await aiService.autoJumpCutSilence();
  }

  async function handleTts() {
    if (!ttsInput.trim()) return;
    await aiService.generateSpeech(ttsInput, selectedVoice);
  }

  async function handleBeatSync() {
    await aiService.syncClipsToBeats();
  }

  async function handleBgRemoval() {
    await aiService.removeBackground();
  }

  async function handleReframe() {
    await aiService.autoReframe();
  }
</script>

<Dialog.Root bind:open={aiService.isPanelOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/75 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <Dialog.Content class="fixed left-1/2 bottom-0 sm:bottom-auto sm:top-1/2 z-50 w-full max-w-4xl h-[88vh] sm:h-auto sm:max-h-[90vh] -translate-x-1/2 sm:-translate-y-1/2 bg-neutral-950 border-t sm:border border-neutral-800 rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden text-neutral-100 pb-[env(safe-area-inset-bottom,0px)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
      <!-- Mobile drag indicator -->
      <div class="w-12 h-1.5 bg-neutral-700 rounded-full mx-auto mt-2 sm:hidden flex-none"></div>
      
      <!-- Top Header -->
      <div class="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-neutral-800/80 bg-neutral-900/50 flex-none">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <Sparkles size={18} />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <Dialog.Title class="text-base font-bold text-white tracking-wide">AI Üretim Merkezi</Dialog.Title>
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <Cpu size={12} /> WebGPU / On-Device
              </span>
            </div>
            <Dialog.Description class="text-xs text-neutral-400">Tüm modeller %100 yerel çalışır, sunucu maliyeti sıfırdır ve veriler cihazınızda kalır.</Dialog.Description>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            onclick={toggleLicense}
            class="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/60 transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Resmi Lisans Güvencesi"
          >
            <ShieldCheck size={14} class="text-emerald-400" />
            Lisanslar (MIT / Apache)
          </button>

          <Dialog.Close
            class="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X size={20} />
          </Dialog.Close>
        </div>
      </div>

      <!-- Active Running Progress Bar Banner -->
      {#if aiService.isRunning}
        <div class="px-6 py-3 bg-blue-950/40 border-b border-blue-800/50 flex items-center justify-between gap-4 flex-none">
          <div class="flex items-center gap-3 min-w-0">
            <Loader2 size={18} class="animate-spin text-blue-400 flex-none" />
            <span class="text-xs font-medium text-blue-200 truncate">{aiService.statusMessage}</span>
          </div>
          <div class="flex items-center gap-3 flex-none">
            <div class="w-28 sm:w-36 h-2 bg-blue-950 rounded-full overflow-hidden border border-blue-800/40">
              <div
                class="h-full bg-blue-500 transition-all duration-300 rounded-full"
                style="width: {aiService.progress}%"
              ></div>
            </div>
            <span class="text-xs font-mono font-bold text-blue-300">{aiService.progress}%</span>
            <button
              onclick={() => aiService.cancelCurrentTask()}
              class="px-2 py-0.5 rounded text-[11px] font-semibold text-rose-300 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-800/60 transition-colors cursor-pointer"
              title="İşlemi durdurur ve sistemi sıfırlar"
            >
              İptal Et
            </button>
          </div>
        </div>
      {/if}

      <!-- Main Feature Grid -->
      <div class="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
        
        <!-- Grid of 6 Core Tools -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          <!-- 1. Auto-Captions (Whisper) -->
          <div class="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition-all flex flex-col justify-between">
            <div>
              <div class="flex items-start justify-between mb-2">
                <div class="flex items-center gap-2.5">
                  <div class="p-2 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/30">
                    <TypeOutline size={18} />
                  </div>
                  <div>
                    <h3 class="text-sm font-bold text-white">Otomatik Altyazı & Kelime Senkronu</h3>
                    <span class="text-[10px] text-purple-400 font-mono">WebGPU Whisper-Tiny (ONNX)</span>
                  </div>
                </div>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-800 text-purple-300 border border-purple-500/20">
                  MIT
                </span>
              </div>
              <p class="text-xs text-neutral-400 mb-4">
                Konuşmayı doğrudan cihazınızda analiz ederek milisaniyelik zaman damgaları çıkarır. Timeline'da animasyonlu karaoke/reels altyazı katmanı oluşturur.
              </p>
            </div>
            <button
              onclick={handleCaptions}
              disabled={aiService.isRunning}
              class="w-full py-2 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-purple-950/50 cursor-pointer"
            >
              <TypeOutline size={14} /> Altyazı Üret ve Ekle
            </button>
          </div>

          <!-- 2. Silence Cut (Silero VAD) -->
          <div class="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition-all flex flex-col justify-between">
            <div>
              <div class="flex items-start justify-between mb-2">
                <div class="flex items-center gap-2.5">
                  <div class="p-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <Scissors size={18} />
                  </div>
                  <div>
                    <h3 class="text-sm font-bold text-white">Sessizlik & Boşluk Kesici (Jump-Cut)</h3>
                    <span class="text-[10px] text-emerald-400 font-mono">ONNX Silero VAD v5</span>
                  </div>
                </div>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-800 text-emerald-300 border border-emerald-500/20">
                  MIT
                </span>
              </div>
              <p class="text-xs text-neutral-400 mb-4">
                Konuşmadaki "ııı", duraksama ve sessiz nefes boşluklarını yapay zeka ile tespit eder, klibi otomatik bölerek akıcı hale getirir.
              </p>
            </div>
            <button
              onclick={handleSilenceCut}
              disabled={aiService.isRunning}
              class="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-950/50 cursor-pointer"
            >
              <Scissors size={14} /> Boşlukları Otomatik Kes
            </button>
          </div>

          <!-- 3. AI Voiceover (Kokoro TTS) -->
          <div class="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition-all flex flex-col justify-between md:col-span-2">
            <div>
              <div class="flex items-start justify-between mb-2">
                <div class="flex items-center gap-2.5">
                  <div class="p-2 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/30">
                    <Volume2 size={18} />
                  </div>
                  <div>
                    <h3 class="text-sm font-bold text-white">Yapay Zeka Seslendirme (Kokoro-82M TTS)</h3>
                    <span class="text-[10px] text-blue-400 font-mono">Kokoro-82M ONNX WebGPU / WASM</span>
                  </div>
                </div>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-800 text-blue-300 border border-blue-500/20">
                  Apache 2.0
                </span>
              </div>
              
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 my-3">
                <div class="md:col-span-2">
                  <label for="tts-text-input" class="block text-[11px] font-medium text-neutral-400 mb-1">Seslendirilecek Metin:</label>
                  <input
                    id="tts-text-input"
                    type="text"
                    bind:value={ttsInput}
                    placeholder="Videonuz için seslendirme metnini yazın..."
                    class="w-full px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-800 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label for="tts-voice-select" class="block text-[11px] font-medium text-neutral-400 mb-1">Ses Karakteri:</label>
                  <select
                    id="tts-voice-select"
                    bind:value={selectedVoice}
                    class="w-full px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-800 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    {#each voices as v}
                      <option value={v.id}>{v.name}</option>
                    {/each}
                  </select>
                </div>
              </div>
            </div>
            
            <button
              onclick={handleTts}
              disabled={aiService.isRunning || !ttsInput.trim()}
              class="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-blue-950/50 cursor-pointer"
            >
              <Volume2 size={14} /> Sese Dönüştür ve Timeline'a Ekle
            </button>
          </div>

          <!-- 4. Beat Sync (Rhythm Detection) -->
          <div class="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition-all flex flex-col justify-between">
            <div>
              <div class="flex items-start justify-between mb-2">
                <div class="flex items-center gap-2.5">
                  <div class="p-2 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    <Music size={18} />
                  </div>
                  <div>
                    <h3 class="text-sm font-bold text-white">Müzik Ritim & Vuruş Senkronu</h3>
                    <span class="text-[10px] text-amber-400 font-mono">Web Audio Realtime-BPM Engine</span>
                  </div>
                </div>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-800 text-amber-300 border border-amber-500/20">
                  MIT
                </span>
              </div>
              <p class="text-xs text-neutral-400 mb-4">
                Müziğin BPM ve bas vuruşlarını gerçek zamanlı analiz eder. Klipleri ritme otomatik hizalar ve sinematik montaj sağlar.
              </p>
            </div>
            <button
              onclick={handleBeatSync}
              disabled={aiService.isRunning}
              class="w-full py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-amber-950/50 cursor-pointer"
            >
              <Music size={14} /> Ritme Göre Klipleri Hizala
            </button>
          </div>

          <!-- 5. Background Removal (RMBG-1.4) -->
          <div class="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition-all flex flex-col justify-between">
            <div>
              <div class="flex items-start justify-between mb-2">
                <div class="flex items-center gap-2.5">
                  <div class="p-2 rounded-lg bg-pink-500/15 text-pink-400 border border-pink-500/30">
                    <Layers size={18} />
                  </div>
                  <div>
                    <h3 class="text-sm font-bold text-white">Yeşil Perdesiz Arka Plan Silme</h3>
                    <span class="text-[10px] text-pink-400 font-mono">WebGPU RMBG-1.4 Segmentasyon</span>
                  </div>
                </div>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-800 text-pink-300 border border-pink-500/20">
                  Apache 2.0
                </span>
              </div>
              <p class="text-xs text-neutral-400 mb-4">
                Kişiyi ve nesneleri arka plandan piksel hassasiyetiyle ayırır; arkasına yazı, renk gradyanı veya ikincil video yerleştirmenizi sağlar.
              </p>
            </div>
            <button
              onclick={handleBgRemoval}
              disabled={aiService.isRunning}
              class="w-full py-2 px-3 rounded-lg bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-pink-950/50 cursor-pointer"
            >
              <Layers size={14} /> Arka Planı Kaldır
            </button>
          </div>

          <!-- 6. Smart 9:16 Reframe (BlazeFace) -->
          <div class="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition-all flex flex-col justify-between md:col-span-2">
            <div>
              <div class="flex items-start justify-between mb-2">
                <div class="flex items-center gap-2.5">
                  <div class="p-2 rounded-lg bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                    <Crop size={18} />
                  </div>
                  <div>
                    <h3 class="text-sm font-bold text-white">Akıllı Yüz Takibi & 9:16 Otomatik Kadraj (Auto-Reframe)</h3>
                    <span class="text-[10px] text-cyan-400 font-mono">MediaPipe BlazeFace AI Yüz Takibi</span>
                  </div>
                </div>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-800 text-cyan-300 border border-cyan-500/20">
                  Apache 2.0
                </span>
              </div>
              <p class="text-xs text-neutral-400 mb-4">
                Yatay çekilmiş 16:9 videodaki konuşmacının yüzünü tespit eder. Titreşimsiz kinematik takip ile konuşmacıyı dikey (9:16) formatının merkezinde tutar.
              </p>
            </div>
            <button
              onclick={handleReframe}
              disabled={aiService.isRunning}
              class="w-full py-2 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-cyan-950/50 cursor-pointer"
            >
              <Crop size={14} /> 9:16 Dikey Akıllı Kadrajı Uygula
            </button>
          </div>

        </div>

        <!-- Accordion Section: License & Logs -->
        <Accordion.Root type="multiple" bind:value={accordionValue} class="border-t border-neutral-800/80 pt-4 space-y-2.5">
          <!-- Logs Item -->
          <Accordion.Item value="logs" class="border border-neutral-800/80 rounded-xl overflow-hidden bg-neutral-950/40">
            <Accordion.Header level={3}>
              <Accordion.Trigger class="flex items-center justify-between w-full px-4 py-2.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer">
                <span>Yapay Zeka Motor Günlükleri ({aiService.logs.length})</span>
                <ChevronDown size={15} class="transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content hiddenUntilFound={true} class="px-4 pb-3 pt-1">
              <div class="p-3 bg-neutral-950 rounded-lg border border-neutral-800 font-mono text-[11px] max-h-36 overflow-y-auto space-y-1">
                {#if aiService.logs.length === 0}
                  <div class="text-neutral-600">Henüz bir günlük kaydı yok.</div>
                {:else}
                  {#each aiService.logs as log}
                    <div class="flex items-center gap-2 {log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-amber-400' : 'text-neutral-400'}">
                      <span class="text-neutral-600">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                      <span>{log.message}</span>
                    </div>
                  {/each}
                {/if}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>

      </div>

      <!-- Bottom Footer -->
      <div class="px-6 py-3 border-t border-neutral-800/80 bg-neutral-900/30 flex items-center justify-between text-xs text-neutral-500 flex-none">
        <div class="flex items-center gap-2.5">
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span class="text-neutral-300 font-medium">WebGPU Donanım Hızlandırma Aktif</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Dialog.Close
            class="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-xs transition-colors cursor-pointer"
          >
            Kapat
          </Dialog.Close>
        </div>
      </div>

    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #262626;
    border-radius: 3px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #404040;
  }
</style>
