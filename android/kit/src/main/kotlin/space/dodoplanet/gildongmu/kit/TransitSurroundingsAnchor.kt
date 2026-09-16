package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.TransitLegStop

/**
 * 대중교통 안내 "주변 확인" 앵커 판정(E15-2, spec 2026-08-23-transit-surroundings-anchor §2). Kit
 * `TransitSurroundingsAnchor.swift` 미러.
 *
 * "현재역"은 조망의 `transitOverviewHere`가 `Station`으로 **확정**했을 때만이다 — 같은 화면에서 조망은 "현재 위치 모름"
 * 이라 말하고 주변 확인은 "현재역 주변"이라 말하는 모순을 판정 재사용으로 막는다. 그 밖은 전부 하차역이고, 정차역
 * 목록이 없어 하차역 좌표를 모르면 앵커가 없다(섹션 미노출 — 좌표 없는 주변 확인은 없다).
 *
 * ⚠ 웹 미러가 없는 Kit 단독 순수 함수다 — 웹에는 주변 확인 UI가 없다.
 */
sealed class TransitSurroundingsAnchor {
    abstract val stop: TransitLegStop

    data class CurrentStation(override val stop: TransitLegStop) : TransitSurroundingsAnchor()
    data class AlightStop(override val stop: TransitLegStop) : TransitSurroundingsAnchor()
}

fun transitSurroundingsAnchor(state: TransitGuideState, leg: TransitGuideLeg): TransitSurroundingsAnchor? {
    val here = transitOverviewHere(state, leg)
    if (here is TransitOverviewHere.Station && here.stopIndex in leg.viaStops.indices) {
        return TransitSurroundingsAnchor.CurrentStation(leg.viaStops[here.stopIndex])
    }
    val alight = leg.alightStop ?: return null
    return TransitSurroundingsAnchor.AlightStop(alight)
}
