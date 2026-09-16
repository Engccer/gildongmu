package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 도착 화면 걸음·칼로리 요약(spec 2026-08-17 §4) — Kit `WalkHealthTests` 미러. 활동 칼로리 = 거리(km)×체중×0.5.
 */
class WalkHealthTest {
    private fun food(key: String, count: Int) = WalkHealth.FoodComparison(key, count)

    @Test fun `1km 65kg은 33kcal`() {
        assertEquals(WalkHealthSummary(1400, 33, false), WalkHealth.summary(1400, 1000.0, 65.0))
    }

    @Test fun `거리에 선형 비례`() {
        assertEquals(96, WalkHealth.summary(3000, 2400.0, 80.0).kcal)
    }

    @Test fun `거리 없으면 보폭으로 폴백`() {
        // 1,000걸음 × 0.7m = 700m × 65kg × 0.5/1000 = 22.75 → 23
        assertEquals(23, WalkHealth.summary(1000, null, 65.0).kcal)
    }

    @Test fun `걸음·거리 0은 0kcal`() {
        assertEquals(WalkHealthSummary(0, 0, false), WalkHealth.summary(0, 0.0, 65.0))
    }

    @Test fun `체중 미입력·범위 밖은 기본 체중`() {
        for (w in listOf(null, 0.0, 19.9, 300.1, -5.0)) {
            val s = WalkHealth.summary(1400, 1000.0, w)
            assertTrue(s.usedDefaultWeight, "weight $w")
            assertEquals(33, s.kcal)
        }
        assertEquals(20.0, WalkHealth.normalizedWeight(20.0))
        assertEquals(300.0, WalkHealth.normalizedWeight(300.0))
        assertNull(WalkHealth.normalizedWeight(0.0))
    }

    @Test fun `의미 있는 보행 경계는 유효 거리로 판정한다`() {
        assertTrue(WalkHealth.isMeaningfulWalk(0, 50.0))
        assertFalse(WalkHealth.isMeaningfulWalk(0, 49.9))
        assertTrue(WalkHealth.isMeaningfulWalk(72, null)) // 50.4m
        assertFalse(WalkHealth.isMeaningfulWalk(71, null)) // 49.7m
        assertFalse(WalkHealth.isMeaningfulWalk(0, 0.0))
        assertFalse(WalkHealth.isMeaningfulWalk(-100, Double.NaN))
        // 거리 0(미제공)이면 걸음이 판정한다 — 거리 0을 "0m 걸음"으로 읽지 않는다.
        assertTrue(WalkHealth.isMeaningfulWalk(100, 0.0))
    }

    @Test fun `음수·NaN 입력은 0으로 접는다`() {
        assertEquals(0, WalkHealth.summary(-3, -10.0, 65.0).steps)
        assertEquals(WalkHealth.summary(10, null, 65.0).kcal, WalkHealth.summary(10, Double.NaN, 65.0).kcal)
        assertEquals(WalkHealth.summary(10, null, 65.0).kcal, WalkHealth.summary(10, Double.POSITIVE_INFINITY, 65.0).kcal)
    }

    // 음식 비유: 비율 최근접, 상단 초과는 n단위, 하단 미달은 침묵.
    @Test fun `음식 비유는 비율 최근접`() {
        assertEquals(food("kimchi", 1), WalkHealth.foodComparison(19))
        assertEquals(food("tangerine", 1), WalkHealth.foodComparison(33))
        assertEquals(food("apple", 1), WalkHealth.foodComparison(90))
        assertEquals(food("riceBowl", 1), WalkHealth.foodComparison(300))
    }

    @Test fun `사다리 위는 최상단 항목 n단위`() {
        assertEquals(food("ramyeon", 2), WalkHealth.foodComparison(1000))
        assertEquals(food("ramyeon", 1), WalkHealth.foodComparison(700))
    }

    @Test fun `최하단 절반 미만은 null`() {
        assertNull(WalkHealth.foodComparison(0))
        assertNull(WalkHealth.foodComparison(1))
        assertEquals(food("cherryTomato", 1), WalkHealth.foodComparison(2))
    }

    @Test fun `사다리는 오름차순이고 키가 유일하다`() {
        val kcals = WalkHealth.foodLadder.map { it.kcal }
        assertEquals(kcals.sorted(), kcals)
        assertEquals(kcals.size, WalkHealth.foodLadder.map { it.key }.toSet().size)
    }

    // ── 체중 입력 권유의 무시 상한(E31) — 경계는 리터럴로 적는다(상수를 쓰면 변경 감지기가 되지 못한다) ──

    @Test fun `권유는 무시 상한까지 뜬다`() {
        assertTrue(WalkHealth.shouldShowWeightPrompt(true, 0))
        assertTrue(WalkHealth.shouldShowWeightPrompt(true, 1))
        assertFalse(WalkHealth.shouldShowWeightPrompt(true, 2))
        assertFalse(WalkHealth.shouldShowWeightPrompt(true, 5))
    }

    @Test fun `체중을 입력했으면 권유가 없다`() {
        for (d in listOf(0, 1, 2, 9)) assertFalse(WalkHealth.shouldShowWeightPrompt(false, d))
    }

    @Test fun `표시된 권유를 행동 없이 닫으면 센다`() {
        assertEquals(1, WalkHealth.nextWeightPromptDismissals(0, promptShown = true, promptEngaged = false))
        assertEquals(2, WalkHealth.nextWeightPromptDismissals(1, promptShown = true, promptEngaged = false))
    }

    @Test fun `권유가 화면에 있었을 때만 센다`() {
        for (c in listOf(0, 1, 2)) assertEquals(c, WalkHealth.nextWeightPromptDismissals(c, promptShown = false, promptEngaged = false))
    }

    @Test fun `체중 입력하기를 누른 화면의 닫기는 무시가 아니다`() {
        assertEquals(0, WalkHealth.nextWeightPromptDismissals(0, promptShown = true, promptEngaged = true))
        assertEquals(1, WalkHealth.nextWeightPromptDismissals(1, promptShown = true, promptEngaged = true))
    }

    @Test fun `두 억제자가 동시에 참이어도 세지 않는다`() {
        assertEquals(1, WalkHealth.nextWeightPromptDismissals(1, promptShown = false, promptEngaged = true))
    }

    @Test fun `무시 횟수는 상한에서 멈춘다`() {
        var count = 0
        repeat(5) {
            val shown = WalkHealth.shouldShowWeightPrompt(true, count)
            count = WalkHealth.nextWeightPromptDismissals(count, promptShown = shown, promptEngaged = false)
        }
        assertEquals(WalkHealth.maxWeightPromptDismissals, count)
        assertFalse(WalkHealth.shouldShowWeightPrompt(true, count))
    }

    /** A39: 설정 입력의 세 결과를 가른다. 종전엔 범위 밖이 조용히 0(미입력)이 되어 "저장됨"과 "무시됨"이 뭉개졌다. */
    @Test fun `체중 커밋은 세 결과로 갈린다`() {
        assertEquals(WalkHealth.WeightCommitOutcome.Clear, WalkHealth.weightCommit(""))
        assertEquals(WalkHealth.WeightCommitOutcome.Clear, WalkHealth.weightCommit("   "))
        assertEquals(WalkHealth.WeightCommitOutcome.Store(65.0), WalkHealth.weightCommit("65"))
        assertEquals(WalkHealth.WeightCommitOutcome.Store(65.5), WalkHealth.weightCommit("65.5"))
        // 쉼표 소수점 로케일(fr·it·es 키패드) — 판정과 같은 자리에서 흡수한다.
        assertEquals(WalkHealth.WeightCommitOutcome.Store(62.5), WalkHealth.weightCommit("62,5"))
        // 경계는 포함(weightRange는 닫힌 구간이다).
        assertEquals(WalkHealth.WeightCommitOutcome.Store(20.0), WalkHealth.weightCommit("20"))
        assertEquals(WalkHealth.WeightCommitOutcome.Store(300.0), WalkHealth.weightCommit("300"))
        for (text in listOf("5", "500", "0", "-10", "abc", "nan", "1e400")) {
            assertEquals(WalkHealth.WeightCommitOutcome.Reject, WalkHealth.weightCommit(text), text)
        }
        // JVM 파서만 받는 꼴은 Swift `Double(String)`처럼 거절한다.
        for (text in listOf("65d", "65f", "65\n")) {
            assertEquals(WalkHealth.WeightCommitOutcome.Reject, WalkHealth.weightCommit(text), text)
        }
    }
}
