import React, { useState, useEffect, useRef } from 'react';
import { GameState, Player, RoundInfo, RoundResult, ChatMessage } from '@quiz/shared';
import { socket } from '../socket';
import { soundEngine } from '../utils/sound';

const TOKEN_KEY = 'quiz_survival_player_token';

interface PlayerViewProps {
  gameState: GameState;
}

export const PlayerView: React.FC<PlayerViewProps> = ({ gameState }) => {
  const [nicknameInput, setNicknameInput] = useState(() => localStorage.getItem('quiz_survival_player_nickname') || '');
  const [player, setPlayer] = useState<Player | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [roundInfo, setRoundInfo] = useState<RoundInfo | undefined>(gameState.currentRoundInfo);
  const [roundResult, setRoundResult] = useState<RoundResult | undefined>(gameState.lastRoundResult);
  const [soundUnlocked, setSoundUnlocked] = useState(false);

  // 채팅 상태
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const desktopChatScrollRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 생존자/탈락자 명단 모달
  const [showRoster, setShowRoster] = useState(false);

  // 닉네임 수정 상태
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [editNicknameInput, setEditNicknameInput] = useState('');
  const [editNickError, setEditNickError] = useState('');

  // 문제 풀이 실시간 카운트다운 타이머 (초)
  const [secondsLeft, setSecondsLeft] = useState<number>(15);
  const lastVibrateSecRef = useRef<number | null>(null);

  useEffect(() => {
    if (gameState.status === 'IN_ROUND' && roundInfo?.serverEndTime) {
      const updateTimer = () => {
        const remaining = Math.max(0, Math.ceil((roundInfo.serverEndTime - Date.now()) / 1000));
        setSecondsLeft(remaining);

        // 3초 전 촉각 진동 (Haptic Vibration) 연출
        if (lastVibrateSecRef.current !== remaining) {
          lastVibrateSecRef.current = remaining;
          if (remaining <= 3 && remaining > 0) {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try {
                navigator.vibrate([100, 80, 100]);
              } catch {}
            }
          }
        }
      };
      updateTimer();
      const interval = setInterval(updateTimer, 200);
      return () => clearInterval(interval);
    } else {
      lastVibrateSecRef.current = null;
    }
  }, [gameState.status, roundInfo]);

  // 1. 로컬 스토리지 토큰으로 자동 재접속/상태 복구 및 소켓 재연결 시 자동 재등록
  const restorePlayerSession = () => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedNick = localStorage.getItem('quiz_survival_player_nickname') || '';
    if (savedToken) {
      socket.emit('player:join', { nickname: savedNick, token: savedToken }, (res) => {
        if (res.success && res.player) {
          setPlayer(res.player);
          localStorage.setItem(TOKEN_KEY, res.player.token);
          localStorage.setItem('quiz_survival_player_nickname', res.player.nickname);
        } else {
          // 세션 복구 실패 시 (만료된 세션, 재시작된 서버 등)
          // 잘못된 토큰을 지워 새로 깨끗이 입장할 수 있도록 처리
          localStorage.removeItem(TOKEN_KEY);
          setPlayer(null);
        }
      });
    }
  };

  // 참가자 자발적 퇴장 (뒤로가기, 창 닫기, 나가기 버튼 클릭 시)
  const handleLeaveLobby = (isUnload = false) => {
    const savedToken = localStorage.getItem(TOKEN_KEY) || player?.token;
    if (savedToken) {
      try {
        socket.emit('player:leave', { token: savedToken });
      } catch {}
    }
    localStorage.removeItem(TOKEN_KEY);
    setPlayer(null);
    if (!isUnload) {
      socket.disconnect();
      setTimeout(() => {
        socket.connect();
      }, 150);
    }
  };

  // 스마트폰 뒤로가기(popstate) 및 창닫기(beforeunload, pagehide) 감지하여 즉시 퇴장 처리
  useEffect(() => {
    const onPopState = () => {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (savedToken || player) {
        handleLeaveLobby(false);
      }
    };

    const onBeforeUnload = () => {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (savedToken && gameState.status === 'WAITING') {
        try {
          socket.emit('player:leave', { token: savedToken });
          socket.disconnect();
        } catch {}
        localStorage.removeItem(TOKEN_KEY);
      }
    };

    const onPageHide = () => {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (savedToken && gameState.status === 'WAITING') {
        try {
          socket.emit('player:leave', { token: savedToken });
          socket.disconnect();
        } catch {}
        localStorage.removeItem(TOKEN_KEY);
      }
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [player, gameState.status]);

  useEffect(() => {
    restorePlayerSession();

    const handleConnect = () => {
      restorePlayerSession();
    };

    socket.on('connect', handleConnect);
    return () => {
      socket.off('connect', handleConnect);
    };
  }, []);

  // 2. 최신 게임 상태에서 내 정보 갱신 및 대기실 리셋 처리
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY) || player?.token;
    if (savedToken) {
      const me = gameState.players.find(p => p.token === savedToken);
      if (me) {
        setPlayer(me);
      }
    }

    if (gameState.status === 'WAITING' || gameState.status === 'STARTING') {
      setRoundInfo(undefined);
      setRoundResult(undefined);
      setSelectedOption(null);
      setIsSubmitted(false);
      setShowRoster(false);
      setPlayer((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          isAlive: true,
          score: 0,
          eliminatedRound: undefined,
          eliminatedReason: undefined,
          selectedAnswer: undefined,
          answeredAt: undefined
        };
      });
    } else {
      if (gameState.currentRoundInfo) {
        setRoundInfo(gameState.currentRoundInfo);
      }
      if (gameState.lastRoundResult) {
        setRoundResult(gameState.lastRoundResult);
      }
    }
  }, [gameState]);

  // 3. 소켓 이벤트 및 채팅 수신
  useEffect(() => {
    const handleRoundStart = (info: RoundInfo) => {
      setRoundInfo(info);
      setRoundResult(undefined);
      setSelectedOption(null);
      setIsSubmitted(false);
    };

    const handleRoundEnd = (result: RoundResult) => {
      setRoundResult(result);
    };

    const handleChatMessage = (msg: ChatMessage) => {
      setChatMessages((prev) => [...prev.slice(-49), msg]);
      setUnreadCount((c) => c + 1);
    };

    const handleChatHistory = (history: ChatMessage[]) => {
      setChatMessages(history);
    };

    const handleChatCleared = () => {
      setChatMessages([]);
      setUnreadCount(0);
    };

    // 전원 강제 대기실 이동 수신
    const handleForceLobby = () => {
      setRoundInfo(undefined);
      setRoundResult(undefined);
      setSelectedOption(null);
      setIsSubmitted(false);
      setShowRoster(false);
      setPlayer((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          isAlive: true,
          score: 0,
          eliminatedRound: undefined,
          eliminatedReason: undefined,
          selectedAnswer: undefined,
          answeredAt: undefined
        };
      });
    };

    const handlePlayerKickedAll = () => {
      localStorage.removeItem(TOKEN_KEY);
      setPlayer(null);
      setRoundInfo(undefined);
      setRoundResult(undefined);
      setSelectedOption(null);
      setIsSubmitted(false);
      setShowRoster(false);
    };

    socket.on('game:round_started', handleRoundStart);
    socket.on('game:round_ended', handleRoundEnd);
    socket.on('chat:message', handleChatMessage);
    socket.on('chat:history', handleChatHistory);
    socket.on('chat:cleared', handleChatCleared);
    socket.on('game:force_lobby', handleForceLobby);
    socket.on('game:player_kicked_all', handlePlayerKickedAll);

    return () => {
      socket.off('game:round_started', handleRoundStart);
      socket.off('game:round_ended', handleRoundEnd);
      socket.off('chat:message', handleChatMessage);
      socket.off('chat:history', handleChatHistory);
      socket.off('chat:cleared', handleChatCleared);
      socket.off('game:force_lobby', handleForceLobby);
      socket.off('game:player_kicked_all', handlePlayerKickedAll);
    };
  }, []);

  // 모바일 채팅창 열림 또는 데스크톱 전환 시 읽지 않은 수 초기화
  useEffect(() => {
    if (isChatOpen || !isMobile) {
      setUnreadCount(0);
    }
  }, [isChatOpen, isMobile]);

  // 채팅 스크롤 자동 이동 (모바일 및 데스크톱)
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
    if (desktopChatScrollRef.current) {
      desktopChatScrollRef.current.scrollTop = desktopChatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatOpen]);

  const handleUnlockAudio = () => {
    soundEngine.enable();
    setSoundUnlocked(true);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nicknameInput.trim()) return;
    setErrorMessage('');
    handleUnlockAudio();

    socket.emit('player:join', { nickname: nicknameInput.trim() }, (res) => {
      if (res.success && res.player) {
        setPlayer(res.player);
        localStorage.setItem(TOKEN_KEY, res.player.token);
        localStorage.setItem('quiz_survival_player_nickname', res.player.nickname);
        try {
          window.history.pushState({ inLobby: true }, '', window.location.href);
        } catch {}
      } else {
        setErrorMessage(res.message || '참가에 실패했습니다.');
      }
    });
  };

  const handleSelectOption = (index: number) => {
    if (isSubmitted || gameState.status !== 'IN_ROUND' || !player) return;

    setSelectedOption(index);
    setIsSubmitted(true);
    handleUnlockAudio();

    // token을 항상 동봉하여 전송 (소켓 재연결 시 인증 만료 방지)
    socket.emit('player:submit_answer', {
      answerIndex: index,
      clientTimestamp: Date.now(),
      token: player.token
    }, (res) => {
      if (!res.success) {
        alert(res.message);
        setIsSubmitted(false);
      }
    });
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !player) return;
    socket.emit('chat:send', { message: chatInput.trim(), token: player.token });
    setChatInput('');
  };

  const handleRequestReset = () => {
    setRoundInfo(undefined);
    setRoundResult(undefined);
    setSelectedOption(null);
    setIsSubmitted(false);
    setShowRoster(false);
    setPlayer((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        isAlive: true,
        score: 0,
        eliminatedRound: undefined,
        eliminatedReason: undefined,
        selectedAnswer: undefined,
        answeredAt: undefined
      };
    });
    socket.emit('game:request_reset');
  };

  const handleUpdateNickname = (e: React.FormEvent) => {
    e.preventDefault();
    if (!player) return;
    const trimmed = editNicknameInput.trim();
    if (!trimmed) {
      setEditNickError('변경할 닉네임을 입력해주세요.');
      return;
    }
    setEditNickError('');
    socket.emit('player:update_nickname', { token: player.token, newNickname: trimmed }, (res) => {
      if (res.success && res.player) {
        setPlayer(res.player);
        localStorage.setItem('quiz_survival_player_nickname', res.player.nickname);
        setIsEditingNickname(false);
      } else {
        setEditNickError(res.message || '닉네임 변경에 실패했습니다.');
      }
    });
  };

  const mobileContainerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '460px',
    margin: '0 auto',
    padding: '16px',
    minHeight: '100dvh',
    height: '100dvh',
    maxHeight: '100dvh',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    overflowX: 'hidden',
    overflowY: 'auto'
  };

  // 1. 미입장 상태: 참가 폼
  if (!player) {
    return (
      <div style={{ ...mobileContainerStyle, justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ padding: '20px 0', width: '100%' }}>
          <div style={{ fontSize: '3.2rem', marginBottom: '8px' }}>🔥</div>
          <h1 style={{ fontSize: '1.75rem', color: '#818cf8', fontWeight: 900, marginBottom: '8px', wordBreak: 'keep-all' }}>
            CMB 150인 서바이벌 퀴즈쇼
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '28px', wordBreak: 'keep-all' }}>
            틀리면 즉시 탈락! 최후의 1인에 도전하세요.
          </p>

          <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
            <input
              type="text"
              placeholder="참가자 이름(닉네임) 입력"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              maxLength={10}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '1.15rem',
                textAlign: 'center',
                borderRadius: '14px',
                border: '2px solid #4338ca',
                background: '#0f172a',
                color: 'white',
                boxSizing: 'border-box'
              }}
            />
            {errorMessage && (
              <div style={{ color: '#f87171', fontSize: '0.9rem', fontWeight: 600 }}>
                {errorMessage}
              </div>
            )}
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '1.15rem',
                backgroundColor: '#6366f1',
                color: 'white',
                fontWeight: 800,
                borderRadius: '14px',
                boxShadow: '0 8px 20px rgba(99, 102, 241, 0.4)',
                boxSizing: 'border-box'
              }}
            >
              대기실 입장하기
            </button>
          </form>

          <div style={{ marginTop: '36px', color: '#64748b', fontSize: '0.9rem' }}>
            현재 대기 인원: <strong style={{ color: '#38bdf8' }}>{gameState.players.length}</strong> / 150명
          </div>

          <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #1e293b' }}>
            <button
              type="button"
              onClick={() => window.open('/admin', '_blank')}
              style={{
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#94a3b8',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              🛠️ 관리자 센터 (새창)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. 대기실 상태
  if (gameState.status === 'WAITING' || gameState.status === 'STARTING') {
    const waitingContent = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '10px 0' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>⏳</div>
        <h2 style={{ fontSize: '1.5rem', color: '#f8fafc', fontWeight: 800, marginBottom: '16px' }}>
          대기실 입장 완료
        </h2>
        <div style={{ background: '#1e293b', padding: '16px 18px', borderRadius: '14px', marginBottom: '20px', border: '1px solid #334155', width: '100%', maxWidth: '400px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>나의 닉네임</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#38bdf8' }}>{player.nickname}</div>
            </div>
            <button
              onClick={() => {
                setEditNicknameInput(player.nickname);
                setEditNickError('');
                setIsEditingNickname(true);
              }}
              style={{
                padding: '8px 12px',
                fontSize: '0.85rem',
                background: '#334155',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              ✏️ 수정
            </button>
          </div>
        </div>

        <p style={{ color: '#cbd5e1', fontSize: '1rem', lineHeight: 1.6, wordBreak: 'keep-all', marginBottom: '20px' }}>
          관리자가 게임을 시작할 때까지<br />대형 TV 화면을 바라보며 기다려주세요!
        </p>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowRoster(true)}
            style={{ padding: '10px 16px', background: '#334155', color: '#38bdf8', fontSize: '0.9rem', borderRadius: '10px', border: '1px solid #475569', cursor: 'pointer', fontWeight: 600 }}
          >
            👥 참가자 현황 ({gameState.players.length}명)
          </button>
          {!soundUnlocked && (
            <button
              onClick={handleUnlockAudio}
              style={{ padding: '10px 16px', background: '#334155', color: '#cbd5e1', fontSize: '0.9rem', borderRadius: '10px', border: '1px solid #475569', cursor: 'pointer', fontWeight: 600 }}
            >
              🔊 효과음 켜기
            </button>
          )}
        </div>

        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => handleLeaveLobby(false)}
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#f87171',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            🚪 대기실 나가기 (참가 취소)
          </button>
          <button
            type="button"
            onClick={() => window.open('/admin', '_blank')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: '0.8rem',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            🛠️ 관리자 센터 (새창)
          </button>
        </div>
      </div>
    );
    return renderResponsiveLayout(waitingContent);
  }

  // 4. 게임 종료 화면 (1등 확정 또는 무승부 시 대기실 이동 버튼)
  if (gameState.status === 'GAME_OVER') {
    const isWinner = gameState.winner?.token === player.token;
    const gameOverContent = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '10px 0', overflowY: 'auto', width: '100%' }}>
        <div style={{ fontSize: '3rem', marginBottom: '8px' }}>{isWinner ? '👑' : '🏁'}</div>
        <h1 style={{ fontSize: '1.75rem', color: isWinner ? '#facc15' : '#818cf8', fontWeight: 900, marginBottom: '10px' }}>
          {isWinner ? '🎉 최종 우승! 🎉' : gameState.isDraw ? '🤝 무승부 (전원 탈락)' : '게임 종료'}
        </h1>

        {isWinner ? (
          <div style={{ background: 'rgba(234, 179, 8, 0.2)', border: '2px solid #eab308', borderRadius: '14px', padding: '16px', marginBottom: '16px', maxWidth: '450px', width: '100%', boxSizing: 'border-box' }}>
            <p style={{ fontSize: '1.1rem', color: '#fef08a', fontWeight: 800 }}>
              축하합니다! CMB 150인 서바이벌 최후의 승자입니다!
            </p>
            <div style={{ marginTop: '8px', color: '#fde047', fontSize: '1.2rem', fontWeight: 800 }}>
              점수: {player.score}점
            </div>
          </div>
        ) : (
          <p style={{ color: '#cbd5e1', fontSize: '1rem', marginBottom: '16px' }}>
            우승자: <strong style={{ color: '#facc15' }}>{gameState.winner?.nickname || (gameState.isDraw ? '무승부' : '없음')}</strong>
          </p>
        )}

        {/* 나의 최종 등수 배너 */}
        {(() => {
          const myRankItem = (gameState.topRankings || []).find(r => r.token === player.token);
          const myRank = myRankItem ? `${myRankItem.rank}위` : '순위권';
          return (
            <div style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '12px', padding: '12px', marginBottom: '14px', maxWidth: '450px', width: '100%', boxSizing: 'border-box' }}>
              <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>나의 최종 결과</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f8fafc', marginTop: '4px' }}>
                {player.nickname} 님: <span style={{ color: '#facc15' }}>{myRank}</span> ({player.score}점)
              </div>
            </div>
          );
        })()}

        {/* 최종 TOP 10 명예의 전당 */}
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '12px', padding: '12px', marginBottom: '16px', textAlign: 'left', maxWidth: '450px', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fde047', marginBottom: '8px', textAlign: 'center' }}>
            🏆 최종 명예의 전당 (TOP 1~10위)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
            {(gameState.topRankings || []).map((r) => {
              const isMe = r.token === player.token;
              const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}위`;
              return (
                <div key={r.token} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: isMe ? 'rgba(99, 102, 241, 0.25)' : '#1e293b', border: isMe ? '1px solid #6366f1' : '1px solid #334155', borderRadius: '8px', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 800, width: '28px', textAlign: 'center' }}>{medal}</span>
                    <span style={{ fontWeight: isMe ? 800 : 600, color: isMe ? '#818cf8' : '#f8fafc' }}>
                      {r.nickname} {isMe && '(나)'}
                    </span>
                    {r.isAlive && <span style={{ fontSize: '0.7rem', color: '#86efac', background: '#166534', padding: '1px 4px', borderRadius: '4px' }}>생존</span>}
                  </div>
                  <div style={{ fontWeight: 700, color: '#38bdf8' }}>{r.score}점</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 최종 결과 영구 유지 안내 배너 */}
        <div style={{
          padding: '12px 20px',
          background: 'rgba(99, 102, 241, 0.15)',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          borderRadius: '12px',
          color: '#c7d2fe',
          fontSize: '0.92rem',
          fontWeight: 700,
          marginBottom: '12px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>⏳</span>
          <span>관리자가 새 게임을 시작할 때까지 최종 결과 화면이 유지됩니다.</span>
        </div>
      </div>
    );
    return renderResponsiveLayout(gameOverContent);
  }

  // 5. 라운드 진행 중 (문제 풀이, 답변 제출, 및 관전자 모드)
  const currentOptions = roundResult?.options || roundInfo?.options || ['', '', '', ''];
  const hasOptions = currentOptions.some(opt => opt && opt.trim().length > 0);

  const inRoundContent = (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', flex: 1 }}>
      {/* 👁️ 관전자 모드 상단 고정 배너 */}
      {!player.isAlive && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(90deg, rgba(88, 28, 135, 0.7), rgba(30, 41, 59, 0.9))',
          border: '1.5px solid #a855f7',
          borderRadius: '10px',
          padding: '7px 12px',
          marginBottom: '8px',
          boxShadow: '0 2px 10px rgba(168, 85, 247, 0.25)',
          flexShrink: 0
        }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.82rem',
            fontWeight: 800,
            color: '#f3e8ff'
          }}>
            <span style={{ fontSize: '0.9rem' }}>👁️</span>
            <span>[관전자 모드 - 연습 풀이 중]</span>
          </span>
          <span style={{
            fontSize: '0.78rem',
            color: '#cbd5e1',
            fontWeight: 700
          }}>
            현재 생존자: <strong style={{ color: '#4ade80' }}>{gameState.survivors.length}명</strong>
          </span>
        </div>
      )}

      {/* 상단: 타이머 및 라운드/상태 정보 */}
      <div style={{ flexShrink: 0, marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '1.15rem', fontWeight: 900, color: '#f59e0b' }}>
              R{roundInfo?.roundNumber ?? gameState.currentRound}
            </span>
            <span style={{
              background: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              color: '#a5b4fc',
              fontSize: '0.78rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '6px'
            }}>
              {roundInfo?.category || '퀴즈'}
            </span>
            {gameState.status === 'QUESTION_READING' && (
              <span style={{
                marginLeft: '4px',
                fontSize: '0.85rem',
                fontWeight: 800,
                color: '#fbbf24',
                background: 'rgba(251, 191, 36, 0.15)',
                border: '1px solid rgba(251, 191, 36, 0.4)',
                padding: '2px 8px',
                borderRadius: '6px',
                animation: 'pulse 1.2s infinite'
              }}>
                🎙️ 낭독 중...
              </span>
            )}
            {gameState.status === 'IN_ROUND' && (
              <span style={{
                marginLeft: '4px',
                fontSize: secondsLeft <= 3 ? '1rem' : '0.95rem',
                fontWeight: 900,
                color: secondsLeft <= 3 ? '#ef4444' : secondsLeft <= 5 ? '#f87171' : '#38bdf8',
                background: secondsLeft <= 3 ? 'rgba(239, 68, 68, 0.25)' : secondsLeft <= 5 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                border: secondsLeft <= 3 ? '1.5px solid #ef4444' : secondsLeft <= 5 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(56, 189, 248, 0.3)',
                padding: '2px 8px',
                borderRadius: '6px',
                animation: secondsLeft <= 3 ? 'heartbeat 0.6s infinite' : 'none',
                boxShadow: secondsLeft <= 3 ? '0 0 15px rgba(239, 68, 68, 0.7)' : 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                {secondsLeft <= 3 ? (
                  <span style={{ display: 'inline-block', animation: 'shake 0.3s infinite' }}>⏰</span>
                ) : (
                  <span>⏱️</span>
                )}
                <span>{secondsLeft}초</span>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => {
                setEditNicknameInput(player.nickname);
                setEditNickError('');
                setIsEditingNickname(true);
              }}
              style={{ background: '#1e293b', color: '#cbd5e1', fontSize: '0.75rem', padding: '3px 8px', borderRadius: '6px', border: '1px solid #334155' }}
            >
              {player.nickname} ✏️
            </button>
            <button
              onClick={() => setShowRoster(true)}
              style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#4ade80', fontSize: '0.75rem', fontWeight: 700, padding: '3px 8px', borderRadius: '6px' }}
            >
              생존 {gameState.survivors.length}명
            </button>
          </div>
        </div>
      </div>

      {/* 중앙: 문제 텍스트 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'linear-gradient(180deg, #1e293b, #0f172a)',
          borderRadius: '14px',
          padding: '14px',
          border: (secondsLeft <= 3 && gameState.status === 'IN_ROUND')
            ? '2px solid #ef4444'
            : gameState.status === 'QUESTION_READING'
            ? '1.5px solid #facc15'
            : '1px solid rgba(255,255,255,0.12)',
          boxShadow: (secondsLeft <= 3 && gameState.status === 'IN_ROUND')
            ? '0 0 25px rgba(239, 68, 68, 0.7)'
            : '0 4px 16px rgba(0, 0, 0, 0.3)',
          animation: (secondsLeft <= 3 && gameState.status === 'IN_ROUND')
            ? 'redWarningBorder 0.8s infinite'
            : 'none',
          marginBottom: '8px',
          minHeight: '80px',
          maxHeight: isMobile ? '140px' : '180px',
          overflowY: 'auto',
          flexShrink: 0,
          transition: 'border-color 0.3s ease'
        }}
      >
        <h2 style={{
          fontSize: isMobile ? '1.12rem' : '1.35rem',
          color: '#f8fafc',
          lineHeight: 1.45,
          wordBreak: 'keep-all',
          textAlign: 'center',
          fontWeight: 800,
          margin: 0
        }}>
          {roundInfo?.question || roundResult?.question || '문제를 로딩 중입니다...'}
        </h2>
        {gameState.status === 'QUESTION_READING' && (
          <div style={{
            marginTop: '6px',
            color: '#fbbf24',
            fontSize: '0.82rem',
            fontWeight: 800,
            animation: 'pulse 1.2s infinite'
          }}>
            🎙️ 문제를 낭독하고 있습니다. 잠시 후 보기가 공개됩니다...
          </div>
        )}
        {isSubmitted && gameState.status === 'IN_ROUND' && (
          <div style={{
            marginTop: '6px',
            color: player.isAlive ? '#38bdf8' : '#c084fc',
            fontSize: '0.8rem',
            fontWeight: 700
          }}>
            {player.isAlive
              ? '✔ 답변 제출 완료! 대형 TV 화면을 주목해주세요.'
              : '✔ 연습 답변 제출 완료! (공식 결과에 영향 없음)'}
          </div>
        )}
      </div>

      {/* 4지선다 선택지 버튼 (낭독 단계 시 블러 및 안내 오버레이) */}
      {hasOptions && (
        <div style={{
          position: 'relative',
          display: isMobile ? 'flex' : 'grid',
          gridTemplateColumns: isMobile ? undefined : '1fr 1fr',
          flexDirection: isMobile ? 'column' : undefined,
          gap: '8px',
          marginBottom: '8px',
          flexShrink: 0
        }}>
          {gameState.status === 'QUESTION_READING' && (
            <div style={{
              position: 'absolute',
              inset: 0,
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(15, 23, 42, 0.6)',
              borderRadius: '12px',
              backdropFilter: 'blur(3px)',
              border: '1.5px solid rgba(251, 191, 36, 0.4)',
              padding: '12px'
            }}>
              <div style={{ fontSize: '1.6rem', marginBottom: '4px', animation: 'pulse 1.2s infinite' }}>🎙️</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#fef08a', textAlign: 'center', wordBreak: 'keep-all' }}>
                문제 사전 낭독 중
              </div>
              <div style={{ fontSize: '0.78rem', color: '#cbd5e1', marginTop: '3px', textAlign: 'center', wordBreak: 'keep-all' }}>
                잠시 후 보기가 공개되면 즉시 답을 선택하세요!
              </div>
            </div>
          )}

          {currentOptions.map((opt, idx) => {
            const isSelected = selectedOption === idx;
            let bg = '#1e293b';
            let border = '2px solid transparent';
            let color = '#f8fafc';

            if (isSelected) {
              bg = player.isAlive ? '#4f46e5' : '#7c3aed';
              border = player.isAlive ? '2px solid #a5b4fc' : '2px solid #c084fc';
              color = 'white';
            }

            if (gameState.status === 'ROUND_RESULT' && roundResult) {
              if (idx === roundResult.correctAnswerIndex) {
                bg = '#15803d';
                border = '2px solid #4ade80';
                color = '#ffffff';
              } else if (isSelected) {
                bg = '#b91c1c';
                border = '2px solid #f87171';
              }
            }

            return (
              <button
                key={idx}
                onClick={() => handleSelectOption(idx)}
                disabled={isSubmitted || gameState.status !== 'IN_ROUND'}
                style={{
                  background: bg,
                  border,
                  color,
                  padding: gameState.status === 'ROUND_RESULT' ? '8px 12px' : '10px 14px',
                  fontSize: '0.98rem',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: '10px',
                  minHeight: gameState.status === 'ROUND_RESULT' ? '44px' : '52px',
                  touchAction: 'manipulation',
                  wordBreak: 'keep-all',
                  boxShadow: isSelected ? '0 4px 12px rgba(79, 70, 229, 0.4)' : 'none',
                  filter: gameState.status === 'QUESTION_READING' ? 'blur(6px)' : 'none',
                  opacity: gameState.status === 'QUESTION_READING' ? 0.4 : 1,
                  animation: gameState.status === 'IN_ROUND' ? 'optionsReveal 0.4s ease-out' : 'none',
                  transition: 'filter 0.3s ease, opacity 0.3s ease'
                }}
              >
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: isSelected ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)',
                  marginRight: '10px',
                  fontWeight: 900,
                  fontSize: '0.85rem',
                  flexShrink: 0
                }}>
                  {idx + 1}
                </span>
                <span style={{ flex: 1, wordBreak: 'keep-all', fontWeight: isSelected ? 800 : 600 }}>{opt}</span>
                {gameState.status === 'ROUND_RESULT' && roundResult && (
                  <span style={{ marginLeft: '6px', fontSize: '1rem', flexShrink: 0 }}>
                    {idx === roundResult.correctAnswerIndex ? '⭕' : isSelected ? '❌' : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 🎯 라운드 결과 발표 상세 카드 섹션 */}
      {gameState.status === 'ROUND_RESULT' && roundResult && (() => {
        const correctIdx = roundResult.correctAnswerIndex;
        const correctText = currentOptions[correctIdx] || '';
        const hasSelected = selectedOption !== null && selectedOption !== undefined;
        const isCorrect = hasSelected && selectedOption === correctIdx;
        const mySelectedText = hasSelected ? (currentOptions[selectedOption] || '') : '';
        const isSpectator = !player.isAlive;
        const wasEliminatedThisRound = isSpectator && player.eliminatedRound === (roundResult.roundNumber || gameState.currentRound);

        return (
          <div style={{
            marginBottom: '8px',
            padding: '12px 14px',
            background: 'linear-gradient(180deg, #0f172a, #1e1b4b)',
            borderRadius: '14px',
            border: isCorrect ? '2px solid #22c55e' : '2px solid #ef4444',
            boxShadow: isCorrect ? '0 4px 18px rgba(34, 197, 94, 0.25)' : '0 4px 18px rgba(239, 68, 68, 0.25)',
            flexShrink: 0,
            overflow: 'hidden'
          }}>
            {/* 상단 판정 텍스트 배너 */}
            <div style={{
              fontSize: '1rem',
              fontWeight: 900,
              textAlign: 'center',
              color: isCorrect ? '#4ade80' : '#f87171',
              marginBottom: '10px'
            }}>
              {isSpectator ? (
                wasEliminatedThisRound ? (
                  '💥 오답으로 탈락했습니다! 다음 라운드부터 관전자 연습 모드로 참여합니다.'
                ) : isCorrect ? (
                  '🎉 [관전자 연습 풀이] 정답입니다!'
                ) : hasSelected ? (
                  '❌ [관전자 연습 풀이] 오답입니다!'
                ) : (
                  '⏰ [관전자 연습 풀이] 시간 초과 (미선택)'
                )
              ) : (
                isCorrect ? (
                  '🎉 정답입니다! 다음 라운드 진출!'
                ) : hasSelected ? (
                  '❌ 오답입니다! 탈락 처리됩니다.'
                ) : (
                  '⏰ 시간 초과! 탈락 처리됩니다.'
                )
              )}
            </div>

            {/* 카드 1: 내가 선택한 보기 */}
            <div style={{
              background: isCorrect ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              border: isCorrect ? '1.5px solid #22c55e' : '1.5px solid #ef4444',
              borderRadius: '10px',
              padding: '8px 12px',
              marginBottom: '8px'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.8rem',
                fontWeight: 800,
                color: isCorrect ? '#86efac' : '#fca5a5',
                marginBottom: '3px'
              }}>
                <span>나의 선택: {hasSelected ? `[${selectedOption + 1}번]` : '[미제출]'}</span>
                <span>{isCorrect ? '✅ 정답' : '❌ 오답'}</span>
              </div>
              <div style={{
                fontSize: '0.92rem',
                fontWeight: 700,
                color: '#f8fafc',
                wordBreak: 'break-word',
                lineHeight: 1.35
              }}>
                {hasSelected ? mySelectedText : '제한시간 내에 보기를 선택하지 못했습니다.'}
              </div>
            </div>

            {/* 카드 2: 실제 정답 보기 (초록색 하이라이트 카드) */}
            <div style={{
              background: 'rgba(34, 197, 94, 0.22)',
              border: '2px solid #22c55e',
              borderRadius: '10px',
              padding: '8px 12px',
              marginBottom: '8px',
              boxShadow: '0 2px 10px rgba(34, 197, 94, 0.2)'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.8rem',
                fontWeight: 800,
                color: '#86efac',
                marginBottom: '3px'
              }}>
                <span>정답: [{correctIdx + 1}번]</span>
                <span>⭐ 실제 정답</span>
              </div>
              <div style={{
                fontSize: '0.95rem',
                fontWeight: 800,
                color: '#4ade80',
                wordBreak: 'break-word',
                lineHeight: 1.35
              }}>
                {correctText}
              </div>
            </div>

            {/* 카드 3: 정답 해설 */}
            {roundResult.explanation && (
              <div style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '0.8rem',
                color: '#cbd5e1',
                lineHeight: 1.4,
                wordBreak: 'keep-all'
              }}>
                💡 <strong style={{ color: '#93c5fd' }}>해설:</strong> {roundResult.explanation}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );

  return renderResponsiveLayout(inRoundContent);

  // --- 실시간 채팅 말풍선 UI ---
  function renderChatItem(c: ChatMessage, isCompact = false) {
    const isMe = player && c.nickname === player.nickname;
    const nameColor = isMe ? '#facc15' : c.isAlive ? '#4ade80' : '#f87171';
    return (
      <div
        key={c.id}
        style={{
          background: isMe ? 'rgba(234, 179, 8, 0.12)' : 'rgba(30, 41, 59, 0.7)',
          border: isMe ? '1px solid rgba(234, 179, 8, 0.4)' : '1px solid rgba(51, 65, 85, 0.8)',
          borderRadius: '10px',
          padding: isCompact ? '5px 8px' : '7px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          wordBreak: 'break-word',
          boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: isCompact ? '0.75rem' : '0.82rem', color: nameColor, fontWeight: 800 }}>
              [{c.nickname}{isMe ? ' (나)' : ''}]
            </span>
            <span style={{
              fontSize: '0.65rem',
              padding: '1px 5px',
              borderRadius: '4px',
              background: c.isAlive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: c.isAlive ? '#86efac' : '#fca5a5',
              fontWeight: 700
            }}>
              {c.isAlive ? '생존' : '탈락'}
            </span>
          </div>
          {c.timestamp && (
            <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
              {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div style={{ color: '#f8fafc', fontSize: isCompact ? '0.82rem' : '0.9rem', lineHeight: 1.35 }}>
          {c.message}
        </div>
      </div>
    );
  }

  // --- 데스크톱/태블릿 전용 고정 사이드바 채팅창 (1/3 비율, 폭 300px~360px 고정) ---
  function renderDesktopChatSidebar() {
    return (
      <div style={{
        height: '100%',
        background: 'rgba(15, 23, 42, 0.95)',
        borderRadius: '16px',
        border: '1px solid #334155',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        boxSizing: 'border-box',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)'
      }}>
        {/* 헤더 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: '12px',
          borderBottom: '1px solid #334155',
          marginBottom: '12px',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc' }}>
              💬 실시간 톡
            </span>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              ({chatMessages.length})
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            <span style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 700 }}>LIVE</span>
          </div>
        </div>

        {/* 메시지 리스트 (Auto Scroll) */}
        <div
          ref={desktopChatScrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingRight: '4px',
            marginBottom: '12px'
          }}
        >
          {chatMessages.length === 0 ? (
            <div style={{ color: '#64748b', textAlign: 'center', margin: 'auto 0', fontSize: '0.9rem' }}>
              💬 첫 실시간 응원 메시지를 남겨보세요!
            </div>
          ) : (
            chatMessages.map(c => renderChatItem(c, false))
          )}
        </div>

        {/* 채팅 입력 폼 */}
        <form onSubmit={handleSendChat} style={{ display: 'flex', gap: '8px', marginTop: 'auto', flexShrink: 0 }}>
          <input
            type="text"
            placeholder="실시간 응원/메시지..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            maxLength={60}
            style={{
              flex: 1,
              background: '#1e293b',
              border: '1px solid #475569',
              color: '#ffffff',
              padding: '10px 12px',
              fontSize: '0.88rem',
              borderRadius: '10px',
              minHeight: '42px',
              boxSizing: 'border-box'
            }}
          />
          <button
            type="submit"
            style={{
              padding: '10px 16px',
              background: '#6366f1',
              color: 'white',
              fontSize: '0.88rem',
              fontWeight: 700,
              borderRadius: '10px',
              border: 'none',
              cursor: 'pointer',
              minHeight: '42px',
              whiteSpace: 'nowrap'
            }}
          >
            전송
          </button>
        </form>
      </div>
    );
  }

  // --- 모바일 세로 뷰 하단 채팅 UI ---
  function renderMobileChatBox() {
    return (
      <div style={{
        marginTop: 'auto',
        background: 'rgba(15, 23, 42, 0.95)',
        borderRadius: '14px',
        border: '1.5px solid #334155',
        padding: '8px 12px',
        flexShrink: 0,
        boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.5)'
      }}>
        {/* 헤더 바 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isChatOpen ? '8px' : '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#f8fafc', fontWeight: 800 }}>
              💬 실시간 톡 ({chatMessages.length})
            </span>
            {!isChatOpen && unreadCount > 0 && (
              <span style={{
                background: '#ef4444',
                color: '#ffffff',
                fontSize: '0.7rem',
                fontWeight: 900,
                padding: '1px 6px',
                borderRadius: '9999px',
                animation: 'pulse 1s infinite'
              }}>
                NEW {unreadCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setIsChatOpen(!isChatOpen);
              if (!isChatOpen) setUnreadCount(0);
            }}
            style={{
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              color: '#38bdf8',
              fontSize: '0.78rem',
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            {isChatOpen ? '접기 ▲' : '열기 ▼'}
          </button>
        </div>

        {/* 메시지 리스트 */}
        <div
          ref={chatScrollRef}
          style={{
            maxHeight: isChatOpen ? '130px' : '36px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            marginBottom: '8px'
          }}
        >
          {chatMessages.length === 0 ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '4px', fontSize: '0.8rem' }}>
              첫 응원 메시지를 남겨보세요!
            </div>
          ) : isChatOpen ? (
            chatMessages.slice(-30).map(c => renderChatItem(c, true))
          ) : (
            (() => {
              const latest = chatMessages[chatMessages.length - 1];
              const isMe = player && latest.nickname === player.nickname;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color: isMe ? '#facc15' : latest.isAlive ? '#4ade80' : '#f87171', fontWeight: 800, flexShrink: 0 }}>
                    [{latest.nickname}]:
                  </span>
                  <span style={{ color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {latest.message}
                  </span>
                </div>
              );
            })()
          )}
        </div>

        {/* 채팅 입력 폼 */}
        <form onSubmit={handleSendChat} style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            placeholder="실시간 응원/메시지..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            maxLength={60}
            style={{
              flex: 1,
              background: '#1e293b',
              border: '1px solid #475569',
              color: '#ffffff',
              padding: '6px 10px',
              fontSize: '0.85rem',
              borderRadius: '8px',
              minHeight: '38px',
              boxSizing: 'border-box'
            }}
          />
          <button
            type="submit"
            style={{
              padding: '6px 14px',
              background: '#6366f1',
              color: 'white',
              fontSize: '0.85rem',
              fontWeight: 700,
              minHeight: '38px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            전송
          </button>
        </form>
      </div>
    );
  }

  // --- 반응형 레이아웃 래퍼: 데스크톱/태블릿은 3분할(2:1 비율), 모바일은 세로 스택 ---
  function renderResponsiveLayout(mainContent: React.ReactNode) {
    if (!isMobile) {
      return (
        <div style={{
          width: '100%',
          maxWidth: '1150px',
          margin: '0 auto',
          minHeight: '100dvh',
          height: '100dvh',
          maxHeight: '100dvh',
          display: 'flex',
          flexDirection: 'row',
          gap: '20px',
          padding: '20px',
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}>
          {/* 좌측 메인 영역 (2/3 비율, col-span-2) */}
          <div style={{
            flex: '2 1 0%',
            minWidth: 0,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            background: 'rgba(15, 23, 42, 0.65)',
            border: '1px solid #334155',
            borderRadius: '16px',
            padding: '20px',
            boxSizing: 'border-box'
          }}>
            {mainContent}
          </div>

          {/* 우측 채팅창 전용 고정 사이드바 (1/3 비율, 최적 너비 300px~360px 고정) */}
          <div style={{
            flex: '1 1 0%',
            maxWidth: '360px',
            minWidth: '290px',
            height: '100%',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {renderDesktopChatSidebar()}
          </div>

          {renderRosterModal()}
          {renderEditNicknameModal()}
        </div>
      );
    }

    // 모바일 세로 뷰: 단일 컬럼 유지
    return (
      <div style={{
        ...mobileContainerStyle,
        padding: '10px 14px',
        justifyContent: 'space-between'
      }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', marginBottom: '8px' }}>
          {mainContent}
        </div>
        {renderMobileChatBox()}
        {renderRosterModal()}
        {renderEditNicknameModal()}
      </div>
    );
  }

  // --- 실시간 탈락자/생존자 모달 (요구사항 4번) ---
  function renderRosterModal() {
    if (!showRoster) return null;
    const survivors = gameState.survivors;
    const eliminated = gameState.players.filter(p => !p.isAlive);

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.85)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}
      >
        <div style={{ background: '#1e293b', borderRadius: '16px', maxWidth: '400px', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', border: '1px solid #475569' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', color: '#f8fafc' }}>
              실시간 참가자 명단 (총 {gameState.players.length}명)
            </h3>
            <button
              onClick={() => setShowRoster(false)}
              style={{ background: 'transparent', color: '#94a3b8', fontSize: '1.2rem', padding: '4px' }}
            >
              ✕
            </button>
          </div>

          <div style={{ padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* 생존자 섹션 */}
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#4ade80', marginBottom: '8px' }}>
                ● 생존자 ({survivors.length}명)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {survivors.map(s => (
                  <span key={s.token} style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid #22c55e', color: '#86efac', padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem' }}>
                    {s.nickname} ({s.score}점)
                  </span>
                ))}
              </div>
            </div>

            {/* 탈락자 섹션 */}
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f87171', marginBottom: '8px' }}>
                ✕ 탈락자 ({eliminated.length}명)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {eliminated.map(e => (
                  <span key={e.token} style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#fca5a5', padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem', textDecoration: 'line-through' }}>
                    {e.nickname} (R{e.eliminatedRound || '-'})
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- 닉네임 수정 모달 컴포넌트 ---
  function renderEditNicknameModal() {
    if (!isEditingNickname || !player) return null;
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.85)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}
      >
        <div
          style={{
            background: '#1e293b',
            borderRadius: '16px',
            maxWidth: '380px',
            width: '100%',
            padding: '24px 20px',
            border: '1px solid #475569',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>✏️</div>
          <h3 style={{ fontSize: '1.2rem', color: '#f8fafc', marginBottom: '6px' }}>
            닉네임 수정
          </h3>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '18px' }}>
            새로 사용할 닉네임을 입력해주세요 (최대 12자).
          </p>

          <form onSubmit={handleUpdateNickname} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              type="text"
              value={editNicknameInput}
              onChange={(e) => setEditNicknameInput(e.target.value)}
              placeholder="새 닉네임 입력"
              maxLength={12}
              autoFocus
              style={{
                padding: '12px 16px',
                fontSize: '1.1rem',
                textAlign: 'center',
                borderRadius: '10px',
                border: '2px solid #6366f1',
                background: '#0f172a',
                color: '#fff'
              }}
            />

            {editNickError && (
              <div style={{ color: '#f87171', fontSize: '0.85rem', fontWeight: 600 }}>
                {editNickError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => setIsEditingNickname(false)}
                style={{ flex: 1, padding: '12px', background: '#334155', color: '#cbd5e1', borderRadius: '10px' }}
              >
                취소
              </button>
              <button
                type="submit"
                style={{ flex: 1, padding: '12px', background: '#6366f1', color: '#fff', borderRadius: '10px', fontWeight: 700 }}
              >
                변경 완료
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }
};
