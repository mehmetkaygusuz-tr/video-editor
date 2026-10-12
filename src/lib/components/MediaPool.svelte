<script lang="ts">
  import { editor } from '../editor.svelte';
  import { engine } from '../engine/orchestrator.svelte';
  import { saveFileToOPFS } from '../opfs';
  import { Plus, Film, Music, Image as ImageIcon, Upload, Wand2, Trash2 } from '@lucide/svelte';

  let fileInput = $state<HTMLInputElement>();

  async function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    for (let i = 0; i < target.files.length; i++) {
      const file = target.files[i];
      let type: 'video' | 'audio' | 'image' = 'video';
      if (file.type.startsWith('audio/')) type = 'audio';
      if (file.type.startsWith('image/')) type = 'image';

      // Save to OPFS
      try {
        const handle = await saveFileToOPFS(file, file.name);
        const blobUrl = URL.createObjectURL(file);
        const asset = editor.addAsset(file.name, type, handle, undefined, blobUrl);
        editor.setCachedFile(file.name, file);
        editor.announce(`Medya yüklendi: ${file.name}`);

        // Detect native aspect ratio and dimensions for 'original' mode
        if (type === 'video') {
          const v = document.createElement('video');
          v.preload = 'metadata';
          v.src = blobUrl;
          const cleanup = () => {
            v.onloadedmetadata = null;
            v.onerror = null;
            v.removeAttribute('src');
            v.load();
          };
          v.onloadedmetadata = () => {
            if (v.videoWidth && v.videoHeight) {
              editor.originalWidth = v.videoWidth;
              editor.originalHeight = v.videoHeight;
              if (v.duration && !isNaN(v.duration)) {
                asset.duration = v.duration;
              }
            }
            cleanup();
          };
          v.onerror = () => {
            cleanup();
          };
        } else if (type === 'image') {
          const img = new Image();
          img.src = blobUrl;
          img.onload = () => {
            if (img.naturalWidth && img.naturalHeight) {
              editor.originalWidth = img.naturalWidth;
              editor.originalHeight = img.naturalHeight;
            }
          };
        }
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
    const startAt = editor.playhead;

    if (asset.type === 'video') {
      // Find or create V1 video track
      let vTrack = editor.tracks.find(t => t.name === 'V1' || t.name.startsWith('V'));
      if (!vTrack) {
        editor.addTrack('V1');
        vTrack = editor.tracks[editor.tracks.length - 1];
      }

      // Add Video Clip to V1
      editor.addClip(
        vTrack.id,
        asset.name,
        startAt,
        duration,
        asset.color || '#2563eb',
        asset.id,
        { type: 'video' }
      );

      // Find or create A1 audio track for the video's audio channel
      let aTrack = editor.tracks.find(t => t.name === 'A1' || t.name.startsWith('A'));
      if (!aTrack) {
        editor.addTrack('A1');
        aTrack = editor.tracks[editor.tracks.length - 1];
      }

      // Add linked Audio Clip to A1
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
      // Audio or Image
      let targetTrack = editor.tracks.find(t => asset.type === 'audio' ? t.name.startsWith('A') : t.name.startsWith('V'));
      if (!targetTrack && editor.tracks.length > 0) {
        targetTrack = editor.tracks[0];
      }
      if (!targetTrack) {
        const trackName = asset.type === 'audio' ? 'A1' : 'V1';
        editor.addTrack(trackName);
        targetTrack = editor.tracks[editor.tracks.length - 1];
      }

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
    if (asset.blobUrl) {
      try { URL.revokeObjectURL(asset.blobUrl); } catch (_) {}
    }
    engine.removeAsset(asset.name);
    editor.deleteAsset(asset.id);
  }
</script>

<div class="w-full h-full bg-neutral-900 border-r border-neutral-800 flex flex-col shrink-0" role="region" aria-label="Medya Havuzu">
  <!-- Header -->
  <div class="h-12 border-b border-neutral-800 flex items-center justify-between px-4">
    <span class="text-sm font-semibold text-neutral-200">Medya Havuzu</span>
    <button 
      class="h-7 px-2.5 rounded bg-neutral-800 hover:bg-neutral-700 flex items-center gap-1.5 text-xs text-neutral-300 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
      onclick={() => fileInput?.click()}
      aria-label="Cihazdan Medya İçe Aktar"
      title="Medya Yükle (Video, Ses, Resim)"
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

  <!-- Asset List -->
  <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-2" role="list" aria-label="Yüklenen Medyalar">
    {#if editor.assets.length === 0}
      <div class="flex-1 flex items-center justify-center text-center p-4">
        <p class="text-xs text-neutral-500">Henüz medya yüklenmedi. Dosya seçmek için yukarıdaki Yükle butonuna tıklayın.</p>
      </div>
    {/if}

    {#each editor.assets as asset (asset.id)}
      <div 
        role="listitem"
        class="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-600 rounded-lg p-2.5 flex items-center gap-3 cursor-grab active:cursor-grabbing transition-all focus-within:ring-2 focus-within:ring-blue-500 focus-within:outline-none group"
        draggable="true"
        ondragstart={(e) => handleDragStart(e, asset.id)}
      >
        <div class="w-10 h-10 rounded shrink-0 flex items-center justify-center" style="background-color: {asset.color}40; border: 1px solid {asset.color}80">
           {#if asset.type === 'video'}
             <Film size={18} style="color: {asset.color}" />
           {:else if asset.type === 'audio'}
             <Music size={18} style="color: {asset.color}" />
           {:else}
             <ImageIcon size={18} style="color: {asset.color}" />
           {/if}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium text-neutral-200 truncate">{asset.name}</p>
          <p class="text-[10px] text-neutral-500 uppercase font-mono tracking-wider">{asset.type}</p>
        </div>
        <div class="flex items-center gap-1">
          <button
            onclick={() => addAssetToTimeline(asset.id)}
            class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 p-1.5 rounded-md bg-neutral-800 hover:bg-blue-600 text-neutral-300 hover:text-white transition-all focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
            title="Zaman Çizelgesine Ekle (Oynatma Kafasında)"
            aria-label="{asset.name} klibini oynatma kafasına ekle"
          >
            <Plus size={14} />
          </button>
          <button
            onclick={() => handleDeleteAsset(asset)}
            class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 p-1.5 rounded-md bg-neutral-800 hover:bg-rose-600 text-neutral-400 hover:text-white transition-all focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
            title="Medyayı Sil"
            aria-label="{asset.name} medyasını sil"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    {/each}
  </div>
</div>
