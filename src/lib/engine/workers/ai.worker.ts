import { pipeline, env, RawImage } from '@huggingface/transformers';

// 1. Official Transformers.js & ONNX Runtime Configuration
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;

// Configure ONNX WebAssembly environment for web worker execution
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false; // Never spawn nested workers inside a web worker
  const threadCount = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? Math.min(Math.max(1, navigator.hardwareConcurrency), 4)
    : 2;
  env.backends.onnx.wasm.numThreads = threadCount;
}

/**
 * Checks browser WebGPU availability and shader-f16 feature support
 */
async function checkWebGpuSupport(): Promise<{ supported: boolean; hasFp16: boolean }> {
  try {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      return { supported: false, hasFp16: false };
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { supported: false, hasFp16: false };
    const hasFp16 = adapter.features?.has('shader-f16') ?? false;
    return { supported: true, hasFp16 };
  } catch {
    return { supported: false, hasFp16: false };
  }
}

function notifyProgress(taskId: string, feature: string, progress: number, message: string) {
  self.postMessage({
    type: 'ai_progress',
    taskId,
    payload: { taskId, feature, progress, message }
  });
}

function notifyLog(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  self.postMessage({
    type: 'ai_log',
    payload: { message, level, timestamp: Date.now() }
  });
}

function sendResult(taskId: string, result: any, transfer?: Transferable[]) {
  if (transfer && transfer.length > 0) {
    (self as any).postMessage({
      type: 'ai_result',
      taskId,
      result,
      payload: { taskId, result }
    }, transfer);
  } else {
    self.postMessage({
      type: 'ai_result',
      taskId,
      result,
      payload: { taskId, result }
    });
  }
}

function sendError(taskId: string, error: any) {
  const errMsg = error instanceof Error ? error.message : String(error);
  self.postMessage({
    type: 'ai_error',
    taskId,
    error: errMsg,
    payload: { taskId, error: errMsg }
  });
}

// Module-level cached AI model instances to prevent repeated initialization overhead
let transcriber: any = null;
let segmenter: any = null;
let kokoroTTS: any = null;
let faceDetector: any = null;
let vadInstance: any = null;
const loadedModelsList = new Set<string>();

self.onmessage = async (e: MessageEvent) => {
  const { type, taskId, payload } = e.data;

  try {
    if (type === 'TRANSCRIBE_AUDIO') {
      notifyLog(`Görev ${taskId} başlatıldı: Whisper Altyazı Transkripsiyonu`);
      notifyProgress(taskId, 'whisper_captions', 10, 'Whisper konuşma tanıma modeli hazırlanıyor...');

      if (!transcriber) {
        const gpuInfo = await checkWebGpuSupport();

        if (gpuInfo.supported) {
          try {
            notifyLog(`WebGPU algılandı (${gpuInfo.hasFp16 ? 'fp16 destekli' : 'fp32'}). Whisper-Tiny WebGPU yükleniyor...`);
            // Transformers.js v3/v4 official WebGPU pipeline configuration:
            // Full precision/fp16 for encoder and INT4 (q4) for decoder for optimal accuracy and lowest latency
            transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
              device: 'webgpu',
              dtype: {
                encoder_model: gpuInfo.hasFp16 ? 'fp16' : 'fp32',
                decoder_model_merged: 'q4'
              },
              progress_callback: (p: any) => {
                if (p?.status === 'progress' && typeof p.progress === 'number') {
                  notifyProgress(taskId, 'whisper_captions', 10 + Math.round(p.progress * 0.25), `Whisper modeli indiriliyor: %${Math.round(p.progress)}`);
                }
              }
            });
            loadedModelsList.add('onnx-community/whisper-tiny [WebGPU]');
            notifyLog('WebGPU Whisper başarıyla yüklendi ve hazır.');
          } catch (err: any) {
            notifyLog(`WebGPU Whisper başlatılamadı (${err?.message || err}), WASM moduna geçiliyor...`, 'warn');
          }
        }

        if (!transcriber) {
          try {
            transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
              device: 'wasm',
              dtype: 'q8',
              progress_callback: (p: any) => {
                if (p?.status === 'progress' && typeof p.progress === 'number') {
                  notifyProgress(taskId, 'whisper_captions', 10 + Math.round(p.progress * 0.25), `Whisper modeli indiriliyor (WASM): %${Math.round(p.progress)}`);
                }
              }
            });
            loadedModelsList.add('onnx-community/whisper-tiny [WASM]');
            notifyLog('WASM Whisper başarıyla yüklendi.', 'info');
          } catch (fallbackErr: any) {
            notifyLog(`Model yüklenemedi: ${fallbackErr.message}`, 'error');
            throw fallbackErr;
          }
        }
      }

      notifyProgress(taskId, 'whisper_captions', 40, 'Ses analizi ve konuşma çözümleniyor...');

      const { audioData, language } = payload;
      let resultText = '';
      let subtitles: Array<{ id: string; text: string; start: number; end: number; words?: any[] }> = [];

      if (!transcriber) {
        throw new Error('Whisper modeli başlatılamadı veya indirilemedi.');
      }

      if (audioData && audioData.length > 0) {
        try {
          const inputAudio = audioData instanceof Float32Array ? audioData : new Float32Array(audioData);
          const transcribeOptions: any = {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: 'word',
            task: 'transcribe'
          };
          if (language) {
            transcribeOptions.language = language;
          }

          const result = await transcriber(inputAudio, transcribeOptions);
          resultText = typeof result?.text === 'string' ? result.text.trim() : '';

          if (Array.isArray(result?.chunks) && result.chunks.length > 0) {
            const rawTokens = result.chunks.filter((c: any) => c.text && c.text.trim().length > 0);
            const isWordLevel = rawTokens.length > 0 && (rawTokens[0].text.trim().split(/\s+/).length <= 2);

            if (isWordLevel) {
              let currentWords: Array<{ word: string; start: number; end: number }> = [];
              let blockStart = 0;
              let blockIndex = 0;

              for (let i = 0; i < rawTokens.length; i++) {
                const token = rawTokens[i];
                const start = Array.isArray(token.timestamp) ? (token.timestamp[0] ?? 0) : (typeof token.timestamp === 'number' ? token.timestamp : 0);
                const end = Array.isArray(token.timestamp) ? (token.timestamp[1] ?? (start + 0.4)) : (start + 0.4);
                const wText = token.text.trim();

                if (currentWords.length === 0) {
                  blockStart = Math.max(0, Number(start.toFixed(2)));
                }

                currentWords.push({
                  word: wText,
                  start: Math.max(0, Number(start.toFixed(2))),
                  end: Math.max(start + 0.1, Number(end.toFixed(2)))
                });

                const blockDur = end - blockStart;
                const endsWithPunct = /[.!?]$/.test(wText);

                if (currentWords.length >= 6 || blockDur >= 2.8 || endsWithPunct || i === rawTokens.length - 1) {
                  const blockEnd = Math.max(blockStart + 0.5, Number(end.toFixed(2)));
                  const phraseText = currentWords.map(w => w.word).join(' ');

                  subtitles.push({
                    id: `sub_${Date.now()}_${blockIndex++}`,
                    text: phraseText,
                    start: blockStart,
                    end: blockEnd,
                    words: [...currentWords]
                  });
                  currentWords = [];
                }
              }
            } else {
              subtitles = rawTokens.map((chunk: any, i: number) => {
                const start = Array.isArray(chunk.timestamp) ? chunk.timestamp[0] ?? 0 : (typeof chunk.timestamp === 'number' ? chunk.timestamp : 0);
                const end = Array.isArray(chunk.timestamp) ? chunk.timestamp[1] ?? (start + 2.5) : start + 2.5;
                const chunkStart = Math.max(0, Number(start.toFixed(2)));
                const chunkEnd = Math.max(chunkStart + 0.3, Number(end.toFixed(2)));
                const textStr = chunk.text.trim();

                let words = chunk.words;
                if (!words || words.length === 0) {
                  const splitWords = textStr.split(/\s+/).filter(Boolean);
                  const dur = chunkEnd - chunkStart;
                  const step = dur / Math.max(1, splitWords.length);
                  words = splitWords.map((w: string, idx: number) => ({
                    word: w,
                    start: Number((chunkStart + idx * step).toFixed(2)),
                    end: Number((chunkStart + (idx + 1) * step).toFixed(2))
                  }));
                }

                return {
                  id: `sub_${Date.now()}_${i}`,
                  text: textStr,
                  start: chunkStart,
                  end: chunkEnd,
                  words
                };
              });
            }
          }
        } catch (transErr: any) {
          notifyLog(`Whisper transkripsiyon inferansı hatası: ${transErr?.message || transErr}`, 'error');
          throw transErr;
        }
      }

      notifyProgress(taskId, 'whisper_captions', 100, 'Altyazı üretimi tamamlandı!');
      sendResult(taskId, {
        text: resultText,
        subtitles: subtitles
      });

    } else if (type === 'DETECT_SILENCE') {
      notifyLog(`Görev ${taskId} başlatıldı: Sessizlik Tespiti (VAD)`);
      notifyProgress(taskId, 'silero_vad', 20, 'Ses dalga formu inceleniyor...');

      const {
        audioData,
        sampleRate = 16000,
        positiveSpeechThreshold = 0.5,
        negativeSpeechThreshold = 0.35,
        minSpeechMs = 100,
        redemptionMs = 200
      } = payload;
      const speechSegments: { start: number; end: number }[] = [];
      const inputAudio = audioData instanceof Float32Array ? audioData : new Float32Array(audioData || []);

      try {
        if (!vadInstance) {
          const vad = await import('@ricky0123/vad-web');
          const origin = typeof self !== 'undefined' && self.location?.origin && self.location.origin !== 'null'
            ? self.location.origin
            : '';
          const vadModelUrl = origin
            ? `${origin}/silero_vad_legacy.onnx`
            : new URL('/silero_vad_legacy.onnx', self.location.href).href;

          vadInstance = await vad.NonRealTimeVAD.new({
            modelURL: vadModelUrl,
            positiveSpeechThreshold,
            negativeSpeechThreshold,
            minSpeechMs,
            redemptionMs,
            ortConfig: (ort: any) => {
              if (ort.env?.wasm) {
                ort.env.wasm.proxy = false;
                ort.env.wasm.numThreads = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
                  ? Math.min(Math.max(1, navigator.hardwareConcurrency), 4)
                  : 2;
              }
            }
          });
          loadedModelsList.add('Silero VAD (ONNX)');
          notifyLog('Silero VAD modeli hazırlandı, konuşma alanları taranıyor...');
        }

        const CHUNK_SECONDS = 30;
        const chunkSize = sampleRate * CHUNK_SECONDS;

        for (let i = 0; i < inputAudio.length; i += chunkSize) {
          const chunk = inputAudio.slice(i, Math.min(i + chunkSize, inputAudio.length));
          for await (const { start, end } of vadInstance.run(chunk, sampleRate)) {
            const globalStart = (start / sampleRate) + (i / sampleRate);
            const globalEnd = (end / sampleRate) + (i / sampleRate);
            speechSegments.push({
              start: Number(globalStart.toFixed(3)),
              end: Number(globalEnd.toFixed(3))
            });
          }
          await new Promise(r => setTimeout(r, 5));
          notifyProgress(taskId, 'silero_vad', 20 + Math.floor((i / inputAudio.length) * 70), 'Ses taranıyor...');
        }
      } catch (vadErr: any) {
        notifyLog(`Silero VAD inferans uyarısı (${vadErr?.message || vadErr}), DSP RMS enerji filtrelemesi uygulanıyor...`, 'warn');
        // W3C Web Audio RMS Energy analizi (Sıfır ek gecikme, garantili sonuç)
        const frameSize = Math.floor(sampleRate * 0.05); // 50ms kareler
        const numFrames = Math.floor(inputAudio.length / frameSize);
        const rmsValues = new Float32Array(numFrames);
        let totalRms = 0;

        for (let i = 0; i < numFrames; i++) {
          const offset = i * frameSize;
          let sum = 0;
          for (let j = 0; j < frameSize; j++) {
            const s = inputAudio[offset + j];
            sum += s * s;
          }
          const rms = Math.sqrt(sum / frameSize);
          rmsValues[i] = rms;
          totalRms += rms;
        }

        const avgRms = totalRms / (numFrames || 1);
        const thresholdMultiplier = positiveSpeechThreshold ? (positiveSpeechThreshold * 0.7) : 0.35;
        const threshold = Math.max(0.012, avgRms * thresholdMultiplier);

        let inSpeech = false;
        let segStart = 0;
        for (let i = 0; i < numFrames; i++) {
          const isSpeech = rmsValues[i] > threshold;
          if (isSpeech && !inSpeech) {
            inSpeech = true;
            segStart = i * 0.05;
          } else if (!isSpeech && inSpeech) {
            inSpeech = false;
            const segEnd = i * 0.05;
            if (segEnd - segStart >= (minSpeechMs / 1000)) {
              speechSegments.push({
                start: Number(segStart.toFixed(3)),
                end: Number(segEnd.toFixed(3))
              });
            }
          }
        }
        if (inSpeech) {
          speechSegments.push({
            start: Number(segStart.toFixed(3)),
            end: Number((numFrames * 0.05).toFixed(3))
          });
        }
      }

      const silenceSegments: { start: number; end: number }[] = [];
      let lastEnd = 0;
      const totalDuration = inputAudio.length / sampleRate;

      for (const seg of speechSegments) {
        if (seg.start > lastEnd + 0.15) {
          silenceSegments.push({
            start: Number(lastEnd.toFixed(3)),
            end: Number(seg.start.toFixed(3))
          });
        }
        lastEnd = seg.end;
      }
      if (lastEnd < totalDuration - 0.15) {
        silenceSegments.push({
          start: Number(lastEnd.toFixed(3)),
          end: Number(totalDuration.toFixed(3))
        });
      }

      notifyProgress(taskId, 'silero_vad', 100, 'Sessizlik tespiti tamamlandı!');
      sendResult(taskId, {
        speechSegments,
        silenceSegments
      });

    } else if (type === 'GENERATE_TTS') {
      notifyLog(`Görev ${taskId} başlatıldı: Kokoro-82M ONNX Yapay Zeka Ses Sentezleme (TTS)`);
      notifyProgress(taskId, 'kokoro_tts', 15, 'Kokoro-82M ONNX ses modeli hazırlanıyor...');

      const { text = '', voice = 'af_bella', speed = 1.0 } = payload;
      const cleanText = text.trim();
      if (!cleanText) {
        throw new Error('Seslendirilecek bir metin girilmedi.');
      }

      if (!kokoroTTS) {
        const { KokoroTTS } = await import('kokoro-js');
        const gpuInfo = await checkWebGpuSupport();

        if (gpuInfo.supported) {
          try {
            notifyLog(`WebGPU algılandı (${gpuInfo.hasFp16 ? 'fp16' : 'fp32'}). Kokoro-82M WebGPU modeli yükleniyor...`);
            kokoroTTS = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
              dtype: gpuInfo.hasFp16 ? 'fp16' : 'fp32',
              device: 'webgpu',
              progress_callback: (p: any) => {
                if (p?.status === 'progress' && typeof p.progress === 'number') {
                  notifyProgress(taskId, 'kokoro_tts', 15 + Math.round(p.progress * 0.45), `Model indiriliyor: %${Math.round(p.progress)}`);
                }
              }
            });
            loadedModelsList.add('Kokoro-82M-v1.0 [WebGPU]');
            notifyLog('Kokoro-82M modeli WebGPU üzerinde başarıyla yüklendi.');
          } catch (gpuErr: any) {
            notifyLog(`Kokoro WebGPU başlatılamadı (${gpuErr?.message || gpuErr}), WASM q8 moduna geçiliyor...`, 'warn');
          }
        }

        if (!kokoroTTS) {
          try {
            kokoroTTS = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
              dtype: 'q8',
              device: 'wasm',
              progress_callback: (p: any) => {
                if (p?.status === 'progress' && typeof p.progress === 'number') {
                  notifyProgress(taskId, 'kokoro_tts', 15 + Math.round(p.progress * 0.45), `Model indiriliyor (WASM): %${Math.round(p.progress)}`);
                }
              }
            });
            loadedModelsList.add('Kokoro-82M-v1.0 [WASM]');
            notifyLog('Kokoro-82M modeli WASM üzerinde başarıyla yüklendi.', 'info');
          } catch (wasmErr: any) {
            notifyLog(`Kokoro modeli yüklenemedi: ${wasmErr?.message || wasmErr}`, 'error');
            throw wasmErr;
          }
        }
      }

      notifyProgress(taskId, 'kokoro_tts', 70, 'Stüdyo kalitesinde ses sentezleniyor...');
      const audioResult = await kokoroTTS.generate(cleanText, {
        voice: voice || 'af_bella',
        speed: speed || 1.0
      });

      const pcmData = audioResult.audio instanceof Float32Array 
        ? audioResult.audio 
        : new Float32Array(audioResult.audio);
      const sampleRate = audioResult.sampling_rate || 24000;
      const durationSec = Number((pcmData.length / sampleRate).toFixed(2));

      notifyProgress(taskId, 'kokoro_tts', 100, 'Ses sentezi tamamlandı!');
      // Zero-copy ArrayBuffer transfer for maximum throughput
      sendResult(taskId, {
        text: cleanText,
        voice,
        duration: durationSec,
        sampleRate,
        pcmData
      }, [pcmData.buffer]);

    } else if (type === 'REMOVE_BACKGROUND') {
      notifyLog(`Görev ${taskId} başlatıldı: Arka Plan Ayrıştırma (Segmentation)`);
      notifyProgress(taskId, 'modnet_bg', 10, 'Görsel yükleniyor...');
      
      const { image } = payload;
      
      try {
        if (!image || image === 'dummy_frame') {
          throw new Error('Geçerli bir görsel karesi sağlanamadı.');
        }

        if (!segmenter) {
          const gpuInfo = await checkWebGpuSupport();
          notifyProgress(taskId, 'modnet_bg', 20, 'Segmentasyon modeli hazırlanıyor (briaai/RMBG-1.4)...');

          if (gpuInfo.supported) {
            try {
              segmenter = await pipeline('image-segmentation', 'briaai/RMBG-1.4', {
                device: 'webgpu',
                dtype: gpuInfo.hasFp16 ? 'fp16' : 'fp32',
                progress_callback: (p: any) => {
                  if (p?.status === 'progress' && typeof p.progress === 'number') {
                    notifyProgress(taskId, 'modnet_bg', 20 + Math.round(p.progress * 0.25), `Segmentasyon modeli indiriliyor: %${Math.round(p.progress)}`);
                  }
                }
              });
              loadedModelsList.add('briaai/RMBG-1.4 [WebGPU]');
              notifyLog('Segmentasyon modeli başarıyla WebGPU üzerine yüklendi.');
            } catch (gpuErr: any) {
              notifyLog(`WebGPU segmentasyon başlatılamadı (${gpuErr?.message || gpuErr}), WASM moduna geçiliyor...`, 'warn');
            }
          }

          if (!segmenter) {
            try {
              segmenter = await pipeline('image-segmentation', 'briaai/RMBG-1.4', {
                device: 'wasm',
                progress_callback: (p: any) => {
                  if (p?.status === 'progress' && typeof p.progress === 'number') {
                    notifyProgress(taskId, 'modnet_bg', 20 + Math.round(p.progress * 0.25), `Segmentasyon modeli indiriliyor (WASM): %${Math.round(p.progress)}`);
                  }
                }
              });
              loadedModelsList.add('briaai/RMBG-1.4 [WASM]');
              notifyLog('Segmentasyon modeli WASM modunda başarıyla yüklendi.', 'info');
            } catch (fallbackErr: any) {
              notifyLog(`briaai/RMBG-1.4 yüklenemedi (${fallbackErr.message}), onnx-community alternatifine geçiliyor...`, 'warn');
              segmenter = await pipeline('image-segmentation', 'onnx-community/bria-rmbg-1.4', {
                device: 'wasm'
              });
              loadedModelsList.add('onnx-community/bria-rmbg-1.4 [WASM]');
            }
          }
        }

        notifyProgress(taskId, 'modnet_bg', 50, 'Görsel piksel segmentasyonu uygulanıyor...');
        
        // Read the image using official RawImage.read method
        const rawImage = await RawImage.read(image);
        
        // Run inference
        const result = await segmenter(rawImage);
        
        // Extract mask from result
        const maskObj = Array.isArray(result) ? result[0]?.mask : (result?.mask ?? result);
        
        let processedImageBase64 = '';
        if (maskObj && maskObj.data && rawImage.width > 0 && rawImage.height > 0) {
          const w = rawImage.width;
          const h = rawImage.height;
          const rawRgba = rawImage.rgba();
          const rgba = new Uint8ClampedArray(w * h * 4);
          const maskData = maskObj.data;
          
          for (let i = 0; i < w * h; i++) {
            rgba[i * 4] = rawRgba.data[i * 4];
            rgba[i * 4 + 1] = rawRgba.data[i * 4 + 1];
            rgba[i * 4 + 2] = rawRgba.data[i * 4 + 2];
            rgba[i * 4 + 3] = maskData[i] !== undefined ? maskData[i] : 255;
          }

          if (typeof OffscreenCanvas !== 'undefined') {
            const offscreen = new OffscreenCanvas(w, h);
            const offCtx = offscreen.getContext('2d');
            if (offCtx) {
              const imgData = new ImageData(rgba, w, h);
              offCtx.putImageData(imgData, 0, 0);
              const blob = await offscreen.convertToBlob({ type: 'image/png' });
              const buffer = await blob.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              const CHUNK_SIZE = 0x8000;
              let binary = '';
              for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
                binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK_SIZE)));
              }
              processedImageBase64 = `data:image/png;base64,${btoa(binary)}`;
            }
          }
        }
        
        notifyProgress(taskId, 'modnet_bg', 100, 'Arka plan ayrıştırma tamamlandı!');
        
        sendResult(taskId, {
          success: true,
          segmented: true,
          maskBase64: processedImageBase64,
          timestamp: Date.now()
        });
      } catch (err: any) {
        notifyLog(`Segmentasyon Hatası: ${err.message}`, 'error');
        sendError(taskId, err);
      }

    } else if (type === 'AUTO_REFRAME') {
      notifyLog(`Görev ${taskId} başlatıldı: MediaPipe BlazeFace AI Yüz Takibi & 9:16 Reframe`);
      notifyProgress(taskId, 'yunet_reframe', 20, 'MediaPipe BlazeFace yapay zeka yüz modeli hazırlanıyor...');

      const { duration = 5, frames = [] } = payload;

      if (!faceDetector) {
        try {
          const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision');
          let vision: any;
          try {
            vision = await FilesetResolver.forVisionTasks(
              'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
            );
          } catch {
            vision = await FilesetResolver.forVisionTasks(
              'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
            );
          }

          const modelAssetPath = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';

          try {
            faceDetector = await FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath,
                delegate: 'GPU'
              },
              runningMode: 'IMAGE',
              minDetectionConfidence: 0.5,
              minSuppressionThreshold: 0.3
            });
            loadedModelsList.add('MediaPipe BlazeFace [GPU]');
            notifyLog('MediaPipe BlazeFace GPU hızlandırmasıyla yüklendi.');
          } catch (gpuErr: any) {
            notifyLog(`MediaPipe GPU başlatılamadı (${gpuErr?.message || gpuErr}), CPU moduna geçiliyor...`, 'warn');
            faceDetector = await FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath,
                delegate: 'CPU'
              },
              runningMode: 'IMAGE',
              minDetectionConfidence: 0.5,
              minSuppressionThreshold: 0.3
            });
            loadedModelsList.add('MediaPipe BlazeFace [CPU]');
            notifyLog('MediaPipe BlazeFace CPU modunda yüklendi.');
          }
        } catch (visionErr: any) {
          notifyLog(`MediaPipe model başlatma uyarısı: ${visionErr?.message || visionErr}`, 'warn');
        }
      }

      notifyProgress(taskId, 'yunet_reframe', 50, 'Video kareleri analiz edilerek yüz ve hareket izleniyor...');
      const keyframes = [];
      const CROP_W_9_16 = 0.316; // 16:9 genişlikte 9:16 pencere boyutu (81/256)
      let smoothedCenterX = 0.5;

      if (frames && frames.length > 0) {
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          let detectedX = smoothedCenterX;

          if (faceDetector && frame.image) {
            let bitmap: ImageBitmap | null = null;
            try {
              const resp = await fetch(frame.image);
              const blob = await resp.blob();
              bitmap = await createImageBitmap(blob);
              const detections = faceDetector.detect(bitmap);

              if (detections && detections.detections && detections.detections.length > 0) {
                const primary = detections.detections[0];
                const bb = primary.boundingBox;
                if (bb && bitmap.width > 0) {
                  const faceCenter = (bb.originX + bb.width / 2) / bitmap.width;
                  detectedX = Math.max(0.16, Math.min(0.84, faceCenter));
                }
              }
            } catch (frameErr: any) {
              notifyLog(`Kare analiz atlaması: ${frameErr?.message || frameErr}`, 'warn');
            } finally {
              // Always close ImageBitmap to prevent GPU memory leaks
              if (bitmap && typeof bitmap.close === 'function') {
                try { bitmap.close(); } catch {}
              }
            }
          }

          // Kinematik yumuşatma (titremeyi önler)
          smoothedCenterX = smoothedCenterX * 0.65 + detectedX * 0.35;
          const normalizedCropX = Number(Math.max(0, Math.min(1 - CROP_W_9_16, smoothedCenterX - CROP_W_9_16 / 2)).toFixed(3));

          keyframes.push({
            time: frame.time ?? Number(((i / frames.length) * duration).toFixed(3)),
            x: normalizedCropX,
            y: 0,
            width: CROP_W_9_16,
            height: 1.0
          });
        }
      }

      // Eğer kare gelmediyse süre boyunca dengeli anahtar kareler oluştur
      if (keyframes.length === 0) {
        const numKeyframes = Math.max(4, Math.floor(duration * 2));
        for (let i = 0; i <= numKeyframes; i++) {
          const time = Number(((i / numKeyframes) * duration).toFixed(3));
          keyframes.push({
            time,
            x: Number((0.5 - CROP_W_9_16 / 2).toFixed(3)),
            y: 0,
            width: CROP_W_9_16,
            height: 1.0
          });
        }
      }

      notifyProgress(taskId, 'yunet_reframe', 100, '9:16 akıllı yüz kadrajı tamamlandı!');
      sendResult(taskId, { keyframes });

    } else if (type === 'DETECT_BEATS') {
      notifyLog(`Görev ${taskId} başlatıldı: Ritim Analizi (Spectral Flux / Beat Detection)`);
      notifyProgress(taskId, 'beat_detector', 10, 'Ses sinyali enerjisi hesaplanıyor...');

      const { audioData, sampleRate = 44100 } = payload;
      const data = audioData instanceof Float32Array ? audioData : new Float32Array(audioData || []);
      
      const windowSize = Math.max(64, Math.floor(sampleRate * 0.05)); // 50ms pencere
      const numWindows = Math.floor(data.length / windowSize);
      const energies = new Float32Array(numWindows);

      for (let i = 0; i < numWindows; i++) {
        let sum = 0;
        const start = i * windowSize;
        const end = start + windowSize;
        for (let j = start; j < end; j++) {
          sum += data[j] * data[j];
        }
        energies[i] = sum / windowSize;
      }

      notifyProgress(taskId, 'beat_detector', 60, 'Dinamik eşik ile vuruşlar tespit ediliyor...');
      const beats: number[] = [];
      const minDistance = Math.max(1, Math.floor((sampleRate * 0.25) / windowSize)); // Min 250ms aralık
      let lastBeatWindow = -minDistance;
      const historySize = Math.max(1, Math.floor((sampleRate * 1.0) / windowSize)); // 1 saniyelik hareketli ortalama

      for (let i = 0; i < numWindows; i++) {
        const windowStart = Math.max(0, i - historySize);
        let localSum = 0;
        for (let k = windowStart; k <= i; k++) {
          localSum += energies[k];
        }
        const localAvg = localSum / (i - windowStart + 1);
        const threshold = localAvg * 1.45;

        if (energies[i] > threshold && (i - lastBeatWindow) >= minDistance) {
          const timeInSeconds = (i * windowSize) / sampleRate;
          beats.push(Number(timeInSeconds.toFixed(3)));
          lastBeatWindow = i;
        }
      }

      let bpm = 120;
      if (beats.length >= 4) {
        const intervals: number[] = [];
        for (let i = 1; i < beats.length; i++) {
          const dt = beats[i] - beats[i - 1];
          if (dt >= 0.25 && dt <= 1.2) {
            intervals.push(dt);
          }
        }
        if (intervals.length > 0) {
          const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          bpm = Math.round(60 / avgInterval);
        }
      }

      notifyProgress(taskId, 'beat_detector', 100, `Ritim analizi tamamlandı (${beats.length} vuruş, ${bpm} BPM)`);
      sendResult(taskId, { beats, bpm });

    } else if (type === 'RELEASE_VRAM') {
      transcriber = null;
      segmenter = null;
      kokoroTTS = null;
      if (vadInstance && typeof vadInstance.release === 'function') {
        try { await vadInstance.release(); } catch {}
      }
      vadInstance = null;
      if (faceDetector && typeof faceDetector.close === 'function') {
        try { faceDetector.close(); } catch {}
      }
      faceDetector = null;
      loadedModelsList.clear();
      notifyLog('VRAM ve tüm modeller serbest bırakıldı.', 'info');
      sendResult(taskId, { released: true });

    } else if (type === 'GET_VRAM_STATUS') {
      sendResult(taskId, {
        loadedModels: Array.from(loadedModelsList)
      });

    } else {
      sendResult(taskId, { unsupported: true });
    }
  } catch (error: any) {
    notifyLog(`Worker işlem hatası: ${error?.message || error}`, 'error');
    sendError(taskId, error);
  }
};

self.onerror = (e) => {
  console.error('[ai.worker] Global worker unhandled error:', e);
};

self.onunhandledrejection = (e) => {
  console.error('[ai.worker] Global worker unhandled rejection:', e.reason);
};
