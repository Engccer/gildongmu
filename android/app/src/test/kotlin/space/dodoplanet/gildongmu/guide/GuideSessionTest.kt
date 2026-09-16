package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.TestScope
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 워치독이 2초 주기 무한 루프라 `advanceUntilIdle`은 영영 끝나지 않는다 — 현재 시각의 태스크만 소진한다. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

/** spec §3-1 `startWalk` 게이트·§5-5 억제 소유자 집합. `attach`의 멱등은 Context가 필요해 소스 가드(Task 7)가 첫 줄을 잠근다. */
@OptIn(ExperimentalCoroutinesApi::class)
class GuideSessionTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private data class Owner(val n: Int)

    @Test fun `실험 게이트가 거짓이면 startWalk는 아무것도 하지 않는다`() = guideTest(dispatcher) { h ->
        GuideSession.attachForTest(h.model, h.coordinator)
        GuideSession.experimentalEnabled = { false }
        GuideSession.startWalk(h.request)
        settle()
        assertEquals(GuideStatus.idle, h.model.ui.value.status)
        assertEquals(0, h.tones.preloads)
        assertEquals(0, h.controller.starts)
    }

    @Test fun `게이트 통과 → 프리로드·TTS 준비 → 시작`() = guideTest(dispatcher) { h ->
        GuideSession.attachForTest(h.model, h.coordinator)
        GuideSession.experimentalEnabled = { true }
        GuideSession.startWalk(h.request)
        assertEquals(1, h.tones.preloads)
        assertTrue(h.speaker.prepares >= 1)
        settle()
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
        assertTrue(GuideSession.isActive)
        assertTrue(GuideSession.hasScreen)
        // 안내 중 재시작 요청은 거부 통지.
        h.speaker.spoken.clear()
        GuideSession.startWalk(h.request)
        assertEquals(listOf(h.catalog.get("guide.alreadyActive") to true), h.speaker.spoken)
        h.model.stopByUser()
        assertFalse(GuideSession.isActive)
    }

    @Test fun `억제 소유자는 동일성으로 센다 — 동등한 두 인스턴스가 따로, 해제는 이전 ∧ 현재`() = guideTest(dispatcher) { h ->
        GuideSession.attachForTest(h.model, h.coordinator)
        val a = Owner(1)
        val b = Owner(1)
        assertEquals(a, b)
        GuideSession.setOutputSuppressed(true, a)
        GuideSession.setOutputSuppressed(true, b)
        assertTrue(h.model.outputSuppressed)
        GuideSession.setOutputSuppressed(false, a)
        assertTrue(h.model.outputSuppressed, "동등 인스턴스 b가 아직 소유 중")
        GuideSession.setOutputSuppressed(false, b)
        assertFalse(h.model.outputSuppressed)

        // 세션 경계가 억제를 풀었으면(이전 값 false) 소유자 해제가 억제를 되살리지 않는다.
        GuideSession.setOutputSuppressed(true, a)
        h.model.outputSuppressed = false
        GuideSession.setOutputSuppressed(false, a)
        assertFalse(h.model.outputSuppressed)

        // 이전에 이미 억제 중이었으면(이전 값 true) 해제 뒤에도 유지.
        h.model.outputSuppressed = true
        GuideSession.setOutputSuppressed(true, a)
        GuideSession.setOutputSuppressed(false, a)
        assertTrue(h.model.outputSuppressed)
    }
}
