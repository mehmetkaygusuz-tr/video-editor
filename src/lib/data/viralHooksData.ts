/**
 * 2026 Viral Hook & Script Copilot Database
 * Yüksek kitle tutma (retention) ve izlenme oranına sahip 2026 güncel kanca şablonları.
 * 100% Yerel / Açık Kaynak - Sıfır API bağımlılığı.
 */

export interface ViralHook {
  id: string;
  category: 'curiosity' | 'controversy' | 'tutorial' | 'story' | 'warning' | 'productivity';
  categoryLabel: string;
  title: string;
  hookTemplate: string;
  sampleText: string;
  targetDurationSeconds: number; // Önerilen kanca süresi (1.5s - 3s)
  recommendedAnimation: 'pop' | 'typewriter' | 'glow' | 'bounce';
  soundDesignCue?: string; // Ör: 'whoosh' | 'sub-drop' | 'record-scratch'
}

export const VIRAL_HOOKS_DATABASE: ViralHook[] = [
  // 1. Merak & Gizem (Curiosity)
  {
    id: 'curiosity-secret',
    category: 'curiosity',
    categoryLabel: 'Gizem & Merak',
    title: 'Bunu Kimse Söylemiyor',
    hookTemplate: 'Sektörün sizden sakladığı en büyük sırrı açıklıyorum...',
    sampleText: 'Bunu kimse söylemiyor ama 2026\'da en hızlı büyümenin tek yolu bu.',
    targetDurationSeconds: 2.2,
    recommendedAnimation: 'pop',
    soundDesignCue: 'sub-drop'
  },
  {
    id: 'curiosity-wait',
    category: 'curiosity',
    categoryLabel: 'Gizem & Merak',
    title: 'Sonuna Kadar İzle',
    hookTemplate: 'Videonun sonundaki 5 saniyeyi görmeden geçmeyin...',
    sampleText: 'Sonuna kadar izleyin çünkü sonda göreceğiniz şey her şeyi değiştirecek.',
    targetDurationSeconds: 2.0,
    recommendedAnimation: 'glow',
    soundDesignCue: 'whoosh'
  },
  {
    id: 'curiosity-stop-scrolling',
    category: 'curiosity',
    categoryLabel: 'Gizem & Merak',
    title: 'Kaydırmayı Durdur',
    hookTemplate: 'Eğer [Konu] ile ilgileniyorsan bu videoyu geçme!',
    sampleText: 'Kaydırmayı durdur! Eğer içerik üretiyorsan bu 3 saniye senin için kritik.',
    targetDurationSeconds: 1.8,
    recommendedAnimation: 'bounce',
    soundDesignCue: 'record-scratch'
  },

  // 2. Uyarı & Kritik Hata (Warning)
  {
    id: 'warning-stop-doing-this',
    category: 'warning',
    categoryLabel: 'Kritik Uyarı',
    title: 'Bunu Yapmayı Hemen Bırakın',
    hookTemplate: 'Hala [Eylem] yapıyorsanız çok büyük hata yapıyorsunuz.',
    sampleText: 'Hala eski yöntemlerle edit yapıyorsanız saatlerinizi çöpe atıyorsunuz.',
    targetDurationSeconds: 2.5,
    recommendedAnimation: 'pop',
    soundDesignCue: 'sub-drop'
  },
  {
    id: 'warning-biggest-mistake',
    category: 'warning',
    categoryLabel: 'Kritik Uyarı',
    title: 'En Yaygın Yanılgı',
    hookTemplate: 'İnsanların %99\'u [Konu] hakkında bu hatayı yapıyor...',
    sampleText: 'İnsanların %99\'u video kurgularken bu kritik adımı atlıyor.',
    targetDurationSeconds: 2.3,
    recommendedAnimation: 'glow',
    soundDesignCue: 'whoosh'
  },

  // 3. Hızlı Taktik & Nasıl Yapılır (Tutorial)
  {
    id: 'tutorial-3-steps',
    category: 'tutorial',
    categoryLabel: 'Hızlı Taktik',
    title: '3 Adımda Çözüm',
    hookTemplate: 'Sadece 3 basit adımda [Hedef Sonuç] nasıl yapılır?',
    sampleText: 'Sadece 3 adımda telefonunuzdan stüdyo kalitesinde video üretin.',
    targetDurationSeconds: 2.0,
    recommendedAnimation: 'typewriter',
    soundDesignCue: 'pop'
  },
  {
    id: 'tutorial-cheat-code',
    category: 'tutorial',
    categoryLabel: 'Hızlı Taktik',
    title: 'Gizli Hile Kodu',
    hookTemplate: 'Bu ücretsiz özellik adeta bir hile kodu gibi...',
    sampleText: 'Bu açık kaynak yapay zeka aracı adeta profesyonel bir hile kodu!',
    targetDurationSeconds: 2.2,
    recommendedAnimation: 'bounce',
    soundDesignCue: 'whoosh'
  },

  // 4. Tartışmalı & Karşı Fikir (Controversy)
  {
    id: 'controversy-unpopular-opinion',
    category: 'controversy',
    categoryLabel: 'Karşı Fikir',
    title: 'Popüler Olmayan Gerçek',
    hookTemplate: 'Biliyorum linç yiyeceğim ama gerçek şu ki...',
    sampleText: 'Biliyorum tepki çekecek ama pahalı kameralar artık tamamen gereksiz.',
    targetDurationSeconds: 2.4,
    recommendedAnimation: 'pop',
    soundDesignCue: 'sub-drop'
  },

  // 5. Hikaye & Dönüşüm (Story)
  {
    id: 'story-from-zero',
    category: 'story',
    categoryLabel: 'Dönüşüm Hikayesi',
    title: 'Sıfırdan Başlangıç',
    hookTemplate: 'Buna ilk başladığımda kimse inanmamıştı ama...',
    sampleText: 'Bunu ilk denediğimde kimse inanmamıştı, şimdi ise sonuç bu!',
    targetDurationSeconds: 2.6,
    recommendedAnimation: 'glow',
    soundDesignCue: 'whoosh'
  },

  // 6. Verimlilik & Zaman Kazandıran (Productivity)
  {
    id: 'productivity-save-hours',
    category: 'productivity',
    categoryLabel: 'Verimlilik',
    title: 'Günde 2 Saat Kazan',
    hookTemplate: 'Bu tekniği öğrendikten sonra haftalık çalışma sürem yarıya indi...',
    sampleText: 'Bu yerel kurgu tekniği ile her videoda 2 saat zaman kazanıyorum.',
    targetDurationSeconds: 2.3,
    recommendedAnimation: 'typewriter',
    soundDesignCue: 'pop'
  }
];

export function getHooksByCategory(category?: string): ViralHook[] {
  if (!category || category === 'all') return VIRAL_HOOKS_DATABASE;
  return VIRAL_HOOKS_DATABASE.filter(h => h.category === category);
}

export function getRandomHook(category?: string): ViralHook {
  const pool = getHooksByCategory(category);
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] || VIRAL_HOOKS_DATABASE[0];
}
