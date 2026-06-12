# CLAUDE.md — 길동무 (gildongmu)

> Next.js 16 주의: 이 버전은 학습 데이터와 컨벤션이 다를 수 있다. 코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드를 먼저 읽을 것 (요청 API 전부 비동기: `await params`, `await cookies()`; `middleware.ts` 대신 `proxy.ts`).

## 프로젝트 정체성

**국내 서비스 연동 실험실.** 네이버·카카오를 시작으로 대한민국 로컬 서비스 API(지도, 내비게이션, 장소, 예약, 관광 등)를 계속 발굴·추가하며, 접근성 우선 미니멀 UI로 실험한다. 두 사용자 집단이 1급 시민:

1. **시각장애인** — 스크린 리더만으로 전체 흐름(검색 → 장소 정보 → 길찾기)이 완결되어야 한다.
2. **한국 방문 외국인** — 한국어를 몰라도 쓸 수 있는 미니멀한 영어 UI.

**궁극 목표**: 여기서 검증된 기능을 `~/Mac-Projects/dodo-planet/`(가족 여행 가이드 PWA)에 통합한다. 이 저장소는 인큐베이터 — 따라서 **스택·컨벤션을 dodo-planet과 일치**시키고(next-intl 4, zod 4, Vitest 4, App Router), `src/lib/`는 React/Next 비의존으로 유지해 이식성을 보장한다.

## 절대 원칙: 접근성

- **정보의 정본은 리스트/텍스트 UI다. 지도는 시각 보조 레이어다.** 네이버·카카오 지도 SDK는 캔버스 렌더링이라 스크린 리더 접근 불가 — 지도에만 존재하는 정보가 있으면 그것은 버그다.
- 상태 변화(검색 결과 수, 오류, 경로 안내)는 `aria-live` 영역으로 통지한다.
- 모든 인터랙티브 요소는 키보드 도달 가능 + `:focus-visible` 스타일 필수.
- 터치 타깃 최소 44×44px (`min-h-11` 이상).
- UI 메뉴/버튼 라벨에 이모지 금지 (워크스페이스 공통 원칙).

## 아키텍처

```
클라이언트 컴포넌트 ──fetch──▶ Route Handler (src/app/api/*) ──▶ 외부 API
                                 (Secret은 서버 전용 env에만 존재)
```

- **Provider 추상화** (`src/lib/providers/`): 도메인별 단일 진입점(예: `searchPlaces()`)이 키 유무로 provider를 자동 선택. **새 국내 서비스 추가 시 이 패턴을 따른다** — provider 파일 추가 → 진입점에 선택 로직 → mock 폴백 유지.
  - 장소 검색 우선순위: **kakao-local(15건) > naver-local(5건) > mock**. `PLACES_PROVIDER` env로 강제 지정(A/B 실험).
  - 실데이터 호출 실패 시 mock으로 조용히 폴백하지 않는다(가짜 실데이터 금지).
- **좌표는 WGS84 십진 도로 통일**. 네이버 지역 검색의 `mapx/mapy`(×10⁷ 정수)는 provider 안에서만 존재. 카카오는 WGS84 그대로.
- **내비게이션은 딥링크로 네이티브 앱 위임**: `src/lib/deeplink.ts`(nmap://), `src/lib/deeplink-kakao.ts`(kakaomap://). NCP/카카오내비 Directions는 자동차 전용이라 도보·대중교통 자체 구현 대상이 아니다.
- i18n: next-intl, `/ko` `/en` 경로 프리픽스, 메시지는 `messages/*.json`.

## API 키 현황 (2026-06-12)

| 키 | 상태 | 비고 |
|----|------|------|
| `KAKAO_REST_API_KEY` | **키 확보, 서비스 비활성** | dodo-planet 카카오 앱 키 재사용(.env.local에 있음). 카카오 디벨로퍼스에서 카카오맵(OPEN_MAP_AND_LOCAL) 활성화 필요 — 활성화 즉시 동작 |
| `NAVER_LOCAL_CLIENT_ID/SECRET` | 미발급 | developers.naver.com — 결제수단 불필요, 일 25,000회 |
| `NCP_MAPS_CLIENT_ID/SECRET` | 차단 | NCP 계정 결제수단 미등록 → 카드 등록 후 콘솔 Maps > Application 등록 |

상세 조사: `docs/RESEARCH-2026-06-naver-api-ecosystem.md`, `docs/RESEARCH-2026-06-kakao-api-ecosystem.md`. 설계 결정: `docs/SPEC.md`.

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
- 새 서비스 실험을 추가할 때는 `docs/SPEC.md`의 "실험 백로그" 표를 갱신할 것.
