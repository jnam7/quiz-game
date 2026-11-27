import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  SOCKET_ROOM_ADMIN,
  CHANNELS,
  ChannelId,
  ChannelSummary,
  CHANNEL_NAMES,
  normalizeChannel,
  getChannelRoom,
  AdminRole,
  GameState
} from '@quiz/shared';
import { GameEngine } from '../game/GameEngine';
import { JsonDatabase } from '../db/Database';

export function setupSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  gameEnginesOrSingle: Map<ChannelId, GameEngine> | GameEngine,
  db?: JsonDatabase
) {
  let gameEngines: Map<ChannelId, GameEngine>;
  let database: JsonDatabase;

  if (gameEnginesOrSingle instanceof GameEngine) {
    gameEngines = new Map<ChannelId, GameEngine>();
    for (const ch of CHANNELS) {
      gameEngines.set(ch, gameEnginesOrSingle);
    }
    database = db || gameEnginesOrSingle.getDatabase();
  } else {
    gameEngines = gameEnginesOrSingle;
    database = db || gameEngines.get('ch1')!.getDatabase();
  }
  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    try {
      // 1. 소켓 연결 시 쿼리 파라미터(?ch=1~5) 기반 채널 확인 및 룸 조인
      const initialCh = normalizeChannel(socket.handshake.query.ch as string | undefined);
      socket.data.channel = initialCh;
      const room = getChannelRoom(initialCh);
      socket.join(room);

      const engine = gameEngines.get(initialCh) || gameEngines.get('ch1')!;
      // 현재 채널 최신 게임 상태 및 채팅 기록 전달
      socket.emit('game:state_sync', { ...engine.getState(), channel: initialCh });
      socket.emit('chat:history', engine.getChatHistory());
    } catch (e) {
      console.error('[Socket Join Error]:', e);
    }

    // 0. 채널 전환 (플레이어 또는 마스터 관리자)
    socket.on('channel:join', (data, callback) => {
      try {
        const targetCh = normalizeChannel(data?.channel);
        const oldCh = (socket.data.channel || 'ch1') as ChannelId;
        socket.leave(getChannelRoom(oldCh));
        socket.join(getChannelRoom(targetCh));
        socket.data.channel = targetCh;

        const engine = gameEngines.get(targetCh) || gameEngines.get('ch1')!;
        const state: GameState = { ...engine.getState(), channel: targetCh };
        socket.emit('game:state_sync', state);
        socket.emit('chat:history', engine.getChatHistory());
        if (callback) callback({ success: true, channel: targetCh, state });
      } catch (err: any) {
        console.error('[channel:join Error]:', err);
        if (callback) callback({ success: false, channel: 'ch1' });
      }
    });

    // 채널 엔진 조회 헬퍼 (일반 클라이언트용)
    const getClientEngine = (): { engine: GameEngine; channel: ChannelId } => {
      const ch = (socket.data.channel || 'ch1') as ChannelId;
      const engine = gameEngines.get(ch) || gameEngines.get('ch1')!;
      return { engine, channel: ch };
    };

    // 관리자 권한 검증 및 엔진 조회 헬퍼 (타 채널 제어 차단)
    const getAuthorizedEngine = (targetChannel?: string): { engine: GameEngine; channel: ChannelId } | null => {
      const ch = normalizeChannel(targetChannel || socket.data.channel);
      const role = socket.data.adminRole as AdminRole | undefined;
      const allowed = socket.data.allowedChannels as ChannelId[] | undefined;

      if (!role || !allowed) {
        return null;
      }
      if (role === 'MASTER' || allowed.includes(ch)) {
        const engine = gameEngines.get(ch);
        if (engine) return { engine, channel: ch };
      }
      return null;
    };

    // 1. 플레이어 참가 및 재접속/복구
    socket.on('player:join', (data, callback) => {
      try {
        if (!data || (!data.nickname && !data.token)) {
          if (callback) callback({ success: false, message: '닉네임을 입력해주세요.' });
          return;
        }
        const { engine } = getClientEngine();
        const result = engine.registerPlayer(socket.id, data.nickname || '', data.token);
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
        const { engine } = getClientEngine();
        const result = engine.updatePlayerNickname(data.token, data.newNickname);
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
        const { engine } = getClientEngine();
        const result = engine.submitAnswer(socket.id, data.answerIndex, data.token);
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
        const { engine, channel } = getClientEngine();
        const chat = engine.addChatMessage(socket.id, data.message, data.token);
        if (chat) {
          io.to(getChannelRoom(channel)).emit('chat:message', chat);
          if (callback) callback({ success: true });
        } else {
          if (callback) callback({ success: false, message: '채팅 전송 실패: 참가 등록이 필요합니다.' });
        }
      } catch (err: any) {
        console.error('[chat:send Error]:', err);
        if (callback) callback({ success: false, message: '채팅 전송 중 오류가 발생했습니다.' });
      }
    });

    // 2-2. 1등 확정 / 무승부 시 대기실 복귀 요청
    socket.on('game:request_reset', () => {
      try {
        const { engine } = getClientEngine();
        if (engine.getState().status === 'GAME_OVER') {
          console.log('[Notice] GAME_OVER 상태에서는 클라이언트의 개별 복귀 요청으로 게임을 리셋하지 않습니다.');
          return;
        }
        engine.requestResetToLobby();
      } catch (err) {
        console.error('[game:request_reset Error]:', err);
      }
    });

    // 2-4. TV TTS 낭독 완료 또는 타이머로 보기 오픈 요청
    socket.on('round:open_options', () => {
      try {
        const { engine } = getClientEngine();
        engine.openOptionsAndStartTimer();
      } catch (err) {
        console.error('[round:open_options Error]:', err);
      }
    });

    socket.on('player:leave', (data, callback) => {
      try {
        const { engine } = getClientEngine();
        const token = data?.token;
        if (token) {
          engine.removePlayer(token);
        } else {
          engine.handleDisconnect(socket.id);
        }
        if (callback) callback({ success: true });
      } catch (err) {
        console.error('[player:leave Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    // 3. 관리자 비밀번호 인증 (채널별 비밀번호 + 마스터 비밀번호)
    socket.on('admin:auth', (payload, callback) => {
      try {
        let password = '';
        let targetChannel: ChannelId = (socket.data.channel || 'ch1') as ChannelId;
        if (typeof payload === 'string') {
          password = payload;
        } else if (payload && typeof payload === 'object') {
          password = payload.password || '';
          if (payload.channel) {
            targetChannel = normalizeChannel(payload.channel);
          }
        }

        const masterPw = database.getMasterPassword();
        const channelPw = database.getChannelPassword(targetChannel);

        if (password && password === masterPw) {
          socket.data.adminRole = 'MASTER';
          socket.data.allowedChannels = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'];
          socket.join(SOCKET_ROOM_ADMIN);
          if (callback) {
            callback({
              success: true,
              role: 'MASTER',
              allowedChannels: ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'],
              currentChannel: targetChannel
            });
          }
        } else if (password && password === channelPw) {
          socket.data.adminRole = 'CHANNEL';
          socket.data.allowedChannels = [targetChannel];
          socket.join(SOCKET_ROOM_ADMIN);
          if (callback) {
            callback({
              success: true,
              role: 'CHANNEL',
              allowedChannels: [targetChannel],
              currentChannel: targetChannel
            });
          }
        } else {
          if (callback) callback({ success: false, message: '비밀번호가 올바르지 않습니다.' });
        }
      } catch (err) {
        console.error('[admin:auth Error]:', err);
        if (callback) callback({ success: false, message: '인증 처리 중 오류가 발생했습니다.' });
      }
    });

    // 3-1. 관리자 비밀번호 변경
    socket.on('admin:change_password', (data, callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (!auth) {
          if (callback) callback({ success: false, message: '관리자 인증이 필요합니다.' });
          return;
        }
        const currentMasterPw = database.getMasterPassword();
        if (!data || !data.currentPassword || !data.newPassword) {
          if (callback) callback({ success: false, message: '현재 비밀번호와 새 비밀번호를 모두 입력해주세요.' });
          return;
        }
        if (socket.data.adminRole === 'MASTER') {
          if (data.currentPassword !== currentMasterPw) {
            if (callback) callback({ success: false, message: '현재 마스터 비밀번호가 일치하지 않습니다.' });
            return;
          }
          const trimmedNew = (data.newPassword || '').trim();
          if (trimmedNew.length < 4) {
            if (callback) callback({ success: false, message: '새 비밀번호는 최소 4자리 이상이어야 합니다.' });
            return;
          }
          database.setAdminPassword(trimmedNew);
          if (callback) callback({ success: true, message: '마스터 관리자 비밀번호가 성공적으로 변경되었습니다.' });
        } else {
          const currentChPw = database.getChannelPassword(auth.channel);
          if (data.currentPassword !== currentChPw && data.currentPassword !== currentMasterPw) {
            if (callback) callback({ success: false, message: '현재 채널 비밀번호가 일치하지 않습니다.' });
            return;
          }
          const trimmedNew = (data.newPassword || '').trim();
          if (trimmedNew.length < 4) {
            if (callback) callback({ success: false, message: '새 비밀번호는 최소 4자리 이상이어야 합니다.' });
            return;
          }
          database.setChannelPassword(auth.channel, trimmedNew);
          if (callback) callback({ success: true, message: `${CHANNEL_NAMES[auth.channel]} 비밀번호가 성공적으로 변경되었습니다.` });
        }
      } catch (err) {
        console.error('[admin:change_password Error]:', err);
        if (callback) callback({ success: false, message: '비밀번호 변경 처리 중 오류가 발생했습니다.' });
      }
    });

    // 3-2. 전체 5개 채널 종합 상태 조회 (마스터 관리자 전용)
    socket.on('admin:get_all_channels_status', (callback) => {
      try {
        if (socket.data.adminRole !== 'MASTER') {
          if (callback) callback({ success: false, message: '마스터 권한이 필요합니다.' });
          return;
        }
        const statuses: Record<ChannelId, ChannelSummary> = {} as any;
        for (const ch of CHANNELS) {
          const eng = gameEngines.get(ch)!;
          const st = eng.getState();
          statuses[ch] = {
            channel: ch,
            name: CHANNEL_NAMES[ch],
            status: st.status,
            playerCount: st.players.length,
            survivorCount: st.survivors.length,
            currentRound: st.currentRound,
            totalRounds: st.totalRounds,
            winner: st.winner?.nickname || null
          };
        }
        if (callback) callback({ success: true, channels: statuses });
      } catch (err: any) {
        console.error('[admin:get_all_channels_status Error]:', err);
        if (callback) callback({ success: false, message: err.message });
      }
    });

    // 4. 관리자 게임 제어 (타 채널 제어 차단)
    socket.on('admin:start_game', (callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (!auth) {
          if (callback) callback({ success: false });
          return;
        }
        const success = auth.engine.startGame();
        if (callback) callback({ success });
      } catch (err) {
        console.error('[admin:start_game Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:pause_game', () => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) auth.engine.pauseGame();
      } catch (err) {
        console.error('[admin:pause_game Error]:', err);
      }
    });

    socket.on('admin:resume_game', () => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) auth.engine.resumeGame();
      } catch (err) {
        console.error('[admin:resume_game Error]:', err);
      }
    });

    socket.on('admin:skip_round', () => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) auth.engine.skipRound();
      } catch (err) {
        console.error('[admin:skip_round Error]:', err);
      }
    });

    socket.on('admin:skip_reading', () => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) auth.engine.openOptionsAndStartTimer();
      } catch (err) {
        console.error('[admin:skip_reading Error]:', err);
      }
    });

    socket.on('admin:random_quiz', () => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) auth.engine.triggerRandomQuiz();
      } catch (err) {
        console.error('[admin:random_quiz Error]:', err);
      }
    });

    socket.on('admin:kick_player', (token) => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) auth.engine.kickPlayer(token);
      } catch (err) {
        console.error('[admin:kick_player Error]:', err);
      }
    });

    socket.on('admin:reset_game', () => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) auth.engine.resetGame();
      } catch (err) {
        console.error('[admin:reset_game Error]:', err);
      }
    });

    socket.on('admin:clear_all_players', (callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) {
          auth.engine.clearAllPlayers();
          io.to(getChannelRoom(auth.channel)).emit('game:player_kicked_all');
          if (callback) callback({ success: true });
        } else {
          if (callback) callback({ success: false });
        }
      } catch (err) {
        console.error('[admin:clear_all_players Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:move_to_lobby', (callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) {
          auth.engine.resetGame();
          if (callback) callback({ success: true });
        } else {
          if (callback) callback({ success: false });
        }
      } catch (err) {
        console.error('[admin:move_to_lobby Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    // 4-2. 관리자 대기실 QR 코드 실시간 갱신 요청
    socket.on('admin:regenerate_qr', (callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) {
          const sessionToken = auth.engine.regenerateQrSession();
          io.to(getChannelRoom(auth.channel)).emit('game:qr_updated', {
            sessionToken,
            timestamp: Date.now()
          });
          console.log(`[Admin] Lobby QR code regenerated for ${auth.channel}: session=${sessionToken}`);
          if (callback) callback({ success: true, sessionToken });
        } else {
          if (callback) callback({ success: false, sessionToken: '' });
        }
      } catch (err) {
        console.error('[admin:regenerate_qr Error]:', err);
        if (callback) callback({ success: false, sessionToken: '' });
      }
    });

    // 4-3. 관리자 대기실 QR 모드 변경 요청 (사내 Wi-Fi vs 외부 공인/LTE)
    socket.on('admin:change_qr_mode', (data, callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) {
          const mode = data?.mode === 'WIFI' ? 'WIFI' : 'EXTERNAL';
          auth.engine.setQrMode(mode);
          console.log(`[Admin] Lobby QR mode changed for ${auth.channel} to: ${mode}`);
          if (callback) callback({ success: true, mode });
        } else {
          if (callback) callback({ success: false, mode: 'EXTERNAL' });
        }
      } catch (err) {
        console.error('[admin:change_qr_mode Error]:', err);
        if (callback) callback({ success: false, mode: 'EXTERNAL' });
      }
    });

    socket.on('admin:chat_clear', (callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) {
          auth.engine.clearChatHistory();
          io.to(getChannelRoom(auth.channel)).emit('chat:cleared');
          if (callback) callback({ success: true });
        } else {
          if (callback) callback({ success: false });
        }
      } catch (err) {
        console.error('[admin:chat_clear Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:change_audio_settings', (audioSettings, callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) {
          const updatePayload: any = { ...audioSettings };
          if (audioSettings.isMuted !== undefined) {
            updatePayload.bgmEnabled = !audioSettings.isMuted;
            updatePayload.isMuted = audioSettings.isMuted;
          } else if (audioSettings.bgmEnabled !== undefined) {
            updatePayload.isMuted = !audioSettings.bgmEnabled;
          }
          auth.engine.updateSettings(updatePayload);
          if (callback) callback({ success: true });
        } else {
          if (callback) callback({ success: false });
        }
      } catch (err) {
        console.error('[admin:change_audio_settings Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:update_settings', (settings) => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) {
          const updatePayload: any = { ...settings };
          if (settings.isMuted !== undefined && settings.bgmEnabled === undefined) {
            updatePayload.bgmEnabled = !settings.isMuted;
          } else if (settings.bgmEnabled !== undefined && settings.isMuted === undefined) {
            updatePayload.isMuted = !settings.bgmEnabled;
          }
          auth.engine.updateSettings(updatePayload);
        }
      } catch (err) {
        console.error('[admin:update_settings Error]:', err);
      }
    });

    socket.on('admin:play_sound', (soundType) => {
      try {
        const auth = getAuthorizedEngine();
        if (auth) {
          io.to(getChannelRoom(auth.channel)).emit('game:play_sound', soundType);
        }
      } catch (err) {
        console.error('[admin:play_sound Error]:', err);
      }
    });

    // 5. 관리자 문제은행 관리 (공용 DB)
    socket.on('admin:quiz:add', (quizData, callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (!auth) {
          if (callback) callback({ success: false });
          return;
        }
        const db = auth.engine.getDatabase();
        const newQuiz = db.addQuiz(quizData);
        if (callback) callback({ success: true, quiz: newQuiz });
        // 모든 채널 상태 동기화
        for (const eng of gameEngines.values()) {
          eng.syncState();
        }
      } catch (err) {
        console.error('[admin:quiz:add Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:quiz:update', (quiz, callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (!auth) {
          if (callback) callback({ success: false });
          return;
        }
        const db = auth.engine.getDatabase();
        const success = db.updateQuiz(quiz);
        if (callback) callback({ success });
        for (const eng of gameEngines.values()) {
          eng.syncState();
        }
      } catch (err) {
        console.error('[admin:quiz:update Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:quiz:delete', (id, callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (!auth) {
          if (callback) callback({ success: false });
          return;
        }
        const db = auth.engine.getDatabase();
        const success = db.deleteQuiz(id);
        if (callback) callback({ success });
        for (const eng of gameEngines.values()) {
          eng.syncState();
        }
      } catch (err) {
        console.error('[admin:quiz:delete Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    socket.on('admin:quiz:toggle_approve', (id, callback) => {
      try {
        const auth = getAuthorizedEngine();
        if (!auth) {
          if (callback) callback({ success: false });
          return;
        }
        const db = auth.engine.getDatabase();
        const success = db.toggleApprove(id);
        if (callback) callback({ success });
        for (const eng of gameEngines.values()) {
          eng.syncState();
        }
      } catch (err) {
        console.error('[admin:quiz:toggle_approve Error]:', err);
        if (callback) callback({ success: false });
      }
    });

    // 6. 연결 해제
    socket.on('disconnect', () => {
      try {
        const ch = (socket.data.channel || 'ch1') as ChannelId;
        const engine = gameEngines.get(ch);
        if (engine) engine.handleDisconnect(socket.id);
      } catch (err) {
        console.error('[disconnect Error]:', err);
      }
    });
  });
}
