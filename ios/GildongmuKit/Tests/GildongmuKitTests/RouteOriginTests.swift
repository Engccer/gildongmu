import Testing
@testable import GildongmuKit

/// 안내 경로 origin 선택(A18). "첫 fix"와 "가장 나쁜 fix"가 같은 fix인 세션 시작
/// 국면에서, 정확한 fix는 즉시 쓰고 그 전까지는 최선값만 보관하는지를 못 박는다.
@Suite struct RouteOriginTests {
    private func fix(_ acc: Double, age: Double = 1, lat: Double = 37.5, lng: Double = 127.1) -> RouteOriginFix {
        RouteOriginFix(lat: lat, lng: lng, accuracy: acc, ageSeconds: age)
    }

    // MARK: - 즉시 조회

    @Test func acceptedFixFetchesImmediately() {
        let f = fix(8)
        #expect(routeOriginStep(best: nil, fix: f) == .fetch(f))
        #expect(routeOriginStep(best: nil, fix: fix(30, age: 10)) == .fetch(fix(30, age: 10)))  // 경계 포함
    }

    /// 보관 중인 최선값이 있어도 수용 fix가 오면 그 fix로 간다(최선값은 대기용이다).
    @Test func acceptedFixWinsOverStoredBest() {
        let f = fix(12, lat: 37.6)
        #expect(routeOriginStep(best: fix(45), fix: f) == .fetch(f))
    }

    // MARK: - 대기·최선값 보관 (실사고의 정확한 자리)

    /// 종전 코드가 그대로 origin으로 삼던 fix다. 정확도 상한이 없으면 이 테스트가
    /// `.fetch`를 받아 실패한다 — 변이 주입의 기준 케이스.
    @Test func coarseFirstFixWaitsAndBecomesBest() {
        let f = fix(45)
        #expect(routeOriginStep(best: nil, fix: f) == .wait(best: f))
    }

    @Test func worseCandidateKeepsIncumbentBest() {
        let best = fix(45)
        #expect(routeOriginStep(best: best, fix: fix(80)) == .wait(best: best))
        #expect(routeOriginStep(best: best, fix: fix(45, lat: 37.9)) == .wait(best: best))  // 동률은 유지
    }

    @Test func betterCandidateReplacesBest() {
        let f = fix(40, lat: 37.7)
        #expect(routeOriginStep(best: fix(45), fix: f) == .wait(best: f))
    }

    // MARK: - 후보 자격 (단발 취득 `oneShotBest`와 같은 상한)

    /// km급 셀 측위 좌표는 어떤 용도로도 위치가 아니다(`storeCeiling`).
    @Test func fixOverCeilingIsNotACandidate() {
        #expect(routeOriginStep(best: nil, fix: fix(150)) == .wait(best: nil))
        let best = fix(45)
        #expect(routeOriginStep(best: best, fix: fix(150)) == .wait(best: best))
    }

    @Test func staleFixIsNeitherAcceptedNorCandidate() {
        #expect(routeOriginStep(best: nil, fix: fix(5, age: 11)) == .wait(best: nil))
        #expect(routeOriginStep(best: nil, fix: fix(5, age: -1)) == .wait(best: nil))
    }

    @Test func invalidAccuracyIsIgnored() {
        #expect(routeOriginStep(best: nil, fix: fix(-1)) == .wait(best: nil))
        #expect(routeOriginStep(best: nil, fix: fix(0)) == .wait(best: nil))
        #expect(routeOriginStep(best: nil, fix: fix(.nan)) == .wait(best: nil))
    }

    @Test func honorsInjectedThresholds() {
        let f = fix(50)
        #expect(routeOriginStep(best: nil, fix: f, acceptAccuracy: 60) == .fetch(f))
        #expect(routeOriginStep(best: nil, fix: f, acceptAccuracy: 40, ceiling: 45) == .wait(best: nil))
    }
}
