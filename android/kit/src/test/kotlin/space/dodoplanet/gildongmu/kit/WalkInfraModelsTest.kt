package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.NearbyAudioSignals
import space.dodoplanet.gildongmu.kit.models.OsmWalkData
import space.dodoplanet.gildongmu.kit.models.WalkInfraEnvelope
import space.dodoplanet.gildongmu.kit.models.WalkSourceStatus
import kotlinx.serialization.SerializationException
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** 보행 인프라 계약 테스트. 픽스처 3종 전부 프로덕션 실호출 캡처. */
class WalkInfraModelsTest {
    @Test fun walkNearbyDecodesBothSourcesOk() {
        val envelope = Fixtures.kitJson("walk-nearby.json", WalkInfraEnvelope.serializer())
        val audio = assertIs<WalkSourceStatus.Ok<NearbyAudioSignals>>(envelope.walk.audioSignals).data
        assertEquals(5, audio.deviceCount)
        assertEquals(5, audio.sites.size)
        assertEquals(183, audio.sites[0].distanceMeters)
        assertEquals("nw", audio.sites[0].bearing)
        assertEquals("2026-05-28", audio.baseDate)

        val osm = assertIs<WalkSourceStatus.Ok<OsmWalkData>>(envelope.walk.osm).data
        assertEquals(osm.features.size, osm.listedCount)
        assertTrue(osm.truncated)
        assertTrue(osm.crossingTotal >= osm.crossings.size)
        assertTrue(osm.tactileTotal >= osm.tactiles.size)
        assertTrue(osm.crossings.all { it.crossing })
        assertTrue(osm.tactiles.all { !it.crossing && it.tactilePaving })
        assertTrue(osm.features.all { it.distanceMeters >= 0 })
    }

    @Test fun walkNearbyPreservesPartialFailure() {
        val envelope = Fixtures.kitJson("walk-nearby-degraded.json", WalkInfraEnvelope.serializer())
        assertIs<WalkSourceStatus.Ok<*>>(envelope.walk.audioSignals)
        assertIs<WalkSourceStatus.Error<*>>(envelope.walk.osm)
    }

    @Test fun walkNearbyDecodesUnsupportedOutsideSeoul() {
        val envelope = Fixtures.kitJson("walk-nearby-unsupported.json", WalkInfraEnvelope.serializer())
        assertIs<WalkSourceStatus.Unsupported<*>>(envelope.walk.audioSignals)
    }

    @Test fun walkNearbyDecodesOsmUnsupportedOutsideKorea() {
        val json = """{"walk":{"audioSignals":{"status":"unsupported","reason":"outsideSeoul"},"osm":{"status":"unsupported","reason":"outsideKorea"}}}"""
        assertIs<WalkSourceStatus.Unsupported<*>>(KitJson.decodeFromString(WalkInfraEnvelope.serializer(), json).walk.osm)
    }

    @Test fun missingStatusOrDataThrowsSerializationException() {
        assertFailsWith<SerializationException> { KitJson.decodeFromString(WalkInfraEnvelope.serializer(), """{"walk":{"audioSignals":{"status":"ok"},"osm":{"status":"error"}}}""") }
        assertFailsWith<SerializationException> { KitJson.decodeFromString(WalkInfraEnvelope.serializer(), """{"walk":{"audioSignals":{},"osm":{"status":"error"}}}""") }
    }

    @Test fun walkSourceUnknownStatusFallsBackToError() {
        val json = """{"walk":{"audioSignals":{"status":"future-new"},"osm":{"status":"error"}}}"""
        assertIs<WalkSourceStatus.Error<*>>(KitJson.decodeFromString(WalkInfraEnvelope.serializer(), json).walk.audioSignals)
    }
}
