import { io, Socket } from 'socket.io-client';
import {
  GameState,
  ClientToServerEvents,
  ServerToClientEvents,
  RoundInfo,
  RoundResult
} from '@quiz/shared';

const SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:4000';
const BOT_COUNT = 100;

interface BotClient {
  id: number;
  nickname: string;
  token?: string;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isAlive: boolean;
  score: number;
}

async function runLoadTest() {
  console.log(`=======================================================`);
  console.log(`🧪 [100인 가상 봇 부하 테스트 시작]`);
  console.log(`🎯 대상 서버: ${SERVER_URL}`);
  console.log(`🤖 참가 봇 수: ${BOT_COUNT}명`);
  console.log(`=======================================================`);

  const bots: BotClient[] = [];
  let joinedCount = 0;
  let currentRound = 0;
  let testStartTime = Date.now();

  // 1. 100명 봇 소켓 연결 및 입장
  for (let i = 1; i <= BOT_COUNT; i++) {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
      transports: ['websocket'],
      forceNew: true
    });

    const bot: BotClient = {
      id: i,
      nickname: `도전자_${String(i).padStart(3, '0')}`,
      socket,
      isAlive: true,
      score: 0
    };
    bots.push(bot);

    socket.on('connect', () => {
      socket.emit('player:join', { nickname: bot.nickname }, (res) => {
        if (res.success && res.player) {
          bot.token = res.player.token;
          joinedCount++;
          if (joinedCount === BOT_COUNT) {
            console.log(`✅ [1단계 성공] 100명 가상 봇 전원 입장 완료! (소요 시간: ${Date.now() - testStartTime}ms)`);
            triggerGameStart(bots[0].socket);
          }
        } else {
          console.error(`❌ 봇 ${bot.nickname} 입장 실패:`, res.message);
        }
      });
    });

    // 라운드 출제 이벤트 수신 시 답변 자동 제출 시뮬레이션
    socket.on('game:round_started', (roundInfo: RoundInfo) => {
      currentRound = roundInfo.roundNumber;
      if (!bot.isAlive) return;

      // 0.5초 ~ 3.5초 사이에 랜덤하게 답변 제출
      const delayMs = 500 + Math.random() * 3000;
      setTimeout(() => {
        if (!bot.isAlive) return;
        // 4지선다 중 하나 선택 (확률적으로 정답 또는 오답)
        const choice = Math.floor(Math.random() * 4);
        socket.emit('player:submit_answer', {
          answerIndex: choice,
          clientTimestamp: Date.now()
        }, () => {});
      }, delayMs);
    });

    // 라운드 결과 수신 시 생존 여부 동기화
    socket.on('game:round_ended', (result: RoundResult) => {
      // 탈락자 명단에 내가 있는지 확인
      const isEliminated = result.eliminatedPlayers.some(p => p.nickname === bot.nickname);
      if (isEliminated) {
        bot.isAlive = false;
      }
      if (bot.id === 1) {
        console.log(`📊 [라운드 ${result.roundNumber} 집계] 생존: ${result.survivorsCount}명, 이번 탈락: ${result.eliminatedCount}명 (정답: 보기 ${result.correctAnswerIndex + 1})`);
      }
    });

    // 게임 종료
    socket.on('game:winner_announced', (winner, isDraw) => {
      if (bot.id === 1) {
        console.log(`=======================================================`);
        console.log(`🏆 [테스트 완료: 게임 종료]`);
        if (winner) {
          console.log(`🎉 최종 우승 봇: ${winner.nickname} (점수: ${winner.score}점)`);
        } else if (isDraw) {
          console.log(`🤝 전원 탈락으로 인한 무승부 처리 완료`);
        }
        console.log(`총 테스트 소요 시간: ${Math.round((Date.now() - testStartTime) / 1000)}초`);
        console.log(`=======================================================`);
        
        // 봇 연결 해제
        setTimeout(() => {
          bots.forEach(b => b.socket.disconnect());
          process.exit(0);
        }, 1500);
      }
    });
  }
}

function triggerGameStart(adminSocket: Socket<ServerToClientEvents, ClientToServerEvents>) {
  console.log(`🎮 [2단계] 관리자 권한으로 게임 시작 트리거 요청...`);
  // 관리자 인증 후 시작
  adminSocket.emit('admin:auth', 'quizadmin2026', (authRes) => {
    if (authRes.success) {
      console.log(`🔑 관리자 인증 성공`);
      adminSocket.emit('admin:start_game', (startRes) => {
        if (startRes?.success) {
          console.log(`🚀 게임 카운트다운 시작!`);
        }
      });
    }
  });
}

// 스크립트 단독 실행 시 테스트 동작
if (require.main === module) {
  runLoadTest().catch(console.error);
}

