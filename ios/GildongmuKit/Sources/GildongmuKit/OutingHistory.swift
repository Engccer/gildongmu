import Foundation

// 나들이 기록(E82 V10~V12, spec 2026-11-14-e82-vergilius-v1-design.md §3.2).
//
// 안내가 **끝까지 말한** 문장과, 말하지 못하고 지나온 가게, 말로 물은 답을 세션 메모리에 둔다. 화면은 이 기록 하나를 두
// 묶음으로 나눠 그린다: 「지나온 곳」(답이 아닌 줄)과 「물어본 것」(답), 둘 다 최신이 아래다. 문장은 화면이 자기 언어로
// 조립한다(여기에는 재료만 있다). 질문 재료(「방금 말한 것」)는 두 묶음을 가르지 않은 시간 순서 그대로 읽는다.
// 세션이 끝나면 지운다. ⚠ 가게 이름·좌표와 답의 글이 들어 있으므로 디스크 로그에는 `logSummary`(종류별 건수)만 쓴다.

/// 기록에 남는 가게 — 도보 안내의 도착지가 될 재료(id·이름·좌표)와 줄의 「전화 걸기」가 쓰는 전화번호(없으면 nil).
public struct OutingHistoryPlace: Sendable, Equatable {
    public let id: String
    public let name: String
    public let nameRoman: String?
    public let lat: Double
    public let lng: Double
    public let phone: String?

    public init(id: String, name: String, nameRoman: String?, lat: Double, lng: Double, phone: String?) {
        self.id = id
        self.name = name
        self.nameRoman = nameRoman
        self.lat = lat
        self.lng = lng
        self.phone = phone
    }
}

/// 기록 한 줄의 재료. 종류는 다섯(가게·횡단보도·갈림길·도로명·답)이다.
public enum OutingHistoryContent: Sendable, Equatable {
    /// 가게. `side`는 말한 순간(지나옴이면 넘긴 순간)의 좌우이고, `passedBy`는 말하지 못하고 지나왔다는 표시다.
    /// 둘 다 기본값이 없다 — 지나온 가게가 「말한 가게」로, 방향 모르는 가게가 왼쪽으로 적히지 않게.
    case place(OutingHistoryPlace, side: OutingSide, passedBy: Bool)
    case crosswalk(audioSignal: Bool)
    case junction(OutingJunctionShape)
    case road(name: String)
    /// 물음에 대한 답의 글(S6이 적는다).
    case answer(text: String)

    /// 말로 물은 답인가 — 화면의 「물어본 것」 묶음과 「지나온 곳」 묶음을 가른다(위원장 판정 2026-11-16 ①).
    public var isAnswer: Bool {
        if case .answer = self { return true }
        return false
    }

    /// 로그에 쓰는 종류 이름. 글·이름·좌표는 로그에 쓰지 않는다.
    public var kindLabel: String {
        switch self {
        case .place(_, _, let passedBy): passedBy ? "placePassed" : "place"
        case .crosswalk: "crosswalk"
        case .junction: "junction"
        case .road: "road"
        case .answer: "answer"
        }
    }
}

public struct OutingHistoryEntry: Sendable, Equatable, Identifiable {
    /// 세션 안의 순번 — 목록 행의 정체성이다(새 줄이 들어와도 기존 줄의 id는 그대로라 VoiceOver 커서가 튀지 않는다).
    public let id: Int
    /// 적은 시각(초). 호출자가 한 시계로만 넣는다.
    public let at: Double
    public let content: OutingHistoryContent
}

public struct OutingHistory: Sendable, Equatable {
    /// 두는 건수의 상한(V12) — 묶음마다 센다. 걷는 동안 쌓이는 「지나온 곳」 줄이 「물어본 것」의 답을 밀어내지 않게.
    public static let capacity = 50
    /// 「지나온 곳」의 단계 공개 수: 처음 20줄, 「더 보기」마다 20줄(위원장 판정 2026-11-16 ②, `RevealWindow` 관례).
    public static let passedRevealStep = 20

    /// 최신이 맨 앞이다(시간 순서, 두 묶음이 섞여 있다).
    public private(set) var entries: [OutingHistoryEntry] = []

    /// 「지나온 곳」 줄(가게·횡단보도·갈림길·도로명) — 오래된 것이 위, **최신이 아래**(위원장 판정 2026-11-17: 「물어본 것」과
    /// 같은 방향으로 쌓인다. 최신이 위였던 2026-11-16 판을 실사용 뒤 뒤집었다).
    public var passedEntries: [OutingHistoryEntry] { entries.filter { !$0.content.isAnswer }.reversed() }

    /// 「물어본 것」 줄(말로 물은 답) — 오래된 것이 위, **최신이 아래**(위원장 판정 2026-11-16 ⑨: 맨 아래 「말로 묻기」에서
    /// 위로 쓸면 방금 받은 답부터 거꾸로 듣는다).
    public var answerEntries: [OutingHistoryEntry] { entries.filter(\.content.isAnswer).reversed() }
    private var nextID = 1

    public init() {}

    /// 한 줄을 적는다. 같은 가게가 이미 있으면 옛 줄을 지우고 새로 적는다 — 한 가게가 두 줄(지나옴 뒤 다시 지나며
    /// 말함)로 남으면 어느 줄이 지금의 것인지 알 수 없다.
    @discardableResult
    public mutating func record(_ content: OutingHistoryContent, at: Double) -> OutingHistoryEntry {
        if case .place(let place, _, _) = content {
            entries.removeAll { entry in
                if case .place(let old, _, _) = entry.content { return old.id == place.id }
                return false
            }
        }
        let entry = OutingHistoryEntry(id: nextID, at: at, content: content)
        nextID += 1
        entries.insert(entry, at: 0)
        // 상한은 새 줄과 같은 묶음에서만 센다 — 넘으면 그 묶음의 가장 오래된 줄을 버린다.
        let isAnswer = content.isAnswer
        if entries.filter({ $0.content.isAnswer == isAnswer }).count > Self.capacity,
           let oldest = entries.lastIndex(where: { $0.content.isAnswer == isAnswer }) {
            entries.remove(at: oldest)
        }
        return entry
    }

    /// 세션 끝 — 전부 지운다. 순번도 처음으로 돌린다(다음 세션의 줄이 옛 세션의 줄과 이어져 보이지 않게).
    public mutating func clear() {
        entries = []
        nextID = 1
    }

    /// 디스크 로그용 요약: 건수뿐이다.
    public var logSummary: String { "n=\(entries.count)" }
}

/// 적은 지 몇 분 지났는가(내림). 1분이 안 됐으면 0(「방금」). 시계가 거꾸로 갔으면 0.
public func outingHistoryAgeMinutes(at: Double, now: Double) -> Int {
    max(0, Int((now - at) / 60))
}

/// 「지나온 곳」에 보일 줄 수 — **최신 줄에서부터 센다**(화면은 최신이 아래라 목록의 끝 쪽 이만큼을 보인다). 창(`RevealWindow`)의
/// 수가 기본이고, VoiceOver 커서가 그보다 오래된 줄에 머물러 있으면 그 줄까지 남긴다 — 새 줄은 맨 아래에 들어와 창의 가장
/// 오래된 줄(맨 위)을 밀어내므로, 줄 수만으로 자르면 커서가 머문 줄이 사라져 커서가 튄다.
/// `focusedIndex`는 커서가 머문 줄이 최신에서 몇 번째인가(최신 줄이 0)이고 커서가 목록 밖이면 nil이다.
public func outingPassedShownCount(windowCount: Int, total: Int, focusedIndex: Int?) -> Int {
    let keep = focusedIndex.map { $0 + 1 } ?? 0
    return min(total, max(windowCount, keep))
}

/// 「지나온 곳」의 「더 보기」: 창을 지금 보이는 줄 너머(더 오래된 쪽)로 한 단계 연다. 첫 새 줄의 위치를 **최신에서 센 순번**으로
/// 돌려준다(커서를 옮길 곳, 통지 없음 — `RevealWindow` 관례). 화면에서는 종전 맨 윗줄의 바로 위 줄이라, 위로 쓸어 가며 듣던
/// 방향이 그대로 이어진다. 더 없으면 nil이고 창은 그대로다.
public func outingPassedRevealMore(_ window: inout RevealWindow, shown: Int, total: Int) -> Int? {
    guard shown < total else { return nil }
    while window.visibleCount <= shown {
        guard window.revealMore(totalCount: total) != nil else { break }
    }
    return shown
}

/// 「지나온 곳」의 줄 id 목록(화면 순서 — 오래된 것이 앞, 최신이 끝)에서 그 줄이 **최신에서 몇 번째인가**(최신 줄이 0).
/// 커서가 목록 밖이면 nil. `outingPassedShownCount`의 `focusedIndex`에 넣는 값이다.
public func outingPassedFromNewest(ids: [Int], focusedID: Int?) -> Int? {
    guard let focusedID, let index = ids.firstIndex(of: focusedID) else { return nil }
    return ids.count - 1 - index
}

/// 최신에서 센 순번(`outingPassedRevealMore`가 돌려준 값)의 줄 id — 「더 보기」가 커서를 옮길 줄이다. 범위 밖이면 nil.
public func outingPassedRowID(ids: [Int], fromNewest: Int) -> Int? {
    let index = ids.count - 1 - fromNewest
    return ids.indices.contains(index) ? ids[index] : nil
}
