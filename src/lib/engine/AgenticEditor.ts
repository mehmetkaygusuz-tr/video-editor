import { editor } from '../editor.svelte';
import { aiService } from './aiService.svelte';
import { MAGIC_TEMPLATES } from '../templates';
import type { TimelineClip, AgentIntentResult, AgentActionType } from '../types';

/**
 * AgenticEditor
 * Autonomous multi-track orchestration engine that executes structured video editing actions
 * based on natural language intent, audio beat analysis, VAD silence pruning, and AI transforms.
 */
export class AgenticEditor {
  /**
   * Deterministic Natural Language Intent Parser
   * Maps user Turkish/English prompts to formal editing commands and parameters.
   */
  parseIntent(prompt: string): AgentIntentResult {
    const p = prompt.trim().toLowerCase();

    // 0. Ses Kapatma (Mute) & Ses Seviyesi (Volume) - Checked FIRST to avoid conflict with silence cut
    if (
      p.includes('sessize al') ||
      p.includes('sesini kapat') ||
      p.includes('sesi kapat') ||
      p.includes('mute') ||
      p.includes('sesi kes')
    ) {
      return {
        action: 'TOGGLE_MUTE',
        confidence: 0.98,
        description: 'Videonun sesini kapat / sessize al'
      };
    }

    const volumeMatch = p.match(/(?:ses|volume|sesi)\s*(?:seviyesi|düzeyi)?\s*(?:%|yüzde)?\s*(\d+)/i) || p.match(/(\d+)\s*%\s*ses/i);
    if (volumeMatch && (p.includes('ses') || p.includes('volume'))) {
      const volPercent = parseInt(volumeMatch[1], 10);
      const vol = Math.max(0, Math.min(2, volPercent / 100));
      return {
        action: 'SET_VOLUME',
        confidence: 0.95,
        description: `Ses seviyesini %${volPercent} olarak ayarla`,
        params: { volume: vol }
      };
    }

    // 1. Sessizlik temizleme / Jump Cut (Safe check ensuring no "sessize al" false trigger)
    if (
      p.includes('sessizlik') ||
      p.includes('jump cut') ||
      p.includes('silence') ||
      p.includes('duraklama') ||
      p.includes('boşlukları sil') ||
      p.includes('ölü anlar') ||
      (p.includes('sessiz') && !p.includes('sessize'))
    ) {
      return {
        action: 'JUMP_CUT_SILENCE',
        confidence: 0.95,
        description: 'Konuşma aralarındaki tüm ölü sessizlikleri tespit edip manyetik olarak sil'
      };
    }

    // 2. Otomatik Altyazı / Transkripsiyon
    if (
      p.includes('altyazı') ||
      p.includes('caption') ||
      p.includes('sub') ||
      p.includes('transkript') ||
      p.includes('sesi yazı')
    ) {
      return {
        action: 'GENERATE_AUTO_SUBTITLES',
        confidence: 0.95,
        description: 'Klipteki konuşmaları Whisper AI ile transkribe edip altyazı üret'
      };
    }

    // 3. Ritim Senkronu / Şablon Kesimi
    if (
      p.includes('ritim') ||
      p.includes('ritm') ||
      p.includes('beat') ||
      p.includes('müzik') ||
      p.includes('müziğ') ||
      p.includes('tempo') ||
      p.includes('şablon')
    ) {
      return {
        action: 'BEAT_SYNC_CUT',
        confidence: 0.9,
        description: 'Müziğin vuruş noktalarına göre video klipleri dinamik ritme oturt'
      };
    }

    // 4. Arka Plan Silme / Segmentasyon
    if (
      p.includes('arka plan') ||
      p.includes('arkaplan') ||
      p.includes('background') ||
      p.includes('yeşil perde') ||
      p.includes('bg remove')
    ) {
      return {
        action: 'REMOVE_BACKGROUND',
        confidence: 0.95,
        description: 'RMBG-1.4 sinir ağı ile arka planı şeffaflaştır'
      };
    }

    // 5. Akıllı Dikey Kadraj / Reframe
    if (
      p.includes('dikey') ||
      p.includes('9:16') ||
      p.includes('reframe') ||
      p.includes('kadraj') ||
      p.includes('tiktok') ||
      p.includes('reels') ||
      p.includes('shorts')
    ) {
      return {
        action: 'SMART_REFRAME',
        confidence: 0.9,
        description: 'Yüz takip algoritmasıyla 9:16 dikey akıllı kırpma uygula'
      };
    }

    // 6. Hız Değiştirme
    const speedMatch = p.match(/(\d+(?:[.,]\d+)?)\s*(?:x|kat|hız|speed)/i) || p.match(/(?:hızlandır|hızı)\s*(\d+(?:[.,]\d+)?)/i);
    if (speedMatch || p.includes('hızlandır') || p.includes('yavaşlat') || p.includes('slow motion')) {
      let targetSpeed = 2.0;
      if (speedMatch && speedMatch[1]) {
        targetSpeed = parseFloat(speedMatch[1].replace(',', '.'));
      } else if (p.includes('yavaşlat') || p.includes('slow')) {
        targetSpeed = 0.5;
      }
      return {
        action: 'CHANGE_SPEED',
        confidence: 0.88,
        description: `Klip oynatma hızını ${targetSpeed}x olarak ayarla`,
        params: { speed: targetSpeed }
      };
    }

    // 7. Bölme / Kesme (Split at Playhead or given time)
    const timeMatch = p.match(/(\d+(?:[.,]\d+)?)\s*(?:sn|saniye|sec|s)/i);
    if (p.includes('böl') || p.includes('kes') || p.includes('split')) {
      const splitSec = timeMatch ? parseFloat(timeMatch[1].replace(',', '.')) : editor.playhead;
      return {
        action: 'SPLIT_AT_PLAYHEAD',
        confidence: 0.85,
        description: `${splitSec.toFixed(2)}. saniyeden klibi ikiye böl`,
        params: { time: splitSec }
      };
    }

    // 8. Başı / Sonu Manyetik Kırp
    if (p.includes('başı') || p.includes('başını kırp') || p.includes('trim head')) {
      return {
        action: 'RIPPLE_TRIM_HEAD',
        confidence: 0.9,
        description: 'Oynatma kafasından önceki kısmı kırp ve zaman çizelgesini sola kaydır'
      };
    }
    if (p.includes('sonu') || p.includes('sonunu kırp') || p.includes('trim tail')) {
      return {
        action: 'RIPPLE_TRIM_TAIL',
        confidence: 0.9,
        description: 'Oynatma kafasından sonraki kısmı kırp ve klipleri birleştir'
      };
    }

    // 9. Çoğaltma / Duplicate
    if (p.includes('çoğalt') || p.includes('kopyasını çıkar') || p.includes('duplicate')) {
      return {
        action: 'DUPLICATE_CLIP',
        confidence: 0.95,
        description: 'Seçili klibin kopyasını oluşturup zaman çizelgesine ekle'
      };
    }

    // 10. Silme (Delete selected clip)
    if (
      p === 'sil' ||
      p === 'kaldır' ||
      p.includes('klibi sil') ||
      p.includes('klibi kaldır') ||
      p.includes('seçiliyi sil') ||
      p.includes('seçili klibi') ||
      p.includes('videoyu sil') ||
      p.includes('delete clip') ||
      p.includes('çöpe at')
    ) {
      return {
        action: 'DELETE_SELECTED',
        confidence: 0.85,
        description: 'Seçili klibi zaman çizelgesinden tamamen kaldır'
      };
    }

    // 11. Yapay Zeka Seslendirme / Kokoro TTS
    if (
      p.includes('seslendir') ||
      p.includes('ses üret') ||
      p.includes('tts') ||
      p.includes('voiceover') ||
      p.includes('konuşma ekle')
    ) {
      let speechText = 'Yeni video projeme hoş geldiniz.';
      const colonMatch = prompt.match(/(?:seslendir|ses üret|tts|voiceover|konuşma ekle)\s*[:=]\s*(.+)/i);
      if (colonMatch && colonMatch[1]?.trim()) {
        speechText = colonMatch[1].trim();
      } else {
        const cleaned = prompt.replace(/(?:seslendir|ses üret|tts|voiceover|konuşma ekle)/gi, '').trim();
        if (cleaned) speechText = cleaned;
      }
      return {
        action: 'GENERATE_TTS',
        confidence: 0.95,
        description: `Kokoro-82M AI ile "${speechText.slice(0, 25)}..." seslendirmesi üret`,
        params: { text: speechText }
      };
    }

    // 12. Metin / Başlık Katmanı Ekleme
    if (
      p.includes('yazı ekle') ||
      p.includes('metin ekle') ||
      p.includes('başlık ekle') ||
      p.includes('add text') ||
      p.includes('yazı yaz')
    ) {
      let textOverlay = 'Yeni Başlık';
      const colonMatch = prompt.match(/(?:yazı ekle|metin ekle|başlık ekle|add text|yazı yaz)\s*[:=]\s*(.+)/i);
      if (colonMatch && colonMatch[1]?.trim()) {
        textOverlay = colonMatch[1].trim();
      } else {
        const cleaned = prompt.replace(/(?:yazı ekle|metin ekle|başlık ekle|add text|yazı yaz)/gi, '').trim();
        if (cleaned) textOverlay = cleaned;
      }
      return {
        action: 'ADD_TEXT_OVERLAY',
        confidence: 0.9,
        description: `"${textOverlay}" metin katmanını ekle`,
        params: { text: textOverlay }
      };
    }

    // 13. Geri Al / Yinele
    if (p.includes('geri al') || p.includes('undo')) {
      return {
        action: 'UNDO',
        confidence: 0.99,
        description: 'Son işlemi geri al'
      };
    }
    if (p.includes('yinele') || p.includes('ileri al') || p.includes('redo')) {
      return {
        action: 'REDO',
        confidence: 0.99,
        description: 'Geri alınan işlemi yinele'
      };
    }

    // 14. Renkleri Tümüne Yay / Kopyala
    if (p.includes('tümüne yay') || p.includes('tüm kliplere yay') || p.includes('bütün kliplere uygula') || p.includes('renkleri tümüne')) {
      return {
        action: 'COPY_GRADE_TO_ALL',
        confidence: 0.95,
        description: 'Seçili klibin renk ve LUT ayarını projedeki tüm video parçalarına kopyala'
      };
    }

    // 15. Renkleri Sıfırla
    if (p.includes('renkleri sıfırla') || p.includes('renk sıfırla') || p.includes('filtreyi kaldır') || p.includes('orijinal renge dön')) {
      return {
        action: 'RESET_COLOR_GRADING',
        confidence: 0.95,
        description: 'Renk ve filtre ayarlarını sıfırlayıp doğal haline döndür'
      };
    }

    // 16. Tek Tıkla Renk İyileştirme / Auto Color
    if (
      p.includes('otomatik renk') ||
      p.includes('renkleri düzelt') ||
      p.includes('renk iyileştir') ||
      p.includes('auto color') ||
      p.includes('sinematik renk')
    ) {
      return {
        action: 'AUTO_COLOR_ENHANCE',
        confidence: 0.94,
        description: 'Oklab renk bilimiyle sahneyi analiz edip dinamik renk ve kontrastı otomatik iyileştir'
      };
    }

    // 17. Renk Filtresi Uygulama
    if (
      p.includes('filtre') ||
      p.includes('lut') ||
      p.includes('teal orange') ||
      p.includes('cyberpunk') ||
      p.includes('vintage') ||
      p.includes('retro') ||
      p.includes('siyah beyaz') ||
      p.includes('noir') ||
      p.includes('golden hour')
    ) {
      let filterId = 'teal-orange';
      if (p.includes('cyberpunk') || p.includes('neon')) filterId = 'cyberpunk-neon';
      else if (p.includes('vintage') || p.includes('retro') || p.includes('90')) filterId = 'vintage-90s';
      else if (p.includes('siyah beyaz') || p.includes('noir') || p.includes('bw')) filterId = 'noir-bw';
      else if (p.includes('golden') || p.includes('gün batımı') || p.includes('altın')) filterId = 'golden-hour';
      else if (p.includes('bleach') || p.includes('mat')) filterId = 'bleach-bypass';
      else if (p.includes('pastel')) filterId = 'soft-pastel';
      else if (p.includes('matrix') || p.includes('zümrüt')) filterId = 'matrix-emerald';

      return {
        action: 'APPLY_FILTER',
        confidence: 0.92,
        description: `"${filterId}" sinematik renk filtresini videoya uygula`,
        params: { filterId }
      };
    }

    // 18. Dip Gürültü Temizleme / Denoise
    if (
      p.includes('gürültü') ||
      p.includes('sesi temizle') ||
      p.includes('denoise') ||
      p.includes('hiss') ||
      p.includes('arka plan ses') ||
      p.includes('uğultu')
    ) {
      return {
        action: 'DENOISE_AUDIO',
        confidence: 0.95,
        description: 'Spectral Gate filtresiyle dip uğultuyu temizle ve insan sesini netleştir'
      };
    }

    // 19. Viral Kanca & Senaryo Üretimi
    if (
      p.includes('viral') ||
      p.includes('kanca') ||
      p.includes('hook') ||
      p.includes('senaryo') ||
      p.includes('başlık öner') ||
      p.includes('fikir ver')
    ) {
      return {
        action: 'GENERATE_VIRAL_HOOKS',
        confidence: 0.92,
        description: 'Agentic Script AI ile video için viral kancalar ve kurgu fikirleri sentezle'
      };
    }

    // 20. Geçiş Efektleri
    if (p.includes('geçiş ekle') || p.includes('geçiş efekti') || p.includes('geçiş koy') || p.includes('crossfade') || p.includes('transition')) {
      return {
        action: 'OPEN_TRANSITIONS',
        confidence: 0.95,
        description: 'Geçiş efektleri seçicisini aç'
      };
    }

    // 21. En/Boy Oranı Değiştirme
    if (p.includes('9:16') || p.includes('dikey') || p.includes('shorts yap') || p.includes('tiktok yap')) {
      return {
        action: 'SET_ASPECT_RATIO',
        confidence: 0.95,
        description: 'Video oranını 9:16 dikey (TikTok/Shorts/Reels) olarak ayarla',
        params: { ratio: '9:16' }
      };
    }
    if (p.includes('16:9') || p.includes('yatay') || p.includes('youtube yap')) {
      return {
        action: 'SET_ASPECT_RATIO',
        confidence: 0.95,
        description: 'Video oranını 16:9 geniş ekran (YouTube) olarak ayarla',
        params: { ratio: '16:9' }
      };
    }
    if (p.includes('1:1') || p.includes('kare')) {
      return {
        action: 'SET_ASPECT_RATIO',
        confidence: 0.95,
        description: 'Video oranını 1:1 kare formatına ayarla',
        params: { ratio: '1:1' }
      };
    }

    // 22. Dışa Aktarma / Export
    if (p.includes('dışa aktar') || p.includes('export') || p.includes('render al') || p.includes('videoyu indir') || p.includes('kaydet')) {
      return {
        action: 'OPEN_EXPORT',
        confidence: 0.96,
        description: '4K Ultra-HD Dışa Aktarma penceresini aç'
      };
    }

    // 23. Proje Temizleme / Sıfırlama
    if (p.includes('projeyi sıfırla') || p.includes('yeni proje') || p.includes('her şeyi temizle') || p.includes('baştan başla') || p.includes('reset project')) {
      return {
        action: 'RESET_PROJECT',
        confidence: 0.96,
        description: 'Zaman çizelgesini temizle ve yeni bir boş proje başlat'
      };
    }

    // 24. AI Kontrol Merkezi & Modeller
    if (
      p.includes('ai merkezi') ||
      p.includes('kontrol merkezi') ||
      p.includes('ai paneli') ||
      p.includes('ai kontrol') ||
      p.includes('model hub') ||
      p.includes('ai hub') ||
      p.includes('modeller') ||
      p.includes('lisans') ||
      p.includes('yapay zeka merkezi')
    ) {
      return {
        action: 'OPEN_AI_CENTER',
        confidence: 0.98,
        description: 'Yapay Zeka Üretim Merkezi ve Model Lisansları panelini aç'
      };
    }

    // Fallback: Safe unrecognized prompt notice (never destructively cut up video)
    return {
      action: 'UNKNOWN_INTENT',
      confidence: 0.1,
      description: `"${prompt}" komutu anlaşılamadı. Lütfen önerilen akıllı eylemleri deneyin.`
    };
  }


  /**
   * Main Autonomous Execution Pipeline
   * Takes a natural language prompt, maps it to a concrete editing tool, and executes it.
   * Supports multi-step chaining (e.g., "Sessizlikleri sil ve altyazı üret").
   */
  async executeNaturalLanguageCommand(prompt: string): Promise<{ success: boolean; message: string }> {
    if (!prompt.trim()) return { success: false, message: 'Boş komut girildi.' };

    // Support multi-command chaining
    const chainDelimiters = /\s+(?:ve|ardından|sonra|sonrasında|and\s+then|then|and)\s+/i;
    if (chainDelimiters.test(prompt)) {
      const subCommands = prompt.split(chainDelimiters).map(s => s.trim()).filter(Boolean);
      if (subCommands.length > 1) {
        aiService.addLog(`[AgenticEditor] Çoklu Zincirleme Komut Algılandı (${subCommands.length} adım): ${subCommands.join(' -> ')}`, 'info');
        const results: string[] = [];
        for (let i = 0; i < subCommands.length; i++) {
          const sub = subCommands[i];
          editor.announce(`Adım ${i + 1}/${subCommands.length}: "${sub}"`);
          const res = await this.executeSingleCommand(sub);
          results.push(res.message);
          if (!res.success) {
            return { success: false, message: `Adım ${i + 1} başarısız: ${res.message}` };
          }
        }
        return { success: true, message: `Tüm adımlar tamamlandı: ${results.join(' | ')}` };
      }
    }

    return this.executeSingleCommand(prompt);
  }

  /**
   * Executes a single atomic natural language intent with telemetry.
   */
  private async executeSingleCommand(prompt: string): Promise<{ success: boolean; message: string }> {
    const startTime = performance.now();
    const intent = this.parseIntent(prompt);
    
    // Model identifier for telemetry
    const modelMap: Record<AgentActionType, string> = {
      JUMP_CUT_SILENCE: 'ONNX Silero VAD v5 [WebGPU]',
      GENERATE_AUTO_SUBTITLES: 'onnx-community/whisper-tiny [WebGPU]',
      BEAT_SYNC_CUT: 'Web Audio BPM Analyzer',
      REMOVE_BACKGROUND: 'briaai/RMBG-1.4 [WebGPU]',
      SMART_REFRAME: 'MediaPipe BlazeFace AI',
      GENERATE_TTS: 'Kokoro-82M-v1.0 [WebGPU]',
      CHANGE_SPEED: 'Bézier Speed Curve Engine',
      SPLIT_AT_PLAYHEAD: 'Magnetic Timeline Engine',
      RIPPLE_TRIM_HEAD: 'Magnetic Timeline Engine',
      RIPPLE_TRIM_TAIL: 'Magnetic Timeline Engine',
      DELETE_SELECTED: 'Magnetic Timeline Engine',
      ADD_TEXT_OVERLAY: 'Canvas Typography Engine',
      APPLY_FILTER: 'Oklab Color Science Engine',
      AUTO_COLOR_ENHANCE: 'Oklab Smart Color Profiler',
      DENOISE_AUDIO: 'Web Audio Spectral Gate',
      GENERATE_VIRAL_HOOKS: 'Agentic Script AI (On-Device)',
      APPLY_TEMPLATE: 'Autonomous Rhythm Orchestrator',
      SET_ASPECT_RATIO: 'Viewport Geometry Engine',
      OPEN_AI_CENTER: 'AI Orchestration Core',
      SET_VOLUME: 'Web Audio DSP Gain Controller',
      TOGGLE_MUTE: 'Web Audio DSP Mute Stage',
      DUPLICATE_CLIP: 'Magnetic Timeline Engine',
      COPY_GRADE_TO_ALL: 'Oklab Color Science Engine',
      RESET_COLOR_GRADING: 'Oklab Color Science Engine',
      OPEN_TRANSITIONS: 'Spatial Transition Engine',
      OPEN_EXPORT: 'Hardware Accelerated MediaCodec Pipeline',
      RESET_PROJECT: 'Studio State Orchestrator',
      UNDO: 'Timeline History Engine',
      REDO: 'Timeline History Engine',
      UNKNOWN_INTENT: 'AI Command Engine'
    };

    const activeModel = modelMap[intent.action] || 'Agentic Orchestration Core';

    editor.updateAgentTelemetry({
      lastAction: intent.action,
      lastIntentPrompt: prompt,
      confidence: intent.confidence,
      status: 'executing',
      activeModel
    });

    aiService.addLog(`[AgenticEditor] Doğal Dil Algılandı: "${prompt}" -> ${intent.action} (${activeModel})`, 'info');
    editor.announce(`AI Direktörü: ${intent.description}`);

    try {
      editor.isProcessing = true;

      let result: { success: boolean; message: string };

      switch (intent.action) {
        case 'UNKNOWN_INTENT': {
          result = {
            success: false,
            message: `Komut anlaşılamadı. Örn: "Sessizlikleri sil", "Altyazı üret", "2x hızlandır", "9:16 dikey yap"`
          };
          break;
        }

        case 'UNDO':
          editor.undo();
          result = { success: true, message: 'İşlem geri alındı.' };
          break;

        case 'REDO':
          editor.redo();
          result = { success: true, message: 'İşlem yinelendi.' };
          break;

        case 'JUMP_CUT_SILENCE': {
          const clip = editor.getSelectedClip() || editor.ensureSampleVideoClip();
          await this.analyzeClipContext(clip.id);
          await this.removeSilencesFromClip(clip.id);
          result = { success: true, message: 'Sessizlikler temizlendi ve klipler manyetik bağlandı.' };
          break;
        }

        case 'GENERATE_AUTO_SUBTITLES': {
          const clip = editor.getSelectedClip() || editor.ensureSampleVideoClip();
          await aiService.generateCaptionsForClip(clip.id);
          result = { success: true, message: 'Klip için Whisper altyazıları başarıyla oluşturuldu.' };
          break;
        }

        case 'BEAT_SYNC_CUT': {
          const audioClip = editor.ensureSampleAudioClip();
          const videoClips = editor.tracks
            .flatMap(t => t.clips)
            .filter(c => c.type === 'video' || c.type === 'image');
          
          let videoAssetIds = videoClips.map(c => c.assetId).filter(Boolean) as string[];
          if (videoAssetIds.length === 0) {
            const v = editor.ensureSampleVideoClip();
            if (v.assetId) videoAssetIds = [v.assetId];
          }

          if (audioClip.assetId) {
            await this.applyTemplate('fast-rhythm', audioClip.assetId, videoAssetIds);
            result = { success: true, message: 'Müzik ritmine göre kesimler başarıyla uygulandı.' };
          } else {
            result = { success: false, message: 'Ritim analizi için ses klibi bulunamadı.' };
          }
          break;
        }

        case 'REMOVE_BACKGROUND': {
          const clip = editor.getSelectedClip() || editor.ensureSampleVideoClip();
          editor.selectedClipId = clip.id;
          await aiService.removeBackground();
          result = { success: true, message: 'Arka plan başarıyla kaldırıldı.' };
          break;
        }

        case 'SMART_REFRAME': {
          const clip = editor.getSelectedClip() || editor.ensureSampleVideoClip();
          editor.selectedClipId = clip.id;
          await aiService.autoReframe(clip.id);
          editor.aspectRatio = '9:16';
          result = { success: true, message: '9:16 Dikey Akıllı Kadraj uygulandı.' };
          break;
        }

        case 'GENERATE_TTS': {
          const text = intent.params?.text || 'Yeni video projeme hoş geldiniz.';
          await aiService.generateSpeech(text, 'af_bella');
          result = { success: true, message: `Kokoro-82M ile "${text.slice(0, 20)}..." seslendirmesi oluşturuldu.` };
          break;
        }

        case 'ADD_TEXT_OVERLAY': {
          const text = intent.params?.text || 'Yeni Başlık';
          let textTrack = editor.tracks.find(t => t.name === 'Yazı' || t.name === 'T1' || t.name.startsWith('T'));
          if (!textTrack) {
            editor.addTrack('T1');
            textTrack = editor.tracks[editor.tracks.length - 1];
          }
          const clipDur = 4.0;
          editor.addClip(textTrack.id, text, editor.playhead, clipDur, '#f59e0b', undefined, { type: 'text' });
          editor.saveState();
          result = { success: true, message: `"${text}" metin katmanı eklendi.` };
          break;
        }

        case 'CHANGE_SPEED': {
          const clip = editor.getSelectedClip() || editor.ensureSampleVideoClip();
          const speed = intent.params?.speed ?? 2.0;
          editor.setClipSpeed(clip.id, speed);
          result = { success: true, message: `Klip hızı ${speed}x olarak güncellendi.` };
          break;
        }

        case 'SPLIT_AT_PLAYHEAD': {
          const targetTime = intent.params?.time ?? editor.playhead;
          editor.playhead = targetTime;
          editor.splitClipAtPlayhead(editor.selectedClipId || undefined);
          result = { success: true, message: `Klip ${targetTime.toFixed(2)}s noktasından bölündü.` };
          break;
        }

        case 'RIPPLE_TRIM_HEAD': {
          editor.rippleTrimHead();
          result = { success: true, message: 'Başlangıç kısmı kırpıldı.' };
          break;
        }

        case 'RIPPLE_TRIM_TAIL': {
          editor.rippleTrimTail();
          result = { success: true, message: 'Bitiş kısmı kırpıldı.' };
          break;
        }

        case 'DELETE_SELECTED': {
          if (editor.selectedClipId) {
            editor.deleteClip(editor.selectedClipId);
            result = { success: true, message: 'Seçili klip silindi.' };
          } else {
            result = { success: false, message: 'Silinecek klip seçilmedi.' };
          }
          break;
        }

        case 'AUTO_COLOR_ENHANCE': {
          const clip = editor.getSelectedClip() || editor.ensureSampleVideoClip();
          await aiService.autoColorEnhance(clip.id);
          result = { success: true, message: `"${clip.name}" için sinematik renk iyileştirmesi yapıldı.` };
          break;
        }

        case 'APPLY_FILTER': {
          const filterId = intent.params?.filterId || 'teal-orange';
          if (editor.selectedClipId) {
            editor.applyFilterToClip(editor.selectedClipId, filterId);
          } else {
            editor.applyFilterToAllClips(filterId);
          }
          result = { success: true, message: `"${filterId}" renk filtresi başarıyla uygulandı.` };
          break;
        }

        case 'DENOISE_AUDIO': {
          const clip = editor.getSelectedClip() || 
            editor.tracks.find(t => t.name.startsWith('A'))?.clips[0] || 
            editor.tracks.flatMap(t => t.clips).find(c => c.type === 'audio');
          if (clip) {
            await aiService.denoiseAudio(clip.id);
            result = { success: true, message: 'Dip gürültü temizlendi ve insan sesi parlatıldı.' };
          } else {
            result = { success: false, message: 'Denoise uygulanacak ses klibi bulunamadı.' };
          }
          break;
        }

        case 'GENERATE_VIRAL_HOOKS': {
          const hooksResult = await aiService.generateViralHooks();
          // Add top hook as a title overlay
          let textTrack = editor.tracks.find(t => t.name === 'Yazı' || t.name === 'T1' || t.name.startsWith('T'));
          if (!textTrack) {
            editor.addTrack('T1');
            textTrack = editor.tracks[editor.tracks.length - 1];
          }
          editor.addClip(textTrack.id, hooksResult.title, editor.playhead, 3.5, '#ec4899', undefined, { type: 'text' });
          editor.saveState();
          result = { success: true, message: `Viral kanca oluşturuldu: "${hooksResult.title}"` };
          break;
        }

        case 'SET_ASPECT_RATIO': {
          const ratio = intent.params?.ratio || '9:16';
          editor.aspectRatio = ratio;
          editor.saveState();
          editor.announce(`En-boy oranı ${ratio} olarak ayarlandı.`);
          result = { success: true, message: `Video görünüm oranı ${ratio} yapıldı.` };
          break;
        }

        case 'APPLY_TEMPLATE': {
          const tmplId = intent.params?.templateId || 'viral-tiktok-hook';
          const audioClip = editor.ensureSampleAudioClip();
          const videoClips = editor.tracks.flatMap(t => t.clips).filter(c => c.type === 'video' || c.type === 'image');
          let videoAssetIds = videoClips.map(c => c.assetId).filter(Boolean) as string[];
          if (videoAssetIds.length === 0) {
            const v = editor.ensureSampleVideoClip();
            if (v.assetId) videoAssetIds = [v.assetId];
          }
          if (audioClip.assetId) {
            await this.applyTemplate(tmplId, audioClip.assetId, videoAssetIds);
            result = { success: true, message: `"${tmplId}" şablonu başarıyla uygulandı.` };
          } else {
            result = { success: false, message: 'Şablon için ses dosyası bulunamadı.' };
          }
          break;
        }

        case 'TOGGLE_MUTE': {
          const clip = editor.getSelectedClip() || editor.tracks.flatMap(t => t.clips).find(c => c.type === 'video' || c.type === 'audio');
          if (clip) {
            const newVol = (clip.volume ?? 1) > 0 ? 0 : 1;
            editor.setClipVolume(clip.id, newVol);
            result = { success: true, message: newVol === 0 ? 'Klip sesi kapatıldı (Mute).' : 'Klip sesi açıldı.' };
          } else {
            result = { success: false, message: 'Sesi kapatılacak klip bulunamadı.' };
          }
          break;
        }

        case 'SET_VOLUME': {
          const clip = editor.getSelectedClip() || editor.tracks.flatMap(t => t.clips).find(c => c.type === 'video' || c.type === 'audio');
          const vol = intent.params?.volume ?? 1;
          if (clip) {
            editor.setClipVolume(clip.id, vol);
            result = { success: true, message: `Ses seviyesi %${Math.round(vol * 100)} olarak ayarlandı.` };
          } else {
            result = { success: false, message: 'Ses seviyesi ayarlanacak klip bulunamadı.' };
          }
          break;
        }

        case 'DUPLICATE_CLIP': {
          editor.duplicateClip();
          result = { success: true, message: 'Klip başarıyla çoğaltıldı.' };
          break;
        }

        case 'COPY_GRADE_TO_ALL': {
          const clip = editor.getSelectedClip();
          if (clip && clip.colorGrading) {
            const grading = { ...clip.colorGrading };
            for (const track of editor.tracks) {
              for (const c of track.clips) {
                if (c.type !== 'audio' && c.type !== 'text') {
                  c.colorGrading = { ...grading };
                }
              }
            }
            editor.saveState();
            result = { success: true, message: 'Renk ve filtre ayarları projedeki tüm video parçalarına kopyalandı.' };
          } else {
            result = { success: false, message: 'Renk ayarları kopyalanacak bir klip seçilmedi.' };
          }
          break;
        }

        case 'RESET_COLOR_GRADING': {
          const clip = editor.getSelectedClip();
          if (clip) {
            editor.updateClip(clip.id, {
              colorGrading: { brightness: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0 }
            });
            result = { success: true, message: 'Seçili klibin renk ayarları sıfırlandı.' };
          } else {
            for (const track of editor.tracks) {
              for (const c of track.clips) {
                if (c.type !== 'audio' && c.type !== 'text') {
                  c.colorGrading = { brightness: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0 };
                }
              }
            }
            editor.saveState();
            result = { success: true, message: 'Tüm kliplerin renk ayarları sıfırlandı.' };
          }
          break;
        }

        case 'OPEN_TRANSITIONS': {
          editor.openBottomSheet('transitions');
          result = { success: true, message: 'Geçiş efektleri seçicisi açıldı.' };
          break;
        }

        case 'OPEN_EXPORT': {
          editor.isExportOpen = true;
          result = { success: true, message: 'Dışa Aktarma (4K Ultra-HD) penceresi açıldı.' };
          break;
        }

        case 'RESET_PROJECT': {
          for (const track of editor.tracks) {
            track.clips = [];
          }
          editor.playhead = 0;
          editor.duration = 10;
          editor.selectedClipId = null;
          editor.saveState();
          result = { success: true, message: 'Proje temizlendi ve yeni boş proje başlatıldı.' };
          break;
        }

        case 'OPEN_AI_CENTER': {
          editor.activeSidebarTab = 'ai';
          editor.mobileWorkspace = 'ai';
          result = { success: true, message: 'AI Kurgu sekmesi açıldı.' };
          break;
        }

        default:
          result = { success: false, message: 'Komut anlaşılamadı veya desteklenmiyor.' };
      }

      const execDuration = Math.round(performance.now() - startTime);
      editor.updateAgentTelemetry({
        status: result.success ? 'completed' : 'error',
        executionTimeMs: execDuration
      });

      return result;
    } catch (err: any) {
      const execDuration = Math.round(performance.now() - startTime);
      editor.updateAgentTelemetry({
        status: 'error',
        executionTimeMs: execDuration
      });
      aiService.addLog(`[AgenticEditor] Yürütme Hatası: ${err.message}`, 'error');
      editor.announce(`Hata: ${err.message}`);
      return { success: false, message: err.message };
    } finally {
      editor.isProcessing = false;
    }
  }

  async applyTemplate(templateId: string, audioAssetId: string, videoAssetIds: string[]) {
    try {
      const template = MAGIC_TEMPLATES.find(t => t.id === templateId);
      if (!template) throw new Error('Şablon bulunamadı.');

      editor.announce(`"${template.name}" AI şablonu başlatılıyor...`);
      aiService.addLog(`[AgenticEditor] "${template.name}" orkestrasyonu başlatıldı...`);
      
      editor.isProcessing = true;

      // 1. Audio Beat Analysis
      aiService.addLog(`[AgenticEditor] 1. Aşama: Müzik analizi ve ritim çıkarma...`);
      const audioAsset = editor.assets.find(a => a.id === audioAssetId);
      if (!audioAsset) throw new Error('Seçilen müzik dosyası kütüphanede bulunamadı.');
      
      // Temporarily add audio to timeline to extract PCM
      let aTrack = editor.tracks.find(t => t.name.startsWith('A')) || editor.tracks[0];
      if (!aTrack) {
        editor.addTrack('A1');
        aTrack = editor.tracks[editor.tracks.length - 1];
      }
      
      const tempAudioClipId = crypto.randomUUID();
      editor.addClip(
        aTrack.id, 
        audioAsset.name, 
        0, 
        audioAsset.duration || 10, 
        '#10b981', 
        audioAsset.id, 
        { type: 'audio', id: tempAudioClipId }
      );
      
      const audioClip = aTrack.clips.find(c => c.id === tempAudioClipId);
      
      // Extract audio and run Beat Detection
      const { audioData } = await aiService.extractAudioPcmFromClip(audioClip!, 44100);
      const beatRes = await aiService.sendTask<{ beats: number[]; bpm: number }>(
        'DETECT_BEATS',
        { audioData, sampleRate: 44100 },
        'beat_detector',
        [audioData.buffer]
      );
      
      let beats = beatRes?.beats || [];
      const bpm = beatRes?.bpm || 120;
      
      if (beats.length === 0) {
        // Müzikte belirgin vuruş bulunamadıysa standart ritmik grid (120 BPM tempo) oluştur
        const audioDuration = audioAsset.duration || 10;
        const beatInterval = 60 / bpm;
        for (let t = 0; t < audioDuration; t += beatInterval) {
          beats.push(Number(t.toFixed(3)));
        }
      }

      // We have beats! Now let's calculate slot timings
      const slotTimings: { start: number; duration: number }[] = [];
      
      let currentBeatIndex = 0;
      for (const slot of template.slots) {
        const beatOffset = slot.startBeat;
        const durationBeats = slot.durationBeats;
        
        const absoluteStartIndex = currentBeatIndex + beatOffset;
        const absoluteEndIndex = absoluteStartIndex + durationBeats;
        
        if (absoluteStartIndex < beats.length && absoluteEndIndex < beats.length) {
          const startTime = beats[absoluteStartIndex];
          const endTime = beats[absoluteEndIndex];
          slotTimings.push({ start: startTime, duration: endTime - startTime });
        }
      }
      
      aiService.addLog(`[AgenticEditor] 2. Aşama: ${slotTimings.length} adet ritim yuvası (slot) hesaplandı.`);
      
      // Clear video track for new template sequence
      const vTrack = editor.tracks.find(t => t.name.startsWith('V'));
      if (vTrack) vTrack.clips = [];
      
      // Insert clips into slots
      let videoQueue = [...videoAssetIds];
      
      for (const timing of slotTimings) {
        if (videoQueue.length === 0) {
          videoQueue = [...videoAssetIds];
        }
        
        const vidId = videoQueue.shift();
        const vidAsset = editor.assets.find(a => a.id === vidId);
        
        if (vidAsset && vTrack) {
           editor.addClip(
             vTrack.id,
             vidAsset.name,
             timing.start,
             timing.duration,
             vidAsset.color || '#2563eb',
             vidAsset.id,
             {
               type: 'video',
               sourceOffset: 0
             }
           );
        }
      }

      editor.saveState();
      editor.announce(`Şablon başarıyla uygulandı! Müzik ritmine göre kesimler yapıldı.`);
      aiService.addLog(`[AgenticEditor] Orkestrasyon tamamlandı.`);

    } catch (err: any) {
      editor.announce(`Şablon hatası: ${err.message}`);
      aiService.addLog(`[AgenticEditor] Hata: ${err.message}`, 'error');
      throw err;
    } finally {
      editor.isProcessing = false;
    }
  }

  async analyzeClipContext(clipId: string) {
    try {
      const clip = editor.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
      if (!clip) return;
      
      editor.isProcessing = true;
      aiService.addLog(`[AgenticEditor] ${clip.name} için Akıllı Analiz başlatılıyor...`);

      const { audioData, isRealMedia } = await aiService.extractAudioPcmFromClip(clip, 16000);
      const sampleRate = 16000;
      
      // Parallel execution of VAD and Whisper
      const [vadRes, transRes] = await Promise.all([
        aiService.sendTask<{ speechSegments: any[], silenceSegments: any[] }>(
          'DETECT_SILENCE',
          { audioData, sampleRate },
          'silero_vad'
        ),
        aiService.sendTask<{ text: string, subtitles: any[] }>(
          'TRANSCRIBE_AUDIO',
          { audioData, sampleRate, isRealMedia },
          'whisper_captions'
        )
      ]);

      if (vadRes?.silenceSegments) {
         clip.vadSilences = vadRes.silenceSegments;
      }
      if (transRes?.subtitles) {
         clip.subtitles = transRes.subtitles;
      }

      editor.saveState();
      editor.announce(`${clip.name} analizi tamamlandı. Sessizlikler ve metinler zaman çizelgesinde görülebilir.`);
      aiService.addLog(`[AgenticEditor] Analiz tamamlandı. ${vadRes?.silenceSegments?.length || 0} sessizlik alanı, ${transRes?.subtitles?.length || 0} cümle tespit edildi.`);

    } catch(err: any) {
      editor.announce(`Analiz hatası: ${err.message}`);
      aiService.addLog(`[AgenticEditor] Analiz Hatası: ${err.message}`, 'error');
      throw err;
    } finally {
      editor.isProcessing = false;
    }
  }

  async removeSilencesFromClip(clipId: string) {
    const track = editor.tracks.find(t => t.clips.some(c => c.id === clipId));
    if (!track) return;
    const clipIndex = track.clips.findIndex(c => c.id === clipId);
    const clip = track.clips[clipIndex];
    
    if (!clip.vadSilences || clip.vadSilences.length === 0) {
      aiService.addLog(`[AgenticEditor] Silinecek sessizlik bulunamadı.`);
      return;
    }

    // Sort silences chronologically
    const silences = [...clip.vadSilences].sort((a, b) => a.start - b.start);
    const newClips: TimelineClip[] = [];
    let currentTimelineStart = clip.startAt;

    // Split clip into speech segments
    for (let i = 0; i <= silences.length; i++) {
      const startSource = i === 0 ? clip.sourceOffset : silences[i - 1].end;
      const endSource = i === silences.length ? (clip.sourceOffset + clip.duration) : silences[i].start;
      const duration = Number((endSource - startSource).toFixed(3));
      
      if (duration > 0.1) {
        // Adapt subtitles to the newly cut sub-clip's relative local timeline
        let subClipSubs = undefined;
        if (clip.subtitles && clip.subtitles.length > 0) {
          subClipSubs = clip.subtitles
            .filter(s => s.start >= startSource && s.end <= endSource)
            .map(s => ({
              ...s,
              start: Number(Math.max(0, s.start - startSource).toFixed(2)),
              end: Number(Math.min(duration, s.end - startSource).toFixed(2))
            }));
        }

        newClips.push({
          ...JSON.parse(JSON.stringify(clip)),
          id: crypto.randomUUID(),
          startAt: Number(currentTimelineStart.toFixed(3)),
          sourceOffset: Number(startSource.toFixed(3)),
          duration: duration,
          vadSilences: [],
          subtitles: subClipSubs
        });
        currentTimelineStart += duration;
      }
    }

    if (newClips.length > 0) {
      // Replace old clip with speech-only segments
      track.clips.splice(clipIndex, 1, ...newClips);
      editor.saveState();
      editor.announce(`Sessizlikler silindi, klip ${newClips.length} konuşma parçasına bölündü.`);
      aiService.addLog(`[AgenticEditor] Jump Cut uygulandı. ${clip.vadSilences.length} sessizlik alanı silindi.`);
    }
  }
}

export const agenticEditor = new AgenticEditor();

if (typeof window !== 'undefined') {
  (window as any).agenticEditor = agenticEditor;
}
