package space.dodoplanet.gildongmu.kit

/**
 * 대중교통 도보 구간 한 줄의 문구 키와 위치 인자(D8). Kit `TransitWalkLegText.swift` 미러.
 *
 * 판정 축은 둘뿐이다: 행선지 이름이 있는가, 거리가 있는가. 거리는 3-state라 필드가 없으면 "0m"가 아니라
 * 거리 없는 문구로 떨어진다(조립은 `formatDistance` 정본).
 *
 * ⚠ 인자 순서는 **ko 문장의 플레이스홀더 등장 순서**가 정본이다 — ko "{name}까지 도보 {minutes}분,
 *   {distance}" → (name, minutes, distance). 어순이 다른 로케일은 변환 스크립트가 인덱스를 재배치하므로
 *   호출부는 로케일과 무관하게 이 순서 하나만 지킨다.
 *
 * 로컬라이즈는 하지 않는다. 키·인자 결정만 :kit이 맡고 문구 조회는 :app이 한다(`TransitAlternativeName` 동형).
 */
object TransitWalkLegText {
    /** Swift `(key: String, args: [String])` 튜플. */
    data class Resolved(val key: String, val args: List<String>)

    /**
     * `boardExit`은 **다음 구간의 승차 출구**(E25)다 — 걷는 동안 듣고 바로 그 행동을 하므로 이 줄이 싣는다.
     * 행선지 이름이 없는 마지막 도보에는 붙일 자리가 없어 종전 문구로 떨어진다.
     * ko 순서는 "{name} {exit}번 출구까지 도보 {minutes}분, {distance}" → (name, exit, minutes, distance).
     */
    fun resolve(name: String?, distance: String?, minutes: Int, boardExit: String? = null): Resolved {
        val named = name?.takeIf { it.isNotEmpty() }
        val exit = boardExit?.takeIf { it.isNotEmpty() }
        val min = minutes.toString()
        return when {
            named != null && distance != null ->
                if (exit == null) Resolved("route.transit.legWalkTo", listOf(named, min, distance))
                else Resolved("route.transit.legWalkToExit", listOf(named, exit, min, distance))
            named != null ->
                if (exit == null) Resolved("route.transit.legWalkToNoDistance", listOf(named, min))
                else Resolved("route.transit.legWalkToExitNoDistance", listOf(named, exit, min))
            distance != null -> Resolved("route.transit.legWalkToDest", listOf(min, distance))
            else -> Resolved("route.transit.legWalkToDestNoDistance", listOf(min))
        }
    }
}
