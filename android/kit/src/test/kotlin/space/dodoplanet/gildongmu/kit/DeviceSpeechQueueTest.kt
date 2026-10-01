package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 기기 음성 대기 한 칸의 수명 계약(E53 spec 2026-09-30 §4.2) — Kit `DeviceSpeechQueueTests.swift` 미러 + 안드로이드 적응(발화 실패 = 미전달).
 * 합성기는 하나(`SharedSynth`)이고 칸 여럿이 나눠 쓴다. sleeper는 시계를 전진시키고 가상 1ms를 쉰다 — [drain]이 유한 단계만 돌린다(Swift `drain`의
 * 60회 양보 동형, 말이 끝나지 않는 케이스에서 멈추지 않게).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DeviceSpeechQueueTest {
    private val scheduler = TestCoroutineScheduler()
    private val scope = CoroutineScope(StandardTestDispatcher(scheduler))

    private fun drain() = repeat(400) { scheduler.advanceTimeBy(1); scheduler.runCurrent() }

    /** 앱 합성기 흉내. `speak`마다 새 토큰, `stop`·새 발화가 이전 토큰을 무효로 만든다. */
    class SharedSynth {
        var speaking = false
        var paused = false
        var token = 0
            private set
        val spoken = mutableListOf<String>()
        var stops = 0
            private set
        /** 말하지 못하게 한다(안드로이드 포커스 거절·엔진 실패). */
        var fails = false
        val interruptionObservers = mutableListOf<(Int, DeviceSpeechDrop) -> Unit>()

        fun speak(text: String): Int? {
            if (fails) return null
            if (speaking || paused) {
                val cut = token
                interruptionObservers.forEach { it(cut, DeviceSpeechDrop.superseded) }
            }
            token += 1
            speaking = true
            paused = false
            spoken += text
            return token
        }

        fun stop() {
            token += 1
            speaking = false
            paused = false
            stops += 1
        }

        fun isSpeaking(t: Int) = (speaking || paused) && t == token
    }

    private inner class Harness(val synth: SharedSynth = SharedSynth()) {
        var now = 0.0
        var suppressed = false
        var voiceOverRunning = true
        var toneEndsAt: () -> Double? = { null }
        var channel = GuideSpeechChannel.device
        var postOk = true
        val voiceOver = mutableListOf<Pair<String, Boolean>>()
        val drops = mutableListOf<Pair<String, DeviceSpeechDrop>>()
        var speakingAfterPolls = mutableListOf<Boolean>()

        val queue = DeviceSpeechQueue(
            scope = scope,
            clock = { now },
            sleeper = { s ->
                now += s
                if (speakingAfterPolls.isNotEmpty()) synth.speaking = speakingAfterPolls.removeAt(0)
                delay(1)
            },
            isSpeaking = { synth.speaking },
            isSpeakingToken = { synth.isSpeaking(it) },
            voiceOverRunning = { voiceOverRunning },
            isSuppressed = { suppressed },
            toneEndsAt = { toneEndsAt() },
            route = { channel },
            speak = { synth.speak(it) },
            stopSpeaking = { synth.stop() },
            postVoiceOver = { text, high -> if (postOk) { voiceOver += text to high; true } else false },
        )

        init {
            synth.interruptionObservers += { token, reason -> queue.speechInterrupted(token, reason) }
        }

        fun submit(text: String, high: Boolean = false, protected: Boolean = false, bypass: Boolean = false, cls: GuideSpeechClass = GuideSpeechClass.actionable) =
            queue.submit(text, high, protected, bypass, cls) { reason -> drops += text to reason }
    }

    @Test fun speaksImmediatelyWhenIdle() {
        val h = Harness()
        h.submit("지금")
        assertEquals(listOf("지금"), h.synth.spoken)
        assertFalse(h.queue.hasPending)
        assertTrue(h.drops.isEmpty())
    }

    @Test fun waitsWhileSpeakingThenSpeaks() {
        val h = Harness()
        h.submit("전문")
        h.submit("다음")
        assertEquals(listOf("전문"), h.synth.spoken)
        assertTrue(h.queue.hasPending)
        h.speakingAfterPolls = mutableListOf(true, false)
        drain()
        assertEquals(listOf("전문", "다음"), h.synth.spoken)
        assertTrue(h.drops.isEmpty())
    }

    @Test fun replacementIsSuperseded() {
        val h = Harness()
        h.submit("전문"); h.submit("옛"); h.submit("새")
        assertEquals(listOf("옛" to DeviceSpeechDrop.superseded), h.drops)
        h.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("전문", "새"), h.synth.spoken)
    }

    @Test fun highPriorityPreempts() {
        val h = Harness()
        h.submit("계단 경고"); h.submit("칸의 전문"); h.submit("도착", high = true)
        assertEquals(listOf("계단 경고", "도착"), h.synth.spoken)
        assertEquals(setOf("칸의 전문", "계단 경고"), h.drops.map { it.first }.toSet())
        assertTrue(h.drops.all { it.second == DeviceSpeechDrop.superseded })
        assertFalse(h.queue.hasPending)
        h.submit("잠시 후 왼쪽 전 예고")
        assertTrue(h.queue.hasPending)
    }

    @Test fun urgentPreempts() {
        val h = Harness()
        h.submit("묶음 전문")
        h.submit("잠시 후 우회전하세요", cls = GuideSpeechClass.urgent)
        assertEquals(listOf("묶음 전문", "잠시 후 우회전하세요"), h.synth.spoken)
        assertFalse(h.queue.hasPending)
        assertEquals(listOf("묶음 전문" to DeviceSpeechDrop.superseded), h.drops)
    }

    @Test fun preemptDoesNotNotifyForeignSpeech() {
        val synth = SharedSynth()
        val a = Harness(synth)
        val b = Harness(synth)
        a.submit("a의 옛 문장")
        b.submit("b가 말하는 중", high = true)
        assertEquals(listOf("a의 옛 문장"), a.drops.map { it.first })
        a.submit("a의 도착", high = true)
        assertEquals(listOf("a의 옛 문장" to DeviceSpeechDrop.superseded), a.drops)
    }

    @Test fun immediateSpeakClearsStalePending() {
        val h = Harness()
        h.submit("전문"); h.submit("옛")
        h.synth.speaking = false
        h.submit("새")
        drain()
        assertEquals(listOf("전문", "새"), h.synth.spoken)
        assertEquals(listOf(DeviceSpeechDrop.superseded), h.drops.map { it.second })
    }

    @Test fun protectedBlocksPlain() {
        val h = Harness()
        h.submit("전문"); h.submit("횡단보도", protected = true); h.submit("지나침")
        assertEquals(listOf("지나침" to DeviceSpeechDrop.undelivered), h.drops)
        h.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("전문", "횡단보도"), h.synth.spoken)
    }

    @Test fun ttlDropsPlainButNotProtected() {
        val h = Harness()
        h.submit("전문"); h.submit("낡을 문장")
        h.speakingAfterPolls = (MutableList(29) { true } + false).toMutableList()
        drain()
        assertEquals(listOf("전문"), h.synth.spoken)
        assertEquals(listOf(DeviceSpeechDrop.undelivered), h.drops.map { it.second })

        val k = Harness()
        k.submit("전문"); k.submit("횡단보도", protected = true)
        k.speakingAfterPolls = (MutableList(29) { true } + false).toMutableList()
        drain()
        assertEquals(listOf("전문", "횡단보도"), k.synth.spoken)
    }

    @Test fun suppressedAtDrainDropsUnlessBypass() {
        val h = Harness()
        h.submit("전문"); h.submit("억제 중 대기")
        h.suppressed = true
        h.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("전문"), h.synth.spoken)
        assertEquals(listOf(DeviceSpeechDrop.undelivered), h.drops.map { it.second })

        val b = Harness()
        b.submit("전문"); b.submit("목적지 전환 확인", bypass = true)
        b.suppressed = true
        b.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("전문", "목적지 전환 확인"), b.synth.spoken)
    }

    @Test fun waitsForToneBeforeDelivering() {
        val h = Harness()
        h.submit("전문"); h.submit("임박 전 예고")
        h.toneEndsAt = { 2.0 }
        h.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("전문", "임박 전 예고"), h.synth.spoken)
        assertTrue(h.now >= 2.0 + SpeechDeferConstants.speechDeferGapSeconds, "${h.now}")
    }

    @Test fun toneWaitIsCapped() {
        val h = Harness()
        h.submit("전문"); h.submit("상한 문장", protected = true)
        var toneCalls = 0
        h.toneEndsAt = { toneCalls += 1; if (toneCalls < 50) h.now + 2 else null }
        h.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("전문", "상한 문장"), h.synth.spoken)
        assertTrue(h.now < SpeechDeferConstants.speechDeferMaxSeconds + 4 * DeviceSpeechQueue.pollSeconds, "${h.now}")
    }

    @Test fun toneWaitCapRestartsAfterSpeechResumes() {
        val h = Harness()
        h.submit("전문"); h.submit("보호 문장", protected = true)
        var toneCalls = 0
        h.toneEndsAt = { toneCalls += 1; if (toneCalls < 50) h.now + 2 else null }
        h.speakingAfterPolls = mutableListOf(false, true, true, false)
        drain()
        assertEquals(listOf("전문", "보호 문장"), h.synth.spoken)
        assertTrue(h.now > 5, "${h.now}")
    }

    @Test fun reroutesAtDrain() {
        val h = Harness()
        h.submit("전문"); h.submit("복귀 뒤")
        h.channel = GuideSpeechChannel.voiceOver
        h.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("복귀 뒤" to true), h.voiceOver)

        val d = Harness()
        d.submit("전문"); d.submit("토글 끔")
        d.channel = GuideSpeechChannel.drop
        d.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf(DeviceSpeechDrop.undelivered), d.drops.map { it.second })
    }

    @Test fun resetDropsSilently() {
        val h = Harness()
        h.submit("전문"); h.submit("끝난 세션")
        h.queue.reset()
        h.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("전문"), h.synth.spoken)
        assertTrue(h.drops.isEmpty())
        assertFalse(h.queue.hasPending)
    }

    @Test fun handOverReturnsSpeakingAndPendingInOrder() {
        val h = Harness()
        h.submit("40m 전문"); h.submit("다음 예고")
        h.channel = GuideSpeechChannel.voiceOver
        val handed = h.queue.handOver()
        assertEquals(listOf("40m 전문", "다음 예고"), handed.texts)
        assertEquals(1, h.synth.stops)
        assertTrue(h.voiceOver.isEmpty())
        assertTrue(h.drops.isEmpty())
        assertFalse(h.queue.hasPending)
        h.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("40m 전문"), h.synth.spoken)
    }

    @Test fun handOverIgnoresForeignSpeech() {
        val synth = SharedSynth()
        val beacon = Harness(synth)
        val transit = Harness(synth)
        beacon.channel = GuideSpeechChannel.voiceOver
        transit.channel = GuideSpeechChannel.voiceOver
        beacon.submit("승차역 도착")
        transit.submit("대중교통 시작", high = true)
        assertTrue(beacon.queue.handOver().isEmpty)
        assertEquals(0, synth.stops)
        assertEquals(listOf("대중교통 시작"), transit.queue.handOver().texts)
        assertEquals(1, synth.stops)
    }

    @Test fun handOverSkipsFinishedSpeech() {
        val h = Harness()
        h.submit("다 들은 문장")
        h.synth.speaking = false
        h.channel = GuideSpeechChannel.voiceOver
        assertTrue(h.queue.handOver().isEmpty)
        assertEquals(0, h.synth.stops)
    }

    @Test fun handOverKeepsDeviceChannel() {
        val h = Harness()
        h.submit("말하는 중"); h.submit("대기")
        h.channel = GuideSpeechChannel.device
        assertTrue(h.queue.handOver().isEmpty)
        assertEquals(0, h.synth.stops)
        assertTrue(h.queue.hasPending)
        h.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("말하는 중", "대기"), h.synth.spoken)
    }

    @Test fun handOverKeepsSpeechWhenVoiceOverOff() {
        val h = Harness()
        h.submit("말하는 중"); h.submit("대기")
        h.channel = GuideSpeechChannel.voiceOver
        h.voiceOverRunning = false
        assertTrue(h.queue.handOver().isEmpty)
        assertEquals(0, h.synth.stops)
        assertTrue(h.queue.hasPending)
    }

    @Test fun handOverRespectsSuppressionAndTTL() {
        val h = Harness()
        h.submit("말하는 중"); h.submit("대기")
        h.channel = GuideSpeechChannel.voiceOver
        h.suppressed = true
        assertTrue(h.queue.handOver().isEmpty)
        assertEquals(1, h.synth.stops)
        assertEquals(listOf(DeviceSpeechDrop.undelivered, DeviceSpeechDrop.undelivered), h.drops.map { it.second })

        val t = Harness()
        t.submit("말하는 중"); t.submit("낡은 명령")
        t.now = DeviceSpeechQueue.pendingTTLSeconds + 1
        t.channel = GuideSpeechChannel.voiceOver
        assertEquals(listOf("말하는 중"), t.queue.handOver().texts)
        assertEquals(listOf("낡은 명령"), t.drops.map { it.first })
    }

    @Test fun handOverRollbackReportsUndeliveredOnce() {
        val h = Harness()
        h.submit("계단 경고"); h.submit("다음 예고")
        h.channel = GuideSpeechChannel.voiceOver
        val handed = h.queue.handOver()
        assertTrue(h.drops.isEmpty())
        handed.undelivered()
        handed.undelivered()
        assertEquals(listOf("계단 경고", "다음 예고"), h.drops.map { it.first })
        assertTrue(h.drops.all { it.second == DeviceSpeechDrop.undelivered })
        assertTrue(DeviceSpeechHandover.empty.isEmpty)
    }

    @Test fun externalStopOfOwnSpeechIsUndelivered() {
        val synth = SharedSynth()
        val outing = Harness(synth)
        val beacon = Harness(synth)
        outing.submit("횡단보도 예고")
        val token = synth.token
        synth.stop()
        beacon.queue.speechInterrupted(token, DeviceSpeechDrop.undelivered)
        assertTrue(beacon.drops.isEmpty())
        outing.queue.speechInterrupted(token - 1, DeviceSpeechDrop.undelivered)
        assertTrue(outing.drops.isEmpty())
        outing.queue.speechInterrupted(token, DeviceSpeechDrop.undelivered)
        outing.queue.speechInterrupted(token, DeviceSpeechDrop.undelivered)
        assertEquals(listOf("횡단보도 예고" to DeviceSpeechDrop.undelivered), outing.drops)
    }

    @Test fun pausedOwnSpeechIsReportedWhenReplaced() {
        val h = Harness()
        h.submit("계단 경고")
        h.synth.speaking = false
        h.synth.paused = true
        h.submit("다음 예고")
        assertEquals(listOf("계단 경고", "다음 예고"), h.synth.spoken)
        assertEquals(listOf("계단 경고" to DeviceSpeechDrop.superseded), h.drops)
        assertFalse(h.queue.hasPending)
    }

    @Test fun handOverTakesPausedOwnSpeech() {
        val h = Harness()
        h.submit("횡단보도 예고")
        h.synth.speaking = false
        h.synth.paused = true
        h.channel = GuideSpeechChannel.voiceOver
        assertEquals(listOf("횡단보도 예고"), h.queue.handOver().texts)
        assertEquals(1, h.synth.stops)
    }

    @Test fun drainReplacingPausedOwnSpeechIsSuperseded() {
        val h = Harness()
        h.submit("계단 경고"); h.submit("다음 예고")
        h.synth.speaking = false
        h.synth.paused = true
        drain()
        assertEquals(listOf("계단 경고", "다음 예고"), h.synth.spoken)
        assertEquals(listOf("계단 경고" to DeviceSpeechDrop.superseded), h.drops)
    }

    @Test fun foreignSpeechSupersedesOwnSpeech() {
        val synth = SharedSynth()
        val beacon = Harness(synth)
        val transit = Harness(synth)
        beacon.submit("승차역 도착")
        transit.submit("대중교통 시작", high = true)
        assertEquals(listOf("승차역 도착" to DeviceSpeechDrop.superseded), beacon.drops)
        assertTrue(transit.drops.isEmpty())
    }

    // ── 안드로이드 적응: 말하지 못한 문장은 전달이 아니다 ──

    @Test fun speakFailureIsUndelivered() {
        val h = Harness()
        h.synth.fails = true
        h.submit("계단 경고")
        assertEquals(listOf("계단 경고" to DeviceSpeechDrop.undelivered), h.drops)
        h.synth.fails = false
        h.submit("다음")
        assertEquals(listOf("다음"), h.synth.spoken)
        assertEquals(1, h.drops.size, "실패한 문장이 다음 선점에서 또 통지되지 않는다")
    }

    @Test fun directPostFailureAtDrainIsUndelivered() {
        val h = Harness()
        h.submit("전문"); h.submit("복귀 뒤")
        h.channel = GuideSpeechChannel.voiceOver
        h.postOk = false
        h.speakingAfterPolls = mutableListOf(false)
        drain()
        assertEquals(listOf("복귀 뒤" to DeviceSpeechDrop.undelivered), h.drops)
    }
}
