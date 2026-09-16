package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.StepFreeStatus
import space.dodoplanet.gildongmu.kit.models.TransitRouteEnvelope
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg
import space.dodoplanet.gildongmu.kit.models.WalkRouteBriefing
import space.dodoplanet.gildongmu.kit.models.WalkRouteEnvelope
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 경로 브리핑 계약 테스트(Kit `RouteModelsTests` 미러): Fixtures/route-*.json이 정본.
 * `RouteService.walk` 404·null 검사와 `TransitDisplay.pickLine`은 CORE 이식 때.
 */
class RouteModelsTest {
    private fun transit() = assertNotNull(Fixtures.kitJson("route-transit.json", TransitRouteEnvelope.serializer()).result)

    @Test fun routeCarFixtureDecodes() {
        val briefing = Fixtures.kitJson("route-car.json", CarRouteBriefing.serializer())
        assertEquals(13841, briefing.distanceMeters)
        assertEquals(22600, briefing.taxiFare)
        assertEquals(0, briefing.tollFare)
        assertTrue(briefing.guides.isNotEmpty())
        assertEquals("출발지", briefing.guides.first().guidance)
        assertTrue(briefing.guides.any { it.name.isEmpty() })
    }

    @Test fun routeTransitFixtureDecodes() {
        val result = transit()
        assertEquals(2, result.recommended.summary.transfers)
        assertEquals("길동", result.recommended.summary.departName)
        assertEquals("강남", result.recommended.summary.arriveName)
        assertEquals(5, result.recommended.legs.size)
        assertEquals(2, result.alternatives.size)
        val subway = assertNotNull(result.recommended.legs.firstOrNull { it.mode == "subway" })
        assertEquals("수도권 5호선", subway.lineName)
        assertEquals("길동", subway.fromName)
        assertEquals(2, subway.stationCount)
        assertTrue(result.alternatives.flatMap { it.legs }.any { it.mode == "bus" })
        assertEquals(9, result.totalCandidates)
    }

    @Test fun routeTransitCarriesStableKeyAndAxes() {
        val result = transit()
        assertEquals("p0", result.recommended.routeKey)
        assertEquals(listOf("p3", "p1"), result.alternatives.map { it.routeKey })
        assertNull(result.recommended.highlight)
        assertEquals(listOf("fewestTransfers"), result.alternatives[0].highlight)
        assertNull(result.alternatives[0].displayIndex)
        assertNull(result.alternatives[1].highlight)
        assertEquals(1, result.alternatives[1].displayIndex)
    }

    @Test fun walkLegsCarryDistanceAndDestination() {
        val result = transit()
        val walks = result.recommended.legs.filter { it.mode == "walk" }
        assertEquals("길동", walks.first().toName)
        assertEquals(178, walks.first().distanceMeters)
        assertNull(walks.last().toName)
        val allLegs = result.recommended.legs + result.alternatives.flatMap { it.legs }
        assertTrue(allLegs.filter { it.mode == "walk" }.any { it.distanceMeters == null })
        assertTrue(allLegs.filter { it.mode != "walk" }.all { it.distanceMeters == null })
    }

    @Test fun routeTransitNullResultDecodesToNull() {
        assertNull(KitJson.decodeFromString(TransitRouteEnvelope.serializer(), """{"result":null}""").result)
    }

    @Test fun routeUnitsAreInSaneRanges() {
        val car = Fixtures.kitJson("route-car.json", CarRouteBriefing.serializer())
        assertTrue(car.durationSeconds in 600..7200)
        val t = transit()
        assertTrue(t.recommended.summary.totalMinutes in 20..180)
        assertTrue(t.recommended.summary.fare > 0)
    }

    @Test fun walkLegsHaveNoLineName() {
        val allLegs = transit().let { it.recommended.legs + it.alternatives.flatMap { a -> a.legs } }
        val walks = allLegs.filter { it.mode == "walk" }
        assertTrue(walks.isNotEmpty())
        assertTrue(walks.all { it.lineName == null && it.fromName == null && it.stationCount == null })
        assertTrue(walks.all { it.minutes >= 0 })
    }

    @Test fun routeWalkFixtureDecodes() {
        val briefing = assertNotNull(Fixtures.kitJson("route-walk.json", WalkRouteEnvelope.serializer()).result)
        assertEquals(2078, briefing.distanceMeters)
        assertEquals(1806, briefing.durationSeconds)
        assertTrue(briefing.steps.isNotEmpty())
        assertEquals("천호대로를 따라 119m 이동", briefing.steps.first().description)
        assertTrue(briefing.steps.all { it.distanceMeters == null })
        assertTrue(briefing.steps.all { it.pathCoords == null })
    }

    @Test fun walkStepDecodesOptionalPathCoords() {
        val json = """{"result":{"distanceMeters":100,"durationSeconds":80,"steps":[
          {"description":"이동","pathCoords":[{"lat":37.5,"lng":127.1},{"lat":37.5001,"lng":127.1}]},
          {"description":"우회전"}]}}"""
        val steps = assertNotNull(KitJson.decodeFromString(WalkRouteEnvelope.serializer(), json).result?.steps)
        assertEquals(2, steps[0].pathCoords?.size)
        assertEquals(RoutePoint(37.5, 127.1), steps[0].pathCoords?.first())
        assertNull(steps[1].pathCoords)
    }

    @Test fun routeWalkNoRouteFixtureDecodesToNullResult() {
        assertNull(Fixtures.kitJson("route-walk-no-route.json", WalkRouteEnvelope.serializer()).result)
    }

    @Test fun routeWalkUnitsAreInSaneRange() {
        val briefing = assertNotNull(Fixtures.kitJson("route-walk.json", WalkRouteEnvelope.serializer()).result)
        assertTrue(briefing.durationSeconds in 60..14400)
        assertTrue(briefing.distanceMeters > 0)
    }

    @Test fun `운행시간 필드를 디코딩한다`() {
        val leg = KitJson.decodeFromString(TransitRouteLeg.serializer(), """{"mode":"bus","lineName":"342","fromName":"강동역","toName":"길동생태공원","stationCount":14,"minutes":22,"serviceStatus":"outside","firstServiceTime":"04:00","lastServiceTime":"22:30"}""")
        assertEquals("outside", leg.serviceStatus); assertEquals("04:00", leg.firstServiceTime); assertEquals("22:30", leg.lastServiceTime)
    }

    @Test fun `운행시간 필드가 없어도 디코딩된다`() {
        val leg = KitJson.decodeFromString(TransitRouteLeg.serializer(), """{"mode":"bus","lineName":"342","minutes":22}""")
        assertNull(leg.serviceStatus); assertNull(leg.firstServiceTime)
    }

    private fun steps(json: String) = KitJson.decodeFromString(WalkRouteBriefing.serializer(), json).steps
    private fun briefing(json: String) = KitJson.decodeFromString(WalkRouteBriefing.serializer(), json)

    @Test fun `서버가 실은 action을 디코딩한다`() {
        val s = steps("""{"distanceMeters":1,"durationSeconds":1,"steps":[{"description":"우회전 후 10m 이동","action":"right"},{"description":"횡단보도","action":"crosswalk"}]}""")
        assertEquals(WalkAction.right, s[0].action); assertEquals(WalkAction.crosswalk, s[1].action)
    }

    @Test fun `action 필드가 없으면 null`() {
        val s = steps("""{"distanceMeters":1,"durationSeconds":1,"steps":[{"description":"직진"}]}""")
        assertNull(s[0].action); assertEquals("직진", s[0].description)
    }

    @Test fun `모르는 행동 문자열은 null로 떨어진다`() {
        assertNull(steps("""{"distanceMeters":1,"durationSeconds":1,"steps":[{"description":"무언가","action":"teleport"}]}""")[0].action)
        // 명시 null도 null — descriptor가 nullable이라 serializer가 JsonNull을 받는 경로를 잠근다.
        assertNull(steps("""{"distanceMeters":1,"durationSeconds":1,"steps":[{"description":"무언가","action":null}]}""")[0].action)
    }

    @Test fun `자동차 브리핑의 guidanceLang은 선택 디코딩`() {
        assertEquals("ko", KitJson.decodeFromString(CarRouteBriefing.serializer(), """{"distanceMeters":1,"durationSeconds":1,"taxiFare":0,"tollFare":0,"guides":[],"guidanceLang":"ko"}""").guidanceLang)
        assertNull(KitJson.decodeFromString(CarRouteBriefing.serializer(), """{"distanceMeters":1,"durationSeconds":1,"taxiFare":0,"tollFare":0,"guides":[]}""").guidanceLang)
    }

    @Test fun `횡단 구간 플래그를 디코딩하고 없으면 null`() {
        val s = steps("""{"distanceMeters":1,"durationSeconds":1,"steps":[{"description":"Cross the crosswalk, then walk 30m","action":"crosswalk","crossing":true},{"description":"천호역 횡단보도까지 100m 이동","action":"crosswalk"}]}""")
        assertEquals(true, s[0].crossing); assertNull(s[1].crossing)
    }

    @Test fun `다른 필드와 함께 와도 전부 디코딩된다`() {
        val s = steps("""{"distanceMeters":1,"durationSeconds":1,"steps":[{"description":"좌회전 후 20m 이동","distanceMeters":20,"pathCoords":[{"lat":37.5,"lng":127.1}],"live":{"target":"파리바게뜨"},"action":"left"}]}""")
        assertEquals(WalkAction.left, s[0].action); assertEquals(20, s[0].distanceMeters)
        assertEquals(1, s[0].pathCoords?.size); assertEquals("파리바게뜨", s[0].live?.target)
    }

    @Test fun `계단 회피 필드 부재는 판정 없음`() {
        val b = briefing("""{"distanceMeters":100,"durationSeconds":60,"steps":[]}""")
        assertNull(b.stepFreeStatus); assertNull(b.stepFreeNotice)
    }

    @Test fun `계단 회피 알려진 상태를 매핑한다`() {
        val b = briefing("""{"distanceMeters":100,"durationSeconds":60,"steps":[],"stepFree":"no_stepfree_route","stepFreeNotice":"계단이 포함될 수 있습니다."}""")
        assertEquals(StepFreeStatus.noStepFreeRoute, b.stepFreeStatus)
        assertEquals("계단이 포함될 수 있습니다.", b.stepFreeNotice)
        assertEquals(StepFreeStatus.applied, briefing("""{"distanceMeters":1,"durationSeconds":1,"steps":[],"stepFree":"applied"}""").stepFreeStatus)
        assertEquals(StepFreeStatus.unavailable, briefing("""{"distanceMeters":1,"durationSeconds":1,"steps":[],"stepFree":"unavailable"}""").stepFreeStatus)
    }

    @Test fun `미지의 계단 회피 상태가 브리핑 전체를 깨뜨리지 않는다`() {
        val b = briefing("""{"distanceMeters":100,"durationSeconds":60,"steps":[],"stepFree":"partially_applied"}""")
        assertEquals(100, b.distanceMeters); assertNull(b.stepFreeStatus)
    }

    @Test fun `최종 접근 기하 부재는 null`() {
        assertNull(briefing("""{"distanceMeters":100,"durationSeconds":60,"steps":[]}""").finalApproach)
    }

    @Test fun `최종 접근 거리와 상대각을 읽는다`() {
        val fa = assertNotNull(briefing("""{"distanceMeters":100,"durationSeconds":60,"steps":[],"finalApproach":{"offsetMeters":16.1,"relativeBearing":-92.4}}""").finalApproach)
        assertTrue(abs(fa.offsetMeters - 16.1) < 0.001)
        assertEquals(RelativeDirection.left, relativeDirection(assertNotNull(fa.relativeBearing)))
        assertNull(fa.unavailableReason)
    }

    @Test fun `최종 접근 부재 사유를 매핑하고 미지 사유는 null`() {
        val b = briefing("""{"distanceMeters":100,"durationSeconds":60,"steps":[],"finalApproach":{"offsetMeters":4.2,"bearingUnavailable":"tooClose"}}""")
        assertEquals(BearingUnavailable.tooClose, b.finalApproach?.unavailableReason)
        assertNull(b.finalApproach?.relativeBearing)
        val unknown = briefing("""{"distanceMeters":100,"durationSeconds":60,"steps":[],"finalApproach":{"offsetMeters":30,"bearingUnavailable":"headingUnstable"}}""")
        assertEquals(100, unknown.distanceMeters)
        assertNull(unknown.finalApproach?.unavailableReason)
        assertEquals(30.0, unknown.finalApproach?.offsetMeters)
    }

    @Test fun `waypoint 필드 도보 자동차 동형`() {
        val walk = briefing("""{"distanceMeters":100,"durationSeconds":60,"steps":[],"waypoint":{"stepIndex":5,"coord":{"lat":37.5353,"lng":127.1323}}}""")
        assertEquals(5, walk.waypoint?.stepIndex); assertEquals(37.5353, walk.waypoint?.coord?.lat)
        assertNull(briefing("""{"distanceMeters":100,"durationSeconds":60,"steps":[]}""").waypoint)
        val car = KitJson.decodeFromString(CarRouteBriefing.serializer(), """{"distanceMeters":2066,"durationSeconds":300,"taxiFare":5000,"tollFare":0,"guides":[],"provider":"tmap","waypoint":{"stepIndex":2,"coord":{"lat":37.5353,"lng":127.1323}}}""")
        assertEquals(2, car.waypoint?.stepIndex)
        assertNull(KitJson.decodeFromString(CarRouteBriefing.serializer(), """{"distanceMeters":2066,"durationSeconds":300,"taxiFare":5000,"tollFare":0,"guides":[]}""").waypoint)
    }

    @Test fun transitLegEnFieldsDecodeOptionally() {
        val json = """{"result":{"recommended":{"summary":{"totalMinutes":31,"fare":1650,"transfers":2,"walkMinutes":3,"departName":"길동","arriveName":"강남","departNameEn":"Gildong","arriveNameEn":"Gangnam"},
          "legs":[{"mode":"subway","lineName":"수도권 9호선(급행)","lineNameEn":"Line 9 Express","fromName":"길동","fromNameEn":"Gildong","toName":"천호","toNameEn":"Cheonho (Pungnaptoseong)","stationCount":1,"minutes":3,
                   "stops":[{"name":"길동","nameEn":"Gildong","lat":37.5,"lng":127.1}]}],
          "routeKey":"p0"},"alternatives":[],"totalCandidates":1}}"""
        val r = assertNotNull(KitJson.decodeFromString(TransitRouteEnvelope.serializer(), json).result)
        val leg = r.recommended.legs[0]
        assertEquals("수도권 9호선(급행)", leg.lineName); assertEquals("Line 9 Express", leg.lineNameEn)
        assertEquals("Gildong", leg.fromNameEn); assertEquals("Cheonho (Pungnaptoseong)", leg.toNameEn)
        assertEquals("Gildong", leg.stops?.get(0)?.nameEn)
        assertEquals("Gildong", r.recommended.summary.departNameEn); assertEquals("Gangnam", r.recommended.summary.arriveNameEn)
    }

    @Test fun `급행 정차역 집합과 출구 번호를 디코딩한다`() {
        val leg = KitJson.decodeFromString(TransitRouteLeg.serializer(), """{"mode":"subway","lineName":"수도권 9호선","fromName":"당산","toName":"노들","stationCount":3,"minutes":6,"expressStops":["김포공항","당산","여의도","노량진","중앙보훈병원"],"expressStopIds":["902","913","915","917","938"],"exit":{"alight":"1"}}""")
        assertEquals(listOf("김포공항", "당산", "여의도", "노량진", "중앙보훈병원"), leg.expressStops)
        assertEquals(listOf("902", "913", "915", "917", "938"), leg.expressStopIds)
        assertEquals("1", leg.exit?.alight); assertNull(leg.exit?.board)
        val bare = KitJson.decodeFromString(TransitRouteLeg.serializer(), """{"mode":"subway","lineName":"수도권 5호선","minutes":6}""")
        assertNull(bare.expressStops); assertNull(bare.expressStopIds); assertNull(bare.exit)
    }
}
