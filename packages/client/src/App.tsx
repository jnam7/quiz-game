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
      maxPlayers: 150,
      isSoundEnabled: true,
      bgmEnabled: true,
      autoProgress: true,
      stageTimeLimits: { 1: 15, 2: 15, 3: 15, 4: 15, 5: 15 },
      selectedCategories: [...ALL_QUIZ_CATEGORIES]
    }
  });

  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    socket.connect();

    socket.on('game:state_sync', (state) => {
      setGameState(state);
    });

    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);

    return () => {
      socket.off('game:state_sync');
      window.removeEventListener('popstate', handlePopState);
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
