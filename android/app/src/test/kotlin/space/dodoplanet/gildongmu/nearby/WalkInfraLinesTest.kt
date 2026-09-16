package space.dodoplanet.gildongmu.nearby

import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoverage
import space.dodoplanet.gildongmu.kit.WalkInfraService
import space.dodoplanet.gildongmu.kit.models.AudioSignalSite
import space.dodoplanet.gildongmu.kit.models.OsmWalkData
import space.dodoplanet.gildongmu.kit.models.WalkFeature
import space.dodoplanet.gildongmu.kit.models.WalkInfrastructure
import space.dodoplanet.gildongmu.kit.models.WalkSourceStatus
import space.dodoplanet.gildongmu.kit.stubbedClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

/** spec §12-1 walkInfra — 소스별 3-state 요약(ok/0건/unsupported/error), 그룹 헤딩 절단, 미지 방위 생략(iOS 이식). */
class WalkInfraLinesTest {
    private val w = WalkSummaryWords({ "반경 300m 안 ${it}기" }, "음향신호기 없음", "음향신호기 미제공 지역", "음향신호기 조회 실패", { "보행 시설 ${it}곳" }, "보행 시설 없음", "보행 시설 미제공", "보행 시설 조회 실패")
    private suspend fun walk(name: String): WalkInfrastructure = WalkInfraService(stubbedClient { HttpResponse(200, Fixtures.kit(name)) }).nearby(37.5, 127.1)
    private fun osm(crossingTotal: Int = 0, tactileTotal: Int = 0, features: List<WalkFeature> = emptyList(), listed: Int = features.size) =
        WalkSourceStatus.Ok(OsmWalkData(features = features, totalCount = crossingTotal + tactileTotal, listedCount = listed, truncated = false, crossingTotal = crossingTotal, tactileTotal = tactileTotal))

    @Test fun `요약 — ok·unsupported·error 조합을 "0기" 합성 없이`() = runTest {
        assertEquals("반경 300m 안 5기, 보행 시설 12곳", walkInfraLiveSummary(walk("walk-nearby.json"), w))
        assertEquals("반경 300m 안 5기, 보행 시설 조회 실패", walkInfraLiveSummary(walk("walk-nearby-degraded.json"), w))
        assertEquals("음향신호기 미제공 지역, 보행 시설 조회 실패", walkInfraLiveSummary(walk("walk-nearby-unsupported.json"), w))
    }

    @Test fun `요약 — ok인데 0건은 0건 문구(정보 없음·실패와 다르다)`() {
        val zero = WalkInfrastructure(WalkSourceStatus.Ok(space.dodoplanet.gildongmu.kit.models.NearbyAudioSignals(0, emptyList(), "2026-05-28")), osm())
        assertEquals("음향신호기 없음, 보행 시설 없음", walkInfraLiveSummary(zero, w))
    }

    @Test fun `그룹 헤딩 — 절단이면 "N곳 중 M곳", 전부 나열이면 "N곳", 0·비-ok는 평문`() {
        val crossing = { s: WalkSourceStatus<OsmWalkData> -> walkGroupHeader(s, { it.crossingTotal }, { it.crossings.size }, "횡단보도", { "횡단보도 ${it}곳" }) { t, l -> "횡단보도 ${t}곳 중 ${l}곳" } }
        val f = WalkFeature("1", true, "yes", false, null, 120, "n")
        assertEquals("횡단보도 7곳 중 1곳", crossing(osm(crossingTotal = 7, features = listOf(f))))
        assertEquals("횡단보도 1곳", crossing(osm(crossingTotal = 1, features = listOf(f))))
        assertEquals("횡단보도", crossing(osm(crossingTotal = 0)))
        assertEquals("횡단보도", crossing(WalkSourceStatus.Error()))
        assertEquals("횡단보도", crossing(WalkSourceStatus.Unsupported()))
    }

    @Test fun `미지 방위는 방위 조각 생략`() {
        assertEquals("120m", walkItemLocationText(WalkFeature("1", true, "yes", false, null, 120, "zz"), { null }) { d, dist -> "$d $dist" })
        assertEquals("북 120m", walkItemLocationText(WalkFeature("1", true, "yes", false, null, 120, "n"), { "북" }) { d, dist -> "$d $dist" })
        assertEquals("북 120m(2기)", walkAudioSiteText(AudioSignalSite(120, "n", 2), { "북" }) { d, dist, n -> "$d $dist(${n}기)" })
        assertEquals("120m(2기)", walkAudioSiteText(AudioSignalSite(120, "zz", 2), { null }) { d, dist, n -> "$d $dist(${n}기)" })
        assertEquals("120m(2기)", walkAudioSiteText(AudioSignalSite(120, "zz", 2), { null }) { d, dist, n -> "$d, $dist(${n}기)" }) // en 꼴 구분자
    }

    @Test fun `walkInfra 조립기 — 커버리지 none·항상 본문·착지 walkinfra-top·통지는 요약`() = runTest {
        val spec = NearbyKinds.walkInfra(WalkInfraService(stubbedClient { HttpResponse(200, Fixtures.kit("walk-nearby.json")) }), testNearbyStrings()) { "오후 3:04" }
        val p = spec.fetch(NearbyCoord(37.5, 127.1), null)
        assertEquals(NearbyCoverage.none, spec.coverage)
        assertFalse(spec.isEmpty(p)); assertEquals("walkinfra-top", spec.firstKey(p)); assertEquals("오후 3:04", p.asOf)
        assertEquals("요약", spec.loadedNotice(p)); assertNull(spec.emptyCopy)
    }
}
