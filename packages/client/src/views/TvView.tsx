import React, { useState, useEffect, useRef } from 'react';
import { GameState, RoundInfo, RoundResult, Player, ChatMessage } from '@quiz/shared';
import { socket } from '../socket';
import { soundEngine } from '../utils/sound';
import confetti from 'canvas-confetti';
import QRCode from 'qrcode';

interface TvViewProps {
  gameState: GameState;
}

export const TvView: React.FC<TvViewProps> = ({ gameState }) => {
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [roundInfo, setRoundInfo] = useState<RoundInfo | undefined>(gameState.currentRoundInfo);
  const [roundResult, setRoundResult] = useState<RoundResult | undefined>(gameState.lastRoundResult);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [joinUrlText, setJoinUrlText] = useState<string>('');
  const [connectionMode, setConnectionMode] = useState<'public' | 'wifi'>('public');
  const [serverInfo, setServerInfo] = useState<{ publicUrl?: string; localIp: string; clientPort: number } | null>(null);
  const [answeredCount, setAnsweredCount] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState(false);

  // 실시간 채팅 및 리액션 피드
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const tvChatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tvChatScrollRef.current) {
      tvChatScrollRef.current.scrollTop = tvChatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // 로컬 IP 또는 공인 터널 URL 가져와 QR코드 생성
  useEffect(() => {
    const updateQr = () => {
      fetch('/api/server-info')
        .then(res => res.json())
        .then(info => {
          setServerInfo(info);
          const targetUrl = (connectionMode === 'public' && info.publicUrl)
            ? info.publicUrl
            : `http://${info.localIp}:${info.clientPort}`;

          setJoinUrlText(targetUrl);
          QRCode.toDataURL(targetUrl, { width: 320, margin: 2, color: { dark: '#ffffff', light: '#00000000' } })
            .then(url => setQrCodeUrl(url))
            .catch(err => console.error(err));
        })
        .catch(() => {
          const fallbackUrl = window.location.origin;
          setJoinUrlText(fallbackUrl);
          QRCode.toDataURL(fallbackUrl, { width: 320, margin: 2, color: { dark: '#ffffff', light: '#00000000' } })
            .then(url => setQrCodeUrl(url));
        });
    };

    updateQr();
    const t1 = setTimeout(updateQr, 3000);
    const t2 = setTimeout(updateQr, 7000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [connectionMode]);

  // 소켓 이벤트
  useEffect(() => {
    const handleRoundStart = (info: RoundInfo) => {
      setRoundInfo(info);
      setRoundResult(undefined);
      setAnsweredCount(0);
    };

    const handleRoundEnd = (res: RoundResult) => {
      setRoundResult(res);
    };

    const handleAnswered = (data: { answerCount: number }) => {
      setAnsweredCount(data.answerCount);
    };

    const handleSound = (type: any) => {
      soundEngine.play(type);
    };

    const handleStarting = (sec: number) => {
      setCountdown(sec);
      soundEngine.play('COUNTDOWN_TICK');
    };

    const handleWinner = (winner?: Player) => {
      if (winner) {
        confetti({
          particleCount: 150,
          spread: 100,
          origin: { y: 0.6 }
        });
        soundEngine.play('WINNER_FANFARE');
      }
    };

    const handleChatMessage = (msg: ChatMessage) => {
      setChatMessages(prev => [...prev.slice(-49), msg]);
    };

    const handleChatHistory = (history: ChatMessage[]) => {
      setChatMessages(history.slice(-50));
    };

    const handleChatCleared = () => {
      setChatMessages([]);
    };

    const handleTunnelUpdated = (newPublicUrl: string) => {
      if (connectionMode === 'public' && newPublicUrl) {
        setJoinUrlText(newPublicUrl);
        QRCode.toDataURL(newPublicUrl, { width: 320, margin: 2, color: { dark: '#ffffff', light: '#00000000' } })
          .then(url => setQrCodeUrl(url))
          .catch(err => console.error(err));
      }
    };

    const handleForceLobby = () => {
      setRoundInfo(undefined);
      setRoundResult(undefined);
      setAnsweredCount(0);
      setCountdown(null);
    };

    socket.on('game:round_started', handleRoundStart);
    socket.on('game:round_ended', handleRoundEnd);
    socket.on('player:answered', handleAnswered);
    socket.on('game:play_sound', handleSound);
    socket.on('game:starting_countdown', handleStarting);
    socket.on('game:winner_announced', handleWinner);
    socket.on('chat:message', handleChatMessage);
    socket.on('chat:history', handleChatHistory);
    socket.on('chat:cleared', handleChatCleared);
    socket.on('server:tunnel_updated', handleTunnelUpdated);
    socket.on('game:force_lobby', handleForceLobby);

    return () => {
      socket.off('game:round_started', handleRoundStart);
      socket.off('game:round_ended', handleRoundEnd);
      socket.off('player:answered', handleAnswered);
      socket.off('game:play_sound', handleSound);
      socket.off('game:starting_countdown', handleStarting);
      socket.off('game:winner_announced', handleWinner);
      socket.off('chat:message', handleChatMessage);
      socket.off('chat:history', handleChatHistory);
      socket.off('chat:cleared', handleChatCleared);
      socket.off('server:tunnel_updated', handleTunnelUpdated);
      socket.off('game:force_lobby', handleForceLobby);
    };
  }, []);

  // 대기실 복귀 시 이전 라운드/카운트다운 데이터 완전 초기화
  useEffect(() => {
    if (gameState.status === 'WAITING') {
      setRoundInfo(undefined);
      setRoundResult(undefined);
      setCountdown(null);
      setAnsweredCount(0);
    }
  }, [gameState.status]);

  // 실시간 타이머 계산
  const [secondsRemaining, setSecondsRemaining] = useState<number>(10);
  useEffect(() => {
    if (gameState.status === 'IN_ROUND' && roundInfo) {
      const interval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((roundInfo.serverEndTime - Date.now()) / 1000));
        setSecondsRemaining(remaining);
        if (remaining <= 3 && remaining > 0) {
          soundEngine.play('COUNTDOWN_URGENT');
        }
      }, 250);
      return () => clearInterval(interval);
    }
  }, [gameState.status, roundInfo]);

  const toggleSound = () => {
    soundEngine.enable();
    setSoundEnabled(true);
  };

  const handleResetToLobby = () => {
    socket.emit('game:request_reset');
  };

  const survivors = gameState.survivors;
  const isUrgent = gameState.status === 'IN_ROUND' && secondsRemaining <= 3;

  const renderBottomStatus = (showTicker: boolean) => (
    <div
      style={{
        marginTop: 'auto',
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid #334155',
        borderRadius: '16px',
        padding: isMobile ? '8px 12px' : '10px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        flexShrink: 0
      }}
    >
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: '6px' }}>
        <div style={{ fontSize: isMobile ? '0.78rem' : '0.85rem', fontWeight: 800, color: '#94a3b8' }}>
          📊 도전자 현황 (생존: <span style={{ color: '#4ade80' }}>{survivors.length}명</span> / 탈락: <span style={{ color: '#f87171' }}>{gameState.players.length - survivors.length}명</span>)
        </div>

        {/* 실시간 채팅 최신 티커 (모바일에서 노출) */}
        {showTicker && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: isMobile ? '100%' : '400px', overflow: 'hidden' }}>
            <span style={{ fontSize: '0.8rem', color: '#818cf8', fontWeight: 700 }}>💬 실시간 톡:</span>
            {chatMessages.length > 0 ? (
              <span style={{ fontSize: '0.82rem', color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <strong style={{ color: chatMessages[chatMessages.length - 1].isAlive ? '#4ade80' : '#f87171' }}>
                  {chatMessages[chatMessages.length - 1].nickname}:
                </strong>{' '}
                {chatMessages[chatMessages.length - 1].message}
              </span>
            ) : (
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>응원 톡을 남겨보세요!</span>
            )}
          </div>
        )}
      </div>

      {/* 참가자 100인 생존/탈락 타일 리스트 (멀리서도 식별 가능) */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          maxHeight: isMobile ? '50px' : '65px',
          overflowY: 'auto'
        }}
      >
        {gameState.players.map(p => (
          <span
            key={p.token}
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 700,
              background: p.isAlive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.1)',
              border: p.isAlive ? '1px solid #22c55e' : '1px solid rgba(239, 68, 68, 0.3)',
              color: p.isAlive ? '#86efac' : '#94a3b8',
              textDecoration: p.isAlive ? 'none' : 'line-through'
            }}
          >
            {p.isAlive ? `● ${p.nickname}` : `✕ ${p.nickname}`}
          </span>
        ))}
      </div>
    </div>
  );

  const renderTvChatPanel = () => (
    <div
      style={{
        height: '100%',
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid #334155',
        borderRadius: '16px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        boxSizing: 'border-box'
      }}
    >
      {/* 채팅 헤더 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: '12px',
          borderBottom: '1px solid #334155',
          marginBottom: '12px',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc' }}>
            💬 실시간 응원톡
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
        ref={tvChatScrollRef}
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
            스마트폰으로 첫 응원 메시지를 남겨보세요!
          </div>
        ) : (
          chatMessages.map((c) => (
            <div
              key={c.id}
              style={{
                background: 'rgba(30, 41, 59, 0.7)',
                border: '1px solid rgba(51, 65, 85, 0.8)',
                borderRadius: '10px',
                padding: '8px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    fontSize: '0.85rem',
                    color: c.isAlive ? '#4ade80' : '#f87171',
                    fontWeight: 800
                  }}>
                    [{c.nickname}]
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
                  <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                    {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div style={{ color: '#f8fafc', fontSize: '0.95rem', lineHeight: 1.35, wordBreak: 'break-word' }}>
                {c.message}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 하단 안내 문구 */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.5)',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '8px 10px',
        textAlign: 'center',
        fontSize: '0.78rem',
        color: '#94a3b8',
        flexShrink: 0
      }}>
        📱 참가자 스마트폰 화면에서 실시간 톡을 전송할 수 있습니다.
      </div>
    </div>
  );

  return (
    <div
      style={{
        width: '100vw',
        minHeight: '100dvh',
        height: isMobile ? 'auto' : '100vh',
        background: isUrgent
          ? 'radial-gradient(circle at 50% 50%, #450a0a 0%, #020617 100%)'
          : 'radial-gradient(circle at 50% 30%, #1e1b4b 0%, #030712 100%)',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        padding: isMobile ? '12px 14px' : '24px 40px',
        overflowY: isMobile ? 'auto' : 'hidden',
        overflowX: 'hidden',
        boxSizing: 'border-box',
        transition: 'background 0.3s ease'
      }}
    >
      {/* 1. 상단 바: 스테이지 정보 / 생존자 수 / 음향 토글 / 실시간 채팅 티커 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: '12px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '10px' : '16px', flexWrap: 'wrap' }}>
          <div
            style={{
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              padding: isMobile ? '6px 14px' : '8px 22px',
              borderRadius: '9999px',
              fontSize: isMobile ? '1rem' : '1.3rem',
              fontWeight: 900,
              boxShadow: '0 0 25px rgba(168, 85, 247, 0.5)'
            }}
          >
            {roundInfo?.stageName || 'CMB 150인 서바이벌 퀴즈쇼'}
          </div>
          <div style={{ fontSize: isMobile ? '0.95rem' : '1.1rem', color: '#94a3b8' }}>
            {roundInfo?.category && `[카테고리: ${roundInfo.category}]`}
          </div>
        </div>

        {/* 생존자 & 탈락자 스탯 보드 */}
        <div style={{ display: 'flex', gap: isMobile ? '14px' : '24px', alignItems: 'center', width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>생존자</div>
            <div style={{ fontSize: isMobile ? '1.6rem' : '2.2rem', fontWeight: 900, color: '#4ade80', textShadow: '0 0 15px rgba(74, 222, 128, 0.6)' }}>
              {survivors.length} <span style={{ fontSize: '0.9rem' }}>명</span>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>누적 탈락자</div>
            <div style={{ fontSize: isMobile ? '1.6rem' : '2.2rem', fontWeight: 900, color: '#f87171' }}>
              {gameState.players.length - survivors.length} <span style={{ fontSize: '0.9rem' }}>명</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!soundEnabled && (
              <button
                onClick={toggleSound}
                style={{
                  padding: '6px 12px',
                  background: '#4338ca',
                  color: 'white',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: 700
                }}
              >
                🔊 음향
              </button>
            )}
            <button
              onClick={() => window.open('/admin', '_blank')}
              style={{
                padding: '6px 12px',
                background: '#1e293b',
                border: '1px solid #475569',
                color: '#c7d2fe',
                borderRadius: '8px',
                fontSize: '0.8rem',
                cursor: 'pointer'
              }}
              title="관리자 페이지를 새창으로 엽니다"
            >
              🛠️ 관리자
            </button>
          </div>
        </div>
      </div>

      {/* 2. 메인 바디 영역: 데스크톱/태블릿은 3분할(좌측 2/3 메인 + 우측 1/3 채팅사이드바), 모바일은 세로 스택 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? '12px' : '20px',
          minHeight: 0,
          overflow: isMobile ? 'visible' : 'hidden'
        }}
      >
        {/* 좌측 메인 영역 (2/3 비율, col-span-2) */}
        <div
          style={{
            flex: isMobile ? 'none' : '2 1 0%',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '12px',
            height: '100%',
            overflowY: isMobile ? 'visible' : 'auto'
          }}
        >
          {/* 게임 상태별 메인 스테이지 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* 2. 대기실 상태: 초대형 QR코드 및 도전자 현황 */}
            {gameState.status === 'WAITING' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '10px 0' : '0' }}>
          <h1 style={{ fontSize: isMobile ? '1.6rem' : '3.2rem', fontWeight: 900, color: '#818cf8', marginBottom: '8px', textAlign: 'center', textShadow: '0 0 30px rgba(129, 140, 248, 0.6)', wordBreak: 'keep-all' }}>
            🔥 CMB 150인 서바이벌 퀴즈 대기실 🔥
          </h1>
          <p style={{ fontSize: isMobile ? '0.95rem' : '1.4rem', color: '#cbd5e1', marginBottom: isMobile ? '14px' : '20px', textAlign: 'center', wordBreak: 'keep-all' }}>
            스마트폰 카메라로 아래 QR코드를 스캔하여 지금 즉시 접속하세요!
          </p>

          {/* 접속 모드 전환 탭 버튼 */}
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '8px', marginBottom: isMobile ? '16px' : '20px', width: isMobile ? '100%' : 'auto' }}>
            <button
              onClick={() => setConnectionMode('public')}
              style={{
                padding: isMobile ? '8px 14px' : '10px 20px',
                background: connectionMode === 'public' ? '#4f46e5' : '#1e293b',
                color: 'white',
                border: connectionMode === 'public' ? '2px solid #a5b4fc' : '1px solid #475569',
                fontSize: isMobile ? '0.85rem' : '1rem',
                borderRadius: '12px'
              }}
            >
              🌐 외부 접속 모드 (LTE / 5G / 모든 네트워크)
            </button>
            <button
              onClick={() => setConnectionMode('wifi')}
              style={{
                padding: isMobile ? '8px 14px' : '10px 20px',
                background: connectionMode === 'wifi' ? '#4f46e5' : '#1e293b',
                color: 'white',
                border: connectionMode === 'wifi' ? '2px solid #a5b4fc' : '1px solid #475569',
                fontSize: isMobile ? '0.85rem' : '1rem',
                borderRadius: '12px'
              }}
            >
              📶 사내 Wi-Fi 직접 접속 모드 (초고속)
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '20px' : '50px', alignItems: 'center', width: isMobile ? '100%' : 'auto' }}>
            {qrCodeUrl && (
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    padding: isMobile ? '12px' : '16px',
                    borderRadius: '20px',
                    border: '2px solid #6366f1',
                    boxShadow: '0 0 40px rgba(99, 102, 241, 0.5)',
                    marginBottom: '8px',
                    display: 'inline-block'
                  }}
                >
                  <img src={qrCodeUrl} alt="QR Code" style={{ width: isMobile ? '180px' : '250px', height: isMobile ? '180px' : '250px', display: 'block' }} />
                </div>
                {joinUrlText && (
                  <div style={{ fontSize: isMobile ? '0.82rem' : '0.95rem', color: '#38bdf8', fontWeight: 'bold', wordBreak: 'break-all', maxWidth: isMobile ? '240px' : '300px', margin: '0 auto' }}>
                    🌐 {joinUrlText}
                  </div>
                )}
              </div>
            )}

            <div style={{ minWidth: isMobile ? '100%' : '340px', textAlign: isMobile ? 'center' : 'left' }}>
              <div style={{ fontSize: isMobile ? '1.1rem' : '1.3rem', marginBottom: '8px' }}>
                현재 입장 인원: <strong style={{ color: '#38bdf8', fontSize: isMobile ? '1.5rem' : '1.8rem' }}>{gameState.players.length}</strong> / 150명
              </div>
              <div style={{ height: '10px', background: '#334155', borderRadius: '5px', overflow: 'hidden', marginBottom: '16px' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min((gameState.players.length / 150) * 100, 100)}%`,
                    background: 'linear-gradient(90deg, #6366f1, #ec4899)'
                  }}
                />
              </div>
              <p style={{ color: '#94a3b8', fontSize: isMobile ? '0.9rem' : '1.05rem', lineHeight: 1.5 }}>
                관리자가 게임을 시작하면<br />자동으로 1라운드가 출제됩니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 3. 게임 시작 3, 2, 1 카운트다운 */}
      {countdown !== null && gameState.status === 'STARTING' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: isMobile ? '1.6rem' : '2.5rem', color: '#818cf8', marginBottom: '12px' }}>
            게임 시작까지
          </div>
          <div
            style={{
              fontSize: isMobile ? '7rem' : '12rem',
              fontWeight: 900,
              color: '#f43f5e',
              textShadow: '0 0 60px rgba(244, 63, 94, 0.8)',
              animation: 'pulse 1s infinite'
            }}
          >
            {countdown}
          </div>
        </div>
      )}

      {/* 4. 라운드 진행 중 (대형 문제 & 4개 보기) */}
      {(gameState.status === 'IN_ROUND' || gameState.status === 'ROUND_RESULT') && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          {/* 중앙 초대형 카운트다운 타이머 & 답변 제출 현황 게이지 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ fontSize: isMobile ? '0.95rem' : '1.2rem', color: '#94a3b8' }}>
              실시간 답변 제출: <strong style={{ color: '#38bdf8' }}>{answeredCount}</strong> / {survivors.length}명
            </div>
            {gameState.status === 'IN_ROUND' && (
              <div
                style={{
                  fontSize: isMobile ? '2.2rem' : '4rem',
                  fontWeight: 900,
                  color: isUrgent ? '#ef4444' : '#38bdf8',
                  textShadow: isUrgent ? '0 0 30px #ef4444' : '0 0 20px #38bdf8'
                }}
              >
                ⏳ {secondsRemaining}초
              </div>
            )}
          </div>

          {/* 메인 문제 박스 */}
          <div
            style={{
              background: 'rgba(30, 41, 59, 0.85)',
              borderRadius: '16px',
              padding: isMobile ? '16px 14px' : '30px 40px',
              border: isUrgent ? '2px solid #ef4444' : '2px solid rgba(255, 255, 255, 0.15)',
              boxShadow: isUrgent ? '0 0 50px rgba(239, 68, 68, 0.4)' : '0 20px 50px rgba(0, 0, 0, 0.5)',
              textAlign: 'center',
              marginBottom: '14px'
            }}
          >
            <h2 style={{ fontSize: isMobile ? '1.25rem' : '2.4rem', fontWeight: 800, lineHeight: 1.4, color: '#ffffff', wordBreak: 'keep-all' }}>
              {roundInfo?.question}
            </h2>
          </div>

          {/* 4지선다 보기 그리드 */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '10px' : '16px', marginBottom: '14px' }}>
            {roundInfo?.options.map((option, idx) => {
              let bg = 'rgba(15, 23, 42, 0.8)';
              let border = '2px solid rgba(255, 255, 255, 0.15)';
              let textColor = '#ffffff';

              if (gameState.status === 'ROUND_RESULT' && roundResult) {
                if (idx === roundResult.correctAnswerIndex) {
                  bg = 'rgba(34, 197, 94, 0.35)';
                  border = '3px solid #22c55e';
                  textColor = '#86efac';
                } else {
                  bg = 'rgba(15, 23, 42, 0.4)';
                  textColor = '#64748b';
                }
              }

              return (
                <div
                  key={idx}
                  style={{
                    background: bg,
                    border,
                    borderRadius: '14px',
                    padding: isMobile ? '12px 16px' : '20px 28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: isMobile ? '1.05rem' : '1.6rem',
                    fontWeight: 700,
                    color: textColor,
                    transition: 'all 0.3s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: isMobile ? '32px' : '42px',
                        height: isMobile ? '32px' : '42px',
                        borderRadius: '50%',
                        background: 'rgba(255, 255, 255, 0.15)',
                        marginRight: isMobile ? '10px' : '16px',
                        fontSize: isMobile ? '1rem' : '1.3rem',
                        fontWeight: 900
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span style={{ wordBreak: 'keep-all' }}>{option}</span>
                  </div>

                  {gameState.status === 'ROUND_RESULT' && roundResult && (
                    <div style={{ fontSize: isMobile ? '0.95rem' : '1.3rem', color: idx === roundResult.correctAnswerIndex ? '#4ade80' : '#f87171' }}>
                      {roundResult.distribution[idx] || 0}명 선택
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 라운드 결과 해설 */}
          {gameState.status === 'ROUND_RESULT' && roundResult && (
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.95)',
                border: '2px solid #6366f1',
                borderRadius: '14px',
                padding: isMobile ? '12px 14px' : '16px 28px',
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                justifyContent: 'space-between',
                alignItems: isMobile ? 'flex-start' : 'center',
                gap: isMobile ? '8px' : '12px',
                marginBottom: '10px'
              }}
            >
              <div>
                <span style={{ fontSize: isMobile ? '1.05rem' : '1.3rem', fontWeight: 900, color: '#4ade80' }}>
                  정답: 보기 {roundResult.correctAnswerIndex + 1}번
                </span>
                <span style={{ color: '#cbd5e1', fontSize: isMobile ? '0.9rem' : '1.1rem', marginLeft: isMobile ? '0' : '16px', display: isMobile ? 'block' : 'inline', marginTop: isMobile ? '4px' : '0' }}>
                  {roundResult.explanation}
                </span>
              </div>
              <div style={{ fontSize: isMobile ? '0.95rem' : '1.2rem', fontWeight: 800 }}>
                탈락: <span style={{ color: '#ef4444' }}>{roundResult.eliminatedCount}명</span> | 생존:{' '}
                <span style={{ color: '#22c55e' }}>{roundResult.survivorsCount}명</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. 최종 우승자 및 최종 1~10등 명예의 전당 화면 */}
      {gameState.status === 'GAME_OVER' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <span style={{ fontSize: isMobile ? '2.2rem' : '3rem' }}>👑</span>
            <h1 style={{ fontSize: isMobile ? '1.6rem' : '2.8rem', fontWeight: 900, color: '#facc15', textShadow: '0 0 40px rgba(250, 204, 21, 0.8)', textAlign: 'center' }}>
              {gameState.winner ? `최종 우승: ${gameState.winner.nickname}!` : '서바이벌 퀴즈쇼 종료'}
            </h1>
          </div>

          {/* 최종 1~10등 리더보드 보드 (1~5위, 6~10위 2컬럼 레이아웃) */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.9)',
            border: '2px solid rgba(250, 204, 21, 0.5)',
            borderRadius: '20px',
            padding: isMobile ? '12px 14px' : '16px 24px',
            width: '95%',
            maxWidth: '1100px',
            boxShadow: '0 0 50px rgba(0, 0, 0, 0.6)',
            marginBottom: '16px'
          }}>
            <div style={{ textAlign: 'center', fontSize: isMobile ? '1.1rem' : '1.4rem', fontWeight: 900, color: '#fde047', marginBottom: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
              <span>🏆</span>
              <span>최종 명예의 전당 (TOP 1~10위)</span>
              <span>🏆</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px' }}>
              {/* 1~5위 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(gameState.topRankings || []).slice(0, 5).map((r) => {
                  const is1st = r.rank === 1;
                  const is2nd = r.rank === 2;
                  const is3rd = r.rank === 3;
                  const medal = is1st ? '🥇' : is2nd ? '🥈' : is3rd ? '🥉' : `${r.rank}위`;
                  const border = is1st ? '2px solid #eab308' : is2nd ? '1px solid #94a3b8' : is3rd ? '1px solid #b45309' : '1px solid #334155';
                  const bg = is1st ? 'rgba(234, 179, 8, 0.2)' : is2nd ? 'rgba(148, 163, 184, 0.15)' : is3rd ? 'rgba(180, 83, 9, 0.15)' : 'rgba(30, 41, 59, 0.6)';
                  return (
                    <div key={r.token} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '6px 10px' : '8px 14px', background: bg, border, borderRadius: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '10px' }}>
                        <span style={{ fontSize: isMobile ? '1rem' : '1.2rem', fontWeight: 900, width: '32px', textAlign: 'center' }}>{medal}</span>
                        <span style={{ fontSize: isMobile ? '1rem' : '1.15rem', fontWeight: 800, color: is1st ? '#fde047' : '#f8fafc' }}>{r.nickname}</span>
                        {r.isAlive && <span style={{ fontSize: '0.72rem', background: '#15803d', color: '#86efac', padding: '2px 5px', borderRadius: '4px' }}>생존</span>}
                      </div>
                      <div style={{ fontSize: isMobile ? '0.95rem' : '1.1rem', fontWeight: 800, color: '#38bdf8' }}>{r.score}점</div>
                    </div>
                  );
                })}
              </div>

              {/* 6~10위 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(gameState.topRankings || []).slice(5, 10).map((r) => {
                  return (
                    <div key={r.token} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '6px 10px' : '8px 14px', background: 'rgba(30, 41, 59, 0.6)', border: '1px solid #334155', borderRadius: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '10px' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#94a3b8', width: '32px', textAlign: 'center' }}>{r.rank}위</span>
                        <span style={{ fontSize: isMobile ? '0.95rem' : '1.05rem', fontWeight: 700, color: '#f1f5f9' }}>{r.nickname}</span>
                      </div>
                      <div style={{ fontSize: isMobile ? '0.95rem' : '1.05rem', fontWeight: 700, color: '#38bdf8' }}>{r.score}점</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 결과 유지 안내 배너 */}
          <div style={{
            padding: isMobile ? '8px 16px' : '12px 28px',
            background: 'rgba(99, 102, 241, 0.2)',
            border: '1.5px solid #6366f1',
            borderRadius: '14px',
            color: '#e0e7ff',
            fontSize: isMobile ? '0.9rem' : '1.15rem',
            fontWeight: 800,
            marginBottom: '12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>⏳</span>
            <span>관리자가 다음 게임을 시작하기 전까지 최종 결과 화면이 고정 유지됩니다.</span>
          </div>

          <div style={{ fontSize: isMobile ? '0.85rem' : '1rem', color: '#94a3b8' }}>
            총 참가: {gameState.players.length}명 | 진행 라운드: {gameState.currentRound}R
          </div>
        </div>
      )}
          </div>

          {/* 하단: 도전자 현황 전광판 타일 */}
          {renderBottomStatus(isMobile)}
        </div>

        {/* 우측 채팅창 전용 고정 사이드바 (1/3 비율, 최적 너비 300px~360px 고정) */}
        {!isMobile && (
          <div
            style={{
              flex: '1 1 0%',
              maxWidth: '360px',
              minWidth: '300px',
              height: '100%',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {renderTvChatPanel()}
          </div>
        )}
      </div>
    </div>
  );
};
