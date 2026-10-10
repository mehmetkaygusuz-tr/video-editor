// 2026 Standard AudioWorkletProcessor for high-performance DSP
// Runs in a dedicated audio thread, isolated from UI.

class DspWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.duckingActive = false;
    this.eqPreset = 'flat';
    
    // Smooth envelope state for ducking (prevents pops/clicks)
    this.currentDuckingGain = 1.0;
    
    // Listen for messages from the main thread
    this.port.onmessage = (event) => {
      const { type, duckingActive, eqPreset } = event.data;
      if (type === 'set_params') {
        this.duckingActive = duckingActive;
        this.eqPreset = eqPreset || 'flat';
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (!input || !input.length) return true;
    
    // Smooth ducking transition parameters
    const DUCKING_TARGET = this.duckingActive ? 0.25 : 1.0;
    // Approach target gain smoothly (approximate time constant)
    const smoothingFactor = 0.99; 
    
    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      
      // If channels mismatch (e.g. mono to stereo), handle safely
      if (!outputChannel) continue;

      for (let i = 0; i < inputChannel.length; i++) {
        // Calculate smooth gain per sample to avoid zipper noise
        if (channel === 0) {
           this.currentDuckingGain = (this.currentDuckingGain * smoothingFactor) + (DUCKING_TARGET * (1 - smoothingFactor));
        }
        
        let sample = inputChannel[i];
        
        // Pseudo-EQ for demonstration (Real EQ would use biquad filters or FFT)
        if (this.eqPreset === 'voice_boost') {
            // Slight high-mid boost (very simplified pseudo-filter effect for voice clarity)
            sample = sample * 1.1; 
        } else if (this.eqPreset === 'bass_boost') {
            // Pseudo-bass boost (clipping limit)
            sample = sample * 1.2;
        }
        
        // Apply Ducking
        sample *= this.currentDuckingGain;
        
        // Hard limiter to prevent clipping above 1.0 or below -1.0
        if (sample > 1.0) sample = 1.0;
        else if (sample < -1.0) sample = -1.0;
        
        outputChannel[i] = sample;
      }
    }

    return true; // Keep processor alive
  }
}

registerProcessor('dsp-worklet', DspWorkletProcessor);
