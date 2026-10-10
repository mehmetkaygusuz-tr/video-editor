<script lang="ts">
  import { appState } from '../appState.svelte';

  let step = $state(1);

  function selectMode(mode: 'basic' | 'pro') {
    appState.completeOnboarding(mode);
  }

  function skip() {
    appState.completeOnboarding('basic');
  }
</script>

<div class="fixed inset-0 bg-neutral-950 flex flex-col items-center justify-center p-6 text-white font-sans z-50">
  {#if step === 1}
    <div class="max-w-md w-full bg-neutral-900 rounded-3xl p-8 shadow-2xl border border-neutral-800 animate-in fade-in zoom-in duration-500">
      <div class="flex justify-between items-center mb-8">
        <h2 class="text-2xl font-bold">Hoş Geldin! 👋</h2>
        <button onclick={skip} class="text-sm font-medium text-neutral-500 hover:text-white transition-colors">Geç</button>
      </div>
      
      <p class="text-neutral-400 mb-8 leading-relaxed">
        Sana en uygun deneyimi sunabilmemiz için nasıl bir editör aradığını seç. (Daha sonra değiştirebilirsin.)
      </p>

      <div class="space-y-4">
        <button 
          onclick={() => selectMode('basic')}
          class="w-full text-left p-5 rounded-2xl bg-neutral-800/50 hover:bg-neutral-800 border border-neutral-700/50 hover:border-blue-500/50 transition-all group">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
              ⚡
            </div>
            <div>
              <h3 class="font-bold text-lg text-white mb-1">Hızlı ve Basit (Basic)</h3>
              <p class="text-sm text-neutral-500">Yapay zeka ritmi bulsun, efektleri eklesin. Sen sadece izle.</p>
            </div>
          </div>
        </button>

        <button 
          onclick={() => selectMode('pro')}
          class="w-full text-left p-5 rounded-2xl bg-neutral-800/50 hover:bg-neutral-800 border border-neutral-700/50 hover:border-purple-500/50 transition-all group">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
              🎛️
            </div>
            <div>
              <h3 class="font-bold text-lg text-white mb-1">Profesyonel (Pro)</h3>
              <p class="text-sm text-neutral-500">Çoklu katman, keyframe'ler ve tam kontrol sende olsun.</p>
            </div>
          </div>
        </button>
      </div>
    </div>
  {/if}
</div>
