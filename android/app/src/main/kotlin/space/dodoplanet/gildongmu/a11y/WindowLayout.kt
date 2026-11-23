package space.dodoplanet.gildongmu.a11y

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo

/**
 * 넓고 낮은 창인가(E91·B30, spec 2026-11-23 §2.1). 기기 이름이 아니라 창 크기로 가른다:
 * 가로가 세로보다 길고 600dp 이상이면 검색·길찾기·채팅을 두 칸으로 놓는다.
 * 한소네 7(1024×576dp)과 가로로 눕힌 폰이 함께 든다. Material 높이 등급(480dp 미만)은 한소네가 빠져 쓰지 않는다.
 */
fun isWideLowWindow(widthDp: Float, heightDp: Float): Boolean = widthDp >= 600f && widthDp > heightDp

/** 두 칸 배치에서 앞 칸(입력·컨트롤)이 차지하는 너비 비율. 채팅은 대화 칸이 나머지(0.6)를 쓴다. */
const val WIDE_CONTROLS_WEIGHT = 0.4f

/** 지금 창이 넓고 낮은가. 회전·창 크기 변경에 따라 다시 계산된다. */
@Composable
fun rememberWideLowWindow(): Boolean {
    val size = LocalWindowInfo.current.containerSize
    val density = LocalDensity.current
    return with(density) { isWideLowWindow(size.width.toDp().value, size.height.toDp().value) }
}
