import { useEffect, useState } from 'react';
import { socket } from './socket';
import { GameState, ALL_QUIZ_CATEGORIES, ChannelId, normalizeChannel } from '@quiz/shared';
import { PlayerView } from './views/PlayerView';
import { TvView } from './views/TvView';
import { AdminView } from './views/AdminView';

export default function App() {
  const [channel, setChannel] = useState<ChannelId>(() => {
    return normalizeChannel(new URLSearchParams(window.location.search).get('ch'));
  });

  const [gameState, setGameState] = useState<GameState>({
    channel: normalizeChannel(new URLSearchParams(window.location.search).get('ch')),
    gameId: '',
    status: 'WAITING',
    currentRound: 0,
    totalRounds: 5,
    players: [],
    survivors: [],
    settings: {
      maxPlayers: 300,
      isSoundEnabled: true,
      bgmEnabled: true,
      ttsEnabled: true,
      isMuted: false,
      bgmVolume: 1.0,
      tickVolume: 1.0,
      autoProgress: true,
      questionTimeLimit: 15,
      stageTimeLimits: { 1: 15, 2: 15, 3: 15, 4: 15, 5: 15 },
      selectedCategories: [...ALL_QUIZ_CATEGORIES]
    }
  });

  const [path, setPath] = useState(window.location.pathname);

  // 채널 전환 핸들러 (마스터 관리자 또는 UI 채널 선택 시 호출)
  const handleChannelChange = (newCh: ChannelId) => {
    setChannel(newCh);
    const url = new URL(window.location.href);
    url.searchParams.set('ch', newCh.replace('ch', ''));
    window.history.pushState({}, '', url.toString());

    socket.emit('channel:join', { channel: newCh }, (res) => {
      if (res && res.state) {
        setGameState(res.state);
      }
    });
  };

  useEffect(() => {
    document.title = '서바이벌 퀴즈쇼';
    const initialCh = normalizeChannel(new URLSearchParams(window.location.search).get('ch'));
    setChannel(initialCh);

    socket.connect();
    socket.emit('channel:join', { channel: initialCh });

    socket.on('game:state_sync', (state) => {
      setGameState(state);
    });

    const handlePopState = () => {
      setPath(window.location.pathname);
      const ch = normalizeChannel(new URLSearchParams(window.location.search).get('ch'));
      setChannel(ch);
      socket.emit('channel:join', { channel: ch });
    };
    window.addEventListener('popstate', handlePopState);

    // 모바일 브라우저 닫기/새로고침 시 소켓 즉시 정리
    const handleUnload = () => {
      const token = localStorage.getItem(`quiz_survival_player_token_${initialCh}`) || localStorage.getItem('quiz_survival_player_token');
      if (token) {
        try {
          socket.emit('player:leave', { token });
          socket.disconnect();
        } catch {}
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      socket.off('game:state_sync');
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      socket.disconnect();
    };
  }, []);

  // 라우팅 분기
  if (path.startsWith('/tv')) {
    return <TvView gameState={gameState} channel={channel} />;
  }

  if (path.startsWith('/admin')) {
    return <AdminView gameState={gameState} channel={channel} onChannelChange={handleChannelChange} />;
  }

  // 기본 경로는 모바일 참가자 뷰
  return <PlayerView gameState={gameState} channel={channel} onChannelChange={handleChannelChange} />;
}
