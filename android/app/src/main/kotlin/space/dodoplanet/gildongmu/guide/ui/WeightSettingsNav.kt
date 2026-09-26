package space.dodoplanet.gildongmu.guide.ui

import android.os.Bundle
import androidx.navigation.NavController
import androidx.navigation.NavDestination
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.settings.SettingsRoute
import space.dodoplanet.gildongmu.settings.SettingsRow

/**
 * 종료 화면 [체중 입력하기](E31)의 설정 push. 설정 화면이 스택에서 빠지면(뒤로·탭 전환) 종료 화면 시트를 다시 연다 — 안드로이드는 설정이
 * 시트 위 시트가 아니라 스택 화면이라, 돌아와도 시트가 접힌 채면 갱신된 요약을 띠바를 찾아 펼쳐야만 듣는다(a11y 감사 m2).
 * 정보 출처처럼 설정 위에 쌓인 화면은 설정이 아직 스택에 있으므로 무시한다.
 */
fun NavController.openWeightSettings() {
    navigate(SettingsRoute(focusRow = SettingsRow.Weight)) { launchSingleTop = true }
    addOnDestinationChangedListener(object : NavController.OnDestinationChangedListener {
        override fun onDestinationChanged(controller: NavController, destination: NavDestination, arguments: Bundle?) {
            if (runCatching { controller.getBackStackEntry<SettingsRoute>() }.isSuccess) return
            controller.removeOnDestinationChangedListener(this)
            GuideSession.reopenAfterWeightSettings()
        }
    })
}
