package space.dodoplanet.gildongmu.nav

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.directions.DirectionsScreen
import space.dodoplanet.gildongmu.directions.openDirections
import androidx.navigation.toRoute
import space.dodoplanet.gildongmu.nearby.BusRouteStopsRoute
import space.dodoplanet.gildongmu.nearby.BusRouteStopsScreen
import space.dodoplanet.gildongmu.nearby.NearbyHubScreen
import space.dodoplanet.gildongmu.nearby.NearbyKindRoute
import space.dodoplanet.gildongmu.nearby.NearbyKindScreen
import space.dodoplanet.gildongmu.nearby.NearbyNav
import space.dodoplanet.gildongmu.nearby.hubKey
import space.dodoplanet.gildongmu.place.PlaceDetailRoute
import space.dodoplanet.gildongmu.place.PlaceDetailScreen
import space.dodoplanet.gildongmu.place.PlaceNav
import space.dodoplanet.gildongmu.search.SearchScreen

/**
 * 앱 골격: 하단 탭(iOS 4탭 미러, 순서는 `AppTab.order`) + 단일 `NavHost`. 탭 전환은 `saveState/restoreState`로
 * **탭별 백스택을 보존**한다(iOS `TabView` 안 `NavigationStack` 동형). 하단 바는 모든 화면에 남는다 —
 * 선형 주파의 끝이 언제나 탭 4개라 위치를 외워 쓰는 탐색이 흔들리지 않는다.
 *
 * 등록 규약: 탭 루트 4개는 여기, 스택 화면은 각 화면 패키지가 자기 라우트를 갖고 아래 `NavHost`에 **한 줄**만 더한다.
 */
@Composable
fun AppRoot(factories: AppFactories) {
    val experimental = AppConfig.experimentalTabOrderEnabled
    val tabs = AppTab.order(experimental)
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination

    Scaffold(
        bottomBar = {
            NavigationBar(Modifier.testTag("tabs")) {
                for (tab in tabs) {
                    val route = tab.route()
                    // 현재 탭 = 그 탭의 루트가 현재 목적지의 계층 안에 있는가(스택 화면에서도 소속 탭이 선택 상태).
                    val selected = currentDestination?.hierarchy?.any { it.hasRoute(route::class) } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = null) }, // 장식 — 라벨이 이름
                        label = { Text(stringResource(tab.label)) },
                        modifier = Modifier.testTag("tab-${tab.rawValue}"),
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = AppTab.initial(experimental).route(),
            modifier = Modifier.padding(padding),
        ) {
            composable<SearchRoute> { SearchScreen(viewModel(factory = factories.search)) { navController.navigate(PlaceDetailRoute.of(it)) } }
            composable<DirectionsRoute> { DirectionsScreen() }
            composable<NearbyRoute> { entry ->
                val returnFocus: ReturnFocusViewModel = viewModel(entry)
                NearbyHubScreen(
                    onOpen = { kind -> returnFocus.slot.remember(hubKey(kind)); navController.navigate(NearbyKindRoute.of(kind, null)) },
                    takeReturnFocus = returnFocus.slot::take,
                    currentAddress = factories.currentAddress,
                )
            }
            composable<ChatRoute> { PlaceholderScreen(AppTab.chat) } // M6
            // ── 스택 화면(각 화면 패키지 소유 라우트, 등록 한 줄씩)
            composable<NearbyKindRoute> { entry ->
                val route = entry.toRoute<NearbyKindRoute>()
                val anchor = remember(route) { route.anchor } // JSON 디코딩은 한 번
                NearbyKindScreen(
                    route = route,
                    anchor = anchor,
                    factory = factories.nearby(route.kind, anchor),
                    nav = NearbyNav(
                        onBack = { navController.popBackStack() },
                        onOpenPlace = { place, domain -> navController.navigate(PlaceDetailRoute.of(place, domain)) },
                        onOpenRouteStops = { navController.navigate(it) },
                    ),
                    requestPrecise = factories.requestPreciseLocation,
                    isLocationEnabled = factories.isLocationEnabled,
                )
            }
            composable<PlaceDetailRoute> { entry ->
                val route = entry.toRoute<PlaceDetailRoute>()
                val place = remember(route) { route.place } // JSON 디코딩은 한 번
                val domain = remember(route) { route.domain }
                val returnFocus: ReturnFocusViewModel = viewModel(entry)
                PlaceDetailScreen(
                    factory = factories.place(place),
                    domain = domain,
                    nav = PlaceNav(
                        onBack = { navController.popBackStack() },
                        onOpenNearby = { kind, anchor -> returnFocus.slot.remember("anchor-${kind.name}"); navController.navigate(NearbyKindRoute.of(kind, anchor)) },
                        onOpenDirections = navController::openDirections, // 탭 전환 — 상세 스택은 검색 탭 백스택에 저장된다(복귀 착지 없음)
                    ),
                    takeReturnFocus = returnFocus.slot::take,
                )
            }
            composable<BusRouteStopsRoute> { entry ->
                val route = entry.toRoute<BusRouteStopsRoute>()
                BusRouteStopsScreen(route, factories.busRouteStops(route)) { navController.popBackStack() }
            }
        }
    }
}

