package space.dodoplanet.gildongmu.directions

import space.dodoplanet.gildongmu.kit.formatDistance
import space.dodoplanet.gildongmu.kit.joinText
import space.dodoplanet.gildongmu.kit.models.CarRouteBriefing
import space.dodoplanet.gildongmu.kit.models.TransitRouteSummary
import space.dodoplanet.gildongmu.kit.models.WalkLineKind
import space.dodoplanet.gildongmu.kit.models.WalkRouteBriefing
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt

// 수단별 요약·스텝 문장(spec §3-4, iOS `RouteBriefing.swift` 대응). 거리는 `formatDistance` 정본만 지난다.

/** 요금 천 단위 구분 — 앱 UI 로케일(iOS `formatted(.number.grouping(.automatic))`의 대응, spec §11-14). */
fun wonText(amount: Int, lang: String): String =
    NumberFormat.getIntegerInstance(Locale.forLanguageTag(lang)).format(amount.toLong())

fun transitSummaryText(summary: TransitRouteSummary, lang: String, strings: Strings): String = joinText(
    strings.get("android.route.durationMinutes", summary.totalMinutes),
    strings.get("android.route.fare", wonText(summary.fare, lang)),
    strings.get("android.route.transfers", summary.transfers),
    // 도보 0분은 생략(웹 TransitRouteResult의 walkMinutes > 0 조건 동형)
    if (summary.walkMinutes > 0) strings.get("android.route.walkMinutes", summary.walkMinutes) else null,
)

/**
 * 도보 요약의 표시 분(초를 반올림). ⚠ 접힘 문턱 판정(:kit `WalkCollapse.shouldCollapse`)도 같은 반올림이다 —
 * 판정과 표시가 다른 값을 쓰면 경계에서 "약 30분인데 접혔다"가 생긴다.
 */
fun walkDisplayMinutes(briefing: WalkRouteBriefing): Int = (briefing.durationSeconds / 60.0).roundToInt()

fun walkSummaryText(briefing: WalkRouteBriefing, strings: Strings): String =
    strings.get("route.pedestrian.summary", formatDistance(briefing.distanceMeters), walkDisplayMinutes(briefing))

/** 자동차 요약 1행. 통행료 0원은 생략(잉여). */
fun carSummaryText(briefing: CarRouteBriefing, lang: String, strings: Strings): String = joinText(
    strings.get("android.route.totalDistance", formatDistance(briefing.distanceMeters)),
    strings.get("android.route.durationMinutes", briefing.durationSeconds / 60),
    strings.get("android.route.taxiFare", wonText(briefing.taxiFare, lang)),
    if (briefing.tollFare > 0) strings.get("android.route.tollFare", wonText(briefing.tollFare, lang)) else null,
)

/** 도보 줄 이름(E42, iOS `WalkLineText.nameKey` 미러) — 조회 화면 줄 이름과 안내 시작 버튼이 같은 이름을 쓴다. */
fun walkLineNameKey(line: WalkLineKind): String = when (line) {
    WalkLineKind.shortest -> "directions.walkShortest"
    WalkLineKind.accessible -> "directions.walkAccessible"
    WalkLineKind.broad -> "directions.walkBroad"
    WalkLineKind.recommended -> "directions.walkRecommended"
}

/**
 * 도보 줄 라벨(E42, 위원장 확정 렌더 `최단 경로, 총 850m, 약 12분`) — 이름과 요약뿐이다. **사유 문장(`stepFreeNotice`)을
 * 붙이지 않는다**: 이름이 곧 그 경로의 성질이다.
 */
fun walkLineLabel(line: WalkLineKind, route: WalkRouteBriefing, strings: Strings): String =
    joinText(strings.get(walkLineNameKey(line)), walkSummaryText(route, strings))

/**
 * 도보 스텝 행 문장들(구획 행 포함). 번호는 **원본 인덱스 + 1**(웹 `<ol>`·CLI·iOS와 같은 값 — 생략으로 밀지 않는다).
 * 서버가 스텝 0에 삽입한 `stepFreeNotice`는 생략한다(iOS `omitNoticeStep` — E42 줄 경로엔 싣지 않지만 삽입 계약은 남아 있다).
 * `viaLabel`이 있으면 `waypoint.stepIndex` 자리 **앞**에 "경유지 {label} 도착" 구획 행(번호 없음).
 */
fun walkStepItems(briefing: WalkRouteBriefing, viaLabel: String?, strings: Strings): List<String> {
    val items = ArrayList<String>()
    val waypoint = briefing.waypoint
    briefing.steps.forEachIndexed { index, step ->
        if (waypoint != null && index == waypoint.stepIndex && viaLabel != null) items += strings.get("directions.viaArrived", viaLabel)
        if (step.description.isEmpty()) return@forEachIndexed
        if (index == 0 && step.description == briefing.stepFreeNotice) return@forEachIndexed
        items += "${index + 1}. ${step.description}"
    }
    return items
}

/** 자동차 안내 행(iOS 정본: `guidance` 비면 `name`, 둘 다 비면 생략, 거리 0은 미제공이라 생략). */
fun carStepItems(briefing: CarRouteBriefing, viaLabel: String?, strings: Strings): List<String> {
    val items = ArrayList<String>()
    val waypoint = briefing.waypoint
    briefing.guides.forEachIndexed { index, guide ->
        if (waypoint != null && index == waypoint.stepIndex && viaLabel != null) items += strings.get("directions.viaArrived", viaLabel)
        val text = guide.guidance.ifEmpty { guide.name }
        if (text.isEmpty()) return@forEachIndexed
        items += joinText(text, if (guide.distanceMeters > 0) formatDistance(guide.distanceMeters) else null)
    }
    return items
}
