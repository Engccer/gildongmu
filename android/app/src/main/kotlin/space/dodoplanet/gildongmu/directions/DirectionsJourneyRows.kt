package space.dodoplanet.gildongmu.directions

import android.util.Log
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.kit.JourneyAboardDirection

// 길찾기 폼의 여정 입력 줄과 확인 질문(B26 단계 5 묶음 B, iOS `DirectionsTabView` 1260-1345·1853-1886·1570-1587 미러).
// 줄 순서·착지 줄은 순수 함수(`directionsInputRows`·`inputLandingRow`)가 정하고 화면은 그 목록을 그대로 그린다 — 순서의 단일 정본.

/** 입력 섹션의 줄(iOS List > Section 순서). `tag`는 testTag다 — 기존 줄의 태그는 그대로다. */
enum class InputRow(val tag: String) {
    From("field-from"),
    AboardStep("aboard-step"),
    Swap("swap"),
    To("field-to"),
    /** 경유지 칸(있을 때) — 삭제 버튼 `ViaRemove`가 따른다. */
    Via("field-via"),
    ViaRemove("via-remove"),
    /** 경유지 없음: 입구 버튼(여정 입력 켜짐 `addMenu`, 꺼짐 종전 「경유지 추가」). */
    ViaAdd("via-add"),
    BoardStation("field-board-station"),
    AlightStation("field-alight-station"),
    AddBoardStation("station-add-board"),
    AddAlightStation("station-add-alight"),
    ClearStations("station-clear"),
    Submit("submit"),
}

/**
 * 입력 줄 순서(iOS Tab:1260-1345). 출발지 → (지금 탄 열차 방면 전) 단계 줄 → 바꾸기(지금 탄 열차가 아닐 때) → 도착지 →
 * 지금 탄 열차이면 역 B 칸·추가 버튼, 아니면 (역 칸이 서 있으면 칸들·남은 쪽 추가·지우기, 아니면 경유지 칸·삭제 또는 입구 버튼) → 조회.
 * 역 칸은 여정 입력이 켜졌을 때만 보인다(`journeyEnabled`). 줄마다 한 접근성 객체다.
 */
fun directionsInputRows(s: DirectionsUiState, journeyEnabled: Boolean): List<InputRow> = buildList {
    val aboard = s.aboardOrigin != null
    add(InputRow.From)
    if (aboard && s.aboardNeedsDirection && s.aboardDirectionsState != AboardDirectionsState.Idle) add(InputRow.AboardStep)
    if (!aboard) add(InputRow.Swap)
    add(InputRow.To)
    if (aboard) {
        add(if (s.alightStation != null) InputRow.AlightStation else InputRow.AddAlightStation)
    } else if (journeyEnabled && s.hasJourneyStations) {
        if (s.boardStation != null) add(InputRow.BoardStation)
        if (s.alightStation != null) add(InputRow.AlightStation)
        if (s.boardStation == null) add(InputRow.AddBoardStation) else if (s.alightStation == null) add(InputRow.AddAlightStation)
        add(InputRow.ClearStations)
    } else if (s.via != null) {
        add(InputRow.Via)
        add(InputRow.ViaRemove)
    } else {
        add(InputRow.ViaAdd)
    }
    add(InputRow.Submit)
}

/**
 * 여정 필드 착지 신호(`Field(via|transfer|boardStation|alightStation)`)가 앉을 줄(iOS `applyResolvedFocus`·`landFocus(on: .via)`).
 * 그 칸이 있으면 칸, 없으면 그 자리의 추가 버튼(입구 버튼), 그것도 없으면 조회 버튼이다(없는 줄에 요청하지 않는다).
 */
fun inputLandingRow(field: DirectionsFieldTarget, rows: List<InputRow>): InputRow {
    val candidates = when (field) {
        DirectionsFieldTarget.via, DirectionsFieldTarget.transfer -> listOf(InputRow.Via, InputRow.ViaAdd)
        DirectionsFieldTarget.boardStation -> listOf(InputRow.BoardStation, InputRow.AddBoardStation)
        DirectionsFieldTarget.alightStation -> listOf(InputRow.AlightStation, InputRow.AddAlightStation)
        DirectionsFieldTarget.from -> listOf(InputRow.From)
        DirectionsFieldTarget.to -> listOf(InputRow.To)
        DirectionsFieldTarget.manualLocation -> emptyList()
    }
    return candidates.firstOrNull { it in rows } ?: InputRow.Submit
}

/**
 * 칸 비우기 전에 커서를 보낼 줄(iOS `clearStationField`): 다른 칸이 남으면 그 칸, 둘 다 비면 조회 버튼. 그 칸이 사라지는 전이이므로
 * 모델을 비우기 전에 옮긴다(헌장 §5).
 */
fun clearStationCursorRow(s: DirectionsUiState, board: Boolean): InputRow {
    val other = if (board) s.alightStation else s.boardStation
    return if (other == null) InputRow.Submit else if (board) InputRow.AlightStation else InputRow.BoardStation
}

/** 지금 탄 열차 단계 줄의 버튼이 하는 일. */
sealed class AboardAction {
    data class Line(val line: String) : AboardAction()
    data class Direction(val direction: JourneyAboardDirection) : AboardAction()
    data object Refresh : AboardAction()
}

data class AboardStepButton(val tag: String, val label: String, val action: AboardAction)

/** 단계 줄 한 벌: 문장 한 줄(착지 대상) + 갈래별 버튼. */
data class AboardStepSpec(val text: String, val buttons: List<AboardStepButton>)

/**
 * 지금 탄 열차 단계 줄(iOS `aboardStepRows`). 노선 질문 → 노선 버튼들, 방면 질문 → 방면 버튼들, 실패·오는 열차 없음 → 「새로고침」,
 * 미커버·로딩 → 문장만, `Idle` → 줄 없음(null).
 */
fun aboardStepSpec(state: AboardDirectionsState, strings: Strings): AboardStepSpec? {
    val text = aboardStepText(state, strings) ?: return null
    val buttons = when (state) {
        is AboardDirectionsState.Lines -> state.lines.mapIndexed { i, line -> AboardStepButton("aboard-line-$i", line, AboardAction.Line(line)) }
        is AboardDirectionsState.Loaded ->
            if (state.directions.isEmpty()) listOf(refreshButton(strings))
            else state.directions.mapIndexed { i, d -> AboardStepButton("aboard-direction-$i", aboardDirectionRowText(d, strings), AboardAction.Direction(d)) }
        AboardDirectionsState.Failed -> listOf(refreshButton(strings))
        AboardDirectionsState.Unavailable, AboardDirectionsState.Loading, AboardDirectionsState.Idle -> emptyList()
    }
    return AboardStepSpec(text, buttons)
}

private fun refreshButton(strings: Strings) = AboardStepButton("aboard-refresh", strings.get("android.common.refresh"), AboardAction.Refresh)

/**
 * 방면 조회가 끝나 커서가 질문이 아닌 문장으로 설 때(미커버·열차 없음·실패, iOS `settleAboardArrival`) 낼 진동 종류. 질문(노선·방면)과 그 밖의 전이는 null이다.
 * 조회 중(`Loading`)에서 넘어온 전이만 세며, 같은 상태가 다시 그려지는 것은 전이가 아니다.
 */
fun aboardArrivalHaptic(previous: AboardDirectionsState?, current: AboardDirectionsState): HapticKind? {
    if (previous != AboardDirectionsState.Loading) return null
    return when {
        current == AboardDirectionsState.Unavailable -> HapticKind.attention
        current == AboardDirectionsState.Failed -> HapticKind.failure
        current is AboardDirectionsState.Loaded && current.directions.isEmpty() -> HapticKind.attention
        else -> null
    }
}

/** 방면 조회가 끝난 전이인가(질문 포함) — 커서가 단계 줄이면 그 줄을 다시 읽힌다(iOS `settleAboardArrival(rereadIfFocused:)`). */
fun aboardArrivalSettled(previous: AboardDirectionsState?, current: AboardDirectionsState): Boolean =
    previous == AboardDirectionsState.Loading && current != AboardDirectionsState.Loading && current != AboardDirectionsState.Idle

/** 지금 탄 열차 단계 줄과 그 아래 버튼들. 줄 목록(`directionsInputRows`)에 `AboardStep`이 있을 때만 부른다. */
@Composable
fun AboardStepRows(
    spec: AboardStepSpec,
    stepFocus: FocusRequester,
    submitFocus: FocusRequester,
    onReland: (FocusRequester) -> Unit,
    onAction: (AboardAction) -> Unit,
) {
    TextRow(spec.text, InputRow.AboardStep.tag, focus = stepFocus)
    for (b in spec.buttons) key(b.tag) {
        Button(
            onClick = {
                // 누른 버튼이 사라지는 전이다 — 계속 존재할 줄로 커서를 먼저 옮긴다(방면 확정은 조회 버튼, 나머지는 단계 줄).
                val target = if (b.action is AboardAction.Direction) submitFocus else stepFocus
                runCatching { target.requestFocus() }.onFailure { Log.w("DirectionsJourney", "단계 버튼 착지 실패 ${b.tag}", it) }
                onAction(b.action)
                // 위 요청은 한소네 커서를 옮기지 못하고, 단계 줄이 이미 입력 포커스를 쥐었으면 아무 일도 없다 — 비우고 다시 앉혀 새 문장을 읽힌다.
                onReland(target)
            },
            modifier = Modifier.tapTarget().testTag(b.tag),
        ) { Text(b.label) }
    }
}

/**
 * 입구 검색의 확인 질문(E77, iOS `.confirmationDialog`): 제목이 질문이고 버튼은 세로로 쌓는다(문장이 길다). 첫 버튼(짐작)에 착지하고
 * 닫기·뒤로·바깥은 `onDismiss`다. 여는 화면이 `LocalModalOpen`을 참으로 제공한다(모달 뒤에서 앱 통지를 집지 않는다).
 * 질문 문장은 창 제목(`paneTitle`)으로도 실려 착지 전에 낭독된다 — 첫 버튼 이름만으로는 무엇을 묻는지 모른다.
 */
@Composable
fun TransferQuestionDialog(title: String, choices: List<TransferChoice>, onChoose: (TransferChoice) -> Unit, onDismiss: () -> Unit) {
    val first = remember { FocusRequester() }
    var firstFocused by remember { mutableStateOf(false) }
    // `Dialog`는 별도 창이라 첫 프레임에 배치가 안 끝날 수 있어 착지를 검증하고 1회 재시도한다(`ChoiceDialog` 관용구).
    LaunchedEffect(Unit) {
        repeat(2) { attempt ->
            withFrameNanos { }
            if (firstFocused) return@LaunchedEffect
            runCatching { first.requestFocus() }.onFailure { Log.w("DirectionsJourney", "질문 착지 실패 (시도 ${attempt + 1})", it) }
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = Modifier.semantics { paneTitle = title },
        title = { Text(title, Modifier.testTag("transfer-question")) },
        text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                choices.forEachIndexed { i, c ->
                    val base = Modifier.fillMaxWidth().padding(vertical = 4.dp).tapTarget().testTag("transfer-answer-$i")
                    Button(
                        onClick = { onChoose(c) },
                        modifier = if (i == 0) base.landingTarget(first).onFocusChanged { if (it.isFocused) firstFocused = true } else base,
                    ) { Text(c.label) }
                }
            }
        },
        confirmButton = {},
    )
}
