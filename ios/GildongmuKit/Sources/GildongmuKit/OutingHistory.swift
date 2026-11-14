import Foundation

// 나들이 「방금 말한 것」 기록(E82 V10~V12, spec 2026-11-14-e82-vergilius-v1-design.md §3.2).
//
// 안내가 **끝까지 말한** 문장과, 말하지 못하고 지나온 가게를 세션 메모리에 최근 50건까지 둔다. 화면은 이 기록으로
// 목록을 그리고(문장은 화면이 자기 언어로 조립한다 — 여기에는 재료만 있다), 가게 줄에서 도보 안내로 넘어간다.
// 세션이 끝나면 지운다. ⚠ 가게 이름·좌표와 답의 글이 들어 있으므로 디스크 로그에는 `logSummary`(종류별 건수)만 쓴다.

/// 기록에 남는 가게 — 도보 안내의 도착지가 될 재료(id·이름·좌표).
public struct OutingHistoryPlace: Sendable, Equatable {
    public let id: String
    public let name: String
    public let nameRoman: String?
    public let lat: Double
    public let lng: Double

    public init(id: String, name: String, nameRoman: String?, lat: Double, lng: Double) {
        self.id = id
        self.name = name
        self.nameRoman = nameRoman
        self.lat = lat
        self.lng = lng
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
    /// 두는 건수의 상한(V12).
    public static let capacity = 50

    /// 최신이 맨 앞이다(화면 순서 그대로).
    public private(set) var entries: [OutingHistoryEntry] = []
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
        if entries.count > Self.capacity { entries.removeLast(entries.count - Self.capacity) }
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
