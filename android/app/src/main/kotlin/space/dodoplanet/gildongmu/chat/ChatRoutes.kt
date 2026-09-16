package space.dodoplanet.gildongmu.chat

import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.KitJson
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.nav.ChatRoute

/**
 * 장소 채팅 라우트(자기 패키지 소유). 장소는 ID 재조회가 없어 `Place` 전체를 JSON으로 싣는다(`PlaceDetailRoute` 관례).
 * 백스택 엔트리마다 ViewModel이 새로 생긴다 = 장소마다 새 대화(iOS 시트 표시마다 새 `ChatView` 동형).
 */
@Serializable
data class PlaceChatRoute(val placeJson: String) {
    val place: Place get() = KitJson.decodeFromString(Place.serializer(), placeJson)

    companion object {
        fun of(place: Place) = PlaceChatRoute(KitJson.encodeToString(Place.serializer(), place))
    }
}

/**
 * 채팅 진입의 유일한 API(spec §7). 장소가 없으면 채팅 탭으로 전환(대화는 이어진다, 탭 옵션은 하단 탭과 같다),
 * 장소가 있으면 **현재 탭 스택에** 장소 채팅을 push — 라우트 인자가 곧 앵커라 프리필 스토어가 필요 없다.
 */
fun NavController.openChat(place: Place?) {
    if (place != null) {
        navigate(PlaceChatRoute.of(place))
        return
    }
    navigate(ChatRoute) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
