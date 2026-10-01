package space.dodoplanet.gildongmu.guide.ui

import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalView
import space.dodoplanet.gildongmu.guide.GuideDiag

/**
 * 이 컴포지션 윈도에서 커서가 옮겨 갈 때마다 그 노드의 고정 표식(리소스 id = `testTag`, 조상에 `testTagsAsResourceId`가 있어야 한다)을 알린다(E57 착지 —
 * 대기 중 사용자 이동·소실 복구·자동 채택 판정). 모르는 노드면 null.
 *
 * Compose 노드의 접근성 이벤트는 `AndroidComposeView`가 부모 뷰의 `requestSendAccessibilityEvent`로 올리므로 부모에 위임자를 달아 엿본다(전달은 그대로).
 * ⚠ Compose 1.12의 접근성 초점 이벤트에는 노드 이름(text·contentDescription)이 실리지 않는다(바이트코드 확인, 리뷰 HIGH-1) — 이벤트를 보내기 전에
 * 갱신된 **초점 노드 자체**를 노드 제공자에서 조회한다(`findFocus`). 접근성 초점(TalkBack 스와이프)과 입력 초점(한소네 키보드 모드 — 터치 탐색이 꺼지면
 * 접근성 초점 이벤트가 0건이다) 둘 다 이동으로 받는다. 부모에 이미 다른 위임자가 있으면 덮지 않고 관찰을 포기한다(로그) — 그때 착지는 이동 취소·소실
 * 복구 없이 동작한다. iOS `elementFocusedNotification`·`focusedRow` 바인딩의 안드로이드 근사(실기기 판정 행).
 */
@Composable
fun ObserveA11yFocus(onFocus: (tag: String?) -> Unit) {
    val view = LocalView.current
    val latest by rememberUpdatedState(onFocus)
    DisposableEffect(view) {
        val parent = view.parent as? ViewGroup
        if (parent == null || parent.accessibilityDelegate != null) {
            GuideDiag.log("a11yFocus observe unavailable parent=${parent?.javaClass?.simpleName}")
            return@DisposableEffect onDispose { }
        }
        val delegate = object : View.AccessibilityDelegate() {
            override fun onRequestSendAccessibilityEvent(host: ViewGroup, child: View, event: AccessibilityEvent): Boolean {
                val kind = when (event.eventType) {
                    AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED -> AccessibilityNodeInfo.FOCUS_ACCESSIBILITY
                    AccessibilityEvent.TYPE_VIEW_FOCUSED -> AccessibilityNodeInfo.FOCUS_INPUT
                    else -> null
                }
                if (kind != null) latest(child.accessibilityNodeProvider?.findFocus(kind)?.viewIdResourceName)
                return super.onRequestSendAccessibilityEvent(host, child, event)
            }
        }
        parent.accessibilityDelegate = delegate
        onDispose { if (parent.accessibilityDelegate === delegate) parent.accessibilityDelegate = null }
    }
}
