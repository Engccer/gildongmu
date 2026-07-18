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
        client: APIClient(baseURL: AppConfig.apiBaseURL)
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
            var result = await service.search(query: trimmed, lat: nil, lng: nil, lang: AppLanguage.dataLocale)
            guard !Task.isCancelled else { return }
            // 보유 좌표가 있으면 결과를 가까운 순으로 재정렬(웹 userCoords 정렬 미러).
            // 신규 권한 요청·위치 취득은 트리거하지 않는다(LocationService 캐시만 사용).
            if case .loaded(let items) = result.places, let coordinate = LocationService.shared.lastCoordinate {
                result = SearchOutcome(
                    attractions: result.attractions,
                    places: .loaded(sortPlacesByDistance(items, lat: coordinate.lat, lng: coordinate.lng)),
                    addresses: result.addresses,
                    web: result.web
                )
            }
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
            message = appLocalized("ios.search.announceFailed")
        } else if totalCount == 0 {
            message = appLocalized("ios.search.announceEmpty")
        } else {
            message = appLocalized("ios.search.announceCount", String(totalCount))
        }
        AccessibilityNotification.Announcement(message).post()
    }
}
