import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '@quiz/shared';

// 스마트폰 접속 시 3000번 포트의 프록시를 통해 4000번 소켓 서버와 연결 (방화벽 및 단일 포트 호환)
const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL || window.location.origin;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
  timeout: 30000
});
