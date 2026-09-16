package space.dodoplanet.gildongmu.guide.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.guide.GuideMode
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.GuideText
import space.dodoplanet.gildongmu.guide.SessionEndKind
import space.dodoplanet.gildongmu.guide.WalkGuideUiState
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits

/**
 * 안내 시트(spec §7-3~§7-5, iOS `BeaconTrackingSheet` 도보부). 시트를 내리는 제스처(뒤로·바깥 탭·스와이프)는 **최소화**이고 종료는
 * 최하단 고정 버튼뿐(N1). live region이 없다(§5-3 — 문장은 TTS 한 채널). 착지: 진입 = 제목, 띠바 복귀 = 접기 버튼, 재조회 소멸 =
 * 제목, 조망 닫힘 = 진행 상황 버튼, 도착 전이 = 종료 문장. 텍스트 행은 `mergedRow`, 버튼은 `landingTarget`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GuideSheet(ui: WalkGuideUiState, strings: Strings) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = { GuideSession.isMinimized = true }, sheetState = sheetState, dragHandle = null) {
        if (ui.arrivalDest != null) EndScreen(ui, strings) else TrackingContent(ui, strings)
    }
}

@Composable
private fun TrackingContent(ui: WalkGuideUiState, strings: Strings) {
    val meters = strings.get("android.unit.spokenMeters")
    val titleFocus = remember { FocusRequester() }
    val minimizeFocus = remember { FocusRequester() }
    val progressFocus = remember { FocusRequester() }
    var overviewOpen by remember { mutableStateOf(false) }
    var reroutePressed by remember { mutableStateOf(false) }
    var landProgressSeq by remember { mutableStateOf(0) }

    BackHandler(enabled = overviewOpen) { overviewOpen = false; landProgressSeq++ }

    LaunchedEffect(Unit) {
        if (GuideSession.returnedFromBand) { GuideSession.returnedFromBand = false; land(minimizeFocus, "접기 버튼") } else land(titleFocus, "시트 제목")
    }
    // 재조회 성공·자동 채택으로 버튼이 사라지면 제목 착지(포커스를 쥔 컨트롤 소멸).
    LaunchedEffect(ui.offRoute) {
        if (!ui.offRoute && (reroutePressed || ui.offRouteEndedByReroute)) { reroutePressed = false; land(titleFocus, "시트 제목(재조회)") }
    }
    LaunchedEffect(landProgressSeq) { if (landProgressSeq > 0) land(progressFocus, "진행 상황 버튼") }

    if (overviewOpen) {
        OverviewPage(ui, strings, onClose = { overviewOpen = false; landProgressSeq++ })
        return
    }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    HeadingLine(joinText(strings.get("beacon.walkHeading"), ui.destinationLabel), "guide-title", focus = titleFocus)
                }
                IconButton(onClick = { GuideSession.isMinimized = true }, modifier = Modifier.size(48.dp).landingTarget(minimizeFocus).testTag("guide-minimize")) {
                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = strings.get("guide.minimize"))
                }
            }
            Button(
                onClick = {
                    if (ui.mode == GuideMode.detail && ui.routeStepDescriptions != null) overviewOpen = true
                    else GuideSession.walk.announceProgress()
                },
                modifier = Modifier.fillMaxWidth().tapTarget().landingTarget(progressFocus).testTag("guide-progress"),
            ) { Text(strings.get("guide.progressButton")) }
            if (ui.offRoute && ui.mode == GuideMode.detail) {
                Button(
                    onClick = { reroutePressed = true; GuideSession.walk.requestReroute() },
                    modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-reroute"),
                ) { Text(strings.get(if (ui.isRerouting) "guide.rerouteBusy" else "guide.rerouteButton")) }
            }
            if (ui.mode == GuideMode.brief) BodyLine(strings.get("beacon.straightLineNote"), "guide-brief-note")
            val remaining = ui.remainingText
            if (ui.mode == GuideMode.detail && !ui.offRoute && !remaining.isNullOrEmpty()) BodyLine(remaining, "guide-remaining", spokenDistanceUnits(remaining, meters))
            if (ui.mode == GuideMode.detail) {
                ui.liveTopText?.takeIf { it.isNotEmpty() }?.let { BodyLine(it, "guide-live-top", spokenDistanceUnits(it, meters)) }
                ui.liveNextText?.takeIf { it.isNotEmpty() }?.let { BodyLine(it, "guide-live-next", spokenDistanceUnits(it, meters)) }
            }
            if (ui.statusText.isNotEmpty() && (ui.mode == GuideMode.brief || ui.liveTopText.isNullOrEmpty())) {
                val status = if (ui.statusIsNextPreview) strings.get("guide.progressNext", ui.statusText) else ui.statusText
                BodyLine(status, "guide-status", spokenDistanceUnits(status, meters))
            }
            if (ui.soundDegraded) BodyLine(strings.get("android.guide.mediaVolumeZero"), "guide-sound-volume")
            if (ui.focusDenied) BodyLine(strings.get("android.guide.focusDenied"), "guide-sound-focus")
            if (ui.ttsUnavailable) BodyLine(strings.get("android.guide.ttsUnavailable"), "guide-sound-tts")
            if (ui.isSilenced) BodyLine(strings.get("android.beacon.soundUnavailable"), "guide-sound-silenced")
        }
        Button(
            onClick = { GuideSession.walk.stopByUser() },
            modifier = Modifier.fillMaxWidth().padding(16.dp).tapTarget().testTag("guide-stop"),
        ) { Text(strings.get("beacon.stop")) }
    }
}

/** 조망 페이지(§7-4, iOS `GuideOverviewSheet` 도보부): 헤더 = `progressText()`(진입 착지 — 낭독이 곧 조망 문장), 행, 닫기 두 곳. */
@Composable
private fun OverviewPage(ui: WalkGuideUiState, strings: Strings, onClose: () -> Unit) {
    val meters = strings.get("android.unit.spokenMeters")
    val headerFocus = remember { FocusRequester() }
    val header = remember(ui.statusText, ui.remainingText, ui.currentStepIndex) { GuideSession.walk.progressText() }
    LaunchedEffect(Unit) { land(headerFocus, "조망 헤더") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-overview-close-top")) { Text(strings.get("actions.close")) }
        HeadingLine(header, "guide-overview-header", focus = headerFocus, spoken = spokenDistanceUnits(header, meters))
        val steps = ui.routeStepDescriptions.orEmpty()
        val waypointRow = ui.routeWaypointRow
        steps.forEachIndexed { i, desc ->
            if (waypointRow != null && waypointRow.first == i) BodyLine(waypointRow.second, "guide-overview-waypoint")
            val line = if (ui.currentStepIndex == i) strings.get("android.guide.routeListCurrent", (i + 1).toString(), desc)
            else strings.get("android.guide.routeListRow", (i + 1).toString(), desc)
            BodyLine(line, "guide-overview-step-$i", spokenDistanceUnits(line, meters))
        }
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-overview-close")) { Text(strings.get("actions.close")) }
    }
}

/** 종료 화면(§7-5): 헤딩·종료 문장(착지)·걸음·칼로리 문장(있을 때만)·닫기(`clearArrival`). */
@Composable
private fun EndScreen(ui: WalkGuideUiState, strings: Strings) {
    val text = remember(strings) { GuideText(strings) }
    val arrivedFocus = remember { FocusRequester() }
    val headingKey = when (ui.endKind) {
        SessionEndKind.arrived -> "android.beacon.arrivedHeading"
        SessionEndKind.presumed -> "android.beacon.arrivedPresumedHeading"
        SessionEndKind.stopped -> "android.beacon.endedHeading"
    }
    val sentence = when (ui.endKind) {
        SessionEndKind.arrived -> strings.get("guide.arrived")
        SessionEndKind.presumed -> strings.get("guide.arrivedPresumed")
        SessionEndKind.stopped -> ui.endText
    }
    LaunchedEffect(Unit) { land(arrivedFocus, "종료 문장") }
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        HeadingLine(joinText(strings.get(headingKey), ui.destinationLabel), "guide-end-title")
        Text(sentence, Modifier.fillMaxWidth().mergedRow("guide-end", focus = arrivedFocus).padding(vertical = 8.dp))
        ui.arrivalHealth?.let { BodyLine(text.healthLine(it), "guide-end-health") }
        Button(onClick = { GuideSession.walk.clearArrival() }, modifier = Modifier.fillMaxWidth().tapTarget().testTag("guide-end-close")) { Text(strings.get("actions.close")) }
    }
}
