package space.dodoplanet.gildongmu.guide.ui

import android.app.Activity
import android.view.WindowManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.guideStrings

/**
 * `AppRoot`의 `bottomBar` 삽입 한 자리(spec §7-2): 세션 조립(멱등) → 권한 손 → 전경 관찰자 → 띠바(최소화 시) + 탭 → 시트
 * (`ModalBottomSheet`는 자기 윈도라 bottomBar 측정에 0 기여). `nav`는 시트가 앱 골격에 요청하는 이동(종료 화면 [체중 입력하기](E31)의 설정 push·장소 상세 중첩(M4b)). 화면 유지(`FLAG_KEEP_SCREEN_ON`)는 시트가 펼쳐진 동안만(§12-8).
 */
@Composable
fun GuideBottomBar(nav: GuideNav, tabs: @Composable () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext
    remember { GuideSession.attach(app); Unit }
    val strings = remember(context.resources) { guideStrings(context.resources) }
    GuidePermissionsLauncher()
    ForegroundObserver()
    val ui by GuideSession.walk.ui.collectAsState()
    val hasScreen = ui.hasScreen
    val minimized = GuideSession.isMinimized
    val showsSheet = hasScreen && !minimized
    KeepScreenOn(showsSheet)
    val bandFocus = remember { FocusRequester() }
    Column {
        if (hasScreen && minimized) {
            GuideBand(ui, strings, bandFocus)
            // 최소화 직후·백그라운드를 거친 전경 복귀(알림 탭) → 띠바 착지.
            LaunchedEffect(GuideSession.bandLandingSeq) {
                if (GuideSession.suppressNextBandLanding) GuideSession.suppressNextBandLanding = false else land(bandFocus, "띠바")
            }
        }
        tabs()
    }
    if (showsSheet) GuideSheet(ui, strings, nav)
}

/**
 * 안내 시트가 지금 펼쳐져 있는가(M4b 후속 ②) — `AppRoot`가 탭 화면에 `LocalModalOpen`으로 공급한다. 시트(자기 윈도)와 밑 탭 화면이 둘 다 RESUMED라
 * 그대로 두면 탭의 `StatusLine`이 앱 통지(`AppNotices`)를 집어 시트 뒤에서 읽힌다(설계 리뷰 #1). 큐는 덮이지 않으므로 시트를 접는 순간 밑 화면이
 * 집는다. 세션 조립은 멱등이라 `GuideBottomBar`보다 먼저 컴포즈돼도 안전하다.
 */
@Composable
fun guideSheetShowing(): Boolean {
    val app = LocalContext.current.applicationContext
    remember { GuideSession.attach(app); Unit }
    val ui = GuideSession.walk.ui.collectAsState()
    // 결과가 바뀔 때만 읽는 자리를 재구성한다 — 안내 상태는 fix마다 바뀌어, 그대로 읽으면 탭 콘텐츠 블록이 매초 다시 돈다(리뷰 m4).
    val showing by remember { derivedStateOf { ui.value.hasScreen && !GuideSession.isMinimized } }
    return showing
}

/** 알림(33+)·걸음 센서 권한 손 — `MainActivity`는 android-m1 소유라 여기 컴포지션에 둔다. */
@Composable
private fun GuidePermissionsLauncher() {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { GuideSession.permissions.deliver() }
    DisposableEffect(launcher) {
        GuideSession.permissions.attach { launcher.launch(it) }
        onDispose { GuideSession.permissions.detach() }
    }
}

/** ON_START/ON_STOP → 전경 판정 입력(§5-3). */
@Composable
private fun ForegroundObserver() {
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> GuideSession.setForeground(true)
                Lifecycle.Event.ON_STOP -> GuideSession.setForeground(false)
                else -> Unit
            }
        }
        owner.lifecycle.addObserver(observer)
        if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) GuideSession.setForeground(true)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
}

@Composable
private fun KeepScreenOn(on: Boolean) {
    val view = LocalView.current
    DisposableEffect(on, view) {
        val window = (view.context as? Activity)?.window
        if (on) window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }
}
