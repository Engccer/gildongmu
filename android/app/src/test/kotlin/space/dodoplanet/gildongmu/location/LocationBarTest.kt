package space.dodoplanet.gildongmu.location

import space.dodoplanet.gildongmu.kit.ManualFix
import space.dodoplanet.gildongmu.kit.ManualLocation
import space.dodoplanet.gildongmu.kit.ManualVerdict
import kotlin.test.Test
import kotlin.test.assertEquals

/** spec §12-4·§13-4 표시줄 문장 — 수동 > GPS 갈래(권한 → 확정 실패 → 좌표 → 주소; 판정 29), 꼬리 "위치 지정하기", 병기. */
class LocationBarTest {
    private val w = LocationBarWords(
        "위치 권한이 필요합니다", "정확한 위치가 꺼져 있습니다", "현재 위치", { "현재 위치($it 부근)" }, "확인 중", "위치 확인 실패",
        { "지정한 위치, $it" }, { "지정한 위치, $it(위치 확인 불가)" }, "위치 지정하기",
    )
    private fun label(i: LocationBarInput, lang: String = "ko", manual: ManualLocation? = null, verdict: ManualVerdict? = null) = locationBarLabel(i, manual, verdict, lang, w)
    private val fine = LocationBarInput(LocationPermission.Fine, true, false, "천호대로 1", "1 Cheonho-daero")
    private fun manual(origin: ManualFix? = ManualFix(37.5, 127.1, 20.0, 1.0), roman: String? = null) = ManualLocation(1, "길동역", roman, 37.5, 127.1, origin, 1.0)

    @Test fun `권한 없음은 실패가 아니라 권한 필요 — 좌표·실패 표식보다 먼저`() {
        assertEquals("위치 권한이 필요합니다, 위치 지정하기", label(LocationBarInput(LocationPermission.None, true, true, "길동", null)).visual)
        assertEquals("위치 권한이 필요합니다, 위치 지정하기", label(LocationBarInput(LocationPermission.None, false, false, null, null)).visual)
    }

    @Test fun `Coarse는 시도 여부와 무관하게 정확한 위치 꺼짐(표시용 좌표는 Fine에서만 시도 — 확인 중에 갇히지 않는다)`() {
        assertEquals("정확한 위치가 꺼져 있습니다, 위치 지정하기", label(LocationBarInput(LocationPermission.Coarse, false, false, null, null)).visual)
        assertEquals("정확한 위치가 꺼져 있습니다, 위치 지정하기", label(LocationBarInput(LocationPermission.Coarse, true, true, "길동", null)).visual)
    }

    @Test fun `Fine — 확정 실패·확인 중·좌표·주소, 모두 꼬리 위치 지정하기`() {
        assertEquals("위치 확인 실패, 위치 지정하기", label(LocationBarInput(LocationPermission.Fine, false, true, null, null)).visual)
        assertEquals("확인 중, 위치 지정하기", label(LocationBarInput(LocationPermission.Fine, false, false, null, null)).visual)
        assertEquals("현재 위치, 위치 지정하기", label(LocationBarInput(LocationPermission.Fine, true, false, null, null)).visual)
        assertEquals("현재 위치, 위치 지정하기", label(LocationBarInput(LocationPermission.Fine, true, true, null, null)).visual) // 직전 좌표가 있으면 이번 soft 실패는 유지
        val near = label(LocationBarInput(LocationPermission.Fine, true, false, "천호대로 1", null))
        assertEquals("현재 위치(천호대로 1 부근), 위치 지정하기", near.visual); assertEquals(near.visual, near.spoken)
    }

    @Test fun `비-ko 주소 병기 — 시각은 영문 (한글), 낭독은 영문만`() {
        val en = label(fine, "en")
        assertEquals("현재 위치(1 Cheonho-daero (천호대로 1) 부근), 위치 지정하기", en.visual)
        assertEquals("현재 위치(1 Cheonho-daero 부근), 위치 지정하기", en.spoken)
        assertEquals("현재 위치(천호대로 1 부근), 위치 지정하기", label(fine, "ko").visual)
    }

    @Test fun `수동이 GPS 갈래를 이긴다 — 검증 가능형은 origin이 있고 판정이 undecidable이 아닐 때, 나머지는 위치 확인 불가`() {
        assertEquals("지정한 위치, 길동역, 위치 지정하기", label(fine, manual = manual(), verdict = null).visual) // 지정 직후(판정 전)
        assertEquals("지정한 위치, 길동역, 위치 지정하기", label(fine, manual = manual(), verdict = ManualVerdict.keep).visual)
        assertEquals("지정한 위치, 길동역(위치 확인 불가), 위치 지정하기", label(fine, manual = manual(), verdict = ManualVerdict.undecidable).visual)
        assertEquals("지정한 위치, 길동역(위치 확인 불가), 위치 지정하기", label(fine, manual = manual(origin = null), verdict = null).visual)
        // 권한 없음·실패 표식이 서 있어도 수동이면 수동 문장(표시줄은 이 화면의 조회 기준을 말한다)
        assertEquals("지정한 위치, 길동역, 위치 지정하기", label(LocationBarInput(LocationPermission.None, false, true, null, null), manual = manual()).visual)
    }

    @Test fun `수동 비-ko 병기 — 시각은 로마자 (한글), 낭독은 로마자만, 로마자 없으면 한글 그대로`() {
        val en = label(fine, "en", manual = manual(roman = "Gildong Station"))
        assertEquals("지정한 위치, Gildong Station (길동역), 위치 지정하기", en.visual)
        assertEquals("지정한 위치, Gildong Station, 위치 지정하기", en.spoken)
        val plain = label(fine, "en", manual = manual(roman = null))
        assertEquals("지정한 위치, 길동역, 위치 지정하기", plain.visual); assertEquals(plain.visual, plain.spoken)
        assertEquals("지정한 위치, 길동역, 위치 지정하기", label(fine, "ko", manual = manual(roman = "Gildong Station")).visual) // ko는 로마자를 쓰지 않는다
    }

    @Test fun `manualLocationLabel — 길찾기 출발지 필드와 표시줄이 같은 문장을 낸다`() {
        val m = manual(roman = "Gildong Station")
        assertEquals("지정한 위치, Gildong Station", manualLocationLabel(m, ManualVerdict.keep, "en", accessible = true, w.manual, w.manualUnverifiable))
        assertEquals("지정한 위치, Gildong Station (길동역)(위치 확인 불가)", manualLocationLabel(m, ManualVerdict.undecidable, "en", accessible = false, w.manual, w.manualUnverifiable))
    }
}
