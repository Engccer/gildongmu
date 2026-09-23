# 측위 실패 시 옛 위치를 밝힌다 (stale-origin) — 설계

- 날짜: 2026-09-23 · 세션 `stale-origin`(백로그 4차 소화 웨이브 2) · 기준 `0308a91b`
- 출처: BACKLOG E43 "3자 동조" 줄, 계획 `docs/superpowers/plans/2026-09-23-backlog-sweep-4-parallel-plan.md` §1 stale-origin 판정
- **위원장 판정(2026-09-23, 재판정 금지)**: 재측위가 실패하고 직전 좌표가 있으면 옛 주소를 계속 쓰되 **옛 위치임과 시각을 밝힌다**. 길찾기는 그 위치로 계속할 수 있다. 웹·iOS·안드로이드 동조.
- 설계 리뷰 게이트: **적용**(새 상태 계약 — 세 플랫폼 위치 스토어의 3-state와 길찾기 출발지 폴백. 판별 기준 ①·④).

## 1. 현상과 원인 (전수 결과)

| 플랫폼 | 표시줄 | 길찾기 "현재 위치" 칸 | 길찾기 조회 |
|---|---|---|---|
| 웹 | 실패 시 스토어가 `denied`로 좌표를 버려 "위치를 확인할 수 없습니다"(정직하지만 판정과 다름) | `currentAddress` 상태가 남아 **"현재 위치(옛 주소 부근)"** | 실패 → `geoError` |
| iOS | `lastCoordinate != nil`이면 `lastFixFailed`를 보지 않고 **"현재 위치(옛 주소 부근)"**. `CurrentAddressStore`는 표시용 좌표 실패 시 옛 주소를 유지 | `addressState`가 옛 주소를 유지 → **"현재 위치(옛 주소 부근)"** | 실패 → `geoError` |
| 안드로이드 | iOS와 같은 순서(`hasCoordinate`가 먼저) → **"현재 위치(옛 주소 부근)"** | 진입 시 주소 좌표를 `coordinateForRanking`(실패 시 저장 좌표 폴백, TTL 300초)으로 얻어 옛 좌표 주소를 "현재 위치"로 | 실패 → `GeoError` |

공통 원인: "이번 측위가 실패했다"는 사실과 "직전 좌표가 있다"는 사실을 **한 상태로 묶지 않았다**. 좌표 유무만 보는 층은 옛 좌표를 현재로 말하고, 실패만 보는 층은 좌표를 버린다.

## 2. 상태 계약 (새 불변식)

GPS 갈래(수동 위치·장소 앵커가 아닐 때)의 위치 주장은 **셋 중 하나**다. 뭉개지 않는다.

| 상태 | 정의 | 표시 | 길찾기 조회 |
|---|---|---|---|
| 신선(fresh) | 가장 최근 측위 시도가 성공했거나, 캐시가 재사용 정책(웹 나이 상한·iOS/안드로이드 TTL+정확도)을 통과 | 지금 문구 그대로 | 그 좌표 |
| **옛 위치(stale)** | **보관 좌표를 마지막으로 쓴 뒤 측위 시도가 "취득 실패"(시간 초과·fix 0·기기 위치 서비스 꺼짐)로 끝났고**, 좌표의 측정 시각을 안다 | "마지막으로 확인한 위치, 〈주소〉, 〈N분 전〉" | **그 좌표로 진행** + 완료 통지 뒷문장 |
| 없음(none) | 좌표가 한 번도 없거나, 권한 거부·대략적 위치, 또는 옛 좌표의 측정 시각을 모름 | 지금 문구 그대로(권한 안내·"위치를 확인할 수 없습니다") | 지금처럼 오류 |

**판정 단위**: 실패 표식 하나(`failedSinceLastStore`)를 취득 실패에서 세우고, **보관 좌표를 쓰는 자리 하나에서 내린다**(iOS `didUpdateLocations`의 `stored = fix`, 안드로이드 `stored` 세터). 단발·스트림·타임아웃 최선값 어느 경로든 좌표가 들어오면 옛 위치가 풀린다. 웹은 성공이 스토어 상태를 `ready`로 통째로 바꾸므로 구조가 같은 뜻이다(실패 = `denied`+`last`, 성공 = `ready`).
- 기각한 대안: "실패 시각 > 좌표 측정 시각" 비교. 측정 시각은 수신보다 최대 10초(`acceptAge`) 앞서므로, 2초 표시용 측위가 실패한 직후 다른 화면의 8초 측위가 성공해도 그 fix의 측정 시각이 실패보다 이르면 옛 위치가 남는다(설계 리뷰 H1).
- iOS 추적 중(도보 안내 스트림) 재사용 거부로 던지는 실패도 세운다 — 스트림이 저장 상한을 계속 넘어 좌표가 동결된 구간을 "현재 위치"로 말하지 않게. 다음 storable 스트림 fix가 곧바로 푼다(리뷰 L5).

**권한 거부·대략적 위치는 옛 위치로 답하지 않는다.** 권한 거부는 사용자가 위치를 쓰지 말라고 한 상태이고(그 뒤 옛 좌표를 쓰면 거부를 무시하는 것), 대략적 위치는 사용자가 설정을 고쳐야 하는 상태라 지금의 권한 안내가 행동을 바꾸는 정보다. 기존 표시줄의 "권한 → 확정 실패 → 좌표" 순서를 그대로 둔다.

**조용한 측위(`silent`)의 실패는 실패 시각을 남기지 않는다.** 화면이 요청하지 않은 측위(웹·안드로이드 수동 위치 판정)이고 그 동안 표시는 수동 위치가 차지한다. 기존 의미(표시 상태를 흔들지 않는다)를 넓히지 않는다. iOS는 판정 측위가 `silent` 갈래가 없어 실패를 기록한다 — 수동 위치가 켜진 동안은 표시되지 않고, 해제 뒤 보이는 "옛 위치"는 사실(마지막 시도가 실패했다)이라 정합을 위해 iOS 판정 경로를 바꾸지 않는다.

**측정 시각을 모르면 옛 위치가 아니다(없음).** 시각을 밝히는 것이 판정의 내용이라 모르는 시각을 지금으로 도장 찍지 않는다. iOS·안드로이드 `StoredFix`는 측정 시각을 늘 들고 있고, 웹 `fixSeconds`도 늘 수치를 준다 — 웹의 유한 검사는 같은 계약의 방어다.

**옛 좌표의 나이 상한은 두지 않는다.** 경과가 문장(표시줄·출발지 칸·완료 통지)에 들어가므로 "4시간 전에 확인한 위치로 찾았습니다"를 듣고 사용자가 판단한다. 판정("길찾기는 그 위치로 계속할 수 있다")에 상한이 없고, 상한을 두면 그 밖에서 다시 "없음"이 되어 3-state에 네 번째 경계가 생긴다(리뷰 M2).

**기기 위치 서비스 꺼짐은 플랫폼마다 다르게 보고된다**: iOS는 전역 위치 서비스 꺼짐을 `CLAuthorizationStatus.denied`로 보고하고(Apple 문서), 브라우저도 권한 거부(`code 1`)로 보고하는 구현이 있어 둘은 "없음"(권한 안내)이다. 안드로이드만 `isLocationEnabled()`로 가려 "옛 위치"다. 불가피한 차이이며 실기기 대본에서 결함으로 읽지 않는다. 비행기 모드는 위치 서비스를 끄지 않으므로 세 플랫폼 모두 "옛 위치"다(설계 리뷰 L3·구현 리뷰 L-5).

## 3. 시간 표현 (공유 순수 함수)

`staleFixAge(ageSeconds)` → `justNow`(<60초) · `minutes(n)`(1~59) · `hours(n)`(60분 이상, 내림). 음수(시계 역행)는 0으로 접어 `justNow`, 비유한 값은 `nil`(= 없음 상태).

- 정본 Kit `StaleOrigin.swift` ↔ 웹 `src/lib/stale-origin.ts` ↔ `:kit` `StaleOrigin.kt`. 공유 fixture `src/lib/__tests__/fixtures/stale-fix-age-cases.json`(경계 59·60·3599·3600초, 음수, 소수).
- 표시는 **렌더 시점의 지금**으로 계산하고, 옛 위치 상태가 보이는 동안 1분 이내 주기로 다시 그린다(웹 30초 타이머 훅·iOS `TimelineView(.everyMinute)`·Compose 틱). 열어 둔 화면이 "5분 전"에 멈춰 거짓이 되지 않게. 텍스트 재계산은 통지를 만들지 않는다(live region·announcement 아님).
- 문구는 ICU plural(`manualLocation.staleAgeMinutes`·`staleAgeHours`, 수량 인자 정수). 문장 틀은 `manualLocation.gpsStale`(주소·시간)·`gpsStaleNoAddress`(시간만). 길찾기 칸과 표시줄이 **같은 키**를 쓴다(판정선이 갈리면 화면으로 확인 불가 — 수동 위치 라벨 선례). 통지 뒷문장 `directions.staleOriginNotice`(시간 인자).

## 4. 플랫폼별 설계

### 4.1 웹

- **스토어**(`geolocation.ts`): `denied` 상태에 선택 필드 `last?: Coord`(판정 `staleFixOf`는 순수 모듈 `stale-origin.ts` — 여러 테스트가 `@/lib/geolocation`을 통째로 목킹한다). 조용하지 않은 실패에서 사유가 `denied`(권한)가 아니면 직전 좌표를 싣는다 — 직전 상태가 `ready`면 그 좌표, 직전이 `denied`+`last`면 그대로 이어받는다(연속 실패가 옛 좌표를 잃지 않게). 권한 거부면 싣지 않는다. 기존 소비자(`status === "ready"`만 보는 "내 주변" 등)는 **무변경** — 가산 필드라 실패 의미가 그대로다.
- `staleFixOf(state): Coord | null` — `denied` ∧ `reason !== "denied"` ∧ `last` ∧ `last.at` 유한. 판정은 이 함수 하나만 지난다.
- **표시줄**(`LocationBar`): 수동 → 수동 라벨, 그 외 `staleFixOf(geo)`가 있으면 옛 위치 문장 + 그 좌표의 주소(`useCurrentAddress(stale)`), 아니면 지금 그대로.
- **길찾기**(`DirectionsView`): 칸의 위치 주장은 공유 위치 스토어에서 **파생**한다(`useGeolocation` + `staleFixOf`, 주소는 표시줄과 같은 좌표 키 캐시 `useCurrentAddress` — 비-ko는 영문·로마자 1순위). 칸이 상태를 따로 들면 다른 화면의 전이를 못 따라가고 늦은 역지오코딩이 신선/옛 판정을 뒤집는다(구현 리뷰 M-1·M-2). `currentLabel`은 수동 > 옛 위치 > 주소 > 기본.
  - 조회(`runQuery`): `awaitEffectiveLocation`이 null이고 수동 위치가 없으며 `staleFixOf(snapshot)`이 있으면 그 좌표로 진행, `originSource = "stale"`(출발지가 현재 위치일 때), 주소 재동기화, 완료 통지에 뒷문장. 성공하면 `staleOriginAt = null`.
  - "현재 위치 사용" 재선택(`selectCurrentFrom`): 실패 시 옛 좌표가 있으면 옛 위치 표기로 전환하고, 옛 좌표도 없으면(권한 거부 등) 주소를 비운다(지금은 조용히 직전 라벨 유지 — 그 라벨이 옛 주소를 "현재 위치"로 말한다). 세 플랫폼 같다.
  - 진입 시 주소 병기 effect: 스냅샷이 옛 위치면 그 좌표 주소 + 옛 위치 표기.
  - 안내 시작 고지(`announceGuideStart`): `originSource`가 `manual`이거나 `stale`이면 기존 "현재 위치에서 안내를 시작합니다". 새 문장 없음.
  - WebMCP 도구 대기자(`settleAfterCommit`)의 `geoError`는 **옛 위치로 진행하면 나오지 않는다**(조회가 성립). 도구 출력의 `resolved.from/to`는 현재 위치 끝점이면 **출력 시점의 파생 라벨**(`currentLabel`)이다 — 조회를 시작한 렌더의 클로저 값에는 옛 위치 판정·주소가 아직 없다(리뷰 H4). 출력 allowlist는 그대로다.
  - 수동 위치 해제("현재 위치로 되돌리기"): 판정 측위는 `silent`라 실패해도 옛 좌표가 `ready`로 남으므로, 해제 순간 캐시가 나이 상한(180초)을 넘었으면 다시 잰다(`ready`일 때만 — 권한 팝업 없음). 안드로이드는 해제 시 `ensureLoaded`가 이미 같은 일을 한다(리뷰 M1).

### 4.2 iOS

- **`LocationService`**: `private(set) var failedSinceLastStore` — `currentCoordinate`가 **취득 실패**(`unavailable`, 추적 중 재사용 거부 포함)로 끝날 때 세우고 `stored = fix`에서 내린다(권한 거부·정밀도 꺼짐은 세우지 않는다). `var staleFix`(좌표+측정 시각): 표식 ∧ 권한 허용 ∧ 정밀 위치 ∧ `stored`.
- **표시줄**(`LocationBarView.state`): 권한·정밀도 분기 뒤, 좌표 분기 **앞**에 옛 위치 분기. 주소는 `CurrentAddressStore`가 옛 좌표로 조회한 것만.
- **`CurrentAddressStore.ensureLoaded`**: `coordinateForDisplay()`가 nil이면 `staleFix`의 좌표로 조회를 이어 간다. 표시줄은 스토어가 든 주소가 **옛 좌표의 주소일 때만**(`isAddress(forLat:lng:)`) 옛 위치 문장에 싣고, 옛 위치가 서거나 바뀌면(`.task(id:)`) 다시 잰다. `coordinateForDisplay`의 "낡은 좌표 금지" 계약은 그대로다 — 옛 좌표는 옛 위치 문장으로만 표시된다.
- **길찾기**(`DirectionsModel`): `private(set) var currentStaleAt: Date?`. 조회 catch의 `unavailable` 갈래에서 수동 위치 없음 ∧ `staleFix` → 그 좌표로 진행(커버리지 판정·주소 동기화는 성공 경로와 같은 자리). `loadCurrentAddressIfAuthorized`·`refreshCurrentLocation`도 실패 시 같은 폴백. 성공하면 nil. `resultsUsedManualOrigin`은 의미를 넓혀 `resultsOriginNeedsStartNotice`(수동 ∨ 옛 위치)로 개명한다 — 안내 시작 고지 판정 하나.
- 필드 라벨(`currentLocationText`): 수동 > 재측위 중 > 옛 위치 > 주소 > 기본. `TimelineView(.everyMinute)`로 감싼다. 옛 위치는 모델 표식 ∧ 스토어의 살아 있는 `staleFix`(권한을 거두면 칸도 옛 위치를 말하지 않는다, 구현 리뷰 L-4).
- 전이 추종: 표시줄은 `.task(id:)` 키에 옛 위치를 넣지 않고 `.onChange(of: staleFix?.fixedAt)` → `CurrentAddressStore.syncFromStore()`(측위 없음, 스토어 소유 태스크)로 따른다 — 키로 두면 태스크 안의 측위 실패가 자기를 취소한다(구현 리뷰 H-1). 길찾기 칸도 같은 관찰 → `DirectionsModel.syncCurrentFromStore()`. 표식이 바뀌면 주소를 먼저 비운다(L-3).

### 4.3 안드로이드

- **`LocationStore`**: `failedSinceLastStore` — 조용하지 않은 `Unavailable` 실패에서 세우고 `stored` 세터에서 내린다. `staleFix(): StaleFix?`(최상위 타입 — `location` 밖의 `LocationStore` 참조를 소스 가드가 막는다. 측정 시각 = `epochNow − 나이`): 표식 ∧ 권한 `Fine` ∧ `stored`. 관찰 채널 `staleChanges: StateFlow`(옛 위치가 서거나 풀릴 때 — 같은 좌표면 다시 내보내지 않는다).
- **표시줄**: `LocationBarInput`에 `staleFixAtEpoch: Double?`. `gpsLabel` 순서 = 권한 → **옛 위치** → 확정 실패 → 좌표 → 주소. 나이는 렌더 시점 틱으로 계산(`LocationBarRow`). 입력은 `ensureLoaded` 스냅샷이라 다른 화면의 성공·실패를 못 따라가므로, 표시줄이 `staleChanges`를 구독해 **측위 없이** 스냅샷·주소를 다시 맞춘다(`syncFromStore` — 여기서 다시 재면 실패와 성공이 번갈아 서로를 부르는 측위 반복이 된다, 리뷰 H3).
- **`CurrentAddressStore.ensureLoaded`**: iOS와 같이 옛 좌표로 이어 조회.
- **`EffectiveLocation`**: `staleFix()` — 수동 위치가 있으면 null(수동이 이긴다). 길찾기 `EndpointLocator`에 `staleFix()`·`coordinateForDisplay()` 추가.
- **길찾기**(`DirectionsViewModel`): `currentStaleAt: Double?`(UI 상태). 팩토리가 `staleChanges`를 주입하고 뷰모델이 전이를 측위 없이 따라간다(`syncCurrentFromStore`, 구현 리뷰 M-2), 표식이 바뀌면 주소를 먼저 비우고(L-3), 라벨은 살아 있는 `staleFix()`도 본다(L-4). 표시줄 `syncFromStore`는 진행 중에 온 전이를 버리지 않고 끝난 뒤 한 번 더 맞춘다(M-4). 조회의 `Unavailable` 갈래 폴백, `refreshCurrentLocation` 폴백. `loadCurrentAddressIfAuthorized`는 `coordinateForRanking`(저장 좌표 폴백 = 이번 결함의 한 경로) 대신 표시용 좌표 + 옛 위치 폴백으로 바꾼다(iOS 등가). 안드로이드에는 안내 시작 고지("현재 위치에서 안내를 시작합니다")가 아직 없다 — 이번 범위 밖, 등가성 후보로 BACKLOG에 남긴다.

## 5. 범위 밖

- **웹·안드로이드 안내 스트림 fix는 공유 스토어로 오지 않는다**(웹 `useRouteGuide`의 `watchPosition`, 안드로이드 `GuideLocationStream`은 별개 리스너. iOS만 스트림이 `stored`를 갱신한다). 그래서 "실내 출발 → 안내 시작 측위 실패 → 스트림 회복 → 도착 → 복귀"에서 표시줄은 출발 전 좌표를 옛 위치로 말한다. 이것은 옛 위치 판정이 만든 결함이 아니라 스토어 연결의 기존 한계다(신선 상태에서도 웹은 안내 뒤 출발 전 좌표를 "현재 위치"로 말한다) — 옛 위치 문장은 적어도 현재라고 주장하지 않는다. BACKLOG 후속 후보(리뷰 H2).

- "내 주변" 목록·채팅 앵커·검색 거리 가중: 각자 실패 계약(직전 데이터 복원·좌표 없이 진행)이 있다. 판정은 표시줄과 길찾기 출발지.
- 실패 없이 캐시가 오래된 경우(웹 스토어는 TTL이 없어 재측위 요청이 없으면 옛 좌표가 `ready`로 남는다): 판정 단위가 "이번 측위가 실패했다"라 대상이 아니다. 길찾기 조회는 이미 나이 상한(180초)으로 재측위한다.
- 실시간 안내: 언제나 실좌표를 새로 잰다(웹 `awaitRealFix`·iOS `BeaconModel`). 옛 위치로 계산된 경로에서 시작해도 안내 출발점은 실측이다.

## 6. 검증

- 공유 fixture로 세 미러가 같은 시간 표현을 낸다(웹 vitest·Kit swift test·`:kit` gradle).
- 웹 컴포넌트: 스토어 실패 → `last` 유지·권한 거부는 미유지·조용한 실패 불변. 표시줄 옛 위치 문장, 길찾기 조회가 옛 좌표로 진행하고 통지 뒷문장, 재선택 실패 전환, 안내 시작 고지.
- 안드로이드 JVM: `gpsLabel` 순서, 길찾기 VM 폴백(가짜 `EndpointLocator`).
- iOS: Kit 테스트(판정·시간 표현) + Release·Experimental 빌드. 앱 배선은 소스 가드(`LocationBarView`에 옛 위치 분기가 좌표 분기 앞에 있는지 등)로 잠근다.
- 실기기 대본(보고서): 비행기 모드 + 기존 fix 뒤 표시줄·길찾기, 지하 진입, 표시용 측위 실패 직후 "내 주변" 성공 시 표시줄 복귀, 커서를 표시줄에 둔 채 2분 대기(1분 틱이 재낭독을 만드는지 — 리뷰 M3).

## 7. 설계 리뷰 판정 (2026-09-23, fable, `review-design-202609231552.md`)

채택: H1(저장 시 해제로 판정 단위 교체, 시각 비교·fixture 축 삭제) · H3(안드로이드 관찰 채널) · H4(도구 출력 라벨을 출력 시점 파생으로) · M1(웹 수동 해제 시 낡은 캐시 재측위) · L1·L3(문장 정정) · L5(추적 중 실패 기록). 판정으로 닫음: M2(나이 상한 없음, 위 §2). 범위 밖: H2(위 §5, BACKLOG). 실기기로 넘김: M3(§6 대본). L2(도착지 현재 위치 + 옛 위치): 완료 통지 뒷문장은 끝점 어느 쪽이든 나오고, 안내 시작 고지만 출발지일 때다(안내 출발지는 그때도 실좌표). L4(안드로이드 epoch 이중 시계): 관찰 채널은 좌표로만 변화를 가르고 나이는 표시 시점 벽시계로 구한다 — NTP 보정 수 초 오차는 분 단위 문장을 바꾸지 않아 수용.

## 8. 구현 리뷰 판정 (2026-09-23, opus, `review-impl-202609231620.md`) · 접근성 감사 (`review-a11y-202609231617.md`)

채택: H-1(iOS 표시줄 태스크 자기 취소 → 측위 없는 스토어 소유 동기화) · M-1·M-2(칸의 옛 위치 파생·전이 추종, 웹은 공유 주소 캐시로 순서 역전 소멸) · M-3(안드로이드 스토어 불변식·`syncFromStore` 테스트) · M-4(진행 중 전이 재동기화) · L-3(표식 전환 시 주소 선비움) · L-4(권한 회수 뒤 칸) · L-5(위 §2 정정) · L-7(웹 테스트를 실제 ko 카탈로그로, 진입·권한 거부·수동 해제 재측위 추가). 감사 I1(웹 비-ko 괄호 한글을 주소 바로 뒤로) 채택. 코디네이터 판정으로 넘김: 리뷰 L-2 = 감사 W1(결과 0건일 때 뒷문장 동사) · L-6 = I5(ja "たった今に"). 기록만: L-8(도착지가 현재 위치일 때 `destLabel`은 조회 시작 렌더 라벨 — 드문 조합), 감사 I3·I4(실기기 대본 D6·경계 1분 차), I2·I6(BACKLOG 후속 — I2는 웹 칸이 공유 주소 캐시로 바뀌며 함께 해소).
