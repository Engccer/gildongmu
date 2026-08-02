import Foundation

/// 라우트 오류 3분류. 3-state 불변식(spec §6)의 전송 계층 받침대:
/// "빈 결과"는 성공 디코딩의 빈 배열이고, 여기의 오류는 전부 "조회 실패"다.
public enum APIError: Error, Sendable {
    case badStatus(code: Int, message: String?)
    case decoding(any Error)
    case network(any Error)
    /// 좌표가 대한민국 서비스 커버리지 밖(서버가 `{"outOfCoverage":true}` 마커로 응답, spec coverage-contract).
    case outOfCoverage
    /// 한국 **안**이지만 그 도메인 데이터가 그 지역에 없음(따릉이·문화행사 = 서울 전용,
    /// 버스 = TAGO 미보유 시군). `outOfCoverage`와 층이 다르다: 그 메뉴 하나만 무용하고
    /// 나머지 기능은 정상이다.
    /// ⚠ 빈 결과로 흡수 금지 — "지금 근처에 없다"와 "이 지역엔 서비스가 없다"는
    /// 사용자의 다음 행동이 다르다(3-state 불변식).
    /// ⚠ 사유도 뭉개지 말 것: 서울 전용 서비스와 데이터 미보유는 서로 다른 사실이다.
    case unavailableHere(UnavailableHereReason)
}

/// 서비스 지역 미제공 사유. 서버 문자열과 1:1이고, **모르는 값은 사유가 아니라 부재로
/// 다룬다**(서버가 사유를 늘렸을 때 낡은 앱이 틀린 문장을 말하지 않도록).
public enum UnavailableHereReason: String, Sendable {
    case seoulOnly
    case noBusData
}

/// 서버 커버리지 마커 감지용 최소 디코딩 구조체. 정상 페이로드엔 이 필드가 없어 오탐 불가.
private struct OutOfCoverageMarker: Decodable {
    let outOfCoverage: Bool
}

/// 서비스 지역 미제공 마커. 값 비교까지 해야 오탐이 없다(문자열 reason).
private struct UnavailableHereMarker: Decodable {
    let unavailableHere: String
}

/// Vercel `/api/*` 소비 전용 최소 클라이언트. base URL 주입(디버그 로컬 dev 지원).
public struct APIClient: Sendable {
    public let baseURL: URL
    let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func get<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem]) async throws -> T {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: components.url!)
        } catch {
            throw APIError.network(error)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = try? JSONDecoder().decode(APIErrorBody.self, from: data).error
            throw APIError.badStatus(code: status, message: message)
        }
        if let marker = try? JSONDecoder().decode(OutOfCoverageMarker.self, from: data), marker.outOfCoverage {
            throw APIError.outOfCoverage
        }
        if let marker = try? JSONDecoder().decode(UnavailableHereMarker.self, from: data),
           let reason = UnavailableHereReason(rawValue: marker.unavailableHere) {
            throw APIError.unavailableHere(reason)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
