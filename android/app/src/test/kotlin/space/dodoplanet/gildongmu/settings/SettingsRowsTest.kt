package space.dodoplanet.gildongmu.settings

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** spec §14-1 — 행 목록(논리 항목)은 순수 함수(iOS `SettingsView` 순서), 진입 착지 대상도 순수. */
class SettingsRowsTest {
    @Test fun `정식판 9행 iOS 순서, 실험판은 듣기 속도 뒤에 결과 진동이 들어 10행`() {
        val release = listOf(
            SettingsRow.Theme, SettingsRow.Language, SettingsRow.Dictation, SettingsRow.ListenSpeed, SettingsRow.Weight,
            SettingsRow.AiConsent, SettingsRow.PrivacyPolicy, SettingsRow.ReportProblem, SettingsRow.DataSources,
        )
        assertEquals(release, settingsRows(false))
        assertEquals(release.toMutableList().apply { add(indexOf(SettingsRow.Weight), SettingsRow.ResultHaptics) }, settingsRows(true))
    }

    @Test fun `진입 착지 — 정보 출처 복귀가 먼저, focusRow는 첫 진입 한 번만, 그 밖은 제목(null)`() {
        assertNull(settingsEntryTarget(returnKey = null, focusRow = null, focusRowConsumed = false))
        assertEquals(SettingsRow.Weight, settingsEntryTarget(returnKey = null, focusRow = SettingsRow.Weight, focusRowConsumed = false))
        assertNull(settingsEntryTarget(returnKey = null, focusRow = SettingsRow.Weight, focusRowConsumed = true)) // 언어 변경 재생성
        assertEquals(SettingsRow.DataSources, settingsEntryTarget(returnKey = DATA_SOURCES_RETURN_KEY, focusRow = SettingsRow.Weight, focusRowConsumed = false))
        assertNull(settingsEntryTarget(returnKey = "other", focusRow = null, focusRowConsumed = false))
    }
}
