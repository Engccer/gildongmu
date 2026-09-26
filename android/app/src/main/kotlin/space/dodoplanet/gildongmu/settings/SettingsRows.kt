package space.dodoplanet.gildongmu.settings

import kotlinx.serialization.Serializable

/** 설정 화면의 논리 항목(iOS `SettingsView` 순서, spec §14-1). 업데이트 이력은 안드로이드 출시 노트 정본이 없어 넣지 않는다(판정 43). 라우트 인자라 직렬화한다. */
@Serializable
enum class SettingsRow { Theme, Language, Dictation, ListenSpeed, ResultHaptics, Weight, AiConsent, PrivacyPolicy, ReportProblem, DataSources }

/** 순수 — iOS 순서: 테마 → 언어 → 받아쓰기 → 듣기 속도 → (실험판 결과 진동) → 체중 → AI 동의·개인정보 처리방침·문제 신고 → 정보 출처. 정식판 9·실험판 10. */
fun settingsRows(experimental: Boolean): List<SettingsRow> = buildList {
    add(SettingsRow.Theme)
    add(SettingsRow.Language)
    add(SettingsRow.Dictation)
    add(SettingsRow.ListenSpeed)
    if (experimental) add(SettingsRow.ResultHaptics)
    add(SettingsRow.Weight)
    add(SettingsRow.AiConsent)
    add(SettingsRow.PrivacyPolicy)
    add(SettingsRow.ReportProblem)
    add(SettingsRow.DataSources)
}

/**
 * 진입 착지 대상(순수, null = 제목 헤딩). 정보 출처에서 돌아오면 그 행이 먼저이고, 라우트의 `focusRow`(도착 화면 "체중 입력하기" 류)는
 * 첫 진입에서 한 번만 쓴다 — 언어 변경 재생성·pop 복귀에서 다시 그 행으로 끌려가지 않게(`focusRowConsumed`).
 */
fun settingsEntryTarget(returnKey: String?, focusRow: SettingsRow?, focusRowConsumed: Boolean): SettingsRow? = when {
    returnKey == DATA_SOURCES_RETURN_KEY -> SettingsRow.DataSources
    !focusRowConsumed -> focusRow
    else -> null
}
