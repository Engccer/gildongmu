package space.dodoplanet.gildongmu.place

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import space.dodoplanet.gildongmu.kit.RouteDestination
import space.dodoplanet.gildongmu.kit.RouteMode
import space.dodoplanet.gildongmu.kit.buildKakaoPlaceDeeplink
import space.dodoplanet.gildongmu.kit.buildKakaoRouteDeeplink
import space.dodoplanet.gildongmu.kit.buildKakaoWebRouteUrl
import space.dodoplanet.gildongmu.kit.buildNaverRouteDeeplink

/** 외부 앱 열기 계획: 딥링크 + 미설치 폴백(웹). 순수 값이라 JVM에서 판정을 잠근다. */
data class OpenPlan(val primary: String, val fallback: String?)

/** 네이버 지도 도보 길찾기(1급 사용자 주 시나리오). 권역 밖(빌더 null)이면 null → 버튼을 **숨긴다**(spec §10-19). 폴백은 카카오맵 웹 경로. */
fun naverRoutePlan(dest: RouteDestination, appId: String): OpenPlan? {
    val primary = buildNaverRouteDeeplink(RouteMode.walk, dest, appId) ?: return null
    return OpenPlan(primary, buildKakaoWebRouteUrl(RouteMode.walk, dest))
}

fun kakaoRoutePlan(dest: RouteDestination): OpenPlan? {
    val primary = buildKakaoRouteDeeplink(RouteMode.walk, dest) ?: return null
    return OpenPlan(primary, buildKakaoWebRouteUrl(RouteMode.walk, dest))
}

/** 카카오맵 장소 정보. 앱 미설치 폴백은 같은 장소의 카카오맵 웹 상세(경로 폴백은 다른 화면이라 오동작). */
fun kakaoPlacePlan(kakaoPlaceId: String): OpenPlan =
    OpenPlan(buildKakaoPlaceDeeplink(kakaoPlaceId), "https://place.map.kakao.com/$kakaoPlaceId")

/** `Place.id` "kakao-" 접두가 있을 때만 카카오 장소 상세 체인 유효(웹 계약). */
fun kakaoPlaceIdOf(placeId: String): String? = placeId.takeIf { it.startsWith("kakao-") }?.removePrefix("kakao-")

/** 스킴 처리 앱이 없는 것을 미리 묻지 않는다(`<queries>` 불필요) — `ActivityNotFoundException`으로 판정하고 폴백 1회. 그것도 실패면 `onFailed`. */
fun Context.openWithFallback(plan: OpenPlan, onFailed: () -> Unit) {
    if (tryOpen(plan.primary)) return
    if (plan.fallback != null && tryOpen(plan.fallback)) return
    onFailed()
}

private fun Context.tryOpen(url: String): Boolean = try {
    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    true
} catch (_: ActivityNotFoundException) {
    false
}
