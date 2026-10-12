import { editor } from '../editor.svelte';
import { engineState } from './engineState.svelte';
import { VideoDecoderWrapper } from '../videoCodecs';
import type { SeekOptions } from '../types';

export type WorkerMessage = {
    type: string;
    payload?: any;
};

const MAX_ACTIVE_DECODERS = 8;

export class EngineOrchestrator {
    #demuxerWorker: Worker | null = null;
    #aiWorker: Worker | null = null;
    #mediaWorker: Worker | null = null;
    #canvas: HTMLCanvasElement | null = null;
    #ctx: CanvasRenderingContext2D | null = null;
    #canvasConfigured = false;
    #aiMessageListeners: ((data: any) => void)[] = [];
    #mediaMessageListeners: ((data: any) => void)[] = [];
    #decoderMap = new Map<string, VideoDecoderWrapper>();
    #loadingPromises = new Map<string, Promise<VideoDecoderWrapper | null>>();
    #videoElementCache = new Map<string, HTMLVideoElement>();

    // SAB Synchronization (with fallback)
    #sab = typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(8) : null;
    #timeBuffer = this.#sab ? new Float64Array(this.#sab) : null;

    get aiWorker(): Worker | null {
        if (!this.#aiWorker) this.initWorkers();
        return this.#aiWorker;
    }

    get mediaWorker(): Worker | null {
        if (!this.#mediaWorker) this.initWorkers();
        return this.#mediaWorker;
    }

    addAiMessageListener(listener: (data: any) => void) {
        this.#aiMessageListeners.push(listener);
        return () => {
            this.#aiMessageListeners = this.#aiMessageListeners.filter(l => l !== listener);
        };
    }

    addMediaMessageListener(listener: (data: any) => void) {
        this.#mediaMessageListeners.push(listener);
        return () => {
            this.#mediaMessageListeners = this.#mediaMessageListeners.filter(l => l !== listener);
        };
    }

    initWorkers() {
        if (typeof window !== 'undefined' && !this.#demuxerWorker) {
            console.log('[Orchestrator] Initializing worker pool...');
            this.#demuxerWorker = new Worker(new URL('./workers/demuxer.worker.ts', import.meta.url), { type: 'module' });
            this.#aiWorker = new Worker(new URL('./workers/ai.worker.ts', import.meta.url), { type: 'module' });
            this.#mediaWorker = new Worker(new URL('./workers/media.worker.ts', import.meta.url), { type: 'module' });

            this.setupMessageHandlers();
            this.probeDeviceCapabilities();
        }
    }

    setupCanvas(canvas: HTMLCanvasElement) {
        if (this.#canvasConfigured && this.#canvas === canvas) return;
        this.#canvas = canvas;
        this.#ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) 
                 || canvas.getContext('2d');
        this.#canvasConfigured = true;
        editor.updateGpuTelemetry({
            isHardwareAccelerated: true,
            isDualTexturePass: false,
            activeTransition: null,
            pipelineStatus: 'webgpu_active'
        });
    }

    resizeCanvas(width: number, height: number) {
        if (this.#canvas) {
            if (this.#canvas.width !== width) this.#canvas.width = width;
            if (this.#canvas.height !== height) this.#canvas.height = height;
        }
    }

    private setupMessageHandlers() {
        if (this.#demuxerWorker) {
            this.#demuxerWorker.onmessage = (e: MessageEvent<WorkerMessage>) => {
                const { type, payload } = e.data;
                if (type === 'frame_ready' && payload.frame) {
                    if (this.#canvas && this.#ctx) {
                        try {
                            this.#ctx.drawImage(payload.frame, 0, 0, this.#canvas.width, this.#canvas.height);
                        } finally {
                            try { payload.frame.close(); } catch (_) {}
                        }
                    }
                } else {
                    this.handleWorkerMessage('demuxer', type, payload);
                }
            };
        }

        if (this.#aiWorker) {
            this.#aiWorker.onmessage = (e: MessageEvent<WorkerMessage>) => {
                const { type, payload } = e.data;
                for (const listener of this.#aiMessageListeners) listener(e.data);
                if (type.startsWith('ai_')) {
                    if (type === 'ai_progress') {
                        engineState.updateStatus('processing', payload.message ?? engineState.message, payload.progress ?? engineState.progress);
                    }
                    return;
                }
                this.handleWorkerMessage('ai', type, payload);
            };
            this.#aiWorker.onerror = (e: ErrorEvent) => {
                console.error('[Orchestrator] AI Worker error event:', e.message);
                for (const listener of this.#aiMessageListeners) {
                    listener({
                        type: 'ai_error',
                        error: e.message || 'AI Web Worker başlatılamadı veya çöktü.',
                        payload: { error: e.message || 'AI Web Worker başlatılamadı veya çöktü.' }
                    } as any);
                }
            };
        }

        if (this.#mediaWorker) {
            this.#mediaWorker.onmessage = (e: MessageEvent<WorkerMessage>) => {
                const { type, payload } = e.data;
                for (const listener of this.#mediaMessageListeners) listener(e.data);
                if (type.startsWith('media_')) return;
                this.handleWorkerMessage('media', type, payload);
            };
        }
    }

    private handleWorkerMessage(source: string, type: string, payload: any) {
        if (type === 'progress') {
            const prog = payload.progress ?? engineState.progress;
            const msg = payload.message ?? engineState.message;
            if (source === 'demuxer') engineState.updateStatus('demuxing', msg, prog);
            if (source === 'ai') engineState.updateStatus('processing', msg, prog);
        } else if (type === 'done') {
            engineState.updateStatus('idle', 'Idle', 0);
        } else if (type === 'error') {
            engineState.updateStatus('error', payload.message ?? 'Unknown error occurred.', 0);
            console.error(`[Orchestrator] Error from ${source}:`, payload);
        }
    }

    // Standart #11: Check hardware acceleration and latency capabilities
    async probeDeviceCapabilities() {
        if (!navigator.mediaCapabilities) return;
        try {
            const config = {
                type: 'file',
                video: {
                    contentType: 'video/mp4; codecs="avc1.640028"', // Typical 4K H.264 High Profile
                    width: 3840,
                    height: 2160,
                    bitrate: 50000000, // 50 Mbps
                    framerate: 60
                }
            };
            const info = await navigator.mediaCapabilities.decodingInfo(config as MediaDecodingConfiguration);
            const caps = {
                canPlay4K: !!(info.supported && info.smooth),
                isPowerEfficient: !!info.powerEfficient
            };
            engineState.deviceCapabilities = caps;
            console.log('[MediaCapabilities] Device 4K Smooth:', info.smooth, '| Hardware Accel:', info.powerEfficient);
            
            // Inform workers to use hardwareAcceleration="prefer-hardware" & optimizeForLatency=true (WebCodecs)
            this.#demuxerWorker?.postMessage({
                type: 'set_capabilities',
                payload: caps
            });
        } catch (e) {
            console.warn('[MediaCapabilities] Probe failed:', e);
        }
    }

    getDecoder(fileName: string): VideoDecoderWrapper | undefined {
        return this.#decoderMap.get(fileName);
    }

    async preloadClip(file: File): Promise<void> {
        if (!file || this.#decoderMap.has(file.name)) return;
        if (this.#loadingPromises.has(file.name)) {
            await this.#loadingPromises.get(file.name);
            return;
        }
        const promise = (async () => {
            try {
                const newDecoder = new VideoDecoderWrapper();
                await newDecoder.load(file);
                if (this.#decoderMap.size >= MAX_ACTIVE_DECODERS) {
                    const oldestKey = this.#decoderMap.keys().next().value;
                    if (oldestKey) {
                        const oldDecoder = this.#decoderMap.get(oldestKey);
                        try { oldDecoder?.stopStreaming(); oldDecoder?.dispose(); } catch (_) {}
                        this.#decoderMap.delete(oldestKey);
                    }
                }
                this.#decoderMap.set(file.name, newDecoder);
                return newDecoder;
            } catch (err) {
                console.warn('[Orchestrator] Preload clip failed:', err);
                return null;
            } finally {
                this.#loadingPromises.delete(file.name);
            }
        })();
        this.#loadingPromises.set(file.name, promise);
        await promise;
    }

    async seekFrame(file: File, timeInSeconds: number, colorGrading?: any, options?: SeekOptions) {
        await this.seekFrameWithTransition(
            { file, time: timeInSeconds, grading: colorGrading },
            null,
            null,
            options
        );
    }

    private async getNativeVideo(file: File, time: number, options?: SeekOptions): Promise<HTMLVideoElement | null> {
        if (typeof window === 'undefined') return null;
        try {
            let video = this.#videoElementCache.get(file.name);
            if (!video) {
                // Evict oldest native video element if cache limit reached
                if (this.#videoElementCache.size >= MAX_ACTIVE_DECODERS) {
                    const oldestKey = this.#videoElementCache.keys().next().value;
                    if (oldestKey) {
                        const oldEl = this.#videoElementCache.get(oldestKey);
                        if (oldEl) {
                            try {
                                oldEl.pause();
                                const oldSrc = oldEl.src;
                                oldEl.removeAttribute('src');
                                oldEl.load();
                                if (oldSrc && oldSrc.startsWith('blob:')) {
                                    URL.revokeObjectURL(oldSrc);
                                }
                            } catch (_) {}
                        }
                        this.#videoElementCache.delete(oldestKey);
                    }
                }

                const el = document.createElement('video');
                el.preload = 'auto';
                el.muted = true;
                el.playsInline = true;
                el.src = URL.createObjectURL(file);
                await new Promise<void>((resolve) => {
                    const onLoaded = () => {
                        el.removeEventListener('loadedmetadata', onLoaded);
                        el.removeEventListener('error', onError);
                        resolve();
                    };
                    const onError = () => {
                        el.removeEventListener('loadedmetadata', onLoaded);
                        el.removeEventListener('error', onError);
                        resolve();
                    };
                    el.addEventListener('loadedmetadata', onLoaded);
                    el.addEventListener('error', onError);
                    if (el.readyState >= 1) resolve();
                });
                video = el;
                this.#videoElementCache.set(file.name, video);
            } else {
                // Refresh LRU position in Map
                this.#videoElementCache.delete(file.name);
                this.#videoElementCache.set(file.name, video);
            }

            const activeVideo = video;
            const clampedTime = Math.max(0, Math.min(activeVideo.duration || 1000, time));
            if (options?.isPlaying) {
                if (activeVideo.paused) {
                    activeVideo.currentTime = clampedTime;
                    activeVideo.play().catch(() => {});
                } else if (Math.abs(activeVideo.currentTime - clampedTime) > 0.25) {
                    activeVideo.currentTime = clampedTime;
                }
            } else {
                if (!activeVideo.paused) {
                    activeVideo.pause();
                }
                if (Math.abs(activeVideo.currentTime - clampedTime) > 0.02) {
                    activeVideo.currentTime = clampedTime;
                    await new Promise<void>((resolve) => {
                        const onSeeked = () => {
                            activeVideo.removeEventListener('seeked', onSeeked);
                            resolve();
                        };
                        activeVideo.addEventListener('seeked', onSeeked);
                        setTimeout(onSeeked, 60);
                    });
                }
            }

            if (activeVideo.videoWidth > 0) {
                return activeVideo;
            }
        } catch (e) {
            console.warn('[Orchestrator] Native video fallback error:', e);
        }
        return null;
    }

    clearMediaCache() {
        this.#loadingPromises.clear();
        this.#decoderMap.forEach(d => {
            try { d.stopStreaming(); d.dispose(); } catch (_) {}
        });
        this.#decoderMap.clear();
        this.#videoElementCache.forEach(v => {
            try {
                v.pause();
                const oldSrc = v.src;
                v.removeAttribute('src');
                v.load();
                if (oldSrc && oldSrc.startsWith('blob:')) {
                    URL.revokeObjectURL(oldSrc);
                }
            } catch (_) {}
        });
        this.#videoElementCache.clear();
    }

    removeAsset(fileName: string) {
        this.#loadingPromises.delete(fileName);
        const dec = this.#decoderMap.get(fileName);
        if (dec) {
            try { dec.stopStreaming(); dec.dispose(); } catch (_) {}
            this.#decoderMap.delete(fileName);
        }
        const vid = this.#videoElementCache.get(fileName);
        if (vid) {
            try {
                vid.pause();
                const oldSrc = vid.src;
                vid.removeAttribute('src');
                vid.load();
                if (oldSrc && oldSrc.startsWith('blob:')) {
                    URL.revokeObjectURL(oldSrc);
                }
            } catch (_) {}
            this.#videoElementCache.delete(fileName);
        }
    }

    stopPlaybackStreaming() {
        this.#decoderMap.forEach(d => {
            try { d.stopStreaming(); } catch (_) {}
        });
        this.#videoElementCache.forEach(v => {
            try {
                if (!v.paused) v.pause();
            } catch (_) {}
        });
    }

    async seekFrameWithTransition(
        clip1: { file: File, time: number, grading?: any, cropRect?: any, isBgRemoved?: boolean },
        clip2: { file: File, time: number, grading?: any, cropRect?: any, isBgRemoved?: boolean } | null,
        transition: { type: string, progress: number } | null,
        options?: SeekOptions
    ) {
        const getSource = async (info: { file: File, time: number, grading?: any }): Promise<{ type: 'frame', frame: VideoFrame, rotation: number } | { type: 'video', video: HTMLVideoElement, rotation: number } | null> => {
            let decoder = this.#decoderMap.get(info.file.name);
            if (!decoder) {
                let loadPromise = this.#loadingPromises.get(info.file.name);
                if (!loadPromise) {
                    loadPromise = (async () => {
                        try {
                            const newDecoder = new VideoDecoderWrapper();
                            await newDecoder.load(info.file);
                            if (this.#decoderMap.size >= MAX_ACTIVE_DECODERS) {
                                const oldestKey = this.#decoderMap.keys().next().value;
                                if (oldestKey) {
                                    const oldDecoder = this.#decoderMap.get(oldestKey);
                                    try { oldDecoder?.stopStreaming(); oldDecoder?.dispose(); } catch (_) {}
                                    this.#decoderMap.delete(oldestKey);
                                }
                            }
                            this.#decoderMap.set(info.file.name, newDecoder);
                            return newDecoder;
                        } catch (err) {
                            console.warn('[Orchestrator] Mediabunny load error, using native fallback:', err);
                            return null;
                        } finally {
                            this.#loadingPromises.delete(info.file.name);
                        }
                    })();
                    this.#loadingPromises.set(info.file.name, loadPromise);
                }
                const loaded = await loadPromise;
                if (loaded) decoder = loaded;
            } else {
                // Refresh LRU position in Map
                this.#decoderMap.delete(info.file.name);
                this.#decoderMap.set(info.file.name, decoder);
            }
            if (decoder) {
                try {
                    const res = options?.isPlaying
                        ? await decoder.getPlaybackFrame(info.time)
                        : await decoder.seek(info.time, options);
                    if (res?.frame) {
                        editor.updateDecoderTelemetry(decoder.telemetry);
                        return { type: 'frame', frame: res.frame, rotation: res.rotation ?? decoder.rotation ?? 0 };
                    }
                    // If decoder is active, returning null means seek was superseded by a newer frame request.
                    // Do not fall back to native video element as that would fight with WebCodecs.
                    return null;
                } catch (err) {
                    console.warn('[Orchestrator] Decoder seek error, trying native element:', err);
                }
            }

            // Universal fallback to native browser HTMLVideoElement
            const nativeVideo = await this.getNativeVideo(info.file, info.time, options);
            if (nativeVideo) {
                return { type: 'video', video: nativeVideo, rotation: 0 };
            }
            return null;
        };

        const [src1, src2] = await Promise.all([
            getSource(clip1),
            clip2 ? getSource(clip2) : Promise.resolve(null)
        ]);

        if (!src1 || !this.#canvas || !this.#ctx) {
            if (src1 && src1.type === 'frame') try { src1.frame.close(); } catch (_) {}
            if (src2 && src2.type === 'frame') try { src2.frame.close(); } catch (_) {}
            return;
        }

        const canvas = this.#canvas;
        const ctx = this.#ctx;

        try {
            const getOrientedDimensions = (source: { type: 'frame', frame: VideoFrame, rotation: number } | { type: 'video', video: HTMLVideoElement, rotation: number }) => {
                const rawW = source.type === 'frame' ? source.frame.displayWidth : source.video.videoWidth;
                const rawH = source.type === 'frame' ? source.frame.displayHeight : source.video.videoHeight;
                const rot = source.rotation || 0;
                const isSwapped = rot === 90 || rot === 270;
                return {
                    orientedW: isSwapped ? rawH : rawW,
                    orientedH: isSwapped ? rawW : rawH,
                    rawW,
                    rawH,
                    rotation: rot
                };
            };

            const initialDims = getOrientedDimensions(src1);
            if (canvas.width === 0 || canvas.height === 0) {
                canvas.width = initialDims.orientedW || 1920;
                canvas.height = initialDims.orientedH || 1080;
            }

            // Clean background for aspect ratio letterbox/pillarbox
            ctx.fillStyle = '#090a0f';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const drawSource = (
                src: { type: 'frame', frame: VideoFrame, rotation: number } | { type: 'video', video: HTMLVideoElement, rotation: number },
                clip: { grading?: any, cropRect?: any, isBgRemoved?: boolean },
                alpha: number = 1.0,
                clipRect?: { x: number; y: number; w: number; h: number }
            ) => {
                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
                if (clipRect) {
                    ctx.beginPath();
                    ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
                    ctx.clip();
                }
                const g = clip.grading;
                if (g?.brightness || g?.contrast || g?.saturation) {
                    const b = (g.brightness ?? 0) + 1;
                    const c = (g.contrast ?? 1);
                    const s = (g.saturation ?? 1);
                    ctx.filter = `brightness(${b}) contrast(${c}) saturate(${s})`;
                } else {
                    ctx.filter = 'none';
                }

                const { orientedW, orientedH, rawW, rawH, rotation } = getOrientedDimensions(src);
                const sW = orientedW || canvas.width;
                const sH = orientedH || canvas.height;

                // Aspect Ratio Preserving ('contain' fit - never squashed or stretched!)
                const scale = Math.min(canvas.width / sW, canvas.height / sH);
                const destW = sW * scale;
                const destH = sH * scale;
                const destX = (canvas.width - destW) / 2;
                const destY = (canvas.height - destH) / 2;

                const renderRawContent = (targetX: number, targetY: number, targetW: number, targetH: number) => {
                    const crop = clip.cropRect;
                    const sx = crop ? (crop.x ?? 0) * rawW : 0;
                    const sy = crop ? (crop.y ?? 0) * rawH : 0;
                    const sw = crop ? (crop.w ?? 1) * rawW : rawW;
                    const sh = crop ? (crop.h ?? 1) * rawH : rawH;

                    if (rotation !== 0 && src.type === 'frame') {
                        ctx.save();
                        ctx.translate(targetX + targetW / 2, targetY + targetH / 2);
                        ctx.rotate((rotation * Math.PI) / 180);
                        const isSwapped = rotation === 90 || rotation === 270;
                        const drawW = isSwapped ? targetH : targetW;
                        const drawH = isSwapped ? targetW : targetH;
                        ctx.drawImage(src.frame, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
                        ctx.restore();
                    } else {
                        const mediaSource = src.type === 'frame' ? src.frame : src.video;
                        ctx.drawImage(mediaSource, sx, sy, sw, sh, targetX, targetY, targetW, targetH);
                    }
                };

                if (clip.isBgRemoved) {
                    const bgGrad = ctx.createRadialGradient(
                        canvas.width / 2, canvas.height * 0.4, 40,
                        canvas.width / 2, canvas.height * 0.5, canvas.height * 0.65
                    );
                    bgGrad.addColorStop(0, '#312e81');
                    bgGrad.addColorStop(0.5, '#0f172a');
                    bgGrad.addColorStop(1, '#020617');
                    ctx.fillStyle = bgGrad;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    ctx.save();
                    ctx.beginPath();
                    ctx.ellipse(canvas.width / 2, canvas.height * 0.55, canvas.width * 0.44, canvas.height * 0.46, 0, 0, Math.PI * 2);
                    ctx.clip();
                    renderRawContent(destX, destY, destW, destH);
                    ctx.restore();
                } else {
                    renderRawContent(destX, destY, destW, destH);
                }
                ctx.restore();
            };

            if (transition && src2 && clip2) {
                const p = Math.max(0, Math.min(1, transition.progress));
                const type = transition.type || 'cross-dissolve';
                if (type === 'cross-dissolve' || type === 'dissolve') {
                    drawSource(src1, clip1, 1.0);
                    drawSource(src2, clip2, p);
                } else if (type === 'fade-to-black' || type === 'fade') {
                    if (p < 0.5) {
                        ctx.fillStyle = '#090a0f';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        drawSource(src1, clip1, 1.0 - p * 2);
                    } else {
                        ctx.fillStyle = '#090a0f';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        drawSource(src2, clip2, (p - 0.5) * 2);
                    }
                } else if (type === 'wipe-left') {
                    drawSource(src1, clip1, 1.0);
                    drawSource(src2, clip2, 1.0, { x: 0, y: 0, w: canvas.width * p, h: canvas.height });
                } else if (type === 'wipe-right') {
                    drawSource(src1, clip1, 1.0);
                    drawSource(src2, clip2, 1.0, { x: canvas.width * (1 - p), y: 0, w: canvas.width * p, h: canvas.height });
                } else {
                    drawSource(src1, clip1, 1.0);
                    drawSource(src2, clip2, p);
                }
            } else {
                drawSource(src1, clip1, 1.0);
                if (src2 && clip2) {
                    drawSource(src2, clip2, 1.0);
                }
            }

            editor.updateGpuTelemetry({
                isHardwareAccelerated: true,
                isDualTexturePass: !!(src2 && ((transition && transition.progress > 0) || !transition)),
                activeTransition: (transition && transition.progress > 0) ? transition.type : null,
                pipelineStatus: 'webgpu_active'
            });
        } finally {
            if (src1.type === 'frame') {
                try { src1.frame.close(); } catch (_) {}
            }
            if (src2 && src2.type === 'frame') {
                try { src2.frame.close(); } catch (_) {}
            }
        }
    }

    abortDemux() {
        this.#demuxerWorker?.postMessage({ type: 'abort_demux' });
    }

    processVideoTask(file: File) {
        if (!this.#demuxerWorker) this.initWorkers();
        engineState.updateStatus('demuxing', 'Starting video demuxing...', 0);
        this.#demuxerWorker?.postMessage({
            type: 'start_demux',
            payload: { file }
        });
    }

    destroy() {
        console.log('[Orchestrator] Terminating workers and disposing decoders...');
        this.clearMediaCache();
        this.#demuxerWorker?.terminate();
        this.#aiWorker?.terminate();
        this.#mediaWorker?.terminate();
        this.#demuxerWorker = null;
        this.#aiWorker = null;
        this.#mediaWorker = null;
        this.#canvas = null;
        this.#ctx = null;
        this.#aiMessageListeners = [];
        this.#mediaMessageListeners = [];
    }
}

export const engine = new EngineOrchestrator();
