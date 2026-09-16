package space.dodoplanet.gildongmu.chat

import android.util.Log
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester

/**
 * 착지 한 번(부착 관용구는 `a11y/Landing.kt` `landingTarget`·`mergedRow(focus)`). 성패는 `requestFocus(FocusDirection.Enter)`의 Boolean으로 본다(방향을 명시해 Boolean 판을 고른다). 실패·예외는 로그로만 —
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
