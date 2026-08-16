import Foundation

/// 안내 경로 origin 후보 fix.
public struct RouteOriginFix: Equatable, Sendable {
    public var lat: Double
    public var lng: Double
    public var accuracy: Double
    public var ageSeconds: Double

    public init(lat: Double, lng: Double, accuracy: Double, ageSeconds: Double) {
        self.lat = lat
        self.lng = lng
        self.accuracy = accuracy
        self.ageSeconds = ageSeconds
    }
}

/// `routeOriginStep`의 결정.
public enum RouteOriginDecision: Equatable, Sendable {
    /// 이 fix로 지금 조회한다(수용 정확도·나이 통과).
    case fetch(RouteOriginFix)
    /// 계속 기다린다. `best`는 갱신된 최선 후보 — 대기 상한이 끝나면 이것으로 조회한다.
    case wait(best: RouteOriginFix?)
}

/// 안내 경로 origin 선택(순수, A18).
///
/// 세션이 시작되는 순간은 대개 GPS가 가장 나쁜 순간이다(차량 하차·실내 탈출 직후).
/// 그래서 "첫 fix"와 "가장 나쁜 fix"가 구조적으로 같은 fix이고, 그 좌표를 그대로
/// origin으로 삼으면 경로가 통째로 다른 곳에서 출발한다(2026-08-16 실보행: origin이
/// 115m 북쪽이라 건너야 했던 횡단보도가 경로에 없었다).
///
/// 단발 취득 `currentCoordinate()`의 정책을 스트림 위에 그대로 옮긴 것이다:
/// `shouldAcceptFix`를 통과하는 첫 fix면 즉시, 그 전까지는 `storeCeiling` 이내의
/// 최선값만 보관하고 대기 상한(호출부의 `noFixTimeout`)에 그 최선값으로 조회한다.
/// 재측위 의존은 되살리지 않는다 — 판정만 되돌린다.
///
/// ⚠ 이 함수는 origin 선택 한 곳의 술어다. 비콘 앵커·최종 접근이 쓰는 `isUsableFix`는
/// 느슨한 정확도가 의도이므로 조이지 않는다("500m 전 정밀 좌표보다 40m 오차의 지금
/// 좌표가 낫다"). Kit에 있는 이유는 앱 타깃에 테스트 번들이 없어서다(리뷰 I-11 동형).
public func routeOriginStep(
    best: RouteOriginFix?,
    fix: RouteOriginFix,
    acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy,
    acceptAge: Double = LocationFixPolicy.acceptAge,
    ceiling: Double = LocationFixPolicy.storeCeiling
) -> RouteOriginDecision {
    if shouldAcceptFix(
        accuracy: fix.accuracy, age: fix.ageSeconds,
        acceptAccuracy: acceptAccuracy, acceptAge: acceptAge
    ) {
        return .fetch(fix)
    }
    let candidate = isStorableFix(
        accuracy: fix.accuracy, age: fix.ageSeconds, acceptAge: acceptAge, ceiling: ceiling
    )
    guard candidate, isBetterFix(fix.accuracy, than: best?.accuracy) else {
        return .wait(best: best)
    }
    return .wait(best: fix)
}
