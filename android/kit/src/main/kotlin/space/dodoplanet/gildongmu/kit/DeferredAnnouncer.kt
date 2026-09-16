package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.seconds

/**
 * 지연 발화 슬롯(spec 2026-08-14 §4) — 안내 효과음이 끝난 뒤에 음성 통지를 게시하는 비동기 수명 계약의 소유자.
 * Kit `DeferredAnnouncer.swift` 미러. 판정은 `speechDeferStep`(순수 함수, GUIDE `GuideSpeechGate.kt`)이 하고 여기는
 * 단일 슬롯 latest-wins·세대 토큰·게시 직전 재평가·onDropped만 담는다.
 *
 * 안내 모델에 인라인하지 않는 이유: 이 설계에서 가장 위험한 부분이 순수 함수가 아니라 이 수명 계약이고, 시계·sleeper를
 * 주입해야 테스트가 열린다.
 *
 * Swift `@MainActor` 대응: 동기화 없는 클래스라 메인 스레드에서만 부르고, `scope`도 메인 디스패처여야 한다. 예약
 * 코루틴은 `LAZY`로 만들어 슬롯에 넣은 뒤 시작한다 — 즉시 디스패처(`Main.immediate`)는 본문을 그 자리에서 돌릴 수
 * 있어, 슬롯 대입 전에 토큰 확인이 돌면 자기 문장을 버린다(Swift `Task {}`는 현재 코드가 끝난 뒤에 돈다).
 */
class DeferredAnnouncer(
    private val scope: CoroutineScope,
    /** 단조 시각(초) — :app은 `SystemClock.elapsedRealtime()`의 초 환산. */
    private val clock: () -> Double,
    /** 기본은 `delay(Duration)` — 양수 대기를 1ms 이상으로 올림한다(밀리초 절사는 0ms 대기로 재평가 루프를 스핀시킨다). */
    private val sleeper: suspend (seconds: Double) -> Unit = { seconds -> delay(seconds.seconds) },
    /** 지금 재생 중인 톤이 끝나는 단조 시각. 미재생·재생 실패면 null. */
    private val toneEndsAt: () -> Double?,
    /**
     * 실제 게시 시도 `(text, highPriority, bypassSuppression) -> 게시했는가`(억제 가드 → 전경 가드 → 게시). 지연은 타이밍만
     * 바꾸고 실패 처리 계약은 바꾸지 않는다(§4-4) — 대기가 끝난 게시 시도는 "그 시점에 announce를 부른 것"과 완전히
     * 같은 경로를 지난다. bypassSuppression은 `announceNow` 전용.
     */
    private val post: (text: String, highPriority: Boolean, bypassSuppression: Boolean) -> Boolean,
) {
    private class Slot(val token: Int, val job: Job, val onDropped: (() -> Unit)?)

    /** 세션 세대(§4-2). `advanceGeneration()`(세션 시작·stop·teardown)마다 증가하고, 게시 직전에 예약 시점 세대와 일치할 때만 발화한다. */
    private var generation = 0
    private var nextToken = 0

    /**
     * 단일 슬롯(§4-1) — 큐를 만들지 않는다. 안내는 최신이 참이다(늦게 말한 임박 명령은 이미 돈 모퉁이를 돌라는 명령이
     * 된다). onDropped를 함께 보관하는 이유는 `invalidatePending()` 참조.
     */
    private var slot: Slot? = null

    /**
     * 세션 경계(시작·stop·teardown) — 세대를 올리고 보류 문장을 **onDropped 없이** 버린다(§4-2). 취소하지 않으면 일반 정지
     * 뒤 끝난 경로의 명령이 뒤늦게 발화하고, 그사이 새 세션을 시작했으면 이전 목적지의 명령이 새 세션 안에서 나온다.
     * ⚠ 여기서 onDropped를 부르면 안 된다 — `stop()`은 상환 장부(계단 경고 등)를 먼저 비우고 이 함수를 부르므로, 복원이
     *   그 소거 **뒤에** 실행되어 끝난 세션의 경고가 부활한다.
     */
    fun advanceGeneration() {
        generation += 1
        slot?.job?.cancel()
        slot = null
    }

    /**
     * 선점(latest-wins) 폐기 — 새 통지·즉시 창구(`announceNow`) 진입 즉시 부른다(§4-1). 선점으로 버려지는 문장의
     * `onDropped`는 **이 시점에 호출한다**: 상환이 필요한 문장(계단 회피 경고·owed 합본)은 지연 창(최대 3초) 안에서 다른
     * 안내에 선점되면 게시도 상환도 없이 영구 소실되기 때문이다 — 게시 실패(§4-4)와 같은 "전달하지 못했다"이므로 장부
     * 보존도 같아야 한다. 세션 경계 폐기(`advanceGeneration`)와 달리 여기서는 장부가 아직 유효하다.
     */
    fun invalidatePending() {
        val dropped = slot ?: return
        dropped.job.cancel()
        slot = null
        dropped.onDropped?.invoke()
    }

    /**
     * 사용자 활성화의 **직접 응답** 전용 즉시 창구(§4-6 — 목적지 전환 확인). 즉시성이 문장의 본질이라 톤과 겹치더라도
     * 미루지 않는다. 단 보류 슬롯은 진입 즉시 버린다 — 즉시 문장이 나간 **뒤에** 이전 목적지의 명령이 발화하는 역전 차단.
     */
    fun announceNow(text: String, highPriority: Boolean = false, bypassSuppression: Boolean = false) {
        invalidatePending()
        post(text, highPriority, bypassSuppression)
    }

    /**
     * 자동 통지 창구. 톤 잔여만큼 미루고, 게시하지 못하면(억제·백그라운드) 그 시점에 `onDropped`를 부른다 — 상환이 필요한
     * 문장(계단 회피 경고 등)은 여기에 "갚기"를 담는다(§4-6. 반환값이 없는 것이 강제 수단이다 — 새 호출부가 "게시했는가"를
     * 물어볼 방법 자체가 없다).
     */
    fun announce(text: String, highPriority: Boolean = false, onDropped: (() -> Unit)? = null) {
        invalidatePending() // §4-1: 새 통지가 옛 보류 문장을 버린다(latest-wins)
        val wait = speechDeferStep(clock(), toneEndsAt())
        if (wait <= 0.0) {
            if (!post(text, highPriority, false)) onDropped?.invoke()
            return
        }
        nextToken += 1
        val token = nextToken
        val gen = generation
        val scheduledAt = clock()
        val job = scope.launch(start = CoroutineStart.LAZY) {
            var pending = wait
            while (true) {
                sleeper(pending)
                // §4-3: sleeper가 취소에 반응하지 않고 반환할 수 있으므로 확인 없이 게시하면 취소한 문장이 그 자리에서
                // 발화된다. 지금은 모든 무효화 경로가 코루틴을 취소해 `isActive`와 토큰·세대 확인이 겹치지만, 토큰·세대가
                // 정본이다(취소하지 않는 무효화가 생겨도 지켜진다) — 중복으로 보고 지우지 말 것.
                if (!isActive || slot?.token != token || generation != gen) return@launch
                // §4-5: 게시 직전 톤 상태 재평가 — 예약 후 새 톤이 시작됐으면 더 기다리되, 예약 시각부터의 총 대기가 상한을
                // 넘으면 그대로 게시한다(상한이 무한 연기를 구조적으로 막는다).
                val elapsed = clock() - scheduledAt
                val more = speechDeferStep(clock(), toneEndsAt())
                if (more > 0 && elapsed < SpeechDeferConstants.speechDeferMaxSeconds) {
                    pending = minOf(more, SpeechDeferConstants.speechDeferMaxSeconds - elapsed)
                    continue
                }
                // §4-3 ABA: 슬롯 해제는 **자기 토큰일 때만**. 무조건 지우면 옛 코루틴의 종료 코드가 새 슬롯 참조를 지워
                // teardown이 아무것도 취소하지 못한다.
                if (slot?.token == token) slot = null
                if (!post(text, highPriority, false)) onDropped?.invoke()
                return@launch
            }
        }
        slot = Slot(token, job, onDropped)
        job.start()
    }
}
