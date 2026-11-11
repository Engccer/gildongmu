import Foundation

/// 채팅 여정 카드의 신선도 판정(E70-b spec D16, 웹 `journey-card-freshness.ts` 미러) — 순수 함수.
///
/// 카드는 대화에 남아 몇 시간 뒤 다른 곳에서도 눌리고 위치 스토어에는 TTL이 없다. [안내 시작]은 위치를 새로 받아 이 판정을
/// 지나며, `fresh`가 아니면 카드의 결과로 시작하지 않고 같은 여정을 지금 위치로 다시 조회한다.
/// 두 수치는 잠정값이다(spec D16) — 웹과 같은 값이어야 하니 바꾸면 두 곳이다(`JOURNEY_CARD_MAX_AGE_MS`·`JOURNEY_CARD_MAX_DRIFT_M`).
public enum JourneyCardPolicy {
    /// 조회한 지 이보다 오래된 카드는 다시 조회한다(밀리초).
    public static let maxAgeMs: Double = 10 * 60 * 1000
    /// 카드의 출발 좌표에서 이보다 멀리 벗어났으면 다시 조회한다(미터).
    public static let maxDriftMeters: Double = 100
}

/// `fresh`만 카드의 결과로 안내를 시작한다. 나머지 셋은 다시 조회하는 사유다(행동은 같고 테스트·로그가 가른다).
public enum JourneyCardFreshness: Sendable, Equatable {
    case fresh, expired, moved, noFix
}

/// - Parameters:
///   - fix: 방금 새로 받은 위치. 측위에 실패했으면 nil — 어디 있는지 모르는 채로 카드의 경로를 믿지 않는다.
///   - nowMs: 지금(epoch ms). 기본값을 두지 않는다(생략이 조용히 "늘 신선"이 되지 않게).
public func journeyCardFreshness(
    origin: RoutePoint, queriedAtMs: Double, fix: RoutePoint?, nowMs: Double
) -> JourneyCardFreshness {
    guard let fix else { return .noFix }
    // 시각이 숫자가 아니면 낡은 것으로 본다 — NaN 비교는 늘 거짓이라 그대로 두면 신선으로 샌다.
    if !queriedAtMs.isFinite || nowMs - queriedAtMs > JourneyCardPolicy.maxAgeMs { return .expired }
    let drift = haversineMeters(lat1: origin.lat, lng1: origin.lng, lat2: fix.lat, lng2: fix.lng)
    if !drift.isFinite || drift > JourneyCardPolicy.maxDriftMeters { return .moved }
    return .fresh
}
