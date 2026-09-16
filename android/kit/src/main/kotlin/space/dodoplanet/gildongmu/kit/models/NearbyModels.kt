package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// 내 주변 도메인 모델 — 웹 `src/lib/types.ts` ↔ Kit `NearbyModels.swift` 미러(계약 정본은 웹 + Kit Fixtures/*-nearby.json).
// distanceMeters는 전 라우트가 정수(m)로 반올림해 내려준다. status·kind류 문자열은 String(신규 값 추가에 관대).

// MARK: - 지하철 도착

/** 한 역에 도착 예정인 열차 하나. 낭독 정본은 완성 문장 `message`(arvlMsg2). */
@Serializable
data class SubwayArrival(
    /** 호선명(미매핑 코드면 null) */
    val line: String? = null,
    val lineEn: String? = null,
    /** 상/하행 또는 내/외선 */
    val direction: String,
    val directionEn: String? = null,
    /** 행선 안내 완성 문구("{종착역}행 - {주요경유}방면") */
    val trainLineNm: String,
    val trainLineNmEn: String? = null,
    val destination: String,
    /** 도착 메시지(완성 문장, 낭독 정본. 예 "곧 도착"·"전역 출발") */
    val message: String,
    val messageEn: String? = null,
    val currentLocation: String? = null,
    val currentLocationEn: String? = null,
    /** 도착 예정(초). 0이면 진입/도착 — ⚠ 슬롯형 환산 금지(운행종료에도 비0) */
    val arrivalSeconds: Int,
    val express: Boolean,
)

/** 내 주변 지하철역 + 실시간 도착 묶음. */
@Serializable
data class NearbySubwayStation(
    val stationName: String,
    val nameEn: String? = null,
    val lines: List<String>,
    val linesEn: List<String>? = null,
    val distanceMeters: Int,
    /** "ok"(0건=정상적 열차 없음) / "unavailable"(조회 실패) / "closed"(운행 시간 밖, firstTime 동반) / "unknown". 넷을 뭉개지 않는다. */
    val arrivalStatus: String,
    val arrivals: List<SubwayArrival>,
    /** 다음 첫차 "HH:MM"(closed일 때만). */
    val firstTime: String? = null,
)

/** 조회 반경 안에 역이 0건일 때만 실리는 최근접 역 1곳. */
@Serializable
data class NearestSubwayStation(
    val stationName: String,
    val nameEn: String? = null,
    val lines: List<String>,
    val linesEn: List<String>? = null,
    val distanceMeters: Int,
)

@Serializable
data class SubwayNearbyResponse(val stations: List<NearbySubwayStation>, val nearest: NearestSubwayStation? = null)

/** 화면 payload — 목록과 "0건일 때의 최근접 역"을 함께 옮긴다. */
data class SubwayNearbyResult(val stations: List<NearbySubwayStation>, val nearest: NearestSubwayStation?)

// MARK: - 버스 도착

/** 정류소에 도착 예정인 버스 하나. */
@Serializable
data class BusArrival(
    val routeId: String,
    val routeNo: String,
    val routeType: String,
    val arrivalSeconds: Int,
    val prevStationCount: Int,
    /** 저상버스 여부 — 교통약자 정본, 텍스트로 흡수해 표시 */
    val lowFloor: Boolean,
    /** 완성 도착 문장(낭독 정본). 서울 TOPIS만 채움(arrmsg1) — TAGO는 null */
    val arrivalMessage: String? = null,
    /** 제공자("tago"/"seoul") */
    val source: String,
)

/** 내 주변 버스 정류소 + 도착 묶음. */
@Serializable
data class BusStop(
    val nodeId: String,
    val cityCode: String,
    val name: String,
    val nameRoman: String? = null,
    val stopNo: String? = null,
    val lat: Double,
    val lng: Double,
    val distanceMeters: Int,
    val source: String,
    /** "ok" / "unavailable" 2-state — 버스는 운행 종료를 구분할 소스가 없다. */
    val arrivalStatus: String,
    val arrivals: List<BusArrival>,
)

@Serializable
data class BusNearbyResponse(val stops: List<BusStop>)

// MARK: - 따릉이

/** 따릉이 대여소 하나. 정수 필드라 "0대"와 "정보 없음"의 구조적 혼동 없음. */
@Serializable
data class BikeStation(
    val stationId: String,
    val name: String,
    val nameRoman: String? = null,
    val lat: Double,
    val lng: Double,
    val distanceMeters: Int,
    val racksTotal: Int,
    val bikesAvailable: Int,
)

@Serializable
data class BikeNearbyResponse(val stations: List<BikeStation>)

// MARK: - 소아 야간진료

/** 진료시간 한 칸 — HHMM 정수. 그 요일 정보가 없으면 둘 다 null(=마감 아님, "정보 없음"). */
@Serializable
data class ClinicHours(val start: Int? = null, val end: Int? = null)

/** 소아 야간진료 기관 하나. openStatus는 라우트가 요청 시점 KST로 덧붙이는 필드. */
@Serializable
data class NightClinic(
    val id: String,
    val name: String,
    val nameRoman: String? = null,
    val address: String,
    /** 대표 전화 — 없으면 "" */
    val phone: String,
    val kind: String,
    val emergencyClass: String,
    /** 찾아오는 길 안내 — 없으면 "" */
    val directions: String,
    val lat: Double,
    val lng: Double,
    val distanceMeters: Int,
    /** 월~일·공휴일 진료시간(8칸) */
    val hours: List<ClinicHours>,
    val openStatus: OpenStatus,
    /** 달빛어린이병원 지정 여부. 구버전 응답 호환을 위해 optional(부재 = 구분 정보 없음). */
    val designated: Boolean? = null,
) {
    /** 진료 상태 3-state — "정보 없음(unknown)"과 "마감(closed)"을 뭉개지 않는다. */
    @Serializable
    data class OpenStatus(
        /** "open" / "closed" / "unknown" */
        val state: String,
        val start: Int? = null,
        val end: Int? = null,
    )
}

@Serializable
data class ClinicNearbyResponse(
    val clinics: List<NightClinic>,
    /** 병합 후 전체 수(절단 전). 구버전 응답은 null. */
    val total: Int? = null,
    val designatedTotal: Int? = null,
    val supplementTotal: Int? = null,
    val radiusMeters: Int? = null,
    val supplementRadiusMeters: Int? = null,
    /** 진료시간 판정 축("holiday"/"weekday") */
    val basis: String? = null,
    /** 보완 소스 조회 실패 — 지정 기관만 표시 중임을 밝힌다(은폐 금지). */
    val supplementFailed: Boolean? = null,
)

// MARK: - 아이 놀 곳

/** 아이 놀 곳 하나(카카오 화이트리스트 정규화). */
@Serializable
data class KidsPlace(
    val id: String,
    val name: String,
    val nameRoman: String? = null,
    val category: String,
    val categoryEn: String? = null,
    /** "kidscafe" / "playground" / "playcenter" / "park" */
    val kind: String,
    /** "indoor" / "outdoor" / "unknown" — 3-state, unknown도 문장으로 표시 */
    val indoorOutdoor: String,
    val distanceMeters: Int,
    val address: String,
    val roadAddress: String? = null,
    val lat: Double,
    val lng: Double,
    val phone: String? = null,
    val link: String? = null,
)

@Serializable
data class KidsNearbyResponse(val kids: List<KidsPlace>)

// MARK: - 둘러보기

/** 둘러보기 장소 하나. bearing은 북 기준 절대 8방위 — heading 없는 기기라 정면-상대 방향 금지(웹 계약). */
@Serializable
data class SurroundingPlace(
    val id: String,
    val name: String,
    val nameRoman: String? = null,
    /** 카테고리 키(10종) */
    val category: String,
    /** 카카오 category_name 전체 계층(보조 표시) */
    val categoryRaw: String,
    val categoryEn: String? = null,
    val distanceMeters: Int,
    /** 8방위 소문자("n"·"ne"·"e"·"se"·"s"·"sw"·"w"·"nw") */
    val bearing: String,
    val lat: Double,
    val lng: Double,
    val phone: String? = null,
    val link: String? = null,
)

@Serializable
data class AroundNearbyResponse(val places: List<SurroundingPlace>)

// MARK: - 버스 노선 경유 정류소

/** 노선 경유 정류소 하나(도착 항목 lazy 펼치기 전용). */
@Serializable
data class BusRouteStop(val nodeId: String, val name: String, val order: Int, val lat: Double, val lng: Double)

@Serializable
data class BusRouteStopsResponse(val stops: List<BusRouteStop>)

// MARK: - 문화행사

/** 근처 문화행사 하나(웹 CultureEvent 미러). 오늘 진행 중인 것만 서버가 판정해 내려준다. */
@Serializable
data class CultureEvent(
    val id: String,
    val title: String,
    val titleRoman: String? = null,
    val category: String,
    val place: String,
    val placeRoman: String? = null,
    val district: String,
    /** 원본 완성 표기("2026-06-04~2026-08-23") — 재조합 금지 */
    val dateText: String,
    val timeText: String,
    val isFree: Boolean,
    /** 유료일 때만 존재하는 요금 원문 */
    val fee: String? = null,
    val target: String,
    val link: String? = null,
    val lat: Double,
    val lng: Double,
    val distanceMeters: Int,
)

@Serializable
data class EventsNearbyResponse(val events: List<CultureEvent>, val total: Int)

// MARK: - 한눈에 보기 (/api/nearby/overview)

// 웹 `src/lib/nearby-overview.ts` 미러. 서버는 구조화 데이터만 내고 문장은 `buildOverviewLines`
// (LocationNarrative, CORE)가 결정론 템플릿으로 조립한다. 불릿별 독립 3-state.

@Serializable
data class OverviewPlace(
    val name: String,
    val nameRoman: String? = null,
    val distanceMeters: Int,
    val bearing: String,
)

@Serializable
data class OverviewStation(
    val name: String,
    val nameEn: String? = null,
    val line: String? = null,
    val bearing: String,
    val distanceMeters: Int,
)

/** Swift `OverviewBusStops` 미러 — 케이스는 PascalCase(`.empty` → `Empty`, JSON "none"). */
sealed class OverviewBusStops {
    data class Ok(val count: Int, val nearest: List<OverviewPlace>) : OverviewBusStops()
    /** 반경 내 0건(JSON "none"). */
    data object Empty : OverviewBusStops()
    /** TAGO 미커버 지역 — "없음"과 다르다. */
    data object Uncovered : OverviewBusStops()
    data object Failed : OverviewBusStops()
}

enum class OverviewPlaceKind {
    food, cafe, kids, events, barrierFree;

    companion object {
        fun fromRawValue(raw: String): OverviewPlaceKind? = entries.firstOrNull { it.name == raw }
    }
}

sealed class OverviewPlaceState {
    /** countCapped = 상류 캡에 걸려 "N곳 이상"으로 말해야 하는 경우(식당·카페 30). */
    data class Ok(val count: Int, val countCapped: Boolean, val nearest: List<OverviewPlace>) : OverviewPlaceState()
    data object Empty : OverviewPlaceState()
    data object UnavailableSeoulOnly : OverviewPlaceState()
    data object Failed : OverviewPlaceState()
}

sealed class OverviewBullet {
    /** busStops null = 버스 조각 키 없음(조각 생략), station null = 반경 내 역 없음. */
    data class Transit(val station: OverviewStation?, val busStops: OverviewBusStops?) : OverviewBullet()
    data class Place(val kind: OverviewPlaceKind, val state: OverviewPlaceState) : OverviewBullet()
}

/** 순서 고정(transit, food, kids, events, barrierFree). 모르는 kind·state는 버린다(화면이 죽지 않는다). */
@Serializable(with = NearbyOverviewSerializer::class)
data class NearbyOverview(
    val place: String?,
    val placeRoman: String? = null,
    val radiusMeters: Int,
    val bullets: List<OverviewBullet>,
)

object NearbyOverviewSerializer : KSerializer<NearbyOverview> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("NearbyOverview") {
        element<String>("place", isOptional = true)
        element<Int>("radiusMeters")
    }

    override fun deserialize(decoder: Decoder): NearbyOverview {
        val input = decoder as JsonDecoder
        val json = input.json
        val c = input.decodeJsonElement().jsonObject
        val places = ListSerializer(OverviewPlace.serializer())
        val decoded = ArrayList<OverviewBullet>()
        for (item in c.getValue("bullets").jsonArray) {
            val b = item.jsonObject
            val kind = b.getValue("kind").jsonPrimitive.content
            val state = b.getValue("state").jsonPrimitive.content
            if (kind == "transit") {
                val station = b["station"]?.takeIf { it !is JsonNull }
                    ?.let { json.decodeFromJsonElement(OverviewStation.serializer(), it) }
                var bus: OverviewBusStops? = null
                val busElement = b["busStops"]
                if (busElement != null && busElement !is JsonNull) {
                    val bc = busElement.jsonObject
                    bus = when (bc.getValue("state").jsonPrimitive.content) {
                        "ok" -> OverviewBusStops.Ok(
                            count = bc.getValue("count").jsonPrimitive.int,
                            nearest = json.decodeFromJsonElement(places, bc.getValue("nearest")),
                        )
                        "none" -> OverviewBusStops.Empty
                        "uncovered" -> OverviewBusStops.Uncovered
                        "failed" -> OverviewBusStops.Failed
                        else -> null
                    }
                }
                decoded.add(OverviewBullet.Transit(station, bus))
                continue
            }
            val placeKind = OverviewPlaceKind.fromRawValue(kind) ?: continue
            val placeState: OverviewPlaceState? = when (state) {
                "ok" -> OverviewPlaceState.Ok(
                    count = b.getValue("count").jsonPrimitive.int,
                    countCapped = b["countCapped"]?.jsonPrimitive?.booleanOrNull ?: false,
                    nearest = b["nearest"]?.takeIf { it !is JsonNull }?.let { json.decodeFromJsonElement(places, it) } ?: emptyList(),
                )
                "none" -> OverviewPlaceState.Empty
                "unavailable" -> if (b["reason"]?.jsonPrimitive?.contentOrNull == "seoulOnly") OverviewPlaceState.UnavailableSeoulOnly else null
                "failed" -> OverviewPlaceState.Failed
                else -> null
            }
            if (placeState != null) decoded.add(OverviewBullet.Place(placeKind, placeState))
        }
        return NearbyOverview(
            place = c["place"]?.jsonPrimitive?.contentOrNull,
            placeRoman = c["placeRoman"]?.jsonPrimitive?.contentOrNull,
            radiusMeters = c.getValue("radiusMeters").jsonPrimitive.int,
            bullets = decoded,
        )
    }

    override fun serialize(encoder: Encoder, value: NearbyOverview) {
        throw UnsupportedOperationException("NearbyOverview는 디코딩 전용이다")
    }
}

@Serializable
data class NearbyOverviewResponse(
    /** null = 전 불릿 키 부재 + 위치 문장 없음(구성 결함). 소비자는 실패와 다른 문구로. */
    val data: NearbyOverview? = null,
)
