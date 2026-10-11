import { editor } from '../editor.svelte';
import { engineState } from './engineState.svelte';
import { VideoDecoderWrapper } from '../videoCodecs';
import type { SeekOptions } from '../types';

export type WorkerMessage = {
    type: string;
    payload?: any;
};

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
    #loadingFiles = new Set<string>();
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
            this.#canvas.width = width;
            this.#canvas.height = height;
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

    private fileNode: File | null = null;
    private sabInitialized = false;
    private seekDebounceTimer: number | null = null;
    private lastSeekTime: number = -1;

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

    private currentGrading: any = null;

    
    getDecoder(fileName: string): VideoDecoderWrapper | undefined {
        return this.#decoderMap.get(fileName);
    }

    async seekFrame(file: File, timeInSeconds: number, colorGrading?: any, options?: SeekOptions) {
        await this.seekFrameWithTransition(
            { file, time: timeInSeconds, grading: colorGrading },
            null,
            null,
            options
        );
    }

    private async getNativeVideo(file: File, time: number): Promise<HTMLVideoElement | null> {
        if (typeof window === 'undefined') return null;
        try {
            let video = this.#videoElementCache.get(file.name);
            if (!video) {
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
            }

            const activeVideo = video;
            const clampedTime = Math.max(0, Math.min(activeVideo.duration || 1000, time));
            if (Math.abs(activeVideo.currentTime - clampedTime) > 0.03) {
                activeVideo.currentTime = clampedTime;
                await new Promise<void>((resolve) => {
                    const onSeeked = () => {
                        activeVideo.removeEventListener('seeked', onSeeked);
                        resolve();
                    };
                    activeVideo.addEventListener('seeked', onSeeked);
                    setTimeout(onSeeked, 80);
                });
            }

            if (activeVideo.videoWidth > 0) {
                return activeVideo;
            }
        } catch (e) {
            console.warn('[Orchestrator] Native video fallback error:', e);
        }
        return null;
    }

    async seekFrameWithTransition(
        clip1: { file: File, time: number, grading?: any },
        clip2: { file: File, time: number, grading?: any } | null,
        transition: { type: string, progress: number } | null,
        options?: SeekOptions
    ) {
        const getSource = async (info: { file: File, time: number, grading?: any }): Promise<{ type: 'frame', frame: VideoFrame } | { type: 'video', video: HTMLVideoElement } | null> => {
            let decoder = this.#decoderMap.get(info.file.name);
            if (!decoder) {
                if (this.#loadingFiles.has(info.file.name)) return null;
                this.#loadingFiles.add(info.file.name);
                
                const newDecoder = new VideoDecoderWrapper();
                try {
                    await newDecoder.load(info.file);
                    this.#decoderMap.set(info.file.name, newDecoder);
                    decoder = newDecoder;
                } catch (err) {
                    console.warn('[Orchestrator] Mediabunny load error, using native fallback:', err);
                } finally {
                    this.#loadingFiles.delete(info.file.name);
                }
            }
            if (decoder) {
                try {
                    const res = await decoder.seek(info.time, options);
                    if (res?.frame) {
                        editor.updateDecoderTelemetry(decoder.telemetry);
                        return { type: 'frame', frame: res.frame };
                    }
                    // If decoder is active, returning null means seek was superseded by a newer frame request.
                    // Do not fall back to native video element as that would fight with WebCodecs.
                    return null;
                } catch (err) {
                    console.warn('[Orchestrator] Decoder seek error, trying native element:', err);
                }
            }

            // Universal fallback to native browser HTMLVideoElement
            const nativeVideo = await this.getNativeVideo(info.file, info.time);
            if (nativeVideo) {
                return { type: 'video', video: nativeVideo };
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
            const srcW = src1.type === 'frame' ? src1.frame.displayWidth : src1.video.videoWidth;
            const srcH = src1.type === 'frame' ? src1.frame.displayHeight : src1.video.videoHeight;
            if (canvas.width === 0 || canvas.height === 0) {
                canvas.width = srcW || 1920;
                canvas.height = srcH || 1080;
            }

            // 1. Draw Primary Frame with Color Grading
            ctx.save();
            const g1 = clip1.grading;
            if (g1?.brightness || g1?.contrast || g1?.saturation) {
                const b = (g1.brightness ?? 0) + 1;
                const c = (g1.contrast ?? 1);
                const s = (g1.saturation ?? 1);
                ctx.filter = `brightness(${b}) contrast(${c}) saturate(${s})`;
            } else {
                ctx.filter = 'none';
            }

            if (src1.type === 'frame') {
                ctx.drawImage(src1.frame, 0, 0, canvas.width, canvas.height);
            } else {
                ctx.drawImage(src1.video, 0, 0, canvas.width, canvas.height);
            }
            ctx.restore();

            // 2. Draw Secondary Frame with Transition (if active)
            if (src2 && transition && transition.progress > 0) {
                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, transition.progress));
                const g2 = clip2?.grading;
                if (g2?.brightness || g2?.contrast || g2?.saturation) {
                    const b = (g2.brightness ?? 0) + 1;
                    const c = (g2.contrast ?? 1);
                    const s = (g2.saturation ?? 1);
                    ctx.filter = `brightness(${b}) contrast(${c}) saturate(${s})`;
                } else {
                    ctx.filter = 'none';
                }

                if (src2.type === 'frame') {
                    ctx.drawImage(src2.frame, 0, 0, canvas.width, canvas.height);
                } else {
                    ctx.drawImage(src2.video, 0, 0, canvas.width, canvas.height);
                }
                ctx.restore();
            }

            editor.updateGpuTelemetry({
                isHardwareAccelerated: true,
                isDualTexturePass: !!(src2 && transition && transition.progress > 0),
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
        this.#decoderMap.forEach(d => d.dispose());
        this.#decoderMap.clear();
        this.#videoElementCache.forEach(v => {
            try { URL.revokeObjectURL(v.src); v.src = ''; } catch (_) {}
        });
        this.#videoElementCache.clear();
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
