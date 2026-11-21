package space.dodoplanet.gildongmu.guide

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 전경 서비스 손잡이의 판정(M5 §6-4·§7-4) — 세대 거름, 동기 거부, 여정 넘김(내리지 않고 이어받기·다음 턴 재결속). */
class GuideServiceRelayTest {
    private val launched = mutableListOf<Int>()
    private val rebound = mutableListOf<Int>()
    private val failed = mutableListOf<Int>()
    private var shutdowns = 0
    private var live = false
    private var reject: Throwable? = null
    private val posted = ArrayDeque<() -> Unit>()

    private val relay = GuideServiceRelay(
        launch = { gen -> reject ?: run { launched += gen; live = true; null } },
        onStartFailed = { gen, _ -> failed += gen },
        shutdown = { shutdowns += 1; live = false },
        rebind = { gen -> if (live) { rebound += gen; true } else false },
        serviceLive = { live },
        post = { posted.addLast(it) },
    )

    private fun drain() { while (posted.isNotEmpty()) posted.removeFirst()() }

    @Test fun `여정 없이는 종전대로 — 정지가 내리고 앞 세대의 늦은 정지는 무시한다`() {
        val a = relay.nextGeneration()
        relay.start(a)
        val b = relay.nextGeneration()
        relay.stop(a)
        relay.start(b)
        relay.stop(a)  // 늦은 정지
        assertEquals(listOf(a, b), launched)
        assertEquals(1, shutdowns)
        assertEquals(b, relay.current)
    }

    @Test fun `동기 거부는 세대를 비운 뒤 시작 실패로 넘긴다`() {
        reject = IllegalStateException("bg")
        val a = relay.nextGeneration()
        relay.start(a)
        assertNull(relay.current)
        assertEquals(listOf(a), failed)
        relay.stop(a)  // 실패 처리의 정지는 늦은 정지로 버려진다
        assertEquals(0, shutdowns)
    }

    @Test fun `여정 동안 단계 경계는 내리지 않고 넘기며 재결속은 다음 턴이다`() {
        var holder: Int? = null
        relay.retainer = { relay.nextGeneration().also { holder = it } }
        val walk = relay.nextGeneration()
        relay.start(walk)
        relay.stop(walk)
        assertEquals(0, shutdowns)
        assertEquals(holder, relay.current)
        assertTrue(rebound.isEmpty(), "정지 호출 안에서 재결속하지 않는다")
        drain()
        assertEquals(listOf(holder!!), rebound)
        // 다음 단계 모델의 시작은 startForegroundService 없이 재결속한다(배경 시작 거부를 피한다).
        relay.retainer = null
        val next = relay.nextGeneration()
        relay.start(next)
        drain()
        assertEquals(listOf(walk), launched)
        assertEquals(listOf(holder!!, next), rebound)
        relay.stop(next)
        assertEquals(1, shutdowns)
    }

    @Test fun `넘김 직후 다른 세대가 섰으면 옛 재결속은 버린다`() {
        relay.retainer = { relay.nextGeneration() }
        val walk = relay.nextGeneration()
        relay.start(walk)
        relay.stop(walk)
        val next = relay.nextGeneration()
        relay.start(next)
        drain()
        assertEquals(listOf(next), rebound)
    }

    @Test fun `서비스 인스턴스가 사라졌으면 재결속 대신 다시 시작한다`() {
        relay.retainer = { relay.nextGeneration() }
        val walk = relay.nextGeneration()
        relay.start(walk)
        relay.stop(walk)
        drain()
        live = false  // 서비스가 스스로 죽었다
        relay.retainer = null
        val next = relay.nextGeneration()
        relay.start(next)
        drain()
        assertEquals(listOf(walk, next), launched)
    }
}
