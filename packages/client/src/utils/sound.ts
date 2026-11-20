import { SoundEffectType } from '@quiz/shared';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private isEnabled: boolean = true;
  private bgmOscillator: OscillatorNode | null = null;
  private isBgmPlaying: boolean = false;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public enable() {
    this.initContext();
    this.isEnabled = true;
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }

  public play(type: SoundEffectType) {
    if (!this.isEnabled) return;
    this.initContext();
    if (!this.ctx) return;

    switch (type) {
      case 'COUNTDOWN_TICK':
        this.playTone(800, 0.05, 'sine', 0.1);
        break;

      case 'COUNTDOWN_URGENT':
        this.playTone(1200, 0.08, 'triangle', 0.15);
        break;

      case 'TIMEOUT':
        // 저음 버저 경고음 (220Hz -> 180Hz)
        this.playTone(220, 0.5, 'sawtooth', 0.25);
        setTimeout(() => this.playTone(180, 0.6, 'sawtooth', 0.25), 100);
        break;

      case 'CORRECT':
        // 밝은 메이저 코드
        this.playChord([523.25, 659.25, 783.99], 0.3, 'sine', 0.15);
        break;

      case 'WRONG':
      case 'ELIMINATED':
        // 불협화음 & 저음
        this.playTone(180, 0.4, 'sawtooth', 0.15);
        break;

      case 'ROUND_START':
        this.playTone(440, 0.1, 'sine', 0.1);
        setTimeout(() => this.playTone(880, 0.25, 'sine', 0.15), 120);
        break;

      case 'GAME_START':
        this.playChord([440, 554.37, 659.25, 880], 0.5, 'triangle', 0.2);
        break;

      case 'WINNER_FANFARE':
        this.playFanfare();
        break;
    }
  }

  private playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume: number = 0.1) {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch {
      // AudioContext 재생 정책 예외 무시
    }
  }

  private playChord(freqs: number[], duration: number, type: OscillatorType = 'sine', volume: number = 0.1) {
    freqs.forEach(f => this.playTone(f, duration, type, volume / freqs.length));
  }

  private playFanfare() {
    const notes = [
      { f: 523.25, d: 0.15 }, // C
      { f: 659.25, d: 0.15 }, // E
      { f: 783.99, d: 0.2 },  // G
      { f: 1046.50, d: 0.5 }  // C (high)
    ];
    let offset = 0;
    notes.forEach(n => {
      setTimeout(() => this.playTone(n.f, n.d, 'triangle', 0.2), offset);
      offset += n.d * 1000 + 50;
    });
  }
}

export const soundEngine = new SoundEngine();

