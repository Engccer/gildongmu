package space.dodoplanet.gildongmu.location

import kotlin.test.Test
import kotlin.test.assertEquals

/** spec §12-4 표시줄 문장 — 권한 → 확정 실패 → 좌표 → 주소(판정 29: None은 권한 필요, Coarse는 정확한 위치 꺼짐). */
class LocationBarTest {
    private fun label(i: LocationBarInput, lang: String = "ko") =
        locationBarLabel(i, lang, "위치 권한이 필요합니다", "정확한 위치가 꺼져 있습니다", "현재 위치", { "현재 위치($it 부근)" }, "확인 중", "위치 확인 실패")

    @Test fun `권한 없음은 실패가 아니라 권한 필요 — 좌표·실패 표식보다 먼저`() {
        assertEquals("위치 권한이 필요합니다", label(LocationBarInput(LocationPermission.None, true, true, "길동", null)).visual)
        assertEquals("위치 권한이 필요합니다", label(LocationBarInput(LocationPermission.None, false, false, null, null)).visual)
    }

    @Test fun `Coarse는 시도 여부와 무관하게 정확한 위치 꺼짐(표시용 좌표는 Fine에서만 시도 — 확인 중에 갇히지 않는다)`() {
        assertEquals("정확한 위치가 꺼져 있습니다", label(LocationBarInput(LocationPermission.Coarse, false, false, null, null)).visual)
        assertEquals("정확한 위치가 꺼져 있습니다", label(LocationBarInput(LocationPermission.Coarse, true, true, "길동", null)).visual)
    }

    @Test fun `Fine — 확정 실패·확인 중·좌표·주소`() {
        assertEquals("위치 확인 실패", label(LocationBarInput(LocationPermission.Fine, false, true, null, null)).visual)
        assertEquals("확인 중", label(LocationBarInput(LocationPermission.Fine, false, false, null, null)).visual)
        assertEquals("현재 위치", label(LocationBarInput(LocationPermission.Fine, true, false, null, null)).visual)
        assertEquals("현재 위치", label(LocationBarInput(LocationPermission.Fine, true, true, null, null)).visual) // 직전 좌표가 있으면 이번 soft 실패는 유지
        assertEquals("현재 위치(천호대로 1 부근)", label(LocationBarInput(LocationPermission.Fine, true, false, "천호대로 1", null)).visual)
    }

    @Test fun `비-ko 주소 병기 — 시각은 영문 (한글), 낭독은 영문만`() {
        val en = label(LocationBarInput(LocationPermission.Fine, true, false, "천호대로 1", "1 Cheonho-daero"), "en")
        assertEquals("현재 위치(1 Cheonho-daero (천호대로 1) 부근)", en.visual)
        assertEquals("현재 위치(1 Cheonho-daero 부근)", en.spoken)
        val ko = label(LocationBarInput(LocationPermission.Fine, true, false, "천호대로 1", "1 Cheonho-daero"), "ko")
        assertEquals("현재 위치(천호대로 1 부근)", ko.visual)
    }
}
