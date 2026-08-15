# 작은 고침 묶음 (A7·A13·A11·G4②·§7 잔일) 구현 계획

> **For agentic workers:** 이 계획은 백로그의 확정 처방을 코드로 옮기는 것이다. 처방을 재설계하지 않는다.

**Goal:** 2026-08-16 판정 세션에서 처방이 확정된 백로그 항목 4건(A7·A13·A11·G4②)과 편승을 포기한 §7 잔일 6건(D18·D19·D20·D22·D23·D12)을 한 세션에서 닫는다.

**Architecture:** A7은 `Coord`에 취득 시각을 심어 나이 기준 재취득을 가능케 하고(웹), A13은 안내 시작 인자를 모델이 소유하게 바꿔 재시작이 승계하게 한다(iOS). 이 둘이 A11(출입구 승격)이 서는 토대다 — 승격된 목적지가 재시작·재조회를 건너 살아남아야 하고, 승격 판정은 신선한 출발지 좌표를 전제한다.

**Spec:** A11만 별도 설계 문서 — `docs/superpowers/specs/2026-08-16-destination-entrance-promotion-design.md`. 나머지는 `docs/BACKLOG.md`의 처방 문장이 곧 스펙이다.

## 구현 방식 판정 (AUTONOMY §구현 방식 판정)

**inline.** 근거: ①A7·A13·A11이 순차 의존이다(`Coord.at` → 나이 판정 → 승격 조회의 출발지 신선도 / 시작 인자 소유 → 승격본 승계) ②A13·A11·D12·D23이 **같은 파일 둘**(`DirectionsTabView.swift`·`BeaconModel.swift`)을 편집한다 ③A11은 외부 API(카카오 출입구 POI) 통합이라 실호출로 설계가 뒤집힐 수 있는 탐색적 작업이다. 리뷰는 이 판정과 무관하게 별도 컨텍스트에 맡긴다.

## Global Constraints

- 기능·버그픽스는 **같은 커밋에 테스트 동반**. 웹 게이트 `npm run test:run`·`npx tsc --noEmit`·`npm run lint` 전부 0/green이 기준선.
- 웹↔Kit 미러가 있는 값은 드리프트 테스트를 함께 본다.
- 좌표 쿼리 파라미터는 `src/lib/coord-param.ts` 경유(`Number("")===0` 함정).
- 신규 좌표 라우트 순서: 파싱 → 커버리지 마커 → 키 게이트 → upstream.
- SR 통지에 뻔한 꼬리 문장 금지. 한 줄 = 한 접근성 객체.
- 커밋은 의도 파일만(`git add -A` 금지). 리뷰 통과 후 commit + push 자동. iOS를 건드렸으면 실기기 배포까지가 한 사이클.

---

## Task 1 — A7: 길찾기 출발지 좌표의 나이 기준 재취득 (웹)

**Files:**
- Modify: `src/lib/types.ts`(`Coord`에 `at`), `src/lib/geolocation.ts`(fix 시각 기록 + `maxAgeSeconds` 옵션), `src/lib/effective-location.ts`(`toRealFix`가 실제 `at`을 쓴다), `src/components/DirectionsView.tsx`(`runQuery`)
- Test: `src/lib/__tests__/geolocation.test.ts`(신규 또는 기존), `src/lib/__tests__/effective-location.test.ts`

**계약**
- `Coord.at?: number` — epoch **초**(`effective-location.ts`의 `Date.now()/1000`과 같은 단위. 밀리초를 섞으면 나이가 1000배로 어긋난다).
- `LocateOptions.maxAgeSeconds?: number` — 지정하면 `ready` 캐시라도 나이가 그보다 크면 재취득한다. `force`와 다른 축이다: `force`는 정밀 재취득(`PRECISE_OPTS`), `maxAgeSeconds`는 **조건부** 재취득이고 옵션 자체는 정밀도를 바꾸지 않는다.
- `DIRECTIONS_MAX_AGE_SECONDS = 180`(위원장 판정 "3분"). `DirectionsView.runQuery`는 `awaitEffectiveLocation({ force: false, maxAgeSeconds: DIRECTIONS_MAX_AGE_SECONDS })`.
- 대상은 GPS 경로뿐 — 수동 위치는 `awaitManualLocation`이 먼저 답하므로 나이 판정에 닿지 않는다(구조가 곧 범위 제한).
- 재취득 시 정밀도: `maxAgeSeconds` 초과 재취득은 **정밀 옵션**(`PRECISE_OPTS`)으로 간다. 이동 뒤라는 판정이 이미 섰고, 그 상황의 저정밀 fix는 출발지로 쓰기에 나쁘다(최대 15초 대기는 위원장 판정이 수용한 비용).

**테스트(먼저 실패시킨다)**
- `at`이 없는 저장분(구 캐시)은 "나이 불명"으로 보고 **재취득**한다(나이 없는 캐시를 신선으로 치면 종전 동작으로 되돌아간다 — Kit `isCacheFresh` 계약과 같은 방향).
- 3분 이내 캐시는 `getCurrentPosition` 재호출 0회.
- 3분 초과 캐시는 재호출 1회 + 새 좌표 반환.
- `maxAgeSeconds` 미지정 소비자의 동작은 byte-identical(회귀 0).

## Task 2 — A13: 안내 재시작이 시작 인자를 승계 (iOS)

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift`, `ios/Gildongmu/Directions/DirectionsTabView.swift`
- Modify(가드): `src/lib/__tests__/guidance-gate-drift.test.ts`, spec `docs/superpowers/specs/2026-08-15-walk-guidance-ship-design.md` §3.2 표

**계약**
- `BeaconModel`이 `struct StartRequest { dest, label, kind, accessible, variant, shortestAvailable }`를 **세션 시작 시점에 저장**한다(`toggle`의 시작 분기 한 곳).
- `func restart()` — 저장된 `StartRequest`로 다시 시작한다. 저장분이 없으면 아무것도 하지 않는다(추측 기본값 금지, [[no-default-for-safety-parameters]]).
- `DirectionsTabView`의 `.precise` 복구 경로는 `beacon.restart()`를 부른다. 인자를 하나 더 넘기지 않는다.
- **가드 갱신**: `guidance-gate-drift.test.ts` 검사 3의 판정 축은 "세션을 시작시키는 호출 전수"다. `beacon.toggle(`만 세면 `restart()`가 그 축에서 빠지므로 **두 형태를 합쳐 6곳**으로 센다. spec §3.2 표의 그 행을 `restart()`로 고쳐 적는다.

**테스트**
- 웹 가드(`guidance-gate-drift.test.ts`): 진입점 총수 6 유지 + `restart(` 호출이 정확히 1곳.
- iOS는 앱 타깃 테스트 레인이 없다. 대신 `StartRequest` 저장·재사용은 **한 함수 안**에 두어 육안 검토가 성립하게 하고, 그 사실을 주석으로 남긴다(D8과 같은 한계 인정 방식).

## Task 3 — A11: 출입구 승격

spec `2026-08-16-destination-entrance-promotion-design.md`가 정본. 하위 태스크:

**3a. 순수 판정 계층** — Create `src/lib/entrance.ts`, Test `src/lib/__tests__/entrance.test.ts`(spec §1 실측 6응답 fixture).
**3b. provider + 라우트** — Modify `src/lib/providers/kakao-local.ts`(출입구 질의 함수), Create `src/app/api/places/entrance/route.ts` + `__tests__`.
**3c. 실호출 게이트** — 신명중학교 승격 전/후 `finalApproach` 오프셋 대조(스크립트 1회, 결과를 spec §7에 기록).
**3d. 웹 소비** — `DirectionsView.runQuery` 승격 + 문장 1줄 + i18n 7로케일.
**3e. iOS 소비** — `DirectionsTabView`(모델 `performQuery` + `trackedDestination` + 문장) + `ios/i18n` 파이프라인.

## Task 4 — G4②: 업데이트 이력이 미출시 버전을 감춘다 (iOS)

**Files:** `ios/Gildongmu/…/ReleaseNotesView.swift`, 대응 테스트(웹 게이트에 드리프트 테스트가 있으면 그쪽)

**계약**
- 설치된 빌드의 `CFBundleShortVersionString`보다 **높은** 항목은 목록에서 뺀다. 비교는 문자열이 아니라 **버전 성분 수치 비교**다(`1.10` > `1.9`, `1.7` vs `1.7.0` 동일 — 산출물 검사가 이 함정으로 두 번 막힌 전례가 있다).
- 같은 버전·낮은 버전은 그대로. 미리 등재하는 관례는 유지한다(생성 스크립트 무변).
- 비교 함수는 순수 함수로 분리해 테스트 가능하게 둔다(Kit 또는 뷰 파일 내 `internal` 함수 + 웹 드리프트 테스트로 규칙 고정).

## Task 5 — §7 잔일 6건

각각 독립. 사용자 가시 둘(D18 ①②·D12)이 착수 근거다.

- **D18 ①** 검색 결과 거리(웹·iOS)가 수동 위치를 본다.
- **D18 ②** 웹 `LocalConditions`가 수동 위치를 본다(iOS는 이미 본다).
- **D18 ③** `ManualLocationPicker`가 `resolveAddressCoord`의 4-state를 뭉개지 않는다.
- **D18 ④** Swift `isValid`가 `origin.at` 유한성을 검증한다(웹 zod와 동조).
- **D19** 포그라운드 복귀 판정이 공유 스토어를 `locating`으로 되돌리지 않는다(판정은 유지, 비용만 없앤다).
- **D20** 문구 게이트 사각 둘(`nearbyLiveMessage` 간접 키·표시줄 자신)을 스캔에 넣는다.
- **D22** iOS 표시줄이 "권한 있음 + fix 부재"를 실패로 승격한다(웹 `gpsFailed` 동조).
- **D23** `BeaconModel` 소스 가드를 웹 `useRouteGuide.realfix.test.ts`의 정규식 3축 모델로 바꾼다.
- **D12** 재획득 hold 직후 `statusText`만 되돌린다(`offRoute` 플래그·재조회 버튼은 무변).
- **D5** `tago-coverage.ts` seed 적재에서 2자리 코드 제외.

## 리뷰·마무리

1. 묶음별 spec-compliance + code-quality 서브에이전트 리뷰(별도 컨텍스트, 요구사항+diff만).
2. 게이트: `npm run test:run` · `npx tsc --noEmit` · `npm run lint`.
3. 커밋·push(자동 배포) → iOS 실기기 배포(공식판·실험판 둘 다).
4. 문서 분배: 서사 → `CHANGELOG.md`, 남은 판정 → `docs/BACKLOG.md`, 새 함정 → `CLAUDE.md`, 상태 한 줄 → `PROGRESS.md`.
