# 도보 길찾기(Tmap) + 길찾기 탭 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tmap 보행자 경로로 도보 수단을 신설하고, 임의 A→B 3수단 비교가 가능한 길찾기 진입점(웹 뷰 + iOS 4탭)을 만든다.

**Architecture:** 서버는 기존 provider 추상화(`src/lib/providers`)에 `tmap-pedestrian`을 추가하고 `/api/route/walk`로 노출. 웹은 History API 뷰 전환으로 길찾기 뷰를 신설하며 기존 자동차·대중교통 브리핑의 결과 렌더부를 공용 추출해 재사용. iOS는 같은 API를 소비하는 4탭 클라이언트 작업. 정본 spec: `docs/superpowers/specs/2026-07-21-walk-route-directions-tab-design.md`(§10-A 보강 계약 14조가 최우선).

**Tech Stack:** Next.js 16(App Router), TypeScript, Vitest, next-intl, SwiftUI(GildongmuKit).

## Global Constraints (spec 발췌, 전 태스크 공통)

- 게이트: `hasTmapKey()`(env `TMAP_APP_KEY`). 키 없으면 UI·라우트(404)·채팅 declaration·카탈로그 전부 0. mock 폴백 금지.
- Tmap 좌표 X=lng/Y=lat, `reqCoordType`/`resCoordType`="WGS84GEO", `startName`/`endName`은 ASCII 상수 "start"/"end".
- `description` 완성 문장이 낭독 정본. `turnType` 재조합 금지. 정규화 런타임 검증(유한 양수·steps≥1 아니면 throw).
- 도보는 V1 ko 전용: `prefersEnglish`면 섹션 미노출(`dataLocale` 경유, `useLocale()` 원시값 금지).
- `/api/route/walk`는 IP 레이트리밋(60초 10회) + `next.revalidate=3600`.
- `?dir=`에 현재 위치 좌표 직렬화 금지(`cur` 토큰만). 필드는 `{kind,label,coord|null}` 원자 상태, 라벨 편집 즉시 coord 무효화.
- 조회는 request-id ref + AbortController(15초). 포커스는 최신 세대 settled 후 첫 "성공" 수단 heading(`tabIndex=-1`) 1회. 성공 0건이면 이동 없음+polite 오류 1회.
- 수단별 없는 값은 생략(0·"-" 금지). 커밋은 pathspec 원자(`git add -A` 금지). 주석·커밋 한국어, em dash 금지.
- iOS 탭은 안정 식별자 enum. epoch 리셋 시 진행 Task cancel. 신규 문자열은 messages 정본→xcstrings 파이프라인+키 린터.

---

## Phase W: 서버 + 웹

### Task W1: 타입 + tmap-pedestrian provider

**Files:**
- Modify: `src/lib/types.ts` (TransitLeg 아래에 추가)
- Create: `src/lib/providers/tmap-pedestrian.ts`
- Create: `src/lib/__tests__/tmap-pedestrian.test.ts`
- Modify: `src/lib/env.ts` (TMAP_APP_KEY 편입, 기존 키들과 동형)

**Interfaces (Produces):**
```ts
// types.ts
export interface WalkRouteStep { description: string; distanceMeters?: number }
export interface WalkRouteBriefing { distanceMeters: number; durationSeconds: number; steps: WalkRouteStep[] }
// tmap-pedestrian.ts
export function hasTmapKey(): boolean
export function normalizeTmapWalkRoute(data: TmapRouteResponse): WalkRouteBriefing // 검증 실패 throw
export async function getWalkRouteBriefing(params: { origin: Coord; dest: Coord }): Promise<WalkRouteBriefing>
```

- [ ] Step 1: 실캡처 fixture로 실패 테스트 작성. fixture는 2026-07-21 길동 실호출 응답 축약본(Point feature에 description·totalDistance=2078·totalTime=1806, LineString 혼재, 마지막 Point "도착"). 테스트 케이스: ① 정규화가 Point의 description만 순서대로 추출 ② 첫 Point의 totalDistance/totalTime 투영 ③ totalTime 비유한/0이면 throw ④ steps 0개면 throw ⑤ description 없는 Point(경유 좌표점) 제외.
- [ ] Step 2: `npm run test:run -- tmap` 실행, 모듈 없음 FAIL 확인.
- [ ] Step 3: provider 구현. POST body `{startX,startY,endX,endY,reqCoordType:"WGS84GEO",resCoordType:"WGS84GEO",startName:"start",endName:"end"}`, 헤더 `appKey`, `next:{revalidate:3600}`. HTTP 비200 throw(`Tmap 보행자 경로 실패: HTTP ...`). 정규화는 순수 함수 분리. 파일 상단 주석에 X=lng 반전·description 정본·쿼터 계약 명기(kakao-navi.ts 주석 스타일 미러).
- [ ] Step 4: 테스트 5건 green 확인.
- [ ] Step 5: `git commit -- src/lib/types.ts src/lib/env.ts src/lib/providers/tmap-pedestrian.ts src/lib/__tests__/tmap-pedestrian.test.ts` "feat(walk): Tmap 보행자 provider + 정규화 런타임 검증"

### Task W2: /api/route/walk 라우트

**Files:**
- Create: `src/app/api/route/walk/route.ts`
- Create: `src/lib/rate-limit-walk.ts` 없음, 기존 `src/lib/chat/rate-limit.ts`(`checkChatRateLimit`)의 일반화 재사용: `src/lib/rate-limit.ts`로 이동·`checkRateLimit(bucket, ip, {windowMs, max})` 시그니처면 기존 채팅 호출부 함께 갱신(표시 동작 불변), 일반화가 과하면 walk 전용 사본 금지하고 공용화만.
- Test: `src/app/api/route/walk/__tests__/route.test.ts` (기존 transit route 테스트 파일 패턴 미러)

**Interfaces (Produces):** GET `/api/route/walk?origin=lat,lng&dest=lat,lng` → `{ result: WalkRouteBriefing | null }` | 400(zod) | 404(키 없음) | 429 | 502.

- [ ] Step 1: 실패 테스트: ① origin 형식 오류 400 ② 키 없으면 404 ③ 정상 경로 `{result}` shape(provider mock) ④ provider throw → 502 ⑤ 레이트리밋 초과 429.
- [ ] Step 2: FAIL 확인 → 구현(`export const dynamic` 불필요, revalidate는 provider fetch 옵션) → green.
- [ ] Step 3: 커밋 "feat(walk): /api/route/walk + IP 레이트리밋 공용화"

### Task W3: 브리핑 결과 렌더부 공용 추출

**Files:**
- Modify: `src/components/TransitRouteBriefing.tsx`, 결과 표시부(요약문·legs ol·arrive)를 `export function TransitRouteResult({route, locale, t, dest})`로 추출(파일 내 export, 현 내부 함수가 사실상 존재: 그 함수를 export로 승격)
- Modify: `src/components/CarRouteBriefing.tsx`, 동형으로 `export function CarRouteResult(...)` 추출
- Test: 기존 컴포넌트 테스트 없음(node-env) → 추출은 순수 이동임을 lint+build+AX 스냅샷(Task W7 실호출)으로 검증. 로직 변경 0이 계약.

- [ ] Step 1: 두 파일에서 결과 렌더 JSX를 export 함수로 승격(“이동만, 수정 금지”). props는 현재 클로저에서 받던 값 그대로 명시.
- [ ] Step 2: `npm run lint && npm run build` green.
- [ ] Step 3: 커밋 "refactor(route): 브리핑 결과 렌더부 export 승격(표시 불변)"

### Task W4: WalkRouteBriefing 컴포넌트 + i18n

**Files:**
- Create: `src/components/WalkRouteBriefing.tsx` (결과 렌더 전용: `WalkRouteResult({briefing})`)
- Modify: `messages/{ko,en,es,fr,it}.json`, `route.walk.*` 키 신설(en 이하도 키는 존재해야 i18n 게이트 통과: 도보는 ko 전용이지만 키 부재는 린트 실패)

**i18n 키(ko 정본):** `route.walk.heading`="도보", `route.walk.summary`="총 {distanceKm}km, 약 {minutes}분", `route.walk.noRoute`="도보 경로를 찾지 못했습니다.", `route.walk.error`="도보 경로를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." (en/es/fr/it는 대응 번역, 표시 자체는 ko 로케일 한정이나 키 일관성 유지)

- [ ] Step 1: 컴포넌트 구현, `<h3 tabIndex={-1}>` 없음(heading은 뷰가 소유), 요약 `<p>` 1문장 + `<ol>` step당 `<li>{description}</li>` 단일 텍스트. distanceKm은 `(m/1000).toFixed(1)`, minutes는 `Math.round(sec/60)`.
- [ ] Step 2: 5로케일 키 추가(파이썬 스크립트로 삽입, diff 로케일당 4줄) + `npm run test:run -- i18n` green.
- [ ] Step 3: 커밋 "feat(walk): 도보 브리핑 컴포넌트 + route.walk 5로케일 키"

### Task W5: 길찾기 뷰 + 진입점

**Files:**
- Create: `src/components/DirectionsView.tsx` (뷰 본체)
- Create: `src/lib/directions-state.ts` (원자 필드 상태·`?dir=` 직렬화/파싱 순수 로직)
- Test: `src/lib/__tests__/directions-state.test.ts`
- Modify: `src/components/PlaceSearch.tsx`(홈 "길찾기" 진입 버튼+뷰 전환 배선), `src/components/PlaceDetail.tsx`("길찾기" 버튼 → 도착지 프리필)
- Modify: `messages/*`, `directions.*` 키(제목 "길찾기", 출발지/도착지/스왑/조회/조회 중/현재 위치/오류 합산 통지 등 10여 키 5로케일)

**Interfaces:**
```ts
// directions-state.ts (React 비의존 순수)
export type DirEndpoint = { kind: "current" } | { kind: "place"; label: string; coord: Coord }
export function serializeDir(from: DirEndpoint, to: DirEndpoint | null): string   // current → "cur", place → "이름@lat,lng" URL-safe
export function parseDir(raw: string | null): { from: DirEndpoint; to: DirEndpoint | null } | null  // 불량 입력 null(빈 폼 폴백)
```

- [ ] Step 1: `directions-state` 실패 테스트: 직렬화 왕복, `cur` 토큰(좌표 미포함 확인!), 불량 문자열 null, 부분(`to` 없음) 허용.
- [ ] Step 2: 구현 → green.
- [ ] Step 3: `DirectionsView` 구현. 계약: ① 필드 2개(출발 기본 `{kind:"current"}` 라벨 "현재 위치"), 필드 탭 시 미니 검색(장소+주소 병렬, 기존 `/api/places`·`/api/address/search` fetch 재사용, 후보 리스트에서 선택 시 원자 교체; 라벨 텍스트 수정 시 coord null) ② 스왑 버튼 ③ 조회 버튼(`aria-disabled`+in-flight ref) ④ 조회: `kind:"current"`면 `awaitGeolocation()`, 3수단 `Promise.allSettled`(walk는 `prefersEnglish`면 제외) + AbortController 15초 + 세대 ref ⑤ 결과: `h3 tabIndex=-1` 수단 heading(대중교통→도보→자동차) + `TransitRouteResult`/`WalkRouteResult`/`CarRouteResult` ⑥ 단일 polite live region 합산 통지 1회 + 첫 성공 heading 포커스(성공 0건은 통지만) ⑦ `?dir=` pushState 동기화·popstate 복원(현재 위치는 재측위).
- [ ] Step 4: 진입점 배선, 홈 버튼(min-h-11, 뷰 전환+포커스 이동), PlaceDetail "길찾기"(`to`=장소 프리필). 기존 검색·상세 흐름 회귀 없음(History 스택 규율은 장소 상세 전환 패턴 미러).
- [ ] Step 5: `npm run test:run && npm run lint && npm run build` green.
- [ ] Step 6: 커밋 "feat(directions): 길찾기 뷰(3수단 비교)+진입점+?dir= 동기화"

### Task W6: 채팅 도구 + CLI/MCP 카탈로그

**Files:**
- Modify: `src/lib/chat/declarations.ts`(`get_walk_route`, 게이트 `hasTmapKey`), `src/lib/chat/router.ts`(실행부: 목적지 지오코딩은 기존 길찾기 2종 헬퍼 재사용, `origin=ctx.userLocation` 불변식, data는 요약+steps 상위 20 캡), `src/lib/chat/sources.ts`(출처 표기 기존 패턴)
- Modify: `packages/cli/…endpoint-catalog-shared.ts` + `packages/mcp/…`(両미러, drift 테스트가 강제)
- Test: 기존 router 테스트 파일에 케이스 추가(게이트 off면 declaration 부재 / 실행부 직접 호출도 차단)

- [ ] Step 1: 실패 테스트 → 구현 → green(전체 `npm run test:run`).
- [ ] Step 2: 커밋 "feat(walk): 채팅 get_walk_route + CLI/MCP 카탈로그 route walk"

### Task W7: 웹 게이트 + 실호출 + 배포

- [ ] Step 1: `npm run test:run && npm run lint && npm run build` 전체 green.
- [ ] Step 2: dev 실호출 게이트(spec §9-1·2·3): walk API 길동→강동역 / 비상식 거리(제주→서울 도보, 응답 코드 관측→graceful 코드 확정 반영) / 뷰 E2E(`?dir=` 복원 포함) / en 도보 미노출 / 장소 상세 프리필.
- [ ] Step 3: 서브에이전트 코드 리뷰(스펙 §10-A 14조 준수 중심) → fix 반영.
- [ ] Step 4: pathspec 원자 커밋 + push(자동 배포) → prod smoke: `https://gildongmu.vercel.app/api/route/walk?...` 1건 + 뷰 로드.
- [ ] Step 5: PROGRESS.md 갱신 커밋.

## Phase I: iOS (웹 머지 후)

### Task I1: Kit 모델 + API

**Files:** `ios/GildongmuKit/Sources/...`(모델 `WalkRouteBriefing`·`WalkRouteStep` Codable, `APIClient.walkRoute(origin:dest:)`), Kit 테스트(fixture 디코딩 + 404 게이트 처리).
- [ ] 실패 테스트 → 구현 → `swift build && swift test` green → 커밋.

### Task I2: 4탭 개조(안정 ID) + epoch

**Files:** `ios/Gildongmu/GildongmuApp.swift`(탭 enum `case chat, search, directions, nearby`, rawValue 문자열 안정 ID, 기존 저장 선택값 마이그레이션), `TitleMenu.swift`(`directionsEpoch`), 유휴 리셋 대상 편입, epoch 증가 시 진행 Task cancel 계약.
- [ ] 구현 → 빌드 green → 커밋.

### Task I3: DirectionsTabView

**Files:** `ios/Gildongmu/Directions/DirectionsTabView.swift`(+모델). 계약은 웹 §5 동형: 원자 필드·검색 시트(`SearchService` 재사용)·스왑·조회(권한은 조회 시점)·수단 heading `.isHeader`+`AccessibilityNotification` 포커스·단일 Announcement·없는 값 생략·ko 전용 도보 분기(`AppLanguage`).
- [ ] 구현 → 빌드+Kit 테스트 green → 커밋.

### Task I4: 프리필 진입

**Files:** `LaunchActionStore` 확장(대상 탭+1회 소비), 장소 상세·검색 행 "길찾기" 액션(VoiceOver 커스텀 액션 포함, 로터 순서는 역순 선언 함정 주의).
- [ ] 구현 → 빌드 green → 커밋.

### Task I5: i18n + AX 게이트 + 배포

- [ ] `messages-to-xcstrings` 재생성 + `check-xcstrings-keys.mjs` green.
- [ ] 시뮬레이터 AX 덤프: 4탭 낭독·수단 heading·step 블록 분리·장소 상세 브리핑 AX 동등(§10-A 13).
- [ ] 서브에이전트 리뷰 → fix → pathspec 커밋 + push.
- [ ] `ios/deploy-device.sh` 실기기 배포(기기 연결 시). 실기기 VoiceOver 게이트 6항목은 위원장 QA 대기로 PROGRESS 기록.

## Self-Review 결과

- Spec 커버리지: §1 A~E → W1·W2(A) W5(B·D웹) I2·I3(C) I4(D iOS) W6(E). §4 ko 전용 → W5-④·I3. §10-A 14조 → Global Constraints+각 태스크 계약에 배선. 갭 없음.
- 실기기 VoiceOver(§9-4 후반)는 위원장 게이트라 계획 밖 대기 항목으로 명시.
