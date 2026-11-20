package space.dodoplanet.gildongmu.settings

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.nav.AppSession

/**
 * 탭 루트 상단 바의 공용 동작 묶음(spec §14-1 판정 42, §3-1 순서: 화면 고유 액션 뒤): 「새로고침」 → 「설정」. 탭 루트 네 곳만 부른다.
 *
 * 「새로고침」(B27 ①, iOS 제목 메뉴 `refreshTab`)은 현재 탭만 초기 상태로 되돌린다(채팅은 새 대화). 안드로이드 상단 바에는 제목 메뉴가 없어
 * iOS 실험판 자리(설정 앞 버튼, `experimentalTopBarRefreshEnabled`)를 따른다. 누른 버튼은 화면째 다시 서므로 새 탭 루트의 같은 버튼에
 * 착지한다(헌장 §5 복원 — 라벨 「새로고침」이 곧 완료 신호라 별도 통지는 없다). `focus`는 설정 pop 복귀 착지용.
 */
@Composable
fun SettingsAction(onOpen: () -> Unit, focus: FocusRequester) {
    val refreshFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        if (!AppSession.takeRefreshLanding()) return@LaunchedEffect
        withFrameNanos { }
        runCatching { refreshFocus.requestFocus() }
    }
    IconButton(onClick = AppSession::refreshCurrentTab, modifier = Modifier.tapTarget().testTag(REFRESH_TAG).landingTarget(refreshFocus)) {
        Icon(Icons.Filled.Refresh, contentDescription = stringResource(R.string.android_common_refresh))
    }
    IconButton(onClick = onOpen, modifier = Modifier.tapTarget().testTag(SETTINGS_RETURN_KEY).landingTarget(focus)) {
        Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.android_settings_title))
    }
}

/** 설정 버튼의 testTag이자 pop 복귀 키. */
const val SETTINGS_RETURN_KEY = "settings"

/** 탭 루트 「새로고침」 버튼의 testTag. */
const val REFRESH_TAG = "tab-refresh"

/** 정보 출처에서 설정으로 돌아올 때의 복귀 키. */
const val DATA_SOURCES_RETURN_KEY = "dataSources"
