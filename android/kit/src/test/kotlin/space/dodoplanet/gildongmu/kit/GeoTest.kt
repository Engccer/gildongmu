package space.dodoplanet.gildongmu.kit

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertTrue

class GeoTest {
    @Test
    fun `하버사인은 위도 1도를 약 111km로 잰다`() {
        val d = haversineMeters(37.0, 127.0, 38.0, 127.0)
        assertTrue(abs(d - 111_195) < 50, "$d")
    }

    @Test
    fun `방위각은 북 0 동 90 남 180 서 270`() {
        assertTrue(abs(bearingDegrees(37.5, 127.0, 37.6, 127.0) - 0) < 0.01)
        assertTrue(abs(bearingDegrees(37.5, 127.0, 37.5, 127.1) - 90) < 0.5)
        assertTrue(abs(bearingDegrees(37.5, 127.0, 37.4, 127.0) - 180) < 0.01)
        assertTrue(abs(bearingDegrees(37.5, 127.0, 37.5, 126.9) - 270) < 0.5)
    }
}
