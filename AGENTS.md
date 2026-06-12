> 🤖 **이 파일은 자동 생성됩니다. 직접 수정하지 마세요.**
> 정본은 `CLAUDE.md` 입니다. 내용을 바꾸려면 `CLAUDE.md` 를 수정한 뒤
> 프로젝트 루트에서 `python sync_agent_docs.py` 를 실행하세요.
> 이 파일을 직접 고치면 다음 동기화 때 경고와 함께 덮어쓰기 대상이 됩니다.

<!-- SYNC-BODY-START: 이 줄 아래 본문은 CLAUDE.md 와 100% 동일하게 자동 생성됨 -->
# CLAUDE.md — 길동무 (gildongmu)

> Next.js 16 주의: 이 버전은 학습 데이터와 컨벤션이 다를 수 있다. 코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드를 먼저 읽을 것 (요청 API 전부 비동기: `await params`, `await cookies()`; `middleware.ts` 대신 `proxy.ts`).

## 프로젝트 정체성

**대한민국 전용 내비게이션·장소 찾기 UI.** 네이버 계열 API(NCP Maps, 네이버 지역 검색)를 연동하되, 두 사용자 집단을 1급 시민으로 둔다:

1. **시각장애인** — 스크린 리더만으로 전체 흐름(검색 → 장소 정보 → 길찾기)이 완결되어야 한다.
2. **한국 방문 외국인** — 한국어를 몰라도 쓸 수 있는 미니멀한 영어 UI.

**궁극 목표**: 이 프로젝트를 성숙시킨 뒤 `~/Mac-Projects/dodo-planet/`(가족 여행 가이드 PWA)에 통합한다. 따라서 **스택·컨벤션을 dodo-planet과 일치**시킨다 (next-intl 4, zod 4, Vitest 4, TypeScript, App Router).

## 절대 원칙: 접근성

- **정보의 정본은 리스트/텍스트 UI다. 지도는 시각 보조 레이어다.** 네이버 지도 JS SDK는 캔버스 렌더링이라 스크린 리더 접근 불가 — 지도에만 존재하는 정보가 있으면 그것은 버그다.
- 상태 변화(검색 결과 수, 오류, 경로 안내)는 `aria-live` 영역으로 통지한다.
- 모든 인터랙티브 요소는 키보드 도달 가능 + `:focus-visible` 스타일 필수.
- 터치 타깃 최소 44×44px (`min-h-11` 이상).
- UI 메뉴/버튼 라벨에 이모지 금지 (워크스페이스 공통 원칙).

## 아키텍처

```
클라이언트 컴포넌트 ──fetch──▶ Route Handler (src/app/api/*) ──▶ 외부 API
                                 (Secret은 서버 전용 env에만 존재)
```

- **Provider 추상화** (`src/lib/providers/`): 장소 검색은 `searchPlaces()` 단일 진입점. 키가 없으면 mock provider로 자동 폴백 → **API 키 없이도 dev 서버와 전체 UI가 항상 동작**한다. 실데이터 호출 실패 시 mock으로 조용히 폴백하지 않는다(가짜 실데이터 금지).
- **좌표는 WGS84 십진 도로 통일**. 네이버 지역 검색의 `mapx/mapy`(×10⁷ 정수)는 provider 안에서만 존재.
- **도보/대중교통 내비는 `nmap://` 딥링크로 네이버 지도 앱에 위임** (`src/lib/deeplink.ts`). NCP Directions는 자동차 전용이라 자체 구현 대상이 아니다.
- i18n: next-intl, `/ko` `/en` 경로 프리픽스, 메시지는 `messages/*.json`.

## API 키 현황 (2026-06-12)

| 키 | 상태 | 비고 |
|----|------|------|
| `NAVER_LOCAL_CLIENT_ID/SECRET` | 미발급 | developers.naver.com — 결제수단 불필요, 일 25,000회 |
| `NCP_MAPS_CLIENT_ID/SECRET` | **차단** | NCP 계정에 결제수단 미등록 → 사용자가 카드 등록 후 콘솔 Services > Application Services > Maps에서 Application 등록 |

상세 조사: `docs/RESEARCH-2026-06-naver-api-ecosystem.md` (2025년 NCP Maps 개편, 쿼터, 접근성, 딥링크 전부 정리됨). 설계 결정: `docs/SPEC.md`.

## 명령어

```bash
npm run dev        # 개발 서버 (localhost:3000)
npm run build      # 프로덕션 빌드
npm run lint       # ESLint
npm run test:run   # Vitest (게이트 테스트 — 매 커밋 통과 필수)
```

## 개발 규칙

- 기능·버그픽스는 같은 커밋에 테스트 동반 (워크스페이스 공통).
- 커밋 이메일 `engccer@gmail.com` (dodo-planet과 동일).
- 코드 주석·커밋 메시지·문서: 한국어. 변수/함수명: 영어.
- a11y 변경 후에는 `a11y-auditor` 서브에이전트로 점검.
