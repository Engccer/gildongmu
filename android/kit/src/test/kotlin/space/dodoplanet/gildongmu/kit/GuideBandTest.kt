package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** 띠바 대중교통 요약 — Kit `GuideBandTests` 미러. */
class GuideBandTest {
    @Test fun `목적지 변경 대기가 최우선이다`() {
        assertEquals(GuideBandSummary.DestChangePending("학교"), guideBandSummary(TransitPhase.riding, "A", "2호선", 3, false, "학교"))
    }

    @Test fun `목적지 변경 실패는 대기와 구분된다`() {
        assertEquals(GuideBandSummary.DestChangeFailed("학교"), guideBandSummary(TransitPhase.riding, null, null, null, false, "학교", destChangeFailed = true))
    }

    @Test fun `핸드오프 제안은 state가 없어도 도착이다`() {
        assertEquals(GuideBandSummary.Arrived, guideBandSummary(null, null, null, null, true, null))
    }

    @Test fun `waiting과 boarding은 같은 대기 요약이다`() {
        for (phase in listOf(TransitPhase.waiting, TransitPhase.boarding)) {
            assertEquals(GuideBandSummary.Waiting("천호역", "5호선"), guideBandSummary(phase, "천호역", "5호선", null, false, null))
        }
    }

    @Test fun `riding은 잔여 수 유무를 보존한다`() {
        assertEquals(GuideBandSummary.Riding("370", 4), guideBandSummary(TransitPhase.riding, null, "370", 4, false, null))
        assertEquals(GuideBandSummary.Riding("370", null), guideBandSummary(TransitPhase.riding, null, "370", null, false, null))
    }

    @Test fun `도착 완료 국면은 arrived다`() {
        for (phase in listOf(TransitPhase.arrived, TransitPhase.done)) {
            assertEquals(GuideBandSummary.Arrived, guideBandSummary(phase, null, null, null, false, null))
        }
    }

    @Test fun `아무것도 없으면 null이다`() {
        assertNull(guideBandSummary(null, null, null, null, false, null))
    }
}
