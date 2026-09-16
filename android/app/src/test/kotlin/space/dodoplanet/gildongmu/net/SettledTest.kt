package space.dodoplanet.gildongmu.net

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** README §3 — `settled`는 취소를 재던지고 그 밖 예외만 `Result.failure`로 접는다(`runCatching` 금지 계약). */
class SettledTest {
    @Test fun `취소는 삼키지 않고 예외는 값으로`() = runTest {
        assertFailsWith<CancellationException> { settled { throw CancellationException("떠남") } }
        assertTrue(settled { throw IllegalStateException("x") }.isFailure)
        assertEquals(3, settled { 3 }.getOrNull())
    }
}
