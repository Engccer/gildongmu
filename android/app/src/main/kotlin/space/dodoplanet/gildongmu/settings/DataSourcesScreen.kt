package space.dodoplanet.gildongmu.settings

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.AppScreenScaffold
import space.dodoplanet.gildongmu.a11y.Notice
import space.dodoplanet.gildongmu.a11y.StatusLine
import space.dodoplanet.gildongmu.a11y.mergedRow
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.nav.tryStartActivity

/** 정보 출처 16행(iOS `DataSourcesView.sourceLabels` 순서 — `chat.source.osm`은 아래 라이선스 문장이 같은 이름을 말해 제외). */
private val SOURCE_IDS = listOf(
    R.string.chat_source_kakao, R.string.chat_source_tourapi, R.string.chat_source_juso, R.string.chat_source_seoulopen,
    R.string.chat_source_airkorea, R.string.chat_source_kma, R.string.chat_source_tago, R.string.chat_source_nmc,
    R.string.chat_source_kakaomobility, R.string.chat_source_ncp, R.string.chat_source_odsay, R.string.chat_source_tmap,
    R.string.chat_source_kric, R.string.chat_source_korail, R.string.chat_source_seoulmetro, R.string.chat_source_perplexity,
)

/** 정보 출처(spec §14-4, iOS `DataSourcesView` 미러): 출처 16행 + OSM 라이선스 문장 + 링크 2(실패는 로컬 통지 `noAppToOpen`). `walkHealth` 행은 M4. */
@Composable
fun DataSourcesScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    var notice by remember { mutableStateOf(Notice(0, "")) }
    val noApp = stringResource(R.string.android_common_noAppToOpen)
    fun open(intent: Intent) { if (!context.tryStartActivity(intent)) notice = Notice(notice.seq + 1, noApp) }
    AppScreenScaffold(stringResource(R.string.dataSources_title), onBack = onBack) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).semantics { testTagsAsResourceId = true }) {
            SOURCE_IDS.forEachIndexed { i, id -> Text(stringResource(id), Modifier.fillMaxWidth().mergedRow("source-$i").padding(vertical = 8.dp)) }
            Text(stringResource(R.string.dataSources_osmLicense), Modifier.fillMaxWidth().mergedRow("osm-license").padding(vertical = 8.dp))
            Button(onClick = { open(Intent(Intent.ACTION_VIEW, Uri.parse(OSM_COPYRIGHT_URL))) }, modifier = Modifier.tapTarget().testTag("osm-link")) { Text(stringResource(R.string.dataSources_osmLink)) }
            // ODbL 1.0 §4.6 사본 제공 고지 — 문의처가 있어야 이행이 성립하므로 메일 링크(설정의 문제 신고와 같은 주소)
            Button(onClick = { open(Intent(Intent.ACTION_SENDTO, Uri.parse(REPORT_MAILTO))) }, modifier = Modifier.tapTarget().testTag("osm-copy")) { Text(stringResource(R.string.dataSources_osmCopyRequest)) }
            StatusLine(notice, Modifier.padding(vertical = 8.dp))
        }
    }
}

private const val OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
