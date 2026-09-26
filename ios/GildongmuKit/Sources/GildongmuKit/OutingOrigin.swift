import Foundation

// ── 나들이 출발점 확정(spec 2026-09-26 §5.1) ──
// "출발점으로"가 데려갈 좌표. 세션이 시작되는 순간이 대개 GPS가 가장 나쁜 순간이라(A18) 첫 fix를
// 그대로 쓰지 않는다. `routeOriginStep`은 경로 조회용 대기 상한(15초)에 묶여 있어 부르지 않고,
// 같은 문턱(수용 30m·10초, 저장 100m)을 30초 창 위에 둔다.

/// ⚠ 잠정값(spec §10). 출발점 확정 창(초).
public let outingOriginWindowSeconds = 30.0

public enum OutingOriginDecision: Sendable, Equatable {
    /// 이 좌표로 확정한다.
    case confirm(RouteOriginFix)
    /// 계속 기다린다. `best`는 갱신된 최선 후보(저장 가능 fix만).
    case wait(best: RouteOriginFix?)
}

/// fix 하나(또는 타이머 틱 `fix == nil`)에서의 결정. `elapsedSeconds`는 세션 시작 이후 경과.
/// 수용 fix면 즉시, 창이 끝났으면 최선 후보로, 창이 끝났는데 후보가 없으면 첫 후보가 오는 순간 확정한다.
public func outingOriginStep(
    best: RouteOriginFix?, fix: RouteOriginFix?, elapsedSeconds: Double
) -> OutingOriginDecision {
    var nextBest = best
    if let fix {
        if shouldAcceptFix(accuracy: fix.accuracy, age: fix.ageSeconds) { return .confirm(fix) }
        if isStorableFix(accuracy: fix.accuracy, age: fix.ageSeconds),
           isBetterFix(fix.accuracy, than: best?.accuracy) {
            nextBest = fix
        }
    }
    if elapsedSeconds >= outingOriginWindowSeconds, let chosen = nextBest { return .confirm(chosen) }
    return .wait(best: nextBest)
}
