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
 * `AppRoot`의 `bottomBar` 삽입 한 자리(spec §7-2): 정식 빌드는 탭 바만(진입점 0 — 관찰자·손 등록보다 **앞**의 게이트, 리뷰 N3-1).
 * 실험판은 세션 조립(멱등) → 권한 손 → 전경 관찰자 → 띠바(최소화 시) + 탭 → 시트(`ModalBottomSheet`는 자기 윈도라 bottomBar 측정에
 * 0 기여). 화면 유지(`FLAG_KEEP_SCREEN_ON`)는 시트가 펼쳐진 동안만(§12-8).
 */
@Composable
fun GuideBottomBar(tabs: @Composable () -> Unit) {
    if (!GuideSession.experimentalEnabled()) { tabs(); return }   // 기본값 = AppConfig.experimentalGuidanceEnabled(androidTest만 바꿔 끼운다)
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
            LaunchedEffect(GuideSession.bandLandingSeq) { land(bandFocus, "띠바") }
        }
        tabs()
    }
    if (showsSheet) GuideSheet(ui, strings)
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
