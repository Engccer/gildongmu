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

/**
 * 키별 착지 요청자(목록 행) — 없으면 만든다. ⚠ **맵은 반드시 `remember`(또는 기억된 화면 상태 홀더) 안에 둔다**: 요청자의 수명은 맵의 수명이라
 * 그래야 재구성마다 새 요청자가 생기지 않는다. lint `RememberInComposition`은 인라인 `getOrPut` 람다 안의 생성만 보고 이 수명을 모르고, 이 함수는
 * 그 검사를 지나므로 기억되지 않는 맵에 쓰면 lint도 잡지 못한다.
 */
fun <K> MutableMap<K, FocusRequester>.requesterFor(key: K): FocusRequester = getOrPut(key) { FocusRequester() }
