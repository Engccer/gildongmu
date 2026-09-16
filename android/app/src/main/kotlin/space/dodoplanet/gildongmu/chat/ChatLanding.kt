package space.dodoplanet.gildongmu.chat

import android.util.Log
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester

/**
 * 버튼 착지 대상(spec §3-4). Compose 1.12의 `clickable`(Material3 `Button` 포함)은 입력 모드가 터치면 포커스를 받지 않는다 —
 * TalkBack 폰 사용자는 터치 모드에 머물러 `focusRequester`만 걸면 착지가 예외 없이 조용히 실패한다(설계 리뷰 B1, 바이트코드 확인).
 * `focusProperties`는 뒤따르는 포커스 타깃의 `canFocus`를 덮는다. 반드시 `Button`의 수식자 **앞쪽**에 둔다.
 */
fun Modifier.landingTarget(requester: FocusRequester): Modifier = focusRequester(requester).focusProperties { canFocus = true }

/**
 * 착지 한 번. 성패는 `requestFocus(FocusDirection)`의 Boolean으로 본다(무인자 `requestFocus()`는 반환값이 없다). 실패·예외는 로그로만 —
 * 실기기에서 `adb logcat -s ChatFocus`로 실착지를 확인한다(iOS `ChatFocusDiag` 대응, spec §8). 개인정보는 싣지 않는다(태그만).
 */
fun land(requester: FocusRequester?, tag: String): Boolean {
    val ok = requester != null && try {
        requester.requestFocus(FocusDirection.Enter)
    } catch (e: IllegalStateException) {
        Log.w(LOG_TAG, "$tag 예외", e)
        false
    }
    Log.i(LOG_TAG, "$tag ${if (ok) "ok" else "fail"}")
    return ok
}

private const val LOG_TAG = "ChatFocus"
