package space.dodoplanet.gildongmu.nearby

import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.kit.BarrierFreeService
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.NearbyCoord
import space.dodoplanet.gildongmu.kit.NearbyCoverage
import space.dodoplanet.gildongmu.kit.NearbyService
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.stubbedClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** spec §12-1 — M2b kind 조립기(실캡처 fixture + 손 fixture): 첫 착지 키·통지·빈 문구·payload 메타. */
class NearbyKindsTest {
    private val coord = NearbyCoord(37.538, 127.137)
    private val strings = testNearbyStrings()
    private fun nearby(path: String, body: String) = NearbyService(stubbedClient { url -> if (pathOf(url) == path) HttpResponse(200, body) else HttpResponse(404, "") })

    @Test fun `clinic — 첫 키·통지·기준·보완 실패, 0건은 빈 문구가 통지`() = runTest {
        val spec = NearbyKinds.clinic(nearby("/api/clinic/nearby", Fixtures.kit("clinic-nearby.json")), strings)
        val p = spec.fetch(coord, null)
        assertFalse(spec.isEmpty(p)); assertEquals("place-${p.clinics.first().id}", spec.firstKey(p))
        assertEquals("주변 장소 ${p.clinics.size}곳", spec.loadedNotice(p))
        assertEquals("weekday", p.basis); assertFalse(p.supplementFailed)
        val empty = p.copy(clinics = emptyList())
        assertTrue(spec.isEmpty(empty)); assertNull(spec.firstKey(empty))
        assertEquals("주변에 소아 야간진료 기관이 없습니다", spec.loadedNotice(empty)); assertEquals(spec.emptyCopy!!(empty), spec.loadedNotice(empty))
        assertEquals(NearbyCoverage.korea, spec.coverage)
    }

    @Test fun `clinic — basis·supplementFailed 부재는 weekday·false`() = runTest {
        val p = NearbyKinds.clinic(nearby("/api/clinic/nearby", """{"clinics":[]}"""), strings).fetch(coord, null)
        assertEquals("weekday", p.basis); assertFalse(p.supplementFailed)
        val q = NearbyKinds.clinic(nearby("/api/clinic/nearby", """{"clinics":[],"basis":"holiday","supplementFailed":true}"""), strings).fetch(coord, null)
        assertEquals("holiday", q.basis); assertTrue(q.supplementFailed)
    }

    @Test fun `barrierFree·kids·events — 첫 키는 place-{id}, 통지·빈 문구는 종류별`() = runTest {
        val bf = NearbyKinds.barrierFree(BarrierFreeService(stubbedClient { HttpResponse(200, Fixtures.kit("barrier-free-nearby.json")) }), strings)
        val b = bf.fetch(coord, null)
        assertEquals("place-${b.first().contentId}", bf.firstKey(b)); assertEquals("주변 장소 ${b.size}곳", bf.loadedNotice(b))
        assertEquals("주변에 무장애 여행지가 없습니다", bf.loadedNotice(emptyList()))

        val kids = NearbyKinds.kids(nearby("/api/places/kids", Fixtures.kit("kids-nearby.json")), strings)
        val k = kids.fetch(coord, null)
        assertEquals("place-${k.first().id}", kids.firstKey(k)); assertEquals("주변 장소 ${k.size}곳", kids.loadedNotice(k))
        assertEquals("주변에 아이 놀 곳이 없습니다", kids.emptyCopy!!(emptyList()))

        val ev = NearbyKinds.events(nearby("/api/events/nearby", javaClass.getResource("/events-nearby.json")!!.readText()), strings)
        val e = ev.fetch(coord, null)
        assertEquals("place-e1", ev.firstKey(e)); assertEquals("주변 문화행사 2건", ev.loadedNotice(e))
        assertEquals("주변에 문화행사가 없습니다", ev.emptyCopy!!(emptyList()))
    }
}
