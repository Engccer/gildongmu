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
 *   실시간 안내가 살아 있지 않으면 `resetRequests`를 올린다. 안내 중 복귀는 "유휴"가 아니다(iOS `!guideSession.isOccupied`).
 * - 탭 새로고침(B27 ①): 화면의 새로고침 버튼이 `refreshCurrentTab`을 부르고 `AppRoot`가 현재 탭만 초기화한다.
 */
object AppSession {
    const val ACTION_VOICE_SEARCH = "space.dodoplanet.gildongmu.action.VOICE_SEARCH"
    const val ACTION_NEARBY = "space.dodoplanet.gildongmu.action.NEARBY"

    private val _pending = MutableStateFlow<LaunchAction?>(null)
    val pending: StateFlow<LaunchAction?> = _pending.asStateFlow()

    /** 재생성된 검색 화면이 내리며 받아쓰기를 시작하는 1회 신호. */
    val voiceStartRequested = MutableStateFlow(false)

    private val _resetRequests = MutableStateFlow(0)
    val resetRequests: StateFlow<Int> = _resetRequests.asStateFlow()

    private val _refreshRequests = MutableStateFlow(0)
    val refreshRequests: StateFlow<Int> = _refreshRequests.asStateFlow()

    /** 백그라운드 진입 시각(초). null = 기록 없음. */
    internal var backgroundedAt: Double? = null

    fun actionFor(intentAction: String?): LaunchAction? = when (intentAction) {
        ACTION_VOICE_SEARCH -> LaunchAction.voiceSearch
        ACTION_NEARBY -> LaunchAction.nearby
        else -> null
    }

    /** 인텐트 진입. 진입 자체가 리셋이므로 같은 전경 전환의 유휴 판정을 무효화한다(iOS `consumeLaunchAction`의 `backgroundedAt = nil`). */
    fun offer(intentAction: String?) {
        val action = actionFor(intentAction) ?: return
        backgroundedAt = null
        _pending.value = action
    }

    /** `AppRoot`가 보류 액션을 꺼낸다. 직전 음성 검색의 잔존 신호는 액션과 무관하게 지운다(유령 마이크 시작 차단). */
    fun take(): LaunchAction? {
        val action = _pending.value ?: return null
        _pending.value = null
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
        if (reset) _resetRequests.value += 1
        return reset
    }

    fun refreshCurrentTab() {
        _refreshRequests.value += 1
    }

    /** 테스트 전용. */
    internal fun resetForTest() {
        _pending.value = null
        voiceStartRequested.value = false
        backgroundedAt = null
        _resetRequests.value = 0
        _refreshRequests.value = 0
    }
}

/**
 * 모든 탭을 초기 상태로 되돌리고 `target` 탭을 연다(유휴 리셋·바로가기, iOS `resetSession` + 탭 선택).
 * 현재 스택을 상태 저장 없이 비워(그 엔트리의 ViewModel 폐기 — 채팅 스트림도 함께 취소된다) 시작 탭을 새로 세우고, 다른 탭의 저장된 백스택을 지운다.
 */
fun NavController.resetAllTabs(tabs: List<AppTab>, initial: AppTab, target: AppTab) {
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
