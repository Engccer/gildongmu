package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.models.TransitLegStop

/**
 * 안내 표시 투영(E27 잔여 ①, spec 2026-09-01 §3.5) — 웹 `transit-display.ts` ↔ Kit `TransitDisplayProjection.swift` 미러.
 * 공유 fixture `transit-display-cases.json`이 두 구현을 한 표로 잠근다.
 *
 * **조인 필드가 타입에 없다.** 문장을 만드는 계층은 `TransitGuideLeg`·`TransitTrackItem` 원본을 받지 않고 이 투영만
 * 받는다 — 그래서 노선명·역명을 조회 쿼리나 매핑표 키로 쓰는 코드가 표시 경로에 **존재할 수 없다**(소스 가드는 2선이고
 * 이 타입이 1선이다).
 *
 * ⚠ 투영에 `vehicleId`·`routeId`·`arsId`·좌표를 넣지 말 것 — 넣는 순간 표시 계층이 다시 조인한다.
 */

/** 한 조각의 ko·en 쌍. `en == null` = 그 조각의 영문이 없다(그 줄은 통째로 ko). */
@Serializable
data class TransitLabel(val ko: String, val en: String? = null)

@Serializable
data class TransitDisplayLeg(
    val mode: String,
    val line: TransitLabel,
    /** 재선택한 기준 역이 있으면 그 역(A16 L3). */
    val board: TransitLabel,
    val alight: TransitLabel,
    val stops: List<TransitLabel>,
    val stationCount: Int?,
    val walkBeforeMinutes: Int?,
    /** 승차 지점이 재선택으로 바뀌었는가 — 선행 도보 문구 분기 축(지난 도보를 다시 말하지 않게). */
    val boardOverridden: Boolean,
    /** 하차 출구 번호(E25) — 조인이 아니라 표시 값이라 투영에 둔다. 부재는 null. */
    val exitAlight: String? = null,
)

@Serializable
data class TransitDisplayItem(
    /** ⚠ 유일하게 `""`가 유효한 조각(TAGO는 ko도 완성 문장이 없다). */
    val message: TransitLabel,
    val direction: TransitLabel,
    val destination: TransitLabel?,
    val currentLocation: TransitLabel?,
    val express: Boolean,
    val remainingStops: Int?,
    /** 차량 식별자 유무 — 원문 식별자는 표시 계층에 넘기지 않는다. */
    val selectable: Boolean,
)

/**
 * 조각 정규화 — 두 방향을 함께 본다(spec §3.4, 웹 `label` 미러).
 * ① **영문 자리의 빈 문자열은 영문이 아니다** — 정보 소실이 "완비"로 위장한다.
 * ② ⚠ **ko가 비어 있으면 그 조각은 언어 축이 아니다.** ko에도 없는 것을 "영문 결측"으로 세면 나머지가 전부 영문이어도
 * 줄 전체가 한국어로 되돌아간다(서울버스 `direction`이 구조적 `""`).
 */
private fun transitLabel(ko: String?, en: String?): TransitLabel {
    val koText = ko ?: ""
    val enText = if (en != null && en.trim().isNotEmpty()) en else null
    if (koText.trim().isEmpty()) return TransitLabel(koText, enText ?: "")
    return TransitLabel(koText, enText)
}

private fun stopLabel(stop: TransitLegStop): TransitLabel = transitLabel(stop.name, stop.nameEn)

/**
 * leg → 표시 투영. `boardOverrideIndex`는 세션 경로 `viaStops`의 인덱스다(이름이 아니다 — 정규화 후 동명 역이 둘이면
 * 이름 역조회가 다른 역의 영문명을 고른다, spec §3.6). 범위 밖 인덱스는 override 없음으로 떨어진다.
 */
fun transitDisplayLeg(leg: TransitGuideLeg, boardOverrideIndex: Int?): TransitDisplayLeg {
    val override = boardOverrideIndex?.let { leg.viaStops.getOrNull(it) }
    return TransitDisplayLeg(
        mode = leg.mode,
        line = transitLabel(leg.lineName, leg.lineNameEn),
        board = override?.let(::stopLabel) ?: transitLabel(leg.boardName, leg.boardNameEn),
        alight = transitLabel(leg.alightName, leg.alightNameEn),
        stops = leg.viaStops.map(::stopLabel),
        stationCount = leg.stationCount,
        walkBeforeMinutes = leg.walkBeforeMinutes,
        boardOverridden = override != null,
        exitAlight = leg.exitAlight,
    )
}

/** 폴링 항목 → 표시 투영. `message`만 `""`를 자리 표시로 보존한다. */
fun transitDisplayItem(item: TransitTrackItem): TransitDisplayItem = TransitDisplayItem(
    message = TransitLabel(item.message, item.messageEn),
    direction = transitLabel(item.direction, item.directionEn),
    destination = if (!item.destinationName.isNullOrEmpty()) transitLabel(item.destinationName, item.destinationNameEn) else null,
    currentLocation = if (!item.currentLocation.isNullOrEmpty()) transitLabel(item.currentLocation, item.currentLocationEn) else null,
    express = item.express,
    remainingStops = item.remainingStops,
    selectable = !item.vehicleId.isNullOrEmpty(),
)

/**
 * 승차 전 도보 대상의 표시 라벨 — **앱이 `TransitLabel`을 직접 만들지 않게** 하는 자리다. `TransitLabel` 생성자엔 정규화가
 * 없어 `nameEn == ""`이면 "en 완비"로 읽혀 `"Arrived at "`(이름 없는 문장)가 된다(a11y 감사 I2).
 */
fun transitPrewalkLabel(target: TransitPrewalkTarget): TransitLabel = transitLabel(target.name, target.nameEn)

/** 이벤트가 실어 온 완성 문장 쌍(같은 관측에서 나온 ko·en, spec §3.4). */
fun transitMessageLabel(ko: String, en: String?): TransitLabel = TransitLabel(ko, en)

/** 현재역 쌍 — 없으면 null(부재와 빈 문자열을 뭉개지 않는다). */
fun transitLocationLabel(ko: String?, en: String?): TransitLabel? = if (!ko.isNullOrEmpty()) transitLabel(ko, en) else null
