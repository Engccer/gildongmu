import SwiftUI
import Observation
import GildongmuKit

/// 내 주변 지하철 도착 — NearbyLoadCore 껍데기(규범 원형). 상태 머신·전이표는 Kit 정본.
/// anchor: nil = 현재 위치(내 주변 허브), 좌표 = 그 좌표 고정(장소 상세 "이 장소 주변").
@Observable @MainActor
final class SubwayNearbyModel {
    private let core: NearbyLoadCore<[NearbySubwayStation]>
    var phase: NearbyLoadPhase<[NearbySubwayStation]> { core.phase }

    init(anchor: PlaceAnchor? = nil) {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: anchor.map { .fixed($0.coord) } ?? LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current·fixed 소스는 좌표 보장") }
                return try await service.subwayArrivals(lat: coord.lat, lng: coord.lng)
            },
            onEvent: nearbyAnnouncer(loaded: { stations in
                nearbyLoadedMessage(count: stations.count, unit: appLocalized("ios.nearby.unitStation"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }
}

struct SubwayNearbyView: View {
    private let anchor: PlaceAnchor?
    @State private var model: SubwayNearbyModel

    /// anchor 기본값 nil = 현재 위치(내 주변 허브 호출처 무변경).
    /// State(initialValue:) 인자는 순수 생성만(부수효과 금지) — [[swiftui-state-initialvalue-side-effect]]
    init(anchor: PlaceAnchor? = nil) {
        self.anchor = anchor
        _model = State(initialValue: SubwayNearbyModel(anchor: anchor))
    }

    var body: some View {
        List {
            if case .loaded(let stations) = model.phase {
                ForEach(stations, id: \.stationName) { station in
                    Section {
                        // 역명만 heading(웹 h4 규칙). 노선·거리는 같은 줄에 흡수.
                        // 역명은 현재 언어 하나만(웹 `isEn ? nameEn || stationName` 미러) —
                        // 병기는 lang 경계를 만들어 분절되므로 쓰지 않는다. 노선명은
                        // 외부 데이터가 한국어뿐이라 en에서도 그대로 둔다.
                        Text(joinText(displayStationName(station), station.lines.joined(separator: ", "), "\(station.distanceMeters)m"))
                            .accessibilityAddTraits(.isHeader)
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
            NearbyStateOverlayView(phase: model.phase, descriptor: .list(
                empty: NearbyOverlayCopy(appLocalized("ios.nearby.subwayEmpty"), systemImage: "tram"),
                isEmpty: \.isEmpty))
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }

    /// 표시 역명 — en 계열 로케일은 seed 영문명, 없으면 한국어 원명으로 폴백.
    private func displayStationName(_ station: NearbySubwayStation) -> String {
        guard AppLanguage.dataLocale == "en", let nameEn = station.nameEn, !nameEn.isEmpty else {
            return station.stationName
        }
        return nameEn
    }
}
