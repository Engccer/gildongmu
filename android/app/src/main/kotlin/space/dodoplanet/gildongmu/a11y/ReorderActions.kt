package space.dodoplanet.gildongmu.a11y

import android.util.Log
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.kit.Reorder
import space.dodoplanet.gildongmu.kit.ReorderMove

/**
 * 순서 바꾸기 작업 메뉴(E67, iOS `ReorderActions.swift` 한 벌의 안드로이드판 — spec 2026-10-05-reorder-rotor-actions-design.md §1·§2).
 * 할 수 있는 이동의 판정은 `:kit` `Reorder.availableMoves`가 정본이다. 기준은 **화면에 보이는 고정 순서**(§2.2)이고, 화면은 이동 뒤
 * `reorderPinned*`가 돌려준 저장 배열을 채택한다. 작업 메뉴는 목록 순서 그대로 노출되므로(README §3 화면 관용구) 맨 위로 → 위로 → 아래로,
 * 그 뒤에 고정/해제·삭제가 온다(spec §1의 의도 순서 「이동 셋 → 고정 해제 → 삭제」).
 *
 * 포커스 유지(iOS `keepFocusAfterMove`): 행을 항목 키로 `key(...)` 감싸 이동이 같은 레이아웃 노드를 옮기게 하고, 옮긴 행을 다음 프레임에
 * 화면 안으로 가져온 뒤 포커스를 다시 준다(`MovedRowLanding`). 노드만 옮기면 행이 화면 밖으로 나갈 때 한소네 커서가 화면 제목으로
 * 떨어진다(실기기 2026-11-21, 「맨 위로」). 이동 뒤 새 자리는 화면의 통지 창구로 알린다(`android.reorder.moved`).
 */
class ReorderLabels(val toTop: String, val up: String, val down: String) {
    fun of(move: ReorderMove): String = when (move) {
        ReorderMove.toTop -> toTop
        ReorderMove.up -> up
        ReorderMove.down -> down
    }
}

@Composable
fun reorderLabels(): ReorderLabels = ReorderLabels(
    toTop = stringResource(R.string.android_reorder_toTop),
    up = stringResource(R.string.android_reorder_up),
    down = stringResource(R.string.android_reorder_down),
)

/** 그 행에서 할 수 있는 이동의 작업 메뉴(없으면 빈 목록). */
fun reorderCustomActions(moves: List<ReorderMove>, labels: ReorderLabels, perform: (ReorderMove) -> Unit): List<CustomAccessibilityAction> =
    moves.map { move -> CustomAccessibilityAction(labels.of(move)) { perform(move); true } }

/** 화면 목록에서 그 항목이 고정 부분열의 몇째인지로 할 수 있는 이동을 낸다(비고정이면 없음, iOS `pinnedMoves`). */
fun <T> pinnedMoves(items: List<T>, item: T, isPinned: (T) -> Boolean, sameAs: (T, T) -> Boolean): List<ReorderMove> {
    if (!isPinned(item)) return emptyList()
    val pins = items.filter(isPinned)
    val index = pins.indexOfFirst { sameAs(it, item) }
    return Reorder.availableMoves(index, pins.size)
}

/** 화면의 고정 순서에 이동을 적용한 순서(저장소 `reorderPinned*`에 넘길 값). 그 항목이 고정 부분열에 없으면 null. */
fun <T> pinnedOrderAfterMove(items: List<T>, item: T, move: ReorderMove, isPinned: (T) -> Boolean, sameAs: (T, T) -> Boolean): List<T>? {
    val pins = items.filter(isPinned)
    val index = pins.indexOfFirst { sameAs(it, item) }
    if (index < 0) return null
    return Reorder.moved(pins, index, move)
}

/**
 * 옮긴 행 다시 착지(iOS `keepFocusAfterMove`의 가시화 → 대입). 행은 `bringFor(키)`를 `bringIntoViewRequester`로 달고, 이동 동작은
 * `pending = 키`를 세운다. 화면 밖 행의 포커스 이동은 한소네 커서가 따르지 않으므로 스크롤이 끝난 뒤 포커스를 준다(첫 결과 착지와 같은 꼴).
 */
class MovedRowLanding {
    private val bring = mutableMapOf<Any, BringIntoViewRequester>()
    var pending by mutableStateOf<Any?>(null)
    fun bringFor(key: Any): BringIntoViewRequester = bring.getOrPut(key) { BringIntoViewRequester() }
}

@Composable
fun rememberMovedRowLanding(focusFor: (Any) -> FocusRequester?): MovedRowLanding {
    val landing = remember { MovedRowLanding() }
    LaunchedEffect(landing.pending) {
        val key = landing.pending ?: return@LaunchedEffect
        withFrameNanos { }
        runCatching { landing.bringFor(key).bringIntoView() }.onFailure { Log.w("Reorder", "옮긴 행 스크롤 실패", it) }
        runCatching { focusFor(key)?.requestFocus() }.onFailure { Log.w("Reorder", "옮긴 행 착지 실패", it) }
        landing.pending = null // 일을 마친 뒤 끈다(자기 키를 바꾸는 효과는 그 순간 취소된다)
    }
    return landing
}
