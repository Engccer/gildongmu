package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.directions.CatalogStrings
import space.dodoplanet.gildongmu.kit.GuidePhase
import space.dodoplanet.gildongmu.kit.GuideStepGeometry
import space.dodoplanet.gildongmu.kit.LiveNextRow
import space.dodoplanet.gildongmu.kit.LiveTopRow
import space.dodoplanet.gildongmu.kit.RelativeDirection
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.WalkAction
import space.dodoplanet.gildongmu.kit.WalkHealthSummary
import space.dodoplanet.gildongmu.kit.buildGuideRoute
import space.dodoplanet.gildongmu.kit.initialGuideState
import space.dodoplanet.gildongmu.kit.models.FinalApproachPayload
import kotlin.test.Test
import kotlin.test.assertEquals

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
        assertEquals("길동역까지 도보 안내 시작. 안내 3개, 총 331m. 천호대로를 따라 119m 이동", t.start(route, initial.firstIndices, "길동역"))
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
        assertEquals("안내 3개 중 1번째 구간. 남은 거리 331m, 약 5분. 현재 안내, 천호대로를 따라 119m 이동. 다음 안내, 횡단보도를 건너세요", t.progress(route, s, "길동역", null, null, 5))
        assertEquals("경로 이탈 상태. 목적지까지 직선거리 120m", t.progress(route, s.copy(phase = GuidePhase.offRoute), "길동역", null, 120.0, null))
        assertEquals("경로에서 벗어난 것 같습니다", t.progress(route, s.copy(phase = GuidePhase.offRoute), "길동역", null, null, null))
        assertEquals("목적지까지 직선거리 40m", t.progress(route, s.copy(phase = GuidePhase.finalApproach), "길동역", null, 40.0, null))
        assertEquals("위치 확신이 낮습니다. 마지막 안내, 천호대로를 따라 119m 이동", t.progress(route, s.copy(phase = GuidePhase.uncertain), "길동역", "천호대로를 따라 119m 이동", null, null))
        assertEquals("위치 확신이 낮습니다. 마지막 안내, 아직 안내가 없습니다", t.progress(route, s.copy(phase = GuidePhase.reacquiring), "길동역", null, null, null))
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
        assertEquals("이번 구간에서 1200걸음 걸으셨어요. 65kg 기준으로 약 27kcal를 태우셨어요. 귤 한 개 분량이에요!", t.healthLine(WalkHealthSummary(1200, 27, usedDefaultWeight = true)))
        assertEquals("이번 구간에서 100걸음 걸으셨어요. 약 1kcal를 태우셨어요.", t.healthLine(WalkHealthSummary(100, 1, usedDefaultWeight = false)))
        assertEquals("라면 약 3그릇 분량이에요!", t.foodLine(1500))
    }

    @Suppress("unused")
    private val p0: RoutePoint = north(0.0)
}
