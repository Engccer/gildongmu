package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.TransitLegStop
import space.dodoplanet.gildongmu.kit.models.TransitRouteLeg

// 경로 브리핑에서 지하철역 상세·전화(E45) — Kit `TransitBriefingStations.swift` 미러,
// spec docs/superpowers/specs/2026-09-18-briefing-station-entry-design.md §3.2·§5.1.
// 정규식 신설 없음(조인 정규화는 기존 `normalizeStopName` 재사용 — 자체 정규화 금지).

/** 브리핑 렌더 순서의 한 줄. Swift 연관값 enum → sealed class(케이스는 타입이라 PascalCase). */
sealed class TransitBriefingRow {
    /** 도보 구간 줄 — 행선지가 다음에 탈 역이다. */
    data class Walk(val legIndex: Int) : TransitBriefingRow()

    /** 탑승 구간 줄 — 승차·하차가 함께 들린다. */
    data class Transit(val legIndex: Int) : TransitBriefingRow()

    /** 하차 줄(빠른하차·하차 출구) — 하차역만 들린다. */
    data class Alight(val legIndex: Int) : TransitBriefingRow()

    val index: Int
        get() = when (this) {
            is Walk -> legIndex
            is Transit -> legIndex
            is Alight -> legIndex
        }
}

/** 그 줄에서 열 수 있는 역 하나. 순서는 줄에 이름이 들리는 순서다. */
data class TransitBriefingStation(
    val stop: TransitLegStop,
    /**
     * 전화번호 조회 노선 힌트(spec §4). `leg.lineName`의 빈값·공백값을 접어 넘긴다 —
     * 노선 표 판정은 앱 `StationPhoneStore.key` 한 곳이 한다(복제하면 표 갱신 때 두 자리가 갈린다).
     */
    val lineName: String?,
    /**
     * **그 줄이 이 역을 부른 영문 이름**(`leg.fromNameEn`/`toNameEn`). 영문이 없으면 null.
     *
     * ⚠ `stop.nameEn`을 쓰지 않는다. 줄의 영어 자격 술어(`transitLegUsesEnglish`)는 **leg 필드**를 보는데 `stop.nameEn`은 서버가
     *   다른 원본(`passStopList.stations[].stationName`)에서 채우므로, 한쪽만 빈 응답에서 **줄은 영어인데 라벨만 한국어**가 된다.
     */
    val nameEn: String? = null,
)

/**
 * 이 줄에 달릴 역 진입점들.
 *
 * **불변식**: 지하철 구간이 만든 줄에서 들린 역 이름에는 그 역으로 가는 수단이 있고, 그 밖의 줄에는 없다.
 * 위험한 것은 존재가 아니라 **정체성**이다 — 들린 이름과 열리는 역이 다르면 불변식을 지킨 채로 틀린 역이 열린다.
 *
 * ⚠ `stops.first()`/`stops.last()`를 승차·하차역으로 쓰지 않는다. 서버 `toLegStops`가 이름·좌표가 무효한 항목을 떨어뜨리므로
 *   목록의 첫·마지막이 조용히 중간역이 될 수 있다. **줄에서 들린 이름으로 조인하고, 조인에 실패하면 진입점은 없다.**
 */
fun transitBriefingStations(legs: List<TransitRouteLeg>, row: TransitBriefingRow): List<TransitBriefingStation> =
    when (row) {
        is TransitBriefingRow.Walk -> {
            val index = row.legIndex
            if (index !in legs.indices || legs[index].mode != "walk") {
                emptyList()
            } else {
                // "다음 leg"는 `legs[index + 1]`이 아니라 **다음 non-walk leg**다 — 서버가 도보 줄의 행선지 이름을 그렇게 유도한다
                // (odsay `legs.slice(i + 1).find(l => l.mode !== "walk")`). 줄에 들리는 `toName`은 서버가 `next.fromName`으로
                // 덮은 값이라 `fromName` 하나만 보는 것이 곧 "줄에 들린 이름" 게이트다(서버 계약 — 실호출 게이트가 일치를 잰다).
                val next = legs.subList(index + 1, legs.size).firstOrNull { it.mode != "walk" }
                if (next == null || next.mode != "subway") {
                    emptyList()
                } else {
                    // 영문 이름은 **이 도보 줄**이 쓴 값이다 — 줄의 자격 술어도 도보 leg 자신을 본다.
                    listOfNotNull(joinedStation(next, next.fromName, legs[index].toNameEn, fromEnd = false))
                }
            }
        }
        is TransitBriefingRow.Transit -> {
            val leg = subwayLeg(legs, row.legIndex)
            if (leg == null) {
                emptyList()
            } else {
                val board = joinedStation(leg, leg.fromName, leg.fromNameEn, fromEnd = false)
                val alight = joinedStation(leg, leg.toName, leg.toNameEn, fromEnd = true)
                // 승차와 하차가 같은 역이면 한 건으로 접는다(판정은 조인과 같은 정규화).
                val sameStation = board != null && alight != null &&
                    normalizeStopName(board.stop.name) == normalizeStopName(alight.stop.name)
                listOfNotNull(board, alight.takeUnless { sameStation })
            }
        }
        // 줄 존재 판정(`alightLineText`의 `station`)과 대상 판정이 **같은 필드**(`toName`)를 본다.
        is TransitBriefingRow.Alight ->
            subwayLeg(legs, row.legIndex)?.let { leg -> listOfNotNull(joinedStation(leg, leg.toName, leg.toNameEn, fromEnd = true)) }
                ?: emptyList()
    }

/** 버스 정류장은 진입점을 갖지 않는다 — `transitStopPlace`가 `category: "지하철역"`을 박는다(spec §7). */
private fun subwayLeg(legs: List<TransitRouteLeg>, index: Int): TransitRouteLeg? =
    legs.getOrNull(index)?.takeIf { it.mode == "subway" }

/**
 * 줄에서 들린 이름으로 그 leg의 정차역을 찾는다. 승차는 앞에서부터, 하차는 뒤에서부터 — 같은 역을 두 번 지나는 노선(순환·왕복)에서
 * 어느 통과를 가리키는지가 이 방향으로 갈린다.
 */
private fun joinedStation(leg: TransitRouteLeg, name: String?, nameEn: String?, fromEnd: Boolean): TransitBriefingStation? {
    // 표시와 같은 부재 기준을 먼저 적용한다. 조인 정규화는 개행을 남기므로(Swift `.whitespaces`), 이름과 정차역 이름 양쪽이
    // 개행 공백이면 정규화 뒤 non-empty 검사만으로는 조인이 통과한다.
    val shown = transitBriefingName(name) ?: return null
    val stops = leg.stops?.takeIf { it.isNotEmpty() } ?: return null
    // 부역명·"역" 접미를 제거한 뒤에도 유효한 조인 이름이 남아야 한다.
    val target = normalizeStopName(shown)
    if (target.isEmpty()) return null
    val ordered = if (fromEnd) stops.asReversed() else stops
    val stop = ordered.firstOrNull { normalizeStopName(it.name) == target } ?: return null
    return TransitBriefingStation(stop, lineName = transitBriefingName(leg.lineName), nameEn = transitBriefingName(nameEn))
}

/** 결과 진동 어휘(앱 `HapticKind` 미러). :kit은 안드로이드를 모르므로 판정만 여기서 내고 발화는 앱이 한다. */
enum class ResultHapticKind { success, attention, failure }

/** Swift `(key: String, haptic: ResultHapticKind)` 튜플. */
data class BriefingPhoneAnnouncement(val key: String, val haptic: ResultHapticKind)

/**
 * 역 전화 액션의 통지·진동(spec §5.1). **번호가 있으면 null** — 다이얼러로 넘어가는 것이 곧 응답이라 통지가 잉여다. 그 밖의 세 상태는
 * 문장과 진동을 함께 낸다(3-state를 촉각에도).
 *
 * ⚠ null 입력은 세 상태를 겹쳐 든다(조회 전 · 첫 조회 중 · 갱신 시도 없이 보관 한도로 지워짐). "찾고 있습니다"가 거짓이 되지 않게 하는 것은
 *   호출부의 몫이다 — 통지 전에 조회를 킥오프해 문장이 사후적으로 참이 되게 한다.
 *
 * 통지 문구에 역 이름을 넣지 않는다. 방금 누른 액션 라벨이 그 역을 말했다(뻔한 꼬리 문장 금지).
 *
 * ⚠ 돌려주는 것은 **iOS 키**(`ios.station.*`)다. 앱은 리터럴 `when`으로 되받아 `android.station.*` 리소스로 옮긴다.
 */
fun briefingPhoneAnnouncement(result: StationPhoneResult?): BriefingPhoneAnnouncement? = when (result) {
    is StationPhoneResult.Direct, is StationPhoneResult.Representative -> null
    StationPhoneResult.Unavailable -> BriefingPhoneAnnouncement("ios.station.phoneMissing", ResultHapticKind.attention)
    StationPhoneResult.Failed -> BriefingPhoneAnnouncement("ios.station.phoneError", ResultHapticKind.failure)
    null -> BriefingPhoneAnnouncement("ios.station.phonePending", ResultHapticKind.attention)
}
