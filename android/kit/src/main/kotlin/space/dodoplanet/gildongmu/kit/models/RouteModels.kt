package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.BearingUnavailable
import space.dodoplanet.gildongmu.kit.CarAction
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.WalkAction

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
)

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
)

/** /api/route/transit envelope. ⚠ result는 optional — null은 ODsay 경로 없음(3-state: 조회 실패 아님). */
@Serializable
data class TransitRouteEnvelope(val result: TransitRouteResult? = null)

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
)

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
) {
    /** 알려진 상태만 매핑하고 미지의 값은 null("판정 없음")이다. */
    val stepFreeStatus: StepFreeStatus? get() = stepFree?.let(StepFreeStatus::fromRawValue)
}

/**
 * 서버 `FinalApproachGeometry`의 디코딩 표면. Kit 계산 타입과 분리한 이유는 서버가 부재 사유에
 * 넷째 값을 추가해도 디코딩이 죽지 않게 하기 위해서다. 판독은 `unavailableReason`.
 */
@Serializable
data class FinalApproachPayload(
    val offsetMeters: Double,
    val relativeBearing: Double? = null,
    val bearingUnavailable: String? = null,
) {
    val unavailableReason: BearingUnavailable? get() = bearingUnavailable?.let(BearingUnavailable::fromRawValue)
}

/**
 * /api/route/walk envelope. result null은 "경로 없음"(3-state: 조회 실패 아님). `shortest`는
 * `alternatives=1` 응답에만 — 부재와 null 모두 null로 안전 디코딩한다.
 */
@Serializable
data class WalkRouteEnvelope(val result: WalkRouteBriefing? = null, val shortest: WalkRouteBriefing? = null)
