import Foundation

/// 이탈 판정 방위 축(spec 2026-08-09). 웹 `guide-course-axis.ts` 미러.
///
/// 수직거리 축이 못 보는 이탈(자기근접으로 수직거리가 무너지는 갈림, 역주행)을
/// 진행 방위로 잡는다. 두 축은 독립 병렬이고 확정은 OR, 복귀는 활성 축 전체 해제다.
///
/// ⚠ **`courseAccuracy`는 통과권이 아니라 불확실성이다.** 기존 `courseStep`의 45°
/// 게이트는 4분할 방향 어절 생략 기준이지 이탈 증명 기준이 아니다.
///
/// 상수의 근거는 웹 `__tests__/a6-probe.test.ts`가 실경로 5개를 재생해 잰다(잠정
/// 모델 기준). 가혹 조건(기기가 자기 오차를 절반으로 축소 보고) 헛경고: 판정 가능
/// 비율 게이트 없음 56% → 있음·임계 45° 23% → 있음·임계 60° 4.0%. 대가는 검출
/// 속도다(이탈 255건 중앙: 현행 54초, 임계 45° 27초, 임계 60° 46초).
/// **거짓 이탈 경고가 지연보다 해롭다고 보고 보수적 값에서 출발한다.**

/// ⚠ 잠정값(spec §6·§7) — 실기기 로그로 확정한다.
public let courseAxisThresholdDegrees = 60.0
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
/// ⚠ 잠정값(spec §6·§7). 이 이상 부정확한 fix는 투영점이 틀려 접선 비교가 무의미하다.
public let courseAxisMaxAccuracyMeters = 12.0
/// ⚠ 잠정값(spec §6·§7). 대조 접선 표본 간격(m) — 검출 입도라 다른 상수와 같은 부류다.
private let courseAxisSampleStepMeters = 5.0

/// 기기 방위 관측. `state`는 기존 `courseStep` 결과이고 `accuracyDeg`는 그 원본
/// 불확실성이다.
///
/// ⚠ **둘을 함께 넘긴다.** `state`만 넘기면 불확실성이 사라져 이 축이 다시
/// 통과권 방식으로 되돌아간다.
public struct CourseObservation: Sendable, Equatable {
    public let state: CourseState
    public let accuracyDeg: Double

    public init(state: CourseState, accuracyDeg: Double) {
        self.state = state
        self.accuracyDeg = accuracyDeg
    }
}

/// 방위를 제공하지 않는 경로가 넘기는 값. 축이 통째로 꺼진다.
public let inactiveCourse = CourseObservation(state: .unknown, accuracyDeg: 0)

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
    _ obs: CourseObservation, poly: GuidePolyline, d: Double, fixAccuracy: Double
) -> CourseVote {
    guard case let .valid(course) = obs.state else { return .unknown }
    guard course.isFinite, course >= 0, course < 360 else { return .unknown }
    guard obs.accuracyDeg.isFinite, obs.accuracyDeg >= 0 else { return .unknown }
    guard fixAccuracy > 0, fixAccuracy <= courseAxisMaxAccuracyMeters else { return .unknown }

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

    if best - obs.accuracyDeg > courseAxisThresholdDegrees { return .mismatch }
    if best + obs.accuracyDeg < courseAxisThresholdDegrees { return .match }
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
