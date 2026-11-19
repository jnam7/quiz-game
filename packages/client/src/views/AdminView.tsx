import React, { useState, useEffect } from 'react';
import { GameState, QuizItem, QuizCategory, RankedPlayer, ALL_QUIZ_CATEGORIES } from '@quiz/shared';
import { socket } from '../socket';
import QRCode from 'qrcode';

interface AdminViewProps {
  gameState: GameState;
}

export const AdminView: React.FC<AdminViewProps> = ({ gameState }) => {
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [serverIp, setServerIp] = useState('');
  const [rankingSearchTerm, setRankingSearchTerm] = useState('');

  // 직전/현재 경기 결과 스냅샷 (리셋 후에도 언제든 등수 확인 가능)
  const [persistedGameResult, setPersistedGameResult] = useState<{
    gameId: string;
    endedAt: string;
    winnerNickname?: string;
    isDraw?: boolean;
    rankings: RankedPlayer[];
  } | null>(() => {
    try {
      const saved = localStorage.getItem('quiz_admin_last_result');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [showSavedResultModal, setShowSavedResultModal] = useState(false);

  // 관리자 비밀번호 변경 상태
  const [showPwChangeModal, setShowPwChangeModal] = useState(false);
  const [currentPwInput, setCurrentPwInput] = useState('');
  const [newPwInput, setNewPwInput] = useState('');
  const [confirmPwInput, setConfirmPwInput] = useState('');
  const [pwChangeError, setPwChangeError] = useState('');
  const [pwChangeSuccess, setPwChangeSuccess] = useState('');

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPwChangeError('');
    setPwChangeSuccess('');

    if (!currentPwInput) {
      setPwChangeError('현재 비밀번호를 입력해주세요.');
      return;
    }
    if (!newPwInput || newPwInput.trim().length < 4) {
      setPwChangeError('새 비밀번호는 4자리 이상이어야 합니다.');
      return;
    }
    if (newPwInput !== confirmPwInput) {
      setPwChangeError('새 비밀번호와 확인이 일치하지 않습니다.');
      return;
    }

    socket.emit('admin:change_password', {
      currentPassword: currentPwInput,
      newPassword: newPwInput.trim()
    }, (res) => {
      if (res.success) {
        setPwChangeSuccess(res.message || '비밀번호가 성공적으로 변경되었습니다.');
        setCurrentPwInput('');
        setNewPwInput('');
        setConfirmPwInput('');
        setTimeout(() => {
          setShowPwChangeModal(false);
          setPwChangeSuccess('');
        }, 1500);
      } else {
        setPwChangeError(res.message || '비밀번호 변경 실패');
      }
    });
  };

  // 새 문제 입력 폼 상태
  const [newQuiz, setNewQuiz] = useState<{
    question: string;
    category: QuizCategory;
    options: [string, string, string, string];
    answerIndex: number;
    explanation: string;
    difficulty: 'easy' | 'medium' | 'hard';
    timeLimit: number;
  }>({
    question: '',
    category: '일반 상식',
    options: ['', '', '', ''],
    answerIndex: 0,
    explanation: '',
    difficulty: 'medium',
    timeLimit: 15
  });

  const [publicUrl, setPublicUrl] = useState('');

  const loadQuizzes = () => {
    fetch('/api/quizzes')
      .then(res => res.json())
      .then(data => setQuizzes(data.quizzes || []))
      .catch(console.error);
  };

  useEffect(() => {
    const fetchInfo = () => {
      fetch('/api/server-info')
        .then(res => res.json())
        .then(info => {
          setServerIp(info.localIp);
          if (info.publicUrl) setPublicUrl(info.publicUrl);
          const targetUrl = info.publicUrl || `http://${info.localIp}:${info.clientPort}`;
          QRCode.toDataURL(targetUrl, { width: 240, margin: 1 })
            .then(url => setQrCodeDataUrl(url));
        });
    };

    fetchInfo();
    const t = setTimeout(fetchInfo, 3000);
    loadQuizzes();

    const handleTunnelUpdated = (newPublicUrl: string) => {
      setPublicUrl(newPublicUrl);
      QRCode.toDataURL(newPublicUrl, { width: 240, margin: 1 })
        .then(url => setQrCodeDataUrl(url));
    };
    socket.on('server:tunnel_updated', handleTunnelUpdated);

    return () => {
      clearTimeout(t);
      socket.off('server:tunnel_updated', handleTunnelUpdated);
    };
  }, []);

  // 게임 종료 시 직전 경기 결과 스냅샷 자동 저장 (리셋 후에도 등수 영구 보존)
  useEffect(() => {
    if (gameState.status === 'GAME_OVER' && gameState.topRankings && gameState.topRankings.length > 0) {
      const snap = {
        gameId: gameState.gameId,
        endedAt: new Date().toLocaleTimeString(),
        winnerNickname: gameState.winner?.nickname,
        isDraw: gameState.isDraw,
        rankings: gameState.topRankings
      };
      setPersistedGameResult(snap);
      try {
        localStorage.setItem('quiz_admin_last_result', JSON.stringify(snap));
      } catch {}
    }
  }, [gameState.status, gameState.topRankings, gameState.gameId, gameState.winner, gameState.isDraw]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    socket.emit('admin:auth', passwordInput, (res) => {
      if (res.success) {
        setIsAuthenticated(true);
        setAuthError('');
        loadQuizzes();
      } else {
        setAuthError('관리자 비밀번호가 일치하지 않습니다.');
      }
    });
  };

  const handleStartGame = () => {
    socket.emit('admin:start_game', (res) => {
      if (!res?.success) alert('게임을 시작할 수 없습니다. (대기 인원 확인 필요)');
    });
  };

  const handlePause = () => socket.emit('admin:pause_game');
  const handleResume = () => socket.emit('admin:resume_game');
  const handleSkip = () => socket.emit('admin:skip_round');
  const handleRandomQuiz = () => {
    socket.emit('admin:random_quiz');
  };
  const handleMoveToLobby = () => {
    if (gameState.topRankings && gameState.topRankings.length > 0) {
      const snap = {
        gameId: gameState.gameId,
        endedAt: new Date().toLocaleTimeString(),
        winnerNickname: gameState.winner?.nickname,
        isDraw: gameState.isDraw,
        rankings: gameState.topRankings
      };
      setPersistedGameResult(snap);
      try { localStorage.setItem('quiz_admin_last_result', JSON.stringify(snap)); } catch {}
    }
    socket.emit('admin:move_to_lobby', (res) => {
      if (res?.success) {
        alert('모든 모바일 참가자와 TV 화면을 대기실로 즉시 강제 이동시켰습니다.\n(직전 경기 등수는 상단의 [직전 경기 등수 다시보기]에서 계속 확인하실 수 있습니다)');
      }
    });
  };
  const handleReset = () => {
    if (confirm('게임을 정말 초기화하시겠습니까?\n(현재 경기 결과와 등수는 상단의 [직전 경기 등수 다시보기]에서 언제든 다시 확인하실 수 있습니다)')) {
      if (gameState.topRankings && gameState.topRankings.length > 0) {
        const snap = {
          gameId: gameState.gameId,
          endedAt: new Date().toLocaleTimeString(),
          winnerNickname: gameState.winner?.nickname,
          isDraw: gameState.isDraw,
          rankings: gameState.topRankings
        };
        setPersistedGameResult(snap);
        try { localStorage.setItem('quiz_admin_last_result', JSON.stringify(snap)); } catch {}
      }
      socket.emit('admin:reset_game');
    }
  };
  const handleClearAllPlayers = () => {
    if (confirm('정말 참가자 전원을 퇴장시키고 대기실을 0명으로 완전히 비우시겠습니까?')) {
      socket.emit('admin:clear_all_players', (res) => {
        if (res?.success) {
          alert('모든 참가자가 퇴장 처리되어 대기 인원이 0명으로 초기화되었습니다.');
        }
      });
    }
  };

  // 카테고리 선택 제어 로직
  const currentSelectedCategories = gameState.settings.selectedCategories && gameState.settings.selectedCategories.length > 0
    ? gameState.settings.selectedCategories
    : ALL_QUIZ_CATEGORIES;

  const handleToggleCategory = (cat: QuizCategory) => {
    let next: QuizCategory[];
    if (currentSelectedCategories.includes(cat)) {
      if (currentSelectedCategories.length <= 1) {
        alert('최소 1개 이상의 카테고리는 선택되어 있어야 합니다.');
        return;
      }
      next = currentSelectedCategories.filter(c => c !== cat);
    } else {
      next = [...currentSelectedCategories, cat];
    }
    socket.emit('admin:update_settings', { selectedCategories: next });
  };

  const handleSelectAllCategories = () => {
    socket.emit('admin:update_settings', { selectedCategories: [...ALL_QUIZ_CATEGORIES] });
  };

  const handleDeselectAllCategories = () => {
    socket.emit('admin:update_settings', { selectedCategories: [ALL_QUIZ_CATEGORIES[0]] });
  };

  const totalAvailableQuizzesCount = quizzes.filter(q => q.isApproved && currentSelectedCategories.includes(q.category)).length;

  const handleKick = (token: string, nickname: string) => {
    if (confirm(`'${nickname}' 참가자를 강제 탈락 처리하시겠습니까?`)) {
      socket.emit('admin:kick_player', token);
    }
  };

  const handleAddQuiz = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuiz.question.trim() || newQuiz.options.some(o => !o.trim())) {
      alert('문제와 4개 보기를 모두 입력해주세요.');
      return;
    }

    socket.emit('admin:quiz:add', { ...newQuiz, isApproved: true }, (res) => {
      if (res.success) {
        alert('문제가 성공적으로 등록되었습니다.');
        setNewQuiz({
          question: '',
          category: '일반 상식',
          options: ['', '', '', ''],
          answerIndex: 0,
          explanation: '',
          difficulty: 'medium',
          timeLimit: 15
        });
        loadQuizzes();
      }
    });
  };

  const handleToggleApprove = (id: number) => {
    socket.emit('admin:quiz:toggle_approve', id, () => loadQuizzes());
  };

  const handleDeleteQuiz = (id: number) => {
    if (confirm('이 문제를 삭제하시겠습니까?')) {
      socket.emit('admin:quiz:delete', id, () => loadQuizzes());
    }
  };

  const handleDownloadExcel = () => {
    window.open('/api/export-excel', '_blank');
  };

  // 로그인 화면
  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: '400px', margin: '80px auto', padding: '30px', background: '#1e293b', borderRadius: '16px', textAlign: 'center' }}>
        <h2 style={{ color: '#818cf8', marginBottom: '16px' }}>🛠️ 관리자 대시보드 로그인</h2>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <input
            type="password"
            placeholder="관리자 비밀번호 입력"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            style={{ padding: '12px', fontSize: '1rem' }}
          />
          {authError && <div style={{ color: '#f87171', fontSize: '0.9rem' }}>{authError}</div>}
          <button type="submit" style={{ padding: '14px', background: '#6366f1', color: 'white', fontSize: '1.05rem' }}>
            로그인
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '16px 12px' : '24px 16px' }}>
      {/* 관리자 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: '20px', borderBottom: '1px solid #334155', paddingBottom: '16px', flexDirection: isMobile ? 'column' : 'row', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: isMobile ? '1.4rem' : '1.8rem', color: '#818cf8', fontWeight: 900 }}>🛠️ CMB 150인 서바이벌 퀴즈 관리자 센터</h1>
          <p style={{ color: '#94a3b8', fontSize: isMobile ? '0.8rem' : '0.9rem', marginTop: '4px', lineHeight: 1.5 }}>
            현장 서버 IP: <strong style={{ color: '#38bdf8' }}>{serverIp}:4000</strong>
            {publicUrl && (
              <> | 공인 URL: <strong style={{ color: '#4ade80' }}>{publicUrl}</strong></>
            )}
            {' '}| 상태: <strong style={{ color: '#f59e0b' }}>{gameState.status}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
          <button
            onClick={() => {
              setShowPwChangeModal(true);
              setPwChangeError('');
              setPwChangeSuccess('');
              setCurrentPwInput('');
              setNewPwInput('');
              setConfirmPwInput('');
            }}
            style={{ flex: isMobile ? '1 1 auto' : 'none', padding: isMobile ? '8px 12px' : '10px 16px', background: '#475569', color: 'white', fontSize: isMobile ? '0.8rem' : '0.9rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer', border: 'none' }}
          >
            🔒 비밀번호 변경
          </button>
          {persistedGameResult && (
            <button
              onClick={() => setShowSavedResultModal(true)}
              style={{ flex: isMobile ? '1 1 auto' : 'none', padding: isMobile ? '8px 12px' : '10px 16px', background: '#3b82f6', color: 'white', fontSize: isMobile ? '0.8rem' : '0.9rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer' }}
              title="리셋 전/직전에 완료된 경기의 최종 등수와 점수를 확인합니다"
            >
              📜 직전 경기 등수 다시보기
            </button>
          )}
          <button
            onClick={handleDownloadExcel}
            style={{ flex: isMobile ? '1 1 auto' : 'none', padding: isMobile ? '8px 14px' : '10px 18px', background: '#16a34a', color: 'white', fontSize: isMobile ? '0.85rem' : '0.95rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer' }}
          >
            📊 결과 엑셀 다운로드
          </button>
        </div>
      </div>

      {/* 🏆 경기 종료 시: 전체 등수 및 최종 결과 관리 보드 (리셋 누르기 전까지 영구 고정 표시) */}
      {gameState.status === 'GAME_OVER' && (
        <div style={{ background: 'linear-gradient(180deg, #1e1b4b, #0f172a)', border: '2px solid #818cf8', borderRadius: '16px', padding: isMobile ? '16px 12px' : '24px', marginBottom: '24px', boxShadow: '0 10px 30px rgba(99, 102, 241, 0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: '12px', marginBottom: '16px', borderBottom: '1px solid #3730a3', paddingBottom: '14px' }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: '#a5b4fc', fontWeight: 700 }}>🏁 이번 경기 최종 집계 결과 (등수 관리 보드)</div>
              <h2 style={{ fontSize: isMobile ? '1.3rem' : '1.7rem', color: '#fef08a', fontWeight: 900, marginTop: '4px' }}>
                {gameState.winner ? `👑 우승자: ${gameState.winner.nickname} (${gameState.winner.score}점)` : gameState.isDraw ? '🤝 무승부 (전원 동시 탈락)' : '게임 종료'}
              </h2>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                * 관리자가 하단의 [게임 리셋] 또는 [전원 대기실 이동]을 누르기 전까지 이 등수표가 유지됩니다.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', width: isMobile ? '100%' : 'auto' }}>
              <button
                onClick={handleDownloadExcel}
                style={{ width: isMobile ? '100%' : 'auto', padding: '10px 18px', background: '#16a34a', color: 'white', fontWeight: 700, borderRadius: '8px', cursor: 'pointer' }}
              >
                📊 엑셀 다운로드
              </button>
            </div>
          </div>

          {/* 닉네임 검색 필터 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: isMobile ? '0.95rem' : '1.05rem', fontWeight: 800, color: '#f8fafc' }}>
              🎖️ 전체 참가자 최종 순위표 (총 {(gameState.topRankings || []).length}명)
            </span>
            <input
              type="text"
              placeholder="참가자 닉네임 검색..."
              value={rankingSearchTerm}
              onChange={(e) => setRankingSearchTerm(e.target.value)}
              style={{ padding: '8px 14px', background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: '#f8fafc', fontSize: '0.9rem', width: isMobile ? '100%' : '220px' }}
            />
          </div>

          {/* 전체 순위 테이블 */}
          <div style={{ maxHeight: '380px', overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch', background: '#090d16', borderRadius: '10px', border: '1px solid #312e81' }}>
            <table style={{ width: '100%', minWidth: '450px', borderCollapse: 'collapse', fontSize: isMobile ? '0.85rem' : '0.95rem' }}>
              <thead>
                <tr style={{ background: '#1e1b4b', color: '#cbd5e1', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '10px', width: '70px', textAlign: 'center' }}>등수</th>
                  <th style={{ padding: '10px' }}>닉네임</th>
                  <th style={{ padding: '10px' }}>최종 점수</th>
                  <th style={{ padding: '10px' }}>최종 상태</th>
                  <th style={{ padding: '10px' }}>탈락 라운드</th>
                </tr>
              </thead>
              <tbody>
                {(gameState.topRankings || [])
                  .filter(r => !rankingSearchTerm || r.nickname.toLowerCase().includes(rankingSearchTerm.toLowerCase()))
                  .map((r) => {
                    const medal = r.rank === 1 ? '🥇 1위' : r.rank === 2 ? '🥈 2위' : r.rank === 3 ? '🥉 3위' : `${r.rank}위`;
                    const isTop3 = r.rank <= 3;
                    return (
                      <tr key={r.token} style={{ borderBottom: '1px solid #1e293b', background: isTop3 ? 'rgba(99, 102, 241, 0.18)' : 'transparent' }}>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: r.rank === 1 ? '#facc15' : r.rank === 2 ? '#e2e8f0' : r.rank === 3 ? '#d97706' : '#94a3b8' }}>
                          {medal}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#f8fafc' }}>
                          {r.nickname}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#38bdf8' }}>
                          {r.score}점
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '0.78rem', background: r.isAlive ? '#166534' : '#7f1d1d', color: r.isAlive ? '#86efac' : '#fca5a5' }}>
                            {r.isAlive ? '최종 생존' : '탈락'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#94a3b8' }}>
                          {r.eliminatedRound ? `${r.eliminatedRound}라운드` : (r.isAlive ? '우승 완주' : '-')}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 📜 직전 경기 등수 다시보기 모달 (리셋 후에도 언제든 조회 가능) */}
      {showSavedResultModal && persistedGameResult && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '8px' : '16px' }}>
          <div style={{ background: '#0f172a', border: '2px solid #6366f1', borderRadius: '16px', maxWidth: '750px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: isMobile ? '16px 12px' : '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '14px', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: isMobile ? '1.1rem' : '1.4rem', color: '#fde047', fontWeight: 800 }}>📜 직전 경기 최종 등수 및 기록</h3>
                <div style={{ fontSize: isMobile ? '0.75rem' : '0.85rem', color: '#94a3b8', marginTop: '4px' }}>
                  종료: {persistedGameResult.endedAt} | 우승: <strong style={{ color: '#facc15' }}>{persistedGameResult.winnerNickname || (persistedGameResult.isDraw ? '무승부' : '없음')}</strong> | 총 {persistedGameResult.rankings.length}명
                </div>
              </div>
              <button
                onClick={() => setShowSavedResultModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.6rem', cursor: 'pointer', padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: '420px', borderCollapse: 'collapse', fontSize: isMobile ? '0.82rem' : '0.9rem' }}>
                <thead>
                  <tr style={{ background: '#1e293b', color: '#cbd5e1', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: '60px' }}>등수</th>
                    <th style={{ padding: '8px 10px' }}>닉네임</th>
                    <th style={{ padding: '8px 10px' }}>점수</th>
                    <th style={{ padding: '8px 10px' }}>상태</th>
                    <th style={{ padding: '8px 10px' }}>탈락 라운드</th>
                  </tr>
                </thead>
                <tbody>
                  {persistedGameResult.rankings.map(r => (
                    <tr key={r.token} style={{ borderBottom: '1px solid #334155', background: r.rank <= 3 ? 'rgba(99, 102, 241, 0.15)' : 'transparent' }}>
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: r.rank === 1 ? '#facc15' : r.rank === 2 ? '#e2e8f0' : r.rank === 3 ? '#d97706' : '#94a3b8' }}>
                        {r.rank === 1 ? '🥇 1위' : r.rank === 2 ? '🥈 2위' : r.rank === 3 ? '🥉 3위' : `${r.rank}위`}
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#f8fafc' }}>{r.nickname}</td>
                      <td style={{ padding: '8px 10px', color: '#38bdf8', fontWeight: 700 }}>{r.score}점</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', background: r.isAlive ? '#166534' : '#7f1d1d', color: r.isAlive ? '#86efac' : '#fca5a5' }}>
                          {r.isAlive ? '생존' : '탈락'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', color: '#94a3b8' }}>
                        {r.eliminatedRound ? `${r.eliminatedRound}라운드` : (r.isAlive ? '완주' : '-')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={handleDownloadExcel}
                style={{ padding: '8px 16px', background: '#16a34a', color: 'white', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
              >
                📊 엑셀 다운로드
              </button>
              <button
                onClick={() => setShowSavedResultModal(false)}
                style={{ padding: '8px 24px', background: '#475569', color: 'white', borderRadius: '8px', cursor: 'pointer' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🔒 관리자 비밀번호 변경 모달 */}
      {showPwChangeModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.75)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
        }}>
          <div style={{
            background: '#1e293b', border: '1px solid #475569', borderRadius: '16px',
            maxWidth: '420px', width: '100%', padding: isMobile ? '18px 16px' : '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.8)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #334155', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: isMobile ? '1.15rem' : '1.25rem', color: '#f8fafc', fontWeight: 800 }}>🔒 관리자 비밀번호 변경</h3>
              <button
                onClick={() => setShowPwChangeModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.4rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '6px' }}>현재 비밀번호</label>
                <input
                  type="password"
                  value={currentPwInput}
                  onChange={(e) => setCurrentPwInput(e.target.value)}
                  placeholder="현재 관리자 비밀번호 입력"
                  style={{ width: '100%', padding: '10px 12px', fontSize: '0.95rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '6px' }}>새 비밀번호 (4자리 이상)</label>
                <input
                  type="password"
                  value={newPwInput}
                  onChange={(e) => setNewPwInput(e.target.value)}
                  placeholder="새로운 비밀번호 입력"
                  style={{ width: '100%', padding: '10px 12px', fontSize: '0.95rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '6px' }}>새 비밀번호 확인</label>
                <input
                  type="password"
                  value={confirmPwInput}
                  onChange={(e) => setConfirmPwInput(e.target.value)}
                  placeholder="새 비밀번호 다시 입력"
                  style={{ width: '100%', padding: '10px 12px', fontSize: '0.95rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: 'white' }}
                />
              </div>

              {pwChangeError && (
                <div style={{ color: '#f87171', fontSize: '0.85rem', fontWeight: 600, padding: '8px 12px', background: 'rgba(239,68,68,0.15)', borderRadius: '6px' }}>
                  {pwChangeError}
                </div>
              )}
              {pwChangeSuccess && (
                <div style={{ color: '#4ade80', fontSize: '0.85rem', fontWeight: 600, padding: '8px 12px', background: 'rgba(74,222,128,0.15)', borderRadius: '6px' }}>
                  {pwChangeSuccess}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button
                  type="submit"
                  style={{ flex: 1, padding: '12px', background: '#6366f1', color: 'white', fontWeight: 700, borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                >
                  변경 저장
                </button>
                <button
                  type="button"
                  onClick={() => setShowPwChangeModal(false)}
                  style={{ padding: '12px 18px', background: '#334155', color: '#cbd5e1', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 1. 상단 컨트롤 패널 */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))', gap: isMobile ? '14px' : '20px', marginBottom: '24px' }}>
        {/* 게임 제어 */}
        <div style={{ background: '#1e293b', padding: isMobile ? '16px 14px' : '20px', borderRadius: '16px' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '14px', color: '#f8fafc' }}>🎮 실시간 게임 제어</h3>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px' }}>
            <button
              onClick={handleStartGame}
              disabled={gameState.status !== 'WAITING' && gameState.status !== 'GAME_OVER'}
              style={{ gridColumn: isMobile ? 'span 2' : 'span 1', padding: '12px', background: '#4f46e5', color: 'white', fontWeight: 700 }}
            >
              🚀 게임 시작
            </button>
            <button
              onClick={handlePause}
              disabled={gameState.status !== 'IN_ROUND'}
              style={{ padding: '12px', background: '#f59e0b', color: 'black', fontWeight: 700 }}
            >
              ⏸️ 일시정지
            </button>
            <button
              onClick={handleResume}
              disabled={gameState.status !== 'PAUSED'}
              style={{ padding: '12px', background: '#10b981', color: 'white', fontWeight: 700 }}
            >
              ▶️ 재개
            </button>
            <button
              onClick={handleSkip}
              disabled={gameState.status !== 'IN_ROUND'}
              style={{ padding: '12px', background: '#64748b', color: 'white' }}
            >
              문제 스킵
            </button>
            <button
              onClick={handleRandomQuiz}
              style={{
                gridColumn: isMobile ? 'span 2' : 'span 1',
                padding: '12px 14px',
                background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                color: 'white',
                fontWeight: 800,
                boxShadow: '0 4px 12px rgba(139, 92, 246, 0.4)'
              }}
            >
              🎲 랜덤 문제 출제
            </button>
            <button
              onClick={handleMoveToLobby}
              style={{
                gridColumn: isMobile ? 'span 2' : 'span 1',
                padding: '12px 14px',
                background: '#0284c7',
                color: 'white',
                fontWeight: 700
              }}
            >
              🏠 전원 대기실 이동
            </button>
            <button
              onClick={handleReset}
              style={{ padding: '12px', background: '#e11d48', color: 'white', fontWeight: 700 }}
            >
              게임 리셋
            </button>
            <button
              onClick={handleClearAllPlayers}
              style={{ padding: '12px', background: '#b91c1c', color: 'white', fontWeight: 700 }}
              title="대기 중인 모든 참가자를 퇴장시키고 인원을 0명으로 초기화합니다"
            >
              🧹 전원 퇴장 (0명)
            </button>
          </div>
        </div>

        {/* 접속 QR코드 프리뷰 */}
        <div style={{ background: '#1e293b', padding: isMobile ? '16px 14px' : '20px', borderRadius: '16px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          {qrCodeDataUrl && (
            <img src={qrCodeDataUrl} alt="QR Code" style={{ width: '90px', height: '90px', borderRadius: '8px', flexShrink: 0 }} />
          )}
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#cbd5e1' }}>모바일 접속 QR코드</div>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '4px 0 8px' }}>
              참가자들에게 QR코드를 공유하세요.
            </p>
            {qrCodeDataUrl && (
              <a
                href={qrCodeDataUrl}
                download="quiz_join_qr.png"
                style={{ color: '#38bdf8', fontSize: '0.82rem', textDecoration: 'underline' }}
              >
                QR 이미지 다운로드
              </a>
            )}
          </div>
        </div>

        {/* 생존 통계 */}
        <div style={{ background: '#1e293b', padding: isMobile ? '16px 14px' : '20px', borderRadius: '16px' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '10px', color: '#f8fafc' }}>📈 진행 통계</h3>
          <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
            <div>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>총 참가자</div>
              <div style={{ fontSize: isMobile ? '1.5rem' : '1.8rem', fontWeight: 900, color: '#38bdf8' }}>{gameState.players.length}</div>
            </div>
            <div>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>생존자</div>
              <div style={{ fontSize: isMobile ? '1.5rem' : '1.8rem', fontWeight: 900, color: '#4ade80' }}>{gameState.survivors.length}</div>
            </div>
            <div>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>현재 라운드</div>
              <div style={{ fontSize: isMobile ? '1.5rem' : '1.8rem', fontWeight: 900, color: '#f59e0b' }}>R{gameState.currentRound}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 🎯 출제 문제 카테고리 선택 (체크된 카테고리만 출제) */}
      <div style={{ background: '#1e293b', padding: isMobile ? '16px 14px' : '22px', borderRadius: '16px', marginBottom: '24px', border: '2px solid #4f46e5', boxShadow: '0 8px 24px rgba(79, 70, 229, 0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: '12px', marginBottom: '16px', borderBottom: '1px solid #334155', paddingBottom: '14px' }}>
          <div>
            <h3 style={{ fontSize: isMobile ? '1.15rem' : '1.25rem', color: '#818cf8', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span>🎯 출제 문제 카테고리 선택</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '2px 8px', borderRadius: '9999px' }}>
                체크된 카테고리만 출제
              </span>
            </h3>
            <p style={{ color: '#cbd5e1', fontSize: isMobile ? '0.82rem' : '0.9rem', marginTop: '6px' }}>
              선택된 카테고리: <strong style={{ color: '#4ade80' }}>{currentSelectedCategories.length}개</strong>
              {' '}| 출제 가능: <strong style={{ color: '#facc15' }}>{totalAvailableQuizzesCount}문제</strong>
              {currentSelectedCategories.length === 1 && (
                <span style={{ marginLeft: '8px', color: '#f43f5e', fontWeight: 800, background: 'rgba(244, 63, 94, 0.15)', padding: '2px 6px', borderRadius: '6px' }}>
                  ⚡ 단일 카테고리 집중 모드
                </span>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', width: isMobile ? '100%' : 'auto' }}>
            <button
              onClick={handleSelectAllCategories}
              style={{ flex: isMobile ? 1 : 'none', padding: '8px 14px', background: '#3730a3', color: '#e0e7ff', fontSize: '0.82rem', fontWeight: 700, borderRadius: '8px', border: '1px solid #6366f1', cursor: 'pointer' }}
            >
              ✅ 전체 선택
            </button>
            <button
              onClick={handleDeselectAllCategories}
              style={{ flex: isMobile ? 1 : 'none', padding: '8px 14px', background: '#0f172a', color: '#94a3b8', fontSize: '0.82rem', fontWeight: 600, borderRadius: '8px', border: '1px solid #475569', cursor: 'pointer' }}
            >
              초기화 (1개만)
            </button>
          </div>
        </div>

        {/* 카테고리 체크박스 그리드 */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(210px, 1fr))', gap: isMobile ? '8px' : '12px' }}>
          {ALL_QUIZ_CATEGORIES.map((cat) => {
            const isChecked = currentSelectedCategories.includes(cat);
            const count = quizzes.filter(q => q.category === cat && q.isApproved).length;
            return (
              <label
                key={cat}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: isMobile ? '8px' : '12px',
                  padding: isMobile ? '10px 10px' : '12px 14px',
                  background: isChecked ? 'rgba(99, 102, 241, 0.22)' : '#0f172a',
                  border: isChecked ? '2px solid #818cf8' : '1px solid #334155',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  userSelect: 'none',
                  boxShadow: isChecked ? '0 4px 12px rgba(99, 102, 241, 0.2)' : 'none'
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggleCategory(cat)}
                  style={{ width: '18px', height: '18px', accentColor: '#6366f1', cursor: 'pointer' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: isMobile ? '0.88rem' : '0.95rem', fontWeight: isChecked ? 800 : 500, color: isChecked ? '#f8fafc' : '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {cat}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: isChecked ? '#38bdf8' : '#64748b', marginTop: '2px', fontWeight: 600 }}>
                    승인 {count}문제
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* 2. 참가자 목록 & 강제 탈락 관리 */}
      <div style={{ background: '#1e293b', padding: isMobile ? '16px 14px' : '20px', borderRadius: '16px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: isMobile ? '1.1rem' : '1.2rem', marginBottom: '14px', color: '#f8fafc' }}>
          👥 참가자 실시간 관리 ({gameState.players.length}명)
        </h3>
        <div style={{ maxHeight: '280px', overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', minWidth: '480px', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ background: '#0f172a', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '8px', width: '60px', textAlign: 'center' }}>순위</th>
                <th style={{ padding: '8px' }}>닉네임</th>
                <th style={{ padding: '8px' }}>상태</th>
                <th style={{ padding: '8px' }}>점수</th>
                <th style={{ padding: '8px' }}>탈락 사유</th>
                <th style={{ padding: '8px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {[...gameState.players]
                .sort((a, b) => {
                  const rankA = (gameState.topRankings || []).find(r => r.token === a.token)?.rank || 999;
                  const rankB = (gameState.topRankings || []).find(r => r.token === b.token)?.rank || 999;
                  return rankA - rankB;
                })
                .map((p) => {
                  const rankItem = (gameState.topRankings || []).find(r => r.token === p.token);
                  const rankText = rankItem ? (rankItem.rank === 1 ? '🥇 1' : rankItem.rank === 2 ? '🥈 2' : rankItem.rank === 3 ? '🥉 3' : `${rankItem.rank}위`) : '-';
                  return (
                    <tr key={p.token} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '8px', textAlign: 'center', fontWeight: 800, color: rankItem?.rank === 1 ? '#facc15' : '#94a3b8' }}>
                        {rankText}
                      </td>
                      <td style={{ padding: '8px', fontWeight: 700 }}>{p.nickname}</td>
                      <td style={{ padding: '8px' }}>
                        <span className={p.isAlive ? 'badge badge-alive' : 'badge badge-dead'}>
                          {p.isAlive ? '생존' : '탈락'}
                        </span>
                      </td>
                      <td style={{ padding: '8px', color: '#38bdf8', fontWeight: 700 }}>{p.score}점</td>
                      <td style={{ padding: '8px', color: '#94a3b8' }}>
                        {p.eliminatedReason === 'TIMEOUT' ? '시간 초과' : p.eliminatedReason === 'WRONG_ANSWER' ? '오답' : p.eliminatedReason === 'ADMIN_KICK' ? '강제 퇴장' : '-'}
                      </td>
                      <td style={{ padding: '8px' }}>
                        {p.isAlive && (
                          <button
                            onClick={() => handleKick(p.token, p.nickname)}
                            style={{ padding: '4px 10px', background: '#ef4444', color: 'white', fontSize: '0.8rem', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            강제 탈락
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. 문제은행 관리 (CRUD) */}
      <div style={{ background: '#1e293b', padding: isMobile ? '16px 14px' : '20px', borderRadius: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ fontSize: isMobile ? '1.1rem' : '1.2rem', color: '#f8fafc' }}>
            📚 문제은행 관리 (총 {quizzes.length}개)
          </h3>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            승인: <strong style={{ color: '#4ade80' }}>{quizzes.filter(q => q.isApproved).length}개</strong>
          </div>
        </div>

        {/* 신규 문제 등록 폼 */}
        <form onSubmit={handleAddQuiz} style={{ background: '#0f172a', padding: isMobile ? '14px 12px' : '16px', borderRadius: '12px', marginBottom: '20px' }}>
          <h4 style={{ fontSize: '0.95rem', color: '#38bdf8', marginBottom: '12px' }}>➕ 새 문제 직접 추가</h4>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <input
              type="text"
              placeholder="문제 제목"
              value={newQuiz.question}
              onChange={(e) => setNewQuiz({ ...newQuiz, question: e.target.value })}
            />
            <select
              value={newQuiz.category}
              onChange={(e) => setNewQuiz({ ...newQuiz, category: e.target.value as QuizCategory })}
              style={{ background: '#1e293b', color: 'white', padding: '10px', borderRadius: '10px', border: '1px solid #475569' }}
            >
              {ALL_QUIZ_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="제한시간(초)"
              value={newQuiz.timeLimit}
              onChange={(e) => setNewQuiz({ ...newQuiz, timeLimit: Number(e.target.value) })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '10px', marginBottom: '10px' }}>
            {[0, 1, 2, 3].map((idx) => (
              <input
                key={idx}
                type="text"
                placeholder={`보기 ${idx + 1}`}
                value={newQuiz.options[idx]}
                onChange={(e) => {
                  const opts = [...newQuiz.options] as [string, string, string, string];
                  opts[idx] = e.target.value;
                  setNewQuiz({ ...newQuiz, options: opts });
                }}
              />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr auto', gap: '10px' }}>
            <select
              value={newQuiz.answerIndex}
              onChange={(e) => setNewQuiz({ ...newQuiz, answerIndex: Number(e.target.value) })}
              style={{ background: '#1e293b', color: 'white', padding: '10px', borderRadius: '10px', border: '1px solid #475569' }}
            >
              <option value={0}>정답: 보기 1</option>
              <option value={1}>정답: 보기 2</option>
              <option value={2}>정답: 보기 3</option>
              <option value={3}>정답: 보기 4</option>
            </select>
            <input
              type="text"
              placeholder="정답 해설"
              value={newQuiz.explanation}
              onChange={(e) => setNewQuiz({ ...newQuiz, explanation: e.target.value })}
            />
            <button type="submit" style={{ padding: '10px 24px', background: '#4f46e5', color: 'white' }}>
              문제 등록
            </button>
          </div>
        </form>

        {/* 문제 목록 테이블 */}
        <div style={{ maxHeight: '350px', overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#0f172a', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>ID</th>
                <th style={{ padding: '8px' }}>카테고리</th>
                <th style={{ padding: '8px' }}>문제</th>
                <th style={{ padding: '8px' }}>정답</th>
                <th style={{ padding: '8px' }}>제한시간</th>
                <th style={{ padding: '8px' }}>승인 상태</th>
                <th style={{ padding: '8px' }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {quizzes.map((q) => (
                <tr key={q.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '8px', color: '#94a3b8' }}>#{q.id}</td>
                  <td style={{ padding: '8px', color: '#38bdf8' }}>{q.category}</td>
                  <td style={{ padding: '8px', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {q.question}
                  </td>
                  <td style={{ padding: '8px', color: '#4ade80' }}>
                    보기 {q.answerIndex + 1} ({q.options[q.answerIndex]})
                  </td>
                  <td style={{ padding: '8px' }}>{q.timeLimit}초</td>
                  <td style={{ padding: '8px' }}>
                    <button
                      onClick={() => handleToggleApprove(q.id)}
                      style={{
                        padding: '3px 8px',
                        background: q.isApproved ? '#15803d' : '#64748b',
                        color: 'white',
                        fontSize: '0.75rem',
                        borderRadius: '4px'
                      }}
                    >
                      {q.isApproved ? '승인됨' : '미승인'}
                    </button>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <button
                      onClick={() => handleDeleteQuiz(q.id)}
                      style={{ padding: '3px 8px', background: '#dc2626', color: 'white', fontSize: '0.75rem', borderRadius: '4px' }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

