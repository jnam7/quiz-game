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

  // 생존자/탈락자 명단 모달
  const [showRoster, setShowRoster] = useState(false);

  // 닉네임 수정 상태
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [editNicknameInput, setEditNicknameInput] = useState('');
  const [editNickError, setEditNickError] = useState('');

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
    };

    const handleChatHistory = (history: ChatMessage[]) => {
      setChatMessages(history);
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
    socket.on('game:force_lobby', handleForceLobby);
    socket.on('game:player_kicked_all', handlePlayerKickedAll);

    return () => {
      socket.off('game:round_started', handleRoundStart);
      socket.off('game:round_ended', handleRoundEnd);
      socket.off('chat:message', handleChatMessage);
      socket.off('chat:history', handleChatHistory);
      socket.off('game:force_lobby', handleForceLobby);
      socket.off('game:player_kicked_all', handlePlayerKickedAll);
    };
  }, []);

  // 채팅 스크롤 자동 이동
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
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
      } else {
        setErrorMessage(res.message || '참가에 실패했습니다.');
      }
    });
  };

  const handleSelectOption = (index: number) => {
    if (isSubmitted || !player?.isAlive || gameState.status !== 'IN_ROUND') return;

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

  // 1. 미입장 상태: 참가 폼
  if (!player) {
    return (
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '24px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '8px' }}>🔥</div>
        <h1 style={{ fontSize: '1.8rem', color: '#818cf8', marginBottom: '8px' }}>
          CMB 150인 서바이벌 퀴즈쇼
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '32px' }}>
          틀리면 즉시 탈락! 최후의 1인에 도전하세요.
        </p>

        <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <input
            type="text"
            placeholder="참가자 이름(닉네임) 입력"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            maxLength={10}
            style={{
              padding: '16px',
              fontSize: '1.2rem',
              textAlign: 'center',
              borderRadius: '14px',
              border: '2px solid #4338ca'
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
              padding: '16px',
              fontSize: '1.2rem',
              backgroundColor: '#6366f1',
              color: 'white',
              boxShadow: '0 8px 20px rgba(99, 102, 241, 0.4)'
            }}
          >
            대기실 입장하기
          </button>
        </form>

        <div style={{ marginTop: '40px', color: '#64748b', fontSize: '0.85rem' }}>
          현재 대기 인원: <strong style={{ color: '#38bdf8' }}>{gameState.players.length}</strong> / 150명
        </div>

        <div style={{ marginTop: '28px', paddingTop: '16px', borderTop: '1px solid #1e293b' }}>
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
    );
  }

  // 2. 대기실 상태
  if (gameState.status === 'WAITING' || gameState.status === 'STARTING') {
    return (
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '30px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', minHeight: '90vh' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>⏳</div>
          <h2 style={{ fontSize: '1.6rem', color: '#f8fafc', marginBottom: '10px' }}>
            대기실 입장 완료
          </h2>
          <div style={{ background: '#1e293b', padding: '16px 20px', borderRadius: '14px', marginBottom: '24px', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>나의 닉네임</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#38bdf8' }}>{player.nickname}</div>
              </div>
              <button
                onClick={() => {
                  setEditNicknameInput(player.nickname);
                  setEditNickError('');
                  setIsEditingNickname(true);
                }}
                style={{
                  padding: '8px 14px',
                  fontSize: '0.85rem',
                  background: '#334155',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                  fontWeight: 600
                }}
              >
                ✏️ 닉네임 수정
              </button>
            </div>
          </div>

          <p style={{ color: '#cbd5e1', fontSize: '1.05rem', lineHeight: 1.6 }}>
            관리자가 게임을 시작할 때까지<br />대형 TV 화면을 바라보며 기다려주세요!
          </p>

          <div style={{ marginTop: '24px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <button
              onClick={() => setShowRoster(true)}
              style={{ padding: '10px 16px', background: '#334155', color: '#38bdf8', fontSize: '0.9rem' }}
            >
              👥 참가자 현황 ({gameState.players.length}명)
            </button>
            {!soundUnlocked && (
              <button
                onClick={handleUnlockAudio}
                style={{ padding: '10px 16px', background: '#334155', color: '#cbd5e1', fontSize: '0.9rem' }}
              >
                🔊 효과음 활성화
              </button>
            )}
          </div>

          <div style={{ marginTop: '16px' }}>
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

        {/* 대기실 실시간 채팅 컴포넌트 */}
        {renderChatBox()}
        {renderRosterModal()}
        {renderEditNicknameModal()}
      </div>
    );
  }

  // 3. 탈락자 화면
  if (!player.isAlive && gameState.status !== 'GAME_OVER') {
    return (
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '24px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', minHeight: '90vh' }}>
        <div style={{ flex: 1 }}>
          {/* 헤더 내 닉네임 및 수정 버튼 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', background: '#1e293b', padding: '8px 14px', borderRadius: '10px' }}>
            <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
              참가자: <strong style={{ color: '#f8fafc' }}>{player.nickname}</strong>
            </span>
            <button
              onClick={() => {
                setEditNicknameInput(player.nickname);
                setEditNickError('');
                setIsEditingNickname(true);
              }}
              style={{ background: 'transparent', color: '#38bdf8', fontSize: '0.8rem', padding: '2px 6px', border: '1px solid #475569', borderRadius: '6px' }}
            >
              ✏️ 닉네임 변경
            </button>
          </div>

          <div style={{ fontSize: '3.5rem', marginBottom: '12px' }}>💥</div>
          <h2 style={{ fontSize: '1.8rem', color: '#f87171', fontWeight: 900, marginBottom: '6px' }}>
            아쉽습니다!
          </h2>
          <h3 style={{ fontSize: '1.2rem', color: '#fca5a5', marginBottom: '16px' }}>
            당신은 탈락했습니다!
          </h3>

          <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '16px', padding: '16px', marginBottom: '20px' }}>
            <div style={{ color: '#fca5a5', fontSize: '0.9rem', marginBottom: '4px' }}>
              탈락 사유: {player.eliminatedReason === 'TIMEOUT' ? '제한시간 초과 (미응답)' : '오답 선택'}
            </div>
            <div style={{ color: '#fca5a5', fontSize: '0.9rem' }}>
              탈락 라운드: {player.eliminatedRound || gameState.currentRound}라운드
            </div>
            <div style={{ marginTop: '8px', fontSize: '1.1rem', fontWeight: 700, color: '#fef08a' }}>
              최종 획득 점수: {player.score}점
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '16px' }}>
            <button
              onClick={() => setShowRoster(true)}
              style={{ padding: '8px 16px', background: '#1e293b', color: '#4ade80', fontSize: '0.85rem' }}
            >
              👥 생존자 ({gameState.survivors.length}) / 탈락자 명단 보기
            </button>
          </div>
        </div>

        {/* 관전자 실시간 응원 채팅창 */}
        {renderChatBox()}
        {renderRosterModal()}
        {renderEditNicknameModal()}
      </div>
    );
  }

  // 4. 게임 종료 화면 (1등 확정 또는 무승부 시 대기실 이동 버튼)
  if (gameState.status === 'GAME_OVER') {
    const isWinner = gameState.winner?.token === player.token;
    return (
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '30px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', minHeight: '90vh' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '4rem', marginBottom: '12px' }}>{isWinner ? '👑' : '🏁'}</div>
          <h1 style={{ fontSize: '2rem', color: isWinner ? '#facc15' : '#818cf8', marginBottom: '12px' }}>
            {isWinner ? '🎉 최종 우승! 🎉' : gameState.isDraw ? '🤝 무승부 (전원 탈락)' : '게임 종료'}
          </h1>

          {isWinner ? (
            <div style={{ background: 'rgba(234, 179, 8, 0.2)', border: '2px solid #eab308', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <p style={{ fontSize: '1.2rem', color: '#fef08a', fontWeight: 800 }}>
                축하합니다! CMB 150인 서바이벌 최후의 승자입니다!
              </p>
              <div style={{ marginTop: '10px', color: '#fde047', fontSize: '1.3rem' }}>
                점수: {player.score}점
              </div>
            </div>
          ) : (
            <p style={{ color: '#cbd5e1', fontSize: '1.1rem', marginBottom: '20px' }}>
              우승자: <strong style={{ color: '#facc15' }}>{gameState.winner?.nickname || (gameState.isDraw ? '무승부' : '없음')}</strong>
            </p>
          )}

          {/* 나의 최종 등수 배너 */}
          {(() => {
            const myRankItem = (gameState.topRankings || []).find(r => r.token === player.token);
            const myRank = myRankItem ? `${myRankItem.rank}위` : '순위권';
            return (
              <div style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '14px', padding: '14px', marginBottom: '16px' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>나의 최종 결과</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f8fafc', marginTop: '4px' }}>
                  {player.nickname} 님: <span style={{ color: '#facc15' }}>{myRank}</span> ({player.score}점)
                </div>
              </div>
            );
          })()}

          {/* 최종 TOP 10 명예의 전당 */}
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '14px', padding: '12px 14px', marginBottom: '16px', textAlign: 'left' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#fde047', marginBottom: '8px', textAlign: 'center' }}>
              🏆 최종 명예의 전당 (TOP 1~10위)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
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

          {/* 대기실로 바로 이동 버튼 (요구사항 1번) */}
          <button
            onClick={handleRequestReset}
            style={{
              padding: '16px 32px',
              backgroundColor: '#4f46e5',
              color: 'white',
              fontSize: '1.15rem',
              fontWeight: 800,
              borderRadius: '14px',
              boxShadow: '0 8px 25px rgba(79, 70, 229, 0.4)',
              marginBottom: '16px'
            }}
          >
            🏠 새 게임 대기실로 바로 이동
          </button>
        </div>

        {renderChatBox()}
        {renderRosterModal()}
        {renderEditNicknameModal()}
      </div>
    );
  }

  // 5. 라운드 진행 중 (문제 풀이 및 답변 제출)
  return (
    <div style={{ maxWidth: '420px', margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', minHeight: '90vh' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#f59e0b' }}>
            R{roundInfo?.roundNumber ?? gameState.currentRound}
          </span>
          <span style={{ color: '#94a3b8', fontSize: '0.85rem', marginLeft: '6px' }}>
            ({roundInfo?.category || '퀴즈'})
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => {
              setEditNicknameInput(player.nickname);
              setEditNickError('');
              setIsEditingNickname(true);
            }}
            style={{ background: '#1e293b', color: '#94a3b8', fontSize: '0.75rem', padding: '3px 8px', borderRadius: '6px', border: '1px solid #334155' }}
          >
            {player.nickname} ✏️
          </button>
          <button
            onClick={() => setShowRoster(true)}
            style={{ background: 'transparent', color: '#4ade80', fontSize: '0.85rem', fontWeight: 700 }}
          >
            생존: {gameState.survivors.length}명 ▾
          </button>
        </div>
      </div>

      {/* 문제 문구 */}
      <div
        style={{
          background: '#1e293b',
          borderRadius: '16px',
          padding: '20px 16px',
          border: '1px solid rgba(255,255,255,0.1)',
          marginBottom: '20px',
          textAlign: 'center'
        }}
      >
        <h2 style={{ fontSize: '1.25rem', color: '#f8fafc', lineHeight: 1.5, wordBreak: 'keep-all' }}>
          {roundInfo?.question || '문제를 로딩 중입니다...'}
        </h2>
      </div>

      {isSubmitted && gameState.status === 'IN_ROUND' && (
        <div style={{ textAlign: 'center', color: '#38bdf8', fontWeight: 700, marginBottom: '12px' }}>
          ✔ 답변 제출 완료! 대형 TV 화면을 주목해주세요.
        </div>
      )}

      {/* 4지선다 보기 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
        {roundInfo?.options.map((opt, idx) => {
          const isSelected = selectedOption === idx;
          let bg = '#1e293b';
          let border = '2px solid transparent';

          if (isSelected) {
            bg = '#4f46e5';
            border = '2px solid #a5b4fc';
          }

          if (gameState.status === 'ROUND_RESULT' && roundResult) {
            if (idx === roundResult.correctAnswerIndex) {
              bg = '#15803d';
              border = '2px solid #4ade80';
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
                color: 'white',
                padding: '18px 16px',
                fontSize: '1.1rem',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                borderRadius: '14px',
                minHeight: '60px',
                touchAction: 'manipulation'
              }}
            >
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.15)',
                marginRight: '12px',
                fontWeight: 900
              }}>
                {idx + 1}
              </span>
              <span style={{ flex: 1, wordBreak: 'keep-all' }}>{opt}</span>
            </button>
          );
        })}
      </div>

      {/* 라운드 결과 해설 */}
      {gameState.status === 'ROUND_RESULT' && roundResult && (
        <div style={{ marginBottom: '16px', padding: '14px', background: '#0f172a', borderRadius: '12px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: selectedOption === roundResult.correctAnswerIndex ? '#4ade80' : '#f87171' }}>
            {selectedOption === roundResult.correctAnswerIndex ? '🎉 정답입니다! 다음 라운드 진출!' : '❌ 틀렸습니다! 탈락 처리됩니다.'}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
            {roundResult.explanation}
          </div>
        </div>
      )}

      {/* 실시간 채팅창 컴포넌트 */}
      {renderChatBox()}
      {renderRosterModal()}
      {renderEditNicknameModal()}
    </div>
  );

  // --- 실시간 채팅 UI 함수 ---
  function renderChatBox() {
    return (
      <div style={{ marginTop: 'auto', background: 'rgba(15, 23, 42, 0.9)', borderRadius: '14px', border: '1px solid #334155', padding: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 700 }}>
            💬 실시간 파티 톡 ({chatMessages.length})
          </span>
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            style={{ background: 'transparent', color: '#38bdf8', fontSize: '0.8rem' }}
          >
            {isChatOpen ? '접기 ▲' : '열기 ▼'}
          </button>
        </div>

        {/* 메시지 리스트 */}
        <div
          ref={chatScrollRef}
          style={{
            maxHeight: isChatOpen ? '140px' : '45px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            marginBottom: '8px',
            fontSize: '0.85rem'
          }}
        >
          {chatMessages.length === 0 ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '6px' }}>첫 응원 메시지를 남겨보세요!</div>
          ) : (
            chatMessages.slice(isChatOpen ? -30 : -2).map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: c.isAlive ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>
                  [{c.nickname}]
                </span>
                <span style={{ color: '#f1f5f9', wordBreak: 'break-all' }}>{c.message}</span>
              </div>
            ))
          )}
        </div>

        {/* 채팅 입력 폼 */}
        <form onSubmit={handleSendChat} style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            placeholder="실시간 응원/메시지 입력..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            maxLength={60}
            style={{ flex: 1, padding: '8px 12px', fontSize: '0.9rem', borderRadius: '8px' }}
          />
          <button type="submit" style={{ padding: '8px 14px', background: '#6366f1', color: 'white', fontSize: '0.9rem' }}>
            전송
          </button>
        </form>
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
