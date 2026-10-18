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

/// 자동 재조회의 순수 판정(신선도·세션당 조회 상한). 모델 계층은 이 판정만 소비한다 —
/// 걷는 중 낡은 출발점의 경로를 채택하면 도로 중앙 안내(§5.6 실사고 계열)가 되므로,
/// `isFresh`는 **채택 시점 1회 안전망**이다(2026-09-02 자동 채택 개정 — 종전 수락제의
/// 만료 능동 전이는 폐기됐고, `isFreshInTime`은 프로덕션 호출부 없이 테스트 전용 공개 API로 남았다).
public enum RerouteProposalGate {
    /// 신선도 시간 한계(잠정값 — 실보행 판정 대상, spec §6). 이동 상한은 수단별 `GuideTuning.rerouteMaxDriftM`이다.
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

    /// 취득 위치에서 `maxDriftMeters` 초과 이동 또는 120초 경과면 만료. 이동 상한은 호출부가 수단의
    /// `GuideTuning.rerouteMaxDriftM`으로 넘긴다(기본값 없음 — 도보 상한이 자동차에 조용히 적용되지 않게).
    public static func isFresh(
        _ proposal: RerouteProposal, nowUptime: TimeInterval,
        currentLat: Double, currentLng: Double, maxDriftMeters: Double
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

    /// E69 ⓒ: 벗어난 채 이만큼 서 있으면 "경로 다시 조회" 버튼이 선다(초, 착수 기본값 — 실보행 판정 대상,
    /// spec `2026-10-17-reroute-button-visibility-design.md` §1.2). 웹 `REROUTE_BUTTON_STILL_S` 미러.
    public static let stillButtonSeconds: TimeInterval = 30

    /// E69 ⓒ의 정지 연속 갱신. 새 정지 판정을 만들지 않고 `GuideFix.stopped`만 본다(E55 — `speedUnknown`은 정지가
    /// 아니라 연속을 끊는다). `since`는 연속 시작 시각, `reached`는 이 fix에서 문턱에 닿았는가. 웹 `rerouteStillStep` 미러.
    public static func stillStep(
        since: TimeInterval?, stopped: Bool, now: TimeInterval
    ) -> (since: TimeInterval?, reached: Bool) {
        guard stopped else { return (nil, false) }
        let start = since ?? now
        return (start, now - start >= stillButtonSeconds)
    }

    // ── 새 경로 첫 점 검사(A70 spec 2026-10-19 §2) — 웹 `routeStart*` 미러 ──────────────────────
    // 신선도(`isFresh`)는 **요청 지점 ↔ 현재 위치**만 본다. provider가 출발점을 멀리 붙이면(실보행 237m) 신선한 요청이
    // 먼 경로를 낳는다 — 그 축은 **경로 첫 점 ↔ 현재 위치**다. 문턱은 같은 수단별 데이터 `rerouteMaxDriftM`.
    // 공유 판정표 `route-start-gap-cases.json`.

    /// 경로 첫 점까지의 직선거리(m).
    public static func routeStartGapMeters(route: GuideRoute, currentLat: Double, currentLng: Double) -> Double {
        let p = route.polyline.points[0]
        return haversineMeters(lat1: currentLat, lng1: currentLng, lat2: p.lat, lng2: p.lng)
    }

    /// 자동 재조회 채택 자격: 첫 점이 `maxDriftMeters` 안인가. 밖이면 채택하지 않고 `none`과 같은 결말(E69 ⓐ).
    public static func routeStartsNearby(
        route: GuideRoute, currentLat: Double, currentLng: Double, maxDriftMeters: Double
    ) -> Bool {
        routeStartGapMeters(route: route, currentLat: currentLat, currentLng: currentLng) <= maxDriftMeters
    }

    /// 현재 위치에서 첫 점의 북 기준 8방위(`n`·`ne`·`e`·`se`·`s`·`sw`·`w`·`nw`) — 사용자가 연 조회(시작·버튼 재조회·줄 전환)의
    /// 고지 문장(`guide.routeStartsAway`). 진행 방위 기준 시계가 아닌 이유: 시작 순간엔 대개 관측이 없고, 상태 행에 남는
    /// 문장은 절대 방향이어야 나중에도 참이다(A57).
    public static func routeStartCompass(route: GuideRoute, fromLat: Double, fromLng: Double) -> String {
        let p = route.polyline.points[0]
        let deg = bearingDegrees(fromLat: fromLat, fromLng: fromLng, toLat: p.lat, toLng: p.lng)
        let dirs = ["n", "ne", "e", "se", "s", "sw", "w", "nw"]
        let norm = ((deg.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360)
        return dirs[Int((norm / 45).rounded()) % 8]
    }
}
