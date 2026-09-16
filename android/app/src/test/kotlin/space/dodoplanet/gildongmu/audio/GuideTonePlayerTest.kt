package space.dodoplanet.gildongmu.audio

import android.media.AudioManager
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.LeftRightToneScheme
import space.dodoplanet.gildongmu.kit.TrendHaptics
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

open class FakeSound : SoundPort {
    val loaded = HashSet<Int>()
    private val callbacks = HashMap<Int, () -> Unit>()
    val loadRequests = mutableListOf<Int>()
    val plays = mutableListOf<Pair<Int, Float>>()
    val stops = mutableListOf<Int>()
    var nextStream = 1
    var failPlay = false
    override fun load(resId: Int, onLoaded: () -> Unit) { loadRequests += resId; callbacks[resId] = onLoaded }
    fun completeLoad(resId: Int) { loaded += resId; callbacks.remove(resId)?.invoke() }
    fun completeAll() { loadRequests.toList().forEach { completeLoad(it) } }
    open override fun play(resId: Int, gain: Float): Int { plays += resId to gain; return if (failPlay) 0 else nextStream++ }
    override fun stop(streamId: Int) { stops += streamId }
    override fun isLoaded(resId: Int) = resId in loaded
}

/** 호출 순서를 한 목록에 기록하는 진동 포트. */
class OrderVibrator(private val log: MutableList<String>) : VibratorPort {
    override fun vibrate(waveform: Waveform) { log += "vibrate" }
    override fun click() { log += "click" }
}

class OrderFocusPort(private val log: MutableList<String>) : AudioFocusPort {
    var nextResult = AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    override fun request(listener: (Int) -> Unit): Int { log += "focus"; return nextResult }
    override fun abandon() { log += "abandon" }
}

/** spec §5-1 `play` 순서·보류 시작 톤·거절 3-state·선점·무음·옵트인 진동·종료 반납. 리소스 ID는 톤 서수(`R.raw` 대신). */
class GuideTonePlayerTest {
    private val log = mutableListOf<String>()
    private val sound = object : FakeSound() {
        override fun play(resId: Int, gain: Float): Int { log += "play"; return super.play(resId, gain) }
    }
    private val focusPort = OrderFocusPort(log)
    private val sched = FakeScheduler()
    private val focus = GuideAudioFocus(focusPort, sched.post)
    private val store = InMemoryKeyValueStore()
    private var now = 100.0
    private var volumeZero = false
    /** 실제 표처럼 left·right만 scheme으로 갈린다(15개). */
    private val resource: (BeaconTone, LeftRightToneScheme) -> Int = { t, s ->
        if (t == BeaconTone.left || t == BeaconTone.right) t.ordinal * 10 + s.ordinal else t.ordinal * 10
    }
    private val player = GuideTonePlayer(sound, focus, OrderVibrator(log), VolumePort { volumeZero }, store, { now }, resource)

    private fun ready() { player.preload(); sound.completeAll() }

    @Test fun `play 순서 — 진동 → 포커스 → 재생, toneEndsAt = now + 길이, 반납 예약 = 길이 + 0_15`() {
        ready()
        log.clear()
        player.play(BeaconTone.warning)
        assertEquals(listOf("vibrate", "focus", "play"), log)
        assertEquals(100.0 + 0.80, player.toneEndsAt)
        sched.runDue(0.9)
        assertEquals(0, log.count { it == "abandon" })
        sched.runDue(0.1)
        assertEquals(1, log.count { it == "abandon" })
        assertEquals(1f, sound.plays.single().second)
    }

    @Test fun `포커스 거절 — 진동 1·재생 0·toneEndsAt null, 3회 연속에 focusDenied, 허가 뒤 해제`() {
        ready()
        focusPort.nextResult = AudioManager.AUDIOFOCUS_REQUEST_FAILED
        log.clear()
        player.play(BeaconTone.closer.also { store.putString(TrendHaptics.storageKey, "true") })
        assertEquals(listOf("vibrate", "focus"), log)
        assertNull(player.toneEndsAt)
        assertFalse(player.focusDenied)
        player.play(BeaconTone.farther)
        assertFalse(player.focusDenied)
        player.play(BeaconTone.farther)
        assertTrue(player.focusDenied)
        assertEquals(0, sound.plays.size)
        focusPort.nextResult = AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        player.play(BeaconTone.farther)
        assertFalse(player.focusDenied)
        assertEquals(1, sound.plays.size)
    }

    @Test fun `로드 전 시작 톤은 1개 보류 → 로드 완료에 같은 경로로 재생, 다른 톤은 버린다`() {
        player.preload()
        assertEquals(15, sound.loadRequests.size)
        log.clear()
        player.play(BeaconTone.closer)
        player.play(BeaconTone.start)
        assertEquals(emptyList(), log)
        sound.completeAll()
        assertEquals(listOf("vibrate", "focus", "play"), log)
        assertEquals(resource(BeaconTone.start, LeftRightToneScheme.pitch), sound.plays.single().first)
        assertEquals(100.0 + 1.30, player.toneEndsAt)
    }

    @Test fun `beginSession은 보류 시작 톤을 지우고 반납 예약을 취소한다`() {
        player.preload()
        player.play(BeaconTone.start)
        player.beginSession()
        sound.completeAll()
        assertEquals(0, sound.plays.size)
        player.play(BeaconTone.stop)
        sched.runDue(1.0)
        player.beginSession()
        sched.runDue(2.0)
        assertEquals(0, log.count { it == "abandon" })
        assertTrue(focus.held)
    }

    @Test fun `재생 실패(0) → isSilenced, 다음 성공에 해제`() {
        ready()
        sound.failPlay = true
        player.play(BeaconTone.nearby)
        assertTrue(player.isSilenced)
        assertNull(player.toneEndsAt)
        sound.failPlay = false
        player.play(BeaconTone.nearby)
        assertFalse(player.isSilenced)
    }

    @Test fun `억제 중엔 아무것도 하지 않는다`() {
        ready()
        player.isSuppressed = true
        log.clear()
        player.play(BeaconTone.warning)
        assertEquals(emptyList(), log)
        assertNull(player.toneEndsAt)
    }

    @Test fun `옵트인 진동 — closer는 스위치 꺼짐이면 진동 0, 켜짐이면 1, warning은 무관`() {
        ready()
        log.clear()
        player.play(BeaconTone.closer)
        assertEquals(listOf("focus", "play"), log)
        store.putString(TrendHaptics.storageKey, "true")
        log.clear()
        player.play(BeaconTone.closer)   // 포커스는 이미 쥐고 있어 요청 로그가 없다
        assertEquals(listOf("vibrate", "play"), log)
        log.clear()
        store.putString(TrendHaptics.storageKey, "false")
        player.play(BeaconTone.warning)
        assertEquals(listOf("vibrate", "play"), log)
    }

    @Test fun `선점 — 두 번째 play가 첫 스트림을 stop한다`() {
        ready()
        player.play(BeaconTone.ahead)
        player.play(BeaconTone.left)
        assertEquals(listOf(1), sound.stops)
    }

    @Test fun `좌우 방식은 저장값 — 기본 pitch, pan 저장 시 pan 리소스`() {
        ready()
        player.play(BeaconTone.left)
        assertEquals(resource(BeaconTone.left, LeftRightToneScheme.pitch), sound.plays.last().first)
        store.putString(LeftRightToneScheme.storageKey, "pan")
        player.play(BeaconTone.right)
        assertEquals(resource(BeaconTone.right, LeftRightToneScheme.pan), sound.plays.last().first)
    }

    @Test fun `endSession — 잔여 재생 + 0_15초 뒤 반납, 미디어 볼륨 0 위임`() {
        ready()
        player.play(BeaconTone.stop)   // 1.30초
        now += 0.5
        player.endSession()            // 잔여 0.8 + 0.15
        sched.runDue(0.9)
        assertEquals(0, log.count { it == "abandon" })
        sched.runDue(0.1)
        assertEquals(1, log.count { it == "abandon" })
        assertFalse(player.isMediaVolumeZero)
        volumeZero = true
        assertTrue(player.isMediaVolumeZero)
    }

    @Test fun `게인 표`() {
        assertEquals(0.35f, toneGain(BeaconTone.closer))
        assertEquals(0.3f, toneGain(BeaconTone.tick))
        assertEquals(0.45f, toneGain(BeaconTone.unreliable))
        assertEquals(1f, toneGain(BeaconTone.nearby))
        assertEquals(0.8f, toneGain(BeaconTone.crosswalk))
    }
}
