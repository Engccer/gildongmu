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

    public func car(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        lang: String? = nil,
        includeGeometry: Bool = false
    ) async throws -> CarRouteBriefing {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
        ]
        if let lang { query.append(URLQueryItem(name: "lang", value: lang)) }
        if includeGeometry { query.append(URLQueryItem(name: "includeGeometry", value: "1")) }
        return try await client.get("/api/route/car", query: query)
    }

    /// nil = 경로 없음(3-state, throw 아님, walk와 동형). 키 없음(503)·조회 실패(502)는
    /// 여느 라우트와 동형으로 throw.
    /// includeStops=true는 경유 정류장 옵트인(웹 `?includeStops=1` 계약, B2 실시간
    /// 안내의 승차·하차 정류소 ID·좌표 데이터원). false면 파라미터 생략(byte-호환).
    public func transit(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        includeStops: Bool = false
    ) async throws -> TransitRouteResult? {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
        ]
        if includeStops { query.append(URLQueryItem(name: "includeStops", value: "1")) }
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
    public func walk(
        originLat: Double, originLng: Double,
        destLat: Double, destLng: Double,
        accessible: Bool,
        includeGeometry: Bool = false
    ) async throws -> WalkRouteBriefing? {
        var query = [
            URLQueryItem(name: "origin", value: coordPair(originLat, originLng)),
            URLQueryItem(name: "dest", value: coordPair(destLat, destLng)),
        ]
        if accessible { query.append(URLQueryItem(name: "accessible", value: "true")) }
        if includeGeometry { query.append(URLQueryItem(name: "includeGeometry", value: "1")) }
        let envelope: WalkRouteEnvelope = try await client.get("/api/route/walk", query: query)
        return envelope.result
    }
}
