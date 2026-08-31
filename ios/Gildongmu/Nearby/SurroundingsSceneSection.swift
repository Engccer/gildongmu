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
/// 묶음별 "더 보기" 창(웹 useRevealMore per-group 미러). 버튼형·자동 펼침 두 모드가 공유한다.
@Observable @MainActor
final class SceneRevealWindows {
    private var windows: [String: RevealWindow] = [:]

    func reset() { windows = [:] }

    func visibleCount(for bucket: String) -> Int {
        windows[bucket]?.visibleCount ?? RevealWindow.initialVisible
    }

    /// "더 보기": 해당 묶음 공개 수를 늘리고 첫 새 항목 행 id를 반환(VO 포커스 대상).
    func revealMore(scene: SurroundingsScene, bucket: String) -> String? {
        guard let group = scene.groups.first(where: { $0.bucket == bucket }) else { return nil }
        var window = windows[bucket] ?? RevealWindow()
        guard let firstNewIndex = window.revealMore(totalCount: group.items.count) else { return nil }
        windows[bucket] = window
        return sceneItemRowID(bucket: bucket, index: firstNewIndex)
    }
}

@Observable @MainActor
final class SurroundingsSceneModel {
    private var core: NearbyLoadCore<SurroundingsScene>!   // 클로저가 self 캡처 — IUO 2단 초기화
    let reveal = SceneRevealWindows()
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
                self?.reveal.reset()
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

    func visibleCount(for bucket: String) -> Int { reveal.visibleCount(for: bucket) }

    /// "더 보기": 해당 묶음 공개 수를 늘리고 첫 새 항목 행 id를 반환(VO 포커스 대상).
    func revealMore(bucket: String) -> String? {
        guard case .loaded(let scene) = phase else { return nil }
        return reveal.revealMore(scene: scene, bucket: bucket)
    }
}

private func sceneItemRowID(bucket: String, index: Int) -> String {
    "scene-item-\(bucket)-\(index)"
}

/// 묶음이 이보다 크면 제목에 곳수를 병기한다(웹 COUNT_IN_TITLE_THRESHOLD 미러 —
/// 스와이프 전 규모 예고).
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
        case .unavailableHere(let reason):
            // 현행 라우트는 이 마커를 안 내지만, 서버가 내기 시작하면 무음 실패가
            // 되지 않도록 기존 문구로 받는다(리뷰 반영 — 3-state 침묵 금지).
            switch reason {
            case .seoulOnly: return appLocalized("ios.common.unavailableHere.seoulOnly")
            case .noBusData: return appLocalized("ios.common.unavailableHere.noBusData")
            }
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
            SurroundingsSceneGroupsView(
                scene: scene, reveal: model.reveal, proxy: proxy, focusedID: $focusedID)
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
        // 가시화 선행(리뷰 반영 — repo 착지 정본 "가시화 → 지연 → 대입"). 트리거
        // 인접 행이라 대개 no-op이지만, 시트처럼 위에 행이 많은 화면에서 대상이
        // 컬링됐을 때의 조용한 실패를 막는다. anchor 미지정(sticky 헤더 잘림 방지).
        proxy.scrollTo(target)
        try? await Task.sleep(for: .milliseconds(400))
        focusedID = target
        try? await Task.sleep(for: .milliseconds(600))
        if focusedID != target { focusedID = target }
    }
}

/// 묶음·항목 문구 조립(버튼형·자동 펼침 공유). 린터 계약(리터럴 키만)이라 switch 나열.
private enum SceneText {
    /// 항목 문구. `name`은 병기 이름의 한 변종(시각 `display` 또는 낭독 `primary`, E28)이다.
    static func itemLine(_ item: SurroundingsSceneItem, name: String) -> String {
        if let road = item.road {
            return appLocalized(
                "surroundings.itemWithRoad",
                formatDistance(item.distanceMeters), name, road)
        }
        return appLocalized(
            "surroundings.item", formatDistance(item.distanceMeters), name)
    }

    /// 한 줄 = 한 접근성 객체. 시각은 `Roman (한글)` 병기, 낭독은 로마자만 + 거리 단위 정정.
    @MainActor
    static func itemRow(_ item: SurroundingsSceneItem) -> some View {
        let name = bilingual(item.name, roman: item.nameRoman)
        return bilingualLine(
            visible: itemLine(item, name: name.display),
            accessible: itemLine(item, name: name.primary))
    }

    static func bucketTitle(_ group: SurroundingsSceneGroup) -> String {
        let name = Self.bucketName(group.bucket)
        guard group.items.count > countInTitleThreshold else { return name }
        return "\(name) \(appLocalized("surroundings.count", group.items.count))"
    }

    /// bucket 값→키 매핑. 린터 계약(리터럴 키만)이라 switch에 12개를 나열한다.
    /// 모르는 값은 원값 노출(키 문자열 노출보다 낫다 — 서버가 값을 늘려도 안 깨진다).
    static func bucketName(_ bucket: String) -> String {
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

}

/// 장면 본문(묶음 헤딩 + 장소 행 + 더 보기 + 출처 각주). 버튼형(`SurroundingsSceneSection`)과
/// 자동 펼침(`SurroundingsSceneAutoSection`)이 공유한다. 각 장소 행은 **장소 상세로 열리는
/// NavigationLink**(M4 판정 ⑤ — 실재성 헤지는 출처 각주가 그대로 맡는다).
struct SurroundingsSceneGroupsView: View {
    let scene: SurroundingsScene
    let reveal: SceneRevealWindows
    let proxy: ScrollViewProxy
    var focusedID: AccessibilityFocusState<String?>.Binding
    /// 버튼형만 true — 자동 펼침은 부모의 위치 문장이 같은 내용을 이미 말한다(중복 낭독 금지).
    var showPlace = true

    var body: some View {
        // 위치 확인 문장 먼저, 그다음 묶음(spec 판정 3).
        if showPlace, let place = scene.place {
            // 위치 문장은 주소라 로마자(주소 규칙)로 병기(E28).
            let name = bilingual(place, roman: scene.placeRoman)
            Text(name.display).accessibilityLabel(Text(name.primary))
        }
        ForEach(scene.groups, id: \.bucket) { group in
            // 묶음 제목이 유일한 발견 경로(spec 판정 10 — 제목 점프로 통째 건너뛰기).
            Text(SceneText.bucketTitle(group))
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            ForEach(
                Array(group.items.prefix(reveal.visibleCount(for: group.bucket)).enumerated()),
                id: \.offset
            ) { index, item in
                // 한 줄 = 한 접근성 객체. 거리 낭독 정정은 distanceText가(m→로케일 단어).
                NavigationLink {
                    PlaceDetailView(place: sceneItemToPlace(item))
                } label: {
                    SceneText.itemRow(item)
                }
                .id(sceneItemRowID(bucket: group.bucket, index: index))
                .accessibilityFocused(
                    focusedID,
                    equals: sceneItemRowID(bucket: group.bucket, index: index))
            }
            if group.items.count > reveal.visibleCount(for: group.bucket) {
                Button(appLocalized("actions.showMore")) {
                    if let id = reveal.revealMore(scene: scene, bucket: group.bucket) {
                        proxy.scrollTo(id, anchor: .top)   // 가시화 후 포커스(Clinic 정본)
                        DispatchQueue.main.async { focusedID.wrappedValue = id }
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

/// M4 자동 펼침 — 데이터는 부모(둘러보기 화면)가 한 커밋으로 주입한다. 트리거·닫기·착지
/// 없음: 조용히 나타나는 섹션이라 **헤딩이 유일한 발견 경로**이고(헌장 §3), 포커스는
/// 부모의 위치 문장 1회 착지가 전부다(늦게 와도 움직이지 않는다 — 한 커밋이라 늦게 올 수도 없다).
struct SurroundingsSceneAutoSection: View {
    /// nil = 조회 실패(failed) 또는 data null. 0건은 total==0으로 온다.
    let scene: SurroundingsScene?
    let failed: Bool
    /// 부모 커밋 식별자 — 바뀌면 "더 보기" 창을 리셋한다(다른 reveal 창이 willCommit에서 리셋되는 관례 동형).
    let commitID: UUID
    let proxy: ScrollViewProxy
    var focusedID: AccessibilityFocusState<String?>.Binding
    @State private var reveal = SceneRevealWindows()

    var body: some View {
        Text(appLocalized("surroundings.ready"))
            .font(.headline)
            .accessibilityAddTraits(.isHeader)
            .onChange(of: commitID) { reveal.reset() }
        if failed || scene == nil {
            Text(appLocalized("surroundings.error"))
        } else if let scene, scene.total == 0 {
            Text(appLocalized("surroundings.empty"))
        } else if let scene {
            SurroundingsSceneGroupsView(
                scene: scene, reveal: reveal, proxy: proxy, focusedID: focusedID, showPlace: false)
        }
    }
}
