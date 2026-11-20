package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.BuildConfig
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.TransitTextLine
import space.dodoplanet.gildongmu.kit.TransitTextPart

/**
 * Kit descriptor → 앱 카탈로그 문자열(iOS `TransitGuideTextRenderer.swift` 미러, E27 잔여 ① spec 2026-09-01 §3.7).
 *
 * 판정(키·인자 순서·줄 언어)은 Kit `TransitGuideText`가 하고 여기서는 **리터럴 키 조회**만 한다. 리터럴인 이유는 `GuideSourceGuardTest` ⑧이
 * 키 모양 리터럴 전수를 `guideStringId` 표와 대조하기 때문이다(동적 키는 대조 밖). `when` 망라성은 `transitTextKeys`와의 대조 테스트가 강제한다.
 */
class TransitGuideTextRenderer(private val strings: Strings, private val isEn: () -> Boolean) {
    /**
     * 한 줄 → 문자열. 조각을 각자 조회해 쉼표로 잇는다(빈 조각 제거 — 웹 `joinText` 미러).
     *
     * ⚠ **en 세션에서 ko로 떨어진 줄은 계측한다**(spec §3.8): 줄 단위 언어 태깅 수단이 없어 한국어 폴백이 영어 음성에 삼켜질 수 있는데, 그것을
     * 수용 위험으로 넘기는 대신 **관측 가능하게** 만든다. 실승차에서 한글이 들렸을 때 이 로그가 있으면 "서버가 영문을 못 만든 정상 폴백", 없으면
     * "배선 누락"으로 갈린다.
     */
    fun render(line: TransitTextLine): String {
        if (isEn() && line.lang == "ko" && line.parts.isNotEmpty()) {
            val keys = line.parts.mapNotNull { it.key }.joinToString(",")
            GuideDiag.log { "transit koFallback keys=${keys.ifEmpty { "(raw)" }}" }
        }
        return line.parts.map(::part).filter { it.isNotEmpty() }.joinToString(", ")
    }

    private fun part(p: TransitTextPart): String {
        p.text?.let { return it }
        val key = p.key ?: return ""
        val args = (p.args ?: emptyList()).toTypedArray()
        return when (key) {
            "waitContext" -> strings.get("transitGuide.waitContext", *args)
            "waitContextBus" -> strings.get("transitGuide.waitContextBus", *args)
            "waitContextWalk" -> strings.get("transitGuide.waitContextWalk", *args)
            "waitContextWalkBus" -> strings.get("transitGuide.waitContextWalkBus", *args)
            "boardingContext" -> strings.get("transitGuide.boardingContext", *args)
            "boardingContextBus" -> strings.get("transitGuide.boardingContextBus", *args)
            "context" -> strings.get("transitGuide.context", *args)
            "contextBus" -> strings.get("transitGuide.contextBus", *args)
            "contextBusUnconfirmed" -> strings.get("transitGuide.contextBusUnconfirmed", *args)
            "remainingCount" -> strings.get("transitGuide.remainingCount", *args)
            "remainingCountJoin" -> strings.get("transitGuide.remainingCountJoin", *args)
            "stopsAway" -> strings.get("transitGuide.stopsAway", *args)
            "stopsAwayOnly" -> strings.get("transitGuide.stopsAwayOnly", *args)
            "busEtaMinSec" -> strings.get("transitGuide.busEtaMinSec", *args)
            "busEtaMin" -> strings.get("transitGuide.busEtaMin", *args)
            "busEtaSec" -> strings.get("transitGuide.busEtaSec", *args)
            "busSoon" -> strings.get("transitGuide.busSoon", *args)
            "busNotDeparted" -> strings.get("transitGuide.busNotDeparted", *args)
            "busTurning" -> strings.get("transitGuide.busTurning", *args)
            "subwayNextStop" -> strings.get("transitGuide.subwayNextStop", *args)
            "subwayArriving" -> strings.get("transitGuide.subwayArriving", *args)
            "subwayAtStop" -> strings.get("transitGuide.subwayAtStop", *args)
            "subwayDeparted" -> strings.get("transitGuide.subwayDeparted", *args)
            "approachFrame" -> strings.get("transitGuide.approachFrame", *args)
            "vehicleSelected" -> strings.get("transitGuide.vehicleSelected", *args)
            "selectedVehicle" -> strings.get("transitGuide.selectedVehicle", *args)
            "vehiclePassed" -> strings.get("transitGuide.vehiclePassed", *args)
            "boardConfirmNeeded" -> strings.get("transitGuide.boardConfirmNeeded", *args)
            "boardConfirmLapsed" -> strings.get("transitGuide.boardConfirmLapsed", *args)
            "arrivedAtBoardStop" -> strings.get("transitGuide.arrivedAtBoardStop", *args)
            "arrivedAtBoardStopBus" -> strings.get("transitGuide.arrivedAtBoardStopBus", *args)
            "arrivingAtBoardStop" -> strings.get("transitGuide.arrivingAtBoardStop", *args)
            "arrivingAtBoardStopBus" -> strings.get("transitGuide.arrivingAtBoardStopBus", *args)
            "boarded" -> strings.get("transitGuide.boarded", *args)
            "boardedAlight" -> strings.get("transitGuide.boardedAlight", *args)
            "arrivingAtAlightStop" -> strings.get("transitGuide.arrivingAtAlightStop", *args)
            "arrivingAtAlightStopUnnamed" -> strings.get("transitGuide.arrivingAtAlightStopUnnamed", *args)
            "alightStopReached" -> strings.get("transitGuide.alightStopReached", *args)
            "alightStopReachedUnnamed" -> strings.get("transitGuide.alightStopReachedUnnamed", *args)
            "currentStation" -> strings.get("transitGuide.currentStation", *args)
            "bound" -> strings.get("transitGuide.bound", *args)
            "expressCheck" -> strings.get("transitGuide.expressCheck", *args)
            "expressStopsAt" -> strings.get("transitGuide.expressStopsAt", *args)
            "expressSkipsAlight" -> strings.get("transitGuide.expressSkipsAlight", *args)
            "exitBound" -> strings.get("transitGuide.exitBound", *args)
            "exitBoundSentence" -> strings.get("transitGuide.exitBoundSentence", *args)
            "departed" -> strings.get("transitGuide.departed", *args)
            "terminatesEarly" -> strings.get("transitGuide.terminatesEarly", *args)
            "viaBoard" -> strings.get("transitGuide.viaBoard", *args)
            "viaAlight" -> strings.get("transitGuide.viaAlight", *args)
            "viaCurrent" -> strings.get("transitGuide.viaCurrent", *args)
            "overviewLeg" -> strings.get("transitGuide.overviewLeg", *args)
            "prewalkStart" -> strings.get("transitGuide.prewalkStart", *args)
            "prewalkArrived" -> strings.get("transitGuide.prewalkArrived", *args)
            "prewalkArrivedButton" -> strings.get("transitGuide.prewalkArrivedButton", *args)
            "openStation" -> strings.get("transitGuide.openStation", *args)
            else -> {
                // Kit이 키를 늘렸는데 여기 분기가 빠진 것 — 디버그에서 즉시 드러내고, 릴리스는 키를 그대로 노출해 침묵을 피한다.
                check(!BuildConfig.DEBUG) { "TransitGuideText 키 미매핑: $key" }
                key
            }
        }
    }
}

/** 데이터 언어 축 — 비-ko 로케일은 전부 영문 데이터를 공유한다(E27 잔여 ① §3.1). iOS `transitGuideIsEn`. */
fun transitGuideIsEn(dataLocale: DataLocale): Boolean = dataLocale == DataLocale.en
