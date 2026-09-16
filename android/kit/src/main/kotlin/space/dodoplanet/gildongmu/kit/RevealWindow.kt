package space.dodoplanet.gildongmu.kit

/**
 * "더 보기" 단계 공개 창. Kit `RevealWindow.swift` 미러 — 웹 useRevealMore의 수치 로직 공용화.
 * 초기 10·+10은 웹 NEARBY_INITIAL_VISIBLE/REVEAL_STEP과 동일 값 유지.
 */
class RevealWindow {
    var visibleCount: Int = initialVisible
        private set

    /** 새 로드 커밋 시 초기값 복원(`NearbyLoadCore`의 willCommit에서 호출). */
    fun reset() {
        visibleCount = initialVisible
    }

    /** 공개 수를 늘리고 첫 새 항목 인덱스를 반환(스크린 리더 포커스 이동 대상). 더 없으면 null. */
    fun revealMore(totalCount: Int): Int? {
        if (visibleCount >= totalCount) return null
        val firstNewIndex = visibleCount
        visibleCount = minOf(visibleCount + revealStep, totalCount)
        return firstNewIndex
    }

    companion object {
        const val initialVisible = 10
        const val revealStep = 10
    }
}
