import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  SOCKET_ROOM_MAIN,
  SOCKET_ROOM_ADMIN,
  SOCKET_ROOM_TV,
  ADMIN_PASSWORD
} from '@quiz/shared';
import { GameEngine } from '../game/GameEngine';

export function setupSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  gameEngine: GameEngine
) {
  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    try {
      // 룸 기본 조인
      socket.join(SOCKET_ROOM_MAIN);
      // 현재 최신 게임 상태 및 채팅 기록 즉시 전달
      socket.emit('game:state_sync', gameEngine.getState());
      socket.emit('chat:history', gameEngine.getChatHistory());
    } catch (e) {
      console.error('[Socket Join Error]:', e);
    }

    // 1. 플레이어 참가 및 재접속/복구
    socket.on('player:join', (data, callback) => {
      try {
        if (!data || (!data.nickname && !data.token)) {
          if (callback) callback({ success: false, message: '닉네임을 입력해주세요.' });
          return;
        }
        const result = gameEngine.registerPlayer(socket.id, data.nickname || '', data.token);
        if (callback) callback(result);
      } catch (err: any) {
        console.error('[player:join Error]:', err);
        if (callback) callback({ success: false, message: '접속 처리 중 일시적인 오류가 발생했습니다.' });
      }
    });

    // 1-1. 플레이어 닉네임 수정
    socket.on('player:update_nickname', (data, callback) => {
      try {
        if (!data || !data.token || !data.newNickname) {
          if (callback) callback({ success: false, message: '변경할 닉네임을 입력해주세요.' });
          return;
        }
        const result = gameEngine.updatePlayerNickname(data.token, data.newNickname);
        if (callback) callback(result);
      } catch (err: any) {
        console.error('[player:update_nickname Error]:', err);
        if (callback) callback({ success: false, message: '닉네임 변경 중 오류가 발생했습니다.' });
      }
    });

    // 2. 플레이어 답안 제출 (토큰 기반 자동 인증 복구 지원)
    socket.on('player:submit_answer', (data, callback) => {
      try {
        if (!data || data.answerIndex === undefined) {
          if (callback) callback({ success: false, message: '답안 정보가 올바르지 않습니다.' });
          return;
        }
        const result = gameEngine.submitAnswer(socket.id, data.answerIndex, data.token);
        if (callback) callback(result);
      } catch (err: any) {
        console.error('[player:submit_answer Error]:', err);
        if (callback) callback({ success: false, message: '제출 중 오류가 발생했습니다.' });
      }
    });

    // 2-1. 실시간 채팅 송수신
    socket.on('chat:send', (data, callback) => {
      try {
        if (!data || !data.message) {
          if (callback) callback({ success: false, message: '메시지를 입력해주세요.' });
          return;
        }
        const chat = gameEngine.addChatMessage(socket.id, data.message, data.token);
        if (chat) {
          io.to(SOCKET_ROOM_MAIN).emit('chat:message', chat);
          if (callback) callback({ success: true });
        } else {
          if (callback) callback({ success: false, message: '채팅 전송 실패: 참가 등록이 필요합니다.' });
        }
      } catch (err: any) {
        console.error('[chat:send Error]:', err);
        if (callback) callback({ success: false, message: '채팅 전송 중 오류가 발생했습니다.' });
      }
    });

    // 2-2. 1등 확정 / 무승부 시 대기실 복귀 요청 (GAME_OVER 시에는 관리자 제어 전까지 무시)
    socket.on('game:request_reset', () => {
      try {
        if (gameEngine.getState().status === 'GAME_OVER') {
          console.log('[Notice] GAME_OVER 상태에서는 클라이언트의 개별 복귀 요청으로 게임을 리셋하지 않습니다.');
          return;
        }
        gameEngine.requestResetToLobby();
      } catch (err) {
        console.error('[game:request_reset Error]:', err);
      }
    });

    // 2-4. TV TTS 낭독 완료 또는 타이머로 보기 오픈 요청
    socket.on('round:open_options', () => {
      try {
        gameEngine.openOptionsAndStartTimer();
      } catch (err) {
        console.error('[round:open_options Error]:', err);
      }
    });
    socket.on('player:leave', (data, callback) => {
      try {
        const token = data?.token;
        if (token) {
          gameEngine.removePlayer(token);
        } else {
          gameEngine.handleDisconnect(socket.id);
        }
        if (callback) callback({ success: true });
      } catch (err) {
        console.error('[player:leave Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    // 3. 관리자 비밀번호 인증
    socket.on('admin:auth', (password, callback) => {
      try {
        const currentAdminPw = gameEngine.getDatabase().getAdminPassword();
        if (password === currentAdminPw) {
          socket.join(SOCKET_ROOM_ADMIN);
          if (callback) callback({ success: true });
        } else {
          if (callback) callback({ success: false });
        }
      } catch (err) {
        console.error('[admin:auth Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    // 3-1. 관리자 비밀번호 변경
    socket.on('admin:change_password', (data, callback) => {
      try {
        const db = gameEngine.getDatabase();
        const currentAdminPw = db.getAdminPassword();
        if (!data || !data.currentPassword || !data.newPassword) {
          if (callback) callback({ success: false, message: '현재 비밀번호와 새 비밀번호를 모두 입력해주세요.' });
          return;
        }
        if (data.currentPassword !== currentAdminPw) {
          if (callback) callback({ success: false, message: '현재 비밀번호가 일치하지 않습니다.' });
          return;
        }
        const trimmedNew = (data.newPassword || '').trim();
        if (trimmedNew.length < 4) {
          if (callback) callback({ success: false, message: '새 비밀번호는 최소 4자리 이상이어야 합니다.' });
          return;
        }
        db.setAdminPassword(trimmedNew);
        console.log('🔑 [관리자 비밀번호 변경 완료]');
        if (callback) callback({ success: true, message: '관리자 비밀번호가 성공적으로 변경되었습니다.' });
      } catch (err) {
        console.error('[admin:change_password Error]:', err);
        if (callback) callback({ success: false, message: '비밀번호 변경 처리 중 오류가 발생했습니다.' });
      }
    });

    // 4. 관리자 게임 제어
    socket.on('admin:start_game', (callback) => {
      try {
        const success = gameEngine.startGame();
        if (callback) callback({ success });
      } catch (err) {
        console.error('[admin:start_game Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:pause_game', () => {
      try {
        gameEngine.pauseGame();
      } catch (err) {
        console.error('[admin:pause_game Error]:', err);
      }
    });

    socket.on('admin:resume_game', () => {
      try {
        gameEngine.resumeGame();
      } catch (err) {
        console.error('[admin:resume_game Error]:', err);
      }
    });

    socket.on('admin:skip_round', () => {
      try {
        gameEngine.skipRound();
      } catch (err) {
        console.error('[admin:skip_round Error]:', err);
      }
    });

    socket.on('admin:skip_reading', () => {
      try {
        gameEngine.openOptionsAndStartTimer();
      } catch (err) {
        console.error('[admin:skip_reading Error]:', err);
      }
    });

    socket.on('admin:random_quiz', () => {
      try {
        gameEngine.triggerRandomQuiz();
      } catch (err) {
        console.error('[admin:random_quiz Error]:', err);
      }
    });

    socket.on('admin:kick_player', (token) => {
      try {
        gameEngine.kickPlayer(token);
      } catch (err) {
        console.error('[admin:kick_player Error]:', err);
      }
    });

    socket.on('admin:reset_game', () => {
      try {
        gameEngine.resetGame();
      } catch (err) {
        console.error('[admin:reset_game Error]:', err);
      }
    });

    socket.on('admin:clear_all_players', (callback) => {
      try {
        gameEngine.clearAllPlayers();
        io.to(SOCKET_ROOM_MAIN).emit('game:player_kicked_all');
        if (callback) callback({ success: true });
      } catch (err) {
        console.error('[admin:clear_all_players Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:move_to_lobby', (callback) => {
      try {
        gameEngine.resetGame();
        if (callback) callback({ success: true });
      } catch (err) {
        console.error('[admin:move_to_lobby Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    // 4-2. 관리자 대기실 QR 코드 실시간 갱신 요청
    socket.on('admin:regenerate_qr', (callback) => {
      try {
        const sessionToken = gameEngine.regenerateQrSession();
        io.to(SOCKET_ROOM_MAIN).emit('game:qr_updated', {
          sessionToken,
          timestamp: Date.now()
        });
        console.log(`[Admin] Lobby QR code regenerated: session=${sessionToken}`);
        if (callback) callback({ success: true, sessionToken });
      } catch (err) {
        console.error('[admin:regenerate_qr Error]:', err);
        if (callback) callback({ success: false, sessionToken: '' });
      }
    });

    // 4-3. 관리자 대기실 QR 모드 변경 요청 (사내 Wi-Fi vs 외부 공인/LTE)
    socket.on('admin:change_qr_mode', (data, callback) => {
      try {
        const mode = data?.mode === 'WIFI' ? 'WIFI' : 'EXTERNAL';
        gameEngine.setQrMode(mode);
        console.log(`[Admin] Lobby QR mode changed to: ${mode}`);
        if (callback) callback({ success: true, mode });
      } catch (err) {
        console.error('[admin:change_qr_mode Error]:', err);
        if (callback) callback({ success: false, mode: 'EXTERNAL' });
      }
    });

    socket.on('admin:chat_clear', (callback) => {
      try {
        gameEngine.clearChatHistory();
        io.to(SOCKET_ROOM_MAIN).emit('chat:cleared');
        console.log('[Admin] Chat cleared broadcasted to all clients');
        if (callback) callback({ success: true });
      } catch (err) {
        console.error('[admin:chat_clear Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:change_audio_settings', (audioSettings, callback) => {
      try {
        const updatePayload: any = { ...audioSettings };
        if (audioSettings.isMuted !== undefined) {
          updatePayload.bgmEnabled = !audioSettings.isMuted;
          updatePayload.isMuted = audioSettings.isMuted;
        } else if (audioSettings.bgmEnabled !== undefined) {
          updatePayload.isMuted = !audioSettings.bgmEnabled;
        }
        gameEngine.updateSettings(updatePayload);
        if (callback) callback({ success: true });
      } catch (err) {
        console.error('[admin:change_audio_settings Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:update_settings', (settings) => {
      try {
        const updatePayload: any = { ...settings };
        if (settings.isMuted !== undefined && settings.bgmEnabled === undefined) {
          updatePayload.bgmEnabled = !settings.isMuted;
        } else if (settings.bgmEnabled !== undefined && settings.isMuted === undefined) {
          updatePayload.isMuted = !settings.bgmEnabled;
        }
        gameEngine.updateSettings(updatePayload);
      } catch (err) {
        console.error('[admin:update_settings Error]:', err);
      }
    });

    socket.on('admin:play_sound', (soundType) => {
      try {
        io.to(SOCKET_ROOM_MAIN).emit('game:play_sound', soundType);
      } catch (err) {
        console.error('[admin:play_sound Error]:', err);
      }
    });

    // 5. 관리자 문제은행 관리
    socket.on('admin:quiz:add', (quizData, callback) => {
      try {
        const db = gameEngine.getDatabase();
        const newQuiz = db.addQuiz(quizData);
        if (callback) callback({ success: true, quiz: newQuiz });
        gameEngine.syncState();
      } catch (err) {
        console.error('[admin:quiz:add Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:quiz:update', (quiz, callback) => {
      try {
        const db = gameEngine.getDatabase();
        const success = db.updateQuiz(quiz);
        if (callback) callback({ success });
        gameEngine.syncState();
      } catch (err) {
        console.error('[admin:quiz:update Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:quiz:delete', (id, callback) => {
      try {
        const db = gameEngine.getDatabase();
        const success = db.deleteQuiz(id);
        if (callback) callback({ success });
        gameEngine.syncState();
      } catch (err) {
        console.error('[admin:quiz:delete Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:quiz:toggle_approve', (id, callback) => {
      try {
        const db = gameEngine.getDatabase();
        const success = db.toggleApprove(id);
        if (callback) callback({ success });
        gameEngine.syncState();
      } catch (err) {
        console.error('[admin:quiz:toggle_approve Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    // 6. 연결 해제
    socket.on('disconnect', () => {
      try {
        gameEngine.handleDisconnect(socket.id);
      } catch (err) {
        console.error('[disconnect Error]:', err);
      }
    });
  });
}
