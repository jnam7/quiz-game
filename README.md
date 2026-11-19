# 100인 실시간 서바이벌 퀴즈 웹게임 (Monorepo)

100명의 참가자가 동시에 접속하여 실시간으로 퀴즈를 풀고, 오답자는 즉시 탈락하는 서바이벌 퀴즈 웹게임 모노레포 프로젝트입니다.

---

## 📁 프로젝트 구조

```
100-quiz-survival/
├── package.json              # 모노레포 루트 설정 (npm workspaces)
├── tsconfig.base.json        # 공통 TypeScript 설정
├── .gitignore
├── README.md
└── packages/
    ├── shared/               # 공통 타입 및 상수 (@quiz/shared)
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── types.ts      # Player, GameState, SocketEvents 정의
    │       ├── constants.ts  # 정원(100명), 라운드 시간 등
    │       └── index.ts
    │
    ├── server/               # 실시간 웹소켓 서버 (@quiz/server)
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts      # Express & HTTP Server & Socket.io 초기화
    │       ├── socket/       # 실시간 이벤트 핸들러
    │       ├── game/         # 100인 서바이벌 룸 & 퀴즈 진행 엔진
    │       └── data/         # 퀴즈 문제 데이터
    │
    └── client/               # 프론트엔드 웹 앱 (@quiz/client)
        ├── package.json
        ├── vite.config.ts    # Vite 및 프록시 설정
        ├── tsconfig.json
        ├── index.html
        └── src/
            ├── App.tsx       # 메인 라우팅 & 게임 상태 구독
            ├── socket.ts     # Socket.io 클라이언트
            └── components/
                ├── Lobby.tsx     # 100인 대기실 & 참가 폼
                ├── QuizRoom.tsx  # 문제 풀이, 타이머, 실시간 결과
                └── GameOver.tsx  # 최종 우승자 발표 & 리셋
```

---

## 🚀 빠른 시작 가이드

### 1. 패키지 설치
프로젝트 루트 디렉토리에서 의존성을 설치합니다.
```bash
npm install
```

### 2. 공통 모듈(@quiz/shared) 빌드
서버와 클라이언트에서 사용할 공유 타입을 먼저 빌드합니다.
```bash
npm run dev:shared
# 또는 1회 빌드
npm --workspace=@quiz/shared run build
```

### 3. 백엔드 서버 실행 (Node.js / Socket.io)
새 터미널에서 서버를 실행합니다 (기본 포트: `4000`).
```bash
npm run dev:server
```

### 4. 프론트엔드 실행 (React / Vite)
새 터미널에서 클라이언트 개발 서버를 실행합니다 (기본 포트: `3000`).
```bash
npm run dev:client
```
브라우저에서 `http://localhost:3000`으로 접속하여 테스트할 수 있습니다.

---

## ⚡ 주요 특징

1. **End-to-End TypeScript 타입 동기화**:
   - `@quiz/shared`를 통해 서버와 클라이언트 간의 Socket 이벤트와 게임 상태(State)가 완전하게 타입 세이프하게 관리됩니다.
2. **100인 실시간 서바이벌 엔진**:
   - `GameManager`가 라운드별 타이머, 정답 제출 취합, 탈락자 처리 및 실시간 생존자 수 브로드캐스트를 책임집니다.
3. **확장성**:
   - Socket.io Redis Adapter(선택 사항)를 도입하면 여러 서버 노드로 100인 이상의 대규모 트래픽으로 쉽게 수평 확장 가능합니다.

