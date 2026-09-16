package space.dodoplanet.gildongmu.settings

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.tapTarget

/** 탭 루트 상단 바의 공용 "설정" 버튼(spec §14-1 판정 42, §3-1 순서: 화면 고유 액션 뒤). `focus`는 pop 복귀 착지용. */
@Composable
fun SettingsAction(onOpen: () -> Unit, focus: FocusRequester) {
    IconButton(onClick = onOpen, modifier = Modifier.tapTarget().testTag(SETTINGS_RETURN_KEY).landingTarget(focus)) {
        Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.android_settings_title))
    }
}

/** 설정 버튼의 testTag이자 pop 복귀 키. */
const val SETTINGS_RETURN_KEY = "settings"

/** 정보 출처에서 설정으로 돌아올 때의 복귀 키. */
const val DATA_SOURCES_RETURN_KEY = "dataSources"
