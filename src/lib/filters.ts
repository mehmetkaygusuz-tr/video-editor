import type { FilterPreset } from './types';

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'teal-orange',
    name: 'Teal & Orange',
    category: 'cinematic',
    description: 'Hollywood sinematik standardı. Soğuk mavi gölgeler ve sıcak ten tonları.',
    grading: {
      brightness: 0.04,
      contrast: 1.25,
      saturation: 1.2,
      temperature: 0.28,
      tint: -0.18,
      lut: 'teal-orange'
    },
    previewGradient: 'linear-gradient(135deg, #0ea5e9 0%, #f97316 100%)'
  },
  {
    id: 'cyberpunk-neon',
    name: 'Cyberpunk Neon',
    category: 'creative',
    description: 'Fütüristik mor, neon camgöbeği ve yüksek doygunluklu gece tonu.',
    grading: {
      brightness: 0.02,
      contrast: 1.35,
      saturation: 1.45,
      temperature: -0.32,
      tint: 0.35,
      lut: 'cyberpunk'
    },
    previewGradient: 'linear-gradient(135deg, #a855f7 0%, #06b6d4 100%)'
  },
  {
    id: 'vintage-90s',
    name: 'Vintage VHS 90s',
    category: 'vintage',
    description: 'Nostaljik retro kamera tonu, yumuşak siyahlar ve sıcak tonlama.',
    grading: {
      brightness: 0.08,
      contrast: 0.88,
      saturation: 0.85,
      temperature: 0.18,
      tint: -0.06,
      lut: 'vintage'
    },
    previewGradient: 'linear-gradient(135deg, #d97706 0%, #78350f 100%)'
  },
  {
    id: 'noir-bw',
    name: 'Monochrome Noir',
    category: 'cinematic',
    description: 'Klasik sinema noir. Yüksek kontrastlı, dramatik siyah-beyaz.',
    grading: {
      brightness: -0.04,
      contrast: 1.45,
      saturation: 0.0,
      temperature: 0.0,
      tint: 0.0,
      lut: 'noir'
    },
    previewGradient: 'linear-gradient(135deg, #000000 0%, #737373 50%, #ffffff 100%)'
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    category: 'creative',
    description: 'Büyüleyici gün batımı sıcaklığı, altın sarısı ışıltı ve yumuşak ışık.',
    grading: {
      brightness: 0.07,
      contrast: 1.12,
      saturation: 1.22,
      temperature: 0.42,
      tint: -0.1,
      lut: 'golden-hour'
    },
    previewGradient: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)'
  },
  {
    id: 'bleach-bypass',
    name: 'Bleach Bypass',
    category: 'cinematic',
    description: 'Sert, düşük doygunluklu, mat ve agresif aksiyon filmi estetiği.',
    grading: {
      brightness: -0.03,
      contrast: 1.48,
      saturation: 0.52,
      temperature: -0.08,
      tint: -0.04,
      lut: 'bleach'
    },
    previewGradient: 'linear-gradient(135deg, #475569 0%, #1e293b 100%)'
  },
  {
    id: 'clean-studio',
    name: 'Studio Commercial',
    category: 'clean',
    description: 'Net, berrak ticari reklam ve ürün çekimi standardı.',
    grading: {
      brightness: 0.06,
      contrast: 1.14,
      saturation: 1.15,
      temperature: 0.02,
      tint: 0.0,
      lut: 'clean'
    },
    previewGradient: 'linear-gradient(135deg, #3b82f6 0%, #10b981 100%)'
  },
  {
    id: 'soft-pastel',
    name: 'Aesthetic Pastel',
    category: 'creative',
    description: 'Yumuşak, dingin vlog ve lifestyle renk paleti.',
    grading: {
      brightness: 0.1,
      contrast: 0.94,
      saturation: 0.88,
      temperature: 0.1,
      tint: 0.05,
      lut: 'pastel'
    },
    previewGradient: 'linear-gradient(135deg, #f472b6 0%, #c084fc 100%)'
  },
  {
    id: 'matrix-emerald',
    name: 'Matrix Emerald',
    category: 'creative',
    description: 'Bilim kurgu yeşil/zümrüt tonu, teknolojik estetik.',
    grading: {
      brightness: 0.02,
      contrast: 1.24,
      saturation: 1.12,
      temperature: -0.22,
      tint: -0.38,
      lut: 'matrix'
    },
    previewGradient: 'linear-gradient(135deg, #10b981 0%, #064e3b 100%)'
  }
];
