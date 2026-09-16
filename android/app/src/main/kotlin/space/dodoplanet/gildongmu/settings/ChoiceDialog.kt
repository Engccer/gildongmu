package space.dodoplanet.gildongmu.settings

import android.util.Log
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.tapTarget

/**
 * 단일 선택 다이얼로그(spec §14-2·§14-3 — 언어 7행·받아쓰기 2행이 같은 관용구). 라우트 없음: 선택 즉시 닫힌다(뒤로 = dismiss).
 * 진입 착지는 **현재 선택된 행**(없으면 첫 행) — 현재 값이 다섯째 행일 때 스와이프로 세어 찾지 않게. 행은 `selectableGroup` 안 `RadioButton` 역할
 * 한 객체. 여는 화면이 `LocalModalOpen`을 참으로 제공한다(§13-5 — 모달 뒤에서 앱 통지를 집지 않는다).
 */
@Composable
fun ChoiceDialog(title: String, options: List<Pair<String, String>>, selected: String?, onSelect: (String) -> Unit, onDismiss: () -> Unit) {
    val requesters = remember { mutableMapOf<String, FocusRequester>() }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        val key = selected?.takeIf { s -> options.any { it.first == s } } ?: options.first().first
        runCatching { requesters[key]?.requestFocus() }.onFailure { Log.w("ChoiceDialog", "진입 착지 실패 $key", it) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.selectableGroup()) {
                for ((key, label) in options) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .tapTarget()
                            .testTag("choice-$key")
                            .landingTarget(requesters.getOrPut(key) { FocusRequester() }) // selectable 앞(착지 순서 가드)
                            .selectable(selected = key == selected, role = Role.RadioButton) { onSelect(key) }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = key == selected, onClick = null)
                        Text(label, Modifier.padding(start = 8.dp))
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.tapTarget().testTag("choice-cancel")) { Text(stringResource(R.string.actions_close)) } },
    )
}
