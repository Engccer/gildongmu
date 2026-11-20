package space.dodoplanet.gildongmu.nav

import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import space.dodoplanet.gildongmu.kit.IdleReset

/** 앱 바로가기 진입 액션(iOS `LaunchAction`, `AppShortcuts.swift`). */
enum class LaunchAction { voiceSearch, nearby }

/**
 * 앱 세션 상태 — 액티비티 밖(프로세스 수명)에 두어 정적 바로가기의 새 태스크 재생성을 넘어 산다(iOS `LaunchActionStore.shared` 동형).
 *
 * - 바로가기: `res/xml/shortcuts.xml`의 인텐트 액션을 `offer`가 받아 `pending`에 1칸 보류하고, `AppRoot`가 소비한다(전 탭 초기화 → 목적 탭).
 *   음성 검색은 `voiceStartRequested`를 세우고 재생성된 검색 화면이 내리면서 받아쓰기를 시작한다 — `pending`과 나눈 이유는 iOS와 같다
 *   (재구성 때 소비가 다시 돌아도 `pending`은 이미 비어 리셋이 멱등이다).
 * - 유휴 리셋(B27 ②, iOS `GildongmuApp` scenePhase 갈래): 백그라운드 진입 시각을 적고, 복귀 때 10분(`IdleReset.interval`)을 넘었고
 *   실시간 안내가 살아 있지 않으면 `resetPending`을 세운다. 안내 중 복귀는 "유휴"가 아니다(iOS `!guideSession.isOccupied`).
 * - 탭 새로고침(B27 ①): 화면의 새로고침 버튼이 `refreshCurrentTab`을 부르고 `AppRoot`가 현재 탭만 초기화한다.
 */
object AppSession {
    const val ACTION_VOICE_SEARCH = "space.dodoplanet.gildongmu.action.VOICE_SEARCH"
    const val ACTION_NEARBY = "space.dodoplanet.gildongmu.action.NEARBY"

    private val _pending = MutableStateFlow<LaunchAction?>(null)
    val pending: StateFlow<LaunchAction?> = _pending.asStateFlow()

    /** 재생성된 검색 화면이 내리며 받아쓰기를 시작하는 1회 신호. */
    val voiceStartRequested = MutableStateFlow(false)

    // 리셋·새로고침은 1회 소비 깃발이다 — 세대 카운터면 액티비티 재생성(회전)으로 새로 선 `AppRoot`가 옛 요청을 다시 실행한다.
    private val _resetPending = MutableStateFlow(false)
    val resetPending: StateFlow<Boolean> = _resetPending.asStateFlow()

    private val _refreshPending = MutableStateFlow(false)
    val refreshPending: StateFlow<Boolean> = _refreshPending.asStateFlow()

    /** 새로고침 뒤 새로 선 탭 루트가 「새로고침」 버튼에 착지하는 1회 신호(누른 버튼이 화면째 사라져 커서가 떨어지므로, 헌장 §5 복원). */
    private var refreshLandingPending = false

    /** 백그라운드 진입 시각(초, `elapsedRealtime`). null = 기록 없음. 프로세스가 죽어도 액티비티 저장 상태로 넘어온다(`MainActivity`). */
    internal var backgroundedAt: Double? = null

    /** 프로세스 종료 뒤 복원(리뷰 지적): 백그라운드 사이 프로세스가 죽으면 메모리 기록이 사라져 복귀가 리셋되지 않는다. 새 프로세스일 때만 받는다. */
    fun restoreBackgroundedAt(saved: Double?) {
        if (backgroundedAt == null && saved != null) backgroundedAt = saved
    }

    fun actionFor(intentAction: String?): LaunchAction? = when (intentAction) {
        ACTION_VOICE_SEARCH -> LaunchAction.voiceSearch
        ACTION_NEARBY -> LaunchAction.nearby
        else -> null
    }

    /** 인텐트 진입. 진입 자체가 리셋이므로 같은 전경 전환의 유휴 판정을 무효화한다(iOS `consumeLaunchAction`의 `backgroundedAt = nil`). */
    // 액션을 받은 액티비티. 앱이 떠 있을 때 바로가기는 옛 액티비티를 지우고 새로 여는데(NEW_TASK|CLEAR_TASK), 지워지는 옛
    // `AppRoot`도 같은 전역 흐름을 보고 있어 먼저 꺼내 가면 새 화면은 처음 탭으로 뜬다(한소네 실측 2026-11-21). 받은 쪽만 꺼낸다.
    private var pendingOwner: Any? = null

    fun offer(intentAction: String?, owner: Any) {
        val action = actionFor(intentAction) ?: return
        backgroundedAt = null
        pendingOwner = owner
        _pending.value = action
    }

    /** `AppRoot`가 보류 액션을 꺼낸다. 직전 음성 검색의 잔존 신호는 액션과 무관하게 지운다(유령 마이크 시작 차단). */
    fun take(owner: Any): LaunchAction? {
        val action = _pending.value ?: return null
        if (owner !== pendingOwner) return null
        _pending.value = null
        pendingOwner = null
        voiceStartRequested.value = action == LaunchAction.voiceSearch
        return action
    }

    fun onBackground(now: Double) {
        backgroundedAt = now
    }

    /** 전경 복귀. 리셋을 요청했으면 true. 기록은 판정과 무관하게 지운다. */
    fun onForeground(now: Double, guideActive: Boolean): Boolean {
        val reset = IdleReset.shouldReset(backgroundedAt, now) && !guideActive
        backgroundedAt = null
        if (reset) _resetPending.value = true
        return reset
    }

    fun takeReset(): Boolean = _resetPending.value.also { _resetPending.value = false }

    fun refreshCurrentTab() {
        _refreshPending.value = true
    }

    fun takeRefresh(): Boolean {
        if (!_refreshPending.value) return false
        _refreshPending.value = false
        refreshLandingPending = true
        return true
    }

    fun takeRefreshLanding(): Boolean = refreshLandingPending.also { refreshLandingPending = false }

    /** 테스트 전용. */
    internal fun resetForTest() {
        _pending.value = null
        pendingOwner = null
        voiceStartRequested.value = false
        backgroundedAt = null
        _resetPending.value = false
        _refreshPending.value = false
        refreshLandingPending = false
    }
}

/**
 * 모든 탭을 초기 상태로 되돌리고 `target` 탭을 연다(유휴 리셋·바로가기, iOS `resetSession` + 탭 선택).
 *
 * 세 단계다. ① 탭 바처럼 시작 탭으로 가며 그 탭의 저장된 백스택을 되살린다 — 탭 전환이 시작 탭 위 화면을 시작 목적지 id로 저장해 두므로,
 * 되살려 살아 있는 스택으로 만들지 않으면 ②가 지우지 못하고 나중에 시작 탭을 누를 때 옛 화면이 돌아온다(리뷰 지적).
 * ② 살아 있는 스택 전부를 상태 저장 없이 빼고 시작 탭을 새로 세운다(엔트리 ViewModel 폐기 — 채팅 스트림도 함께 취소된다).
 * ③ 다른 탭의 저장된 백스택을 지운다. 시작 탭에 `clearBackStack`을 쓰지 않는 이유: 저장분을 복원한 뒤 그 목적지까지 빼므로 새 루트까지 지운다.
 */
fun NavController.resetAllTabs(tabs: List<AppTab>, initial: AppTab, target: AppTab) {
    navigate(initial.route()) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
    navigate(initial.route()) { popUpTo(graph.id) { inclusive = true } }
    for (tab in tabs) if (tab != initial) clearBackStack(tab.route())
    if (target != initial) {
        // 탭 바를 누른 것과 같은 옵션(`AppRoot`) — 지운 뒤라 되살릴 상태가 없어 새 루트가 선다.
        navigate(target.route()) {
            popUpTo(graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }
}

/**
 * 현재 탭만 초기 상태로(제목 메뉴 「새로고침」, iOS `refreshCurrentTab`): 그 탭의 루트부터 위를 상태 저장 없이 빼고 루트를 새로 세운다.
 * 다른 탭의 저장 상태는 그대로다. 채팅은 엔트리 ViewModel이 폐기되며 진행 중 스트림이 취소되고 새 대화가 된다.
 */
fun NavController.refreshTab(tab: AppTab) {
    navigate(tab.route()) {
        popUpTo(tab.route()) { inclusive = true }
        launchSingleTop = false
    }
}
