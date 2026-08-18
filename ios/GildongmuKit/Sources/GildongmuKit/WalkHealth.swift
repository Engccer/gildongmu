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

    /// 태운 칼로리를 한국 음식 한 단위에 빗댄다(위원장 요청 2026-08-18 — 수치만으로는
    /// 감이 없고, 외국인에게는 한국 음식 자체가 재미다). 문장은 앱 문자열
    /// `ios.beacon.food.<key>`(단위 1개)와 `ios.beacon.food.<key>Many`(최상단 항목 n단위)에 있다.
    /// 값은 흔히 알려진 대략치(kcal)이고 정밀 영양 정보가 아니다 — 문장도 "약"으로 말한다.
    public static let foodLadder: [(key: String, kcal: Double)] = [
        ("cherryTomato", 3),   // 방울토마토 한 알
        ("cucumberHalf", 8),   // 오이 반 개
        ("kimchi", 15),        // 김치 한 접시
        ("tangerine", 40),     // 귤 한 개
        ("boiledEgg", 75),     // 삶은 달걀 한 개
        ("apple", 95),         // 사과 한 개
        ("banana", 105),       // 바나나 한 개
        ("riceHalfBowl", 150), // 밥 반 공기
        ("hotteok", 200),      // 호떡 한 개
        ("riceBowl", 300),     // 밥 한 공기
        ("ramyeon", 500),      // 라면 한 그릇
    ]

    public struct FoodComparison: Equatable, Sendable {
        public let key: String
        /// 1이면 단위 1개 문장, 2 이상이면 최상단 항목의 n단위 문장.
        public let count: Int
    }

    /// 칼로리 → 가장 가까운 음식 단위(비율 기준 최근접). 사다리 최상단의 1.5배를 넘으면
    /// 최상단 항목 n단위로, 최하단의 절반에도 못 미치면 nil(비유가 성립하지 않으면 말하지 않는다).
    public static func foodComparison(kcal: Int) -> FoodComparison? {
        guard kcal > 0, let first = foodLadder.first, let last = foodLadder.last else { return nil }
        let value = Double(kcal)
        if value < first.kcal * 0.5 { return nil }
        if value > last.kcal * 1.5 {
            return FoodComparison(key: last.key, count: Int((value / last.kcal).rounded()))
        }
        let nearest = foodLadder.min { a, b in
            abs(log(value / a.kcal)) < abs(log(value / b.kcal))
        }!
        return FoodComparison(key: nearest.key, count: 1)
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
