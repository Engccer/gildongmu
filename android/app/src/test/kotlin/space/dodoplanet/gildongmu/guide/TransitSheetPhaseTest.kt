package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.directions.CatalogStrings
import space.dodoplanet.gildongmu.guide.ui.TRANSIT_CANDIDATE_TAG_PREFIX
import space.dodoplanet.gildongmu.guide.ui.TransitCandidateRow
import space.dodoplanet.gildongmu.guide.ui.TransitPhaseControls
import space.dodoplanet.gildongmu.guide.ui.transitAdvanceLabelKey
import space.dodoplanet.gildongmu.guide.ui.transitAlightPrepText
import space.dodoplanet.gildongmu.guide.ui.transitBoardSelectedKey
import space.dodoplanet.gildongmu.guide.ui.transitCandidateRow
import space.dodoplanet.gildongmu.guide.ui.transitCandidateRowId
import space.dodoplanet.gildongmu.guide.ui.transitCandidateTag
import space.dodoplanet.gildongmu.guide.ui.transitHandoffNow
import space.dodoplanet.gildongmu.guide.ui.transitJourneyHandoff
import space.dodoplanet.gildongmu.guide.ui.transitLostCandidateId
import space.dodoplanet.gildongmu.guide.ui.transitPhaseControls
import space.dodoplanet.gildongmu.guide.ui.transitQuickExitLine
import space.dodoplanet.gildongmu.guide.ui.transitReboardAsksStop
import space.dodoplanet.gildongmu.guide.ui.transitReboardCancelKey
import space.dodoplanet.gildongmu.guide.ui.transitReboardPromptKey
import space.dodoplanet.gildongmu.guide.ui.transitUntrackableButtonKey
import space.dodoplanet.gildongmu.guide.ui.transitVehicleDescLabel
import space.dodoplanet.gildongmu.guide.ui.transitViaCallLabelKey
import space.dodoplanet.gildongmu.guide.ui.transitViaCount
import space.dodoplanet.gildongmu.guide.ui.transitViaRowText
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.TransitBoardingCandidate
import space.dodoplanet.gildongmu.kit.TransitLock
import space.dodoplanet.gildongmu.kit.TransitPhase
import space.dodoplanet.gildongmu.kit.TransitSignal
import space.dodoplanet.gildongmu.kit.TransitTrackItem
import space.dodoplanet.gildongmu.kit.TransitTrackMode
import space.dodoplanet.gildongmu.kit.buildTransitGuideRoute
import space.dodoplanet.gildongmu.kit.initTransitGuide
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.TransitRoute
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import space.dodoplanet.gildongmu.kit.transitDisplayItem
import space.dodoplanet.gildongmu.kit.transitDisplayLeg
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 대중교통 시트 5-B(경유역·국면 컨트롤) — 국면별 버튼 집합·라벨 키·후보 줄·하차 준비 줄은 순수 함수로, 행 순서·표식·단계 6 경계는 소스 가드로.
 * (Compose UI 테스트 레인은 이 저장소에 없다 — `GuideInfoBandTest`·`GuideHereButtonsTest`가 같은 방식이다.)
 */
class TransitSheetPhaseTest {
    private val strings = CatalogStrings("ko")
    private val renderer = TransitGuideTextRenderer(strings) { false }

    private fun rawRoute() = TransitRoute(
        summary = TransitRouteSummary(totalMinutes = 30, fare = 1500, transfers = 0, walkMinutes = 8, departName = "천호", arriveName = "여의도"),
        legs = listOf(
            TransitRouteLeg(mode = "walk", minutes = 3),
            TransitRouteLeg(mode = "subway", lineName = "수도권 5호선", fromName = "천호", toName = "여의도", stationCount = 8, minutes = 20, serviceWayCode = 2),
            TransitRouteLeg(mode = "walk", minutes = 5),
        ),
        routeKey = "p0",
    )

    private fun waiting(): TransitGuideUiState {
        val r = buildTransitGuideRoute(rawRoute())!!
        return TransitGuideUiState(state = initTransitGuide(r, 0.0), route = r, destinationLabel = "여의도", dest = BeaconDest(37.52, 126.92))
    }

    private fun TransitGuideUiState.inPhase(phase: TransitPhase) = copy(state = state!!.copy(phase = phase))

    private fun TransitGuideUiState.withTrackMode(mode: TransitTrackMode) = copy(route = route!!.copy(legs = route!!.legs.map { it.copy(trackMode = mode) }))

    @Test fun `국면별 버튼 집합 — 대기 · 승차 대기 · 승차 · 도착 · 추적 불가`() {
        val ui = waiting()
        assertNull(transitPhaseControls(TransitGuideUiState()))
        assertEquals(TransitPhaseControls.Waiting, transitPhaseControls(ui))
        // 승차 대기: 선언 버튼은 래치가 선 뒤에만, 「다른 차량 선택」은 늘 선다.
        assertEquals(TransitPhaseControls.Boarding(boardSelectedOffered = false), transitPhaseControls(ui.inPhase(TransitPhase.boarding)))
        assertEquals(TransitPhaseControls.Boarding(boardSelectedOffered = true), transitPhaseControls(ui.inPhase(TransitPhase.boarding).copy(boardingManualAvailable = true)))
        // 승차 중(관측 잠금): 다음 구간 없음(근사 잠금이 아니다), 탑승 변경만.
        val riding = ui.inPhase(TransitPhase.riding).withTrackMode(TransitTrackMode.subway)
        assertEquals(TransitPhaseControls.Active(advance = false, changeBoarding = true), transitPhaseControls(riding))
        // 근사 잠금(vehicleId 빔)이면 승차 중에도 다음 구간이 상시.
        val approx = riding.copy(state = riding.state!!.copy(lock = TransitLock(TransitTrackMode.subway, "5", "", "")))
        assertEquals(TransitPhaseControls.Active(advance = true, changeBoarding = true), transitPhaseControls(approx))
        // 지방버스 승차 중은 탑승 변경 자리가 없다.
        assertEquals(TransitPhaseControls.Active(advance = false, changeBoarding = false), transitPhaseControls(riding.withTrackMode(TransitTrackMode.tagoBus)))
        // 도착: 다음 구간, 탑승 변경 없음.
        assertEquals(TransitPhaseControls.Active(advance = true, changeBoarding = false), transitPhaseControls(ui.inPhase(TransitPhase.arrived)))
        // 추적 불가가 국면보다 앞이다.
        assertEquals(TransitPhaseControls.Untrackable, transitPhaseControls(ui.copy(state = ui.state!!.copy(signal = TransitSignal.untrackable))))
    }

    @Test fun `하차 인계 판정과 advance 자리 라벨 키`() {
        // 일반 경로: 마지막 leg ∧ 말미 도보 ∧ 인계 가능.
        assertTrue(transitHandoffNow(journeyNextIsWalk = null, isOnFinalLeg = true, finalLegWalkMinutes = 5, walkHandoffAvailable = true))
        assertFalse(transitHandoffNow(null, true, null, true), "말미 도보가 없으면 인계가 아니다")
        assertFalse(transitHandoffNow(null, true, 5, walkHandoffAvailable = false))
        // 여정은 마지막 leg면 말미 도보 분이 없어도 선다.
        assertTrue(transitHandoffNow(journeyNextIsWalk = false, isOnFinalLeg = true, finalLegWalkMinutes = null, walkHandoffAvailable = false))
        assertFalse(transitHandoffNow(journeyNextIsWalk = true, isOnFinalLeg = false, finalLegWalkMinutes = 5, walkHandoffAvailable = true))
        assertTrue(transitJourneyHandoff(handoffNow = true, journeyNextIsWalk = true))
        assertFalse(transitJourneyHandoff(handoffNow = true, journeyNextIsWalk = null))
        assertFalse(transitJourneyHandoff(handoffNow = false, journeyNextIsWalk = true))
        // 라벨: 여정이면 항상 「다음 구간」, 일반 인계면 「남은 도보 안내 시작」.
        assertEquals("transitGuide.advance", transitAdvanceLabelKey(journeyHandoff = true, handoffNow = true))
        assertEquals("transitGuide.advance", transitAdvanceLabelKey(journeyHandoff = false, handoffNow = false))
        assertEquals("transitGuide.walkHandoffStart", transitAdvanceLabelKey(journeyHandoff = false, handoffNow = true))
        assertEquals("transitGuide.advance", transitUntrackableButtonKey(journeyHandoff = true, handoffNow = true))
        assertEquals("transitGuide.walkHandoffStart", transitUntrackableButtonKey(journeyHandoff = false, handoffNow = true))
        assertEquals("transitGuide.advanceUntrackable", transitUntrackableButtonKey(journeyHandoff = false, handoffNow = false))
    }

    @Test fun `역 선택 질문·취소 키 — 서울버스는 정류장, 이미 탑승 pickStation은 지나는 역`() {
        val ui = waiting()
        assertEquals("transitGuide.reboardStationPrompt", transitReboardPromptKey(ui))
        assertEquals("transitGuide.reboardCancel", transitReboardCancelKey(ui))
        val bus = ui.withTrackMode(TransitTrackMode.seoulBus)
        assertTrue(transitReboardAsksStop(bus))
        assertEquals("transitGuide.reboardStopPrompt", transitReboardPromptKey(bus))
        assertEquals("transitGuide.reboardStopCancel", transitReboardCancelKey(bus))
        // 「이미 탑승」 pickStation은 수단과 무관하게 지나는 역을 묻고 취소 문구도 역 쪽이다.
        val aboard = bus.copy(aboardStep = TransitAboardStep.pickStation)
        assertFalse(transitReboardAsksStop(aboard))
        assertEquals("transitGuide.aboardStationPrompt", transitReboardPromptKey(aboard))
        assertEquals("transitGuide.reboardCancel", transitReboardCancelKey(aboard))
        assertEquals("transitGuide.boardSelected", transitBoardSelectedKey(ui.route!!.legs[0].copy(mode = "subway")))
        assertEquals("transitGuide.boardSelectedBus", transitBoardSelectedKey(ui.route!!.legs[0].copy(mode = "bus")))
    }

    @Test fun `경유역 줄 문장 — 승차 · 현재역 · 하차(출구) 조립과 개수는 이동 역 수`() {
        val ui = waiting()
        val leg = ui.route!!.legs[0]
        val stop = { name: String -> space.dodoplanet.gildongmu.kit.models.TransitLegStop(name = name, lat = 37.5, lng = 127.1) }
        val l = leg.copy(viaStops = listOf(stop("천호"), stop("강동"), stop("여의도")), exitAlight = "4")
        val display = transitDisplayLeg(l, boardOverrideIndex = null)
        assertEquals(2, transitViaCount(l))
        assertEquals(joinText("천호", strings.get("transitGuide.viaBoard")), transitViaRowText(renderer, false, display, 0, hereIndex = null))
        assertEquals(joinText(strings.get("transitGuide.viaCurrent"), "강동"), transitViaRowText(renderer, false, display, 1, hereIndex = 1))
        val alight = transitViaRowText(renderer, false, display, 2, hereIndex = null)
        assertEquals(joinText("여의도", strings.get("transitGuide.viaAlight"), strings.get("transitGuide.exitBound", "4")), alight)
        assertEquals(0, transitViaCount(l.copy(viaStops = emptyList())))
        // 전화 라벨은 상태로만 갈리고 액션은 늘 하나다.
        assertEquals("android.place.call", transitViaCallLabelKey(representative = false))
        assertEquals("android.place.callRepresentative", transitViaCallLabelKey(representative = true))
    }

    private fun item(id: String?) = TransitTrackItem(vehicleId = id, direction = "상일동행", message = "5분 후 도착", remainingStops = 3, destinationName = null, express = false, arrivalCode = null)

    @Test fun `후보 행 — 식별자 없는 슬롯은 선택 불가 줄, 있으면 버튼 · 정체성은 식별자 또는 슬롯 위치`() {
        val ui = waiting()
        val leg = ui.route!!.legs[0]
        val display = transitDisplayLeg(leg, null)
        fun cand(i: TransitTrackItem) = TransitBoardingCandidate(item = i, unreachable = null, express = null, directionMatched = true)
        val selectable = transitCandidateRow(renderer, false, cand(item("1234")), leg, display, departedMinutes = null)
        assertTrue(selectable is TransitCandidateRow.Selectable && selectable.desc.isNotEmpty(), selectable.toString())
        val slot = transitCandidateRow(renderer, false, cand(item(null)), leg, display, departedMinutes = null)
        assertTrue(slot is TransitCandidateRow.Unselectable, slot.toString())
        assertTrue(transitCandidateRow(renderer, false, cand(item("")), leg, display, null) is TransitCandidateRow.Unselectable, "빈 문자열도 식별자 없음")
        assertEquals("1234", transitCandidateRowId(cand(item("1234")), 0))
        assertEquals("slot-2", transitCandidateRowId(cand(item(null)), 2))
        assertEquals("slot-0", transitCandidateRowId(cand(item("")), 0))
        // 떠난 열차는 경과 분이 줄에 실린다(같은 열차를 두 줄로 두지 않는다 — 폴 줄과 같은 조립).
        val departed = transitCandidateRow(renderer, false, cand(item("1234")), leg, display, departedMinutes = 2) as TransitCandidateRow.Selectable
        assertTrue(departed.desc != selectable.desc, "경과 분 조각이 desc에 더해진다")
    }

    @Test fun `선택 차량 설명은 ko·en 쌍이고 비면 null`() {
        val withDest = transitDisplayItem(item("1").copy(destinationName = "상일동"))
        val label = transitVehicleDescLabel(strings, withDest)
        assertNotNull(label)
        assertTrue(label.ko.contains("상일동"), label.ko)
        // 서울버스: 행선·방향이 둘 다 없으면 설명이 비어 빈 슬롯을 만들지 않는다.
        val empty = transitDisplayItem(item("1").copy(direction = "", destinationName = null))
        assertNull(transitVehicleDescLabel(strings, empty))
    }

    @Test fun `목록 포커스 소실 판정 — 커서가 후보 행에서 사라졌을 때만`() {
        val tag = transitCandidateTag("1234")
        assertTrue(tag.startsWith(TRANSIT_CANDIDATE_TAG_PREFIX))
        assertEquals("1234", transitLostCandidateId(tag, listOf("slot-0")))
        assertNull(transitLostCandidateId(tag, listOf("1234", "slot-0")))
        assertNull(transitLostCandidateId("transit-refresh", listOf("slot-0")), "목록 밖 커서는 강탈하지 않는다")
        assertNull(transitLostCandidateId(null, emptyList()))
    }

    @Test fun `하차 준비 줄 — 승차 대기·승차 중에만, 문도 출구도 없으면 줄이 없다`() {
        val ui = waiting().copy(route = waiting().route!!.let { r -> r.copy(legs = r.legs.map { it.copy(exitAlight = "4") }) })
        fun text(u: TransitGuideUiState) = transitAlightPrepText(u, transitDisplayLeg(u.route!!.legs[0], null), isEn = false, lang = "ko", strings = strings)
        assertNull(text(ui), "대기 국면은 열차 목록 앞 빠른 하차 줄이 있다")
        assertNull(text(ui.inPhase(TransitPhase.arrived)), "도착 국면은 통지가 출구를 말한다")
        val boarding = text(ui.inPhase(TransitPhase.boarding))
        assertNotNull(boarding)
        assertTrue(boarding.contains(strings.get("transitGuide.exitBound", "4")), boarding)
        assertEquals(boarding, text(ui.inPhase(TransitPhase.riding)))
        val none = ui.copy(route = ui.route!!.copy(legs = ui.route!!.legs.map { it.copy(exitAlight = null) }))
        assertNull(text(none.inPhase(TransitPhase.riding)))
        assertNull(transitQuickExitLine(none.route!!.legs[0], transitDisplayLeg(none.route!!.legs[0], null), isEn = false, lang = "ko"))
    }

    private val guideUi = File("src/main/kotlin/space/dodoplanet/gildongmu/guide/ui")
    private val sheet = guideUi.resolve("TransitGuideSheet.kt").readText()
    private val rows = guideUi.resolve("TransitSheetRows.kt").readText()

    @Test fun `행 순서 — 상태 문장 다음 경유역, 국면 컨트롤, 하차 준비 줄, 최하단 안내 종료`() {
        val order = listOf("StatusRows(ui", "ViaStopsRows(rows)", "PhaseControls(rows)", "AlightPrepRow(rows)", "strings.get(\"beacon.stop\")")
        val at = order.map { sheet.indexOf(it) }
        assertTrue(at.all { it >= 0 } && at == at.sorted(), "행 순서 $order → $at")
        // 경유역 상세는 노선 힌트를 싣는다(E44) — 도보·자동차 호출부는 null을 명시한다.
        assertTrue(sheet.contains("openPlace(transitStopPlace(stop), returnTo, lineName)"))
        assertTrue(sheet.contains("nav.onOpenPlace(place, false, returnTo, stationLineHint)"))
    }

    @Test fun `국면 버튼 표식과 단계 경계 — 세 버튼 testTag, 인계는 모델 전이 뒤 단계 6 표식`() {
        for (button in listOf("boardSelected", "reselect", "advance")) assertTrue(rows.contains("TransitPhaseButton.$button.tag"), button)
        assertTrue(rows.contains("c.model.advanceIntoWalkHandoff()"))
        assertEquals(2, Regex("// 단계 6: GuideSession.acceptWalkHandoff").findAll(rows).count(), "다음 구간 인계와 복구 걷기, 두 자리")
        assertTrue(rows.contains("RecoveryControls(c, leg)"))
        // 질문 화면 컨트롤은 렌더 조건(`exists`)을 지나고 착지 부착은 transitLandingRow 한 자리다 — focusRequester 직접 부착 없음.
        for (control in listOf("waitingLabel", "expressPrompt", "expressBlocked", "reboardPrompt")) {
            assertTrue(Regex("""c\.exists\(TransitSheetControl\.$control\)""").containsMatchIn(rows), control)
            assertTrue(rows.contains("transitLandingRow(c.targets, TransitSheetControl.$control)"), control)
        }
        assertFalse(rows.contains("requestFocus("))
        assertFalse(rows.contains("focusRequester("))
        // 한 줄 = 한 객체: 낭독 이름 덮어쓰기·거리 풀어쓰기 없음, 시트에 live region 없음.
        assertFalse(rows.contains("spoken ="))
        assertFalse(rows.contains("liveRegion"))
        assertFalse(rows.contains("enabled = false"))
    }

    @Test fun `5-B 표식이 남지 않는다`() {
        val left = guideUi.parentFile.walkTopDown().filter { it.extension == "kt" && it.readText().contains("// 5-" + "B:") }.map { it.name }.toList()
        assertEquals(emptyList(), left)
    }
}
