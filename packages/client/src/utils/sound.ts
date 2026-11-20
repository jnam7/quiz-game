import { SoundEffectType } from '@quiz/shared';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private isEnabled: boolean = true;
  private bgmOscillator: OscillatorNode | null = null;
  private isBgmPlaying: boolean = false;
  private clockTickToggle: boolean = false; // Tick(3초,1초) - Tock(2초) 아날로그 교차 플래그

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
        // 고출력 아날로그 시계 묵직한 초침(Tick-Tock) 둔탁한 타격음 합성 (기존 비프음 대체)
        this.playAnalogClockTick();
        break;

      case 'TIMEOUT':
        // 확실하고 묵직한 마감 경고음
        this.playTimeoutAlarm();
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

  // 고출력 아날로그 시계 묵직한 초침(Tick-Tock) 소리 합성 (낮은 주파수의 둔탁한 타격음 파형)
  private playAnalogClockTick() {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const isTock = this.clockTickToggle;
      this.clockTickToggle = !this.clockTickToggle;

      // 마스터 게인 노드 (볼륨 크게 증폭: BGM 위로 선명하게 전달)
      const masterGain = this.ctx.createGain();
      masterGain.gain.setValueAtTime(0.95, now);
      masterGain.connect(this.ctx.destination);

      // 1. Sharp mechanical transient click (기계식 톱니 맞물림 찰나의 스냅)
      const clickOsc = this.ctx.createOscillator();
      const clickGain = this.ctx.createGain();
      clickOsc.type = 'triangle';
      clickOsc.frequency.setValueAtTime(isTock ? 1200 : 1600, now);
      clickOsc.frequency.exponentialRampToValueAtTime(300, now + 0.018);

      clickGain.gain.setValueAtTime(0.8, now);
      clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);

      clickOsc.connect(clickGain);
      clickGain.connect(masterGain);
      clickOsc.start(now);
      clickOsc.stop(now + 0.025);

      // 2. Heavy analog body thud (낮은 주파수 250Hz->55Hz 급격한 Gain 감쇄 둔탁한 타격음)
      const bodyOsc = this.ctx.createOscillator();
      const bodyGain = this.ctx.createGain();
      bodyOsc.type = 'sine';
      const startFreq = isTock ? 190 : 250;
      const endFreq = isTock ? 40 : 55;
      bodyOsc.frequency.setValueAtTime(startFreq, now);
      bodyOsc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.065);

      bodyGain.gain.setValueAtTime(1.0, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

      bodyOsc.connect(bodyGain);
      bodyGain.connect(masterGain);
      bodyOsc.start(now);
      bodyOsc.stop(now + 0.08);

      // 3. Crisp mechanical texture noise burst (아날로그 시계 특유의 기계음 질감)
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.025);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.004));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(isTock ? 1400 : 1800, now);
      noiseFilter.Q.setValueAtTime(2.0, now);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.5, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);
      noise.start(now);
      noise.stop(now + 0.03);
    } catch {
      // AudioContext 재생 정책 예외 무시
    }
  }

  // 0초 타임오버 확실한 마감 경고음
  private playTimeoutAlarm() {
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      [180, 270].forEach((freq) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.linearRampToValueAtTime(freq * 0.85, now + 0.65);

        gain.gain.setValueAtTime(0.4, now);
        gain.gain.setValueAtTime(0.4, now + 0.5);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);
        osc.start(now);
        osc.stop(now + 0.7);
      });
    } catch {
      // AudioContext 재생 정책 예외 무시
    }
  }
}

export const soundEngine = new SoundEngine();

