import Foundation
import Observation
import Accessibility
import GildongmuKit

/// 검색 화면 상태. 요청 세대 관리는 Task 취소로(웹 request-id ref의 iOS 문법).
@Observable
@MainActor
final class SearchModel {
    var query = ""
    private(set) var outcome: SearchOutcome?
    private(set) var isSearching = false
    private(set) var failed = false
    private var searchTask: Task<Void, Never>?

    private let service = SearchService(
        client: APIClient(baseURL: URL(string: "https://gildongmu.vercel.app")!)
    )

    func submit() {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        searchTask?.cancel()   // 진행 중 검색 폐기: stale 응답 차단
        isSearching = true
        failed = false
        searchTask = Task {
            let result = await service.search(query: trimmed, lat: nil, lng: nil, lang: "ko")
            guard !Task.isCancelled else { return }
            outcome = result
            isSearching = false
            announce(result)
        }
    }

    /// 단일 통지 채널(웹 combinedLiveMessage의 iOS 문법).
    private func announce(_ result: SearchOutcome) {
        let total = result.attractions.count + result.sections.reduce(0) { $0 + $1.count }
        let message = total == 0 ? "검색 결과가 없습니다" : "검색 결과 \(total)건"
        AccessibilityNotification.Announcement(message).post()
    }
}
