package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.DeviceSpeechDrop
import space.dodoplanet.gildongmu.kit.GuideSpeechClass
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.TransitWalkLegText
import space.dodoplanet.gildongmu.location.LocationPermission
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 폴 루프가 무한이라 `advanceUntilIdle`은 쓰지 않는다 — 현재 시각의 태스크만 소진한다. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

/** M5 단계 2-1: 수명·폴·유휴·통지. 판정은 :kit, 여기는 순서·수명·포트 호출을 잠근다. */
@OptIn(ExperimentalCoroutinesApi::class)
class TransitGuideModelTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private fun TransitGuideHarness.begin() = model.start(subwayRoute(), "여의도역", dest, accessible = false)

    @Test fun `시작 문장은 목적지를 말하고 즉폴이 나간다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        val name = TransitWalkLegText.destinationName(label = "여의도역", roman = null, english = false)!!
        assertTrue(h.speaker.texts.first().startsWith(h.catalog.get("transitGuide.startedAt", name, 1)), h.speaker.texts.toString())
        assertEquals(listOf(BeaconTone.start), h.tones.played)
        assertEquals(1, h.seenUrls.size)
        assertTrue(h.seenUrls.single().contains("mode=subway"))
        assertTrue(h.model.ui.value.isTracking)
    }

    @Test fun `이미 다른 안내가 있으면 거부 문장을 말하고 시작하지 않는다`() = transitTest(dispatcher) { h ->
        h.coordinator.claim { }
        h.begin()
        settle()
        assertEquals(listOf(h.catalog.get("guide.alreadyActive")), h.speaker.texts)
        assertFalse(h.model.ui.value.isTracking)
        assertEquals(0, h.seenUrls.size)
    }

    @Test fun `대기 폴은 후보 목록을 채운다`() = transitTest(dispatcher) { h ->
        h.trackReplies += TransitGuideHarness.okTrack("v1") to 0L
        h.begin()
        settle()
        assertEquals(listOf("v1"), h.model.ui.value.waitingLive.map { it.vehicleId })
        assertEquals(1, h.model.waitingCandidatesPool().size)
    }

    @Test fun `폴 주기 0이면 즉폴도 없다`() = transitTest(dispatcher) { h ->
        h.model.start(h.untrackableRoute(), "나", h.dest, accessible = false)
        settle()
        advanceTimeBy(120_000)
        runCurrent()
        assertEquals(0, h.seenUrls.size)
        assertTrue(h.speaker.texts.first().contains(h.catalog.get("transitGuide.untrackable")))
    }

    @Test fun `백그라운드를 거친 뒤 옛 폴 결과는 버려진다`() = transitTest(dispatcher) { h ->
        // 첫 폴은 5초 늦게 도착하는 옛 응답, 복귀 즉폴은 새 응답. 세대 가드가 없으면 늦은 옛 응답이 새 응답을 덮는다.
        h.trackReplies += TransitGuideHarness.okTrack("old") to 5_000L
        h.trackReplies += TransitGuideHarness.okTrack("new") to 0L
        h.begin()
        runCurrent()
        h.env.foreground = false
        h.model.setForeground(false)
        h.env.foreground = true
        h.model.setForeground(true)
        advanceTimeBy(10_000)
        runCurrent()
        assertEquals(listOf("new"), h.model.ui.value.waitingLive.map { it.vehicleId })
    }

    @Test fun `떠난 열차는 180초 보존되고 경과 분이 붙는다`() = transitTest(dispatcher) { h ->
        h.trackReplies += TransitGuideHarness.okTrack("v1") to 0L
        h.begin()
        settle()
        // 20초 주기 폴이 비어 도착한다: 120초 뒤엔 2분 전 떠남, 200초 뒤엔 사라진다.
        advanceTimeBy(120_000)
        runCurrent()
        val departed = h.model.ui.value.waitingDeparted
        assertEquals(listOf("v1"), departed.map { it.item.vehicleId })
        assertEquals(2, departed.single().minutes)
        advanceTimeBy(80_000)
        runCurrent()
        assertTrue(h.model.ui.value.waitingDeparted.isEmpty())
    }

    @Test fun `유휴 한계를 넘기면 정지를 알리고 전경 복귀가 재개한다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        advanceTimeBy(90 * 60_000L)
        runCurrent()
        assertTrue(h.model.ui.value.idlePaused, "urls=${h.seenUrls.size} st=${h.model.ui.value.state}")
        assertTrue(h.speaker.texts.contains(h.catalog.get("transitGuide.idlePaused")), h.speaker.texts.toString())
        val callsAtPause = h.seenUrls.size
        advanceTimeBy(5 * 60_000L)
        runCurrent()
        assertEquals(callsAtPause, h.seenUrls.size, "유휴 정지 중엔 폴이 없다")
        // 화면을 껐다 켠다.
        h.env.foreground = false
        h.model.setForeground(false)
        h.env.foreground = true
        h.model.setForeground(true)
        settle()
        assertFalse(h.model.ui.value.idlePaused)
        assertTrue(h.speaker.texts.any { it.contains(h.catalog.get("transitGuide.resumed")) }, h.speaker.texts.toString())
        assertTrue(h.seenUrls.size > callsAtPause, "재개는 즉폴")
    }

    @Test fun `백그라운드에서는 유휴 정지음이 나지 않는다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        val before = h.tones.played.size
        h.env.foreground = false
        h.model.setForeground(false)
        advanceTimeBy(90 * 60_000L)
        runCurrent()
        assertTrue(h.model.ui.value.idlePaused)
        assertEquals(before, h.tones.played.size)
        assertFalse(h.tones.played.contains(BeaconTone.stop))
    }

    @Test fun `억제 중 버려진 마지막 문장은 해제 때 한 번 다시 나간다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        h.model.outputSuppressed = true
        h.model.announceExternal("첫 문장", highPriority = false, speechClass = GuideSpeechClass.actionable)
        h.model.announceExternal("마지막 문장", highPriority = false, speechClass = GuideSpeechClass.actionable)
        settle()
        assertFalse(h.speaker.texts.contains("마지막 문장"))
        h.model.outputSuppressed = false
        settle()
        assertEquals(1, h.speaker.texts.count { it == "마지막 문장" })
        assertFalse(h.speaker.texts.contains("첫 문장"))
    }

    @Test fun `권한이 없으면 keepAlive를 원하지 않고 있으면 원한다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        val riding = h.model.ui.value.state!!.copy(phase = TransitPhase.riding)
        assertNull(h.model.keepAliveWanted.value, "대기 국면은 원하지 않는다")
        h.perms.location = LocationPermission.None
        h.model.debugSetState(riding)
        assertNull(h.model.keepAliveWanted.value)
        h.perms.location = LocationPermission.Fine
        h.model.debugSetState(riding)
        assertEquals(GuideLocationProfile.keepAlive, h.model.keepAliveWanted.value)
        h.model.stop(playStopTone = false)
        assertNull(h.model.keepAliveWanted.value)
    }

    @Test fun `정지는 점유를 풀고 정지음은 요청할 때만 낸다`() = transitTest(dispatcher) { h ->
        h.begin()
        settle()
        assertTrue(h.coordinator.isActive)
        h.model.stop(playStopTone = false)
        assertFalse(h.coordinator.isActive)
        assertFalse(h.model.ui.value.isTracking)
        assertFalse(h.tones.played.contains(BeaconTone.stop))
        assertEquals(1, h.tones.ends)

        h.begin()
        settle()
        h.model.stop(playStopTone = true)
        assertTrue(h.tones.played.contains(BeaconTone.stop))
    }

    @Test fun `speaker onInterrupted를 덮어쓰지 않는다`() = transitTest(dispatcher) { h ->
        val sentinel: (Int, DeviceSpeechDrop) -> Unit = { _, _ -> }
        h.speaker.onInterrupted = sentinel
        h.begin()
        settle()
        assertNotNull(h.speaker.onInterrupted)
        assertTrue(h.speaker.onInterrupted === sentinel)
    }
}
