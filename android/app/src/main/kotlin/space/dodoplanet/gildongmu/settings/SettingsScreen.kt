package space.dodoplanet.gildongmu.settings

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.input.KeyboardType
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.WalkHealth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.AppNotices
import space.dodoplanet.gildongmu.a11y.AppScreenScaffold
import space.dodoplanet.gildongmu.a11y.HapticKind
import space.dodoplanet.gildongmu.a11y.LocalModalOpen
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.landingTarget
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.chat.ChatServices
import space.dodoplanet.gildongmu.kit.ListenSpeed
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.nav.tryStartActivity

/**
 * 설정 화면(spec §14, iOS `SettingsView` 미러): 행 목록은 순수 `settingsRows`, 값은 `AppConfig.settings`(단일 소유자), ViewModel 없음.
 * 각 행 한 객체("언어, 한국어"). 언어·받아쓰기는 같은 선택 다이얼로그(진입 착지 = 현재 선택 행, 닫히면 그 행으로 복귀).
 * 언어 적용: 저장 → `localizedApp` 무효화 → 앱 통지(새 언어 문장, `success`) → `recreate()` — 재생성 뒤 착지는 제목(`titleFocus`).
 * 링크 열기 실패는 화면 로컬 통지 `noAppToOpen`(화면 변화 없는 활성화는 통지가 유일한 증거).
 * 테마·듣기 속도도 같은 선택 다이얼로그다(테마는 `MainActivity`가 즉시 반영, 새 값은 복귀 착지한 행의 라벨이 말한다).
 * AI 채팅 동의는 스위치 행 — 끄면 채팅 화면이 다음 전송 전에 동의 본문으로 돌아간다(`ChatConsentStore.revoke`, iOS 5.1.2(i) 철회 경로).
 * `focusRow`는 첫 진입 착지 대상(`settingsEntryTarget`).
 * 묶음 다섯(일반·음성·길 안내·AI 채팅·앱 정보)은 묶음이 바뀌는 자리의 헤딩 한 줄로 드러난다(E59, iOS 섹션 머리말 미러).
 */
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onOpenDataSources: () -> Unit,
    takeReturnFocus: () -> String?,
    store: SettingsStore = AppConfig.settings,
    focusRow: SettingsRow? = null,
) {
    val context = LocalContext.current
    val res = context.resources
    val language by store.language.collectAsState()
    val dictation by store.dictationStyle.collectAsState()
    val haptics by store.resultHapticsEnabled.collectAsState()
    val theme by store.themePreference.collectAsState()
    val listenSpeed by store.listenSpeed.collectAsState()
    val consent = remember { ChatServices.get(context).consent }
    val aiConsent by consent.granted.collectAsState()
    LaunchedEffect(consent) { consent.ensureLoaded() } // 첫 읽기는 IO
    val weightStored by store.weightText.collectAsState()
    var weightText by remember(weightStored) { mutableStateOf(weightStored) }
    val weightMin = WalkHealth.weightRange.start.toInt()
    val weightMax = WalkHealth.weightRange.endInclusive.toInt()
    var dialog by rememberSaveable { mutableStateOf<SettingsRow?>(null) } // 회전·글꼴 변경에 열려 있던 다이얼로그가 소리 없이 닫히지 않게
    var pendingLanding by remember { mutableStateOf<SettingsRow?>(null) }
    var focusRowConsumed by rememberSaveable { mutableStateOf(false) } // 언어 변경 재생성 뒤 다시 그 행으로 끌려가지 않게
    var notice by remember { mutableStateOf(Notice(0, "")) }
    val titleFocus = remember { FocusRequester() }
    val rowFocus = remember { mutableMapOf<SettingsRow, FocusRequester>() }
    val rows = remember { settingsRows(AppConfig.resultHapticsSettingEnabled) }
    val noApp = stringResource(R.string.android_common_noAppToOpen)
    val systemLabel = stringResource(R.string.android_settings_themeSystem)
    val tapLabel = stringResource(R.string.android_settings_dictationTap)
    val holdLabel = stringResource(R.string.android_settings_dictationHold)
    val themeOptions = listOf(
        SettingsStore.THEME_SYSTEM to systemLabel,
        SettingsStore.THEME_LIGHT to stringResource(R.string.android_settings_themeLight),
        SettingsStore.THEME_DARK to stringResource(R.string.android_settings_themeDark),
    )
    val speedOptions = ListenSpeed.allowedSpeeds.map { it.toString() to stringResource(listenSpeedLabelId(it)) }
    // 링크 열기 실패 = 화면 변화 없는 활성화의 유일한 증거(통지) + 실패 진동(검색·내 주변 실패와 같은 채널)
    fun open(intent: Intent) { if (!context.tryStartActivity(intent)) notice = Notice(notice.seq + 1, noApp, haptic = HapticKind.failure) }
    // 체중 확정(A39 — 편집 종료·화면 이탈, 멱등): 범위 밖은 저장하지 않고 통지(이전 값이 있으면 그 값 유지를 말한다, 3-state).
    fun commitWeight() {
        if (weightText == weightStored) return
        when (store.commitWeight(weightText)) {
            is WalkHealth.WeightCommitOutcome.Store, WalkHealth.WeightCommitOutcome.Clear -> Unit
            WalkHealth.WeightCommitOutcome.Reject -> {
                val prior = weightStored
                notice = Notice(notice.seq + 1, if (prior.isEmpty()) appLocalized(res, R.string.android_settings_weightRejectedNone, weightMin, weightMax) else appLocalized(res, R.string.android_settings_weightRejected, weightMin, weightMax, prior))
                weightText = prior
            }
        }
    }
    DisposableEffect(Unit) { onDispose { commitWeight() } }

    // 진입·재생성·pop 복귀 착지(한 프레임 뒤): 정보 출처에서 돌아오면 그 행, 첫 진입의 `focusRow`면 그 행, 그 밖(push 진입·언어 변경 재생성)은 제목 헤딩.
    LaunchedEffect(Unit) {
        val key = takeReturnFocus()
        val row = settingsEntryTarget(key, focusRow, focusRowConsumed)
        focusRowConsumed = true
        withFrameNanos { }
        val target = row?.let { rowFocus[it] } ?: titleFocus
        runCatching { target.requestFocus() }.onFailure { Log.w("Settings", "착지 실패 $key", it) }
    }
    // 다이얼로그가 닫힌 뒤 복귀 착지 = 연 행
    LaunchedEffect(pendingLanding) {
        val row = pendingLanding ?: return@LaunchedEffect
        withFrameNanos { }
        runCatching { rowFocus[row]?.requestFocus() }.onFailure { Log.w("Settings", "복귀 착지 실패 $row", it) }
        pendingLanding = null
    }

    val languageValue = language?.let { stringResource(nativeNameId(it)) } ?: systemLabel
    val dictationValue = if (dictation == SettingsStore.DICTATION_HOLD) holdLabel else tapLabel
    val themeValue = themeOptions.first { it.first == theme }.second

    CompositionLocalProvider(LocalModalOpen provides (dialog != null)) {
        AppScreenScaffold(stringResource(R.string.android_settings_title), onBack = onBack, titleFocus = titleFocus) { padding ->
            Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).semantics { testTagsAsResourceId = true }) {
                StatusLine(notice, Modifier.padding(vertical = 8.dp)) // 상단 바 바로 아래(§3-1 — 자리를 외워 쓰는 탐색)
                for ((i, row) in rows.withIndex()) {
                    val focus = rowFocus.getOrPut(row) { FocusRequester() }
                    // 묶음이 바뀌는 자리에만 헤딩(E59) — 헤딩 이동으로 묶음 다섯을 차례로 건너뛴다.
                    if (i == 0 || rows[i - 1].group != row.group) GroupHeading(row.group)
                    when (row) {
                        SettingsRow.Theme -> ValueRow(joinText(stringResource(R.string.android_settings_theme), themeValue), "settings-theme", focus) { dialog = row }
                        SettingsRow.ListenSpeed -> ValueRow(joinText(stringResource(R.string.android_settings_listenSpeed), stringResource(listenSpeedLabelId(listenSpeed))), "settings-listenspeed", focus) { dialog = row }
                        // 읽는 중(null)엔 그리지 않는다 — "꺼짐"으로 보이고 읽히다 눌리면 이미 동의한 사용자의 뜻과 반대가 된다(3-state, 한 프레임 수준)
                        SettingsRow.AiConsent -> aiConsent?.let { granted ->
                            SwitchRow(stringResource(R.string.android_settings_aiConsentToggle), granted, "settings-aiconsent", focus) { on ->
                                if (on) consent.grant() else consent.revoke()
                            }
                        }
                        SettingsRow.Language -> ValueRow(joinText(stringResource(R.string.android_settings_language), languageValue), "settings-language", focus) { dialog = row }
                        SettingsRow.Dictation -> ValueRow(joinText(stringResource(R.string.android_settings_dictationStyle), dictationValue), "settings-dictation", focus) { dialog = row }
                        SettingsRow.ResultHaptics -> {
                            SwitchRow(stringResource(R.string.android_settings_trendHaptics), haptics, "settings-haptics", focus) { store.setResultHaptics(it) }
                            Text(stringResource(R.string.android_settings_resultHapticsFooter), Modifier.fillMaxWidth().mergedRow("settings-haptics-footer").padding(vertical = 8.dp))
                        }
                        SettingsRow.Weight -> {
                            OutlinedTextField(
                                value = weightText,
                                onValueChange = { weightText = it },
                                label = { Text(stringResource(R.string.android_settings_weightKg)) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.fillMaxWidth().testTag("settings-weight").landingTarget(focus).onFocusChanged { if (!it.isFocused) commitWeight() },
                            )
                            Text(appLocalized(res, R.string.android_settings_weightFooter, weightMin, weightMax), Modifier.fillMaxWidth().mergedRow("settings-weight-footer").padding(vertical = 8.dp))
                        }
                        SettingsRow.DataSources -> ValueRow(stringResource(R.string.dataSources_title), "settings-datasources", focus, onOpenDataSources)
                        SettingsRow.PrivacyPolicy -> ValueRow(stringResource(R.string.android_common_privacyPolicy), "settings-privacy", focus) {
                            open(Intent(Intent.ACTION_VIEW, Uri.parse("${AppConfig.API_BASE_URL}/${AppLocale.current(res)}/privacy")))
                        }
                        SettingsRow.ReportProblem -> ValueRow(stringResource(R.string.android_settings_reportProblem), "settings-report", focus) {
                            open(Intent(Intent.ACTION_SENDTO, Uri.parse(REPORT_MAILTO)))
                        }
                    }
                }
            }
        }
        when (dialog) {
            SettingsRow.Language -> ChoiceDialog(
                title = stringResource(R.string.android_settings_language),
                options = listOf(SYSTEM_LANGUAGE to systemLabel) + AppLocale.supported.map { it to stringResource(nativeNameId(it)) },
                selected = language ?: SYSTEM_LANGUAGE,
                onSelect = { key ->
                    dialog = null
                    val code = key.takeIf { it != SYSTEM_LANGUAGE }
                    if (code == language) {
                        pendingLanding = SettingsRow.Language
                    } else {
                        store.setLanguage(code) // 저장이 곧 `localizedApp` 무효화
                        AppNotices.post(AppConfig.localizedApp().getString(R.string.android_settings_languageApplied), haptic = HapticKind.success)
                        context.findActivity()?.recreate() ?: Log.w("Settings", "Activity 없음 — 언어 적용 재생성 미완(통지는 나갔다)")
                    }
                },
                onDismiss = { dialog = null; pendingLanding = SettingsRow.Language },
            )
            SettingsRow.Dictation -> ChoiceDialog(
                title = stringResource(R.string.android_settings_dictationStyle),
                options = listOf(SettingsStore.DICTATION_TAP to tapLabel, SettingsStore.DICTATION_HOLD to holdLabel),
                selected = dictation,
                onSelect = { key -> store.setDictationStyle(key); dialog = null; pendingLanding = SettingsRow.Dictation },
                onDismiss = { dialog = null; pendingLanding = SettingsRow.Dictation },
            )
            SettingsRow.Theme -> ChoiceDialog(
                title = stringResource(R.string.android_settings_theme),
                options = themeOptions,
                selected = theme,
                onSelect = { key -> store.setTheme(key); dialog = null; pendingLanding = SettingsRow.Theme },
                onDismiss = { dialog = null; pendingLanding = SettingsRow.Theme },
            )
            SettingsRow.ListenSpeed -> ChoiceDialog(
                title = stringResource(R.string.android_settings_listenSpeed),
                options = speedOptions,
                selected = listenSpeed.toString(),
                onSelect = { key -> key.toDoubleOrNull()?.let(store::setListenSpeed); dialog = null; pendingLanding = SettingsRow.ListenSpeed },
                onDismiss = { dialog = null; pendingLanding = SettingsRow.ListenSpeed },
            )
            else -> Unit
        }
    }
}

/** 묶음 헤딩(iOS 섹션 머리말 미러). 키보드 포커스를 받는 헤딩 — 한소네는 포커스로 이동하므로 비포커스 `Text`면 묶음 경계가 들리지 않는다(장소 상세·채팅 헤딩과 같은 관용구). */
@Composable
private fun GroupHeading(group: SettingsGroup) {
    val (tag, label) = when (group) {
        SettingsGroup.General -> "settings-heading-general" to R.string.android_settings_sectionGeneral
        SettingsGroup.Voice -> "settings-heading-voice" to R.string.android_settings_sectionVoice
        SettingsGroup.Guidance -> "settings-heading-guidance" to R.string.android_settings_sectionGuidance
        SettingsGroup.AiChat -> "settings-heading-aichat" to R.string.android_settings_aiSection
        SettingsGroup.About -> "settings-heading-about" to R.string.android_settings_sectionAbout
    }
    Text(stringResource(label), Modifier.fillMaxWidth().mergedRow(tag).headingText().padding(top = 16.dp, bottom = 4.dp), style = MaterialTheme.typography.titleMedium)
}

/** 값 있는 행 = 라벨과 값을 한 문장으로("언어, 한국어") — 한 줄 = 한 객체. */
@Composable
private fun ValueRow(text: String, tag: String, focus: FocusRequester, onClick: () -> Unit) {
    Text(
        text,
        Modifier
            .fillMaxWidth()
            .tapTarget()
            .testTag(tag)
            .landingTarget(focus)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 12.dp),
    )
}

/** 스위치 행 = 라벨 + 켬/끔 한 객체(`toggleable` 역할 Switch — 상태는 스위치 상태가 말한다). */
@Composable
private fun SwitchRow(label: String, checked: Boolean, tag: String, focus: FocusRequester, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .tapTarget()
            .testTag(tag)
            .landingTarget(focus)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = null)
    }
}

/** 배속 → 선택지 라벨(허용값 정본은 `ListenSpeed.allowedSpeeds`, 그 밖은 1배 — iOS `listenSpeedLabel` 동형). */
private fun listenSpeedLabelId(speed: Double): Int = when (speed) {
    1.5 -> R.string.android_settings_listenSpeed15x
    2.0 -> R.string.android_settings_listenSpeed2x
    else -> R.string.android_settings_listenSpeed1x
}

/** 자국어 표기는 기존 `nav_*` 6키(6로케일에서 값이 같다) — 리터럴 매핑. */
private fun nativeNameId(code: String): Int = when (code) {
    "ko" -> R.string.nav_korean
    "en" -> R.string.nav_english
    "es" -> R.string.nav_spanish
    "fr" -> R.string.nav_french
    "it" -> R.string.nav_italian
    "ja" -> R.string.nav_japanese
    else -> R.string.nav_korean
}

private fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

private const val SYSTEM_LANGUAGE = "system"
