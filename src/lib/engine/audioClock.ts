import type { AudioClockTelemetry, TimelineTrack, TimelineClip } from '../types';
import { Input, BlobSource, ALL_FORMATS, AudioBufferSink } from 'mediabunny';
import { getFileFromOPFS } from '../opfs';
import { evaluateSpeedCurve } from './speedCurve';

export class MasterAudioClock {
  private ctx: AudioContext | null = null;
  private isUnlocked = false;

  private isPlaying = false;
  private anchorAudioTime = 0;
  private anchorTimelineTime = 0;
  private playbackRate = 1.0;

  // Active playing audio source nodes and their gain nodes
  private activeSources = new Map<string, {
    source: AudioBufferSourceNode;
    gain: GainNode;
    clipId: string;
  }>();

  // Decoded AudioBuffer cache: assetKey -> AudioBuffer
  private audioBufferCache = new Map<string, AudioBuffer>();
  private pendingDecodes = new Map<string, Promise<AudioBuffer | null>>();

  // Telemetry
  private lastDriftMs = 0;

  constructor() {
    // AudioContext will be lazily initialized upon first user interaction
  }

  public getAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
    }
    return this.ctx;
  }

  public async ensureUnlocked(): Promise<boolean> {
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
        this.isUnlocked = true;
      } catch (err) {
        console.warn('AudioContext resume failed:', err);
        return false;
      }
    } else {
      this.isUnlocked = true;
    }
    return true;
  }

  public getLatency(): { baseLatency: number; outputLatency: number; totalLatency: number } {
    const ctx = this.getAudioContext();
    const base = ctx.baseLatency || 0;
    const output = (ctx as any).outputLatency || 0;
    return {
      baseLatency: base,
      outputLatency: output,
      totalLatency: base + output
    };
  }

  /**
   * Calculates the exact video presentation timestamp (PTS) compensation.
   * Compares the master audio presentation time with the audio hardware output latency.
   */
  public getVideoPresentationTime(timelineTime?: number): number {
    const t = timelineTime !== undefined ? timelineTime : this.getCurrentTime();
    const { totalLatency } = this.getLatency();
    return Math.max(0, t - totalLatency);
  }

  /**
   * Returns the current timeline time governed by the hardware audio clock.
   */
  public getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) {
      return this.anchorTimelineTime;
    }
    const elapsedAudioTime = Math.max(0, this.ctx.currentTime - this.anchorAudioTime);
    return this.anchorTimelineTime + (elapsedAudioTime * this.playbackRate);
  }

  public setPlaybackRate(rate: number) {
    if (rate <= 0) return;
    if (this.isPlaying) {
      // Re-anchor timeline time before changing playback rate
      const currentTimeline = this.getCurrentTime();
      this.anchorTimelineTime = currentTimeline;
      this.anchorAudioTime = this.ctx ? this.ctx.currentTime : 0;
    }
    this.playbackRate = rate;
  }

  /**
   * Start playback anchored to the hardware clock and schedule audio nodes.
   */
  public async start(timelineTime: number, tracks: TimelineTrack[], rate: number = 1.0) {
    await this.ensureUnlocked();
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn('AudioContext resume failed:', err);
      }
    }

    this.stopActiveSources(); // Stop previous nodes with micro-fade

    this.playbackRate = Math.max(0.1, Math.min(16.0, rate));
    this.anchorTimelineTime = Math.max(0, timelineTime);
    this.anchorAudioTime = ctx.currentTime;
    this.isPlaying = true;

    // Schedule audio clips starting from or crossing timelineTime
    this.scheduleClips(this.anchorTimelineTime, tracks);
  }

  /**
   * Pause playback with clicks/pops micro-fade out.
   */
  public pause(): number {
    const currentTimeline = this.getCurrentTime();
    this.isPlaying = false;
    this.anchorTimelineTime = currentTimeline;

    // Smoothly fade out and stop all active sources to prevent clicks/pops
    this.stopActiveSources();

    // W3C Web Audio API standard: suspend to freeze hardware clock (zero drift) & eliminate idle CPU usage
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }

    return currentTimeline;
  }

  /**
   * Seek to a new timeline position.
   */
  public seek(timelineTime: number, tracks?: TimelineTrack[]) {
    this.anchorTimelineTime = Math.max(0, timelineTime);
    if (this.ctx) {
      this.anchorAudioTime = this.ctx.currentTime;
    }

    this.stopActiveSources();

    if (this.isPlaying && tracks) {
      this.scheduleClips(this.anchorTimelineTime, tracks);
    }
  }

  /**
   * Real-time live volume adjustment for actively playing audio sources (pop/click-free ramp).
   */
  public updateClipVolumeLive(clipId: string, volume: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const targetGain = Math.max(0, Math.min(2.0, volume));
    for (const item of this.activeSources.values()) {
      if (item.clipId === clipId) {
        try {
          item.gain.gain.cancelScheduledValues(now);
          item.gain.gain.setValueAtTime(item.gain.gain.value, now);
          item.gain.gain.linearRampToValueAtTime(targetGain, now + 0.02);
        } catch (_) {
          item.gain.gain.value = targetGain;
        }
      }
    }
  }

  /**
   * Schedule audio buffers on the AudioContext timeline.
   */
  private scheduleClips(fromTimelineTime: number, tracks: TimelineTrack[]) {
    const ctx = this.getAudioContext();
    const now = ctx.currentTime;

    // Detect speech clips for auto-ducking
    let isSpeechActive = false;
    for (const track of tracks) {
      if (track.isMuted) continue;
      for (const clip of track.clips) {
        if (fromTimelineTime >= clip.startAt && fromTimelineTime <= clip.startAt + clip.duration) {
          if (clip.subtitles && clip.subtitles.length > 0) {
            const timeInClip = fromTimelineTime - clip.startAt;
            if (clip.subtitles.some(s => timeInClip >= s.start && timeInClip <= s.end)) {
              isSpeechActive = true;
              break;
            }
          }
        }
      }
      if (isSpeechActive) break;
    }

    // Collect asset IDs that are already represented on dedicated audio tracks (A1, A2...) to prevent double audio echo
    const audioTrackAssetIds = new Set<string>();
    for (const track of tracks) {
      if (track.isMuted) continue;
      if (track.name.startsWith('A')) {
        for (const clip of track.clips) {
          if (clip.assetId) audioTrackAssetIds.add(clip.assetId);
        }
      }
    }

    for (const track of tracks) {
      if (track.isMuted) continue;

      for (const clip of track.clips) {
        if (clip.type === 'text') continue;
        // If this is a video track clip and its audio is already handled on a dedicated audio track, skip to avoid double sound
        if (track.name.startsWith('V') && clip.assetId && audioTrackAssetIds.has(clip.assetId)) {
          continue;
        }
        const clipEnd = clip.startAt + clip.duration;

        // Clip is either currently active or starts shortly in the future
        if (clipEnd > fromTimelineTime) {
          this.scheduleSingleClip(clip, fromTimelineTime, now, isSpeechActive);
        }
      }
    }
  }

  private async scheduleSingleClip(
    clip: TimelineClip,
    timelineStart: number,
    audioNow: number,
    isSpeechActive: boolean
  ) {
    const ctx = this.getAudioContext();
    const buffer = await this.getOrDecodeAudioBuffer(clip);
    if (!buffer || !this.isPlaying) return;

    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // Pitch-preserving speed setting
      const currentSpeed = clip.speed ?? 1.0;
      source.playbackRate.value = currentSpeed * this.playbackRate;

      // Dedicated GainNode for sample-accurate volume automation & envelope
      const gainNode = ctx.createGain();

      // Envelope calculation
      const elapsed = Math.max(0, timelineStart - clip.startAt);
      let envelopeMultiplier = 1.0;
      const fadeInSec = clip.audioEnvelope?.fadeIn ?? 0;
      const fadeOutSec = clip.audioEnvelope?.fadeOut ?? 0;
      const remainingSec = clip.duration - elapsed;

      if (fadeInSec > 0 && elapsed < fadeInSec) {
        envelopeMultiplier *= Math.max(0, elapsed / fadeInSec);
      }
      if (fadeOutSec > 0 && remainingSec < fadeOutSec) {
        envelopeMultiplier *= Math.max(0, remainingSec / fadeOutSec);
      }

      // Auto-ducking: -12dB if ducking active
      if (clip.audioEnvelope?.ducking && isSpeechActive) {
        envelopeMultiplier *= 0.25;
      }

      const targetGain = Math.max(0, Math.min(2.0, (clip.volume ?? 1.0) * envelopeMultiplier));

      // Click/Pop-Free Envelope: 4ms micro-fade in
      gainNode.gain.setValueAtTime(0.0001, audioNow);
      gainNode.gain.linearRampToValueAtTime(targetGain, audioNow + 0.004);

      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      let when = audioNow;
      let offset = clip.sourceOffset || 0;
      let duration = clip.duration;

      if (timelineStart >= clip.startAt) {
        // Clip is already playing
        const timeIntoClip = (timelineStart - clip.startAt) * currentSpeed;
        offset += timeIntoClip;
        duration = Math.max(0, clip.duration - (timelineStart - clip.startAt));
        when = audioNow;
      } else {
        // Clip starts in the future
        const delayTimeline = (clip.startAt - timelineStart) / this.playbackRate;
        when = audioNow + delayTimeline;
      }

      // Validate offset & duration within buffer limits
      if (offset < buffer.duration && duration > 0) {
        const safeDuration = Math.min(duration, buffer.duration - offset);
        source.start(when, offset, safeDuration);

        const nodeKey = `${clip.id}_${Date.now()}`;
        this.activeSources.set(nodeKey, { source, gain: gainNode, clipId: clip.id });

        source.onended = () => {
          try {
            source.disconnect();
            gainNode.disconnect();
          } catch (_) {}
          this.activeSources.delete(nodeKey);
        };
      }
    } catch (err) {
      console.warn(`Failed to schedule audio clip ${clip.id}:`, err);
    }
  }

  /**
   * Stops all active sources with a 4ms micro-fade out to prevent clicks.
   */
  private stopActiveSources() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const fadeOutDuration = 0.004;

    for (const [key, item] of this.activeSources.entries()) {
      try {
        item.gain.gain.cancelScheduledValues(now);
        item.gain.gain.setValueAtTime(item.gain.gain.value, now);
        item.gain.gain.linearRampToValueAtTime(0.0001, now + fadeOutDuration);
        item.source.stop(now + fadeOutDuration);
        setTimeout(() => {
          try {
            item.source.disconnect();
            item.gain.disconnect();
          } catch (_) {}
        }, 20);
      } catch (_) {
        try { item.source.stop(); } catch (__) {}
        try {
          item.source.disconnect();
          item.gain.disconnect();
        } catch (___) {}
      }
    }
    this.activeSources.clear();
  }

  /**
   * Retrieves or decodes the audio track into an AudioBuffer using mediabunny / Web Audio.
   */
  public async getOrDecodeAudioBuffer(clip: TimelineClip): Promise<AudioBuffer | null> {
    const cacheKey = clip.assetId || clip.name || clip.id;
    if (this.audioBufferCache.has(cacheKey)) {
      return this.audioBufferCache.get(cacheKey)!;
    }

    if (this.pendingDecodes.has(cacheKey)) {
      return this.pendingDecodes.get(cacheKey)!;
    }

    const decodePromise = (async () => {
      try {
        let file: File | null = null;
        if (clip.name) {
          file = await getFileFromOPFS(clip.name);
        }
        if (!file && clip.sourceUrl) {
          const resp = await fetch(clip.sourceUrl);
          const blob = await resp.blob();
          file = new File([blob], clip.name || 'audio_track', { type: blob.type });
        }
        if (!file) return null;

        const ctx = this.getAudioContext();

        // 1. Try Mediabunny AudioBufferSink for demuxing from video/audio containers
        try {
          const input = new Input({
            source: new BlobSource(file),
            formats: ALL_FORMATS
          });
          try {
            const audioTrack = await input.getPrimaryAudioTrack();
            if (audioTrack) {
              const sink = new AudioBufferSink(audioTrack);
              const startSec = clip.sourceOffset || 0;
              const endSec = startSec + clip.duration + 1; // +1s buffer
              const wrappedBuffers: AudioBuffer[] = [];
              
              // Query buffer for the required clip range
              if (typeof (sink as any).buffers === 'function') {
                for await (const wrapped of (sink as any).buffers(startSec, endSec)) {
                  if (wrapped && wrapped.buffer) {
                    wrappedBuffers.push(wrapped.buffer);
                  } else if (wrapped instanceof AudioBuffer) {
                    wrappedBuffers.push(wrapped);
                  }
                }
              } else if (typeof sink.getBuffer === 'function') {
                const buf = await sink.getBuffer(startSec);
                if (buf) wrappedBuffers.push(buf as any);
              }

              if (wrappedBuffers.length > 0) {
                const merged = this.mergeAudioBuffers(ctx, wrappedBuffers);
                this.audioBufferCache.set(cacheKey, merged);
                return merged;
              }
            }
          } finally {
            try { input[Symbol.dispose]?.(); } catch (_) {}
          }
        } catch (mbErr) {
          // Fallback to standard Web Audio decodeAudioData if container is audio-only or unsupported
        }

        // 2. Fallback: native Web Audio decodeAudioData
        const arrayBuf = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuf);
        this.audioBufferCache.set(cacheKey, decoded);
        return decoded;
      } catch (err) {
        console.warn(`Audio decoding failed for clip ${clip.id}:`, err);
        return null;
      } finally {
        this.pendingDecodes.delete(cacheKey);
      }
    })();

    this.pendingDecodes.set(cacheKey, decodePromise);
    return decodePromise;
  }

  private mergeAudioBuffers(ctx: AudioContext, buffers: AudioBuffer[]): AudioBuffer {
    if (buffers.length === 1) return buffers[0];
    const numChannels = buffers[0].numberOfChannels;
    const sampleRate = buffers[0].sampleRate;
    const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);

    const merged = ctx.createBuffer(numChannels, totalLength, sampleRate);
    for (let ch = 0; ch < numChannels; ch++) {
      const dest = merged.getChannelData(ch);
      let offset = 0;
      for (const buf of buffers) {
        dest.set(buf.getChannelData(ch), offset);
        offset += buf.length;
      }
    }
    return merged;
  }

  public getTelemetry(): AudioClockTelemetry {
    const lat = this.getLatency();
    return {
      currentTime: this.getCurrentTime(),
      baseLatency: lat.baseLatency,
      outputLatency: lat.outputLatency,
      totalLatency: lat.totalLatency,
      driftMs: this.lastDriftMs,
      isPlaying: this.isPlaying,
      activeSources: this.activeSources.size
    };
  }

  public recordVideoDrift(videoPTS: number) {
    const expected = this.getVideoPresentationTime();
    this.lastDriftMs = (videoPTS - expected) * 1000;
  }

  public dispose() {
    this.stopActiveSources();
    this.audioBufferCache.clear();
    this.pendingDecodes.clear();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
  }
}

// Global Master Audio Clock Singleton
export const masterAudioClock = new MasterAudioClock();
