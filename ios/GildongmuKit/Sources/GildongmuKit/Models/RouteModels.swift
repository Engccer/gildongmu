import Foundation

// 경로 브리핑 도메인 모델: 웹 /api/route/car·/api/route/transit·/api/route/walk 계약 미러
// (계약 정본은 Fixtures/route-car.json·route-transit.json·route-walk.json).
// 단위 함정 주의: durationSeconds=초·totalMinutes/walkMinutes/minutes=분·fare류=원.
// mode는 신규 값 추가에 깨지지 않도록 String으로 둔다(기존 원칙).

// MARK: - 자동차 경로

/// 자동차 안내 구간의 링크별 도로명·길이(B1 기하 옵트인 — 무명 링크는 name nil).
public struct CarRoadLink: Codable, Sendable, Hashable {
    public let name: String?
    public let distanceMeters: Double

    public init(name: String?, distanceMeters: Double) {
        self.name = name
        self.distanceMeters = distanceMeters
    }
}

/// 자동차 경로 안내 구간 하나. guidance(한국어 완성 안내문)가 낭독 정본,
/// 빈 문자열이면 뷰가 name으로 폴백(둘 다 비면 행 생략).
/// pathCoords·roadLinks는 `includeGeometry=1` 요청에서만 오는 B1 기하(옵셔널).
public struct CarRouteGuide: Codable, Sendable, Hashable {
    /// 지점명(교차로·시설명). 빈 문자열 실측 존재(옵셔널 아님)
    public let name: String
    /// 안내문(예 "올림픽대교 왕십리역 방면으로 우회전")
    public let guidance: String
    /// 이 구간 거리(m)
    public let distanceMeters: Int
    /// 이 구간 소요(초)
    public let durationSeconds: Int
    /// 동작 이후 구간 폴리라인(기하 옵트인 전용)
    public let pathCoords: [RoutePoint]?
    /// 링크별 도로명·길이(기하 옵트인 전용)
    public let roadLinks: [CarRoadLink]?

    public init(
        name: String, guidance: String, distanceMeters: Int, durationSeconds: Int,
        pathCoords: [RoutePoint]? = nil, roadLinks: [CarRoadLink]? = nil
    ) {
        self.name = name
        self.guidance = guidance
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
        self.pathCoords = pathCoords
        self.roadLinks = roadLinks
    }
}

/// 자동차 경로 브리핑. ⚠ /api/route/car 응답은 envelope 없이 이 타입 직접.
public struct CarRouteBriefing: Codable, Sendable, Hashable {
    /// 총 거리(m)
    public let distanceMeters: Int
    /// 총 소요(초). 밀리초 아님(NCP ms→서버가 초로 정규화, 단위 회귀 테스트 대상)
    public let durationSeconds: Int
    /// 예상 택시 요금(원)
    public let taxiFare: Int
    /// 통행료(원). 0이면 뷰가 생략
    public let tollFare: Int
    /// 턴바이턴 안내 구간들
    public let guides: [CarRouteGuide]
    /// ko 서비스 provider 판별자("tmap"/"kakao") — 자동차 안내 버튼 게이트(B1 §3.1).
    /// en(NCP) 응답·구버전 서버는 nil.
    public let provider: String?
    /// 종점(E) 마커 좌표(기하 옵트인 전용, B1 §5 커버리지 검증 축).
    public let terminalCoord: RoutePoint?

    public init(
        distanceMeters: Int, durationSeconds: Int, taxiFare: Int, tollFare: Int,
        guides: [CarRouteGuide], provider: String? = nil, terminalCoord: RoutePoint? = nil
    ) {
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
        self.taxiFare = taxiFare
        self.tollFare = tollFare
        self.guides = guides
        self.provider = provider
        self.terminalCoord = terminalCoord
    }
}

// MARK: - 대중교통 경로

/// 한 경로의 요약. 전부 분·원 단위(ODsay 정규화 후).
public struct TransitRouteSummary: Codable, Sendable, Hashable {
    /// 총 소요(분)
    public let totalMinutes: Int
    /// 요금(원)
    public let fare: Int
    /// 환승 횟수
    public let transfers: Int
    /// 도보 합계(분)
    public let walkMinutes: Int
    /// 출발 정류장·역명(없으면 nil)
    public let departName: String?
    /// 도착 정류장·역명(없으면 nil)
    public let arriveName: String?
}

/// 경유 정류장·역 하나(웹 `TransitLegStop` 미러) — `includeStops=1` 옵트인 시에만 온다(B2 §7).
public struct TransitLegStop: Codable, Sendable, Hashable {
    public let name: String
    /// ODsay 내부 ID 원문(수도권 지하철은 4자리 zero-pad 시 seed stationId와 일치)
    public let stationId: String?
    /// 지역 정류소 ID(버스, 서울은 TOPIS stId 동일값)
    public let localId: String?
    /// 정류소 고유번호(버스 arsID — 서울 getStationByUid 조회 키)
    public let arsId: String?
    /// ODsay 정류소 도시 코드 원문(서울=1000) — TOPIS 추적 가능 판정 축
    public let cityCode: String?
    public let lat: Double
    public let lng: Double

    public init(
        name: String, stationId: String? = nil, localId: String? = nil,
        arsId: String? = nil, cityCode: String? = nil, lat: Double, lng: Double
    ) {
        self.name = name
        self.stationId = stationId
        self.localId = localId
        self.arsId = arsId
        self.cityCode = cityCode
        self.lat = lat
        self.lng = lng
    }
}

/// 경로 구간 하나. mode "walk"/"bus"/"subway".
/// walk leg는 lineName·fromName·stationCount가 전부 nil이고, toName·distanceMeters만
/// 가질 수 있다(도보 구간의 행선지·거리, spec §3.2).
public struct TransitRouteLeg: Codable, Sendable, Hashable {
    public let mode: String
    /// 노선명(예 "수도권 5호선"·"342"), walk는 nil
    public let lineName: String?
    /// 승차 지점명
    public let fromName: String?
    /// 하차 지점명. 도보 구간에서는 "걸어서 도착할 곳"(뒤 첫 탑승 구간의 승차역).
    /// ⚠ 마지막 도보에는 없다. provider가 목적지 이름을 모른다(뒤에 탑승이 없다).
    public let toName: String?
    /// 경유 역·정류장 수
    public let stationCount: Int?
    /// 도보 구간 거리(미터, ODsay 원값이 정수). 탑승 구간에는 오지 않는다.
    /// ⚠ 3-state: 서버가 결측·비수치를 0으로 채우지 않고 **필드를 빼므로** nil은
    ///   "0m"가 아니라 "거리 정보 없음"이다. 표시는 거리 없는 문구로 떨어진다.
    public let distanceMeters: Int?
    /// 이 구간 소요(분)
    public let minutes: Int
    /// 운행 시간 판정("running"·"outside"·"unknown"). 버스만, 그 외 nil
    public let serviceStatus: String?
    /// 첫차 시각 "04:00"(판정된 경우만)
    public let firstServiceTime: String?
    /// 막차 시각 "22:30"(판정된 경우만)
    public let lastServiceTime: String?
    /// TOPIS 노선 ID(서울버스 추적 조인 키, B2) — additive optional
    public let serviceRouteId: String?
    /// 지하철 방향(ODsay wayCode 1=상행·2=하행) — additive optional
    public let serviceWayCode: Int?
    /// 경유 정류장·역(양 끝 포함) — `includeStops=1` 시 탑승 leg에만
    public let stops: [TransitLegStop]?
    /// 하차역 빠른하차 문 위치(서울교통공사 1~8호선, E5) — additive optional.
    /// ⚠ additive라도 **여기 선언하지 않으면 값이 오지 않는다**. 서버가 실었는데
    ///   앱만 침묵하는 조용한 결함이라 계약 테스트가 디코딩부터 문장까지 훑는다.
    public let quickExit: QuickExit?

    public init(
        mode: String, lineName: String?, fromName: String?, toName: String?,
        stationCount: Int?, minutes: Int, serviceStatus: String?,
        firstServiceTime: String?, lastServiceTime: String?,
        serviceRouteId: String? = nil, serviceWayCode: Int? = nil,
        stops: [TransitLegStop]? = nil, distanceMeters: Int? = nil,
        quickExit: QuickExit? = nil
    ) {
        self.mode = mode
        self.lineName = lineName
        self.fromName = fromName
        self.toName = toName
        self.stationCount = stationCount
        self.distanceMeters = distanceMeters
        self.minutes = minutes
        self.serviceStatus = serviceStatus
        self.firstServiceTime = firstServiceTime
        self.lastServiceTime = lastServiceTime
        self.serviceRouteId = serviceRouteId
        self.serviceWayCode = serviceWayCode
        self.stops = stops
        self.quickExit = quickExit
    }
}

/// 빠른하차 문 위치. `"6-4"`는 6번 칸 4번 문이고, 두 문 사이면 `kind == "between"`에
/// 두 문이 순서대로 담긴다(문 번호 자리에 `"3-2,3-3 사이"`를 넣으면 문장이 깨진다).
/// ⚠ `kind`는 String이다 — 서버가 형태를 늘려도 디코딩이 깨지지 않게(mode와 같은 원칙).
public struct QuickExitDoor: Codable, Sendable, Hashable {
    public let kind: String
    public let doors: [String]

    public init(kind: String, doors: [String]) {
        self.kind = kind
        self.doors = doors
    }
}

/// 한쪽 시설만 있으면 그쪽만 온다 — 없는 시설을 "없음"으로 표현하지 않는다(3-state).
public struct QuickExit: Codable, Sendable, Hashable {
    public let elevator: QuickExitDoor?
    public let stairs: QuickExitDoor?

    public init(elevator: QuickExitDoor? = nil, stairs: QuickExitDoor? = nil) {
        self.elevator = elevator
        self.stairs = stairs
    }
}

/// 대중교통 경로 하나(요약 + 구간들).
public struct TransitRoute: Codable, Sendable, Hashable {
    public let summary: TransitRouteSummary
    public let legs: [TransitRouteLeg]
    /// 응답 안에서 유일한 경로 식별자(서버가 정규화 시점에 부여).
    /// ⚠ 펼침 상태·안내 세션 추적·포커스 복귀는 **배열 인덱스가 아니라 이 키로** 한다.
    ///   강등 정렬·재조회로 표시 순서가 바뀌면 인덱스는 다른 경로를 가리킨다.
    public let routeKey: String
    /// 이 경로가 1순위보다 나은 축("fastest"·"fewestTransfers", 둘 다일 수 있다).
    /// 축 없는 대안은 필드 부재. 표시 이름은 `TransitAlternativeName`이 고른다.
    /// ⚠ 서버가 축을 늘려도 깨지지 않도록 String 배열로 둔다(mode와 같은 원칙).
    public let highlight: [String]?
    /// 축 라벨이 없는 대안의 표시 번호(1부터). 번호를 서버가 정해 3플랫폼이 갈리지 않는다.
    public let displayIndex: Int?

    public init(
        summary: TransitRouteSummary, legs: [TransitRouteLeg], routeKey: String,
        highlight: [String]? = nil, displayIndex: Int? = nil
    ) {
        self.summary = summary
        self.legs = legs
        self.routeKey = routeKey
        self.highlight = highlight
        self.displayIndex = displayIndex
    }
}

/// 추천 1건 + 대안 최대 4건. 대안은 뷰가 요약 라벨로 접어 표시(spec §2).
public struct TransitRouteResult: Codable, Sendable, Hashable {
    public let recommended: TransitRoute
    public let alternatives: [TransitRoute]
    /// 절단 전 후보 경로 총수(조용한 절단 금지). 표시하지는 않는다.
    /// 표기 심사는 "사용자 행동을 바꾸는가"이고 후보 총수는 바꾸지 않는다.
    public let totalCandidates: Int

    public init(
        recommended: TransitRoute, alternatives: [TransitRoute], totalCandidates: Int
    ) {
        self.recommended = recommended
        self.alternatives = alternatives
        self.totalCandidates = totalCandidates
    }
}

/// /api/route/transit envelope(자동차와 달리 result로 감싼다). ⚠ result는 optional.
/// null은 ODsay 경로 없음(graceful, 3-state: 조회 실패 아님, walk envelope와 동형).
public struct TransitRouteEnvelope: Codable, Sendable {
    public let result: TransitRouteResult?
}

// MARK: - 도보 경로

/// 도보 안내 단계 하나. description이 낭독 정본(완성 문장, 예 "천호대로를 따라 119m 이동").
/// distanceMeters는 optional — 현재 서버가 미전송(웹 계약상 옵셔널 필드).
/// pathCoords는 `includeGeometry=1` 요청에서만 오는 스텝 폴리라인(실시간 상세 안내용).
/// 미요청 응답엔 없으므로 옵셔널이고, 요청해도 스텝별로 빠질 수 있다.
public struct WalkRouteStep: Codable, Sendable, Hashable {
    public let description: String
    public let distanceMeters: Int?
    public let pathCoords: [RoutePoint]?
}

/// 계단 회피 적용 상태(웹 `StepFreeStatus` 미러 — applied·no_stepfree_route·unavailable).
public enum StepFreeStatus: String, Codable, Sendable, Hashable {
    case applied
    case noStepFreeRoute = "no_stepfree_route"
    case unavailable
}

/// 도보 경로 브리핑(자동차 CarRouteBriefing과 동형, 지도 없이 완결되는 텍스트 정본).
public struct WalkRouteBriefing: Codable, Sendable, Hashable {
    /// 총 거리(m)
    public let distanceMeters: Int
    /// 총 소요(초)
    public let durationSeconds: Int
    /// 안내 단계들
    public let steps: [WalkRouteStep]
    /// 계단 회피 판정(원시 문자열). `accessible` 요청에만 존재한다.
    /// ⚠ **raw enum으로 디코딩하지 않는다** — 서버가 넷째 상태를 추가하면
    /// 브리핑 전체의 디코딩이 실패한다. 판독은 `stepFreeStatus`가 한다.
    public let stepFree: String?
    /// 열화 상태의 안내 문장(서버 정본). `applied`이거나 미요청이면 nil.
    /// ⚠ `includeGeometry=1` 응답에는 유사 스텝이 없으므로 이것이 유일한 채널이다.
    public let stepFreeNotice: String?

    /// 알려진 상태만 매핑하고 미지의 값은 nil("판정 없음")이다.
    public var stepFreeStatus: StepFreeStatus? {
        stepFree.flatMap(StepFreeStatus.init(rawValue:))
    }
}

/// /api/route/walk envelope. ⚠ transit과 달리 result가 optional —
/// null은 "경로 없음"(3-state: 조회 실패 아님, throw 대상 아님).
public struct WalkRouteEnvelope: Codable, Sendable {
    public let result: WalkRouteBriefing?
}
