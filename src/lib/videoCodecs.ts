import { 
  Input, 
  BlobSource, 
  ALL_FORMATS, 
  VideoSampleSink, 
  EncodedPacketSink, 
  type InputVideoTrack 
} from 'mediabunny';
import type { 
  IDecoderEngine, 
  SeekOptions, 
  DecodedFrameResult, 
  DecoderTelemetry 
} from './types';

interface PendingSeek {
  timeInSeconds: number;
  options?: SeekOptions;
  resolve: (result: DecodedFrameResult | null) => void;
  reject: (err: any) => void;
}

export class VideoDecoderWrapper implements IDecoderEngine {
  private input: Input | null = null;
  private videoTrack: InputVideoTrack | null = null;
  private sink: VideoSampleSink | null = null;
  private packetSink: EncodedPacketSink | null = null;
  
  private _fileLoaded = false;
  private _isDecoding = false;
  private _pendingSeek: PendingSeek | null = null;
  
  private _duration = 0;
  private _width = 0;
  private _height = 0;
  private _codec: string | null = null;
  
  // GOP & Keyframe metadata
  private _keyframeTimestamps: number[] = [];
  private _keyframeIndexingPromise: Promise<void> | null = null;
  
  // Frame Cache (LRU for decoded keyframes and recent exact frames for 0ms latency on repeated hits)
  private _keyframeCache = new Map<number, VideoFrame>();
  private readonly MAX_CACHE_FRAMES = 16;
  private _recentFrameCache = new Map<number, VideoFrame>();
  private readonly MAX_RECENT_FRAMES = 12;

  // Forward-Streaming Lookahead Ring Buffer for 60fps stutter-free continuous playback
  private _streamBuffer: { pts: number; duration: number; frame: VideoFrame }[] = [];
  private _streamCancelToken: { cancelled: boolean } | null = null;
  private _streamActive = false;
  private _isStreamFilling = false;
  private readonly MAX_RING_BUFFER = 24;
  
  // Telemetry
  private _lastPTS = 0;
  private _lastIsKeyframe = false;
  private _lastMode: 'fast_keyframe' | 'exact' | 'idle' = 'idle';
  private _lastDurationMs = 0;
  private _lastPlaybackFrame: VideoFrame | null = null;

  get isLoaded(): boolean {
    return this._fileLoaded;
  }

  get duration(): number {
    return this._duration;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get codec(): string | null {
    return this._codec;
  }

  get telemetry(): DecoderTelemetry {
    return {
      lastPTS: this._lastPTS,
      isKeyframe: this._lastIsKeyframe,
      mode: this._lastMode,
      decodeDurationMs: this._lastDurationMs,
      keyframeCount: this._keyframeTimestamps.length,
      cachedKeyframes: this._keyframeCache.size,
      renderFps: this._lastDurationMs > 0 ? Math.round(1000 / this._lastDurationMs) : 0
    };
  }

  constructor() {}

  async load(file: File): Promise<void> {
    this.dispose();

    this.input = new Input({
      source: new BlobSource(file, { useStreamReader: false }),
      formats: ALL_FORMATS
    });

    this.videoTrack = await this.input.getPrimaryVideoTrack();
    if (!this.videoTrack) {
      throw new Error('Dosyada çözülebilir video parçası bulunamadı.');
    }

    this._width = await this.videoTrack.getDisplayWidth();
    this._height = await this.videoTrack.getDisplayHeight();
    this._duration = await this.videoTrack.computeDuration();
    
    try {
      this._codec = (await this.videoTrack.getCodec()) || 'unknown';
    } catch {
      this._codec = 'unknown';
    }

    // Hardware accelerated low-latency sink with software fallback
    try {
      this.sink = new VideoSampleSink(this.videoTrack, {
        hardwareAcceleration: 'no-preference',
        optimizeForLatency: true
      });
    } catch {
      this.sink = new VideoSampleSink(this.videoTrack);
    }

    this.packetSink = new EncodedPacketSink(this.videoTrack);
    this._fileLoaded = true;

    // Start background keyframe indexing (non-blocking)
    this._keyframeIndexingPromise = this.indexKeyframes();
  }

  private async indexKeyframes(): Promise<void> {
    if (!this.packetSink) return;
    try {
      const timestamps: number[] = [];
      let cur = await this.packetSink.getFirstKeyPacket({ metadataOnly: true });
      let safetyCount = 0;
      
      while (cur && safetyCount < 4000) {
        timestamps.push(cur.timestamp);
        cur = await this.packetSink.getNextKeyPacket(cur, { metadataOnly: true });
        safetyCount++;
        if (safetyCount % 50 === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }

      if (timestamps.length > 0) {
        this._keyframeTimestamps = timestamps.sort((a, b) => a - b);
      }
    } catch (err) {
      console.warn('[VideoDecoderWrapper] Keyframe indeksleme uyarısı:', err);
    }
  }

  getKeyframeTimestamps(): number[] {
    return [...this._keyframeTimestamps];
  }

  getNearestKeyframe(timeInSeconds: number): number {
    const target = Math.max(0, timeInSeconds);
    const keys = this._keyframeTimestamps;
    
    if (keys.length === 0) return 0;
    if (target <= keys[0]) return keys[0];
    if (target >= keys[keys.length - 1]) return keys[keys.length - 1];

    // Binary search for largest keyframe <= target
    let low = 0;
    let high = keys.length - 1;
    let best = keys[0];

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (keys[mid] <= target) {
        best = keys[mid];
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best;
  }

  /**
   * Coalesced seek request: if a decode is already executing, supersedes prior pending seeks
   * and dispatches immediately upon completion of the active decode.
   */
  async seek(timeInSeconds: number, options?: SeekOptions): Promise<DecodedFrameResult | null> {
    if (!this._fileLoaded || !this.sink) return null;

    if (this._isDecoding) {
      return new Promise<DecodedFrameResult | null>((resolve, reject) => {
        // Resolve prior pending seek as superseded (null)
        if (this._pendingSeek) {
          this._pendingSeek.resolve(null);
        }
        this._pendingSeek = {
          timeInSeconds,
          options,
          resolve,
          reject
        };
      });
    }

    this._isDecoding = true;
    try {
      const result = await this.executeSeek(timeInSeconds, options);
      return result;
    } finally {
      this._isDecoding = false;
      this.drainPendingSeek();
    }
  }

  private drainPendingSeek() {
    if (this._pendingSeek && !this._isDecoding) {
      const next = this._pendingSeek;
      this._pendingSeek = null;
      this.seek(next.timeInSeconds, next.options)
        .then(next.resolve)
        .catch(next.reject);
    }
  }

  private async executeSeek(timeInSeconds: number, options?: SeekOptions): Promise<DecodedFrameResult | null> {
    if (!this.sink) return null;

    const tStart = performance.now();
    const targetTime = Math.max(0, Math.min(this._duration, timeInSeconds));
    const mode = options?.mode || 'adaptive';

    // Step 1: GOP-Aware Two-Tier Seek Logic
    const nearestKey = this.getNearestKeyframe(targetTime);
    const isFastKeyframeMode = mode === 'fast_keyframe';

    // Cache check for keyframe mode
    if (isFastKeyframeMode && this._keyframeCache.has(nearestKey)) {
      const cached = this._keyframeCache.get(nearestKey)!;
      const durationMs = performance.now() - tStart;
      this._lastPTS = nearestKey;
      this._lastIsKeyframe = true;
      this._lastMode = 'fast_keyframe';
      this._lastDurationMs = durationMs;

      return {
        frame: cached.clone(),
        pts: nearestKey,
        isKeyframe: true,
        mode: 'fast_keyframe',
        decodeDurationMs: durationMs
      };
    }

    // Cache check for recent exact frame hits (instant 0ms scrubbing response)
    if (!isFastKeyframeMode) {
      for (const [pts, cachedFrame] of this._recentFrameCache.entries()) {
        if (Math.abs(pts - targetTime) < 0.015) {
          const durationMs = performance.now() - tStart;
          this._lastPTS = pts;
          this._lastIsKeyframe = false;
          this._lastMode = 'exact';
          this._lastDurationMs = durationMs;
          return {
            frame: cachedFrame.clone(),
            pts,
            isKeyframe: false,
            mode: 'exact',
            decodeDurationMs: durationMs
          };
        }
      }
    }

    try {
      // For fast_keyframe, we decode directly at the nearest keyframe PTS
      const requestPTS = isFastKeyframeMode ? nearestKey : targetTime;
      let sample = await this.sink.getSample(requestPTS);
      
      // If null, timestamp might be before the first frame in the track (e.g. targetTime=0, but first PTS is 0.033 or 0.080)
      if (!sample && this._keyframeTimestamps.length > 0) {
        const firstKey = this._keyframeTimestamps[0];
        if (requestPTS <= firstKey || targetTime <= firstKey) {
          sample = await this.sink.getSample(firstKey);
        }
      }

      // If still null, try nearest keyframe
      if (!sample && nearestKey !== requestPTS) {
        sample = await this.sink.getSample(nearestKey);
      }

      // Sequential fallback if near start
      if (!sample && targetTime < 0.5) {
        try {
          const iter = this.sink.samples();
          const first = await iter.next();
          if (first && !first.done && first.value) {
            sample = first.value;
          }
        } catch (_) {}
      }

      if (!sample) return null;

      const frame = sample.toVideoFrame();
      const samplePTS = sample.timestamp;
      sample.close();

      const isKey = Math.abs(samplePTS - nearestKey) < 0.001 || isFastKeyframeMode;
      const durationMs = performance.now() - tStart;

      // Cache keyframes into LRU cache for 0ms future scrubbing
      if (isKey) {
        if (this._keyframeCache.size >= this.MAX_CACHE_FRAMES) {
          const oldestKey = this._keyframeCache.keys().next().value;
          if (oldestKey !== undefined) {
            const evicted = this._keyframeCache.get(oldestKey);
            evicted?.close();
            this._keyframeCache.delete(oldestKey);
          }
        }
        this._keyframeCache.set(nearestKey, frame.clone());
      }

      // Cache recent exact frames for 0ms scrubbing
      if (!isFastKeyframeMode) {
        if (this._recentFrameCache.size >= this.MAX_RECENT_FRAMES) {
          const oldest = this._recentFrameCache.keys().next().value;
          if (oldest !== undefined) {
            const evicted = this._recentFrameCache.get(oldest);
            try { evicted?.close(); } catch (_) {}
            this._recentFrameCache.delete(oldest);
          }
        }
        this._recentFrameCache.set(samplePTS, frame.clone());
      }

      this._lastPTS = samplePTS;
      this._lastIsKeyframe = isKey;
      this._lastMode = isFastKeyframeMode ? 'fast_keyframe' : 'exact';
      this._lastDurationMs = durationMs;

      return {
        frame,
        pts: samplePTS,
        isKeyframe: isKey,
        mode: isFastKeyframeMode ? 'fast_keyframe' : 'exact',
        decodeDurationMs: durationMs
      };
    } catch (err) {
      console.warn('[VideoDecoderWrapper] mediabunny decode hatası:', err);
      return null;
    }
  }

  /**
   * Continuous forward streaming frame retrieval (O(1) sub-millisecond latency).
   * Pulls pre-decoded frames from the forward streaming ring buffer,
   * completely eliminating repeated GOP seeks during playback.
   */
  async getPlaybackFrame(timeInSeconds: number): Promise<DecodedFrameResult | null> {
    if (!this._fileLoaded || !this.sink) return null;

    const tStart = performance.now();
    const targetTime = Math.max(0, Math.min(this._duration, timeInSeconds));

    // Determine if the streaming pipeline needs to be initialized or repositioned
    const hasBuffer = this._streamBuffer.length > 0;
    const bufferHeadPTS = hasBuffer ? this._streamBuffer[0].pts : 0;
    const bufferTailPTS = hasBuffer ? this._streamBuffer[this._streamBuffer.length - 1].pts : 0;

    const isOutOfBufferRange = !hasBuffer || 
      targetTime < bufferHeadPTS - 0.25 || 
      targetTime > bufferTailPTS + 0.8;

    if (!this._streamActive || isOutOfBufferRange) {
      this.stopStreaming();
      const token = { cancelled: false };
      this._streamCancelToken = token;
      this._fillStreamBuffer(targetTime, token);
    }

    // Wait adequately (up to 120ms with 5ms polls) if the buffer is empty immediately after streaming starts
    if (this._streamBuffer.length === 0 && this._isStreamFilling) {
      let waited = 0;
      while (this._streamBuffer.length === 0 && this._isStreamFilling && waited < 120 && !this._streamCancelToken?.cancelled) {
        await new Promise(r => setTimeout(r, 5));
        waited += 5;
      }
    }

    // Prune stale frames that have already elapsed in presentation time
    while (this._streamBuffer.length > 1 && this._streamBuffer[1].pts <= targetTime) {
      const stale = this._streamBuffer.shift()!;
      try { stale.frame.close(); } catch {}
    }

    // Check if the head frame matches the target presentation time
    if (this._streamBuffer.length > 0) {
      const candidate = this._streamBuffer[0];
      if (Math.abs(candidate.pts - targetTime) <= 0.4) {
        const durationMs = performance.now() - tStart;
        this._lastPTS = candidate.pts;
        this._lastIsKeyframe = false;
        this._lastMode = 'exact';
        this._lastDurationMs = durationMs;

        try { this._lastPlaybackFrame?.close(); } catch {}
        this._lastPlaybackFrame = candidate.frame.clone();

        return {
          frame: candidate.frame.clone(),
          pts: candidate.pts,
          isKeyframe: false,
          mode: 'exact',
          decodeDurationMs: durationMs
        };
      }
    }

    // If stream is still active/filling, return held frame (Frame Holding) rather than spawning
    // a competing decoder seek that thrashes the GPU!
    if (this._isStreamFilling && this._lastPlaybackFrame) {
      const durationMs = performance.now() - tStart;
      return {
        frame: this._lastPlaybackFrame.clone(),
        pts: this._lastPTS,
        isKeyframe: false,
        mode: 'exact',
        decodeDurationMs: durationMs
      };
    }

    // Fallback: adaptive seek only if streaming pipeline is completely inactive
    if (!this._streamActive) {
      const res = await this.seek(targetTime, { mode: 'adaptive' });
      if (res?.frame) {
        try { this._lastPlaybackFrame?.close(); } catch {}
        this._lastPlaybackFrame = res.frame.clone();
      }
      return res;
    }

    if (this._lastPlaybackFrame) {
      return {
        frame: this._lastPlaybackFrame.clone(),
        pts: this._lastPTS,
        isKeyframe: false,
        mode: 'exact',
        decodeDurationMs: performance.now() - tStart
      };
    }

    return null;
  }

  private async _fillStreamBuffer(startPTS: number, token: { cancelled: boolean }) {
    if (!this.sink) return;
    this._streamActive = true;
    this._isStreamFilling = true;
    try {
      const iter = this.sink.samples(startPTS);
      for await (const sample of iter) {
        if (token.cancelled || !this.sink) {
          try { sample.close(); } catch {}
          try { await iter.return(); } catch {}
          break;
        }

        // Backpressure: throttle when buffer is full
        while (this._streamBuffer.length >= this.MAX_RING_BUFFER && !token.cancelled) {
          await new Promise(r => setTimeout(r, 10));
        }

        if (token.cancelled || !this.sink) {
          try { sample.close(); } catch {}
          try { await iter.return(); } catch {}
          break;
        }

        try {
          const frame = sample.toVideoFrame();
          const pts = sample.timestamp;
          const dur = sample.duration;
          sample.close();
          if (token.cancelled || !this.sink) {
            try { frame.close(); } catch {}
            break;
          }
          this._streamBuffer.push({ pts, duration: dur, frame });
        } catch {
          try { sample.close(); } catch {}
        }
      }
    } catch (_) {
      // End of media or cancelled iteration
    } finally {
      if (token === this._streamCancelToken) {
        this._streamActive = false;
        this._isStreamFilling = false;
      }
    }
  }

  stopStreaming(): void {
    if (this._streamCancelToken) {
      this._streamCancelToken.cancelled = true;
      this._streamCancelToken = null;
    }
    this._streamActive = false;
    this._isStreamFilling = false;
    for (const item of this._streamBuffer) {
      try { item.frame.close(); } catch {}
    }
    this._streamBuffer = [];
  }

  async start(file: File): Promise<DecodedFrameResult | null> {
    await this.load(file);
    return await this.seek(0, { mode: 'exact' });
  }

  getDimensions() {
    return { width: this._width, height: this._height, duration: this._duration };
  }

  dispose() {
    this.stopStreaming();

    try {
      this._lastPlaybackFrame?.close();
    } catch {}
    this._lastPlaybackFrame = null;

    if (this._pendingSeek) {
      this._pendingSeek.resolve(null);
      this._pendingSeek = null;
    }

    // Clean up cached frames to prevent GPU memory leaks
    for (const frame of this._keyframeCache.values()) {
      try { frame.close(); } catch {}
    }
    this._keyframeCache.clear();

    for (const frame of this._recentFrameCache.values()) {
      try { frame.close(); } catch {}
    }
    this._recentFrameCache.clear();

    this.sink = null;
    this.packetSink = null;
    this.videoTrack = null;
    this._keyframeTimestamps = [];
    this._keyframeIndexingPromise = null;

    if (this.input && !this.input.disposed) {
      try {
        this.input[Symbol.dispose]?.();
      } catch {}
      this.input = null;
    }

    this._fileLoaded = false;
    this._isDecoding = false;
    this._lastMode = 'idle';
  }
}
