import { Service } from '@angular/core';

// Synthesized via the Web Audio API — no external sound files needed.
@Service()
export class Audio {
  private ctx: AudioContext | null = null;

  // Lazily created on the first user gesture (a key press or swipe), since
  // browsers block audio contexts from starting before any user interaction.
  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    startOffset: number,
    duration: number,
    type: OscillatorType,
    peakGain: number,
  ) {
    const ctx = this.getContext();
    const start = ctx.currentTime + startOffset;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peakGain, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  // A percussive, pitchless burst (filtered white noise) instead of a tone -
  // used for the countdown tick and the wall-bump thud, the way a real
  // clock/collision is a "tsk"/"thud" rather than a musical note.
  private noiseBurst(
    startOffset: number,
    duration: number,
    filterFreq: number,
    peakGain: number,
    type: BiquadFilterType = 'highpass',
  ) {
    const ctx = this.getContext();
    const start = ctx.currentTime + startOffset;

    const bufferSize = Math.max(1, Math.ceil(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFreq, start);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(start);
    noise.stop(start + duration + 0.02);
  }

  /** Soft low thud when a move is blocked by a wall. */
  playBump() {
    try {
      this.noiseBurst(0, 0.05, 400, 0.12, 'lowpass');
    } catch {
      // Audio is a nice-to-have; never let it break gameplay.
    }
  }

  /** Bright ascending chime when reaching the cheese; pitch rises for a better finish rank. */
  playFinish(rank: number) {
    try {
      const base = 523.25; // C5
      this.tone(base, 0, 0.1, 'sine', 0.16);
      this.tone(base * Math.pow(2, 4 / 12), 0.08, 0.1, 'sine', 0.16);
      this.tone(base * Math.pow(2, 7 / 12), 0.16, 0.16, 'sine', 0.16);
      if (rank === 1) {
        this.tone(base * 2, 0.24, 0.22, 'sine', 0.16);
      }
    } catch {
      // Audio is a nice-to-have; never let it break gameplay.
    }
  }

  /** Percussive clock-tick for the final seconds of a round; sharper and louder once it's down to the wire. */
  playTick(secondsLeft: number) {
    try {
      const critical = secondsLeft <= 3;
      this.noiseBurst(0, 0.035, critical ? 3200 : 2200, critical ? 0.28 : 0.18);
    } catch {
      // Audio is a nice-to-have; never let it break gameplay.
    }
  }
}
