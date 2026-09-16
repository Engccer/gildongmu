package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 통지 게이트 계약 — Kit `BeaconGateTests` 미러. 톤 창(추세 2초·tick 3초) 계약은 `GuideToneLayerTest`가 본다.
 * 여기 남은 톤 축은 **도착 톤 소유 판정** 하나뿐이다.
 */
class BeaconGateTest {
    private fun announce(kind: AnnounceKind, distance: Double = 100.0, accuracy: Double = 10.0, speak: Boolean = false) =
        BeaconAnnounce(kind, distance, accuracy, speak)

    private fun gate(state: BeaconGateState, a: BeaconAnnounce) = beaconGateStep(state, a)

    // ── 도착 톤 소유 ──

    /** 리듀서 래치는 음성만 막고 톤은 매 fix 흐른다. 도착해 서 있는 동안 톤이 GPS 주기로 반복되면 안 된다. */
    @Test fun `도착 톤은 존 진입당 한 번만 난다`() {
        val first = gate(BeaconGateState.initial, announce(AnnounceKind.nearby, speak = true))
        assertTrue(first.nearbyTone)
        var s = first.state
        repeat(4) {
            val r = gate(s, announce(AnnounceKind.nearby))
            assertFalse(r.nearbyTone)
            s = r.state
        }
    }

    /** 존 경계에서 흔들리는 것(hold)은 재진입이 아니다. */
    @Test fun `히스테리시스 hold는 도착 톤을 재무장하지 않는다`() {
        var s = gate(BeaconGateState.initial, announce(AnnounceKind.nearby)).state
        s = gate(s, announce(AnnounceKind.hold)).state
        assertFalse(gate(s, announce(AnnounceKind.nearby)).nearbyTone)
    }

    @Test fun `추세가 재개되면 다음 도착은 다시 알린다`() {
        var s = gate(BeaconGateState.initial, announce(AnnounceKind.nearby)).state
        s = gate(s, announce(AnnounceKind.farther)).state
        assertTrue(gate(s, announce(AnnounceKind.nearby)).nearbyTone)
    }

    @Test fun `nearby가 아닌 종류는 톤을 소유하지 않는다`() {
        for (kind in listOf(AnnounceKind.first, AnnounceKind.weak, AnnounceKind.hold, AnnounceKind.closer, AnnounceKind.farther)) {
            assertFalse(gate(BeaconGateState.initial, announce(kind)).nearbyTone, "$kind")
        }
    }

    // ── 통지 ──

    @Test fun `발화 통지는 반올림한 거리를 싣는다`() {
        assertEquals(BeaconNotice.Closer(123), gate(BeaconGateState.initial, announce(AnnounceKind.closer, distance = 123.4, speak = true)).notice)
    }

    /** 문구가 "목적지 근처 (약 ±N m)"로 **오차 반경**을 말한다. distance를 넣으면 의미가 뒤집힌다. */
    @Test fun `nearby 통지는 거리가 아니라 정확도를 싣는다`() {
        val r = gate(BeaconGateState.initial, announce(AnnounceKind.nearby, distance = 7.0, accuracy = 12.4, speak = true))
        assertEquals(BeaconNotice.Nearby(12), r.notice)
    }

    @Test fun `발화하지 않는 추세는 통지가 없다`() {
        assertNull(gate(BeaconGateState.initial, announce(AnnounceKind.closer, speak = false)).notice)
    }

    /** weak은 리듀서에서 항상 speak=false다. speak만 보고 통지를 내면 신호 약함이 영영 통지되지 않는다. */
    @Test fun `weak 통지는 전이에서만`() {
        var s = gate(BeaconGateState.initial, announce(AnnounceKind.closer, speak = true)).state
        val enter = gate(s, announce(AnnounceKind.weak))
        assertEquals(BeaconNotice.Weak, enter.notice)
        s = enter.state
        repeat(3) {
            val r = gate(s, announce(AnnounceKind.weak))
            assertNull(r.notice)
            s = r.state
        }
        s = gate(s, announce(AnnounceKind.closer, speak = true)).state
        assertEquals(BeaconNotice.Weak, gate(s, announce(AnnounceKind.weak)).notice)
    }

    @Test fun `첫 안내는 통지를 싣는다 — 반올림은 0에서 먼 쪽`() {
        assertEquals(BeaconNotice.First(303), gate(BeaconGateState.initial, announce(AnnounceKind.first, distance = 302.6, speak = true)).notice)
        // Swift `rounded()`는 .5를 올린다(Kotlin `round`의 짝수 반올림이면 302).
        assertEquals(BeaconNotice.First(303), gate(BeaconGateState.initial, announce(AnnounceKind.first, distance = 302.5, speak = true)).notice)
    }

    /** weak 억제는 "직전이 weak인가"로만 판정해야 한다. hold를 거치면 재통지가 맞다. */
    @Test fun `weak은 다른 종류를 거치면 재통지한다`() {
        var s = gate(BeaconGateState.initial, announce(AnnounceKind.weak)).state
        s = gate(s, announce(AnnounceKind.hold)).state
        assertEquals(BeaconNotice.Weak, gate(s, announce(AnnounceKind.weak)).notice)
    }

    @Test fun `hold는 통지가 없다`() {
        assertNull(gate(BeaconGateState.initial, announce(AnnounceKind.hold)).notice)
    }
}
