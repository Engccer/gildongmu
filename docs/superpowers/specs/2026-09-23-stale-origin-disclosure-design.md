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
| **옛 위치(stale)** | **실패한 측위 시도가 보관된 좌표보다 나중**이고, 실패 사유가 "취득 실패"(시간 초과·fix 0·기기 위치 서비스 꺼짐)이며, 좌표의 측정 시각을 안다 | "마지막으로 확인한 위치, 〈주소〉, 〈N분 전〉" | **그 좌표로 진행** + 완료 통지 뒷문장 |
| 없음(none) | 좌표가 한 번도 없거나, 권한 거부·대략적 위치, 또는 옛 좌표의 측정 시각을 모름 | 지금 문구 그대로(권한 안내·"위치를 확인할 수 없습니다") | 지금처럼 오류 |

**판정 단위**: "실패가 보관 좌표보다 나중인가"(`isFixSupersededByFailure(fixedAt, failedAt)` — 실패 시각 > 좌표 측정 시각). 이렇게 정의하는 이유: 불리언 표식(`lastFixFailed`)만 보면 스트림 fix(도보 안내·대중교통 keep-alive)가 좌표를 새로 채운 뒤에도 "옛 위치"가 남는다. 시각 비교는 그 뒤 들어온 어떤 fix든 자동으로 해제한다.

**권한 거부·대략적 위치는 옛 위치로 답하지 않는다.** 권한 거부는 사용자가 위치를 쓰지 말라고 한 상태이고(그 뒤 옛 좌표를 쓰면 거부를 무시하는 것), 대략적 위치는 사용자가 설정을 고쳐야 하는 상태라 지금의 권한 안내가 행동을 바꾸는 정보다. 기존 표시줄의 "권한 → 확정 실패 → 좌표" 순서를 그대로 둔다.

**조용한 측위(`silent`)의 실패는 실패 시각을 남기지 않는다.** 화면이 요청하지 않은 측위(웹·안드로이드 수동 위치 판정)이고 그 동안 표시는 수동 위치가 차지한다. 기존 의미(표시 상태를 흔들지 않는다)를 넓히지 않는다. iOS는 판정 측위가 `silent` 갈래가 없어 실패를 기록한다 — 수동 위치가 켜진 동안은 표시되지 않고, 해제 뒤 보이는 "옛 위치"는 사실(마지막 시도가 실패했다)이라 정합을 위해 iOS 판정 경로를 바꾸지 않는다.

**측정 시각을 모르면 옛 위치가 아니다(없음).** 시각을 밝히는 것이 판정의 내용이라, 모르는 시각을 지금으로 도장 찍으면 "방금 전"이라는 거짓이 된다(웹 `coords.at` 부재 = 구버전 저장분, `isStaleCoord`의 "나이 불명 = 낡음"과 같은 방향).

## 3. 시간 표현 (공유 순수 함수)

`staleFixAge(ageSeconds)` → `justNow`(<60초) · `minutes(n)`(1~59) · `hours(n)`(60분 이상, 내림). 음수(시계 역행)는 0으로 접어 `justNow`, 비유한 값은 `nil`(= 없음 상태).

- 정본 Kit `StaleOrigin.swift` ↔ 웹 `src/lib/stale-origin.ts` ↔ `:kit` `StaleOrigin.kt`. 공유 fixture `src/lib/__tests__/fixtures/stale-fix-age-cases.json`(경계 59·60·3599·3600초, 음수, 소수).
- 같은 파일에 `isFixSupersededByFailure(fixedAt, failedAt)`(초 단위 epoch·같은 시계). iOS 앱 타깃에 테스트 번들이 없어 판정을 Kit으로 내린다(선례 `LocationFixPolicy`).
- 표시는 **렌더 시점의 지금**으로 계산하고, 옛 위치 상태가 보이는 동안 1분 이내 주기로 다시 그린다(웹 30초 타이머 훅·iOS `TimelineView(.everyMinute)`·Compose 틱). 열어 둔 화면이 "5분 전"에 멈춰 거짓이 되지 않게. 텍스트 재계산은 통지를 만들지 않는다(live region·announcement 아님).
- 문구는 ICU plural(`manualLocation.staleAgeMinutes`·`staleAgeHours`, 수량 인자 정수). 문장 틀은 `manualLocation.gpsStale`(주소·시간)·`gpsStaleNoAddress`(시간만). 길찾기 칸과 표시줄이 **같은 키**를 쓴다(판정선이 갈리면 화면으로 확인 불가 — 수동 위치 라벨 선례). 통지 뒷문장 `directions.staleOriginNotice`(시간 인자).

## 4. 플랫폼별 설계

### 4.1 웹

- **스토어**(`geolocation.ts`): `denied` 상태에 선택 필드 `last?: Coord`. 조용하지 않은 실패에서 사유가 `denied`(권한)가 아니면 직전 좌표를 싣는다 — 직전 상태가 `ready`면 그 좌표, 직전이 `denied`+`last`면 그대로 이어받는다(연속 실패가 옛 좌표를 잃지 않게). 권한 거부면 싣지 않는다. 기존 소비자(`status === "ready"`만 보는 "내 주변" 등)는 **무변경** — 가산 필드라 실패 의미가 그대로다.
- `staleFixOf(state): Coord | null` — `denied` ∧ `reason !== "denied"` ∧ `last` ∧ `last.at` 유한. 판정은 이 함수 하나만 지난다.
- **표시줄**(`LocationBar`): 수동 → 수동 라벨, 그 외 `staleFixOf(geo)`가 있으면 옛 위치 문장 + 그 좌표의 주소(`useCurrentAddress(stale)`), 아니면 지금 그대로.
- **길찾기**(`DirectionsView`): 상태 `staleOriginAt: number | null`(옛 좌표의 측정 시각, epoch 초). `currentLabel`은 수동 > 재측위 중 > 옛 위치 > 주소 > 기본.
  - 조회(`runQuery`): `awaitEffectiveLocation`이 null이고 수동 위치가 없으며 `staleFixOf(snapshot)`이 있으면 그 좌표로 진행, `originSource = "stale"`(출발지가 현재 위치일 때), 주소 재동기화, 완료 통지에 뒷문장. 성공하면 `staleOriginAt = null`.
  - "현재 위치 사용" 재선택(`selectCurrentFrom`): 실패 시 옛 좌표가 있으면 옛 위치 표기로 전환(지금은 조용히 직전 라벨 유지 — 그 라벨이 거짓이다).
  - 진입 시 주소 병기 effect: 스냅샷이 옛 위치면 그 좌표 주소 + 옛 위치 표기.
  - 안내 시작 고지(`announceGuideStart`): `originSource`가 `manual`이거나 `stale`이면 기존 "현재 위치에서 안내를 시작합니다". 새 문장 없음.
  - WebMCP 도구 대기자(`settleAfterCommit`)의 `geoError`는 **옛 위치로 진행하면 나오지 않는다**(조회가 성립). 도구 출력에 출발지 신선도 필드는 싣지 않는다(출력 allowlist 확장 없음 — YAGNI, 라벨 문자열 `fromLabel`이 이미 옛 위치 문장을 담는다).

### 4.2 iOS

- **`LocationService`**: `private(set) var lastFailedAt: Date?` — `currentCoordinate`가 **취득 실패**(`unavailable`)로 끝날 때만 기록(권한 거부·정밀도 꺼짐·추적 중 재사용 거부는 기록하지 않는다). `var staleFix: StaleFix?`(좌표+측정 시각): 권한 허용 ∧ 정밀 위치 ∧ `stored` ∧ `isFixSupersededByFailure`.
- **표시줄**(`LocationBarView.state`): 권한·정밀도 분기 뒤, 좌표 분기 **앞**에 옛 위치 분기. 주소는 `CurrentAddressStore`가 옛 좌표로 조회한 것만.
- **`CurrentAddressStore.ensureLoaded`**: `coordinateForDisplay()`가 nil이면 `staleFix`의 좌표로 조회를 이어 간다(키가 좌표라 옛 좌표 주소가 정확히 그 좌표의 주소다). `coordinateForDisplay`의 "낡은 좌표 금지" 계약은 그대로다 — 옛 좌표는 옛 위치 문장으로만 표시된다.
- **길찾기**(`DirectionsModel`): `private(set) var currentStaleAt: Date?`. 조회 catch의 `unavailable` 갈래에서 수동 위치 없음 ∧ `staleFix` → 그 좌표로 진행(커버리지 판정·주소 동기화는 성공 경로와 같은 자리). `loadCurrentAddressIfAuthorized`·`refreshCurrentLocation`도 실패 시 같은 폴백. 성공하면 nil. `resultsUsedManualOrigin`은 의미를 넓혀 `resultsOriginNeedsStartNotice`(수동 ∨ 옛 위치)로 개명한다 — 안내 시작 고지 판정 하나.
- 필드 라벨(`currentLocationText`): 수동 > 재측위 중 > 옛 위치 > 주소 > 기본. `TimelineView(.everyMinute)`로 감싼다.

### 4.3 안드로이드

- **`LocationStore`**: `lastFailedAtElapsedMs: Long?` — 조용하지 않은 `Unavailable` 실패에서만. `staleFix(): StaleFix?`(좌표+epoch 측정 시각 = `epochNow − 나이`): 권한 `Fine` ∧ `stored` ∧ `isFixSupersededByFailure`(같은 elapsed 시계로 비교).
- **표시줄**: `LocationBarInput`에 `staleFixAtEpoch: Double?`. `gpsLabel` 순서 = 권한 → **옛 위치** → 확정 실패 → 좌표 → 주소. 나이는 렌더 시점 틱으로 계산(`LocationBarRow`).
- **`CurrentAddressStore.ensureLoaded`**: iOS와 같이 옛 좌표로 이어 조회.
- **`EffectiveLocation`**: `staleFix()` — 수동 위치가 있으면 null(수동이 이긴다). 길찾기 `EndpointLocator`에 `staleFix()`·`coordinateForDisplay()` 추가.
- **길찾기**(`DirectionsViewModel`): `currentStaleAt: Double?`(UI 상태). 조회의 `Unavailable` 갈래 폴백, `refreshCurrentLocation` 폴백. `loadCurrentAddressIfAuthorized`는 `coordinateForRanking`(저장 좌표 폴백 = 이번 결함의 한 경로) 대신 표시용 좌표 + 옛 위치 폴백으로 바꾼다(iOS 등가). 안드로이드에는 안내 시작 고지("현재 위치에서 안내를 시작합니다")가 아직 없다 — 이번 범위 밖, 등가성 후보로 BACKLOG에 남긴다.

## 5. 범위 밖

- "내 주변" 목록·채팅 앵커·검색 거리 가중: 각자 실패 계약(직전 데이터 복원·좌표 없이 진행)이 있다. 판정은 표시줄과 길찾기 출발지.
- 실패 없이 캐시가 오래된 경우(웹 스토어는 TTL이 없어 재측위 요청이 없으면 옛 좌표가 `ready`로 남는다): 판정 단위가 "이번 측위가 실패했다"라 대상이 아니다. 길찾기 조회는 이미 나이 상한(180초)으로 재측위한다.
- 실시간 안내: 언제나 실좌표를 새로 잰다(웹 `awaitRealFix`·iOS `BeaconModel`). 옛 위치로 계산된 경로에서 시작해도 안내 출발점은 실측이다.

## 6. 검증

- 공유 fixture로 세 미러가 같은 시간 표현을 낸다(웹 vitest·Kit swift test·`:kit` gradle).
- 웹 컴포넌트: 스토어 실패 → `last` 유지·권한 거부는 미유지·조용한 실패 불변. 표시줄 옛 위치 문장, 길찾기 조회가 옛 좌표로 진행하고 통지 뒷문장, 재선택 실패 전환, 안내 시작 고지.
- 안드로이드 JVM: `gpsLabel` 순서, 길찾기 VM 폴백(가짜 `EndpointLocator`).
- iOS: Kit 테스트(판정·시간 표현) + Release·Experimental 빌드. 앱 배선은 소스 가드(`LocationBarView`에 옛 위치 분기가 좌표 분기 앞에 있는지 등)로 잠근다.
- 실기기 대본(보고서): 비행기 모드 + 기존 fix 뒤 표시줄·길찾기, 지하 진입.
