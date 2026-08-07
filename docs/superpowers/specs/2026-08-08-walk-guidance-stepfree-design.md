# 계단 회피 상태의 실시간 도보 안내 전달 설계 (백로그 A4 + D1 편승)

> 2026-08-08. 백로그 `docs/BACKLOG.md` §A4(정합 결함)와 §D1(카카오 도보 잔여, "다음에 도보를 손댈 때 편승")을 한 마일스톤으로 닫는다. 관련 항구 규칙은 `CLAUDE.md`의 "도보 경로" 행과 접근성 헌장 §1(3-state 불변식).

## 1. 문제

브리핑에서 계단 회피를 켠 뒤 도보 안내를 시작하면, **안내가 따라가는 경로는 계단 회피가 꺼진 기본 경로다.** 안내 세션이 현재 위치 기준으로 경로를 다시 조회하면서 `accessible` 파라미터를 빠뜨린다. 화면에 보이는 브리핑과 귀로 듣는 안내가 서로 다른 경로가 되고, 계단 회피를 켠 사용자는 자기가 피하려던 계단으로 안내받는다. **어느 쪽도 오류를 내지 않아 실패가 조용하다.**

### 1.1 실재 확인 (2026-08-08 코드 대조)

| 지점 | 상태 |
|---|---|
| `src/hooks/useRouteGuide.ts:571` | `/api/route/walk?origin=…&dest=…&includeGeometry=1` — `accessible` 없음 |
| `ios/Gildongmu/Directions/BeaconModel.swift:341` | `routeService.walk(originLat:originLng:destLat:destLng:includeGeometry:)` — `accessible:` 없음 |
| `ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift:64` | `accessible: Bool = false` 기본값이 있어 **컴파일 오류 없이 통과** |
| `ios/Gildongmu/Directions/DirectionsTabView.swift:351` | 브리핑 조회는 `accessible: stepFreeEnabled`를 정상 전달 — 같은 화면 안에서 두 조회의 계약이 갈려 있다 |

서버는 무죄다. `/api/route/walk`는 `accessible` 미지정 시 정직한 기본 경로를 반환한다. 결함은 **클라이언트가 사용자 선택을 조회에 싣지 않는 것**이다.

### 1.2 백로그가 몰랐던 함정 — 상태 전달만으로 끝나지 않는다

`accessible=true`를 그냥 실으면 **더 나쁜 결함이 생긴다.**

서버는 계단 회피가 미적용될 때 안전 문장을 `steps[0]`에 **기하 없는 유사 스텝**으로 끼워 넣는다(`src/lib/walk-route.ts:71-81`의 `withStepFree`). 그런데 경로 빌더는 기하 없는 스텝을 만나면 **경로 전체를 거부**한다.

- 웹 `src/lib/route-geometry.ts:62` — `if (!pc || pc.length === 0 || !pc.every(finite)) return null;`
- Kit `RouteGeometry.swift:73-75` — 동일 판정

결과: **무계단 경로가 없을 때 상세(경로 추종) 안내가 통째로 간략 모드로 조용히 강등된다.** 계단 회피를 켠 사용자가 정확히 그것이 필요한 상황에서 안내 품질을 잃는다. 폴백 자체가 정상 경로(`fallbackToBrief`)라 로그도 오류도 남지 않는다.

이 조합(`accessible=true` ∧ `includeGeometry=1`)은 **지금까지 한 번도 실행된 적이 없다** — 안내가 `accessible`을 보낸 적이 없기 때문이다. 두 옵트인은 라우트 스키마에서 서로 독립이라 요청 자체는 400이 아니다.

### 1.3 iOS는 `stepFree` 필드를 아예 모른다

Kit `WalkRouteBriefing`(`Models/RouteModels.swift:248`)에 `stepFree` 필드가 없다. iOS가 계단 회피 상태를 아는 유일한 채널이 삽입된 산문 스텝이다. 위 §1.2의 유사 스텝을 빼면 iOS는 상태를 **알 방법이 사라진다** — 필드 디코딩 추가가 선택이 아니라 전제다.

### 1.4 D1 두 건 (같은 파일이라 편승)

- **D1-a (무테스트)**: `getWalkRoute`의 마지막 `fetchPrimaryOrFallback`(`walk-route.ts:141`)이 throw하면 502로 전파되는데 테스트가 없다. 재호출의 *null* 케이스만 `walk-route.test.ts:210`에 있다.
- **D1-b (문구 부정확)**: `no_stepfree_route` 문장이 **두 분기에 공용**인데 한쪽에서 거짓이다.
  - `walk-route.ts:135` — ACCESSIBLE 응답에 계단 문구가 남아 fail-closed 강등: **반환하는 것은 ACCESSIBLE 경로**
  - `walk-route.ts:145-147` — 무계단 경로 부재로 기본 모드 재호출: 반환하는 것은 **일반 경로**

  문장은 둘 다 "계단 없는 경로를 찾지 못해 **일반 경로를 안내합니다**"라고 말한다. 앞 분기에서 거짓이다.

## 2. 설계

### 2.1 서버 — 기하 응답에는 유사 스텝을 넣지 않는다

`WalkRouteBriefing`에 `stepFreeNotice?: string`을 신설한다. **열화 상태(`no_stepfree_route`·`unavailable`)면 `includeGeometry` 여부와 무관하게 항상 채운다.** 유사 스텝 삽입은 `includeGeometry`가 **아닐 때만** 한다.

```
includeGeometry 미지정  →  steps[0] 유사 스텝 삽입 + stepFree + stepFreeNotice   (기존 동작 + 새 필드)
includeGeometry=1       →  유사 스텝 없음        + stepFree + stepFreeNotice
```

**근거 셋.**

1. `includeGeometry=1`은 정의상 **구조화 소비자 옵트인**이다. 기하를 달라고 한 응답에 기하 없는 스텝을 섞는 것은 서버가 자기 옵트인 계약을 어기는 것이다.
2. 지식이 서버 한 곳에 남는다. 클라이언트가 떼는 방식은 "안내 문장은 인덱스 0에 있다"는 계약을 웹·iOS 두 곳에 복제한다 — 이 저장소가 반복해 겪은 미러 드리프트의 정확한 형태다.
3. 문장이 한 벌로 유지된다. `STEP_FREE_NOTICE` 상수를 클라이언트에 복제하지 않는다(도보는 V1 ko 전용이라 i18n 키가 없다).

**기존 소비자는 byte-호환이다.** `includeGeometry` 미지정 경로의 `steps`는 그대로이고, 추가되는 것은 선택 필드 하나뿐이다. 브리핑 UI·채팅·CLI는 변경 없다.

**필드를 무조건 채우는 이유**: 조건을 하나만 두면(스텝 삽입) 계약이 단순해진다. "필드는 항상, 스텝은 산문 소비자에게만".

### 2.2 클라이언트 — 계단 회피를 세션 봉인 구성에 넣는다

**값의 수명**: `kind`와 같은 봉인 축이다. 세션 시작 시 캡처하고 그 세션의 모든 경로 조회(시작·이탈 재조회)가 같은 값을 쓴다. 세션 도중 브리핑 토글을 바꿔도 진행 중인 안내는 시작 시점 계약을 유지한다 — 걷는 중에 안내 경로의 성격이 조용히 바뀌는 것이 더 나쁘다.

**웹**: `DirectionsView`(토글 소유) → `DistanceBeacon accessible` prop → `useRouteGuide(dest, kind, accessible)`. 훅 안에서 `kindFixed`와 같은 방식(`useState` 초기값 고정)으로 봉인한다.

**iOS**: `DirectionsTabView`(토글 소유) → `BeaconModel.toggle(dest:label:kind:accessible:)` → 모델 필드 → `fetchDetailData`가 `routeService.walk(… accessible:)`에 전달.

**호출부 전수**(§2.5의 "기본값 금지"에 따라 전부 명시 전달):

| 플랫폼 | 호출부 | 값 |
|---|---|---|
| 웹 | `DirectionsView.tsx:739` 간략 폴백(walk) | `stepFreeEnabled` |
| 웹 | `DirectionsView.tsx:772` 도보 안내 시작 | `stepFreeEnabled` |
| 웹 | `DirectionsView.tsx:781` 자동차 | `false` |
| 웹 | `PlaceDetail.tsx:208`(walk) | `false` — 토글 없음 |
| 웹 | `TransitGuidePanel.tsx:365`(walk 인계) | `false` — 토글 없음 |
| iOS | `DirectionsTabView.swift` `beacon.toggle` 5곳 | walk 2곳은 `stepFreeEnabled`, 나머지 `false` |

⚠ 간략 폴백 비콘도 도보 값을 싣는다. 그 세션도 시작 시 상세 경로 조회를 시도하므로(폴백 판정은 브리핑 조회 결과이지 안내 조회 결과가 아니다) 계약이 갈리면 안 된다.

### 2.3 통지 — 시작 시 1회 (위원장 판정 2026-08-08)

상세 경로 조회가 **성공**하고 응답에 `stepFreeNotice`가 있으면, 세션 시작 발화에 이어 **1회 polite 통지**한다. 정상 적용(`applied`)이면 침묵한다.

- 웹: `liveText`에 실어 단일 polite live region으로.
- iOS: 원자 시작 발화 경로에 흡수(별도 채널 신설 금지).
- **상세 조회 실패로 간략 폴백된 경우엔 통지하지 않는다.** 경로 자체가 없으니 계단 회피 개념이 성립하지 않는다(3-state: "계단 있음"이 아니라 "경로 판정 없음").

**이것은 브리핑에서 들은 문장의 반복이 아니다.** 안내 세션은 브리핑과 **다른 출발지**(첫 수용 fix)로 경로를 다시 뽑으므로 계단 회피 판정이 달라질 수 있다. 브리핑이 `applied`였는데 안내가 `no_stepfree_route`인 경우가 정확히 이 통지가 필요한 상황이다.

**반대 방향(브리핑 열화 → 안내 적용)은 침묵한다.** 사용자가 실제보다 나쁘게 예상하는 안전한 방향의 오차이고, 정상 상태를 매번 확인 발화하면 그 자체가 노이즈다(접근성 헌장 §2 과잉 통지 금지).

### 2.4 Kit — 필드 디코딩 추가

`WalkRouteBriefing`에 `stepFree: StepFreeStatus?`와 `stepFreeNotice: String?`을 더한다. `StepFreeStatus`는 Kit에 없으므로 웹 `src/lib/types.ts:380`의 열거형을 미러하는 `String` raw enum으로 신설한다(`applied`·`no_stepfree_route`·`unavailable`).

⚠ **디코딩은 옵셔널이어야 한다.** 웹 배포가 앱보다 먼저 나가는 것이 정상 순서지만, 필수 디코딩으로 만들면 구버전 서버 응답에서 도보 브리핑이 통째로 오류가 된다(대중교통 `routeKey`가 만든 배포 순서 제약을 반복하지 않는다).

### 2.5 재발 방지 — 기본값 있는 안전 인자를 없앤다

**A4가 생긴 기제가 곧 수정 방법을 정한다.** `RouteService.walk`의 `accessible: Bool = false` 기본값이, 호출부가 안전 관련 값을 조용히 생략해도 컴파일을 통과시켰다. 같은 모양으로 고치면(기본값 있는 인자를 하나 더 추가) 정확히 같은 기제로 재발한다.

- **iOS**: `RouteService.walk`의 `accessible` **기본값 제거**(실호출부 2곳: `DirectionsTabView.swift:351` 브리핑, `BeaconModel.swift:341` 안내). `BeaconModel.toggle`의 `accessible`도 required로 두고 호출부 5곳이 각자 의도를 명시한다(car·transit은 `false` — 그 수단에 계단 회피 개념이 없다는 사실이 코드에 드러난다).
- **웹**: 도보 조회 URL 조립을 `walkRouteUrl({origin, dest, accessible, includeGeometry})` 공용 빌더로 모은다. 인자는 전부 named·required. 현재는 `DirectionsView.tsx:133`이 `&accessible=true`를 손으로 붙이고 훅은 URL을 따로 조립해, 같은 계약이 두 곳에 흩어져 있다. `DistanceBeacon`의 `accessible` prop과 `useRouteGuide`의 세 번째 인자도 **선택이 아니라 필수**로 둔다 — 계단 회피 개념이 없는 수단(car·transit 인계)에서 `false`를 적는 것은 잉여가 아니라 그 사실의 선언이다.

### 2.6 D1-b — 문장을 두 분기 모두 참인 것으로 교체

열거형 `StepFreeStatus`는 공개 계약(CLI·채팅·향후 iOS 소비)이므로 **유지**한다. 상태를 넷으로 늘리지 않고 문장만 고친다 — 문장의 역할은 "어느 경로를 골랐는지 설명하는 것"이 아니라 "계단이 있을 수 있음을 경고하는 것"이다.

```
before: 계단 없는 경로를 찾지 못해 일반 경로를 안내합니다. 계단이 포함될 수 있습니다.
after:  계단 없는 경로를 확정하지 못했습니다. 안내 경로에 계단이 포함될 수 있습니다.
```

`unavailable` 문장("계단 회피 경로를 조회하지 못했습니다. 일반 경로를 안내하며 계단이 포함될 수 있습니다.")은 그 분기가 실제로 일반 경로를 반환하므로 **참이다 — 건드리지 않는다.**

⚠ 이 문장은 꼬리 문장 규칙([[sr-announcement-tails-live-in-server-strings]])의 **유지 대상**이다. 뒷문장이 "계단이 포함될 수 있다"는 **새 정보**(조건·한계)를 주지, 자명한 재시도 권유가 아니다.

### 2.7 D1-a — throw 경로 테스트

무계단 경로 부재 → 기본 모드 재호출이 throw하는 경로(`walk-route.ts:141`)가 502로 전파되는지 단언한다. null 케이스와 짝을 이룬다.

## 3. 응답 계약 (변경 후)

```ts
interface WalkRouteBriefing {
  distanceMeters: number;
  durationSeconds: number;
  steps: WalkRouteStep[];
  stepFree?: StepFreeStatus;        // 기존 (accessible 요청 시에만 존재)
  stepFreeNotice?: string;          // 신설: stepFree가 applied가 아닐 때만 존재
}
```

**불변식 셋** (테스트로 못 박는다):

1. `includeGeometry=1` 응답의 모든 스텝은 `pathCoords`를 갖는다(기하 없는 스텝 0개).
2. `stepFree !== "applied"` ⟺ `stepFreeNotice`가 존재한다. `stepFree`가 없으면 `stepFreeNotice`도 없다.
3. `includeGeometry` 미지정 + `accessible=true` + 열화 응답의 `steps[0].description === stepFreeNotice`(산문 소비자와 구조화 소비자가 같은 문장을 받는다).

## 4. 테스트 계획

### 4.1 서버 (`src/lib/__tests__/walk-route.test.ts`)

- `includeGeometry=1` + 열화: `steps[0]`이 유사 스텝이 **아니고** 모든 스텝이 기하를 갖는다
- `includeGeometry` 미지정 + 열화: 종전대로 유사 스텝이 앞에 붙고 `steps[0].description === stepFreeNotice`
- `applied`: `stepFreeNotice` 부재
- D1-b: `hasStairs` 분기 문장이 "일반 경로를 안내합니다"를 포함하지 **않는다**
- D1-a: 마지막 기본 모드 재호출 throw → 전파

### 4.2 경로 빌더 회귀 (`route-geometry` · Kit)

- 기하 없는 스텝이 섞이면 `null`을 반환한다는 기존 계약은 **유지**(이번 변경이 그 판정을 무르게 하지 않는다). 그 계약이 살아 있음을 단언하는 테스트를 이 스위트에 남긴다 — 서버가 실수로 유사 스텝을 다시 넣으면 상세 안내가 죽는다는 사실이 그 자리에 기록되어야 한다.

### 4.3 클라이언트 배선

- 웹 `walkRouteUrl` 단위 테스트: `accessible` true/false, `includeGeometry` on/off 4조합의 정확한 쿼리 문자열
- 웹 훅 계약(신규 `src/hooks/__tests__/useRouteGuide.stepfree.test.tsx` — 기존 레인 `useRouteGuide.car.test.tsx`·`useRouteGuide.tone.test.tsx`와 동형): 세션 시작 시 `accessible=true`가 요청에 실린다 / 이탈 재조회도 같은 값 / `stepFreeNotice`가 오면 시작 통지에 1회 포함되고 두 번 반복되지 않는다 / `applied`면 통지 없음 / 상세 실패 폴백이면 통지 없음. ⚠ 이 레인은 fake timer를 쓰므로 `waitFor` 금지·`toFake`에 `performance` 포함([[jsdom-sync-focus-assertion-flake]] 및 톤 스위트 선례)
- iOS는 앱 타깃에 테스트 레인이 없다. `RouteService.walk`·`toggle`의 기본값 제거가 **컴파일러 강제**로 대신하고, Kit `WalkRouteBriefing` 디코딩(선택 필드 부재·존재 두 모양)은 Kit 스위트가 덮는다.

### 4.4 변이 주입 후보 (하한 — 설계는 리뷰 계층에 넘긴다)

[[mutation-proves-test-detection-power]] 2026-08-08 갱신: 구현자가 고른 변이는 구현자의 계약 이해를 넘지 못한다. 아래는 **하한**이고, 리뷰어에게 독립 변이를 요구한다.

| # | 변이 | 잡아야 할 축 |
|---|---|---|
| M1 | 안내 조회에서 `accessible`을 다시 뺀다 | A4 본체 |
| M2 | `includeGeometry`일 때도 유사 스텝을 넣는다 | §1.2 함정(상세 조용한 강등) |
| M3 | `stepFreeNotice`를 `applied`에도 채운다 | 정상 상태 침묵 계약 |
| M4 | 통지를 매 fix 반복한다 | 1회 계약 |
| M5 | 이탈 재조회에서 `accessible`을 떨어뜨린다 | 세션 봉인 |
| M6 | D1-b 문장을 원복 | 문구 정확성 |

⚠ **M2는 fixture 선택에 걸린다.** 열화 상태 fixture로만 돌리면 잡히지만, `applied` fixture에서는 유사 스텝 자체가 없어 변이가 항등이 된다. 열화 + `includeGeometry=1` 조합이 반드시 있어야 한다.

## 5. 실호출 게이트 (머지 조건)

fixture green은 실계약 검증이 아니다. **계단이 실재하는 좌표쌍**으로 다음을 확인한다.

1. `accessible=true&includeGeometry=1` 응답에 기하 없는 스텝이 0개
2. 같은 좌표쌍에서 `accessible` 없이 조회한 경로와 **실제로 다른 경로**가 나온다(파라미터가 upstream에 도달했다는 증거 — 응답 통과만으로는 부족하다)
3. 무계단 경로가 없는 좌표쌍에서 `stepFree === "no_stepfree_route"` + `stepFreeNotice` 존재 + 기하 온전
4. `includeGeometry` 미지정 응답이 종전과 byte-동일(`steps[0]` 유사 스텝 포함)

⚠ 3번 좌표쌍은 조사가 필요하다. 실측으로 찾지 못하면 그 사실을 기록하고 fixture로 대신한다(없는 것을 있다고 적지 않는다).

## 6. 범위 밖

- **라우트 `error` 문자열의 꼬리 문장 11건(9개 라우트)**: `[[sr-announcement-tails-live-in-server-strings]]`가 지목한 잔여분이 아직 살아 있다(`/api/route/walk` 자신도 2건). 확인된 규칙 위반이고 클라이언트가 `body.error`를 그대로 낭독하지만 A4와 무관하므로 **같은 마일스톤 안 별도 커밋**으로 처리한다. 백로그에도 등재한다(마일스톤 줄에만 남은 관찰이 백로그에 도착하지 못하는 것이 이 저장소의 알려진 실패 모드 ④다).
- **브리핑과 안내의 경로가 다를 수 있다는 사실 자체**: 출발지가 다르므로 정상이고 결함이 아니다. 안내 경로는 "지금 있는 자리에서의" 경로다.
- **세션 도중 토글 변경**: 진행 중 세션은 시작 시점 계약을 유지한다(§2.2). 토글을 비활성화하지도, 세션을 중지시키지도 않는다.
- **`no_stepfree_route`를 두 상태로 쪼개기**: 공개 계약을 늘리는 대신 문장을 참으로 만드는 쪽을 골랐다(§2.6).

## 7. 미해결

없음. 실호출 게이트 3번의 좌표쌍 확보만 구현 중 조사 대상이고, 실패해도 진행을 막지 않는다(fixture 대체 + 기록).
