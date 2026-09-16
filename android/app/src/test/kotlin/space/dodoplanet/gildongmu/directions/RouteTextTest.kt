package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.WalkCollapse
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.CarRouteGuide
import space.dodoplanet.gildongmu.kit.models.RouteWaypoint
import space.dodoplanet.gildongmu.kit.models.TransitRouteEnvelope
import space.dodoplanet.gildongmu.kit.models.WalkRouteBriefing
import space.dodoplanet.gildongmu.kit.models.WalkRouteEnvelope
import space.dodoplanet.gildongmu.kit.models.WalkRouteStep
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/** spec §3-4 요약·스텝 문장(iOS `RouteBriefing.swift` 대응). */
class RouteTextTest {
    private val ko = CatalogStrings("ko")
    private val transit = Fixtures.kitJson("route-transit.json", TransitRouteEnvelope.serializer()).result!!
    private val walk = Fixtures.kitJson("route-walk.json", WalkRouteEnvelope.serializer()).result!!
    private val car = Fixtures.kitJson("route-car.json", CarRouteBriefing.serializer())

    @Test fun `대중교통 요약 - 도보 0분은 생략`() {
        assertEquals("약 34분, 요금 1,650원, 환승 2회, 도보 9분", transitSummaryText(transit.recommended.summary, "ko", ko))
        assertEquals("약 34분, 요금 1,650원, 환승 2회", transitSummaryText(transit.recommended.summary.copy(walkMinutes = 0), "ko", ko))
    }

    @Test fun `도보 요약과 접힘 판정은 같은 반올림 분을 쓴다`() {
        assertEquals(30, walkDisplayMinutes(walk)) // 1806초 → 30
        assertEquals("총 2.078km, 약 30분", walkSummaryText(walk, ko))
        assertFalse(WalkCollapse.shouldCollapse(walk.durationSeconds)) // 30분은 접지 않는다 — 표시 "약 30분"과 일치
        val boundary = walk.copy(durationSeconds = 1830) // 30.5 → 31: 표시도 31, 판정도 접힘
        assertEquals(31, walkDisplayMinutes(boundary))
        assertEquals(true, WalkCollapse.shouldCollapse(boundary.durationSeconds))
    }

    @Test fun `자동차 요약 - 통행료 0원 생략, 천 단위 구분`() {
        assertEquals("총 13.841km, 약 61분, 택시 요금 약 22,600원", carSummaryText(car, "ko", ko))
        assertEquals("총 13.841km, 약 61분, 택시 요금 약 22,600원, 통행료 1,200원", carSummaryText(car.copy(tollFare = 1200), "ko", ko))
    }

    @Test fun `도보 스텝 번호는 원본 인덱스이고 notice 스텝 0은 생략, 경유지 구획은 그 자리 앞`() {
        val notice = "계단 회피 경로를 찾지 못해 일반 경로를 안내합니다"
        val b = WalkRouteBriefing(
            distanceMeters = 500, durationSeconds = 400,
            steps = listOf(WalkRouteStep(notice), WalkRouteStep("가"), WalkRouteStep("나"), WalkRouteStep(""), WalkRouteStep("다")),
            stepFreeNotice = notice, waypoint = RouteWaypoint(stepIndex = 2, coord = RoutePoint(37.5, 127.1)),
        )
        assertEquals(listOf("2. 가", "경유지 편의점 도착", "3. 나", "5. 다"), walkStepItems(b, "편의점", ko))
        assertEquals(listOf("2. 가", "3. 나", "5. 다"), walkStepItems(b, null, ko)) // 라벨이 없으면 구획 행 없음
        assertEquals(listOf("1. 천호대로를 따라 119m 이동", "2. 강동역 방면으로 우회전", "3. 58m 이동 후 좌회전", "4. 목적지에 도착"), walkStepItems(walk, null, ko))
    }

    @Test fun `자동차 안내 행 - guidance 폴백 name, 거리 0 생략, 경유지 구획`() {
        val b = CarRouteBriefing(
            distanceMeters = 1000, durationSeconds = 120, taxiFare = 4800, tollFare = 0,
            guides = listOf(
                CarRouteGuide(name = "출발지", guidance = "출발지", distanceMeters = 0, durationSeconds = 0),
                CarRouteGuide(name = "", guidance = "우회전", distanceMeters = 79, durationSeconds = 22),
                CarRouteGuide(name = "강동역", guidance = "", distanceMeters = 1200, durationSeconds = 60),
                CarRouteGuide(name = "", guidance = "", distanceMeters = 5, durationSeconds = 1),
            ),
            waypoint = RouteWaypoint(stepIndex = 2, coord = RoutePoint(37.5, 127.1)),
        )
        assertEquals(listOf("출발지", "우회전, 79m", "경유지 마트 도착", "강동역, 1.2km"), carStepItems(b, "마트", ko))
        assertEquals("출발지", carStepItems(car, null, ko).first())
    }

    @Test fun `요금 구분자는 앱 로케일`() {
        assertEquals("22,600", wonText(22600, "ko"))
        assertEquals("22,600", wonText(22600, "en"))
        assertEquals("22.600", wonText(22600, "it"))
    }
}
