package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** 웹 `clinic-kind.test.ts`·Kit `ClinicKindTests` 미러 — 두 값만 키, 그 밖은 null. */
class ClinicKindTest {
    @Test fun clinicKindKeyMapsOnlyTwoValues() {
        assertEquals("clinic", clinicKindKey("의원"))
        assertEquals("hospital", clinicKindKey(" 병원 "))
        assertNull(clinicKindKey("종합병원"))
        assertNull(clinicKindKey("보건소"))
        assertNull(clinicKindKey(""))
    }
}
