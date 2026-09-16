package space.dodoplanet.gildongmu.a11y

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.dodoplanet.gildongmu.kit.joinText

/**
 * 앱 수준 통지 큐(spec §13-5, 판정 33) — 화면 밖에서 일어난 상태 변경(수동 위치 자동 해제·언어 변경)을 **화면의 단일 `StatusLine`**이 읽어 낭독한다.
 * iOS `AccessibilityNotification.Announcement`는 화면 라이브 리전과 다른 큐라 둘 다 발화하지만, 안드로이드는 화면당 라이브 리전 하나(§3)라 병합이
 * 필요하고 그 규칙이 통지를 삼키면 안 된다:
 * - **덮이지 않는 1칸 큐**: `pending`은 소비될 때까지 화면 통지가 밀어내지 못하고, 그 뒤에 온 앱 통지는 대기한다.
 * - `consume(seq)`는 **발화 성공 시점**(`StatusLine`의 `LaunchedEffect` 끝)에서만, 그 seq의 pending만 지운다(내비게이션 전환 중 두 `StatusLine`이
 *   살아 있어도 발화한 쪽 하나가 소비한다).
 * 프로세스 수명이라 액티비티 재생성을 넘긴다(언어 변경 통지).
 */
object AppNotices {
    private val _pending = MutableStateFlow<Notice?>(null)
    val pending: StateFlow<Notice?> = _pending.asStateFlow()
    private val queue = ArrayDeque<Notice>()
    private var seq = 0

    @Synchronized
    fun post(text: String, spoken: String? = null) {
        val notice = Notice(++seq, text, spoken)
        if (_pending.value == null) _pending.value = notice else queue.addLast(notice)
    }

    @Synchronized
    fun consume(seq: Int) {
        if (_pending.value?.seq != seq) return
        _pending.value = queue.removeFirstOrNull()
    }

    /** 테스트 전용 초기화. */
    @Synchronized
    internal fun reset() { queue.clear(); _pending.value = null; seq = 0 }
}

/**
 * 화면 통지와 대기 중인 앱 통지의 병합(순수). 앱 통지가 있으면 **한 문장으로 합친다**(앱 통지가 앞 — CLAUDE.md "같은 커밋에 두 문장이 나는 자리는
 * 대기 꼬리로 합친다" 동형: "이동이 감지되어 지정한 위치를 해제했습니다, 주변 역 3곳") 그리고 결과에 **새 단조 seq**를 찍는다(두 카운터를 비교하지
 * 않는다; 같은 수의 텍스트 교체가 `LaunchedEffect(seq)`를 건너뛰는 침묵 방지). 앱 통지가 없으면 화면 통지 그대로.
 */
fun mergeNotices(screen: Notice, app: Notice?, nextSeq: Int): Notice {
    if (app == null) return screen
    val text = joinText(app.text, screen.text)
    val spoken = joinText(app.spoken ?: app.text, screen.spoken ?: screen.text).takeIf { it != text }
    return Notice(nextSeq, text, spoken)
}
