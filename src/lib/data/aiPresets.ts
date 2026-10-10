/**
 * 2026 AI Production Workflow & Editing Presets
 * Video kurgusunda 2026 yılına kadar edinilen kullanıcı deneyimleri, 
 * CapCut / DaVinci / Premiere analizleri ve en verimli adım adım iş akışı tanımları.
 */

export interface WorkflowStep {
  id: string;
  stepNumber: number;
  title: string;
  shortTitle: string;
  description: string;
  badge: string;
  icon: string; // Lucide icon identifier
  aiAction?: string; // İlgili yapay zeka kısayol aksiyonu
  color: string;
}

export const PRODUCTION_WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: 'step-ingest',
    stepNumber: 1,
    title: 'Medya & Kaba Kurgu',
    shortTitle: 'Kurgu',
    description: 'Videoları içe aktarın, gereksiz kısımları kesin ve sıraya dizin.',
    badge: 'Temel',
    icon: 'Scissors',
    aiAction: 'silence_cut',
    color: 'sky'
  },
  {
    id: 'step-silence',
    stepNumber: 2,
    title: 'AI Akıllı Sessizlik Silici',
    shortTitle: 'Sessizlik Sil',
    description: 'Silero VAD ile nefes ve bekleme boşluklarını tek tıkla otomatik kesin.',
    badge: 'AI VAD',
    icon: 'Sparkles',
    aiAction: 'silence_cut',
    color: 'purple'
  },
  {
    id: 'step-reframe',
    stepNumber: 3,
    title: 'Format & 9:16 Akıllı Kadraj',
    shortTitle: 'Reframe',
    description: 'MediaPipe BlazeFace ile konuşmacıyı algılayarak dikey formata odaklayın.',
    badge: 'AI Vision',
    icon: 'Crop',
    aiAction: 'auto_reframe',
    color: 'rose'
  },
  {
    id: 'step-color',
    stepNumber: 4,
    title: 'Sinematik Renk & LUT',
    shortTitle: 'Renk',
    description: 'Oklab renk uzayı ile Hollywood Teal & Orange veya estetik renk profili uygulayın.',
    badge: 'Oklab',
    icon: 'Palette',
    aiAction: 'auto_color',
    color: 'cyan'
  },
  {
    id: 'step-audio',
    stepNumber: 5,
    title: 'Ses Temizleme & Ritim',
    shortTitle: 'Ses & Ritim',
    description: 'Dip gürültüyü spektral olarak temizleyin ve vuruşları müzikle senkronlayın.',
    badge: 'Web Audio',
    icon: 'Volume2',
    aiAction: 'audio_denoise',
    color: 'emerald'
  },
  {
    id: 'step-captions',
    stepNumber: 6,
    title: 'Otomatik Altyazı & Kanca',
    shortTitle: 'Altyazı',
    description: 'Whisper ile kelime kelime senkron altyazı ve 2026 viral kanca başlıkları ekleyin.',
    badge: 'Whisper',
    icon: 'Type',
    aiAction: 'generate_captions',
    color: 'amber'
  }
];

export interface TypographyPreset {
  id: string;
  name: string;
  category: 'tiktok' | 'youtube' | 'minimal' | 'cinematic';
  fontSize: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  highlightColor: string;
  backgroundColor: string;
  animation: 'pop' | 'typewriter' | 'glow' | 'none';
  positionY: number; // Yüzde olarak (örn: %75 ekranın alt kısmı)
}

export const TYPOGRAPHY_PRESETS: TypographyPreset[] = [
  {
    id: 'tiktok-viral-yellow',
    name: 'TikTok Viral Sarı',
    category: 'tiktok',
    fontSize: 26,
    textColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 4,
    highlightColor: '#facc15', // Vibrant yellow
    backgroundColor: 'transparent',
    animation: 'pop',
    positionY: 76
  },
  {
    id: 'reels-neon-cyan',
    name: 'Reels Siber Camgöbeği',
    category: 'tiktok',
    fontSize: 24,
    textColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 3,
    highlightColor: '#22d3ee', // Neon Cyan
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    animation: 'glow',
    positionY: 74
  },
  {
    id: 'cinematic-serif',
    name: 'Sinematik Klasik',
    category: 'cinematic',
    fontSize: 20,
    textColor: '#f1f5f9',
    strokeColor: 'transparent',
    strokeWidth: 0,
    highlightColor: '#f8fafc',
    backgroundColor: 'transparent',
    animation: 'none',
    positionY: 82
  },
  {
    id: 'karaoke-glow',
    name: 'Karaoke Işıltı',
    category: 'youtube',
    fontSize: 25,
    textColor: '#e2e8f0',
    strokeColor: '#020617',
    strokeWidth: 3,
    highlightColor: '#ec4899', // Hot Pink
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    animation: 'pop',
    positionY: 75
  }
];
