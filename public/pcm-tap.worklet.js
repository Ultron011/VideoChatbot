// public/pcm-tap.worklet.js
// Receives audio in the AudioWorkletGlobalScope, converts Float32 → Int16,
// batches to ~60ms chunks at 24kHz (1440 samples), and posts them to the main thread.

class PcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetSampleRate = opts.targetSampleRate || 24000;
    this.batchSamples = opts.batchSamples || 1440; // 60ms at 24kHz
    this.buffer = new Int16Array(this.batchSamples);
    this.writeIndex = 0;
  }

  resampleAndFlushFrame(channelData) {
    const ratio = sampleRate / this.targetSampleRate;
    const outLen = Math.floor(channelData.length / ratio);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, channelData.length - 1);
      const frac = srcIdx - lo;
      const sample = channelData[lo] * (1 - frac) + channelData[hi] * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.buffer[this.writeIndex++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.writeIndex >= this.batchSamples) {
        this.port.postMessage(this.buffer.slice(0, this.batchSamples));
        this.writeIndex = 0;
      }
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;
    this.resampleAndFlushFrame(channel);
    return true;
  }
}

registerProcessor('pcm-tap', PcmTapProcessor);
