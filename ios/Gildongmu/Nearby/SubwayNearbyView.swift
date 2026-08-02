import SwiftUI
import Observation
import GildongmuKit

/// 최근접 역 낭독 라벨 — 역명(현재 언어)과 노선을 한 텍스트로 합친다.
/// 모델 init의 통지 클로저와 뷰 오버레이가 **같은 문구**를 써야 해서 파일 레벨에 둔다
/// (한쪽만 고치면 들은 것과 보이는 것이 갈린다).
private func nearestLabel(_ station: NearestSubwayStation) -> String {
    let nameEn = station.nameEn ?? ""
    let name = AppLanguage.dataLocale == "en" && !nameEn.isEmpty ? nameEn : station.stationName
    return joinText(name, station.lines.joined(separator: ", "))
}

/// 내 주변 지하철 도착 — NearbyLoadCore 껍데기(규범 원형). 상태 머신·전이표는 Kit 정본.
/// anchor: nil = 현재 위치(내 주변 허브), 좌표 = 그 좌표 고정(장소 상세 "이 장소 주변").
@Observable @MainActor
final class SubwayNearbyModel {
    private let core: NearbyLoadCore<SubwayNearbyResult>
    var phase: NearbyLoadPhase<SubwayNearbyResult> { core.phase }

    init(anchor: PlaceAnchor? = nil) {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: anchor.map { .fixed($0.coord) } ?? LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current·fixed 소스는 좌표 보장") }
                return try await service.subwayArrivals(lat: coord.lat, lng: coord.lng)
            },
            onEvent: nearbyAnnouncer(loaded: { result in
                // 0건이면 최근접 역 거리를 통지에 실어 "1km 안에 없다"와 "이 지역엔
                // 도시철도가 없다"를 가른다(웹 emptyNearest 미러).
                if result.stations.isEmpty, let nearest = result.nearest {
                    return appLocalized("ios.nearby.subwayEmptyNearest",
                                        nearestLabel(nearest), formatDistance(nearest.distanceMeters))
                }
                return nearbyLoadedMessage(count: result.stations.count,
                                           unit: appLocalized("ios.nearby.unitStation"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }
}

struct SubwayNearbyView: View {
    private let anchor: PlaceAnchor?
    @State private var model: SubwayNearbyModel
    /// 항목 정체성 옵셔널 바인딩 — `Bool`을 여러 행에 붙이면 첫 행 외 전부가
    /// `false`가 되어 초기 상태에서 나머지 행이 포커스를 주장한다(실기기 확정).
    @AccessibilityFocusState private var focusedStation: String?
    @State private var lander = NearbyFocusLander()

    /// anchor 기본값 nil = 현재 위치(내 주변 허브 호출처 무변경).
    /// State(initialValue:) 인자는 순수 생성만(부수효과 금지) — [[swiftui-state-initialvalue-side-effect]]
    init(anchor: PlaceAnchor? = nil) {
        self.anchor = anchor
        _model = State(initialValue: SubwayNearbyModel(anchor: anchor))
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if case .loaded(let result) = model.phase {
                    // 역명이 정체성이자 포커스 키다. 근접역 조회가 `dedupeByName`으로
                    // 같은 이름을 하나만 남기므로(`subway-nearby.ts`) 이 목록 안에서는
                    // 중복이 생기지 않는다 — 버스가 nodeId를 쓰는 것과 조건이 다르다.
                    ForEach(result.stations, id: \.stationName) { station in
                        Section {
                            // 역명만 heading(웹 h4 규칙). 노선·거리는 같은 줄에 흡수.
                            // 역명은 현재 언어 하나만(웹 `isEn ? nameEn || stationName` 미러) —
                            // 병기는 lang 경계를 만들어 분절되므로 쓰지 않는다. 노선명은
                            // 외부 데이터가 한국어뿐이라 en에서도 그대로 둔다.
                            distanceText(joinText(displayStationName(station), station.lines.joined(separator: ", "), formatDistance(station.distanceMeters)))
                                .accessibilityAddTraits(.isHeader)
                                // 첫 로드 착지 대상. 키는 ForEach 정체성과 같은 값이어야 한다.
                                .accessibilityFocused($focusedStation, equals: station.stationName)
                            // 4-state를 뭉개지 않는다(웹 미러): 조회 실패 / 운행 시간 밖 /
                            // 실시간 미제공 / 정상. closed인데 첫차가 없으면 판정 근거가
                            // 반쪽이라 "운행이 끝났다"고 말하지 않고 미제공으로 물러선다.
                            if station.arrivalStatus == "unavailable" {
                                Text(appLocalized("ios.nearby.arrivalUnavailable"))   // 조회 실패 ≠ 열차 없음
                            } else if station.arrivalStatus == "closed", let first = station.firstTime {
                                Text(appLocalized("ios.nearby.subwayClosed", first))
                            } else if station.arrivalStatus == "closed" || station.arrivalStatus == "unknown" {
                                Text(appLocalized("ios.nearby.subwayNoRealtime"))
                            } else if station.arrivals.isEmpty {
                                Text(appLocalized("ios.station.noArrivals"))
                            } else {
                                ForEach(Array(station.arrivals.enumerated()), id: \.offset) { _, arrival in
                                    // 완성 문장 정본 message 그대로. 급행은 텍스트로 흡수.
                                    Text(joinText(arrival.line, arrival.express ? appLocalized("subwayArrival.express") : nil, arrival.trainLineNm, arrival.message))
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle(nearbyTitle(appLocalized("ios.nearby.subway"), anchor: anchor))
            .nearbyStateOverlay {
                NearbyStateOverlayView(
                phase: model.phase,
                onPreciseGranted: { Task { await model.load(force: true) } },
                descriptor: .list(
                    empty: NearbyOverlayCopy(emptyTitle, systemImage: "tram"),
                    isEmpty: { $0.stations.isEmpty }))
            }
            .task { await model.load() }
            .nearbyRefreshable { await model.load(force: true) }
            .nearbyFocusOnLoad(
                id: firstStationName, lander: lander, proxy: proxy,
                current: { focusedStation },
                apply: { focusedStation = $0 })
        }
    }

    /// 첫 역명 — nil→값 전이가 곧 "로드 완료"다(0건·실패는 nil로 남는다).
    private var firstStationName: String? {
        guard case .loaded(let result) = model.phase else { return nil }
        return result.stations.first?.stationName
    }

    /// 0건 오버레이 제목 — 최근접 역이 있으면 거리를 함께 알린다(통지와 같은 문구).
    private var emptyTitle: String {
        guard case .loaded(let result) = model.phase, let nearest = result.nearest else {
            return appLocalized("ios.nearby.subwayEmpty")
        }
        return appLocalized("ios.nearby.subwayEmptyNearest",
                            nearestLabel(nearest), formatDistance(nearest.distanceMeters))
    }

    /// 표시 역명 — en 계열 로케일은 seed 영문명, 없으면 한국어 원명으로 폴백.
    private func displayStationName(_ station: NearbySubwayStation) -> String {
        guard AppLanguage.dataLocale == "en", let nameEn = station.nameEn, !nameEn.isEmpty else {
            return station.stationName
        }
        return nameEn
    }
}
