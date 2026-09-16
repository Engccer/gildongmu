package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.AroundNearbyResponse
import space.dodoplanet.gildongmu.kit.models.BikeNearbyResponse
import space.dodoplanet.gildongmu.kit.models.BusNearbyResponse
import space.dodoplanet.gildongmu.kit.models.BusRouteStopsResponse
import space.dodoplanet.gildongmu.kit.models.ClinicNearbyResponse
import space.dodoplanet.gildongmu.kit.models.KidsNearbyResponse
import space.dodoplanet.gildongmu.kit.models.SubwayNearbyResponse
import space.dodoplanet.gildongmu.kit.models.SurroundingsSceneResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 내 주변 계약 테스트 — Kit Fixtures/…-nearby.json(prod 실캡처)이 계약 정본. */
class NearbyModelsTest {
    @Test fun subwayNearbyFixtureDecodes() {
        val result = Fixtures.kitJson("subway-nearby.json", SubwayNearbyResponse.serializer())
        assertTrue(result.stations.isNotEmpty())
        val first = result.stations[0]
        assertEquals("ok", first.arrivalStatus)
        assertTrue(first.lines.isNotEmpty())
        assertTrue(first.arrivals.isNotEmpty())
        assertTrue(first.arrivals.all { it.message.isNotEmpty() })
        assertEquals(result.stations.map { it.distanceMeters }.sorted(), result.stations.map { it.distanceMeters })
    }

    @Test fun busNearbyFixtureDecodes() {
        val result = Fixtures.kitJson("bus-nearby.json", BusNearbyResponse.serializer())
        assertTrue(result.stops.isNotEmpty())
        assertTrue(result.stops.all { it.source == "tago" || it.source == "seoul" })
        val seoulArrivals = result.stops.flatMap { it.arrivals }.filter { it.source == "seoul" }
        assertTrue(seoulArrivals.isNotEmpty())
        assertTrue(seoulArrivals.all { it.arrivalMessage?.isEmpty() == false })
    }

    @Test fun bikeNearbyFixtureDecodes() {
        val result = Fixtures.kitJson("bike-nearby.json", BikeNearbyResponse.serializer())
        assertTrue(result.stations.isNotEmpty())
        assertTrue(result.stations.all { it.racksTotal >= 0 && it.bikesAvailable >= 0 })
        assertTrue(result.stations.all { it.stationId.isNotEmpty() })
    }

    @Test fun clinicNearbyFixtureDecodes() {
        val result = Fixtures.kitJson("clinic-nearby.json", ClinicNearbyResponse.serializer())
        assertTrue(result.clinics.isNotEmpty())
        assertTrue(result.clinics.all { it.openStatus.state in setOf("open", "closed", "unknown") })
        assertTrue(result.clinics.all { it.hours.size == 8 })
        assertTrue(result.clinics.any { c -> c.hours.any { it.start == null && it.end == null } })
        assertTrue((result.total ?: 0) >= result.clinics.size)
        assertEquals(3000, result.supplementRadiusMeters)
        assertTrue(result.clinics.any { it.designated == true })
        assertTrue(result.clinics.any { it.designated == false })
    }

    @Test fun clinicNearbyLegacyShapeDecodes() {
        val result = KitJson.decodeFromString(ClinicNearbyResponse.serializer(), """{"clinics":[]}""")
        assertNull(result.total); assertNull(result.supplementFailed)
    }

    @Test fun kidsNearbyFixtureDecodes() {
        val result = Fixtures.kitJson("kids-nearby.json", KidsNearbyResponse.serializer())
        assertTrue(result.kids.isNotEmpty())
        assertTrue(result.kids.all { it.kind in setOf("kidscafe", "playground", "playcenter", "park") })
        assertTrue(result.kids.all { it.indoorOutdoor in setOf("indoor", "outdoor", "unknown") })
        assertTrue(result.kids.any { it.roadAddress == null })
        assertTrue(result.kids.any { it.phone == null })
    }

    @Test fun aroundNearbyFixtureDecodes() {
        val result = Fixtures.kitJson("around-nearby.json", AroundNearbyResponse.serializer())
        assertTrue(result.places.isNotEmpty())
        val validBearings = setOf("n", "ne", "e", "se", "s", "sw", "w", "nw")
        assertTrue(result.places.all { it.bearing in validBearings })
        assertTrue(result.places.all { it.categoryRaw.isNotEmpty() })
        assertTrue(result.places.all { it.distanceMeters >= 0 })
    }

    @Test fun busRouteStopsFixtureDecodes() {
        val result = Fixtures.kitJson("bus-route-stops.json", BusRouteStopsResponse.serializer())
        assertTrue(result.stops.isNotEmpty())
        assertTrue(result.stops.all { it.nodeId.isNotEmpty() })
        assertEquals(result.stops.map { it.order }.sorted(), result.stops.map { it.order })
    }

    @Test fun surroundingsSceneFixtureDecodes() {
        val scene = assertNotNull(Fixtures.kitJson("surroundings-scene.json", SurroundingsSceneResponse.serializer()).data)
        assertEquals("entrance", scene.frame)
        assertTrue(scene.total > 0)
        assertTrue(scene.groups.isNotEmpty())
        assertTrue(scene.groups.all { it.items.isNotEmpty() })
        assertTrue(scene.groups.flatMap { it.items }.all { it.distanceMeters >= 0 })
    }

    @Test fun surroundingsSceneCompassFixtureDecodes() {
        val scene = assertNotNull(Fixtures.kitJson("surroundings-scene-compass.json", SurroundingsSceneResponse.serializer()).data)
        assertEquals("compass", scene.frame)
        assertTrue(scene.groups.isNotEmpty())
    }
}
