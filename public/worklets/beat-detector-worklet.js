class BeatDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Simplified RMS beat detection for real-time
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.threshold = 0.5; // Will adapt dynamically
    this.decay = 0.98;
    this.lastBeatTime = 0;
    this.minBeatInterval = 60 / 200; // Max 200 BPM
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0];
      
      for (let i = 0; i < channelData.length; i++) {
        const sample = channelData[i];
        
        // Very basic RMS / Peak detection per chunk
        if (Math.abs(sample) > this.threshold) {
          const now = currentTime; // AudioContext currentTime is globally available in worklets
          if (now - this.lastBeatTime > this.minBeatInterval) {
             this.port.postMessage({ type: 'beat', time: now });
             this.lastBeatTime = now;
             this.threshold = Math.min(Math.abs(sample) + 0.1, 0.9); // Spike threshold
          }
        }
        // Decay threshold to allow next beat
        this.threshold = Math.max(0.1, this.threshold * this.decay);
      }
    }
    return true; // Keep processor alive
  }
}

registerProcessor('beat-detector-processor', BeatDetectorProcessor);
