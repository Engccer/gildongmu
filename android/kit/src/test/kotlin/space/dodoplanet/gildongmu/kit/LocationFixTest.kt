package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Kit `LocationFixTests` 미러. */
class LocationFixTest {
    @Test fun acceptsGoodFreshFix() {
        assertTrue(shouldAcceptFix(accuracy = 8.0, age = 1.0))
        assertTrue(shouldAcceptFix(accuracy = 30.0, age = 10.0)) // 경계 포함
    }

    /** 음수 accuracy는 좌표 무효 신호다(계약이 갈려 있던 지점). */
    @Test fun rejectsInvalidAccuracy() {
        assertFalse(shouldAcceptFix(accuracy = -1.0, age = 1.0))
        assertFalse(shouldAcceptFix(accuracy = 0.0, age = 1.0))
        assertFalse(shouldAcceptFix(accuracy = Double.NaN, age = 1.0))
        assertFalse(shouldAcceptFix(accuracy = Double.POSITIVE_INFINITY, age = 1.0))
    }

    @Test fun rejectsCoarseFix() {
        assertFalse(shouldAcceptFix(accuracy = 31.0, age = 1.0))
        assertFalse(shouldAcceptFix(accuracy = 100.0, age = 1.0))
        assertFalse(shouldAcceptFix(accuracy = 5000.0, age = 1.0))
    }

    @Test fun rejectsStaleFix() {
        assertFalse(shouldAcceptFix(accuracy = 5.0, age = Double.NaN)) // Swift `guard age >= 0`과 같이 NaN도 거른다
        assertFalse(isStorableFix(accuracy = 5.0, age = Double.NaN))
        assertFalse(isCacheFresh(age = Double.NaN, ttl = 60.0))
        assertFalse(shouldAcceptFix(accuracy = 5.0, age = 11.0))
        assertFalse(shouldAcceptFix(accuracy = 5.0, age = 600.0))
        assertFalse(shouldAcceptFix(accuracy = 5.0, age = -1.0)) // 미래 timestamp도 신뢰하지 않는다
    }

    @Test fun honorsInjectedThresholds() {
        assertTrue(shouldAcceptFix(accuracy = 50.0, age = 1.0, acceptAccuracy = 60.0, acceptAge = 10.0))
        assertFalse(shouldAcceptFix(accuracy = 50.0, age = 1.0, acceptAccuracy = 40.0, acceptAge = 10.0))
    }

    @Test fun picksSmallerAccuracy() {
        assertTrue(isBetterFix(10.0, than = 20.0))
        assertFalse(isBetterFix(20.0, than = 10.0))
        assertFalse(isBetterFix(10.0, than = 10.0))
    }

    @Test fun anyValidFixBeatsNothing() {
        assertTrue(isBetterFix(500.0, than = null))
    }

    @Test fun invalidNeverBecomesBest() {
        assertFalse(isBetterFix(-1.0, than = null))
        assertFalse(isBetterFix(-1.0, than = 100.0))
        assertFalse(isBetterFix(Double.NaN, than = null))
    }

    @Test fun validReplacesInvalidIncumbent() {
        assertTrue(isBetterFix(80.0, than = -1.0))
    }

    @Test fun freshWithinTTL() {
        assertTrue(isCacheFresh(age = 0.0, ttl = 60.0))
        assertTrue(isCacheFresh(age = 60.0, ttl = 60.0))
        assertFalse(isCacheFresh(age = 61.0, ttl = 60.0))
    }

    @Test fun unknownAgeIsNotFresh() {
        assertFalse(isCacheFresh(age = null, ttl = 60.0))
        assertFalse(isCacheFresh(age = null, ttl = Double.MAX_VALUE))
    }

    @Test fun negativeAgeIsNotFresh() {
        assertFalse(isCacheFresh(age = -5.0, ttl = 60.0))
    }

    @Test fun softTTLIsLooserThanFresh() {
        assertTrue(LocationFixPolicy.softTTL > LocationFixPolicy.freshTTL)
        assertTrue(isCacheFresh(age = 120.0, ttl = LocationFixPolicy.softTTL))
        assertFalse(isCacheFresh(age = 120.0, ttl = LocationFixPolicy.freshTTL))
    }

    @Test fun storableIsLooserThanAcceptable() {
        assertTrue(isStorableFix(accuracy = 40.0, age = 1.0))
        assertFalse(shouldAcceptFix(accuracy = 40.0, age = 1.0))
    }

    @Test fun storableRejectsCellScaleFix() {
        assertFalse(isStorableFix(accuracy = 101.0, age = 1.0))
        assertFalse(isStorableFix(accuracy = 2000.0, age = 1.0))
    }

    @Test fun storableStillRejectsStale() {
        assertFalse(isStorableFix(accuracy = 5.0, age = 11.0))
        assertFalse(isStorableFix(accuracy = 5.0, age = -1.0))
    }

    @Test fun storableRejectsInvalid() {
        assertFalse(isStorableFix(accuracy = -1.0, age = 1.0))
        assertFalse(isStorableFix(accuracy = Double.NaN, age = 1.0))
    }

    /** 핵심 계약: 저장은 100m까지 허용하지만 재사용은 30m까지다. */
    @Test fun reuseRejectsCoarseButStoredFix() {
        assertTrue(isStorableFix(accuracy = 80.0, age = 1.0))
        assertFalse(canReuseCachedFix(accuracy = 80.0, age = 5.0, ttl = 60.0))
    }

    @Test fun reuseAcceptsGoodFreshCache() {
        assertTrue(canReuseCachedFix(accuracy = 10.0, age = 5.0, ttl = 60.0))
        assertTrue(canReuseCachedFix(accuracy = 30.0, age = 60.0, ttl = 60.0))
    }

    @Test fun reuseRejectsExpired() {
        assertFalse(canReuseCachedFix(accuracy = 10.0, age = 61.0, ttl = 60.0))
    }

    @Test fun reuseRejectsUnknownAccuracy() {
        assertFalse(canReuseCachedFix(accuracy = null, age = 5.0, ttl = 60.0))
        assertFalse(canReuseCachedFix(accuracy = -1.0, age = 5.0, ttl = 60.0))
    }

    @Test fun reuseRejectsUnknownAge() {
        assertFalse(canReuseCachedFix(accuracy = 10.0, age = null, ttl = 60.0))
    }
}
