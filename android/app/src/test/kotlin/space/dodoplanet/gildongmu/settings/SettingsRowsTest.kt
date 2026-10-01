package space.dodoplanet.gildongmu.settings

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** spec §14-1 — 행 목록(논리 항목)은 순수 함수(iOS `SettingsView` 순서), 진입 착지 대상도 순수. */
class SettingsRowsTest {
    @Test fun `정식판 9행 iOS 순서, 실험판은 체중 뒤에 결과 진동이 들어 10행`() {
        val release = listOf(
            SettingsRow.Theme, SettingsRow.Language, SettingsRow.Dictation, SettingsRow.ListenSpeed, SettingsRow.Weight,
            SettingsRow.AiConsent, SettingsRow.PrivacyPolicy, SettingsRow.ReportProblem, SettingsRow.DataSources,
        )
        assertEquals(release, settingsRows(false))
        assertEquals(release.toMutableList().apply { add(indexOf(SettingsRow.Weight) + 1, SettingsRow.ResultHaptics) }, settingsRows(true))
    }

    @Test fun `묶음 다섯이 판정 순서로 한 번씩 이어진다(E59) — 헤딩은 묶음이 바뀌는 자리에만`() {
        for (experimental in listOf(false, true)) {
            val runs = settingsRows(experimental).map { it.group }.fold(listOf<SettingsGroup>()) { acc, g -> if (acc.lastOrNull() == g) acc else acc + g }
            assertEquals(SettingsGroup.entries.toList(), runs) // 묶음이 쪼개지면 같은 헤딩이 두 번 나온다
        }
        assertEquals(SettingsGroup.Guidance, SettingsRow.Weight.group)
        assertEquals(SettingsGroup.Guidance, SettingsRow.ResultHaptics.group)
        assertEquals(SettingsGroup.AiChat, SettingsRow.ReportProblem.group)
    }

    @Test fun `진입 착지 — 정보 출처 복귀가 먼저, focusRow는 첫 진입 한 번만, 그 밖은 제목(null)`() {
        assertNull(settingsEntryTarget(returnKey = null, focusRow = null, focusRowConsumed = false))
        assertEquals(SettingsRow.Weight, settingsEntryTarget(returnKey = null, focusRow = SettingsRow.Weight, focusRowConsumed = false))
        assertNull(settingsEntryTarget(returnKey = null, focusRow = SettingsRow.Weight, focusRowConsumed = true)) // 언어 변경 재생성
        assertEquals(SettingsRow.DataSources, settingsEntryTarget(returnKey = DATA_SOURCES_RETURN_KEY, focusRow = SettingsRow.Weight, focusRowConsumed = false))
        assertNull(settingsEntryTarget(returnKey = "other", focusRow = null, focusRowConsumed = false))
    }
}
