package space.dodoplanet.gildongmu.nav

import androidx.lifecycle.SavedStateHandle

/**
 * pop 복귀 착지 키(spec §3-1) — 화면들이 공유하는 **한 벌**. 저장은 `SavedStateHandle`(프로세스 재생성 뒤에도 복원),
 * 소비는 한 번(착지를 시도하는 순간 무조건 지운다). 소비는 반드시 `LaunchedEffect` 안에서 — 컴포지션 본문에서 부르면
 * 재구성마다 값이 사라져 착지가 유실된다.
 */
class ReturnFocusSlot(private val savedState: SavedStateHandle) {
    fun remember(key: String) {
        savedState[KEY] = key
    }

    fun take(): String? {
        val key = savedState.get<String>(KEY)
        savedState.remove<String>(KEY)
        return key
    }

    companion object {
        const val KEY = "returnFocus"
    }
}
