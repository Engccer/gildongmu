package space.dodoplanet.gildongmu.guide.ui

import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalView
import space.dodoplanet.gildongmu.guide.GuideDiag

/**
 * 이 컴포지션 윈도에서 스크린 리더 커서(접근성 초점)가 옮겨 갈 때마다 그 노드의 낭독 이름을 알린다(E57 착지 — 대기 중 사용자 이동·소실 복구 판정).
 * Compose 노드의 접근성 이벤트는 `AndroidComposeView`가 부모 뷰의 `requestSendAccessibilityEvent`로 올리므로, 부모에 위임자를 달아 초점 이벤트만
 * 엿본다(전달은 그대로 한다). 부모에 이미 다른 위임자가 있으면 덮지 않고 관찰을 포기한다(로그) — 그때 착지는 이동 취소·소실 복구 없이 동작한다.
 * iOS `elementFocusedNotification` 판정의 안드로이드 근사다(실기기 판정 행).
 */
@Composable
fun ObserveA11yFocus(onFocus: (label: String) -> Unit) {
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
                if (event.eventType == AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED) latest(a11yEventLabel(event.contentDescription, event.text))
                return super.onRequestSendAccessibilityEvent(host, child, event)
            }
        }
        parent.accessibilityDelegate = delegate
        onDispose { if (parent.accessibilityDelegate === delegate) parent.accessibilityDelegate = null }
    }
}

/** 이벤트의 낭독 이름 — 설명이 있으면 그것(병합 행의 `contentDescription`), 없으면 텍스트 조각(버튼 라벨). */
fun a11yEventLabel(contentDescription: CharSequence?, text: List<CharSequence>): String =
    contentDescription?.toString()?.takeIf { it.isNotEmpty() } ?: text.joinToString(" ")
