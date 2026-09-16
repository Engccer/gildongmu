package space.dodoplanet.gildongmu.a11y

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.dodoplanet.gildongmu.kit.joinText

/**
 * 앱 수준 통지 큐(spec §13-5, 판정 33) — 화면 밖에서 일어난 상태 변경(수동 위치 자동 해제·언어 변경)을 **화면의 단일 `StatusLine`**이 읽어 낭독한다.
 * iOS `AccessibilityNotification.Announcement`는 화면 라이브 리전과 다른 큐라 둘 다 발화하지만, 안드로이드는 화면당 라이브 리전 하나(§3)라 병합이
 * 필요하고 그 규칙이 통지를 삼키면 안 된다:
 * - **덮이지 않는 1칸 큐**: `pending`은 집어 갈 때까지 화면 통지가 밀어내지 못하고, 그 뒤에 온 앱 통지는 대기한다.
 * - **소유자는 하나**: 내비게이션 전환 프레임에는 두 `StatusLine`이 살아 있으므로 `RESUMED`인 쪽이 `claim(seq)`로 가져간다(`pending → claimed`).
 *   `consume(seq)`는 **발화 성공 시점**에서만(`claimed`를 비우고 큐 머리를 `pending`으로), 발화 전에 떠나면 `restore(seq)`(`claimed → pending`,
 *   그 사이 앉은 통지는 큐 앞으로 — 되돌아온 것이 먼저 낭독된다).
 * 프로세스 수명이라 액티비티 재생성을 넘긴다(언어 변경 통지).
 */
object AppNotices {
    private val _pending = MutableStateFlow<Notice?>(null)
    val pending: StateFlow<Notice?> = _pending.asStateFlow()
    private val queue = ArrayDeque<Notice>()
    private var claimed: Notice? = null
    private var seq = 0

    /** `haptic`: 자동 해제 = `attention`, 언어 적용 = `success`(spec §14-3). */
    @Synchronized
    fun post(text: String, spoken: String? = null, haptic: HapticKind? = null) {
        val notice = Notice(++seq, text, spoken, haptic)
        if (_pending.value == null) _pending.value = notice else queue.addLast(notice)
    }

    /** `pending → claimed`. 같은 seq이고 아직 아무도 집지 않았을 때만 그 통지를 돌려준다(아니면 null). 집은 쪽이 발화하고 `consume`한다. */
    @Synchronized
    fun claim(seq: Int): Notice? {
        val notice = _pending.value ?: return null
        if (notice.seq != seq || claimed != null) return null
        claimed = notice
        _pending.value = null
        return notice
    }

    /** 발화 성공 latch — 집은 통지를 비우고 큐 머리를 `pending`으로 올린다(그 사이 `pending`에 앉은 통지가 있으면 그대로 둔다). */
    @Synchronized
    fun consume(seq: Int) {
        if (claimed?.seq != seq) return
        claimed = null
        if (_pending.value == null) _pending.value = queue.removeFirstOrNull()
    }

    /** 발화 전에 소유자가 떠났다 — `claimed → pending`. 되돌아온 통지가 먼저 낭독되도록 그 사이 앉은 통지는 큐 앞으로 민다. */
    @Synchronized
    fun restore(seq: Int) {
        val notice = claimed?.takeIf { it.seq == seq } ?: return
        claimed = null
        _pending.value?.let { queue.addFirst(it) }
        _pending.value = notice
    }

    /** 테스트 전용 초기화. */
    @Synchronized
    internal fun reset() { queue.clear(); claimed = null; _pending.value = null; seq = 0 }
}

/**
 * 화면 통지와 집은 앱 통지의 병합(순수). 앱 통지가 있으면 **한 문장으로 합친다**(앱 통지가 앞 — CLAUDE.md "같은 커밋에 두 문장이 나는 자리는
 * 대기 꼬리로 합친다" 동형: "이동이 감지되어 지정한 위치를 해제했습니다, 주변 역 3곳") 그리고 결과에 호출자가 준 **단조 세대**를 찍는다(두 카운터를
 * 비교하지 않는다; 같은 수의 텍스트 교체가 발화 효과를 건너뛰는 침묵 방지). 진동은 **앱 통지의 종류가 이긴다**(null이면 화면 것). 앱 통지가 없으면 화면 통지 그대로.
 */
fun mergeNotices(screen: Notice, app: Notice?, nextSeq: Int): Notice {
    if (app == null) return screen
    val text = joinText(app.text, screen.text)
    val spoken = joinText(app.spoken ?: app.text, screen.spoken ?: screen.text).takeIf { it != text }
    return Notice(nextSeq, text, spoken, app.haptic ?: screen.haptic)
}
