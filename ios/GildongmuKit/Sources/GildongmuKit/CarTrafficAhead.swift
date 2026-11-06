import Foundation

// 주행 중 "앞으로 지날 구간에 새로 생긴 정체" 판정(E80 spec `docs/superpowers/specs/2026-11-07-e80-car-traffic-design.md` §5).
// 웹 `src/lib/car-traffic-ahead.ts`의 1:1 미러, 공유 fixture `src/lib/__tests__/fixtures/car-jams-ahead-cases.json`.
//
// 재조회 응답은 지금 위치에서 다시 찾은 경로라 지금 안내 중인 경로와 다를 수 있다. 그래서 정체를 좌표로 받아 지금 경로에
// 투영한다 — 둘 다 경로 위(`carJamOnRouteMeters` 안)이고 시작이 지금 진행거리보다 앞일 때만 "내가 지날 구간"이다. 이미 아는
// 정체와 겹치면 새것이 아니다. 아는 정체도 좌표로 보관해 판정 때마다 다시 투영한다(재경로 뒤에도 유효).

/// 정체 좌표가 안내 경로 위로 인정되는 수직거리(m). 웹 `JAM_ON_ROUTE_M` 미러.
public let carJamOnRouteMeters = 40.0
/// 투영 구간 길이와 정체 길이의 허용 차(m)·비율. 웹 `JAM_LENGTH_TOLERANCE_M`·`JAM_LENGTH_TOLERANCE_RATIO` 미러 —
/// 양 끝만 경로 위인 우회로 정체를 내 앞 정체로 말하지 않는다.
public let carJamLengthToleranceMeters = 150.0
public let carJamLengthToleranceRatio = 0.25

/// 아는 정체(좌표만).
public struct KnownCarJam: Sendable, Equatable, Codable {
    public let start: RoutePoint
    public let end: RoutePoint

    public init(start: RoutePoint, end: RoutePoint) {
        self.start = start
        self.end = end
    }
}

public struct NewCarJamsAhead: Sendable, Equatable {
    /// 알릴 정체(가장 가까운 하나)와 지금 위치에서 정체 시작까지(m). 없으면 nil.
    public let nearest: (jam: CarJam, aheadMeters: Int)?
    /// 알린 뒤의 아는 정체 = 입력 + `nearest` 하나(먼 새 정체는 다음 재조회가 말한다). 호출부는 실제로 말했을 때만 채택한다.
    public let known: [KnownCarJam]

    public static func == (a: NewCarJamsAhead, b: NewCarJamsAhead) -> Bool {
        a.known == b.known && a.nearest?.jam == b.nearest?.jam && a.nearest?.aheadMeters == b.nearest?.aheadMeters
    }
}

private func jamInterval(
    _ poly: GuidePolyline, start: RoutePoint, end: RoutePoint, fromD: Double, toD: Double
) -> (Double, Double)? {
    guard let s = projectOnPolyline(poly, p: start, fromD: fromD, toD: toD),
          let e = projectOnPolyline(poly, p: end, fromD: fromD, toD: toD),
          s.perpMeters <= carJamOnRouteMeters, e.perpMeters <= carJamOnRouteMeters,
          e.d > s.d
    else { return nil }
    return (s.d, e.d)
}

/// 웹 `newJamsAhead` 미러. `d`는 지금 진행거리(m).
public func newCarJamsAhead(
    polyline: GuidePolyline, totalMeters: Double, d: Double, known: [KnownCarJam], fresh: [CarJam]
) -> NewCarJamsAhead {
    let knownIntervals = known.compactMap {
        jamInterval(polyline, start: $0.start, end: $0.end, fromD: 0, toD: totalMeters)
    }
    var added: [(jam: CarJam, s: Double)] = []
    for jam in fresh {
        // 시작이 지금 진행거리보다 앞이 아니면 지나갔거나 이미 그 안이다(창 클램프로 s == d가 된다).
        guard let iv = jamInterval(polyline, start: jam.start, end: jam.end, fromD: d, toD: totalMeters),
              iv.0 > d
        else { continue }
        let tolerance = max(carJamLengthToleranceMeters, Double(jam.lengthMeters) * carJamLengthToleranceRatio)
        if abs(iv.1 - iv.0 - Double(jam.lengthMeters)) > tolerance { continue }
        if knownIntervals.contains(where: { iv.0 < $0.1 && $0.0 < iv.1 }) { continue }
        added.append((jam, iv.0))
    }
    guard !added.isEmpty else { return NewCarJamsAhead(nearest: nil, known: known) }
    // 안정 정렬(같은 시작이면 응답 순서) — 웹 Array.sort는 안정이다.
    let sorted = added.enumerated().sorted { ($0.element.s, $0.offset) < ($1.element.s, $1.offset) }.map(\.element)
    let first = sorted[0]
    return NewCarJamsAhead(
        nearest: (first.jam, Int((first.s - d).rounded())),
        known: known + [KnownCarJam(start: first.jam.start, end: first.jam.end)])
}
