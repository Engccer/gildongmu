import Foundation

// ── 나들이 주변 재조회 트리거(spec 2026-09-26 §6.2) ──
// 둘러보기 500m 반경을 걷는 동안 새로 받는 시점. 마지막 조회 좌표에서 직선 100m를 벗어나면
// 다시 조회한다. 조회 실패 계수(3회 연속이면 "주변 정보 없음")도 여기서 판정한다.

/// ⚠ 잠정값(spec §10). 주변 재조회 이동 거리(m).
public let outingRequeryDistanceMeters = 100.0
/// 연속 실패가 이 횟수에 닿으면 주변 정보가 "없음"이 된다(§6.2, 3-state의 실패 칸).
public let outingRequeryFailureLimit = 3

/// 이 fix에서 주변을 다시 조회해야 하는가. 마지막 조회 좌표가 없으면(세션 첫 조회) 참.
public func outingRequeryStep(lastQuery: RoutePoint?, fix: RoutePoint) -> Bool {
    guard let lastQuery else { return true }
    let moved = haversineMeters(lat1: lastQuery.lat, lng1: lastQuery.lng, lat2: fix.lat, lng2: fix.lng)
    guard moved.isFinite else { return false }
    return moved >= outingRequeryDistanceMeters
}

/// 주변 정보의 상태(3-state + 서비스 지역 밖). 화면·낭독이 같은 값을 읽는다.
public enum OutingSurroundingsStatus: Sendable, Equatable {
    /// 아직 한 번도 받지 못했다(세션 초반).
    case loading
    /// 받은 목록이 있다(0건 포함 — 0건은 "이정표 없음"으로 말한다).
    case ready
    /// 연속 실패가 상한에 닿았다 — 직전 목록을 더는 믿지 않는다.
    case failed
    /// 한국 밖(서버 `outOfCoverage`).
    case outOfCoverage
}

/// 조회 결과 하나를 반영한 다음 상태와 연속 실패 수. 성공·서비스 밖은 실패 수를 0으로 되돌리고,
/// 실패는 상한 전까지 직전 상태를 유지한다(직전 결과 유지 — 세션을 끊지 않는다).
public func outingSurroundingsStep(
    status: OutingSurroundingsStatus, failures: Int, result: OutingQueryOutcome
) -> (status: OutingSurroundingsStatus, failures: Int) {
    switch result {
    case .success: return (.ready, 0)
    case .outOfCoverage: return (.outOfCoverage, 0)
    case .failure:
        let next = failures + 1
        return (next >= outingRequeryFailureLimit ? .failed : status, next)
    }
}

public enum OutingQueryOutcome: Sendable, Equatable {
    case success, failure, outOfCoverage
}
