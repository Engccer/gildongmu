import Foundation

/// 채팅 경로 카드의 [안내 시작] 재료(E83, spec `2026-11-14-e83-chat-route-start-design.md` §4, 웹 `RouteStartRenderPayload` 미러).
/// 도구 호출 하나가 렌더 하나이고, 한 답의 렌더를 `routeStartCardGroups`가 도착지별로 묶어 카드 하나로 그린다(R1).
public enum RouteStartMode: String, Decodable, Sendable, Hashable, CaseIterable {
    /// 선언 순서가 카드의 버튼 순서다(도보 → 자동차 → 대중교통).
    case walk, car, transit
}

public struct RouteStartChatPayload: Decodable, Sendable, Hashable {
    /// 경유지(도보·자동차만, 대중교통은 늘 nil).
    public struct Via: Decodable, Sendable, Hashable {
        public let lat: Double
        public let lng: Double
        public let label: String
    }

    /// 대중교통 조회 결과와 신선도 판정 재료(R5·R6, 여정 카드 D8과 같은 props-driven).
    public struct Transit: Decodable, Sendable, Hashable {
        /// 길찾기 화면이 쓰는 대중교통 조회 결과와 같은 모양.
        public let result: TransitRouteResult
        public let origin: RoutePoint
        /// 조회 시각(epoch ms). 신선도 판정(`journeyCardFreshness`)의 근거.
        public let queriedAt: Double
        /// 출발지가 수동 지정 위치였는가 — 참이면 그 결과로 시작하지 않고 기기 위치로 다시 조회한다.
        public let manualOrigin: Bool
    }

    public let mode: RouteStartMode
    public let dest: RoutePoint
    public let destLabel: String
    public let destRoman: String?
    public let via: Via?
    /// 도보의 계단 회피. 그 밖의 수단은 false.
    public let accessible: Bool
    /// 자동차 경로의 provider(예: "tmap"). 그 밖의 수단은 nil.
    public let carProvider: String?
    public let transit: Transit?

    /// 계약에 맞는 렌더만 돌려준다. 디코딩 실패·모르는 수단·대중교통인데 결과가 없는(또는 다른 수단인데 결과가 실린) 렌더는
    /// nil이다(호출부가 `.unsupported`로 접는다 — 카드 한 장이 깨졌다고 답 전체를 잃지 않는다).
    static func decodeValid(from decoder: any Decoder) -> RouteStartChatPayload? {
        guard let payload = try? RouteStartChatPayload(from: decoder),
              (payload.mode == .transit) == (payload.transit != nil)
        else { return nil }
        return payload
    }
}

/// 한 도착지의 카드 재료: 수단별 렌더(없으면 nil). 버튼 순서는 `modes`가 정한다.
public struct RouteStartCardGroup: Sendable, Hashable {
    public let dest: RoutePoint
    public let destLabel: String
    public let destRoman: String?
    public let walk: RouteStartChatPayload?
    public let car: RouteStartChatPayload?
    public let transit: RouteStartChatPayload?

    /// 버튼 순서대로의 렌더(도보 → 자동차 → 대중교통, 없는 수단은 빠진다).
    public var modes: [RouteStartChatPayload] { [walk, car, transit].compactMap { $0 } }

    /// [길찾기에서 열기]가 싣는 경유지: 버튼 순서로 처음 만나는 경유지(대중교통 렌더에는 없다).
    public var via: RouteStartChatPayload.Via? { modes.lazy.compactMap(\.via).first }
}

/// 한 답의 `route-start` 렌더를 도착지 좌표로 묶는다(R1·R12, 웹 `MessageBubble`과 같은 규칙) — 순수 함수.
/// 묶음 순서는 그 도착지가 처음 나온 순서이고, 같은 수단이 둘이면 첫 것만 쓴다. 이름·로마자는 묶음의 첫 렌더 것이다.
public func routeStartCardGroups(_ renders: [ChatRenderPayload]) -> [RouteStartCardGroup] {
    var order: [RoutePoint] = []
    var byDest: [RoutePoint: [RouteStartChatPayload]] = [:]
    for render in renders {
        guard case .routeStart(let payload) = render else { continue }
        if byDest[payload.dest] == nil { order.append(payload.dest) }
        byDest[payload.dest, default: []].append(payload)
    }
    return order.compactMap { dest in
        guard let items = byDest[dest], let first = items.first else { return nil }
        func pick(_ mode: RouteStartMode) -> RouteStartChatPayload? { items.first { $0.mode == mode } }
        return RouteStartCardGroup(
            dest: dest, destLabel: first.destLabel, destRoman: first.destRoman,
            walk: pick(.walk), car: pick(.car), transit: pick(.transit))
    }
}
