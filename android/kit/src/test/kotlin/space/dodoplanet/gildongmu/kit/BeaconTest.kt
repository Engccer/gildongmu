package space.dodoplanet.gildongmu.kit

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 웹 `beacon.test.ts` 케이스 + iOS 고유 가드 — Kit `BeaconTests` 미러. 두 플랫폼이 같은 입력에 같은 판정을
 * 내는지가 이 스위트의 계약이다. 목적지는 서울시청 부근, 같은 경도선에서 위도차로 거리를 만든다.
 */
class BeaconTest {
    private val dest = BeaconDest(37.5665, 126.978)

    private fun fixAt(metersNorth: Double, accuracy: Double = 10.0) =
        BeaconFix(dest.lat + metersNorth / 111_320, dest.lng, accuracy)

    private fun step(state: BeaconState, metersNorth: Double, accuracy: Double = 10.0) =
        beaconStep(state, fixAt(metersNorth, accuracy), dest)

    // ── beaconStep ──

    @Test fun `첫 fix는 앵커를 잡고 발화한다`() {
        val r = step(BeaconState.initial, 300.0)
        assertEquals(AnnounceKind.first, r.announce.kind)
        assertTrue(r.announce.speak)
        assertTrue(r.announce.distance > 250)
        assertNotNull(r.state.anchorDistance)
    }

    @Test fun `데드밴드가 흔들림을 억제한다`() {
        var s = step(BeaconState.initial, 300.0).state
        for (d in listOf(305.0, 295.0, 308.0, 293.0)) {
            val r = step(s, d)
            assertEquals(AnnounceKind.hold, r.announce.kind)
            s = r.state
        }
    }

    @Test fun `데드밴드를 넘으면 closer·farther`() {
        val s = step(BeaconState.initial, 300.0).state
        assertEquals(AnnounceKind.closer, step(s, 250.0).announce.kind)
        assertEquals(AnnounceKind.farther, step(s, 350.0).announce.kind)
    }

    @Test fun `정확도 상한 초과는 weak이고 앵커를 유지한다`() {
        val s = step(BeaconState.initial, 300.0).state
        val r = step(s, 200.0, accuracy = 150.0)
        assertEquals(AnnounceKind.weak, r.announce.kind)
        assertEquals(s.anchorDistance, r.state.anchorDistance)
    }

    /** 음수 정확도는 좌표 무효 신호이고, 통과시키면 deadBand가 15로 잡혀 쓰레기 좌표가 앵커가 된다. */
    @Test fun `음수 정확도는 weak이고 앵커를 잡지 않는다`() {
        val r = step(BeaconState.initial, 300.0, accuracy = -1.0)
        assertEquals(AnnounceKind.weak, r.announce.kind)
        assertNull(r.state.anchorDistance)
    }

    @Test fun `정확도 0은 weak`() {
        assertEquals(AnnounceKind.weak, step(BeaconState.initial, 300.0, accuracy = 0.0).announce.kind)
    }

    /** 이 기능의 핵심. 정확도가 나쁘면 데드밴드가 커져 같은 변화가 추세가 아니게 된다. */
    @Test fun `데드밴드는 정확도로 스케일한다`() {
        val s = step(BeaconState.initial, 300.0, accuracy = 60.0).state
        assertEquals(AnnounceKind.hold, step(s, 260.0, accuracy = 60.0).announce.kind) // 40m 감소 < deadBand 60
    }

    @Test fun `추세 반전은 마일스톤 미달이어도 발화한다`() {
        var s = step(BeaconState.initial, 300.0).state
        s = step(s, 280.0).state
        val r = step(s, 300.0)
        assertEquals(AnnounceKind.farther, r.announce.kind)
        assertTrue(r.announce.speak)
    }

    @Test fun `farther는 50m 마일스톤을 유지한다`() {
        val s0 = step(BeaconState.initial, 300.0).state
        val r1 = step(s0, 330.0)
        assertEquals(AnnounceKind.farther, r1.announce.kind)
        assertFalse(r1.announce.speak) // 30m < 50 — 경고 축은 촘촘한 간격 유지
        assertTrue(step(r1.state, 355.0).announce.speak) // 누적 55m ≥ 50
    }

    @Test fun `closer는 근거리에서 적응형 마일스톤을 쓴다`() {
        // 300m 이내는 100m 간격 — 종전 50m 정책이면 245m에서 발화했다(웹 미러).
        val s0 = step(BeaconState.initial, 300.0).state
        val r1 = step(s0, 280.0)
        assertEquals(AnnounceKind.closer, r1.announce.kind)
        assertFalse(r1.announce.speak)
        val r2 = step(r1.state, 245.0)
        assertFalse(r2.announce.speak) // 누적 55m < 100
        assertTrue(step(r2.state, 195.0).announce.speak) // 누적 105m ≥ 100
    }

    @Test fun `closer는 장거리에서 500m 간격`() {
        val s0 = step(BeaconState.initial, 2000.0).state
        val r1 = step(s0, 1700.0)
        assertEquals(AnnounceKind.closer, r1.announce.kind)
        assertFalse(r1.announce.speak) // 누적 300m < 500
        assertTrue(step(r1.state, 1450.0).announce.speak) // 누적 550m ≥ 500
    }

    @Test fun `closer는 초장거리에서 1km 간격`() {
        val s0 = step(BeaconState.initial, 8000.0).state
        val r1 = step(s0, 7200.0)
        assertEquals(AnnounceKind.closer, r1.announce.kind)
        assertFalse(r1.announce.speak) // 누적 800m < 1000
        assertTrue(step(r1.state, 6900.0).announce.speak) // 누적 1,100m ≥ 1000
    }

    @Test fun `도착 래치는 진입 때 한 번만 발화한다`() {
        val s = step(BeaconState.initial, 300.0).state
        val r = step(s, 15.0, accuracy = 12.0)
        assertEquals(AnnounceKind.nearby, r.announce.kind)
        assertTrue(r.announce.speak)
        assertTrue(r.state.nearby)
        val r2 = step(r.state, 14.0, accuracy = 12.0)
        assertEquals(AnnounceKind.nearby, r2.announce.kind)
        assertFalse(r2.announce.speak)
    }

    @Test fun `도착 래치는 히스테리시스를 넘어야 풀린다`() {
        val s0 = step(BeaconState.initial, 300.0).state
        val near = step(s0, 15.0).state
        // threshold(20) + deadBand(15) 이내는 아직 래치 유지 + hold 침묵
        val held = step(near, 30.0)
        assertEquals(AnnounceKind.hold, held.announce.kind)
        assertTrue(held.state.nearby)
        // 그 너머는 이탈하고 추세 재개
        val out = step(near, 120.0)
        assertFalse(out.state.nearby)
        assertEquals(AnnounceKind.farther, out.announce.kind)
    }

    /** 도착 임계값도 accuracy로 스케일한다. 정확도가 나쁘면 더 멀리서 "도착"이다. */
    @Test fun `도착 임계는 정확도로 스케일한다`() {
        val s = step(BeaconState.initial, 300.0).state
        assertEquals(AnnounceKind.nearby, step(s, 40.0, accuracy = 60.0).announce.kind)
        assertEquals(AnnounceKind.closer, step(s, 40.0, accuracy = 5.0).announce.kind)
    }

    @Test fun `hold는 발화하지 않는다`() {
        val s = step(BeaconState.initial, 300.0).state
        val r = step(s, 305.0)
        assertEquals(AnnounceKind.hold, r.announce.kind)
        assertFalse(r.announce.speak)
    }

    @Test fun `비유한 좌표는 weak`() {
        val s = step(BeaconState.initial, 300.0).state
        val r = beaconStep(s, BeaconFix(Double.NaN, Double.NaN, 10.0), dest)
        assertEquals(AnnounceKind.weak, r.announce.kind)
        assertEquals(s.anchorDistance, r.state.anchorDistance)
    }

    // ── 하버사인: 기준값은 웹 `haversineMeters` 실행 출력, 허용 오차 1mm ──

    @Test fun `하버사인은 웹 출력과 같다`() {
        assertEquals(0.0, haversineMeters(37.5, 127.0, 37.5, 127.0))
        assertTrue(abs(haversineMeters(37.5, 127.0, 37.501, 127.0) - 111.19492664429958) < 0.001)
        assertTrue(abs(haversineMeters(37.5665, 126.978, 37.4979, 127.0276) - 8792.890880750394) < 0.001)
    }

    // ── fix 신선도 ──

    @Test fun `신선하고 정확한 fix는 쓸 수 있다`() {
        assertTrue(isUsableFix(10.0, 0.0))
        assertTrue(isUsableFix(65.0, 4.9))
    }

    @Test fun `낡은 fix는 거부한다`() {
        assertFalse(isUsableFix(10.0, 5.1))
        assertFalse(isUsableFix(10.0, 120.0))
    }

    @Test fun `미래 timestamp는 거부한다`() {
        assertFalse(isUsableFix(10.0, -30.0))
    }

    @Test fun `무효 정확도는 거부한다`() {
        assertFalse(isUsableFix(-1.0, 0.0))
        assertFalse(isUsableFix(0.0, 0.0))
    }

    @Test fun `창은 설정 가능하다`() {
        assertTrue(isUsableFix(10.0, 20.0, maxAge = 30.0))
    }

    // ── 추세 판정 추출(두 모드가 공유하는 유일한 축) ──

    @Test fun `앵커가 없으면 현재 거리를 앵커로 잡고 hold`() {
        assertEquals(TrendStepResult(TrendKind.hold, 100.0, BeaconTrend.none), trendStep(null, BeaconTrend.none, 100.0, 15.0))
    }

    @Test fun `데드밴드를 넘어 줄면 closer이고 앵커가 전진한다`() {
        assertEquals(TrendStepResult(TrendKind.closer, 84.0, BeaconTrend.closer), trendStep(100.0, BeaconTrend.none, 84.0, 15.0))
    }

    @Test fun `데드밴드를 넘어 늘면 farther`() {
        val r = trendStep(100.0, BeaconTrend.closer, 116.0, 15.0)
        assertEquals(TrendKind.farther, r.kind)
        assertEquals(BeaconTrend.farther, r.trend)
    }

    @Test fun `데드밴드 안이면 hold이고 앵커·추세가 불변이다`() {
        assertEquals(TrendStepResult(TrendKind.hold, 100.0, BeaconTrend.closer), trendStep(100.0, BeaconTrend.closer, 90.0, 15.0))
    }

    @Test fun `경계값은 포함이다`() {
        assertEquals(TrendKind.closer, trendStep(100.0, BeaconTrend.none, 85.0, 15.0).kind)
        assertEquals(TrendKind.farther, trendStep(100.0, BeaconTrend.none, 115.0, 15.0).kind)
    }

    // ── 축 전환 재기준화 ──

    @Test fun `방향만 승계하고 앵커·발화 기준을 둘 다 새 축 값으로 재설정한다`() {
        val state = BeaconState.initial.copy(anchorDistance = 500.0, trend = BeaconTrend.closer, lastSpokenDistance = 500.0)
        val out = rebaseBeaconState(state, 120.0)
        assertEquals(120.0, out.anchorDistance)
        assertEquals(120.0, out.lastSpokenDistance)
        assertEquals(BeaconTrend.closer, out.trend)
        assertFalse(out.nearby)
    }

    @Test fun `새 축 값을 모르면 null로 두어 다음 fix가 first 경로를 탄다`() {
        val state = BeaconState(anchorDistance = 500.0, trend = BeaconTrend.farther, lastSpokenDistance = 500.0, nearby = true)
        val out = rebaseBeaconState(state, null)
        assertNull(out.anchorDistance)
        assertNull(out.lastSpokenDistance)
        assertEquals(BeaconTrend.farther, out.trend)
        assertFalse(out.nearby)
    }
}
