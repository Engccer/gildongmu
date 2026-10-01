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
 * 갱신된 **초점 노드 자체**를 노드 제공자에서 조회한다(`findFocus`). ⚠ 입력 초점은 보지 않는다: Compose 1.12는 내부 노드 사이 입력 초점 이동에
 * `TYPE_VIEW_FOCUSED`를 보내지 않고, 오는 것은 뷰 자체의 초점 획득뿐이라 낡은 노드를 돌려준다(증분 리뷰) — 한소네 키보드 이동(터치 탐색이 꺼지면 접근성
 * 초점 이벤트가 0건)은 잡히지 않는다(실기기 판정 행). 부모에 이미 다른 위임자가 있으면 덮지 않고 관찰을 포기한다(로그) — 그때 착지는 이동 취소·소실
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
                if (event.eventType == AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED) {
                    latest(child.accessibilityNodeProvider?.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY)?.viewIdResourceName)
                }
                return super.onRequestSendAccessibilityEvent(host, child, event)
            }
        }
        parent.accessibilityDelegate = delegate
        onDispose { if (parent.accessibilityDelegate === delegate) parent.accessibilityDelegate = null }
    }
}
