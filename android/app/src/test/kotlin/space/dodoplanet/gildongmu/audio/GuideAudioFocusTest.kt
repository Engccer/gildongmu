package space.dodoplanet.gildongmu.audio

import android.media.AudioManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FakeFocusPort : AudioFocusPort {
    var requests = 0
    var abandons = 0
    var nextResult = AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    var listener: ((Int) -> Unit)? = null
    override fun request(listener: (Int) -> Unit): Int { requests++; this.listener = listener; return nextResult }
    override fun abandon() { abandons++ }
}

/** 예약 목록을 들고 `runDue(seconds)`로 실행하는 페이크 스케줄러. */
class FakeScheduler {
    private data class Entry(val at: Long, val block: () -> Unit, var cancelled: Boolean = false)
    private val entries = mutableListOf<Entry>()
    var now = 0L
    val post: (Long, () -> Unit) -> Cancellable = { ms, block ->
        val e = Entry(now + ms, block)
        entries += e
        Cancellable { e.cancelled = true }
    }
    val pendingCount: Int get() = entries.count { !it.cancelled && it.at > now }
    fun runDue(seconds: Double) {
        now += (seconds * 1000).toLong()
        val due = entries.filter { !it.cancelled && it.at <= now }
        entries.removeAll(due)
        due.forEach { it.block() }
    }
}

/** spec §5-2 표 19항 1:1(iOS `GuideAudioSessionTests` 대응 판). */
class GuideAudioFocusTest {
    private val port = FakeFocusPort()
    private val sched = FakeScheduler()
    private val focus = GuideAudioFocus(port, sched.post)

    @Test fun `#1 세션 시작은 포커스를 잡지 않고 첫 재생의 acquire가 잡는다`() {
        assertFalse(focus.held)
        assertEquals(0, port.requests)
        assertTrue(focus.acquire())
        assertTrue(focus.held)
        assertEquals(1, port.requests)
    }

    @Test fun `#2 #3 억제 중엔 재생이 없어 요청 0, 해제 뒤 첫 재생이 요청 1`() {
        // 억제는 모델 창구(§5-5)가 재생 자체를 막는다 — 포커스 층은 요청을 본 적이 없다.
        assertEquals(0, port.requests)
        assertTrue(focus.acquire())
        assertEquals(1, port.requests)
    }

    @Test fun `#4 #5 쥔 적 없는 종료는 반납 0`() {
        focus.endSession(0.0)
        sched.runDue(1.0)
        assertEquals(0, port.abandons)
        assertEquals(0, port.requests)
    }

    @Test fun `#6 쥐었으면 종료 시 잔여 + 0_15초 뒤 반납 1회`() {
        focus.acquire()
        focus.endSession(2.0)
        sched.runDue(2.1)
        assertEquals(0, port.abandons)
        sched.runDue(0.1)
        assertEquals(1, port.abandons)
        assertFalse(focus.held)
    }

    @Test fun `#7 LOSS 뒤 억제 해제 뒤 재생 → 재요청 1회`() {
        focus.acquire()
        port.listener!!(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
        assertFalse(focus.held)
        assertTrue(focus.acquire())
        assertEquals(2, port.requests)
    }

    @Test fun `#9 쥐지 않은 상태의 LOSS 콜백은 상태 변화 0·반납 0`() {
        focus.acquire()
        focus.releaseNow()
        assertEquals(1, port.abandons)
        port.listener!!(AudioManager.AUDIOFOCUS_LOSS)
        assertFalse(focus.held)
        assertEquals(1, port.abandons)
    }

    @Test fun `#10 세션 밖 단발 재생도 같은 경로 — acquire → releaseAfter`() {
        assertTrue(focus.acquire())
        focus.releaseAfter(0.35)
        assertEquals(1, sched.pendingCount)
        sched.runDue(0.4)
        assertEquals(1, port.abandons)
    }

    @Test fun `#12 종료 예약은 그대로 진행한다`() {
        focus.acquire()
        focus.endSession(0.0)
        sched.runDue(0.2)
        assertEquals(1, port.abandons)
    }

    @Test fun `#13 #14 GAIN 콜백은 무시, LOSS 뒤 GAIN 뒤 재생이 재요청`() {
        focus.acquire()
        port.listener!!(AudioManager.AUDIOFOCUS_LOSS)
        port.listener!!(AudioManager.AUDIOFOCUS_GAIN)
        assertFalse(focus.held)
        assertTrue(focus.acquire())
        assertEquals(2, port.requests)
    }

    @Test fun `#15 held 전이는 acquire 성공·abandon·LOSS 셋뿐`() {
        assertFalse(focus.held)
        port.nextResult = AudioManager.AUDIOFOCUS_REQUEST_FAILED
        assertFalse(focus.acquire()); assertFalse(focus.held)
        port.nextResult = AudioManager.AUDIOFOCUS_REQUEST_DELAYED
        assertFalse(focus.acquire()); assertFalse(focus.held)
        port.nextResult = AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        assertTrue(focus.acquire()); assertTrue(focus.held)
        port.listener!!(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK); assertFalse(focus.held)
        assertTrue(focus.acquire()); assertTrue(focus.held)
        focus.releaseNow(); assertFalse(focus.held)
        assertEquals(1, port.abandons)
    }

    @Test fun `#16 예약 반납 중 새 acquire가 예약을 취소하고 held 유지`() {
        focus.acquire()
        focus.releaseAfter(0.5)
        assertTrue(focus.acquire())
        assertEquals(0, sched.pendingCount)
        sched.runDue(1.0)
        assertEquals(0, port.abandons)
        assertTrue(focus.held)
        assertEquals(1, port.requests)
    }

    @Test fun `#16' 새 세션 시작(cancelPendingRelease)이 끝난 세션의 반납을 취소한다`() {
        focus.acquire()
        focus.endSession(1.0)
        focus.cancelPendingRelease()
        sched.runDue(2.0)
        assertEquals(0, port.abandons)
        assertTrue(focus.held)
    }

    @Test fun `#19 요청 거절 — acquire false·held false, 뒤에 허가되면 true`() {
        port.nextResult = AudioManager.AUDIOFOCUS_REQUEST_FAILED
        repeat(3) { assertFalse(focus.acquire()) }
        assertEquals(3, port.requests)
        assertFalse(focus.held)
        port.nextResult = AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        assertTrue(focus.acquire())
        assertTrue(focus.held)
    }
}
