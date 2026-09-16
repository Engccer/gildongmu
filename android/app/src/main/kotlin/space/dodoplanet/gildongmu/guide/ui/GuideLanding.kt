package space.dodoplanet.gildongmu.guide.ui

import android.util.Log
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.focus.FocusRequester
import kotlinx.coroutines.delay

/**
 * 안내 화면 착지 관용구(spec §7): M1~M3의 `runCatching { requester.requestFocus() }.onFailure { Log.w }`에 "한 프레임 + 400ms 뒤,
 * 실패하면 600ms 뒤 한 번 더"만 더한다 — `ModalBottomSheet` 표시 애니메이션이 끝난 뒤 시스템이 포커스를 옮기므로 그보다 늦게
 * 대입한다(iOS `landTitleFocus` 동형). `requestFocus()`는 void라 Boolean 판정을 하지 않는다.
 */
suspend fun land(requester: FocusRequester, what: String) {
    withFrameNanos { }
    delay(400)
    runCatching { requester.requestFocus() }.onFailure {
        delay(600)
        runCatching { requester.requestFocus() }.onFailure { e -> Log.w("Guide", "$what 착지 실패", e) }
    }
}
