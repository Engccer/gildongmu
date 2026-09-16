package space.dodoplanet.gildongmu.chat

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.headingText
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.KeyValueStore
import space.dodoplanet.gildongmu.nav.tryStartActivity

/**
 * AI 채팅 데이터 전송 동의(iOS `AIChatConsent` 미러, spec §3-2). 미결정·거부를 구분하지 않는다 — 어느 쪽이든 동의 화면을 보인다.
 * 앱에 하나(탭·장소 화면이 같은 `StateFlow`를 본다). 실험판·정식판은 applicationId가 달라 저장이 자동으로 갈린다.
 */
class ChatConsentStore(private val store: KeyValueStore, private val io: CoroutineDispatcher = Dispatchers.IO) {
    private val _granted = MutableStateFlow<Boolean?>(null)

    /** null = 아직 읽지 않음(화면은 동의 본문도 대화도 그리지 않는다 — 동의 전 화면이 한 프레임 번쩍이지 않게). */
    val granted: StateFlow<Boolean?> = _granted.asStateFlow()

    /** 첫 읽기는 IO에서(저장소 계약 — `SharedPreferences` 첫 접근은 디스크 로드). 이미 알면 즉시 반환. */
    suspend fun ensureLoaded() {
        if (_granted.value != null) return
        val stored = withContext(io) { store.getString(KEY) == "true" }
        _granted.compareAndSet(null, stored)
    }

    fun grant() {
        _granted.value = true
        store.putString(KEY, "true")
    }

    companion object {
        const val KEY = "aiChatConsent"
    }
}

/**
 * 인라인 동의 본문(iOS `ChatConsentView` 미러, spec §3-2). 시트·팝업이 아니라 인라인이라 포커스가 예측 가능하다.
 * 개인정보 처리방침을 열 앱이 없으면 통지 줄로 알린다.
 */
@Composable
fun ChatConsentContent(notice: Notice, onAgree: () -> Unit, onNoApp: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val res = context.resources
    val noApp = stringResource(R.string.android_common_noAppToOpen)
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .semantics { testTagsAsResourceId = true },
    ) {
        Text(
            stringResource(R.string.android_chat_consentTitle),
            Modifier.fillMaxWidth().mergedRow("consent-title").headingText().padding(vertical = 8.dp),
            style = MaterialTheme.typography.titleMedium,
        )
        for ((id, tag) in listOf(
            R.string.android_chat_consentData to "consent-data",
            R.string.android_chat_consentAiNotice to "consent-ai",
            R.string.android_chat_consentAlt to "consent-alt",
        )) {
            Text(stringResource(id), Modifier.fillMaxWidth().mergedRow(tag).padding(vertical = 8.dp))
        }
        OutlinedButton(
            onClick = {
                val uri = Uri.parse("${AppConfig.API_BASE_URL}/${AppLocale.current(res)}/privacy")
                if (!context.tryStartActivity(Intent(Intent.ACTION_VIEW, uri))) onNoApp(noApp)
            },
            modifier = Modifier.tapTarget().testTag("consent-privacy"),
        ) { Text(stringResource(R.string.android_common_privacyPolicy)) }
        Button(onClick = onAgree, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).tapTarget().testTag("consent-agree")) {
            Text(stringResource(R.string.android_chat_consentAgree))
        }
        StatusLine(notice, Modifier.padding(vertical = 8.dp))
    }
}
