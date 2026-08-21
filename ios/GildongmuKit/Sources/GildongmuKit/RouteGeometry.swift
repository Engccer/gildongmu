import Foundation

/// 도보 경로 기하: 폴리라인 조립·검증·투영 (순수 — CoreLocation 비의존).
/// 웹 정본 `src/lib/route-geometry.ts`의 1:1 미러. 공유 fixture
/// `src/lib/__tests__/fixtures/route-guide-scenarios.json`이 동조를 강제한다.
///
/// ⚠ 전역 최근접 매칭 금지 — 경로가 자기 자신과 12m까지 근접해(조사 §2) 엉뚱한
/// 스텝을 고른다. 호출자는 창을 구속하고, 전역 탐색은 후보 목록으로만 받는다.

/// 40m 미만 스텝은 GPS 자동 판정 대상이 아니다: 25m 미만 구간 21%·도심 오차 7~13m.
public let longStepMinMeters = 40.0
/// 스텝 이음매 허용 간격. 실측 0.00m지만 보증이 아니라 응답마다 검증한다(스펙 §7.2).
public let seamToleranceMeters = 5.0

/// 경로 기하 좌표 한 점(WGS84 십진). 서버 `pathCoords` 원소와 동형.
public struct RoutePoint: Codable, Sendable, Hashable {
    public let lat: Double
    public let lng: Double

    public init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }
}

public struct GuidePolyline: Sendable, Equatable {
    public let points: [RoutePoint]
    /// cum[i] = 시작점→points[i] 누적 미터.
    public let cum: [Double]
}

public struct GuideStepSpan: Sendable, Equatable {
    public let index: Int
    public let description: String
    public let startD: Double
    public let endD: Double
    public let isLong: Bool
}

public struct GuideRoute: Sendable, Equatable {
    public let polyline: GuidePolyline
    public let steps: [GuideStepSpan]
    public let totalMeters: Double
    /// 경유지에서 시작하는 스텝의 index(N4, 서버 `waypoint.stepIndex`). 도착선은
    /// `steps[waypointStepIndex].startD`. nil = 경유지 없는 경로.
    public let waypointStepIndex: Int?
}

public struct GuideProjection: Sendable, Equatable {
    /// 경로 시작 기준 진행거리(m).
    public let d: Double
    /// 폴리라인까지 수직거리(m).
    public let perpMeters: Double
}

/// buildGuideRoute 입력(스텝 문장 + 기하). WalkRouteStep에서 투영해 만든다.
public struct GuideStepGeometry: Sendable {
    public let description: String
    public let pathCoords: [RoutePoint]?

    public init(description: String, pathCoords: [RoutePoint]?) {
        self.description = description
        self.pathCoords = pathCoords
    }
}

/// 스텝 기하를 하나의 연속 폴리라인 + 스텝 스팬으로 조립한다.
/// 검증 실패는 nil — 소비자는 상세 부적격으로 간략 폴백한다(fail-closed).
/// `waypointStepIndex`(N4): 범위 `0 ..< steps.count` 밖이면 nil — 경유지를 받은 세션이
/// 경유지 위치를 모르면 상세 안내 자격이 없다(유령 스텝 가드와 같은 규율). 0은 유효하다
/// (경유지에서 출발 — leg 0이 비었거나 첫 Point가 경유지).
public func buildGuideRoute(
    _ steps: [GuideStepGeometry], waypointStepIndex: Int? = nil
) -> GuideRoute? {
    if let w = waypointStepIndex, !(0..<steps.count).contains(w) { return nil }
    guard !steps.isEmpty else { return nil }
    var points: [RoutePoint] = []
    var cum: [Double] = []
    var spans: [GuideStepSpan] = []
    var d = 0.0
    for (i, step) in steps.enumerated() {
        guard let pc = step.pathCoords, !pc.isEmpty,
              pc.allSatisfy({ $0.lat.isFinite && $0.lng.isFinite })
        else { return nil }
        let startD = d
        for (j, p) in pc.enumerated() {
            if points.isEmpty {
                points.append(p)
                cum.append(0)
                continue
            }
            let prev = points[points.count - 1]
            let seg = haversineMeters(lat1: prev.lat, lng1: prev.lng, lat2: p.lat, lng2: p.lng)
            // 스텝 첫 점은 직전 스텝 끝점과 이어져야 한다(이음매 검증).
            if j == 0 && seg > seamToleranceMeters { return nil }
            if seg == 0 { continue } // 중복점 제거
            d += seg
            points.append(p)
            cum.append(d)
        }
        // 직전 스텝 끝점과 동일한 좌표 1점뿐인 중간 스텝(Tmap 폴백류 0-길이 지시)은
        // 거부한다(fail-closed). 통과시키면 startD==endD 유령 스텝이 spans에 남는다.
        if d - startD <= 0 && i > 0 && pc.count < 2 { return nil }
        spans.append(GuideStepSpan(
            index: i,
            description: step.description,
            startD: startD,
            endD: d,
            isLong: d - startD >= longStepMinMeters
        ))
    }
    guard points.count >= 2, d > 0 else { return nil }
    return GuideRoute(
        polyline: GuidePolyline(points: points, cum: cum),
        steps: spans,
        totalMeters: d,
        waypointStepIndex: waypointStepIndex
    )
}

/// 위경도를 기준점(ref) 주변 로컬 평면(m)으로 변환.
private func toLocal(ref: RoutePoint, p: RoutePoint) -> (x: Double, y: Double) {
    let y = (p.lat - ref.lat) * 111_320
    let x = (p.lng - ref.lng) * 111_320 * cos(ref.lat * .pi / 180)
    return (x, y)
}

/// [fromD, toD] 창 안에서 p의 최근접 투영. 창과 겹치는 세그먼트가 없으면 nil.
/// ⚠ perp는 세그먼트 기하 최근접(창 클램프 전) 기준 — 클램프 후 지점까지의 거리로
/// 재면 전방 진행이 "수직 이탈"과 구분되지 않는다(웹 정본 동일 계약).
public func projectOnPolyline(
    _ poly: GuidePolyline, p: RoutePoint, fromD: Double, toD: Double
) -> GuideProjection? {
    var best: GuideProjection?
    for i in 0..<(poly.points.count - 1) {
        let d0 = poly.cum[i]
        let d1 = poly.cum[i + 1]
        if d1 < fromD || d0 > toD || d1 == d0 { continue }
        let a = toLocal(ref: p, p: poly.points[i])
        let b = toLocal(ref: p, p: poly.points[i + 1])
        let abx = b.x - a.x
        let aby = b.y - a.y
        let len2 = abx * abx + aby * aby
        var t = len2 == 0 ? 0 : (-a.x * abx - a.y * aby) / len2
        t = max(0, min(1, t))
        let px = a.x + abx * t
        let py = a.y + aby * t
        let perp = (px * px + py * py).squareRoot()
        let dd = max(fromD, min(toD, d0 + (d1 - d0) * t))
        if best == nil || perp < best!.perpMeters {
            best = GuideProjection(d: dd, perpMeters: perp)
        }
    }
    return best
}

/// 세그먼트 i 단독 투영(t는 [0,1]만 클램프 — 창 없음).
private func projectOnSegment(_ poly: GuidePolyline, i: Int, p: RoutePoint) -> GuideProjection {
    let a = toLocal(ref: p, p: poly.points[i])
    let b = toLocal(ref: p, p: poly.points[i + 1])
    let abx = b.x - a.x
    let aby = b.y - a.y
    let len2 = abx * abx + aby * aby
    var t = len2 == 0 ? 0 : (-a.x * abx - a.y * aby) / len2
    t = max(0, min(1, t))
    let px = a.x + abx * t
    let py = a.y + aby * t
    return GuideProjection(
        d: poly.cum[i] + (poly.cum[i + 1] - poly.cum[i]) * t,
        perpMeters: (px * px + py * py).squareRoot()
    )
}

/// 전역 후보(국소 최소점들): perp ≤ maxPerp 후보를 진행거리 30m 간격으로 병합.
/// 후보가 복수면 호출자는 위치를 확정하지 말아야 한다(스펙 §6 모호 규칙).
/// ⚠ 창 기반 projectOnPolyline 재사용 금지 — 인접 세그먼트의 기하 최근접이 경계
/// 클램프 d로 끌려 들어와 유령 후보를 만든다(웹 실측: U자 왕복에서 3후보).
public func globalCandidates(
    _ poly: GuidePolyline, p: RoutePoint, maxPerp: Double
) -> [GuideProjection] {
    var raw: [GuideProjection] = []
    for i in 0..<(poly.points.count - 1) {
        let pr = projectOnSegment(poly, i: i, p: p)
        if pr.perpMeters <= maxPerp { raw.append(pr) }
    }
    raw.sort { $0.d < $1.d }
    var merged: [GuideProjection] = []
    for c in raw {
        if let last = merged.last, c.d - last.d < 30 {
            if c.perpMeters < last.perpMeters { merged[merged.count - 1] = c }
        } else {
            merged.append(c)
        }
    }
    return merged
}

/// 진행거리 `d` 지점의 경로 접선 방위(진북 기준 도, `[0,360)`).
/// 앞뒤 `halfMeters`의 두 점을 잇는 방위라 폴리라인 정점 노이즈를 평활한다.
/// 웹 `route-geometry.ts` `tangentAt` 미러.
///
/// ⚠ **두 점이 같으면 `nil`이다.** 0도로 접으면 소비자가 "북쪽"이라는 거짓 정보를 얻는다.
public func tangentAt(_ poly: GuidePolyline, d: Double, halfMeters: Double) -> Double? {
    guard let total = poly.cum.last, total > 0 else { return nil }
    guard let a = pointAtD(poly, d: max(0, d - halfMeters)),
          let b = pointAtD(poly, d: min(total, d + halfMeters))
    else { return nil }
    let lat0 = a.lat * .pi / 180
    let dx = (b.lng - a.lng) * cos(lat0)
    let dy = b.lat - a.lat
    if dx == 0 && dy == 0 { return nil }
    return (atan2(dx, dy) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
}

/// 진행거리 `d` 지점의 좌표. 범위 밖은 끝점으로 물린다.
private func pointAtD(_ poly: GuidePolyline, d: Double) -> RoutePoint? {
    guard !poly.points.isEmpty else { return nil }
    if poly.points.count == 1 { return poly.points[0] }
    let dd = max(0, min(d, poly.cum[poly.cum.count - 1]))
    for i in 0..<(poly.points.count - 1) where poly.cum[i] <= dd && dd <= poly.cum[i + 1] {
        let seg = poly.cum[i + 1] - poly.cum[i]
        let t = seg == 0 ? 0 : (dd - poly.cum[i]) / seg
        return RoutePoint(
            lat: poly.points[i].lat + t * (poly.points[i + 1].lat - poly.points[i].lat),
            lng: poly.points[i].lng + t * (poly.points[i + 1].lng - poly.points[i].lng)
        )
    }
    return poly.points[poly.points.count - 1]
}
