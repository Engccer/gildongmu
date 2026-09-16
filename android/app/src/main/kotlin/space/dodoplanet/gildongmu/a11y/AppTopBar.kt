package space.dodoplanet.gildongmu.a11y

import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material3.Scaffold
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R

/**
 * 화면 껍데기: 상단 바 + 본문. 골격의 바깥 `Scaffold`(`AppRoot`)가 상태바·탭 바 인셋을 이미 먹였으므로 여기서는 `WindowInsets(0)` —
 * 화면마다 `Scaffold`를 직접 열면 이 한 줄을 빠뜨려 Android 15+에서 인셋이 두 겹이 된다(M2 리뷰). 새 화면은 이것을 쓴다.
 */
@Composable
fun AppScreenScaffold(
    title: String,
    onBack: (() -> Unit)?,
    titleFocus: FocusRequester? = null,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { AppTopBar(title, onBack, titleFocus, actions) },
        content = content,
    )
}

/**
 * 공통 상단 바(spec §3-1): 제목은 헤딩(스크린 리더의 헤딩 점프가 화면 진입점), 스택 화면은 왼쪽에 뒤로, 오른쪽에 화면별 동작.
 * 화면마다 제목 자리가 같아야 위치를 외워 쓰는 탐색이 흔들리지 않는다. `titleFocus`는 진입 착지용(§3-2).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppTopBar(
    title: String,
    onBack: (() -> Unit)?,
    titleFocus: FocusRequester? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = {
            Text(
                title,
                modifier = Modifier
                    .testTag("title")
                    .headingText()
                    .let { m -> if (titleFocus != null) m.focusRequester(titleFocus).focusable() else m },
            )
        },
        navigationIcon = {
            if (onBack != null) {
                IconButton(onClick = onBack, modifier = Modifier.testTag("back")) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.android_common_back))
                }
            }
        },
        actions = actions,
        // 골격의 바깥 Scaffold(AppRoot)가 상태바 인셋을 이미 padding으로 먹였다 — 여기서 또 넣으면 Android 15+에서 두 겹(M2 리뷰 M3).
        windowInsets = WindowInsets(0, 0, 0, 0),
    )
}
