package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * `DeferredAnnouncer` 수명 계약 테스트(spec 2026-08-14 §4·§8, Kit `DeferredAnnouncerTests` 미러).
 *
 * 순수 함수(`speechDeferStep`)만 검사하면 §8의 변이 6종이 전부 통과한다 — 이 스위트의 존재 이유는 비동기 수명
 * 계약(단일 슬롯 latest-wins·세대 토큰·토큰 확인·재평가 상한·onDropped)을 주입 시계·sleeper로 결정론 검증하는 것이다.
 * 테스트 sleeper는 시계를 동기 전진시키고 즉시 반환한다. ⚠ 코루틴은 첫 실행 전에 취소되면 본문을 돌리지 않아(Swift
 * `Task`는 돌린다) 예약 직후 무효화하는 테스트는 토큰·세대 확인에 닿지 않는다 — 그 확인은 `holdSleeper`로 본문을 sleeper
 * 안에 세운 뒤 무효화하는 `*WhileSleeping*` 테스트가 잠근다.
 */
class DeferredAnnouncerTest {
    private class Post(val text: String, val highPriority: Boolean, val bypass: Boolean)

    private class Harness(scope: CoroutineScope) {
        var now = 0.0
        val sleeps = mutableListOf<Double>()
        val posts = mutableListOf<Post>()

        /** post의 반환값(게시 성공 여부). 억제·백그라운드 실패를 흉내 낸다. */
        var postResult = true

        /** toneEndsAt 스크립트 — 호출마다 하나씩 소비, 소진되면 마지막 값 반복. 재대입 시 소비 위치도 처음으로 되돌린다. */
        var toneScript: List<Double?> = listOf(null)
            set(value) {
                field = value
                toneCallIndex = 0
            }

        /** true면 sleeper가 취소에 반응하지 않고 `releaseSleeper()`까지 멈춘다(Swift sleep의 "취소돼도 반환" 재현). */
        var holdSleeper = false
        private var sleepWaiter: Continuation<Unit>? = null

        fun releaseSleeper() {
            sleepWaiter?.resume(Unit)
            sleepWaiter = null
        }

        /** 스크립트 대신 동적 판정이 필요할 때(상한 테스트 — 항상 잔여 2초). */
        var toneDynamic: (() -> Double?)? = null

        private var toneCallIndex = 0

        private fun nextToneEndsAt(): Double? {
            toneDynamic?.let { return it() }
            val value = toneScript[minOf(toneCallIndex, toneScript.size - 1)]
            toneCallIndex += 1
            return value
        }

        val announcer = DeferredAnnouncer(
            scope = scope,
            clock = { now },
            sleeper = { seconds ->
                sleeps.add(seconds)
                now += seconds
                if (holdSleeper) suspendCoroutine { sleepWaiter = it }
            },
            toneEndsAt = { nextToneEndsAt() },
            post = { text, high, bypass ->
                posts.add(Post(text, high, bypass))
                postResult
            },
        )

        val texts: List<String> get() = posts.map { it.text }
    }

    /** 예약된 코루틴들이 소진되도록 스케줄러를 돌린다. */
    private fun TestScope.drain() = testScheduler.advanceUntilIdle()

    @Test fun immediateWhenNoTone() = runTest {
        val h = Harness(this)
        h.toneScript = listOf(null)
        h.announcer.announce("지금")
        assertEquals(listOf("지금"), h.texts) // 동기 게시(코루틴 경유 아님)
        assertTrue(h.sleeps.isEmpty())
    }

    @Test fun longToneDefersUntilToneEnds() = runTest {
        val h = Harness(this)
        h.toneScript = listOf(2.246, 2.246) // 예약 시 + 재평가 시
        h.announcer.announce("도착했습니다")
        assertTrue(h.posts.isEmpty()) // 예약만 — 아직 발화 없음
        drain()
        assertEquals(listOf("도착했습니다"), h.texts)
        assertEquals(listOf(2.246 + SpeechDeferConstants.speechDeferGapSeconds), h.sleeps)
    }

    /** §4-3: 토큰·세대 확인 없이는 취소한 문장이 그 자리에서 발화된다. */
    @Test fun invalidatedPendingNeverPosts() = runTest {
        val h = Harness(this)
        h.toneScript = listOf(2.246)
        h.announcer.announce("버릴 문장")
        h.announcer.invalidatePending()
        drain()
        assertTrue(h.posts.isEmpty())
    }

    /** §4-3: 본문이 sleeper 안에 있는 동안 무효화되면, sleeper가 취소에 반응하지 않고 반환해도 게시하지 않는다(토큰 확인). */
    @Test fun invalidatedWhileSleepingNeverPosts() = runTest {
        val h = Harness(this)
        h.holdSleeper = true
        h.toneScript = listOf(2.246, null) // 재평가에 닿으면 즉시 게시하도록 둘째는 톤 없음
        var dropped = 0
        h.announcer.announce("버릴 문장") { dropped += 1 }
        testScheduler.runCurrent()
        assertEquals(1, h.sleeps.size) // 본문이 sleeper 안에서 멈췄다
        h.announcer.invalidatePending()
        h.releaseSleeper()
        drain()
        assertTrue(h.posts.isEmpty())
        assertEquals(1, dropped) // 선점 시점 1회뿐
    }

    /** §4-2: 세대 경계도 sleeper 안의 본문을 멈춘다(onDropped 없음). */
    @Test fun generationAdvanceWhileSleepingNeverPosts() = runTest {
        val h = Harness(this)
        h.holdSleeper = true
        h.toneScript = listOf(2.246, null)
        var dropped = 0
        h.announcer.announce("끝난 경로의 명령") { dropped += 1 }
        testScheduler.runCurrent()
        assertEquals(1, h.sleeps.size)
        h.announcer.advanceGeneration()
        h.releaseSleeper()
        drain()
        assertTrue(h.posts.isEmpty())
        assertEquals(0, dropped)
    }

    /** §4-2: 세대 증가(stop·teardown·세션 시작)가 보류 문장을 버린다. */
    @Test fun generationAdvanceDropsPending() = runTest {
        val h = Harness(this)
        h.toneScript = listOf(2.246)
        h.announcer.announce("끝난 경로의 명령")
        h.announcer.advanceGeneration()
        drain()
        assertTrue(h.posts.isEmpty())
    }

    /** §4-1: 단일 슬롯 latest-wins — 새 통지가 옛 보류 문장을 버린다. */
    @Test fun latestWinsReplacesPending() = runTest {
        val h = Harness(this)
        h.toneScript = listOf(2.246, 2.246, 2.246)
        h.announcer.announce("옛 문장")
        h.announcer.announce("새 문장")
        drain()
        assertEquals(listOf("새 문장"), h.texts)
    }

    /** §4-1: 즉시 창구(announce의 무톤 경로)도 보류 슬롯을 버린다 — 즉시 문장이 나간 **뒤에** 이전 문장이 발화하면 순서가 뒤집힌다. */
    @Test fun immediateAnnounceDropsPendingFirst() = runTest {
        val h = Harness(this)
        h.toneScript = listOf(2.246, null) // 첫 통지는 지연, 둘째는 톤 없음(즉시)
        h.announcer.announce("이전 목적지 명령")
        h.announcer.announce("목적지가 변경되었습니다")
        assertEquals(listOf("목적지가 변경되었습니다"), h.texts)
        drain()
        assertEquals(listOf("목적지가 변경되었습니다"), h.texts)
    }

    /** announceNow는 톤과 무관하게 즉시 게시하되 보류 슬롯을 버린다(목적지 변경 확인 뒤 이전 목적지 명령이 발화하는 역전 차단). */
    @Test fun announceNowDropsPendingAndPostsImmediately() = runTest {
        val h = Harness(this)
        h.toneScript = listOf(2.246, 2.246) // 톤이 재생 중이어도 announceNow는 미루지 않는다
        h.announcer.announce("이전 목적지 명령")
        h.announcer.announceNow("목적지가 변경되었습니다", highPriority = true, bypassSuppression = true)
        assertEquals(listOf("목적지가 변경되었습니다"), h.texts)
        assertEquals(true, h.posts.first().bypass)
        drain()
        assertEquals(listOf("목적지가 변경되었습니다"), h.texts)
    }

    /** §4-5: 게시 직전 재평가 — 대기 중 새 톤이 시작됐으면 그만큼 더 기다린다. */
    @Test fun reevaluatesNewToneBeforePosting() = runTest {
        val h = Harness(this)
        // 예약 시 ahead(0.731) → 첫 대기 0.881 뒤 재평가 시점에 새 톤이 1.9에 끝남.
        h.toneScript = listOf(0.731, 1.9, 1.9)
        h.announcer.announce("왼쪽으로 도세요")
        drain()
        assertEquals(listOf("왼쪽으로 도세요"), h.texts)
        assertEquals(2, h.sleeps.size) // 첫 대기 + 재평가 추가 대기
        val first = 0.731 + SpeechDeferConstants.speechDeferGapSeconds
        assertTrue(abs(h.sleeps[0] - first) < 1e-9)
        assertTrue(abs(h.sleeps[1] - (1.9 - first + SpeechDeferConstants.speechDeferGapSeconds)) < 1e-9)
    }

    /** §4-5: 총 대기 상한 — 톤이 계속 이어져도 예약 시각부터 3.0초를 넘기면 그대로 게시한다(무한 연기 구조 차단). */
    @Test fun totalWaitCappedAtMax() = runTest {
        val h = Harness(this)
        h.toneDynamic = { h.now + 2 } // 항상 잔여 2초
        h.announcer.announce("상한 문장")
        drain()
        assertEquals(listOf("상한 문장"), h.texts)
        assertTrue(abs(h.now - SpeechDeferConstants.speechDeferMaxSeconds) < 1e-9)
    }

    /** §4-4·§4-6: 게시 실패는 즉시 발화와 동일 처리 — onDropped가 그 시점에 불린다. */
    @Test fun onDroppedFiresWhenPostFails() = runTest {
        val h = Harness(this)
        h.postResult = false
        var droppedImmediate = 0
        h.toneScript = listOf(null)
        h.announcer.announce("즉시 실패") { droppedImmediate += 1 }
        assertEquals(1, droppedImmediate)

        var droppedDeferred = 0
        h.toneScript = listOf(2.246, 2.246)
        h.announcer.announce("지연 실패") { droppedDeferred += 1 }
        drain()
        assertEquals(1, droppedDeferred)
    }

    /**
     * 선점(latest-wins)으로 버려진 문장의 onDropped는 그 시점에 불린다: 상환 문장이 지연 창 안에서 다른 안내에 밀리면 게시도
     * 상환도 없이 영구 소실되기 때문이다 — 게시 실패(§4-4)와 같은 "전달 못함"이다.
     */
    @Test fun supersededPendingFiresOnDropped() = runTest {
        val h = Harness(this)
        var dropped = 0
        h.toneScript = listOf(2.246, 2.246, 2.246)
        h.announcer.announce("계단 경고 합본") { dropped += 1 }
        h.announcer.announce("새 안내")
        assertEquals(1, dropped) // 선점 시점에 동기 호출
        drain()
        assertEquals(listOf("새 안내"), h.texts)
        assertEquals(1, dropped) // 이중 호출 없음
    }

    /** 세션 경계 폐기는 onDropped를 부르지 않는다 — stop()이 상환 장부를 먼저 비우고 세대를 올리므로 복원이 경고를 부활시킨다. */
    @Test fun generationAdvanceDoesNotFireOnDropped() = runTest {
        val h = Harness(this)
        var dropped = 0
        h.toneScript = listOf(2.246)
        h.announcer.announce("끝난 세션의 경고") { dropped += 1 }
        h.announcer.advanceGeneration()
        drain()
        assertEquals(0, dropped)
        assertTrue(h.posts.isEmpty())
    }

    @Test fun onDroppedNotFiredWhenPosted() = runTest {
        val h = Harness(this)
        var dropped = 0
        h.toneScript = listOf(2.246, 2.246)
        h.announcer.announce("성공 문장") { dropped += 1 }
        drain()
        assertEquals(listOf("성공 문장"), h.texts)
        assertEquals(0, dropped)
    }

    /**
     * 옛 슬롯이 게시를 마치고 해제된 뒤 새 슬롯이 여전히 취소 가능하다. §4-3 ABA(옛 코루틴 종료 코드가 새 슬롯 참조를 지우는
     * 경합) 자체는 확인과 해제 사이에 중단점이 없어 이 테스트가 재현하지 못한다(Swift 원본도 같다).
     */
    @Test fun staleTaskDoesNotClearNewSlot() = runTest {
        val h = Harness(this)
        h.toneScript = listOf(2.246, 2.246, 2.246)
        h.announcer.announce("옛 문장")
        drain() // 옛 슬롯이 게시를 마치고 자기 토큰으로 해제
        h.toneScript = listOf(h.now + 2.246, h.now + 2.246)
        h.announcer.announce("이후 문장")
        h.announcer.invalidatePending() // 새 슬롯이 살아 있어야 취소가 성립
        drain()
        assertEquals(listOf("옛 문장"), h.texts) // "이후 문장"은 취소로 미발화
    }

    /**
     * 즉시 디스패처(:app의 `Main.immediate` 대응)에서도 지연 문장이 게시된다 — 예약 코루틴이 슬롯 대입보다 먼저 돌면
     * 토큰 확인에서 자기 문장을 버린다(Kotlin 고유: `LAZY` 시작의 검출 테스트).
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun deferredPostSurvivesImmediateDispatcher() = runTest {
        val h = Harness(CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        h.toneScript = listOf(2.246, 2.246)
        h.announcer.announce("도착했습니다")
        assertEquals(listOf("도착했습니다"), h.texts)
    }

    @Test fun highPriorityForwarded() = runTest {
        val h = Harness(this)
        h.toneScript = listOf(null)
        h.announcer.announce("중요", highPriority = true)
        assertEquals(true, h.posts.first().highPriority)
    }
}
