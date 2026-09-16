package space.dodoplanet.gildongmu.speech

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DictationTest {
    @Test fun `33 미만은 프로브를 부르지도 않고 false`() {
        var probed = false
        assertFalse(isDictationAvailable(31) { probed = true; true })
        assertFalse(isDictationAvailable(32) { probed = true; true })
        assertFalse(probed)
    }

    @Test fun `33 이상은 온디바이스 프로브가 정한다`() {
        assertTrue(isDictationAvailable(33) { true })
        assertFalse(isDictationAvailable(35) { false })
    }
}
