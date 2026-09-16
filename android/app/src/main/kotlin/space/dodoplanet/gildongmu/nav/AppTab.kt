package space.dodoplanet.gildongmu.nav

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Send
import androidx.compose.ui.graphics.vector.ImageVector
import space.dodoplanet.gildongmu.R

/**
 * 탭 정체성(iOS `AppTab` 미러). `rawValue`는 안정 식별자 — 정수 인덱스였다면 탭 삽입 시 저장된 값이 다른 탭을
 * 가리키는 마이그레이션 결함이 생긴다(iOS 스펙 10-A §8). 아이콘은 장식(라벨이 이름을 다 말한다).
 */
enum class AppTab(@param:StringRes val label: Int, val icon: ImageVector) {
    chat(R.string.android_tab_chat, Icons.Filled.Send),
    search(R.string.android_tab_search, Icons.Filled.Search),
    directions(R.string.android_tab_directions, Icons.Filled.Place),
    nearby(R.string.android_tab_nearby, Icons.Filled.LocationOn),
    ;

    val rawValue: String get() = name

    companion object {
        /**
         * 탭 바 순서(iOS `AppTab.order`, K1 ① 위원장 판정 2026-08-23 — 실험판 판정 대기라 플래그로 가른다).
         * 실험판 검색-길찾기-내 주변-채팅 / 정식판 채팅-검색-길찾기-내 주변. 기본 탭은 `order[0]`.
         */
        fun order(experimental: Boolean): List<AppTab> =
            if (experimental) listOf(search, directions, nearby, chat) else listOf(chat, search, directions, nearby)

        fun initial(experimental: Boolean): AppTab = order(experimental)[0]
    }
}
