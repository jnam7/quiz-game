import { SoundEffectType } from '@quiz/shared';
import { CLOCK_TICK_WAV_BASE64 } from './clockSounds';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private isEnabled: boolean = true;
  private clockTickBuffer: AudioBuffer | null = null;
  private isDecodingClock: boolean = false;
  private html5TickAudio: HTMLAudioElement | null = null;
  private html5TimeoutAudio: HTMLAudioElement | null = null;
  private tickVolume: number = 1.0;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.html5TickAudio = new Audio(CLOCK_TICK_WAV_BASE64);
        this.html5TickAudio.preload = 'auto';
        this.html5TimeoutAudio = new Audio('/timeout_bell.mp3');
        this.html5TimeoutAudio.preload = 'auto';
      } catch {
        // SSR / 브라우저 정책 방어
      }
    }
  }

  private initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (this.ctx && !this.clockTickBuffer && !this.isDecodingClock) {
      this.preloadClockBuffer();
    }
  }

  private async preloadClockBuffer() {
    if (!this.ctx || this.isDecodingClock) return;
    this.isDecodingClock = true;
    try {
      const res = await fetch(CLOCK_TICK_WAV_BASE64);
      const arrayBuf = await res.arrayBuffer();
      this.clockTickBuffer = await this.ctx.decodeAudioData(arrayBuf);
    } catch {
      // AudioBuffer 디코딩 실패 시 html5TickAudio로 자동 폴백
    } finally {
      this.isDecodingClock = false;
    }
  }

  public enable() {
    this.initContext();
    this.isEnabled = true;
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }

  public setTickVolume(volume: number) {
    this.tickVolume = Math.max(0, Math.min(2, volume));
  }

  public play(type: SoundEffectType) {
    if (!this.isEnabled) return;
    this.initContext();

    switch (type) {
      case 'COUNTDOWN_TICK':
        this.playTone(800, 0.05, 'sine', 0.1);
        break;

      case 'COUNTDOWN_URGENT':
        // 실제 아날로그 괘종시계/초침 '째-깍' 고출력 무지연 사운드 재생
        this.playMechanicalClockTick();
        break;

      case 'TIMEOUT':
        // 칼같이 종료되는 마감 공/종소리 사운드 재생
        this.playTimeoutGong();
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

  // 진짜 아날로그 시계 째-깍(Tick-Tock) 고품질 사운드 재생 (최대 음량 확보)
  private playMechanicalClockTick() {
    // 1. Web Audio API AudioBuffer 기반 무지연/고출력 증폭 재생
    if (this.ctx && this.clockTickBuffer) {
      try {
        const source = this.ctx.createBufferSource();
        source.buffer = this.clockTickBuffer;

        // 행사장 스피커에서도 쩌렁쩌렁하게 들리도록 게인 2.5배 증폭
        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(2.5 * this.tickVolume, this.ctx.currentTime);

        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        source.start(0);
        return;
      } catch (err) {
        console.warn('[SoundEngine] Web Audio tick play error, fallback to HTML5 Audio:', err);
      }
    }

    // 2. Fallback: Base64 / Static 오디오 엘리먼트 즉시 재생
    if (this.html5TickAudio) {
      try {
        this.html5TickAudio.currentTime = 0;
        this.html5TickAudio.volume = Math.max(0, Math.min(1, this.tickVolume));
        const p = this.html5TickAudio.play();
        if (p) p.catch(() => {});
        return;
      } catch {}
    }

    try {
      const audio = new Audio('/tick.wav');
      audio.volume = Math.max(0, Math.min(1, this.tickVolume));
      audio.play().catch(() => {});
    } catch {}
  }

  // 0초 타임오버 칼같은 마감 공/종소리 사운드 재생
  private playTimeoutGong() {
    // 1. 실제 마감 공/종소리 오디오 파일 재생
    if (this.html5TimeoutAudio) {
      try {
        this.html5TimeoutAudio.currentTime = 0;
        this.html5TimeoutAudio.volume = 1.0;
        const p = this.html5TimeoutAudio.play();
        if (p) p.catch(() => {});
      } catch {}
    } else {
      try {
        const audio = new Audio('/timeout_bell.mp3');
        audio.volume = 1.0;
        audio.play().catch(() => {});
      } catch {}
    }

    // 2. Web Audio API로 맑고 웅장한 마감 공/벨 화음 결합 (청명한 울림)
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      [587.33, 880, 1174.66].forEach((freq, idx) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        const vol = 0.4 / (idx + 1);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);
        osc.start(now);
        osc.stop(now + 1.2);
      });
    } catch {}
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
