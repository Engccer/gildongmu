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
- **자동차 경로 텍스트 브리핑** (`/api/route/car` + `CarRouteBriefing` 컴포넌트): 카카오모빌리티 directions의 `guides[].guidance`(완성된 한국어 안내문)를 낭독 정본으로 사용. 실주행 내비가 아니라 "출발 전 경로 미리 듣기" — 실주행은 딥링크 위임 원칙 유지.
- **버튼 비활성화는 `disabled` 대신 `aria-disabled` + 핸들러 가드** — `disabled`는 포커스를 제거해 스크린 리더 사용자가 맥락을 잃는다 (a11y 감사 반영, 2026-06-13).
- i18n: next-intl, `/ko` `/en` 경로 프리픽스, 메시지는 `messages/*.json`.

## API 키 현황 (2026-06-13)

| 키 | 상태 | 비고 |
|----|------|------|
| `KAKAO_REST_API_KEY` | **동작 확인 (2026-06-12)** | dodo-planet 카카오 앱(ID 1383407) 키 재사용(.env.local). 카카오맵 제품 활성화 완료. 이 키 하나로 **로컬 검색 + 주소 지오코딩 + 카카오모빌리티 자동차 경로**까지 모두 동작 (모빌리티는 별도 활성화 불필요, 2026-06-13 검증) |
| `TOUR_API_KEY` | 미발급 (provider 구현 완료) | data.go.kr 회원가입 → 관광정보 서비스 활용신청 (자동 승인). **Decoding 키**를 넣을 것. en 로케일 장소 검색이 자동으로 TourAPI 우선 |
| `NAVER_LOCAL_CLIENT_ID/SECRET` | 미발급 | developers.naver.com 수동 등록 필요 (Claude in Chrome이 해당 도메인 차단) — 결제수단 불필요, 일 25,000회 |
| `NCP_MAPS_CLIENT_ID/SECRET` | 차단 | NCP 계정 결제수단 미등록 → 카드 등록 후 콘솔 Maps > Application 등록 |

상세 조사: `docs/RESEARCH-2026-06-naver-api-ecosystem.md`, `docs/RESEARCH-2026-06-kakao-api-ecosystem.md`. 설계 결정: `docs/SPEC.md`.

## 배포

- **Vercel 프로덕션**: https://gildongmu.vercel.app (2026-06-13 최초 배포, 팀 `hunyong-kims-projects`)
- 환경변수는 Vercel 프로젝트에 등록 (`KAKAO_REST_API_KEY` — Production/Preview/Development 전체). 주의: CLI `vercel env add <key> preview`는 비대화형에서 `git_branch_required`로 멈추는 결함(54.12.2에서도 재현) — Preview 등록은 REST API(`POST /v10/projects/{id}/env`) 또는 대시보드 사용
- GitHub 저장소(`Engccer/gildongmu`)가 Vercel에 연결됨 — **push하면 자동 배포**된다. push는 사용자 요청 시에만 하는 워크스페이스 규칙이 곧 배포 게이트.
- 수동 배포: `vercel deploy --prod --yes`

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
