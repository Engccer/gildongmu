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
    /// 3-state 불변식: "결과 없음"과 구분되는 "조회 실패"(정본 두 트랙 모두 실패).
    private(set) var failed = false
    /// 검색 완료 세대. 뷰가 포커스 이동 시점을 아는 신호(SearchOutcome은 Equatable이 아님).
    private(set) var resultsRevision = 0
    private var searchTask: Task<Void, Never>?

    private let service = SearchService(
        client: APIClient(baseURL: URL(string: "https://gildongmu.vercel.app")!)
    )

    var totalCount: Int {
        guard let outcome else { return 0 }
        return outcome.attractions.items.count + outcome.orderedSections.reduce(0) { $0 + $1.count }
    }

    func submit() {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        searchTask?.cancel()   // 진행 중 검색 폐기: stale 응답 차단
        isSearching = true
        searchTask = Task {
            let result = await service.search(query: trimmed, lat: nil, lng: nil, lang: "ko")
            guard !Task.isCancelled else { return }
            outcome = result
            failed = result.allFailed && totalCount == 0
            isSearching = false
            resultsRevision += 1
            announce()
        }
    }

    /// 단일 통지 채널(웹 combinedLiveMessage의 iOS 문법). 실패는 "없음"과 다른 문장으로.
    private func announce() {
        let message: String
        if failed {
            message = "검색에 실패했습니다. 잠시 후 다시 시도해 주세요"
        } else if totalCount == 0 {
            message = "검색 결과가 없습니다"
        } else {
            message = "검색 결과 \(totalCount)건"
        }
        AccessibilityNotification.Announcement(message).post()
    }
}
