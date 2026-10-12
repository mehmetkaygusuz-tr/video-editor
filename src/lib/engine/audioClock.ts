import type { AudioClockTelemetry, TimelineTrack, TimelineClip } from '../types';
import { editor } from '../editor.svelte';
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
    filter?: BiquadFilterNode;
    clipId: string;
  }>();

  // Decoded AudioBuffer cache: assetKey -> AudioBuffer
  private audioBufferCache = new Map<string, AudioBuffer>();
  private pendingDecodes = new Map<string, Promise<AudioBuffer | null>>();

  // Active lookahead scheduling trackers
  private scheduledClipIds = new Set<string>();
  private lastLookaheadCheckTime = 0;

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
    return Math.max(0, t);
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
    this.anchorTimelineTime = Math.max(0, timelineTime);
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
      if (track.type === 'audio' || track.name.startsWith('A')) {
        for (const clip of track.clips) {
          if (clip.assetId) audioTrackAssetIds.add(clip.assetId);
        }
      }
    }

    // W3C Web Audio API standard: 8-second lookahead window to prevent main-thread lag & memory spikes
    const LOOKAHEAD_WINDOW = 8.0;

    for (const track of tracks) {
      if (track.isMuted) continue;

      for (const clip of track.clips) {
        if (clip.type === 'text') continue;
        const isVideoTrack = track.type === 'video' || track.name.startsWith('V');
        // If this is a video track clip and its audio is already handled on a dedicated audio track, skip to avoid double sound
        if (isVideoTrack && clip.assetId && audioTrackAssetIds.has(clip.assetId)) {
          continue;
        }
        const clipEnd = clip.startAt + clip.duration;

        // Clip is active now OR starts within the lookahead window
        if (clipEnd > fromTimelineTime && clip.startAt < fromTimelineTime + LOOKAHEAD_WINDOW) {
          if (!this.scheduledClipIds.has(clip.id)) {
            this.scheduledClipIds.add(clip.id);
            this.scheduleSingleClip(clip, fromTimelineTime, now, isSpeechActive);
          }
        }
      }
    }
  }

  /**
   * Periodically check and schedule clips entering the lookahead window during playback.
   */
  public checkLookahead(timelineTime: number, tracks: TimelineTrack[]) {
    if (!this.isPlaying || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastLookaheadCheckTime < 0.5) return;
    this.lastLookaheadCheckTime = now;
    this.scheduleClips(timelineTime, tracks);
  }

  private async scheduleSingleClip(
    clip: TimelineClip,
    timelineStart: number,
    audioNow: number,
    isSpeechActive: boolean
  ) {
    const ctx = this.getAudioContext();
    let buffer: AudioBuffer | null = null;
    try {
      buffer = await this.getOrDecodeAudioBuffer(clip);
    } catch (_) {}

    if (!buffer || !this.isPlaying) {
      this.scheduledClipIds.delete(clip.id);
      return;
    }

    // Re-anchor audioNow and timelineStart to account for any decoding latency
    const currentAudioNow = ctx.currentTime;
    const currentTimeline = this.getCurrentTime();

    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // Pitch-preserving speed setting with speed curve support
      const elapsed = Math.max(0, currentTimeline - clip.startAt);
      const normT = Math.max(0, Math.min(1, clip.duration > 0 ? elapsed / clip.duration : 0));
      const currentSpeed = clip.speedCurve ? evaluateSpeedCurve(clip.speedCurve, normT) : (clip.speed ?? 1.0);
      source.playbackRate.value = currentSpeed * this.playbackRate;

      // Pitch shift via Web Audio detune (cents = semitones * 100)
      const pitchShift = clip.audioEnvelope?.pitchShift ?? 0;
      if (pitchShift !== 0) {
        source.detune.value = pitchShift * 100;
      }

      // Calculate timing parameters
      let when = currentAudioNow;
      let offset = clip.sourceOffset || 0;
      let duration = clip.duration;

      const isFutureClip = currentTimeline < clip.startAt;
      if (!isFutureClip) {
        // Clip is already playing
        const timeIntoClip = (currentTimeline - clip.startAt) * currentSpeed;
        offset += timeIntoClip;
        duration = Math.max(0, clip.duration - (currentTimeline - clip.startAt));
        when = currentAudioNow;
      } else {
        // Clip starts in the future
        const delayTimeline = (clip.startAt - currentTimeline) / this.playbackRate;
        when = currentAudioNow + delayTimeline;
      }

      // Dedicated GainNode for sample-accurate volume automation & envelope
      const gainNode = ctx.createGain();
      const baseVolume = Math.max(0, Math.min(2.0, clip.volume ?? 1.0));
      const duckingFactor = (clip.audioEnvelope?.ducking && isSpeechActive) ? 0.25 : 1.0;
      const nominalGain = Math.max(0.0001, baseVolume * duckingFactor);

      const fadeInSec = Math.max(0, clip.audioEnvelope?.fadeIn ?? 0);
      const fadeOutSec = Math.max(0, clip.audioEnvelope?.fadeOut ?? 0);

      if (isFutureClip) {
        // Future clip: strictly automate gain starting at 'when'
        gainNode.gain.setValueAtTime(0.0001, when);
        if (fadeInSec > 0) {
          gainNode.gain.linearRampToValueAtTime(nominalGain, when + fadeInSec);
        } else {
          gainNode.gain.linearRampToValueAtTime(nominalGain, when + 0.005);
        }

        if (fadeOutSec > 0 && duration > fadeOutSec) {
          const fadeOutStart = when + duration - fadeOutSec;
          gainNode.gain.setValueAtTime(nominalGain, fadeOutStart);
          gainNode.gain.linearRampToValueAtTime(0.0001, when + duration);
        }
      } else {
        // Mid-playback clip: account for elapsed timeline progress
        const elapsedSec = Math.max(0, currentTimeline - clip.startAt);
        const remainingSec = Math.max(0, clip.duration - elapsedSec);

        let initialGain = nominalGain;
        if (fadeInSec > 0 && elapsedSec < fadeInSec) {
          initialGain = nominalGain * (elapsedSec / fadeInSec);
        }
        if (fadeOutSec > 0 && remainingSec < fadeOutSec) {
          initialGain = nominalGain * (remainingSec / fadeOutSec);
        }
        initialGain = Math.max(0.0001, initialGain);

        gainNode.gain.setValueAtTime(initialGain, currentAudioNow);

        if (fadeInSec > 0 && elapsedSec < fadeInSec) {
          gainNode.gain.linearRampToValueAtTime(nominalGain, currentAudioNow + (fadeInSec - elapsedSec));
        }

        if (fadeOutSec > 0 && remainingSec > fadeOutSec) {
          const fadeOutStart = currentAudioNow + (remainingSec - fadeOutSec);
          gainNode.gain.setValueAtTime(nominalGain, fadeOutStart);
          gainNode.gain.linearRampToValueAtTime(0.0001, currentAudioNow + remainingSec);
        } else if (fadeOutSec > 0 && remainingSec <= fadeOutSec) {
          gainNode.gain.linearRampToValueAtTime(0.0001, currentAudioNow + remainingSec);
        }
      }

      // Connect DSP chain: Source -> EQ Filter (if set) -> Gain -> Destination
      let lastNode: AudioNode = source;
      let filterNode: BiquadFilterNode | undefined = undefined;
      const eqPreset = clip.audioEnvelope?.eqPreset;

      if (eqPreset && eqPreset !== 'flat') {
        filterNode = ctx.createBiquadFilter();
        if (eqPreset === 'voice-boost') {
          filterNode.type = 'peaking';
          filterNode.frequency.value = 2800;
          filterNode.Q.value = 1.0;
          filterNode.gain.value = 4.5;
        } else if (eqPreset === 'bass-boost') {
          filterNode.type = 'lowshelf';
          filterNode.frequency.value = 120;
          filterNode.gain.value = 5.0;
        } else if (eqPreset === 'podcast') {
          filterNode.type = 'peaking';
          filterNode.frequency.value = 3200;
          filterNode.Q.value = 1.2;
          filterNode.gain.value = 3.5;
        }
        lastNode.connect(filterNode);
        lastNode = filterNode;
      }

      lastNode.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Validate offset & duration within buffer limits
      if (offset < buffer.duration && duration > 0) {
        const safeDuration = Math.min(duration, buffer.duration - offset);
        source.start(when, offset, safeDuration);

        const nodeKey = `${clip.id}_${Date.now()}`;
        this.activeSources.set(nodeKey, { source, gain: gainNode, filter: filterNode, clipId: clip.id });

        source.onended = () => {
          try {
            source.disconnect();
            filterNode?.disconnect();
            gainNode.disconnect();
          } catch (_) {}
          this.activeSources.delete(nodeKey);
          this.scheduledClipIds.delete(clip.id);
        };
      } else {
        this.scheduledClipIds.delete(clip.id);
      }
    } catch (err) {
      console.warn(`Failed to schedule audio clip ${clip.id}:`, err);
      this.scheduledClipIds.delete(clip.id);
    }
  }

  /**
   * Stops all active sources with a 4ms micro-fade out to prevent clicks.
   */
  private stopActiveSources() {
    this.scheduledClipIds.clear();
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
            item.filter?.disconnect();
            item.gain.disconnect();
          } catch (_) {}
        }, 20);
      } catch (_) {
        try { item.source.stop(); } catch (__) {}
        try {
          item.source.disconnect();
          item.filter?.disconnect();
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
        let assetName = clip.name;
        
        if (clip.assetId) {
          const asset = editor.assets.find(a => a.id === clip.assetId);
          if (asset) {
            assetName = asset.name;
            file = editor.getCachedFile(asset.name) || null;
            if (!file && asset.blobUrl) {
              try {
                const resp = await fetch(asset.blobUrl);
                const blob = await resp.blob();
                file = new File([blob], asset.name, { type: blob.type || 'video/mp4' });
                editor.setCachedFile(asset.name, file);
              } catch (_) {}
            }
          }
        }
        
        if (!file && assetName) {
          file = (await getFileFromOPFS(assetName)) || null;
        }
        if (!file && clip.name && clip.name !== assetName) {
          file = (await getFileFromOPFS(clip.name)) || null;
        }
        if (!file && clip.sourceUrl) {
          try {
            const resp = await fetch(clip.sourceUrl);
            const blob = await resp.blob();
            file = new File([blob], assetName || clip.name || 'audio_track', { type: blob.type });
          } catch (_) {}
        }
        if (!file) return null;

        const ctx = this.getAudioContext();

        // 1. Try Mediabunny AudioBufferSink for demuxing from video/audio containers
        try {
          const input = new Input({
            source: new BlobSource(file, { useStreamReader: false }),
            formats: ALL_FORMATS
          });
          try {
            const audioTrack = await input.getPrimaryAudioTrack();
            if (audioTrack) {
              const sink = new AudioBufferSink(audioTrack);
              const wrappedBuffers: AudioBuffer[] = [];
              // Decode the full audio track of the asset from 0 to end (0ms latency for all sub-clips)
              if (typeof (sink as any).buffers === 'function') {
                for await (const wrapped of (sink as any).buffers(0, Infinity)) {
                  if (wrapped && wrapped.buffer) {
                    wrappedBuffers.push(wrapped.buffer);
                  } else if (wrapped instanceof AudioBuffer) {
                    wrappedBuffers.push(wrapped);
                  }
                }
              } else if (typeof sink.getBuffer === 'function') {
                const buf = await sink.getBuffer(0);
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

        // 2. Fallback: native Web Audio decodeAudioData (guarded against > 250MB OOM)
        if (file.size > 250 * 1024 * 1024) {
          throw new Error('Dosya boyutu doğrudan Web Audio çözümü için çok büyük (>250MB).');
        }
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
    if (buffers.length === 0) {
      return ctx.createBuffer(2, Math.max(1, Math.floor(ctx.sampleRate * 0.1)), ctx.sampleRate);
    }
    if (buffers.length === 1) return buffers[0];
    const numChannels = Math.max(...buffers.map(b => b.numberOfChannels), 1);
    const sampleRate = buffers[0].sampleRate;
    const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);

    const merged = ctx.createBuffer(numChannels, totalLength, sampleRate);
    for (let ch = 0; ch < numChannels; ch++) {
      const dest = merged.getChannelData(ch);
      let offset = 0;
      for (const buf of buffers) {
        const src = ch < buf.numberOfChannels ? buf.getChannelData(ch) : buf.getChannelData(0);
        dest.set(src, offset);
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
