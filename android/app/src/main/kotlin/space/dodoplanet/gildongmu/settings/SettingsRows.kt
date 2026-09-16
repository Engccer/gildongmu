package space.dodoplanet.gildongmu.settings

/** 설정 화면의 논리 항목(iOS `SettingsView` 순서, spec §14-1). 테마·듣기 속도·체중·AI 동의는 소비 마일스톤이 더한다(판정 41). */
enum class SettingsRow { Language, Dictation, ResultHaptics, DataSources, PrivacyPolicy, ReportProblem }

/** 순수 — 실험판에만 결과 진동 행(받아쓰기 뒤). 정식판 5·실험판 6. */
fun settingsRows(experimental: Boolean): List<SettingsRow> = buildList {
    add(SettingsRow.Language)
    add(SettingsRow.Dictation)
    if (experimental) add(SettingsRow.ResultHaptics)
    add(SettingsRow.DataSources)
    add(SettingsRow.PrivacyPolicy)
    add(SettingsRow.ReportProblem)
}
