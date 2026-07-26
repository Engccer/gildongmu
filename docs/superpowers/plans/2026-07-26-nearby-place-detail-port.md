# 내 주변 → 장소 상세 UI 이식 (iOS) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내 주변 4종(소아 진료·아이 놀 곳·둘러보기·무장애 관광지) 항목에서 검색 탭과 동일한 장소 상세(`PlaceDetailView`)·행 로터 액션(`PlaceRow`)으로 진입하게 한다.

**Architecture:** `PlaceRow`에 보조 텍스트 주입 슬롯, `PlaceDetailView`에 도메인 섹션 제네릭 슬롯을 열고, 4종 화면의 항목을 `NavigationLink { PlaceDetailView } label: { PlaceRow }`로 통일한다. 무장애용 `barrierFreePlaceToPlace` 합성 함수를 Kit에 신규 추가한다. 스펙: `docs/superpowers/specs/2026-07-26-nearby-place-detail-port-design.md`.

**Tech Stack:** SwiftUI(iOS 26), GildongmuKit(SPM, swift-testing), xcstrings 결정론 변환 파이프라인.

## Global Constraints

- 주석·커밋 메시지 한국어, 변수·함수명 영어. 커밋 이메일 `engccer@gmail.com`.
- `git add -A` 금지 — 의도 파일만 명시 pathspec으로 add·commit.
- 접근성: 행 = 1접근성 객체(combine), 로터 액션 역순 선언, 보유 데이터만 액션 노출, 평문 단일 텍스트(라벨 볼드 분절·dl 금지), UI 라벨 이모지 금지.
- 커밋 푸터:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01NT9BANtD7Lk2HBcBqSV7mx`
- 빌드 게이트: `xcodebuild -project ios/Gildongmu.xcodeproj -scheme Gildongmu -destination 'platform=iOS Simulator,name=iPhone 17' build` (성공 = `** BUILD SUCCEEDED **`).
- Kit 테스트: `cd ios/GildongmuKit && swift test`.

---

### Task 1: Kit — `barrierFreePlaceToPlace` 합성 함수

**Files:**
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/PlaceProjection.swift`
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/PlaceProjectionTests.swift`

**Interfaces:**
- Consumes: `BarrierFreePlace`(contentId·name·category·address·lat·lng·distanceMeters — `Models/BarrierFreeModels.swift`), `Place`(SearchModels).
- Produces: `public func barrierFreePlaceToPlace(_ b: BarrierFreePlace) -> Place` — Task 5가 사용.

- [ ] **Step 1: 실패하는 테스트 작성** — `PlaceProjectionTests.swift` 끝에 추가:

```swift
@Test func barrierFreePlaceToPlaceMapsRoadAddressSlot() {
    let bf = BarrierFreePlace(
        contentId: "130183", name: "서울도서관", category: "",
        address: "서울특별시 중구 세종대로 110 (태평로1가)",
        lat: 37.5666, lng: 126.9784, distanceMeters: 34)
    let place = barrierFreePlaceToPlace(bf)

    #expect(place.id == "130183")
    #expect(place.name == "서울도서관")
    #expect(place.category == "")
    // TourAPI addr1은 도로명 주소(fixture 실측) — 지번 슬롯이면 상세가 "지번 주소 …"로 오낭독.
    #expect(place.roadAddress == "서울특별시 중구 세종대로 110 (태평로1가)")
    #expect(place.address == "")
    #expect(place.phone == nil)
    #expect(place.link == nil)
    #expect(place.distanceMeters == 34)
}
```

- [ ] **Step 2: 실패 확인** — Run: `cd ios/GildongmuKit && swift test --filter barrierFreePlaceToPlace` → 컴파일 에러(`cannot find 'barrierFreePlaceToPlace'`) 예상.

- [ ] **Step 3: 구현** — `PlaceProjection.swift`의 `surroundingPlaceToPlace` 뒤에 추가:

```swift
public func barrierFreePlaceToPlace(_ b: BarrierFreePlace) -> Place {
    Place(
        id: b.contentId,
        name: b.name,
        // contenttypeid 라벨(빈 문자열 허용) — 역 키워드가 없어 일반 프롬프트 버킷.
        category: b.category,
        // ⚠ TourAPI addr1은 도로명 주소다(fixture 실측 "서울특별시 중구 세종대로 110 (태평로1가)").
        // 지번은 소스에 없으므로 비운다(없는 값을 지어내지 않는다).
        address: "",
        roadAddress: b.address,
        englishAddress: nil,
        lat: b.lat,
        lng: b.lng,
        phone: nil,
        link: nil,
        distanceMeters: Double(b.distanceMeters))
}
```

파일 상단 주석의 "내 주변 항목(소아진료·아이 놀 곳·둘러보기)" 열거에 무장애 관광지를 추가한다.

- [ ] **Step 4: 통과 확인** — Run: `cd ios/GildongmuKit && swift test` → 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add ios/GildongmuKit/Sources/GildongmuKit/PlaceProjection.swift ios/GildongmuKit/Tests/GildongmuKitTests/PlaceProjectionTests.swift
git commit -m "feat(kit): barrierFreePlaceToPlace 합성 — 무장애 관광지 상세·채팅 진입 기반" -- ios/GildongmuKit/Sources/GildongmuKit/PlaceProjection.swift ios/GildongmuKit/Tests/GildongmuKitTests/PlaceProjectionTests.swift
```

---

### Task 2: `PlaceRow` 보조 텍스트 슬롯 + `PlaceDetailView` 도메인 섹션 슬롯

**Files:**
- Modify: `ios/Gildongmu/SearchView.swift`(PlaceRow, formatDistanceKo)
- Modify: `ios/Gildongmu/PlaceDetailView.swift`

**Interfaces:**
- Produces(Task 3~5가 사용):
  - `PlaceRow(place: Place, secondaryOverride: String?, onAskAbout: (() -> Void)?)` — secondaryOverride nil이면 기존 조합(기존 호출처 무변경).
  - `PlaceDetailView(place: Place)`(기존 그대로) + `PlaceDetailView(place: Place, @ViewBuilder domainSection:)` — 도메인 섹션은 List 최상단 렌더.
  - `formatDistanceKo(_ meters: Double) -> String` — private 제거(모듈 내부 공유, M6b 백로그 소화).

- [ ] **Step 1: PlaceRow에 secondaryOverride 추가** — `SearchView.swift`의 `PlaceRow`:

```swift
struct PlaceRow: View {
    let place: Place
    /// 도메인 화면(내 주변)이 보조 줄을 대체할 때 주입(진료 상태·실내외·방위 등).
    /// nil이면 기본 조합(카테고리·주소·거리) — 검색 탭·채팅 카드 무변경.
    var secondaryOverride: String? = nil
    /// 장소 채팅 진입(검색 결과 전용 — sheet 상태를 가진 화면만 넘긴다).
    /// 채팅 카드 내 재사용은 nil로 액션 미노출(채팅 안에서 채팅 재진입 순환 방지).
    var onAskAbout: (() -> Void)? = nil
    ...
```

`joined` 계산 속성 첫 줄에 override 분기:

```swift
    private var joined: String {
        if let secondaryOverride { return secondaryOverride }
        var parts = [place.category, place.roadAddress.isEmpty ? place.address : place.roadAddress]
        ...기존 그대로...
```

⚠ 기존 호출처가 `PlaceRow(place:, onAskAbout:)` 라벨 인자 순서로 호출하므로 `secondaryOverride`는 `place` 다음, `onAskAbout` 앞에 선언(기본값 있어 무변경 컴파일).

- [ ] **Step 2: formatDistanceKo private 제거** — `SearchView.swift:356` `private func formatDistanceKo` → `func formatDistanceKo`(주석: 내 주변 행 보조 텍스트와 공유).

- [ ] **Step 3: PlaceDetailView 제네릭 슬롯** — 구조체 선언·body 최상단·편의 init:

```swift
/// 장소 상세. 정보 정본은 텍스트 리스트(지도 없음). 실주행은 딥링크 위임(spec §4).
/// domainSection: 도메인 전용 최상단 섹션(내 주변 소아 진료 등) — 그 화면에 온 이유이므로 서열 1위.
struct PlaceDetailView<DomainSection: View>: View {
    let place: Place
    @ViewBuilder var domainSection: () -> DomainSection
    @Environment(\.openURL) private var openURL
    ...기존 @State 그대로...

    var body: some View {
        List {
            domainSection()
            Section {
            ...기존 그대로...
```

파일 끝에 편의 init(기존 호출처 `PlaceDetailView(place:)` 무변경):

```swift
extension PlaceDetailView where DomainSection == EmptyView {
    init(place: Place) {
        self.init(place: place, domainSection: { EmptyView() })
    }
}
```

⚠ `@ViewBuilder`가 저장 프로퍼티에 붙으면 합성 memberwise init이 `@ViewBuilder` 클로저 인자를 받는다(Swift 5.4+). 합성 init이 통하지 않으면 명시 init을 쓴다:

```swift
    init(place: Place, @ViewBuilder domainSection: @escaping () -> DomainSection) {
        self.place = place
        self.domainSection = domainSection
    }
```

- [ ] **Step 4: 빌드 확인** — Global Constraints의 xcodebuild 명령 → BUILD SUCCEEDED(기존 화면 회귀 없음 확인이 목적).

- [ ] **Step 5: 커밋**

```bash
git add ios/Gildongmu/SearchView.swift ios/Gildongmu/PlaceDetailView.swift
git commit -m "feat(ios): PlaceRow 보조 텍스트·PlaceDetailView 도메인 섹션 슬롯 — 내 주변 이식 기반" -- ios/Gildongmu/SearchView.swift ios/Gildongmu/PlaceDetailView.swift
```

---

### Task 3: 소아 진료 화면 전환 + 도메인 섹션 + i18n 키

**Files:**
- Modify: `ios/Gildongmu/Nearby/ClinicNearbyView.swift`
- Modify: `ios/i18n/ios-extra/{ko,en,es,fr,it}.json` — `ios.clinic.designated` 신규

**Interfaces:**
- Consumes: Task 2의 `PlaceRow(place:secondaryOverride:onAskAbout:)`·`PlaceDetailView(place:domainSection:)`·`formatDistanceKo`, 기존 `nightClinicToPlace`·`joinText`.
- Produces: 파일 수준 `func clinicStatusText(_ status: NightClinic.OpenStatus) -> String`(뷰 private에서 승격, 이 파일 안에서 행·도메인 섹션 공유).

- [ ] **Step 1: 상태 문장 헬퍼 승격** — `ClinicNearbyView` 내부 private `clinicStatusText`·`endTimeText`를 파일 수준 internal로 이동(이름 충돌 방지 위해 `endTimeText` → `clinicEndTimeText`로 개명):

```swift
/// 진료 상태 3-state 문장 — 목록 행 보조 텍스트와 상세 도메인 섹션이 공유.
/// open이면 종료시각까지, closed/unknown은 각각의 문장으로.
func clinicStatusText(_ status: NightClinic.OpenStatus) -> String {
    switch status.state {
    case "open":
        if let end = status.end {
            return joinText(appLocalized("clinicNearby.open"), clinicEndTimeText(end))
        }
        return appLocalized("clinicNearby.open")
    case "closed":
        return appLocalized("ios.nearby.clinicClosed")
    default:
        return appLocalized("ios.nearby.clinicUnknown")
    }
}

/// HHMM 정수를 "HH시 MM분까지"로. 2400은 자정을 뜻해 "자정까지".
private func clinicEndTimeText(_ hhmm: Int) -> String {
    if hhmm == 2400 { return appLocalized("ios.nearby.untilMidnight") }
    return appLocalized("ios.nearby.untilTime", String(hhmm / 100), String(hhmm % 100))
}
```

- [ ] **Step 2: 도메인 섹션 뷰 추가** — 같은 파일에:

```swift
/// 소아 진료 도메인 섹션 — 장소 상세 최상단(진료 여부가 이 화면에 온 이유).
/// 전부 평문 단일 텍스트. 달빛 지정은 true일 때만(위원장 판정 2026-07-26: 목록 미표기·상세 조건부).
struct ClinicDomainSection: View {
    let clinic: NightClinic

    var body: some View {
        Section {
            Text(clinicStatusText(clinic.openStatus))
            if !clinic.directions.isEmpty {
                Text(appLocalized("clinicNearby.directions", clinic.directions))
            }
            if clinic.designated == true {
                Text(appLocalized("ios.clinic.designated"))
            }
        }
    }
}
```

- [ ] **Step 3: 목록 전환** — `ClinicNearbyView.body`의 `ForEach` 블록(항목별 Section·header·주소·찾아오는길·전화 행 전부)을 평면 행으로 교체. 조건부 안내 Section(공휴일 기준·보완 실패)은 그대로 둔다:

```swift
            if case .loaded(let clinics) = model.state {
                // 평면 1행=1객체(검색 탭 동형). 항목 heading·주소·전화 행은 상세로 이동
                // — M2·M3 "평면 리스트 heading 잉여" 결정 동형. 실기기 VO 확인 게이트.
                ForEach(clinics) { clinic in
                    NavigationLink {
                        PlaceDetailView(place: nightClinicToPlace(clinic)) {
                            ClinicDomainSection(clinic: clinic)
                        }
                    } label: {
                        PlaceRow(
                            place: nightClinicToPlace(clinic),
                            secondaryOverride: joinText(
                                clinic.kind,
                                clinicStatusText(clinic.openStatus),
                                appLocalized("place.distance", formatDistanceKo(Double(clinic.distanceMeters)))),
                            onAskAbout: { chatPlace = nightClinicToPlace(clinic) })
                    }
                }
            }
```

뷰 내부의 `chatLabel`·`clinicStatusText`·`endTimeText` private 메서드와 `contextMenu`·`accessibilityAction` 잔재를 제거한다(로터 물어보기는 PlaceRow가 `ios.place.askAbout` 키로 제공 — 하드코딩 한국어 라벨 해소).

- [ ] **Step 4: i18n 키 추가** — `ios/i18n/ios-extra/*.json`의 `"ios"` 객체 안 `"place"` 형제로 `"clinic"` 신설:

| 로케일 | `ios.clinic.designated` |
|---|---|
| ko | `달빛어린이병원으로 지정된 기관입니다.` |
| en | `Government-designated night pediatric clinic (Moonlight Children's Hospital).` |
| es | `Clínica pediátrica nocturna designada por el gobierno (Moonlight Children's Hospital).` |
| fr | `Clinique pédiatrique de nuit désignée par l'État (Moonlight Children's Hospital).` |
| it | `Clinica pediatrica notturna designata dal governo (Moonlight Children's Hospital).` |

- [ ] **Step 5: 빌드 확인** — xcodebuild 명령 → BUILD SUCCEEDED.

- [ ] **Step 6: 커밋**

```bash
git add ios/Gildongmu/Nearby/ClinicNearbyView.swift ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json
git commit -m "feat(ios): 소아 진료 목록을 장소 상세 진입으로 전환 — 평면 행+도메인 섹션(달빛 지정 조건부)" -- ios/Gildongmu/Nearby/ClinicNearbyView.swift ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json
```

---

### Task 4: 아이 놀 곳·둘러보기 화면 전환

**Files:**
- Modify: `ios/Gildongmu/Nearby/KidsNearbyView.swift`
- Modify: `ios/Gildongmu/Nearby/AroundNearbyView.swift`

**Interfaces:**
- Consumes: Task 2 산출물 + 기존 `kidsPlaceToPlace`·`surroundingPlaceToPlace`·`joinText`. 각 화면의 라벨 헬퍼(`kindLabel`·`inOutLabel`·`categoryPiece`·`bearingLabel`)는 유지.

- [ ] **Step 1: KidsNearbyView ForEach 교체** — 단일 `Text`+contextMenu+accessibilityAction 행을:

```swift
                ForEach(places) { place in
                    // 보조 텍스트 정보량은 현행 유지(종류·실내외·거리·주소), 이름은 PlaceRow 1행에 결합.
                    NavigationLink {
                        PlaceDetailView(place: kidsPlaceToPlace(place))
                    } label: {
                        PlaceRow(
                            place: kidsPlaceToPlace(place),
                            secondaryOverride: joinText(
                                kindLabel(place.kind), inOutLabel(place.indoorOutdoor),
                                appLocalized("place.distance", formatDistanceKo(Double(place.distanceMeters))),
                                place.roadAddress ?? place.address),
                            onAskAbout: { chatPlace = kidsPlaceToPlace(place) })
                    }
                }
```

`chatLabel` private 메서드 제거(로터는 PlaceRow가 제공).

- [ ] **Step 2: AroundNearbyView ForEach 교체** — 동형:

```swift
                ForEach(places) { place in
                    // 보조 텍스트 정보량은 현행 유지(카테고리·방위·거리). ⚠ 방위는 북 기준 절대 8방위만.
                    NavigationLink {
                        PlaceDetailView(place: surroundingPlaceToPlace(place))
                    } label: {
                        PlaceRow(
                            place: surroundingPlaceToPlace(place),
                            secondaryOverride: joinText(
                                categoryPiece(place.categoryRaw), bearingLabel(place.bearing),
                                appLocalized("place.distance", formatDistanceKo(Double(place.distanceMeters)))),
                            onAskAbout: { chatPlace = surroundingPlaceToPlace(place) })
                    }
                }
```

`chatLabel` private 메서드 제거(하드코딩 한국어 해소).

- [ ] **Step 3: 빌드 확인** — xcodebuild 명령 → BUILD SUCCEEDED.

- [ ] **Step 4: 커밋**

```bash
git add ios/Gildongmu/Nearby/KidsNearbyView.swift ios/Gildongmu/Nearby/AroundNearbyView.swift
git commit -m "feat(ios): 아이 놀 곳·둘러보기 목록을 장소 상세 진입으로 전환 — PlaceRow 통일" -- ios/Gildongmu/Nearby/KidsNearbyView.swift ios/Gildongmu/Nearby/AroundNearbyView.swift
```

---

### Task 5: 무장애 관광지 화면 전환 + 죽은 코드·키 정리

**Files:**
- Modify: `ios/Gildongmu/Nearby/BarrierFreeNearbyView.swift`
- Modify: `ios/i18n/ios-extra/{ko,en,es,fr,it}.json` — `ios.nearby.showFacilitiesFor`·`ios.nearby.facilitiesFailed` 제거

**Interfaces:**
- Consumes: Task 1의 `barrierFreePlaceToPlace`, Task 2 산출물, 기존 `ChatView`.
- 유지: Kit `BarrierFreeService.detail(contentId:)`은 앱에서 미사용이 되지만 웹 라우트 미러 계약이라 Kit에 보존(테스트 포함).

- [ ] **Step 1: 목록 전환·죽은 코드 제거** — `BarrierFreeNearbyView.swift`에서 `BarrierFreeDetailLoadState`·`BarrierFreePlaceSection`·모델의 `detailStates`·`detailInFlight`·`loadDetailIfNeeded`를 제거하고, ForEach를 교체. 출처 Section은 유지. 채팅 sheet 상태 신설(이 화면은 처음 채팅 진입을 얻는다):

```swift
struct BarrierFreeNearbyView: View {
    @State private var model = BarrierFreeNearbyModel()
    /// 장소 채팅 sheet(웹 계약 미러). 표시마다 새 ChatView = 장소마다 새 대화
    @State private var chatPlace: Place?

    var body: some View {
        List {
            if case .loaded(let places) = model.state {
                // 편의시설의 발견 경로는 상세의 BarrierFreeInfoSection 자동 섹션으로 대체
                // (match 라우트 — 같은 소스 좌표라 50m∩이름 매칭). DisclosureGroup lazy 로드 폐기.
                ForEach(places) { place in
                    NavigationLink {
                        PlaceDetailView(place: barrierFreePlaceToPlace(place))
                    } label: {
                        PlaceRow(
                            place: barrierFreePlaceToPlace(place),
                            secondaryOverride: joinText(
                                place.address,
                                appLocalized("place.distance", formatDistanceKo(Double(place.distanceMeters)))),
                            onAskAbout: { chatPlace = barrierFreePlaceToPlace(place) })
                    }
                }
                if !places.isEmpty {
                    Section {
                        Text(appLocalized("barrierFreeInfo.source"))
                    }
                }
            }
        }
        .navigationTitle(appLocalized("ios.nearby.barrierFree"))
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
        .sheet(item: $chatPlace) { ChatView(place: $0) }
    }
    ...stateOverlay 기존 그대로...
}
```

- [ ] **Step 2: 죽은 i18n 키 제거** — 5개 `ios/i18n/ios-extra/*.json`에서 `ios.nearby.showFacilitiesFor`·`ios.nearby.facilitiesFailed` 삭제 전, 다른 사용처가 없는지 확인:

Run: `grep -rn "showFacilitiesFor\|ios.nearby.facilitiesFailed" ios/Gildongmu --include="*.swift"` → 결과 0이어야 삭제.

⚠ 웹 키 `barrierFreeNearby.facilitiesLoading`·`facilitiesEmpty`(messages/*.json)는 웹이 계속 쓰므로 건드리지 않는다.

- [ ] **Step 3: 빌드 확인** — xcodebuild 명령 → BUILD SUCCEEDED.

- [ ] **Step 4: 커밋**

```bash
git add ios/Gildongmu/Nearby/BarrierFreeNearbyView.swift ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json
git commit -m "feat(ios): 무장애 관광지 목록을 장소 상세 진입으로 전환 — DisclosureGroup 폐기·채팅 진입 신설" -- ios/Gildongmu/Nearby/BarrierFreeNearbyView.swift ios/i18n/ios-extra/ko.json ios/i18n/ios-extra/en.json ios/i18n/ios-extra/es.json ios/i18n/ios-extra/fr.json ios/i18n/ios-extra/it.json
```

---

### Task 6: xcstrings 재생성 + 전체 게이트 + 시뮬 실측

**Files:**
- Modify(생성물): `ios/Gildongmu/Localizable.xcstrings`

- [ ] **Step 1: xcstrings 재생성·키 린트**

```bash
node ios/scripts/messages-to-xcstrings.mjs all && node ios/scripts/check-xcstrings-keys.mjs
```

Expected: 린터 PASS(신규 `ios.clinic.designated` 포함, 제거 키 잔존 없음).

- [ ] **Step 2: Kit 전체 테스트** — `cd ios/GildongmuKit && swift test` → 전체 PASS.

- [ ] **Step 3: 전체 빌드** — xcodebuild 명령 → BUILD SUCCEEDED.

- [ ] **Step 4: 시뮬 실측** — 시뮬레이터 위치를 길동으로 고정 후 xcodebuildmcp로 구동·스냅샷:

```bash
UDID=$(xcrun simctl list devices booted | grep -o '[0-9A-F-]\{36\}' | head -1)
xcrun simctl location "$UDID" set 37.5384,127.1428
npx xcodebuildmcp simulator build-and-run --project ios/Gildongmu.xcodeproj --scheme Gildongmu
npx xcodebuildmcp ui-automation snapshot-ui
```

내 주변 탭 → 소아 진료·아이 놀 곳·둘러보기·무장애 각 화면 진입(`tap` elementRef) 후 snapshot으로 확인: ① 행이 단일 결합 라벨(이름+보조)인가 ② 행 탭으로 상세가 뜨고 소아 진료 상세 최상단에 진료 상태(달빛 지정 기관이면 지정 문장)가 있는가 ③ 무장애 상세에 편의시설 자동 섹션이 뜨는가(match 실호출). 스냅샷은 원시 트리라 최종 판정은 실기기 VO(위원장).

- [ ] **Step 5: 커밋**

```bash
git add ios/Gildongmu/Localizable.xcstrings
git commit -m "chore(i18n): xcstrings 재생성 — ios.clinic.designated 추가·무장애 펼침 키 제거" -- ios/Gildongmu/Localizable.xcstrings
```

---

### Task 7: 리뷰·문서·배포

- [ ] **Step 1: 리뷰** — code-reviewer 서브에이전트에 `git diff <스펙 커밋>..HEAD` 범위 리뷰 + a11y-auditor로 4종 화면·상세 슬롯 점검(기준: 접근성 헌장 — 과잉 없는가까지). 지적은 아키텍처 대조 후 반영.
- [ ] **Step 2: PROGRESS.md 갱신** — 미해결·보류에 이 마일스톤 완료 기록(실기기 VO 확인 잔여 명시), 소아 진료 단락의 "상세 이식 시 조건부 노출" 문구를 완료로 연결.
- [ ] **Step 3: push** — `git push` (자동 배포는 웹만 영향 — 이번 변경은 iOS 전용이라 무영향).
- [ ] **Step 4: 실기기 배포** — iPhone 연결 확인 후 `ios/deploy-device.sh`.
- [ ] **Step 5: 위원장 VO 확인 요청** — 행 낭독(1행=1객체)·로터 액션 6종·상세 진입·소아 진료 heading 제거 체감.
