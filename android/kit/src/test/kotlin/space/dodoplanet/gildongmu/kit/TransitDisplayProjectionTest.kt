package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 표시 투영 공유 fixture(E27 잔여 ①) — Kit `TransitDisplayProjectionTests`·웹 `transit-display.test.ts`와 같은 파일을 돌린다. */
class TransitDisplayProjectionTest {
    @Serializable
    private data class DisplayFixture(val legs: List<LegCase>, val items: List<ItemCase>) {
        @Serializable
        data class LegCase(val name: String, val leg: TransitGuideLeg, val boardOverrideIndex: Int? = null, val expect: TransitDisplayLeg)

        @Serializable
        data class ItemCase(val name: String, val item: TransitTrackItem, val expect: TransitDisplayItem)
    }

    @Test fun `공유 fixture 동조`() {
        val fixture = Fixtures.sharedJson("transit-display-cases.json", DisplayFixture.serializer())
        // ⚠ 케이스 0건이면 아래 루프가 공허하게 통과한다(경로 오타가 "합격"으로 위장) — 수를 먼저 본다.
        assertTrue(fixture.legs.size >= 5)
        assertTrue(fixture.items.size >= 4)
        for (c in fixture.legs) assertEquals(c.expect, transitDisplayLeg(c.leg, c.boardOverrideIndex), "leg: ${c.name}")
        for (c in fixture.items) assertEquals(c.expect, transitDisplayItem(c.item), "item: ${c.name}")
    }
}
