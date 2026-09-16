package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * 안내 경로 origin 선택(A18) — Kit `RouteOriginTests` 미러. "첫 fix"와 "가장 나쁜 fix"가 같은 fix인 세션 시작
 * 국면에서, 정확한 fix는 즉시 쓰고 그 전까지는 최선값만 보관하는지를 못 박는다.
 */
class RouteOriginTest {
    private fun fix(acc: Double, age: Double = 1.0, lat: Double = 37.5, lng: Double = 127.1) =
        RouteOriginFix(lat = lat, lng = lng, accuracy = acc, ageSeconds = age)

    @Test fun `수용 fix는 즉시 조회한다`() {
        val f = fix(8.0)
        assertEquals(RouteOriginDecision.Fetch(f), routeOriginStep(null, f))
        assertEquals(RouteOriginDecision.Fetch(fix(30.0, age = 10.0)), routeOriginStep(null, fix(30.0, age = 10.0))) // 경계 포함
    }

    /** 보관 중인 최선값이 있어도 수용 fix가 오면 그 fix로 간다(최선값은 대기용이다). */
    @Test fun `수용 fix가 보관 최선값을 이긴다`() {
        val f = fix(12.0, lat = 37.6)
        assertEquals(RouteOriginDecision.Fetch(f), routeOriginStep(fix(45.0), f))
    }

    /** 종전 코드가 그대로 origin으로 삼던 fix다 — 변이 주입의 기준 케이스. */
    @Test fun `거친 첫 fix는 대기하고 최선값이 된다`() {
        val f = fix(45.0)
        assertEquals(RouteOriginDecision.Wait(f), routeOriginStep(null, f))
    }

    @Test fun `더 나쁜 후보는 기존 최선값을 유지한다`() {
        val best = fix(45.0)
        assertEquals(RouteOriginDecision.Wait(best), routeOriginStep(best, fix(80.0)))
        assertEquals(RouteOriginDecision.Wait(best), routeOriginStep(best, fix(45.0, lat = 37.9))) // 동률은 유지
    }

    @Test fun `더 나은 후보가 최선값을 교체한다`() {
        val f = fix(40.0, lat = 37.7)
        assertEquals(RouteOriginDecision.Wait(f), routeOriginStep(fix(45.0), f))
    }

    /** km급 셀 측위 좌표는 어떤 용도로도 위치가 아니다(`storeCeiling`). */
    @Test fun `상한 밖 fix는 후보가 아니다`() {
        assertEquals(RouteOriginDecision.Wait(null), routeOriginStep(null, fix(150.0)))
        val best = fix(45.0)
        assertEquals(RouteOriginDecision.Wait(best), routeOriginStep(best, fix(150.0)))
    }

    @Test fun `낡은 fix는 수용도 후보도 아니다`() {
        assertEquals(RouteOriginDecision.Wait(null), routeOriginStep(null, fix(5.0, age = 11.0)))
        assertEquals(RouteOriginDecision.Wait(null), routeOriginStep(null, fix(5.0, age = -1.0)))
    }

    @Test fun `무효 정확도는 무시한다`() {
        assertEquals(RouteOriginDecision.Wait(null), routeOriginStep(null, fix(-1.0)))
        assertEquals(RouteOriginDecision.Wait(null), routeOriginStep(null, fix(0.0)))
        assertEquals(RouteOriginDecision.Wait(null), routeOriginStep(null, fix(Double.NaN)))
    }

    @Test fun `주입한 임계를 따른다`() {
        val f = fix(50.0)
        assertEquals(RouteOriginDecision.Fetch(f), routeOriginStep(null, f, acceptAccuracy = 60.0))
        assertEquals(RouteOriginDecision.Wait(null), routeOriginStep(null, f, acceptAccuracy = 40.0, ceiling = 45.0))
    }
}
