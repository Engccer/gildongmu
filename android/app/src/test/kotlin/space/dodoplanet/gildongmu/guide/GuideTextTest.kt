package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.directions.CatalogStrings
import space.dodoplanet.gildongmu.kit.CrossingRemaining
import space.dodoplanet.gildongmu.kit.GuidePhase
import space.dodoplanet.gildongmu.kit.GuideStepGeometry
import space.dodoplanet.gildongmu.kit.LiveNextRow
import space.dodoplanet.gildongmu.kit.LiveStepFields
import space.dodoplanet.gildongmu.kit.LiveTopRow
import space.dodoplanet.gildongmu.kit.OffRouteGuidance
import space.dodoplanet.gildongmu.kit.OffRouteSide
import space.dodoplanet.gildongmu.kit.RelativeDirection
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.WalkAction
import space.dodoplanet.gildongmu.kit.WalkHealthSummary
import space.dodoplanet.gildongmu.kit.buildGuideRoute
import space.dodoplanet.gildongmu.kit.initialGuideState
import space.dodoplanet.gildongmu.kit.liveStepsFrom
import space.dodoplanet.gildongmu.kit.models.FinalApproachPayload
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** iOS `GuideText.swift` walk 함수의 실문장(ko 카탈로그). 어순은 로케일 문구가 소유한다 — 여기는 조립 규칙만. */
class GuideTextTest {
    private val ko = CatalogStrings("ko")
    private val t = GuideText(ko)
    private val route = buildGuideRoute(
        listOf(
            GuideStepGeometry("천호대로를 따라 119m 이동", listOf(north(0.0), north(119.0))),
            GuideStepGeometry("횡단보도를 건너세요", listOf(north(119.0), north(131.0)), WalkAction.crosswalk),
            GuideStepGeometry("길동로를 따라 200m 이동", listOf(north(131.0), north(331.0))),
        ),
    )!!

    @Test fun `시작 원자 발화 — 목적지·개수·총 거리·첫 안내`() {
        val initial = initialGuideState(route, 0.0)
        assertEquals("길동역까지 도보 안내 시작. 천호대로를 따라 119m 이동. 안내 3개, 총 331m.", t.start(route, initial.firstIndices, "길동역"))
    }

    @Test fun `주기 통지 — 횡단 스텝은 원문, target 유무, 마지막 스텝은 목적지 틀`() {
        assertEquals("횡단보도를 건너세요", t.periodicWalk(route, 1, 8, 5.0, "길동역", "어디"))
        assertEquals("길동역까지 약 60m 직진하세요", t.periodicWalk(route, 0, 60, 15.0, "길동역", "길동역"))
        assertEquals("60m쯤 직진하세요", t.periodicWalk(route, 0, 60, 30.0, "길동역", null))
        assertEquals("길동역까지 50m", t.periodicWalk(route, 2, 50, 5.0, "길동역", null))
    }

    @Test fun `임박 명령·행동구`() {
        assertEquals("잠시 후 왼쪽으로 도세요", t.imminentText(WalkAction.left))
        assertEquals("잠시 후 횡단보도를 건너세요", t.imminentText(WalkAction.crosswalk))
        assertEquals("오른쪽으로 도세요", t.liveActionPhrase(WalkAction.right))
    }

    @Test fun `최종 접근 진입 서술 — 방향 유·무, 헤지는 정확도가 좋아도 붙는다`() {
        val withDir = FinalApproachPayload(offsetMeters = 12.0, relativeBearing = 80.0, bearingUnavailable = null)
        assertEquals("경로가 끝납니다. 오른쪽으로 약 12m 가면 길동역입니다.", t.finalApproachEnter("길동역", withDir, 5.0))
        val noDir = FinalApproachPayload(offsetMeters = 40.0, relativeBearing = null, bearingUnavailable = "degenerateGeometry")
        assertEquals("경로가 끝납니다. 길동역까지 40m쯤입니다.", t.finalApproachEnter("길동역", noDir, 25.0))
    }

    @Test fun `최종 접근 주기 — 15m 이하는 근처, 그 위는 방향 어절 이동형`() {
        assertEquals("목적지 근처입니다. 왼쪽입니다.", t.finalApproachTick(12.0, RelativeDirection.left, 5.0))
        assertEquals("목적지 근처입니다.", t.finalApproachTick(12.0, null, 5.0))
        assertEquals("왼쪽으로 약 30m입니다.", t.finalApproachTick(30.0, RelativeDirection.left, 10.0))
        assertEquals("30m쯤입니다.", t.finalApproachTick(30.0, null, 40.0))
    }

    @Test fun `진행 상황 — following 서수·현재·다음, offRoute 직선, finalApproach 직선, uncertain 마지막 안내`() {
        val s = initialGuideState(route, 0.0).state
        assertEquals("안내 3개 중 1번째 구간. 남은 거리 331m, 약 5분. 현재 안내, 천호대로를 따라 119m 이동. 다음 안내, 횡단보도를 건너세요", t.progress(route, s, "길동역", null, null, 5, null))
        assertEquals("경로 이탈 상태. 목적지까지 직선거리 120m", t.progress(route, s.copy(phase = GuidePhase.offRoute), "길동역", null, 120.0, null, null))
        assertEquals("경로에서 벗어난 것 같습니다", t.progress(route, s.copy(phase = GuidePhase.offRoute), "길동역", null, null, null, null))
        assertEquals("목적지까지 직선거리 40m", t.progress(route, s.copy(phase = GuidePhase.finalApproach), "길동역", null, 40.0, null, null))
        assertEquals("위치 확신이 낮습니다. 마지막 안내, 천호대로를 따라 119m 이동", t.progress(route, s.copy(phase = GuidePhase.uncertain), "길동역", "천호대로를 따라 119m 이동", null, null, null))
        assertEquals("위치 확신이 낮습니다. 마지막 안내, 아직 안내가 없습니다", t.progress(route, s.copy(phase = GuidePhase.reacquiring), "길동역", null, null, null, null))
    }

    @Test fun `하단 2행 렌더 — GuideLiveRowsTest 규칙과 같은 문장`() {
        assertEquals("길동역까지 120m 직진하세요", t.liveTop(LiveTopRow.Straight(120, "길동역")))
        assertEquals("120m 직진하세요", t.liveTop(LiveTopRow.Straight(120, null)))
        assertEquals("8m 후 왼쪽으로 도세요", t.liveTop(LiveTopRow.TurnIn(8, WalkAction.left)))
        assertEquals("잠시 후 오른쪽으로 도세요", t.liveTop(LiveTopRow.TurnSoon(WalkAction.right)))
        assertEquals("횡단보도를 건너세요", t.liveTop(LiveTopRow.Crossing("횡단보도를 건너세요")))
        assertEquals("경로에서 벗어난 것 같습니다", t.liveTop(LiveTopRow.OffRoute))
        assertEquals("다음 안내, 은행 앞에서 왼쪽으로 도세요", t.liveNext(LiveNextRow.Action(WalkAction.left, "은행")))
        assertEquals("다음 안내, 왼쪽으로 도세요", t.liveNext(LiveNextRow.Action(WalkAction.left, null)))
        assertEquals("다음 안내, 길동역까지 50m 직진", t.liveNext(LiveNextRow.Straight(50, "길동역")))
        assertEquals("다음 안내, 50m 직진", t.liveNext(LiveNextRow.Straight(50, null)))
        assertEquals("다음 안내, 횡단보도를 건너세요", t.liveNext(LiveNextRow.Crossing(WalkAction.crosswalk)))
        assertEquals("다음 안내, 뒤로 도세요", t.liveNext(LiveNextRow.Turn(WalkAction.back)))
    }

    @Test fun `확신도 사다리`() {
        assertEquals("16m", t.confidenceDistance(16.0, 8.0))
        assertEquals("약 16m", t.confidenceDistance(16.0, 15.0))
        assertEquals("16m쯤", t.confidenceDistance(16.0, 30.0))
        assertEquals("250m", t.confidenceDistance(250.0, 60.0))
        assertEquals("약 8m", t.approachDistance(8.0, 3.0))
    }

    @Test fun `종료 화면 걸음 문장 — 기본 체중 기준 병기 + 음식 비유, 비유 없으면 요약만`() {
        // 권유가 숨겨졌으면(E31 무시 2회) 기준 체중이 문장 안으로, 떠 있으면 고지 줄이 말하므로 종전 문장(두 벌 키).
        assertEquals("이번 구간에서 1200걸음 걸으셨어요. 65kg 기준으로 약 27kcal를 태우셨어요. 귤 한 개 분량이에요!", t.healthLine(WalkHealthSummary(1200, 27, usedDefaultWeight = true), showsWeightPrompt = false))
        assertEquals("이번 구간에서 1200걸음 걸으셨어요. 약 27kcal를 태우셨어요. 귤 한 개 분량이에요!", t.healthLine(WalkHealthSummary(1200, 27, usedDefaultWeight = true), showsWeightPrompt = true))
        assertEquals("이번 구간에서 100걸음 걸으셨어요. 약 1kcal를 태우셨어요.", t.healthLine(WalkHealthSummary(100, 1, usedDefaultWeight = false), showsWeightPrompt = false))
        assertEquals("라면 약 3그릇 분량이에요!", t.foodLine(1500))
    }

    @Suppress("unused")
    private val p0: RoutePoint = north(0.0)
    /** 첫 스텝에 방향 구절을 뗀 문장(`parts.body`)이 있는 표시 입력(E62). */
    private val bodied = liveStepsFrom(route, listOf(LiveStepFields(null, null, false, body = "천호대로를 따라 119m 이동B"), LiveStepFields(null, null, true, crossingClock = 9), LiveStepFields(null, null, false)))

    @Test fun `되읽기는 들어선 첫 스텝의 회전 문장을 뗀다 — 뒤 스텝은 원문, body 없으면 원문(E62)`() {
        assertEquals("천호대로를 따라 119m 이동B", t.rereadUnit(route, listOf(0), bodied))
        assertEquals("다음 안내. 천호대로를 따라 119m 이동B. 횡단보도를 건너세요", t.rereadUnit(route, listOf(0, 1), bodied))
        assertEquals("횡단보도를 건너세요", t.rereadUnit(route, listOf(1), bodied))
    }

    @Test fun `전문 거리 머리말 — 묶음이면 다음 안내 서두 뒤 첫 문장에, 1m 미만은 원문(E62 a11y M3)`() {
        assertEquals("앞으로 약 25m 가다가 횡단보도를 건너세요", t.announceAhead(route, listOf(1), 25.0))
        assertEquals("다음 안내. 앞으로 약 25m 가다가 횡단보도를 건너세요. 길동로를 따라 200m 이동", t.announceAhead(route, listOf(1, 2), 25.0))
        assertEquals("횡단보도를 건너세요", t.announceAhead(route, listOf(1), 0.4))
    }

    @Test fun `임박 횡단 방향 — 12시·6시 낱말, 그 밖은 시계, 방향 모름·비횡단은 종전(E62)`() {
        assertEquals("잠시 후 진행 방향 그대로 횡단보도를 건너세요", t.imminentText(WalkAction.crosswalk, 12))
        assertEquals("잠시 후 뒤로 돌아 횡단보도를 건너세요", t.imminentText(WalkAction.crosswalk, 6))
        assertEquals("잠시 후 9시 방향으로 돌아 횡단보도를 건너세요", t.imminentText(WalkAction.crosswalk, 9))
        assertEquals("잠시 후 횡단보도를 건너세요", t.imminentText(WalkAction.crosswalk, null))
        assertEquals("잠시 후 왼쪽으로 도세요", t.imminentText(WalkAction.left, 9))
    }

    @Test fun `횡단 중 남은 거리 행 — 횡단보도와 지하보도(E62 판정 4)`() {
        assertEquals("횡단보도 끝까지 약 30m", t.crossingRemaining(CrossingRemaining(30, WalkAction.crosswalk)))
        assertEquals("지하보도 끝까지 약 10m", t.crossingRemaining(CrossingRemaining(10, WalkAction.underpass)))
    }

    @Test fun `이탈 문장 — 벗어난 쪽 + 돌아갈 시계, 6시는 뒤로, 보류는 무발화(E63)`() {
        assertEquals("경로에서 오른쪽으로 벗어났습니다. 8시 방향으로 돌아가세요", t.offRoute(OffRouteGuidance.turn, OffRouteSide.right, 240.0))
        assertEquals("경로에서 오른쪽으로 벗어났습니다. 뒤로 도세요", t.offRoute(OffRouteGuidance.turn, OffRouteSide.right, 180.0))
        assertEquals("경로와 반대 방향입니다. 뒤로 도세요", t.offRoute(OffRouteGuidance.opposite, OffRouteSide.left, null))
        assertEquals("경로에서 왼쪽으로 벗어났습니다", t.offRoute(OffRouteGuidance.sideOnly, OffRouteSide.left, null))
        assertEquals("경로에서 벗어난 것 같습니다", t.offRoute(OffRouteGuidance.turn, null, 90.0))
        assertNull(t.offRoute(OffRouteGuidance.hold, OffRouteSide.right, 300.0))
        assertEquals("경로에서 벗어난 것 같습니다", t.offRouteSide(null))
    }

    @Test fun `자동 재조회 채택 — 할 일 먼저, 머리말이 있으면 첫 스텝은 body(E63 문안 라·J1)`() {
        val first = listOf(0)
        assertEquals("새 경로로 다시 안내합니다. 2시 방향으로 도세요. 그 후 천호대로를 따라 119m 이동B. 안내 3개, 총 331m.", t.autoReroute(route, first, bodied, 2, english = false).spoken)
        assertEquals("새 경로로 다시 안내합니다. 진행 방향 그대로 천호대로를 따라 119m 이동B. 안내 3개, 총 331m.", t.autoReroute(route, first, bodied, 12, english = false).spoken)
        assertEquals("새 경로로 다시 안내합니다. 뒤로 도세요. 그 후 천호대로를 따라 119m 이동B. 안내 3개, 총 331m.", t.autoReroute(route, first, bodied, 6, english = false).spoken)
        assertEquals("새 경로로 다시 안내합니다. 천호대로를 따라 119m 이동. 안내 3개, 총 331m.", t.autoReroute(route, first, bodied, null, english = false).spoken)
    }

    @Test fun `자동 재조회 채택 — 상태 행은 머리말을 뺀 문장(A57)`() {
        val first = listOf(0)
        // 머리말이 있으면 첫 스텝은 이미 body — 상태 행은 되읽기 유닛과 같다.
        for (clock in listOf(2, 12, 6)) {
            assertEquals("새 경로로 다시 안내합니다. 천호대로를 따라 119m 이동B. 안내 3개, 총 331m.", t.autoReroute(route, first, bodied, clock, english = false).statusLine)
        }
        assertEquals(
            "새 경로로 다시 안내합니다. 다음 안내. 천호대로를 따라 119m 이동B. 횡단보도를 건너세요. 안내 3개, 총 331m.",
            t.autoReroute(route, listOf(0, 1), bodied, 2, english = false).statusLine,
        )
        // 머리말이 없으면 음성과 같다.
        val plain = t.autoReroute(route, first, bodied, null, english = false)
        assertEquals(plain.spoken, plain.statusLine)
    }

    @Test fun `자동 재조회 채택 — 조각 없는 첫 스텝이 자기 방향을 말하면 머리말 없음(A58)`() {
        val en = GuideText(CatalogStrings("en"))
        val turnFirst = buildGuideRoute(
            listOf(
                GuideStepGeometry("Turn left, then walk 119m", listOf(north(0.0), north(119.0)), WalkAction.left),
                GuideStepGeometry("Walk 212m", listOf(north(119.0), north(331.0))),
            ),
        )!!
        val noBody = liveStepsFrom(turnFirst, listOf(LiveStepFields(null, null, false), LiveStepFields(null, null, false)))
        val turned = en.autoReroute(turnFirst, listOf(0), noBody, 2, english = true)
        assertEquals("Now guiding on a new route. Turn left, then walk 119m. 2 instructions, 331m total.", turned.spoken)
        assertEquals(turned.spoken, turned.statusLine)
        // 조각 없는 직진 첫 스텝에는 머리말을 붙인다.
        assertEquals(
            "Now guiding on a new route. Turn to 2 o'clock. Then Walk 212m. 2 instructions, 331m total.",
            en.autoReroute(turnFirst, listOf(1), noBody, 2, english = true).spoken,
        )
        // en 횡단(조각 없이 방향을 박을 수 있다)은 머리말 없음, ko 조각 없는 횡단(판본 2는 방향 구절이 없다)은 머리말.
        val crossFirst = buildGuideRoute(
            listOf(GuideStepGeometry("횡단보도를 건너세요", listOf(north(0.0), north(12.0)), WalkAction.crosswalk)),
        )!!
        val crossLive = liveStepsFrom(crossFirst, listOf(LiveStepFields(null, null, true)))
        assertEquals("새 경로로 다시 안내합니다. 2시 방향으로 도세요. 그 후 횡단보도를 건너세요. 안내 1개, 총 12m.", t.autoReroute(crossFirst, listOf(0), crossLive, 2, english = false).spoken)
        assertEquals("새 경로로 다시 안내합니다. 횡단보도를 건너세요. 안내 1개, 총 12m.", t.autoReroute(crossFirst, listOf(0), crossLive, 2, english = true).spoken)
    }

    @Test fun `진행 상황 현재 안내는 body(E62 a11y M2)`() {
        val s = initialGuideState(route, 0.0).state
        assertEquals("안내 3개 중 1번째 구간. 남은 거리 331m. 현재 안내, 천호대로를 따라 119m 이동B. 다음 안내, 횡단보도를 건너세요", t.progress(route, s, "길동역", null, null, null, "천호대로를 따라 119m 이동B"))
    }
}
