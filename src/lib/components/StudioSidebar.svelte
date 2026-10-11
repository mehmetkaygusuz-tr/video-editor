<script lang="ts">
  import { editor } from '../editor.svelte';
  import { engine } from '../engine/orchestrator.svelte';
  import { aiService } from '../engine/aiService.svelte';
  import { agenticEditor } from '../engine/AgenticEditor';
  import { saveFileToOPFS } from '../opfs';
  import { MAGIC_TEMPLATES } from '../templates';
  import { FILTER_PRESETS } from '../filters';
  import { Tabs, Slider } from 'bits-ui';
  import { 
    FolderClosed, Sparkles, SlidersHorizontal as Sliders, Type, Upload, Plus, Trash as Trash2, 
    Scissors, Volume2, Music, Crop, Layers, Cpu, Check, 
    RotateCcw, Play, ShieldCheck, FastForward, Film, Image as ImageIcon, X, Gauge, Wand2, Palette, ChevronRight
  } from '@lucide/svelte';

  let { onClose, isMobileSheet = false, hideTabs = false }: { onClose?: () => void; isMobileSheet?: boolean; hideTabs?: boolean } = $props();

  let fileInput = $state<HTMLInputElement>();
  let ttsText = $state('Merhaba! ToolX Studio yerel yapay zeka ile profesyonel video kurgusu.');
  let selectedVoice = $state('af_bella');
  let silenceSensitivity = $state(0.5);
  let newSubtitleText = $state('');

  let selectedTemplateId = $state<string>('viral-tiktok-hook');
  let selectedTemplateAudioId = $state<string>('');
  let selectedTemplateVideoIds = $state<string[]>([]);
  let selectedTemplateCategory = $state<'all' | 'viral' | 'cinematic' | 'rhythm' | 'creative' | 'social'>('all');
  let selectedFilterCategory = $state<'all' | 'cinematic' | 'creative' | 'vintage' | 'clean'>('all');

  const voices = [
    { id: 'af_bella', name: 'Bella (Kadın - Stüdyo Tonu)' },
    { id: 'af_sarah', name: 'Sarah (Kadın - Doğal Anlatım)' },
    { id: 'am_michael', name: 'Michael (Erkek - Enerjik & Net)' },
    { id: 'am_adam', name: 'Adam (Erkek - Derin Belgesel Tonu)' }
  ];

  let selectedClip = $derived(editor.selectedClip);
  let allSubtitles = $derived(
    editor.tracks.flatMap(t => t.clips.flatMap(c => (c.subtitles || []).map(s => ({ clipId: c.id, clipName: c.name, sub: s }))))
  );

  async function handleFileUpload(event: Event) {
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
  }

  function handleDragStart(e: DragEvent, assetId: string) {
    if (e.dataTransfer) {
      e.dataTransfer.setData('application/x-editor-asset', assetId);
      e.dataTransfer.effectAllowed = 'copy';
    }
  }

  function addAssetToTimeline(assetId: string) {
    const asset = editor.assets.find(a => a.id === assetId);
    if (!asset) return;

    const duration = asset.duration || (asset.type === 'image' ? 5 : 10);

    if (asset.type === 'video') {
      let vTrack = editor.tracks.find(t => t.type === 'video' || t.name === 'V1' || t.name.startsWith('V'));
      if (!vTrack) {
        vTrack = editor.addTrack('V1', 'video');
      }
      const lastClipEnd = vTrack.clips.reduce((max, clip) => Math.max(max, clip.startAt + clip.duration), 0);
      const startAt = Math.max(editor.playhead, lastClipEnd);

      editor.addClip(
        vTrack.id,
        asset.name,
        startAt,
        duration,
        asset.color || '#2563eb',
        asset.id,
        { type: 'video' }
      );

      let aTrack = editor.tracks.find(t => t.type === 'audio' || t.name === 'A1' || t.name.startsWith('A'));
      if (!aTrack) {
        aTrack = editor.addTrack('A1', 'audio');
      }

      editor.addClip(
        aTrack.id,
        `${asset.name} (Ses)`,
        startAt,
        duration,
        '#10b981',
        asset.id,
        { type: 'audio' }
      );

      editor.announce(`"${asset.name}" video ve ses kanallarına eklendi.`);
    } else {
      let targetTrack = editor.tracks.find(t => asset.type === 'audio' ? (t.type === 'audio' || t.name.startsWith('A')) : (t.type === 'video' || t.name.startsWith('V')));
      if (!targetTrack) {
        const trackName = asset.type === 'audio' ? 'A1' : 'V1';
        targetTrack = editor.addTrack(trackName, asset.type === 'audio' ? 'audio' : 'video');
      }

      const lastClipEnd = targetTrack.clips.reduce((max, clip) => Math.max(max, clip.startAt + clip.duration), 0);
      const startAt = Math.max(editor.playhead, lastClipEnd);

      editor.addClip(
        targetTrack.id,
        asset.name,
        startAt,
        duration,
        asset.color,
        asset.id,
        { type: asset.type }
      );
      editor.announce(`"${asset.name}" zaman çizelgesine eklendi.`);
    }
  }

  function handleDeleteAsset(asset: any) {
    engine.removeAsset(asset.name);
    editor.deleteAsset(asset.id);
  }

  async function runWhisperCaptions() {
    await aiService.generateCaptionsForClip();
    editor.activeSidebarTab = 'captions';
  }

  async function runSilenceCut() {
    await aiService.autoJumpCutSilence();
  }

  async function runTtsGeneration() {
    if (!ttsText.trim()) return;
    await aiService.generateSpeech(ttsText, selectedVoice);
  }

  async function runBeatSync() {
    await aiService.syncClipsToBeats();
  }

  async function runBgRemoval() {
    await aiService.removeBackground();
  }

  async function runSmartReframe() {
    await aiService.autoReframe();
  }
</script>

<aside 
  class="@container w-full h-full bg-transparent flex flex-col select-none overflow-hidden" 
  role="region" 
  aria-label="Stüdyo Kontrol Paneli"
>
  {#if isMobileSheet}
    <!-- Mobile Sheet Drag Handle & Close -->
    <div class="flex-none pt-2 pb-1 px-4 flex items-center justify-between border-b border-neutral-900 bg-neutral-950">
      <div class="flex items-center gap-2">
        <div class="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></div>
        <span class="text-xs font-bold text-white uppercase tracking-wider">
          {#if editor.activeSidebarTab === 'media'}Medya Kütüphanesi
          {:else if editor.activeSidebarTab === 'ai'}AI Paneli
          {:else if editor.activeSidebarTab === 'templates'}Kurgu Şablonları
          {:else if editor.activeSidebarTab === 'filters'}Renk Filtreleri
          {:else}Altyazı Yöneticisi{/if}
        </span>
      </div>
      <button
        onclick={() => onClose?.()}
        class="w-10 h-10 rounded-full bg-neutral-950 hover:bg-neutral-800 active:bg-neutral-700 flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
        aria-label="Pencereyi Kapat"
      >
        <X size={18} />
      </button>
    </div>
  {/if}

  <!-- Tabs Root Container -->
  <Tabs.Root bind:value={editor.activeSidebarTab} loop={true} class="flex-1 flex flex-col min-h-0 overflow-hidden">
    <!-- Tab Header Bar -->
    {#if !hideTabs}
    <Tabs.List class="h-12 flex-none border-b border-white/5 bg-transparent px-2 flex items-center justify-between overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <div class="flex items-center gap-1 min-w-max">
        <!-- Media Tab Button -->
        <Tabs.Trigger
          value="media"
          onclick={() => editor.triggerHaptic('light')}
          class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none data-[state=active]:bg-neutral-800 data-[state=active]:text-white data-[state=active]:shadow-sm text-neutral-400 hover:text-white hover:bg-neutral-950 cursor-pointer"
          title="Medya Dosyaları"
        >
          <FolderClosed size={15} class={editor.activeSidebarTab === 'media' ? 'text-blue-400' : ''} />
          <span>Medya</span>
        </Tabs.Trigger>

        <!-- AI Tools Tab Button -->
        <Tabs.Trigger
          value="ai"
          onclick={() => editor.triggerHaptic('light')}
          class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none data-[state=active]:bg-blue-950/60 data-[state=active]:text-blue-300 data-[state=active]:border data-[state=active]:border-blue-500/40 data-[state=active]:shadow-sm text-neutral-400 hover:text-white hover:bg-neutral-950 cursor-pointer"
          title="Yapay Zeka Paneli"
        >
          <Sparkles size={15} class="text-blue-400" />
          <span>AI Paneli</span>
        </Tabs.Trigger>

        <!-- Captions Tab Button -->
        <Tabs.Trigger
          value="captions"
          onclick={() => editor.triggerHaptic('light')}
          class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none data-[state=active]:bg-neutral-800 data-[state=active]:text-white data-[state=active]:shadow-sm text-neutral-400 hover:text-white hover:bg-neutral-950 cursor-pointer"
          title="Altyazı Yöneticisi"
        >
          <Type size={15} class={editor.activeSidebarTab === 'captions' ? 'text-yellow-400' : ''} />
          <span>Altyazı</span>
        </Tabs.Trigger>

        <!-- Templates Tab Button -->
        <Tabs.Trigger
          value="templates"
          onclick={() => editor.triggerHaptic('light')}
          class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none data-[state=active]:bg-pink-950/60 data-[state=active]:text-pink-300 data-[state=active]:border data-[state=active]:border-pink-500/40 data-[state=active]:shadow-sm text-neutral-400 hover:text-white hover:bg-neutral-950 cursor-pointer"
          title="Sihirli Şablonlar"
        >
          <Wand2 size={15} class={editor.activeSidebarTab === 'templates' ? 'text-pink-400' : ''} />
          <span>Şablonlar</span>
        </Tabs.Trigger>

        <!-- Filters Tab Button -->
        <Tabs.Trigger
          value="filters"
          onclick={() => editor.triggerHaptic('light')}
          class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none data-[state=active]:bg-cyan-950/60 data-[state=active]:text-cyan-300 data-[state=active]:border data-[state=active]:border-cyan-500/40 data-[state=active]:shadow-sm text-neutral-400 hover:text-white hover:bg-neutral-950 cursor-pointer"
          title="Sinematik Renk Filtreleri"
        >
          <Palette size={15} class={editor.activeSidebarTab === 'filters' ? 'text-cyan-400' : ''} />
          <span>Filtreler</span>
        </Tabs.Trigger>
      </div>
    </Tabs.List>
    {/if}

    <!-- 1. TAB CONTENT: MEDIA POOL -->
    <Tabs.Content value="media" class="flex-1 overflow-y-auto p-3.5 custom-scrollbar outline-none">
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-white">Medya Kütüphanesi</h3>
            <p class="text-[11px] text-neutral-400">Projeye video, ses veya resim ekleyin.</p>
          </div>
          <button 
            onclick={() => fileInput?.click()}
            class="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            aria-label="Yeni Medya Yükle"
          >
            <Upload size={13} />
            <span>Yükle</span>
          </button>
        </div>

        <input 
          type="file" 
          accept="video/*,audio/*,image/*" 
          multiple
          bind:this={fileInput} 
          onchange={handleFileUpload}
          class="hidden"
          aria-label="Dosya Seçici"
        />

        {#if editor.assets.length === 0}
          <div class="p-6 border border-dashed border-neutral-800 rounded-xl text-center flex flex-col items-center justify-center gap-2 text-neutral-500 bg-neutral-950/30">
            <Upload size={24} class="opacity-40" />
            <span class="text-xs">Henüz dosya eklenmedi</span>
            <button 
              onclick={() => fileInput?.click()}
              class="text-xs text-blue-400 hover:text-blue-300 font-medium underline"
            >
              Cihazdan dosya seçin
            </button>
          </div>
        {:else}
          <div class="grid grid-cols-1 gap-2" role="list">
            {#each editor.assets as asset (asset.id)}
              <div 
                role="listitem"
                class="p-2.5 bg-neutral-950/70 border border-neutral-800/80 hover:border-neutral-700 rounded-xl flex items-center justify-between gap-3 group transition-all"
                draggable="true"
                ondragstart={(e) => handleDragStart(e, asset.id)}
              >
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style="background-color: {asset.color}20; color: {asset.color};">
                    {#if asset.type === 'video'}<Film size={15} />
                    {:else if asset.type === 'audio'}<Music size={15} />
                    {:else}<ImageIcon size={15} />{/if}
                  </div>
                  <div class="min-w-0">
                    <p class="text-xs font-medium text-white truncate">{asset.name}</p>
                    <span class="text-[10px] text-neutral-500 uppercase">{asset.type} {asset.duration ? `• ${asset.duration.toFixed(1)}s` : ''}</span>
                  </div>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <button 
                    onclick={() => addAssetToTimeline(asset.id)}
                    class="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white text-[11px] font-medium rounded-md transition-colors flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                    title="Zaman Çizelgesine Ekle"
                  >
                    <Plus size={12} /> Ekle
                  </button>
                  <button 
                    onclick={() => handleDeleteAsset(asset)}
                    class="p-1.5 text-neutral-500 hover:text-rose-400 hover:bg-neutral-800 rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none"
                    title="Medyayı Sil"
                    aria-label="{asset.name} medyasını sil"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </Tabs.Content>

    <!-- 2. TAB CONTENT: AI PANEL TOOLS -->
    <Tabs.Content value="ai" class="flex-1 overflow-y-auto p-3.5 custom-scrollbar outline-none">
      <div class="space-y-4">
        <!-- AI Assistant: Natural Language Command Trigger -->
        <div class="p-3 bg-gradient-to-br from-indigo-950/40 to-purple-950/30 border border-indigo-500/30 rounded-xl space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <Sparkles size={14} />
              </div>
              <div>
                <h4 class="text-xs font-bold text-white">Yapay Zeka Komut Asistanı</h4>
                <span class="text-[10px] text-neutral-400">Akıllı Video Asistanı</span>
              </div>
            </div>
            <span class="text-[10px] bg-indigo-900/60 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-700/50 font-mono">Ctrl + K</span>
          </div>
          <p class="text-[11px] text-neutral-300 leading-tight">
            Videonuzu 'Sessizlikleri sil', 'Altyazı üret', '2x hızlandır', '9:16 dikey yap' gibi akıllı komutlarla anında düzenleyin.
          </p>
          <button
            onclick={() => editor.isCommandPaletteOpen = true}
            class="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
          >
            <Sparkles size={13} /> AI Komut Paletini Aç (Ctrl + K)
          </button>
        </div>

        <!-- AI Tool 1: Whisper Captions -->
        <div class="p-3 bg-neutral-950/50 border border-neutral-800 rounded-xl space-y-2">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/30">
                <Type size={14} />
              </div>
              <div>
                <h4 class="text-xs font-bold text-white">Otomatik Altyazı & Senkron</h4>
                <span class="text-[10px] text-neutral-400 font-mono">OpenAI Whisper (WebGPU)</span>
              </div>
            </div>
            <span class="text-[10px] bg-purple-950/80 text-purple-300 px-1.5 py-0.5 rounded border border-purple-800/40">WebGPU</span>
          </div>
          <p class="text-[11px] text-neutral-400 leading-tight">
            Videodaki konuşmaları milisaniyelik zaman damgalarıyla algılar ve şık altyazı katmanı ekler. (Whisper AI)
          </p>
          <button
            onclick={runWhisperCaptions}
            disabled={aiService.isRunning}
            class="w-full py-2 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm"
          >
            <Type size={13} /> Altyazıları Otomatik Çıkar
          </button>
        </div>

        <!-- AI Tool 2: Silero VAD Silence Cut -->
        <div class="p-3 bg-neutral-950/50 border border-neutral-800 rounded-xl space-y-2">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <Scissors size={14} />
              </div>
              <div>
                <h4 class="text-xs font-bold text-white">Sessizlik & Boşluk Kesici</h4>
                <span class="text-[10px] text-neutral-400 font-mono">Silero VAD (ONNX WebGPU)</span>
              </div>
            </div>
            <span class="text-[10px] bg-emerald-950/80 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-800/40">WebGPU</span>
          </div>
          <p class="text-[11px] text-neutral-400 leading-tight">
            Nefes ve sessiz duraksama aralıklarını otomatik tespit ederek klibi böler ve akıcı hale getirir.
          </p>
          <div class="flex items-center gap-2">
            <label for="silence-threshold" class="text-[10px] text-neutral-400 flex-none">Hassasiyet:</label>
            <input 
              id="silence-threshold"
              type="range" 
              min="0.2" 
              max="0.8" 
              step="0.05" 
              bind:value={silenceSensitivity}
              class="w-full accent-emerald-500 h-1 bg-neutral-800 rounded"
            />
            <span class="text-[10px] font-mono text-neutral-400 w-8 text-right">{silenceSensitivity}</span>
          </div>
          <button
            onclick={runSilenceCut}
            disabled={aiService.isRunning}
            class="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm"
          >
            <Scissors size={13} /> Boşlukları Otomatik Kes (Jump-Cut)
          </button>
        </div>

        <!-- AI Tool 3: Kokoro TTS Voiceover -->
        <div class="p-3 bg-neutral-950/50 border border-neutral-800 rounded-xl space-y-2">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/30">
                <Volume2 size={14} />
              </div>
              <div>
                <h4 class="text-xs font-bold text-white">Yapay Zeka Seslendirme (TTS)</h4>
                <span class="text-[10px] text-neutral-400 font-mono">Kokoro-82M (WebGPU)</span>
              </div>
            </div>
            <span class="text-[10px] bg-blue-950/80 text-blue-300 px-1.5 py-0.5 rounded border border-blue-800/40">WebGPU</span>
          </div>
          <textarea
            bind:value={ttsText}
            placeholder="Seslendirilecek metni buraya yazın..."
            class="w-full p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 resize-none h-16"
          ></textarea>
          <div class="space-y-2">
            <div>
              <label for="tts-voice-select" class="block text-[10px] font-medium text-neutral-400 mb-1">Ses Sanatçısı:</label>
              <select
                id="tts-voice-select"
                bind:value={selectedVoice}
                class="w-full px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                {#each voices as voice (voice.id)}
                  <option value={voice.id}>{voice.name}</option>
                {/each}
              </select>
            </div>
            <button
              onclick={runTtsGeneration}
              disabled={aiService.isRunning || !ttsText.trim()}
              class="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
            >
              <Volume2 size={13} />
              <span>Seslendir ve Klibe Ekle</span>
            </button>
          </div>
        </div>

        <!-- AI Tool 4: Beat Detector -->
        <div class="p-3 bg-neutral-950/50 border border-neutral-800 rounded-xl space-y-2">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <Music size={14} />
              </div>
              <div>
                <h4 class="text-xs font-bold text-white">Müzik Ritim & Vuruş Senkronu</h4>
                <span class="text-[10px] text-neutral-400 font-mono">Web Audio Beat Engine (MIT)</span>
              </div>
            </div>
            <span class="text-[10px] bg-amber-950/80 text-amber-300 px-1.5 py-0.5 rounded border border-amber-800/40">Audio</span>
          </div>
          <p class="text-[11px] text-neutral-400 leading-tight">
            Müziğin ritmik vuruşlarını hesaplar, video geçişlerini müzikle kusursuz eşleştirir.
          </p>
          <button
            onclick={runBeatSync}
            disabled={aiService.isRunning}
            class="w-full py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm"
          >
            <Music size={13} /> Klipleri Ritime Kilitler
          </button>
        </div>

        <!-- AI Tool 5 & 6: BG Removal & Smart Reframe in 2-column -->
        <div class="grid grid-cols-2 gap-2">
          <div class="p-2.5 bg-neutral-950/50 border border-neutral-800 rounded-xl space-y-2">
            <div class="flex items-center gap-1.5 text-cyan-400">
              <Layers size={14} />
              <span class="text-xs font-bold text-white">Arka Plan Sil</span>
            </div>
            <p class="text-[10px] text-neutral-400">Yeşil perde olmadan kişiyi arka plandan ayırır.</p>
            <button
              onclick={runBgRemoval}
              disabled={aiService.isRunning}
              class="w-full py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center justify-center gap-1 transition-all"
            >
              <Layers size={11} /> Matting Uygula
            </button>
          </div>

          <div class="p-2.5 bg-neutral-950/50 border border-neutral-800 rounded-xl space-y-2">
            <div class="flex items-center gap-1.5 text-rose-400">
              <Crop size={14} />
              <span class="text-xs font-bold text-white">9:16 Reframe</span>
            </div>
            <p class="text-[10px] text-neutral-400">Konuşmacıyı takip edip dikey kadrajlar.</p>
            <button
              onclick={runSmartReframe}
              disabled={aiService.isRunning}
              class="w-full py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center justify-center gap-1 transition-all"
            >
              <Crop size={11} /> Kadrajla
            </button>
          </div>
        </div>

        <!-- AI Tool 7: Auto Color Enhance -->
        <div class="p-3 bg-neutral-950/50 border border-neutral-800 rounded-xl space-y-2">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                <Sparkles size={14} />
              </div>
              <div>
                <h4 class="text-xs font-bold text-white">Yapay Zeka Tek Tıkla Renk İyileştirme</h4>
                <span class="text-[10px] text-neutral-400 font-mono">Oklab Smart Color Profiler</span>
              </div>
            </div>
            <span class="text-[10px] bg-indigo-950/80 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-800/40">WebGPU</span>
          </div>
          <p class="text-[11px] text-neutral-400 leading-tight">
            Işık ve histogramı analiz edip dinamik kontrast ve sinematik Teal & Orange renk dengesini otomatik atar.
          </p>
          <button
            onclick={() => aiService.autoColorEnhance()}
            disabled={aiService.isRunning}
            class="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
          >
            <Sparkles size={13} /> Sinematik Rengi Otomatik Uygula
          </button>
        </div>

        <!-- AI Tool 8: Audio Denoise & Clean -->
        <div class="p-3 bg-neutral-950/50 border border-neutral-800 rounded-xl space-y-2">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <Volume2 size={14} />
              </div>
              <div>
                <h4 class="text-xs font-bold text-white">Dip Gürültü Temizleme & Ses İzolasyonu</h4>
                <span class="text-[10px] text-neutral-400 font-mono">Web Audio Spectral Gate</span>
              </div>
            </div>
            <span class="text-[10px] bg-emerald-950/80 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-800/40">Audio</span>
          </div>
          <p class="text-[11px] text-neutral-400 leading-tight">
            Klima, fan ve mikrofon dip gürültüsünü filtreler; konuşmacı sesini netleştirip öne çıkarır.
          </p>
          <button
            onclick={() => aiService.denoiseAudio()}
            disabled={aiService.isRunning}
            class="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
          >
            <Volume2 size={13} /> Sesi Temizle ve Parlat
          </button>
        </div>

        <!-- AI Tool 9: Viral Hook & Script Copilot -->
        <div class="p-3 bg-gradient-to-br from-pink-950/30 to-purple-950/30 border border-pink-500/20 rounded-xl space-y-2">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <div class="p-1.5 rounded-lg bg-pink-500/20 text-pink-400 border border-pink-500/30">
                <Wand2 size={14} />
              </div>
              <div>
                <h4 class="text-xs font-bold text-white">Viral Kanca & Kurgu Asistanı</h4>
                <span class="text-[10px] text-pink-300 font-mono">Agentic Script AI (On-Device)</span>
              </div>
            </div>
            <span class="text-[10px] bg-pink-900/60 text-pink-300 px-1.5 py-0.5 rounded border border-pink-700/50">WASM</span>
          </div>
          <p class="text-[11px] text-neutral-300 leading-tight">
            İzleyicinin dikkatini ilk 3 saniyede bağlayacak viral kancalar ve kurgu adımları üretir.
          </p>
          <button
            onclick={async () => {
              const res = await aiService.generateViralHooks();
              // automatically add as text clip
              let textTrack = editor.tracks.find(t => t.type === 'subtitle' || t.name === 'Yazı' || t.name === 'T1' || t.name.startsWith('T'));
              if (!textTrack) {
                textTrack = editor.addTrack('T1', 'subtitle');
              }
              editor.addClip(textTrack.id, res.title, editor.playhead, 3.5, '#ec4899', undefined, { type: 'text' });
              editor.announce(`Viral başlık eklendi: "${res.title}"`);
            }}
            disabled={aiService.isRunning}
            class="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
          >
            <Sparkles size={13} /> Viral Kanca Üret & Klibe Ekle
          </button>
        </div>
      </div>
    </Tabs.Content>

    <!-- 3. TAB CONTENT: CAPTIONS MANAGER -->
    <Tabs.Content value="captions" class="flex-1 overflow-y-auto p-3.5 custom-scrollbar outline-none">
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-white">Altyazı Yöneticisi</h3>
            <p class="text-[11px] text-neutral-400">Zaman damgalı kelime ve satırları düzenleyin.</p>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              onclick={() => editor.openBottomSheet('subtitle_style')}
              class="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-purple-300 border border-purple-500/30 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors"
              title="Tipografi ve Şablon Stillerini Ayarla"
            >
              <Type size={12} /> Stiller
            </button>
            <button
              onclick={runWhisperCaptions}
              disabled={aiService.isRunning}
              class="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors"
            >
              <Sparkles size={12} /> Otomatik Üret
            </button>
          </div>
        </div>

        <!-- Add Subtitle Input -->
        <div class="flex gap-2">
          <input
            type="text"
            bind:value={newSubtitleText}
            placeholder="Yeni altyazı satırı..."
            class="flex-1 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onclick={() => {
              if (!newSubtitleText.trim()) return;
              const clip = selectedClip || editor.tracks[0]?.clips[0];
              if (clip) {
                editor.addSubtitleToClip(clip.id, newSubtitleText);
                newSubtitleText = '';
              }
            }}
            class="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
          >
            <Plus size={13} /> Ekle
          </button>
        </div>

        <!-- Subtitles List -->
        {#if allSubtitles.length === 0}
          <div class="p-6 border border-dashed border-neutral-800 rounded-xl text-center flex flex-col items-center justify-center gap-2 text-neutral-500 bg-neutral-950/30">
            <Type size={24} class="opacity-40" />
            <span class="text-xs">Henüz altyazı bulunmuyor</span>
            <button 
              onclick={runWhisperCaptions}
              class="text-xs text-purple-400 hover:text-purple-300 font-medium underline"
            >
              Simüle edilmiş motorla videodan otomatik çıkar
            </button>
          </div>
        {:else}
          <div class="space-y-2">
            {#each allSubtitles as item (item.clipId + '_' + item.sub.id)}
              <div class="p-2.5 bg-neutral-950/70 border border-neutral-800 hover:border-neutral-700 rounded-xl space-y-1.5 transition-all">
                <div class="flex items-center justify-between text-[10px] font-mono text-neutral-400">
                  <button 
                    onclick={() => editor.seekTo(item.sub.start)} 
                    class="hover:text-blue-400 transition-colors flex items-center gap-1 font-bold text-neutral-300"
                  >
                    <Play size={9} /> {item.sub.start.toFixed(2)}s - {item.sub.end.toFixed(2)}s
                  </button>
                  <div class="flex items-center gap-1.5">
                    <button
                      onclick={() => {
                        editor.rippleCutRange(item.sub.start, item.sub.end);
                        editor.removeSubtitle(item.clipId, item.sub.id);
                      }}
                      class="px-1.5 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[9px] flex items-center gap-1 transition-colors"
                      title="Bu konuşma aralığını videodan doğrudan kesip çıkar ve boşluğu kapat (Jump-Cut)"
                    >
                      <Scissors size={9} />
                      <span>Videodan Kes</span>
                    </button>
                    <button 
                      onclick={() => editor.removeSubtitle(item.clipId, item.sub.id)}
                      class="text-neutral-500 hover:text-red-400 transition-colors p-0.5"
                      title="Sadece Altyazıyı Sil"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={item.sub.text}
                  oninput={(e) => editor.updateSubtitleText(item.clipId, item.sub.id, (e.target as HTMLInputElement).value)}
                  class="w-full px-2 py-1 rounded bg-neutral-950 border border-neutral-800 text-xs text-yellow-300 font-medium focus:outline-none focus:border-yellow-500"
                />
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </Tabs.Content>

    <!-- 5. TAB CONTENT: MAGIC TEMPLATES -->
    <Tabs.Content value="templates" class="flex-1 overflow-y-auto p-3.5 custom-scrollbar outline-none">
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-1.5"><Wand2 size={16} class="text-pink-400" /> 2026 Sihirli Kurgu Şablonları</h3>
            <p class="text-[11px] text-neutral-400">Ritim vuruşları ve sahne geçişleriyle otomatik montaj</p>
          </div>
        </div>

        <!-- Template Category Filters -->
        <div class="flex items-center gap-1 overflow-x-auto pb-1">
          {#each [
            { id: 'all', label: 'Tümü' },
            { id: 'viral', label: 'Viral TikTok' },
            { id: 'cinematic', label: 'Sinematik' },
            { id: 'rhythm', label: 'Ritim & Beat' },
            { id: 'creative', label: 'Yaratıcı' },
            { id: 'social', label: 'Sosyal / Podcast' }
          ] as cat}
            <button
              onclick={() => selectedTemplateCategory = cat.id as any}
              class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer {selectedTemplateCategory === cat.id ? 'bg-pink-600 text-white font-bold' : 'bg-neutral-950 text-neutral-400 border border-white/5 hover:text-white'}"
            >
              {cat.label}
            </button>
          {/each}
        </div>
        
        <!-- Templates List -->
        <div class="space-y-2">
          <span class="block text-xs font-semibold text-neutral-300">1. Şablon Seçin ({MAGIC_TEMPLATES.length} Hazır Stil)</span>
          <div class="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
            {#each (selectedTemplateCategory === 'all' ? MAGIC_TEMPLATES : MAGIC_TEMPLATES.filter(t => t.category === selectedTemplateCategory)) as template (template.id)}
              <button 
                class="text-left p-2.5 rounded-xl border transition-all cursor-pointer {selectedTemplateId === template.id ? 'bg-pink-950/40 border-pink-500 text-pink-100 shadow-sm' : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'}"
                onclick={() => selectedTemplateId = template.id}
              >
                <div class="flex items-center justify-between">
                  <span class="font-bold text-xs text-white">{template.name}</span>
                  <div class="flex items-center gap-1">
                    {#if template.targetBpm}
                      <span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-pink-500/20 text-pink-300 border border-pink-500/30">{template.targetBpm} BPM</span>
                    {/if}
                    <span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400">{template.slots.length} Klip</span>
                  </div>
                </div>
                {#if template.description}
                  <p class="text-[10px] text-neutral-400 mt-1 leading-tight">{template.description}</p>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <!-- 2. Audio Select -->
        <div class="space-y-2 mt-3">
          <div class="flex items-center justify-between">
            <label for="template-audio-select" class="block text-xs font-semibold text-neutral-300">2. Ana Müzik / Ritim</label>
          </div>
          <select 
            id="template-audio-select"
            bind:value={selectedTemplateAudioId}
            class="w-full px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-800 text-xs text-white focus:border-pink-500 focus:outline-none"
          >
            <option value="">Ses veya müzik dosyası seçin...</option>
            {#each editor.assets.filter(a => a.type === 'audio' || a.type === 'video') as asset (asset.id)}
              <option value={asset.id}>{asset.name}</option>
            {/each}
          </select>
        </div>

        <!-- 3. Videos Select -->
        <div class="space-y-2 mt-3">
          <div class="flex items-center justify-between text-xs font-semibold text-neutral-300">
            <span>3. Videoları Seç</span>
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-normal text-neutral-500">{selectedTemplateVideoIds.length} seçili</span>
            </div>
          </div>
          <div class="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar pr-1">
            {#each editor.assets.filter(a => a.type === 'video' || a.type === 'image') as asset (asset.id)}
              <label class="flex items-center gap-2 p-2 rounded-lg bg-neutral-950 border border-neutral-800 cursor-pointer hover:border-neutral-700">
                <input 
                  type="checkbox" 
                  value={asset.id} 
                  bind:group={selectedTemplateVideoIds}
                  class="rounded border-neutral-700 text-pink-500 focus:ring-pink-500 bg-neutral-950"
                />
                <span class="text-xs text-neutral-300 truncate flex-1">{asset.name}</span>
              </label>
            {/each}
            {#if editor.assets.filter(a => a.type === 'video' || a.type === 'image').length === 0}
              <div class="text-xs text-neutral-500 p-2 text-center">Önce medyadan video veya resim yükleyin.</div>
            {/if}
          </div>
        </div>

        <button 
          disabled={!selectedTemplateId || editor.isProcessing}
          onclick={async () => {
            let audioId = selectedTemplateAudioId;
            let vIds = [...selectedTemplateVideoIds];

            if (!audioId) {
              const audioAsset = editor.assets.find(a => a.type === 'audio');
              if (audioAsset) audioId = audioAsset.id;
            }
            if (vIds.length === 0) {
              const videoAssets = editor.assets.filter(a => a.type === 'video' || a.type === 'image');
              vIds = videoAssets.map(a => a.id);
            }

            if (!audioId || vIds.length === 0) {
              editor.announce('Şablon uygulamak için lütfen önce bir video ve ses dosyası yükleyin.');
              return;
            }

            if (selectedTemplateId && audioId) {
              await agenticEditor.applyTemplate(selectedTemplateId, audioId, vIds);
            }
          }}
          class="w-full mt-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white text-xs font-bold shadow-lg shadow-pink-900/20 hover:shadow-pink-900/40 hover:from-pink-500 hover:to-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
        >
          {#if editor.isProcessing}
            <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Şablon Kurgulanıyor...</span>
          {:else}
            <Wand2 size={14} />
            <span>Şablonu Uygula & Kurgula</span>
          {/if}
        </button>

      </div>
    </Tabs.Content>

    <!-- 6. TAB CONTENT: CINEMATIC FILTERS -->
    <Tabs.Content value="filters" class="flex-1 overflow-y-auto p-3.5 custom-scrollbar outline-none">
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-1.5">
              <Palette size={16} class="text-cyan-400" /> Sinematik Renk Filtreleri
            </h3>
            <p class="text-[11px] text-neutral-400">Oklab renk uzayında WebGPU hızlandırmalı LUT profilleri</p>
          </div>

          <button
            onclick={() => aiService.autoColorEnhance()}
            disabled={aiService.isRunning}
            class="px-2.5 py-1 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-[11px] font-semibold flex items-center gap-1 shadow transition-all cursor-pointer disabled:opacity-50"
            title="Yapay zeka ile sahne ışığını analiz et ve sinematik renk uygula"
          >
            <Sparkles size={11} class={aiService.isRunning ? 'animate-spin' : ''} />
            <span>AI Renk</span>
          </button>
        </div>

        <!-- Filter Categories -->
        <div class="flex items-center gap-1 overflow-x-auto pb-1">
          {#each [
            { id: 'all', label: 'Tümü' },
            { id: 'cinematic', label: 'Sinematik' },
            { id: 'creative', label: 'Yaratıcı' },
            { id: 'vintage', label: 'Nostalji' },
            { id: 'clean', label: 'Temiz' }
          ] as cat}
            <button
              onclick={() => selectedFilterCategory = cat.id as any}
              class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer {selectedFilterCategory === cat.id ? 'bg-cyan-600 text-white font-bold' : 'bg-neutral-950 text-neutral-400 border border-white/5 hover:text-white'}"
            >
              {cat.label}
            </button>
          {/each}
        </div>

        <!-- Filters Grid -->
        <div class="grid grid-cols-1 gap-2">
          {#each (selectedFilterCategory === 'all' ? FILTER_PRESETS : FILTER_PRESETS.filter(p => p.category === selectedFilterCategory)) as preset (preset.id)}
            {@const isCurrent = selectedClip?.colorGrading?.lut === preset.grading.lut}
            <button
              onclick={() => {
                if (selectedClip) editor.applyFilterToClip(selectedClip.id, preset.id);
                else editor.applyFilterToAllClips(preset.id);
              }}
              class="p-2.5 rounded-xl border text-left transition-all cursor-pointer group flex items-center justify-between gap-3 {isCurrent ? 'border-cyan-500 bg-cyan-950/20 shadow-md' : 'border-white/5 bg-neutral-950 hover:border-white/20'}"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-lg shrink-0 shadow-inner" style="background: {preset.previewGradient};"></div>
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-bold text-white truncate">{preset.name}</span>
                    {#if isCurrent}
                      <Check size={12} class="text-cyan-400" />
                    {/if}
                  </div>
                  <p class="text-[10px] text-neutral-400 truncate">{preset.description}</p>
                </div>
              </div>

              <span class="text-[10px] text-cyan-400 font-medium shrink-0 group-hover:underline">Uygula</span>
            </button>
          {/each}
        </div>
      </div>
    </Tabs.Content>
  </Tabs.Root>
</aside>
