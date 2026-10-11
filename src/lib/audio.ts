import { getFileFromOPFS } from './opfs';
import { evaluateSpeedCurve } from './engine/speedCurve';
import { masterAudioClock } from './engine/audioClock';

export const audioCtx = masterAudioClock.getAudioContext();

let isAudioUnlocked = false;
let workletLoaded = false;

export function ensureAudioUnlocked() {
  masterAudioClock.ensureUnlocked().then(() => {
    isAudioUnlocked = true;
    if (!workletLoaded) {
      workletLoaded = true;
      audioCtx.audioWorklet.addModule('/audio-worklet.js').catch(err => {
        console.warn('DSP Worklet yüklenemedi:', err);
      });
      audioCtx.audioWorklet.addModule('/worklets/beat-detector-worklet.js').catch(err => {
        console.warn('Beat Detector Worklet yüklenemedi:', err);
      });
    }
  }).catch(console.error);
}

import { Input, BlobSource, ALL_FORMATS, AudioBufferSink } from 'mediabunny';

// Cache for generated waveform peaks
const peaksCache = new Map<string, Float32Array>();

export async function generateWaveformPeaks(file: File, numPeaks: number = 1000): Promise<Float32Array> {
  const cacheKey = `${file.name}_${file.size}_${numPeaks}`;
  if (peaksCache.has(cacheKey)) {
    return peaksCache.get(cacheKey)!;
  }

  try {
    let channelData: Float32Array | null = null;

    // 1. First attempt: Streamlined audio extraction via Mediabunny (safe for 100MB+ videos)
    try {
      const input = new Input({
        source: new BlobSource(file),
        formats: ALL_FORMATS
      });
      const audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack) {
        const sink = new AudioBufferSink(audioTrack);
        const duration = (await input.computeDuration().catch(() => 60)) || 60;
        const wrappedBuffers: AudioBuffer[] = [];
        if (typeof (sink as any).buffers === 'function') {
          for await (const wrapped of (sink as any).buffers(0, Math.min(600, duration))) {
            if (wrapped && wrapped.buffer) wrappedBuffers.push(wrapped.buffer);
            else if (wrapped instanceof AudioBuffer) wrappedBuffers.push(wrapped);
          }
        }
        if (wrappedBuffers.length > 0) {
          const totalLength = wrappedBuffers.reduce((sum, b) => sum + b.length, 0);
          const merged = new Float32Array(totalLength);
          let offset = 0;
          for (const b of wrappedBuffers) {
            merged.set(b.getChannelData(0), offset);
            offset += b.length;
          }
          channelData = merged;
        }
      }
    } catch (_) {}

    // 2. Fallback attempt: Direct AudioContext decode for audio files or standard containers
    if (!channelData || channelData.length === 0) {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      channelData = audioBuffer.getChannelData(0);
    }

    if (!channelData || channelData.length === 0) {
      return new Float32Array(numPeaks);
    }

    // 3. Compute accurate peak envelope (RMS & Max Peak)
    const peaks = new Float32Array(numPeaks);
    const sampleSize = Math.max(1, Math.floor(channelData.length / numPeaks));

    for (let i = 0; i < numPeaks; i++) {
      const start = i * sampleSize;
      const end = Math.min(channelData.length, start + sampleSize);
      let maxPeak = 0;
      for (let j = start; j < end; j++) {
        const val = Math.abs(channelData[j]);
        if (val > maxPeak) maxPeak = val;
      }
      peaks[i] = Math.min(1.0, maxPeak);
    }

    peaksCache.set(cacheKey, peaks);
    return peaks;
  } catch (e) {
    console.warn('[audio] Waveform generation fallback:', e);
    return new Float32Array(numPeaks);
  }
}

export async function detectAudioBeats(file: File): Promise<{ bpm: number; beats: number[] }> {
  try {
    ensureAudioUnlocked();
    const arrayBuffer = await file.arrayBuffer();
    // Use an OfflineAudioContext with lower sample rate to analyze faster and save memory
    const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      try { await tempCtx.close(); } catch (_) {}
    }
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    // Divide into 50ms windows to calculate spectral energy
    const windowSize = Math.floor(sampleRate * 0.05); // 50ms
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

    // Dynamic threshold detection for rhythmic peaks (transients)
    const beats: number[] = [];
    const minDistance = Math.floor(sampleRate * 0.25 / windowSize); // Minimum 250ms between beats (max 240 BPM)
    let lastBeatWindow = -minDistance;
    
    // Moving average of energy (local threshold)
    const historySize = Math.floor(sampleRate * 1.0 / windowSize); // 1-second moving average window
    for (let i = 0; i < numWindows; i++) {
      const windowStart = Math.max(0, i - historySize);
      let localSum = 0;
      for (let k = windowStart; k <= i; k++) {
        localSum += energies[k];
      }
      const localAvg = localSum / (i - windowStart + 1);
      const threshold = localAvg * 1.45; // 1.45x local average represents a transient beat

      if (energies[i] > threshold && (i - lastBeatWindow) >= minDistance) {
        const timeInSeconds = (i * windowSize) / sampleRate;
        beats.push(Math.round(timeInSeconds * 100) / 100);
        lastBeatWindow = i;
      }
    }

    // Estimate BPM from beat intervals
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

    return { bpm, beats };
  } catch (e) {
    console.warn("Beat detection failed:", e);
    return { bpm: 120, beats: [] };
  }
}

// Master Audio Clock Bridge for Preview Playback
let lastPlaybackState = false;

export function updateAudioEngine(playhead: number, isPlaying: boolean, tracks: any[]) {
  if (isPlaying) {
    // Only start audio once when playback state transitions from paused to playing
    if (!lastPlaybackState) {
      masterAudioClock.start(playhead, tracks);
    }
  } else {
    if (lastPlaybackState) {
      masterAudioClock.pause();
    }
  }
  lastPlaybackState = isPlaying;
}

