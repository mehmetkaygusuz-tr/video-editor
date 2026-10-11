import { untrack } from 'svelte';
import type { 
  EditorState, TimelineTrack, TimelineClip, Asset, BeatMarker, 
  TransitionType, SubtitleStyle, SubtitlePresetStyle,
  SpeedCurveConfig, SpeedCurvePreset, AudioEnvelopeConfig,
  ScrubbingMode, DecoderTelemetry, AudioClockTelemetry, GpuTelemetry, AgentTelemetry,
  AppSettingsConfig, ThemeId, TrackType, AspectRatio
} from './types';
import { get, set } from 'idb-keyval';
import { getFileFromOPFS, deleteFileFromOPFS } from './opfs';
import { MAGIC_TEMPLATES } from './templates';
import { FILTER_PRESETS } from './filters';
import { detectAudioBeats } from './audio';
import { masterAudioClock } from './engine/audioClock';
import { quantizeToFrame, formatSMPTETimecode, DEFAULT_PROJECT_FPS } from './engine/timeline/timecode';

export const DEFAULT_APP_SETTINGS: AppSettingsConfig = {
  theme: 'obsidian',
  resolutionPreset: '1080p',
  canvasWidth: 1920,
  canvasHeight: 1080,
  fps: 30,
  colorSpace: 'srgb',
  hardwareAcceleration: true,
  modelPrecision: 'fp32',
  audioSampleRate: 48000,
  offlineMode: false,
  hapticFeedback: true,
  autoSaveIntervalSec: 60,
  magneticSnapping: true,
  snapThresholdPx: 8
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  preset: 'tiktok-bold',
  fontSize: 28,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  textColor: '#ffffff',
  highlightColor: '#fde047', // Yellow karaoke highlight
  backgroundColor: 'rgba(0, 0, 0, 0.75)',
  strokeColor: '#000000',
  strokeWidth: 3,
  positionY: 82, // 82% from top
  animation: 'pop'
};

class VideoEditor {
  isHydrated = $state(false);
  tracks = $state<TimelineTrack[]>([]);
  assets = $state<Asset[]>([]);
  playhead = $state(0);
  duration = $state(10); // Dynamic timeline duration initialized to 10s
  isPlaying = $state(false);
  projectFps = $state(DEFAULT_PROJECT_FPS); // SMPTE standard (30 fps)
  
  get smpteTimecode(): string {
    return formatSMPTETimecode(this.playhead, this.projectFps);
  }

  zoom = $state(40); // pixels per second (scale factor)
  scrollX = $state(0); // viewport scroll offset in pixels
  scrollY = $state(0); 
  selectedClipId = $state<string | null>(null);
  announcement = $state<string>('');
  activeSidebarTab = $state<'media' | 'ai' | 'captions' | 'templates' | 'filters'>('media');
  mobileWorkspace = $state<'timeline' | 'media' | 'ai' | 'captions' | 'templates' | 'filters'>('timeline');
  activeBottomSheet = $state<'media' | 'ai' | 'captions' | 'templates' | 'transitions' | 'subtitle_style' | 'speed_curve' | 'audio_envelope' | 'filters' | 'settings' | null>(null);
  activeTransitionCut = $state<{ trackId: string; prevClipId: string; nextClipId: string } | null>(null);
  aspectRatio = $state<AspectRatio>('original');
  originalWidth = $state<number>(1920);
  originalHeight = $state<number>(1080);
  isCommandPaletteOpen = $state<boolean>(false);
  isSettingsModalOpen = $state<boolean>(false);
  settings = $state<AppSettingsConfig>({ ...DEFAULT_APP_SETTINGS });
  activeTheme = $state<ThemeId>('obsidian');
  


  isTimelineCollapsed = $state(false);
  isBottomPanelExpanded = $state(false);
  isExportOpen = $state(false);

  // Step 1: GOP-Aware Two-Tier Scrubbing & Decoder Telemetry
  scrubbingMode = $state<ScrubbingMode>('adaptive');
  isScrubbing = $state(false);
  decoderTelemetry = $state<DecoderTelemetry>({
    lastPTS: 0,
    isKeyframe: false,
    mode: 'idle',
    decodeDurationMs: 0,
    keyframeCount: 0,
    cachedKeyframes: 0,
    renderFps: 0
  });

  updateDecoderTelemetry(telemetry: DecoderTelemetry) {
    this.decoderTelemetry = telemetry;
  }

  // Step 2: Master Audio Clock & A/V Sync Telemetry
  audioClockTelemetry = $state<AudioClockTelemetry>({
    currentTime: 0,
    baseLatency: 0,
    outputLatency: 0,
    totalLatency: 0,
    driftMs: 0,
    isPlaying: false,
    activeSources: 0
  });

  updateAudioClockTelemetry(telemetry: AudioClockTelemetry) {
    this.audioClockTelemetry = telemetry;
  }

  // Step 3: WebGPU Dual-Texture Hardware Transitions Telemetry
  gpuTelemetry = $state<GpuTelemetry>({
    isHardwareAccelerated: false,
    isDualTexturePass: false,
    activeTransition: null,
    pipelineStatus: 'initializing'
  });

  updateGpuTelemetry(telemetry: Partial<GpuTelemetry>) {
    this.gpuTelemetry = { ...untrack(() => this.gpuTelemetry), ...telemetry };
  }

  // Step 8: Agentic AI Orchestration & Multi-Track Natural Language Telemetry
  agentTelemetry = $state<AgentTelemetry>({
    lastAction: null,
    lastIntentPrompt: '',
    confidence: 0,
    status: 'idle',
    executionTimeMs: 0,
    activeModel: null
  });

  updateAgentTelemetry(telemetry: Partial<AgentTelemetry>) {
    this.agentTelemetry = { ...this.agentTelemetry, ...telemetry };
  }

  setScrubbingMode(mode: ScrubbingMode) {
    this.scrubbingMode = mode;
    this.triggerHaptic('light');
    const labels = {
      adaptive: 'Uyarlamalı GOP (Akıllı İki Kademeli)',
      fast_keyframe: 'Hızlı I-Frame (Sıfır Gecikme)',
      exact: 'Kusursuz Tam Kare (Her Kareyi Çöz)'
    };
    this.announce(`Tarama modu: ${labels[mode]}`);
  }
  
  // Real-time Subtitle Typography & Karaoke Styling
  globalSubtitleStyle = $state<SubtitleStyle>({ ...DEFAULT_SUBTITLE_STYLE });
  activeSubtitleId = $state<string | null>(null);

  // Magnetic / Ripple Editing & Beat Markers
  isMagnetic = $state(true);
  snapToBeat = $state(true);
  beatMarkers = $state<BeatMarker[]>([]);
  activeBpm = $state<number | null>(null);
  isProcessing = $state(false);

  // History for Undo/Redo
  #history: TimelineTrack[][] = [];
  #historyIndex = $state(-1);
  #isUndoing = false;

  get canUndo(): boolean {
    return this.#historyIndex > 0;
  }

  get canRedo(): boolean {
    return this.#historyIndex < this.#history.length - 1;
  }

  triggerHaptic(type: 'light' | 'medium' | 'heavy' = 'light') {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        if (type === 'light') navigator.vibrate(10);
        else if (type === 'medium') navigator.vibrate(25);
        else if (type === 'heavy') navigator.vibrate([40, 25, 40]);
      } catch {
        // Platform or browser policy restriction
      }
    }
  }

  openBottomSheet(tab: 'media' | 'ai' | 'captions' | 'templates' | 'transitions' | 'subtitle_style' | 'speed_curve' | 'audio_envelope' | 'filters' | 'settings') {
    this.activeBottomSheet = tab;
    if (tab !== 'transitions' && tab !== 'subtitle_style' && tab !== 'speed_curve' && tab !== 'audio_envelope' && tab !== 'filters' && tab !== 'settings') {
      this.activeSidebarTab = tab;
    }
    this.triggerHaptic('light');
  }

  applyFilterToClip(clipId: string, filterId: string) {
    const filter = FILTER_PRESETS.find(f => f.id === filterId);
    if (!filter) return;
    this.updateClip(clipId, {
      colorGrading: { ...filter.grading }
    });
    this.saveState();
    this.announce(`"${filter.name}" filtresi klibe uygulandı.`);
    this.triggerHaptic('light');
  }

  applyFilterToAllClips(filterId: string) {
    const filter = FILTER_PRESETS.find(f => f.id === filterId);
    if (!filter) return;
    for (const track of this.tracks) {
      for (const clip of track.clips) {
        if (clip.type !== 'audio' && clip.type !== 'text') {
          clip.colorGrading = { ...filter.grading };
        }
      }
    }
    this.saveState();
    this.announce(`"${filter.name}" filtresi tüm video kliplerine uygulandı.`);
    this.triggerHaptic('medium');
  }

  setTheme(theme: ThemeId) {
    this.activeTheme = theme;
    this.settings.theme = theme;
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    this.announce(`Tema değiştirildi: ${theme}`);
    this.triggerHaptic('light');
  }

  updateSettings(partial: Partial<AppSettingsConfig>) {
    this.settings = { ...this.settings, ...partial };
    if (partial.fps !== undefined) {
      this.projectFps = partial.fps;
    }
    if (partial.theme !== undefined) {
      this.setTheme(partial.theme);
    }
    if (partial.resolutionPreset !== undefined) {
      if (partial.resolutionPreset === '4k') {
        this.originalWidth = 3840;
        this.originalHeight = 2160;
        this.aspectRatio = '16:9';
      } else if (partial.resolutionPreset === '1080p') {
        this.originalWidth = 1920;
        this.originalHeight = 1080;
        this.aspectRatio = '16:9';
      } else if (partial.resolutionPreset === '720p') {
        this.originalWidth = 1280;
        this.originalHeight = 720;
        this.aspectRatio = '16:9';
      } else if (partial.resolutionPreset === 'shorts_9_16') {
        this.originalWidth = 1080;
        this.originalHeight = 1920;
        this.aspectRatio = '9:16';
      } else if (partial.resolutionPreset === 'square_1_1') {
        this.originalWidth = 1080;
        this.originalHeight = 1080;
        this.aspectRatio = '1:1';
      } else if (partial.resolutionPreset === 'portrait_4_5') {
        this.originalWidth = 1080;
        this.originalHeight = 1350;
        this.aspectRatio = 'original';
      }
    }
    this.saveState();
  }

  openTransitionPicker(trackId: string, prevClipId: string, nextClipId: string) {
    this.activeTransitionCut = { trackId, prevClipId, nextClipId };
    this.openBottomSheet('transitions');
    this.triggerHaptic('medium');
  }

  closeBottomSheet() {
    this.activeBottomSheet = null;
  }

  announce(message: string) {
    this.announcement = message;
  }

  constructor() {
    this.initPersistence();
  }

  async initPersistence() {
    try {
      const data = await get('toolx_project_state');
      if (data) {
        if (Array.isArray(data.tracks) && data.tracks.length > 0) {
          this.tracks = data.tracks;
        } else {
          this.tracks = [];
        }
        this.assets = Array.isArray(data.assets) ? data.assets : [];
        
        // Deterministically restore blob URLs for assets & clips from OPFS
        const newUrls = new Map<string, string>();
        for (const asset of this.assets) {
          try {
            const file = await getFileFromOPFS(asset.name);
            if (file) {
              const url = URL.createObjectURL(file);
              asset.blobUrl = url;
              newUrls.set(asset.id, url);
            }
          } catch (e) {
            console.warn(`Could not restore OPFS file for ${asset.name}:`, e);
          }
        }
        for (const track of this.tracks) {
          for (const clip of track.clips) {
            if (clip.assetId && newUrls.has(clip.assetId)) {
              clip.sourceUrl = newUrls.get(clip.assetId)!;
            }
          }
        }
      } else {
        this.tracks = [];
        this.assets = [];
      }
    } catch (e) {
      console.warn('Failed to restore persistence state:', e);
      if (!this.tracks) {
        this.tracks = [];
      }
    } finally {
      this.isHydrated = true;
      this.saveState();
    }
  }

  async persistToIDB() {
    if (!this.isHydrated) return;
    // Save to IDB immediately (skip proxy state serialization issues by cloning)
    try {
      await set('toolx_project_state', {
        tracks: $state.snapshot(this.tracks),
        assets: $state.snapshot(this.assets)
      });
    } catch (e) {
      console.warn('Failed to persist to IDB', e);
    }
  }

  loadInitialSampleProject() {
    // This function is kept for testing or future onboarding scenarios
    // but should not be called automatically on constructor.
  }

  ensureSampleVideoClip(): TimelineClip {
    let vTrack = this.tracks.find(t => t.name === 'V1' || t.name.startsWith('V'));
    if (!vTrack) {
      this.addTrack('V1');
      vTrack = this.tracks[0];
    }
    const existing = vTrack.clips.find(c => c.type !== 'audio' && c.type !== 'text');
    if (existing) return existing;

    const asset = this.addAsset('Örnek Video Klibi (1080p).mp4', 'video', null, 10);
    this.addClip(vTrack.id, asset.name, 0, 10, '#3b82f6', asset.id, { type: 'video' });
    const newClip = vTrack.clips[vTrack.clips.length - 1];
    this.selectedClipId = newClip.id;
    return newClip;
  }

  ensureSampleAudioClip(): TimelineClip {
    let aTrack = this.tracks.find(t => t.name === 'A1' || t.name.startsWith('A'));
    if (!aTrack) {
      this.addTrack('A1');
      aTrack = this.tracks[this.tracks.length - 1];
    }
    const existing = aTrack.clips.find(c => c.type === 'audio' || c.name.toLowerCase().includes('mp3') || c.name.toLowerCase().includes('müzik'));
    if (existing) return existing;

    const asset = this.addAsset('Örnek Ritim Müziği (128 BPM).mp3', 'audio', null, 16);
    this.addClip(aTrack.id, asset.name, 0, 16, '#10b981', asset.id, { type: 'audio' });
    return aTrack.clips[aTrack.clips.length - 1];
  }

  saveState() {
    if (!this.isHydrated) return;
    if (this.#isUndoing) return;
    
    // Discard future history if we're branching
    if (this.#historyIndex < this.#history.length - 1) {
      this.#history = this.#history.slice(0, this.#historyIndex + 1);
    }
    
    // Use structured clone for history (prevents JSON parse/stringify overhead and mobile GC bloat)
    const snapshot = structuredClone($state.snapshot(this.tracks));
    this.#history.push(snapshot);
    this.persistToIDB();
    if (this.#history.length > 25) {
      this.#history.shift();
    } else {
      this.#historyIndex++;
    }
  }

  undo() {
    if (this.#historyIndex > 0) {
      this.#isUndoing = true;
      this.#historyIndex--;
      const snapshot = structuredClone(this.#history[this.#historyIndex]);
      this.tracks = snapshot;
      this.announce('İşlem geri alındı.');
      this.triggerHaptic('light');
      
      // Allow DOM to update before we re-enable saves
      setTimeout(() => {
        this.#isUndoing = false;
      }, 0);
    }
  }

  redo() {
    if (this.#historyIndex < this.#history.length - 1) {
      this.#isUndoing = true;
      this.#historyIndex++;
      const snapshot = structuredClone(this.#history[this.#historyIndex]);
      this.tracks = snapshot;
      this.announce('İşlem yinelendi.');
      this.triggerHaptic('light');
      
      setTimeout(() => {
        this.#isUndoing = false;
      }, 0);
    }
  }

  #fileCache = new Map<string, File>();

  setCachedFile(name: string, file: File) {
    this.#fileCache.set(name, file);
  }

  getCachedFile(name: string): File | undefined {
    return this.#fileCache.get(name);
  }

  addAsset(name: string, type: 'video' | 'audio' | 'image', fileHandle?: FileSystemFileHandle | null, duration?: number, blobUrl?: string) {
    const colors = {
      'video': '#2563eb',
      'audio': '#10b981',
      'image': '#eab308'
    };
    const asset: Asset = {
      id: crypto.randomUUID(),
      name,
      type,
      duration,
      fileHandle,
      color: colors[type],
      blobUrl
    };
    this.assets.push(asset);
    this.persistToIDB();
    return asset;
  }

  async deleteAsset(assetId: string) {
    const assetIndex = this.assets.findIndex(a => a.id === assetId);
    if (assetIndex === -1) return;

    const asset = this.assets[assetIndex];

    // 1. WHATWG File API: Revoke blob URL to prevent memory leaks
    if (asset.blobUrl) {
      try {
        URL.revokeObjectURL(asset.blobUrl);
      } catch (e) {
        console.warn('Could not revoke blob URL:', e);
      }
    }

    // 2. W3C File System Access API: Physical file removal from OPFS
    try {
      await deleteFileFromOPFS(asset.name);
    } catch (e) {
      console.warn('Could not delete OPFS file:', e);
    }

    // 3. Cascade timeline cleanup: remove any clips linked to this asset
    for (const track of this.tracks) {
      track.clips = track.clips.filter(clip => {
        if (clip.assetId === assetId) {
          if (this.selectedClipId === clip.id) {
            this.selectedClipId = null;
          }
          return false;
        }
        return true;
      });
    }

    // 4. Remove asset from store
    this.assets.splice(assetIndex, 1);

    // 5. Announce and persist clean state
    this.announce(`"${asset.name}" silindi.`);
    this.triggerHaptic('medium');
    this.saveState();
  }

  addTrack(name: string, type?: TrackType): TimelineTrack {
    let resolvedType: TrackType = type || (
      name.startsWith('V') ? 'video' :
      name.startsWith('T') || name.toLowerCase().includes('altyazı') || name.toLowerCase().includes('metin') ? 'subtitle' :
      name.startsWith('FX') || name.toLowerCase().includes('efekt') ? 'effect' :
      name.startsWith('A') || name.toLowerCase().includes('ses') || name.toLowerCase().includes('müzik') ? 'audio' :
      'video'
    );

    const newTrack: TimelineTrack = {
      id: crypto.randomUUID(),
      name,
      type: resolvedType,
      clips: []
    };

    // Logical hierarchy ordering: Video -> Subtitle -> Effect -> Audio
    const typePriority: Record<TrackType, number> = {
      video: 1,
      subtitle: 2,
      effect: 3,
      audio: 4
    };

    const targetPriority = typePriority[resolvedType] || 2;
    let insertIndex = this.tracks.length;
    for (let i = 0; i < this.tracks.length; i++) {
      const curPriority = typePriority[this.tracks[i].type || 'video'] || 1;
      if (targetPriority < curPriority) {
        insertIndex = i;
        break;
      }
    }

    this.tracks.splice(insertIndex, 0, newTrack);
    this.saveState();
    return newTrack;
  }

  deleteTrack(trackId: string) {
    const idx = this.tracks.findIndex(t => t.id === trackId);
    if (idx !== -1) {
      this.tracks.splice(idx, 1);
      this.saveState();
      this.announce('Kanal silindi.');
      this.triggerHaptic('medium');
    }
  }

  async applyMagicTemplate(templateId: string, audioAssetId: string, videoAssetIds: string[]) {
    const template = MAGIC_TEMPLATES.find(t => t.id === templateId);
    const audioAsset = this.assets.find(a => a.id === audioAssetId);
    if (!template || !audioAsset) return;

    this.announce(`"${template.name}" şablonu ritimlere hizalanıyor...`);
    this.isProcessing = true;

    try {
      // Fetch Audio File
      let audioFile: File | null = null;
      if (audioAsset.fileHandle) {
        audioFile = await audioAsset.fileHandle.getFile();
      } else {
        audioFile = await getFileFromOPFS(audioAsset.name);
      }

      if (!audioFile && audioAsset.blobUrl) {
        try {
          const resp = await fetch(audioAsset.blobUrl);
          const blob = await resp.blob();
          audioFile = new File([blob], audioAsset.name || 'audio.wav', { type: blob.type || 'audio/wav' });
        } catch (e) {
          console.warn("Failed to fetch audio from blobUrl", e);
        }
      }
      
      if (!audioFile) {
        this.announce("Ses dosyası bulunamadı.");
        return;
      }

      // Detect Beats via Spectral Flux
      let { bpm, beats } = await detectAudioBeats(audioFile);
      if (beats.length === 0) {
        bpm = template.targetBpm || 120;
        const beatInterval = 60 / bpm;
        const totalDuration = audioAsset.duration || 30;
        beats = [];
        for (let t = 0; t <= totalDuration; t += beatInterval) {
          beats.push(Number(t.toFixed(3)));
        }
      }

      this.activeBpm = bpm;
      this.beatMarkers = beats.map((time, idx) => ({
        id: crypto.randomUUID(),
        time,
        intensity: idx % 4 === 0 ? 1.0 : 0.6
      }));

      // Apply template aspect ratio preference
      if (template.aspectRatioPreference) {
        this.aspectRatio = template.aspectRatioPreference;
      }

      // Clear existing tracks
      this.tracks = [];
      const vTrack = this.addTrack('V1', 'video');
      const aTrack = this.addTrack('A1', 'audio');

      // Add full audio to A1
      this.addClip(aTrack.id, audioAsset.name, 0, audioAsset.duration || 60, audioAsset.color, audioAsset.id, { type: 'audio' });

      // Apply video clips matching template rhythm
      if (videoAssetIds.length > 0) {
        let slotIndex = 0;
        let currentBeatIndex = 0;
        let videoIndex = 0;

        while (currentBeatIndex < beats.length - 1) {
          const slot = template.slots[slotIndex % template.slots.length];
          const startTime = beats[currentBeatIndex];
          let endTimeIndex = currentBeatIndex + Math.max(1, Math.round(slot.durationBeats));
          
          if (endTimeIndex >= beats.length) {
            endTimeIndex = beats.length - 1;
          }
          
          const duration = beats[endTimeIndex] - startTime;
          if (duration <= 0) {
             currentBeatIndex++;
             continue;
          }

          const vAssetId = videoAssetIds[videoIndex % videoAssetIds.length];
          const vAsset = this.assets.find(a => a.id === vAssetId);
          
          if (vAsset) {
            const clipOptions: Partial<TimelineClip> = { 
              type: 'video', 
              sourceOffset: 0 
            };
            if (slot.suggestedTransition && slot.suggestedTransition !== 'none') {
              clipOptions.transitionIn = {
                type: slot.suggestedTransition,
                duration: 0.4
              };
            }
            this.addClip('V1', vAsset.name, startTime, duration, vAsset.color, vAsset.id, clipOptions);
          }
          
          currentBeatIndex = endTimeIndex;
          slotIndex++;
          videoIndex++;
        }
      }

      // Apply default filter if defined
      if (template.defaultFilter) {
        this.applyFilterToAllClips(template.defaultFilter);
      }

      this.announce(`"${template.name}" şablonu ${bpm} BPM hızında başarıyla uygulandı!`);
    } catch (e) {
      console.error(e);
      this.announce("Şablon uygulanırken bir hata oluştu.");
    } finally {
      this.isProcessing = false;
      this.saveState();
    }
  }

  addClip(
    trackId: string, 
    name: string, 
    startAt: number, 
    duration: number, 
    color: string = '#3b82f6', 
    assetId?: string,
    options?: Partial<TimelineClip>
  ) {
    const track = this.tracks.find(t => t.id === trackId);
    if (track) {
      if (track.isLocked) {
        this.announce('Kilitli ize klip eklenemez.');
        return;
      }
      const asset = assetId ? this.assets.find(a => a.id === assetId) : undefined;
      const resolvedType = options?.type || asset?.type || (track.name.startsWith('A') ? 'audio' : 'video');
      let sourceUrl = options?.sourceUrl || asset?.blobUrl || '';
      
      const quantizedStart = quantizeToFrame(startAt, this.projectFps);
      let quantizedDuration = Math.max(quantizeToFrame(0.1, this.projectFps), quantizeToFrame(duration, this.projectFps));
      const sourceOffset = options?.sourceOffset ? quantizeToFrame(options.sourceOffset, this.projectFps) : 0;

      if (asset && asset.duration && asset.duration > 0) {
        const maxAllowed = Math.max(0.1, asset.duration - sourceOffset);
        if (quantizedDuration > maxAllowed) {
          quantizedDuration = maxAllowed;
        }
      }

      const newClip: TimelineClip = {
        id: crypto.randomUUID(),
        trackId,
        assetId,
        sourceUrl,
        name,
        startAt: quantizedStart,
        duration: quantizedDuration,
        sourceOffset,
        color,
        parentClipId: options?.parentClipId,
        anchorOffset: options?.anchorOffset,
        type: resolvedType,
        cropRect: options?.cropRect,
        isBgRemoved: options?.isBgRemoved,
        volume: options?.volume ?? 1.0,
        speed: options?.speed ?? 1.0
      };

      // If sourceUrl is missing, attempt OPFS restore in background
      if (!sourceUrl && name) {
        getFileFromOPFS(name).then(file => {
          if (file) {
            const url = URL.createObjectURL(file);
            newClip.sourceUrl = url;
            if (asset && !asset.blobUrl) asset.blobUrl = url;
          }
        }).catch(() => {});
      }

      // Modül 5: Manyetik Insert (Yalnızca aynı izdeki klipleri öteler, diğer bağımsız ses/video izlerini bozmaz)
      if (this.isMagnetic) {
        for (const c of track.clips) {
          if (c.startAt >= quantizedStart) {
            c.startAt = quantizeToFrame(c.startAt + quantizedDuration, this.projectFps);
          }
        }
      }
      track.clips.push(newClip);
      this.saveState();
      return newClip;
    }
  }

  updateClip(clipId: string, partial: Partial<TimelineClip>) {
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        Object.assign(clip, partial);
        this.saveState();
        break;
      }
    }
  }

  updateClipPosition(clipId: string, newStartAt: number, newTrackId?: string, save: boolean = true) {
    let targetClip: TimelineClip | undefined;
    let oldTrack: TimelineTrack | undefined;
    
    // Find clip
    for (const track of this.tracks) {
      const idx = track.clips.findIndex(c => c.id === clipId);
      if (idx !== -1) {
        targetClip = track.clips[idx];
        oldTrack = track;
        break;
      }
    }

    if (!targetClip || !oldTrack) return;

    // Use requested track or fallback to original
    const targetTrackId = newTrackId || oldTrack.id;
    const track = this.tracks.find(t => t.id === targetTrackId);
    
    if (!track) return;

    // 1D Collision Detection & Snapping Algorithm
    let finalStartAt = quantizeToFrame(Math.max(0, newStartAt), this.projectFps);
    let finalEndAt = finalStartAt + targetClip.duration;
    
    // Create a non-reactive snapshot for heavy mathematical checks
    // This prevents Svelte from registering thousands of proxy reads per second during scrubbing
    const clipsSnapshot = $state.snapshot(track.clips);
    
    // Check for collisions with other clips on the target track
    for (const other of clipsSnapshot) {
      if (other.id === clipId) continue;
      
      const otherStart = other.startAt;
      const otherEnd = other.startAt + other.duration;
      
      // If overlapping: A_start < B_end && B_start < A_end
      if (finalStartAt < otherEnd && otherStart < finalEndAt) {
        // Snap to the closest edge of the overlapping clip
        const distToStart = Math.abs(finalStartAt - otherStart);
        const distToEnd = Math.abs(finalStartAt - otherEnd);
        
        if (distToStart < distToEnd) {
          // Snap before
          finalStartAt = quantizeToFrame(Math.max(0, otherStart - targetClip.duration), this.projectFps);
        } else {
          // Snap after
          finalStartAt = quantizeToFrame(otherEnd, this.projectFps);
        }
        
        // Recalculate end for cascading checks (basic resolution)
        finalEndAt = finalStartAt + targetClip.duration;
      }
    }

    // Apply resolved position
    if (newTrackId && newTrackId !== oldTrack.id) {
      const oldIdx = oldTrack.clips.findIndex(c => c.id === clipId);
      oldTrack.clips.splice(oldIdx, 1);
      targetClip.trackId = newTrackId;
      track.clips.push(targetClip);
    }
    
    const deltaX = finalStartAt - targetClip.startAt;
    targetClip.startAt = finalStartAt;

    // Connected Clips: Move all anchored child clips in lockstep
    if (Math.abs(deltaX) > 0.0001) {
      for (const t of this.tracks) {
        for (const child of t.clips) {
          if (child.parentClipId === clipId) {
            child.startAt = quantizeToFrame(Math.max(0, child.startAt + deltaX), this.projectFps);
          }
        }
      }
    }

    if (save) this.saveState();
  }

  updateClipBounds(clipId: string, startAt: number, duration: number, sourceOffset: number, save: boolean = true) {
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        clip.startAt = Math.max(0, startAt);
        const validOffset = Math.max(0, sourceOffset);
        let validDuration = Math.max(0.1, duration);

        // Enforce asset duration boundary to prevent audio/video desync beyond actual file length
        if (clip.assetId) {
          const asset = this.assets.find(a => a.id === clip.assetId);
          if (asset && asset.duration && asset.duration > 0) {
            const maxDuration = Math.max(0.1, asset.duration - validOffset);
            validDuration = Math.min(validDuration, maxDuration);
          }
        }

        clip.duration = validDuration;
        clip.sourceOffset = validOffset;
        if (save) this.saveState();
        break;
      }
    }
  }

  selectClip(clipId: string | null) {
    this.selectedClipId = clipId;
    if (clipId) {
      this.triggerHaptic('light');
      for (const track of this.tracks) {
        const found = track.clips.find(c => c.id === clipId);
        if (found) {
          this.announce(`Klip seçildi: ${found.name}`);
          break;
        }
      }
    } else {
      this.announce('Klip seçimi kaldırıldı.');
    }
  }

  deleteClip(clipId?: string) {
    const targetId = clipId || this.selectedClipId;
    if (!targetId) return;

    let deletedName = '';
    let targetTrack: TimelineTrack | null = null;
    let deletedClipDuration = 0;
    let deletedClipStart = 0;

    for (const track of this.tracks) {
      const idx = track.clips.findIndex(c => c.id === targetId);
      if (idx !== -1) {
        const c = track.clips[idx];
        deletedName = c.name;
        deletedClipStart = c.startAt;
        deletedClipDuration = c.duration;
        targetTrack = track;
        track.clips.splice(idx, 1);
        break;
      }
    }

    

    // Ripple Delete: Yalnızca silinen klibin bulunduğu izdeki takip eden klipleri sola kaydırır
    // Böylece müzik ve ses efektleri videodan bağımsız kaymaz, senkron korunur
    if (this.isMagnetic && targetTrack && deletedClipDuration > 0) {
      for (const clip of targetTrack.clips) {
        if (clip.startAt > deletedClipStart) {
          clip.startAt = quantizeToFrame(Math.max(0, clip.startAt - deletedClipDuration), this.projectFps);
        }
      }
    }

    // Detach connected clips from the deleted parent
    for (const track of this.tracks) {
      for (const clip of track.clips) {
        if (clip.parentClipId === targetId) {
          clip.parentClipId = undefined;
          clip.anchorOffset = undefined;
        }
      }
    }

    if (this.selectedClipId === targetId) {
      this.selectedClipId = null;
    }

    this.saveState();
    this.triggerHaptic('medium');
    this.announce(`Klip silindi: ${deletedName || 'Klip'}${this.isMagnetic ? ' (Manyetik Hizalandı)' : ''}`);
  }

  closeGapAt(trackId: string, gapStartTime: number) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track || track.isLocked) return;

    // Find the clip before the gap and the clip after
    const sorted = [...track.clips].sort((a, b) => a.startAt - b.startAt);
    let prevClipEnd = 0;
    let nextClip: TimelineClip | null = null;

    for (const clip of sorted) {
      if (clip.startAt + clip.duration <= gapStartTime + 0.05) {
        prevClipEnd = Math.max(prevClipEnd, clip.startAt + clip.duration);
      } else if (clip.startAt >= gapStartTime - 0.05) {
        nextClip = clip;
        break;
      }
    }

    if (nextClip) {
      const gapDuration = quantizeToFrame(nextClip.startAt - prevClipEnd, this.projectFps);
      if (gapDuration > 0.02) {
        for (const t of this.tracks) {
          if (t.isLocked) continue;
          if (t.syncLocked === false && t.id !== trackId) continue;
          for (const clip of t.clips) {
            if (clip.startAt >= nextClip.startAt) {
              clip.startAt = quantizeToFrame(Math.max(0, clip.startAt - gapDuration), this.projectFps);
            }
          }
        }
        this.saveState();
        this.triggerHaptic('light');
        this.announce('Boşluk kapatıldı.');
      }
    }
  }

  rippleCutRange(startTime: number, endTime: number) {
    const duration = endTime - startTime;
    if (duration <= 0.01) return;

    for (const track of this.tracks) {
      const clipsToProcess = [...track.clips];
      for (const clip of clipsToProcess) {
        const clipEnd = clip.startAt + clip.duration;
        // Clip completely inside cut range -> remove it
        if (clip.startAt >= startTime && clipEnd <= endTime) {
          const idx = track.clips.findIndex(c => c.id === clip.id);
          if (idx !== -1) track.clips.splice(idx, 1);
        }
        // Clip starts before, ends inside -> trim right
        else if (clip.startAt < startTime && clipEnd > startTime && clipEnd <= endTime) {
          clip.duration = startTime - clip.startAt;
        }
        // Clip starts inside, ends after -> trim left
        else if (clip.startAt >= startTime && clip.startAt < endTime && clipEnd > endTime) {
          const diff = endTime - clip.startAt;
          clip.startAt = endTime;
          clip.duration -= diff;
          clip.sourceOffset += diff;
        }
        // Clip spans across the entire cut range -> split and trim
        else if (clip.startAt < startTime && clipEnd > endTime) {
          const firstPartDuration = startTime - clip.startAt;
          const secondPartDuration = clipEnd - endTime;
          const secondPartSourceOffset = clip.sourceOffset + (endTime - clip.startAt);

          clip.duration = firstPartDuration;

          track.clips.push({
            ...clip,
            id: crypto.randomUUID(),
            startAt: endTime,
            duration: secondPartDuration,
            sourceOffset: secondPartSourceOffset
          });
        }
      }

      // Ripple shift clips on this track that start after the cut range
      for (const clip of track.clips) {
        if (clip.startAt >= endTime) {
          clip.startAt = Math.max(0, clip.startAt - duration);
        }
      }
    }

    this.saveState();
    this.triggerHaptic('medium');
    this.announce(`${duration.toFixed(1)}s konuşma aralığı metin üzerinden kesildi.`);
  }

  applyTransitionToCut(trackId: string, prevClipId: string, nextClipId: string, type: TransitionType, duration = 0.5) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return;

    const prevClip = track.clips.find(c => c.id === prevClipId);
    const nextClip = track.clips.find(c => c.id === nextClipId);

    if (type === 'none') {
      if (prevClip) prevClip.transitionOut = undefined;
      if (nextClip) nextClip.transitionIn = undefined;
      this.announce('Geçiş kaldırıldı');
    } else {
      if (prevClip) {
        prevClip.transitionOut = { type, duration };
      }
      if (nextClip) {
        nextClip.transitionIn = { type, duration };
      }
      this.announce(`${type} geçişi uygulandı (${duration}s)`);
    }

    this.saveState();
    this.triggerHaptic('light');
  }

  applyTransitionToAllCuts(trackId: string, type: TransitionType, duration = 0.5) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return;

    for (const clip of track.clips) {
      if (type === 'none') {
        clip.transitionIn = undefined;
        clip.transitionOut = undefined;
      } else {
        clip.transitionIn = { type, duration };
        clip.transitionOut = { type, duration };
      }
    }

    this.saveState();
    this.triggerHaptic('medium');
    this.announce(type === 'none' ? 'Tüm geçişler kaldırıldı' : `Tüm kesimlere ${type} uygulandı`);
  }

  splitClipAtPlayhead(clipId?: string) {
    const splitTime = quantizeToFrame(this.playhead, this.projectFps);
    let targetClip: TimelineClip | undefined;
    let targetTrack: TimelineTrack | undefined;

    // Find requested clip or selected clip, or clip intersecting playhead
    if (clipId || this.selectedClipId) {
      const searchId = clipId || this.selectedClipId;
      for (const track of this.tracks) {
        const found = track.clips.find(c => c.id === searchId);
        if (found) {
          targetClip = found;
          targetTrack = track;
          break;
        }
      }
    }

    // Fallback: Find clip at playhead on any track
    if (!targetClip) {
      for (const track of this.tracks) {
        const found = track.clips.find(c => splitTime > c.startAt + 0.05 && splitTime < c.startAt + c.duration - 0.05);
        if (found) {
          targetClip = found;
          targetTrack = track;
          break;
        }
      }
    }

    if (!targetClip || !targetTrack) {
      this.announce('Bölünecek geçerli bir klip veya oynatma konumu bulunamadı.');
      return;
    }

    if (targetTrack.isLocked) {
      this.announce('Kilitli izdeki klip bölünemez.');
      return;
    }

    // Ensure splitTime is strictly inside the clip bounds with at least 0.1s on each side
    if (splitTime <= targetClip.startAt + 0.05 || splitTime >= targetClip.startAt + targetClip.duration - 0.05) {
      this.announce('Klip bölme için en az 1 kare mesafe gereklidir.');
      return;
    }

    const firstDuration = quantizeToFrame(splitTime - targetClip.startAt, this.projectFps);
    const secondDuration = quantizeToFrame(targetClip.duration - firstDuration, this.projectFps);
    if (firstDuration < 0.05 || secondDuration < 0.05) {
      this.announce('Bölünen parçalar en az 1 kare olmalıdır.');
      return;
    }
    const secondSourceOffset = quantizeToFrame(targetClip.sourceOffset + firstDuration, this.projectFps);

    // Deep clone subtitles for split segments if present
    let firstSubs = undefined;
    let secondSubs = undefined;

    if (targetClip.subtitles && targetClip.subtitles.length > 0) {
      firstSubs = targetClip.subtitles
        .filter(s => s.start < firstDuration)
        .map(s => ({ ...s, end: Math.min(s.end, firstDuration) }));

      secondSubs = targetClip.subtitles
        .filter(s => s.end > firstDuration)
        .map(s => ({
          ...s,
          start: Math.max(0, s.start - firstDuration),
          end: s.end - firstDuration
        }));
    }

    // Update left clip
    targetClip.duration = firstDuration;
    if (firstSubs) targetClip.subtitles = firstSubs;

    // Create right clip
    const newRightClip: TimelineClip = {
      id: crypto.randomUUID(),
      trackId: targetTrack.id,
      assetId: targetClip.assetId,
      sourceUrl: targetClip.sourceUrl,
      name: `${targetClip.name} (Bölüm 2)`,
      startAt: splitTime,
      duration: secondDuration,
      sourceOffset: secondSourceOffset,
      color: targetClip.color,
      type: targetClip.type,
      cropRect: targetClip.cropRect ? { ...targetClip.cropRect } : undefined,
      isBgRemoved: targetClip.isBgRemoved,
      colorGrading: targetClip.colorGrading ? { ...targetClip.colorGrading } : undefined,
      volume: targetClip.volume,
      speed: targetClip.speed,
      speedCurve: targetClip.speedCurve ? JSON.parse(JSON.stringify(targetClip.speedCurve)) : undefined,
      audioEnvelope: targetClip.audioEnvelope ? { ...targetClip.audioEnvelope } : undefined,
      reframeKeyframes: targetClip.reframeKeyframes ? [...targetClip.reframeKeyframes] : undefined,
      subtitles: secondSubs
    };

    targetTrack.clips.push(newRightClip);

    // Re-anchor any connected child clips starting after splitTime to the new right clip
    for (const track of this.tracks) {
      for (const child of track.clips) {
        if (child.parentClipId === targetClip.id && child.startAt >= splitTime) {
          child.parentClipId = newRightClip.id;
          child.anchorOffset = quantizeToFrame(child.startAt - newRightClip.startAt, this.projectFps);
        }
      }
    }

    // Sort clips chronologically by startAt
    targetTrack.clips.sort((a, b) => a.startAt - b.startAt);

    this.selectedClipId = newRightClip.id;
    this.saveState();
    this.triggerHaptic('medium');
    this.announce(`Klip bölündü: ${targetClip.name}`);
  }

  /**
   * Slip Edit: Shuts media in/out window without moving clip position or altering total timeline duration.
   */
  slipClip(clipId: string, deltaSeconds: number) {
    for (const track of this.tracks) {
      if (track.isLocked) continue;
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        const asset = clip.assetId ? this.assets.find(a => a.id === clip.assetId) : null;
        const maxOffset = asset?.duration ? Math.max(0, asset.duration - clip.duration) : Infinity;
        const currentOffset = clip.sourceOffset || 0;
        const newOffset = Math.max(0, Math.min(maxOffset, currentOffset + deltaSeconds));
        clip.sourceOffset = quantizeToFrame(newOffset, this.projectFps);
        this.saveState();
        this.announce(`Klip içeriği kaydırıldı (Slip): ${clip.sourceOffset.toFixed(2)}s`);
        break;
      }
    }
  }

  /**
   * Rolling Edit: Moves the edit cut point between two adjacent clips without altering timeline length.
   */
  rollingEdit(trackId: string, prevClipId: string, nextClipId: string, deltaSeconds: number) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track || track.isLocked) return;
    const prev = track.clips.find(c => c.id === prevClipId);
    const next = track.clips.find(c => c.id === nextClipId);
    if (!prev || !next) return;

    const quantizedDelta = quantizeToFrame(deltaSeconds, this.projectFps);
    if (prev.duration + quantizedDelta < 0.1 || next.duration - quantizedDelta < 0.1) return;

    prev.duration = quantizeToFrame(prev.duration + quantizedDelta, this.projectFps);
    next.startAt = quantizeToFrame(next.startAt + quantizedDelta, this.projectFps);
    next.duration = quantizeToFrame(next.duration - quantizedDelta, this.projectFps);
    next.sourceOffset = quantizeToFrame(next.sourceOffset + quantizedDelta, this.projectFps);

    this.saveState();
    this.announce(`Kesim noktası kaydırıldı (Rolling): ${(quantizedDelta > 0 ? '+' : '')}${quantizedDelta.toFixed(2)}s`);
  }

  /**
   * Ripple Trim: Trims a clip's in or out point and ripples all sync-locked tracks.
   */
  rippleTrimClip(clipId: string, side: 'in' | 'out', deltaSeconds: number) {
    let targetClip: TimelineClip | undefined;
    let targetTrack: TimelineTrack | undefined;

    for (const track of this.tracks) {
      if (track.isLocked) continue;
      const found = track.clips.find(c => c.id === clipId);
      if (found) {
        targetClip = found;
        targetTrack = track;
        break;
      }
    }

    if (!targetClip || !targetTrack) return;

    const quantizedDelta = quantizeToFrame(deltaSeconds, this.projectFps);
    if (Math.abs(quantizedDelta) < 0.001) return;

    if (side === 'out') {
      const newDuration = Math.max(0.1, quantizeToFrame(targetClip.duration + quantizedDelta, this.projectFps));
      const effectiveDelta = newDuration - targetClip.duration;
      targetClip.duration = newDuration;

      // Ripple shift following clips on sync-locked tracks
      if (this.isMagnetic && Math.abs(effectiveDelta) > 0.001) {
        for (const track of this.tracks) {
          if (track.isLocked) continue;
          if (track.syncLocked === false && track.id !== targetTrack.id) continue;
          for (const clip of track.clips) {
            if (clip.id !== targetClip.id && clip.startAt >= targetClip.startAt + targetClip.duration - effectiveDelta - 0.01) {
              clip.startAt = quantizeToFrame(Math.max(0, clip.startAt + effectiveDelta), this.projectFps);
            }
          }
        }
      }
    } else if (side === 'in') {
      const newDuration = Math.max(0.1, quantizeToFrame(targetClip.duration - quantizedDelta, this.projectFps));
      const effectiveDelta = targetClip.duration - newDuration;
      targetClip.duration = newDuration;
      targetClip.sourceOffset = Math.max(0, quantizeToFrame(targetClip.sourceOffset + quantizedDelta, this.projectFps));
      
      if (this.isMagnetic && Math.abs(effectiveDelta) > 0.001) {
        for (const track of this.tracks) {
          if (track.isLocked) continue;
          if (track.syncLocked === false && track.id !== targetTrack.id) continue;
          for (const clip of track.clips) {
            if (clip.startAt > targetClip.startAt) {
              clip.startAt = quantizeToFrame(Math.max(0, clip.startAt - effectiveDelta), this.projectFps);
            }
          }
        }
      }
    }

    this.saveState();
  }

  duplicateClip(clipId?: string) {
    const targetId = clipId || this.selectedClipId;
    if (!targetId) return;

    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === targetId);
      if (clip) {
        const cloned: TimelineClip = {
          ...clip,
          id: crypto.randomUUID(),
          name: `${clip.name} (Kopya)`,
          startAt: clip.startAt + clip.duration + 0.1
        };
        track.clips.push(cloned);
        this.selectedClipId = cloned.id;
        this.saveState();
        this.triggerHaptic('light');
        this.announce(`Klip çoğaltıldı: ${clip.name}`);
        break;
      }
    }
  }

  stepPlayhead(deltaSeconds: number) {
    this.playhead = Math.max(0, Math.min(this.duration, Number((this.playhead + deltaSeconds).toFixed(3))));
    masterAudioClock.seek(this.playhead, this.tracks);
  }

  stepFrame(deltaFrames: number) {
    const fps = this.projectFps || DEFAULT_PROJECT_FPS;
    const currentFrame = Math.round(this.playhead * fps);
    const targetFrame = Math.max(0, Math.min(Math.round(this.duration * fps), currentFrame + deltaFrames));
    this.playhead = quantizeToFrame(targetFrame / fps, fps);
    masterAudioClock.seek(this.playhead, this.tracks);
    this.announce(`Kare: ${formatSMPTETimecode(this.playhead, fps)}`);
  }

  seekTo(timeSeconds: number) {
    this.playhead = Math.max(0, Math.min(this.duration, Number(timeSeconds.toFixed(3))));
    masterAudioClock.seek(this.playhead, this.tracks);
    this.announce(`Oynatma konumu: ${this.playhead.toFixed(2)} saniye`);
  }

  togglePlayback() {
    if (!this.isPlaying && this.duration > 0 && this.playhead >= this.duration - 0.05) {
      this.playhead = 0;
      masterAudioClock.seek(0, this.tracks);
    }
    this.isPlaying = !this.isPlaying;
    if (this.isPlaying) {
      masterAudioClock.start(this.playhead, this.tracks, 1.0);
    } else {
      masterAudioClock.pause();
    }
    this.triggerHaptic('light');
    this.announce(this.isPlaying ? 'Oynatma başlatıldı' : `Durduruldu (${this.playhead.toFixed(2)}s)`);
  }

  getSelectedClip(): TimelineClip | undefined {
    if (!this.selectedClipId) return undefined;
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === this.selectedClipId);
      if (clip) return clip;
    }
    return undefined;
  }

  setClipVolume(clipId: string, volume: number) {
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        clip.volume = Math.max(0, Math.min(2, volume));
        this.saveState();
        break;
      }
    }
  }

  setClipSpeed(clipId: string, speed: number) {
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        clip.speed = Math.max(0.25, Math.min(4, speed));
        this.saveState();
        this.announce(`Klip hızı ayarlandı: ${speed}x`);
        break;
      }
    }
  }

  updateSubtitleText(clipId: string, subId: string, text: string) {
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip && clip.subtitles) {
        const sub = clip.subtitles.find(s => s.id === subId);
        if (sub) {
          sub.text = text;
          this.saveState();
          break;
        }
      }
    }
  }

  removeSubtitle(clipId: string, subId: string) {
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip && clip.subtitles) {
        const idx = clip.subtitles.findIndex(s => s.id === subId);
        if (idx !== -1) {
          clip.subtitles.splice(idx, 1);
          this.saveState();
          this.announce('Altyazı satırı silindi.');
          break;
        }
      }
    }
  }

  addSubtitleToClip(clipId: string, text: string, start?: number, end?: number) {
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        if (!clip.subtitles) clip.subtitles = [];
        const s = start ?? Math.max(0, this.playhead - clip.startAt);
        const e = end ?? Math.min(clip.duration, s + 2.0);
        clip.subtitles.push({
          id: crypto.randomUUID(),
          text,
          start: Number(s.toFixed(2)),
          end: Number(e.toFixed(2))
        });
        clip.subtitles.sort((a, b) => a.start - b.start);
        this.saveState();
        this.announce('Yeni altyazı eklendi.');
        break;
      }
    }
  }

  rippleTrimHead(clipId?: string) {
    const time = this.playhead;
    for (const track of this.tracks) {
      const searchId = clipId || this.selectedClipId;
      const clipIndex = track.clips.findIndex(c => 
        (searchId && c.id === searchId) || (!searchId && time > c.startAt + 0.05 && time < c.startAt + c.duration - 0.05)
      );

      if (clipIndex !== -1) {
        const clip = track.clips[clipIndex];
        const delta = time - clip.startAt;
        if (delta <= 0.05) return;

        clip.duration = Math.max(0.1, clip.duration - delta);
        clip.sourceOffset = (clip.sourceOffset || 0) + delta;
        // Shift following clips on this track
        for (let i = clipIndex + 1; i < track.clips.length; i++) {
          track.clips[i].startAt = Math.max(0, track.clips[i].startAt - delta);
        }
        this.playhead = clip.startAt;
        this.saveState();
        this.triggerHaptic('medium');
        this.announce('Ripple Trim Head uygulandı.');
        return;
      }
    }
  }

  rippleTrimTail(clipId?: string) {
    const time = this.playhead;
    for (const track of this.tracks) {
      const searchId = clipId || this.selectedClipId;
      const clipIndex = track.clips.findIndex(c => 
        (searchId && c.id === searchId) || (!searchId && time > c.startAt + 0.05 && time < c.startAt + c.duration - 0.05)
      );

      if (clipIndex !== -1) {
        const clip = track.clips[clipIndex];
        const clipEnd = clip.startAt + clip.duration;
        const delta = clipEnd - time;
        if (delta <= 0.05) return;

        clip.duration = Math.max(0.1, time - clip.startAt);
        // Shift following clips on this track
        for (let i = clipIndex + 1; i < track.clips.length; i++) {
          track.clips[i].startAt = Math.max(0, track.clips[i].startAt - delta);
        }
        this.saveState();
        this.triggerHaptic('medium');
        this.announce('Ripple Trim Tail uygulandı.');
        return;
      }
    }
  }

  setSubtitlePreset(preset: SubtitlePresetStyle) {
    this.globalSubtitleStyle.preset = preset;
    if (preset === 'tiktok-bold') {
      this.globalSubtitleStyle.textColor = '#ffffff';
      this.globalSubtitleStyle.highlightColor = '#fde047';
      this.globalSubtitleStyle.backgroundColor = 'rgba(0, 0, 0, 0.75)';
      this.globalSubtitleStyle.strokeColor = '#000000';
      this.globalSubtitleStyle.strokeWidth = 3;
      this.globalSubtitleStyle.animation = 'pop';
    } else if (preset === 'karaoke-glow') {
      this.globalSubtitleStyle.textColor = '#93c5fd';
      this.globalSubtitleStyle.highlightColor = '#38bdf8';
      this.globalSubtitleStyle.backgroundColor = 'rgba(15, 23, 42, 0.85)';
      this.globalSubtitleStyle.strokeColor = '#0369a1';
      this.globalSubtitleStyle.strokeWidth = 2;
      this.globalSubtitleStyle.animation = 'karaoke';
    } else if (preset === 'minimal-pill') {
      this.globalSubtitleStyle.textColor = '#ffffff';
      this.globalSubtitleStyle.highlightColor = '#ffffff';
      this.globalSubtitleStyle.backgroundColor = 'rgba(24, 24, 27, 0.8)';
      this.globalSubtitleStyle.strokeColor = 'transparent';
      this.globalSubtitleStyle.strokeWidth = 0;
      this.globalSubtitleStyle.animation = 'none';
    } else if (preset === 'neon-reels') {
      this.globalSubtitleStyle.textColor = '#f472b6';
      this.globalSubtitleStyle.highlightColor = '#f43f5e';
      this.globalSubtitleStyle.backgroundColor = 'rgba(30, 10, 20, 0.85)';
      this.globalSubtitleStyle.strokeColor = '#881337';
      this.globalSubtitleStyle.strokeWidth = 3;
      this.globalSubtitleStyle.animation = 'pop';
    } else if (preset === 'classic-sub') {
      this.globalSubtitleStyle.textColor = '#ffff00';
      this.globalSubtitleStyle.highlightColor = '#ffffff';
      this.globalSubtitleStyle.backgroundColor = 'transparent';
      this.globalSubtitleStyle.strokeColor = '#000000';
      this.globalSubtitleStyle.strokeWidth = 4;
      this.globalSubtitleStyle.animation = 'none';
    }

    this.saveState();
    this.triggerHaptic('light');
    this.announce(`Altyazı stili değiştirildi: ${preset}`);
  }

  updateGlobalSubtitleStyle(updates: Partial<SubtitleStyle>) {
    Object.assign(this.globalSubtitleStyle, updates);
    this.saveState();
  }

  setClipSpeedCurve(clipId: string, curve: SpeedCurveConfig | undefined) {
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        clip.speedCurve = curve;
        if (curve && curve.points.length > 0) {
          // Compute effective average speed to adapt duration proportionally
          const avgSpeed = curve.points.reduce((acc, p) => acc + p.speed, 0) / curve.points.length;
          clip.speed = Number(avgSpeed.toFixed(2));
        }
        this.saveState();
        this.triggerHaptic('light');
        this.announce(curve ? `Hız eğrisi uygulandı: ${curve.preset}` : 'Hız eğrisi kaldırıldı');
        break;
      }
    }
  }

  updateClipAudioEnvelope(clipId: string, envelopeUpdates: Partial<AudioEnvelopeConfig>) {
    for (const track of this.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        clip.audioEnvelope = {
          fadeIn: 0,
          fadeOut: 0,
          ducking: false,
          pitchShift: 0,
          eqPreset: 'flat',
          ...(clip.audioEnvelope || {}),
          ...envelopeUpdates
        };
        this.saveState();
        this.triggerHaptic('light');
        break;
      }
    }
  }
}

export const editor = new VideoEditor();

if (typeof window !== 'undefined') {
  (window as any).editor = editor;
  (window as any).__videoEditorInstance = editor;
}

