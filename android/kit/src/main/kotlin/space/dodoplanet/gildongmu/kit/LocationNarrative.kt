package space.dodoplanet.gildongmu.kit

import space.dodoplanet.gildongmu.kit.models.CultureEvent
import space.dodoplanet.gildongmu.kit.models.NearbyOverview
import space.dodoplanet.gildongmu.kit.models.OverviewBullet
import space.dodoplanet.gildongmu.kit.models.OverviewBusStops
import space.dodoplanet.gildongmu.kit.models.OverviewPlace
import space.dodoplanet.gildongmu.kit.models.OverviewPlaceKind
import space.dodoplanet.gildongmu.kit.models.OverviewPlaceState
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.TransitLegStop

// "한눈에 보기" 문장 빌더 — 웹 `src/lib/overview-lines.ts` ↔ CLI `formatNearbyOverview` ↔ Kit
// `LocationNarrative.swift` 미러. 템플릿은 `messages/*.json` whereAmI.overview.*(위치 인자), 방위 단어는
// whereAmI.direction.*.

/** 8방위 단어. 미지정 키는 원문 반환(웹 폴백 동형). 키는 리터럴 when(동적 조립 금지, 린터 계약). */
internal fun directionWord(bearing: String, lang: String): String = when (bearing) {
    "n" -> kitLocalized("whereAmI.direction.n", lang)
    "ne" -> kitLocalized("whereAmI.direction.ne", lang)
    "e" -> kitLocalized("whereAmI.direction.e", lang)
    "se" -> kitLocalized("whereAmI.direction.se", lang)
    "s" -> kitLocalized("whereAmI.direction.s", lang)
    "sw" -> kitLocalized("whereAmI.direction.sw", lang)
    "w" -> kitLocalized("whereAmI.direction.w", lang)
    "nw" -> kitLocalized("whereAmI.direction.nw", lang)
    else -> bearing
}

// 한눈에 보기 문장 (M4)

private fun overviewLabel(kind: OverviewPlaceKind, lang: String): String = when (kind) {
    OverviewPlaceKind.food -> kitLocalized("whereAmI.overview.labelFood", lang)
    OverviewPlaceKind.cafe -> kitLocalized("whereAmI.overview.labelCafe", lang)
    OverviewPlaceKind.kids -> kitLocalized("whereAmI.overview.labelKids", lang)
    OverviewPlaceKind.events -> kitLocalized("whereAmI.overview.labelEvents", lang)
    OverviewPlaceKind.barrierFree -> kitLocalized("whereAmI.overview.labelBarrierFree", lang)
}

/** ko 라벨에 주격·보조사를 붙인다(라벨은 전부 한글이라 판정 불가가 없다). 다른 언어는 그대로. */
private fun withSubject(label: String, lang: String): String =
    if (lang == "ko") label + (KoreanParticle.subjectMarker(label) ?: "") else label

private fun withTopic(label: String, lang: String): String =
    if (lang == "ko") label + (KoreanParticle.topicMarker(label) ?: "") else label

/**
 * 불릿 한 줄의 문장 + 한글 병기 꼬리(E28, 웹 `OverviewLine` 미러). `secondary`는 병기한 이름들의 한글 원문을
 * 순서대로 쉼표로 이었고, 없으면 null. 화면은 `text`를 낭독하고 시각은 `text (secondary)`.
 */
data class OverviewLine(val text: String, val secondary: String?) {
    val display: String get() = if (secondary == null) text else "$text ($secondary)"
}

/** 병기한 한글 이름을 불릿 단위로 모은다. */
private class KoSink {
    val names = ArrayList<String>()
    val secondary: String? get() = if (names.isEmpty()) null else names.joinToString(", ")
}

/** 불릿에 넣을 이름 — 비-ko는 원천 영문(역 `nameEn`) → 로마자 → 한글 순(`bilingualName` 규칙). */
private fun pickName(name: String, en: String?, roman: String?, lang: String, sink: KoSink): String {
    val b = bilingualName(lang, ko = name, en = en, roman = roman)
    b.secondary?.let { sink.names.add(it) }
    return b.primary
}

/**
 * "가장 가까운 곳은 {첫 곳}이고, {나머지}가 있습니다." — 거리·방위를 이름 앞에 두는 어순(웹 `nearestSentence`
 * 미러). 첫 곳만 `nearestFirst`("…지점에 있는 {name}")로 서술격 조사를 받고, 나머지는
 * `nearestItem`으로 나열하며 ko는 마지막 이름에만 주격 조사가 붙는다(판정 불가면 조사 자리를 비운다 —
 * `KoreanParticle` 계약). 한 곳뿐이면 나열이 없으므로 `nearestOne`.
 * ⚠ 인자 순서는 ko 플레이스홀더 등장 순서(direction, distance, name).
 */
private fun overviewNearest(items: List<OverviewPlace>, lang: String, sink: KoSink): String {
    val head = items.firstOrNull() ?: return ""
    val first = kitLocalized(
        "whereAmI.overview.nearestFirst", lang,
        directionWord(head.bearing, lang),
        formatDistance(head.distanceMeters),
        pickName(head.name, en = null, roman = head.nameRoman, lang = lang, sink = sink),
    )
    val rest = items.drop(1)
    if (rest.isEmpty()) return kitLocalized("whereAmI.overview.nearestOne", lang, first)
    val parts = rest.mapIndexed { offset, place ->
        val name = pickName(place.name, en = null, roman = place.nameRoman, lang = lang, sink = sink)
        kitLocalized(
            "whereAmI.overview.nearestItem", lang,
            directionWord(place.bearing, lang),
            formatDistance(place.distanceMeters),
            if (offset == rest.size - 1) withSubject(name, lang) else name,
        )
    }
    return kitLocalized("whereAmI.overview.nearestLead", lang, first, parts.joinToString(", "))
}

/**
 * 불릿당 문장 묶음(한 접근성 객체). 상태별 문장이 전부 다르다(3-state 불변식) — 반경 문구는 헤딩 부제
 * (`whereAmI.overview.radius`)가 한 번만 말하고, none 문장만 반경을 품는다. 템플릿은 `messages` 로케일
 * JSON의 whereAmI.overview.*(6 로케일, LLM 아님).
 */
fun buildOverviewLines(overview: NearbyOverview, lang: String): List<OverviewLine> {
    val radius = formatDistance(overview.radiusMeters)
    return overview.bullets.map { bullet ->
        val sink = KoSink()
        val text = overviewBulletText(bullet, lang, radius, sink)
        OverviewLine(text, sink.secondary)
    }
}

private fun overviewBulletText(bullet: OverviewBullet, lang: String, radius: String, sink: KoSink): String = when (bullet) {
    is OverviewBullet.Transit -> {
        val parts = ArrayList<String>()
        val station = bullet.station
        if (station != null) {
            val line = station.line?.let { kitLocalized("whereAmI.overview.transitLine", lang, it) } ?: ""
            // ⚠ 인자 순서는 ko 플레이스홀더 등장 순서(direction, distance, line, name).
            parts.add(
                kitLocalized(
                    "whereAmI.overview.transitStation", lang,
                    directionWord(station.bearing, lang),
                    formatDistance(station.distanceMeters),
                    line,
                    pickName(station.name, en = station.nameEn, roman = null, lang = lang, sink = sink),
                ),
            )
        } else {
            parts.add(kitLocalized("whereAmI.overview.transitNoStation", lang, radius))
        }
        when (val bus = bullet.busStops) {
            is OverviewBusStops.Ok -> parts.add(
                kitLocalized("whereAmI.overview.transitBus", lang, bus.count, overviewNearest(bus.nearest, lang, sink)),
            )
            OverviewBusStops.Empty -> parts.add(kitLocalized("whereAmI.overview.transitBusNone", lang))
            OverviewBusStops.Uncovered -> parts.add(kitLocalized("whereAmI.overview.transitBusUncovered", lang))
            OverviewBusStops.Failed -> parts.add(kitLocalized("whereAmI.overview.transitBusFailed", lang))
            null -> {}
        }
        kitLocalized("whereAmI.overview.transitLead", lang, parts.joinToString(" "))
    }
    is OverviewBullet.Place -> {
        val label = overviewLabel(bullet.kind, lang)
        when (val state = bullet.state) {
            is OverviewPlaceState.Ok -> kitLocalized(
                if (state.countCapped) "whereAmI.overview.okCapped" else "whereAmI.overview.ok", lang,
                withSubject(label, lang), state.count.toString(), overviewNearest(state.nearest, lang, sink),
            )
            OverviewPlaceState.Empty -> kitLocalized("whereAmI.overview.none", lang, withTopic(label, lang), radius)
            OverviewPlaceState.UnavailableSeoulOnly ->
                kitLocalized("whereAmI.overview.unavailableSeoulOnly", lang, withTopic(label, lang))
            OverviewPlaceState.Failed -> kitLocalized("whereAmI.overview.failedItem", lang, label)
        }
    }
}

// MARK: 한눈에 보기 문장 속 상세 진입(E65)

/**
 * 「한눈에 보기」 한 줄이 부른 장소 중 상세 화면을 열 수 있는 것 하나. 뷰가 장소마다 「○○ 상세 보기」 액션을 단다
 * (채팅 산문·브리핑 동형 — 장소가 여럿인 문장은 장소마다 액션). Swift `OverviewDetailTarget` 미러(`id` = `place.id`).
 */
data class OverviewDetailTarget(
    /** 그 문장이 부른 이름(`bilingualName`의 `primary`) — 액션 라벨이 문장과 같은 이름을 말한다. */
    val name: String,
    val place: Place,
    /** 역 상세의 노선 힌트(E44 전화 조회는 같은 역·같은 노선 후보만 본다). 역만 있다. */
    val lineHint: String?,
    /** 문화 행사 원본 — 상세 화면의 행사 섹션 재료. 행사만 있다. */
    val event: CultureEvent?,
    /** 역 대상인가 — 라벨 키가 다르다(`transitGuide.openStation`). */
    val isStation: Boolean,
) {
    val id: String get() = place.id
}

/**
 * 한 불릿의 상세 진입 대상을 **문장 등장 순**으로(E65 spec §2). 문장을 파싱하지 않고 불릿 구조에서 뽑는다 —
 * `buildOverviewLines`와 같은 순서(역 → 버스, `nearest` 배열 순)다. 상세 화면이 없는 종류(버스 정류소)와
 * 옵트인 재료(`places=1`)가 없는 항목은 빠진다(죽은 액션을 달지 않는다).
 */
fun overviewDetailTargets(bullet: OverviewBullet, lang: String): List<OverviewDetailTarget> = when (bullet) {
    is OverviewBullet.Transit -> {
        val station = bullet.station
        val lat = station?.lat
        val lng = station?.lng
        if (station == null || lat == null || lng == null) {
            emptyList()
        } else {
            val stop = TransitLegStop(name = station.name, lat = lat, lng = lng, nameEn = station.nameEn)
            val name = bilingualName(lang = lang, ko = station.name, en = station.nameEn, roman = null).primary
            listOf(
                OverviewDetailTarget(name = name, place = transitStopPlace(stop), lineHint = station.line, event = null, isStation = true),
            )
        }
    }
    is OverviewBullet.Place -> {
        val state = bullet.state
        if (state is OverviewPlaceState.Ok) {
            state.nearest.mapNotNull { item ->
                val name = bilingualName(lang = lang, ko = item.name, en = null, roman = item.nameRoman).primary
                val event = item.event
                val place = item.place
                when {
                    event != null -> OverviewDetailTarget(name = name, place = cultureEventToPlace(event), lineHint = null, event = event, isStation = false)
                    place != null -> OverviewDetailTarget(name = name, place = place, lineHint = null, event = null, isStation = false)
                    else -> null
                }
            }
        } else {
            emptyList()
        }
    }
}
