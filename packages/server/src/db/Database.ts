import fs from 'fs';
import path from 'path';
import { QuizItem, GameState, INITIAL_QUIZ_BANK, ADMIN_PASSWORD } from '@quiz/shared';
import * as XLSX from 'xlsx';

export interface GameHistoryRecord {
  gameId: string;
  startedAt: string;
  endedAt: string;
  totalPlayers: number;
  winnerNickname: string;
  winnerScore: number;
  totalRounds: number;
  participants: Array<{
    token: string;
    nickname: string;
    isAlive: boolean;
    score: number;
    eliminatedRound?: number;
    eliminatedReason?: string;
  }>;
}

export class JsonDatabase {
  private dbPath: string;
  private quizzes: QuizItem[] = [];
  private history: GameHistoryRecord[] = [];
  private adminPassword?: string;

  constructor() {
    const dataDir = path.resolve(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'quiz_database.json');
    this.loadDatabase();
  }

  public getAdminPassword(): string {
    return this.adminPassword || process.env.ADMIN_PASSWORD || ADMIN_PASSWORD || 'admin123';
  }

  public setAdminPassword(newPassword: string): boolean {
    this.adminPassword = newPassword;
    this.saveDatabase();
    return true;
  }

  private loadDatabase() {
    const defaultPw = process.env.ADMIN_PASSWORD || ADMIN_PASSWORD || 'admin123';
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.quizzes = parsed.quizzes || INITIAL_QUIZ_BANK;
        this.history = parsed.history || [];
        this.adminPassword = parsed.adminPassword || defaultPw;
        // 모든 문제의 기본 제한시간을 15초로 동기화
        this.quizzes.forEach(q => { q.timeLimit = 15; });

        // INITIAL_QUIZ_BANK의 신규 문제가 기존 DB에 누락되어 있다면 자동 병합
        const existingQuestions = new Set(this.quizzes.map(q => q.question.trim()));
        let addedCount = 0;
        for (const item of INITIAL_QUIZ_BANK) {
          if (!existingQuestions.has(item.question.trim())) {
            const nextId = this.quizzes.reduce((max, cur) => Math.max(max, cur.id), 0) + 1;
            this.quizzes.push({ ...item, id: nextId });
            existingQuestions.add(item.question.trim());
            addedCount++;
          }
        }
        if (addedCount > 0) {
          console.log(`📚 [문제은행 동기화] 신규 문제 ${addedCount}개가 DB에 자동 추가되었습니다. (총 ${this.quizzes.length}개)`);
        }

        this.saveDatabase();
        return;
      } catch (err) {
        console.error('[DB Load Error] Initializing with default bank:', err);
      }
    }
    // 최초 실행 시 기본 132개 문제로 초기화
    this.quizzes = [...INITIAL_QUIZ_BANK];
    this.history = [];
    this.adminPassword = defaultPw;
    this.saveDatabase();
  }

  private saveDatabase() {
    try {
      const defaultPw = process.env.ADMIN_PASSWORD || ADMIN_PASSWORD || 'admin123';
      const data = {
        quizzes: this.quizzes,
        history: this.history,
        adminPassword: this.adminPassword || defaultPw,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB Save Error]:', err);
    }
  }

  // --- 문제은행 CRUD ---
  public getQuizzes(onlyApproved: boolean = false): QuizItem[] {
    if (onlyApproved) {
      return this.quizzes.filter(q => q.isApproved);
    }
    return this.quizzes;
  }

  public getQuizById(id: number): QuizItem | undefined {
    return this.quizzes.find(q => q.id === id);
  }

  public addQuiz(quiz: Omit<QuizItem, 'id'>): QuizItem {
    const nextId = this.quizzes.length > 0 ? Math.max(...this.quizzes.map(q => q.id)) + 1 : 1;
    const newQuiz: QuizItem = { ...quiz, id: nextId };
    this.quizzes.push(newQuiz);
    this.saveDatabase();
    return newQuiz;
  }

  public updateQuiz(updated: QuizItem): boolean {
    const idx = this.quizzes.findIndex(q => q.id === updated.id);
    if (idx === -1) return false;
    this.quizzes[idx] = updated;
    this.saveDatabase();
    return true;
  }

  public deleteQuiz(id: number): boolean {
    const beforeCount = this.quizzes.length;
    this.quizzes = this.quizzes.filter(q => q.id !== id);
    if (this.quizzes.length !== beforeCount) {
      this.saveDatabase();
      return true;
    }
    return false;
  }

  public toggleApprove(id: number): boolean {
    const quiz = this.quizzes.find(q => q.id === id);
    if (!quiz) return false;
    quiz.isApproved = !quiz.isApproved;
    this.saveDatabase();
    return true;
  }

  // --- 게임 히스토리 및 엑셀 다운로드 ---
  public saveGameRecord(state: GameState) {
    const record: GameHistoryRecord = {
      gameId: state.gameId,
      startedAt: state.gameStartedAt ? new Date(state.gameStartedAt).toLocaleString('ko-KR') : '-',
      endedAt: state.gameEndedAt ? new Date(state.gameEndedAt).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR'),
      totalPlayers: state.players.length,
      winnerNickname: state.winner?.nickname || (state.isDraw ? '무승부' : '생존자 없음'),
      winnerScore: state.winner?.score || 0,
      totalRounds: state.currentRound,
      participants: state.players.map(p => ({
        token: p.token,
        nickname: p.nickname,
        isAlive: p.isAlive,
        score: p.score,
        eliminatedRound: p.eliminatedRound,
        eliminatedReason: p.eliminatedReason
      }))
    };

    this.history.unshift(record);
    this.saveDatabase();
  }

  public getHistory(): GameHistoryRecord[] {
    return this.history;
  }

  public generateExcelBuffer(gameId?: string): Buffer {
    const wb = XLSX.utils.book_new();

    // 1. 게임 요약 시트
    const summaryData = this.history
      .filter(h => !gameId || h.gameId === gameId)
      .map(h => ({
        '게임 ID': h.gameId,
        '시작 일시': h.startedAt,
        '종료 일시': h.endedAt,
        '총 참가자 수': h.totalPlayers,
        '진행 라운드': h.totalRounds,
        '최종 우승자': h.winnerNickname,
        '우승자 점수': h.winnerScore
      }));

    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, '게임 요약');

    // 2. 최근 게임 참가자 상세 시트
    const targetGame = gameId ? this.history.find(h => h.gameId === gameId) : this.history[0];
    if (targetGame) {
      const participantData = targetGame.participants
        .sort((a, b) => b.score - a.score)
        .map((p, idx) => ({
          '순위': idx + 1,
          '닉네임': p.nickname,
          '최종 상태': p.isAlive ? '최종 생존 (우승)' : '탈락',
          '획득 점수': p.score,
          '탈락 라운드': p.eliminatedRound ? `${p.eliminatedRound}라운드` : '-',
          '탈락 사유': p.eliminatedReason === 'WRONG_ANSWER' ? '오답' :
                      p.eliminatedReason === 'TIMEOUT' ? '시간 초과(미응답)' :
                      p.eliminatedReason === 'ADMIN_KICK' ? '관리자 강퇴' : '-'
        }));

      const wsParticipants = XLSX.utils.json_to_sheet(participantData);
      XLSX.utils.book_append_sheet(wb, wsParticipants, '참가자 결과');
    }

    // 3. 문제은행 현황 시트
    const quizData = this.quizzes.map(q => ({
      'ID': q.id,
      '카테고리': q.category,
      '난이도': q.difficulty,
      '문제': q.question,
      '보기1': q.options[0],
      '보기2': q.options[1],
      '보기3': q.options[2],
      '보기4': q.options[3],
      '정답': `보기 ${q.answerIndex + 1} (${q.options[q.answerIndex]})`,
      '제한시간(초)': q.timeLimit,
      '승인여부': q.isApproved ? '승인' : '미승인',
      '해설': q.explanation
    }));
    const wsQuizzes = XLSX.utils.json_to_sheet(quizData);
    XLSX.utils.book_append_sheet(wb, wsQuizzes, '문제은행');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
}

