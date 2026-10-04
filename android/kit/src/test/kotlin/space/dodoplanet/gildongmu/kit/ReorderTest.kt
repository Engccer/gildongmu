package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

/** 순서 바꾸기 판정 — Kit `ReorderTests` 미러. */
class ReorderTest {
    private val up = ReorderMove.up
    private val down = ReorderMove.down
    private val toTop = ReorderMove.toTop

    @Test fun `할 수 있는 이동만 낸다`() {
        assertEquals(emptyList(), Reorder.availableMoves(0, 1))
        assertEquals(listOf(down), Reorder.availableMoves(0, 2))
        assertEquals(listOf(up), Reorder.availableMoves(1, 2))
        assertEquals(listOf(up, down), Reorder.availableMoves(1, 4))
        assertEquals(listOf(toTop, up, down), Reorder.availableMoves(2, 4))
        assertEquals(listOf(toTop, up), Reorder.availableMoves(3, 4))
        assertEquals(emptyList(), Reorder.availableMoves(4, 4))
        assertEquals(emptyList(), Reorder.availableMoves(-1, 4))
    }

    @Test fun `한 항목을 옮긴다`() {
        val items = listOf("a", "b", "c", "d")
        assertEquals(listOf("d", "a", "b", "c"), Reorder.moved(items, 3, toTop))
        assertEquals(listOf("a", "c", "b", "d"), Reorder.moved(items, 2, up))
        assertEquals(listOf("a", "c", "b", "d"), Reorder.moved(items, 1, down))
    }

    @Test fun `옮길 수 없는 이동은 원본 그대로`() {
        val items = listOf("a", "b", "c")
        assertEquals(items, Reorder.moved(items, 0, up))
        assertEquals(items, Reorder.moved(items, 0, toTop))
        assertEquals(items, Reorder.moved(items, 2, down))
        assertEquals(items, Reorder.moved(items, 5, up))
    }

    @Test fun `낸 이동은 언제나 순서를 바꾼다`() {
        for (count in 1..5) {
            val items = (0 until count).toList()
            for (index in items) for (move in Reorder.availableMoves(index, count)) {
                assertNotEquals(items, Reorder.moved(items, index, move), "$index $move")
            }
        }
    }

    @Test fun `저장 순서를 복구하고 빠진 값은 기본 순서로 메운다`() {
        val defaults = listOf("chat", "search", "directions", "nearby")
        assertEquals(listOf("nearby", "search", "chat", "directions"),
            Reorder.restoredOrder(listOf("nearby", "search", "chat", "directions"), defaults))
        assertEquals(listOf("directions", "chat", "search", "nearby"), Reorder.restoredOrder(listOf("directions"), defaults))
        assertEquals(listOf("search", "chat", "directions", "nearby"),
            Reorder.restoredOrder(listOf("map", "search", "search", "chat"), defaults))
        assertEquals(defaults, Reorder.restoredOrder(emptyList(), defaults))
    }

    @Test fun `저장 문자열에서 복구한다`() {
        val defaults = listOf("chat", "search", "directions", "nearby")
        assertEquals(defaults, Reorder.restoredOrder(json = "", defaults))
        assertEquals(defaults, Reorder.restoredOrder(json = "not json", defaults))
        assertEquals(defaults, Reorder.restoredOrder(json = """{"a":1}""", defaults))
        val order = listOf("search", "nearby", "chat", "directions")
        assertEquals(order, Reorder.restoredOrder(json = Reorder.encodedOrder(order), defaults))
    }
}
