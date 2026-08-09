import Foundation

/// 이탈 판정 방위 축(spec 2026-08-09, 재설계 2026-08-10). 웹 `guide-course-axis.ts` 미러.
///
/// 수직거리 축이 못 보는 이탈(자기근접으로 수직거리가 무너지는 갈림, 역주행)을
/// 진행 방위로 잡는다. 두 축은 독립 병렬이고 확정은 OR, 복귀는 활성 축 전체 해제다.
///
/// ⚠ **불확실성은 통과권이 아니라 오차범위다.** 각도차 50°에 불확실성 40°면 실제
/// 차이는 10°일 수 있고, 그런 표를 모으면 확신이 아니라 같은 오차의 반복 집계가 된다.
/// 관측은 기기 course가 아니라 위치 이력 유도(`CourseDerivation.swift`)에서 오고,
/// 불확실성은 사슬 자기일관성 U다(spec §2.0·§2.10).
///
/// 상수의 근거는 실사용 로그(spec §3.0, `docs/superpowers/specs/logs/`)와 웹 리플레이
/// 게이트 `course-derivation-replay.test.ts`다(확정은 §7 3단계 검증 보행).

/// ⚠ 잠정값(spec §6·§7) — 검증 보행으로 확정한다. 60은 기기 course의 두꺼운 꼬리
/// (p90 51°)에 맞춘 값이었고 유도 방위(p90 30.8°)에서는 45°가 오표 0.4% 그대로
/// 45° 갈림까지 검출한다(spec §3.0.5).
public let courseAxisThresholdDegrees = 45.0
/// ⚠ 잠정값(spec §6·§7).
public let courseAxisWindowSeconds = 20.0
/// ⚠ 잠정값(spec §6·§7). 확정 임계.
public let courseAxisConfirmRatio = 0.7
/// ⚠ 잠정값(spec §6·§7). 해제 임계. 확정과 다른 값이라야 경계 진동이 없다.
public let courseAxisClearRatio = 0.3
/// ⚠ 잠정값(spec §6·§7). 판정 가능한 표가 덮어야 할 최소 시간(초).
public let courseAxisMinSpanSeconds = 16.0
/// ⚠ 잠정값(spec §6·§7). 판정 가능한 표의 최소 개수.
public let courseAxisMinVotes = 8
/// ⚠ 잠정값(spec §6·§7). 창의 표 중 **판정 가능해야 하는 비율**.
///
/// ⚠ **개수 하한만으로는 부족하다.** 창의 대부분이 `unknown`이어도 남은 소수가 전부
/// `mismatch`면 비율 판정이 통과해, 얇은 근거 위에서 이탈을 확신하게 된다. 그리고
/// 이것을 **개수**로 표현하면 cadence에 묶인다 — 10Hz는 무조건 통과하고 0.5Hz는
/// 영영 미달이라 같은 상황을 두 기기가 다르게 판정한다. 비율이라야 둘 다 성립한다.
public let courseAxisMinDecisiveRatio = 0.8
/// ⚠ 잠정값(spec §6·§7). 위원장 판정으로 앞뒤 10m.
public let courseAxisBackMeters = 10.0
/// ⚠ 잠정값(spec §6·§7).
public let courseAxisAheadMeters = 10.0
/// ⚠ 잠정값(spec §6·§7). 접선 반폭.
public let courseAxisTangentHalfMeters = 15.0
/// ⚠ 잠정값(spec §6·§7). 대조 접선 표본 간격(m) — 검출 입도라 다른 상수와 같은 부류다.
private let courseAxisSampleStepMeters = 5.0

// 보고 acc 게이트(courseAxisMaxAccuracyMeters)는 폐기했다(spec §2.10): 보고 acc는
// 실사용 로그에서 14.2m 동결(249/281)이라 판정 근거로 무의미 — 품질 증거는 사슬 U가
// 담는다. 기기 관측 전제의 CourseObservation·inactiveCourse도 함께 소멸했다
// (유도는 lat/lng/t만 필요해 웹에서도 축이 켜진다 — spec §4).

public enum CourseVote: String, Sendable, Equatable {
    case mismatch, match, unknown
}

public struct CourseVoteSample: Sendable, Equatable {
    public let at: Double
    public let vote: CourseVote

    public init(at: Double, vote: CourseVote) {
        self.at = at
        self.vote = vote
    }
}

public enum CourseAxisVerdict: String, Sendable, Equatable {
    case off, on, unknown
}

private func angDiff(_ a: Double, _ b: Double) -> Double {
    abs((a - b + 540).truncatingRemainder(dividingBy: 360) - 180)
}

/// 한 fix의 표결.
///
/// ⚠ **"경로의 어느 부분과도 나란하지 않은가"를 묻는다.** 단일 지점 접선과 비교하면
/// 모퉁이를 도는 동안 헛경고가 쏟아진다 — 사람은 2~3초에 급히 꺾는데 접선은 15m
/// 폭으로 완만하기 때문이다. 도는 중에도 꺾기 전이나 꺾은 뒤 방향과는 나란하다.
public func courseVote(
    _ obs: DerivedCourse?, poly: GuidePolyline, d: Double
) -> CourseVote {
    guard let obs else { return .unknown }
    let course = obs.bearing
    // 유도기 계산값이라 범위가 보장되지만 방어로 유지한다(비용 0).
    guard course.isFinite, course >= 0, course < 360 else { return .unknown }
    guard obs.uncertaintyDeg.isFinite, obs.uncertaintyDeg >= 0 else { return .unknown }

    var best: Double?
    var offset = -courseAxisBackMeters
    while offset <= courseAxisAheadMeters {
        if let t = tangentAt(poly, d: d + offset, halfMeters: courseAxisTangentHalfMeters) {
            let diff = angDiff(course, t)
            if best == nil || diff < best! { best = diff }
        }
        offset += courseAxisSampleStepMeters
    }
    // 유효 접선이 하나도 없으면 판정하지 않는다(0도로 접지 않는다).
    guard let best else { return .unknown }

    if best - obs.uncertaintyDeg > courseAxisThresholdDegrees { return .mismatch }
    if best + obs.uncertaintyDeg < courseAxisThresholdDegrees { return .match }
    return .unknown
}

/// 표를 창에 기록한다.
///
/// ⚠ **같은 시각의 중복 fix는 하나로 합친다.** 안 그러면 배치 도착한 fix 묶음이
/// 2초 움직임으로 20초 창의 다수를 장악한다.
public func recordVote(
    _ samples: [CourseVoteSample], at: Double, vote: CourseVote
) -> [CourseVoteSample] {
    var kept = samples.filter { $0.at > at - courseAxisWindowSeconds && $0.at != at }
    kept.append(CourseVoteSample(at: at, vote: vote))
    return kept
}

/// 창의 판정. `off`=이탈, `on`=경로 방향 정합, `unknown`=판정 불가.
///
/// ⚠ **`unknown`은 `on`이 아니다.** 판정 근거가 없는데 정합으로 접으면, 실제 방향을
/// 전혀 모르는 상태에서 "돌아왔습니다"를 발화하게 된다(3-state 불변식).
public func courseAxisVerdict(_ samples: [CourseVoteSample]) -> CourseAxisVerdict {
    let decisive = samples.filter { $0.vote != .unknown }
    guard decisive.count >= courseAxisMinVotes else { return .unknown }
    guard Double(decisive.count) / Double(samples.count) >= courseAxisMinDecisiveRatio else {
        return .unknown
    }
    let ats = decisive.map(\.at)
    guard let hi = ats.max(), let lo = ats.min(), hi - lo >= courseAxisMinSpanSeconds else {
        return .unknown
    }
    let ratio = Double(decisive.filter { $0.vote == .mismatch }.count) / Double(decisive.count)
    if ratio >= courseAxisConfirmRatio { return .off }
    if ratio <= courseAxisClearRatio { return .on }
    return .unknown
}
