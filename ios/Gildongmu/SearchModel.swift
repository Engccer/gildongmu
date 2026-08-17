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
    /// 정렬 축(spec 2026-08-17 §6). review = 네이버 리뷰순 단독(최대 5건).
    private(set) var sort: PlaceSort = .accuracy
    /// 마지막으로 제출된 질의 — 정렬 토글은 입력창의 현재 텍스트가 아니라 이것으로 재조회한다.
    private var lastSubmittedQuery = ""
    /// 네이버가 답한 응답을 이 세션에서 본 적 있는가(래치). iOS는 서버 키를 모르므로
    /// `placesProvider`("merged"·"naver-local")가 네이버 키 보유의 유일한 관측 채널이다.
    private var naverBackedSeen = false
    private var searchTask: Task<Void, Never>?

    private let service = SearchService(
        client: APIClient(baseURL: AppConfig.apiBaseURL)
    )

    /// 리뷰순 토글 노출 조건: ko + 네이버 키(웹 canSortByReview + dataLocale ko 미러).
    var canSortByReview: Bool {
        AppLanguage.dataLocale == "ko" && naverBackedSeen
    }

    var totalCount: Int {
        guard let outcome else { return 0 }
        return outcome.orderedSections.reduce(0) { $0 + $1.count }
    }

    /// 정렬 전환(spec 2026-08-17 §6): 마지막 제출 질의로 재조회. 첫 결과 착지 계약은 적용하지
    /// 않는다(landFocus=false — 사용자가 토글에 커서를 둔 채 일으킨 재조회, 새로고침 계열).
    /// 라벨 전환이 상태 신호, 건수는 announce()가 그대로 통지한다.
    func toggleSort() {
        guard !isSearching, !lastSubmittedQuery.isEmpty else { return }
        sort = sort == .review ? .accuracy : .review
        query = lastSubmittedQuery
        submit(landFocus: false)
    }

    /// 정렬 재조회의 장소 트랙이 실패하면 라벨(=상태 신호)이 실패한 정렬을 가리키지 않게
    /// 되돌린다(웹 toggleSort 롤백 미러). 취소(stale)는 새 검색이 상태를 소유하므로 제외.
    private func rollbackSortIfFailed(_ result: SearchOutcome, requested: PlaceSort) {
        guard requested == sort, result.places.isFailed else { return }
        sort = requested == .review ? .accuracy : .review
    }

    func submit(landFocus: Bool = true) {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        searchTask?.cancel()   // 진행 중 검색 폐기: stale 응답 차단
        lastSubmittedQuery = trimmed
        let requestedSort = sort
        isSearching = true
        searchTask = Task {
            // 권한이 이미 허용된 세션이면 좌표를 취득해 싣는다(캐시 우선, 팝업 없음).
            // 좌표 없는 검색은 전국 정확도순이라 근처 결과가 매몰된다(2026-07-21).
            let coordinate = await LocationService.shared.coordinateForRanking()
            let result = await service.search(
                query: trimmed,
                lat: coordinate?.lat,
                lng: coordinate?.lng,
                lang: AppLanguage.dataLocale,
                sort: sort
            )
            guard !Task.isCancelled else { return }
            // 정확도순 전환(웹 스펙 2026-07-20 미러): 좌표는 API로 보내 카카오 근접
            // 블렌딩에 쓰고, 클라 재정렬은 하지 않는다. distanceMeters는 서버 주석.
            outcome = result
            failed = result.allFailed && totalCount == 0
            isSearching = false
            if !landFocus { rollbackSortIfFailed(result, requested: requestedSort) }
            if let provider = result.placesProvider, provider == "merged" || provider == "naver-local" {
                naverBackedSeen = true
            }
            if landFocus { resultsRevision += 1 }
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
