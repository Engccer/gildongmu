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
import androidx.compose.ui.Modifier
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
 * 도보 안내 1회성 공지의 저장(iOS `WalkGuideNotice` 미러, spec 2026-08-15 §5). 키 이름이 iOS와 같다 — V1은 공지 버전이고 자동차·대중교통을
 * 더할 때 V2 키로 새 공지를 낸다. 저장은 확인 버튼만 한다: 뒤로·바깥 탭·아래로 끌기로 닫으면 저장하지 않아 다음 길찾기 진입에 다시 뜬다.
 */
class WalkGuideNotice(private val store: KeyValueStore, private val io: CoroutineDispatcher = Dispatchers.IO) {
    /** 첫 읽기는 IO에서(`SharedPreferences` 첫 접근은 디스크 로드). */
    suspend fun isConfirmed(): Boolean = withContext(io) { store.getString(KEY) == "true" }

    fun confirm() = store.putString(KEY, "true")

    companion object {
        const val KEY = "walkGuideNoticeV1"
    }
}

/**
 * 길찾기 진입 때 뜨는 도보 안내 공지 시트(iOS `WalkGuideNoticeSheet` 미러). 계약은 "한 번 뜨면 다시 안 뜬다"가 아니라 **"확인을 누르면 다시 뜨지
 * 않는다"**다 — 닫기 제스처는 막지 않되(탈출 제스처는 1급 사용자가 모달에서 빠져나오는 표준 수단이다) 저장하지 않는다.
 *
 * 접근성: 제목·소제목 둘은 헤딩, 본문은 문단마다 한 객체. 모달 등장 자체가 읽히므로 별도 통지를 내지 않는다. 여는 화면은 이 시트가 떠 있는 동안
 * `LocalModalOpen`을 참으로 제공한다(모달 뒤에서 앱 통지를 집지 않게).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalkGuideNoticeSheet(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            HeadingLine(stringResource(R.string.android_directions_walkNotice_title), "walk-notice-title")
            BodyLine(stringResource(R.string.android_directions_walkNotice_intro), "walk-notice-intro")
            HeadingLine(stringResource(R.string.android_directions_walkNotice_head1), "walk-notice-head1")
            BodyLine(stringResource(R.string.android_directions_walkNotice_body1), "walk-notice-body1")
            HeadingLine(stringResource(R.string.android_directions_walkNotice_head2), "walk-notice-head2")
            BodyLine(stringResource(R.string.android_directions_walkNotice_body2), "walk-notice-body2")
            BodyLine(stringResource(R.string.android_directions_walkNotice_body3), "walk-notice-body3")
            BodyLine(stringResource(R.string.android_directions_walkNotice_body4), "walk-notice-body4")
            Button(
                onClick = onConfirm,
                modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp).tapTarget().testTag("walk-notice-confirm"),
            ) { Text(stringResource(R.string.android_directions_walkNotice_confirm)) }
        }
    }
}
