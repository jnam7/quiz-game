import React, { useState, useEffect } from 'react';
import { GameState, QuizItem, QuizCategory, RankedPlayer, ALL_QUIZ_CATEGORIES, SoundEffectType } from '@quiz/shared';
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

  // 인증 상태
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');

  // 문제 목록 및 서버 정보
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [serverIp, setServerIp] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [serverInfo, setServerInfo] = useState<{ localIp: string; clientPort: number; serverPort: number; publicUrl?: string | null } | null>(null);
  const [qrSession, setQrSession] = useState<string>('');

  // 직전/현재 경기 결과 스냅샷
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
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [rankingSearchTerm, setRankingSearchTerm] = useState('');

  // 비밀번호 변경 모달 상태
  const [showPwChangeModal, setShowPwChangeModal] = useState(false);
  const [currentPwInput, setCurrentPwInput] = useState('');
  const [newPwInput, setNewPwInput] = useState('');
  const [confirmPwInput, setConfirmPwInput] = useState('');
  const [pwChangeError, setPwChangeError] = useState('');
  const [pwChangeSuccess, setPwChangeSuccess] = useState('');

  // 카드 접이식(Accordion) 상태
  const [isSoundPanelOpen, setIsSoundPanelOpen] = useState(false);
  const [isPlayerPanelOpen, setIsPlayerPanelOpen] = useState(true);
  const [isCategoryPanelOpen, setIsCategoryPanelOpen] = useState(false);
  const [isQuizBankOpen, setIsQuizBankOpen] = useState(false);

  // 참가자 필터링 & 검색 상태
  const [playerFilter, setPlayerFilter] = useState<'ALL' | 'ALIVE' | 'DEAD'>('ALL');
  const [playerSearch, setPlayerSearch] = useState('');
  const [playerSort, setPlayerSort] = useState<'RANK' | 'SCORE' | 'NAME'>('RANK');

  // 풀이 시간 실시간 카운트다운 타이머
  const [remainingTime, setRemainingTime] = useState<number>(0);
  const questionTimeLimit = gameState.settings.questionTimeLimit || 15;

  useEffect(() => {
    if (gameState.status !== 'IN_ROUND' || !gameState.currentRoundInfo) {
      setRemainingTime(0);
      return;
    }

    const updateTimer = () => {
      const end = gameState.currentRoundInfo?.serverEndTime || 0;
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setRemainingTime(left);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 250);
    return () => clearInterval(interval);
  }, [gameState.status, gameState.currentRoundInfo]);

  // 전광판 사운드 및 연출 원격 제어 상태
  const [bgmVolume, setBgmVolume] = useState<number>(gameState.settings.bgmVolume ?? 1.0);
  const [bgmEnabled, setBgmEnabled] = useState<boolean>(
    gameState.settings.isMuted !== undefined ? !gameState.settings.isMuted : (gameState.settings.bgmEnabled ?? true)
  );
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(gameState.settings.ttsEnabled ?? true);
  const [tickVolume, setTickVolume] = useState<number>(gameState.settings.tickVolume ?? 1.0);

  useEffect(() => {
    if (gameState.settings.bgmVolume !== undefined) setBgmVolume(gameState.settings.bgmVolume);
    if (gameState.settings.isMuted !== undefined) {
      setBgmEnabled(!gameState.settings.isMuted);
    } else if (gameState.settings.bgmEnabled !== undefined) {
      setBgmEnabled(gameState.settings.bgmEnabled);
    }
    if (gameState.settings.ttsEnabled !== undefined) setTtsEnabled(gameState.settings.ttsEnabled);
    if (gameState.settings.tickVolume !== undefined) setTickVolume(gameState.settings.tickVolume);
  }, [
    gameState.settings.bgmVolume,
    gameState.settings.bgmEnabled,
    gameState.settings.isMuted,
    gameState.settings.ttsEnabled,
    gameState.settings.tickVolume
  ]);

  const handleBgmVolumeChange = (vol: number) => {
    setBgmVolume(vol);
    socket.emit('admin:change_audio_settings', { bgmVolume: vol });
  };

  const handleBgmToggle = () => {
    const next = !bgmEnabled;
    setBgmEnabled(next);
    socket.emit('admin:change_audio_settings', { isMuted: !next, bgmEnabled: next });
  };

  const handleTtsToggle = () => {
    const next = !ttsEnabled;
    setTtsEnabled(next);
    socket.emit('admin:change_audio_settings', { ttsEnabled: next });
  };

  const handleTickVolumeChange = (vol: number) => {
    setTickVolume(vol);
    socket.emit('admin:change_audio_settings', { tickVolume: vol });
  };

  const handleTestSound = (type: SoundEffectType) => {
    socket.emit('admin:play_sound', type);
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

  // QR 모드 및 타겟 URL
  const currentQrMode = gameState.settings.qrMode || 'EXTERNAL';

  const handleQrModeChange = (mode: 'WIFI' | 'EXTERNAL') => {
    socket.emit('admin:change_qr_mode', { mode });
  };

  const getQrTargetUrl = (mode: 'WIFI' | 'EXTERNAL') => {
    let target = '';
    if (mode === 'WIFI') {
      const ip = serverInfo?.localIp || serverIp || 'localhost';
      const port = serverInfo?.clientPort || 3000;
      target = `http://${ip}:${port}`;
    } else {
      target = serverInfo?.publicUrl || publicUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    }
    if (qrSession) {
      target += (target.includes('?') ? '&' : '?') + `session=${qrSession}`;
    }
    return target;
  };

  const activeQrUrl = getQrTargetUrl(currentQrMode);

  useEffect(() => {
    if (activeQrUrl) {
      QRCode.toDataURL(activeQrUrl, { width: 320, margin: 1 })
        .then(url => setQrCodeDataUrl(url))
        .catch(console.error);
    }
  }, [activeQrUrl]);

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
          setServerInfo(info);
          setServerIp(info.localIp);
          if (info.publicUrl) setPublicUrl(info.publicUrl);
        })
        .catch(console.error);
    };

    fetchInfo();
    const t = setTimeout(fetchInfo, 3000);
    loadQuizzes();

    const handleTunnelUpdated = (newPublicUrl: string) => {
      setPublicUrl(newPublicUrl);
    };
    const handleQrUpdated = (data: { sessionToken: string; timestamp: number }) => {
      setQrSession(data.sessionToken);
    };

    socket.on('server:tunnel_updated', handleTunnelUpdated);
    socket.on('game:qr_updated', handleQrUpdated);

    return () => {
      clearTimeout(t);
      socket.off('server:tunnel_updated', handleTunnelUpdated);
      socket.off('game:qr_updated', handleQrUpdated);
    };
  }, []);

  // 게임 종료 시 직전 경기 결과 스냅샷 자동 저장
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
  const handleSkipReading = () => socket.emit('admin:skip_reading');
  const handleRandomQuiz = () => socket.emit('admin:random_quiz');

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
        alert('모든 모바일 참가자와 TV 화면을 대기실로 이동시켰습니다.');
      }
    });
  };

  const handleReset = () => {
    if (confirm('게임을 정말 초기화하시겠습니까?\n(현재 경기 결과와 등수는 상단의 [직전 등수]에서 언제든 다시 확인하실 수 있습니다)')) {
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

  const handleRegenerateQr = () => {
    if (confirm('대기실 접속 QR 코드를 새로운 세션으로 갱신하시겠습니까?\n(TV 전광판의 QR 코드가 즉시 새로고침 없이 갱신됩니다)')) {
      socket.emit('admin:regenerate_qr', (res) => {
        if (res?.success) {
          alert('새 QR 코드가 발급되었습니다.');
        } else {
          alert('QR 코드 갱신에 실패했습니다.');
        }
      });
    }
  };

  // 카테고리 제어 로직
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

  const handleClearChat = () => {
    if (confirm('정말로 모든 참가자 및 TV 화면의 실시간 채팅 내역을 초기화하시겠습니까?')) {
      socket.emit('admin:chat_clear', (res) => {
        if (res?.success) {
          alert('모든 실시간 채팅 내역이 깨끗하게 초기화되었습니다.');
        } else {
          alert('채팅 초기화 처리에 실패했습니다.');
        }
      });
    }
  };

  const handleUpdateTimeLimit = (sec: number) => {
    socket.emit('admin:update_settings', { questionTimeLimit: sec });
  };

  const handleUpdateMaxPlayers = (max: number) => {
    socket.emit('admin:update_settings', { maxPlayers: max });
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

  // 참가자 필터링 & 정렬
  const totalPlayersCount = gameState.players.length;
  const alivePlayersCount = gameState.survivors.length;
  const deadPlayersCount = Math.max(0, totalPlayersCount - alivePlayersCount);

  const filteredPlayers = [...gameState.players]
    .filter(p => {
      if (playerFilter === 'ALIVE' && !p.isAlive) return false;
      if (playerFilter === 'DEAD' && p.isAlive) return false;
      if (playerSearch && !p.nickname.toLowerCase().includes(playerSearch.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (playerSort === 'RANK') {
        const rankA = (gameState.topRankings || []).find(r => r.token === a.token)?.rank || 999;
        const rankB = (gameState.topRankings || []).find(r => r.token === b.token)?.rank || 999;
        return rankA - rankB;
      }
      if (playerSort === 'SCORE') {
        return b.score - a.score;
      }
      return a.nickname.localeCompare(b.nickname);
    });

  // 게임 상태 뱃지 텍스트 및 색상 매핑
  const getStatusBadge = () => {
    switch (gameState.status) {
      case 'WAITING':
        return { text: '대기실 준비 중', bg: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', border: '#3b82f6' };
      case 'STARTING':
        return { text: '카운트다운 중 (3,2,1)', bg: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '#f59e0b' };
      case 'QUESTION_READING':
        return { text: '문제 낭독 중 📢', bg: 'rgba(168, 85, 247, 0.25)', color: '#c084fc', border: '#a855f7', pulse: true };
      case 'IN_ROUND':
        return { text: '문제 풀이 진행 중 ⏱️', bg: 'rgba(16, 185, 129, 0.25)', color: '#34d399', border: '#10b981', pulse: true };
      case 'PAUSED':
        return { text: '일시 정지 ⏸️', bg: 'rgba(244, 63, 94, 0.25)', color: '#fb7185', border: '#f43f5e' };
      case 'ROUND_RESULT':
        return { text: '정답 및 결과 집계 📊', bg: 'rgba(14, 165, 233, 0.2)', color: '#38bdf8', border: '#0ea5e9' };
      case 'GAME_OVER':
        return { text: '최종 결과 발표 (우승) 👑', bg: 'rgba(234, 179, 8, 0.25)', color: '#facc15', border: '#eab308' };
      default:
        return { text: gameState.status, bg: 'rgba(100, 116, 139, 0.2)', color: '#cbd5e1', border: '#64748b' };
    }
  };

  const statusBadge = getStatusBadge();

  // 로그인 화면
  if (!isAuthenticated) {
    return (
      <div style={{
        width: '100%',
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: '#090d16',
        color: '#f8fafc'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '400px',
          padding: '32px 24px',
          background: '#1e293b',
          borderRadius: '20px',
          textAlign: 'center',
          boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          border: '1px solid #334155'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🛠️</div>
          <h2 style={{ color: '#818cf8', fontSize: '1.5rem', fontWeight: 900, marginBottom: '6px' }}>
            관리자 대시보드 로그인
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.88rem', marginBottom: '24px' }}>
            서바이벌 퀴즈쇼 행사 총괄 센터
          </p>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
            <input
              type="password"
              placeholder="관리자 비밀번호 입력"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              style={{
                width: '100%',
                height: '48px',
                padding: '0 14px',
                fontSize: '1rem',
                borderRadius: '10px',
                border: '1px solid #475569',
                background: '#0f172a',
                color: 'white'
              }}
            />
            {authError && (
              <div style={{ color: '#f87171', fontSize: '0.85rem', fontWeight: 600 }}>
                {authError}
              </div>
            )}
            <button
              type="submit"
              style={{
                width: '100%',
                height: '48px',
                background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                color: 'white',
                fontSize: '1.05rem',
                fontWeight: 800,
                borderRadius: '10px',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                cursor: 'pointer'
              }}
            >
              대시보드 접속
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      background: '#090d16',
      color: '#f8fafc',
      paddingBottom: '60px'
    }}>
      {/* ==============================================================
          1. [상단 고정 현황 바 (Sticky Header)]
         ============================================================== */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        background: 'rgba(15, 23, 42, 0.94)',
        borderBottom: '1px solid rgba(51, 65, 85, 0.8)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.45)',
        padding: isMobile ? '10px 12px' : '12px 24px'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          {/* 좌측: 타이틀, 상태 뱃지, 실시간 참가자 카운터 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: isMobile ? '1.2rem' : '1.4rem' }}>🛠️</span>
              <span style={{ fontSize: isMobile ? '1rem' : '1.2rem', fontWeight: 900, color: '#f8fafc' }}>
                퀴즈 컨트롤 타워
              </span>
            </div>

            {/* 현재 상태 뱃지 */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 12px',
              borderRadius: '9999px',
              background: statusBadge.bg,
              color: statusBadge.color,
              border: `1.5px solid ${statusBadge.border}`,
              fontSize: isMobile ? '0.78rem' : '0.85rem',
              fontWeight: 800,
              boxShadow: `0 0 12px ${statusBadge.bg}`,
              animation: statusBadge.pulse ? 'pulse 1.8s infinite' : 'none'
            }}>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: statusBadge.color }} />
              {statusBadge.text}
            </div>

            {/* 실시간 참가자 카운터 */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 12px',
              borderRadius: '10px',
              background: '#1e293b',
              border: '1px solid #334155',
              fontSize: isMobile ? '0.78rem' : '0.85rem'
            }}>
              <span>총 접속: <strong style={{ color: '#38bdf8', fontWeight: 800 }}>{totalPlayersCount}</strong>명</span>
              <span style={{ color: '#475569' }}>|</span>
              <span>생존: <strong style={{ color: '#4ade80', fontWeight: 800 }}>{alivePlayersCount}</strong>명</span>
              <span style={{ color: '#475569' }}>|</span>
              <span>탈락: <strong style={{ color: '#f87171', fontWeight: 800 }}>{deadPlayersCount}</strong>명</span>
            </div>
          </div>

          {/* 우측: 퀵 액션 & 비상 초기화 버튼 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                setShowPwChangeModal(true);
                setPwChangeError('');
                setPwChangeSuccess('');
              }}
              style={{
                height: '36px',
                padding: '0 10px',
                background: '#334155',
                color: '#cbd5e1',
                fontSize: '0.8rem',
                fontWeight: 700,
                borderRadius: '8px'
              }}
              title="관리자 비밀번호 변경"
            >
              🔒 비번
            </button>

            {persistedGameResult && (
              <button
                onClick={() => setShowSavedResultModal(true)}
                style={{
                  height: '36px',
                  padding: '0 10px',
                  background: '#2563eb',
                  color: 'white',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  borderRadius: '8px'
                }}
                title="직전 경기 등수 다시보기"
              >
                📜 직전 등수
              </button>
            )}

            <button
              onClick={handleDownloadExcel}
              style={{
                height: '36px',
                padding: '0 10px',
                background: '#16a34a',
                color: 'white',
                fontSize: '0.8rem',
                fontWeight: 700,
                borderRadius: '8px'
              }}
              title="최종 결과 엑셀 다운로드"
            >
              📊 엑셀
            </button>

            {/* 비상 게임 초기화/정지 모달 호출 버튼 */}
            <button
              onClick={() => setShowEmergencyModal(true)}
              style={{
                height: '36px',
                padding: '0 12px',
                background: 'linear-gradient(135deg, #e11d48, #be123c)',
                color: 'white',
                fontSize: '0.82rem',
                fontWeight: 800,
                borderRadius: '8px',
                boxShadow: '0 2px 10px rgba(225, 29, 72, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span>🚨</span>
              <span>비상 제어</span>
            </button>
          </div>
        </div>
      </header>

      {/* 메인 컨테이너 */}
      <main style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: isMobile ? '14px 12px' : '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        {/* ==============================================================
            🏆 경기 종료 시: 전체 등수 및 최종 결과 관리 보드 (리셋 전 영구 고정)
           ============================================================== */}
        {gameState.status === 'GAME_OVER' && (
          <div style={{
            background: 'linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)',
            border: '2px solid #818cf8',
            borderRadius: '20px',
            padding: isMobile ? '16px' : '24px',
            boxShadow: '0 12px 36px rgba(99, 102, 241, 0.35)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: '14px', marginBottom: '16px', borderBottom: '1px solid #3730a3', paddingBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '0.85rem', color: '#a5b4fc', fontWeight: 800 }}>🏁 이번 경기 최종 집계 결과 (등수 관리 보드)</div>
                <h2 style={{ fontSize: isMobile ? '1.4rem' : '1.8rem', color: '#fef08a', fontWeight: 900, marginTop: '4px' }}>
                  {gameState.winner ? `👑 최종 우승: ${gameState.winner.nickname} (${gameState.winner.score}점)` : gameState.isDraw ? '🤝 무승부 (전원 동시 탈락)' : '게임 종료'}
                </h2>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                  * 관리자가 아래 [전원 대기실 이동] 또는 [새 게임 시작]을 누르기 전까지 이 결과 화면이 유지됩니다.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', width: isMobile ? '100%' : 'auto' }}>
                <button
                  onClick={handleMoveToLobby}
                  style={{
                    flex: isMobile ? 1 : 'none',
                    minHeight: '44px',
                    padding: '8px 16px',
                    background: '#0284c7',
                    color: 'white',
                    fontWeight: 800,
                    borderRadius: '10px'
                  }}
                >
                  🏠 전원 대기실 이동
                </button>
                <button
                  onClick={handleDownloadExcel}
                  style={{
                    flex: isMobile ? 1 : 'none',
                    minHeight: '44px',
                    padding: '8px 16px',
                    background: '#16a34a',
                    color: 'white',
                    fontWeight: 800,
                    borderRadius: '10px'
                  }}
                >
                  📊 엑셀 다운로드
                </button>
              </div>
            </div>

            {/* 등수 검색창 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>
                🎖️ 전체 순위표 (총 {(gameState.topRankings || []).length}명)
              </span>
              <input
                type="text"
                placeholder="참가자 닉네임 검색..."
                value={rankingSearchTerm}
                onChange={(e) => setRankingSearchTerm(e.target.value)}
                style={{ padding: '8px 14px', background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: '#f8fafc', fontSize: '0.9rem', width: isMobile ? '100%' : '240px' }}
              />
            </div>

            {/* 순위 테이블 */}
            <div style={{ maxHeight: '360px', overflowY: 'auto', background: '#090d16', borderRadius: '12px', border: '1px solid #312e81' }}>
              <table style={{ width: '100%', minWidth: '450px', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: '#1e1b4b', color: '#cbd5e1', position: 'sticky', top: 0, zIndex: 1 }}>
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
                        <tr key={r.token} style={{ borderBottom: '1px solid #1e293b', background: isTop3 ? 'rgba(99, 102, 241, 0.16)' : 'transparent' }}>
                          <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: r.rank === 1 ? '#facc15' : r.rank === 2 ? '#e2e8f0' : r.rank === 3 ? '#d97706' : '#94a3b8' }}>
                            {medal}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: '#f8fafc' }}>{r.nickname}</td>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: '#38bdf8' }}>{r.score}점</td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '0.78rem', background: r.isAlive ? '#166534' : '#7f1d1d', color: r.isAlive ? '#86efac' : '#fca5a5' }}>
                              {r.isAlive ? '최종 생존' : '탈락'}
                            </span>
                          </td>
                          <td style={{ padding: '8px 10px', color: '#94a3b8' }}>
                            {r.eliminatedRound ? `${r.eliminatedRound}라운드` : (r.isAlive ? '완주' : '-')}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==============================================================
            2. [카드 2: 게임 진행 컨트롤 타워 (핵심 조작부)]
           ============================================================== */}
        <section style={{
          background: '#1e293b',
          borderRadius: '20px',
          padding: isMobile ? '16px' : '24px',
          border: '1px solid #334155',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>🎮</span>
              <h2 style={{ fontSize: isMobile ? '1.15rem' : '1.3rem', fontWeight: 800, color: '#f8fafc' }}>
                게임 진행 컨트롤 타워
              </h2>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              현재 라운드: <strong style={{ color: '#f59e0b', fontSize: '1rem' }}>R{gameState.currentRound}</strong>
            </div>
          </div>

          {/* 순서형 진행 단계 인디케이터 (Workflow Stepper) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)',
            gap: '8px',
            marginBottom: '20px'
          }}>
            {[
              { num: 1, label: '대기실 오픈', active: gameState.status === 'WAITING' },
              { num: 2, label: '문제 낭독', active: gameState.status === 'QUESTION_READING' || gameState.status === 'STARTING' },
              { num: 3, label: '보기 & 타이머', active: gameState.status === 'IN_ROUND' },
              { num: 4, label: '정답 & 결과', active: gameState.status === 'ROUND_RESULT' },
              { num: 5, label: '다음 라운드', active: gameState.status === 'GAME_OVER' }
            ].map((step) => (
              <div
                key={step.num}
                style={{
                  padding: '8px 10px',
                  borderRadius: '12px',
                  background: step.active ? 'rgba(79, 70, 229, 0.25)' : '#0f172a',
                  border: step.active ? '2px solid #818cf8' : '1px solid #334155',
                  textAlign: 'center',
                  boxShadow: step.active ? '0 0 15px rgba(99, 102, 241, 0.35)' : 'none',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ fontSize: '0.75rem', color: step.active ? '#a5b4fc' : '#64748b', fontWeight: 800 }}>
                  STEP {step.num}
                </div>
                <div style={{ fontSize: isMobile ? '0.8rem' : '0.9rem', fontWeight: step.active ? 800 : 600, color: step.active ? '#ffffff' : '#94a3b8', marginTop: '2px', wordBreak: 'keep-all' }}>
                  {step.label}
                </div>
              </div>
            ))}
          </div>

          {/* 실시간 타이머 게이지 바 (풀이 진행 중일 때 노출) */}
          {gameState.status === 'IN_ROUND' && (
            <div style={{
              background: '#0f172a',
              borderRadius: '16px',
              padding: '16px',
              marginBottom: '20px',
              border: remainingTime <= 3 ? '2px solid #ef4444' : '1px solid #334155',
              boxShadow: remainingTime <= 3 ? '0 0 20px rgba(239, 68, 68, 0.4)' : 'none'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.9rem', color: remainingTime <= 3 ? '#f87171' : '#38bdf8', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⏱️</span>
                  <span>{remainingTime <= 3 ? '종료 3초 전 마감 카운트다운!' : '문제 풀이 제한 시간 진행 중'}</span>
                </span>
                <span style={{ fontSize: '1.25rem', fontWeight: 900, color: remainingTime <= 3 ? '#f87171' : '#facc15' }}>
                  {remainingTime}초 / {questionTimeLimit}초
                </span>
              </div>
              <div style={{ height: '12px', background: '#334155', borderRadius: '6px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, (remainingTime / questionTimeLimit) * 100))}%`,
                    background: remainingTime <= 3
                      ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                      : remainingTime <= 5
                      ? 'linear-gradient(90deg, #f59e0b, #eab308)'
                      : 'linear-gradient(90deg, #10b981, #06b6d4)',
                    transition: 'width 0.25s linear'
                  }}
                />
              </div>
            </div>
          )}

          {/* ⭐ 큼직한 다음 행동 추천 버튼 (Hero Action Button) */}
          <div style={{ marginBottom: '20px' }}>
            {gameState.status === 'WAITING' && (
              <button
                onClick={handleStartGame}
                style={{
                  width: '100%',
                  minHeight: '56px',
                  background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                  color: 'white',
                  fontSize: isMobile ? '1.05rem' : '1.2rem',
                  fontWeight: 900,
                  borderRadius: '14px',
                  boxShadow: '0 6px 20px rgba(79, 70, 229, 0.45)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px'
                }}
              >
                <span>🚀</span>
                <span>게임 시작 (1라운드 문제 낭독 시작)</span>
              </button>
            )}

            {gameState.status === 'QUESTION_READING' && (
              <button
                onClick={handleSkipReading}
                style={{
                  width: '100%',
                  minHeight: '56px',
                  background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                  color: 'white',
                  fontSize: isMobile ? '1.05rem' : '1.2rem',
                  fontWeight: 900,
                  borderRadius: '14px',
                  boxShadow: '0 6px 20px rgba(245, 158, 11, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  animation: 'pulse 1.5s infinite'
                }}
              >
                <span>⚡</span>
                <span>즉시 보기 오픈 & 풀이 타이머 시작 (낭독 스킵)</span>
              </button>
            )}

            {gameState.status === 'IN_ROUND' && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                <button
                  onClick={handleSkip}
                  style={{
                    minHeight: '52px',
                    background: '#64748b',
                    color: 'white',
                    fontSize: isMobile ? '0.95rem' : '1.05rem',
                    fontWeight: 800,
                    borderRadius: '12px'
                  }}
                >
                  ⏭️ 문제 스킵 (즉시 채점)
                </button>
                <button
                  onClick={handlePause}
                  style={{
                    minHeight: '52px',
                    background: '#f59e0b',
                    color: '#0f172a',
                    fontSize: isMobile ? '0.95rem' : '1.05rem',
                    fontWeight: 800,
                    borderRadius: '12px'
                  }}
                >
                  ⏸️ 일시정지
                </button>
              </div>
            )}

            {gameState.status === 'PAUSED' && (
              <button
                onClick={handleResume}
                style={{
                  width: '100%',
                  minHeight: '56px',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: 'white',
                  fontSize: isMobile ? '1.05rem' : '1.2rem',
                  fontWeight: 900,
                  borderRadius: '14px',
                  boxShadow: '0 6px 20px rgba(16, 185, 129, 0.45)'
                }}
              >
                ▶️ 게임 재개 (타이머 계속 진행)
              </button>
            )}

            {gameState.status === 'ROUND_RESULT' && (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: '10px' }}>
                <button
                  onClick={handleStartGame}
                  style={{
                    minHeight: '52px',
                    background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                    color: 'white',
                    fontSize: isMobile ? '1rem' : '1.1rem',
                    fontWeight: 900,
                    borderRadius: '12px'
                  }}
                >
                  ⏭️ 다음 라운드 문제 출제
                </button>
                <button
                  onClick={handleMoveToLobby}
                  style={{
                    minHeight: '52px',
                    background: '#0284c7',
                    color: 'white',
                    fontSize: isMobile ? '0.95rem' : '1.05rem',
                    fontWeight: 800,
                    borderRadius: '12px'
                  }}
                >
                  🏠 전원 대기실 이동
                </button>
              </div>
            )}
          </div>

          {/* 보조 게임 진행 버튼 그리드 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: '8px',
            marginBottom: '20px'
          }}>
            <button
              onClick={handleRandomQuiz}
              style={{
                minHeight: '46px',
                background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                color: 'white',
                fontWeight: 700,
                fontSize: '0.88rem',
                borderRadius: '10px'
              }}
            >
              🎲 랜덤 문제 출제
            </button>
            <button
              onClick={handleMoveToLobby}
              style={{
                minHeight: '46px',
                background: '#0369a1',
                color: 'white',
                fontWeight: 700,
                fontSize: '0.88rem',
                borderRadius: '10px'
              }}
            >
              🏠 전원 대기실 이동
            </button>
            <button
              onClick={handleClearChat}
              style={{
                minHeight: '46px',
                background: '#7c3aed',
                color: 'white',
                fontWeight: 700,
                fontSize: '0.88rem',
                borderRadius: '10px'
              }}
            >
              💬 채팅창 초기화
            </button>
            <button
              onClick={handleClearAllPlayers}
              style={{
                minHeight: '46px',
                background: '#991b1b',
                color: 'white',
                fontWeight: 700,
                fontSize: '0.88rem',
                borderRadius: '10px'
              }}
            >
              🧹 참가자 전원 퇴장
            </button>
          </div>

          {/* 문제 풀이 제한 시간 설정 (10초 / 15초 / 20초 / 25초) */}
          <div style={{ background: '#0f172a', padding: '14px', borderRadius: '14px', border: '1px solid #334155', marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#38bdf8' }}>
                ⏱️ 문제 풀이 제한 시간 선택
              </span>
              <span style={{ fontSize: '0.78rem', color: '#facc15', background: 'rgba(250, 204, 21, 0.15)', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                현재 적용: {questionTimeLimit}초
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {[10, 15, 20, 25].map((sec) => {
                const isSelected = questionTimeLimit === sec;
                return (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => handleUpdateTimeLimit(sec)}
                    style={{
                      minHeight: '42px',
                      background: isSelected ? 'linear-gradient(135deg, #0284c7, #2563eb)' : '#1e293b',
                      border: isSelected ? '2px solid #38bdf8' : '1px solid #334155',
                      borderRadius: '8px',
                      color: isSelected ? '#ffffff' : '#cbd5e1',
                      fontSize: '0.9rem',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    {sec}초 {isSelected && '✓'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 👥 최대 참가 가능 정원 설정 (10명 ~ 500명, 기본 300명) */}
          <div style={{ background: '#0f172a', padding: '14px', borderRadius: '14px', border: '1px solid #334155', marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#38bdf8' }}>
                👥 최대 참가 가능 정원 설정
              </span>
              <span style={{ fontSize: '0.78rem', color: '#4ade80', background: 'rgba(74, 222, 128, 0.15)', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                현재 정원: {gameState.settings.maxPlayers || 300}명
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
              <input
                type="range"
                min={10}
                max={500}
                step={10}
                value={gameState.settings.maxPlayers || 300}
                onChange={(e) => handleUpdateMaxPlayers(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#4f46e5', cursor: 'pointer' }}
              />
              <input
                type="number"
                min={10}
                max={500}
                step={10}
                value={gameState.settings.maxPlayers || 300}
                onChange={(e) => handleUpdateMaxPlayers(Math.max(10, Math.min(500, Number(e.target.value))))}
                style={{ width: '75px', padding: '6px 8px', background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', color: 'white', textAlign: 'center', fontSize: '0.9rem', fontWeight: 800 }}
              />
              <span style={{ fontSize: '0.88rem', color: '#cbd5e1' }}>명</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {[50, 100, 200, 300].map((count) => {
                const isSelected = (gameState.settings.maxPlayers || 300) === count;
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => handleUpdateMaxPlayers(count)}
                    style={{
                      minHeight: '38px',
                      background: isSelected ? 'linear-gradient(135deg, #4f46e5, #6366f1)' : '#1e293b',
                      border: isSelected ? '2px solid #818cf8' : '1px solid #334155',
                      borderRadius: '8px',
                      color: isSelected ? '#ffffff' : '#cbd5e1',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    {count}명 {isSelected && '✓'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 출제 문제 카테고리 필터 (접이식) */}
          <div style={{ background: '#0f172a', borderRadius: '14px', border: '1px solid #334155', overflow: 'hidden' }}>
            <div
              onClick={() => setIsCategoryPanelOpen(prev => !prev)}
              style={{
                padding: '12px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                userSelect: 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#818cf8' }}>🎯 출제 문제 카테고리 필터</span>
                <span style={{ fontSize: '0.78rem', color: '#4ade80', background: 'rgba(74, 222, 128, 0.15)', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                  {currentSelectedCategories.length}개 선택됨 (출제 가능 {totalAvailableQuizzesCount}문제)
                </span>
              </div>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                {isCategoryPanelOpen ? '▲ 닫기' : '▼ 펼치기'}
              </span>
            </div>

            {isCategoryPanelOpen && (
              <div style={{ padding: '0 14px 14px 14px', borderTop: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', gap: '8px', margin: '10px 0 12px 0' }}>
                  <button
                    onClick={handleSelectAllCategories}
                    style={{ padding: '6px 12px', background: '#3730a3', color: '#e0e7ff', fontSize: '0.78rem', fontWeight: 700, borderRadius: '6px' }}
                  >
                    ✅ 전체 선택
                  </button>
                  <button
                    onClick={handleDeselectAllCategories}
                    style={{ padding: '6px 12px', background: '#1e293b', color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600, borderRadius: '6px' }}
                  >
                    초기화 (1개만)
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {ALL_QUIZ_CATEGORIES.map((cat) => {
                    const isChecked = currentSelectedCategories.includes(cat);
                    const count = quizzes.filter(q => q.category === cat && q.isApproved).length;
                    return (
                      <label
                        key={cat}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 10px',
                          background: isChecked ? 'rgba(99, 102, 241, 0.25)' : '#1e293b',
                          border: isChecked ? '1.5px solid #818cf8' : '1px solid #334155',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '0.82rem',
                          color: isChecked ? '#ffffff' : '#94a3b8'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleCategory(cat)}
                          style={{ width: '16px', height: '16px', accentColor: '#6366f1', cursor: 'pointer' }}
                        />
                        <span>{cat} ({count})</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ==============================================================
            3. [카드 1: 대기실 및 QR 코드 관리]
           ============================================================== */}
        <section style={{
          background: '#1e293b',
          borderRadius: '20px',
          padding: isMobile ? '16px' : '24px',
          border: '1px solid #334155',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>📱</span>
              <h2 style={{ fontSize: isMobile ? '1.15rem' : '1.3rem', fontWeight: 800, color: '#f8fafc' }}>
                대기실 및 접속 QR 코드 관리
              </h2>
            </div>

            {/* 상단 세그먼트 탭: 사내 Wi-Fi vs 외부 접속(LTE/5G) */}
            <div style={{
              display: 'inline-flex',
              background: '#0f172a',
              padding: '4px',
              borderRadius: '12px',
              border: '1px solid #334155',
              gap: '4px'
            }}>
              <button
                type="button"
                onClick={() => handleQrModeChange('WIFI')}
                style={{
                  padding: isMobile ? '8px 12px' : '8px 18px',
                  borderRadius: '8px',
                  fontSize: isMobile ? '0.82rem' : '0.9rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  background: currentQrMode === 'WIFI' ? '#4f46e5' : 'transparent',
                  color: currentQrMode === 'WIFI' ? '#ffffff' : '#94a3b8',
                  border: currentQrMode === 'WIFI' ? '1px solid #818cf8' : 'none',
                  boxShadow: currentQrMode === 'WIFI' ? '0 2px 8px rgba(79, 70, 229, 0.4)' : 'none'
                }}
              >
                📶 사내 Wi-Fi
              </button>
              <button
                type="button"
                onClick={() => handleQrModeChange('EXTERNAL')}
                style={{
                  padding: isMobile ? '8px 12px' : '8px 18px',
                  borderRadius: '8px',
                  fontSize: isMobile ? '0.82rem' : '0.9rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  background: currentQrMode === 'EXTERNAL' ? '#4f46e5' : 'transparent',
                  color: currentQrMode === 'EXTERNAL' ? '#ffffff' : '#94a3b8',
                  border: currentQrMode === 'EXTERNAL' ? '1px solid #818cf8' : 'none',
                  boxShadow: currentQrMode === 'EXTERNAL' ? '0 2px 8px rgba(79, 70, 229, 0.4)' : 'none'
                }}
              >
                🌐 외부 접속 (LTE/5G)
              </button>
            </div>
          </div>

          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'center' : 'flex-start',
            gap: '20px',
            background: '#0f172a',
            padding: isMobile ? '16px' : '20px',
            borderRadius: '16px',
            border: '1px solid #334155'
          }}>
            {/* QR 미리보기 */}
            <div style={{
              background: '#ffffff',
              padding: '8px',
              borderRadius: '14px',
              display: 'inline-block',
              boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
              flexShrink: 0
            }}>
              {qrCodeDataUrl ? (
                <img src={qrCodeDataUrl} alt="QR Code Preview" style={{ width: '120px', height: '120px', display: 'block' }} />
              ) : (
                <div style={{ width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                  생성 중...
                </div>
              )}
            </div>

            {/* 정보 & 액션 */}
            <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <span style={{
                  padding: '3px 10px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  background: currentQrMode === 'WIFI' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(79, 70, 229, 0.2)',
                  color: currentQrMode === 'WIFI' ? '#4ade80' : '#a5b4fc',
                  border: `1px solid ${currentQrMode === 'WIFI' ? '#22c55e' : '#818cf8'}`
                }}>
                  {currentQrMode === 'WIFI' ? '📶 사내 Wi-Fi 직접 접속 모드' : '🌐 LTE / 5G 외부 접속 모드'}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>TV 전광판 화면과 실시간 동기화</span>
              </div>

              {/* 접속 URL 표시 및 복사 버튼 */}
              <div style={{
                fontSize: isMobile ? '0.82rem' : '0.92rem',
                color: '#38bdf8',
                fontWeight: 700,
                wordBreak: 'break-all',
                background: '#1e293b',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #334155',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginBottom: '14px'
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeQrUrl}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(activeQrUrl);
                    alert('접속 URL이 클립보드에 복사되었습니다:\n' + activeQrUrl);
                  }}
                  style={{
                    background: '#334155',
                    color: '#f8fafc',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    flexShrink: 0
                  }}
                >
                  📋 복사
                </button>
              </div>

              {/* 액션 버튼 2개: QR 이미지 다운로드 & QR 실시간 갱신 */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {qrCodeDataUrl && (
                  <a
                    href={qrCodeDataUrl}
                    download={currentQrMode === 'WIFI' ? 'quiz-qr-internal-wifi.png' : 'quiz-qr-external-lte.png'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: currentQrMode === 'WIFI' ? '#16a34a' : '#2563eb',
                      color: '#ffffff',
                      padding: '10px 18px',
                      borderRadius: '10px',
                      fontSize: '0.88rem',
                      textDecoration: 'none',
                      fontWeight: 800,
                      boxShadow: currentQrMode === 'WIFI' ? '0 4px 12px rgba(22, 163, 74, 0.4)' : '0 4px 12px rgba(37, 99, 235, 0.4)'
                    }}
                  >
                    <span>📥</span>
                    <span>QR 이미지 다운로드</span>
                  </a>
                )}
                <button
                  onClick={handleRegenerateQr}
                  style={{
                    minHeight: '44px',
                    padding: '10px 16px',
                    background: '#0d9488',
                    color: 'white',
                    fontWeight: 800,
                    fontSize: '0.88rem',
                    borderRadius: '10px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>🔄</span>
                  <span>대기실 QR 실시간 갱신</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ==============================================================
            4. [카드 3: 전광판 사운드 및 연출 제어 (접이식/아코디언)]
           ============================================================== */}
        <section style={{
          background: '#1e293b',
          borderRadius: '20px',
          padding: isMobile ? '16px' : '20px 24px',
          border: '1px solid #334155',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
        }}>
          <div
            onClick={() => setIsSoundPanelOpen(prev => !prev)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>🔊</span>
              <h2 style={{ fontSize: isMobile ? '1.15rem' : '1.3rem', fontWeight: 800, color: '#f8fafc' }}>
                전광판 사운드 & 연출 제어
              </h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                {bgmEnabled ? `🎵 BGM ${Math.round(bgmVolume * 100)}%` : '🔇 BGM 음소거'} | 🎙️ 낭독 {ttsEnabled ? 'ON' : 'OFF'} | 초침 {Math.round(tickVolume * 100)}%
              </span>
              <span style={{ fontSize: '1rem', color: '#cbd5e1' }}>
                {isSoundPanelOpen ? '▲' : '▼'}
              </span>
            </div>
          </div>

          {isSoundPanelOpen && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #334155' }}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                {/* 1. BGM 음량 슬라이더 & 원터치 음소거 토글 */}
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '14px', border: '1px solid #334155' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#38bdf8' }}>
                      🔊 전체 BGM 볼륨 (0% ~ 100%)
                    </span>
                    <button
                      onClick={handleBgmToggle}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '6px',
                        background: bgmEnabled ? '#22c55e' : '#64748b',
                        color: 'white',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        border: 'none',
                        cursor: 'pointer'
                      }}
                      title={bgmEnabled ? '전광판 BGM 음소거' : '전광판 BGM 켜기'}
                    >
                      {bgmEnabled ? '소리 ON' : '음소거 MUTE'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={bgmEnabled ? bgmVolume : 0}
                      onChange={(e) => handleBgmVolumeChange(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: '#38bdf8', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc', width: '45px', textAlign: 'right' }}>
                      {bgmEnabled ? `${Math.round(bgmVolume * 100)}%` : '0%'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
                    TV 전광판 문제 풀이 배경음악의 음량을 실시간 원격 조절합니다.
                  </div>
                </div>

                {/* 2. 문제 사전 낭독 (TTS 음성) ON/OFF 토글 스위치 */}
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '14px', border: '1px solid #334155' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#34d399' }}>
                      🎙️ 문제 사전 낭독 (TTS 음성)
                    </span>
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: ttsEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.2)',
                      color: ttsEnabled ? '#34d399' : '#94a3b8',
                      fontWeight: 700
                    }}>
                      {ttsEnabled ? '한국어 음성 낭독' : '음성 꺼짐 (텍스트만)'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <button
                      onClick={handleTtsToggle}
                      style={{
                        flex: 1,
                        padding: '8px 16px',
                        borderRadius: '8px',
                        background: ttsEnabled ? 'linear-gradient(135deg, #059669, #10b981)' : '#334155',
                        border: ttsEnabled ? '1px solid #34d399' : '1px solid #475569',
                        color: 'white',
                        fontSize: '0.88rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                      }}
                      title="TV 화면 문제 낭독 음성 ON/OFF 토글"
                    >
                      {ttsEnabled ? '🗣️ 음성 낭독 활성화됨 (ON)' : '🔇 음성 낭독 비활성화됨 (OFF)'}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    TV 전광판에서 보기가 열리기 전 문제를 음성으로 읽어줄지 원격 제어합니다.
                  </div>
                </div>

                {/* 3. 초침 효과음 볼륨 슬라이더 */}
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '14px', border: '1px solid #334155' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f59e0b' }}>
                      ⏱️ 3초 전 초침 효과음 (Tick-Tock)
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      고출력 아날로그 시계
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.05}
                      value={tickVolume}
                      onChange={(e) => handleTickVolumeChange(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: '#f59e0b', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc', width: '45px', textAlign: 'right' }}>
                      {Math.round(tickVolume * 100)}%
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
                    문제 마감 3초 전 TV 화면 대형 시계 연출과 함께 울리는 초침 볼륨입니다.
                  </div>
                </div>
              </div>

              {/* 전광판 효과음 즉시 테스트 버튼 */}
              <div style={{ background: '#0f172a', padding: '14px', borderRadius: '14px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#cbd5e1', marginBottom: '8px' }}>
                  📢 TV 전광판 효과음 즉시 송출 테스트
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {[
                    { label: '🔔 시작음', type: 'GAME_START' as SoundEffectType },
                    { label: '⏱️ 초침 째깍', type: 'COUNTDOWN_URGENT' as SoundEffectType },
                    { label: '🚨 타임오버 버저', type: 'TIMEOUT' as SoundEffectType },
                    { label: '✅ 정답 효과음', type: 'CORRECT' as SoundEffectType },
                    { label: '❌ 오답 효과음', type: 'ELIMINATED' as SoundEffectType },
                    { label: '🎺 우승 팡파레', type: 'WINNER_FANFARE' as SoundEffectType }
                  ].map((sfx) => (
                    <button
                      key={sfx.type}
                      onClick={() => handleTestSound(sfx.type)}
                      style={{
                        padding: '6px 14px',
                        background: '#1e293b',
                        border: '1px solid #475569',
                        color: '#f8fafc',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        borderRadius: '8px'
                      }}
                    >
                      {sfx.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ==============================================================
            5. [카드 4: 실시간 참가자 목록 & 모니터링]
           ============================================================== */}
        <section style={{
          background: '#1e293b',
          borderRadius: '20px',
          padding: isMobile ? '16px' : '20px 24px',
          border: '1px solid #334155',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
        }}>
          <div
            onClick={() => setIsPlayerPanelOpen(prev => !prev)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>👥</span>
              <h2 style={{ fontSize: isMobile ? '1.15rem' : '1.3rem', fontWeight: 800, color: '#f8fafc' }}>
                실시간 참가자 모니터링 ({totalPlayersCount}명)
              </h2>
            </div>
            <span style={{ fontSize: '1rem', color: '#cbd5e1' }}>
              {isPlayerPanelOpen ? '▲ 접기' : '▼ 펼치기'}
            </span>
          </div>

          {isPlayerPanelOpen && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #334155' }}>
              {/* 필터 & 검색 툴바 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
                {/* 탭: 전체 / 생존자 / 탈락자 */}
                <div style={{ display: 'inline-flex', background: '#0f172a', padding: '4px', borderRadius: '10px', border: '1px solid #334155', gap: '4px' }}>
                  <button
                    onClick={() => setPlayerFilter('ALL')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      background: playerFilter === 'ALL' ? '#4f46e5' : 'transparent',
                      color: playerFilter === 'ALL' ? '#ffffff' : '#94a3b8',
                      fontSize: '0.82rem',
                      fontWeight: 700
                    }}
                  >
                    전체 ({totalPlayersCount})
                  </button>
                  <button
                    onClick={() => setPlayerFilter('ALIVE')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      background: playerFilter === 'ALIVE' ? '#16a34a' : 'transparent',
                      color: playerFilter === 'ALIVE' ? '#ffffff' : '#94a3b8',
                      fontSize: '0.82rem',
                      fontWeight: 700
                    }}
                  >
                    생존 ({alivePlayersCount})
                  </button>
                  <button
                    onClick={() => setPlayerFilter('DEAD')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      background: playerFilter === 'DEAD' ? '#dc2626' : 'transparent',
                      color: playerFilter === 'DEAD' ? '#ffffff' : '#94a3b8',
                      fontSize: '0.82rem',
                      fontWeight: 700
                    }}
                  >
                    탈락 ({deadPlayersCount})
                  </button>
                </div>

                {/* 검색 & 정렬 */}
                <div style={{ display: 'flex', gap: '8px', flex: isMobile ? '1 1 100%' : 'none' }}>
                  <input
                    type="text"
                    placeholder="참가자 닉네임 검색..."
                    value={playerSearch}
                    onChange={(e) => setPlayerSearch(e.target.value)}
                    style={{
                      flex: 1,
                      minWidth: '150px',
                      padding: '6px 12px',
                      fontSize: '0.85rem',
                      background: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: 'white'
                    }}
                  />
                  <select
                    value={playerSort}
                    onChange={(e) => setPlayerSort(e.target.value as 'RANK' | 'SCORE' | 'NAME')}
                    style={{
                      padding: '6px 10px',
                      fontSize: '0.85rem',
                      background: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: 'white'
                    }}
                  >
                    <option value="RANK">순위순</option>
                    <option value="SCORE">점수순</option>
                    <option value="NAME">이름순</option>
                  </select>
                </div>
              </div>

              {/* 참가자 스크롤 테이블 */}
              <div style={{ maxHeight: '320px', overflowY: 'auto', background: '#0f172a', borderRadius: '12px', border: '1px solid #334155' }}>
                <table style={{ width: '100%', minWidth: '500px', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ background: '#1e293b', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1, color: '#cbd5e1' }}>
                      <th style={{ padding: '8px 10px', width: '60px', textAlign: 'center' }}>순위</th>
                      <th style={{ padding: '8px 10px' }}>닉네임</th>
                      <th style={{ padding: '8px 10px' }}>상태</th>
                      <th style={{ padding: '8px 10px' }}>점수</th>
                      <th style={{ padding: '8px 10px' }}>탈락 사유</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlayers.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                          조건에 일치하는 참가자가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredPlayers.map((p) => {
                        const rankItem = (gameState.topRankings || []).find(r => r.token === p.token);
                        const rankText = rankItem ? (rankItem.rank === 1 ? '🥇 1' : rankItem.rank === 2 ? '🥈 2' : rankItem.rank === 3 ? '🥉 3' : `${rankItem.rank}위`) : '-';
                        return (
                          <tr key={p.token} style={{ borderBottom: '1px solid #1e293b' }}>
                            <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: rankItem?.rank === 1 ? '#facc15' : '#94a3b8' }}>
                              {rankText}
                            </td>
                            <td style={{ padding: '8px 10px', fontWeight: 700, color: '#f8fafc' }}>
                              {p.nickname}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{
                                padding: '3px 8px',
                                borderRadius: '4px',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                background: p.isAlive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                color: p.isAlive ? '#4ade80' : '#f87171',
                                border: `1px solid ${p.isAlive ? '#22c55e' : '#ef4444'}`
                              }}>
                                {p.isAlive ? '생존' : '탈락'}
                              </span>
                            </td>
                            <td style={{ padding: '8px 10px', color: '#38bdf8', fontWeight: 700 }}>
                              {p.score}점
                            </td>
                            <td style={{ padding: '8px 10px', color: '#94a3b8' }}>
                              {p.eliminatedReason === 'TIMEOUT' ? '시간 초과' : p.eliminatedReason === 'WRONG_ANSWER' ? '오답' : p.eliminatedReason === 'ADMIN_KICK' ? '강제 퇴장' : '-'}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                              {p.isAlive && (
                                <button
                                  onClick={() => handleKick(p.token, p.nickname)}
                                  style={{
                                    padding: '4px 8px',
                                    background: '#ef4444',
                                    color: 'white',
                                    fontSize: '0.75rem',
                                    borderRadius: '6px'
                                  }}
                                >
                                  강제 탈락
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* ==============================================================
            6. [카드 5: 문제은행 관리 (CRUD)]
           ============================================================== */}
        <section style={{
          background: '#1e293b',
          borderRadius: '20px',
          padding: isMobile ? '16px' : '20px 24px',
          border: '1px solid #334155',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
        }}>
          <div
            onClick={() => setIsQuizBankOpen(prev => !prev)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>📚</span>
              <h2 style={{ fontSize: isMobile ? '1.15rem' : '1.3rem', fontWeight: 800, color: '#f8fafc' }}>
                문제은행 관리 (총 {quizzes.length}개 / 승인 {quizzes.filter(q => q.isApproved).length}개)
              </h2>
            </div>
            <span style={{ fontSize: '1rem', color: '#cbd5e1' }}>
              {isQuizBankOpen ? '▲ 접기' : '▼ 문제 추가 및 목록'}
            </span>
          </div>

          {isQuizBankOpen && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #334155' }}>
              {/* 신규 문제 등록 폼 */}
              <form onSubmit={handleAddQuiz} style={{ background: '#0f172a', padding: '16px', borderRadius: '14px', marginBottom: '16px', border: '1px solid #334155' }}>
                <h4 style={{ fontSize: '0.95rem', color: '#38bdf8', fontWeight: 800, marginBottom: '12px' }}>➕ 새 문제 직접 등록</h4>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                  <input
                    type="text"
                    placeholder="문제 제목 입력"
                    value={newQuiz.question}
                    onChange={(e) => setNewQuiz({ ...newQuiz, question: e.target.value })}
                    style={{ minHeight: '44px', width: '100%' }}
                  />
                  <select
                    value={newQuiz.category}
                    onChange={(e) => setNewQuiz({ ...newQuiz, category: e.target.value as QuizCategory })}
                    style={{ minHeight: '44px', width: '100%', background: '#1e293b', color: 'white' }}
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
                    style={{ minHeight: '44px', width: '100%' }}
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
                      style={{ minHeight: '44px', width: '100%' }}
                    />
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr auto', gap: '10px' }}>
                  <select
                    value={newQuiz.answerIndex}
                    onChange={(e) => setNewQuiz({ ...newQuiz, answerIndex: Number(e.target.value) })}
                    style={{ minHeight: '44px', width: '100%', background: '#1e293b', color: 'white' }}
                  >
                    <option value={0}>정답: 보기 1</option>
                    <option value={1}>정답: 보기 2</option>
                    <option value={2}>정답: 보기 3</option>
                    <option value={3}>정답: 보기 4</option>
                  </select>
                  <input
                    type="text"
                    placeholder="정답 해설 (선택사항)"
                    value={newQuiz.explanation}
                    onChange={(e) => setNewQuiz({ ...newQuiz, explanation: e.target.value })}
                    style={{ minHeight: '44px', width: '100%' }}
                  />
                  <button type="submit" style={{ padding: '10px 24px', minHeight: '44px', background: '#4f46e5', color: 'white', fontWeight: 800, borderRadius: '10px' }}>
                    등록하기
                  </button>
                </div>
              </form>

              {/* 문제 목록 테이블 */}
              <div style={{ maxHeight: '300px', overflowY: 'auto', background: '#0f172a', borderRadius: '12px', border: '1px solid #334155' }}>
                <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#1e293b', textAlign: 'left', color: '#cbd5e1' }}>
                      <th style={{ padding: '8px 10px', width: '50px' }}>ID</th>
                      <th style={{ padding: '8px 10px', width: '120px' }}>카테고리</th>
                      <th style={{ padding: '8px 10px' }}>문제</th>
                      <th style={{ padding: '8px 10px' }}>정답</th>
                      <th style={{ padding: '8px 10px', width: '70px' }}>제한시간</th>
                      <th style={{ padding: '8px 10px', width: '70px' }}>승인</th>
                      <th style={{ padding: '8px 10px', width: '60px' }}>삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quizzes.map((q) => (
                      <tr key={q.id} style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '8px 10px', color: '#94a3b8' }}>#{q.id}</td>
                        <td style={{ padding: '8px 10px', color: '#38bdf8' }}>{q.category}</td>
                        <td style={{ padding: '8px 10px', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {q.question}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#4ade80' }}>
                          보기 {q.answerIndex + 1} ({q.options[q.answerIndex]})
                        </td>
                        <td style={{ padding: '8px 10px' }}>{q.timeLimit}초</td>
                        <td style={{ padding: '8px 10px' }}>
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
                            {q.isApproved ? '승인' : '미승인'}
                          </button>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
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
          )}
        </section>
      </main>

      {/* ==============================================================
          🚨 [모달: 비상 제어 및 초기화 센터]
         ============================================================== */}
      {showEmergencyModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.82)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
        }}>
          <div style={{
            background: '#1e293b', border: '2px solid #ef4444', borderRadius: '20px',
            maxWidth: '460px', width: '100%', padding: '24px', boxShadow: '0 20px 50px rgba(239, 68, 68, 0.35)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #334155', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.4rem' }}>🚨</span>
                <h3 style={{ fontSize: '1.25rem', color: '#f87171', fontWeight: 900 }}>비상 제어 및 초기화 센터</h3>
              </div>
              <button
                onClick={() => setShowEmergencyModal(false)}
                style={{ background: 'transparent', color: '#94a3b8', fontSize: '1.4rem', padding: '4px' }}
              >
                ✕
              </button>
            </div>

            <p style={{ color: '#cbd5e1', fontSize: '0.88rem', marginBottom: '20px', lineHeight: 1.5 }}>
              예기치 못한 돌발 상황 시 아래 비상 명령을 실행할 수 있습니다. 조작 실수를 방지하기 위해 신중히 선택해주세요.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => {
                  handlePause();
                  setShowEmergencyModal(false);
                }}
                style={{
                  minHeight: '48px',
                  background: '#f59e0b',
                  color: '#0f172a',
                  fontWeight: 800,
                  fontSize: '0.95rem',
                  borderRadius: '10px',
                  textAlign: 'left',
                  padding: '0 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>⏸️ 게임 즉시 일시정지 (Pause)</span>
                <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>타이머 멈춤</span>
              </button>

              <button
                onClick={() => {
                  handleMoveToLobby();
                  setShowEmergencyModal(false);
                }}
                style={{
                  minHeight: '48px',
                  background: '#0284c7',
                  color: 'white',
                  fontWeight: 800,
                  fontSize: '0.95rem',
                  borderRadius: '10px',
                  textAlign: 'left',
                  padding: '0 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>🏠 전원 대기실로 즉시 이동</span>
                <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>TV/모바일 화면 강제 이동</span>
              </button>

              <button
                onClick={() => {
                  setShowEmergencyModal(false);
                  handleClearAllPlayers();
                }}
                style={{
                  minHeight: '48px',
                  background: '#b91c1c',
                  color: 'white',
                  fontWeight: 800,
                  fontSize: '0.95rem',
                  borderRadius: '10px',
                  textAlign: 'left',
                  padding: '0 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>🧹 참가자 전원 퇴장 처리 (0명)</span>
                <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>세션 초기화</span>
              </button>

              <button
                onClick={() => {
                  setShowEmergencyModal(false);
                  handleReset();
                }}
                style={{
                  minHeight: '48px',
                  background: '#e11d48',
                  color: 'white',
                  fontWeight: 800,
                  fontSize: '0.95rem',
                  borderRadius: '10px',
                  textAlign: 'left',
                  padding: '0 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>🔄 게임 완전 초기화 (Reset)</span>
                <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>등수는 보존됨</span>
              </button>
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button
                onClick={() => setShowEmergencyModal(false)}
                style={{ padding: '8px 20px', background: '#334155', color: '#cbd5e1', borderRadius: '8px', fontWeight: 700 }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================
          📜 [모달: 직전 경기 등수 다시보기]
         ============================================================== */}
      {showSavedResultModal && persistedGameResult && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#0f172a', border: '2px solid #6366f1', borderRadius: '20px', maxWidth: '750px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: isMobile ? '16px' : '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '14px', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: isMobile ? '1.1rem' : '1.4rem', color: '#fde047', fontWeight: 800 }}>📜 직전 경기 최종 등수 및 기록</h3>
                <div style={{ fontSize: isMobile ? '0.75rem' : '0.85rem', color: '#94a3b8', marginTop: '4px' }}>
                  종료: {persistedGameResult.endedAt} | 우승: <strong style={{ color: '#facc15' }}>{persistedGameResult.winnerNickname || (persistedGameResult.isDraw ? '무승부' : '없음')}</strong> | 총 {persistedGameResult.rankings.length}명
                </div>
              </div>
              <button
                onClick={() => setShowSavedResultModal(false)}
                style={{ background: 'transparent', color: '#94a3b8', fontSize: '1.6rem', padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ width: '100%', minWidth: '420px', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: '#1e293b', color: '#cbd5e1', position: 'sticky', top: 0, zIndex: 1 }}>
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
                style={{ padding: '8px 16px', background: '#16a34a', color: 'white', borderRadius: '8px', fontWeight: 700 }}
              >
                📊 엑셀 다운로드
              </button>
              <button
                onClick={() => setShowSavedResultModal(false)}
                style={{ padding: '8px 24px', background: '#475569', color: 'white', borderRadius: '8px' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================
          🔒 [모달: 관리자 비밀번호 변경]
         ============================================================== */}
      {showPwChangeModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.8)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
        }}>
          <div style={{
            background: '#1e293b', border: '1px solid #475569', borderRadius: '20px',
            maxWidth: '420px', width: '100%', padding: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.8)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #334155', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '1.2rem', color: '#f8fafc', fontWeight: 800 }}>🔒 관리자 비밀번호 변경</h3>
              <button
                onClick={() => setShowPwChangeModal(false)}
                style={{ background: 'transparent', color: '#94a3b8', fontSize: '1.4rem', padding: '4px' }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '6px' }}>현재 비밀번호</label>
                <input
                  type="password"
                  value={currentPwInput}
                  onChange={(e) => setCurrentPwInput(e.target.value)}
                  placeholder="현재 관리자 비밀번호 입력"
                  style={{ width: '100%', height: '46px', padding: '0 12px', fontSize: '0.95rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '6px' }}>새 비밀번호 (4자리 이상)</label>
                <input
                  type="password"
                  value={newPwInput}
                  onChange={(e) => setNewPwInput(e.target.value)}
                  placeholder="새로운 비밀번호 입력"
                  style={{ width: '100%', height: '46px', padding: '0 12px', fontSize: '0.95rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '6px' }}>새 비밀번호 확인</label>
                <input
                  type="password"
                  value={confirmPwInput}
                  onChange={(e) => setConfirmPwInput(e.target.value)}
                  placeholder="새 비밀번호 다시 입력"
                  style={{ width: '100%', height: '46px', padding: '0 12px', fontSize: '0.95rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: 'white' }}
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
                  style={{ flex: 1, height: '48px', padding: '12px', background: '#6366f1', color: 'white', fontWeight: 800, borderRadius: '8px' }}
                >
                  변경 저장
                </button>
                <button
                  type="button"
                  onClick={() => setShowPwChangeModal(false)}
                  style={{ height: '48px', padding: '12px 18px', background: '#334155', color: '#cbd5e1', borderRadius: '8px' }}
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
