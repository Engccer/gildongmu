import Foundation

/// 이탈 확정 시 자동 조회해 보관한 제안 경로(E10ⓑ, spec 2026-08-12 §6).
/// 취득 좌표·취득 시각(uptime)이 신선도 판정의 기준값이다.
public struct RerouteProposal: Sendable {
    public let originLat: Double
    public let originLng: Double
    /// 취득 시각 — `ProcessInfo.systemUptime` 기준(벽시계 점프 무관).
    public let acquiredAt: TimeInterval

    public init(originLat: Double, originLng: Double, acquiredAt: TimeInterval) {
        self.originLat = originLat
        self.originLng = originLng
        self.acquiredAt = acquiredAt
    }
}

/// 제안의 순수 판정(신선도·세션당 조회 상한). 모델 계층은 이 판정만 소비한다 —
/// 걷는 중 낡은 출발점의 경로를 채택하면 도로 중앙 안내(§5.6 실사고 계열)가
/// 되므로, 만료는 수락을 기다리지 않는 능동 전이의 근거다(spec §6 리뷰 #12).
public enum RerouteProposalGate {
    /// 신선도 한계(잠정값 — 실보행 판정 대상, spec §6).
    public static let maxDriftMeters: Double = 30
    public static let maxAgeSeconds: TimeInterval = 120
    /// 세션당 자동 조회 상한(잠정값). GPS 진동으로 확정 회차가 반복 생성될 때
    /// 쿼터·통지 폭주를 막는 마지막 방어선(spec §6 리뷰 #8).
    public static let maxFetchesPerSession = 5

    /// 시간 축 단독 판정 — 현재 좌표를 단정할 수 없을 때(fix 끊김·최종 접근 중)의
    /// 만료 검사용. 시간 축을 fix 도착에만 걸면 실내·권한 철회에서 만료가 영구히
    /// 발동하지 못한다(워치독 계열 교훈 — fix 경로에만 걸면 영구 침묵).
    public static func isFreshInTime(
        _ proposal: RerouteProposal, nowUptime: TimeInterval
    ) -> Bool {
        nowUptime - proposal.acquiredAt <= maxAgeSeconds
    }

    /// 취득 위치에서 30m 초과 이동 또는 120초 경과면 만료.
    public static func isFresh(
        _ proposal: RerouteProposal, nowUptime: TimeInterval,
        currentLat: Double, currentLng: Double
    ) -> Bool {
        guard isFreshInTime(proposal, nowUptime: nowUptime) else { return false }
        let drift = haversineMeters(
            lat1: proposal.originLat, lng1: proposal.originLng,
            lat2: currentLat, lng2: currentLng
        )
        return drift <= maxDriftMeters
    }

    /// 세션당 자동 조회 허용 여부(확정 회차당 1회는 호출부 계약).
    public static func mayFetch(episodeFetchCount: Int) -> Bool {
        episodeFetchCount < maxFetchesPerSession
    }
}
