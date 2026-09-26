package space.dodoplanet.gildongmu.guide.ui

import android.os.Bundle
import androidx.navigation.NavController
import androidx.navigation.NavDestination
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.place.PlaceDetailRoute

/**
 * 안내 시트에서 장소 상세 열기(M4b spec §4.4, iOS 표준 중첩 시트의 안드로이드 판). 시트는 자기 윈도라 그 위에 스택 화면을 띄울 수 없으므로 시트를
 * 접고(띠바 착지 1회 억제) 상세를 push하고, **push한 그 엔트리**가 백스택에서 빠지면(뒤로·탭 전환) 시트를 다시 연다(`openWeightSettings` 선례).
 * ⚠ `getBackStackEntry<PlaceDetailRoute>()` 타입 조회로 판정하지 않는다 — 다른 탭 스택에 원래 있던 상세를 잡아 영영 재개하지 않는다. 상세 위에 쌓인
 * 화면(채팅·주변)은 그 엔트리가 아직 스택에 있으므로 무시한다. `returnTo`는 재개 착지(제목 또는 주변 확인 행 키). 안내 신호는 억제하지 않는다
 * (임박 큐는 안전 계층, iOS 동형).
 */
fun NavController.openGuidePlace(place: Place, showsDirectionsEntry: Boolean, returnTo: String) {
    GuideSession.pendingSheetReturn = returnTo
    GuideSession.suppressNextBandLanding = true
    GuideSession.isMinimized = true
    navigate(PlaceDetailRoute.of(place).copy(showsDirectionsEntry = showsDirectionsEntry))
    val pushedId = currentBackStackEntry?.id ?: return GuideSession.reopenAfterNestedScreen()
    addOnDestinationChangedListener(object : NavController.OnDestinationChangedListener {
        override fun onDestinationChanged(controller: NavController, destination: NavDestination, arguments: Bundle?) {
            if (controller.currentBackStack.value.any { it.id == pushedId }) return
            controller.removeOnDestinationChangedListener(this)
            GuideSession.reopenAfterNestedScreen()
        }
    })
}

/** 재개 착지 표식 — 제목 행(제목 메뉴에서 연 장소 상세). 주변 확인 행은 그 행 키를 그대로 쓴다. */
const val GUIDE_TITLE_RETURN = "guide-title"
