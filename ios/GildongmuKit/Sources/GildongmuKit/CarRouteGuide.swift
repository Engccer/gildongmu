import Foundation

/// 자동차 안내 기하 조립(B1 스펙 §5) — 웹 `src/lib/car-route-guide.ts` 미러.
///
/// fail-closed: 어느 guide든 기하가 결손이면 부분 조립 없이 전체 nil이다.
/// 부분 상세는 중간부터 틀린 도로에 스냅해 이탈 판정이 영영 못 잡는 거짓 안내가
/// 된다. 이음매·0-길이 검증은 `buildGuideRoute`가 두 번째 층으로 다시 본다.
///
/// 도로명 스팬은 별도 축: 링크 길이 누적 합이 경로 총거리와 5% 이상 어긋나면
/// 도로명 기능만 강등(빈 배열)하고 경로 안내는 유지한다.

/// 도로명 스팬 — 진행거리 [startD, endD) 구간의 도로명(무명 링크는 nil).
public struct CarRoadSpan: Sendable, Equatable {
    public let name: String?
    public let startD: Double
    public let endD: Double

    public init(name: String?, startD: Double, endD: Double) {
        self.name = name
        self.startD = startD
        self.endD = endD
    }
}

public struct CarGuideData: Sendable {
    public let route: GuideRoute
    public let roadSpans: [CarRoadSpan]
}

private let roadSpanToleranceRatio = 0.05
/// 종점 마커와 마지막 스텝 끝의 허용 어긋남(m) — 이음매 허용치와 같은 수준.
private let terminalToleranceMeters = 5.0

public func buildCarGuide(briefing: CarRouteBriefing) -> CarGuideData? {
    let guides = briefing.guides
    guard !guides.isEmpty else { return nil }
    // fail-closed: 기하 결손 guide가 하나라도 있으면 전체 부적격.
    for g in guides {
        guard let coords = g.pathCoords, coords.count >= 2 else { return nil }
        for c in coords where !c.lat.isFinite || !c.lng.isFinite { return nil }
    }
    // 전 구간 커버리지(§5): 마지막 스텝 끝 = 종점 마커(어긋나면 짧은 조립 — 부적격).
    if let terminal = briefing.terminalCoord,
       let lastEnd = guides.last?.pathCoords?.last,
       haversineMeters(
           lat1: lastEnd.lat, lng1: lastEnd.lng, lat2: terminal.lat, lng2: terminal.lng
       ) > terminalToleranceMeters {
        return nil
    }

    guard let route = buildGuideRoute(
        guides.map { GuideStepGeometry(description: $0.guidance, pathCoords: $0.pathCoords!) },
        waypointStepIndex: briefing.waypoint?.stepIndex
    ) else { return nil }

    // 도로명 스팬: 링크 길이를 경로 진행거리 축에 누적한다.
    let links = guides.flatMap { $0.roadLinks ?? [] }
    var acc = 0.0
    var roadSpans: [CarRoadSpan] = []
    for link in links {
        guard link.distanceMeters.isFinite, link.distanceMeters >= 0 else {
            return CarGuideData(route: route, roadSpans: [])
        }
        roadSpans.append(
            CarRoadSpan(name: link.name, startD: acc, endD: acc + link.distanceMeters)
        )
        acc += link.distanceMeters
    }
    // 누적 합이 총거리와 5% 이상 어긋나면 도로명 강등(경로 안내는 유지).
    if roadSpans.isEmpty || abs(acc - route.totalMeters) > route.totalMeters * roadSpanToleranceRatio {
        return CarGuideData(route: route, roadSpans: [])
    }
    return CarGuideData(route: route, roadSpans: roadSpans)
}

/// 진행거리 d가 속한 스팬의 도로명. 무명 스팬·빈 스팬·범위 밖은 nil.
public func roadNameAt(spans: [CarRoadSpan], d: Double) -> String? {
    for s in spans where d >= s.startD && d < s.endD { return s.name }
    // 종점 등호 경계: 마지막 스팬의 끝은 마지막 스팬 소속으로 본다.
    if let last = spans.last, d == last.endD { return last.name }
    return nil
}
