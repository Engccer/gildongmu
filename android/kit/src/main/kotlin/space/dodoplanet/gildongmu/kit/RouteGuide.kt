package space.dodoplanet.gildongmu.kit

/**
 * 리듀서가 fix마다 내는 우선 톤. 행동 톤 5종(`imminentTone`)과 이탈 경고. Kit `RouteGuide.swift` 미러.
 * ⚠ `BeaconTone`(재생 파일)과는 다른 층이다 — 변환은 `BeaconTone.fromGuide` 한 곳.
 */
enum class GuideTone {
    ahead, crosswalk, left, right, back, warning;

    val rawValue: String get() = name

    companion object {
        fun fromRawValue(raw: String): GuideTone? = entries.firstOrNull { it.name == raw }
    }
}

/**
 * 결정 지점 임박 큐의 **소리**. 행동별로 가른다(N2, 2026-08-22 위원장 판정: 횡단보도·왼쪽·오른쪽·뒤로 돌기·그 외).
 * 백그라운드·잠금에서는 문장이 나가지 않으므로 이 소리가 다음 행동을 알리는 유일한 채널이다. `underpass`는
 * "그 외"다 — 횡단보도 비프는 음향신호기의 인용이라 지하보도에 붙이면 거짓 인용이 된다.
 * 웹 `imminentTone` ↔ Kit `WalkAction.swift` 미러(소리 열거형이 여기 있어 Kotlin은 이 파일에 둔다).
 * 소리 정본은 `scripts/build-guide-tones.py`.
 */
fun imminentTone(action: WalkAction): GuideTone = when (action) {
    WalkAction.crosswalk -> GuideTone.crosswalk
    WalkAction.left -> GuideTone.left
    WalkAction.right -> GuideTone.right
    WalkAction.back -> GuideTone.back
    WalkAction.underpass -> GuideTone.ahead
    // 갈래 선택은 회전과 같은 소리(소리 5종 유지 — N2 판정).
    WalkAction.keepLeft -> GuideTone.left
    WalkAction.keepRight -> GuideTone.right
}
