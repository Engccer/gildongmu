import SwiftUI
import GildongmuKit

/// 채팅 경로 카드(E83, spec `2026-11-14-e83-chat-route-start-design.md` R3·R6·R7·R8·R10·R12): 한 도착지의 수단별 [안내 시작]과
/// [길찾기에서 열기]. 실험판 봉인 뒤에서만 그린다(대화 화면의 `showsRouteStartCard`).
///
/// 읽기 순서: (답에 도착지가 둘 이상일 때만) 도착지 이름 → 도보 안내 시작 → 자동차 안내 시작 → 대중교통 안내 시작 → 길찾기에서 열기.
/// 줄마다 한 접근성 객체이고 제목·합계·heading은 없다(R12 — 턴 점프는 질문 heading이 맡는다).
/// - 수단 버튼은 그 수단의 안내를 시작할 수 있을 때만 선다(R10, 길찾기 화면의 시작 버튼과 같은 판정). 조건이 안 되면 그 버튼만 빠진다.
/// - 도보·자동차는 측위·신선도 없이 바로 시작한다 — 안내가 시작하며 지금 위치에서 경로를 새로 받는다(R4·R7).
/// - 대중교통은 여정 카드와 같은 순서다: 점유 확인 → 실측위 → 신선도 → 신선하고 수동 위치가 아니면 추천 첫 경로로 시작,
///   아니면 길찾기 탭에서 기기 위치로 다시 조회하고 사유를 한 번 말한다(R6, 자동 시작 없음).
/// - 측위를 기다리는 동안 버튼을 `disabled`로 만들지 않는다 — 포커스가 버튼에 남아야 한다(재진입은 `busy` 가드로 막는다).
struct RouteStartChatCardView: View {
    let group: RouteStartCardGroup
    /// 답에 도착지가 둘 이상이라 카드 첫 줄에 이름을 두는가(R12).
    let showsDestinationName: Bool

    /// 재진입 가드(여정 카드와 같다). 측위 대기 중 재탭은 무시하고, 시각 표식(흐림)만 바꾼다.
    @State private var busy = false
    /// 측위를 기다리는 [대중교통 안내 시작]의 Task. 카드가 화면에서 사라지면 취소해 뒤늦은 시작·탭 전환·재조회를 막는다.
    @State private var startTask: Task<Void, Never>?

    private var destination: GuideDestination {
        GuideDestination(
            dest: BeaconDest(lat: group.dest.lat, lng: group.dest.lng), label: group.destLabel, labelRoman: group.destRoman)
    }

    private var destinationEndpoint: DirectionsEndpoint {
        .place(label: group.destLabel, lat: group.dest.lat, lng: group.dest.lng, labelRoman: group.destRoman)
    }

    /// 자동차 버튼 조건(R10): 길찾기 화면의 자동차 시작 버튼과 같은 판정이다(한국어 데이터 ∧ Tmap 경로).
    private var carStartable: Bool {
        guard let car = group.car else { return false }
        return canStartCarGuide(dataLocale: AppLanguage.dataLocale, provider: car.carProvider)
    }

    /// 대중교통 버튼이 시작할 경로: 길찾기 결과 화면이 맨 위에 펼쳐 두는 경로(같은 목록 함수의 첫 항목)이고, 탑승 구간이 있어야 한다.
    private var transitRoute: TransitRoute? {
        guard let result = group.transit?.transit?.result,
              let route = transitRouteEntries(result).first?.route, transitGuideStartable(route)
        else { return nil }
        return route
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if showsDestinationName {
                let name = bilingualName(lang: AppLanguage.current, ko: group.destLabel, en: nil, roman: group.destRoman)
                bilingualLine(visible: name.display, accessible: name.primary)
            }
            if let walk = group.walk {
                cardButton(appLocalized("beacon.guideStartWalk")) {
                    startNow(.walk(accessible: walk.accessible, waypoint: waypoint(walk)), via: walk.via)
                }
            }
            if carStartable, let car = group.car {
                cardButton(appLocalized("beacon.guideStartCar")) {
                    startNow(.car(waypoint: waypoint(car)), via: car.via)
                }
            }
            if let transit = group.transit?.transit, let route = transitRoute {
                // 측위를 기다리는 동안 라벨이 바뀌는 것이 VoiceOver 신호 하나다(헌장 §5 — 포커스는 버튼에 남고 별도 통지는 없다).
                cardButton(busy ? appLocalized("directions.locating") : appLocalized("beacon.guideStartTransit")) {
                    startTransit(route, transit)
                }
            }
            cardButton(appLocalized("journey.openInDirections")) { openInDirections() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.4)))
        .onDisappear {
            startTask?.cancel()
            startTask = nil
            busy = false
        }
    }

    private func cardButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .frame(minHeight: 44)
            .buttonStyle(.bordered)
            .opacity(busy ? 0.5 : 1)
    }

    private func waypoint(_ payload: RouteStartChatPayload) -> BeaconModel.Waypoint? {
        payload.via.map { BeaconModel.Waypoint(dest: BeaconDest(lat: $0.lat, lng: $0.lng), label: $0.label) }
    }

    private func viaEndpoint(_ via: RouteStartChatPayload.Via?) -> RecentEndpoint? {
        via.map { RecentEndpoint(label: $0.label, lat: $0.lat, lng: $0.lng, labelRoman: nil) }
    }

    /// 카드로 시작한 경로를 최근 경로에 남긴다(여정 카드와 같게: 출발은 현재 위치라 nil 투영).
    private func recordRecentRoute(via: RouteStartChatPayload.Via?) {
        _ = RecentSearchStore().recordRoute(RecentRoute(
            from: nil,
            to: RecentEndpoint(
                label: group.destLabel, lat: group.dest.lat, lng: group.dest.lng, labelRoman: group.destRoman),
            via: viaEndpoint(via), boardStation: nil, alightStation: nil))
    }

    /// 도보·자동차 [안내 시작](R4·R7): 점유를 확인하고 바로 시작한다. 전송이 아니라 AI 동의와 무관하다.
    private func startNow(_ mode: GuideStartMode, via: RouteStartChatPayload.Via?) {
        guard !busy else { return }
        // 다른 안내가 진행 중이면 최근 경로를 남기기 전에 거부한다(길찾기 [안내 시작]이 점유 중에 하는 것과 같은 통지).
        guard !GuideSession.shared.refuseStartIfOccupied() else { return }
        recordRecentRoute(via: via)
        GuideSession.shared.startGuide(to: destination, mode: mode)
    }

    /// [대중교통 안내 시작](R5·R6): 위치를 새로 받아 카드의 출발 좌표·조회 시각과 견준다. 신선하고 수동 위치에서 조회한 카드가 아니면
    /// 카드의 추천 첫 경로로 바로 시작하고, 아니면(낡음·이동·측위 실패·수동 위치) 시작하지 않고 길찾기 탭에서 기기 위치로 다시 조회한다.
    private func startTransit(_ route: TransitRoute, _ transit: RouteStartChatPayload.Transit) {
        guard !busy else { return }
        // 다른 안내가 진행 중이면 측위·재조회 전에 거부한다 — 시작할 수 없는 상황에서 탭 전환·유료 조회가 일어나지 않게.
        guard !GuideSession.shared.refuseStartIfOccupied() else { return }
        busy = true
        startTask = Task { @MainActor in
            defer { busy = false }
            // 실측위 — 수동 위치 스토어를 거치지 않는다(안내는 늘 실좌표에서 시작한다). 실패하면 `noFix`로 다시 조회한다.
            let fix = try? await LocationService.shared.currentCoordinate(force: true)
            // 측위 중 카드가 사라졌으면 아무것도 하지 않는다.
            guard !Task.isCancelled else { return }
            let freshness = journeyCardFreshness(
                origin: transit.origin, queriedAtMs: transit.queriedAt,
                fix: fix.map { RoutePoint(lat: $0.lat, lng: $0.lng) }, nowMs: Date().timeIntervalSince1970 * 1000)
            // 수동 지정 위치에서 조회한 카드는 신선해도 그 결과로 시작하지 않는다(첫 구간부터 실제 위치와 어긋난다).
            guard freshness == .fresh, !transit.manualOrigin else {
                requeryInDirections()
                return
            }
            recordRecentRoute(via: nil)
            GuideSession.shared.startGuide(
                to: destination, mode: .transit(route: route, accessible: group.transit?.accessible ?? false))
        }
    }

    /// [길찾기에서 열기](R8): 길찾기 탭에 도착지와 경유지를 채우고 평소 조회(전 수단)를 돌린다. 착지는 그 화면의 평소 규칙이다.
    private func openInDirections() {
        guard !busy else { return }
        DirectionsPrefillStore.shared.pending = DirectionsPrefill(
            role: .to, endpoint: destinationEndpoint,
            via: group.via.map { .place(label: $0.label, lat: $0.lat, lng: $0.lng) })
    }

    /// 낡은 카드·수동 위치 카드의 [대중교통 안내 시작](R6): 길찾기 탭에서 **기기 위치**로 다시 조회하고 사유를 조회 시작 때 한 번 말한다.
    /// 경유지는 싣지 않는다 — 대중교통은 경유지를 지원하지 않아 실으면 그 수단이 「미지원」으로 떨어진다.
    private func requeryInDirections() {
        DirectionsPrefillStore.shared.pending = DirectionsPrefill(
            role: .to, endpoint: destinationEndpoint,
            realOriginRequeryNotice: appLocalized("journey.cardStaleRequery"))
    }
}
