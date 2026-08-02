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
        return outcome.orderedSections.reduce(0) { $0 + $1.count }
    }

    func submit() {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        searchTask?.cancel()   // 진행 중 검색 폐기: stale 응답 차단
        isSearching = true
        searchTask = Task {
            // 권한이 이미 허용된 세션이면 좌표를 취득해 싣는다(캐시 우선, 팝업 없음).
            // 좌표 없는 검색은 전국 정확도순이라 근처 결과가 매몰된다(2026-07-21).
            let coordinate = await LocationService.shared.coordinateForRanking()
            let result = await service.search(
                query: trimmed,
                lat: coordinate?.lat,
                lng: coordinate?.lng,
                lang: AppLanguage.dataLocale
            )
            guard !Task.isCancelled else { return }
            // 정확도순 전환(웹 스펙 2026-07-20 미러): 좌표는 API로 보내 카카오 근접
            // 블렌딩에 쓰고, 클라 재정렬은 하지 않는다. distanceMeters는 서버 주석.
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
