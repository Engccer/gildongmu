package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.guide.ui.TransitPhaseButton
import space.dodoplanet.gildongmu.guide.ui.TransitSheetControl
import space.dodoplanet.gildongmu.guide.ui.TransitSheetLanding
import space.dodoplanet.gildongmu.guide.ui.transitControlExists
import space.dodoplanet.gildongmu.guide.ui.transitLandingFallbackText
import space.dodoplanet.gildongmu.guide.ui.transitPhaseTransitionLanding
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.TransitSignal
import space.dodoplanet.gildongmu.kit.buildTransitGuideRoute
import space.dodoplanet.gildongmu.kit.initTransitGuide
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 대중교통 시트 착지(M5 단계 5-A, iOS `TransitTrackingSheet` E38·A47·E57) — 착지 상태 머신은 가상 시계로, 전이 판정·렌더 조건·폴백 문장·시트 선택은 순수 함수로.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TransitSheetLandingTest {
    private class H(val scope: TestScope) {
        var settled = true
        var foreground = true
        var tracking = true
        var pageOpen = false
        var present = TransitSheetControl.entries.toSet()
        var focusOk = true
        var fallback = "상태 문장"
        val focused = mutableListOf<TransitSheetControl>()
        val revealed = mutableListOf<TransitSheetControl>()
        val announced = mutableListOf<String>()
        val logs = mutableListOf<String>()
        val landing = TransitSheetLanding(
            scope = scope,
            clock = { scope.testScheduler.currentTime / 1000.0 },
            announcementsSettled = { settled },
            isForeground = { foreground },
            isTracking = { tracking },
            pageOpen = { pageOpen },
            exists = { it in present },
            reveal = { revealed += it },
            focus = { c -> if (focusOk) { focused += c; true } else false },
            fallbackText = { fallback },
            announceFallback = { announced += it },
            log = { logs += it },
        )
        val last: String get() = logs.last()
    }

    @Test fun `진입 — 안내 문장이 끝난 뒤 상태 문장 행에 앉고, 대입 전에 화면 안으로 들인다`() = runTest {
        val h = H(this)
        h.settled = false
        h.landing.land(TransitSheetControl.status, "open", expectsSystemPlacement = true)
        advanceTimeBy(3_000); runCurrent()
        assertEquals(emptyList(), h.focused, "시작 문장이 말하는 동안 앉지 않는다")
        h.settled = true
        advanceUntilIdle()
        assertEquals(listOf(TransitSheetControl.status), h.focused)
        assertEquals(listOf(TransitSheetControl.status), h.revealed)
        assertEquals(TransitSheetControl.status.tag, h.landing.cursorTag)
        assertTrue(h.last.contains("target=status landed=true") && h.last.contains("note=open"), h.last)
    }

    @Test fun `대기 중 사용자가 커서를 옮기면 앉지 않는다 — 시스템 배치를 기대한 요청의 첫 이동은 제외`() = runTest {
        val h = H(this)
        h.settled = false
        h.landing.land(TransitSheetControl.status, "open", expectsSystemPlacement = true)
        advanceTimeBy(500); runCurrent()
        h.landing.onA11yFocus("guide-title")        // 시트 표시의 시스템 배치
        h.settled = true
        advanceUntilIdle()
        assertEquals(listOf(TransitSheetControl.status), h.focused)

        h.settled = false
        h.landing.land(TransitSheetControl.status, "transition", expectsSystemPlacement = false)
        advanceTimeBy(500); runCurrent()
        h.landing.onA11yFocus("transit-via")        // 사용자 이동
        h.settled = true
        advanceUntilIdle()
        assertEquals(1, h.focused.size)
        assertTrue(h.last.contains("reason=userMoved"), h.last)
    }

    @Test fun `시스템 배치를 기다리던 요청을 대신하는 새 요청은 그 기대를 물려받아 첫 이동을 사용자 이동으로 세지 않는다`() = runTest {
        val h = H(this)
        h.settled = false
        h.landing.land(TransitSheetControl.status, "overviewClose", expectsSystemPlacement = true)
        advanceTimeBy(500); runCurrent()
        assertTrue(h.landing.awaitingSystemPlacement, "첫 이동 전에는 시스템 배치를 기다린다")
        val inherits = h.landing.awaitingSystemPlacement
        h.landing.cancel()
        h.landing.land(TransitSheetControl.status, "transition", expectsSystemPlacement = inherits)
        advanceTimeBy(100); runCurrent()
        h.landing.onA11yFocus("guide-title")        // 페이지 교체의 시스템 배치
        h.settled = true
        advanceUntilIdle()
        assertEquals(listOf(TransitSheetControl.status), h.focused)
        assertFalse(h.logs.any { it.contains("reason=userMoved") }, h.logs.toString())
    }

    @Test fun `기대 없는 새 요청은 같은 첫 이동에 사용자 이동으로 끝난다 — 이미 이동을 본 요청은 기다리지 않는다`() = runTest {
        val h = H(this)
        h.settled = false
        h.landing.land(TransitSheetControl.status, "x", expectsSystemPlacement = false)
        advanceTimeBy(100); runCurrent()
        assertFalse(h.landing.awaitingSystemPlacement)
        h.landing.onA11yFocus("guide-title")
        h.settled = true
        advanceUntilIdle()
        assertEquals(emptyList(), h.focused)
        assertTrue(h.last.contains("reason=userMoved"), h.last)
    }

    @Test fun `배경에서 온 요청은 이월되고 전경 복귀가 한 번만 소비한다`() = runTest {
        val h = H(this)
        h.foreground = false
        h.landing.land(TransitSheetControl.status, "transition", expectsSystemPlacement = false)
        advanceUntilIdle()
        assertEquals(emptyList(), h.focused)
        assertEquals(TransitSheetControl.status, h.landing.deferred)
        h.foreground = true
        h.landing.onForegroundReturn()
        advanceUntilIdle()
        h.landing.onForegroundReturn()
        advanceUntilIdle()
        assertEquals(listOf(TransitSheetControl.status), h.focused, "복귀 착지는 한 번")
        assertNull(h.landing.deferred)
    }

    @Test fun `배경 판정은 대입 시점 — 400ms 사이 잠기면 이월`() = runTest {
        val h = H(this)
        h.landing.land(TransitSheetControl.status, "transition", expectsSystemPlacement = false)
        runCurrent()
        h.foreground = false
        advanceUntilIdle()
        assertEquals(emptyList(), h.focused)
        assertEquals(TransitSheetControl.status, h.landing.deferred)
        assertTrue(h.last.contains("reason=background deferred=true phase=inFlight"), h.last)
    }

    @Test fun `시트 안 페이지 위에선 이월하고 페이지 닫힘이 소비한다`() = runTest {
        val h = H(this)
        h.pageOpen = true
        h.landing.land(TransitSheetControl.recoveryStatus, "recoveryOutcome", expectsSystemPlacement = false)
        advanceUntilIdle()
        assertEquals(emptyList(), h.focused)
        h.pageOpen = false
        assertTrue(h.landing.landDeferred("deferred"))
        advanceUntilIdle()
        assertEquals(listOf(TransitSheetControl.recoveryStatus), h.focused)
        assertFalse(h.landing.landDeferred("deferred"), "이월은 한 번 소비된다")
    }

    @Test fun `대상이 사라졌으면 폴백 없이 끝난다`() = runTest {
        val h = H(this)
        h.present = emptySet()
        h.landing.land(TransitSheetControl.expressPrompt, "express", expectsSystemPlacement = false)
        advanceUntilIdle()
        assertEquals(emptyList(), h.focused)
        assertEquals(emptyList(), h.announced)
        assertTrue(h.last.contains("reason=vanished"), h.last)
    }

    @Test fun `두 번 다 초점을 받지 못하면 그 자리 라벨을 통지한다 — 빈 문장은 건너뛴다`() = runTest {
        val h = H(this)
        h.focusOk = false
        h.landing.land(TransitSheetControl.status, "transition", expectsSystemPlacement = false)
        advanceUntilIdle()
        assertEquals(listOf("상태 문장"), h.announced)
        assertTrue(h.logs.any { it.contains("target=status landed=false attempts=2") })
        h.fallback = ""
        h.landing.land(TransitSheetControl.destChangeStatus, "destChange", expectsSystemPlacement = false)
        advanceUntilIdle()
        assertEquals(1, h.announced.size)
        assertTrue(h.last.contains("skipped=emptyText"), h.last)
    }

    @Test fun `국면 변화는 진행 중 착지를 끊는다`() = runTest {
        val h = H(this)
        h.settled = false
        h.landing.land(TransitSheetControl.reboardPrompt, "reboardPicker", expectsSystemPlacement = false)
        runCurrent()
        h.landing.cancel()
        h.settled = true
        advanceUntilIdle()
        assertEquals(emptyList(), h.focused)
    }

    @Test fun `전이 착지 — 사용자 전이는 전부, 관측 전이는 도착과 소실 복구만(A47)`() {
        // 사용자 전이: 차량 선택 목록으로 가면 그 질문 라벨, 라벨이 서지 않으면 상태 문장, 그 밖은 상태 문장.
        assertEquals(TransitSheetControl.waitingLabel, transitPhaseTransitionLanding(TransitPhase.boarding, TransitPhase.waiting, byUser = true, lostFocus = false, waitingLabelExists = true))
        assertEquals(TransitSheetControl.status, transitPhaseTransitionLanding(TransitPhase.boarding, TransitPhase.waiting, byUser = true, lostFocus = false, waitingLabelExists = false))
        assertEquals(TransitSheetControl.status, transitPhaseTransitionLanding(TransitPhase.waiting, TransitPhase.boarding, byUser = true, lostFocus = false, waitingLabelExists = true))
        // 관측 boarding → riding은 포커스 강탈이라 앉지 않는다.
        assertNull(transitPhaseTransitionLanding(TransitPhase.boarding, TransitPhase.riding, byUser = false, lostFocus = false, waitingLabelExists = true))
        assertEquals(TransitSheetControl.status, transitPhaseTransitionLanding(TransitPhase.riding, TransitPhase.arrived, byUser = false, lostFocus = false, waitingLabelExists = true))
        assertNull(transitPhaseTransitionLanding(TransitPhase.arrived, TransitPhase.arrived, byUser = false, lostFocus = false, waitingLabelExists = true))
        // 커서를 쥔 국면 버튼이 사라졌으면 잃은 포커스의 복구.
        assertEquals(TransitSheetControl.status, transitPhaseTransitionLanding(TransitPhase.boarding, TransitPhase.riding, byUser = false, lostFocus = true, waitingLabelExists = true))
        assertNull(transitPhaseTransitionLanding(TransitPhase.arrived, TransitPhase.done, byUser = true, lostFocus = false, waitingLabelExists = true))
        assertNull(transitPhaseTransitionLanding(TransitPhase.riding, null, byUser = false, lostFocus = true, waitingLabelExists = true))
        assertEquals(TransitPhase.boarding, TransitPhaseButton.forTag("transit-reselect")?.phase)
        assertEquals(TransitPhase.arrived, TransitPhaseButton.forTag("transit-advance")?.phase)
        assertNull(TransitPhaseButton.forTag(TransitSheetControl.status.tag))
    }

    private fun route() = buildTransitGuideRoute(rawRoute())!!

    private fun rawRoute() = (
        TransitRoute(
            summary = TransitRouteSummary(totalMinutes = 30, fare = 1500, transfers = 0, walkMinutes = 8, departName = "천호", arriveName = "여의도"),
            legs = listOf(
                TransitRouteLeg(mode = "walk", minutes = 3),
                TransitRouteLeg(mode = "subway", lineName = "수도권 5호선", fromName = "천호", toName = "여의도", stationCount = 8, minutes = 20, serviceWayCode = 2),
                TransitRouteLeg(mode = "walk", minutes = 5),
            ),
            routeKey = "p0",
        )
    )

    private fun waiting(): TransitGuideUiState {
        val r = route()
        return TransitGuideUiState(state = initTransitGuide(r, 0.0), route = r, destinationLabel = "여의도", dest = BeaconDest(37.52, 126.92))
    }

    @Test fun `렌더 조건 정본 — transitControlExists`() {
        val ui = waiting()
        fun has(u: TransitGuideUiState, c: TransitSheetControl, express: Boolean = false, recovery: Boolean = false) = transitControlExists(u, c, express, recovery)
        assertTrue(has(ui, TransitSheetControl.status))
        assertFalse(has(TransitGuideUiState(), TransitSheetControl.status), "세션이 없으면 상태 문장도 없다")
        assertTrue(has(ui, TransitSheetControl.waitingLabel))
        assertFalse(has(ui.copy(state = ui.state!!.copy(signal = TransitSignal.untrackable)), TransitSheetControl.waitingLabel), "추적 불가는 목록이 없다")
        val pick = ui.copy(aboardStep = TransitAboardStep.pickStation)
        assertFalse(has(pick, TransitSheetControl.waitingLabel))
        assertTrue(has(pick, TransitSheetControl.reboardPrompt), "이미 탑승 역 선택")
        assertFalse(has(ui, TransitSheetControl.reboardPrompt))
        assertTrue(has(ui.copy(state = ui.state!!.copy(phase = TransitPhase.riding), reboardPickerActive = true), TransitSheetControl.reboardPrompt))
        assertTrue(has(ui, TransitSheetControl.expressPrompt, express = true))
        assertFalse(has(ui, TransitSheetControl.expressPrompt, express = false))
        assertTrue(has(ui.copy(expressBlockedNote = "급행은 서지 않아요"), TransitSheetControl.expressBlocked))
        val dest = PendingDestChange(BeaconDest(1.0, 2.0), "강남", null, DestChangePhase.Loading, null)
        assertTrue(has(ui.copy(pendingDestChange = dest), TransitSheetControl.destChangeStatus))
        assertFalse(has(ui, TransitSheetControl.destChangeStatus))
        val failed = ui.copy(recoveryOutcome = RecoveryOutcome.noRoute)
        assertTrue(has(failed, TransitSheetControl.recoveryStatus, recovery = true))
        assertFalse(has(failed, TransitSheetControl.recoveryStatus, recovery = false), "복구가 제공되지 않으면 행이 없다")
        val picking = ui.copy(state = ui.state!!.copy(phase = TransitPhase.riding), pendingRecovery = PendingRecovery(1, 0, PendingRecovery.Phase.pickStation))
        assertTrue(has(picking, TransitSheetControl.reboardPrompt, recovery = true))
        assertFalse(has(picking, TransitSheetControl.recoveryStatus, recovery = true), "역 고르기 중엔 상태 행이 아니라 질문 헤딩")
    }

    @Test fun `폴백 문장은 그 자리에서 낭독됐을 라벨의 키`() {
        val strings = Strings { key, _ -> key }
        val ui = waiting()
        fun text(u: TransitGuideUiState, c: TransitSheetControl) = transitLandingFallbackText(c, u, strings) { "상태" }
        assertEquals("상태", text(ui, TransitSheetControl.status))
        assertEquals("transitGuide.waitingLabel", text(ui, TransitSheetControl.waitingLabel))
        assertEquals("transitGuide.waitingLabelAboard", text(ui.copy(aboardStep = TransitAboardStep.pickVehicle), TransitSheetControl.waitingLabel))
        assertEquals("transitGuide.aboardStationPrompt", text(ui.copy(aboardStep = TransitAboardStep.pickStation), TransitSheetControl.reboardPrompt))
        assertEquals("transitGuide.reboardStationPrompt", text(ui, TransitSheetControl.reboardPrompt))
        assertEquals("transitGuide.expressPrompt", text(ui, TransitSheetControl.expressPrompt))
        assertEquals("", text(ui, TransitSheetControl.expressBlocked))
        val dest = PendingDestChange(BeaconDest(1.0, 2.0), "강남", null, DestChangePhase.Empty, null)
        assertEquals("android.transitGuide.destChangeNone", text(ui.copy(pendingDestChange = dest), TransitSheetControl.destChangeStatus))
        assertEquals("", text(ui.copy(pendingDestChange = dest.copy(phase = DestChangePhase.Loaded(dummyResult()))), TransitSheetControl.destChangeStatus))
        assertEquals("android.transitGuide.recoveryNoLocation", text(ui.copy(recoveryOutcome = RecoveryOutcome.noLocation), TransitSheetControl.recoveryStatus))
        assertEquals("android.transitGuide.destChangeLoading", text(ui.copy(pendingRecovery = PendingRecovery(1, 0, PendingRecovery.Phase.loading)), TransitSheetControl.recoveryStatus))
        // 폴백 키는 전부 매핑돼 있어야 한다(가드 ⑧과 같은 축).
        for (key in listOf("transitGuide.waitingLabel", "transitGuide.waitingLabelAboard", "transitGuide.aboardStationPrompt", "transitGuide.reboardStopPrompt",
            "transitGuide.reboardStationPrompt", "transitGuide.expressPrompt", "android.transitGuide.destChangeNone", "android.transitGuide.destChangeLoading",
            "android.transitGuide.destChangeError", "android.transitGuide.recoveryNoLocation", "android.transitGuide.recoveryNoRoute", "android.transitGuide.recoveryNoGuidable")) {
            assertTrue(guideStringId(key) != null, key)
        }
    }

    private fun dummyResult() = space.dodoplanet.gildongmu.kit.models.TransitRouteResult(recommended = rawRoute(), alternatives = emptyList(), totalCandidates = 1)

    @Test fun `시트 선택 — 도보가 먼저, 대중교통은 추적 중이거나 하차 인계 신호가 남았을 때`() {
        val walk = WalkGuideUiState(status = GuideStatus.tracking, destinationLabel = "길동역")
        val transit = waiting()
        assertEquals(GuideScreenKind.beacon, guideScreenKind(walk, transit), "인계 창에서 도보가 이긴다")
        assertEquals(GuideScreenKind.transit, guideScreenKind(WalkGuideUiState(), transit))
        val handoff = TransitGuideUiState(pendingWalkHandoff = TransitWalkHandoff("여의도", 5, null, null, null))
        assertEquals(GuideScreenKind.transit, guideScreenKind(WalkGuideUiState(), handoff))
        assertNull(guideScreenKind(WalkGuideUiState(), TransitGuideUiState()))
        assertNull(guideScreenKind(null, null))
    }

    private val guideUi = File("src/main/kotlin/space/dodoplanet/gildongmu/guide/ui")
    private val sheet = guideUi.resolve("TransitGuideSheet.kt").readText()

    @Test fun `시트 행 순서와 배선 — 제목, 진행 상황, 상태 문장, 최하단 안내 종료`() {
        val order = listOf("GuideTitleMenu(", "strings.get(\"guide.progressButton\")", "StatusRows(ui", "ViaStopsRows(rows)", "PhaseControls(rows)", "AlightPrepRow(rows)", "SurroundingsSection(rows", "DestChangeSection(rows", "strings.get(\"beacon.stop\")")
        val at = order.map { sheet.indexOf(it) }
        assertTrue(at.all { it >= 0 } && at == at.sorted(), "행 순서 $order → $at")
        // 종료는 대중교통 모델 종료(알림 종료와 같은 톤 재생), 제스처는 최소화.
        assertTrue(sheet.contains("onClick = { model.stop(playStopTone = true) }"))
        assertTrue(sheet.contains("ModalBottomSheet(onDismissRequest = { GuideSession.isMinimized = true }"))
        // 렌더와 착지가 같은 정본을 읽는다.
        assertTrue(sheet.contains("transitControlExists(model.ui.value, c, expressPromptActive, model.recoveryOffered)"))
        // 장소 상세는 길찾기 진입 버튼을 숨긴다.
        assertTrue(sheet.contains("nav.onOpenPlace(place, false, returnTo, stationLineHint)"))
    }

    @Test fun `5-A 표식이 남지 않는다`() {
        val left = guideUi.parentFile.walkTopDown().filter { it.extension == "kt" && it.readText().contains("// 5-" + "A:") }.map { it.name }.toList()
        assertEquals(emptyList(), left)
    }
}
