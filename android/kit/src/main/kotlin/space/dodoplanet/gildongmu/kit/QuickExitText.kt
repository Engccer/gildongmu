package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.QuickExit
import space.dodoplanet.gildongmu.kit.models.QuickExitDoor

// 빠른하차 값 → 한 문장. 웹 `src/lib/quick-exit-text.ts` ↔ Kit `QuickExitText.swift` 미러.
//
// **3분기 × 2형태로 키를 나눈다.** 변수만 비우는 방식은 로케일마다 절 순서가 달라 성립하지 않고,
// `between`이 별도 조각인 이유도 같다 — `"3-2,3-3 사이"`를 문 번호 자리에 그대로 넣으면
// "엘리베이터 3-2,3-3 사이 문"이 된다.
//
// ⚠ 위치 인자 순서는 **ko 문장의 플레이스홀더 등장 순서**가 정본이다
//   (`"{station} 하차, 엘리베이터 {elevator}, 계단 {stairs}"` → station·elevator·stairs).
//   어겨도 컴파일은 통과하고 낭독만 뒤섞인다.

private fun doorPhrase(door: QuickExitDoor, lang: String): String? {
    if (door.kind == "between" && door.doors.size >= 2) {
        return kitLocalized("route.transit.quickExitBetween", lang, door.doors[0], door.doors[1])
    }
    val single = door.doors.firstOrNull()?.takeIf { it.isNotEmpty() } ?: return null
    return kitLocalized("route.transit.quickExitDoor", lang, single)
}

/** 값이 없거나 시설이 하나도 없으면 null — "빠른하차 정보 없음" 문구를 만들지 않는다(3-state). */
fun quickExitText(quickExit: QuickExit?, station: String, lang: String): String? {
    if (quickExit == null || station.isEmpty()) return null
    // 환승 leg는 빠른환승 문 하나가 정본이다(A20) — seed 계단은 환승 통로가 아닐 수 있다.
    quickExit.transfer?.let { doorPhrase(it, lang) }?.let { transfer ->
        return kitLocalized("route.transit.quickExitTransfer", lang, station, transfer)
    }
    val elevator = quickExit.elevator?.let { doorPhrase(it, lang) }
    val stairs = quickExit.stairs?.let { doorPhrase(it, lang) }
    return when {
        elevator != null && stairs != null -> kitLocalized("route.transit.quickExitBoth", lang, station, elevator, stairs)
        elevator != null -> kitLocalized("route.transit.quickExitElevator", lang, station, elevator)
        stairs != null -> kitLocalized("route.transit.quickExitStairs", lang, station, stairs)
        else -> null
    }
}
