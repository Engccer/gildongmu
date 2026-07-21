import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 출발 전 미리 듣기 텍스트 브리핑(자동차·대중교통). 실주행은 딥링크 위임 유지(브리핑은 보완재).
/// 출발지 불변식: origin은 LocationService 좌표만, 장소 좌표는 dest에만 쓴다(웹 장소 앵커 불변식).
/// guidance·노선명·정류장명은 provider 한국어 원문이 낭독 정본, 행은 joinText 단일 텍스트.

/// 브리핑 공통 상태(NearbyLoadState 유사, payload가 목록이 아닌 단건이라 별도 정의)
enum RouteLoadState<Payload> {
    case idle, loading
    case loaded(Payload)
    case denied              // 위치 권한 거부
    case failed              // 조회 실패
    /// 경로 없음(3-state: 조회 실패 아님, ODsay `{result:null}` graceful). car는 도달하지
    /// 않는다(브리핑 직접 응답이라 "경로 없음" 상태가 없다, Kit classify(car:) 동형).
    case empty
}

/// 상태 오버레이 공통(거부·실패 문장은 M2 공통, 실패 제목만 경로 전용)
@MainActor @ViewBuilder
private func routeStateOverlay<Payload>(_ state: RouteLoadState<Payload>) -> some View {
    switch state {
    case .loading: ProgressView(appLocalized("ios.common.checking"))
    case .denied:
        ContentUnavailableView(appLocalized("ios.common.geoDeniedTitle"), systemImage: "location.slash",
            description: Text(appLocalized("ios.common.geoDeniedDesc")))
    case .failed:
        ContentUnavailableView(appLocalized("ios.route.failedTitle"), systemImage: "wifi.exclamationmark",
            description: Text(appLocalized("ios.common.retryLater")))
    case .empty:
        ContentUnavailableView(appLocalized("route.transit.noRoute"), systemImage: "arrow.triangle.swap")
    default: EmptyView()
    }
}

/// 요금 천 단위 구분(예 22600 → "22,600")
private func wonText(_ amount: Int) -> String {
    amount.formatted(.number.grouping(.automatic))
}

// MARK: - 결과 행 (브리핑 단독 화면·길찾기 탭 공용)

/// 자동차 결과 행들(요약 1행+턴바이턴). summaryAsHeader: 단독 브리핑 화면은 요약이
/// 유일한 발견 경로라 heading trait, 길찾기 탭은 수단 heading이 따로 있어 평문(과잉 방지).
struct CarRouteRows: View {
    let briefing: CarRouteBriefing
    var summaryAsHeader = false

    var body: some View {
        // 통행료 0원은 생략(잉여)
        Text(joinText(
            appLocalized("ios.route.totalDistance", String(format: "%.1f", Double(briefing.distanceMeters) / 1000)),
            appLocalized("ios.route.durationMinutes", String(briefing.durationSeconds / 60)),
            appLocalized("ios.route.taxiFare", wonText(briefing.taxiFare)),
            briefing.tollFare > 0 ? appLocalized("ios.route.tollFare", wonText(briefing.tollFare)) : nil))
            .accessibilityAddTraits(summaryAsHeader ? .isHeader : [])
        ForEach(Array(briefing.guides.enumerated()), id: \.offset) { _, guide in
            // guidance(완성 안내문)가 정본, 비면 name 폴백, 둘 다 비면 행 생략
            let text = guide.guidance.isEmpty ? guide.name : guide.guidance
            if !text.isEmpty {
                Text(joinText(text, "\(guide.distanceMeters)m"))
            }
        }
    }
}

/// 대중교통 결과 행들(요약 1행+구간들). 소비 화면이 heading·섹션을 소유한다.
struct TransitRouteRows: View {
    let route: TransitRoute

    var body: some View {
        Text(transitSummaryText(route.summary))
        ForEach(Array(route.legs.enumerated()), id: \.offset) { _, leg in
            Text(transitLegText(leg))
        }
    }
}

func transitSummaryText(_ summary: TransitRouteSummary) -> String {
    joinText(
        appLocalized("ios.route.durationMinutes", String(summary.totalMinutes)),
        appLocalized("ios.route.fare", wonText(summary.fare)),
        appLocalized("ios.route.transfers", String(summary.transfers)),
        appLocalized("ios.route.walkMinutes", String(summary.walkMinutes)))
}

/// 구간 한 줄 = 한 접근성 객체. walk leg는 노선 정보가 없어 단일 분기(계약 테스트 근거)
func transitLegText(_ leg: TransitRouteLeg) -> String {
    if leg.mode == "walk" {
        return appLocalized("ios.route.walkMinutes", String(leg.minutes))
    }
    let countKey = leg.mode == "bus" ? appLocalized("ios.route.stopCount") : appLocalized("ios.route.stationCount")
    return joinText(
        leg.lineName,
        leg.fromName.map { appLocalized("ios.route.board", $0) },
        leg.toName.map { appLocalized("ios.route.alight", $0) },
        leg.stationCount.map { String(format: countKey, String($0)) },
        appLocalized("ios.route.legMinutes", String(leg.minutes)))
}

/// 도보 결과 행들(요약 1행+step들). 웹 WalkRouteResult 미러: step description
/// 완성 문장이 낭독 정본(turnType 재조합 금지), 빈 문장은 행 생략.
struct WalkRouteRows: View {
    let briefing: WalkRouteBriefing

    var body: some View {
        Text(appLocalized("route.pedestrian.summary",
            String(format: "%.1f", Double(briefing.distanceMeters) / 1000),
            String(Int((Double(briefing.durationSeconds) / 60).rounded()))))
        ForEach(Array(briefing.steps.enumerated()), id: \.offset) { _, step in
            if !step.description.isEmpty {
                Text(step.description)
            }
        }
    }
}

// MARK: - 자동차 경로

@Observable @MainActor
final class CarBriefingModel {
    private(set) var state: RouteLoadState<CarRouteBriefing> = .idle
    private let service = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    /// 재진입 가드(웹 in-flight ref 가드 미러, M2 공통 패턴)
    private var isLoadingInFlight = false

    func load(place: Place) async {
        if isLoadingInFlight { return }
        isLoadingInFlight = true
        defer { isLoadingInFlight = false }
        if case .idle = state { state = .loading }
        do {
            let coord = try await LocationService.shared.currentCoordinate()
            let briefing = try await service.car(
                originLat: coord.lat, originLng: coord.lng,
                destLat: place.lat, destLng: place.lng)
            state = .loaded(briefing)
            // 완료 통지 1회(진행 통지 없음)
            AccessibilityNotification.Announcement(
                appLocalized("ios.route.carReady", String(briefing.durationSeconds / 60))).post()
        } catch let error as LocationService.LocationError {
            if case .denied = error { state = .denied } else { state = .failed }
        } catch {
            state = .failed
        }
    }
}

struct CarBriefingView: View {
    let place: Place
    @State private var model = CarBriefingModel()

    var body: some View {
        List {
            if case .loaded(let briefing) = model.state {
                Section {
                    // 요약 1행이 헤더(발견 경로)
                    CarRouteRows(briefing: briefing, summaryAsHeader: true)
                }
            }
        }
        .navigationTitle(appLocalized("ios.route.carTitle"))
        .overlay { routeStateOverlay(model.state) }
        .task { await model.load(place: place) }
    }
}

// MARK: - 대중교통 경로

@Observable @MainActor
final class TransitBriefingModel {
    private(set) var state: RouteLoadState<TransitRouteResult> = .idle
    private let service = RouteService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    /// 재진입 가드(웹 in-flight ref 가드 미러, M2 공통 패턴)
    private var isLoadingInFlight = false

    func load(place: Place) async {
        if isLoadingInFlight { return }
        isLoadingInFlight = true
        defer { isLoadingInFlight = false }
        if case .idle = state { state = .loading }
        do {
            let coord = try await LocationService.shared.currentCoordinate()
            let result = try await service.transit(
                originLat: coord.lat, originLng: coord.lng,
                destLat: place.lat, destLng: place.lng)
            if let result {
                state = .loaded(result)
                // 완료 통지 1회(진행 통지 없음)
                AccessibilityNotification.Announcement(
                    appLocalized("ios.route.transitReady", String(result.recommended.summary.totalMinutes))).post()
            } else {
                // nil = 경로 없음(3-state, 조회 실패와 다른 문구)
                state = .empty
                AccessibilityNotification.Announcement(appLocalized("route.transit.noRoute")).post()
            }
        } catch let error as LocationService.LocationError {
            if case .denied = error { state = .denied } else { state = .failed }
        } catch {
            state = .failed
        }
    }
}

struct TransitBriefingView: View {
    let place: Place
    @State private var model = TransitBriefingModel()

    var body: some View {
        List {
            if case .loaded(let result) = model.state {
                Section {
                    TransitRouteRows(route: result.recommended)
                } header: {
                    Text(appLocalized("ios.route.recommended")).accessibilityAddTraits(.isHeader)
                }
                // 대안은 요약 1행씩만(legs 미표시, 미니멀). 없으면 섹션 미노출
                if !result.alternatives.isEmpty {
                    Section {
                        ForEach(Array(result.alternatives.enumerated()), id: \.offset) { _, route in
                            Text(transitSummaryText(route.summary))
                        }
                    } header: {
                        Text(appLocalized("ios.route.alternatives")).accessibilityAddTraits(.isHeader)
                    }
                }
            }
        }
        .navigationTitle(appLocalized("ios.route.transitTitle"))
        .overlay { routeStateOverlay(model.state) }
        .task { await model.load(place: place) }
    }
}
