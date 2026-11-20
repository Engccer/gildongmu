package space.dodoplanet.gildongmu.guide.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.a11y.BodyLine
import space.dodoplanet.gildongmu.a11y.HeadingLine
import space.dodoplanet.gildongmu.a11y.tapTarget
import space.dodoplanet.gildongmu.kit.KeyValueStore

/**
 * 2.0 공지의 저장(iOS `ReleaseNotice` 미러, spec 2026-10-01-release-2.0-graduation-design.md §1). 키 이름이 iOS와 같다 — 키의 V2가 공지 버전이고
 * 다음 큰 변경 때 V3 키로 새 공지를 낸다. 저장은 확인 버튼만 한다: 뒤로·바깥 탭·아래로 끌기로 닫으면 저장하지 않아 다음 실행에 다시 뜬다.
 */
class ReleaseNotice(private val store: KeyValueStore, private val io: CoroutineDispatcher = Dispatchers.IO) {
    /** 첫 읽기는 IO에서(`SharedPreferences` 첫 접근은 디스크 로드). */
    suspend fun isConfirmed(): Boolean = withContext(io) { store.getString(KEY) == "true" }

    fun confirm() = store.putString(KEY, "true")

    companion object {
        const val KEY = "releaseNoticeV2"

        /** 이 프로세스에서 표시 판정을 이미 했는가(메인 스레드 전용) — 액티비티 재생성(언어 전환)이 판정을 되풀이하지 않게. */
        var judgedThisProcess = false
    }
}

/**
 * 앱을 열면 바로 뜨는 1회 공지 시트(iOS `ReleaseNoticeSheet` 미러, 어느 탭이든 — 위원장 판정 2026-10-01). 계약은 "한 번 뜨면 다시 안 뜬다"가 아니라
 * **"확인을 누르면 다시 뜨지 않는다"**다 — 닫기 제스처는 막지 않되(탈출 제스처는 1급 사용자가 모달에서 빠져나오는 표준 수단이다) 저장하지 않는다.
 *
 * 접근성: 제목·소제목 둘은 헤딩, 본문은 문단마다 한 객체. 모달 등장 자체가 읽히므로 별도 통지를 내지 않는다. 여는 화면(`AppRoot`)은 이 시트가
 * 떠 있는 동안 `LocalModalOpen`을 참으로 제공한다(모달 뒤에서 앱 통지를 집지 않게).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReleaseNoticeSheet(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val titleFocus = remember { FocusRequester() }
    // 표시 애니메이션 뒤 제목으로 착지한다(`GuideSheet` 동형). 드래그 핸들은 두지 않는다 — 제목보다 먼저 읽히는 잡음이고, 닫기는 뒤로·바깥 탭으로 충분하다.
    LaunchedEffect(Unit) { land(titleFocus, "공지 제목") }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, dragHandle = null) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            HeadingLine(stringResource(R.string.android_releaseNotice_title), "release-notice-title", focus = titleFocus)
            BodyLine(stringResource(R.string.android_releaseNotice_intro), "release-notice-intro")
            HeadingLine(stringResource(R.string.android_releaseNotice_head1), "release-notice-head1")
            BodyLine(stringResource(R.string.android_releaseNotice_body1), "release-notice-body1")
            BodyLine(stringResource(R.string.android_releaseNotice_body2), "release-notice-body2")
            BodyLine(stringResource(R.string.android_releaseNotice_body3), "release-notice-body3")
            BodyLine(stringResource(R.string.android_releaseNotice_body4), "release-notice-body4")
            HeadingLine(stringResource(R.string.android_releaseNotice_head2), "release-notice-head2")
            BodyLine(stringResource(R.string.android_releaseNotice_body5), "release-notice-body5")
            BodyLine(stringResource(R.string.android_releaseNotice_body6), "release-notice-body6")
            Button(
                onClick = onConfirm,
                modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp).tapTarget().testTag("release-notice-confirm"),
            ) { Text(stringResource(R.string.android_releaseNotice_confirm)) }
        }
    }
}
