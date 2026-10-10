import type { SpeedCurveConfig, SpeedCurvePoint } from '../types';

/**
 * Evaluates the instantaneous speed multiplier at a normalized time t (0 to 1)
 * using linear interpolation across speed curve keyframe points.
 */
export function evaluateSpeedCurve(curve: SpeedCurveConfig | undefined, t: number): number {
  if (!curve || !curve.points || curve.points.length === 0) return 1.0;
  if (curve.points.length === 1) return curve.points[0].speed;

  const sorted = [...curve.points].sort((a, b) => a.time - b.time);
  if (t <= sorted[0].time) return sorted[0].speed;
  if (t >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].speed;

  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i];
    const p2 = sorted[i + 1];
    if (t >= p1.time && t <= p2.time) {
      const dt = p2.time - p1.time;
      if (dt <= 0.0001) return p1.speed;
      const progress = (t - p1.time) / dt;
      // Smooth cosine easing interpolation for natural ramp
      const smoothProgress = (1 - Math.cos(progress * Math.PI)) / 2;
      return p1.speed + (p2.speed - p1.speed) * smoothProgress;
    }
  }

  return 1.0;
}

/**
 * Standard CapCut / VN Speed Curve Templates
 */
export const SPEED_CURVE_PRESETS: {
  id: string;
  name: string;
  description: string;
  points: SpeedCurvePoint[];
}[] = [
  {
    id: 'hero',
    name: 'Hero (Kahraman)',
    description: 'Yavaş başlar (0.3x), ortada zirveye ulaşır (3.0x), sonunda tekrar yavaşlar.',
    points: [
      { time: 0.0, speed: 0.3 },
      { time: 0.2, speed: 0.5 },
      { time: 0.5, speed: 3.0 },
      { time: 0.8, speed: 0.5 },
      { time: 1.0, speed: 0.3 }
    ]
  },
  {
    id: 'bullet',
    name: 'Bullet (Mermi Zamanı)',
    description: 'Ultra hızlı geçiş (5.0x), kritik anda ağır çekim (0.2x), sonra tekrar hızlanma.',
    points: [
      { time: 0.0, speed: 4.0 },
      { time: 0.3, speed: 5.0 },
      { time: 0.45, speed: 0.2 },
      { time: 0.7, speed: 0.2 },
      { time: 1.0, speed: 3.5 }
    ]
  },
  {
    id: 'flash-in',
    name: 'Flash-In (Hızlı Giriş)',
    description: 'Çok hızlı bir darbe (4.0x) ile girip yavaşlayarak normal hıza oturur.',
    points: [
      { time: 0.0, speed: 4.5 },
      { time: 0.25, speed: 2.0 },
      { time: 0.6, speed: 1.0 },
      { time: 1.0, speed: 1.0 }
    ]
  },
  {
    id: 'flash-out',
    name: 'Flash-Out (Hızlı Çıkış)',
    description: 'Normal hızda ilerlerken klip sonuna doğru aniden fırlar (4.0x).',
    points: [
      { time: 0.0, speed: 1.0 },
      { time: 0.5, speed: 1.0 },
      { time: 0.8, speed: 2.5 },
      { time: 1.0, speed: 5.0 }
    ]
  },
  {
    id: 'jump-cut',
    name: 'Jump Cut (Ritim Patlaması)',
    description: 'Müzik vuruşlarına senkronize ritmik hız dalgalanması.',
    points: [
      { time: 0.0, speed: 0.5 },
      { time: 0.25, speed: 3.0 },
      { time: 0.5, speed: 0.4 },
      { time: 0.75, speed: 3.0 },
      { time: 1.0, speed: 0.8 }
    ]
  }
];
