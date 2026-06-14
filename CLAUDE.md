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
  - **en 로케일은 카카오 + TourAPI 병합**(`searchPlacesMergedEn`): TourAPI는 관광 콘텐츠만 커버해 일상 장소(학교·카페 등)를 못 찾으므로, 카카오를 기본으로 두고 TourAPI 영문 관광 정보를 보강한다. 두 소스를 병렬 호출해 한쪽 실패해도 다른 쪽 실데이터는 보존하고, 둘 다 실패하면 에러를 던진다. 중복은 좌표 4자리(약 11m)로만 판정해 카카오를 우선 남긴다(이름은 한/영으로 갈려 비교 불가). en+TourAPI만 있으면 TourAPI 단독, 카카오만 있으면 카카오 단독.
  - **en 병합 결과의 카카오 카드는 영문 주소 보강**(`enrichEnglishAddresses` → `ncp-geocode.ts`): 카카오는 한글 주소만 주므로 NCP Maps Geocoding으로 `englishAddress`를 채운다. TourAPI 카드는 이미 영문 주소라 건드리지 않고, `hasNcpMapsKeys()` 가드로 NCP 키 없으면 단계 자체를 건너뛴다. 영문 주소는 best-effort 보강 — `geocodeEnglishAddress`는 HTTP·네트워크 실패를 모두 null로 흡수하고 throw하지 않아, 변환 실패 카드는 한글 주소로 graceful degrade한다. UI는 영문을 메인·한글을 보조(`lang="ko"`)로 표시.
  - 실데이터 호출 실패 시 mock으로 조용히 폴백하지 않는다(가짜 실데이터 금지).
- **좌표는 WGS84 십진 도로 통일**. 네이버 지역 검색의 `mapx/mapy`(×10⁷ 정수)는 provider 안에서만 존재. 카카오는 WGS84 그대로.
- **내비게이션은 딥링크로 네이티브 앱 위임**: `src/lib/deeplink.ts`(nmap://), `src/lib/deeplink-kakao.ts`(kakaomap://). NCP/카카오내비 Directions는 자동차 전용이라 도보·대중교통 자체 구현 대상이 아니다.
- **자동차 경로 텍스트 브리핑** (`/api/route/car` + `CarRouteBriefing` 컴포넌트): 카카오모빌리티 directions의 `guides[].guidance`(완성된 한국어 안내문)를 낭독 정본으로 사용. 실주행 내비가 아니라 "출발 전 경로 미리 듣기" — 실주행은 딥링크 위임 원칙 유지.
- **버튼 비활성화는 `disabled` 대신 `aria-disabled` + 핸들러 가드** — `disabled`는 포커스를 제거해 스크린 리더 사용자가 맥락을 잃는다 (a11y 감사 반영, 2026-06-13). 단 `aria-disabled`만으로는 빠른 더블클릭/Enter 반복 시 같은 렌더의 클로저 가드가 중복 호출을 못 막으므로, 비동기 트리거에는 **in-flight ref 가드**(`useRef(false)` + `finally` 해제)를 병행한다(codex 리뷰 반영, 2026-06-14).
- **검색 → 결과 → 장소 상세 흐름 (v2, 2026-06-14)**: 입력은 검색창 하나. 결과는 카테고리 버킷 칩으로 필터(`ChipFilter`), 장소를 고르면 **같은 페이지 내 뷰 전환 + History API**로 상세(`PlaceDetail`)를 연다 — 카카오 로컬은 ID 단건 조회가 없어 메모리의 `Place`로 상세를 그린다. `openDetail`이 `pushState`로 백버튼 포착용 trap 엔트리를 쌓고, `popstate`가 단일 수렴점으로 목록 복귀 + 결과 헤딩 포커스 이동을 담당(딥링크 상세 복원은 비목표). 검색은 `?q=` URL 동기화 + request-id ref로 stale 응답을 버린다. 상세에 길찾기 딥링크·자동차 브리핑·(역이면)역 편의시설을 집약.
- **역 교통약자 편의시설** (`korail-facilities` provider + `/api/station/facilities` + `StationFacilities`): 철도공사 API(15125774)가 역명 필터를 무시해 406역 전체를 받아 `normalizeStationName`으로 클라이언트 매칭(일 1회 revalidate). 교통약자(`/weekPersonFacilities`)와 엘리베이터(`/stationFacilities`)를 **`stn_cd` 조인**(역명 조인은 동명이역 혼입 위험). **정본 정확성**: "0대"와 "정보 없음"을 뭉개지 않음(`num→number|undefined`), 주 데이터 upstream 장애는 throw→502(미커버 `null`과 구분). 도시철도(지하철)는 미포함이라 매칭 실패=graceful degrade.
- i18n: next-intl, `/ko` `/en` 경로 프리픽스, 메시지는 `messages/*.json`. **로케일별 단일 언어**(혼용 제거) + 언어 전환기(`LanguageSwitcher`)가 경로·`?q=`(`replaceState` 후 커스텀 이벤트로 동기화)·`NEXT_LOCALE` 쿠키를 보존. SSG hydration 안전(`useSyncExternalStore`, 서버 스냅샷 `""`).

## API 키 현황 (2026-06-13)

| 키 | 상태 | 비고 |
|----|------|------|
| `KAKAO_REST_API_KEY` | **동작 확인 (2026-06-12)** | dodo-planet 카카오 앱(ID 1383407) 키 재사용(.env.local). 카카오맵 제품 활성화 완료. 이 키 하나로 **로컬 검색 + 주소 지오코딩 + 카카오모빌리티 자동차 경로**까지 모두 동작 (모빌리티는 별도 활성화 불필요, 2026-06-13 검증) |
| `TOUR_API_KEY` | **동작 확인 (2026-06-13)** | data.go.kr 국문·영문 GW 활용신청 승인(만료 2028-06-13), 실응답 검증 완료(빈 결과 `items:""`, contenttypeid 라벨 매핑 확정). 신형 GW는 **hex 64자 단일 키**(Encoding/Decoding 구분 없음, 승인 후 전파 ~10분간 401). **개발계정은 기능당 일 1,000건**(상향은 운영계정 신청). en 로케일 장소 검색은 카카오와 병합(`searchPlacesMergedEn`)되어 일상 장소+관광 영문 정보를 함께 노출 — 로컬 실호출 검증됨(2026-06-13) |
| `DATA_GO_KR_API_KEY` | **동작 확인 (2026-06-14)** | **`TOUR_API_KEY`와 동일 값** — data.go.kr은 계정당 단일 인증키라 모든 승인 API가 공유. "TOUR" 이름에 묶이지 않는 정식 별칭으로 추가(향후 TAGO 버스·열차·무장애여행 등 data.go.kr 서비스 공용). 현재 **한국철도공사 편의시설(15125774)** 승인·실호출 검증 완료: `apis.data.go.kr/B551457/convenience`의 `/stationFacilities`·`/weekPersonFacilities`(교통약자: 장애인화장실유무 `pwdbs_tolt_estnc`·휠체어리프트수 `whlch_liftt_cnt`)·`/parkingLots`·`/codes`, 각 일 10,000건, 전국 406역. 신규 API 추가는 같은 키로 data.go.kr 활용신청만 하면 즉시 자동승인 |
| `NAVER_LOCAL_CLIENT_ID/SECRET` | 미발급 | developers.naver.com 수동 등록 필요 (Claude in Chrome이 해당 도메인 차단) — 결제수단 불필요, 일 25,000회 |
| `NCP_MAPS_CLIENT_ID/SECRET` | **동작 확인 (2026-06-13)** | 결제수단 등록 후 Maps 구독 + Application `gildongmu` 등록(API 6종 전체 체크, Web URL: vercel.app·localhost:3000·3001). Geocoding(`englishAddress` 포함)·Directions 5 실호출 검증. 호스트 `maps.apigw.ntruss.com`, 헤더 `x-ncp-apigw-api-key-id`/`x-ncp-apigw-api-key`. **en 검색 카카오 카드의 영문 주소 보강에 사용 중**(`ncp-geocode.ts`, 2026-06-13 연결) — Directions는 카카오모빌리티와 중복이라 미연결 |

상세 조사: `docs/RESEARCH-2026-06-naver-api-ecosystem.md`, `docs/RESEARCH-2026-06-kakao-api-ecosystem.md`, **`docs/RESEARCH-2026-06-domestic-api-expansion.md`**(우편번호·버스·지하철·맛집·예약·접근성 6개 도메인 + KRIC 교통약자 §I). 설계 결정: `docs/SPEC.md`.

## 배포

- **Vercel 프로덕션**: https://gildongmu.vercel.app (2026-06-13 최초 배포, 팀 `hunyong-kims-projects`)
- 프로덕션 환경변수 현황(2026-06-14): `KAKAO_REST_API_KEY`(Production), `TOUR_API_KEY`(Production/Preview/Development), `NCP_MAPS_CLIENT_ID`·`NCP_MAPS_CLIENT_SECRET`(Production — en 영문 주소 보강용), `DATA_GO_KR_API_KEY`(Production — 역 교통약자 편의시설, 2026-06-14 추가). `vercel env ls production`으로 확인.
- **환경변수는 배포 시점에 함수로 주입된다** — 키를 추가/변경한 뒤에는 반드시 재배포(`vercel deploy --prod --yes` 또는 push)해야 이미 떠 있는 배포에 반영된다. 키만 추가하고 재배포 안 하면 기존 함수는 옛 env를 본다(2026-06-13 NCP 키 등록 시 실측).
- 비대화형 등록: `printf '%s' "$VALUE" | vercel env add <KEY> production`. 주의: CLI `vercel env add <key> preview`는 비대화형에서 `git_branch_required`로 멈추는 결함(54.12.2에서도 재현) — Preview 등록은 REST API(`POST /v10/projects/{id}/env`) 또는 대시보드 사용
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
