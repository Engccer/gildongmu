package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** G4② — 업데이트 이력이 설치된 빌드보다 높은 버전을 보여 주지 않는다. Kit `AppVersionTests` 미러. */
class AppVersionTest {
    @Test
    fun `컴포넌트 수가 달라도 같은 버전이다`() {
        assertEquals(0, compareVersionStrings("1.7", "1.7.0"))
        assertTrue(isReleaseNoteVisible("1.7", "1.7.0"))
    }

    @Test
    fun `사전순이 아니라 수치로 비교한다`() {
        assertTrue(compareVersionStrings("1.10", "1.9") > 0)
        assertFalse(isReleaseNoteVisible("1.10", "1.9.0"))
    }

    @Test
    fun `미출시 버전은 감춘다`() {
        assertFalse(isReleaseNoteVisible("1.8", "1.7.0"))
        assertFalse(isReleaseNoteVisible("1.7.1", "1.7.0"))
    }

    @Test
    fun `지난 버전은 보인다`() {
        assertTrue(isReleaseNoteVisible("1.6", "1.7.0"))
        assertTrue(isReleaseNoteVisible("1.0", "1.7.0"))
    }

    @Test
    fun `앱 버전을 모르면 거르지 않는다`() {
        assertTrue(isReleaseNoteVisible("9.9", null))
        assertTrue(isReleaseNoteVisible("9.9", ""))
    }

    @Test
    fun `숫자가 아닌 꼬리는 앞쪽 숫자만 읽는다`() {
        assertEquals(0, compareVersionStrings("1.7-beta", "1.7"))
        assertTrue(compareVersionStrings("1.8-beta", "1.7") > 0)
    }
}
