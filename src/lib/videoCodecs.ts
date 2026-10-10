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
  
  // Frame Cache (LRU for decoded keyframes to guarantee 0ms latency on repeated GOP hits)
  private _keyframeCache = new Map<number, VideoFrame>();
  private readonly MAX_CACHE_FRAMES = 16;
  
  // Telemetry
  private _lastPTS = 0;
  private _lastIsKeyframe = false;
  private _lastMode: 'fast_keyframe' | 'exact' | 'idle' = 'idle';
  private _lastDurationMs = 0;

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
      source: new BlobSource(file),
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

  async start(file: File): Promise<DecodedFrameResult | null> {
    await this.load(file);
    return await this.seek(0, { mode: 'exact' });
  }

  getDimensions() {
    return { width: this._width, height: this._height, duration: this._duration };
  }

  dispose() {
    if (this._pendingSeek) {
      this._pendingSeek.resolve(null);
      this._pendingSeek = null;
    }

    // Clean up cached frames to prevent GPU memory leaks
    for (const frame of this._keyframeCache.values()) {
      try { frame.close(); } catch {}
    }
    this._keyframeCache.clear();

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
