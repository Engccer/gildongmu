import Foundation

/// 측위 시작부터 주소 커밋까지 같은 요청을 소유한다. 네트워크 취소 협조 여부와 무관하게
/// 이전 측위·주소 응답을 폐기하며, 표시용 한/영 주소는 하나의 값으로 교체한다.
public struct DirectionsAddressState: Sendable {
    public struct Request: Equatable, Sendable {
        fileprivate let id: UUID
        public let language: String
    }

    public struct Address: Equatable, Sendable {
        public let original: String?
        public let english: String?
    }

    public private(set) var address = Address(original: nil, english: nil)
    public private(set) var hasLoaded = false
    public private(set) var isLoading = false
    private var latest: Request?

    public init() {}

    public mutating func begin(language: String) -> Request {
        let request = Request(id: UUID(), language: language)
        latest = request
        isLoading = true
        return request
    }

    public func accepts(_ request: Request, language: String, isCancelled: Bool) -> Bool {
        !isCancelled && latest == request && request.language == language
    }

    @discardableResult
    public mutating func finish(_ request: Request) -> Bool {
        guard latest == request else { return false }
        isLoading = false
        return true
    }

    /// 표시 주소를 비우고 완료 표식을 내린다(옛 위치 표식이 바뀔 때 — 다른 좌표의 주소가 옛 위치 문장에
    /// 실리지 않게). 요청 세대는 건드리지 않는다. 표식을 내리는 이유: 비운 뒤 그 요청이 취소되면 재진입이
    /// 주소를 다시 받아야 한다 — 완료 표식은 "지금 보이는 주소가 수락된 커밋에서 왔다"는 뜻이고, 세우는
    /// 자리는 여전히 `commit` 한 곳이다(stale-origin 재리뷰 N-3·최종 확인 F-3).
    public mutating func clearAddress() {
        address = Address(original: nil, english: nil)
        hasLoaded = false
    }

    public mutating func cancel() {
        latest = nil
        isLoading = false
    }

    @discardableResult
    public mutating func commit(
        _ response: ReverseGeocodeResponse?, for request: Request,
        language: String, isCancelled: Bool
    ) -> Bool {
        guard accepts(request, language: language, isCancelled: isCancelled) else { return false }
        address = Address(original: response?.address,
                          english: response?.address == nil ? nil : response?.english)
        hasLoaded = true
        finish(request)
        return true
    }
}
