import Testing

@testable import GildongmuKit

/// 안내 통지 게시 장부(E57 착지 대기 계층, spec 2026-09-30-guide-sheet-info-row-landing §3.3·§3.3.1, 횡단 리뷰 F1·F2).
struct GuideAnnouncementLedgerTests {
    // 게시가 없으면 곧장 끝난 상태다 — 갚을 통지가 없는 복귀는 기다리지 않는다(F1).
    @Test func emptyIsSettled() {
        #expect(GuideAnnouncementLedger().isSettled(at: 0))
    }

    @Test func postedIsOpenUntilItsFinish() {
        var ledger = GuideAnnouncementLedger()
        ledger.posted("요약", at: 0)
        #expect(!ledger.isSettled(at: 1))
        ledger.finished("요약", at: 3)
        #expect(ledger.isSettled(at: 3))
    }

    // 앱의 다른 통지(장부에 없는 문장)의 끝은 세지 않는다(F2 — 종전엔 아무 통지 끝이나 조건을 채웠다).
    @Test func foreignFinishIsIgnored() {
        var ledger = GuideAnnouncementLedger()
        ledger.posted("요약", at: 0)
        ledger.finished("검색 결과 3건", at: 1)
        #expect(!ledger.isSettled(at: 1))
    }

    // 앞 주기 통지가 끝나도 뒤에 게시한 요약이 남아 있으면 끝나지 않았다(F2의 순서 역전).
    @Test func everyPostedMustFinish() {
        var ledger = GuideAnnouncementLedger()
        ledger.posted("주기 통지", at: 0)
        ledger.posted("요약", at: 0.5)
        ledger.finished("주기 통지", at: 1)
        #expect(!ledger.isSettled(at: 1))
        ledger.finished("요약", at: 4)
        #expect(ledger.isSettled(at: 4))
    }

    // 같은 문장이 둘이면 하나의 끝은 하나만 지운다.
    @Test func duplicateTextsPairOneByOne() {
        var ledger = GuideAnnouncementLedger()
        ledger.posted("경로를 벗어났습니다", at: 0)
        ledger.posted("경로를 벗어났습니다", at: 1)
        ledger.finished("경로를 벗어났습니다", at: 2)
        #expect(!ledger.isSettled(at: 2))
        ledger.finished("경로를 벗어났습니다", at: 3)
        #expect(ledger.isSettled(at: 3))
    }

    // 끝 신호가 오지 않는 통지는 만료한다 — 대기가 영영 끝나지 않는 경로가 없다.
    @Test func unfinishedExpires() {
        var ledger = GuideAnnouncementLedger()
        ledger.posted("버려진 통지", at: 0)
        #expect(!ledger.isSettled(at: GuideAnnouncementLedger.expirySeconds - 0.1))
        #expect(ledger.openCount(at: GuideAnnouncementLedger.expirySeconds - 0.1) == 1)
        #expect(ledger.isSettled(at: GuideAnnouncementLedger.expirySeconds))
        #expect(ledger.openCount(at: GuideAnnouncementLedger.expirySeconds) == 0)
    }
}
