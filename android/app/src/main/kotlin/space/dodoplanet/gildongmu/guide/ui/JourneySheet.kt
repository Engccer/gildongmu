package space.dodoplanet.gildongmu.guide.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusManager
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.guide.FailResolution
import space.dodoplanet.gildongmu.guide.GuideSession
import space.dodoplanet.gildongmu.guide.JourneyFailure
import space.dodoplanet.gildongmu.guide.JourneyUiState
import space.dodoplanet.gildongmu.guide.journeyStatusText
import space.dodoplanet.gildongmu.kit.JourneyEvent
import space.dodoplanet.gildongmu.kit.JourneyPhase
import space.dodoplanet.gildongmu.kit.JourneyStage
import space.dodoplanet.gildongmu.location.LocationPermission
import space.dodoplanet.gildongmu.location.appDetailsSettingsIntent
import space.dodoplanet.gildongmu.nav.tryStartActivity

/** 여정 시트의 버튼(iOS `JourneySheet.failedControls` 몫). 목록 순서가 읽기 순서다. */
enum class JourneySheetButton(val key: String, val tag: String) {
    settings("android.common.openSettings", "journey-settings"),
    precise("android.common.allowPrecise", "journey-precise"),
    retry("guide.rerouteButton", "journey-retry"),
    taxiDropped("android.journey.taxiDropped", "journey-taxi-dropped"),
    taxiBoarded("android.journey.taxiBoarded", "journey-taxi-boarded"),
}

/**
 * 실패일 때 보이는 버튼을 순서대로(iOS `failedControls`) — 해결 수단(권한 철회·정밀 위치 꺼짐으로 끊긴 경우, §6.1) → [경로 다시 조회] → 「자동차에서 내렸어요」 →
 * 「자동차에 탔어요」. 출구 도보 시작 실패는 「자동차에 탔어요」가 곧 다음 단계라 재시도를 두지 않는다(§6.4 표) — 끊긴 경우(`failure != null`)는 둔다.
 * 실패가 아니면(준비 중) 버튼이 없다 — 상태 문장과 [안내 종료]뿐이다. 순수 함수라 JVM 테스트가 순서를 잠그고, 그려진 시트는 계측 테스트 `JourneySheetA11yTest`가 본다.
 */
fun journeySheetButtons(phase: JourneyPhase, failure: JourneyFailure?): List<JourneySheetButton> {
    val stage = (phase as? JourneyPhase.Failed)?.at ?: return emptyList()
    return buildList {
        when (failure?.resolution) {
            FailResolution.settings -> add(JourneySheetButton.settings)
            FailResolution.precise -> add(JourneySheetButton.precise)
            FailResolution.none, null -> Unit
        }
        if (stage != JourneyStage.egress || failure != null) add(JourneySheetButton.retry)
        if (stage == JourneyStage.taxiIn) add(JourneySheetButton.taxiDropped)
        if (stage == JourneyStage.egress) add(JourneySheetButton.taxiBoarded)
    }
}

/**
 * 상태 문장 행에 착지하는가 — **실패일 때만**이다(iOS 접근성 감사 M1). 준비 중 시트는 곧 다음 단계 시트가 덮고, 그 사이 강제 착지 낭독이 직전 문장(택시 자동
 * 도착의 「…역에 도착했습니다.」)을 끊는다. 준비 중 → 실패는 버튼이 새로 생기는 전이라 착지가 안내다.
 */
fun journeySheetLandsOnStatus(phase: JourneyPhase): Boolean = phase is JourneyPhase.Failed

/**
 * 여정 시트(B26 §7-5, iOS `JourneySheet`) — 다음 세션 준비 중이거나 실패해 사용자의 결정을 기다리는 동안. 상태 문장 한 줄 + (실패면) 해결 수단·[경로 다시 조회]·
 * 단계 버튼 + 하단 고정 [안내 종료]. 시트를 내리는 제스처는 최소화이고(바깥 탭 닫기는 끈다, 2026-11-21 위원장 판정) 단계 세션이 서면 호스트가 그 세션의 시트로
 * 바꾼다(시트를 더하지 않는다, N1). live region·통지 없음(실패 문장은 그 모델이 이미 냈고, 준비 중은 곧 다음 세션의 시작 통지가 온다).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JourneySheet(ui: JourneyUiState?, strings: Strings) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = { GuideSession.isMinimized = true },
        sheetState = sheetState,
        dragHandle = null,
        properties = ModalBottomSheetProperties(shouldDismissOnClickOutside = false),
    ) {
        JourneySheetContent(ui, strings)
    }
}

@Composable
private fun JourneySheetContent(ui: JourneyUiState?, strings: Strings) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val statusFocus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    var acting by remember { mutableStateOf(false) }
    val phase = ui?.phase
    val lands = phase != null && journeySheetLandsOnStatus(phase)
    // 시트가 뜰 때 실패면, 그리고 국면이 실패로 바뀔 때(키가 거짓 → 참). 준비 중에는 착지하지 않는다. 실패 문장은 그 모델이 TTS로 막 말했으므로
    // 발화가 끝난 뒤 착지한다(TalkBack이 같은 문장을 겹쳐 읽지 않게, 도보 시트 착지와 같은 대기).
    LaunchedEffect(lands) { if (lands) relandStatus(focusManager, statusFocus, waitForSpeech = true) }
    // 누르면 자기가 사라지는 버튼(실패 → 준비 중): 커서를 남을 상태 문장으로 먼저 옮긴 뒤 전이한다(헌장 §5, iOS `act`). 상태 문장이
    // 「경로를 찾는 중입니다.」로 바뀌는 것이 곧 눌렸다는 신호다. 상태 문장은 실패 착지로 이미 입력 포커스를 쥐고 있어 다시 요청만으로는 커서가
    // 따라오지 않는다(한소네 재현) — 비우고 간격을 둔 뒤 준다. 그 사이 두 번 누름은 in-flight 표식이 막는다.
    val act: (JourneyEvent) -> Unit = { event ->
        if (!acting) {
            acting = true
            scope.launch {
                try {
                    relandStatus(focusManager, statusFocus, waitForSpeech = false)
                    GuideSession.journeyAction(event)
                } finally {
                    acting = false
                }
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.End) {
            IconButton(onClick = { GuideSession.isMinimized = true }, modifier = Modifier.size(48.dp).testTag("guide-minimize")) {
                Icon(Icons.Filled.KeyboardArrowDown, contentDescription = strings.get("guide.minimize"))
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Text(
                journeyStatusText(ui, strings),
                Modifier.fillMaxWidth().mergedRow("journey-status", focus = statusFocus).padding(vertical = 8.dp),
                style = MaterialTheme.typography.bodyLarge,
            )
            if (phase != null) {
                for (button in journeySheetButtons(phase, ui.failure)) {
                    Button(
                        onClick = {
                            when (button) {
                                JourneySheetButton.settings -> context.tryStartActivity(appDetailsSettingsIntent(context))
                                // 정밀 위치 요청은 도보 시작 실패 행과 같은 선례 — 허용되면 다시 조회한다.
                                JourneySheetButton.precise -> scope.launch {
                                    if (AppConfig.permissionGate.request() == LocationPermission.Fine) act(JourneyEvent.Retry)
                                    // 시스템이 창을 다시 띄우지 않는 경우(거듭 거절)에도 눌렸다는 응답을 준다 — 선례 그대로.
                                    else GuideSession.walk.announceNow(strings.get("android.common.geoReducedDesc"), highPriority = true)
                                }
                                JourneySheetButton.retry -> act(JourneyEvent.Retry)
                                JourneySheetButton.taxiDropped -> act(JourneyEvent.TaxiDropped)
                                JourneySheetButton.taxiBoarded -> act(JourneyEvent.TaxiBoarded)
                            }
                        },
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).tapTarget().testTag(button.tag),
                    ) { Text(strings.get(button.key)) }
                }
            }
        }
        // 안내 종료는 목록 밖 최하단 고정(iOS `GuideStopButton(tall: false)`).
        Button(
            onClick = { GuideSession.journeyAction(JourneyEvent.UserEnded) },
            modifier = Modifier.fillMaxWidth().padding(16.dp).tapTarget().testTag("journey-stop"),
        ) { Text(strings.get("beacon.stop")) }
    }
}

/**
 * 상태 문장 행에 (다시) 착지한다. 이미 입력 포커스를 쥔 행은 다시 요청해도 접근성 이벤트가 나가지 않으므로 비우고 이벤트 묶음 간격을 둔 뒤 준다
 * (`MovedRowLanding` 관용구). `waitForSpeech`면 안내 모델(도보·대중교통)의 발화가 끝나기를 상한 안에서 기다린다(도보 시트 `SPEECH_WAIT_MS`).
 */
private suspend fun relandStatus(focusManager: FocusManager, requester: FocusRequester, waitForSpeech: Boolean) {
    withFrameNanos { }
    if (waitForSpeech) {
        val start = SystemClock.elapsedRealtime()
        delay(400) // 시트 표시 애니메이션
        while (!(GuideSession.walk.announcementsSettled() && GuideSession.transit.announcementsSettled())) {
            if (SystemClock.elapsedRealtime() - start >= GuideSheetLanding.SPEECH_WAIT_MS) break
            delay(100)
        }
    }
    focusManager.clearFocus()
    delay(JOURNEY_FOCUS_EVENT_GAP_MS)
    val landed = runCatching { requester.requestFocus(); true }.getOrElse { e -> Log.w("Guide", "여정 상태 문장 착지 실패", e); false }
    Log.i("Guide", "journeySheetFocus target=status landed=$landed speechWait=$waitForSpeech")
}

private const val JOURNEY_FOCUS_EVENT_GAP_MS = 250L
