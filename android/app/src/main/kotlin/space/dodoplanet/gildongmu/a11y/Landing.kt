package space.dodoplanet.gildongmu.a11y

import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester

/**
 * 버튼·클릭 행의 착지 관용구 — 앱 안의 `focusRequester(` 부착은 `mergedRow(focus)`와 이것뿐(소스 가드 `AppSourceGuardTest`).
 *
 * ⚠ Compose 1.12 `clickable`(Material3 `Button` 포함)의 포커스 타깃은 `Focusability.SystemDefined`라 **입력 모드가 터치이면 포커스를 받지
 * 않는다**(M6 설계 리뷰가 aar 바이트코드로 확인). TalkBack 폰 사용자는 터치 모드라 버튼에 대한 `requestFocus()`가 예외 없이 `false`로
 * 끝나고, 한소네(키보드 모드) 실측만 초록이라 놓친다. `focusProperties { canFocus = true }`가 그 뒤 체인의 포커스 타깃을 모드와 무관하게
 * 켠다. `mergedRow`의 `focusable()`은 `Focusability.Always`라 이 관용구가 필요 없다.
 */
fun Modifier.landingTarget(requester: FocusRequester): Modifier = focusRequester(requester).focusProperties { canFocus = true }
