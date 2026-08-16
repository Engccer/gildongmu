import Foundation

/// 도착 화면 걸음·칼로리 요약(spec 2026-08-17 §4).
public struct WalkHealthSummary: Equatable, Sendable {
    public let steps: Int
    /// 활동 칼로리(반올림 정수). 휴식 대사분은 포함하지 않는다.
    public let kcal: Int
    /// 체중 미입력·범위 밖이라 기본 체중으로 계산했는가(화면이 "기준 체중" 꼬리를 붙인다).
    public let usedDefaultWeight: Bool

    public init(steps: Int, kcal: Int, usedDefaultWeight: Bool) {
        self.steps = steps
        self.kcal = kcal
        self.usedDefaultWeight = usedDefaultWeight
    }
}

public enum WalkHealth {
    public static let defaultWeightKg: Double = 65
    /// 만보계가 거리를 주지 않을 때의 보폭.
    public static let fallbackStrideMeters: Double = 0.7
    /// ACSM 보행식 `VO2 = 3.5 + 0.1×v`에서 휴식 대사 3.5를 뺀 순 보행분:
    /// `0.1×v(m/min) × 체중/200 (kcal/min)`에 시간을 곱하면 `0.0005 × 거리(m) × 체중`.
    /// 시간이 소거되어 정지·속도가 결과에 들어오지 않고 0거리는 정의상 0kcal다.
    public static let netKcalPerKgKm: Double = 0.5
    /// UserDefaults 키(설정 "칼로리 추정용 체중"). 0 = 미입력.
    public static let weightStorageKey = "walkWeightKg"
    public static let weightRange: ClosedRange<Double> = 20...300

    /// 저장값 → 유효 체중. 범위 밖·nil·비유한값은 nil(=기본 체중 사용).
    public static func normalizedWeight(_ raw: Double?) -> Double? {
        guard let raw, raw.isFinite, weightRange.contains(raw) else { return nil }
        return raw
    }

    public static func summary(steps: Int, distanceMeters: Double?, weightKg: Double?) -> WalkHealthSummary {
        let safeSteps = max(0, steps)
        let meters: Double
        if let d = distanceMeters, d.isFinite, d > 0 {
            meters = d
        } else {
            meters = Double(safeSteps) * fallbackStrideMeters
        }
        let weight = normalizedWeight(weightKg)
        let kcal = (meters / 1000) * (weight ?? defaultWeightKg) * netKcalPerKgKm
        return WalkHealthSummary(
            steps: safeSteps,
            kcal: Int(kcal.rounded()),
            usedDefaultWeight: weight == nil
        )
    }
}
