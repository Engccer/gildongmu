package space.dodoplanet.gildongmu.nearby

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.ViewModelProvider
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.AppTopBar
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.NearbyLoadPhase
import space.dodoplanet.gildongmu.kit.UnavailableHereReason
import space.dodoplanet.gildongmu.kit.buildOverviewLines
import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.BikeStation
import space.dodoplanet.gildongmu.kit.models.BusRouteStop
import space.dodoplanet.gildongmu.kit.models.BusStop
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.SubwayNearbyResult
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits
import space.dodoplanet.gildongmu.kit.surroundingPlaceToPlace
import space.dodoplanet.gildongmu.location.appDetailsSettingsIntent
import space.dodoplanet.gildongmu.location.locationSourceSettingsIntent
import space.dodoplanet.gildongmu.search.PlaceRow

/** 화면이 요청하는 스택 이동(내비게이션은 `AppRoot` 몫). */
class NearbyNav(
    val onBack: () -> Unit,
    val onOpenPlace: (Place) -> Unit,
    val onOpenRouteStops: (BusRouteStopsRoute) -> Unit,
)

/** kind로 갈라 타입이 맞는 ViewModel과 본문을 고른다. 껍데기는 공통(`NearbyShell`). */
@Composable
fun NearbyKindScreen(route: NearbyKindRoute, factory: ViewModelProvider.Factory, nav: NearbyNav, requestPrecise: suspend () -> Boolean, isLocationEnabled: () -> Boolean) {
    val title = nearbyTitle(stringResource(kindTitle(route.kind)), route.anchor, AppLocale.current(LocalContext.current.resources))
    when (route.kind) {
        NearbyKind.around -> {
            val vm: NearbyScreenViewModel<AroundPayload> = viewModel(factory = factory)
            NearbyShell(title, vm, nav.onBack, requestPrecise, isLocationEnabled) { p, req -> AroundBody(p, vm, req, nav.onOpenPlace) }
        }
        NearbyKind.subway -> {
            val vm: NearbyScreenViewModel<SubwayNearbyResult> = viewModel(factory = factory)
            NearbyShell(title, vm, nav.onBack, requestPrecise, isLocationEnabled) { p, req -> SubwayBody(p, req) }
        }
        NearbyKind.bus -> {
            val vm: NearbyScreenViewModel<List<BusStop>> = viewModel(factory = factory)
            NearbyShell(title, vm, nav.onBack, requestPrecise, isLocationEnabled) { p, req -> BusBody(p, req, nav.onOpenRouteStops) }
        }
        NearbyKind.bike -> {
            val vm: NearbyScreenViewModel<List<BikeStation>> = viewModel(factory = factory)
            NearbyShell(title, vm, nav.onBack, requestPrecise, isLocationEnabled) { p, req -> BikeBody(p, req) }
        }
    }
}

/** 경유 정류소(파라미터형). 첫 로드 착지 없음(iOS 동형). */
@Composable
fun BusRouteStopsScreen(route: BusRouteStopsRoute, factory: ViewModelProvider.Factory, onBack: () -> Unit) {
    val vm: NearbyScreenViewModel<List<BusRouteStop>> = viewModel(factory = factory)
    val res = LocalContext.current.resources
    NearbyShell(appLocalized(res, R.string.android_nearby_routeStopsTitle, route.routeNo), vm, onBack, requestPrecise = { false }, isLocationEnabled = { true },
        loadingText = stringResource(R.string.android_nearby_routeStopsLoading), failedText = stringResource(R.string.android_nearby_routeStopsFailed)) { stops, _ ->
        for (stop in stops) {
            Text("${stop.order}, ${stop.name}", Modifier.fillMaxWidth().mergedRow("routeStop-${stop.nodeId}").padding(vertical = 8.dp))
        }
    }
}

/**
 * 공통 껍데기(spec §3-5): 상단 바(제목 헤딩·뒤로·새로고침) → StatusLine → phase 본문(오버레이가 아니라 본문 교체). 착지 셋 —
 * 첫 로드(도메인 첫 키), 더 보기(첫 새 항목), 전락·실패(원인 헤딩). 전부 한 프레임 뒤 `requestFocus`(M1 관용구).
 */
@Composable
fun <P : Any> NearbyShell(
    title: String,
    vm: NearbyScreenViewModel<P>,
    onBack: () -> Unit,
    requestPrecise: suspend () -> Boolean,
    isLocationEnabled: () -> Boolean,
    loadingText: String = stringResource(R.string.android_common_checking),
    failedText: String = stringResource(R.string.android_common_failedTitle),
    body: @Composable (payload: P, requesterFor: (String) -> FocusRequester) -> Unit,
) {
    val phase by vm.phase.collectAsState()
    val notice by vm.notice.collectAsState()
    val landing by vm.landing.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val requesters = remember { mutableMapOf<String, FocusRequester>() }
    val requesterFor: (String) -> FocusRequester = { key -> requesters.getOrPut(key) { FocusRequester() } }
    val causeFocus = remember { FocusRequester() }
    val checking = stringResource(R.string.android_common_checking)

    LaunchedEffect(Unit) { vm.load() }

    LaunchedEffect(landing) {
        val l = landing as? Landing.Key ?: return@LaunchedEffect
        if (l.rev <= vm.consumedLanding) return@LaunchedEffect
        vm.consumedLanding = l.rev
        withFrameNanos { }
        requesters[l.key]?.let { runCatching { it.requestFocus() } }
    }
    // 원인 헤딩 착지: 목록이 통째로 사라지는 전락과 첫 로드 실패 — 진입 뒤 첫 낭독이 원인이 되게(spec §3-5).
    val causeKind = phase.let { it is NearbyLoadPhase.Denied || it is NearbyLoadPhase.ReducedAccuracy || it is NearbyLoadPhase.OutOfCoverage || it is NearbyLoadPhase.UnavailableHere || it is NearbyLoadPhase.FailedLocation || it is NearbyLoadPhase.FailedServer || it is NearbyLoadPhase.Empty }
    LaunchedEffect(phase::class, causeKind) {
        if (!causeKind) return@LaunchedEffect
        withFrameNanos { }
        runCatching { causeFocus.requestFocus() }
    }

    Scaffold(
        topBar = {
            AppTopBar(title, onBack) {
                IconButton(
                    onClick = { vm.load(force = true) },
                    modifier = Modifier.testTag("refresh").semantics { if (phase is NearbyLoadPhase.Loading) stateDescription = checking },
                ) { Icon(Icons.Filled.Refresh, contentDescription = stringResource(R.string.android_common_refresh)) }
            }
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .semantics { testTagsAsResourceId = true },
        ) {
            StatusLine(notice, Modifier.padding(vertical = 8.dp))
            val cause = Modifier.fillMaxWidth().mergedRow("cause").headingText().focusRequester(causeFocus).padding(vertical = 8.dp)
            when (val p = phase) {
                NearbyLoadPhase.Idle, NearbyLoadPhase.Loading -> Text(loadingText, Modifier.fillMaxWidth().mergedRow("loading").padding(vertical = 8.dp))
                is NearbyLoadPhase.Loaded -> {
                    if (vm.isEmpty(p.payload)) {
                        val copy = vm.emptyCopy()
                        Text(copy, Modifier.fillMaxWidth().mergedRow("empty", spokenDistanceUnits(copy, stringResource(R.string.android_unit_spokenMeters))).padding(vertical = 8.dp))
                    } else {
                        body(p.payload, requesterFor)
                    }
                }
                NearbyLoadPhase.Denied -> {
                    Text(stringResource(R.string.android_common_geoDeniedTitle), cause, style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.android_common_geoDeniedDesc), Modifier.fillMaxWidth().mergedRow("cause-desc").padding(vertical = 8.dp))
                    Button(onClick = { context.startActivity(appDetailsSettingsIntent(context)) }, Modifier.testTag("openSettings")) { Text(stringResource(R.string.android_common_openSettings)) }
                }
                NearbyLoadPhase.ReducedAccuracy -> {
                    Text(stringResource(R.string.android_common_geoReducedTitle), cause, style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.android_common_geoReducedDesc), Modifier.fillMaxWidth().mergedRow("cause-desc").padding(vertical = 8.dp))
                    Button(
                        onClick = {
                            scope.launch {
                                // 재요청이 업그레이드 다이얼로그를 띄운다(Android 12). 여전히 대략이면 설정으로.
                                if (requestPrecise()) vm.load(force = true) else context.startActivity(appDetailsSettingsIntent(context))
                            }
                        },
                        Modifier.testTag("allowPrecise"),
                    ) { Text(stringResource(R.string.android_common_allowPrecise)) }
                }
                NearbyLoadPhase.OutOfCoverage -> Text(stringResource(R.string.android_common_outOfCoverage), cause)
                is NearbyLoadPhase.UnavailableHere -> Text(
                    stringResource(when (p.reason) { UnavailableHereReason.seoulOnly -> R.string.android_common_unavailableHere_seoulOnly; UnavailableHereReason.noBusData -> R.string.android_common_unavailableHere_noBusData }),
                    cause,
                )
                NearbyLoadPhase.FailedLocation -> {
                    // 기기 위치 서비스 꺼짐은 렌더 시 다시 판정한다(spec §3-5) — 원인이 다르면 문장도 다르다.
                    if (!isLocationEnabled()) {
                        Text(stringResource(R.string.android_common_locationOff), cause, style = MaterialTheme.typography.titleMedium)
                        Button(onClick = { context.startActivity(locationSourceSettingsIntent()) }, Modifier.testTag("openLocationSettings")) { Text(stringResource(R.string.android_common_openSettings)) }
                    } else {
                        Text(stringResource(R.string.android_common_locationFailed), cause, style = MaterialTheme.typography.titleMedium)
                    }
                }
                NearbyLoadPhase.FailedServer, NearbyLoadPhase.Empty -> Text(failedText, cause, style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

// ── 도메인 본문(spec §3-6~3-9). 한 줄 = 한 객체, 거리가 든 줄은 낭독에 단위 풀어쓰기.

@Composable
private fun SubwayBody(result: SubwayNearbyResult, requesterFor: (String) -> FocusRequester) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)
    val isEn = AppLocale.dataLocale(res) == "en"
    val meters = stringResource(R.string.android_unit_spokenMeters)
    val express = stringResource(R.string.subwayArrival_express)
    val segmentText = { seg: space.dodoplanet.gildongmu.kit.SubwayArrivalSegment ->
        val id = subwayArrivalSegmentResId(seg.key)
        if (id == null) {
            if (space.dodoplanet.gildongmu.BuildConfig.DEBUG) error("subwayArrivalProseSegments 키 미매핑: ${seg.key}")
            seg.key // 릴리스는 키를 노출해 침묵을 피한다(빈 문자열 금지)
        } else appLocalized(res, id, *seg.args.toTypedArray())
    }
    for (station in result.stations) {
        val line = subwayStationLine(isEn, lang, station.stationName, station.nameEn, station.lines, station.linesEn)
        val distance = formatDistance(station.distanceMeters)
        val key = "station-${station.stationName}"
        Text(
            joinText(line.visual, distance),
            Modifier.fillMaxWidth().mergedRow(key, spokenDistanceUnits(joinText(line.spoken, distance), meters)).headingText().focusRequester(requesterFor(key)).padding(top = 12.dp, bottom = 4.dp),
            style = MaterialTheme.typography.titleMedium,
        )
        // 4-state를 뭉개지 않는다: 조회 실패 / 운행 시간 밖 / 실시간 미제공 / 정상(0건 포함)
        when {
            station.arrivalStatus == "unavailable" -> Text(stringResource(R.string.android_nearby_arrivalUnavailable), Modifier.fillMaxWidth().mergedRow("$key-status").padding(vertical = 8.dp))
            station.arrivalStatus == "closed" && station.firstTime != null -> Text(appLocalized(res, R.string.android_nearby_subwayClosed, station.firstTime!!), Modifier.fillMaxWidth().mergedRow("$key-status").padding(vertical = 8.dp))
            station.arrivalStatus == "closed" || station.arrivalStatus == "unknown" -> Text(stringResource(R.string.android_nearby_subwayNoRealtime), Modifier.fillMaxWidth().mergedRow("$key-status").padding(vertical = 8.dp))
            station.arrivals.isEmpty() -> Text(stringResource(R.string.android_station_noArrivals), Modifier.fillMaxWidth().mergedRow("$key-status").padding(vertical = 8.dp))
            else -> station.arrivals.forEachIndexed { i, arrival ->
                Text(
                    subwayArrivalLine(arrival, isEn, segmentText, express) { appLocalized(res, R.string.subwayArrival_currentLocation, it) },
                    Modifier.fillMaxWidth().mergedRow("$key-arrival-$i").padding(vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun BusBody(stops: List<BusStop>, requesterFor: (String) -> FocusRequester, onOpenRouteStops: (BusRouteStopsRoute) -> Unit) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)
    val meters = stringResource(R.string.android_unit_spokenMeters)
    val hint = stringResource(R.string.android_nearby_routeStopsHint)
    val lowFloor = stringResource(R.string.android_nearby_lowFloor)
    for (stop in stops) {
        val heading = busStopHeading(stop, lang)
        val key = "stop-${stop.nodeId}"
        Text(
            heading.visual,
            Modifier.fillMaxWidth().mergedRow(key, spokenDistanceUnits(heading.spoken, meters)).headingText().focusRequester(requesterFor(key)).padding(top = 12.dp, bottom = 4.dp),
            style = MaterialTheme.typography.titleMedium,
        )
        when {
            stop.arrivalStatus == "unavailable" -> Text(stringResource(R.string.android_nearby_arrivalUnavailable), Modifier.fillMaxWidth().mergedRow("$key-status").padding(vertical = 8.dp))
            stop.arrivals.isEmpty() -> Text(stringResource(R.string.android_nearby_noBusArrivals), Modifier.fillMaxWidth().mergedRow("$key-status").padding(vertical = 8.dp))
            else -> stop.arrivals.forEachIndexed { i, arrival ->
                val line = busArrivalLine(
                    arrival,
                    routeNo = { appLocalized(res, R.string.android_nearby_routeNo, it) },
                    lowFloorLabel = lowFloor,
                    stopsBefore = { appLocalized(res, R.string.android_nearby_stopsBefore, it) },
                    minutesAway = { appLocalized(res, R.string.android_nearby_minutesAway, it) },
                )
                // 도착 행은 경유 정류소로 가는 버튼 — onClickLabel이 "두 번 탭하여 경유 정류소 보기"로 읽힌다(별도 hint 축 없음).
                Text(
                    line,
                    Modifier
                        .fillMaxWidth()
                        .clickable(onClickLabel = hint, role = Role.Button) {
                            onOpenRouteStops(BusRouteStopsRoute(stop.source, if (stop.source == "tago") stop.cityCode else null, arrival.routeId, arrival.routeNo))
                        }
                        .testTag("$key-arrival-$i")
                        .defaultMinSize(minHeight = 48.dp)
                        .padding(vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun BikeBody(stations: List<BikeStation>, requesterFor: (String) -> FocusRequester) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)
    val meters = stringResource(R.string.android_unit_spokenMeters)
    for (station in stations) {
        val line = bikeLine(
            station, lang,
            bikesAvailable = { appLocalized(res, R.string.android_nearby_bikesAvailable, it) },
            racksTotal = { appLocalized(res, R.string.android_nearby_racksTotal, it) },
        )
        val key = "bike-${station.stationId}"
        // 헤딩 없음 — 한 줄에 전부 흡수, 첫 행이 착지 지점.
        Text(line.visual, Modifier.fillMaxWidth().mergedRow(key, spokenDistanceUnits(line.spoken, meters)).focusRequester(requesterFor(key)).padding(vertical = 8.dp))
    }
}

@Composable
private fun AroundBody(payload: AroundPayload, vm: NearbyScreenViewModel<AroundPayload>, requesterFor: (String) -> FocusRequester, onOpenPlace: (Place) -> Unit) {
    val res = LocalContext.current.resources
    val lang = AppLocale.current(res)
    val meters = stringResource(R.string.android_unit_spokenMeters)
    val visibleCount by vm.visibleCount.collectAsState()
    val overview = payload.overview

    // 1. 위치 문장(헤딩, 첫 로드 착지 지점) — 내가 어디 서 있는지가 먼저 오는 질문이다. M2는 GPS만(수동 위치 없음).
    val placeName = overview?.place?.let { space.dodoplanet.gildongmu.kit.bilingualName(lang, it, en = null, roman = overview.placeRoman) }
    val hereVisual = placeName?.let { appLocalized(res, R.string.android_nearby_aroundHere, it.display) } ?: stringResource(R.string.android_nearby_aroundHereNoPlace)
    val hereSpoken = placeName?.let { appLocalized(res, R.string.android_nearby_aroundHere, it.primary) }
    Text(hereVisual, Modifier.fillMaxWidth().mergedRow("around-top", hereSpoken).headingText().focusRequester(requesterFor("around-top")).padding(vertical = 8.dp), style = MaterialTheme.typography.titleMedium)

    // 2. 한눈에 보기 — 헤딩 + 반경, 불릿 6개(각 한 객체, 낭독은 text + 단위 풀어쓰기, 시각은 한글 병기 꼬리)
    val overviewHeading = stringResource(R.string.whereAmI_overview_heading)
    if (overview != null) {
        Text("$overviewHeading ${appLocalized(res, R.string.whereAmI_overview_radius, formatDistance(overview.radiusMeters))}", Modifier.fillMaxWidth().mergedRow("overview").headingText().padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
        buildOverviewLines(overview, lang).forEachIndexed { i, line ->
            Text(line.display, Modifier.fillMaxWidth().mergedRow("overview-$i", spokenDistanceUnits(line.text, meters)).padding(vertical = 8.dp))
        }
    } else if (payload.overviewFailed) {
        Text(overviewHeading, Modifier.fillMaxWidth().mergedRow("overview").headingText().padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.whereAmI_overview_failed), Modifier.fillMaxWidth().mergedRow("overview-failed").padding(vertical = 8.dp))
    }

    // 3. 주변 가게와 시설 — 장소 행은 버튼(상세), 더 보기
    Text(stringResource(R.string.android_nearby_aroundPlacesHeading), Modifier.fillMaxWidth().mergedRow("places").headingText().padding(top = 12.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
    val places = payload.places
    if (places == null) {
        Text(stringResource(R.string.android_nearby_aroundPlacesFailed), Modifier.fillMaxWidth().mergedRow("places-failed").padding(vertical = 8.dp))
    } else if (places.isEmpty()) {
        Text(stringResource(R.string.android_nearby_aroundEmpty), Modifier.fillMaxWidth().mergedRow("places-empty").padding(vertical = 8.dp))
    } else {
        for (p in places.take(visibleCount)) {
            val secondary = aroundSecondary(
                p, lang,
                direction = { bearingResId(it)?.let { id -> res.getString(id) } },
                suffixed = { appLocalized(res, R.string.android_nearby_directionSuffixed, it) },
                distance = { appLocalized(res, R.string.place_distance, it) },
            )
            val place = surroundingPlaceToPlace(p)
            PlaceRow(place, lang, spokenMeters = meters, secondaryOverride = secondary, onClick = { onOpenPlace(place) }, modifier = Modifier.focusRequester(requesterFor("place-${place.id}")))
        }
        if (places.size > visibleCount) {
            Button(onClick = { vm.revealMore(places.size) { i -> "place-${places[i].id}" } }, Modifier.testTag("showMore")) { Text(stringResource(R.string.actions_showMore)) }
        }
    }
}

private fun bearingResId(bearing: String): Int? = when (bearing) {
    "n" -> R.string.surroundingsNearby_direction_n
    "ne" -> R.string.surroundingsNearby_direction_ne
    "e" -> R.string.surroundingsNearby_direction_e
    "se" -> R.string.surroundingsNearby_direction_se
    "s" -> R.string.surroundingsNearby_direction_s
    "sw" -> R.string.surroundingsNearby_direction_sw
    "w" -> R.string.surroundingsNearby_direction_w
    "nw" -> R.string.surroundingsNearby_direction_nw
    else -> null
}
