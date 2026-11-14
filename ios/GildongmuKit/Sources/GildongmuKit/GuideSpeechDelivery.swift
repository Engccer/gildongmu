import Foundation

// 발화 전달 계약(E82 V0a, spec `docs/superpowers/specs/2026-11-14-e82-vergilius-v1-design.md` §3.0).
// 「이 문장이 실제로 나갔는가」의 신호. 게시부(`post`)는 문장이 채널에 실렸는지를 돌려주고, 실린 문장의 끝은
// 채널마다 다른 신호로 온다:
//   - 지연 슬롯(`DeferredAnnouncer`): 새 문장에 밀려나면 `onDropped`.
//   - 기기 음성(`DeviceSpeechQueue` 계약 8·9): 대기 칸에서 밀려나거나 말하다 끊기면 `onDropped`, 합성기가 끝까지
//     말했다고 알리면 `onSpoken`.
//   - VoiceOver 통지: 이 파일의 장부. 끝 신호(`announcementDidFinishNotification`)가 「끝까지 말했다」를 실어 왔을 때만
//     `spoken`이고, 끊겼다는 신호와 신호 없음(만료)은 `dropped`다.

/// 발화 전달 신호. 「말했다」 = 채널에 실렸고 끝까지 말해졌다. 밀려났거나 끊겼거나 끝 신호를 받지 못했으면 `dropped`다
/// (의심스러우면 말하지 않은 것으로 친다 — 표시가 먼저 서면 그 문장은 다시 나오지 않는다).
public enum GuideSpeechOutcome: String, Sendable {
    case spoken
    case dropped
}

/// 전달을 추적하는 VoiceOver 통지의 장부. 착지 대기 장부(`GuideAnnouncementLedger`)와 따로 둔다 — 그쪽은 「끝났는가」만
/// 보고(끊겨도 끝이다) 이쪽은 「끝까지 말했는가」를 본다.
///
/// 끝 신호가 오지 않는 통지(VoiceOver가 조용히 버렸거나 도중에 꺼졌다)는 그 문장의 만료 시간(`expirySeconds(for:)`) 뒤
/// `dropped`로 닫는다.
public struct VoiceOverDeliveryLedger {
    /// 끝 신호를 기다리는 시간의 상한(초).
    public static let maxExpirySeconds = 30.0

    /// 그 문장의 끝 신호를 기다리는 시간(초): 글자 수 × 0.15초 + 5초, 상한 `maxExpirySeconds`. 문장이 말해지는 시간보다
    /// 길어야 한다(짧으면 말하는 중인 문장을 버린 것으로 쳐서 한 번 더 말한다). 고정 30초로 두면 조용히 버려진 짧은
    /// 문장 하나가 그만큼 다음 문장을 붙든다.
    public static func expirySeconds(for text: String) -> Double {
        min(maxExpirySeconds, Double(text.count) * 0.15 + 5)
    }

    private struct Entry {
        let id: Int
        let text: String
        let expiresAt: Double
    }

    private var open: [Entry] = []
    private var nextID = 0

    public init() {}

    public var isEmpty: Bool { open.isEmpty }

    /// 게시했다(`at`: 단조 시각, 초). 돌려주는 값은 이 통지의 id다.
    public mutating func posted(_ text: String, at now: Double) -> Int {
        nextID += 1
        open.append(Entry(id: nextID, text: text, expiresAt: now + Self.expirySeconds(for: text)))
        return nextID
    }

    /// 끝 신호 — 같은 문장 중 가장 오래된 하나를 닫는다. `successful`이 참일 때만 `spoken`이다(없거나 거짓이면
    /// `dropped`). 장부에 없는 문장이면 nil.
    public mutating func finished(_ text: String, successful: Bool?) -> (id: Int, outcome: GuideSpeechOutcome)? {
        guard let index = open.firstIndex(where: { $0.text == text }) else { return nil }
        let entry = open.remove(at: index)
        return (entry.id, successful == true ? .spoken : .dropped)
    }

    /// 만료된 통지의 id(전부 `dropped`로 닫는다).
    public mutating func expire(at now: Double) -> [Int] {
        let expired = open.filter { now >= $0.expiresAt }.map(\.id)
        open.removeAll { now >= $0.expiresAt }
        return expired
    }

    /// 세션 경계 — 열린 통지를 결과 없이 비운다(끝난 세션의 문장은 말했다고도 버렸다고도 통지하지 않는다).
    public mutating func reset() {
        open.removeAll()
    }
}
