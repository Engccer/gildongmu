package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 웹 `format.test.ts` normalizeVoiceQuery 블록 ↔ Kit `VoiceQueryTests` 미러. */
class VoiceQueryTest {
    @Test fun `후행 마침표를 제거한다`() {
        assertEquals("강동구 성내로 12", normalizeVoiceQuery("강동구 성내로 12."))
        assertEquals("서울 강동구 양재대로 1401", normalizeVoiceQuery("서울 강동구 양재대로 1401."))
    }

    @Test fun `물음표 느낌표 말줄임표와 연속 부호도 제거한다`() {
        assertEquals("강동구 맛집", normalizeVoiceQuery("강동구 맛집?"))
        assertEquals("길동역", normalizeVoiceQuery("길동역!"))
        assertEquals("천호동", normalizeVoiceQuery("천호동..."))
    }

    @Test fun `부호 뒤 공백까지 함께 제거한다`() {
        assertEquals("천호대로 1077", normalizeVoiceQuery("천호대로 1077.  "))
        assertEquals("강동구청", normalizeVoiceQuery("  강동구청  "))
    }

    @Test fun `부호와 공백이 섞인 꼬리도 한 번에 걷는다`() {
        assertEquals("강동구청", normalizeVoiceQuery("강동구청 . , "))
    }

    @Test fun `중간 문장부호는 보존한다`() {
        assertEquals("길동 442-1, 3층", normalizeVoiceQuery("길동 442-1, 3층."))
        assertEquals("S.M. 엔터테인먼트", normalizeVoiceQuery("S.M. 엔터테인먼트"))
    }

    @Test fun `부호를 지우면 빈 문자열이 되는 입력은 원문을 되돌린다`() {
        assertEquals(".", normalizeVoiceQuery("."))
        assertEquals("...", normalizeVoiceQuery("  ...  "))
    }

    @Test fun `부호가 없으면 그대로 통과한다`() {
        assertEquals("강동구 길동 맛집", normalizeVoiceQuery("강동구 길동 맛집"))
        assertEquals("", normalizeVoiceQuery(""))
    }
}

class SpeechContentTest {
    @Test fun `문장부호만 남은 전사는 내용 없음`() {
        assertFalse(hasSpeechContent("."))
        assertFalse(hasSpeechContent("..."))
        assertFalse(hasSpeechContent("?"))
        assertFalse(hasSpeechContent("。"))
        assertFalse(hasSpeechContent(". , !"))
    }

    @Test fun `공백뿐인 전사도 내용 없음`() {
        assertFalse(hasSpeechContent(""))
        assertFalse(hasSpeechContent("   "))
        assertFalse(hasSpeechContent("\n\t"))
    }

    @Test fun `글자나 숫자가 하나라도 있으면 내용 있음`() {
        assertTrue(hasSpeechContent("네."))
        assertTrue(hasSpeechContent("강동구청"))
        assertTrue(hasSpeechContent("12"))
        assertTrue(hasSpeechContent("ok"))
    }

    @Test fun `부호에 둘러싸인 한 글자도 발화로 인정한다`() {
        assertTrue(hasSpeechContent("응."))
        assertTrue(hasSpeechContent("...네..."))
    }
}
