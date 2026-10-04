import Foundation

/// 순서 바꾸기 로터 액션(spec docs/superpowers/specs/2026-10-05-reorder-rotor-actions-design.md §1).
/// 고정한 최근 항목(E67)과 탭 순서(E66)가 같은 조작법이라 판정을 여기 한 곳에 둔다.
public enum ReorderMove: String, CaseIterable, Sendable {
    case toTop, up, down
}

public enum Reorder {
    /// 그 자리에서 할 수 있는 이동, 위에서 아래 순(맨 위로, 위로, 아래로). 항목이 2개 미만이면 없다.
    /// 둘째 자리의 맨 위로는 위로와 같으므로 내지 않는다.
    public static func availableMoves(index: Int, count: Int) -> [ReorderMove] {
        guard count >= 2, index >= 0, index < count else { return [] }
        var moves: [ReorderMove] = []
        if index >= 2 { moves.append(.toTop) }
        if index >= 1 { moves.append(.up) }
        if index < count - 1 { moves.append(.down) }
        return moves
    }

    /// 한 항목을 옮긴 새 배열. 범위 밖이거나 옮길 수 없는 이동(맨 위의 위로 등)은 원본 그대로.
    public static func moved<T>(_ items: [T], from index: Int, _ move: ReorderMove) -> [T] {
        guard items.indices.contains(index) else { return items }
        let target: Int = switch move {
        case .toTop: 0
        case .up: index - 1
        case .down: index + 1
        }
        guard items.indices.contains(target), target != index else { return items }
        var out = items
        let item = out.remove(at: index)
        out.insert(item, at: target)
        return out
    }

    /// 저장된 순서의 복구(E66 탭 순서, spec §3.1): 기본 순서에 있는 값만 처음 한 번씩 앞에서부터 남기고,
    /// 빠진 값은 기본 순서대로 뒤에 붙인다. 모르는 값·중복은 버린다. 결과는 언제나 기본 순서의 순열이다.
    public static func restoredOrder(saved: [String], defaultOrder: [String]) -> [String] {
        var seen = Set<String>()
        let known = Set(defaultOrder)
        let kept = saved.filter { known.contains($0) && seen.insert($0).inserted }
        return kept + defaultOrder.filter { !seen.contains($0) }
    }

    /// 저장 문자열(JSON 배열) 판. 파싱 실패·빈 값은 기본 순서다.
    public static func restoredOrder(json: String, defaultOrder: [String]) -> [String] {
        let saved = (try? JSONDecoder().decode([String].self, from: Data(json.utf8))) ?? []
        return restoredOrder(saved: saved, defaultOrder: defaultOrder)
    }

    /// 저장 문자열로 쓰기(`restoredOrder(json:)`의 짝).
    public static func encodedOrder(_ order: [String]) -> String {
        (try? JSONEncoder().encode(order)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }
}
