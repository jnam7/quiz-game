import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import os from 'os';
import path from 'path';
import fs from 'fs';
import events from 'events';
import { spawn, ChildProcess } from 'child_process';

// 150인 이상 동시 접속 시 리스너 초과 경고 방지 및 메모리 보호
events.EventEmitter.defaultMaxListeners = 250;
import {
  ClientToServerEvents,
  ServerToClientEvents,
  SOCKET_ROOM_MAIN
} from '@quiz/shared';
import { JsonDatabase } from './db/Database';
import { GameEngine } from './game/GameEngine';
import { setupSocketHandlers } from './socket';

// 전역 예외 방어: 어떤 예기치 않은 오류가 발생해도 서버 프로세스가 절대 죽지 않도록 방어
process.on('uncaughtException', (err) => {
  console.error('🛡️ [SERVER CRASH SHIELD] Uncaught Exception 방어됨:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [SERVER CRASH SHIELD] Unhandled Rejection 방어됨:', reason);
});

const app = express();
const port = Number(process.env.PORT) || 4000;
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
let publicTunnelUrl = '';
let sshProcess: ChildProcess | null = null;
let isReconnectingTunnel = false;

// 1. Render 및 클라우드 즉시 응답 헬스체크 라우트 (최상단 배치)
app.get('/healthz', (req, res) => res.status(200).send('OK'));
app.get('/health', (req, res) => res.status(200).send('OK'));

app.use(cors({ origin: '*' }));
app.use(express.json());

// 프론트엔드 빌드 정적 파일 서빙 지원 (단일 포트 통합 서빙)
const candidateDistPaths = [
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(process.cwd(), 'packages/client/dist'),
  path.resolve(__dirname, '../../../packages/client/dist')
];
const clientDistPath = candidateDistPaths.find(p => fs.existsSync(p)) || candidateDistPaths[0];
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  console.log(`📦 [정적 파일 서빙] 클라이언트 빌드 폴더 연결됨: ${clientDistPath}`);
} else {
  console.warn(`⚠️ [정적 파일 서빙] 클라이언트 dist 폴더가 존재하지 않습니다: ${clientDistPath}`);
}

// 데이터베이스 및 게임 엔진 인스턴스
const database = new JsonDatabase();
const httpServer = http.createServer(app);

// 고신뢰성 Socket.io 설정 (150인 동시 접속 최적화 & 초고속 브로드캐스트 & 모바일 네트워크 순단 방지)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,   // 모바일 화면 슬립/네트워크 전환 시 불필요한 끊김 방지
  pingInterval: 25000,
  connectTimeout: 45000,
  maxHttpBufferSize: 2e7,
  perMessageDeflate: false, // 150인 동시 브로드캐스트 시 CPU 압축 오버헤드 원천 제거
  allowEIO3: true
});

const gameEngine = new GameEngine(database, {
  emitStateSync: (state) => {
    try { io.to(SOCKET_ROOM_MAIN).emit('game:state_sync', state); } catch (e) { console.error(e); }
  },
  emitPlaySound: (sound) => {
    try { io.to(SOCKET_ROOM_MAIN).emit('game:play_sound', sound); } catch (e) { console.error(e); }
  },
  emitRoundStart: (info) => {
    try { io.to(SOCKET_ROOM_MAIN).emit('game:round_started', info); } catch (e) { console.error(e); }
  },
  emitRoundEnd: (result) => {
    try { io.to(SOCKET_ROOM_MAIN).emit('game:round_ended', result); } catch (e) { console.error(e); }
  },
  emitWinner: (winner, isDraw) => {
    try { io.to(SOCKET_ROOM_MAIN).emit('game:winner_announced', winner, isDraw); } catch (e) { console.error(e); }
  },
  emitStartingCountdown: (seconds) => {
    try { io.to(SOCKET_ROOM_MAIN).emit('game:starting_countdown', seconds); } catch (e) { console.error(e); }
  },
  emitPlayerAnswered: (token, count, totalAlive) => {
    try { io.to(SOCKET_ROOM_MAIN).emit('player:answered', { token, answerCount: count, totalAlive }); } catch (e) { console.error(e); }
  },
  emitForceLobby: () => {
    try { io.to(SOCKET_ROOM_MAIN).emit('game:force_lobby'); } catch (e) { console.error(e); }
  }
});

setupSocketHandlers(io, gameEngine);

// Render 및 외부 배포 환경 감지 헬퍼 함수
function getEffectivePublicUrl(req?: express.Request): string {
  if (publicTunnelUrl) return publicTunnelUrl;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (req && req.headers && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    return `${proto}://${req.headers.host}`;
  }
  return '';
}

// 1. 상태 확인 API
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: isProduction ? 'production' : 'development',
    gameStatus: gameEngine.getState().status,
    totalPlayers: gameEngine.getState().players.length,
    publicUrl: getEffectivePublicUrl(req) || null,
    timestamp: new Date().toISOString()
  });
});

// 2. 문제 목록 조회 API
app.get('/api/quizzes', (req, res) => {
  try {
    const onlyApproved = req.query.approved === 'true';
    const quizzes = database.getQuizzes(onlyApproved);
    res.json({ total: quizzes.length, quizzes });
  } catch (err) {
    res.status(500).json({ error: '문제 목록 조회 중 오류 발생' });
  }
});

// 3. 엑셀 결과 다운로드 API
app.get('/api/export-excel', (req, res) => {
  try {
    const gameId = req.query.gameId as string | undefined;
    const buffer = database.generateExcelBuffer(gameId);
    const filename = `100_quiz_result_${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Excel Export Error:', err);
    res.status(500).json({ error: '엑셀 파일 생성 중 오류가 발생했습니다.' });
  }
});

// 4. 로컬 IP 주소 반환 API (스마트폰 접속 QR코드 생성용)
function getLocalNetworkIp(): string {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch {}
  return 'localhost';
}

app.get('/api/server-info', (req, res) => {
  res.json({
    localIp: getLocalNetworkIp(),
    clientPort: port,
    serverPort: port,
    publicUrl: getEffectivePublicUrl(req) || null
  });
});

// SPA 라우팅 지원 (HTML5 History API fallback)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path === '/healthz' || req.path === '/health') {
    return next();
  }
  const indexPath = path.join(clientDistPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // clientDistPath가 없더라도 서버가 죽지 않고 기본 HTML 응답을 제공
    res.status(200).send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CMB 150인 서바이벌 퀴즈</title>
</head>
<body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: white;">
  <h1>CMB 서바이벌 퀴즈 서버 정상 가동 중</h1>
  <p>클라이언트 dist 빌드가 진행 중이거나 준비되지 않았습니다. 잠시 후 새로고침해 주세요.</p>
</body>
</html>`);
  }
});

// Express 전역 에러 핸들러
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Express Request Error:', err);
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
});

// --- 고가용성 자동 재연결 터널 매니저 (로컬 개발 환경 전용) ---
function connectTunnel(targetPort: number) {
  // Render 등 프로덕션/배포 환경에서는 SSH 터널 완전 비활성화
  if (isProduction) return;
  if (isReconnectingTunnel) return;
  isReconnectingTunnel = true;

  if (sshProcess) {
    try {
      sshProcess.kill('SIGKILL');
    } catch {}
    sshProcess = null;
  }

  console.log('🔄 [로컬 터널 연결 및 복구 시도 중...]');
  try {
    const child = spawn('ssh', [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=NUL',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=120',
      '-o', 'TCPKeepAlive=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-R', `80:127.0.0.1:${targetPort}`,
      'serveo.net'
    ]);
    sshProcess = child;

    const handleOutput = (data: Buffer) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.serveousercontent\.com/);
      if (match) {
        const newUrl = match[0];
        if (publicTunnelUrl !== newUrl) {
          publicTunnelUrl = newUrl;
          console.log(`=======================================================`);
          console.log(`🌍 [외부 공인 접속 주소 (LTE/5G) 정상 연결됨]:`);
          console.log(`👉 ${publicTunnelUrl}`);
          console.log(`=======================================================`);
          try {
            io.to(SOCKET_ROOM_MAIN).emit('server:tunnel_updated', publicTunnelUrl);
          } catch {}
        }
      }
    };

    child.stdout.on('data', handleOutput);
    child.stderr.on('data', handleOutput);

    child.on('error', (err) => {
      console.warn('⚠️ [터널 프로세스 오류]:', err.message);
      scheduleTunnelReconnect(targetPort);
    });

    child.on('close', (code) => {
      console.warn(`⚠️ [터널 연결 닫힘 (code: ${code})] 3초 후 자동 재접속합니다...`);
      scheduleTunnelReconnect(targetPort);
    });

    // 10초 후 재접속 락 해제
    setTimeout(() => {
      isReconnectingTunnel = false;
    }, 10000);
  } catch (err: any) {
    console.error('터널 프로세스 생성 실패:', err.message);
    scheduleTunnelReconnect(targetPort);
  }
}

function scheduleTunnelReconnect(targetPort: number) {
  if (isProduction) return;
  sshProcess = null;
  isReconnectingTunnel = false;
  setTimeout(() => {
    connectTunnel(targetPort);
  }, 3000);
}

// 30초 주기 터널 생존 감시 헬스체크 데몬 (로컬 개발 환경 전용)
if (!isProduction) {
  setInterval(() => {
    if (!sshProcess || sshProcess.killed) {
      console.log('🔍 [헬스체크] 터널 프로세스 재기동 필요 감지');
      connectTunnel(port);
    }
  }, 30000);
}

// 프로세스 종료 시 안전하게 정리
process.on('SIGINT', () => {
  if (sshProcess) {
    try { sshProcess.kill(); } catch {}
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (sshProcess) {
    try { sshProcess.kill(); } catch {}
  }
  process.exit(0);
});

httpServer.listen(port, '0.0.0.0', () => {
  const localIp = getLocalNetworkIp();
  console.log(`=======================================================`);
  console.log(`🚀 [CMB 150인 서바이벌 퀴즈 서버 - ${isProduction ? 'Render 프로덕션 배포 모드' : '로컬 개발 모드'} 가동]`);
  console.log(`📡 포트: ${port}`);
  console.log(`🖥️ 대형 TV 화면:    http://localhost:${port}/tv`);
  console.log(`🛠️ 관리자 대시보드:  http://localhost:${port}/admin`);
  if (!isProduction) {
    console.log(`📱 스마트폰 (사내 Wi-Fi): http://${localIp}:${port}/`);
    console.log(`⏳ 외부 접속(LTE/5G)용 자동 복구 HTTPS 터널 시작 중...`);
    connectTunnel(port);
  } else {
    console.log(`🌐 [Render.com 배포 완료] 웹 서비스 및 실시간 소켓이 준비되었습니다.`);
    if (process.env.RENDER_EXTERNAL_URL) {
      console.log(`👉 서비스 공인 URL: ${process.env.RENDER_EXTERNAL_URL}`);
    }
  }
  console.log(`=======================================================`);
});
