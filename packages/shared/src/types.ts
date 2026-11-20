export type QuizCategory =
  | '일반 상식'
  | '넌센스'
  | '과학 및 역사'
  | '스포츠'
  | '영화 및 음악'
  | '속담 및 맞춤법'
  | '회사 생활 및 직장인 유머'
  | '순발력'
  | '함정 문제'
  | '초등상식'
  | '중등상식'
  | '고등상식';

export interface QuizItem {
  id: number;
  question: string;
  category: QuizCategory;
  options: [string, string, string, string];
  answerIndex: number; // 0..3
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  timeLimit: number; // 초
  isApproved: boolean;
  isUsed?: boolean;
}

export type PlayerStatus = 'alive' | 'eliminated' | 'spectator';

export interface Player {
  id: string; // Socket ID (접속할 때마다 갱신)
  token: string; // 참가자 고유 복구 토큰 (새로고침/재접속 시 신원 복구용)
  nickname: string;
  isAlive: boolean;
  score: number;
  selectedAnswer?: number;
  answeredAt?: number; // 응답 소요 시간(ms)
  eliminatedRound?: number; // 몇 라운드에서 탈락했는지
  eliminatedReason?: 'WRONG_ANSWER' | 'TIMEOUT' | 'DISCONNECT_FORCED' | 'ADMIN_KICK';
  isOnline: boolean;
}

export type GameStatus =
  | 'WAITING'           // 참가자 입장 대기 (QR코드 및 대기실)
  | 'STARTING'          // 카운트다운 (3, 2, 1)
  | 'QUESTION_READING'  // 문제 사전 낭독 중 (보기 비활성화/블러)
  | 'IN_ROUND'          // 보기 오픈 및 문제 풀이 제한시간 진행 중
  | 'ROUND_RESULT'      // 정답 공개 및 탈락자 처리 연출
  | 'PAUSED'            // 관리자 일시정지
  | 'GAME_OVER';        // 최종 우승자 발표 및 종료

export interface RoundInfo {
  roundNumber: number;
  stageName: string; // 1라운드(일반상식), 2라운드(눈치/재미), 3라운드(순발력), 4라운드(함정), 최종전(최후의 1인)
  totalRounds: number;
  quizId: number;
  category: QuizCategory;
  question: string;
  options: [string, string, string, string];
  timeLimit: number;
  serverStartTime: number; // 서버 기준 시작 시각(ms)
  serverEndTime: number;   // 서버 기준 마감 시각(ms)
  isReading?: boolean;     // 문제 낭독 단계 여부
}

export interface RoundResult {
  roundNumber: number;
  quizId: number;
  question?: string;
  options?: [string, string, string, string];
  correctAnswerIndex: number;
  explanation: string;
  survivorsCount: number;
  eliminatedCount: number;
  eliminatedPlayers: Array<{ nickname: string; reason: string }>;
  distribution: { [optionIndex: number]: number };
  answersCount: number;
}

export interface GameSettings {
  maxPlayers: number;
  isSoundEnabled: boolean;
  bgmEnabled: boolean;
  autoProgress: boolean; // 다음 문제 자동 진행 여부
  stageTimeLimits: { [roundNumber: number]: number }; // 라운드별 기본 제한시간
  questionTimeLimit?: number; // 문제 풀이 제한 시간 (10 | 15 | 20 | 25초, 기본값: 15초)
  selectedCategories?: QuizCategory[]; // 출제할 문제 카테고리 필터
}

export interface RankedPlayer {
  rank: number;
  token: string;
  nickname: string;
  score: number;
  isAlive: boolean;
  eliminatedRound?: number;
}

export interface GameState {
  gameId: string;
  status: GameStatus;
  currentRound: number;
  totalRounds: number;
  players: Player[];
  survivors: Player[];
  currentRoundInfo?: RoundInfo;
  lastRoundResult?: RoundResult;
  winner?: Player;
  isDraw?: boolean; // 전원 동시 탈락 시 무승부
  topRankings?: RankedPlayer[]; // 최종 1~10등 등수 순위표
  settings: GameSettings;
  gameStartedAt?: number;
  gameEndedAt?: number;
}

export interface ChatMessage {
  id: string;
  token: string;
  nickname: string;
  message: string;
  isAlive: boolean;
  timestamp: number;
}

// Socket 이벤트 규약
export interface ClientToServerEvents {
  // 참가자
  'player:join': (
    data: { nickname: string; token?: string },
    callback: (res: { success: boolean; player?: Player; message?: string }) => void
  ) => void;
  'player:submit_answer': (
    data: { answerIndex: number; clientTimestamp: number; token?: string },
    callback: (res: { success: boolean; message?: string; isSpectator?: boolean }) => void
  ) => void;
  'chat:send': (
    data: { message: string; token?: string },
    callback?: (res: { success: boolean; message?: string }) => void
  ) => void;
  'player:update_nickname': (
    data: { token: string; newNickname: string },
    callback: (res: { success: boolean; message?: string; player?: Player }) => void
  ) => void;
  'game:request_reset': () => void; // 게임 종료 후 대기실 복귀 요청
  'player:leave': (
    data: { token?: string },
    callback?: (res: { success: boolean }) => void
  ) => void; // 참가자 뒤로가기/창닫기 시 퇴장 요청
  'round:open_options': () => void; // TV TTS 낭독 완료 또는 타이머로 보기 오픈 요청

  // 관리자
  'admin:auth': (password: string, callback: (res: { success: boolean }) => void) => void;
  'admin:change_password': (
    data: { currentPassword: string; newPassword: string },
    callback: (res: { success: boolean; message?: string }) => void
  ) => void;
  'admin:start_game': (callback?: (res: { success: boolean }) => void) => void;
  'admin:pause_game': () => void;
  'admin:resume_game': () => void;
  'admin:skip_round': () => void;
  'admin:skip_reading': () => void; // 문제 낭독 즉시 스킵 후 보기 오픈
  'admin:random_quiz': () => void;
  'admin:kick_player': (token: string) => void;
  'admin:update_timer': (seconds: number) => void;
  'admin:reset_game': () => void;
  'admin:clear_all_players': (callback?: (res: { success: boolean }) => void) => void;
  'admin:move_to_lobby': (callback?: (res: { success: boolean }) => void) => void;
  'admin:chat_clear': (callback?: (res: { success: boolean }) => void) => void;
  'admin:update_settings': (settings: Partial<GameSettings>) => void;
  'admin:quiz:add': (quiz: Omit<QuizItem, 'id'>, callback: (res: { success: boolean; quiz?: QuizItem }) => void) => void;
  'admin:quiz:update': (quiz: QuizItem, callback: (res: { success: boolean }) => void) => void;
  'admin:quiz:delete': (id: number, callback: (res: { success: boolean }) => void) => void;
  'admin:quiz:toggle_approve': (id: number, callback: (res: { success: boolean }) => void) => void;
  'admin:play_sound': (soundType: SoundEffectType) => void;
}

export type SoundEffectType =
  | 'COUNTDOWN_TICK'
  | 'COUNTDOWN_URGENT'
  | 'TIMEOUT'
  | 'CORRECT'
  | 'WRONG'
  | 'ELIMINATED'
  | 'WINNER_FANFARE'
  | 'ROUND_START'
  | 'GAME_START';

export interface ServerToClientEvents {
  'game:state_sync': (state: GameState) => void;
  'game:starting_countdown': (secondsLeft: number) => void;
  'game:round_started': (round: RoundInfo) => void;
  'game:round_ended': (result: RoundResult) => void;
  'game:winner_announced': (winner?: Player, isDraw?: boolean) => void;
  'game:force_lobby': () => void;
  'game:player_kicked_all': () => void;
  'game:play_sound': (soundType: SoundEffectType) => void;
  'player:answered': (data: { token: string; answerCount: number; totalAlive: number }) => void;
  'chat:message': (chat: ChatMessage) => void;
  'chat:history': (messages: ChatMessage[]) => void;
  'chat:cleared': () => void;
  'server:tunnel_updated': (url: string) => void;
  'error:message': (message: string) => void;
}
