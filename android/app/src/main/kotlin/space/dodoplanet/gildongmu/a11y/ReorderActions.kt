package space.dodoplanet.gildongmu.a11y

import androidx.compose.runtime.Composable
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
 * 포커스 유지(iOS `keepFocusAfterMove`)는 행을 항목 키로 `key(...)` 감싸는 것이 대신한다: 이동은 같은 레이아웃 노드를 옮기므로
 * TalkBack 커서가 그 행에 남는다(Column + verticalScroll이라 화면 밖 행도 트리에 있다). 이동 뒤 새 자리는 화면의 통지 창구로 알린다
 * (`android.reorder.moved` — 커서가 같은 행에 남아 라벨이 다시 읽히지 않으므로 이 통지가 이동의 유일한 증거다).
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
