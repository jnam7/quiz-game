import { useEffect, useState } from 'react';
import { socket } from './socket';
import { GameState, ALL_QUIZ_CATEGORIES, ChannelId, normalizeChannel } from '@quiz/shared';
import { PlayerView } from './views/PlayerView';
import { TvView } from './views/TvView';
import { AdminView } from './views/AdminView';

const getInitialChannel = (): ChannelId => {
  const urlCh = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ch') : null;
  if (urlCh) return normalizeChannel(urlCh);
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('quiz_player_session') : null;
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.channel) return normalizeChannel(s.channel);
    }
  } catch {}
  return 'ch1';
};

export default function App() {
  const [channel, setChannel] = useState<ChannelId>(getInitialChannel);

  const [gameState, setGameState] = useState<GameState>({
    channel: getInitialChannel(),
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
    const initialCh = getInitialChannel();
    setChannel(initialCh);

    socket.connect();
    socket.emit('channel:join', { channel: initialCh });

    socket.on('game:state_sync', (state) => {
      setGameState(state);
    });

    const handlePopState = () => {
      setPath(window.location.pathname);
      const ch = getInitialChannel();
      setChannel(ch);
      socket.emit('channel:join', { channel: ch });
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      socket.off('game:state_sync');
      window.removeEventListener('popstate', handlePopState);
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
