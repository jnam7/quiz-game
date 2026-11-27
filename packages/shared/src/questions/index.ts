import { QuizItem } from '../types';
import { COMMON_QUESTIONS } from './common';
import { NONSENSE_QUESTIONS } from './nonsense';
import { SCIENCE_HISTORY_QUESTIONS } from './scienceHistory';
import { SPORTS_QUESTIONS } from './sports';
import { PROVERB_SPELLING_QUESTIONS } from './proverbSpelling';
import { MOVIE_MUSIC_QUESTIONS } from './movieMusic';
import { TRAP_QUESTIONS } from './trap';
import { ELEMENTARY_QUESTIONS } from './elementary';
import { MIDDLE_QUESTIONS } from './middle';
import { HIGH_QUESTIONS } from './high';

export { COMMON_QUESTIONS } from './common';
export { NONSENSE_QUESTIONS } from './nonsense';
export { SCIENCE_HISTORY_QUESTIONS } from './scienceHistory';
export { SPORTS_QUESTIONS } from './sports';
export { PROVERB_SPELLING_QUESTIONS } from './proverbSpelling';
export { MOVIE_MUSIC_QUESTIONS } from './movieMusic';
export { TRAP_QUESTIONS } from './trap';
export { ELEMENTARY_QUESTIONS } from './elementary';
export { MIDDLE_QUESTIONS } from './middle';
export { HIGH_QUESTIONS } from './high';

export const ALL_QUESTIONS: QuizItem[] = [
  ...COMMON_QUESTIONS,
  ...NONSENSE_QUESTIONS,
  ...SCIENCE_HISTORY_QUESTIONS,
  ...SPORTS_QUESTIONS,
  ...PROVERB_SPELLING_QUESTIONS,
  ...MOVIE_MUSIC_QUESTIONS,
  ...TRAP_QUESTIONS,
  ...ELEMENTARY_QUESTIONS,
  ...MIDDLE_QUESTIONS,
  ...HIGH_QUESTIONS
];
