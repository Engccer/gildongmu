package space.dodoplanet.gildongmu.chat

import android.Manifest
import android.content.pm.PackageManager
import android.content.res.Resources
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.location.appDetailsSettingsIntent
import space.dodoplanet.gildongmu.nav.tryStartActivity
import space.dodoplanet.gildongmu.speech.DictationFailure
import space.dodoplanet.gildongmu.speech.DictationNotice
import space.dodoplanet.gildongmu.speech.DictationPhase
import space.dodoplanet.gildongmu.speech.DictationSession
import space.dodoplanet.gildongmu.speech.dictationSessionOrNull
import space.dodoplanet.gildongmu.speech.speechLanguageTag

/**
 * 받아쓰기 세션을 이 화면 컴포지션에 둔다(spec §6). 게이트(API 33·온디바이스) 미충족이면 null = 버튼 0.
 * 화면이 떠나면 마이크를 폐기하고(탭 전환·pop), 구성 변경(회전 등 재생성)이면 정상 정지로 누적분을 살아남는 초안에 넘긴다.
 */
@Composable
fun rememberDictation(onTranscript: (String) -> Unit, onNotice: (DictationNotice) -> Unit): DictationSession? {
    val context = LocalContext.current
    val activity = LocalActivity.current
    val latestTranscript by rememberUpdatedState(onTranscript)
    val latestNotice by rememberUpdatedState(onNotice)
    val session = remember {
        dictationSessionOrNull(
            context,
            languageTag = { speechLanguageTag(AppLocale.current(context.resources)) },
            onTranscript = { latestTranscript(it) },
            onNotice = { latestNotice(it) },
        )
    } ?: return null
    DisposableEffect(session) {
        onDispose { if (activity?.isChangingConfigurations == true) session.detach() else session.dispose() }
    }
    return session
}

/**
 * 받아쓰기 버튼(탭 토글, 헌장 §6 ⓐ — 라벨 전환이 상태 신호, `enabled = false` 금지) + 거부 상태에서만 설정 열기.
 * 권한은 비활성 세션에서 누를 때 묻는다(허용 → 시작, 거부 → Denied 통지).
 */
@Composable
fun DictationControls(session: DictationSession, onNoApp: () -> Unit) {
    val context = LocalContext.current
    val phase by session.phase.collectAsState()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) session.toggle() else session.markDenied()
    }
    val label = when (phase) {
        DictationPhase.Preparing -> stringResource(R.string.android_voice_preparing)
        DictationPhase.Listening -> stringResource(R.string.voice_stop)
        else -> stringResource(R.string.android_voice_start)
    }
    OutlinedButton(
        onClick = {
            val idle = phase == DictationPhase.Idle || phase == DictationPhase.Denied
            if (!idle || context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                session.toggle()
            } else {
                launcher.launch(Manifest.permission.RECORD_AUDIO)
            }
        },
        modifier = Modifier.tapTarget().testTag("chat-dictation"),
    ) { Text(label) }
    if (phase == DictationPhase.Denied) {
        OutlinedButton(
            onClick = { if (!context.tryStartActivity(appDetailsSettingsIntent(context))) onNoApp() },
            modifier = Modifier.tapTarget().testTag("chat-dictation-settings"),
        ) { Text(stringResource(R.string.android_common_openSettings)) }
    }
}

/** 받아쓰기 안내 → 통지 문장(리터럴 매핑). 실패는 사용자가 다음에 할 일이 달라 종류별로 가른다(iOS `speechAlertText` 미러). */
fun dictationNoticeText(res: Resources, notice: DictationNotice): String = res.getString(
    when (notice) {
        DictationNotice.DownloadRequested -> R.string.android_voice_downloadRequested
        DictationNotice.DownloadReady -> R.string.android_voice_downloadReady
        DictationNotice.DownloadFailed -> R.string.android_voice_errorDownload
        DictationNotice.Denied -> R.string.android_voice_denied
        is DictationNotice.Failure -> when (notice.kind) {
            DictationFailure.StartFailed -> R.string.android_voice_failed
            DictationFailure.Interrupted -> R.string.voice_errors_stt_failed
            DictationFailure.Locale -> R.string.android_voice_errorLocale
            DictationFailure.OnDevice -> R.string.android_voice_errorOnDevice
            DictationFailure.Audio -> R.string.android_voice_errorAudio
        }
    },
)
