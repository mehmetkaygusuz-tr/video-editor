<script lang="ts">
  import { X, Sliders, Volume2, FastForward, Sparkles, Layers, Crop, Trash as Trash2, Scissors, HelpCircle } from '@lucide/svelte';
  import { editor } from '../editor.svelte';
  import { aiService } from '../engine/aiService.svelte';
  import { appState } from '../appState.svelte';
  import OklabColorWheel from './controls/OklabColorWheel.svelte';
  
  let selectedClip = $derived(editor.getSelectedClip());
</script>

<aside class="@container w-full h-full flex flex-col bg-transparent overflow-y-auto p-3.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
  {#if selectedClip}
    <div class="space-y-3.5">
      <!-- Header / Clip Identity Card -->
      <div class="spatial-glass-subtle p-3 rounded-2xl border border-white/10 shadow-lg flex items-center justify-between">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-3.5 h-3.5 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.4)] flex-none" style="background-color: {selectedClip.color};"></div>
          <div class="flex flex-col min-w-0">
            <span class="text-[10px] text-purple-400 font-mono font-bold uppercase tracking-wider">Klip Özellikleri</span>
            <span class="text-xs font-semibold text-white truncate">{selectedClip.name}</span>
          </div>
        </div>
        <div class="flex items-center gap-1 flex-none">
          <button 
            onclick={() => editor.selectClip(null)}
            class="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            title="Seçimi Kaldır"
          >
            <X size={14} />
          </button>
          <button 
            onclick={() => {
              if (window.innerWidth < 1280) {
                editor.closeBottomSheet();
              } else {
                appState.toggleInspector();
              }
            }}
            class="xl:hidden text-neutral-400 hover:text-white p-1.5 bg-neutral-800 rounded-lg cursor-pointer"
            title="Müfettişi Kapat"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <!-- Timing & Duration Card -->
      <div class="spatial-glass-subtle p-3 rounded-2xl border border-white/10 shadow-md">
        <span class="text-[10px] font-mono text-neutral-400 uppercase tracking-wider block mb-2 font-semibold">Zamanlama & Süre</span>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="bg-neutral-950/60 p-2 rounded-xl border border-white/5 flex flex-col">
            <span class="text-[9px] text-neutral-400 uppercase font-mono">Başlangıç</span>
            <span class="font-mono text-cyan-300 font-bold text-sm">{selectedClip.startAt.toFixed(2)}s</span>
          </div>
          <div class="bg-neutral-950/60 p-2 rounded-xl border border-white/5 flex flex-col">
            <span class="text-[9px] text-neutral-400 uppercase font-mono">Toplam Süre</span>
            <span class="font-mono text-purple-300 font-bold text-sm">{selectedClip.duration.toFixed(2)}s</span>
          </div>
        </div>
      </div>

      <!-- Audio & Volume Card -->
      <div class="spatial-glass-subtle p-3 rounded-2xl border border-white/10 shadow-md space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-neutral-300 font-medium flex items-center gap-1.5">
            <Volume2 size={14} class="text-emerald-400" />
            <span>Ses Düzeyi</span>
          </span>
          <span class="font-mono text-emerald-400 font-bold">{Math.round((selectedClip.volume ?? 1) * 100)}%</span>
        </div>
        <input 
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={selectedClip.volume ?? 1}
          oninput={(e) => editor.setClipVolume(selectedClip.id, parseFloat((e.target as HTMLInputElement).value))}
          class="w-full accent-emerald-400 h-1.5 bg-neutral-800 rounded-full appearance-none cursor-pointer"
        />
        <div class="flex justify-end pt-1">
          <button
            onclick={() => editor.openBottomSheet('audio_envelope')}
            class="text-[10px] text-emerald-400 hover:text-emerald-300 font-mono font-medium flex items-center gap-1 transition-colors"
          >
            <span>Akıllı Zarf & Ducking →</span>
          </button>
        </div>
      </div>

      <!-- Playback Speed Card -->
      <div class="spatial-glass-subtle p-3 rounded-2xl border border-white/10 shadow-md space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-neutral-300 font-medium flex items-center gap-1.5">
            <FastForward size={14} class="text-amber-400" />
            <span>Oynatma Hızı</span>
          </span>
          <span class="font-mono text-amber-400 font-bold">{selectedClip.speed ?? 1}x</span>
        </div>
        <div class="grid grid-cols-4 gap-1.5">
          {#each [0.5, 1, 1.5, 2] as spd}
            <button
              onclick={() => editor.setClipSpeed(selectedClip.id, spd)}
              class="py-1.5 text-xs rounded-xl font-mono font-semibold transition-all {(selectedClip.speed ?? 1) === spd && !selectedClip.speedCurve ? 'bg-amber-400 text-neutral-950 shadow-[0_0_12px_rgba(251,191,36,0.35)] font-bold' : 'bg-neutral-950/70 text-neutral-300 border border-white/5 hover:border-white/20'}"
            >
              {spd}x
            </button>
          {/each}
        </div>
        <button
          onclick={() => editor.openBottomSheet('speed_curve')}
          class="w-full py-1.5 mt-1 text-[11px] rounded-xl bg-neutral-950/70 hover:bg-neutral-900 border border-amber-500/30 text-amber-300 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Sliders size={12} />
          <span>Kavisli Hız Eğrisi (Speed Ramping)</span>
        </button>
      </div>

      <!-- AI Neural Suite Card -->
      <div class="spatial-glass-subtle p-3 rounded-2xl border border-white/10 shadow-md space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-neutral-200 font-semibold flex items-center gap-1.5">
            <Sparkles size={14} class="text-purple-400" />
            <span>AI Sinir Ağı İşlemleri</span>
          </span>
          <span class="text-[9px] font-mono text-purple-300 bg-purple-500/20 px-1.5 py-0.2 rounded-full border border-purple-500/30">WebGPU</span>
        </div>
        
        <div class="space-y-1.5 pt-1">
          <button
            onclick={() => aiService.removeBackground(selectedClip.id)}
            class="w-full py-2 px-3 rounded-xl bg-neutral-950/60 hover:bg-neutral-900 border border-white/5 hover:border-purple-500/50 text-neutral-200 flex items-center justify-between transition-all shadow-sm active:scale-98"
          >
            <span class="flex items-center gap-2 text-xs">
              <Layers size={13} class="text-purple-400" />
              <span>Sihirli Arka Plan Kaldırma</span>
            </span>
            {#if selectedClip.isBgRemoved}
              <span class="text-[9px] text-emerald-400 font-bold bg-emerald-400/15 border border-emerald-400/30 px-2 py-0.5 rounded-full">Aktif ✓</span>
            {/if}
          </button>

          <button
            onclick={() => aiService.autoReframe(selectedClip.id)}
            class="w-full py-2 px-3 rounded-xl bg-neutral-950/60 hover:bg-neutral-900 border border-white/5 hover:border-rose-500/50 text-neutral-200 flex items-center justify-between transition-all shadow-sm active:scale-98"
          >
            <span class="flex items-center gap-2 text-xs">
              <Crop size={13} class="text-rose-400" />
              <span>9:16 Akıllı Odak (Auto Reframe)</span>
            </span>
          </button>

          <button
            onclick={() => aiService.generateCaptionsForClip(selectedClip.id)}
            class="w-full py-2 px-3 rounded-xl bg-neutral-950/60 hover:bg-neutral-900 border border-white/5 hover:border-amber-500/50 text-neutral-200 flex items-center gap-2 text-xs transition-all shadow-sm active:scale-98"
          >
            <Sparkles size={13} class="text-amber-400" />
            <span>Otomatik Altyazı (Whisper AI)</span>
          </button>

          <button
            onclick={() => aiService.autoColorEnhance(selectedClip.id)}
            class="w-full py-2 px-3 rounded-xl bg-neutral-950/60 hover:bg-neutral-900 border border-white/5 hover:border-cyan-500/50 text-neutral-200 flex items-center justify-between transition-all shadow-sm active:scale-98"
          >
            <span class="flex items-center gap-2 text-xs">
              <Sparkles size={13} class="text-cyan-400" />
              <span>Sinematik Renk İyileştirme</span>
            </span>
            <span class="text-[9px] text-cyan-300 font-mono bg-cyan-500/15 px-1.5 py-0.5 rounded">Oklab</span>
          </button>

          <button
            onclick={() => aiService.denoiseAudio(selectedClip.id)}
            class="w-full py-2 px-3 rounded-xl bg-neutral-950/60 hover:bg-neutral-900 border border-white/5 hover:border-emerald-500/50 text-neutral-200 flex items-center justify-between transition-all shadow-sm active:scale-98"
          >
            <span class="flex items-center gap-2 text-xs">
              <Volume2 size={13} class="text-emerald-400" />
              <span>Dip Gürültü Temizleme (Denoise)</span>
            </span>
            <span class="text-[9px] text-emerald-300 font-mono bg-emerald-500/15 px-1.5 py-0.5 rounded">Spectral</span>
          </button>
        </div>
      </div>

      <!-- Color Grading & Filter Card -->
      <div class="spatial-glass-subtle p-3 rounded-2xl border border-white/10 shadow-md space-y-2.5">
        <span class="text-xs text-neutral-200 font-semibold flex items-center gap-1.5">
          <Sliders size={14} class="text-cyan-400" />
          <span>Oklab Renk Bilimi & Filtreler</span>
        </span>
        
        <div class="py-2 flex justify-center">
          <OklabColorWheel 
            value={{
              l: selectedClip.colorGrading?.brightness !== undefined ? (selectedClip.colorGrading.brightness + 1) / 2 : 0.7,
              a: selectedClip.colorGrading?.temperature ?? 0,
              b: selectedClip.colorGrading?.tint ?? 0
            }}
            onChange={(val) => {
              editor.updateClip(selectedClip.id, { 
                colorGrading: { 
                  ...(selectedClip.colorGrading || {}), 
                  brightness: (val.l * 2) - 1,
                  temperature: val.a,
                  tint: val.b
                } 
              });
            }}
          />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-[10px]">
            <span class="text-neutral-400">Kontrast</span>
            <span class="font-mono text-cyan-400 font-bold">{(selectedClip.colorGrading?.contrast ?? 1).toFixed(2)}</span>
          </div>
          <input type="range" min="0" max="3" step="0.05" 
            value={selectedClip.colorGrading?.contrast ?? 1}
            oninput={(e) => editor.updateClip(selectedClip.id, { colorGrading: { ...(selectedClip.colorGrading || {}), contrast: parseFloat((e.target as HTMLInputElement).value) } })}
            class="w-full accent-cyan-400 h-1 bg-neutral-800 rounded appearance-none cursor-pointer" />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-[10px]">
            <span class="text-neutral-400">Doygunluk</span>
            <span class="font-mono text-cyan-400 font-bold">{(selectedClip.colorGrading?.saturation ?? 1).toFixed(2)}</span>
          </div>
          <input type="range" min="0" max="3" step="0.05" 
            value={selectedClip.colorGrading?.saturation ?? 1}
            oninput={(e) => editor.updateClip(selectedClip.id, { colorGrading: { ...(selectedClip.colorGrading || {}), saturation: parseFloat((e.target as HTMLInputElement).value) } })}
            class="w-full accent-cyan-400 h-1 bg-neutral-800 rounded appearance-none cursor-pointer" />
        </div>

        <!-- Quick Filters Palette -->
        <div class="space-y-1.5 pt-2 border-t border-white/5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-neutral-400 font-semibold uppercase">Hazır Sinematik LUT</span>
            <button
              onclick={() => editor.openBottomSheet('filters')}
              class="text-[10px] text-purple-400 hover:text-purple-300 font-medium"
            >
              Tümü (9) →
            </button>
          </div>
          <div class="grid grid-cols-2 gap-1.5 text-[10px]">
            <button
              onclick={() => editor.applyFilterToClip(selectedClip.id, 'teal-orange')}
              class="py-1.5 px-2 rounded-xl bg-neutral-950/80 hover:bg-neutral-800 text-neutral-300 border border-white/5 truncate text-left flex items-center gap-1.5"
            >
              <span class="w-2.5 h-2.5 rounded-full bg-orange-400 shadow-[0_0_6px_#fb923c]"></span>
              <span>Teal & Orange</span>
            </button>
            <button
              onclick={() => editor.applyFilterToClip(selectedClip.id, 'cyberpunk-neon')}
              class="py-1.5 px-2 rounded-xl bg-neutral-950/80 hover:bg-neutral-800 text-neutral-300 border border-white/5 truncate text-left flex items-center gap-1.5"
            >
              <span class="w-2.5 h-2.5 rounded-full bg-purple-400 shadow-[0_0_6px_#c084fc]"></span>
              <span>Cyberpunk</span>
            </button>
            <button
              onclick={() => editor.applyFilterToClip(selectedClip.id, 'vintage-90s')}
              class="py-1.5 px-2 rounded-xl bg-neutral-950/80 hover:bg-neutral-800 text-neutral-300 border border-white/5 truncate text-left flex items-center gap-1.5"
            >
              <span class="w-2.5 h-2.5 rounded-full bg-amber-600 shadow-[0_0_6px_#d97706]"></span>
              <span>90s VHS</span>
            </button>
            <button
              onclick={() => editor.applyFilterToClip(selectedClip.id, 'noir-bw')}
              class="py-1.5 px-2 rounded-xl bg-neutral-950/80 hover:bg-neutral-800 text-neutral-300 border border-white/5 truncate text-left flex items-center gap-1.5"
            >
              <span class="w-2.5 h-2.5 rounded-full bg-neutral-400 shadow-[0_0_6px_#a3a3a3]"></span>
              <span>Monochrome</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Clip Edit Actions (Razor Cut & Delete) -->
      <div class="grid grid-cols-2 gap-2 pt-1">
        <button
          onclick={() => editor.splitClipAtPlayhead(selectedClip.id)}
          class="py-2.5 px-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-white/10 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95"
        >
          <Scissors size={14} class="text-sky-400" />
          <span>Klibi Böl (C)</span>
        </button>
        <button
          onclick={() => editor.deleteClip(selectedClip.id)}
          class="py-2.5 px-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95"
        >
          <Trash2 size={14} class="text-rose-400" />
          <span>Klibi Sil (Del)</span>
        </button>
      </div>
    </div>
  {:else}
    <!-- Project Info & Keyboard Shortcuts Guide -->
    <div class="space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-white/10">
        <div class="flex items-center gap-2">
          <Sliders size={14} class="text-neutral-400" />
          <h3 class="text-xs font-semibold text-white uppercase tracking-wider">Proje Özellikleri</h3>
        </div>
        <button 
          onclick={() => {
            if (window.innerWidth < 1280) {
              editor.closeBottomSheet();
            } else {
              appState.toggleInspector();
            }
          }}
          class="xl:hidden text-neutral-500 hover:text-neutral-300 p-1 bg-neutral-900 rounded"
          title="Müfettişi Kapat"
        >
          <X size={14} />
        </button>
      </div>

      <div class="space-y-2 text-xs">
        <div class="flex items-center justify-between bg-neutral-950/50 p-2.5 rounded-lg border border-white/5">
          <span class="text-neutral-400">En-Boy Oranı</span>
          <span class="font-mono text-cyan-400 font-medium">{editor.aspectRatio === 'original' ? 'Orijinal' : editor.aspectRatio}</span>
        </div>
        <div class="flex items-center justify-between bg-neutral-950/50 p-2.5 rounded-lg border border-white/5">
          <span class="text-neutral-400">Çözünürlük</span>
          <span class="font-mono text-neutral-200">
            {editor.aspectRatio === 'original' 
              ? `${editor.originalWidth || 1920} × ${editor.originalHeight || 1080}` 
              : editor.aspectRatio === '9:16' ? '1080 × 1920' 
              : editor.aspectRatio === '16:9' ? '1920 × 1080' 
              : '1080 × 1080'}
          </span>
        </div>
        <div class="flex items-center justify-between bg-neutral-950/50 p-2.5 rounded-lg border border-white/5">
          <span class="text-neutral-400">Kare Hızı (FPS)</span>
          <span class="font-mono text-emerald-400">{editor.projectFps || 30} FPS</span>
        </div>
        <div class="flex items-center justify-between bg-neutral-950/50 p-2.5 rounded-lg border border-white/5">
          <span class="text-neutral-400">Klip Sayısı</span>
          <span class="font-mono text-neutral-300">{editor.tracks.reduce((acc, t) => acc + t.clips.length, 0)}</span>
        </div>
      </div>

      <!-- Quick Project Actions -->
      <div class="space-y-1.5 pt-2">
        <button
          onclick={() => editor.isSettingsModalOpen = true}
          class="w-full py-2 px-3 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-neutral-200 border border-white/10 text-xs font-medium flex items-center justify-between transition-colors shadow-sm cursor-pointer"
        >
          <span class="flex items-center gap-2">
            <Sliders size={13} class="text-blue-400" />
            Detaylı Stüdyo Ayarları
          </span>
          <span class="text-[10px] text-neutral-500">2026 Pro →</span>
        </button>

        <button
          onclick={() => aiService.generateViralHooks()}
          disabled={aiService.isRunning}
          class="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-pink-950/40 to-purple-950/40 hover:from-pink-900/50 hover:to-purple-900/50 text-pink-300 border border-pink-500/20 text-xs font-medium flex items-center justify-between transition-colors shadow-sm cursor-pointer disabled:opacity-50"
        >
          <span class="flex items-center gap-2">
            <Sparkles size={13} class="text-pink-400" />
            AI Viral Kanca & Senaryo
          </span>
          <span class="text-[10px] text-pink-400 font-mono">Copilot</span>
        </button>
      </div>

      <!-- NLE Keyboard Shortcuts Reference -->
      <div class="pt-3 border-t border-white/5 space-y-2">
        <div class="flex items-center gap-1.5 text-neutral-400">
          <HelpCircle size={13} />
          <span class="text-[11px] font-medium uppercase tracking-wider">Pro Kısayollar</span>
        </div>

        <div class="space-y-1.5 text-[11px]">
          <div class="flex items-center justify-between py-1 border-b border-white/5">
            <span class="text-neutral-400">Oynat / Durdur</span>
            <kbd class="px-1.5 py-0.5 bg-neutral-900 border border-white/10 rounded font-mono text-neutral-300 shadow-sm">Space</kbd>
          </div>
          <div class="flex items-center justify-between py-1 border-b border-white/5">
            <span class="text-neutral-400">Kare Kare İleri/Geri</span>
            <div class="flex gap-1">
              <kbd class="px-1 py-0.5 bg-neutral-900 border border-white/10 rounded font-mono text-neutral-300 shadow-sm">J</kbd>
              <kbd class="px-1 py-0.5 bg-neutral-900 border border-white/10 rounded font-mono text-neutral-300 shadow-sm">K</kbd>
              <kbd class="px-1 py-0.5 bg-neutral-900 border border-white/10 rounded font-mono text-neutral-300 shadow-sm">L</kbd>
            </div>
          </div>
          <div class="flex items-center justify-between py-1 border-b border-white/5">
            <span class="text-neutral-400">Böl (Kesici)</span>
            <kbd class="px-1.5 py-0.5 bg-neutral-900 border border-white/10 rounded font-mono text-neutral-300 shadow-sm">C</kbd>
          </div>
          <div class="flex items-center justify-between py-1 border-b border-white/5">
            <span class="text-neutral-400">Klibi Sil</span>
            <kbd class="px-1.5 py-0.5 bg-neutral-900 border border-white/10 rounded font-mono text-neutral-300 shadow-sm">Del</kbd>
          </div>
        </div>
      </div>
    </div>
  {/if}
</aside>
