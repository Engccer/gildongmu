import SwiftUI
import Observation
import GildongmuKit

/// 내 주변 따릉이 대여소 — NearbyLoadCore 껍데기(SubwayNearbyModel 규범 패턴 미러).
/// 정수 필드라 "0대"와 "정보 없음"의 구조적 혼동 없음.
/// anchor: nil = 현재 위치(내 주변 허브), 좌표 = 그 좌표 고정(장소 상세 "이 장소 주변").
/// ⚠ 따릉이는 서울 전용이라 지방 좌표는 0건이 아니라 `.unavailableHere`로 전이된다
/// (서버가 upstream 호출 전에 마커로 응답 — 조회 실패와도 다른 상태다).
@Observable @MainActor
final class BikeNearbyModel {
    private let core: NearbyLoadCore<[BikeStation]>
    var phase: NearbyLoadPhase<[BikeStation]> { core.phase }

    init(anchor: PlaceAnchor? = nil) {
        let service = NearbyService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: anchor.map { .fixed($0.coord) } ?? LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, _ in
                guard let coord else { preconditionFailure("current·fixed 소스는 좌표 보장") }
                return try await service.bikeStations(lat: coord.lat, lng: coord.lng)
            },
            onEvent: nearbyAnnouncer(loaded: { stations in
                nearbyLoadedMessage(count: stations.count, unit: appLocalized("ios.nearby.unitBike"))
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }
}

struct BikeNearbyView: View {
    private let anchor: PlaceAnchor?
    @State private var model: BikeNearbyModel
    /// 항목 정체성 옵셔널 바인딩(Bool 다중 부착 금지 — SubwayNearbyView 주석 참고)
    @AccessibilityFocusState private var focusedStation: String?
    @State private var lander = NearbyFocusLander()

    /// anchor 기본값 nil = 현재 위치(내 주변 허브 호출처 무변경).
    init(anchor: PlaceAnchor? = nil) {
        self.anchor = anchor
        _model = State(initialValue: BikeNearbyModel(anchor: anchor))
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if case .loaded(let stations) = model.phase {
                    ForEach(stations, id: \.stationId) { station in
                        // 한 줄 = 한 접근성 객체. 대여소명·거리·대여 가능·거치대를 단일 텍스트로 흡수(heading 없음).
                        Text(joinText(station.name, "\(station.distanceMeters)m",
                                      appLocalized("ios.nearby.bikesAvailable", String(station.bikesAvailable)), appLocalized("ios.nearby.racksTotal", String(station.racksTotal))))
                            // 착지 대상. 이 목록만 heading이 없어(한 줄에 전부 흡수) 첫 행
                            // 자체가 결과의 시작점이다 — heading을 새로 만들지 않는다.
                            .accessibilityFocused($focusedStation, equals: station.stationId)
                    }
                }
            }
            .navigationTitle(nearbyTitle(appLocalized("ios.nearby.bike"), anchor: anchor))
            .nearbyStateOverlay {
                NearbyStateOverlayView(phase: model.phase, descriptor: .list(
                    empty: NearbyOverlayCopy(appLocalized("ios.nearby.bikeEmpty"), systemImage: "bicycle"),
                    isEmpty: \.isEmpty))
            }
            .task { await model.load() }
            .nearbyRefreshable { await model.load(force: true) }
            .nearbyFocusOnLoad(
                id: firstStationID, lander: lander, proxy: proxy,
                landed: { focusedStation == $0 },
                apply: { focusedStation = $0 })
        }
    }

    /// 첫 대여소 ID — nil→값 전이가 곧 "로드 완료"다.
    private var firstStationID: String? {
        guard case .loaded(let stations) = model.phase else { return nil }
        return stations.first?.stationId
    }
}
