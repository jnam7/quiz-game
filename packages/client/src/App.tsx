import { useEffect, useState } from 'react';
import { socket } from './socket';
import { GameState, ALL_QUIZ_CATEGORIES } from '@quiz/shared';
import { PlayerView } from './views/PlayerView';
import { TvView } from './views/TvView';
import { AdminView } from './views/AdminView';

export default function App() {
  const [gameState, setGameState] = useState<GameState>({
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

  useEffect(() => {
    document.title = '서바이벌 퀴즈쇼';
    socket.connect();

    socket.on('game:state_sync', (state) => {
      setGameState(state);
    });

    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);

    // 모바일 브라우저 닫기/새로고침 시 소켓 즉시 정리
    const handleUnload = () => {
      const token = localStorage.getItem('quiz_survival_player_token');
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
    return <TvView gameState={gameState} />;
  }

  if (path.startsWith('/admin')) {
    return <AdminView gameState={gameState} />;
  }

  // 기본 경로는 모바일 참가자 뷰
  return <PlayerView gameState={gameState} />;
}
