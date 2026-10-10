// Phase 1: Structural Foundation & Svelte 5 Engine State Management
export type EngineStatus = 'idle' | 'demuxing' | 'processing' | 'rendering' | 'error';

export class EngineState {
    // Lightweight UI-bound reactive variables
    status = $state<EngineStatus>('idle');
    progress = $state(0);
    message = $state('Ready');
    
    currentTime = $state(0);
    duration = $state(0);
    isPlaying = $state(false);

    // Hardware capabilities
    deviceCapabilities = $state({ canPlay4K: true, isPowerEfficient: false });

    // HIGH FREQUENCY & HEAVY VARIABLES: Opt out of deep reactivity tracking to prevent Svelte overhead
    // We keep a small cache of VideoFrames/ImageBitmaps for scrubbing
    frames = $state.raw<VideoFrame[]>([]);
    activeFile = $state.raw<File | null>(null);

    constructor() {}

    reset() {
        this.status = 'idle';
        this.progress = 0;
        this.message = 'Ready';
        this.currentTime = 0;
        this.duration = 0;
        this.isPlaying = false;
        
        // Clean up VRAM
        for (const frame of this.frames) {
            frame.close();
        }
        this.frames = [];
        this.activeFile = null;
    }

    // Example interaction
    updateStatus(newStatus: EngineStatus, msg: string, prog: number = 0) {
        this.status = newStatus;
        this.message = msg;
        this.progress = prog;
    }
}

export const engineState = new EngineState();
