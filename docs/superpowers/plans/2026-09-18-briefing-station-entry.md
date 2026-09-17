# 경로 브리핑에서 지하철역 상세·전화 (E45) 구현 계획

> **에이전트 실행자용**: 이 계획은 inline 실행(단일 세션 순차)이다 — 파일이 서로 겹치고(같은 `TransitRouteRows`·`TransitTrackingSheet`를 여러 태스크가 만진다) 선행 결정(Kit 시그니처)이 후속 인터페이스를 정하기 때문이다(자율성 헌장 §자율 진행). 태스크 묶음마다 리뷰 서브에이전트를 별도 컨텍스트로 디스패치한다.

**목표**: 길찾기 탭의 대중교통 경로 브리핑에서, 지하철 구간 줄에 들린 역 이름마다 VoiceOver 로터로 "상세 보기"·"전화 걸기"를 쓸 수 있게 한다.

**아키텍처**: 대상 역 선택은 Kit 순수 함수(이름 조인)가 정하고, 줄은 전부 `Text`로 남으며 진입은 로터 커스텀 액션뿐이다. 소비자는 옵트인(길찾기 탭 하나)이고, 저장소를 읽는 자리는 하위 뷰로 격리한다.

**스택**: Swift 6 / SwiftUI / Swift Testing(Kit) / Vitest(소스 가드·i18n)

**Spec**: `docs/superpowers/specs/2026-09-18-briefing-station-entry-design.md` (판정 §2, 리뷰 반영 §9 — **다시 열지 않는다**)

## 전역 제약

- **서버(`src/**` 런타임 코드) 변경 0.** 새 라우트·새 응답 필드·계약 변경이 필요해지면 멈추고 보고한다(심사 동결 정합). `src/lib/__tests__/**` 소스 가드 추가는 예외(테스트 레인).
- **push·Vercel 재배포 금지**(2026-09-22 09:00 KST까지). 로컬 커밋만. `.git/hooks/pre-push` 가드를 지우지 않는다.
- `git add -A` 금지. `git commit -m "..." -- <의도 경로>`로 원자화하고 직후 `git show HEAD --stat` 확인.
- `npm run test:run`이 매 커밋 통과. Kit은 `swift test`(`ios/GildongmuKit`).
- **대상 역은 이름 조인으로만 고른다**(`stops.first`/`stops.last` 금지, spec §3.2).
- **줄은 전부 `Text`로 남는다**(역이 하나여도 `Button` 금지, spec §3.3).
- **전화 액션은 저장소 상태와 무관하게 항상 있다**(spec §5.1).
- **`StationPhoneStore.prefetch`에 `leg.stops`를 넘기지 않는다**(줄당 최대 2건, spec §5.2).
- 로터 액션 선언은 **역순**(VoiceOver가 빌더 선언의 역순으로 노출).
- 문서·주석·커밋 메시지는 한국어. em dash 금지(에이전트용 문서는 적용 제외지만 UI 문구·사용자 응답은 금지).

---

## 파일 지도

| 파일 | 책임 | 상태 |
|---|---|---|
| `ios/GildongmuKit/Sources/GildongmuKit/TransitBriefingStations.swift` | 줄 → 대상 역 목록(이름 조인), 전화 3상태 → (문구 키, 진동) | 신설 |
| `ios/GildongmuKit/Tests/GildongmuKitTests/TransitBriefingStationsTests.swift` | 위 두 함수 전수 | 신설 |
| `android/kit/mirrors/core.json` | Kit 파일 등록부(`pending`) | 수정 |
| `messages/{ko,en,es,fr,it,ja}.json` | `transitGuide.callStation`·`…Representative` 신설 + `kidsNearby.call`·`surroundingsNearby.call` ko 동조 | 수정 |
| `ios/i18n/ios-extra/{6}.json` | `ios.station.phoneMissing`·`phonePending` 신설 | 수정 |
| `ios/Gildongmu/Resources/Localizable.xcstrings`, `ios/GildongmuKit/.../Localizable.xcstrings` | 생성물(재생성) | 수정 |
| `ios/Gildongmu/StationPhoneStore.swift` | 전화 액션 단일 창구 `callStationPhone` 추가(두 화면 공유) | 수정 |
| `ios/Gildongmu/RouteBriefing.swift` | `TransitRouteRows.stationEntry` 옵트인 + 하위 뷰 `BriefingStationRow` + 표시 이름 선택 | 수정 |
| `ios/Gildongmu/Directions/DirectionsTabView.swift` | `NavigationStack(path:)` + `navigationDestination` + push 콜백 | 수정 |
| `ios/Gildongmu/Directions/TransitTrackingSheet.swift` | 경유역 로터 상시 노출(§5.3) | 수정 |
| `src/lib/__tests__/briefing-station-entry-guard.test.ts` | 소스 가드 7종 | 신설 |
| `src/lib/__tests__/station-detail-guard.test.ts` | E44 로터 가드를 상시 노출로 개정 | 수정 |
| `docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md` | §5.5 표에 개정 표기 | 수정 |

---

## Task 1: Kit 순수 함수 둘

**파일**
- 생성: `ios/GildongmuKit/Sources/GildongmuKit/TransitBriefingStations.swift`
- 생성: `ios/GildongmuKit/Tests/GildongmuKitTests/TransitBriefingStationsTests.swift`
- 수정: `android/kit/mirrors/core.json`

**인터페이스 (후속 태스크가 의존)**

```swift
public enum TransitBriefingRow: Sendable, Hashable {
    case walk(legIndex: Int)
    case transit(legIndex: Int)
    case alight(legIndex: Int)
}

public struct TransitBriefingStation: Sendable, Hashable {
    public let stop: TransitLegStop
    public let lineName: String?
}

public func transitBriefingStations(_ legs: [TransitRouteLeg], row: TransitBriefingRow) -> [TransitBriefingStation]

public enum ResultHapticKind: Sendable, Hashable { case success, attention, failure }

/// nil = 통지하지 않는다(번호를 걸면 전화 앱 전환이 응답이다).
public func briefingPhoneAnnouncement(_ result: StationPhoneResult?) -> (key: String, haptic: ResultHapticKind)?
```

**단계**

- [ ] 1-1 실패 테스트 작성: `transitBriefingStations` 전수(줄 3종 × 조인 성공·실패·부분 목록·역순 목록·빈 이름·nil `stops`·버스·도보 연속·승차=하차 접기) + `briefingPhoneAnnouncement` 5상태
- [ ] 1-2 `swift test`로 컴파일 실패 확인
- [ ] 1-3 구현
- [ ] 1-4 `swift test` 통과 확인
- [ ] 1-5 `android/kit/mirrors/core.json`에 `pending` 등재, `npm run test:run -- mirror-registry` 통과
- [ ] 1-6 커밋 `feat(ios): E45 브리핑 역 진입 판정 Kit 함수(이름 조인·전화 3상태)`

**구현 요지** (spec §3.2 표 + 규칙 다섯)

- `.walk(i)`: `legs[i].mode == "walk"` → `legs[(i+1)...]`에서 **첫 non-walk** leg → 그것이 `subway`일 때 그 leg의 `stops`에서 `fromName` 조인(앞에서부터). 노선 힌트는 그 leg의 `lineName`.
- `.transit(i)`: `legs[i].mode == "subway"` → `fromName` 앞에서부터, `toName` 뒤에서부터. 정규화 결과가 같으면 1개로 접는다.
- `.alight(i)`: `.transit`의 하차 항목과 같은 술어(`toName` 뒤에서부터).
- 이름 게이트는 **non-empty**(`""`는 없는 것). 조인 실패는 빈 배열.
- 조인 술어는 기존 `normalizeStopName`(같은 모듈) 재사용 — 자체 정규화 신설 금지.
- `lineName`은 `leg.lineName`의 빈 문자열만 접는다. 노선 표 판정(`subwayLineIdentity`)은 복제하지 않는다.

---

## Task 2: 문구

**파일**
- 수정: `messages/{ko,en,es,fr,it,ja}.json`
- 수정: `ios/i18n/ios-extra/{ko,en,es,fr,it,ja}.json`
- 재생성: 두 `Localizable.xcstrings`

**단계**

- [ ] 2-1 `messages/*`에 `transitGuide.callStation`·`transitGuide.callStationRepresentative` 6로케일 추가
- [ ] 2-2 `messages/ko.json`의 `kidsNearby.call`·`surroundingsNearby.call`을 `전화 걸기`로 동조
- [ ] 2-3 `ios/i18n/ios-extra/*`에 `ios.station.phoneMissing`·`ios.station.phonePending` 6로케일 추가
- [ ] 2-4 `node ios/scripts/messages-to-xcstrings.mjs all`
- [ ] 2-5 `npm run test:run`(i18n 일관성·xcstrings arg-order 게이트) 통과
- [ ] 2-6 커밋

**문구 표**

| 키 | ko | en | es | fr | it | ja |
|---|---|---|---|---|---|---|
| `transitGuide.callStation` | `{station}에 전화 걸기` | `Call {station}` | `Llamar a {station}` | `Appeler {station}` | `Chiama {station}` | `{station}に電話をかける` |
| `transitGuide.callStationRepresentative` | `{station} 대표번호로 전화 걸기` | `Call {station} main line` | `Llamar al número central de {station}` | `Appeler le standard de {station}` | `Chiama il numero centrale di {station}` | `{station}の代表番号に電話をかける` |
| `ios.station.phoneMissing` | `역 전화번호가 없습니다.` | `No station phone number available.` | `No hay teléfono de la estación.` | `Aucun numéro de la gare.` | `Nessun numero della stazione.` | `駅の電話番号がありません。` |
| `ios.station.phonePending` | `역 전화번호를 찾고 있습니다.` | `Looking up the station phone number.` | `Buscando el teléfono de la estación.` | `Recherche du numéro de la gare.` | `Ricerca del numero della stazione.` | `駅の電話番号を検索しています。` |

---

## Task 3: 전화 액션 단일 창구

**파일**: 수정 `ios/Gildongmu/StationPhoneStore.swift`

브리핑 하위 뷰와 `ViaStopStationRow`가 **같은 한 벌**을 지난다(spec §5.1·§5.3).

```swift
/// 역 전화 액션의 단일 창구(E45 spec §5.1). 번호면 걸고(통지 없음 — 전화 앱 전환이 응답이다),
/// 그 밖이면 3상태를 `.high` 통지 + 진동으로 알린다. `nil`(모름)은 세 상태를 겹쳐 들고 있어
/// 그냥 "찾고 있습니다"라 하면 거짓이 될 수 있으므로 **`resolve`를 킥오프한 뒤** 통지한다.
/// 통지 문구에 역 이름을 넣지 않는다 — 방금 누른 액션 라벨이 그 역을 말했다.
@MainActor
func callStationPhone(stationName: String, lat: Double, lng: Double, lineName: String, openURL: OpenURLAction)
```

- [ ] 3-1 구현(커밋은 Task 4와 함께 — 소비자가 없으면 미사용 경고)

---

## Task 4: 브리핑 옵트인 + 로터 + push 경로

**파일**
- 수정: `ios/Gildongmu/RouteBriefing.swift`
- 수정: `ios/Gildongmu/Directions/DirectionsTabView.swift`
- 생성: `src/lib/__tests__/briefing-station-entry-guard.test.ts`

**설계 결정(spec §3.5 구현 항목)**

`stationEntry`는 **콜백 옵셔널**이다: `var stationEntry: ((TransitLegStop, String?) -> Void)? = nil`.
spec 문언은 `Bool = false`지만, 로터 액션이 실제로 무언가를 하려면 push 클로저가 함께 필요하다.
Bool과 클로저를 둘 다 두면 "Bool은 true인데 클로저가 nil" = 무반응 액션이라는 조합이 생기고,
그것이 정확히 spec §3.5가 막으려던 결함이다. 하나로 합치면 기본 꺼짐·옵트인·호출부 전수 가드가
그대로 성립하면서 그 조합이 **구조적으로 불가능**해진다.

**단계**

- [ ] 4-1 소스 가드 7종 작성(실패 상태 확인)
- [ ] 4-2 `RouteBriefing.swift`: `stationEntry` 프로퍼티, 표시 이름 선택(`transitLegUsesEnglish`), 하위 뷰 `BriefingStationRow`(로터 역순 선언·`.task(id:)` 30초 재확인·줄당 prefetch)
- [ ] 4-3 `DirectionsTabView.swift`: `StationDestination` 값, `NavigationStack(path:)`, `navigationDestination(for:)`, `TransitRouteRows(stationEntry:)` 배선
- [ ] 4-4 `npm run test:run` 전량 통과(신규 가드 7종 + `place-detail-sheet-guard` 포함)
- [ ] 4-5 Xcode 빌드 확인
- [ ] 4-6 커밋

---

## Task 5: 안내 시트 경유역 로터 상시 노출 (§5.3)

**파일**
- 수정: `ios/Gildongmu/Directions/TransitTrackingSheet.swift`
- 수정: `src/lib/__tests__/station-detail-guard.test.ts`
- 수정: `docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md`

- [ ] 5-1 E44 가드를 상시 노출 계약으로 개정(실패 확인)
- [ ] 5-2 `ViaStopStationRow.accessibilityActions`를 상태 `switch` → 무조건 1개, 동작은 `callStationPhone`
- [ ] 5-3 `npm run test:run` 통과 + 빌드
- [ ] 5-4 E44 spec §5.5 표에 개정 표기
- [ ] 5-5 커밋

---

## Task 6: 검증 (커밋 뒤)

- [ ] 6-1 변이 주입 5축(spec §8): 위치 인덱스 되돌림 · `reversed()` 제거 · `.walk` 게이트를 `legs[i+1]`로 · 이름 게이트 non-nil · `stationEntry` 기본값 켜짐
- [ ] 6-2 실호출 게이트: `/api/route/transit?includeStops=1` 수십 건으로 이름 조인 성립률. 확인 케이스(환승 2회 이상·버스↔지하철 혼합·지하철-지하철 연속)를 별도 PASS로 단언, 부재는 FAIL로 기록
- [ ] 6-3 a11y 감사(general-purpose + 헌장 Read)
- [ ] 6-4 cross-cutting 리뷰 서브에이전트 1회
- [ ] 6-5 실기기 배포 안내(위원장 판정 3건) — **여기서 멈춘다**

---

## Task 7: 문서 분배

- [ ] 7-1 `CHANGELOG.md` 서사, `docs/BACKLOG.md` §5 E45 종결, `PROGRESS.md` 상태 한 줄
- [ ] 7-2 새 함정을 `CLAUDE.md` 한두 줄 + `docs/PATTERNS.md` 같은 제목 절
- [ ] 7-3 `python sync_agent_docs.py`(워크스페이스 루트, CLAUDE.md를 고쳤을 때만)
- [ ] 7-4 `doc-audit` 스킬(SessionStart 보고가 떠 있다)
- [ ] 7-5 커밋
