package space.dodoplanet.gildongmu.chat

import kotlin.test.Test
import kotlin.test.assertEquals

/** 블록 인라인 마크다운 걷기(spec §3-5). 기호가 남으면 TalkBack·점자가 별표를 그대로 읽는다. */
class ChatInlineTest {
    private fun t(s: String) = chatInlineText(s)

    @Test fun `굵게 두 꼴은 기호를 걷고 구간을 남긴다`() {
        val r = t("**강남역** 근처 __카페__")
        assertEquals("강남역 근처 카페", r.plain)
        assertEquals(listOf(0..2, 7..8), r.bold)
    }

    @Test fun `고정폭은 구간을 남기고 취소선·링크는 기호만 걷는다`() {
        val code = t("`2호선` A12")
        assertEquals("2호선 A12", code.plain)
        assertEquals(listOf(0..2), code.code)
        assertEquals("폐업", t("~~폐업~~").plain)
        assertEquals("안내 보기", t("[안내](https://x.test) 보기").plain)
    }

    @Test fun `굵게 안의 고정폭 구간은 바깥 기준으로 옮겨진다`() {
        val r = t("앞 **`A`출구**")
        assertEquals("앞 A출구", r.plain)
        assertEquals(listOf(2..4), r.bold)
        assertEquals(listOf(2..2), r.code)
    }

    @Test fun `기울임은 기호 안쪽이 공백이 아닐 때만 걷는다`() {
        assertEquals("아주 좋음", t("아주 *좋음*").plain)
        assertEquals("2 * 3 * 4", t("2 * 3 * 4").plain)
    }

    @Test fun `밑줄 한 개는 걷지 않는다(snake_case)`() {
        assertEquals("get_weather_now", t("get_weather_now").plain)
    }

    @Test fun `이스케이프는 역슬래시만 걷는다`() {
        assertEquals("*별표*", t("""\*별표\*""").plain)
    }

    @Test fun `짝 없는 기호는 원문 그대로`() {
        assertEquals("**미완", t("**미완").plain)
        assertEquals("`열린 코드", t("`열린 코드").plain)
        assertEquals("[라벨 없음", t("[라벨 없음").plain)
    }

    @Test fun `목록 표지는 건드리지 않는다`() {
        assertEquals("1. 역 출구", t("1. **역** 출구").plain)
        assertEquals("• 역", t("• 역").plain)
    }

    @Test fun `굵은 기울임 세 글자 표지도 기호를 모두 걷는다`() {
        val r = t("***강조***")
        assertEquals("강조", r.plain)
        assertEquals(listOf(0..1), r.bold)
    }

    @Test fun `링크가 아닌 대괄호 뒤에 링크가 와도 괄호를 뭉개지 않는다`() {
        assertEquals("[참고] 서울역 안내", t("[참고] 서울역 [안내](https://x.test)").plain)
    }

    @Test fun `빈 강조는 기호 그대로`() {
        assertEquals("****", t("****").plain)
    }
}
