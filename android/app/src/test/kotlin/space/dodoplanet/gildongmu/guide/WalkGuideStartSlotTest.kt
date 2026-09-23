package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.directions.DirectionsUiState
import space.dodoplanet.gildongmu.guide.ui.walkGuideStartSlot
import space.dodoplanet.gildongmu.kit.DirectionsEndpoint
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** 도보 안내 시작 슬롯(spec §7-1)은 빌드 구성과 무관하게 도착 좌표만으로 선다 — 게이트가 되살아나면 정식판 진입점이 조용히 0이 된다. */
class WalkGuideStartSlotTest {
    @Test fun `도착지가 장소면 슬롯이 선다`() {
        assertNotNull(walkGuideStartSlot(DirectionsUiState(to = DirectionsEndpoint.Place("길동역", 37.5385, 127.1355))))
    }

    @Test fun `도착지가 현재 위치거나 비었으면 슬롯이 없다`() {
        assertNull(walkGuideStartSlot(DirectionsUiState(to = DirectionsEndpoint.Current)))
        assertNull(walkGuideStartSlot(DirectionsUiState()))
    }
}
