import { Input, BlobSource, ALL_FORMATS, VideoSampleSink, EncodedPacketSink } from 'mediabunny';

let currentFileNode: File | null = null;
let currentInput: Input | null = null;
let currentSink: VideoSampleSink | null = null;
let packetSink: EncodedPacketSink | null = null;
let deviceCapabilities = { canPlay4K: true, isPowerEfficient: false };
let isSeeking = false;

// Frame Cache for fast scrubbing (LRU-like, limited to prevent VRAM spikes)
const MAX_CACHE_SIZE = 16;
let frameCache: { time: number; frameData: ImageBitmap }[] = [];

function clearFrameCache() {
  while (frameCache.length > 0) {
    const item = frameCache.pop();
    try {
      item?.frameData?.close?.();
    } catch {}
  }
}

// SAB for sync
let timeBuffer: Float64Array | null = null;
let loopActive = false;
let lastRenderedTime = -1;

async function getOrCreateDemuxer(file: File): Promise<boolean> {
  if (currentFileNode && currentFileNode.name === file.name && currentSink) {
    return true;
  }

  // Cleanup previous state
  if (currentInput && !currentInput.disposed) {
    try {
      currentInput[Symbol.dispose]?.();
    } catch {}
  }
  currentInput = null;
  currentSink = null;
  packetSink = null;
  currentFileNode = file;
  clearFrameCache();

  try {
    currentInput = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS
    });

    const videoTrack = await currentInput.getPrimaryVideoTrack();
    if (!videoTrack) {
      console.error('[DemuxerWorker] No video track found.');
      return false;
    }

    try {
      currentSink = new VideoSampleSink(videoTrack, {
        hardwareAcceleration: deviceCapabilities.isPowerEfficient ? 'prefer-hardware' : 'no-preference',
        optimizeForLatency: true
      });
    } catch {
      currentSink = new VideoSampleSink(videoTrack);
    }

    packetSink = new EncodedPacketSink(videoTrack);
    return true;
  } catch (err: any) {
    console.error('[DemuxerWorker] Failed to setup Mediabunny Demuxer:', err);
    return false;
  }
}

async function renderFrameAtTime(file: File, targetTime: number) {
  if (isSeeking) return;
  isSeeking = true;
  try {
    // Check cache first
    const cached = frameCache.find(c => Math.abs(c.time - targetTime) < 0.05);
    if (cached) {
      let frame: VideoFrame | null = null;
      try {
        frame = new VideoFrame(cached.frameData, { timestamp: cached.time * 1_000_000 });
        (self as any).postMessage(
          { type: 'frame_ready', payload: { frame, timestamp: targetTime, isSeek: true } },
          [frame as unknown as Transferable]
        );
      } catch (cacheErr) {
        console.warn('[DemuxerWorker] Error using cached frame:', cacheErr);
        try { frame?.close(); } catch (_) {}
      }
      isSeeking = false;
      return;
    }

    const ready = await getOrCreateDemuxer(file);
    if (!ready || !currentSink) return;

    const sample = await currentSink.getSample(targetTime);
    if (!sample) return;

    const frame = sample.toVideoFrame();
    const actualTime = sample.timestamp;
    sample.close();

    // Pass frame to main thread
    let frameToSend: VideoFrame | null = null;
    try {
      frameToSend = frame.clone();
      (self as any).postMessage(
        { type: 'frame_ready', payload: { frame: frameToSend, timestamp: actualTime, isSeek: isSeeking } },
        [frameToSend as unknown as Transferable]
      );
    } catch (postErr) {
      console.warn('[DemuxerWorker] Frame transfer error:', postErr);
      try { frameToSend?.close(); } catch (_) {}
    }

    // Cache as ImageBitmap to prevent GPU memory limits
    createImageBitmap(frame)
      .then(bitmap => {
        frameCache.push({ time: actualTime, frameData: bitmap });
        if (frameCache.length > MAX_CACHE_SIZE) {
          const oldest = frameCache.shift();
          oldest?.frameData.close();
        }
        frame.close();
      })
      .catch(e => {
        console.error('[DemuxerWorker] Failed to create ImageBitmap cache:', e);
        frame.close();
      });
  } catch (err: any) {
    console.warn('[DemuxerWorker] Seek error:', err);
  } finally {
    isSeeking = false;
  }
}

// Loop to sync via SharedArrayBuffer
function syncLoop() {
  if (!loopActive || !timeBuffer || !currentFileNode) return;

  const targetTime = timeBuffer[0];
  if (targetTime !== lastRenderedTime && targetTime >= 0) {
    lastRenderedTime = targetTime;
    renderFrameAtTime(currentFileNode, targetTime);
  }

  setTimeout(syncLoop, 1000 / 60);
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'init_sab') {
    timeBuffer = new Float64Array(payload.sab);
    currentFileNode = payload.file;
    loopActive = true;
    syncLoop();
    return;
  }

  if (type === 'seek') {
    const file: File = payload.file;
    const timestamp: number = payload.timestamp ?? payload.time ?? 0;
    if (file) await renderFrameAtTime(file, timestamp);
    return;
  }

  if (type === 'abort_demux') {
    loopActive = false;
    clearFrameCache();
    return;
  }

  if (type === 'set_capabilities') {
    deviceCapabilities = payload;
    console.log('[DemuxerWorker] Capabilities updated:', deviceCapabilities.canPlay4K);
    return;
  }
};

