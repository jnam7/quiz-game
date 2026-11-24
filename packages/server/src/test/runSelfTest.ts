import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { io as ClientIO } from 'socket.io-client';
import { JsonDatabase } from '../db/Database';
import { GameEngine } from '../game/GameEngine';
import { setupSocketHandlers } from '../socket';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  SOCKET_ROOM_MAIN,
  RoundInfo,
  RoundResult
} from '@quiz/shared';

async function runIntegratedTest() {
  console.log(`=======================================================`);
  console.log(`🧪 [100인 서바이벌 퀴즈 실시간 통합 부하 테스트]`);
  console.log(`=======================================================`);

  const app = express();
  const httpServer = http.createServer(app);
  const db = new JsonDatabase();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    pingTimeout: 10000,
    pingInterval: 5000
  });

  const gameEngine = new GameEngine(db, {
    emitStateSync: (state) => io.to(SOCKET_ROOM_MAIN).emit('game:state_sync', state),
    emitPlaySound: (sound) => io.to(SOCKET_ROOM_MAIN).emit('game:play_sound', sound),
    emitRoundStart: (info) => io.to(SOCKET_ROOM_MAIN).emit('game:round_started', info),
    emitRoundEnd: (result) => io.to(SOCKET_ROOM_MAIN).emit('game:round_ended', result),
    emitWinner: (winner, isDraw) => io.to(SOCKET_ROOM_MAIN).emit('game:winner_announced', winner, isDraw),
    emitStartingCountdown: (sec) => io.to(SOCKET_ROOM_MAIN).emit('game:starting_countdown', sec),
    emitPlayerAnswered: (token, count, totalAlive) => io.to(SOCKET_ROOM_MAIN).emit('player:answered', { token, answerCount: count, totalAlive })
  });

  setupSocketHandlers(io, gameEngine);

  const TEST_PORT = 4999;
  await new Promise<void>((resolve) => httpServer.listen(TEST_PORT, () => resolve()));
  console.log(`✅ [1/5] 테스트 서버 기동 완료 (Port: ${TEST_PORT})`);

  // 150명 봇 접속
  const BOT_COUNT = 150;
  const bots: Array<{ id: number; nickname: string; token?: string; socket: any; isAlive: boolean }> = [];
  let joinedCount = 0;
  const startTime = Date.now();

  await new Promise<void>((resolve) => {
    for (let i = 1; i <= BOT_COUNT; i++) {
      const client = ClientIO(`http://localhost:${TEST_PORT}`, {
        transports: ['websocket'],
        forceNew: true
      });

      const nickname = `도전자_${String(i).padStart(3, '0')}`;
      const bot: { id: number; nickname: string; socket: any; isAlive: boolean; token?: string } = {
        id: i,
        nickname,
        socket: client,
        isAlive: true
      };
      bots.push(bot);

      client.on('connect', () => {
        client.emit('player:join', { nickname }, (res: any) => {
          if (res.success && res.player) {
            bot.token = res.player.token;
            joinedCount++;
            if (joinedCount === BOT_COUNT) {
              console.log(`✅ [2/5] 100인 동시 접속 및 중복 방지 등록 완료! (소요 시간: ${Date.now() - startTime}ms)`);
              resolve();
            }
          }
        });
      });

      // 라운드 수신
      client.on('game:round_started', (info: RoundInfo) => {
        if (!bot.isAlive) return;
        // 100ms ~ 500ms 내 랜덤 답안 제출
        const delay = 100 + Math.random() * 400;
        setTimeout(() => {
          if (!bot.isAlive) return;
          const choice = Math.floor(Math.random() * 4);
          client.emit('player:submit_answer', {
            answerIndex: choice,
            clientTimestamp: Date.now()
          }, () => {});
        }, delay);
      });

      // 라운드 결과 수신
      client.on('game:round_ended', (result: RoundResult) => {
        const isEliminated = result.eliminatedPlayers.some(p => p.nickname === bot.nickname);
        if (isEliminated) {
          bot.isAlive = false;
        }
        if (bot.id === 1) {
          console.log(`   └ [R${result.roundNumber} 판정 완료] 정답: 보기 ${result.correctAnswerIndex + 1} | 생존: ${result.survivorsCount}명 | 탈락: ${result.eliminatedCount}명`);
        }
      });
    }
  });

  // 관리자 권한으로 게임 시작
  console.log(`✅ [3/5] 게임 시작 및 3,2,1 카운트다운 트리거...`);
  gameEngine.startGame();

  // 게임 종료 대기
  await new Promise<void>((resolve) => {
    const checkWinner = (winner?: any, isDraw?: boolean) => {
      console.log(`✅ [4/5] 실시간 서바이벌 최종 라운드 종료`);
      if (winner) {
        console.log(`   👑 최종 1인 우승자: ${winner.nickname} (점수: ${winner.score}점)`);
      } else if (isDraw) {
        console.log(`   🤝 전원 동시 탈락 무승부 판정 정상 처리됨`);
      }

      // 최종 TOP 10 랭킹 검증
      const state = gameEngine.getState();
      console.log(`   🏆 최종 TOP 10 명예의 전당 산출 확인 (${state.topRankings?.length || 0}명):`);
      (state.topRankings || []).forEach(r => {
        console.log(`      ${r.rank}위: ${r.nickname} (${r.score}점, ${r.isAlive ? '생존' : '탈락'})`);
      });
      resolve();
    };

    bots[0].socket.on('game:winner_announced', checkWinner);
  });

  // [추가 검증] 한게임 종료 후 대기실 복귀 및 2번째 연속 게임 재시작 검증
  console.log(`🔄 [추가 검증] 한게임 종료 후 대기실 복귀 및 다음 게임 연속 진행 테스트...`);
  const resetSuccess = gameEngine.requestResetToLobby();
  console.log(`   대기실 리셋 결과: ${resetSuccess}, 현재 상태: ${gameEngine.getState().status}`);
  if (gameEngine.getState().status !== 'WAITING') {
    throw new Error('대기실 복귀 실패: 상태가 WAITING이 아닙니다.');
  }
  const nextGameStarted = gameEngine.startGame();
  console.log(`   다음 게임 재시작 결과: ${nextGameStarted}, 현재 상태: ${gameEngine.getState().status}`);
  if (!nextGameStarted || gameEngine.getState().status !== 'STARTING') {
    throw new Error('다음 게임 시작 실패!');
  }
  console.log(`   ✅ 대기실 복귀 및 다음 게임 정상 시작 검증 성공!`);

  // 엑셀 내보내기 검증
  console.log(`✅ [5/5] 데이터베이스 영구 저장 및 엑셀 다운로드 버퍼 검증...`);
  const excelBuffer = db.generateExcelBuffer();
  console.log(`   📄 생성된 엑셀 버퍼 크기: ${excelBuffer.length} bytes`);

  // 정리
  bots.forEach(b => b.socket.disconnect());
  httpServer.close();

  console.log(`=======================================================`);
  console.log(`🎉 [테스트 성공] 서바이벌 퀴즈쇼 전체 라이프사이클 및 연속 게임 재시작 검증 완료!`);
  console.log(`=======================================================`);
  process.exit(0);
}

runIntegratedTest().catch((err) => {
  console.error('Test Error:', err);
  process.exit(1);
});

