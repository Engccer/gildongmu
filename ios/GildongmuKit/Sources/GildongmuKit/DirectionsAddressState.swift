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
