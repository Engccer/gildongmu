import Foundation

/// 자동차·대중교통·도보 경로 조회 `GET ?origin=lat,lng&dest=lat,lng`.
/// 출발지 불변식: origin은 호출자(화면)가 LocationService 좌표로 채운다.
/// 장소 좌표로 origin을 덮지 않는다(dest만 place, 웹 장소 앵커 불변식).
/// ⚠ car 응답은 envelope 없이 CarRouteBriefing 직접, transit·walk는 result envelope
/// (둘 다 result가 optional, null은 "경로 없음"이지 조회 실패 아님). 키 없음은 walk=404·
/// transit·car=503으로 라우트마다 코드가 다르지만, 어느 쪽이든 APIError.badStatus로
/// 그대로 전파한다(Kit 계층에서 흡수하지 않음, 게이트 판정은 DirectionsOutcomeClassifier).
public struct RouteService: Sendable {
    let client: APIClient

    public init(client: APIClient) { self.client = client }

    /// "lat,lng" 좌표 문자열 합성(웹 라우트 파라미터 계약)
    private func coordPair(_ lat: Double, _ lng: Double) -> String {
        "\(lat),\(lng)"
    }

    /// `lang`: 안내 문장 언어. ⚠ **walk와 같은 이유로 기본값을 두지 않는다**(A26) — 빠뜨린 조회는
    /// 오류 없이 한국어 안내를 주고 그 사실은 비-ko 사용자에게 낭독으로만 드러난다. "ko"는
    /// 파라미터를 생략해 기존 요청과 byte-identical(walk 동형). 서버는 en이어도 NCP 키 부재·
    /// 경유지면 ko로 폴백하고 그 결과를 `guidanceLang`으로 알린다.
    public func car(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        lang: String,
        includeGeometry: Bool = false,
        via: (lat: Double, lng: Double)?
    ) async throws -> CarRouteBriefing {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
        ]
        if lang != "ko" { query.append(URLQueryItem(name: "lang", value: lang)) }
        if includeGeometry { query.append(URLQueryItem(name: "includeGeometry", value: "1")) }
        if let via { query.append(URLQueryItem(name: "via", value: coordPair(via.lat, via.lng))) }
        return try await client.get("/api/route/car", query: query)
    }

    /// nil = 경로 없음(3-state, throw 아님, walk와 동형). 키 없음(503)·조회 실패(502)는
    /// 여느 라우트와 동형으로 throw.
    /// includeStops=true는 경유 정류장 옵트인(웹 `?includeStops=1` 계약, B2 실시간
    /// 안내의 승차·하차 정류소 ID·좌표 데이터원). false면 파라미터 생략(byte-호환).
    /// `lang`(E27): 응답 언어. en이면 서버가 ODsay `lang=1` 영문을 `*En`에 additive로 싣는다(한국어 필드
    /// 불변). ⚠ **walk·car와 같은 이유로 기본값을 두지 않는다** — 빠뜨린 조회는 컴파일이 잡는다.
    /// 비-ko만 파라미터를 실어 ko 요청은 종전과 byte-identical.
    public func transit(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        includeStops: Bool = false,
        lang: String
    ) async throws -> TransitRouteResult? {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
        ]
        query.append(URLQueryItem(name: "lanes", value: "1"))
        if includeStops { query.append(URLQueryItem(name: "includeStops", value: "1")) }
        if lang != "ko" { query.append(URLQueryItem(name: "lang", value: lang)) }
        let envelope: TransitRouteEnvelope = try await client.get("/api/route/transit", query: query)
        return envelope.result
    }

    /// 택시 + 대중교통 + 택시 여정 조회(E70, ko 전용 — `lang`을 보내지 않는다). 지정 역은 최대 둘(둘 다 nil이면
    /// 서버가 400이므로 호출자가 가른다). 노선 힌트가 없는 쪽은 `*Line` 파라미터를 생략한다.
    /// `.outOfCoverage` = 서비스 지역 밖, `variants` 빈 결과 = 경로 없음, throw = 조회 실패(3-state).
    /// ⚠ 인자 전부 기본값 없음(빠뜨린 호출은 컴파일이 잡는다).
    public func journey(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        board: JourneyStationQuery?,
        alight: JourneyStationQuery?
    ) async throws -> JourneyResponse {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
            URLQueryItem(name: "stops", value: "1"),
        ]
        if let board {
            query.append(URLQueryItem(name: "board", value: coordPair(board.lat, board.lng)))
            query.append(URLQueryItem(name: "boardName", value: board.name))
            if let line = board.line, board.kind != .busStop { query.append(URLQueryItem(name: "boardLine", value: line)) }
            if board.kind == .busStop { query.append(URLQueryItem(name: "boardKind", value: "stop")) }
            // 지금 탄 열차(E71): 노선이 없으면 boardLine이 빠져 서버 400이 실패 3-state로 드러난다.
            if let dir = board.aboardDirection, board.kind != .busStop {
                query.append(URLQueryItem(name: "boardKind", value: "aboard"))
                query.append(URLQueryItem(name: "boardDir", value: dir))
            }
        }
        if let alight {
            query.append(URLQueryItem(name: "alight", value: coordPair(alight.lat, alight.lng)))
            query.append(URLQueryItem(name: "alightName", value: alight.name))
            if let line = alight.line, alight.kind != .busStop { query.append(URLQueryItem(name: "alightLine", value: line)) }
            if alight.kind == .busStop { query.append(URLQueryItem(name: "alightKind", value: "stop")) }
        }
        do {
            let result: JourneyResult = try await client.get("/api/route/journey", query: query)
            return .result(result)
        } catch APIError.outOfCoverage {
            return .outOfCoverage
        }
    }

    /// 정류장 이름 검색(E70-e spec §4.6). `origin`·`dest` 중 하나 이상은 있어야 한다(둘 다 nil이면 서버가 400).
    /// 결과 3-state: `stops` 빈 배열 = 정상 0건, `unsearched` = 대상 지역을 못 정함, `failed` = 일부 조회 실패(나머지는 실림).
    /// 서비스 지역 밖은 `APIClient`가 `APIError.outOfCoverage`를 던진다. 시트 제출 때만 부른다(타자마다 아님).
    public func journeyStops(
        query text: String,
        origin: (lat: Double, lng: Double)?,
        dest: (lat: Double, lng: Double)?
    ) async throws -> JourneyStopsResult {
        var query = [URLQueryItem(name: "q", value: text)]
        if let origin { query.append(URLQueryItem(name: "origin", value: coordPair(origin.lat, origin.lng))) }
        if let dest { query.append(URLQueryItem(name: "dest", value: coordPair(dest.lat, dest.lng))) }
        return try await client.get("/api/route/journey/stops", query: query)
    }

    /// 수단 재조회(E50 판정 2) — 사용자가 버튼을 눌렀을 때만 부른다(ODsay 호출당 과금, 자동 조회 금지).
    /// 서버가 그 수단만 타는 경로 중 1순위 하나를 `recommended`로 준다(`alternatives` 빈 배열).
    /// nil = 그런 경로 없음, throw = 조회 실패(3-state). 본 조회와 같은 경유 정류장 옵트인을 싣는다 —
    /// 찾은 경로도 안내를 시작할 수 있어야 한다. ⚠ 인자 전부 기본값 없음(빠뜨린 호출은 컴파일이 잡는다).
    public func transitModeRequery(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        axis: TransitModeAxis,
        lang: String
    ) async throws -> TransitRouteResult? {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
            URLQueryItem(name: "includeStops", value: "1"),
            URLQueryItem(name: "lanes", value: "1"),
        ]
        if lang != "ko" { query.append(URLQueryItem(name: "lang", value: lang)) }
        query.append(URLQueryItem(name: "pathType", value: axis.pathType))
        let envelope: TransitRouteEnvelope = try await client.get("/api/route/transit", query: query)
        return envelope.result
    }

    /// nil = 경로 없음(3-state, throw 아님). 키 없음(404)·조회 실패(502)는 여느 라우트와
    /// 동형으로 throw.
    /// accessible=true는 계단 회피 모드(웹 `?accessible=true` 계약). 미적용 시 서버가
    /// 안전 문장을 전달한다 — 산문 소비자에겐 steps[0] 삽입으로, `includeGeometry`
    /// 소비자에겐 `stepFreeNotice` 필드로(기하 없는 스텝은 경로 빌더가 거부한다).
    /// false면 파라미터 자체를 생략해 기존 요청과 byte-identical.
    /// includeGeometry=true는 스텝 폴리라인 보존 옵트인(웹 `?includeGeometry=1` 계약,
    /// 실시간 상세 안내 전용). 서버가 "1"만 허용하므로 그 값으로 보내고, false면
    /// accessible과 동형으로 파라미터를 생략한다.
    /// ⚠ `accessible`에 **기본값을 두지 않는다** — 백로그 A4는 이 기본값이 만든
    /// 결함이었다. 안내 조회가 인자를 생략해도 컴파일이 통과해, 계단 회피를 켠
    /// 사용자가 계단으로 안내받았다(spec 2026-08-08 §2.5).
    /// `variant`(M3): nil이면 파라미터 생략(현행 요청 byte-identical), `.shortest`면
    /// Tmap 최단 축 단일 조회(안내 시작·전환·제안 경로).
    /// `via`(N4): 경유지 1개 "위도,경도"(서버 spec §2.1). nil이면 파라미터 생략.
    /// ⚠ **기본값을 두지 않는다** — 경유지를 받은 세션의 재조회 경로 중 하나라도 `via`를
    /// 빠뜨리면 "경유 안 한 경로"가 "경유한 경로"로 낭독된다. 서버가 표지 부재를 throw로
    /// 막은 그 결함이 클라이언트에서는 *인자 생략*으로 일어나고, 기본값이 있으면 그 생략이
    /// 조용히 컴파일된다(`accessible` 규율 동형).
    /// `lang`(E16 축3): 안내 문장 언어. ⚠ **같은 이유로 기본값을 두지 않는다** — 빠뜨린 조회는
    /// 오류 없이 **한국어 안내**를 주고, 그 사실은 비-ko 사용자에게 낭독으로만 드러난다.
    /// `.ko`는 파라미터를 생략해 기존 요청과 byte-identical. 타입이 `DataLocale`인 이유는
    /// 열린 `String`이면 오타가 서버 400 → `unavailable` 강등으로 조용히 흡수돼 낭독이
    /// "경로를 찾지 못했습니다"가 되기 때문이다(`WalkRouteVariant` 대칭, 2026-09-02).
    public func walk(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        accessible: Bool,
        lang: DataLocale,
        includeGeometry: Bool = false,
        variant: WalkRouteVariant? = nil,
        via: (lat: Double, lng: Double)?
    ) async throws -> WalkRouteBriefing? {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
        ]
        if lang != .ko { query.append(URLQueryItem(name: "lang", value: lang.rawValue)) }
        if accessible { query.append(URLQueryItem(name: "accessible", value: "true")) }
        if includeGeometry { query.append(URLQueryItem(name: "includeGeometry", value: "1")) }
        if let variant { query.append(URLQueryItem(name: "variant", value: variant.rawValue)) }
        if let via { query.append(URLQueryItem(name: "via", value: coordPair(via.lat, via.lng))) }
        appendWording(&query)
        let envelope: WalkRouteEnvelope = try await client.get("/api/route/walk", query: query)
        return envelope.result
    }

    /// 안내 문장 판본 2(E62 문안 확정본, spec `2026-10-03-crosswalk-guidance-design.md` §1)를 늘 싣는다 — 미지정(판본 1)은
    /// 스토어 2.0·1.19의 계약이다. 건너는 길 이름(§3.5)은 판본 2의 일부라 따로 보내지 않는다.
    private func appendWording(_ query: inout [URLQueryItem]) {
        query.append(URLQueryItem(name: "wording", value: "2"))
    }

    /// 조회 화면 도보 줄 목록(E42·E52, `lines=2` 단독 옵트인 — 기하 없음). 모르는 종류의 줄은 뺀다.
    /// 빈 배열은 "경로 없음", 첫 줄 실패는 서버 502라 throw(부분 성공 비대칭 — spec §2.1). 나머지 줄의 조회 실패는
    /// 서버가 흡수해 `failedLines`로 알린다(E52 판정 (나)).
    public func walkLines(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        lang: DataLocale,
        via: (lat: Double, lng: Double)?
    ) async throws -> WalkRouteLineList {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
        ]
        if lang != .ko { query.append(URLQueryItem(name: "lang", value: lang.rawValue)) }
        if let via { query.append(URLQueryItem(name: "via", value: coordPair(via.lat, via.lng))) }
        // 판본 2(E52) = 최대 세 줄. 판본 1(최대 두 줄)은 첫 줄 뒤 줄들이 펼침 상태 하나를 공유하던 1.19 몫이다.
        query.append(URLQueryItem(name: "lines", value: "2"))
        appendWording(&query)
        let envelope: WalkRouteLinesEnvelope = try await client.get("/api/route/walk", query: query)
        return WalkRouteLineList(
            lines: envelope.lines.filter { $0.lineKind != nil }, failedLines: envelope.failedLines ?? [])
    }

    /// 추천+최단 병렬 조회(M3, **옛 조회 화면 호환** — iOS·안드로이드 앱은 E42부터 `walkLines`를 쓴다.
    /// 서버는 배포된 옛 앱을 위해 봉투 모양을 유지한다 — spec 2026-09-23 §2.3).
    /// `shortest` nil은 "필드 부재(키 없음)"와 "최단 실패 흡수(null)"를 뭉친 것 —
    /// 両경우 소비자 행동이 같다(최단 행 미노출). 기본 경로 실패는 서버가 502로
    /// 던지므로 여기 도달하지 않는다(부분 성공 비대칭, spec §3.1).
    public func walkAlternatives(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        accessible: Bool,
        lang: DataLocale,
        via: (lat: Double, lng: Double)?
    ) async throws -> (result: WalkRouteBriefing?, shortest: WalkRouteBriefing?) {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
            URLQueryItem(name: "alternatives", value: "1"),
        ]
        if lang != .ko { query.append(URLQueryItem(name: "lang", value: lang.rawValue)) }
        if accessible { query.append(URLQueryItem(name: "accessible", value: "true")) }
        if let via { query.append(URLQueryItem(name: "via", value: coordPair(via.lat, via.lng))) }
        let envelope: WalkRouteEnvelope = try await client.get("/api/route/walk", query: query)
        return (envelope.result, envelope.shortest)
    }
}

/// 여정 조회에 싣는 지정 역(E70). `line`은 노선 힌트(없으면 서버가 이름·좌표만으로 판정).
public struct JourneyStationQuery: Sendable, Hashable {
    public let name: String
    public let lat: Double
    public let lng: Double
    public let line: String?
    /// 정류장이면 `busStop`(노선 힌트는 싣지 않는다). nil = 역. ⚠ 기본값 없음 — 빠뜨리면 정류장이 역으로 조회된다.
    public let kind: JourneyStationKind?
    /// 지금 탄 열차의 방향(`updnLine` 원문 — 상행·하행·내선·외선). 승차 쪽에만 오고 non-nil이면 `boardKind=aboard`로 조회한다(E71).
    /// 단 `kind == .busStop`이면 무시한다(`boardKind=stop`만 싣고 `boardDir`은 없다).
    /// ⚠ 기본값 없음 — 빠뜨리면 지금 탄 열차가 일반 역 지정으로 조회된다.
    public let aboardDirection: String?

    public init(name: String, lat: Double, lng: Double, line: String?, kind: JourneyStationKind?, aboardDirection: String?) {
        self.name = name
        self.lat = lat
        self.lng = lng
        self.line = line
        self.kind = kind
        self.aboardDirection = aboardDirection
    }
}

/// 도보 경로 축(M3). 서버 `variant` 쿼리 값과 1:1. E42부터 ko는 카카오 `SHORTEST`(폴백 Tmap), en은 Tmap.
public enum WalkRouteVariant: String, Sendable {
    case shortest
}

/// 데이터 언어(웹 `data-locale.ts` 동형 — 외부 데이터는 ko 외 전부 en). 서버 `lang` 쿼리 값과 1:1.
/// 앱의 정본은 `AppLanguage.dataLocaleValue`이고 문자열 `AppLanguage.dataLocale`은 그 투영이다.
/// 도보 경로(`walk`·`walkAlternatives`)가 이 타입을 받는다 — 나머지 `lang: String` 인자는 종전 계약.
public enum DataLocale: String, Sendable {
    case ko, en
}
