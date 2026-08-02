import Testing
@testable import GildongmuKit

@Suite struct LocationFixTests {
    // MARK: - shouldAcceptFix

    @Test func acceptsGoodFreshFix() {
        #expect(shouldAcceptFix(accuracy: 8, age: 1))
        #expect(shouldAcceptFix(accuracy: 30, age: 10))   // 경계 포함
    }

    /// 음수 accuracy는 **좌표 무효 신호**다. 비콘 리듀서가 지키는 규칙이 단발
    /// 경로에도 적용되는지가 이 테스트의 핵심이다(계약이 갈려 있던 지점).
    @Test func rejectsInvalidAccuracy() {
        #expect(!shouldAcceptFix(accuracy: -1, age: 1))
        #expect(!shouldAcceptFix(accuracy: 0, age: 1))
        #expect(!shouldAcceptFix(accuracy: .nan, age: 1))
        #expect(!shouldAcceptFix(accuracy: .infinity, age: 1))
    }

    @Test func rejectsCoarseFix() {
        #expect(!shouldAcceptFix(accuracy: 31, age: 1))
        #expect(!shouldAcceptFix(accuracy: 100, age: 1))   // 종전 목표 정확도가 그대로 통과하던 값
        #expect(!shouldAcceptFix(accuracy: 5000, age: 1))  // reduced accuracy 규모
    }

    /// 캐시된 옛 fix가 "현재 위치"로 채택되던 결함의 회귀 가드.
    @Test func rejectsStaleFix() {
        #expect(!shouldAcceptFix(accuracy: 5, age: 11))
        #expect(!shouldAcceptFix(accuracy: 5, age: 600))
        #expect(!shouldAcceptFix(accuracy: 5, age: -1))    // 미래 timestamp도 신뢰하지 않는다
    }

    @Test func honorsInjectedThresholds() {
        #expect(shouldAcceptFix(accuracy: 50, age: 1, acceptAccuracy: 60, acceptAge: 10))
        #expect(!shouldAcceptFix(accuracy: 50, age: 1, acceptAccuracy: 40, acceptAge: 10))
    }

    // MARK: - isBetterFix

    @Test func picksSmallerAccuracy() {
        #expect(isBetterFix(10, than: 20))
        #expect(!isBetterFix(20, than: 10))
        #expect(!isBetterFix(10, than: 10))
    }

    @Test func anyValidFixBeatsNothing() {
        #expect(isBetterFix(500, than: nil))
    }

    /// 무효 좌표가 "최선값"으로 승격되면 타임아웃 경로가 쓰레기 좌표를 반환한다.
    @Test func invalidNeverBecomesBest() {
        #expect(!isBetterFix(-1, than: nil))
        #expect(!isBetterFix(-1, than: 100))
        #expect(!isBetterFix(.nan, than: nil))
    }

    /// 기존 최선값이 무효였다면 유효한 후보가 이긴다(무효가 자리를 점유하지 않는다).
    @Test func validReplacesInvalidIncumbent() {
        #expect(isBetterFix(80, than: -1))
    }

    // MARK: - isCacheFresh

    @Test func freshWithinTTL() {
        #expect(isCacheFresh(age: 0, ttl: 60))
        #expect(isCacheFresh(age: 60, ttl: 60))
        #expect(!isCacheFresh(age: 61, ttl: 60))
    }

    /// 나이를 모르는 캐시를 신선으로 치면 수명 무한이던 종전 동작으로 되돌아간다.
    @Test func unknownAgeIsNotFresh() {
        #expect(!isCacheFresh(age: nil, ttl: 60))
        #expect(!isCacheFresh(age: nil, ttl: .greatestFiniteMagnitude))
    }

    @Test func negativeAgeIsNotFresh() {
        #expect(!isCacheFresh(age: -5, ttl: 60))
    }

    /// 두 수명이 서로 다른 용도를 위해 존재한다는 계약(주장용 vs 순위 가중용).
    @Test func softTTLIsLooserThanFresh() {
        #expect(LocationFixPolicy.softTTL > LocationFixPolicy.freshTTL)
        #expect(isCacheFresh(age: 120, ttl: LocationFixPolicy.softTTL))
        #expect(!isCacheFresh(age: 120, ttl: LocationFixPolicy.freshTTL))
    }

    // MARK: - isStorableFix (스토어 갱신 기준)

    /// 저장 상한은 수용 기준보다 느슨하다 — 스트림에는 "더 나은 것을 기다리는 창"이
    /// 없어 상한을 좁히면 값이 낡은 채 굳는다.
    @Test func storableIsLooserThanAcceptable() {
        #expect(isStorableFix(accuracy: 40, age: 1))
        #expect(!shouldAcceptFix(accuracy: 40, age: 1))
    }

    /// km급 셀·Wi-Fi 좌표는 어떤 용도로도 위치가 아니다.
    @Test func storableRejectsCellScaleFix() {
        #expect(!isStorableFix(accuracy: 101, age: 1))
        #expect(!isStorableFix(accuracy: 2000, age: 1))
    }

    /// 나이는 수용 기준과 동일하게 엄격하다(낡은 fix는 어디에도 못 들어간다).
    @Test func storableStillRejectsStale() {
        #expect(!isStorableFix(accuracy: 5, age: 11))
        #expect(!isStorableFix(accuracy: 5, age: -1))
    }

    @Test func storableRejectsInvalid() {
        #expect(!isStorableFix(accuracy: -1, age: 1))
        #expect(!isStorableFix(accuracy: .nan, age: 1))
    }

    // MARK: - canReuseCachedFix (캐시 읽기 기준)

    /// **핵심 계약**: 저장은 100m까지 허용하지만 재사용은 30m까지다. 나이만 보는
    /// 읽기는 게이트가 거부한 좌표를 "현재 위치"로 승격시킨다.
    @Test func reuseRejectsCoarseButStoredFix() {
        #expect(isStorableFix(accuracy: 80, age: 1))          // 저장은 된다
        #expect(!canReuseCachedFix(accuracy: 80, age: 5, ttl: 60))  // 재사용은 안 된다
    }

    @Test func reuseAcceptsGoodFreshCache() {
        #expect(canReuseCachedFix(accuracy: 10, age: 5, ttl: 60))
        #expect(canReuseCachedFix(accuracy: 30, age: 60, ttl: 60))  // 경계 포함
    }

    @Test func reuseRejectsExpired() {
        #expect(!canReuseCachedFix(accuracy: 10, age: 61, ttl: 60))
    }

    /// 정확도를 모르는 캐시는 재사용하지 않는다(정확도 미기록 캐시가 곧 결함이었다).
    @Test func reuseRejectsUnknownAccuracy() {
        #expect(!canReuseCachedFix(accuracy: nil, age: 5, ttl: 60))
        #expect(!canReuseCachedFix(accuracy: -1, age: 5, ttl: 60))
    }

    @Test func reuseRejectsUnknownAge() {
        #expect(!canReuseCachedFix(accuracy: 10, age: nil, ttl: 60))
    }
}
