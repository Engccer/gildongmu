package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.BarrierFreeDetailResponse
import space.dodoplanet.gildongmu.kit.models.BarrierFreeNearbyResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 무장애 여행 계약 테스트 — Kit Fixtures/barrier-free-*.json이 정본. `BarrierFreeService.match` 비-throw 검사는 `BarrierFreeServiceTest`. */
class BarrierFreeModelsTest {
    @Test fun nearbyFixtureDecodes() {
        val result = Fixtures.kitJson("barrier-free-nearby.json", BarrierFreeNearbyResponse.serializer())
        assertTrue(result.places.isNotEmpty())
        assertTrue(result.places.all { it.contentId.isNotEmpty() && it.name.isNotEmpty() })
        assertEquals(result.places.map { it.distanceMeters }.sorted(), result.places.map { it.distanceMeters })
    }

    @Test fun detailFixtureDecodes() {
        val detail = assertNotNull(Fixtures.kitJson("barrier-free-detail.json", BarrierFreeDetailResponse.serializer()).detail)
        assertTrue(detail.facilities.isNotEmpty())
        assertTrue(detail.facilities.all { it.label.isNotEmpty() && it.value.isNotEmpty() })
    }

    @Test fun matchFixtureDecodesSameEnvelope() {
        val detail = assertNotNull(Fixtures.kitJson("barrier-free-match.json", BarrierFreeDetailResponse.serializer()).detail)
        assertTrue(detail.facilities.isNotEmpty())
    }

    @Test fun detailNullEnvelopeDecodesToNull() {
        assertNull(KitJson.decodeFromString(BarrierFreeDetailResponse.serializer(), """{"detail":null}""").detail)
    }
}
