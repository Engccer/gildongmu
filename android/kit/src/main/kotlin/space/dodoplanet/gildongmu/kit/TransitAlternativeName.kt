package space.dodoplanet.gildongmu.kit

/**
 * 대안 경로의 표시 이름 키(spec §4.1). 웹 `src/lib/transit-alternative-name.ts` ↔ Kit
 * `TransitAlternativeName.swift` 미러.
 *
 * 서버가 준 축(`highlight`)과 표시 번호(`displayIndex`)를 문구 키로 옮기기만 한다. 어떤 경로가 최단인지·
 * 환승이 가장 적은지의 판정은 전부 서버가 끝냈다. 같은 이름이 disclosure 라벨·안내 시작 버튼 라벨·
 * 스크린 리더 탐색 목록 세 자리에 쓰여 산출을 한 곳에 모은다(갈리면 고른 버튼과 항목이 다르게 들린다).
 *
 * 로컬라이즈는 하지 않는다. 키 결정만 :kit이 맡고 문구 조회는 :app이 한다(앱 카탈로그 문구).
 */
object TransitAlternativeName {
    /** Swift `(key: String, index: Int?)` 튜플. `index`가 null이 아니면 그 키가 번호 인자를 받는다. */
    data class Resolved(val key: String, val index: Int?)

    /**
     * 축·번호 조합 → 로컬라이즈 키.
     * ⚠ 모르는 축 문자열은 무시하고 번호로 떨어진다. 서버가 축을 늘렸을 때 구버전 앱이 원문 축 이름을
     *   그대로 낭독하는 것을 막는다.
     */
    fun key(highlight: List<String>?, displayIndex: Int?): Resolved {
        val axes = highlight ?: emptyList()
        val fast = "fastest" in axes
        val few = "fewestTransfers" in axes
        if (fast && few) return Resolved("route.transit.alternativeFastestFewestTransfers", null)
        if (few) return Resolved("route.transit.alternativeFewestTransfers", null)
        if (fast) return Resolved("route.transit.alternativeFastest", null)
        return Resolved("route.transit.alternativeHeading", displayIndex ?: 1)
    }
}
