package space.dodoplanet.gildongmu.kit

/**
 * Tmap 자동차 `turnType` → 결정 지점 행동(웹 `car-action.ts` ↔ Kit `CarAction.swift` 미러,
 * 공유 fixture `car-action-cases.json`이 코드 표를 동조한다).
 *
 * 서버가 `guides[i].action`에 싣고 앱은 디코딩만 한다 — 이 함수는 미러 검증과 폴백 없는
 * 문서 역할이다. **표에 없는 코드는 null** — 미분류의 결과는 오안내가 아니라 침묵.
 */
enum class CarAction {
    left, right, back, keepLeft, keepRight;

    val rawValue: String get() = name

    /** 리듀서·표시 계층이 쓰는 수단 중립 행동. */
    val guideAction: WalkAction
        get() = when (this) {
            left -> WalkAction.left
            right -> WalkAction.right
            back -> WalkAction.back
            keepLeft -> WalkAction.keepLeft
            keepRight -> WalkAction.keepRight
        }

    companion object {
        fun fromRawValue(raw: String): CarAction? = entries.firstOrNull { it.name == raw }
    }
}

fun carActionFromTurnType(turnType: Int): CarAction? = when (turnType) {
    12, 16, 17 -> CarAction.left // 좌회전·8시/10시 방향 좌회전
    13, 18, 19 -> CarAction.right // 우회전·2시/4시 방향 우회전
    14, 136 -> CarAction.back // U턴·6시 방향
    118, 102, 105, 112, 115 -> CarAction.keepLeft // 왼쪽 방향·왼쪽 (도시)고속도로 입구/출구
    117, 101, 104, 111, 114 -> CarAction.keepRight // 오른쪽 방향·오른쪽 (도시)고속도로 입구/출구
    in 131..135 -> CarAction.keepRight // 1~5시 방향
    in 137..141 -> CarAction.keepLeft // 7~11시 방향
    else -> null // 직진·시설·톨게이트·경유지·출발/도착·182/183
}
