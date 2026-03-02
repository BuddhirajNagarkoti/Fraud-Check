class MicProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = [];
        this.bufferSize = 2048; // ~128ms at 16kHz
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0] || input[0].length === 0) return true;

        const float32 = input[0];
        for (let i = 0; i < float32.length; i++) {
            this.buffer.push(float32[i]);
        }

        if (this.buffer.length >= this.bufferSize) {
            let energy = 0;
            const pcm16 = new Int16Array(this.buffer.length);
            for (let i = 0; i < this.buffer.length; i++) {
                const s = Math.max(-1, Math.min(1, this.buffer[i]));
                energy += s * s;
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            const rms = Math.sqrt(energy / this.buffer.length);
            const isSpeaking = rms > 0.015; // Threshold for speech detection

            this.port.postMessage({ buffer: pcm16.buffer, isSpeaking }, [pcm16.buffer]);
            this.buffer = [];
        }

        return true;
    }
}

registerProcessor('mic-processor', MicProcessor);
