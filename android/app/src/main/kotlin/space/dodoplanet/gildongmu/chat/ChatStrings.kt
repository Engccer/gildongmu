package space.dodoplanet.gildongmu.chat

import android.content.res.Resources
import androidx.annotation.StringRes
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.i18n.appLocalized

/**
 * 대화 상태 머신이 쓰는 문장(호출 시점에 읽는다 — 앱별 언어 변경을 따라간다). 리소스는 화면 몫이라 ViewModel은 이것을 주입받고,
 * JVM 테스트는 카탈로그 JSON을 직접 푸는 페이크로 만든다(`SearchStrings`·`NearbyStrings` 관례).
 */
class ChatStrings(
    val failed: () -> String,
    val emptyAnswer: () -> String,
    val progressFallback: () -> String,
    val progressSearching: (String) -> String,
    /** 도구 카테고리 라벨. 미지 키는 원문 그대로(iOS 동형). */
    val toolLabel: (String) -> String,
    /** 지오코딩 0건 — "좌표를 찾지 못해". */
    val addressNotFound: () -> String,
    /** 지오코딩 조회 실패 — "확인하지 못했습니다"(3-state: 없음 ≠ 실패). */
    val addressLookupFailed: () -> String,
)

fun chatStrings(res: Resources): ChatStrings = chatStrings { res }

/** ViewModel 팩토리용 — **호출 시점**에 `res()`를 읽는다(spec §14-2, 프로덕션은 `{ AppConfig.localizedApp().resources }`). */
fun chatStrings(res: () -> Resources): ChatStrings = ChatStrings(
    failed = { res().getString(R.string.android_chat_failed) },
    emptyAnswer = { res().getString(R.string.android_chat_emptyAnswer) },
    progressFallback = { res().getString(R.string.android_chat_progressFallback) },
    progressSearching = { appLocalized(res(), R.string.chat_progress_searching, it) },
    toolLabel = { category -> toolLabelId(category)?.let(res()::getString) ?: category },
    addressNotFound = { res().getString(R.string.search_addressCoordFailed) },
    addressLookupFailed = { res().getString(R.string.directions_coordError) },
)

/** 도구 카테고리 → 라벨 리소스(iOS `ChatModel.toolLabel` 표 전수, 리터럴 매핑 — 키 린터가 대조할 수 있게). */
@StringRes
fun toolLabelId(category: String): Int? = when (category) {
    "search_places" -> R.string.chat_progress_tool_search_places
    "search_address" -> R.string.chat_progress_tool_search_address
    "get_subway_arrivals" -> R.string.chat_progress_tool_get_subway_arrivals
    "get_night_clinics" -> R.string.chat_progress_tool_get_night_clinics
    "get_kids_places" -> R.string.chat_progress_tool_get_kids_places
    "get_surroundings" -> R.string.chat_progress_tool_get_surroundings
    "get_bus_arrivals" -> R.string.chat_progress_tool_get_bus_arrivals
    "get_bike_stations" -> R.string.chat_progress_tool_get_bike_stations
    "get_air_quality" -> R.string.chat_progress_tool_get_air_quality
    "get_weather" -> R.string.chat_progress_tool_get_weather
    "get_station_meta" -> R.string.chat_progress_tool_get_station_meta
    "get_station_facilities" -> R.string.chat_progress_tool_get_station_facilities
    "get_car_route" -> R.string.chat_progress_tool_get_car_route
    "get_transit_route" -> R.string.chat_progress_tool_get_transit_route
    "get_walk_route" -> R.string.chat_progress_tool_get_walk_route
    "get_nearby_barrier_free" -> R.string.chat_progress_tool_get_nearby_barrier_free
    "get_walk_infrastructure" -> R.string.chat_progress_tool_get_walk_infrastructure
    "search_web" -> R.string.chat_progress_tool_search_web
    "unknown" -> R.string.chat_progress_tool_unknown
    else -> null
}

/** 서버 출처 라벨(`source.<id>`) → 표시 리소스(iOS `sourceDisplayLabel` 표 전수). 미지 라벨은 호출부가 원문을 보인다(키 누락이 화면에 드러난다). */
@StringRes
fun sourceLabelId(label: String): Int? = when (label) {
    "source.airkorea" -> R.string.chat_source_airkorea
    "source.juso" -> R.string.chat_source_juso
    "source.kakao" -> R.string.chat_source_kakao
    "source.kakaomobility" -> R.string.chat_source_kakaomobility
    "source.kma" -> R.string.chat_source_kma
    "source.korail" -> R.string.chat_source_korail
    "source.kric" -> R.string.chat_source_kric
    "source.ncp" -> R.string.chat_source_ncp
    "source.nmc" -> R.string.chat_source_nmc
    "source.odsay" -> R.string.chat_source_odsay
    "source.osm" -> R.string.chat_source_osm
    "source.perplexity" -> R.string.chat_source_perplexity
    "source.seoulmetro" -> R.string.chat_source_seoulmetro
    "source.seoulopen" -> R.string.chat_source_seoulopen
    "source.tago" -> R.string.chat_source_tago
    "source.tmap" -> R.string.chat_source_tmap
    "source.tourapi" -> R.string.chat_source_tourapi
    else -> null
}
