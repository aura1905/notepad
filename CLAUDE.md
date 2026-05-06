# Nabi Notepad

웹 기반 메모장. 빌드 도구 없이 정적 파일 3개로 구성됨. GitHub Pages로 배포.

- **운영 URL**: https://aura1905.github.io/notepad/
- **저장소**: https://github.com/aura1905/notepad
- **배포**: `.github/workflows/deploy.yml` — `master` 브랜치 push 시 자동 배포

## 파일 구조

```
index.html   UI 마크업, 외부 SDK 로드 (CDN)
app.js       전체 로직 (IIFE로 감쌈, 모듈 시스템 안 씀)
style.css    스타일 + 라이트/다크 테마 변수
```

빌드 단계 없음. 파일 직접 편집 후 push만 하면 배포됨.

## 외부 의존성 (전부 CDN)

- `marked` — 마크다운 프리뷰
- `firebase-app-compat`, `firebase-auth-compat`, `firebase-firestore-compat` — 인증 + 동기화

> 모듈 번들러를 도입하면 Firebase modular SDK로 가는 게 일반적이지만, 현재 구조 단순함을 우선해서 compat 버전 사용. 빌드 도구 추가 제안 금지.

## 기능

- 다중 탭 (이름 더블클릭으로 변경, ✕로 닫기)
- 자동 저장 (localStorage 1초 디바운스, Firestore 1.5초 디바운스)
- 파일 열기/저장 (드래그앤드롭 지원)
- 찾기/바꾸기 (정규식, 대소문자 구분)
- 줄 번호, 자동 줄바꿈 토글
- 글꼴 크기 조절 (8~32px)
- 마크다운/JSON/HTML 프리뷰 (분할/전체 모드)
- 다크/라이트 테마 (`localStorage`)
- 단축키: `Ctrl+N/O/S/W/F/H/P`, `Ctrl+/-`, `Tab` 들여쓰기

## Firebase 동기화

**목적**: 사용자 본인 소유의 여러 컴퓨터 간 노트 동기화. 공개 게시판 아님.

### 프로젝트
- `projectId`: `gdd-presentation-ddb3c` (이름: gdd-presentation)
- 이 프로젝트는 다른 앱(GDD Web 등)과 공유됨 → `users/` 컬렉션만 사용. 다른 컬렉션 만들지 말 것.
- 인증: Google 로그인만 (`firebase.auth.GoogleAuthProvider`)
- 사용자 본인은 `hanaura@gmail.com`으로 로그인

### 데이터 모델
단일 문서: `users/{uid}`
```js
{
  tabs: [{ id, name, content, originalContent }],
  activeTabId: string,
  tabCounter: number,
  wordWrap: boolean,
  fontSize: number,
  updatedAt: serverTimestamp,
  updatedAtClient: number,
  clientId: string  // 자체 에코 식별용
}
```

### 동기화 흐름
1. 로그인 → `loadFromFirestoreOnce()`로 클라우드 데이터 1회 로드 → 로컬 상태 교체
2. 처음 로그인이라 문서 없으면 현재 로컬 상태를 업로드
3. `subscribeToFirestore()`가 `onSnapshot`으로 실시간 리스너 시작
4. 로컬 변경 시 `scheduleCloudSave()` (1.5초 디바운스) → `saveToFirestore()` 한 번에 전체 문서 set
5. 다른 기기에서 변경 → onSnapshot 콜백 → `applyRemoteData()` → 탭 재구축

### 자체 에코 회피 (중요)

`onSnapshot`은 자기가 쓴 데이터도 다시 콜백으로 돌려준다. 그대로 적용하면 사용자가 타이핑 중에 1.5초마다 커서가 리셋됨.

방어 두 단계:
1. `doc.metadata.hasPendingWrites === true` → 자기 쓰기가 아직 서버 확정 안 됨, 무시
2. `data.clientId === clientId` (모듈 로드 시 1회 생성한 랜덤 ID) → 서버 확정 후 자기 쓰기가 돌아온 것, 무시

이 두 가드를 깨뜨리지 말 것. 깨지면 입력 중 커서가 튐.

### 충돌 해결
**Last-write-wins**. 두 기기 동시 편집 시 늦게 저장된 쪽이 이전 데이터를 통째로 덮어씀. CRDT/OT는 도입 안 함 (개인용으로 과함).

### 비로그인 폴백
로그인 안 한 상태에서도 기존처럼 localStorage에 저장됨. Firebase는 로그인 시에만 활성화.

### 보안 규칙
`users/{userId}` 및 그 하위 모든 경로 — 본인 (`request.auth.uid == userId`)만 read/write 허용. 다른 사람 차단. 콘솔 → Firestore Database → 규칙 탭에서 확인 가능.

## 작업 시 유의사항

- **공개/멀티유저 모델로 바꾸지 말 것** — 사용자 의도와 다름. "게시판"이라는 표현이 나와도 그건 "본인이 어디서나 쓸 수 있는 곳"의 비유였음.
- 데이터 모델 변경 시 **하위 호환성** 신경 쓸 것 — Firestore에 이미 데이터가 있는 상태에서 필드 이름 바꾸면 본인 메모 사라질 수 있음. 마이그레이션 코드 필요.
- 새 기능 추가 시 **Firebase 사용량(무료 티어)** 고려 — 현재는 Spark 요금제. 매 키스트로크마다 쓰지 말고 디바운스 유지.
- `app.js`는 IIFE 단일 파일. 모듈 분리 제안하지 말 것 (요청 없으면).
- 댓글 추가 자제. 코드 자체로 의미 명확하면 댓글 없는 게 낫다는 게 원칙.

## 로컬 개발

빌드 도구 없으니 그냥 정적 파일 서버로 띄우면 됨:
```
python -m http.server 8000
# 또는 VSCode Live Server 확장
```

Firebase 인증을 로컬에서 테스트하려면 `localhost`가 Authentication 승인된 도메인 목록에 있어야 함 (이미 등록되어 있음).
