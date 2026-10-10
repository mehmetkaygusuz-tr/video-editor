import type { MagicTemplate } from './types';

export const MAGIC_TEMPLATES: MagicTemplate[] = [
  {
    id: 'viral-tiktok-hook',
    name: 'Viral TikTok & Reels Kancası',
    category: 'viral',
    type: 'viral-tiktok',
    description: 'İlk 3 saniyede izleyiciyi yakalayan ultra hızlı ritmik kesimler, dinamik altyazı ve yüksek etkileşim ritmi.',
    targetBpm: 128,
    defaultFilter: 'clean-studio',
    aspectRatioPreference: '9:16',
    slots: [
      { startBeat: 0, durationBeats: 0.75, label: 'Kanca Sahnesi 1', suggestedTransition: 'wipe-right' },
      { startBeat: 0.75, durationBeats: 0.75, label: 'Kanca Sahnesi 2', suggestedTransition: 'wipe-left' },
      { startBeat: 1.5, durationBeats: 1.0, label: 'Merak Uyandırma', suggestedTransition: 'dissolve' },
      { startBeat: 2.5, durationBeats: 0.5, label: 'Hızlı Flaş', suggestedTransition: 'fade' },
      { startBeat: 3.0, durationBeats: 0.5, label: 'Patlama Kesimi', suggestedTransition: 'fade' },
      { startBeat: 3.5, durationBeats: 2.0, label: 'Ana Açıklama', suggestedTransition: 'dissolve' },
      { startBeat: 5.5, durationBeats: 1.5, label: 'Detay Görüntü', suggestedTransition: 'wipe-right' },
      { startBeat: 7.0, durationBeats: 2.0, label: 'Harekete Geçirici Mesaj (CTA)' }
    ]
  },
  {
    id: 'beat-drop',
    name: 'Beat Drop & Bass Boost',
    category: 'rhythm',
    type: 'beat-drop',
    description: 'Yükselen gerilim ve ardından vuran bas ritmiyle senkronize dinamik kesitler.',
    targetBpm: 130,
    defaultFilter: 'cyberpunk-neon',
    aspectRatioPreference: '9:16',
    slots: [
      { startBeat: 0, durationBeats: 4, label: 'Gerilim Tırmanışı (Build-up)', suggestedTransition: 'dissolve' },
      { startBeat: 4, durationBeats: 0.5, label: 'Drop Vuruşu 1', suggestedTransition: 'fade' },
      { startBeat: 4.5, durationBeats: 0.5, label: 'Drop Vuruşu 2', suggestedTransition: 'fade' },
      { startBeat: 5, durationBeats: 0.5, label: 'Drop Vuruşu 3', suggestedTransition: 'fade' },
      { startBeat: 5.5, durationBeats: 0.5, label: 'Drop Vuruşu 4', suggestedTransition: 'wipe-left' },
      { startBeat: 6, durationBeats: 2.0, label: 'Ana Ritim Akışı', suggestedTransition: 'dissolve' },
      { startBeat: 8, durationBeats: 1.0, label: 'Ritim Vuruşu', suggestedTransition: 'fade' }
    ]
  },
  {
    id: 'cinematic-trailer',
    name: 'Sinematik Fragman & Teaser',
    category: 'cinematic',
    type: 'cinematic',
    description: 'Geniş planlar, Teal & Orange renk derecelendirmesi ve ağır çözülmeli epik geçişler.',
    targetBpm: 90,
    defaultFilter: 'teal-orange',
    aspectRatioPreference: '16:9',
    slots: [
      { startBeat: 0, durationBeats: 4, label: 'Giriş / Mekan Tanıtımı', suggestedTransition: 'fade' },
      { startBeat: 4, durationBeats: 3, label: 'Karakter / Odak Sahnesi', suggestedTransition: 'dissolve' },
      { startBeat: 7, durationBeats: 3, label: 'Dramatik Detay', suggestedTransition: 'dissolve' },
      { startBeat: 10, durationBeats: 2, label: 'Hızlanan Aksiyon 1', suggestedTransition: 'wipe-right' },
      { startBeat: 12, durationBeats: 2, label: 'Hızlanan Aksiyon 2', suggestedTransition: 'wipe-left' },
      { startBeat: 14, durationBeats: 4, label: 'Sinematik Final & Logo', suggestedTransition: 'fade' }
    ]
  },
  {
    id: 'podcast-short',
    name: 'Podcast Vurgu & Snippet',
    category: 'social',
    type: 'podcast',
    description: 'Konuşmacı odaklı, otomatik sessizlik temizleme ve karaoke altyazıyla zenginleştirilmiş dikey klip.',
    targetBpm: 100,
    defaultFilter: 'clean-studio',
    aspectRatioPreference: '9:16',
    slots: [
      { startBeat: 0, durationBeats: 3, label: 'Şok Açıklama / Hook' },
      { startBeat: 3, durationBeats: 4, label: 'Tartışma / Hikaye Başlangıcı' },
      { startBeat: 7, durationBeats: 4, label: 'Kritik Fikir / Argüman' },
      { startBeat: 11, durationBeats: 3, label: 'Tepki & Kapanış Sorusu' }
    ]
  },
  {
    id: 'retro-vhs-90s',
    name: 'Retro 90s VHS Nostaljisi',
    category: 'creative',
    type: 'retro-90s',
    description: '90’lar nostaljik kamera tonu, retro gren ve analog video hissi.',
    targetBpm: 110,
    defaultFilter: 'vintage-90s',
    aspectRatioPreference: '1:1',
    slots: [
      { startBeat: 0, durationBeats: 2.5, label: 'VHS Giriş Kasedi', suggestedTransition: 'fade' },
      { startBeat: 2.5, durationBeats: 2.0, label: 'Nostaljik An 1', suggestedTransition: 'dissolve' },
      { startBeat: 4.5, durationBeats: 2.0, label: 'Nostaljik An 2', suggestedTransition: 'dissolve' },
      { startBeat: 6.5, durationBeats: 1.5, label: 'Hızlı Retro Kesit', suggestedTransition: 'wipe-left' },
      { startBeat: 8.0, durationBeats: 3.0, label: 'Retro Kapanış', suggestedTransition: 'fade' }
    ]
  },
  {
    id: 'gaming-montage',
    name: 'Gaming Aksiyon Montajı',
    category: 'viral',
    type: 'gaming',
    description: 'Oyun içi skor ve aksiyon anlarında hızlanan, vuruş odaklı dinamik klip montajı.',
    targetBpm: 140,
    defaultFilter: 'matrix-emerald',
    aspectRatioPreference: '16:9',
    slots: [
      { startBeat: 0, durationBeats: 2, label: 'Pusu / Hazırlık', suggestedTransition: 'dissolve' },
      { startBeat: 2, durationBeats: 0.5, label: 'Ateş / Vuruş 1', suggestedTransition: 'fade' },
      { startBeat: 2.5, durationBeats: 0.5, label: 'Vuruş 2', suggestedTransition: 'fade' },
      { startBeat: 3, durationBeats: 0.5, label: 'Vuruş 3', suggestedTransition: 'wipe-right' },
      { startBeat: 3.5, durationBeats: 2, label: 'Zafer / Kutlama', suggestedTransition: 'dissolve' }
    ]
  },
  {
    id: 'aesthetic-vlog',
    name: 'Aesthetic Lifestyle Vlog',
    category: 'creative',
    type: 'aesthetic',
    description: 'Dingin müzik eşliğinde pastel renkler, yumuşak geçişler ve minimal altyazı estetiği.',
    targetBpm: 85,
    defaultFilter: 'soft-pastel',
    aspectRatioPreference: '9:16',
    slots: [
      { startBeat: 0, durationBeats: 4, label: 'Gün Doğumu / Başlangıç', suggestedTransition: 'dissolve' },
      { startBeat: 4, durationBeats: 4, label: 'Kahve / Detay Çekimi', suggestedTransition: 'dissolve' },
      { startBeat: 8, durationBeats: 3, label: 'Yürüyüş / Manzara', suggestedTransition: 'dissolve' },
      { startBeat: 11, durationBeats: 4, label: 'Sakin Kapanış', suggestedTransition: 'fade' }
    ]
  },
  {
    id: 'fast-rhythm',
    name: 'Hızlı Ritim & Beat',
    category: 'rhythm',
    type: 'fast-rhythm',
    description: 'Klasik tek vuruşluk yüksek tempolu senkronize video kurgusu.',
    targetBpm: 120,
    defaultFilter: 'golden-hour',
    aspectRatioPreference: '16:9',
    slots: [
      { startBeat: 0, durationBeats: 1, label: 'Vuruş 1' },
      { startBeat: 1, durationBeats: 1, label: 'Vuruş 2' },
      { startBeat: 2, durationBeats: 1, label: 'Vuruş 3' },
      { startBeat: 3, durationBeats: 1, label: 'Vuruş 4' },
      { startBeat: 4, durationBeats: 2, label: 'Durgunluk' },
      { startBeat: 6, durationBeats: 1, label: 'Vuruş 5' },
      { startBeat: 7, durationBeats: 1, label: 'Vuruş 6' }
    ]
  }
];
