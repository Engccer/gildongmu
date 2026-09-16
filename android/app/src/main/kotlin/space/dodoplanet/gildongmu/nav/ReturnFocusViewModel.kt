package space.dodoplanet.gildongmu.nav

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel

/** 상태 없는 화면(허브·상세)의 복귀 키 — 백스택 엔트리에 스코프된다. */
class ReturnFocusViewModel(savedState: SavedStateHandle) : ViewModel() {
    val slot = ReturnFocusSlot(savedState)
}
