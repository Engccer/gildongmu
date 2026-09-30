import Foundation

/// 안내가 게시한 VoiceOver 통지 중 아직 끝나지 않은 것(E57 착지 대기, spec 2026-09-30-guide-sheet-info-row-landing §3.3).
///
/// 안내 시트의 첫 정보 행 착지는 "안내 모델이 게시한 통지가 모두 끝났는가"를 기다린다 — 착지 낭독이 시작 요약·복귀 상환을
/// 끊지 않게. 종전 판정("전이 시각 뒤 끝까지 발화된 아무 통지 하나")은 앱의 다른 통지 끝으로도 채워졌고(횡단 리뷰 F2),
/// 갚을 통지가 없는 복귀에서 오지 않을 신호를 상한까지 기다렸다(F1). 장부는 **우리가 게시한 문장**만 적고, 끝 신호
/// (`announcementDidFinishNotification`의 문장)가 같은 문장이면 지운다 — 끝까지 말했든 끊겼든 같다(끊겼으면 그 문장은
/// 이미 없다). 남이 게시한 문장의 끝은 짝이 없어 아무 일도 하지 않는다.
///
/// 끝 신호가 오지 않는 통지(VoiceOver가 조용히 버린 것)는 `expirySeconds` 뒤 만료한다 — 대기가 영영 끝나지 않는 경로를
/// 만들지 않는다. 앱 타깃엔 테스트 레인이 없어 Kit에 둔다(`DeferredAnnouncer` 선례).
public struct GuideAnnouncementLedger: Sendable, Equatable {
    /// 게시 뒤 끝 신호를 기다리는 상한(초). 첫 안내를 담은 긴 시작 요약도 이 안에 끝난다(종전 착지 대기 상한과 같은 값).
    public static let expirySeconds = 12.0

    private struct Entry: Sendable, Equatable {
        let text: String
        let at: Double
    }

    /// 게시 순서대로. 같은 문장이 둘이면 오래된 것부터 짝을 맞춘다.
    private var open: [Entry] = []

    public init() {}

    /// 게시했다(`at`: 단조 시각, 초).
    public mutating func posted(_ text: String, at now: Double) {
        prune(now)
        open.append(Entry(text: text, at: now))
    }

    /// 끝났다(끝까지든 끊겼든) — 같은 문장 중 가장 오래된 하나를 지운다. 우리가 게시하지 않은 문장이면 아무 일도 없다.
    public mutating func finished(_ text: String, at now: Double) {
        prune(now)
        if let index = open.firstIndex(where: { $0.text == text }) { open.remove(at: index) }
    }

    /// 만료 전의 끝나지 않은 통지가 없다.
    public func isSettled(at now: Double) -> Bool {
        openCount(at: now) == 0
    }

    /// 만료 전의 끝나지 않은 통지 수 — 착지가 상한까지 기다렸을 때 계측이 "짝 실패·끝 신호 부재"와 "통지가 이어짐"을 가른다.
    public func openCount(at now: Double) -> Int {
        open.count(where: { now - $0.at < Self.expirySeconds })
    }

    private mutating func prune(_ now: Double) {
        open.removeAll { now - $0.at >= Self.expirySeconds }
    }
}
