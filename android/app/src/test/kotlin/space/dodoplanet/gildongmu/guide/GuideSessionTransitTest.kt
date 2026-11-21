package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** 도보 워치독이 무한 루프라 `advanceUntilIdle`은 끝나지 않는다 — 현재 시각의 태스크만 소진한다. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

/**
 * M5 §6-4·§6-5 경계: 두 모델이 한 벌의 포트(컨트롤러·TTS·톤·코디네이터)를 공유하고 `GuideSession`이 서비스 소유자·세대·억제·전경·TTS 콜백을 고른다.
 * 앱 조립(`attach`)과 같은 모양으로 끼운다 — 서비스의 시작 실패는 `GuideSession.serviceStartFailed`로 돌아온다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GuideSessionTransitTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    private fun joint(body: suspend TestScope.(GuideTestHarness, TransitGuideHarness) -> Unit) = runTest(dispatcher) {
        val w = GuideTestHarness(dispatcher)
        val t = TransitGuideHarness(dispatcher, shared = w)
        w.controller.route = GuideSession::serviceStartFailed
        GuideSession.attachForTest(w.model, w.coordinator, t.model, w.speaker)
        try { body(w, t) } finally {
            w.close()
            t.close()
            GuideSession.attachForTest(w.model, w.coordinator)  // 다음 테스트가 남은 대중교통 모델을 보지 않게
        }
    }

    private fun TransitGuideHarness.beginBoarded() {
        trackReplies += TransitGuideHarness.okTrack("v1") to 0L
        model.start(subwayRoute(), "여의도역", dest, accessible = false, aboard = null)
    }

    @Test fun `서비스 소유자는 대중교통에서 도보로 넘어가고 앞 세대의 위치 꺼짐·알림 종료는 새 세션을 끝내지 않는다`() = joint { w, t ->
        assertNull(GuideSession.serviceOwner())
        t.beginBoarded()
        settle()
        assertSame(t.model, GuideSession.serviceOwner())
        assertEquals(GuideScreenKind.transit, GuideSession.screen)
        t.model.board(t.model.ui.value.waitingLive.single(), null)
        settle()
        val transitGen = assertNotNull(t.model.serviceGeneration, "boarding이 keep-alive 서비스를 켠다")
        // 인계: 앞 모델 정지가 뒤 모델 점유보다 먼저(§3).
        t.model.stop(playStopTone = false)
        assertNull(GuideSession.serviceOwner())
        GuideSession.startWalk(w.request)
        settle()
        assertSame(w.model, GuideSession.serviceOwner())
        assertEquals(GuideScreenKind.beacon, GuideSession.screen)
        val walkGen = assertNotNull(w.model.serviceGeneration)
        assertTrue(walkGen > transitGen, "두 모델이 한 단조 수열을 쓴다")
        // 앞 세션(대중교통) 서비스의 늦은 이벤트는 버린다.
        GuideSession.serviceProviderDisabled(transitGen)
        GuideSession.serviceStopFromNotification(transitGen)
        GuideSession.serviceStartFailed(transitGen, IllegalStateException("late"))
        assertTrue(w.model.isTracking, "앞 세대의 위치 꺼짐·알림 종료·시작 실패가 도보 세션을 끝내지 않는다")
        // 지금 세대의 알림 「안내 종료」는 시트의 안내 종료와 같은 함수다.
        GuideSession.serviceStopFromNotification(walkGen)
        assertFalse(w.model.isTracking)
        assertNull(GuideSession.serviceOwner())
    }

    @Test fun `동기 시작 거부 — 도보는 세션 실패, 대중교통은 keep-alive 없이 계속`() = joint { w, t ->
        w.controller.failOnStart = IllegalStateException("ForegroundServiceStartNotAllowed")
        GuideSession.startWalk(w.request)
        settle()
        assertEquals(GuideStatus.unavailable, w.model.ui.value.status)
        assertNull(w.model.serviceGeneration)
        assertFalse(w.coordinator.isActive)

        t.beginBoarded()
        settle()
        t.model.board(t.model.ui.value.waitingLive.single(), null)
        settle()
        assertTrue(t.model.ui.value.isTracking, "대중교통 keep-alive 거부는 세션을 끝내지 않는다")
        assertNotNull(t.model.keepAliveWanted.value)
        assertFalse(t.model.keepAliveRunning)
    }

    @Test fun `억제 소유자 집합은 두 모델에 함께 걸고 이전 값은 모델마다 든다`() = joint { w, t ->
        val a = Any()
        GuideSession.setOutputSuppressed(true, a)
        assertTrue(w.model.outputSuppressed)
        assertTrue(t.model.outputSuppressed)
        GuideSession.setOutputSuppressed(false, a)
        assertFalse(w.model.outputSuppressed)
        assertFalse(t.model.outputSuppressed)
        // 대중교통만 이미 억제 중이었으면 해제 뒤에도 대중교통은 유지, 도보는 풀린다.
        t.model.outputSuppressed = true
        GuideSession.setOutputSuppressed(true, a)
        GuideSession.setOutputSuppressed(false, a)
        assertTrue(t.model.outputSuppressed)
        assertFalse(w.model.outputSuppressed)
    }

    @Test fun `보류 문장 버림은 그 토큰을 게시한 모델만 상환하고 전경 전이는 두 모델에 간다`() = joint { w, t ->
        t.beginBoarded()
        settle()
        val transitToken = w.speaker.token   // 대중교통 시작 문장
        GuideSession.setForeground(false)
        // 도보 모델이 낸 문장(예: 거부 통지)의 버림은 대중교통의 상환이 아니다(§6-5).
        w.model.announceNow("다른 모델의 문장", highPriority = true, bypassSuppression = true)
        val walkToken = w.speaker.token
        assertTrue(walkToken > transitToken)
        GuideSession.speechDropped(walkToken)
        w.speaker.spoken.clear()
        GuideSession.setForeground(true)
        settle()
        assertEquals(emptyList(), w.speaker.texts, "남의 토큰 버림으로 대중교통이 복귀 낭독을 내지 않는다")
        // 대조: 대중교통 자기 토큰이면 복귀 때 현재 상태를 한 번 낸다(전경 전이가 대중교통에도 간다).
        GuideSession.setForeground(false)
        GuideSession.speechDropped(transitToken)
        w.speaker.spoken.clear()
        GuideSession.setForeground(true)
        settle()
        assertTrue(w.speaker.texts.isNotEmpty(), "대중교통 복귀 낭독")
        assertFalse(w.model.isTracking)
    }
}
