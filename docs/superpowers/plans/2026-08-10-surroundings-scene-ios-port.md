# M1 부근 상황 재구성 iOS 이식 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹에 구현된 M1 도착지 부근 상황 재구성(`/api/surroundings/scene`)을 iOS 두 진입점(WhereAmI·BeaconTrackingSheet)에 요청형 임베드 섹션으로 이식한다.

**Architecture:** 계산은 전부 서버 라우트에 있으므로 Swift 계산 미러는 없다(착수 노트 확정). Kit에 Codable 모델+엔드포인트 1개, 앱에 임베드 섹션 뷰 1개(`NearbyLoadCore` `.fixed` 앵커 + 묶음별 `RevealWindow`), 진입점 2곳 배선. 통지는 전부 포커스·라벨 채널이고 Announcement 0건(웹 `SurroundingsScene.tsx` 계약 미러 — 감싸는 화면이 단일 통지 채널을 소유).

**Tech Stack:** SwiftUI + Observation, GildongmuKit(SPM), Swift Testing(fixture 디코드), xcstrings 파이프라인(`messages-to-xcstrings.mjs`).

**구현 방식 판정(자율성 헌장):** inline. 근거 — Task 1의 타입·시그니처가 Task 3~5의 전제이고(순차 의존), 단일 도메인이며, 수정 파일이 한 계열(ios/)이다. 리뷰는 판정과 무관하게 별도 컨텍스트로 분리한다(Task 7).

## Global Constraints

- 주석·커밋 메시지 한국어, 변수·함수명 영어.
- `appLocalized("키")`의 키는 **문자열 리터럴만**(`check-xcstrings-keys.mjs` 린터 계약 — 동적 조립 금지). bucket 값→키 매핑은 switch에 리터럴 12개를 나열한다.
- 한 줄 = 한 접근성 객체. 거리·이름·길 단서는 i18n 템플릿(`surroundings.item`/`itemWithRoad`)으로 단일 텍스트 조립.
- 거리 문자열을 화면에 낼 때는 `distanceText()`(앱, VO m 오독 정정) 경유. 거리 조립은 Kit `formatDistance`만(소수 km 직접 조립 금지).
- 버튼 비활성화는 `disabled` 금지 — 라벨 교체 + 핸들러 가드.
- 이 섹션은 **Announcement를 게시하지 않는다**(성공=헤딩 포커스, 빈 결과·실패=메시지 행 포커스, 조회 중=트리거 라벨 교체).
- 신규 상태 문자열(`frame`·`bucket`)은 enum이 아니라 String으로 둔다(NearbyModels 원칙 — 서버가 값을 늘려도 깨지지 않게).
- 커밋은 `git commit -m "..." -- <의도 파일들>` pathspec 모드(`git add -A` 금지), 커밋 후 `git show HEAD --stat` 검증.
- push는 Task 7 리뷰 게이트 통과 후에만.

---

### Task 1: Kit — Scene Codable 모델 + NearbyService 엔드포인트 + fixture 테스트

**Files:**
- Create: `ios/GildongmuKit/Sources/GildongmuKit/Models/SurroundingsSceneModels.swift`
- Modify: `ios/GildongmuKit/Sources/GildongmuKit/NearbyService.swift` (메서드 1개 추가)
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/surroundings-scene.json` (prod 실캡처)
- Create: `ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/surroundings-scene-compass.json` (prod 실캡처)
- Test: `ios/GildongmuKit/Tests/GildongmuKitTests/NearbyModelsTests.swift` (append)

**Interfaces:**
- Consumes: `APIClient.get(_:query:)`, `coordQuery(lat:lng:)` (기존)
- Produces: `SurroundingsScene { place: String?, frame: String, groups: [SurroundingsSceneGroup], total: Int }`, `SurroundingsSceneGroup { bucket: String, items: [SurroundingsSceneItem] }`, `SurroundingsSceneItem { name: String, distanceMeters: Int, road: String?, category: String }`, `NearbyService.surroundingsScene(lat:lng:) async throws -> SurroundingsScene?` (nil = 서버 키 미보유)

- [ ] **Step 1: fixture를 prod 실호출로 캡처한다** (좌표는 `scripts/verify-surroundings-scene.mjs`의 게이트 좌표를 그대로 쓴다 — 망원시장은 근사 좌표가 entrance로 새는 함정이 있어 카카오 실좌표로 고정돼 있다)

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu
# entrance frame (강동구청 — 맞은편 묶음 포함)
curl -s "https://gildongmu.vercel.app/api/surroundings/scene?lat=37.5301&lng=127.1237" \
  > ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/surroundings-scene.json
# compass 폴백 (망원시장 — 역지오코딩 도로명 없음)
curl -s "https://gildongmu.vercel.app/api/surroundings/scene?lat=37.555886&lng=126.906266" \
  > ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/surroundings-scene-compass.json
# 캡처 검증: 각각 "frame":"entrance" / "frame":"compass" 포함 확인
grep -o '"frame":"[a-z]*"' ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/surroundings-scene*.json
```

Expected: `"frame":"entrance"` / `"frame":"compass"`. 다르면(라우트 미배포·에러 봉투) 멈추고 원인 확인 — fixture를 손으로 지어내지 않는다(실캡처가 계약 정본, 기존 Fixtures 관례).

- [ ] **Step 2: 실패하는 디코드 테스트 작성** — `NearbyModelsTests.swift` 끝에 append

```swift
// MARK: - M1 부근 상황 재구성

@Test func surroundingsSceneFixtureDecodes() throws {
    let response = try JSONDecoder().decode(
        SurroundingsSceneResponse.self, from: fixture("surroundings-scene"))
    let scene = try #require(response.data)
    #expect(scene.frame == "entrance")
    #expect(scene.total > 0)
    #expect(!scene.groups.isEmpty)
    // 서버는 항목 있는 묶음만 싣는다(빈 묶음 없음)
    #expect(scene.groups.allSatisfy { !$0.items.isEmpty })
    // road는 앵커와 다른 도로일 때만 채워지는 옵셔널 — 디코딩이 null을 삼키는지 확인
    #expect(scene.groups.flatMap(\.items).allSatisfy { $0.distanceMeters >= 0 })
}

@Test func surroundingsSceneCompassFixtureDecodes() throws {
    let response = try JSONDecoder().decode(
        SurroundingsSceneResponse.self, from: fixture("surroundings-scene-compass"))
    let scene = try #require(response.data)
    #expect(scene.frame == "compass")
    #expect(!scene.groups.isEmpty)
}
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `cd /Users/hunyongkim/Mac-Projects/gildongmu/ios/GildongmuKit && swift test --filter surroundingsScene 2>&1 | tail -5`
Expected: 컴파일 실패 (`SurroundingsSceneResponse` 미정의)

- [ ] **Step 4: 모델 구현** — `Models/SurroundingsSceneModels.swift` 생성

```swift
import Foundation

// M1 도착지 부근 상황 재구성 — 서버 `/api/surroundings/scene` 응답 1:1 미러
// (웹 `src/lib/surroundings-scene.ts` Scene). 좌우·맞은편 계산은 전부 서버에
// 있고 앱은 소비만 한다(iOS 이식 착수 노트 2026-08-10: 계산 미러 불필요).

/// 장소 한 줄 재료. 한 줄 조립(거리+이름+길 단서)은 뷰가 i18n 템플릿으로 한다.
public struct SurroundingsSceneItem: Codable, Sendable, Hashable {
    public let name: String
    public let distanceMeters: Int
    /// 앵커와 다른 도로일 때만 서버가 채운다(같은 도로면 잉여라 null).
    public let road: String?
    public let category: String
}

/// 묶음 하나. bucket은 frame에 따라 left|right|across|beyond 또는 8방위(n·ne·…).
/// 신규 값 추가에 깨지지 않도록 String(NearbyModels 원칙).
public struct SurroundingsSceneGroup: Codable, Sendable, Hashable {
    public let bucket: String
    public let items: [SurroundingsSceneItem]
}

public struct SurroundingsScene: Codable, Sendable {
    /// 위치 확인 문장 재료(행정동 + 도로명주소). 못 얻으면 null.
    public let place: String?
    /// "entrance" = 입구 기준 좌우, "compass" = 절대 방위 폴백(3-state).
    public let frame: String
    public let groups: [SurroundingsSceneGroup]
    public let total: Int
}

public struct SurroundingsSceneResponse: Codable, Sendable {
    /// null = 서버 키 미보유(게이트). 소비자가 구성 결함으로 다룬다(빈 결과로 위장 금지).
    public let data: SurroundingsScene?
}
```

- [ ] **Step 5: NearbyService에 엔드포인트 추가** — `busRouteStops` 메서드 앞에 삽입

```swift
    /// M1 부근 상황 재구성(요청형). 앵커 좌표 하나를 받아 입구 기준 좌우 묶음을 준다.
    /// nil = data:null(서버 키 미보유) — 소비자가 오류로 태운다(웹 parse 미러, 3-state).
    public func surroundingsScene(lat: Double, lng: Double) async throws -> SurroundingsScene? {
        let response: SurroundingsSceneResponse = try await client.get(
            "/api/surroundings/scene", query: coordQuery(lat: lat, lng: lng))
        return response.data
    }
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd /Users/hunyongkim/Mac-Projects/gildongmu/ios/GildongmuKit && swift test --filter surroundingsScene 2>&1 | tail -5`
Expected: 2 tests PASS

- [ ] **Step 7: Kit 전체 테스트 회귀 확인 후 커밋**

Run: `swift test 2>&1 | tail -3` (전체 green 확인)

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu
git commit -m "feat(guide-ios): M1 부근 재구성 Kit 모델 + 엔드포인트 — 서버 JSON 1:1 Codable" -- \
  ios/GildongmuKit/Sources/GildongmuKit/Models/SurroundingsSceneModels.swift \
  ios/GildongmuKit/Sources/GildongmuKit/NearbyService.swift \
  ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/surroundings-scene.json \
  ios/GildongmuKit/Tests/GildongmuKitTests/Fixtures/surroundings-scene-compass.json \
  ios/GildongmuKit/Tests/GildongmuKitTests/NearbyModelsTests.swift
git show HEAD --stat
```

---

### Task 2: i18n — 앱 카탈로그에 surroundings 네임스페이스 반영

웹 `surroundings.*` 11키는 6로케일 messages에 이미 있고(확인 완료), 앱 타깃은 전 네임스페이스를 담으므로 **재생성만 하면 된다**(`KIT_NAMESPACES` 수정 불요 — 착수 노트 ⓓ). iOS 전용 카피가 필요 없어 `ios-extra` 추가도 없다(미니멀리즘 — 웹 카피 그대로).

**Files:**
- Modify(생성물): `ios/Gildongmu/Resources/Localizable.xcstrings`

**Interfaces:**
- Produces: 앱 카탈로그 키 `surroundings.button`·`refresh`·`loading`·`ready`·`empty`·`error`·`source`·`item`(%1$@=distance %2$@=name)·`itemWithRoad`(%1$@=distance %2$@=name %3$@=road)·`count`(%1$@)·`bucket.{left,right,across,beyond,n,ne,e,se,s,sw,w,nw}` — Task 3이 `appLocalized`로 소비

- [ ] **Step 1: 재생성 실행**

```bash
cd /Users/hunyongkim/Mac-Projects/gildongmu
node ios/scripts/messages-to-xcstrings.mjs app
```

- [ ] **Step 2: 키 반영·diff 검증**

```bash
python3 -c "
import json
d=json.load(open('ios/Gildongmu/Resources/Localizable.xcstrings'))
ks=[k for k in d['strings'] if k.startswith('surroundings.')]
print(len(ks), sorted(ks)[:3])"
git diff --stat ios/Gildongmu/Resources/Localizable.xcstrings
```

Expected: 19키(11항목 중 bucket이 12키로 전개). diff에 **삭제 행이 있으면 멈추고 원인 조사**(웹 키 삭제가 앱 참조를 끊을 수 있다 — `check-xcstrings-keys.mjs`로 확인). 다른 네임스페이스의 신규 키가 함께 들어오는 것은 카탈로그 동기화라 정상.

- [ ] **Step 3: 기존 키 린터 회귀 확인 후 커밋**

```bash
node ios/scripts/check-xcstrings-keys.mjs
git commit -m "chore(guide-ios): 앱 카탈로그 재생성 — surroundings 네임스페이스 반영" -- \
  ios/Gildongmu/Resources/Localizable.xcstrings
git show HEAD --stat
```

---

### Task 3: 앱 — SurroundingsSceneSection (모델 + 임베드 뷰)

**Files:**
- Create: `ios/Gildongmu/Nearby/SurroundingsSceneSection.swift` (pbxproj 편집 불요 — fileSystemSynchronized 그룹)

**Interfaces:**
- Consumes: `NearbyLoadCore`(`.fixed` 소스)·`RevealWindow`·`NearbyService.surroundingsScene`·`formatDistance`(Kit), `distanceText`·`appLocalized`·`AppConfig.apiBaseURL`(앱)
- Produces: `SurroundingsSceneSection(anchor: NearbyCoord, proxy: ScrollViewProxy)` — List 안에 임베드하는 행 묶음. Task 4·5가 마운트한다.

- [ ] **Step 1: 파일 작성** — 전문:

```swift
import SwiftUI
import Observation
import GildongmuKit

/// M1 부근 상황 재구성 — "여기가 맞나" 확인용 요청형 섹션(웹 SurroundingsScene.tsx 미러).
///
/// 진입점 2곳(WhereAmI·BeaconTrackingSheet)이 모두 **다른 화면의 List 안**이라 자체
/// 화면·nearbyStateOverlay를 만들지 않고 행들로 임베드된다. 통지는 전부 포커스·라벨
/// 채널(헌장 §5): 조회 중 = 트리거 라벨 교체, 성공 = 결과 헤딩 포커스, 빈 결과·실패 =
/// 메시지 행 포커스. Announcement 게시 금지 — 감싸는 화면이 이미 단일 통지 채널을
/// 소유한다(웹 DistanceBeacon 단일 live 계약 동형).
@Observable @MainActor
final class SurroundingsSceneModel {
    private var core: NearbyLoadCore<SurroundingsScene>!   // 클로저가 self 캡처 — IUO 2단 초기화
    /// 묶음별 "더 보기" 창(웹 useRevealMore per-group 미러). 커밋 시 전체 리셋.
    private var windows: [String: RevealWindow] = [:]
    /// 진행 신호(트리거 라벨 교체 근거). core는 loaded 유지 재조회 중을 노출하지 않는다.
    private(set) var busy = false
    /// 재조회 실패 표식 — core 계약 #11이 직전 데이터를 유지하므로, 이 플래그가 없으면
    /// 재조회 실패가 무신호가 된다(침묵 금지). 메시지 행 + 포커스의 근거.
    private(set) var refreshFailed = false
    /// 닫기 상태(웹 close() 미러). 데이터는 버리지 않고 표시만 접는다 — 재조회는 load가.
    private(set) var closed = false
    var phase: NearbyLoadPhase<SurroundingsScene> { core.phase }

    init(anchor: NearbyCoord) {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: .fixed(anchor),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("fixed 소스는 좌표 보장") }
                // data null = 서버 키 미보유. 여기 도달했다면 구성 결함이므로 빈 결과로
                // 위장하지 않고 오류로 태운다(웹 parse 미러, 3-state).
                guard let scene = try await service.surroundingsScene(
                    lat: coord.lat, lng: coord.lng) else {
                    throw APIError.badStatus(code: 200, message: "surroundings scene: data null")
                }
                return scene.total == 0 ? nil : scene   // nil → 코어가 .empty로
            },
            willCommit: { [weak self] _ in
                self?.windows = [:]
                self?.refreshFailed = false
            },
            onEvent: { [weak self] event in
                // 발화 채널 없음(위 주석) — 재조회 실패만 화면 표식으로 옮긴다.
                if case .refreshFailed = event { self?.refreshFailed = true }
            })
    }

    func load() async {
        guard !busy else { return }
        busy = true
        refreshFailed = false
        closed = false
        defer { busy = false }
        await core.load()
    }

    func close() { closed = true }

    func visibleCount(for bucket: String) -> Int {
        windows[bucket]?.visibleCount ?? RevealWindow.initialVisible
    }

    /// "더 보기": 해당 묶음 공개 수를 늘리고 첫 새 항목 행 id를 반환(VO 포커스 대상).
    func revealMore(bucket: String) -> String? {
        guard case .loaded(let scene) = phase,
              let group = scene.groups.first(where: { $0.bucket == bucket }) else { return nil }
        var window = windows[bucket] ?? RevealWindow()
        guard let firstNewIndex = window.revealMore(totalCount: group.items.count) else { return nil }
        windows[bucket] = window
        return sceneItemRowID(bucket: bucket, index: firstNewIndex)
    }
}

private func sceneItemRowID(bucket: String, index: Int) -> String {
    "scene-item-\(bucket)-\(index)"
}

/// 묶음이 이보다 크면 제목에 곳수를 병기한다(웹 COUNT_IN_TITLE_THRESHOLD 미러).
private let countInTitleThreshold = 3

struct SurroundingsSceneSection: View {
    let anchor: NearbyCoord
    let proxy: ScrollViewProxy
    @State private var model: SurroundingsSceneModel
    @AccessibilityFocusState private var focusedID: String?

    init(anchor: NearbyCoord, proxy: ScrollViewProxy) {
        self.anchor = anchor
        self.proxy = proxy
        _model = State(initialValue: SurroundingsSceneModel(anchor: anchor))
    }

    private var anchorKey: String { "\(anchor.lat),\(anchor.lng)" }

    private var isOpen: Bool {
        if case .loaded = model.phase, !model.closed { return true }
        return false
    }

    private var triggerLabel: String {
        if model.busy { return appLocalized("surroundings.loading") }
        return isOpen
            ? appLocalized("surroundings.refresh") : appLocalized("surroundings.button")
    }

    private var terminalMessage: String? {
        if model.refreshFailed { return appLocalized("surroundings.error") }
        switch model.phase {
        case .empty: return appLocalized("surroundings.empty")
        case .failedServer: return appLocalized("surroundings.error")
        case .outOfCoverage: return appLocalized("ios.common.outOfCoverage")
        default: return nil   // denied 계열은 .fixed 소스에서 도달 불가
        }
    }

    var body: some View {
        // 조회 중 라벨 교체가 진행 신호(reroute 버튼 관례 — 별도 announce 금지).
        Button(triggerLabel) {
            guard !model.busy else { return }
            Task {
                await model.load()
                await landAfterLoad()
            }
        }
        .id("scene-trigger")
        .accessibilityFocused($focusedID, equals: "scene-trigger")
        // 앵커가 바뀌면 이전 장면·상태를 버린다(웹 key 재마운트 미러).
        .onChange(of: anchorKey) {
            model = SurroundingsSceneModel(anchor: anchor)
        }

        if let message = terminalMessage {
            Text(message)
                .id("scene-message")
                .accessibilityFocused($focusedID, equals: "scene-message")
        }

        if isOpen, case .loaded(let scene) = model.phase {
            Text(appLocalized("surroundings.ready"))
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .id("scene-heading")
                .accessibilityFocused($focusedID, equals: "scene-heading")
            // 닫기 자신도 사라지는 전이 — 상시 존재하는 트리거로 포커스 선점(헌장 §5).
            Button(appLocalized("actions.close")) {
                model.close()
                Task { await land(on: "scene-trigger") }
            }
            // 위치 확인 문장 먼저, 그다음 묶음(spec 판정 3).
            if let place = scene.place {
                Text(place)
            }
            ForEach(scene.groups, id: \.bucket) { group in
                // 묶음 제목이 유일한 발견 경로(spec 판정 10 — 제목 점프로 통째 건너뛰기).
                Text(bucketTitle(group))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                ForEach(
                    Array(group.items.prefix(model.visibleCount(for: group.bucket)).enumerated()),
                    id: \.offset
                ) { index, item in
                    // 한 줄 = 한 접근성 객체. 거리 낭독 정정은 distanceText가(m→로케일 단어).
                    distanceText(itemLine(item))
                        .id(sceneItemRowID(bucket: group.bucket, index: index))
                        .accessibilityFocused(
                            $focusedID,
                            equals: sceneItemRowID(bucket: group.bucket, index: index))
                }
                if group.items.count > model.visibleCount(for: group.bucket) {
                    Button(appLocalized("actions.showMore")) {
                        if let id = model.revealMore(bucket: group.bucket) {
                            proxy.scrollTo(id, anchor: .top)   // 가시화 후 포커스(Clinic 정본)
                            DispatchQueue.main.async { focusedID = id }
                        }
                    }
                }
            }
            // 실재성 한계 고지(spec 판정 5 — 이름을 그대로 말하는 대신 출처로 헤지).
            Text(appLocalized("surroundings.source"))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func itemLine(_ item: SurroundingsSceneItem) -> String {
        if let road = item.road {
            return appLocalized(
                "surroundings.itemWithRoad",
                formatDistance(item.distanceMeters), item.name, road)
        }
        return appLocalized(
            "surroundings.item", formatDistance(item.distanceMeters), item.name)
    }

    private func bucketTitle(_ group: SurroundingsSceneGroup) -> String {
        let name = bucketName(group.bucket)
        guard group.items.count > countInTitleThreshold else { return name }
        return "\(name) \(appLocalized("surroundings.count", String(group.items.count)))"
    }

    /// bucket 값→키 매핑. 린터 계약(리터럴 키만)이라 switch에 12개를 나열한다.
    /// 모르는 값은 원값 노출(키 문자열 노출보다 낫다 — 서버가 값을 늘려도 안 깨진다).
    private func bucketName(_ bucket: String) -> String {
        switch bucket {
        case "left": appLocalized("surroundings.bucket.left")
        case "right": appLocalized("surroundings.bucket.right")
        case "across": appLocalized("surroundings.bucket.across")
        case "beyond": appLocalized("surroundings.bucket.beyond")
        case "n": appLocalized("surroundings.bucket.n")
        case "ne": appLocalized("surroundings.bucket.ne")
        case "e": appLocalized("surroundings.bucket.e")
        case "se": appLocalized("surroundings.bucket.se")
        case "s": appLocalized("surroundings.bucket.s")
        case "sw": appLocalized("surroundings.bucket.sw")
        case "w": appLocalized("surroundings.bucket.w")
        case "nw": appLocalized("surroundings.bucket.nw")
        default: bucket
        }
    }

    /// 종단 상태로 포커스 착지. 대상 행이 트리거 바로 아래 새 행이라 scrollTo 없이
    /// AX 트리에 있다 — 지연·대입·검증·1회 재시도(BeaconTrackingSheet.landStopFocus 동형).
    private func landAfterLoad() async {
        let target: String?
        if terminalMessage != nil {
            target = "scene-message"
        } else if isOpen {
            target = "scene-heading"
        } else {
            target = nil
        }
        guard let target else { return }
        await land(on: target)
    }

    private func land(on target: String) async {
        try? await Task.sleep(for: .milliseconds(400))
        focusedID = target
        try? await Task.sleep(for: .milliseconds(600))
        if focusedID != target { focusedID = target }
    }
}
```

- [ ] **Step 2: 키 린터 + 시뮬레이터 빌드로 컴파일 확인** (`xcodebuildmcp-cli` 스킬의 빌드 명령 사용 — 아직 미배선이라 화면 확인은 Task 6에서)

```bash
node ios/scripts/check-xcstrings-keys.mjs
```

Expected: `ios.common.outOfCoverage` 포함 전 키 통과. 누락 키가 나오면 카탈로그·키 이름을 대조해 수정(키를 동적 조립로 우회하지 말 것).

Build run(스킬 명령 형식 확인 후): 시뮬레이터 대상 `xcodebuild build` 또는 `xcodebuildmcp simulator build`. Expected: BUILD SUCCEEDED.

- [ ] **Step 3: 커밋**

```bash
git commit -m "feat(guide-ios): M1 부근 재구성 임베드 섹션 — NearbyLoadCore fixed 앵커 + 묶음별 더 보기" -- \
  ios/Gildongmu/Nearby/SurroundingsSceneSection.swift
git show HEAD --stat
```

---

### Task 4: 진입점 1 — WhereAmIView (채팅 버튼 옆)

**Files:**
- Modify: `ios/Gildongmu/Nearby/WhereAmIView.swift:93-95` (채팅 Button 아래)

**Interfaces:**
- Consumes: `SurroundingsSceneSection(anchor:proxy:)` (Task 3), `WhereAmIPayload.lat/.lng` (기존 — 조회 좌표를 이미 보존)

- [ ] **Step 1: loaded Section 안 채팅 버튼 아래에 섹션 마운트**

`WhereAmIView.body`의 loaded Section에서:

```swift
                    Button(appLocalized("ios.nearby.whereAmIChat")) {
                        chatPlace = whereAmIToPlace(payload.data, lat: payload.lat, lng: payload.lng, lang: AppLanguage.current)
                    }
```

바로 아래(같은 Section 내부)에 추가:

```swift
                    // M1 부근 재구성 — 앵커는 이 정위에 실제로 쓴 좌표(수동 위치 자동
                    // 반영, 웹 WhereAmI.tsx 미러). 기준점 산문과 다른 층: 입구 기준
                    // 좌우 묶음 + 18종 단서.
                    SurroundingsSceneSection(
                        anchor: (lat: payload.lat, lng: payload.lng), proxy: proxy)
```

- [ ] **Step 2: 빌드 확인**

Expected: BUILD SUCCEEDED (기존 `ScrollViewReader { proxy in` 스코프 안이라 proxy 사용 가능).

- [ ] **Step 3: 커밋**

```bash
git commit -m "feat(guide-ios): WhereAmI에 부근 재구성 섹션 — 정위 좌표 앵커" -- \
  ios/Gildongmu/Nearby/WhereAmIView.swift
git show HEAD --stat
```

---

### Task 5: 진입점 2 — BeaconTrackingSheet (목적지 앵커)

**Files:**
- Modify: `ios/Gildongmu/Directions/BeaconModel.swift:156` (`dest` 읽기 노출)
- Modify: `ios/Gildongmu/Directions/BeaconTrackingSheet.swift` (ScrollViewReader 래핑 + 둘째 Section)

**Interfaces:**
- Consumes: `SurroundingsSceneSection(anchor:proxy:)` (Task 3), `BeaconDest.lat/.lng` (Kit, public)
- Produces: `BeaconModel.dest`가 `private(set)`으로 읽기 가능해진다

- [ ] **Step 1: BeaconModel.dest 노출** — 156행:

```swift
    private var dest: BeaconDest?
```
→
```swift
    /// 추적 시트가 부근 재구성 앵커로 읽는다(M1). 쓰기는 여전히 모델 내부만.
    private(set) var dest: BeaconDest?
```

- [ ] **Step 2: 시트에 섹션 추가** — `BeaconTrackingSheet.body`의 `List { ... }`를 `ScrollViewReader { proxy in List { ... } }`로 감싸고("더 보기" 가시화용), 기존 Section **다음**에 둘째 Section 추가. 기존 `.task`·`.onChange` 수정자는 List에 그대로 남긴다.

```swift
    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section {
                    // …기존 컨트롤·상태 행 전부 불변…
                } header: {
                    // …기존 헤더 불변…
                }
                // M1 부근 재구성 — 앵커는 **목적지** 좌표다(실시간 안내는 실좌표를
                // 쓰지만 이 기능은 "도착지 부근이 어떤 모습인가"를 묻는다, spec §5).
                // 컨트롤·상태 행 뒤 별도 Section: 결과가 펼쳐져도 중지 버튼~상태 행
                // 묶음이 밀리지 않는다(걷는 중 탐색 비용, 웹 DistanceBeacon 말미 배치 미러).
                if let dest = model.dest {
                    Section {
                        SurroundingsSceneSection(
                            anchor: (lat: dest.lat, lng: dest.lng), proxy: proxy)
                    }
                }
            }
            .task { await landStopFocus() }
            .onChange(of: model.offRoute) { _, isOff in
                guard !isOff, reroutePressed else { return }
                reroutePressed = false
                Task { await landStopFocus() }
            }
        }
    }
```

- [ ] **Step 3: 빌드 확인**

Expected: BUILD SUCCEEDED.

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(guide-ios): 추적 시트에 부근 재구성 섹션 — 목적지 앵커, dest 읽기 노출" -- \
  ios/Gildongmu/Directions/BeaconModel.swift \
  ios/Gildongmu/Directions/BeaconTrackingSheet.swift
git show HEAD --stat
```

---

### Task 6: 시뮬레이터 실호출 검증 (머지 게이트)

외부 API 통합은 실호출이 머지 게이트다. 시뮬레이터 Debug 빌드는 prod(`https://gildongmu.vercel.app`)를 부르므로 이 실행이 곧 실호출이다. `xcodebuildmcp-cli` 스킬을 로드해 명령 형식을 따른다.

- [ ] **Step 1: 시뮬레이터 위치를 게이트 좌표로 고정하고 실행**

```bash
# xcodebuildmcp simulator build-and-run … (스킬 문서의 정확한 형식 사용)
xcrun simctl location <UDID> set 37.5301,127.1237   # 강동구청(entrance 프레임)
```

- [ ] **Step 2: WhereAmI 경로 실측** — `ui-automation snapshot-ui`로:
  1. 내 주변 탭 → "내 위치 확인" 진입 → 정위 로드 완료
  2. "주변 확인" 버튼 존재 확인 → tap
  3. 스냅샷에서 확인: "주변 상황" 헤딩, 위치 확인 문장 행, 묶음 제목(예: "맞은편 N곳") 헤딩, 항목 행("62m …" 형식 단일 라벨), "더 보기" 버튼(10건 초과 묶음), "출처: 카카오맵" 행
  4. "더 보기" tap → 항목 행 증가 확인
  5. "닫기" tap → 결과 접힘 + 트리거 라벨 "주변 확인" 복귀 확인

Expected: 항목 행이 **단일 접근성 객체**(거리·이름·길 단서가 한 라벨). 분절이 보이면 itemLine 조립 확인. ⚠ 스냅샷은 원시 AX 트리라 VO 낭독 1:1이 아니다 — 라벨 회귀 신호로만 쓰고 "한 줄=한 객체" 정본 판정은 실기기 VO(위원장 판정 대기에 병기).

- [ ] **Step 3: BeaconTrackingSheet 경로** — 시뮬레이터에서 실시간 안내 세션 기동은 위치 시뮬레이션 제약이 크다. 빌드에 포함됐고 동일 섹션 컴포넌트이므로 **화면 실측은 실기기 판정으로 이월**(Task 8 배포 후 위원장 실사용 — M1 판정 ①의 일부). 여기서는 dest 노출·조건부 마운트가 컴파일로 검증된 것까지만 확인.

- [ ] **Step 4: Kit 전체 테스트 최종 회귀**

Run: `cd ios/GildongmuKit && swift test 2>&1 | tail -3`
Expected: 전체 PASS.

---

### Task 7: 리뷰 게이트 → push

- [ ] **Step 1: 산출물 동결** — 현재 HEAD SHA 기록(`git rev-parse HEAD`), 착수 전 SHA(플랜 시작 시점 main)와의 diff 범위 확정.

- [ ] **Step 2: code-reviewer 서브에이전트 디스패치** — 요구사항(이 플랜 + spec `2026-08-09-arrival-surroundings-design.md` §2·§6·§7)과 산출물(diff 범위)만 넘긴다. 세션 히스토리·생성 의도 전달 금지. 중점 지시 없음.

- [ ] **Step 3: 지적 처리** — 즉시 지엽 패치 금지, 계층 대조 후 수용/기각(기각 근거 기록). 수정 시 해당 태스크의 테스트·빌드 재실행.

- [ ] **Step 4: push** (자동 배포는 웹 — 이번 변경에 웹 코드 없음, docs·ios만)

```bash
git push origin main
```

---

### Task 8: 문서 분배 + 실기기 배포 조정

- [ ] **Step 1: 문서 분배** (마일스톤을 닫는 마지막 단계)
  - `CHANGELOG.md`: 날짜 항목 2~4줄 + spec 링크 (iOS 이식 완료 — Kit 엔드포인트·임베드 섹션·진입점 2곳).
  - `docs/BACKLOG.md` §H M1: 상태 줄 갱신 — "웹 + 계산 코어 구현 완료" → "웹 + iOS 구현 완료", 남은 판정에서 ③ iOS 이식 제거, ② 실기기 VO에 iOS 항목(묶음 제목 점프·한 줄 비분절·시트 임베드) 명시. 착수 노트는 소비됐으므로 CHANGELOG로 보낸다.
  - `PROGRESS.md`: 상태 한 줄 갱신(해당 절 있으면).
  - 커밋(pathspec) 후 push.

- [ ] **Step 2: 실기기 배포 조정** — ⚠ 위원장 지시(2026-08-10): 배포 전 병렬 세션과 실험판 덮어쓰기 조정 필수. 순서:
  1. `ListAgents`로 이 머신의 다른 활성 세션 확인.
  2. **병렬 세션이 있으면**: 배포 직전 알림(같은 실험판 앱 덮어쓰기 방지 — 메모리 `parallel-sessions-device-deploy-coordination`) 후 진행 여부 확인.
  3. **단일 세션이면**: 기존 자동 배포 그대로 진행.
  4. 배포는 실험판(비콘 시트 진입점이 실시간 안내 = `EXPERIMENTAL` 게이트 안에 있다):
     `CONFIGURATION=Experimental ./ios/deploy-device.sh`
  5. 기기 미연결이면 배포 생략을 명시 보고.

---

## Self-Review 결과 (플랜 작성 시 수행)

- **Spec coverage**: 판정 3(위치 문장 먼저)·5(출처 고지)·6(거리순 — 서버 정렬 소비)·9·10(묶음 제목 heading + 더 보기)·§7 3-state(empty/error/refreshFailed 분리, compass 폴백은 서버 몫) 전부 태스크에 매핑. 헌장 §4(한 줄 조립)·§5(포커스 채널) 반영. **의도적 제외**: 웹 §6 하단 업종 통계·버스정류소·음향신호기 문장은 웹에도 미구현(BACKLOG 남은 판정 ④) — 이식 대상 아님.
- **Type consistency**: `SurroundingsScene`·`NearbyCoord`·`sceneItemRowID` 시그니처가 Task 1↔3↔4↔5에서 일치함을 확인.
- **알려진 트레이드오프**(리뷰어 참고): ⓐ 재조회가 0건이 되는 경로는 core 계약 #11에 따라 직전 데이터 유지+`refreshFailed` 표식(웹은 empty 전환) — 고정 앵커에서 실질 도달 불가하고 코어 재구현 금지 규칙이 우선. ⓑ `landAfterLoad`는 scrollTo 없는 축약 착지 — 대상이 트리거 인접 행이라는 전제이고, 실기기에서 실패하면 `ChatFocusDiag` 로그로 확정 후 보강(가설 패치 금지).
