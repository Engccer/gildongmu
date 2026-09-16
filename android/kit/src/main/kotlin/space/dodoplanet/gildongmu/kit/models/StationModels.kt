package space.dodoplanet.gildongmu.kit.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import space.dodoplanet.gildongmu.kit.trimSwiftWhitespacesAndNewlines

// 역 상세 4종 + 날씨·공기질·혼잡도 도메인 모델: 웹 `src/lib/types.ts` ↔ Kit `StationModels.swift` 미러.
// 미커버 역·데이터 부재는 envelope 본문 null(graceful degrade). status·grade·label류 문자열은 String.

// MARK: - 역 메타

/** 한 역의 메타 요약: 같은 역명의 여러 노선 레코드를 하나로 집계(웹 StationMeta 미러). */
@Serializable
data class StationMeta(
    val name: String,
    val nameEn: String,
    val nameHanja: String? = null,
    val lines: List<String>,
    /** `lines`의 영문(`lang=en`에만 — 하나라도 미지면 배열 전체 null) */
    val linesEn: List<String>? = null,
    val isTransfer: Boolean,
    /** 운영기관명. JSON 키 "operator"는 Swift 예약어라 이름만 변경(Kotlin도 같은 이름 유지). */
    @SerialName("operator") val operatorName: String,
)

@Serializable
data class StationMetaResponse(val meta: StationMeta? = null)

// MARK: - 코레일 교통약자 시설

/** 철도역 교통약자 편의시설(코레일 406역). 수 필드는 Int? 3-state: null="정보 없음" ≠ 0="없음". */
@Serializable
data class StationFacilities(
    val stationName: String,
    val accessibleToilet: Boolean,
    val wheelchairLifts: Int? = null,
    val accessibleSlope: Boolean,
    val elevators: Int? = null,
)

@Serializable
data class StationFacilitiesResponse(val facilities: StationFacilities? = null)

// MARK: - 서울 지하철 교통약자 시설

/** 시설 인스턴스 하나(엘리베이터 1대 등). 위치·층·가동현황이 낭독 정본. */
@Serializable
data class SeoulMetroFacility(
    val name: String,
    val location: String? = null,
    val floors: String? = null,
    /** 가동현황 "normal"/"stopped". 엘리베이터·에스컬레이터만, 그 외 null */
    val operatingStatus: String? = null,
    val detail: String? = null,
    /** 서버 합성 한국어의 구조화 원재료(A26). 구버전 응답엔 없다. */
    val parts: SeoulMetroFacilityParts? = null,
)

/** `SeoulMetroFacility.parts` — 그룹 종류별로 쓰는 필드가 다르다. */
@Serializable
data class SeoulMetroFacilityParts(
    val location: String? = null,
    /** 노선 번호(예 "5") — "호선"은 앱이 단다. */
    val line: String? = null,
    /** `line`의 영문 노선명(`lang=en`에만, 예 "Line 5"). 표 미스면 null. */
    val lineEn: String? = null,
    val restroomType: String? = null,
    val wheelchairAccessible: Boolean? = null,
    /** 8방위 코드 n·ne·e·se·s·sw·w·nw */
    val compass: String? = null,
    val meters: Int? = null,
    val dong: String? = null,
)

/** 한 시설 종류의 묶음. 데이터가 있는 종류만 포함. */
@Serializable
data class SeoulMetroFacilityGroup(val kind: String, val facilities: List<SeoulMetroFacility>)

/** 한 지하철역의 교통약자 시설 전체. `supplementFailed`는 보강 소스 실패 시에만 true(실패 은폐 금지). */
@Serializable
data class SeoulMetroFacilities(
    val stationName: String,
    val line: String? = null,
    val groups: List<SeoulMetroFacilityGroup>,
    val supplementFailed: Boolean? = null,
)

@Serializable
data class SeoulMetroFacilitiesResponse(val facilities: SeoulMetroFacilities? = null)

// MARK: - 역 실시간 도착

/** 역명 기준 실시간 도착 묶음. SubwayArrival은 NearbyModels 타입 재사용. */
@Serializable
data class StationArrivals(val stationName: String, val arrivals: List<SubwayArrival>)

@Serializable
data class StationArrivalResponse(val arrivals: StationArrivals? = null)

// MARK: - 역 첫차·막차 시간표

/** TAGO 지하철 노선정보에서 파생한 시간표 편성 하나(첫차 또는 막차). */
@Serializable
data class TimetableTrain(
    /** 출발 시각("HH:mm" 원문 그대로) */
    val time: String,
    /** 00~02시대 심야 편성이면 true */
    val nextDay: Boolean? = null,
    val terminus: String,
    val terminusEn: String? = null,
)

/** 한 방향(상행 또는 하행)의 첫차·막차 쌍. */
@Serializable
data class TimetableDirection(val direction: String, val first: TimetableTrain, val last: TimetableTrain)

/** 한 노선의 시간표. 매칭된 노선은 coverage와 무관하게 전부 실린다(A19). */
@Serializable
data class TimetableLine(
    val lineName: String,
    /** "ok"/"noTrains"/"unknown"/"unavailable" — 구서버 응답엔 없다. */
    val coverage: String? = null,
    val directions: List<TimetableDirection>,
    /** `lineName`이 TAGO 축약명에 서버가 "선"을 덧붙인 것일 때만 그 원형(A26). */
    val lineCore: String? = null,
    /** 영문 노선명(`lang=en`에만, E27 표). */
    val lineNameEn: String? = null,
)

/** 역 첫차·막차 시간표 전체(웹 StationTimetable 미러). */
@Serializable
data class StationTimetable(
    val stationName: String,
    /** "weekday"/"saturday"/"sunday" */
    val dailyType: String,
    /** 일부 호출 실패로 불완전하면 true(무운행 위장 금지) */
    val partial: Boolean? = null,
    val lines: List<TimetableLine>,
)

@Serializable
data class StationTimetableResponse(val timetable: StationTimetable? = null)

// MARK: - 공기질

/** 오염물질 하나의 측정. 등급 단어가 낭독 정본, 수치는 보강. 장애·부재면 value null + grade "unknown". */
@Serializable
data class AirPollutant(val value: Double? = null, val grade: String)

/** 가장 가까운 측정소의 실시간 공기질(웹 AirQuality 미러). */
@Serializable
data class AirQuality(
    val stationName: String,
    val stationNameRoman: String? = null,
    /** 현재 위치로부터 거리(km, 에어코리아 정본) */
    val distanceKm: Double,
    val addr: String,
    val dataTime: String,
    val khai: AirPollutant,
    val pm10: AirPollutant,
    val pm25: AirPollutant,
)

@Serializable
data class AirNearbyResponse(val air: AirQuality? = null)

// MARK: - 날씨

/** 코드+라벨 쌍(하늘상태·강수형태 공용). 부재면 code null + label "unknown". */
@Serializable
data class WeatherCode(val code: Int? = null, val label: String)

/** 기상청 격자 좌표. */
@Serializable
data class WeatherGrid(val nx: Int, val ny: Int)

/** 이 지역 날씨: 초단기실황+단기예보 합성. 상태 단어가 낭독 정본, 수치는 보강. 없는 값은 null. */
@Serializable
data class Weather(
    val sky: WeatherCode,
    val precipitation: WeatherCode,
    val tempC: Double? = null,
    val tempMax: Double? = null,
    val tempMin: Double? = null,
    val humidity: Double? = null,
    val precipProbability: Double? = null,
    val baseTime: String,
    val grid: WeatherGrid,
)

@Serializable
data class WeatherNearbyResponse(val weather: Weather? = null)

// MARK: - 실시간 인구 혼잡도

/**
 * 혼잡도 등급어 → 표시 키(웹 `congestion-level.ts` 미러). 닫힌 집합(4단계)이라 앱이 번역할 수 있지만,
 * 서울시가 단계를 늘리면 표에 없는 값이 온다. 그때 null을 돌려 소비자가 **원문을 그대로** 낭독한다.
 */
enum class CongestionLevelKey {
    relaxed, normal, slightlyBusy, busy;

    val rawValue: String get() = name

    companion object {
        /** 등급어 원문에서 키를 판정(Swift `init?(levelText:)`). 미등재 값은 null(원문 낭독 폴백). */
        fun fromLevelText(raw: String): CongestionLevelKey? = when (raw.trimSwiftWhitespacesAndNewlines()) {
            "여유" -> relaxed
            "보통" -> normal
            "약간 붐빔" -> slightlyBusy
            "붐빔" -> busy
            else -> null
        }
    }
}

/** 사용자가 서 있는 서울 핫스팟 영역의 실시간 혼잡도. 예보·인구수는 라우트가 걷어낸 투영이라 여기도 없다. */
@Serializable
data class Congestion(
    val code: String,
    val name: String,
    val nameRoman: String? = null,
    /** 등급어 원문("붐빔"). 표시 계층이 `CongestionLevelKey`로 번역한다 */
    val level: String,
    /** 완성 문장(한국어 자유 텍스트). ko 로케일에서만 노출 */
    val message: String,
    val asOf: String,
)

@Serializable
data class CongestionNearbyResponse(
    /** null은 **오류가 아니다**: 서울시가 혼잡도를 재는 121곳 밖. 조회 실패는 throw로 갈라진다. */
    val area: Congestion? = null,
)
