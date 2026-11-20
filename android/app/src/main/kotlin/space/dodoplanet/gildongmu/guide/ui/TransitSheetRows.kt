package space.dodoplanet.gildongmu.guide.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.requesterFor
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.directions.DisclosureRow
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.guide.GuideDiag
import space.dodoplanet.gildongmu.guide.TransitAboardStep
import space.dodoplanet.gildongmu.guide.TransitGuideModel
import space.dodoplanet.gildongmu.guide.TransitGuideTextRenderer
import space.dodoplanet.gildongmu.guide.TransitGuideUiState
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.GuideSpeechClass
import space.dodoplanet.gildongmu.kit.StationPhoneResult
import space.dodoplanet.gildongmu.kit.TransitGuideLeg
import space.dodoplanet.gildongmu.kit.TransitTrackMode
import space.dodoplanet.gildongmu.kit.classifyTransitBoardingCandidates
import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.transitDisplayItem
import space.dodoplanet.gildongmu.kit.transitNeedsExpressPrompt
import space.dodoplanet.gildongmu.place.StationPhoneStore
import space.dodoplanet.gildongmu.place.callStationPhone
import space.dodoplanet.gildongmu.place.dial

/**
 * 시트 본문 행이 읽는 값 묶음(5-A가 시트에서 이름 붙여 둔 것과 같다). 행 컴포저블이 시트 지역 상태를 직접 쥐지 않게, 읽기 값과 갱신 람다만 넘긴다.
 * `exists`는 렌더 조건의 정본(`transitControlExists` + 페이지가 tracking) — 질문 화면 컨트롤을 그리는 자리는 반드시 이것 안에서 그린다.
 */
class TransitRowsCtx(
    val ui: TransitGuideUiState,
    val model: TransitGuideModel,
    val strings: Strings,
    val renderer: TransitGuideTextRenderer,
    val isEn: Boolean,
    val targets: TransitLandingTargets,
    val landing: TransitSheetLanding,
    val returnFocus: MutableMap<String, FocusRequester>,
    /** `returnFocus`와 같은 키의 들이기 요청자 — 화면 밖일 수 있는 복귀 줄이 단다. */
    val returnBring: MutableMap<String, BringIntoViewRequester>,
    val exists: (TransitSheetControl) -> Boolean,
    val viaExpanded: Boolean,
    val setViaExpanded: (Boolean) -> Unit,
    val expressPromptActive: Boolean,
    val setExpressPromptActive: (Boolean) -> Unit,
    /** 경유역 상세(지하철 구간) — 시트의 `openStationDetail`(노선 힌트 포함). */
    val openStation: (stop: TransitLegStop, lineName: String, source: String, returnTo: String) -> Unit,
    /** 잘못 내림 복구의 「목록에 없는 역 찾기」 — 시트가 복구 역 검색 페이지를 연다. */
    val openRecoverySearch: () -> Unit,
)

/** 이 단계에서 말미 도보 인계가 가능한가(iOS `onWalkHandoff != nil`). 단계 6이 `GuideSession.acceptWalkHandoff`를 배선하기 전에도 모델의 전이 가드(`pendingWalkHandoff`)가 안전하다. */
private const val WALK_HANDOFF_AVAILABLE = true

private fun TransitRowsCtx.handoffNow(): Boolean =
    transitHandoffNow(model.journeyNextIsWalk, model.isOnFinalLeg, model.finalLegWalkMinutes, WALK_HANDOFF_AVAILABLE)

@Composable
private fun SheetButton(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = modifier.fillMaxWidth().padding(vertical = 4.dp).tapTarget()) { Text(label) }
}

/** 정적 한 줄(한 줄 = 한 접근성 객체, 시각 분절 span 없음). `secondary`는 iOS `.secondary` 색. */
@Composable
private fun StaticLine(text: String, tag: String, secondary: Boolean = false) {
    Text(
        text,
        Modifier.fillMaxWidth().mergedRow(tag).padding(vertical = 8.dp),
        style = MaterialTheme.typography.bodyLarge,
        color = if (secondary) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
    )
}

// ─────────────────────────────── 경유역 목록 ───────────────────────────────

/**
 * 경유역 목록(iOS `viaStopsRows`) — 펼침 행(라벨 = 「경유역 N개」, 접힘이 기본), 본문은 펼친 동안만. 단계 공개(더 보기) 비적용: 정적 텍스트라 절단 너머가
 * 행동을 바꾸지 않는다. **지하철 leg의 각 행은 행 전체가 그 역의 장소 상세를 여는 버튼**(E33)이고, 버스 leg는 종전 줄(정류장 상세는 범위 밖, spec §2).
 */
@Composable
internal fun ViaStopsRows(c: TransitRowsCtx) {
    val leg = transitUiLeg(c.ui) ?: return
    if (c.ui.state == null || leg.viaStops.isEmpty()) return
    val label = c.strings.get(if (leg.mode == "subway") "transitGuide.viaStopsTrain" else "transitGuide.viaStopsBus", transitViaCount(leg))
    DisclosureRow(label, "transit-via-toggle", c.viaExpanded, onToggle = { c.setViaExpanded(!c.viaExpanded) }, strings = c.strings) {
        // 현재역 인덱스(E35): 도착 `arvlMsg3`와 실시간 열차 위치 중 큰 값 — 판정은 모델 한 곳(조인은 한국어 원문).
        val hereIndex = c.model.viaStopHereIndex
        val display = c.model.displayLeg(leg, useOverride = false)
        // `display.stops`는 `leg.viaStops.map(stopLabel)`이라 인덱스가 1:1 — 상세 진입은 원본 stop(좌표·ID).
        display.stops.indices.forEach { index ->
            val text = transitViaRowText(c.renderer, c.isEn, display, index, hereIndex)
            val key = "transit-via-$index"
            if (leg.mode == "subway") {
                ViaStopStationRow(leg.viaStops[index], leg.lineName, text, key, c)
            } else {
                StaticLine(text, key)
            }
        }
    }
}

/**
 * 지하철 경유역 행(E33 행 전체 버튼 + E44 「전화 걸기」, E72부터 작업 메뉴). **액션은 저장소 상태와 무관하게 항상 하나**이고 라벨만 갈린다(E45 판정 ⑤ — 번호가
 * 확정된 행에만 두면 「번호 없음」·「찾는 중」·「조회 실패」가 전부 액션 부재로 뭉개져 3상태가 사라진다). 저장소는 이 하위 컴포저블만 구독한다 — 번호 도착이
 * 시트 본문 재구성이 되지 않게. 행이 떠 있는 동안(앱이 보이는 동안만) 저장소를 신선하게 유지한다(`keepFresh`, iOS 행의 `recheckSeconds` 루프).
 */
@Composable
private fun ViaStopStationRow(stop: TransitLegStop, lineName: String, text: String, key: String, c: TransitRowsCtx) {
    val context = LocalContext.current
    val store = StationPhoneStore.shared
    val results by store.results.collectAsState()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(stop.name, lineName, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { store.keepFresh(stop.name, stop.lat, stop.lng, lineName) }
    }
    val representative = StationPhoneStore.key(stop.name, stop.lat, stop.lng, lineName)?.let { results[it] } is StationPhoneResult.Representative
    val callLabel = c.strings.get(transitViaCallLabelKey(representative))
    val call = CustomAccessibilityAction(callLabel) {
        c.model.touchUserAction()
        // 브리핑 로터와 같은 창구 — 번호면 걸고, 그 밖이면 3상태를 통지로 알린다. 시트엔 live region이 없어(가드 ⑨) 모델의 TTS 한 채널로 말한다.
        callStationPhone(store, stop, lineName, context::dial)?.let { notice ->
            c.model.announceExternalResult(context.getString(notice.text), highPriority = true, speechClass = GuideSpeechClass.actionable, haptic = notice.haptic.toGuideHaptic())
        }
        true
    }
    Text(
        text,
        Modifier.fillMaxWidth()
            .bringIntoViewRequester(c.returnBring.bringFor(key))
            .landingTarget(c.returnFocus.requesterFor(key))
            .clickable(role = Role.Button) { c.openStation(stop, lineName, "via", key) }
            .testTag(key)
            .semantics(mergeDescendants = true) { customActions = listOf(call) }
            .padding(vertical = 12.dp),
        style = MaterialTheme.typography.bodyLarge,
    )
}

// ─────────────────────────────── 국면 컨트롤 ───────────────────────────────

/**
 * 국면 컨트롤(iOS `phaseControls`) — 국면별 버튼 집합: 추적 불가 / 대기(목록) / 승차 대기 / 승차·도착. 착지 대상은 아니다(E38) — 단 [다음 구간]·[탑승 선택]·
 * [다시 고르기]는 고정 `testTag`를 달아 관측 전이가 그 버튼을 없앴을 때 커서 소실 복구(A47)가 읽는다.
 */
@Composable
internal fun PhaseControls(c: TransitRowsCtx) {
    val ui = c.ui
    val leg = transitUiLeg(ui) ?: return
    val handoffNow = c.handoffNow()
    val journeyHandoff = transitJourneyHandoff(handoffNow, c.model.journeyNextIsWalk)
    when (val controls = transitPhaseControls(ui)) {
        null -> Unit
        TransitPhaseControls.Untrackable -> {
            StaticLine(c.strings.get("transitGuide.untrackable"), "transit-untrackable", secondary = true)
            // 마지막 leg면 라벨이 인계 자체(E34), 여정이면 하차 통지가 부르는 「다음 구간」(판정 6). 이 자리는 종전대로 착지 바인딩이 없다(A35 범위).
            SheetButton(c.strings.get(transitUntrackableButtonKey(journeyHandoff, handoffNow)), Modifier.testTag("transit-untrackable-advance")) { advanceOrHandoff(c, handoffNow) }
        }
        TransitPhaseControls.Waiting -> WaitingList(c, leg)
        is TransitPhaseControls.Boarding -> {
            // 도착 관측이 riding 승격을 **자동으로** 하므로 선언 버튼은 서지 않는다(위원장 판정 2026-09-10) — 관측이 끝났거나 고른 열차의 확인을 기다리거나 그 열차가
            // 떠난 것으로 관측된 뒤(`boardingManualAvailable` 래치)에만 수동 진행 수단을 낸다. 그 사이 실제로 타 버렸으면 [다른 차량 선택] → 대기 국면 [이미 탔어요]가 탈출구다.
            if (controls.boardSelectedOffered) {
                SheetButton(c.strings.get(transitBoardSelectedKey(leg)), Modifier.testTag(TransitPhaseButton.boardSelected.tag)) { c.model.confirmBoarded() }
            }
            SheetButton(c.strings.get("transitGuide.reselectVehicle"), Modifier.testTag(TransitPhaseButton.reselect.tag)) { c.model.changeBoarding() }
        }
        is TransitPhaseControls.Active -> {
            // ⚠ 착지 대상이 아니다(E38): 하차 도착의 커서는 상태 문장에 앉고 이 버튼은 그 아래 경유역 목록을 지나야 만난다.
            // 마지막 leg + 말미 도보면 버튼은 하나이고 라벨이 처음부터 「남은 도보 안내 시작」(E34) — 한 번 누르면 leg 종료와 도보 시작이 함께.
            if (controls.advance) {
                SheetButton(c.strings.get(transitAdvanceLabelKey(journeyHandoff, handoffNow)), Modifier.testTag(TransitPhaseButton.advance.tag)) { advanceOrHandoff(c, handoffNow) }
            }
            if (controls.changeBoarding) {
                if (ui.reboardPickerActive) {
                    // 승차 중 탑승 변경(A16 L3): 하차역이면 도착 선언(A37 ②), 그 밖은 그 역 기준 재선택.
                    StationPicker(
                        c, leg,
                        onPick = { index ->
                            if (index == leg.viaStops.size - 1) {
                                c.model.cancelReboard()
                                c.model.declareArrived()
                            } else {
                                c.model.changeBoarding(index)
                            }
                        },
                        onFindStation = null,
                        onCancel = {
                            c.model.cancelReboard()
                            c.landing.land(TransitSheetControl.status, "reboardCancel", expectsSystemPlacement = false)
                        },
                    )
                } else {
                    SheetButton(c.strings.get("transitGuide.changeBoarding"), Modifier.testTag("transit-change-boarding")) { c.model.beginReboard() }
                }
            }
        }
    }
    RecoveryControls(c, leg)
}

/**
 * 「여기서 다시 길찾기」(E78 spec §3·§8, iOS `recoveryControls`) — 국면 버튼 바로 다음. 지하철은 역부터 묻고(버튼 자리를 역 목록이 대신한다), 상태 행은 버튼 아래
 * 한 줄 + 그 결과의 다음 행동 하나다. 상태 행 문장은 착지 폴백과 같은 키 함수(`transitRecoveryStatusKey`)다.
 */
@Composable
private fun RecoveryControls(c: TransitRowsCtx, leg: TransitGuideLeg) {
    val controls = transitRecoveryControls(c.ui, c.model.recoveryOffered, walkAvailable = c.ui.dest != null) ?: return
    if (controls.picking) {
        StationPicker(
            c, leg,
            onPick = { index -> c.model.recoverFrom(index) },
            onFindStation = c.openRecoverySearch,
            onCancel = {
                c.model.cancelRecovery()
                c.landing.land(TransitSheetControl.status, "recoveryCancel", expectsSystemPlacement = false)
            },
        )
    } else {
        SheetButton(c.strings.get("android.transitGuide.recoveryStart"), Modifier.testTag("transit-recovery-start")) { c.model.beginRecovery() }
    }
    if (c.exists(TransitSheetControl.recoveryStatus)) {
        transitRecoveryStatusKey(c.ui)?.let { key ->
            Text(
                c.strings.get(key),
                Modifier.fillMaxWidth().transitLandingRow(c.targets, TransitSheetControl.recoveryStatus).padding(vertical = 8.dp),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
    if (controls.retry) {
        // 누르면 이 행이 사라진다 — 상태 행(조회 중)으로 커서를 옮긴다(헌장 §5).
        SheetButton(c.strings.get("android.transitGuide.recoveryRetry"), Modifier.testTag("transit-recovery-retry")) {
            c.model.retryRecovery()
            c.landing.land(TransitSheetControl.recoveryStatus, "recoveryRetry", expectsSystemPlacement = false)
        }
    }
    if (controls.walk) {
        SheetButton(c.strings.get("android.transitGuide.recoveryWalk"), Modifier.testTag("transit-recovery-walk")) {
            // 단계 6: GuideSession.acceptWalkHandoff
        }
    }
}

/**
 * `advance` 자리 버튼의 동작(iOS `advanceOrHandoff`) — E34면 leg 종료 뒤 **인계가 실제로 남았을 때만** 도보 시작을 부른다(전이가 no-op이면 세션을 끊지 않는다).
 * 여정은 `.done` 갈래의 콜백이 다음 단계를 연다(spec §6.3) — 시트가 인계를 부르지 않는다.
 */
private fun advanceOrHandoff(c: TransitRowsCtx, handoffNow: Boolean) {
    if (c.model.journeyNextIsWalk != null) {
        c.model.advance()
        return
    }
    if (handoffNow) {
        if (c.model.advanceIntoWalkHandoff()) {
            GuideDiag.log("transit walkHandoff requested")
            // 단계 6: GuideSession.acceptWalkHandoff
        }
    } else {
        c.model.advance()
    }
}

/**
 * 근사(비관측) 잠금 진입(iOS `boardAlreadyOrAskExpress`) — 급행 집합이 있는 노선만 급행 확인을 묻는다(§6), 없으면 즉시 잠금.
 * [이미 탔어요](서울버스)와 [열차 정보 없이 계속](지하철 pickVehicle 0건) 공용.
 */
private fun boardAlreadyOrAskExpress(c: TransitRowsCtx, leg: TransitGuideLeg) {
    if (transitNeedsExpressPrompt(leg)) {
        c.setExpressPromptActive(true)
        c.landing.land(TransitSheetControl.expressPrompt, "express", expectsSystemPlacement = false)
    } else {
        c.model.boardAlready(express = null)
    }
}

// ─────────────────────────────── 대기 목록 ───────────────────────────────

/** 대기 국면(iOS `waitingList`): 지방버스 근사 / 「이미 탑승」 역 묻기 / 차량 후보 목록. */
@Composable
private fun WaitingList(c: TransitRowsCtx, leg: TransitGuideLeg) {
    val ui = c.ui
    val strings = c.strings
    if (leg.trackMode == TransitTrackMode.tagoBus) {
        SheetButton(strings.get("transitGuide.boardApprox"), Modifier.testTag("transit-board-approx")) { c.model.boardApprox() }
        return
    }
    if (ui.aboardStep == TransitAboardStep.pickStation) {
        // 「이미 탑승」 흐름 1단(A34 ②): 지나는 역을 묻는다 — 역 선택 화면 재사용, 질문만 전용 키(목록이 성립하는 조건이 「내 열차가 그 역에 접근·정차·출발 중」이라
        // L3의 「지금 있는 역」과 다른 질문).
        StationPicker(
            c, leg,
            onPick = { index ->
                c.setExpressPromptActive(false)
                c.model.pickAboardStation(index)
                // 하차역이면 국면 전이 착지(arrived → 상태 문장)가 맡는다.
                if (c.model.ui.value.aboardStep == TransitAboardStep.pickVehicle) c.landing.land(TransitSheetControl.waitingLabel, "aboardPicked", expectsSystemPlacement = false)
            },
            onFindStation = null,
            onCancel = {
                c.model.cancelAboard()
                c.landing.land(TransitSheetControl.status, "aboardCancel", expectsSystemPlacement = false)
            },
        )
        return
    }
    val aboardPicking = ui.aboardStep == TransitAboardStep.pickVehicle
    val classified = classifyTransitBoardingCandidates(c.model.waitingCandidatesPool(), leg)
    val rows = classified.candidates.mapIndexed { index, candidate -> transitCandidateRowId(candidate, index) to candidate }
    val display = c.model.displayLeg(leg, useOverride = false)
    // pickVehicle 단계(A34 ②)는 라벨이 곧 질문(「타고 계신 차량을 선택하세요」) — 착지 낭독이 답한다.
    if (c.exists(TransitSheetControl.waitingLabel)) {
        Text(
            strings.get(transitWaitingLabelKey(ui)),
            Modifier.fillMaxWidth().transitLandingRow(c.targets, TransitSheetControl.waitingLabel).padding(vertical = 8.dp),
            style = MaterialTheme.typography.bodyLarge,
        )
    }
    // 목록 포커스 소실 복귀(§13.4, 헌장 §5): 폴링 갱신으로 커서가 얹힌 항목이 사라지면 라벨로 선점 복귀(목록 밖 커서는 강탈 금지).
    val ids = rows.map { it.first }
    OnChange(ids) { _, now ->
        transitLostCandidateId(c.landing.cursorTag, now)?.let { lost -> c.landing.land(TransitSheetControl.waitingLabel, "lost=$lost", expectsSystemPlacement = false) }
    }
    if (classified.directionUncertain && classified.candidates.isNotEmpty()) {
        StaticLine(strings.get("transitGuide.directionCheck"), "transit-direction-check", secondary = true)
    }
    // 빠른하차(E5) — 열차 목록 **앞**. 국면 전환으로 조용히 나타나는 문장이라 착지점(waitingLabel) 뒤에 두어야 앞으로 스와이프해서 만난다. 통지는 만들지 않는다.
    // ⚠ 역명은 **표시 라벨**이다(E27 잔여 ①) — 조인 필드를 그대로 넣으면 영어 틀에 한국어 역명이 섞인다.
    transitQuickExitLine(leg, display, c.isEn, AppLocale.current(LocalContext.current.resources))?.let { StaticLine(it, "transit-quick-exit") }
    if (classified.candidates.isEmpty()) {
        // 0건 사유 3-state(§13.3): 진짜 0건 / 필터 전멸 / 조회 실패. pickVehicle의 「그 역에 있는 열차가 없다」(원 목록엔 후보가 있다)는 진짜 0건과 다른 상태라 따로 말한다.
        val text = if (transitRawHasCandidates(ui, leg, aboardPicking)) strings.get("transitGuide.noCandidatesAboard")
        else c.model.reasonText(ui.waitingReason ?: space.dodoplanet.gildongmu.kit.TransitWaitingEmptyReason.none)
        StaticLine(text, "transit-no-candidates", secondary = true)
    }
    // 항목 정체성은 열차 id — 앞 열차가 빠져도 같은 노드의 글자가 다음 열차로 바뀌지 않는다(커서가 얹힌 노드는 그 열차를 따른다).
    rows.forEach { (id, candidate) -> key(id) { CandidateRow(c, leg, display, id, candidate) } }
    // 대기 국면 탈출구(§13.2) + 탑승 변경 취소(§13.1).
    SheetButton(strings.get("transitGuide.refresh"), Modifier.testTag("transit-refresh")) { c.model.refreshWaiting() }
    if (aboardPicking) {
        // 목록이 빌 때만 근사(비관측) 잠금으로(A34 판정) — 급행 집합 노선이면 급행 확인이 먼저.
        if (classified.candidates.isEmpty()) {
            SheetButton(strings.get("transitGuide.continueWithoutTrain"), Modifier.testTag("transit-continue-without-train")) { boardAlreadyOrAskExpress(c, leg) }
        }
        SheetButton(strings.get("transitGuide.pickAnotherStation"), Modifier.testTag("transit-pick-another-station")) {
            c.setExpressPromptActive(false)
            c.model.pickAnotherAboardStation()
            // 착지는 픽커 헤딩의 상태 변화(`aboardStep`)가 맡는다.
        }
    } else {
        // [이미 탔어요]: 지하철은 역부터 묻고(A34 ②), 그 밖(서울버스)은 종전대로 곧장 잠금.
        SheetButton(strings.get("transitGuide.boardAlready"), Modifier.testTag("transit-board-already")) {
            if (leg.trackMode == TransitTrackMode.subway && leg.viaStops.isNotEmpty()) {
                c.setExpressPromptActive(false)
                c.model.beginAboard()
            } else {
                boardAlreadyOrAskExpress(c, leg)
            }
        }
    }
    if (c.exists(TransitSheetControl.expressPrompt)) {
        // 버튼으로 펼친 것이라 헤딩이 발견 경로(헌장 §3). 답하면 프롬프트는 사라지고 착지는 국면 전이(riding → 다음 구간) 또는 거절 문장이 맡는다.
        Text(
            strings.get("transitGuide.expressPrompt"),
            Modifier.fillMaxWidth().transitLandingRow(c.targets, TransitSheetControl.expressPrompt).headingText().padding(vertical = 8.dp),
            style = MaterialTheme.typography.titleMedium,
        )
        SheetButton(strings.get("transitGuide.expressYes"), Modifier.testTag("transit-express-yes")) {
            c.setExpressPromptActive(false)
            c.model.boardAlready(express = true)
            // 거절이면 문장 행 착지(착지 낭독 = 답). 착지 실패 폴백(`.high` 통지)은 전 대상 공용(A35).
            if (c.model.ui.value.expressBlockedNote != null) c.landing.land(TransitSheetControl.expressBlocked, "expressBlocked", expectsSystemPlacement = false)
        }
        SheetButton(strings.get("transitGuide.expressNo"), Modifier.testTag("transit-express-no")) {
            c.setExpressPromptActive(false)
            c.model.boardAlready(express = false)
        }
    }
    if (c.exists(TransitSheetControl.expressBlocked)) {
        ui.expressBlockedNote?.let { note ->
            Text(
                note,
                Modifier.fillMaxWidth().transitLandingRow(c.targets, TransitSheetControl.expressBlocked).padding(vertical = 8.dp),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
    if (ui.state?.previousLock != null && !aboardPicking) {
        SheetButton(strings.get("transitGuide.cancelChangeBoarding"), Modifier.testTag("transit-cancel-change-boarding")) { c.model.cancelChangeBoarding() }
    }
}

/** 후보 한 줄(iOS `candidateRow`) — 차단·선택 불가는 정적 줄, 선택 가능만 버튼(「{설명} 선택」). 행 정체성 = 차량 식별자(폴링 갱신이 커서를 흔들지 않게, §5.1). */
@Composable
private fun CandidateRow(c: TransitRowsCtx, leg: TransitGuideLeg, display: space.dodoplanet.gildongmu.kit.TransitDisplayLeg, id: String, candidate: space.dodoplanet.gildongmu.kit.TransitBoardingCandidate) {
    val departedMinutes = transitDepartedMinutes(c.ui.waitingDeparted, candidate.item)
    when (val row = transitCandidateRow(c.renderer, c.isEn, candidate, leg, display, departedMinutes)) {
        is TransitCandidateRow.Blocked -> StaticLine(row.text, transitCandidateTag(id), secondary = true)
        is TransitCandidateRow.Unselectable -> StaticLine(row.text, transitCandidateTag(id), secondary = true)
        is TransitCandidateRow.Selectable -> {
            val label = c.strings.get(if (leg.mode == "subway") "transitGuide.selectTrain" else "transitGuide.selectBus", row.desc)
            SheetButton(label, Modifier.testTag(transitCandidateTag(id))) {
                // 설명은 ko·en 쌍으로 얼린다 — 렌더 문자열을 저장하면 세션 도중 언어를 바꿨을 때 그 조각만 옛 언어로 남는다.
                val description = transitVehicleDescLabel(c.strings, transitDisplayItem(candidate.item))
                if (c.model.ui.value.aboardStep == TransitAboardStep.pickVehicle) c.model.boardAboard(candidate.item, description)
                else c.model.board(candidate.item, description)
            }
        }
    }
}

// ─────────────────────────────── 역 선택 화면 ───────────────────────────────

/**
 * 역 선택 화면(iOS `stationPicker`) — 두 흐름이 재사용한다: 승차 중 탑승 변경(A16 L3, 「지금 어느 역에 계신가요?」)과 「이미 탑승」(A34 ②, 「지금 어느 역을
 * 지나고 계신가요?」). 질문·선택 응답만 다르고 행·취소·착지는 같다. 마지막 행(하차역)은 두 흐름 모두 도착 선언이다(A37 ②). 5-D의 잘못 내림 복구는
 * `onFindStation`(「목록에 없는 역 찾기」)을 넘긴다 — 목록 맨 끝, 취소 앞.
 *
 * ⚠ 위치가 아니라 목록인 근거(위원장 판정): 지하철 안에서는 GPS가 잡히지 않는다. 역 이름은 안내방송으로 사용자가 이미 아는 정보라 목록이 지하·지상 무관하게
 * 항상 성립한다. 질문은 흐름별 키(`transitReboardPromptKey`, 뷰·폴백이 같은 식)이고 착지는 이 뷰가 아니라 화면이 열리는 상태 변화가 부른다(A35 §4.1 ③).
 */
@Composable
internal fun StationPicker(
    c: TransitRowsCtx,
    leg: TransitGuideLeg,
    onPick: (Int) -> Unit,
    onFindStation: (() -> Unit)?,
    onCancel: () -> Unit,
) {
    if (c.exists(TransitSheetControl.reboardPrompt)) {
        Text(
            c.strings.get(transitReboardPromptKey(c.ui)),
            Modifier.fillMaxWidth().transitLandingRow(c.targets, TransitSheetControl.reboardPrompt).headingText().padding(vertical = 8.dp),
            style = MaterialTheme.typography.titleMedium,
        )
    }
    // 항목 정체성은 순번 — 동명 정차가 있어도 행이 합쳐지지 않는다. ⚠ **라벨은 표시(en 가능)이고 값은 인덱스**다 — 조회 쿼리는 모델이 인덱스로 viaStops의
    // 한국어 원문을 되찾는다(조인/표시 분리, spec §3.5·§3.6). 언어 축은 로케일(`isEn`)이지 데이터 유무가 아니다(세션 도중 ko로 바꾸면 이 버튼만 영어로 남는다).
    c.model.displayLeg(leg, useOverride = false).stops.forEachIndexed { index, stop ->
        SheetButton(if (c.isEn) (stop.en ?: stop.ko) else stop.ko, Modifier.testTag("transit-picker-$index")) { onPick(index) }
    }
    // 잘못 내림 복구만(E78 §5-2): 하차역을 지나쳐 목록에 없는 역.
    onFindStation?.let { find ->
        // 검색 페이지를 취소로 닫으면 이 버튼으로 되돌아온다(`RECOVERY_FIND_TAG`).
        SheetButton(c.strings.get("android.transitGuide.recoveryFindStation"), Modifier.bringIntoViewRequester(c.returnBring.bringFor(RECOVERY_FIND_TAG)).landingTarget(c.returnFocus.requesterFor(RECOVERY_FIND_TAG)).testTag(RECOVERY_FIND_TAG)) { find() }
    }
    SheetButton(c.strings.get(transitReboardCancelKey(c.ui)), Modifier.testTag("transit-picker-cancel")) { onCancel() }
}

// ─────────────────────────────── 하차 준비 줄 ───────────────────────────────

/**
 * 하차 준비 줄(E84, iOS `alightPrepRow`) — 본 Section의 마지막 줄(국면 버튼 다음, 주변 섹션 앞)이고 정적 정보라 통지·착지가 없다. 문 위치도 출구도 없으면 줄이
 * 없다(부재 문구를 만들지 않는다).
 */
@Composable
internal fun AlightPrepRow(c: TransitRowsCtx) {
    val leg = transitUiLeg(c.ui) ?: return
    val text = transitAlightPrepText(c.ui, c.model.displayLeg(leg, useOverride = false), c.isEn, AppLocale.current(LocalContext.current.resources), c.strings) ?: return
    StaticLine(text, "transit-alight-prep")
}
