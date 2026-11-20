package space.dodoplanet.gildongmu.nav

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import space.dodoplanet.gildongmu.directions.DirectionsPrefillStore
import androidx.navigation.compose.rememberNavController
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.a11y.LocalResultHaptics
import space.dodoplanet.gildongmu.chat.ChatTabScreen
import space.dodoplanet.gildongmu.chat.openChat
import space.dodoplanet.gildongmu.place.CHAT_RETURN_KEY
import space.dodoplanet.gildongmu.chat.PlaceChatRoute
import space.dodoplanet.gildongmu.chat.PlaceChatScreen
import space.dodoplanet.gildongmu.directions.DirectionsScreen
import space.dodoplanet.gildongmu.guide.ui.GuideBottomBar
import space.dodoplanet.gildongmu.guide.ui.GuideNav
import space.dodoplanet.gildongmu.guide.ui.guideSheetShowing
import space.dodoplanet.gildongmu.a11y.LocalModalOpen
import space.dodoplanet.gildongmu.guide.ui.openGuidePlace
import space.dodoplanet.gildongmu.guide.ui.openWeightSettings
import space.dodoplanet.gildongmu.directions.openDirections
import space.dodoplanet.gildongmu.place.LocalPlaceRowNav
import space.dodoplanet.gildongmu.place.PlaceRowNav
import space.dodoplanet.gildongmu.location.LOCATION_BAR_KEY
import space.dodoplanet.gildongmu.location.ManualLocationPickerScreen
import space.dodoplanet.gildongmu.location.ManualLocationRoute
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
import space.dodoplanet.gildongmu.settings.DATA_SOURCES_RETURN_KEY
import space.dodoplanet.gildongmu.settings.DataSourcesRoute
import space.dodoplanet.gildongmu.settings.DataSourcesScreen
import space.dodoplanet.gildongmu.settings.SETTINGS_RETURN_KEY
import space.dodoplanet.gildongmu.settings.SettingsRoute
import space.dodoplanet.gildongmu.settings.SettingsScreen

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
    val hapticsOn by AppConfig.settings.resultHapticsEnabled.collectAsState()
    // 앱 바로가기 진입(B22 ④, iOS `consumeLaunchAction`): 진입 자체가 세션 리셋 — 모든 탭을 초기 상태로 되돌리고 목적 탭을 연다.
    // 음성 검색은 `AppSession.voiceStartRequested`를 세워 새로 선 검색 화면이 받아쓰기를 시작한다.
    val pendingLaunch by AppSession.pending.collectAsState()
    val launchOwner = LocalActivity.current
    LaunchedEffect(pendingLaunch) {
        val action = AppSession.take(launchOwner ?: return@LaunchedEffect) ?: return@LaunchedEffect
        val target = when (action) {
            LaunchAction.voiceSearch -> AppTab.search
            LaunchAction.nearby -> AppTab.nearby
        }
        navController.resetAllTabs(tabs, AppTab.initial(experimental), target)
    }
    // 유휴 리셋(B27 ②, iOS `resetSession`): 모든 탭 초기화 → 시작 탭. 남은 길찾기 프리필도 버린다(지난 도착지가 되살아나지 않게).
    val resetPending by AppSession.resetPending.collectAsState()
    LaunchedEffect(resetPending) {
        if (!AppSession.takeReset()) return@LaunchedEffect
        DirectionsPrefillStore.pending.value?.let(DirectionsPrefillStore::take)
        val initial = AppTab.initial(experimental)
        navController.resetAllTabs(tabs, initial, initial)
    }
    // 탭 새로고침(B27 ①, iOS `refreshCurrentTab`): 현재 탭만 초기 상태로, 탭 이동 없음.
    val refreshPending by AppSession.refreshPending.collectAsState()
    LaunchedEffect(refreshPending) {
        if (!AppSession.takeRefresh()) return@LaunchedEffect
        val destination = navController.currentBackStackEntry?.destination ?: return@LaunchedEffect
        val tab = tabs.firstOrNull { tab -> destination.hierarchy.any { it.hasRoute(tab.route()::class) } } ?: return@LaunchedEffect
        if (tab == AppTab.directions) DirectionsPrefillStore.pending.value?.let(DirectionsPrefillStore::take)
        navController.refreshTab(tab)
    }

    CompositionLocalProvider(LocalResultHaptics provides hapticsOn) {
        Scaffold(
            bottomBar = {
                GuideBottomBar(GuideNav(onOpenSettings = navController::openWeightSettings, onOpenPlace = navController::openGuidePlace)) {
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
                }
            },
        ) { padding ->
            // 안내 시트가 펼쳐진 동안 탭 화면은 앱 통지를 집지 않는다 — 통지는 시트를 접은 뒤 밑 화면이 읽는다(M4b 후속 ②). 탭 화면 안의
            // 공급(다이얼로그·공지 시트)은 이 값과 OR한다(가드 `GuideSheetModalGuardTest`).
            // 장소 줄 동작(B21)의 길찾기·물어보기 길 — 줄을 그리는 화면마다 배선하지 않고 여기서 한 번 공급한다.
            val placeRowNav = remember(navController) { PlaceRowNav(navController::openDirections) { navController.openChat(it) } }
            CompositionLocalProvider(LocalPlaceRowNav provides placeRowNav) {
            CompositionLocalProvider(LocalModalOpen provides guideSheetShowing()) {
            NavHost(
                navController = navController,
                startDestination = AppTab.initial(experimental).route(),
                modifier = Modifier.padding(padding),
            ) {
                // 탭 루트의 설정 버튼(spec §14-1): 복귀 슬롯은 엔트리 스코프 `ReturnFocusViewModel` — 검색 VM 슬롯은 결과 행 전용이라 쓰지 않는다.
                composable<SearchRoute> { entry ->
                    val rf: ReturnFocusViewModel = viewModel(entry)
                    SearchScreen(
                        viewModel(factory = factories.search),
                        onOpenPlace = { navController.navigate(PlaceDetailRoute.of(it)) },
                        onOpenSettings = { rf.slot.remember(SETTINGS_RETURN_KEY); navController.navigate(SettingsRoute()) { launchSingleTop = true } },
                        takeReturn = rf.slot::take,
                        onPickLocation = { rf.slot.remember(LOCATION_BAR_KEY); navController.navigate(ManualLocationRoute) },
                        location = factories.currentAddress to factories.manualLocation,
                    )
                }
                composable<DirectionsRoute> { entry ->
                    val rf: ReturnFocusViewModel = viewModel(entry)
                    DirectionsScreen(
                        onOpenSettings = { rf.slot.remember(SETTINGS_RETURN_KEY); navController.navigate(SettingsRoute()) { launchSingleTop = true } }, takeSettingsReturn = rf.slot::take,
                        // 브리핑 지하철역 상세(E45) — 길찾기 탭 스택에 push, 복귀 착지는 그 줄. 노선 힌트는 누르는 순간 확정한 그 줄의 leg `lineName`.
                        onOpenStation = { stop, lineName, returnKey -> rf.slot.remember(returnKey); navController.navigate(PlaceDetailRoute.ofTransitStop(stop, lineName = lineName)) },
                    )
                }
                composable<NearbyRoute> { entry ->
                    val returnFocus: ReturnFocusViewModel = viewModel(entry)
                    NearbyHubScreen(
                        onOpen = { kind -> returnFocus.slot.remember(hubKey(kind)); navController.navigate(NearbyKindRoute.of(kind, null, directionsEntryAllowed = true)) },
                        onPick = { returnFocus.slot.remember(LOCATION_BAR_KEY); navController.navigate(ManualLocationRoute) },
                        onOpenSettings = { returnFocus.slot.remember(SETTINGS_RETURN_KEY); navController.navigate(SettingsRoute()) { launchSingleTop = true } },
                        takeReturnFocus = returnFocus.slot::take,
                        currentAddress = factories.currentAddress,
                        manualLocation = factories.manualLocation,
                    )
                }
                composable<ChatRoute> { entry ->
                    val rf: ReturnFocusViewModel = viewModel(entry)
                    ChatTabScreen(onPickLocation = { navController.navigate(ManualLocationRoute) }, onOpenSettings = { rf.slot.remember(SETTINGS_RETURN_KEY); navController.navigate(SettingsRoute()) { launchSingleTop = true } }, takeSettingsReturn = rf.slot::take, onOpenPlace = { navController.navigate(PlaceDetailRoute.of(it, showsChatEntry = false)) })
                }
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
                            onOpenPlace = { place, domain, lineHint -> navController.navigate(PlaceDetailRoute.of(place, domain).copy(stationLineHint = lineHint, showsDirectionsEntry = route.directionsEntryAllowed)) },
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
                            onOpenNearby = { kind, anchor -> returnFocus.slot.remember("anchor-${kind.name}"); navController.navigate(NearbyKindRoute.of(kind, anchor, directionsEntryAllowed = route.showsDirectionsEntry)) },
                            onOpenDirections = navController::openDirections, // 탭 전환 — 상세 스택은 검색 탭 백스택에 저장된다(복귀 착지 없음)
                            onOpenChat = { returnFocus.slot.remember(CHAT_RETURN_KEY); navController.openChat(it) }, // M6 spec §7
                        ),
                        takeReturnFocus = returnFocus.slot::take,
                        stationLineHint = route.stationLineHint,
                        showsChatEntry = route.showsChatEntry,
                        showsDirectionsEntry = route.showsDirectionsEntry,
                    )
                }
                composable<PlaceChatRoute> { entry -> PlaceChatScreen(entry.toRoute(), { navController.popBackStack() }) { navController.navigate(PlaceDetailRoute.of(it, showsChatEntry = false)) } }
                composable<ManualLocationRoute> { ManualLocationPickerScreen { navController.popBackStack() } }
                composable<SettingsRoute> { entry ->
                    val rf: ReturnFocusViewModel = viewModel(entry)
                    SettingsScreen(onBack = { navController.popBackStack() }, onOpenDataSources = { rf.slot.remember(DATA_SOURCES_RETURN_KEY); navController.navigate(DataSourcesRoute) { launchSingleTop = true } }, takeReturnFocus = rf.slot::take, focusRow = entry.toRoute<SettingsRoute>().focusRow)
                }
                composable<DataSourcesRoute> { DataSourcesScreen { navController.popBackStack() } }
                composable<BusRouteStopsRoute> { entry ->
                    val route = entry.toRoute<BusRouteStopsRoute>()
                    BusRouteStopsScreen(route, factories.busRouteStops(route)) { navController.popBackStack() }
                }
            }
            }
            }
        }
    }
}
