package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.nullable
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import space.dodoplanet.gildongmu.kit.BearingUnavailable
import space.dodoplanet.gildongmu.kit.CarAction
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.WalkAction
import space.dodoplanet.gildongmu.kit.WalkRouteVariant

// 경로 브리핑 도메인 모델: 웹 /api/route/car·transit·walk 계약 ↔ Kit `RouteModels.swift` 미러
// (계약 정본은 Kit Fixtures/route-*.json). 단위 함정: durationSeconds=초·totalMinutes/walkMinutes/minutes=분·fare류=원.
// mode는 신규 값 추가에 깨지지 않도록 String으로 둔다.

// MARK: - 자동차 경로

/** 자동차 안내 구간의 링크별 도로명·길이(기하 옵트인 — 무명 링크는 name null). */
@Serializable
data class CarRoadLink(val name: String? = null, val distanceMeters: Double)

/**
 * 자동차 경로 안내 구간 하나. guidance(한국어 완성 안내문)가 낭독 정본, 빈 문자열이면 뷰가 name으로 폴백.
 * pathCoords·roadLinks·action은 `includeGeometry=1` 응답에만. ⚠ `action`의 미지 값은 null로 떨어뜨린다.
 */
@Serializable
data class CarRouteGuide(
    /** 지점명(교차로·시설명). 빈 문자열 실측 존재(옵셔널 아님) */
    val name: String,
    val guidance: String,
    val distanceMeters: Int,
    val durationSeconds: Int,
    val pathCoords: List<RoutePoint>? = null,
    val roadLinks: List<CarRoadLink>? = null,
    @Serializable(with = LenientCarActionSerializer::class)
    val action: CarAction? = null,
    /** 결정 지점 이름(E61, 서버 `at` — 기하 옵트인 전용, 이름 없는 "교차로"류는 서버가 뺀다). */
    val at: String? = null,
    /** 결정 지점의 방면(E61, 서버 `toward` — 기하 옵트인 전용). */
    val toward: String? = null,
)

/** 경유지 투영(N4). `via`를 보낸 요청에만 실린다. `stepIndex`는 경유지에서 시작하는 첫 안내 단계. */
@Serializable
data class RouteWaypoint(val stepIndex: Int, val coord: RoutePoint)

/** 자동차 경로 브리핑. ⚠ /api/route/car 응답은 envelope 없이 이 타입 직접. */
@Serializable
data class CarRouteBriefing(
    val distanceMeters: Int,
    /** 총 소요(초). 밀리초 아님(NCP ms→서버가 초로 정규화) */
    val durationSeconds: Int,
    val taxiFare: Int,
    /** 통행료(원). 0이면 뷰가 생략 */
    val tollFare: Int,
    val guides: List<CarRouteGuide>,
    /** ko 서비스 provider 판별자("tmap"/"kakao") — 자동차 안내 버튼 게이트. en(NCP) 응답·구버전은 null. */
    val provider: String? = null,
    val terminalCoord: RoutePoint? = null,
    val waypoint: RouteWaypoint? = null,
    /** 안내문 언어 "ko"/"en"(A26, 웹 `guidanceLang` 미러). 구버전 서버·구버전 응답은 null. */
    val guidanceLang: String? = null,
    /**
     * 정체 구간(E80, 옵트인 `traffic=1`에만). null = 미요청 또는 정보 없음(웹은 키 부재와 `null`을 가르지만 소비자는 둘 다 침묵이라
     * 같은 값으로 받는다), 빈 `jams` = 문턱을 넘는 정체 없음. ⚠ 형식이 어긋나면 경로는 살리고 정체만 null로 접는다(Kit 디코딩 동형 —
     * 일부만 버리면 「정체 없음」으로 위장할 수 있어 통째로 접는다).
     */
    @Serializable(with = LenientCarCongestionSerializer::class)
    val congestion: CarCongestion? = null,
)

/** 정체 구간 하나(E80 spec §2, 웹·Kit `CarJam` 미러). 거리는 경로 출발점 기준 정수 m. */
@Serializable
data class CarJam(
    /** 구간 안 가장 긴 이름 있는 도로. 무명이면 null. */
    val road: String? = null,
    val startMeters: Int,
    val lengthMeters: Int,
    /** 정체 시작·끝 좌표 — 주행 중 판정이 안내 경로에 투영한다. */
    val start: RoutePoint,
    val end: RoutePoint,
)

@Serializable
data class CarCongestion(val jams: List<CarJam>)

/** 정체 관용 디코딩(Kit `CarRouteBriefing.init(from:)`의 `try?`): 해석되지 않으면 null(정보 없음). 미러 파일이 아니라 직렬화 보조다. */
@OptIn(ExperimentalSerializationApi::class)
internal object LenientCarCongestionSerializer : KSerializer<CarCongestion?> {
    override val descriptor: SerialDescriptor = CarCongestion.serializer().descriptor.nullable

    override fun deserialize(decoder: Decoder): CarCongestion? {
        val element = (decoder as JsonDecoder).decodeJsonElement()
        if (element is JsonNull) return null
        return runCatching { decoder.json.decodeFromJsonElement(CarCongestion.serializer(), element) }.getOrNull()
    }

    override fun serialize(encoder: Encoder, value: CarCongestion?) {
        if (value == null) encoder.encodeNull() else encoder.encodeSerializableValue(CarCongestion.serializer(), value)
    }
}

// MARK: - 대중교통 경로

/** 한 경로의 요약. 전부 분·원 단위(ODsay 정규화 후). */
@Serializable
data class TransitRouteSummary(
    val totalMinutes: Int,
    val fare: Int,
    val transfers: Int,
    val walkMinutes: Int,
    val departName: String? = null,
    val arriveName: String? = null,
    /** 영문 출발·도착 정류장(`lang=en` 응답에만, E27). 한국어 필드는 어느 응답에서도 그대로다. */
    val departNameEn: String? = null,
    val arriveNameEn: String? = null,
)

/** 경유 정류장·역 하나(웹 `TransitLegStop` 미러) — `includeStops=1` 옵트인 시에만 온다. */
@Serializable
data class TransitLegStop(
    val name: String,
    /** ODsay 내부 ID 원문(수도권 지하철은 4자리 zero-pad 시 seed stationId와 일치) */
    val stationId: String? = null,
    /** 지역 정류소 ID(버스, 서울은 TOPIS stId 동일값) */
    val localId: String? = null,
    /** 정류소 고유번호(버스 arsID) */
    val arsId: String? = null,
    /** ODsay 정류소 도시 코드 원문(서울=1000) — TOPIS 추적 가능 판정 축 */
    val cityCode: String? = null,
    /** 영문 정류장·역명(`lang=en` 응답에만). `name`은 어느 응답에서도 한국어(조인 키). */
    val nameEn: String? = null,
    val lat: Double,
    val lng: Double,
)

/**
 * 버스 노선 집합의 한 노선(E76, 옵트인 `lanes=1`). 웹 `TransitLane`·Kit `TransitLane` 미러. 첫 항목은 leg 자신이다.
 * ⚠ `lineName`은 `lang=en`에서도 한국어(조인 키), 영문은 `lineNameEn`(표시 전용).
 */
@Serializable
data class TransitLane(
    val lineName: String,
    val lineNameEn: String? = null,
    val serviceRouteId: String? = null,
    val serviceCityCode: Int? = null,
)

/**
 * 경로 구간 하나. mode "walk"/"bus"/"subway". walk leg는 lineName·fromName·stationCount가 전부 null이고,
 * toName·distanceMeters만 가질 수 있다. ⚠ `lang=en` 응답에서도 `lineName`·`fromName`·`toName`은
 * **한국어**다(조인 키). 영문은 `*En`(additive) — 표시 전용.
 * ⚠ additive 필드는 **여기 선언하지 않으면 값이 오지 않는다**(서버가 실어도 앱만 침묵).
 */
@Serializable
data class TransitRouteLeg(
    val mode: String,
    val lineName: String? = null,
    val lineNameEn: String? = null,
    val fromName: String? = null,
    val fromNameEn: String? = null,
    /** 하차 지점명. 도보 구간에서는 "걸어서 도착할 곳". ⚠ 마지막 도보에는 없다. */
    val toName: String? = null,
    val toNameEn: String? = null,
    val stationCount: Int? = null,
    /** 도보 구간 거리(m). ⚠ 3-state: 서버가 결측을 0으로 채우지 않고 필드를 빼므로 null은 "거리 정보 없음"이다. */
    val distanceMeters: Int? = null,
    val minutes: Int,
    /** 운행 시간 판정("running"·"outside"·"unknown"). 버스만, 그 외 null */
    val serviceStatus: String? = null,
    val firstServiceTime: String? = null,
    val lastServiceTime: String? = null,
    /** TOPIS 노선 ID(서울버스 추적 조인 키) */
    val serviceRouteId: String? = null,
    /** 지하철 방향(ODsay wayCode 1=상행·2=하행) */
    val serviceWayCode: Int? = null,
    /** 경유 정류장·역(양 끝 포함) — `includeStops=1` 시 탑승 leg에만 */
    val stops: List<TransitLegStop>? = null,
    /** 하차역 빠른하차 문 위치(서울교통공사 1~8호선) */
    val quickExit: QuickExit? = null,
    /** 이 leg 노선의 급행 정차역 이름 전체 집합(A16 L1). ⚠ null의 뜻은 "판정 불가"이지 "급행 없음"이 아니다. */
    val expressStops: List<String>? = null,
    /** `expressStops`와 같은 순서의 ODsay `stationID` 원문. ID가 있으면 ID로 판정하고 이름은 폴백. */
    val expressStopIds: List<String>? = null,
    /** 승차·하차 출구 번호(E25) — 지하철 leg·`includeStops=1`에만. */
    val exit: TransitLegExit? = null,
    /** 같은 정류장에서 같은 하차 정류장으로 가는 버스 노선 집합(E76, `lanes=1`). 둘 이상일 때 브리핑이 「370, 371」로 쓴다. */
    val lanes: List<TransitLane>? = null,
)

/** 지하철 leg의 승차(`board`)·하차(`alight`) 출구 번호(E25). 서버가 없는 쪽 키를 빼므로 각각 옵셔널. */
@Serializable
data class TransitLegExit(val board: String? = null, val alight: String? = null)

/**
 * 빠른하차 문 위치. `"6-4"`는 6번 칸 4번 문이고, 두 문 사이면 `kind == "between"`에 두 문이 순서대로.
 * ⚠ `kind`는 String이다 — 서버가 형태를 늘려도 디코딩이 깨지지 않게.
 */
@Serializable
data class QuickExitDoor(val kind: String, val doors: List<String>)

/** 한쪽 시설만 있으면 그쪽만 온다 — 없는 시설을 "없음"으로 표현하지 않는다(3-state). */
@Serializable
data class QuickExit(
    val transfer: QuickExitDoor? = null,
    val elevator: QuickExitDoor? = null,
    val stairs: QuickExitDoor? = null,
)

/** 대중교통 경로 하나(요약 + 구간들). */
@Serializable
data class TransitRoute(
    val summary: TransitRouteSummary,
    val legs: List<TransitRouteLeg>,
    /** 응답 안에서 유일한 경로 식별자. ⚠ 펼침 상태·안내 세션 추적·포커스 복귀는 배열 인덱스가 아니라 이 키로. */
    val routeKey: String,
    /** 이 경로가 1순위보다 나은 축("fastest"·"fewestTransfers"). 축 없는 대안은 필드 부재. */
    val highlight: List<String>? = null,
    /** 축 라벨이 없는 대안의 표시 번호(1부터). */
    val displayIndex: Int? = null,
)

/** 추천 1건 + 대안 최대 4건. */
@Serializable
data class TransitRouteResult(
    val recommended: TransitRoute,
    val alternatives: List<TransitRoute>,
    /** 절단 전 후보 경로 총수(조용한 절단 금지). 표시하지는 않는다. */
    val totalCandidates: Int,
    /**
     * 수단 재조회를 제안할 축(E50 §3, "busOnly"·"subwayOnly"). 강등 뒤 전체 후보에 그 수단만 타는 경로가 없을 때만 서버가 싣는다.
     * ⚠ String 목록으로 받고 아는 값만 [knownRequeryAxes]로 쓴다(서버가 늘려도 디코딩이 깨지지 않게).
     */
    val requeryAxes: List<String>? = null,
) {
    /** 아는 재조회 축만(서버 순서 유지, 중복 제거). */
    val knownRequeryAxes: List<TransitModeAxis>
        get() = requeryAxes.orEmpty().mapNotNull(TransitModeAxis::fromRawValue).distinct()
}

/** 수단 재조회 축(E50 판정 2, Kit `TransitModeAxis` 미러). 원시값이 서버 `highlight`·`requeryAxes` 문자열이다. */
enum class TransitModeAxis {
    busOnly, subwayOnly;

    val rawValue: String get() = name

    /** `/api/route/transit?pathType=` 값(ODsay `SearchPathType`: 2 버스·1 지하철). */
    val pathType: String get() = if (this == busOnly) "2" else "1"

    companion object {
        fun fromRawValue(raw: String): TransitModeAxis? = entries.firstOrNull { it.name == raw }
    }
}

/** /api/route/transit envelope. ⚠ result는 optional — null은 ODsay 경로 없음(3-state: 조회 실패 아님). */
@Serializable
data class TransitRouteEnvelope(val result: TransitRouteResult? = null)

// MARK: - 여정(E70 — 택시 → 대중교통 → 택시)

// /api/route/journey 응답(spec 2026-10-17-e70-mode-change-journey-design.md §4.7). ko 전용. Kit `RouteModels.swift`의 여정 타입 미러.
// 좌표는 기존 `RoutePoint`, 택시 구간은 기존 `CarRouteBriefing`, 대중교통은 `TransitRoute` 그대로.
// ⚠ 갈래 enum(`JourneyMissingSide`·`JourneyVariantKind`·`EgressKind`)은 Swift처럼 엄격하다 — 모르는 값은 디코딩 실패다
// (서버가 모르는 갈래를 보내면 조용히 다른 갈래로 읽지 않는다).

/** 지정 역을 찾지 못한 쪽(판정 14). 한쪽만 지정한 조회는 그쪽만 온다. */
@Serializable
enum class JourneyMissingSide { board, alight, both }

@Serializable
data class JourneyDesignatedMissing(
    val side: JourneyMissingSide,
    /** 지금 탄 열차의 승차 쪽에서 반대 방향에만 그 역 열차가 있을 때 true(E71 판정 R5). 키가 없으면 null. */
    val oppositeDirection: Boolean?,
)

/** 변형의 갈래. 지정 역 경로와 추천 경로가 같으면 `designated` 하나만 온다. */
@Serializable
enum class JourneyVariantKind { designated, recommended }

/** 이 변형이 실제로 타는(내리는) 역. `name`은 서버 표기 그대로이고 문장에는 `journeyStationDisplayName`을 거쳐 넣는다. */
@Serializable
data class JourneyStationRef(val name: String, val coord: RoutePoint)

/** 하차 뒤 택시를 탈 자리의 종류. `none`은 후보가 없어 하차 정류 좌표에서 곧장 택시를 부르는 경우다. */
@Serializable
enum class EgressKind { exit, stand, none }

/** 출구·승강장 후보 하나와 거기서 도착지까지의 택시 구간. */
@Serializable
data class EgressOption(
    val kind: EgressKind,
    /** 출구 번호("1", "3-1") · 승강장 이름 · `none`이면 "". */
    val label: String,
    /** 카카오 POI 이름 원문(예 "광화문역 5호선 1번출구", `none`이면 ""). 출구 도보 세션의 목적지 이름이다. */
    val placeName: String,
    val lineName: String?,
    val coord: RoutePoint,
    val taxiOut: CarRouteBriefing,
)

@Serializable
data class JourneyEgress(
    /** [0] = 택시 시간 최단 출구(기본). 승강장은 있으면 마지막. */
    val options: List<EgressOption>,
    /** 출구 조회가 실패했다는 신호 — 후보 없음(`none`)과 다른 사실이라 문장이 갈린다(3-state). */
    val lookupFailed: Boolean?,
)

@Serializable
data class JourneyTotals(val minutes: Int, val taxiFare: Int, val transitFare: Int)

@Serializable
data class JourneyVariant(
    val kind: JourneyVariantKind,
    val boardStation: JourneyStationRef?,
    val alightStation: JourneyStationRef?,
    /** 승차 역을 지정했을 때만 온다. */
    val taxiIn: CarRouteBriefing?,
    /** 앞뒤 도보를 자른 경로. `routeKey` 유지라 실시간 안내가 그대로 읽는다. */
    val transit: TransitRoute,
    /** 하차 역을 지정한 변형에만 온다(하차 역을 지정하지 않았으면 부재). 마지막 탈것이 버스여도 싣고, 그때 후보는 `kind: none` 하나다. */
    val egress: JourneyEgress?,
    val totals: JourneyTotals,
)

@Serializable
data class JourneyResult(
    /** 0~2개. [0]이 기본 선택(지정 역 경로, 없으면 추천). 빈 배열은 "경로 없음"이지 조회 실패가 아니다. */
    val variants: List<JourneyVariant>,
    val designatedMissing: JourneyDesignatedMissing?,
)

/**
 * `journey` 조회의 결과. 서버의 서비스 지역 밖 마커(`{"outOfCoverage":true}`, 200)는 `APIClient`가 던지는
 * `APIError.OutOfCoverage`를 `RouteService.journey`가 이 갈래로 바꿔 돌려준다(경로 없음·조회 실패와 다른 신호).
 * sealed 케이스는 PascalCase(Swift `.result`·`.outOfCoverage`).
 */
sealed class JourneyResponse {
    data class Result(val result: JourneyResult) : JourneyResponse()
    object OutOfCoverage : JourneyResponse()
}

/** 정류장 이름 검색 한 건(E70-e spec §4.6). `source`는 서울 TOPIS / 지방 TAGO. */
@Serializable
data class JourneyStopHit(
    val name: String,
    val lat: Double,
    val lng: Double,
    val stopNo: String?,
    val source: Source,
) {
    @Serializable
    enum class Source { seoul, tago }
}

/**
 * 정류장 이름 검색 응답. 3-state: 정상 0건(`stops` 빈 배열, 플래그 없음) / 미유도(`unsearched`) / 일부 실패(`failed`).
 * `truncated` = TAGO 페이지 상한에 걸려 가까운 정류장이 빠졌을 수 있다. 플래그 부재 = false(Swift 커스텀 디코딩 대응 기본값).
 */
@Serializable
data class JourneyStopsResult(
    val stops: List<JourneyStopHit>,
    val unsearched: Boolean = false,
    val failed: Boolean = false,
    val truncated: Boolean = false,
)

// MARK: - 도보 경로

/**
 * 도보 안내 단계 하나. description이 낭독 정본(완성 문장). `action`은 서버가 투영한 결정 지점
 * 행동 — 도보 리듀서는 문장 분류 폴백 없이 이 필드만 본다. `crossing`은 이 스텝 구간 전체가
 * 횡단이라는 서버 판정(A26). 셋 다 선택 디코딩(구버전 서버 응답 호환), 미지 action은 null.
 */
@Serializable
data class WalkRouteStep(
    val description: String,
    val distanceMeters: Int? = null,
    val pathCoords: List<RoutePoint>? = null,
    val live: WalkLiveFragments? = null,
    @Serializable(with = LenientWalkActionSerializer::class)
    val action: WalkAction? = null,
    val crossing: Boolean? = null,
    /** 방향 구절과 나머지 문장(E62 판본 2, Kit `WalkStepParts` 미러). 되읽기·억제 복구·횡단 윗줄은 `body`를 쓴다. */
    val parts: WalkStepParts? = null,
    /** 횡단보도 건너는 방향 시(E62, 1~12 — 12 = 진행 방향 그대로, 6 = 뒤). 임박 문장이 쓴다. */
    val crossingClock: Int? = null,
)

/** 방향 구절(`turn`, 마침표 없음)과 그것을 뺀 나머지(`body`, 주석 꼬리 포함). E62 spec §3.4. */
@Serializable
data class WalkStepParts(val turn: String, val body: String)

/** 서버 재작성 정규식이 분해한 이름 조각. 추출 실패는 필드 부재 — 클라이언트가 한국어 문장을 재파싱해 채우지 않는다. */
@Serializable
data class WalkLiveFragments(val target: String? = null, val anchor: String? = null)

/** 계단 회피 적용 상태(웹 `StepFreeStatus` 미러). rawValue가 서버 문자열이다. */
enum class StepFreeStatus(val rawValue: String) {
    applied("applied"),
    noStepFreeRoute("no_stepfree_route"),
    unavailable("unavailable");

    companion object {
        fun fromRawValue(raw: String): StepFreeStatus? = entries.firstOrNull { it.rawValue == raw }
    }
}

/** 도보 경로 브리핑(자동차와 동형, 지도 없이 완결되는 텍스트 정본). */
@Serializable
data class WalkRouteBriefing(
    val distanceMeters: Int,
    val durationSeconds: Int,
    val steps: List<WalkRouteStep>,
    /** 계단 회피 판정(원시 문자열). ⚠ enum으로 직접 디코딩하지 않는다 — 넷째 상태가 브리핑 전체를 깨뜨린다. */
    val stepFree: String? = null,
    /** 열화 상태의 안내 문장(서버 정본). `applied`이거나 미요청이면 null. */
    val stepFreeNotice: String? = null,
    /** 경로 종점 → 목적지 오프셋 기하. 선택 디코딩. */
    val finalApproach: FinalApproachPayload? = null,
    /** 경유지(N4, `via` 요청에만). */
    val waypoint: RouteWaypoint? = null,
    /**
     * 이 경로의 줄 종류(E42, 원시 문자열) — 기하 응답(`includeGeometry=1`)에만 온다. 요청이 아니라 서버가 실제로
     * 돌려준 경로의 성질이다(계단 회피 요청이 큰길로 내려가면 `broad`). 판독은 `lineKind`.
     */
    val kind: String? = null,
) {
    /** 알려진 상태만 매핑하고 미지의 값은 null("판정 없음")이다. */
    val stepFreeStatus: StepFreeStatus? get() = stepFree?.let(StepFreeStatus::fromRawValue)

    /** 알려진 줄 종류만 매핑하고 미지의 값·부재는 null — 이름을 지어 붙이지 않는다. */
    val lineKind: WalkLineKind? get() = kind?.let(WalkLineKind::fromRawValue)
}

/**
 * 서버 `FinalApproachGeometry`의 디코딩 표면. Kit 계산 타입과 분리한 이유는 서버가 부재 사유에
 * 넷째 값을 추가해도 디코딩이 죽지 않게 하기 위해서다. 판독은 `unavailableReason`.
 */
@Serializable
data class FinalApproachPayload(
    val offsetMeters: Double,
    // ⚠ 기본값을 두지 않는다 — `relativeBearing`과 `bearingUnavailable`은 "방향을 안다"와 "왜 모르는가"의
    // 짝이라 둘 다 생략한 생성은 계약 위반인데 기본값이 있으면 조용히 컴파일된다. 없는 키의 디코딩은
    // `KitJson`의 `explicitNulls = false`가 이미 null로 받는다(기본값과 무관).
    val relativeBearing: Double?,
    val bearingUnavailable: String?,
) {
    val unavailableReason: BearingUnavailable? get() = bearingUnavailable?.let(BearingUnavailable::fromRawValue)
}

/**
 * /api/route/walk envelope. result null은 "경로 없음"(3-state: 조회 실패 아님). `shortest`는
 * `alternatives=1` 응답에만 — 부재와 null 모두 null로 안전 디코딩한다.
 */
@Serializable
data class WalkRouteEnvelope(val result: WalkRouteBriefing? = null, val shortest: WalkRouteBriefing? = null)

/**
 * 조회 화면 도보 줄의 종류(E42, 웹 `WalkLineKind` 미러). 이름이 곧 그 경로의 성질에 대한 약속이라 **서버가 판정**하고
 * 클라이언트는 이름·안내 요청으로 투영만 한다. ko는 `shortest`·`accessible`|`broad`, en은 `recommended`·`shortest`.
 */
enum class WalkLineKind {
    shortest, accessible, broad, recommended;

    val rawValue: String get() = name

    /** 안내 요청의 경로 축 — 최단 줄만 `shortest`. */
    val variant: WalkRouteVariant? get() = if (this == shortest) WalkRouteVariant.shortest else null

    /**
     * 안내 요청의 계단 회피 — 계단 회피 줄만 참. 큰길·추천은 기본 파이프라인이다. Swift `accessible`이지만 Kotlin enum은 항목
     * `accessible`과 같은 이름의 속성을 둘 수 없어 개명했다.
     */
    val isAccessible: Boolean get() = this == accessible

    companion object {
        fun fromRawValue(raw: String): WalkLineKind? = entries.firstOrNull { it.name == raw }

        /**
         * 안내 중 전환·대안 프리뷰의 대상(E52, Swift `WalkLineKind.switchAlternate` 미러): 조회 화면의 다른 줄 중 **계단 회피가
         * 있으면 그것**, 없으면 첫 다른 줄. 세 줄 화면에서 "첫 다른 줄"로 고르면 계단 회피 줄로는 영영 전환할 수 없다.
         * 두 줄 이하에서는 종전("반대편 줄")과 같다. 줄이 이것뿐이면 null(진입점 없음).
         */
        fun switchAlternate(kind: WalkLineKind, among: List<WalkLineKind>): WalkLineKind? {
            val others = among.filter { it != kind }
            return others.firstOrNull { it.isAccessible } ?: others.firstOrNull()
        }
    }
}

/** `/api/route/walk?lines=2` 응답의 한 줄. 줄 경로엔 `stepFree`·`stepFreeNotice`가 없다(이름이 그 정보다). */
@Serializable
data class WalkRouteLine(
    /**
     * 줄 종류(원시 문자열). ⚠ **enum으로 디코딩하지 않는다** — 서버가 다섯째 종류를 더하면 응답 전체의 디코딩이
     * 실패한다(`stepFree` 규율 동형). 판독은 `lineKind`가 한다.
     */
    val kind: String,
    val route: WalkRouteBriefing,
) {
    /** 알려진 종류만 매핑하고 미지의 값은 null — 이름을 지어 붙이지 않고 화면에서 뺀다. */
    val lineKind: WalkLineKind? get() = WalkLineKind.fromRawValue(kind)
}

/**
 * `/api/route/walk?lines=2` envelope(E42·E52 판본). 배열 순서가 화면 순서이고 첫 원소가 기본 펼침이다.
 * 빈 배열은 "경로 없음"(3-state — 조회 실패는 서버가 502로 던진다).
 */
@Serializable
data class WalkRouteLinesEnvelope(
    val lines: List<WalkRouteLine>,
    /** 조회가 실패해 빠진 줄(E52 위원장 판정 (나), 판본 2 additive — 없으면 실패 없음). 원시 문자열이다(`kind` 규율 동형). */
    val failedLines: List<String>? = null,
)

/** 조회 화면 도보 줄 목록(`RouteService.walkLines`의 반환, Swift `WalkRouteLineList` 미러) — 알려진 종류의 줄과 조회가 실패해 빠진 줄. */
data class WalkRouteLineList(val lines: List<WalkRouteLine>, val failedLines: List<String>)
