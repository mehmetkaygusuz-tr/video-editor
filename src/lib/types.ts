export type TrackType = 'video' | 'subtitle' | 'effect' | 'audio';

export interface TimelineTrack {
  id: string;
  name: string;
  type?: TrackType;
  clips: TimelineClip[];
  isMuted?: boolean;
  isLocked?: boolean;
  syncLocked?: boolean; // When true (default), shifts during multi-track ripple edits
}

export interface SubtitleWord {
  word: string;
  start: number;
  end: number;
}

export interface SubtitleItem {
  id: string;
  text: string;
  start: number;
  end: number;
  words?: SubtitleWord[];
}

export type TransitionType = 'none' | 'fade' | 'dissolve' | 'wipe-left' | 'wipe-right' | 'zoom-in' | 'blur';

export interface ClipTransition {
  type: TransitionType;
  duration: number; // in seconds, typically 0.3s - 1.5s
}

export type SubtitlePresetStyle = 'tiktok-bold' | 'karaoke-glow' | 'minimal-pill' | 'neon-reels' | 'classic-sub';

export interface SubtitleStyle {
  preset: SubtitlePresetStyle;
  fontSize: number; // in pixels, default ~24-32
  fontFamily: string; // e.g. system-ui, Impact, Montserrat
  textColor: string; // default #ffffff
  highlightColor: string; // karaoke active word color, default #fde047
  backgroundColor: string; // pill background, default rgba(0,0,0,0.75)
  strokeColor: string; // text outline stroke, default #000000
  strokeWidth: number; // default 2-4
  positionY: number; // percentage from top, default 80 (bottom zone)
  animation: 'none' | 'pop' | 'typewriter' | 'wave' | 'karaoke';
}

export type SpeedCurvePreset = 'custom' | 'hero' | 'bullet' | 'flash-in' | 'flash-out' | 'jump-cut';

export interface SpeedCurvePoint {
  time: number; // 0 to 1 normalized time within clip
  speed: number; // 0.1x to 10x
}

export interface SpeedCurveConfig {
  preset: SpeedCurvePreset;
  points: SpeedCurvePoint[];
  keepPitch: boolean;
}

export interface AudioEnvelopeConfig {
  fadeIn: number; // seconds (0 to 5)
  fadeOut: number; // seconds (0 to 5)
  ducking: boolean; // auto volume attenuation when speech is detected
  pitchShift: number; // semitones (-12 to +12)
  eqPreset?: 'flat' | 'voice-boost' | 'bass-boost' | 'podcast';
}

export interface ColorGradingConfig {
  brightness?: number; // -1 to 1, default 0
  contrast?: number; // 0 to 3, default 1
  saturation?: number; // 0 to 3, default 1
  blur?: number; // 0 to 20 pixels, default 0
  temperature?: number; // -1 to 1 (blue to orange), default 0
  tint?: number; // -1 to 1 (green to magenta), default 0
  lut?: string; // e.g. 'cinematic', 'teal-orange'
}

export interface TimelineClip {
  id: string;
  trackId: string;
  assetId?: string; // Reference to the Asset in the Media Pool
  sourceUrl: string;
  name: string;
  startAt: number; // Position on timeline in seconds
  duration: number; // Visible duration on timeline in seconds
  sourceOffset: number; // Start time within the source media in seconds
  color: string;
  parentClipId?: string; // Connected clips: ID of parent storyline clip
  anchorOffset?: number; // Offset relative to parentClip startAt in seconds
  type?: 'video' | 'audio' | 'image' | 'text' | 'effect';
  text?: string;
  subtitles?: SubtitleItem[];
  subtitleStyle?: Partial<SubtitleStyle>;
  isBgRemoved?: boolean;
  colorGrading?: ColorGradingConfig;
  cropRect?: { x: number; y: number; w: number; h: number };
  reframeKeyframes?: { time: number; x: number; y: number; width: number; height: number }[];
  volume?: number;
  speed?: number;
  speedCurve?: SpeedCurveConfig;
  audioEnvelope?: AudioEnvelopeConfig;
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  vadSilences?: {start: number, end: number}[];
}

export interface Asset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  duration?: number;
  fileHandle?: FileSystemFileHandle | null;
  color: string;
  blobUrl?: string;
}

export interface BeatMarker {
  id: string;
  time: number;
  label?: string;
  intensity?: number;
}

export interface FilterPreset {
  id: string;
  name: string;
  category: 'cinematic' | 'creative' | 'vintage' | 'clean';
  description: string;
  grading: ColorGradingConfig;
  previewGradient: string;
}

export type TemplateType = 
  | 'fast-rhythm' 
  | 'vlog' 
  | 'beat-drop' 
  | 'viral-tiktok' 
  | 'cinematic' 
  | 'retro-90s' 
  | 'podcast' 
  | 'gaming' 
  | 'aesthetic';

export interface TemplateSlot {
  startBeat: number;
  durationBeats: number;
  label?: string;
  suggestedTransition?: TransitionType;
}

export interface MagicTemplate {
  id: string;
  name: string;
  category?: 'viral' | 'cinematic' | 'rhythm' | 'social' | 'creative';
  description?: string;
  targetBpm?: number;
  type: TemplateType;
  slots: TemplateSlot[];
  defaultFilter?: string;
  aspectRatioPreference?: '9:16' | '16:9' | '1:1' | '21:9';
}

export type AspectRatio = 'original' | '16:9' | '9:16' | '1:1' | '21:9';

export interface EditorState {
  tracks: TimelineTrack[];
  assets: Asset[];
  playhead: number;
  duration: number;
  isPlaying: boolean;
  zoom: number;
}

export type ScrubbingMode = 'adaptive' | 'fast_keyframe' | 'exact';

export interface SeekOptions {
  mode?: ScrubbingMode;
  priority?: 'high' | 'normal' | 'low';
}

export interface DecodedFrameResult {
  frame: VideoFrame;
  pts: number;
  isKeyframe: boolean;
  mode: 'fast_keyframe' | 'exact';
  decodeDurationMs: number;
}

export interface DecoderTelemetry {
  lastPTS: number;
  isKeyframe: boolean;
  mode: 'fast_keyframe' | 'exact' | 'idle';
  decodeDurationMs: number;
  keyframeCount: number;
  cachedKeyframes: number;
  renderFps: number;
}

export interface AudioClockTelemetry {
  currentTime: number;
  baseLatency: number;
  outputLatency: number;
  totalLatency: number;
  driftMs: number;
  isPlaying: boolean;
  activeSources: number;
}

export interface GpuTelemetry {
  isHardwareAccelerated: boolean;
  isDualTexturePass: boolean;
  activeTransition: string | null;
  pipelineStatus: 'webgpu_active' | 'canvas2d_fallback' | 'initializing';
}

export interface IDecoderEngine {
  load(file: File): Promise<void>;
  seek(timeInSeconds: number, options?: SeekOptions): Promise<DecodedFrameResult | null>;
  getKeyframeTimestamps(): number[];
  getNearestKeyframe(timeInSeconds: number): number;
  dispose(): void;
  readonly isLoaded: boolean;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly codec: string | null;
}

export type AIFeatureId =
  | 'whisper_captions'
  | 'silero_vad'
  | 'kokoro_tts'
  | 'beat_detector'
  | 'modnet_bg'
  | 'yunet_reframe'
  | 'ai_color_enhance'
  | 'ai_audio_denoise'
  | 'ai_script_copilot'
  | 'ai_smart_template';

export interface AIFeatureInfo {
  id: AIFeatureId;
  name: string;
  model: string;
  license: string;
  licenseType: 'MIT' | 'Apache 2.0' | 'BSD';
  description: string;
  hardware: 'WebGPU' | 'WASM' | 'WebAudio' | 'Simulated';
  status: 'ready' | 'downloading' | 'processing' | 'idle' | 'error';
  progress?: number;
}

export type AgentActionType =
  | 'JUMP_CUT_SILENCE'
  | 'GENERATE_AUTO_SUBTITLES'
  | 'BEAT_SYNC_CUT'
  | 'SPLIT_AT_PLAYHEAD'
  | 'RIPPLE_TRIM_HEAD'
  | 'RIPPLE_TRIM_TAIL'
  | 'CHANGE_SPEED'
  | 'REMOVE_BACKGROUND'
  | 'SMART_REFRAME'
  | 'GENERATE_TTS'
  | 'DELETE_SELECTED'
  | 'ADD_TEXT_OVERLAY'
  | 'APPLY_FILTER'
  | 'AUTO_COLOR_ENHANCE'
  | 'DENOISE_AUDIO'
  | 'GENERATE_VIRAL_HOOKS'
  | 'APPLY_TEMPLATE'
  | 'SET_ASPECT_RATIO'
  | 'OPEN_AI_CENTER'
  | 'SET_VOLUME'
  | 'TOGGLE_MUTE'
  | 'DUPLICATE_CLIP'
  | 'COPY_GRADE_TO_ALL'
  | 'RESET_COLOR_GRADING'
  | 'OPEN_TRANSITIONS'
  | 'OPEN_EXPORT'
  | 'RESET_PROJECT'
  | 'UNDO'
  | 'REDO'
  | 'UNKNOWN_INTENT';

export interface AgentIntentResult {
  action: AgentActionType;
  confidence: number;
  description: string;
  params?: Record<string, any>;
}

export interface AgentTelemetry {
  lastAction: AgentActionType | null;
  lastIntentPrompt: string;
  confidence: number;
  status: 'idle' | 'executing' | 'completed' | 'error';
  executionTimeMs: number;
  activeModel: string | null;
}

export type ThemeId = 'obsidian' | 'cyber' | 'slate' | 'oled';

export interface AppSettingsConfig {
  theme: ThemeId;
  resolutionPreset: '1080p' | '4k' | '720p' | 'shorts_9_16' | 'square_1_1' | 'portrait_4_5';
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  colorSpace: 'srgb' | 'p3' | 'rec709';
  hardwareAcceleration: boolean;
  modelPrecision: 'fp32' | 'fp16' | 'q8';
  audioSampleRate: 44100 | 48000;
  offlineMode: boolean;
  hapticFeedback: boolean;
  autoSaveIntervalSec: number;
  magneticSnapping: boolean;
  snapThresholdPx: number;
}

