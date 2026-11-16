import Foundation

// 화면을 겨냥하지 않고 받아쓰기를 시작·끝내는 동작(E82 판정 10)의 판정. 순수 함수만(뷰·UIKit 비의존).
// 동작은 둘이다: VoiceOver 두 손가락 두 번 탭(Magic Tap)과 단축어(설정의 「뒷면 탭」에 연결).
// 앱 쪽 등록부(`DictationTriggerRegistry`)가 지금 떠 있는 받아쓰기 버튼을 후보로 모아 넘기고, 여기서 무엇을 할지 고른다.

/// 받아쓰기를 부른 동작.
public enum DictationTriggerSource: Sendable {
    /// VoiceOver 두 손가락 두 번 탭. 처리하지 않으면 시스템 기본 동작(재생·정지, 전화 받기·끊기)이 돈다.
    case magicTap
    /// 단축어 동작(뒷면 탭). 처리하지 않으면 시스템이 이어 할 일이 없어 침묵이 된다.
    case shortcut
}

/// 등록된 받아쓰기 버튼 하나.
public struct DictationTriggerCandidate: Equatable, Sendable {
    public let id: Int
    /// 그 버튼이 사용자가 지금 보고 있는 화면에 있는가(가장 위 시트 안이고, 숨은 탭·밀려난 화면이 아니다).
    public let frontmost: Bool
    /// 받아쓰는 중이거나 시작 준비 중인가. 끝내기는 이 버튼에 가야 한다.
    public let active: Bool
    /// 화면에 나타난 차례. 클수록 나중에 나타났다.
    public let order: Int

    public init(id: Int, frontmost: Bool, active: Bool, order: Int) {
        self.id = id
        self.frontmost = frontmost
        self.active = active
        self.order = order
    }
}

/// 판정 결과.
public enum DictationTriggerResponse: Equatable, Sendable {
    /// 이 버튼의 받아쓰기를 시작하거나 끝낸다(버튼을 누른 것과 같은 길).
    case toggle(id: Int)
    /// 우리가 처리하지 않는다 — Magic Tap의 시스템 기본 동작(음악 재생·정지, 통화 받기·끊기)을 빼앗지 않는다.
    case passToSystem
    /// 받아쓰기가 없는 화면임을 한 문장으로 알린다. 단축어는 그대로 끝나면 실패와 침묵이 구분되지 않는다.
    case announceNoTarget
}

/// 화면을 겨냥하지 않은 받아쓰기 동작을 어디로 보낼지 고른다.
///
/// - 지금 화면(`frontmost`)에 있는 버튼만 대상이다. 시트에 덮인 화면·숨은 탭의 받아쓰기를 몰래 켜지 않는다.
/// - 그중 받아쓰는 중인 버튼이 있으면 그것이다(끝내기). 없으면 가장 나중에 나타난 버튼이다.
///   한 화면에 버튼이 둘 이상인 경우는 지금 코드에 없다(길찾기 출발·도착 칸은 각자의 시트다). 이 규칙은 그때를 위한 결정론이다.
/// - 통화 중의 Magic Tap은 언제나 시스템에 넘긴다. 시스템 기본이 「전화 끊기」이고, 통화가 마이크를 쥐고 있어 받아쓰기는 어차피 시작하지 못한다.
///
/// - Parameter inCall: 통화가 이어지는 중인가. 안전 인자라 기본값이 없다.
public func dictationTriggerResponse(
    source: DictationTriggerSource,
    inCall: Bool,
    candidates: [DictationTriggerCandidate]
) -> DictationTriggerResponse {
    if source == .magicTap, inCall { return .passToSystem }
    let visible = candidates.filter(\.frontmost)
    let pick = visible.filter(\.active).max(by: { $0.order < $1.order })
        ?? visible.max(by: { $0.order < $1.order })
    if let pick { return .toggle(id: pick.id) }
    switch source {
    case .magicTap: return .passToSystem
    case .shortcut: return .announceNoTarget
    }
}
