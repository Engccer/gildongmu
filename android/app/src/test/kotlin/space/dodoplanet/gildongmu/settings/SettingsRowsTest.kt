package space.dodoplanet.gildongmu.settings

import kotlin.test.Test
import kotlin.test.assertEquals

/** spec §14-1 — 행 목록(논리 항목)은 순수 함수: 정식판 5·실험판 6(결과 진동은 받아쓰기 뒤). */
class SettingsRowsTest {
    @Test fun `정식판 5행, 실험판은 받아쓰기 뒤에 결과 진동이 들어 6행`() {
        assertEquals(listOf(SettingsRow.Language, SettingsRow.Dictation, SettingsRow.DataSources, SettingsRow.PrivacyPolicy, SettingsRow.ReportProblem), settingsRows(false))
        assertEquals(listOf(SettingsRow.Language, SettingsRow.Dictation, SettingsRow.ResultHaptics, SettingsRow.DataSources, SettingsRow.PrivacyPolicy, SettingsRow.ReportProblem), settingsRows(true))
    }
}
