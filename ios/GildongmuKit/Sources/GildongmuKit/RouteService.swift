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
        if includeStops { query.append(URLQueryItem(name: "includeStops", value: "1")) }
        if lang != "ko" { query.append(URLQueryItem(name: "lang", value: lang)) }
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
        let envelope: WalkRouteEnvelope = try await client.get("/api/route/walk", query: query)
        return envelope.result
    }

    /// 추천+최단 병렬 조회(M3, 조회 화면 전용 — 기하 없음).
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

/// 도보 경로 축(M3). 서버 `variant` 쿼리 값과 1:1.
public enum WalkRouteVariant: String, Sendable {
    case shortest
}

/// 데이터 언어(웹 `data-locale.ts` 동형 — 외부 데이터는 ko 외 전부 en). 서버 `lang` 쿼리 값과 1:1.
/// 앱의 정본은 `AppLanguage.dataLocaleValue`이고 문자열 `AppLanguage.dataLocale`은 그 투영이다.
/// 도보 경로(`walk`·`walkAlternatives`)가 이 타입을 받는다 — 나머지 `lang: String` 인자는 종전 계약.
public enum DataLocale: String, Sendable, Equatable {
    case ko, en
}
