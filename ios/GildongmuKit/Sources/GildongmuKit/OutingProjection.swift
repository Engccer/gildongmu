import Foundation

// ── 나들이 진행축 투영(spec 2026-09-26 §6.1) ──
// 장소를 "지금 걷는 방향" 기준 앞·옆·뒤와 왼쪽·오른쪽으로 나눈다. 지나침 낭독(§6.3)·조망 구획
// (§8.2)·방향 행(§8.1)이 모두 이 결과를 읽는다.
//
// ⚠ **좌우 표현의 원천은 이 파일의 `OutingSide` 하나다.** 좌우를 말하는 문장은 이 값을 받아
// 조립하고, 이름·방위 문자열에서 좌우를 다시 추론하지 않는다(소스 가드 `outing-guard.test.ts`).
//
// ⚠ **진행 방위는 위치 이력 유도(`deriveCourse`)만 쓴다.** 기기 course 게이트(`courseStep`)는
// 보행 속도에서 입력이 없다(실사용 로그 통과 0/281, `CourseDerivation.swift` 머리 주석).

/// ⚠ 잠정값(spec §10). 옆 판정 종방향 대역(m) — |s| ≤ 이 값이면 옆.
public let outingBesideBandMeters = 10.0
/// ⚠ 잠정값(spec §10). 유도 방위 표의 유효 나이(초). 표는 2m 전진마다 나오므로 보행 중엔 수 초 간격이다.
public let outingHeadingMaxAgeSeconds = 10.0
/// ⚠ 잠정값(spec §10). 조망 반경(m) — "주변 보기"의 앞·옆·지나온 구획이 이 거리 안만 싣는다.
public let outingOverviewRadiusMeters = 50.0
/// 유도 방위의 불확실성 상한(도). 4분할 버킷 반폭(`courseAccuracyMaxDegrees`)과 같은 수.
public let outingHeadingMaxUncertaintyDegrees = courseAccuracyMaxDegrees

/// 유도 방위 관측 하나와 그 시각(단조 초).
public struct OutingCourseSample: Sendable, Equatable {
    public let course: DerivedCourse
    public let at: Double

    public init(course: DerivedCourse, at: Double) {
        self.course = course
        self.at = at
    }
}

/// 세션 안의 방위 기록. `latest`는 마지막 표, `lastGoodBearing`은 불확실성 상한을 통과한 마지막 방위
/// ("마지막 진행 방향"의 근거 — 모퉁이에서 흐려진 표로 덮지 않는다).
public struct OutingHeadingState: Sendable, Equatable {
    public var latest: OutingCourseSample?
    public var lastGoodBearing: Double?

    public init(latest: OutingCourseSample? = nil, lastGoodBearing: Double? = nil) {
        self.latest = latest
        self.lastGoodBearing = lastGoodBearing
    }
}

/// 유도기가 낸 표를 기록한다.
public func outingHeadingRecord(
    _ state: OutingHeadingState, course: DerivedCourse, at: Double
) -> OutingHeadingState {
    var next = state
    next.latest = OutingCourseSample(course: course, at: at)
    if course.uncertaintyDeg.isFinite, course.uncertaintyDeg <= outingHeadingMaxUncertaintyDegrees {
        next.lastGoodBearing = course.bearing
    }
    return next
}

/// 지금의 진행 방위 상태(3-state).
public enum OutingHeading: Sendable, Equatable {
    /// 한 번도 방위를 얻지 못했다(세션 초반).
    case none
    /// 방위는 있었지만 지금은 믿을 수 없다(정지·속도 모름·표 나이 초과·불확실성 초과) — "마지막 진행 방향".
    case stale(bearing: Double)
    /// 지금 걷는 방향을 안다.
    case valid(bearing: Double, uncertaintyDeg: Double)

    /// 방향 행이 말할 방위(valid·stale 공통). none이면 nil.
    public var bearing: Double? {
        switch self {
        case .none: nil
        case .stale(let b): b
        case .valid(let b, _): b
        }
    }
}

public func outingHeading(_ state: OutingHeadingState, motion: MotionState, now: Double) -> OutingHeading {
    if let latest = state.latest,
       motion == .moving,
       latest.course.uncertaintyDeg.isFinite,
       latest.course.uncertaintyDeg <= outingHeadingMaxUncertaintyDegrees,
       now - latest.at >= 0, now - latest.at <= outingHeadingMaxAgeSeconds {
        return .valid(bearing: latest.course.bearing, uncertaintyDeg: latest.course.uncertaintyDeg)
    }
    if let bearing = state.lastGoodBearing { return .stale(bearing: bearing) }
    return .none
}

public enum OutingZone: String, Sendable, Equatable {
    case ahead, beside, behind
}

public enum OutingSide: String, Sendable, Equatable {
    case left, right, unknown
}

/// 장소 하나의 진행축 관계.
public struct OutingRelation: Sendable, Equatable {
    /// 종방향(m, 진행 방향이 +). 방위가 valid가 아니면 0.
    public let s: Double
    /// 횡방향(m, 오른쪽이 +). 방위가 valid가 아니면 0.
    public let t: Double
    /// 직선거리(m).
    public let d: Double
    public let zone: OutingZone
    public let side: OutingSide
    /// valid 방위로 계산했을 때만 그 방위(지나침 판정의 회전 검사가 쓴다). 아니면 nil.
    public let validBearing: Double?
}

/// 진행축 투영. 부호 규약은 `relativeDirection`(θ>0 = 오른쪽)과 같다.
public func outingProject(
    fixLat: Double, fixLng: Double, accuracy: Double,
    heading: OutingHeading,
    placeLat: Double, placeLng: Double
) -> OutingRelation {
    let d = haversineMeters(lat1: fixLat, lng1: fixLng, lat2: placeLat, lng2: placeLng)
    guard case let .valid(course, u) = heading, d.isFinite else {
        return OutingRelation(s: 0, t: 0, d: d, zone: .beside, side: .unknown, validBearing: nil)
    }
    let b = bearingDegrees(fromLat: fixLat, fromLng: fixLng, toLat: placeLat, toLng: placeLng)
    let rel = (b - course) * .pi / 180
    let s = d * cos(rel)
    let t = d * sin(rel)
    let zone: OutingZone = s > outingBesideBandMeters ? .ahead : (s < -outingBesideBandMeters ? .behind : .beside)
    // 사슬 불확실성 U와 GPS 오차가 부호를 뒤집을 수 있는 거리 안이면 좌우를 말하지 않는다(spec §6.1).
    let margin = max(accuracy.isFinite ? accuracy : .infinity, d * sin(min(90, max(0, u)) * .pi / 180))
    let side: OutingSide = abs(t) > margin ? (t > 0 ? .right : .left) : .unknown
    return OutingRelation(s: s, t: t, d: d, zone: zone, side: side, validBearing: course)
}
