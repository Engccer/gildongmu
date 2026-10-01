package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.seconds

/** 기기 음성 대기 칸이 문장을 끝내 내지 못한 이유(E53 spec 2026-09-30 §4.2). Kit `DeviceSpeechQueue.swift` 미러. */
enum class DeviceSpeechDrop {
    /** 더 새 문장이 그 자리를 이었다(칸 교체·즉시 발화·선점). 복귀 상환 표식은 세우지 않는다. 1회성 장부는 되살린다. */
    superseded,

    /** 아무것도 잇지 않은 채 사라졌다(유효 시간·억제·채널 소실·보호 문장에 막힘·발화 실패). 복귀 상환 표식을 세운다. */
    undelivered;

    val rawValue: String get() = name
}

/**
 * 전경 복귀 인계의 결과(계약 6) — 넘길 문장(옛 것 → 새 것)과, 모델의 합본 통지가 끝내 나가지 못했을 때의 되돌림. 모델이 합본 통지의 `onDropped`에서
 * [undelivered]를 부르면 각 문장의 버림 통지가 `undelivered`로 **한 번** 불린다.
 */
class DeviceSpeechHandover internal constructor(items: List<Pair<String, ((DeviceSpeechDrop) -> Unit)?>>) {
    val texts: List<String> = items.map { it.first }
    private var drops: List<((DeviceSpeechDrop) -> Unit)?> = items.map { it.second }

    val isEmpty: Boolean get() = texts.isEmpty()

    /** 합본 통지가 끝내 나가지 못했다 — 인계한 문장마다 버림(`undelivered`)을 통지한다. 두 번 불려도 한 번만. */
    fun undelivered() {
        val pending = drops
        drops = emptyList()
        pending.forEach { it?.invoke(DeviceSpeechDrop.undelivered) }
    }

    companion object {
        /** 넘길 문장이 없는 인계. */
        val empty: DeviceSpeechHandover get() = DeviceSpeechHandover(emptyList())
    }
}

/**
 * 기기 음성 대기 한 칸(spec 2026-09-30 background-speech §4.2). iOS는 세 안내 모델이 하나씩 쓰고, 안드로이드는 도보 안내 하나가 쓴다.
 *
 * 계약(Swift와 같다):
 * 1. 안내 발화가 없으면 즉시 말한다(칸에 옛 문장이 있으면 `superseded`로 버린 뒤 — 순서 역전 금지).
 * 2. `highPriority`와 `urgent`(임박 명령)는 선점한다: 칸을 비우고 말하는 중인 안내를 끊고 즉시 말한다. 끊긴 것이 이 칸의 문장이면 `superseded`.
 * 3. 그 밖은 한 칸에 기다린다(latest-wins, 옛 문장은 `superseded`). 칸의 문장이 보호 문장이면 보호 문장이 아닌 새 문장은 들이지 않는다(`undelivered`).
 * 4. 말이 끝나면(0.3초 확인) 톤이 울리는 중이면 그 뒤까지(한 번의 대기당 상한 3초) 기다렸다가 꺼내고, 꺼내는 순간 억제 중(우회 제외)·유효 시간
 *    초과(보호 제외)면 버리고, 채널을 다시 고른다.
 * 5. 세션 경계 [reset]은 버림 통지 없이 비운다.
 * 6. 전경 복귀 [handOver]는 게시하지 않고 넘길 문장 목록을 돌려준다(이 칸이 낸 발화일 때만 끊는다 — 발화 토큰 대조).
 * 7. 칸 밖의 정지가 이 칸의 발화를 끊으면 그 문장에 버림을 통지한다([speechInterrupted]).
 * 버림 통지는 문장마다 **최대 한 번**이고 부르는 주체는 이 칸이다.
 *
 * **안드로이드 적응 두 곳**(iOS 합성기는 실패하지 않는다): `speak`가 null(포커스 거절·엔진 실패로 말하지 못했다)이면 그 문장은 `undelivered`,
 * `postVoiceOver`(안드로이드는 전경 직접 발화)가 false면 `undelivered`. 1회성 경고가 들리지 않은 채 "전달됨"으로 세지지 않게 한다.
 *
 * Swift `@MainActor` 대응: 메인 스레드 전용, `scope`도 메인 디스패처. 드레인 코루틴은 `LAZY`로 만들어 참조를 잡은 뒤 시작한다(`DeferredAnnouncer` 동형).
 */
class DeviceSpeechQueue(
    private val scope: CoroutineScope,
    private val clock: () -> Double,
    private val sleeper: suspend (seconds: Double) -> Unit = { seconds -> delay(seconds.seconds) },
    /** 어느 안내든 기기 음성이 말하는 중인가(채팅 듣기 제외). */
    private val isSpeaking: () -> Boolean,
    /** 그 발화 토큰의 문장이 아직 합성기에 있는가. */
    private val isSpeakingToken: (Int) -> Boolean,
    /** VoiceOver가 켜져 있는가 — 꺼져 있으면 복귀 인계가 기기 음성을 끊지 않는다. 안드로이드는 안내 채널이 TTS 하나라 늘 거짓을 넘긴다. */
    private val voiceOverRunning: () -> Boolean,
    private val isSuppressed: () -> Boolean,
    private val toneEndsAt: () -> Double?,
    /** 지금 채널(채널 술어를 그 시점 상태로 다시 부른다). */
    private val route: (GuideSpeechClass) -> GuideSpeechChannel,
    /** 안내 발화(직전 발화를 끊고 말한다). 발화 토큰, 말하지 못했으면 null. */
    private val speak: (String) -> Int?,
    private val stopSpeaking: () -> Unit,
    /** 드레인 시점에 채널이 `voiceOver`로 바뀐 문장의 게시(텍스트, 고우선). 게시하지 못했으면 false. */
    private val postVoiceOver: (String, Boolean) -> Boolean,
) {
    private class Item(
        val text: String,
        val highPriority: Boolean,
        val protected: Boolean,
        val bypassSuppression: Boolean,
        val speechClass: GuideSpeechClass,
        val onDropped: ((DeviceSpeechDrop) -> Unit)?,
        val at: Double,
    ) {
        /** 기다리지 않고 선점하는가(계약 2). */
        val preempts: Boolean get() = highPriority || speechClass == GuideSpeechClass.urgent
    }

    private class Spoken(val item: Item, val token: Int)

    private var pending: Item? = null

    /** 이 칸이 마지막으로 기기 음성에 넘긴 문장과 그 발화 토큰. 토큰이 아직 말하는 중일 때만 "지금 이 칸의 문장"이다. */
    private var lastSpoken: Spoken? = null
    private var drain: Job? = null

    /** 경계 세대 — `reset`·`handOver`·선점 뒤에 깨어난 옛 드레인이 새 칸을 건드리지 않게. */
    private var generation = 0

    /** 대기 칸에 문장이 있는가. */
    val hasPending: Boolean get() = pending != null

    /**
     * 기기 음성 채널로 고른 문장을 낸다(계약 1~3).
     * - `protected`: 보호 문장 — 유효 시간으로 버리지 않고 보호 문장이 아닌 새 문장에 밀리지 않는다.
     * - `bypassSuppression`: 사용자 활성화의 직접 응답 — 꺼낼 때 억제 검사를 면제한다.
     * - `onDropped`: 끝내 나가지 못하면 이유와 함께 한 번 불린다.
     */
    fun submit(
        text: String,
        highPriority: Boolean,
        protected: Boolean,
        bypassSuppression: Boolean,
        speechClass: GuideSpeechClass,
        onDropped: ((DeviceSpeechDrop) -> Unit)?,
    ) {
        val item = Item(text, highPriority, protected, bypassSuppression, speechClass, onDropped, clock())
        val speakingNow = isSpeaking()
        if (item.preempts || !speakingNow) {
            clearPending(DeviceSpeechDrop.superseded)
            // 끊길 이 칸의 문장 — 말하는 중이든 일시정지로 남았든(`isSpeakingToken`은 일시정지 포함).
            val current = lastSpoken
            if (current != null && isSpeakingToken(current.token)) {
                lastSpoken = null
                current.item.onDropped?.invoke(DeviceSpeechDrop.superseded)
            }
            say(item)
            return
        }
        val waiting = pending
        if (waiting != null && waiting.protected && !protected) {
            onDropped?.invoke(DeviceSpeechDrop.undelivered)
            return
        }
        pending = item
        waiting?.onDropped?.invoke(DeviceSpeechDrop.superseded)
        startDrainIfNeeded()
    }

    /** 세션 경계(시작·stop) — 칸을 **버림 통지 없이** 비운다. `stop()`은 상환 장부를 먼저 비우므로 여기서 통지하면 끝난 세션의 경고가 되살아난다. */
    fun reset() {
        generation += 1
        drain?.cancel()
        drain = null
        pending = null
        lastSpoken = null
    }

    /** 전경 복귀(계약 6). 넘길 문장을 옛 것 → 새 것 순서로 돌려준다(게시는 호출부가 한 통지로). */
    fun handOver(): DeviceSpeechHandover {
        if (!voiceOverRunning()) return DeviceSpeechHandover.empty
        val handed = mutableListOf<Pair<String, ((DeviceSpeechDrop) -> Unit)?>>()
        val current = lastSpoken
        if (current != null && isSpeakingToken(current.token) && route(current.item.speechClass) == GuideSpeechChannel.voiceOver) {
            stopSpeaking()
            lastSpoken = null
            if (current.item.bypassSuppression || !isSuppressed()) handed += current.item.text to current.item.onDropped
            else current.item.onDropped?.invoke(DeviceSpeechDrop.undelivered)
        }
        val waiting = pending
        if (waiting != null) {
            when (route(waiting.speechClass)) {
                GuideSpeechChannel.device -> Unit // 채널이 그대로다 — 칸은 드레인에 맡긴다
                GuideSpeechChannel.voiceOver -> {
                    clearDrain()
                    pending = null
                    if (isDeliverable(waiting)) handed += waiting.text to waiting.onDropped
                    else waiting.onDropped?.invoke(DeviceSpeechDrop.undelivered)
                }
                GuideSpeechChannel.drop -> {
                    clearDrain()
                    pending = null
                    waiting.onDropped?.invoke(DeviceSpeechDrop.undelivered)
                }
            }
        }
        return DeviceSpeechHandover(handed)
    }

    /** 칸 밖의 정지가 안내 발화를 끊었다(계약 7) — 그 발화가 이 칸이 낸 것이면 버림을 이유와 함께 통지한다. */
    fun speechInterrupted(token: Int, reason: DeviceSpeechDrop) {
        val current = lastSpoken ?: return
        if (current.token != token) return
        lastSpoken = null
        current.item.onDropped?.invoke(reason)
    }

    private fun clearDrain() {
        generation += 1
        drain?.cancel()
        drain = null
    }

    private fun clearPending(reason: DeviceSpeechDrop) {
        val dropped = pending ?: return
        pending = null
        clearDrain()
        dropped.onDropped?.invoke(reason)
    }

    private fun say(item: Item) {
        val token = speak(item.text)
        if (token == null) {
            item.onDropped?.invoke(DeviceSpeechDrop.undelivered)
            return
        }
        lastSpoken = Spoken(item, token)
    }

    /** 꺼내는 순간의 검사(계약 4) — 억제(우회 제외)·유효 시간(보호 제외). */
    private fun isDeliverable(item: Item): Boolean {
        if (!item.bypassSuppression && isSuppressed()) return false
        return item.protected || clock() - item.at <= pendingTTLSeconds
    }

    private fun startDrainIfNeeded() {
        if (drain != null) return
        val gen = generation
        val job = scope.launch(start = CoroutineStart.LAZY) {
            var toneWaitStart: Double? = null
            while (true) {
                sleeper(pollSeconds)
                if (!isActive || generation != gen) return@launch
                if (isSpeaking()) {
                    toneWaitStart = null // 다시 말하기 시작했다 — 톤 대기 상한은 다음 대기에서 새로 잰다
                    continue
                }
                // 톤 뒤 발화: 꺼내는 순간 톤이 울리는 중이면 그 뒤까지 — 한 번의 대기당 상한 3초.
                val now = clock()
                val more = speechDeferStep(now, toneEndsAt())
                if (more > 0) {
                    val started = toneWaitStart ?: now
                    toneWaitStart = started
                    val left = SpeechDeferConstants.speechDeferMaxSeconds - (now - started)
                    if (left > 0) {
                        sleeper(minOf(more, left))
                        if (!isActive || generation != gen) return@launch
                        continue
                    }
                }
                drain = null
                val next = pending ?: return@launch
                pending = null
                deliver(next)
                return@launch
            }
        }
        drain = job
        job.start()
    }

    private fun deliver(item: Item) {
        if (!isDeliverable(item)) {
            item.onDropped?.invoke(DeviceSpeechDrop.undelivered)
            return
        }
        when (route(item.speechClass)) {
            GuideSpeechChannel.device -> say(item)
            // 전경으로 바뀌었다(복귀 인계보다 드레인이 먼저 깬 창) — 인계와 같은 이유로 고우선.
            GuideSpeechChannel.voiceOver -> if (!postVoiceOver(item.text, true)) item.onDropped?.invoke(DeviceSpeechDrop.undelivered)
            GuideSpeechChannel.drop -> item.onDropped?.invoke(DeviceSpeechDrop.undelivered)
        }
    }

    companion object {
        /** 대기 칸 문장의 유효 시간(초). 늦게 나온 명령은 이미 지난 자리를 말한다. */
        const val pendingTTLSeconds = 6.0

        /** 말이 끝났는지 확인하는 간격(초). */
        const val pollSeconds = 0.3
    }
}
