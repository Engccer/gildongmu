package space.dodoplanet.gildongmu.nav

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel

/** pop 복귀 착지 키만 드는 ViewModel(허브 같은 상태 없는 화면용, spec §3-1). 저장은 `SavedStateHandle`, 소비는 한 번. */
class ReturnFocusViewModel(private val savedState: SavedStateHandle) : ViewModel() {
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
