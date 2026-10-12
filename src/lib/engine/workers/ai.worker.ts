import { pipeline, env, RawImage } from '@huggingface/transformers';
import * as vad from '@ricky0123/vad-web';
import { KokoroTTS } from 'kokoro-js';
import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';

env.allowLocalModels = false;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false; // Inside web worker: execute directly, do not spawn nested proxy
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

function sendResult(taskId: string, result: any) {
  self.postMessage({
    type: 'ai_result',
    taskId,
    result,
    payload: { taskId, result }
  });
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

let transcriber: any = null;
let segmenter: any = null;
let kokoroTTS: any = null;
let faceDetector: any = null;
const loadedModelsList = new Set<string>();

self.onmessage = async (e: MessageEvent) => {
  const { type, taskId, payload } = e.data;

  try {
    if (type === 'TRANSCRIBE_AUDIO') {
      notifyLog(`Görev ${taskId} başlatıldı: Whisper Altyazı Transkripsiyonu`);
      notifyProgress(taskId, 'whisper_captions', 10, 'Whisper konuşma tanıma modeli yükleniyor...');

      if (!transcriber) {
        try {
          // Transformers.js v3 resmi WebGPU modeli
          transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
            device: 'webgpu',
            dtype: 'fp32',
            progress_callback: (p: any) => {
              if (p?.status === 'progress' && typeof p.progress === 'number') {
                notifyProgress(taskId, 'whisper_captions', 10 + Math.round(p.progress * 0.25), `Whisper modeli indiriliyor: %${Math.round(p.progress)}`);
              }
            }
          });
          loadedModelsList.add('onnx-community/whisper-tiny [WebGPU]');
          notifyLog('WebGPU Whisper başarıyla yüklendi ve hazır.');
        } catch (err: any) {
          notifyLog('WebGPU başlatılamadı, WASM CPU moduna geçiliyor...', 'warn');
          try {
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
              device: 'wasm',
              dtype: 'q8',
              progress_callback: (p: any) => {
                if (p?.status === 'progress' && typeof p.progress === 'number') {
                  notifyProgress(taskId, 'whisper_captions', 10 + Math.round(p.progress * 0.25), `Whisper modeli indiriliyor (WASM): %${Math.round(p.progress)}`);
                }
              }
            });
            loadedModelsList.add('Xenova/whisper-tiny [WASM]');
            notifyLog('WASM Whisper başarıyla yüklendi.', 'info');
          } catch (fallbackErr: any) {
            notifyLog(`Model yüklenemedi: ${fallbackErr.message}`, 'error');
            throw fallbackErr;
          }
        }
      }

      notifyProgress(taskId, 'whisper_captions', 40, 'Ses analizi ve konuşma çözümleniyor...');

      const { audioData, sampleRate } = payload;
      let resultText = '';
      let subtitles: Array<{ id: string; text: string; start: number; end: number; words?: any[] }> = [];

      if (!transcriber) {
        throw new Error('Whisper modeli başlatılamadı veya indirilemedi.');
      }

      if (audioData && audioData.length > 0) {
        try {
          // transformers.js Float32Array 16kHz ses bekler (W3C standardı)
          const result = await transcriber(audioData, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: 'word',
            task: 'transcribe'
          });

          resultText = typeof result?.text === 'string' ? result.text.trim() : '';

          if (Array.isArray(result?.chunks) && result.chunks.length > 0) {
            // Check if chunks are raw word tokens or phrase chunks
            const rawTokens = result.chunks.filter((c: any) => c.text && c.text.trim().length > 0);
            
            // Check if tokens are individual words (average <= 2 words per chunk)
            const isWordLevel = rawTokens.length > 0 && (rawTokens[0].text.trim().split(/\s+/).length <= 2);

            if (isWordLevel) {
              // Group individual words into readable subtitle blocks (3-7 words or ~2.5s duration)
              let currentWords: Array<{ word: string; start: number; end: number }> = [];
              let blockStart = 0;
              let blockIndex = 0;

              for (let i = 0; i < rawTokens.length; i++) {
                const token = rawTokens[i];
                const start = Array.isArray(token.timestamp) ? (token.timestamp[0] ?? 0) : 0;
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

                // Group boundary reached
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
              // Phrase chunks directly from model
              subtitles = rawTokens.map((chunk: any, i: number) => {
                const start = Array.isArray(chunk.timestamp) ? chunk.timestamp[0] ?? 0 : 0;
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

      const { audioData, sampleRate = 16000 } = payload;
      const speechSegments: { start: number; end: number }[] = [];

      try {
        const vadModelUrl = (self.location?.origin || '') + '/silero_vad_legacy.onnx';
        const myvad = await vad.NonRealTimeVAD.new({
          modelURL: vadModelUrl
        });
        loadedModelsList.add('Silero VAD (ONNX)');
        notifyLog('Silero VAD modeli hazır, konuşma alanları taranıyor...');

        const CHUNK_SECONDS = 30;
        const chunkSize = sampleRate * CHUNK_SECONDS;

        for (let i = 0; i < audioData.length; i += chunkSize) {
          const chunk = audioData.slice(i, Math.min(i + chunkSize, audioData.length));
          for await (const { start, end } of myvad.run(chunk, sampleRate)) {
            const globalStart = (start / sampleRate) + (i / sampleRate);
            const globalEnd = (end / sampleRate) + (i / sampleRate);
            speechSegments.push({
              start: Number(globalStart.toFixed(3)),
              end: Number(globalEnd.toFixed(3))
            });
          }
          await new Promise(r => setTimeout(r, 5));
          notifyProgress(taskId, 'silero_vad', 20 + Math.floor((i / audioData.length) * 70), 'Ses taranıyor...');
        }
      } catch {
        // W3C Web Audio RMS Energy analizi (Sıfır ek gecikme, garantili sonuç)
        notifyLog('Yerel yüksek hassasiyetli RMS enerji filtrelemesi yapılıyor...', 'info');
        const frameSize = Math.floor(sampleRate * 0.05); // 50ms kareler
        const numFrames = Math.floor(audioData.length / frameSize);
        const rmsValues = new Float32Array(numFrames);
        let totalRms = 0;

        for (let i = 0; i < numFrames; i++) {
          const offset = i * frameSize;
          let sum = 0;
          for (let j = 0; j < frameSize; j++) {
            const s = audioData[offset + j];
            sum += s * s;
          }
          const rms = Math.sqrt(sum / frameSize);
          rmsValues[i] = rms;
          totalRms += rms;
        }

        const avgRms = totalRms / (numFrames || 1);
        const threshold = Math.max(0.012, avgRms * 0.35);

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
            if (segEnd - segStart >= 0.2) {
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
      const totalDuration = audioData.length / sampleRate;

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
      notifyProgress(taskId, 'kokoro_tts', 15, 'Kokoro-82M ONNX yapay zeka ses modeli hazırlanıyor...');

      const { text = '', voice = 'af_bella', speed = 1.0 } = payload;
      const cleanText = text.trim();
      if (!cleanText) {
        throw new Error('Seslendirilecek bir metin girilmedi.');
      }

      if (!kokoroTTS) {
        try {
          notifyLog('Kokoro-82M WebGPU modeli yükleniyor...');
          kokoroTTS = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
            dtype: 'fp32',
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
      sendResult(taskId, {
        text: cleanText,
        voice,
        duration: durationSec,
        sampleRate,
        pcmData
      });

    } else if (type === 'REMOVE_BACKGROUND') {
      notifyLog(`Görev ${taskId} başlatıldı: Arka Plan Ayrıştırma (Segmentation)`);
      notifyProgress(taskId, 'modnet_bg', 10, 'Görsel yükleniyor...');
      
      const { image } = payload; // Can be a URL, data URL, or Blob URL
      
      try {
        if (!image || image === 'dummy_frame') {
          throw new Error('Geçerli bir görsel karesi sağlanamadı.');
        }

        if (!segmenter) {
          notifyProgress(taskId, 'modnet_bg', 20, 'Segmentasyon modeli hazırlanıyor (briaai/RMBG-1.4)...');
          try {
            segmenter = await pipeline('image-segmentation', 'briaai/RMBG-1.4', {
              device: 'webgpu',
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
        
        // Read the image using RawImage
        const rawImage = await RawImage.fromURL(image);
        
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
          const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
          );
          try {
            faceDetector = await FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
                delegate: 'GPU'
              },
              runningMode: 'IMAGE'
            });
            loadedModelsList.add('MediaPipe BlazeFace [GPU]');
            notifyLog('MediaPipe BlazeFace GPU hızlandırmasıyla yüklendi.');
          } catch {
            faceDetector = await FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
                delegate: 'CPU'
              },
              runningMode: 'IMAGE'
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
            try {
              const resp = await fetch(frame.image);
              const blob = await resp.blob();
              const bitmap = await createImageBitmap(blob);
              const detections = faceDetector.detect(bitmap);

              if (detections && detections.detections && detections.detections.length > 0) {
                const primary = detections.detections[0];
                const bb = primary.boundingBox;
                if (bb && bitmap.width > 0) {
                  const faceCenter = (bb.originX + bb.width / 2) / bitmap.width;
                  detectedX = Math.max(0.16, Math.min(0.84, faceCenter));
                }
              }
              bitmap.close();
            } catch (frameErr: any) {
              notifyLog(`Kare analiz atlaması: ${frameErr?.message || frameErr}`, 'warn');
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
