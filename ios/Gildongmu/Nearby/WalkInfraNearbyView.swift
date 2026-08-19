import SwiftUI
import Observation
import GildongmuKit

/// 보행 인프라 결과와 조회 시각을 한 커밋으로 묶는 payload.
struct WalkInfraPayload: Sendable {
    let walk: WalkInfrastructure
    let asOf: String
}

/// 내 주변 보행 인프라(음향신호기+OSM 횡단보도·점자블록, 웹 WalkInfraNearby 미러).
/// 게이트 없음(음향신호기=무인증 seed, OSM=무키)이라 허브에 항상 노출한다.
/// 두 소스는 독립 강등(WalkSourceStatus) — 그룹 섹션 3개 헤더는 항상 렌더해
/// 헤딩 내비로 어느 그룹에 먼저 도달해도 그 자리에서 상태를 알 수 있다(웹 h4 계약).
/// 항목은 이름 없는 인프라 점이라 heading 미부여, joinText 한 줄=한 객체.
/// NearbyLoadCore 껍데기이되 `coverage: .none`이 의도 계약 — 라우트에 커버리지 마커가
/// 없고 두 소스가 각자 unsupported로 강등되므로 한국 밖에서도 조회해 소스별 미제공
/// 문구를 낸다(웹 coverage:"none" 동형, .korea로 "정리" 금지 — 그러면 소스별 구분이
/// 사라지고 화면 전체가 커버리지 밖 한 문구로 뭉개진다).
@Observable @MainActor
final class WalkInfraModel {
    private let core: NearbyLoadCore<WalkInfraPayload>
    var phase: NearbyLoadPhase<WalkInfraPayload> { core.phase }

    init() {
        let service = WalkInfraService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .none,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                let walk = try await service.nearby(lat: coord.lat, lng: coord.lng)
                return WalkInfraPayload(walk: walk, asOf: Self.timeFormatter.string(from: Date()))
            },
            onEvent: nearbyAnnouncer(loaded: { walkInfraLiveSummary($0.walk) }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
}

/// 완료 통지 문구 = 소스별 요약 결합(웹 buildLive 미러): ok 소스의 수치만 낭독,
/// error·unsupported는 실패·미제공 문구로("0기" 합성 금지).
@MainActor
func walkInfraLiveSummary(_ walk: WalkInfrastructure) -> String {
    let audio: String
    switch walk.audioSignals {
    case .ok(let data):
        audio = data.deviceCount > 0
            ? appLocalized("walkInfra.audioSummary", String(data.deviceCount))
            : appLocalized("walkInfra.audioNone")
    case .unsupported: audio = appLocalized("walkInfra.audioUnsupported")
    case .error: audio = appLocalized("walkInfra.audioError")
    }
    let osm: String
    switch walk.osm {
    case .ok(let data):
        osm = data.listedCount > 0
            ? appLocalized("walkInfra.osmSummary", String(data.listedCount))
            : appLocalized("walkInfra.osmEmpty")
    case .unsupported: osm = appLocalized("walkInfra.osmUnsupported")
    case .error: osm = appLocalized("walkInfra.osmError")
    }
    return joinText(audio, osm)
}

struct WalkInfraNearbyView: View {
    @State private var model = WalkInfraModel()
    /// 착지 대상은 조회 시각 헤딩(이 화면의 첫 요소이자 유일한 헤딩).
    @AccessibilityFocusState private var focusedTop: String?
    @State private var lander = NearbyFocusLander()

    /// nil→값 전이가 곧 "로드 완료"다(실패는 nil 유지, 이동 없음).
    private var topID: String? {
        guard case .loaded = model.phase else { return nil }
        return "walkinfra-top"
    }

    var body: some View {
        ScrollViewReader { proxy in
        List {
            if case .loaded(let payload) = model.phase {
                // 조회 시각 헤딩(웹 패널 h3 미러, WhereAmIView asOf 동형). 웹 h3의
                // "ready" 접두문은 navigationTitle과 중복이라 의도적 생략(미니멀리즘).
                Section {
                    Text(appLocalized("walkInfra.asOf", payload.asOf))
                        .accessibilityAddTraits(.isHeader)
                        .id("walkinfra-top")
                        .accessibilityFocused($focusedTop, equals: "walkinfra-top")
                }
                audioSection(payload.walk.audioSignals)
                crossingSection(payload.walk.osm)
                tactileSection(payload.walk.osm)
                footnoteSection(payload.walk)
            }
        }
        .nearbyFocusOnLoad(
            id: topID, lander: lander, proxy: proxy,
            current: { focusedTop },
            apply: { focusedTop = $0 })
        }
        .navigationTitle(appLocalized("walkInfra.button"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(
                phase: model.phase,
                onPreciseGranted: { Task { await model.load(force: true) } },
                descriptor: .plain(
                loadingText: appLocalized("walkInfra.loading"),
                // ⚠ 위치 실패 아이콘이 다른 도메인(wifi.exclamationmark)과 다르다 — 현행 그대로.
                failedLocation: NearbyOverlayCopy(appLocalized("ios.common.failedTitle"),
                                                  systemImage: "location.slash"),
                failedServer: NearbyOverlayCopy(appLocalized("walkInfra.error"),
                                                systemImage: "wifi.exclamationmark")))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }

    // MARK: - 그룹 섹션(웹 h4 3개 동형 — 상태와 무관하게 항상 렌더)

    @ViewBuilder private func audioSection(_ status: WalkSourceStatus<NearbyAudioSignals>) -> some View {
        Section {
            switch status {
            case .ok(let data):
                if data.deviceCount > 0 {
                    // deviceCount는 sites(최대 5) 절단 전 총수 — 요약이 절단을 정직 표기
                    distanceText(appLocalized("walkInfra.audioSummary", String(data.deviceCount)))
                    ForEach(Array(data.sites.enumerated()), id: \.offset) { _, site in
                        distanceText(audioSiteText(site))
                    }
                } else {
                    distanceText(appLocalized("walkInfra.audioNone"))
                }
            case .unsupported:
                Text(appLocalized("walkInfra.audioUnsupported"))
            case .error:
                Text(appLocalized("walkInfra.audioError"))
            }
        } header: {
            Text(appLocalized("walkInfra.groupAudio")).accessibilityAddTraits(.isHeader)
        }
    }

    @ViewBuilder private func crossingSection(_ status: WalkSourceStatus<OsmWalkData>) -> some View {
        Section {
            switch status {
            case .ok(let data):
                if data.crossings.isEmpty {
                    Text(appLocalized("walkInfra.crossingEmpty"))
                } else {
                    ForEach(data.crossings, id: \.osmId) { feature in
                        distanceText(joinText(
                            itemLocationText(feature),
                            feature.crossingSignal == "yes" ? appLocalized("walkInfra.hasSignal") : nil,
                            feature.tactilePaving ? appLocalized("walkInfra.hasTactile") : nil))
                    }
                }
            case .unsupported:
                Text(appLocalized("walkInfra.crossingUnsupported"))
            case .error:
                Text(appLocalized("walkInfra.crossingError"))
            }
        } header: {
            Text(crossingHeader(status)).accessibilityAddTraits(.isHeader)
        }
    }

    @ViewBuilder private func tactileSection(_ status: WalkSourceStatus<OsmWalkData>) -> some View {
        Section {
            switch status {
            case .ok(let data):
                if data.tactiles.isEmpty {
                    Text(appLocalized("walkInfra.tactileEmpty"))
                } else {
                    ForEach(data.tactiles, id: \.osmId) { feature in
                        distanceText(joinText(
                            itemLocationText(feature),
                            feature.hostFeature == "busStop" ? appLocalized("walkInfra.hostBusStop") : nil,
                            feature.hostFeature == "subwayEntrance" ? appLocalized("walkInfra.hostSubwayEntrance") : nil))
                    }
                }
            case .unsupported:
                Text(appLocalized("walkInfra.tactileUnsupported"))
            case .error:
                Text(appLocalized("walkInfra.tactileError"))
            }
        } header: {
            Text(tactileHeader(status)).accessibilityAddTraits(.isHeader)
        }
    }

    /// 출처는 실제로 데이터를 보여준 소스만 인용(성공한 소스만, 웹 showFootnote 동형).
    @ViewBuilder private func footnoteSection(_ walk: WalkInfrastructure) -> some View {
        let audioOk: NearbyAudioSignals? = { if case .ok(let d) = walk.audioSignals { return d }; return nil }()
        let osmOk = { if case .ok = walk.osm { return true }; return false }()
        if audioOk != nil || osmOk {
            Section {
                Text(appLocalized("walkInfra.footnote"))
                Text(joinText(
                    osmOk ? appLocalized("walkInfra.sourceOsm") : nil,
                    audioOk.map { appLocalized("walkInfra.sourceAudio", $0.baseDate) }))
            }
        }
    }

    // MARK: - 문구 조립(웹 문구 계약 미러)

    /// "N곳 중 가까운 M곳"은 cap 전 실개수 기반(절단 침묵 금지, 웹 그룹 헤더 동형).
    private func crossingHeader(_ status: WalkSourceStatus<OsmWalkData>) -> String {
        if case .ok(let data) = status, data.crossingTotal > 0 {
            let listed = data.crossings.count
            return data.crossingTotal > listed
                ? appLocalized("walkInfra.groupCrossingTruncated", String(data.crossingTotal), String(listed))
                : appLocalized("walkInfra.groupCrossingCount", String(data.crossingTotal))
        }
        return appLocalized("walkInfra.groupCrossing")
    }

    private func tactileHeader(_ status: WalkSourceStatus<OsmWalkData>) -> String {
        if case .ok(let data) = status, data.tactileTotal > 0 {
            let listed = data.tactiles.count
            return data.tactileTotal > listed
                ? appLocalized("walkInfra.groupTactileTruncated", String(data.tactileTotal), String(listed))
                : appLocalized("walkInfra.groupTactileCount", String(data.tactileTotal))
        }
        return appLocalized("walkInfra.groupTactile")
    }

    private func audioSiteText(_ site: AudioSignalSite) -> String {
        let distance = formatDistance(site.distanceMeters)
        guard let direction = bearingKorean(site.bearing) else {
            // 미지 방위(계약상 도달 희박): 빈 방위를 채우면 선행 공백·쉼표가 남는다 —
            // 포맷 결과에서 잔여 구분자를 걷어내 문구를 깨끗하게(itemLocationText 동형 처리).
            return appLocalized("walkInfra.audioSite", "", distance, String(site.deviceCount))
                .trimmingCharacters(in: CharacterSet(charactersIn: " ,"))
        }
        return appLocalized("walkInfra.audioSite", direction, distance, String(site.deviceCount))
    }

    private func itemLocationText(_ feature: WalkFeature) -> String {
        let distance = formatDistance(feature.distanceMeters)
        guard let direction = bearingKorean(feature.bearing) else { return distance }
        return appLocalized("walkInfra.itemLocation", direction, distance)
    }

    /// 소문자 8방위 → 한글(웹 surroundingsNearby.direction.* 재사용, 신규 중복 정의 금지).
    /// 미지 값은 방위 조각 생략(AroundNearbyView 관례). 린터가 리터럴 키만 인식하므로
    /// 동적 키 조립 금지.
    private func bearingKorean(_ bearing: String) -> String? {
        switch bearing {
        case "n": appLocalized("surroundingsNearby.direction.n")
        case "ne": appLocalized("surroundingsNearby.direction.ne")
        case "e": appLocalized("surroundingsNearby.direction.e")
        case "se": appLocalized("surroundingsNearby.direction.se")
        case "s": appLocalized("surroundingsNearby.direction.s")
        case "sw": appLocalized("surroundingsNearby.direction.sw")
        case "w": appLocalized("surroundingsNearby.direction.w")
        case "nw": appLocalized("surroundingsNearby.direction.nw")
        default: nil
        }
    }
}
