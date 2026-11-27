const fs = require('fs');
const path = require('path');

const categories = [
  { file: 'common.js', tsFile: 'common.ts', varName: 'COMMON_QUESTIONS', categoryName: '일반상식' },
  { file: 'nonsense.js', tsFile: 'nonsense.ts', varName: 'NONSENSE_QUESTIONS', categoryName: '넌센스' },
  { file: 'scienceHistory.js', tsFile: 'scienceHistory.ts', varName: 'SCIENCE_HISTORY_QUESTIONS', categoryName: '과학 및 역사' },
  { file: 'sports.js', tsFile: 'sports.ts', varName: 'SPORTS_QUESTIONS', categoryName: '스포츠' },
  { file: 'proverbSpelling.js', tsFile: 'proverbSpelling.ts', varName: 'PROVERB_SPELLING_QUESTIONS', categoryName: '속담 및 맞춤법' },
  { file: 'movieMusic.js', tsFile: 'movieMusic.ts', varName: 'MOVIE_MUSIC_QUESTIONS', categoryName: '영화 및 음악' },
  { file: 'trap.js', tsFile: 'trap.ts', varName: 'TRAP_QUESTIONS', categoryName: '함정문제' },
  { file: 'elementary.js', tsFile: 'elementary.ts', varName: 'ELEMENTARY_QUESTIONS', categoryName: '초등상식' },
  { file: 'middle.js', tsFile: 'middle.ts', varName: 'MIDDLE_QUESTIONS', categoryName: '중등상식' },
  { file: 'high.js', tsFile: 'high.ts', varName: 'HIGH_QUESTIONS', categoryName: '고등상식' }
];

const dataDir = path.join(__dirname, 'data');
const outDir = path.join(__dirname, '..', 'src', 'questions');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const seenIds = new Set();
let allQuestions = [];

for (const cat of categories) {
  const filePath = path.join(dataDir, cat.file);
  if (!fs.existsSync(filePath)) {
    console.error(`File missing: ${filePath}`);
    process.exit(1);
  }
  const rawList = require(filePath);
  if (!Array.isArray(rawList) || rawList.length !== 100) {
    console.error(`Error in ${cat.file}: expected 100 questions, got ${rawList ? rawList.length : 'none'}`);
    process.exit(1);
  }

  const list = rawList.map(item => ({
    id: item.id,
    question: item.question || item.q,
    options: item.options || item.opts,
    answerIndex: typeof item.answerIndex === 'number' ? item.answerIndex : (typeof item.answer === 'number' ? item.answer : (typeof item.a === 'number' ? item.a : 0)),
    category: item.category || cat.categoryName,
    difficulty: item.difficulty || 'medium',
    explanation: item.explanation || item.exp || '',
    timeLimit: item.timeLimit || 15,
    isApproved: item.isApproved !== undefined ? item.isApproved : (item.approved !== undefined ? item.approved : true)
  }));

  for (const q of list) {
    if (seenIds.has(q.id)) {
      console.error(`Duplicate ID found: ${q.id} in ${cat.file}`);
      process.exit(1);
    }
    seenIds.add(q.id);
  }
  allQuestions.push(...list);

  // Write TS file
  const tsContent = `import { QuizItem } from '../types';

export const ${cat.varName}: QuizItem[] = ${JSON.stringify(list, null, 2)};
`;
  fs.writeFileSync(path.join(outDir, cat.tsFile), tsContent, 'utf-8');
  console.log(`Generated ${cat.tsFile} (${list.length} questions)`);
}

// Write questions/index.ts
const indexImports = categories.map(c => `import { ${c.varName} } from './${c.tsFile.replace('.ts', '')}';`).join('\n');
const indexExports = categories.map(c => `export { ${c.varName} } from './${c.tsFile.replace('.ts', '')}';`).join('\n');
const allConcat = categories.map(c => `  ...${c.varName}`).join(',\n');

const indexTs = `import { QuizItem } from '../types';
${indexImports}

${indexExports}

export const ALL_QUESTIONS: QuizItem[] = [
${allConcat}
];
`;
fs.writeFileSync(path.join(outDir, 'index.ts'), indexTs, 'utf-8');
console.log(`Generated questions/index.ts (Total questions: ${allQuestions.length})`);

// Update packages/shared/src/quizzes.ts
const quizzesTsPath = path.join(__dirname, '..', 'src', 'quizzes.ts');
const quizzesTsContent = `import { QuizItem } from './types';
import { ALL_QUESTIONS } from './questions';

export const INITIAL_QUIZ_BANK: QuizItem[] = ALL_QUESTIONS;
export { ALL_QUESTIONS };
`;
fs.writeFileSync(quizzesTsPath, quizzesTsContent, 'utf-8');
console.log(`Updated packages/shared/src/quizzes.ts`);

// Overwrite packages/server/data/quiz_database.json
const serverDbDir = path.join(__dirname, '..', '..', 'server', 'data');
if (!fs.existsSync(serverDbDir)) {
  fs.mkdirSync(serverDbDir, { recursive: true });
}
const serverDbPath = path.join(serverDbDir, 'quiz_database.json');
fs.writeFileSync(serverDbPath, JSON.stringify(allQuestions, null, 2), 'utf-8');
console.log(`Updated ${serverDbPath} with ${allQuestions.length} questions`);
