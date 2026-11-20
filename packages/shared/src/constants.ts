import { QuizCategory } from './types';

export const MAX_PLAYERS = 150;

export const ALL_QUIZ_CATEGORIES: QuizCategory[] = [
  '일반 상식',
  '넌센스',
  '과학 및 역사',
  '스포츠',
  '영화 및 음악',
  '속담 및 맞춤법',
  '회사 생활 및 직장인 유머',
  '순발력',
  '함정 문제',
  '초등상식',
  '중등상식',
  '고등상식'
];

export const DEFAULT_STAGE_RULES: { [round: number]: { timeLimit: number; stageName: string } } = {
  1: { timeLimit: 15, stageName: '1라운드: 일반 상식' },
  2: { timeLimit: 15, stageName: '2라운드: 눈치 및 재미' },
  3: { timeLimit: 15, stageName: '3라운드: 순발력' },
  4: { timeLimit: 15, stageName: '4라운드: 함정 문제' },
  5: { timeLimit: 15, stageName: '최종전: 최후의 1인 결승' }
};

export const DEFAULT_SETTINGS = {
  maxPlayers: 150,
  isSoundEnabled: true,
  bgmEnabled: true,
  autoProgress: true,
  questionTimeLimit: 15,
  stageTimeLimits: {
    1: 15,
    2: 15,
    3: 15,
    4: 15,
    5: 15
  },
  selectedCategories: [...ALL_QUIZ_CATEGORIES],
  qrMode: 'EXTERNAL' as const
};

export const ADMIN_PASSWORD = (typeof process !== 'undefined' && process.env?.ADMIN_PASSWORD) || 'admin123'; // 관리자 기본 비밀번호
export const SOCKET_ROOM_MAIN = 'room:survival_quiz_main';
export const SOCKET_ROOM_ADMIN = 'room:survival_quiz_admin';
export const SOCKET_ROOM_TV = 'room:survival_quiz_tv';

export const RESULT_DISPLAY_SEC = 5;
export const STARTING_COUNTDOWN_SEC = 3;
