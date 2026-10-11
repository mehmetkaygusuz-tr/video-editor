<script lang="ts">
  import { editor } from '../editor.svelte';
  import { aiService } from '../engine/aiService.svelte';
  import { 
    X, Sliders, Monitor, Cpu, Volume2, Palette, Shield, 
    HardDrive, Check, RefreshCw, Zap, Gauge, Smartphone, Sparkles, Trash2,
    ArrowLeft
  } from '@lucide/svelte';
  import type { ThemeId } from '../types';

  let activeTab = $state<'project' | 'ai' | 'audio' | 'appearance' | 'platform'>('project');
  let vramModels = $state<string[]>([]);
  let isFlushingVram = $state(false);

  $effect(() => {
    if (editor.isSettingsModalOpen && activeTab === 'ai') {
      aiService.checkVramStatus().then(models => {
        vramModels = models;
      });
    }
  });

  async function handleFlushVram() {
    isFlushingVram = true;
    try {
      await aiService.releaseVram();
      vramModels = [];
      editor.announce('GPU VRAM önbelleği temizlendi.');
    } finally {
      isFlushingVram = false;
    }
  }

  const themes: { id: ThemeId; name: string; desc: string; preview: string }[] = [
    {
      id: 'obsidian',
      name: 'Deep Obsidian (2026)',
      desc: 'Modern, sessiz, derin obsidiyen siyahı ve ince neon vurgular.',
      preview: 'bg-neutral-950 border-neutral-800'
    },
    {
      id: 'cyber',
      name: 'Cyberpunk Neon',
      desc: 'Yüksek kontrastlı koyu mor ve elektrik camgöbeği ışıltısı.',
      preview: 'bg-[#0f0c1b] border-purple-500/40'
    },
    {
      id: 'slate',
      name: 'Studio Slate',
      desc: 'Profesyonel NLE kurgu stüdyosu gri tonları ve nötr arka plan.',
      preview: 'bg-slate-900 border-slate-700'
    },
    {
      id: 'oled',
      name: 'OLED Pure Black',
      desc: 'Maksimum kontrast, sıfır piksel tüketimi ve mobil pil tasarrufu.',
      preview: 'bg-black border-white/20'
    }
  ];

  const resolutionPresets = [
    { id: '1080p', label: '1080p FHD (1920 × 1080)', ratio: '16:9' },
    { id: '4k', label: '4K UHD (3840 × 2160)', ratio: '16:9' },
    { id: '720p', label: '720p HD (1280 × 720)', ratio: '16:9' },
    { id: 'shorts_9_16', label: 'TikTok / Shorts / Reels (1080 × 1920)', ratio: '9:16' },
    { id: 'square_1_1', label: 'Instagram Kare (1080 × 1080)', ratio: '1:1' },
    { id: 'portrait_4_5', label: 'Instagram Dikey Post (1080 × 1350)', ratio: '4:5' }
  ];

  const fpsOptions = [24, 25, 30, 60, 120];
</script>

{#if editor.isSettingsModalOpen}
  <div 
    class="fixed inset-0 z-50 bg-neutral-950 text-neutral-100 flex flex-col font-sans select-none overflow-hidden animate-in fade-in duration-150"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-page-title"
  >
    <!-- Top Dedicated Page Header -->
    <header class="flex-none px-4 sm:px-8 py-3.5 border-b border-white/10 bg-neutral-950 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <button 
          onclick={() => editor.isSettingsModalOpen = false}
          class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95"
          title="Stüdyo ve Zaman Çizelgesine Geri Dön"
        >
          <ArrowLeft size={15} />
          <span>Stüdyoya Dön</span>
        </button>
        <div class="h-4 w-px bg-white/15 mx-1 hidden sm:block"></div>
        <div>
          <h1 id="settings-page-title" class="text-sm font-bold text-white flex items-center gap-2">
            <span>Stüdyo ve Sistem Ayarları</span>
            <span class="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">2026 PRO</span>
          </h1>
          <p class="text-[11px] text-neutral-400 hidden sm:block">Proje çözünürlüğü, donanım optimizasyonu, yerel AI ve görünüm tercihleri</p>
        </div>
      </div>

      <button
        onclick={() => editor.isSettingsModalOpen = false}
        class="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all cursor-pointer shadow-md shadow-blue-900/40 active:scale-95 flex items-center gap-1.5"
      >
        <Check size={14} />
        <span>Kaydet & Kapat</span>
      </button>
    </header>

    <!-- Main Settings Layout -->
    <div class="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
      <!-- Sidebar Navigation (Desktop) / Horizontal Tabs (Mobile) -->
      <nav class="flex-none w-full md:w-64 p-3 md:p-4 border-b md:border-b-0 md:border-r border-white/10 bg-neutral-950/80 flex md:flex-col gap-1.5 overflow-x-auto md:overflow-x-visible [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <button
          onclick={() => activeTab = 'project'}
          class="px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all whitespace-nowrap cursor-pointer {activeTab === 'project' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30 font-bold' : 'text-neutral-400 hover:text-white hover:bg-white/5'}"
        >
          <Monitor size={15} />
          <span>Tuval & Proje</span>
        </button>

        <button
          onclick={() => activeTab = 'ai'}
          class="px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all whitespace-nowrap cursor-pointer {activeTab === 'ai' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30 font-bold' : 'text-neutral-400 hover:text-white hover:bg-white/5'}"
        >
          <Cpu size={15} />
          <span>Yapay Zeka & VRAM</span>
        </button>

        <button
          onclick={() => activeTab = 'audio'}
          class="px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all whitespace-nowrap cursor-pointer {activeTab === 'audio' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30 font-bold' : 'text-neutral-400 hover:text-white hover:bg-white/5'}"
        >
          <Volume2 size={15} />
          <span>Ses Motoru</span>
        </button>

        <button
          onclick={() => activeTab = 'appearance'}
          class="px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all whitespace-nowrap cursor-pointer {activeTab === 'appearance' ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/30 font-bold' : 'text-neutral-400 hover:text-white hover:bg-white/5'}"
        >
          <Palette size={15} />
          <span>Görünüm & Temalar</span>
        </button>

        <button
          onclick={() => activeTab = 'platform'}
          class="px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all whitespace-nowrap cursor-pointer {activeTab === 'platform' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30 font-bold' : 'text-neutral-400 hover:text-white hover:bg-white/5'}"
        >
          <Smartphone size={15} />
          <span>Platform & Cihaz</span>
        </button>
      </nav>

      <!-- Content Area: Spacious & Structured -->
      <div class="flex-1 p-4 sm:p-8 overflow-y-auto custom-scrollbar max-w-4xl mx-auto w-full">
        
        <!-- TAB 1: PROJECT & CANVAS -->
        {#if activeTab === 'project'}
          <div class="space-y-6 animate-in fade-in duration-200">
            <div>
              <h2 class="text-base font-bold text-white">Tuval & Çözünürlük Standartları</h2>
              <p class="text-xs text-neutral-400">Videonun dışa aktarma ve önizleme boyutlarını belirleyin.</p>
            </div>

            <!-- Resolution Presets -->
            <div class="space-y-2.5">
              <span class="text-xs font-semibold text-neutral-300">Hazır Çözünürlük Profilleri:</span>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {#each resolutionPresets as preset (preset.id)}
                  <button
                    onclick={() => editor.updateSettings({ resolutionPreset: preset.id as any })}
                    class="p-3.5 rounded-xl border text-left transition-all cursor-pointer {editor.settings.resolutionPreset === preset.id ? 'bg-blue-950/60 border-blue-500 text-white shadow-md' : 'bg-neutral-900/60 border-white/5 text-neutral-400 hover:border-white/20'}"
                  >
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold text-white">{preset.label.split('(')[0]}</span>
                      {#if editor.settings.resolutionPreset === preset.id}
                        <Check size={14} class="text-blue-400" />
                      {/if}
                    </div>
                    <span class="text-[11px] text-neutral-400 block mt-1">{preset.label}</span>
                  </button>
                {/each}
              </div>
            </div>

            <!-- Frame Rate (FPS) -->
            <div class="space-y-2.5 pt-4 border-t border-white/10">
              <span class="text-xs font-semibold text-neutral-300">Proje Kare Hızı (FPS):</span>
              <div class="grid grid-cols-5 gap-2">
                {#each fpsOptions as fps (fps)}
                  <button
                    onclick={() => editor.updateSettings({ fps })}
                    class="py-2.5 rounded-xl text-xs font-mono font-medium transition-colors cursor-pointer {editor.projectFps === fps ? 'bg-blue-600 text-white font-bold shadow-md' : 'bg-neutral-900 border border-white/5 text-neutral-400 hover:text-white'}"
                  >
                    {fps} FPS
                  </button>
                {/each}
              </div>
              <p class="text-[11px] text-neutral-400">24 FPS: Sinematik film; 30/60 FPS: Standart sosyal medya & YouTube akıcılığı; 120 FPS: Ağır çekim / Pro Gaming.</p>
            </div>

            <!-- Magnetic Snapping -->
            <div class="pt-4 border-t border-white/10 flex items-center justify-between">
              <div>
                <span class="text-xs font-semibold text-white block">Manyetik Zaman Çizelgesi (Snapping)</span>
                <span class="text-[11px] text-neutral-400 block">Klipler yaklaştığında uç uca otomatik yapışsın.</span>
              </div>
              <button
                aria-label="Manyetik Çizelge"
                onclick={() => editor.isMagnetic = !editor.isMagnetic}
                class="w-12 h-6 rounded-full transition-colors relative cursor-pointer {editor.isMagnetic ? 'bg-blue-600' : 'bg-neutral-800'}"
              >
                <div class="w-4 h-4 rounded-full bg-white absolute top-1 transition-transform {editor.isMagnetic ? 'right-1' : 'left-1'}"></div>
              </button>
            </div>
          </div>

        <!-- TAB 2: AI & VRAM -->
        {:else if activeTab === 'ai'}
          <div class="space-y-6 animate-in fade-in duration-200">
            <div>
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <Cpu size={18} class="text-purple-400" />
                <span>Yapay Zeka & Donanım Hızlandırma</span>
              </h2>
              <p class="text-xs text-neutral-400">Tüm AI modelleri %100 açık kaynaklı ve doğrudan cihazınızda (on-device) çalışır.</p>
            </div>

            <!-- Hardware Acceleration Status -->
            <div class="p-4 bg-neutral-900/70 border border-purple-500/20 rounded-2xl space-y-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <div class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></div>
                  <span class="text-xs font-bold text-white">WebGPU & W3C WebCodecs Motoru</span>
                </div>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Donanım Aktif</span>
              </div>
              <p class="text-[11px] text-neutral-400 leading-relaxed">
                Ekran kartınızın (GPU) gölgelendiricileri Oklab renk matrisleri ve AI tensör hesaplamaları için kullanılmaktadır.
              </p>
            </div>

            <!-- Model Quantization / Precision -->
            <div class="space-y-2.5">
              <span class="text-xs font-semibold text-neutral-300">Model Hassasiyeti (Quantization):</span>
              <div class="grid grid-cols-3 gap-2 text-xs">
                <button
                  onclick={() => editor.updateSettings({ modelPrecision: 'fp32' })}
                  class="p-3 rounded-xl border text-center transition-all cursor-pointer {editor.settings.modelPrecision === 'fp32' ? 'bg-purple-950/60 border-purple-500 text-white font-bold shadow-md' : 'bg-neutral-900 border-white/5 text-neutral-400 hover:text-white'}"
                >
                  <span class="block font-semibold">FP32 (Tam Kalite)</span>
                  <span class="text-[10px] text-neutral-400 mt-0.5 block">En yüksek doğruluk</span>
                </button>
                <button
                  onclick={() => editor.updateSettings({ modelPrecision: 'fp16' })}
                  class="p-3 rounded-xl border text-center transition-all cursor-pointer {editor.settings.modelPrecision === 'fp16' ? 'bg-purple-950/60 border-purple-500 text-white font-bold shadow-md' : 'bg-neutral-900 border-white/5 text-neutral-400 hover:text-white'}"
                >
                  <span class="block font-semibold">FP16 (Hızlı GPU)</span>
                  <span class="text-[10px] text-neutral-400 mt-0.5 block">2x hızlanma</span>
                </button>
                <button
                  onclick={() => editor.updateSettings({ modelPrecision: 'q8' })}
                  class="p-3 rounded-xl border text-center transition-all cursor-pointer {editor.settings.modelPrecision === 'q8' ? 'bg-purple-950/60 border-purple-500 text-white font-bold shadow-md' : 'bg-neutral-900 border-white/5 text-neutral-400 hover:text-white'}"
                >
                  <span class="block font-semibold">INT8 (Düşük VRAM)</span>
                  <span class="text-[10px] text-neutral-400 mt-0.5 block">Eski cihazlar için</span>
                </button>
              </div>
            </div>

            <!-- VRAM Model Flush -->
            <div class="p-4 bg-neutral-900 border border-white/5 rounded-2xl space-y-3">
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-xs font-semibold text-white block">GPU Belleği & Yüklü Modeller (VRAM)</span>
                  <span class="text-[11px] text-neutral-400">
                    {vramModels.length > 0 ? `${vramModels.length} model bellekte aktif tutuluyor` : 'VRAM boşta'}
                  </span>
                </div>
                <button
                  onclick={handleFlushVram}
                  disabled={isFlushingVram}
                  class="px-3.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-rose-950/40 text-neutral-300 hover:text-rose-300 border border-white/10 hover:border-rose-500/40 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 size={13} />
                  <span>{isFlushingVram ? 'Boşaltılıyor...' : 'VRAM Boşalt'}</span>
                </button>
              </div>

              {#if vramModels.length > 0}
                <div class="space-y-1">
                  {#each vramModels as model, idx (idx)}
                    <div class="text-[11px] font-mono text-neutral-400 bg-neutral-950 px-2.5 py-1.5 rounded border border-white/5 flex items-center gap-2">
                      <div class="w-1.5 h-1.5 rounded-full bg-purple-400"></div>
                      <span>{model}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Offline Mode -->
            <div class="flex items-center justify-between pt-4 border-t border-white/10">
              <div>
                <span class="text-xs font-semibold text-white block">Çevrimdışı Mod (Offline On-Device Only)</span>
                <span class="text-[11px] text-neutral-400 block">Dış ağ çağrılarını engeller, sadece yerel modelleri kullanır.</span>
              </div>
              <button
                aria-label="Çevrimdışı Çalışma Modu"
                onclick={() => editor.updateSettings({ offlineMode: !editor.settings.offlineMode })}
                class="w-12 h-6 rounded-full transition-colors relative cursor-pointer {editor.settings.offlineMode ? 'bg-purple-600' : 'bg-neutral-800'}"
              >
                <div class="w-4 h-4 rounded-full bg-white absolute top-1 transition-transform {editor.settings.offlineMode ? 'right-1' : 'left-1'}"></div>
              </button>
            </div>
          </div>

        <!-- TAB 3: AUDIO ENGINE -->
        {:else if activeTab === 'audio'}
          <div class="space-y-6 animate-in fade-in duration-200">
            <div>
              <h2 class="text-base font-bold text-white">Ses Motoru & W3C Web Audio API</h2>
              <p class="text-xs text-neutral-400">Örnekleme hızı, gecikme senkronizasyonu ve otomatik miksaj ayarları.</p>
            </div>

            <!-- Audio Sample Rate -->
            <div class="space-y-2.5">
              <span class="text-xs font-semibold text-neutral-300">Örnekleme Frekansı (Sample Rate):</span>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  onclick={() => editor.updateSettings({ audioSampleRate: 48000 })}
                  class="p-3.5 rounded-xl border text-left transition-all cursor-pointer {editor.settings.audioSampleRate === 48000 ? 'bg-emerald-950/60 border-emerald-500 text-white shadow-md' : 'bg-neutral-900 border-white/5 text-neutral-400 hover:text-white'}"
                >
                  <div class="text-xs font-bold text-white">48.0 kHz (Stüdyo Standardı)</div>
                  <span class="text-[11px] text-neutral-400 block mt-1">Video ve televizyon yayın standardı</span>
                </button>
                <button
                  onclick={() => editor.updateSettings({ audioSampleRate: 44100 })}
                  class="p-3.5 rounded-xl border text-left transition-all cursor-pointer {editor.settings.audioSampleRate === 44100 ? 'bg-emerald-950/60 border-emerald-500 text-white shadow-md' : 'bg-neutral-900 border-white/5 text-neutral-400 hover:text-white'}"
                >
                  <div class="text-xs font-bold text-white">44.1 kHz (CD Kalitesi)</div>
                  <span class="text-[11px] text-neutral-400 block mt-1">Müzik ve podcast için standart</span>
                </button>
              </div>
            </div>

            <!-- Audio Clock Sync Telemetry -->
            <div class="p-4 bg-neutral-900 border border-white/5 rounded-2xl space-y-2 text-xs">
              <span class="font-semibold text-white block">Master Audio Clock Telemetrisi</span>
              <div class="grid grid-cols-2 gap-3 text-[11px] font-mono text-neutral-400">
                <div>Çıkış Gecikmesi: <span class="text-emerald-400">{(editor.audioClockTelemetry.totalLatency * 1000).toFixed(1)} ms</span></div>
                <div>A/V Drift: <span class="text-emerald-400">{editor.audioClockTelemetry.driftMs.toFixed(1)} ms</span></div>
              </div>
            </div>
          </div>

        <!-- TAB 4: APPEARANCE & THEMES -->
        {:else if activeTab === 'appearance'}
          <div class="space-y-6 animate-in fade-in duration-200">
            <div>
              <h2 class="text-base font-bold text-white">Arayüz Temaları & 2026 Tasarım Dili</h2>
              <p class="text-xs text-neutral-400">Stüdyo arayüzünün renk temasını ve dokunsal geri bildirimini ayarlayın.</p>
            </div>

            <!-- Themes List -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {#each themes as t (t.id)}
                <button
                  onclick={() => editor.setTheme(t.id)}
                  class="p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between {editor.activeTheme === t.id ? 'border-amber-500 bg-amber-950/20 shadow-lg shadow-amber-950/20' : 'border-white/5 bg-neutral-900 hover:border-white/20'}"
                >
                  <div>
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold text-white">{t.name}</span>
                      {#if editor.activeTheme === t.id}
                        <Check size={14} class="text-amber-400" />
                      {/if}
                    </div>
                    <p class="text-[11px] text-neutral-400 mt-1 leading-relaxed">{t.desc}</p>
                  </div>
                  <div class="w-full h-3 rounded-full mt-3 border border-white/10 {t.preview}"></div>
                </button>
              {/each}
            </div>

            <!-- Haptic Feedback -->
            <div class="pt-4 border-t border-white/10 flex items-center justify-between">
              <div>
                <span class="text-xs font-semibold text-white block">Dokunsal Titreşim (Haptic Feedback)</span>
                <span class="text-[11px] text-neutral-400 block">Kesim, bölme ve düğmelere basıldığında hafif titreşim.</span>
              </div>
              <button
                aria-label="Dokunsal Geri Bildirim"
                onclick={() => editor.updateSettings({ hapticFeedback: !editor.settings.hapticFeedback })}
                class="w-12 h-6 rounded-full transition-colors relative cursor-pointer {editor.settings.hapticFeedback ? 'bg-amber-600' : 'bg-neutral-800'}"
              >
                <div class="w-4 h-4 rounded-full bg-white absolute top-1 transition-transform {editor.settings.hapticFeedback ? 'right-1' : 'left-1'}"></div>
              </button>
            </div>
          </div>

        <!-- TAB 5: PLATFORM & NATIVE DEVICE INTEGRATION -->
        {:else if activeTab === 'platform'}
          <div class="space-y-6 animate-in fade-in duration-200">
            <div>
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <Smartphone size={18} class="text-indigo-400" />
                <span>Çoklu Platform & Donanım Uyumu</span>
              </h2>
              <p class="text-xs text-neutral-400">iOS, Android, Windows, macOS ve Linux üzerinde yerel uygulama davranışı.</p>
            </div>

            <div class="p-5 bg-gradient-to-br from-indigo-950/30 to-purple-950/20 border border-indigo-500/20 rounded-2xl space-y-3">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 font-bold text-sm">
                  UX
                </div>
                <div>
                  <h3 class="text-xs font-bold text-white">Yerel Hibrit Uygulama Mimarisi</h3>
                  <span class="text-[10px] text-indigo-300 font-mono">Sıfır Ek Yük & Doğrudan Donanım Hızlandırma</span>
                </div>
              </div>
              <p class="text-[11px] text-neutral-300 leading-relaxed">
                Bu uygulama, paketlendiğinde işletim sistemi kontrollerini, dosya sistemi API'lerini ve doğrudan GPU erişimini yerel hızda kullanır.
              </p>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/10 text-center text-[10px] font-mono">
                <div class="p-2 bg-neutral-900 rounded-lg text-emerald-400 border border-white/5">✓ iOS Native</div>
                <div class="p-2 bg-neutral-900 rounded-lg text-emerald-400 border border-white/5">✓ Android Native</div>
                <div class="p-2 bg-neutral-900 rounded-lg text-emerald-400 border border-white/5">✓ Windows 11</div>
                <div class="p-2 bg-neutral-900 rounded-lg text-emerald-400 border border-white/5">✓ macOS Metal</div>
              </div>
            </div>

            <!-- Safe Area & Touch optimization info -->
            <div class="p-4 bg-neutral-900 border border-white/5 rounded-2xl space-y-1.5 text-xs text-neutral-400">
              <span class="text-white font-semibold block">Dokunmatik ve Güvenli Alan Koruması</span>
              <p class="text-[11px]">Mobil cihazlarda çentik (notch), ada (Dynamic Island) ve ana ekran alt çubuğu (home indicator) otomatik algılanarak taşmalar önlenir.</p>
            </div>
          </div>
        {/if}

      </div>
    </div>
  </div>
{/if}
