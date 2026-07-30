# iOS Nearby 11모델 상태 골격 추출 설계 (2026-07-31)

> 레거시 감사(2026-07-30) 이월 ③번. 웹 nearby 중복 추출(`2026-07-30-nearby-dedup-design.md`)의 iOS 판 — 같은 문제(복제된 상태 머신), 같은 목표(행동 불변 수렴 + 검증 가능한 층으로 전환 + 잠복 결함 1건 중앙 수정), 다른 제약(테스트 인프라 부재로 "현행 코드 계약 테스트 선행"이 불가능 → 전이표 동결 + Kit 기계 선행으로 대체).

## 1. 문제

`ios/Gildongmu/Nearby/` 11개 `@Observable` 모델이 전부 같은 `load()` 상태 머신을 복제한다(모델당 ~30–45줄): in-flight 가드 → loaded 보존 로딩 전이 → `LocationService.shared` 위치 취득 → `isInKorea` 선분기 → fetch → catch 3갈래(denied/outOfCoverage/실패)와 "loaded 중 전락이면 통지+데이터 유지" 분기. 뷰마다 `stateOverlay` switch(~15줄)도 복제. 합계 약 550줄이 8~11벌 동형이고, **앱 타깃에는 테스트 타깃이 없어 이 상태 머신은 검증 불가능한 층이다.**

부수 발견(잠복 결함): 11모델 전부 취소(`CancellationError`·`URLError.cancelled`)를 구분하지 않는다. 로딩 중 화면을 pop하면 `.task` 취소가 catch-all에 잡혀 실패로 오판되고, 직전 성공 데이터가 있던 화면이라면 **떠난 화면의 "새로고침 실패" 통지가 전역 VO로 발화**한다(접근성 헌장 §6 ⑨ "이탈 후 도착한 통지는 폐기" 위반 — 웹 마일스톤의 "닫힌 패널 늦은 응답" 결함과 동형). 또 내비 바 새로고침 버튼은 비구조 `Task {}`라 pop 후에도 취소되지 않고 완주해 맥락 밖 완료/실패 통지를 낼 수 있다.

## 2. 목표·비목표

**목표**
1. 상태 머신 정본 1벌을 `GildongmuKit`으로 추출해 **SPM `swift test`로 검증 가능한 층**으로 만든다(계약 테스트 선행).
2. 11모델을 도메인 구성(fetch·통지 문구·부가 상태)만 남는 얇은 껍데기로 이관 — **행동 byte-identical**(화면 카피·상태 전이·통지 문자열·타이밍 불변).
3. 뷰 `stateOverlay` switch 11벌을 공유 1벌로 수렴(문구·아이콘 디스크립터 주입).
4. **유일한 의도적 행동 변경**: 취소를 기계 한 곳에서 무시(상태 무변경·통지 무발화)해 잠복 결함을 11곳 동시 수정.

**비목표**
- `StationSections.swift`·`BarrierFreeInfoSection.swift`의 자동 등장 섹션 모델(장소 상세 종속, 생명주기 다름 — 후속 검토만).
- `LocationService`·`NearbyRefresh`(공통 modifier)·각 도메인 Service 변경 없음.
- 웹의 요청 ID latest-wins 이식 없음: iOS는 화면=모델 1:1(@State)이라 교차 패널 늦은 응답 경로 자체가 없고, in-flight 가드+취소 무시로 충분. AbortController류 취소 전파 신설도 하지 않는다(기각 동형 — 행동 불변 원칙).
- 새 i18n 키 없음(기존 키 재사용, 취소 수정은 통지 "제거"라 카피 불요).

## 3. 왜 웹과 다른 검증 전략인가 (순환의 구조적 회피)

웹은 무수정 현행 코드에 계약 테스트 118건을 동결한 뒤 추출했다. iOS는 그 길이 막혀 있다: ① 앱 타깃에 테스트 타깃이 없다(신설은 pbxproj 수술+시뮬레이터 레인 신규 인프라) ② 현행 모델이 `LocationService.shared` 싱글턴·전역 `AccessibilityNotification`에 직결이라 **seam 없이는 테스트가 안 붙고, seam을 만들면 이미 수정이다**(동결의 순환).

대체 전략(이 스펙의 §5 전이표가 동결 계약):
1. **전이표를 스펙에 동결** — 현행 11모델 코드 리딩으로 도출했고, 웹 계약 스위트(같은 행동의 118건)와 의미 동형임을 상호 대조.
2. **Kit에 기계+계약 테스트를 먼저 작성**(stub 좌표·fetch 주입, 지연 continuation으로 in-flight·취소 재현) → green 후 이관 시작.
3. **이관은 모델 1개=커밋 1개** — diff가 얇아(도메인 구성만 남음) 리뷰어가 "전이표 대비 소실·추가 없음"을 판정 가능.
4. 최종 게이트: Kit 테스트 + 앱 빌드 + 시뮬레이터 `xcodebuildmcp` 화면 실측(11화면 상태별) + 실기기 VO 스모크(위원장).

## 4. 아키텍처

```
GildongmuKit (SPM 테스트 가능, SwiftUI 무의존)
├─ NearbyLoadCore<Payload>       ← @Observable @MainActor 제네릭 상태 머신 정본
│    · phase: NearbyLoadPhase<Payload> (§5 상태 8종)
│    · load(force:) — 전이표 §5 구현, 취소 무시 포함
│    · 주입: getCoordinate / fetch / coverage / 이벤트 sink
├─ NearbyLoadPhase<Payload>      ← 정규 상태 enum
├─ NearbyLocationError           ← denied | unavailable (앱 어댑터가 LocationService 오류 번역)
├─ NearbyLoadEvent               ← 통지 이벤트 (Kit은 발화하지 않음 — 앱이 VO로 매핑)
└─ RevealWindow                  ← "더 보기" 창(초기 10·+10) 순수 로직 (4개 모델 공유)

앱 (ios/Gildongmu/Nearby/)
├─ 11모델 → NearbyLoadCore 구성 껍데기(도메인 fetch·통지 문구·부가 상태만)
├─ NearbyLoadState.swift → 이벤트→VO 발화 매퍼(announce* 재사용) + joinText 유지
└─ NearbyStateOverlay → 공유 switch 1벌(디스크립터 주입: empty 문구·아이콘, 실패 카피 오버라이드)
```

**주입 시그니처(정본)**

```swift
enum NearbyCoordinateSource {
    case current((_ force: Bool) async throws -> Coord)  // LocationService 어댑터
    case none                                            // 파라미터형(BusRouteStops): 좌표 단계 생략
}
enum NearbyCoverage { case korea, none }                 // korea = isInKorea 선분기(웹 coverage 미러)

// fetch: 좌표(파라미터형은 nil)와 직전 성공 페이로드(Conditions 조각 보존용)를 받고,
// Payload?를 반환한다 — nil = "정상적 부재"(WhereAmI data:null → .empty 경로).
typealias NearbyFetch<Payload> = (_ coord: Coord?, _ previous: Payload?) async throws -> Payload?
```

**동시성·어댑터 계약(Swift 6.2 strict — codex C5·I7 수용)**
- 주입 클로저(좌표·fetch·이벤트 sink·willCommit)는 전부 **`@MainActor` 격리로 선언**한다(코어가 MainActor이므로 저장·호출 모두 격리 일치, `async` 클로저 내부에서 nonisolated 작업으로 내려가는 것은 도메인 자유). `Payload: Sendable` 제약, 전 도메인 값 타입만 사용.
- 앱 오류 어댑터(LocationService → `NearbyLocationError`)의 판정 우선순위 동결: **취소(원본 그대로 rethrow — 절대 `unavailable`로 뭉개지 않는다) → denied → unavailable**. fetch 쪽 오류는 래핑 없이 그대로 전파(`APIError.outOfCoverage`는 Kit 타입이라 소실 없음).
- **`willCommit(Payload)` 훅**(동기, 커밋 게이트 통과 후 phase 대입 직전 호출): revealMore 도메인의 `visibleCount` 리셋 자리(codex I9 수용 — fetch 안 리셋은 커밋이 폐기될 때 창만 먼저 바뀌는 비원자성). 부가 상태 변경은 이 훅으로만.

**이벤트(통지는 전부 앱 몫 — Kit 무발화)**

```swift
enum NearbyLoadEvent<Payload> {
    case loaded(Payload)      // 도메인 완료 통지(건수+단위 / 부분 성공 / 요약 문장)
    case emptyResult          // 첫 로드 부재(WhereAmI whereAmI.empty)
    case refreshFailed        // loaded 중 실패·부재 — 데이터 유지와 짝
    case permissionLost       // loaded 중 denied 전락
    case wentOutOfCoverage    // loaded 중 커버리지 밖 전락
}
```

앱의 이벤트 매퍼 1벌이 기존 `announceLoaded`/`announceRefreshFailed`/`announcePermissionLost`/`announceOutOfCoverage`를 그대로 호출한다(문자열·조건 불변). `loaded`의 문구만 도메인 클로저(건수+단위 8종 / Conditions 3형 / WhereAmI ready / WalkInfra `liveSummary`).

## 5. 전이표 (동결 계약 — 계약 테스트가 전 케이스 커버)

상태: `idle · loading · loaded(Payload) · empty · denied · outOfCoverage · failedLocation · failedServer`.
기존 `NearbyLoadState.failed`는 `failedLocation`/`failedServer`로 정규화하되 **8종 리스트 도메인의 렌더는 두 상태를 같은 카피로 매핑**(화면 byte-identical). WhereAmI만 두 카피 분리(현행 유지).

| # | 사건 | 직전 상태 | 다음 상태 | 이벤트 | 비고 |
|---|---|---|---|---|---|
| 1 | `load()` 재진입(in-flight 중) | * | (무시) | — | in-flight 가드 |
| 2 | `load()` 시작 | loaded | loaded 유지 | — | 보존 재조회 |
| 3 | `load()` 시작 | 그 외 | loading | — | |
| 4 | 좌표 denied | loaded | denied | permissionLost | 전락 통지 |
| 5 | 좌표 denied | 그 외 | denied | — | |
| 6 | 좌표 그 외 실패 | loaded | loaded 유지 | refreshFailed | 데이터 유지 |
| 7 | 좌표 그 외 실패 | 그 외 | failedLocation | — | |
| 8 | coverage=korea ∧ `isInKorea` 거짓 | loaded | outOfCoverage | wentOutOfCoverage | fetch 생략(쿼터 보호) |
| 9 | 〃 | 그 외 | outOfCoverage | — | |
| 10 | fetch 성공(payload ≠ nil) | * | loaded(payload) | loaded | 완료 통지 1회 |
| 11 | fetch 부재(nil) | loaded | loaded 유지 | refreshFailed | WhereAmI 계약 |
| 12 | fetch 부재(nil) | 그 외 | empty | emptyResult | 〃 |
| 13 | fetch `APIError.outOfCoverage` | loaded | outOfCoverage | wentOutOfCoverage | 서버 마커 이중 방어 |
| 14 | 〃 | 그 외 | outOfCoverage | — | |
| 15 | fetch 그 외 throw | loaded | loaded 유지 | refreshFailed | |
| 16 | 〃 | 그 외 | failedServer | — | |
| 17 | **취소 감지** | * | **entry 상태 복원** | **없음** | **유일한 의도적 행동 변경** — §7. loaded였으면 loaded 유지, 그 외는 `load()` 진입 시점 상태로 복원(`.loading` 고착 금지 — codex C1 수용) |

취소 감지는 두 겹이다(codex C2 수용 — 협력적 취소는 오류를 던지지 않고 정상값을 반환할 수 있다):
- **오류형**: `CancellationError`·`URLError.code == .cancelled`(좌표·fetch 단계 공통, 래핑 전 원본 기준).
- **커밋 게이트**: 각 `await` 복귀 직후와 상태·이벤트 커밋 직전에 `Task.isCancelled` 검사 — 성공값이 반환됐어도 취소된 태스크면 커밋·이벤트 없이 #17 복원.

불변식: ① 통지는 이벤트로만(기계 무발화) ② loaded 보존 경로에서 payload는 절대 대체되지 않는다(Payload는 값 타입+`Sendable` 제약 — 참조 공유 변이 금지) ③ 완료 통지는 이번 호출 결과로만 판정(누적 상태 검사 금지 — Conditions 기존 주석 계약) ④ in-flight 해제는 `defer`(취소 포함 전 경로) ⑤ **상태 커밋과 이벤트는 같은 MainActor 턴에서 suspension 없이, "커밋 → 이벤트 1회" 순서로**(현행 코드는 전락 통지가 대입보다 앞서지만 같은 턴이라 관측 동등 — 기계에선 커밋 선행으로 정본화) ⑥ `force`는 `getCoordinate`로 그대로 전달될 뿐 전이에 영향 없음(`none` 소스에선 무의미, in-flight 중 `force` 호출도 #1대로 무시 — 현행 동일).

## 6. 변이 좌표 (11종 — 이관 태스크의 단일 진실)

| 도메인 | Payload | 좌표 | coverage | fetch | loaded 통지 | 특이점 |
|---|---|---|---|---|---|---|
| Subway | `[NearbySubwayStation]` | current | korea | `subwayArrivals` | 건수+unitStation | 규범 원본 |
| Bus | `[BusStop]` | current | korea | `busStops` | 건수+unitStop | |
| Bike | `[BikeStation]` | current | korea | `bikeStations` | 건수+unitBike | |
| Clinic | `(clinics: [NightClinic], summary: ClinicSummary)` | current | korea | `clinics` | 건수+unitPlace | revealMore, summary는 payload에 흡수 |
| Kids | `[KidsPlace]` | current | korea | `kidsPlaces` | 건수+unitPlace | revealMore |
| Around | `[SurroundingPlace]` | current | korea | `surroundings` | 건수+unitPlace | revealMore |
| BarrierFree | `[BarrierFreePlace]` | current | korea | `nearby` | 건수+unitPlace | revealMore, 출처 행 |
| BusRouteStops | `[BusRouteStop]` | **none(파라미터)** | none | `busRouteStops` | 건수+unitStop | denied·outOfCoverage 도달 불가, 로딩·실패 카피 오버라이드 |
| Conditions | `ConditionsPayload{weather, air, freshWeather, freshAir}` | current | korea | 2 fetch `async let` 합성(마커 감지 시 `APIError.outOfCoverage` throw로 승격) | fresh 조합 3형(ready/partial/failedTitle) | 조각 보존은 fetch가 `previous`와 병합, empty 없음 |
| WhereAmI | `(WhereAmIData, lat, lng, asOf)` | current | korea | `locate` → nil이면 부재 | whereAmIReady | **empty 경로 유일 사용**, failedLocation/Server 카피 분리 |
| WalkInfra | `(WalkInfrastructure, asOf)` | current | **none** | `nearby` | `liveSummary` 문장 | 의도 계약: 커버리지 무제한(OSM 전 지구, 웹 coverage:"none" 동형). 라우트에 마커 없어 #13 실제 도달 불가 — 기계 단일 경로 유지(행동 실질 불변) |

`asOf` 시각 포맷·`ClinicSummary` 폴백(`basis ?? "weekday"` 등)은 각 도메인 껍데기에 남고, `visibleCount` 리셋은 **`willCommit` 훅**(§4 — phase 대입과 같은 MainActor 턴, 커밋 게이트 통과 후라 취소 폐기와 원자적).

Conditions 함정 1건 동결: 조각 fetch(`fetchWeather`/`fetchAir`)의 catch-all은 **취소도 흡수**해 "両조각 실패" 페이로드를 정상 반환한다 — 이때 떠난 화면의 `failedTitle` 통지를 막는 것은 §5 **커밋 게이트**다(조각 catch를 고치지 않는다 — 부분 실패 graceful 계약 유지). 両조각 결과의 조합 진리표(양쪽 성공/한쪽/전무 × 첫 로드/보존)는 현행 코드 그대로 도메인 껍데기에 남고 plan에서 명세·테스트한다(codex I8 부분 수용).

## 7. 취소 결함 수정 (유일한 의도적 행동 변경)

- **판정**: 오류형(`CancellationError`·`URLError.cancelled`) + 커밋 게이트(`Task.isCancelled`) 2겹 — §5 #17.
- **효과와 정직한 커버 범위**: `.task` 초기 로드·재조회 경로(지배적 빈도 — 로딩 중 pop 전부)에서 "실패" 오판·맥락 밖 통지가 사라진다. **새로고침 버튼의 비구조 `Task {}` 경로는 이번 수정 밖**: pop 후에도 완주해 맥락 밖 통지를 낼 수 있는 창이 현행 그대로 남는다(아래 기각 근거).
- **새로고침 생명주기 귀속 기각(codex C3 부분 수용 — 문구 정정으로 반영, 구조 변경은 기각)**: `onDisappear`류 detach 게이트는 NavigationStack에서 **상세 화면을 push해 내려갈 때도 발화**해, "목록 새로고침 → 상세 진입 → 완료 통지"라는 현행 유효 통지까지 삼킨다 — 취소 무시보다 큰 행동 변경이라 이번 범위 밖. 실사용 관측 후 별도 판단.
- **테스트**: ① 좌표·fetch 단계 각각의 오류형 취소 → entry 상태 복원+이벤트 0건 ② **취소됐지만 성공값을 반환하는 stub**(협력적 취소 무시 시나리오) → 커밋·이벤트 폐기 ③ entry 상태별(idle·failedServer·loaded 등) 복원 정확성 ④ in-flight 해제(후속 load 정상).

## 8. 뷰 공유 계층

```swift
struct NearbyOverlayDescriptor {
    let loadingText: String            // 기본 ios.common.checking, BusRouteStops만 오버라이드
    let emptyList: (text: String, systemImage: String)?   // loaded ∧ isEmpty 카피(0건). 비리스트는 nil
    let isEmpty: (Payload) -> Bool     // 리스트 도메인 배열 isEmpty, 비리스트는 { _ in false }
    let failedLocation: (title: String, description: String?)  // 기본 failedTitle+retryLater
    let failedServer: (title: String, description: String?)    // 기본 동일, WhereAmI·BusRouteStops 오버라이드
    let absent: (text: String, systemImage: String)?           // .empty 상태(부재 ≠ 0건) — WhereAmI만
}
```

- 디스크립터는 **전용 이니셜라이저로 유효 조합만 생성**한다(`list(empty:…)` / `plain(…)` / WhereAmI형 `absentCapable(…)` — `absent` 있는데 리스트이거나 empty 카피 없는 리스트 같은 불법 조합을 타입으로 차단, codex M1 수용).
- `nearbyStateOverlay`(hit-testing 차단 래퍼)는 유지하고, 그 안의 switch를 `NearbyStateOverlayView(phase:, descriptor:)` 1벌로 수렴. 리스트 도메인의 "loaded ∧ isEmpty → empty 카피" 판정은 디스크립터의 `isEmpty` 클로저(또는 payload count 주입)로 일반화.
- denied·outOfCoverage 카피는 전 도메인 동일(현행)이라 디스크립터 밖 고정.
- 4종 revealMore 뷰 블록(ScrollViewReader+scrollTo 선행+`DispatchQueue.main.async` 포커스 대입)은 **현행 코드 형태 그대로** 도메인 뷰에 남긴다 — 뷰 제네릭화(row 클로저 주입)는 이번 범위 밖(모델 골격이 주제, 뷰 DSL 추상화는 잉여 위험). `RevealWindow`(수치 로직)만 Kit 공유.

## 9. 마이그레이션 순서·게이트

1. Kit: `NearbyLoadCore`+전이표 계약 테스트(전 케이스+취소 3단언+in-flight+보존) — green이 이관 착수 게이트.
2. Kit: `RevealWindow`+테스트.
3. 앱: 이벤트→VO 매퍼+`NearbyStateOverlayView`(이관 1호와 같은 커밋 허용).
4. 이관 11건 = 커밋 11개(규범 Subway부터, 이형 Conditions·WhereAmI·WalkInfra는 후반). 각 커밋 게이트: Kit `swift test` + `xcodebuild build` + **리뷰어가 §6 변이 좌표 표를 체크리스트로 diff 대조**(coverage 선택·fetch 인자·통지 문구 키·디스크립터 — Kit 테스트가 못 보는 배선 층의 판정자, codex C6 완화책).
5. 최종: 시뮬레이터 11화면 실측(loaded·empty·실패·거부 각 대표 케이스) + a11y 감사 + 실기기 배포(deploy-device.sh) + 위원장 VO 스모크(①로딩 중 pop 시 무통지 ②loaded 새로고침 실패 통지+데이터 유지 ③권한 회수 전락 통지 ④더 보기 포커스).

## 10. 판정 기록

- **latest-wins 비이식**: 웹 결함의 성립 조건(공유 화면에서 닫힌 패널의 재열림)이 iOS 내비 push 구조엔 없음. 취소 무시(§7)가 iOS에서의 대응물.
- **기계는 Kit, 오버레이는 앱**: Kit SwiftUI 무의존 유지(웹 `src/lib` React 비의존 미러). Observation은 UI 프레임워크가 아니고 macOS `swift test`에서 동작하므로 Kit 허용.
- **모델 클래스 11개 유지(파일 통합 안 함)**: 도메인 fetch·통지 문구·부가 상태의 자리가 필요하고, 파일=도메인 1:1이 리뷰 단위·웹 구조와 정합.
- **failed 상태 분해**: `failedLocation`/`failedServer` 정규화는 WhereAmI·WalkInfra가 이미 요구하는 최소 구분이며, 8종 렌더 매핑으로 화면 불변 — 상태 축소(단일 failed)로 되돌리면 이형 2종이 기계 밖 분기를 다시 갖게 되어 기각.
- **뷰 row DSL 추상화 기각**: revealMore 뷰 블록 4벌 중복은 남는다. 모델 골격과 달리 뷰 블록은 도메인 row·상세 진입이 얽혀 있어 추상화 이득 대비 간접화 비용이 큼(YAGNI). 후속 관찰.

**구현 중 확정된 승인 예외 2호(2026-07-31, Task 6 리뷰 판정)**: Conditions의 스테일 조각 부활 소멸. 구 코드는 weather/air를 모델 프로퍼티로 누적해 `done → denied/outOfCoverage → 복귀(조각 부분 실패)` 엣지에서 옛 좌표 기준 스테일 조각을 현재 정보처럼 재표시했고(3-state 위반 — SR 사용자는 스테일 판별 불가), 両조각 전멸 복귀에선 "가져오지 못했습니다" 통지와 스테일 화면이 불일치했다. 신 코드는 `previous`가 `.loaded` entry에서만 주어져 부활하지 않는다(그 조각은 "가져오지 못했습니다"로 정직 표시). `loaded → loaded` 새로고침 보존은 전수 동치 확인. 이 계약의 파생 원천(`previous`는 loaded entry 한정)은 Kit 테스트 `fetchPreviousIsNilWhenEntryIsNotLoaded`로 고정한다. §2의 "유일한 의도적 행동 변경"(취소)에 이은 두 번째이자 마지막 승인 예외.

**codex 적대적 리뷰 판정(2026-07-31, 13건)**
- **수용 9**: 취소 시 entry 상태 복원(C1)·협력적 취소 커밋 게이트(C2)·격리/Sendable 계약(C5)·커밋-이벤트 순서 동결(I6)·어댑터 오류 우선순위(I7)·willCommit 훅(I9)·force 계약(I11)·Payload 값 타입 제약(I12)·디스크립터 유효 조합 이니셜라이저(M1).
- **부분 수용 3**: 새로고침 비구조 Task(C3 — §7 커버 범위 문구 정정, onDisappear 게이트는 상세 push 시 유효 통지까지 삼켜 기각) / Conditions 진리표(I8 — 코어가 아닌 도메인 껍데기+plan 몫, 취소 흡수 함정은 커밋 게이트가 정본) / Kit 테스트 배선 한계(C6 — 이관 커밋별 §6 표 대조 리뷰+시뮬 실측으로 완화, **앱 테스트 타깃 신설은 이번 범위 밖 잔여 리스크로 기록** — 후속 마일스톤 후보).
- **기각 1**: in-flight 가드의 재진입 로드 유실(C4) — iOS Nearby는 화면=모델 1:1(`@State`)이라 pop 후 재진입은 **새 모델 인스턴스**(idle)로 시작하고, 낡은 인스턴스의 in-flight는 화면과 함께 폐기된다. 같은 인스턴스 재진입 경로(로드 중 refreshable)는 현행도 의도적 무시. 시나리오 불성립.
