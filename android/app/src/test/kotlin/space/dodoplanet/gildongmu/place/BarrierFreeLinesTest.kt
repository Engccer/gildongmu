package space.dodoplanet.gildongmu.place

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** spec §12-3 — 시설 라벨 27키 리터럴 `when` 전수(키 목록은 생성물 `strings.xml`에서 읽는다 — 미매핑 0), 미지 키는 null(서버 라벨 폴백). */
class BarrierFreeLinesTest {
    @Test fun `시설 키 27종 전수 매핑, 미지 키 null`() {
        val xml = Fixtures.repoRoot.resolve("android/app/src/main/res/values/strings.xml").readText()
        val keys = Regex("""name="barrierFreeInfo_facility_([a-z]+)"""").findAll(xml).map { it.groupValues[1] }.toList()
        assertEquals(27, keys.size)
        keys.forEach { assertNotNull(barrierFreeFacilityResId(it), "미매핑 키 $it") }
        assertNull(barrierFreeFacilityResId("teleport"))
    }
}
