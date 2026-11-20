import {
  GameState,
  GameStatus,
  GameSettings,
  Player,
  QuizItem,
  RoundInfo,
  RoundResult,
  SoundEffectType,
  ChatMessage,
  RankedPlayer,
  MAX_PLAYERS,
  DEFAULT_SETTINGS,
  DEFAULT_STAGE_RULES,
  STARTING_COUNTDOWN_SEC,
  RESULT_DISPLAY_SEC
} from '@quiz/shared';
import { JsonDatabase } from '../db/Database';
import { v4 as uuidv4 } from 'uuid';

export class GameEngine {
  private db: JsonDatabase;
  private gameId: string;
  private status: GameStatus = 'WAITING';
  private currentRoundNumber = 0;
  private activeQuiz?: QuizItem;
  private roundStartTime = 0;
  private roundEndTime = 0;
  private roundTimeoutTimer: NodeJS.Timeout | null = null;
  private countdownTimer: NodeJS.Timeout | null = null;
  private pausedTimeRemaining = 0;

  private players: Map<string, Player> = new Map(); // key: token
  private socketToToken: Map<string, string> = new Map(); // key: socketId -> token
  private usedQuizIds: Set<number> = new Set();
  private settings: GameSettings = { ...DEFAULT_SETTINGS };
  private chatHistory: ChatMessage[] = [];

  private gameStartedAt?: number;
  private gameEndedAt?: number;
  private lastRoundResult?: RoundResult;

  // 이벤트 콜백 함수들
  private emitStateSync: (state: GameState) => void;
  private emitPlaySound: (sound: SoundEffectType) => void;
  private emitRoundStart: (info: RoundInfo) => void;
  private emitRoundEnd: (result: RoundResult) => void;
  private emitWinner: (winner?: Player, isDraw?: boolean) => void;
  private emitStartingCountdown: (secondsLeft: number) => void;
  private emitPlayerAnswered: (token: string, count: number, totalAlive: number) => void;
  private emitForceLobby: () => void;

  constructor(
    db: JsonDatabase,
    callbacks: {
      emitStateSync: (state: GameState) => void;
      emitPlaySound: (sound: SoundEffectType) => void;
      emitRoundStart: (info: RoundInfo) => void;
      emitRoundEnd: (result: RoundResult) => void;
      emitWinner: (winner?: Player, isDraw?: boolean) => void;
      emitStartingCountdown: (secondsLeft: number) => void;
      emitPlayerAnswered: (token: string, count: number, totalAlive: number) => void;
      emitForceLobby?: () => void;
    }
  ) {
    this.db = db;
    this.gameId = `GAME_${Date.now()}`;
    this.emitStateSync = callbacks.emitStateSync;
    this.emitPlaySound = callbacks.emitPlaySound;
    this.emitRoundStart = callbacks.emitRoundStart;
    this.emitRoundEnd = callbacks.emitRoundEnd;
    this.emitWinner = callbacks.emitWinner;
    this.emitStartingCountdown = callbacks.emitStartingCountdown;
    this.emitPlayerAnswered = callbacks.emitPlayerAnswered;
    this.emitForceLobby = callbacks.emitForceLobby || (() => {});
  }

  // --- 플레이어 접속 및 재접속/복구 ---
  public registerPlayer(
    socketId: string,
    nickname: string,
    existingToken?: string
  ): { success: boolean; player?: Player; message?: string } {
    const trimmedNick = (nickname || '').trim();

    // 1. 기존 토큰이 있는 경우 (새로고침 / 재접속 복구)
    if (existingToken && this.players.has(existingToken)) {
      const player = this.players.get(existingToken)!;
      // 이전 소켓 매핑 해제 및 새 소켓 매핑
      for (const [sId, tok] of this.socketToToken.entries()) {
        if (tok === existingToken) this.socketToToken.delete(sId);
      }
      player.id = socketId;
      player.isOnline = true;
      if (trimmedNick && player.nickname !== trimmedNick) {
        player.nickname = trimmedNick;
      }
      this.socketToToken.set(socketId, existingToken);

      console.log(`[Player Reconnected] ${player.nickname} (Token: ${existingToken})`);
      this.syncState();
      return { success: true, player };
    }

    // 닉네임이 없는 경우 (토큰 복구 시도였으나 서버에 토큰이 만료/부재한 경우 포함)
    if (!trimmedNick) {
      return { success: false, message: '닉네임을 입력해주세요.' };
    }

    // 2. 신규 접속 시 정원 체크
    if (this.players.size >= this.settings.maxPlayers) {
      return { success: false, message: `게임 정원(${this.settings.maxPlayers}명)이 가득 찼습니다.` };
    }

    // 3. 닉네임 중복 체크
    for (const p of this.players.values()) {
      if (p.nickname.toLowerCase() === trimmedNick.toLowerCase()) {
        return { success: false, message: '이미 참가 중인 닉네임입니다. 다른 닉네임을 사용해주세요.' };
      }
    }

    // 4. 신규 플레이어 등록
    const token = uuidv4();
    const isOngoing = this.status !== 'WAITING';

    const newPlayer: Player = {
      id: socketId,
      token,
      nickname: trimmedNick,
      isAlive: !isOngoing, // 게임 진행 중 중간 접속자는 관전자/탈락 처리
      score: 0,
      isOnline: true,
      eliminatedRound: isOngoing ? this.currentRoundNumber : undefined,
      eliminatedReason: isOngoing ? 'DISCONNECT_FORCED' : undefined
    };

    this.players.set(token, newPlayer);
    this.socketToToken.set(socketId, token);

    console.log(`[Player Joined] ${trimmedNick} (Total: ${this.players.size}명)`);
    this.syncState();
    return { success: true, player: newPlayer };
  }

  // --- 플레이어 닉네임 변경 ---
  public updatePlayerNickname(
    token: string,
    newNickname: string
  ): { success: boolean; player?: Player; message?: string } {
    const trimmed = (newNickname || '').trim();
    if (!trimmed) {
      return { success: false, message: '닉네임을 1자 이상 입력해주세요.' };
    }
    if (trimmed.length > 12) {
      return { success: false, message: '닉네임은 최대 12자까지 가능합니다.' };
    }

    const player = this.players.get(token);
    if (!player) {
      return { success: false, message: '참가자 정보를 찾을 수 없습니다.' };
    }

    if (player.nickname === trimmed) {
      return { success: true, player };
    }

    // 중복 닉네임 체크 (본인 제외)
    for (const p of this.players.values()) {
      if (p.token !== token && p.nickname.toLowerCase() === trimmed.toLowerCase()) {
        return { success: false, message: '이미 다른 참가자가 사용 중인 닉네임입니다.' };
      }
    }

    const oldNick = player.nickname;
    player.nickname = trimmed;
    console.log(`[Player Nickname Changed] ${oldNick} -> ${trimmed} (Token: ${token})`);

    // 이전 채팅 내역에 있던 닉네임도 일괄 최신화
    for (const chat of this.chatHistory) {
      if (chat.token === token) {
        chat.nickname = trimmed;
      }
    }

    this.syncState();
    return { success: true, player };
  }

  // --- 플레이어 퇴장/제거 (대기실에서는 완전 제거, 진행 중에는 오프라인 처리) ---
  public removePlayer(tokenOrSocketId: string): boolean {
    const token = this.socketToToken.get(tokenOrSocketId) || tokenOrSocketId;
    const player = this.players.get(token);
    if (!player) return false;

    if (this.status === 'WAITING') {
      this.players.delete(token);
      for (const [sId, tok] of this.socketToToken.entries()) {
        if (tok === token) {
          this.socketToToken.delete(sId);
        }
      }
      console.log(`[Player Removed in WAITING] ${player.nickname} (남은 대기 인원: ${this.players.size}명)`);
      this.syncState();
      return true;
    } else {
      player.isOnline = false;
      this.syncState();
      return true;
    }
  }

  public handleDisconnect(socketId: string) {
    const token = this.socketToToken.get(socketId);
    if (!token) return;

    const player = this.players.get(token);
    if (player) {
      if (this.status === 'WAITING') {
        this.players.delete(token);
        this.socketToToken.delete(socketId);
        console.log(`[Player Disconnected in WAITING - Removed] ${player.nickname} (남은 대기 인원: ${this.players.size}명)`);
        this.syncState();
      } else {
        player.isOnline = false;
        console.log(`[Player Disconnected] ${player.nickname} (Offline 처리됨, 상태 보존)`);
        this.syncState();
      }
    }
  }

  // --- 플레이어 정답 제출 (원자적 서버 판정 & 자동 인증 복구) ---
  public submitAnswer(
    socketId: string,
    answerIndex: number,
    clientToken?: string
  ): { success: boolean; message?: string; isSpectator?: boolean } {
    let token = this.socketToToken.get(socketId) || clientToken;
    if (!token || !this.players.has(token)) {
      return { success: false, message: '인증되지 않은 플레이어입니다. 새로고침 후 다시 입장해주세요.' };
    }

    const player = this.players.get(token)!;
    // 재접속 등으로 소켓 매핑이 풀렸을 경우 즉시 자동 복구
    if (this.socketToToken.get(socketId) !== token) {
      this.socketToToken.set(socketId, token);
      player.id = socketId;
      player.isOnline = true;
    }

    // 1. 현재 라운드 진행 중 상태 확인
    if (this.status !== 'IN_ROUND' || !this.activeQuiz) {
      return { success: false, message: '현재 답변을 제출할 수 있는 시간이 아닙니다.' };
    }

    // 2. 서버 기준 시간 초과 검증 (지연된 패킷 원천 거부)
    const now = Date.now();
    if (now > this.roundEndTime + 500) { // 0.5초 네트워크 버퍼
      return { success: false, message: '제한시간이 마감되었습니다.' };
    }

    // 3. 중복 제출 차단 (답변 수정 불가 원칙)
    if (player.selectedAnswer !== undefined) {
      return { success: false, message: '이미 답변을 제출하셨습니다.' };
    }

    // 4. 답안 안전하게 기록 (탈락한 관전자도 연습 풀이 가능)
    const isSpectator = !player.isAlive;
    player.selectedAnswer = answerIndex;
    player.answeredAt = now - this.roundStartTime;

    if (!isSpectator) {
      const survivors = this.getSurvivors();
      const answeredCount = survivors.filter(p => p.selectedAnswer !== undefined).length;

      this.emitPlayerAnswered(player.token, answeredCount, survivors.length);
      // 150명 동시 제출 시 CPU/네트워크 병목 방지: 경량 emitPlayerAnswered로 알림 처리

      // 모든 참여자가 제한시간 전에 답변을 마쳤을 경우 즉시 라운드 마감 및 정답 확인
      const onlineSurvivors = survivors.filter(p => p.isOnline);
      const targetSurvivors = onlineSurvivors.length > 0 ? onlineSurvivors : survivors;
      const allAnswered = targetSurvivors.length > 0 && targetSurvivors.every(p => p.selectedAnswer !== undefined);

      if (allAnswered) {
        console.log(`[All Participants Answered] 참여자 전원(${answeredCount}/${targetSurvivors.length}명) 선택 완료 -> 즉시 정답 확인으로 전환`);
        if (this.roundTimeoutTimer) {
          clearTimeout(this.roundTimeoutTimer);
          this.roundTimeoutTimer = null;
        }
        setTimeout(() => this.finishRound(), 150);
      }
    } else {
      console.log(`[Spectator Answer] 관전자 ${player.nickname} 연습 답안 제출 (보기 ${answerIndex + 1})`);
    }

    return { success: true, isSpectator };
  }

  // --- 게임 시작 (3, 2, 1 카운트다운) ---
  public startGame(): boolean {
    if (this.players.size < 1) return false;

    if (this.roundTimeoutTimer) {
      clearTimeout(this.roundTimeoutTimer);
      this.roundTimeoutTimer = null;
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.gameId = `GAME_${Date.now()}`;
    this.status = 'STARTING';
    this.currentRoundNumber = 0;
    this.activeQuiz = undefined;
    this.usedQuizIds.clear();
    this.gameStartedAt = Date.now();
    this.gameEndedAt = undefined;

    // 모든 참가자 초기화 (생존 상태, 점수 0)
    for (const p of this.players.values()) {
      p.isAlive = true;
      p.score = 0;
      p.selectedAnswer = undefined;
      p.answeredAt = undefined;
      p.eliminatedRound = undefined;
      p.eliminatedReason = undefined;
    }

    console.log(`[Game Started] 새 게임 시작 (GameID: ${this.gameId}, 참가자: ${this.players.size}명 전원 생존 복구)`);
    this.emitPlaySound('GAME_START');
    this.syncState();

    // 3, 2, 1 카운트다운
    let count = STARTING_COUNTDOWN_SEC;
    this.emitStartingCountdown(count);

    this.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        this.emitStartingCountdown(count);
        this.emitPlaySound('COUNTDOWN_TICK');
      } else {
        if (this.countdownTimer) {
          clearInterval(this.countdownTimer);
          this.countdownTimer = null;
        }
        this.startNextRound();
      }
    }, 1000);

    return true;
  }

  // --- 다음 라운드 출제 ---
  public startNextRound() {
    const survivors = this.getSurvivors();

    // 생존자가 1명만 남은 경우: 즉시 최종 우승
    if (survivors.length === 1 && this.currentRoundNumber >= 1) {
      this.endGame(survivors[0], false);
      return;
    }

    // 생존자가 0명인 경우: 무승부
    if (survivors.length === 0 && this.currentRoundNumber >= 1) {
      this.endGame(undefined, true);
      return;
    }

    this.currentRoundNumber++;
    this.status = 'IN_ROUND';
    this.lastRoundResult = undefined;

    // 참가자(생존자 및 관전자) 답변 초기화
    for (const p of this.players.values()) {
      p.selectedAnswer = undefined;
      p.answeredAt = undefined;
    }

    // 라운드별 설정 (1:10s, 2:8s, 3:7s, 4:7s, 5+:5s)
    const stageRule = DEFAULT_STAGE_RULES[Math.min(this.currentRoundNumber, 5)];
    const timeLimit = this.settings.questionTimeLimit || this.settings.stageTimeLimits[this.currentRoundNumber] || stageRule.timeLimit;
    const stageName = this.currentRoundNumber <= 5 ? stageRule.stageName : `결승 연장전 ${this.currentRoundNumber}라운드`;

    // 문제은행에서 승인된 미사용 문제 무작위 선정
    this.activeQuiz = this.selectNextQuiz();
    if (!this.activeQuiz) {
      // 문제를 모두 소진한 경우 현재 최고 득점자 우승 처리
      survivors.sort((a, b) => b.score - a.score);
      this.endGame(survivors[0], false);
      return;
    }

    this.roundStartTime = Date.now();
    this.roundEndTime = this.roundStartTime + timeLimit * 1000;

    const roundInfo: RoundInfo = {
      roundNumber: this.currentRoundNumber,
      stageName,
      totalRounds: Math.max(5, this.currentRoundNumber),
      quizId: this.activeQuiz.id,
      category: this.activeQuiz.category,
      question: this.activeQuiz.question,
      options: this.activeQuiz.options, // 4개 보기 전달 (정답 번호는 일절 포함하지 않음)
      timeLimit,
      serverStartTime: this.roundStartTime,
      serverEndTime: this.roundEndTime
    };

    console.log(`[Round ${this.currentRoundNumber} Start] 제한시간: ${timeLimit}초, 문제 ID: ${this.activeQuiz.id}`);
    this.emitRoundStart(roundInfo);
    this.emitPlaySound('ROUND_START');
    this.syncState();

    // 서버 기준 자동 마감 타이머 등록
    if (this.roundTimeoutTimer) clearTimeout(this.roundTimeoutTimer);
    this.roundTimeoutTimer = setTimeout(() => {
      this.finishRound();
    }, timeLimit * 1000);
  }

  // --- 등록된 문제 완전 랜덤 즉시 출제 (체크된 카테고리 한정) ---
  public triggerRandomQuiz() {
    let approvedQuizzes = this.db.getQuizzes(true);
    if (approvedQuizzes.length === 0) return;

    // 관리자가 선택한 카테고리 필터 적용
    const selectedCats = this.settings.selectedCategories;
    if (selectedCats && selectedCats.length > 0) {
      const filtered = approvedQuizzes.filter(q => selectedCats.includes(q.category));
      if (filtered.length > 0) {
        approvedQuizzes = filtered;
      }
    }

    // 대기실 또는 게임 종료 상태에서 호출 시 참가자 상태 초기화
    if (this.status === 'WAITING' || this.status === 'GAME_OVER') {
      this.currentRoundNumber = 0;
      this.usedQuizIds.clear();
      for (const p of this.players.values()) {
        p.isAlive = true;
        p.score = 0;
        p.selectedAnswer = undefined;
        p.answeredAt = undefined;
        p.eliminatedRound = undefined;
        p.eliminatedReason = undefined;
      }
    }

    if (this.roundTimeoutTimer) {
      clearTimeout(this.roundTimeoutTimer);
      this.roundTimeoutTimer = null;
    }

    this.currentRoundNumber++;
    this.status = 'IN_ROUND';
    this.lastRoundResult = undefined;

    // 참가자(생존자 및 관전자) 답변 초기화
    for (const p of this.players.values()) {
      p.selectedAnswer = undefined;
      p.answeredAt = undefined;
    }

    // 미사용 문제 우선 추출, 없으면 초기화
    let available = approvedQuizzes.filter(q => !this.usedQuizIds.has(q.id));
    if (available.length === 0) {
      this.usedQuizIds.clear();
      available = [...approvedQuizzes];
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    this.activeQuiz = available[randomIndex];
    this.usedQuizIds.add(this.activeQuiz.id);

    const timeLimit = this.settings.questionTimeLimit || 15; // 설정된 제한시간 적용 (기본 15초)
    this.roundStartTime = Date.now();
    this.roundEndTime = this.roundStartTime + timeLimit * 1000;

    const roundInfo: RoundInfo = {
      roundNumber: this.currentRoundNumber,
      stageName: `랜덤 챌린지 R${this.currentRoundNumber}`,
      totalRounds: Math.max(5, this.currentRoundNumber),
      quizId: this.activeQuiz.id,
      category: this.activeQuiz.category,
      question: this.activeQuiz.question,
      options: this.activeQuiz.options,
      timeLimit,
      serverStartTime: this.roundStartTime,
      serverEndTime: this.roundEndTime
    };

    console.log(`[Random Quiz Triggered] 라운드 ${this.currentRoundNumber}, 문제 ID: ${this.activeQuiz.id} (${this.activeQuiz.category})`);
    this.emitRoundStart(roundInfo);
    this.emitPlaySound('ROUND_START');
    this.syncState();

    this.roundTimeoutTimer = setTimeout(() => {
      this.finishRound();
    }, timeLimit * 1000);
  }

  // --- 문제 자동 선별 (체크된 카테고리 필터링 & 미사용 우선) ---
  private selectNextQuiz(): QuizItem | undefined {
    let approvedQuizzes = this.db.getQuizzes(true);

    // 관리자가 선택/체크한 카테고리 필터 적용
    const selectedCats = this.settings.selectedCategories;
    if (selectedCats && selectedCats.length > 0) {
      const filtered = approvedQuizzes.filter(q => selectedCats.includes(q.category));
      if (filtered.length > 0) {
        approvedQuizzes = filtered;
      }
    }

    let available = approvedQuizzes.filter(q => !this.usedQuizIds.has(q.id));

    // 선택된 카테고리의 문제를 모두 사용했다면 초기화 후 재순환
    if (available.length === 0) {
      this.usedQuizIds.clear();
      available = [...approvedQuizzes];
    }

    if (available.length === 0) return undefined;

    // 단계별 선호 카테고리가 있고, 그 카테고리가 관리자가 체크한 카테고리에 포함된 경우 우선 매칭
    let preferredCategory = '';
    if (this.currentRoundNumber === 1) preferredCategory = '일반 상식';
    else if (this.currentRoundNumber === 2) preferredCategory = '넌센스';
    else if (this.currentRoundNumber === 3) preferredCategory = '순발력';
    else if (this.currentRoundNumber === 4) preferredCategory = '함정 문제';

    let pool = available;
    if (preferredCategory && (!selectedCats || selectedCats.includes(preferredCategory as any))) {
      const matched = available.filter(q => q.category === preferredCategory);
      if (matched.length > 0) {
        pool = matched;
      }
    }

    const randomIndex = Math.floor(Math.random() * pool.length);
    const selected = pool[randomIndex];
    this.usedQuizIds.add(selected.id);
    return selected;
  }

  // --- 라운드 종료 및 정답/탈락 판정 ---
  public finishRound() {
    if (this.status !== 'IN_ROUND' || !this.activeQuiz) return;
    this.status = 'ROUND_RESULT';

    if (this.roundTimeoutTimer) {
      clearTimeout(this.roundTimeoutTimer);
      this.roundTimeoutTimer = null;
    }

    const quiz = this.activeQuiz;
    const eliminatedPlayers: Array<{ nickname: string; reason: string }> = [];
    const distribution: { [key: number]: number } = { 0: 0, 1: 0, 2: 0, 3: 0 };
    let answersCount = 0;

    for (const player of this.players.values()) {
      if (!player.isAlive) continue;

      if (player.selectedAnswer !== undefined) {
        answersCount++;
        distribution[player.selectedAnswer] = (distribution[player.selectedAnswer] || 0) + 1;
      }

      // 오답 또는 미응답 판정
      if (player.selectedAnswer === undefined) {
        // 시간 초과 (미응답) 탈락
        player.isAlive = false;
        player.eliminatedRound = this.currentRoundNumber;
        player.eliminatedReason = 'TIMEOUT';
        eliminatedPlayers.push({ nickname: player.nickname, reason: '시간 초과 (미응답)' });
      } else if (player.selectedAnswer !== quiz.answerIndex) {
        // 오답 탈락
        player.isAlive = false;
        player.eliminatedRound = this.currentRoundNumber;
        player.eliminatedReason = 'WRONG_ANSWER';
        eliminatedPlayers.push({ nickname: player.nickname, reason: '오답' });
      } else {
        // 정답 생존 -> 점수 부여 (기본 100점 + 남은 시간 보너스)
        const timeBonus = Math.max(0, Math.floor((this.roundEndTime - (this.roundStartTime + (player.answeredAt || 0))) / 100));
        player.score += 100 + timeBonus;
      }
    }

    const survivors = this.getSurvivors();
    const result: RoundResult = {
      roundNumber: this.currentRoundNumber,
      quizId: quiz.id,
      question: quiz.question,
      options: quiz.options,
      correctAnswerIndex: quiz.answerIndex,
      explanation: quiz.explanation,
      survivorsCount: survivors.length,
      eliminatedCount: eliminatedPlayers.length,
      eliminatedPlayers,
      distribution,
      answersCount
    };
    this.lastRoundResult = result;

    console.log(`[Round ${this.currentRoundNumber} Ended] 정답: 보기 ${quiz.answerIndex + 1}, 생존: ${survivors.length}명, 탈락: ${eliminatedPlayers.length}명`);

    this.emitRoundEnd(result);
    this.emitPlaySound(eliminatedPlayers.length > 0 ? 'ELIMINATED' : 'CORRECT');
    this.syncState();

    // 다음 분기 결정
    setTimeout(() => {
      if (this.status !== 'ROUND_RESULT') return; // 관리자 일시정지 등 대비

      // 1. 단 1명만 생존한 경우 -> 우승
      if (survivors.length === 1) {
        this.endGame(survivors[0], false);
      }
      // 2. 전원 탈락한 경우 -> 무승부
      else if (survivors.length === 0) {
        this.endGame(undefined, true);
      }
      // 3. 생존자가 2명 이상 남아있는 경우
      else {
        if (this.settings.autoProgress) {
          this.startNextRound();
        }
      }
    }, RESULT_DISPLAY_SEC * 1000);
  }

  // --- 게임 종료 처리 ---
  public endGame(winner?: Player, isDraw: boolean = false) {
    this.status = 'GAME_OVER';
    this.gameEndedAt = Date.now();

    if (this.roundTimeoutTimer) {
      clearTimeout(this.roundTimeoutTimer);
      this.roundTimeoutTimer = null;
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    if (winner) {
      this.emitPlaySound('WINNER_FANFARE');
    }

    this.emitWinner(winner, isDraw);
    const finalState = this.getState();
    finalState.winner = winner;
    finalState.isDraw = isDraw;

    // DB에 게임 기록 및 결과 영구 저장
    this.db.saveGameRecord(finalState);
    this.syncState();

    console.log(`===============================================`);
    console.log(`🏁 [GAME OVER] ${winner ? `🏆 우승자: ${winner.nickname}` : isDraw ? '무승부 (전원 탈락)' : '생존자 없음'}`);
    console.log(`===============================================`);
  }

  // --- 관리자 제어 기능 ---
  public pauseGame() {
    if (this.status === 'IN_ROUND') {
      this.status = 'PAUSED';
      if (this.roundTimeoutTimer) {
        clearTimeout(this.roundTimeoutTimer);
        this.roundTimeoutTimer = null;
      }
      this.pausedTimeRemaining = Math.max(0, this.roundEndTime - Date.now());
      this.syncState();
    }
  }

  public resumeGame() {
    if (this.status === 'PAUSED' && this.activeQuiz) {
      this.status = 'IN_ROUND';
      this.roundStartTime = Date.now();
      this.roundEndTime = this.roundStartTime + this.pausedTimeRemaining;
      
      this.roundTimeoutTimer = setTimeout(() => {
        this.finishRound();
      }, this.pausedTimeRemaining);

      this.syncState();
    }
  }

  public skipRound() {
    if (this.status === 'IN_ROUND') {
      if (this.roundTimeoutTimer) {
        clearTimeout(this.roundTimeoutTimer);
        this.roundTimeoutTimer = null;
      }
      this.finishRound();
    }
  }

  public kickPlayer(token: string) {
    const player = this.players.get(token);
    if (player) {
      player.isAlive = false;
      player.eliminatedReason = 'ADMIN_KICK';
      player.eliminatedRound = this.currentRoundNumber;
      this.syncState();

      // 생존자 1명 이하 시 게임 자동 종료 검토
      if (this.status === 'IN_ROUND') {
        const survivors = this.getSurvivors();
        if (survivors.length <= 1) {
          this.finishRound();
        }
      }
    }
  }

  public clearAllPlayers() {
    this.players.clear();
    this.socketToToken.clear();
    this.resetGame();
    console.log('[All Players Cleared] 모든 참가자 목록이 0명으로 초기화되었습니다.');
  }

  public resetGame() {
    if (this.roundTimeoutTimer) {
      clearTimeout(this.roundTimeoutTimer);
      this.roundTimeoutTimer = null;
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.gameId = `GAME_${Date.now()}`;
    this.status = 'WAITING';
    this.currentRoundNumber = 0;
    this.activeQuiz = undefined;
    this.usedQuizIds.clear();
    this.gameStartedAt = undefined;
    this.gameEndedAt = undefined;

    for (const p of this.players.values()) {
      p.isAlive = true;
      p.score = 0;
      p.selectedAnswer = undefined;
      p.answeredAt = undefined;
      p.eliminatedRound = undefined;
      p.eliminatedReason = undefined;
    }

    console.log(`[Game Reset to Lobby] 새 게임 대기실로 초기화 완료 (참가자: ${this.players.size}명 전원 생존 복구)`);
    this.syncState();
    this.emitForceLobby();
  }

  // --- 1등 확정 / 무승부 시 대기실 복귀 (GAME_OVER 상태는 관리자 제어 시에만 전환) ---
  public requestResetToLobby(): boolean {
    if (this.status === 'GAME_OVER') {
      console.log('[Notice] GAME_OVER 상태에서는 관리자가 새 게임을 시작하기 전까지 대기실로 자동 복귀하지 않고 결과를 유지합니다.');
      return false;
    }
    this.resetGame();
    return true;
  }

  // --- 실시간 채팅 처리 ---
  public addChatMessage(socketId: string, text: string, clientToken?: string): ChatMessage | null {
    let token = this.socketToToken.get(socketId) || clientToken;
    if (!token || !this.players.has(token)) return null;

    const player = this.players.get(token)!;
    // 소켓 매핑 최신화
    this.socketToToken.set(socketId, token);
    player.id = socketId;

    const chat: ChatMessage = {
      id: uuidv4(),
      token: player.token,
      nickname: player.nickname,
      message: text.slice(0, 100).trim(),
      isAlive: player.isAlive,
      timestamp: Date.now()
    };

    this.chatHistory.push(chat);
    if (this.chatHistory.length > 50) {
      this.chatHistory.shift();
    }
    return chat;
  }

  public getChatHistory(): ChatMessage[] {
    return this.chatHistory;
  }

  public clearChatHistory(): void {
    this.chatHistory = [];
    console.log('[GameEngine] Chat history cleared');
  }

  public updateSettings(newSettings: Partial<GameSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    this.syncState();
  }

  public getSurvivors(): Player[] {
    return Array.from(this.players.values()).filter(p => p.isAlive);
  }

  // --- 최종 1~150등 등수 계산 (생존 여부, 점수, 탈락 라운드 종합) ---
  public calculateTopRankings(limit: number = 150): RankedPlayer[] {
    const sorted = Array.from(this.players.values()).sort((a, b) => {
      // 1. 생존자 우선
      if (a.isAlive && !b.isAlive) return -1;
      if (!a.isAlive && b.isAlive) return 1;

      // 2. 점수 높은 순
      if (b.score !== a.score) return b.score - a.score;

      // 3. 더 늦은 라운드에 탈락한 사람 우선
      const roundA = a.eliminatedRound || 0;
      const roundB = b.eliminatedRound || 0;
      if (roundB !== roundA) return roundB - roundA;

      return a.nickname.localeCompare(b.nickname);
    });

    let currentRank = 1;
    return sorted.slice(0, limit).map((p, idx, arr) => {
      if (idx > 0) {
        const prev = arr[idx - 1];
        const sameScore = prev.score === p.score;
        const sameAlive = prev.isAlive === p.isAlive;
        const sameRound = (prev.eliminatedRound || 0) === (p.eliminatedRound || 0);
        if (!sameScore || !sameAlive || !sameRound) {
          currentRank = idx + 1;
        }
      }
      return {
        rank: currentRank,
        token: p.token,
        nickname: p.nickname,
        score: p.score,
        isAlive: p.isAlive,
        eliminatedRound: p.eliminatedRound
      };
    });
  }

  public getState(): GameState {
    const survivors = this.getSurvivors();
    const winner = this.status === 'GAME_OVER' && survivors.length === 1 ? survivors[0] : undefined;

    return {
      gameId: this.gameId,
      status: this.status,
      currentRound: this.currentRoundNumber,
      totalRounds: Math.max(5, this.currentRoundNumber),
      players: Array.from(this.players.values()),
      survivors,
      topRankings: this.calculateTopRankings(),
      currentRoundInfo: this.status === 'IN_ROUND' && this.activeQuiz ? {
        roundNumber: this.currentRoundNumber,
        stageName: DEFAULT_STAGE_RULES[Math.min(this.currentRoundNumber, 5)]?.stageName || `결승 연장전`,
        totalRounds: Math.max(5, this.currentRoundNumber),
        quizId: this.activeQuiz.id,
        category: this.activeQuiz.category,
        question: this.activeQuiz.question,
        options: this.activeQuiz.options,
        timeLimit: Math.round((this.roundEndTime - this.roundStartTime) / 1000),
        serverStartTime: this.roundStartTime,
        serverEndTime: this.roundEndTime
      } : undefined,
      winner,
      lastRoundResult: this.lastRoundResult,
      settings: this.settings,
      gameStartedAt: this.gameStartedAt,
      gameEndedAt: this.gameEndedAt
    };
  }

  public syncState() {
    this.emitStateSync(this.getState());
  }

  public getDatabase() {
    return this.db;
  }
}

