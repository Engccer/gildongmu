package space.dodoplanet.gildongmu.kit

/**
 * 대안 경로의 표시 이름 조각(spec `2026-09-24-transit-alternatives-reasoned-design.md` §4.1). 웹
 * `src/lib/transit-alternative-name.ts` ↔ Kit `TransitAlternativeName.swift` 미러.
 *
 * 서버가 준 축(`highlight`)을 문구 키로 옮기기만 한다. 조합마다 키를 두지 않고 **축 하나에 조각 하나**를 조립 순서로
 * 내고 :app이 쉼표로 이어 한 줄로 만든다(한 줄 = 한 접근성 객체, 가운뎃점·사유 문장 금지). `fastest`와
 * `fewestTransfers`가 함께 있을 때만 기존 조합 키 하나를 쓴다. 같은 이름이 disclosure 라벨·안내 시작 버튼 라벨·
 * 스크린 리더 탐색 목록 세 자리에 쓰여 산출을 한 곳에 모은다(갈리면 고른 버튼과 항목이 다르게 들린다).
 *
 * 로컬라이즈는 하지 않는다. 키 결정만 :kit이 맡고 문구 조회는 :app이 한다(앱 카탈로그 문구).
 * 규칙은 공유 fixture `transit-alternative-name-cases.json`이 잠근다.
 */
object TransitAlternativeName {
    /** Swift `(key: String, index: Int?)` 튜플. `index`가 null이 아니면 그 키가 번호 인자를 받는다. */
    data class Resolved(val key: String, val index: Int?)

    private val axisKeys = listOf(
        "fastest" to "route.transit.alternativeFastest",
        "fewestTransfers" to "route.transit.alternativeFewestTransfers",
        "leastWalk" to "route.transit.alternativeLeastWalk",
        "busOnly" to "route.transit.alternativeBusOnly",
        "subwayOnly" to "route.transit.alternativeSubwayOnly",
    )

    /**
     * 축·번호 → 조립 순서의 로컬라이즈 키 조각.
     * ⚠ 모르는 축 문자열은 무시하고, 아는 축이 하나도 없으면 번호로 떨어진다. 서버가 축을 늘렸을 때 구버전 앱이
     *   원문 축 이름을 그대로 낭독하는 것을 막는다.
     */
    fun parts(highlight: List<String>?, displayIndex: Int?): List<Resolved> {
        val axes = highlight.orEmpty().toSet()
        var keys = axisKeys.filter { it.first in axes }.map { it.second }
        if ("fastest" in axes && "fewestTransfers" in axes) {
            keys = listOf("route.transit.alternativeFastestFewestTransfers") +
                keys.filter { it != "route.transit.alternativeFastest" && it != "route.transit.alternativeFewestTransfers" }
        }
        if (keys.isEmpty()) return listOf(Resolved("route.transit.alternativeHeading", displayIndex ?: 1))
        return keys.map { Resolved(it, null) }
    }
}
