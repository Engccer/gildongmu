package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/** Swift 표준 라이브러리 의미 미러 계약. 소비자가 음수·줄바꿈을 넘겨도 경계가 흔들리지 않게 잠근다. */
class SwiftSemanticsTest {
    @Test fun `점5는 0에서 먼 쪽이다 — 짝수 반올림도 양의 방향 반올림도 아니다`() {
        assertEquals(3.0, 2.5.roundedAwayFromZero())
        assertEquals(-3.0, (-2.5).roundedAwayFromZero())
        assertEquals(1.0, 0.5.roundedAwayFromZero())
        assertEquals(-1.0, (-0.5).roundedAwayFromZero())
    }

    @Test fun `부동소수 경계 — 0점5 바로 아래와 큰 정수`() {
        assertEquals(0.0, 0.49999999999999994.roundedAwayFromZero())
        assertEquals(1e16, 1e16.roundedAwayFromZero())
        assertEquals(302.0, 302.4.roundedAwayFromZero())
    }

    @Test fun `공백 trim은 탭과 공백 구분자만 자르고 줄바꿈은 남긴다`() {
        assertEquals("65", " \t65\t ".trimSwiftWhitespaces())
        assertEquals("65\n", "65\n".trimSwiftWhitespaces())
        assertEquals("65", "\u300065\u00A0".trimSwiftWhitespaces())
    }

    @Test fun `공백·줄바꿈 trim은 U+0085를 자르고 정보 분리 문자 U+001C~U+001F는 남긴다`() {
        assertEquals("3", "\n\u0085\u2028 3\r\u2029\u000B".trimSwiftWhitespacesAndNewlines())
        assertEquals("\u001F3\u001C", "\u001F3\u001C".trimSwiftWhitespacesAndNewlines())
        assertEquals("", "\u0085".trimSwiftWhitespacesAndNewlines())
    }
}
