package space.dodoplanet.gildongmu.location

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import space.dodoplanet.gildongmu.directions.EndpointSearchContent

/**
 * 현재 위치 수동 지정 화면(spec §13-3) = M3 끝점 검색 콘텐츠 그대로(제목 "위치 지정하기", "현재 위치로 되돌리기" 버튼, 단일 `StatusLine`).
 * pop은 지정이 끝난 뒤에만(`done`). 상단 바 뒤로는 취소(진행 중 측위를 끊고 pop); 시스템 뒤로는 `NavHost`가 pop하고 ViewModel 소거가 같은 잡을 끊는다.
 */
@Composable
fun ManualLocationPickerScreen(onBack: () -> Unit) {
    val app = LocalContext.current.applicationContext
    val factory = remember(app) { manualLocationPickerFactory(app) }
    val vm: ManualLocationPickerViewModel = viewModel(factory = factory)
    val p by vm.picker.state.collectAsState()
    val done by vm.done.collectAsState()
    LaunchedEffect(done) { if (done) onBack() }
    // `init`이 picker를 열므로 null은 도달 불가 — 방어가 아니라 타입 좁히기다.
    EndpointSearchContent(vm.picker, p!!, onBack = { vm.cancel(); onBack() })
}
