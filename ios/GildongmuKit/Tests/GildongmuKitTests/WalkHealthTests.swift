import Testing
@testable import GildongmuKit

/// 도착 화면 걸음·칼로리 요약(spec 2026-08-17 §4). 활동 칼로리 = 거리(km)×체중×0.5 —
/// ACSM 보행식에서 휴식 대사 3.5를 뺀 순 보행분은 시간이 소거되어 거리만 남는다.
@Suite struct WalkHealthTests {
    @Test func oneKilometerAt65kgIs33kcal() {
        let s = WalkHealth.summary(steps: 1400, distanceMeters: 1000, weightKg: 65)
        #expect(s == WalkHealthSummary(steps: 1400, kcal: 33, usedDefaultWeight: false))
    }

    @Test func distanceScalesLinearly() {
        let s = WalkHealth.summary(steps: 3000, distanceMeters: 2400, weightKg: 80)
        #expect(s.kcal == 96)
    }

    @Test func nilDistanceFallsBackToStride() {
        // 1,000걸음 × 0.7m = 700m × 65kg × 0.5/1000 = 22.75 → 23
        let s = WalkHealth.summary(steps: 1000, distanceMeters: nil, weightKg: 65)
        #expect(s.kcal == 23)
    }

    @Test func zeroStepsZeroDistanceIsZeroKcal() {
        let s = WalkHealth.summary(steps: 0, distanceMeters: 0, weightKg: 65)
        #expect(s == WalkHealthSummary(steps: 0, kcal: 0, usedDefaultWeight: false))
    }

    @Test func missingOrOutOfRangeWeightUsesDefault() {
        for w in [nil, 0, 19.9, 300.1, -5] as [Double?] {
            let s = WalkHealth.summary(steps: 1400, distanceMeters: 1000, weightKg: w)
            #expect(s.usedDefaultWeight, "weight \(String(describing: w))")
            #expect(s.kcal == 33)
        }
        #expect(WalkHealth.normalizedWeight(20) == 20)
        #expect(WalkHealth.normalizedWeight(300) == 300)
        #expect(WalkHealth.normalizedWeight(0) == nil)
    }

    @Test func negativeOrNaNInputsClampToZero() {
        #expect(WalkHealth.summary(steps: -3, distanceMeters: -10, weightKg: 65).steps == 0)
        #expect(WalkHealth.summary(steps: 10, distanceMeters: .nan, weightKg: 65).kcal
                == WalkHealth.summary(steps: 10, distanceMeters: nil, weightKg: 65).kcal)
        #expect(WalkHealth.summary(steps: 10, distanceMeters: .infinity, weightKg: 65).kcal
                == WalkHealth.summary(steps: 10, distanceMeters: nil, weightKg: 65).kcal)
    }
}
