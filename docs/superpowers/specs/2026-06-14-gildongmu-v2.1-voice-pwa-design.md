# 길동무 v2.1 — 음성 받아쓰기 + PWA 설계

작성일: 2026-06-14
상태: 승인됨 (사용자 구두 승인 2026-06-14)
선행: `2026-06-14-gildongmu-v2-upgrade-design.md`(v2 검색→상세 흐름)

## 1. 목표

모바일 접근성·UX를 두 축으로 끌어올린다.
1. **음성 받아쓰기**: 검색창에 마이크 입력 — dodo-planet의 Deepgram 서버 STT를 수입·적응. 시각장애인이 타이핑 없이 음성으로 검색.
2. **PWA**: 홈 화면 설치·standalone 실행·앱셸 캐싱·오프라인 폴백으로 모바일 앱 경험.

**측정 가능한 성과**:
- 검색창에서 마이크 탭 → 말하기 → 인식 텍스트로 자동 검색까지 스크린 리더로 완결.
- 브라우저 "홈 화면에 추가"로 설치 가능, standalone 실행, 오프라인 시 폴백 페이지.

## 2. 범위

- **포함**: Deepgram STT 라우트·녹음 훅·권한 훅·마이크 버튼·SearchBar 통합·자동 검색, Serwist PWA(manifest·SW·아이콘·오프라인).
- **제외**: 음성 *출력*(TTS), 음성 명령(검색 외 액션), 채팅, 오프라인 검색(API 의존이라 불가).

## 3. Part A — 음성 받아쓰기

### 3.1 상호작용 모델 (정정 반영)
**탭-토글**: 마이크 버튼 한 번 탭 → 녹음 시작, 다시 탭 → 정지·전사. (dodo의 실제 동작이 PTT가 아니라 탭-토글이었음 — 설계 질문의 오기를 정정. 탭-토글이 스크린 리더 제스처와도 정합.) Esc로 녹음 취소.

### 3.2 수입 대상 (dodo-planet → gildongmu)
- `/api/speech-to-text/route.ts`: Deepgram Nova-2(`nova-2-conversationalai`, smart_format·punctuate·detect_language). FormData `{audio, locale}` → `{text, language_code, confidence}`. 25MB 상한. `DEEPGRAM_API_KEY` 없으면 500.
- `src/hooks/useVoiceRecorder.ts`: MediaRecorder(webm/opus 우선), 최대 60초·최소 0.3초 가드, `isSupported` 감지, 마운트 클린업. 상태 `idle|recording|processing`.
- `src/hooks/useMicrophonePermission.ts`: 권한 상태(`idle|checking|needsPermission|ready|denied`), Permissions API + Safari localStorage 폴백.
- `src/components/VoiceRecordButton.tsx`: 탭-토글, sr-only aria-live(assertive) 안내, 상태별 아이콘(Mic/Square/Loader2/MicOff), Esc 취소.

### 3.3 gildongmu 적응 (dodo 의존성 제거)
dodo는 gildongmu에 없는 것들에 의존 — 다음으로 대체:
- `sonner`(토스트) → **제거**. 오류는 컴포넌트의 sr-only `aria-live` 안내 + 부모로 콜백 전달해 검색 영역 상태에 반영.
- `useSound`(효과음) → **제거**(에셋 없음; aria 안내로 피드백 충분).
- `cn` util → **제거**, 평문 className(기존 gildongmu 컨벤션).
- `appendShortcutHint`/`keyboardShortcut` → **제거**(단축키 미광고).
- `MicrophonePermissionPrompt` 모달 → **제거**. 권한은 `getUserMedia` 네이티브 프롬프트로 직접 요청하고, 거부 시 aria-live 안내. (사전 설명 모달 없이 간소화 — 미니멀 원칙.)
- 스타일: dodo의 gray/orange/red → 디자인 토큰(`accent`, recording 시 시각 강조는 별도 대비색). 44px 타깃, `aria-disabled`는 미지원/processing에만.

### 3.4 SearchBar 통합 + 자동 검색
- `SearchBar`에 마이크 버튼 추가(입력창 우측, 검색 버튼 옆). props로 `onTranscribed`·`locale` 받기.
- 흐름: 전사 완료 → `onQueryChange(text)` + 자동 `onSubmit()`. 인식 결과는 VoiceRecordButton의 aria-live가 낭독, 검색창 input에도 채워져 편집 가능.
- `PlaceSearch`가 `onTranscribed`를 `(text) => { setQuery(text); runSearch(text) }`로 배선. `runSearch`가 인자 query를 받도록 소폭 일반화(현재 state 의존 → 인자 우선).
- locale은 `useLocale()`로 STT 힌트 전달(ko/en).

### 3.5 graceful degrade
- `isSupported=false`(MediaRecorder/getUserMedia 없음) → 마이크 버튼 미렌더 또는 비활성+안내. 텍스트 검색은 정상.
- `DEEPGRAM_API_KEY` 없음 → 라우트 500, 컴포넌트 오류 안내. 텍스트 검색 정상.
- 권한 거부 → aria-live 안내, 버튼은 재시도 가능 상태 유지.

### 3.6 키 이관
- `DEEPGRAM_API_KEY`를 dodo `.env.local` → gildongmu `.env.local`(로컬) + Vercel Production(배포). 서버 전용(클라 노출 금지).

## 4. Part B — PWA (Serwist)

### 4.1 도구
- `@serwist/next` + `serwist`. `next.config.ts`를 `withSerwist(withNextIntl(config))`로 합성.
- **리스크/폴백**: Next 16 Turbopack과 Serwist SW 빌드 호환을 M2에서 먼저 검증. 비호환 시 **수제 최소 서비스워커**(precache 앱셸 + network-first + 오프라인 폴백)로 폴백 — 목표(설치·앱셸 캐시·오프라인 폴백)는 동일 달성. 어느 경로든 manifest·아이콘은 공통.

### 4.2 manifest (`app/manifest.ts`, Next 16 메타데이터 라우트)
- `name`: "길동무 Gildongmu", `short_name`: "길동무", `description`.
- `theme_color`: accent(#1d4ed8), `background_color`: #ffffff, `display`: standalone, `start_url`: "/", `scope`: "/", `lang`: "ko", `dir`: auto.
- `icons`: 192·512(any) + 512(maskable).
- 라우트는 `/manifest.webmanifest`로 노출(proxy.ts matcher가 `.`포함 경로 제외라 로케일 라우팅 미간섭).

### 4.3 서비스워커 (`app/sw.ts` 또는 폴백 `public/sw.js`)
- precache: 빌드 산출 앱셸·정적 에셋.
- 런타임: 페이지(document)는 network-first → 실패 시 캐시 → 최종 오프라인 폴백 페이지.
- **API(`/api/*`)·검색은 캐시하지 않음**(실데이터 원칙, 가짜 캐시 금지).
- 오프라인 폴백: `app/[locale]/offline/page.tsx` 또는 정적 `/offline.html` 정적 프리캐시.

### 4.4 아이콘 (신설)
- 앱 로고 없음 → 간단한 브랜드 아이콘 SVG 제작(위치 핀 + "길" 모티프, accent 배경/흰 전경, 고대비).
- SVG → PNG 변환으로 `public/icons/`에 192·512·maskable(안전영역 패딩)·apple-touch(180) 생성. 변환 도구는 M2에서 가용한 것(rsvg-convert/sharp/sips) 사용.
- `app/[locale]/layout.tsx`에 apple-touch-icon·theme-color 메타(또는 manifest로 충분한 부분은 생략).

### 4.5 접근성
- 설치 후 standalone에서도 skip 링크·포커스 이동·aria-live가 동일 동작(추가 코드 불필요 — 검증만).
- viewport·theme-color가 다크모드와 충돌 없게(라이트 기준 theme_color, 다크는 브라우저 처리).

## 5. 테스트 전략
- **게이트(순수 단위, Vitest node)**: `/api/speech-to-text` 응답 정규화(Deepgram envelope → `{text,language_code,confidence}`) 파서 + zod/입력 검증. manifest 객체 형태(필수 필드) 검증. STT 파서는 fixture 기반.
- MediaRecorder/권한/SW는 jsdom·브라우저 의존이라 게이트 제외 → a11y-auditor + 프로덕션 수동 스모크.
- 기능·버그픽스는 같은 커밋에 테스트 동반(워크스페이스 공통).

## 6. 마일스톤 (subagent-driven)
1. **M1 받아쓰기**: STT 라우트(+파서 테스트) → useVoiceRecorder·useMicrophonePermission 수입·적응 → VoiceRecordButton(gildongmu 토큰·aria) → SearchBar 통합 + PlaceSearch 자동검색 배선 → `voice` 메시지 키 ko/en → 키 이관. 게이트 통과.
2. **M2 PWA**: Serwist 도입(Turbopack 호환 검증, 폴백 준비) → manifest → 아이콘 생성 → SW(앱셸·오프라인 폴백, API 비캐시) → 오프라인 페이지 → 메타. 게이트 통과.
3. **M3 검증·배포**: a11y-auditor, codex 마일스톤 리뷰(diff 주입), build/lint/test, 문서(SPEC·CLAUDE.md)·AGENTS 동기화, `DEEPGRAM_API_KEY` 프로덕션 등록, main 병합·푸시·배포, 프로덕션 스모크(STT·설치·오프라인).

## 7. 리스크
- **Serwist × Turbopack 호환**: 미검증 → M2 선검증 + 수제 SW 폴백(§4.1).
- **iOS Safari PWA 제약**: 설치(홈추가)는 되나 SW·푸시 제약 — 오프라인 폴백·설치만 목표라 영향 적음. standalone에서 마이크 권한은 사용자 1회 허용 필요.
- **Deepgram 비용/한도**: dodo와 공유 키. 검색 쿼리는 짧아 호출당 비용 작음. 남용 방지로 60초 상한 유지.
- **모바일 마이크 권한**: getUserMedia는 https 필수(Vercel·localhost OK).
