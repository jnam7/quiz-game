import React, { useState, useEffect } from 'react';
import { GameState, RoundInfo, RoundResult, Player, ChatMessage } from '@quiz/shared';
import { socket } from '../socket';
import { soundEngine } from '../utils/sound';
import confetti from 'canvas-confetti';
import QRCode from 'qrcode';

interface TvViewProps {
  gameState: GameState;
}

export const TvView: React.FC<TvViewProps> = ({ gameState }) => {
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
      setChatMessages(prev => [...prev.slice(-19), msg]);
    };

    const handleChatHistory = (history: ChatMessage[]) => {
      setChatMessages(history.slice(-20));
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

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: isUrgent
          ? 'radial-gradient(circle at 50% 50%, #450a0a 0%, #020617 100%)'
          : 'radial-gradient(circle at 50% 30%, #1e1b4b 0%, #030712 100%)',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 40px',
        overflow: 'hidden',
        boxSizing: 'border-box',
        transition: 'background 0.3s ease'
      }}
    >
      {/* 1. 상단 바: 스테이지 정보 / 생존자 수 / 음향 토글 / 실시간 채팅 티커 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              padding: '8px 22px',
              borderRadius: '9999px',
              fontSize: '1.3rem',
              fontWeight: 900,
              boxShadow: '0 0 25px rgba(168, 85, 247, 0.5)'
            }}
          >
            {roundInfo?.stageName || 'CMB 150인 서바이벌 퀴즈쇼'}
          </div>
          <div style={{ fontSize: '1.1rem', color: '#94a3b8' }}>
            {roundInfo?.category && `[카테고리: ${roundInfo.category}]`}
          </div>
        </div>

        {/* 생존자 & 탈락자 스탯 보드 */}
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>생존자</div>
            <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#4ade80', textShadow: '0 0 15px rgba(74, 222, 128, 0.6)' }}>
              {survivors.length} <span style={{ fontSize: '1.1rem' }}>명</span>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>누적 탈락자</div>
            <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#f87171' }}>
              {gameState.players.length - survivors.length} <span style={{ fontSize: '1.1rem' }}>명</span>
            </div>
          </div>
          {!soundEnabled && (
            <button
              onClick={toggleSound}
              style={{
                padding: '8px 16px',
                background: '#4338ca',
                color: 'white',
                borderRadius: '8px',
                fontSize: '0.85rem'
              }}
            >
              🔊 음향 켜기
            </button>
          )}
          <button
            onClick={() => window.open('/admin', '_blank')}
            style={{
              padding: '8px 14px',
              background: '#1e293b',
              border: '1px solid #475569',
              color: '#c7d2fe',
              borderRadius: '8px',
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
            title="관리자 페이지를 새창으로 엽니다"
          >
            🛠️ 관리자 센터 (새창)
          </button>
        </div>
      </div>

      {/* 2. 대기실 상태: 초대형 QR코드 및 도전자 현황 */}
      {gameState.status === 'WAITING' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h1 style={{ fontSize: '3.2rem', fontWeight: 900, color: '#818cf8', marginBottom: '12px', textShadow: '0 0 30px rgba(129, 140, 248, 0.6)' }}>
            🔥 CMB 150인 서바이벌 퀴즈 대기실 🔥
          </h1>
          <p style={{ fontSize: '1.4rem', color: '#cbd5e1', marginBottom: '20px' }}>
            스마트폰 카메라로 아래 QR코드를 스캔하여 지금 즉시 접속하세요!
          </p>

          {/* 접속 모드 전환 탭 버튼 */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <button
              onClick={() => setConnectionMode('public')}
              style={{
                padding: '10px 20px',
                background: connectionMode === 'public' ? '#4f46e5' : '#1e293b',
                color: 'white',
                border: connectionMode === 'public' ? '2px solid #a5b4fc' : '1px solid #475569',
                fontSize: '1rem',
                borderRadius: '12px'
              }}
            >
              🌐 외부 접속 모드 (LTE / 5G / 모든 네트워크)
            </button>
            <button
              onClick={() => setConnectionMode('wifi')}
              style={{
                padding: '10px 20px',
                background: connectionMode === 'wifi' ? '#4f46e5' : '#1e293b',
                color: 'white',
                border: connectionMode === 'wifi' ? '2px solid #a5b4fc' : '1px solid #475569',
                fontSize: '1rem',
                borderRadius: '12px'
              }}
            >
              📶 사내 Wi-Fi 직접 접속 모드 (초고속)
            </button>
          </div>

          <div style={{ display: 'flex', gap: '50px', alignItems: 'center' }}>
            {qrCodeUrl && (
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    padding: '16px',
                    borderRadius: '24px',
                    border: '2px solid #6366f1',
                    boxShadow: '0 0 40px rgba(99, 102, 241, 0.5)',
                    marginBottom: '10px'
                  }}
                >
                  <img src={qrCodeUrl} alt="QR Code" style={{ width: '250px', height: '250px', display: 'block' }} />
                </div>
                {joinUrlText && (
                  <div style={{ fontSize: '0.95rem', color: '#38bdf8', fontWeight: 'bold', wordBreak: 'break-all', maxWidth: '300px' }}>
                    🌐 {joinUrlText}
                  </div>
                )}
              </div>
            )}

            <div style={{ minWidth: '340px' }}>
              <div style={{ fontSize: '1.3rem', marginBottom: '10px' }}>
                현재 입장 인원: <strong style={{ color: '#38bdf8', fontSize: '1.8rem' }}>{gameState.players.length}</strong> / 150명
              </div>
              <div style={{ height: '12px', background: '#334155', borderRadius: '6px', overflow: 'hidden', marginBottom: '20px' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min((gameState.players.length / 150) * 100, 100)}%`,
                    background: 'linear-gradient(90deg, #6366f1, #ec4899)'
                  }}
                />
              </div>
              <p style={{ color: '#94a3b8', fontSize: '1.05rem', lineHeight: 1.6 }}>
                관리자가 게임을 시작하면<br />자동으로 1라운드가 출제됩니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 3. 게임 시작 3, 2, 1 카운트다운 */}
      {countdown !== null && gameState.status === 'STARTING' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '2.5rem', color: '#818cf8', marginBottom: '16px' }}>
            게임 시작까지
          </div>
          <div
            style={{
              fontSize: '12rem',
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '1.2rem', color: '#94a3b8' }}>
              실시간 답변 제출: <strong style={{ color: '#38bdf8' }}>{answeredCount}</strong> / {survivors.length}명
            </div>
            {gameState.status === 'IN_ROUND' && (
              <div
                style={{
                  fontSize: '4rem',
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
              borderRadius: '20px',
              padding: '30px 40px',
              border: isUrgent ? '2px solid #ef4444' : '2px solid rgba(255, 255, 255, 0.15)',
              boxShadow: isUrgent ? '0 0 50px rgba(239, 68, 68, 0.4)' : '0 20px 50px rgba(0, 0, 0, 0.5)',
              textAlign: 'center',
              marginBottom: '16px'
            }}
          >
            <h2 style={{ fontSize: '2.4rem', fontWeight: 800, lineHeight: 1.4, color: '#ffffff' }}>
              {roundInfo?.question}
            </h2>
          </div>

          {/* 4지선다 보기 그리드 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
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
                    borderRadius: '16px',
                    padding: '20px 28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '1.6rem',
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
                        width: '42px',
                        height: '42px',
                        borderRadius: '50%',
                        background: 'rgba(255, 255, 255, 0.15)',
                        marginRight: '16px',
                        fontSize: '1.3rem',
                        fontWeight: 900
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span>{option}</span>
                  </div>

                  {gameState.status === 'ROUND_RESULT' && roundResult && (
                    <div style={{ fontSize: '1.3rem', color: idx === roundResult.correctAnswerIndex ? '#4ade80' : '#f87171' }}>
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
                padding: '16px 28px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px'
              }}
            >
              <div>
                <span style={{ fontSize: '1.3rem', fontWeight: 900, color: '#4ade80' }}>
                  정답: 보기 {roundResult.correctAnswerIndex + 1}번
                </span>
                <span style={{ color: '#cbd5e1', fontSize: '1.1rem', marginLeft: '16px' }}>
                  {roundResult.explanation}
                </span>
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '10px' }}>
            <span style={{ fontSize: '3rem' }}>👑</span>
            <h1 style={{ fontSize: '2.8rem', fontWeight: 900, color: '#facc15', textShadow: '0 0 40px rgba(250, 204, 21, 0.8)' }}>
              {gameState.winner ? `최종 우승: ${gameState.winner.nickname}!` : '서바이벌 퀴즈쇼 종료'}
            </h1>
          </div>

          {/* 최종 1~10등 리더보드 보드 (1~5위, 6~10위 2컬럼 레이아웃) */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.9)',
            border: '2px solid rgba(250, 204, 21, 0.5)',
            borderRadius: '20px',
            padding: '16px 24px',
            width: '92%',
            maxWidth: '1100px',
            boxShadow: '0 0 50px rgba(0, 0, 0, 0.6)',
            marginBottom: '16px'
          }}>
            <div style={{ textAlign: 'center', fontSize: '1.4rem', fontWeight: 900, color: '#fde047', marginBottom: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
              <span>🏆</span>
              <span>CMB 서바이벌 퀴즈 최종 명예의 전당 (TOP 1~10위)</span>
              <span>🏆</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
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
                    <div key={r.token} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: bg, border, borderRadius: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1.2rem', fontWeight: 900, width: '40px', textAlign: 'center' }}>{medal}</span>
                        <span style={{ fontSize: '1.15rem', fontWeight: 800, color: is1st ? '#fde047' : '#f8fafc' }}>{r.nickname}</span>
                        {r.isAlive && <span style={{ fontSize: '0.75rem', background: '#15803d', color: '#86efac', padding: '2px 6px', borderRadius: '4px' }}>생존</span>}
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#38bdf8' }}>{r.score}점</div>
                    </div>
                  );
                })}
              </div>

              {/* 6~10위 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(gameState.topRankings || []).slice(5, 10).map((r) => {
                  return (
                    <div key={r.token} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: 'rgba(30, 41, 59, 0.6)', border: '1px solid #334155', borderRadius: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 700, color: '#94a3b8', width: '40px', textAlign: 'center' }}>{r.rank}위</span>
                        <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f1f5f9' }}>{r.nickname}</span>
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#38bdf8' }}>{r.score}점</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 대기실로 바로 이동 버튼 */}
          <button
            onClick={handleResetToLobby}
            style={{
              padding: '12px 36px',
              backgroundColor: '#4f46e5',
              color: 'white',
              fontSize: '1.2rem',
              fontWeight: 900,
              borderRadius: '14px',
              boxShadow: '0 8px 30px rgba(79, 70, 229, 0.6)',
              marginBottom: '10px'
            }}
          >
            🏠 새 게임 대기실로 바로 이동하기
          </button>

          <div style={{ fontSize: '1rem', color: '#94a3b8' }}>
            총 참가 인원: {gameState.players.length}명 | 총 진행 라운드: {gameState.currentRound}라운드
          </div>
        </div>
      )}

      {/* 6. 하단 고정: 실시간 생존자 / 탈락자 명단 전광판 (요구사항 4번) */}
      <div
        style={{
          marginTop: 'auto',
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid #334155',
          borderRadius: '16px',
          padding: '10px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#94a3b8' }}>
            📊 실시간 도전자 현황 (생존: <span style={{ color: '#4ade80' }}>{survivors.length}명</span> / 탈락: <span style={{ color: '#f87171' }}>{gameState.players.length - survivors.length}명</span>)
          </div>

          {/* 실시간 채팅 최신 티커 (요구사항 3번) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '400px', overflow: 'hidden' }}>
            <span style={{ fontSize: '0.8rem', color: '#818cf8', fontWeight: 700 }}>💬 실시간 톡:</span>
            {chatMessages.length > 0 ? (
              <span style={{ fontSize: '0.85rem', color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <strong style={{ color: chatMessages[chatMessages.length - 1].isAlive ? '#4ade80' : '#f87171' }}>
                  {chatMessages[chatMessages.length - 1].nickname}:
                </strong>{' '}
                {chatMessages[chatMessages.length - 1].message}
              </span>
            ) : (
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>응원 톡을 남겨보세요!</span>
            )}
          </div>
        </div>

        {/* 참가자 100인 생존/탈락 타일 리스트 (멀리서도 식별 가능) */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            maxHeight: '65px',
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
    </div>
  );
};
