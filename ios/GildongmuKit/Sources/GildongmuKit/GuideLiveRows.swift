import Foundation

/// 실시간 도보 안내 하단 2행 파생 계층 (spec 2026-08-11 §4 — 순수, I/O 비의존).
/// 웹 정본 `src/lib/guide-live-rows.ts`의 1:1 미러 — 공유 fixture
/// (guide-live-rows-scenarios.json)가 최종 ko 문자열 수준에서 동조를 강제한다.
///
/// 구간 선택·국면·잔여는 전부 표시 좌표계(`displayEffectiveD`)를 쓴다. 음성·톤·햅틱
/// 파이프라인(`guideStep`)은 원시 d를 계속 쓴다(불변식 A). 이 계층은 문자열을 만들지
/// 않고 **디스크립터**를 낸다 — 렌더는 앱 `GuideText.liveTop`/`liveNext`의 몫이고,
/// 디스크립터→키 매핑 규칙은 fixture 러너와 동일해야 한다.
///
/// 우선순위 1·2(도착·최종 접근)는 이 계층 밖이다 — 그 국면의 발화·표시 소유자는
/// 오케스트레이터의 최종 접근 층이고, 여기는 finalApproach에서 빈 행을 낸다.

/// 회전 접근 전환 표시 잔여(m). 표시 10 = 원시 25 = 임박 큐 시점(spec §2-4).
public let turnApproachMeters = 10.0
/// 예고에서 "연속 회전"으로 접는 유닛 길이(m) — 직진 창이 사실상 없는 유닛.
public let shortUnitPreviewMeters = 10.0

public struct LiveStepInput: Sendable, Equatable {
    public let description: String
    public let startD: Double
    public let endD: Double
    /// 서버 구조화 조각(spec §5). 추출 실패는 nil — 재파싱으로 채우지 않는다.
    public let target: String?
    public let anchor: String?

    public init(
        description: String, startD: Double, endD: Double,
        target: String? = nil, anchor: String? = nil
    ) {
        self.description = description
        self.startD = startD
        self.endD = endD
        self.target = target
        self.anchor = anchor
    }
}

/// 행동 경계 기준으로 병합한 표시 유닛(spec §4.1) — "직진 구간 + (있다면) 끝 행동".
public struct DisplayUnit: Sendable, Equatable {
    public let stepIndices: [Int]
    public let startD: Double
    public let endD: Double
    public let crossing: Bool
    /// 횡단 유닛의 표시 문장(주석 포함 스텝 전문). 비횡단은 nil.
    public let crossingText: String?
    /// 횡단 유닛의 행동 종류(crosswalk|underpass). 비횡단은 nil.
    public let crossingAction: WalkAction?
    /// 유닛 끝 경계의 행동(다음 유닛 첫 스텝에서 유도). 최종 유닛은 nil(F6).
    public let endAction: WalkAction?
    /// 끝 행동의 기준 이름(다음 유닛 첫 스텝의 anchor).
    public let endAnchor: String?
    /// 직진 목표 이름(유닛 마지막 스텝의 target — 병합 후 유닛의 것).
    public let target: String?
}

/// 횡단 유닛 판정. walkStepAction만으로는 부족하다 — "횡단보도"는 지명으로도
/// 등장하므로(회전 우선순위가 회전 문장은 걸러 주지만, 회전 없는 "천호역 횡단보도까지
/// 100m 이동"이 남는다) 재작성 행동문("…건너세요")까지 요구한다.
private func isCrossing(_ action: WalkAction?, _ description: String) -> Bool {
    (action == .crosswalk || action == .underpass) && description.contains("건너")
}

public func buildDisplayUnits(_ steps: [LiveStepInput]) -> [DisplayUnit] {
    struct Group {
        var indices: [Int]
        let crossing: Bool
        let action: WalkAction?
    }
    var groups: [Group] = []
    for i in steps.indices {
        let action = walkStepAction(steps[i].description)
        let crossing = isCrossing(action, steps[i].description)
        // 행동 없는 경계(지도 분할 직진)는 흡수한다(F5). 횡단 유닛은 흡수하지 않는다 —
        // 국면이 유닛 단위라 꼬리를 붙이면 다 건넌 뒤에도 "건너세요"가 남는다.
        if i > 0, action == nil, let last = groups.indices.last, !groups[last].crossing {
            groups[last].indices.append(i)
        } else {
            groups.append(Group(indices: [i], crossing: crossing, action: action))
        }
    }
    return groups.indices.map { gi in
        let g = groups[gi]
        let first = steps[g.indices.first!]
        let last = steps[g.indices.last!]
        let nextFirst = gi + 1 < groups.count ? steps[groups[gi + 1].indices.first!] : nil
        return DisplayUnit(
            stepIndices: g.indices,
            startD: first.startD,
            endD: last.endD,
            crossing: g.crossing,
            crossingText: g.crossing ? first.description : nil,
            crossingAction: g.crossing ? g.action : nil,
            // 끝 행동 = 다음 유닛 첫 스텝이 알리는 행동(횡단 유닛 진입 포함). 최종 유닛 nil.
            endAction: nextFirst.flatMap { walkStepAction($0.description) },
            endAnchor: nextFirst?.anchor,
            target: last.target
        )
    }
}

/// 리듀서 스팬(StepSpan)과 응답 스텝(live)을 index로 짝지어 표시 입력을 만든다.
public func liveStepsFrom(
    route: GuideRoute, live: [(target: String?, anchor: String?)?]
) -> [LiveStepInput] {
    route.steps.map { span in
        let fragments = span.index < live.count ? live[span.index] : nil
        return LiveStepInput(
            description: span.description, startD: span.startD, endD: span.endD,
            target: fragments?.target, anchor: fragments?.anchor
        )
    }
}

/// 표시 전용 소상태(spec §4) — 판정 계층 상태 신설 금지.
public struct LiveRowsState: Sendable, Equatable {
    /// 직전 표시 유닛 index(단조 클램프 스코프).
    public let unitIndex: Int
    /// 직전 표시 잔여(클램프 기준).
    public let clamped: Int
}

public enum LiveTopRow: Sendable, Equatable {
    case offRoute
    case reacquiring
    case uncertain
    case crossing(text: String)
    case turnIn(meters: Int, action: WalkAction) // meters ≥ 1
    case turnSoon(action: WalkAction) // 표시 잔여 0 = "잠시 후"(음수 표시 금지)
    case straight(meters: Int, target: String?)
}

public enum LiveNextRow: Sendable, Equatable {
    case action(action: WalkAction, anchor: String?) // 직진 국면: 현재 유닛 끝 행동
    case straight(meters: Int, target: String?) // 다음 유닛 직진 예고(지도 값)
    case crossing(action: WalkAction)
    case turn(action: WalkAction) // 연속 회전
}

public struct LiveRowsOutput: Sendable, Equatable {
    public let state: LiveRowsState?
    public let top: LiveTopRow?
    public let next: LiveNextRow?
}

/// 다음 유닛 예고(종류별 — 직진 가정 금지, F11).
private func previewOf(_ unit: DisplayUnit) -> LiveNextRow {
    if unit.crossing { return .crossing(action: unit.crossingAction ?? .crosswalk) }
    let len = Int(floor(unit.endD - unit.startD))
    // 직진 창이 사실상 없는 짧은 유닛은 길이 예고가 무의미하다 — 행동만 예고(연속 회전).
    if Double(len) <= shortUnitPreviewMeters, let action = unit.endAction {
        return .turn(action: action)
    }
    return .straight(meters: len, target: unit.target)
}

/// 리듀서형 파생(F3): `(prevRowState, 입력) → (nextRowState, rows)`. 입력은 리듀서가
/// 이미 계산하는 값만 받는다(원시 d·국면·세션/재조회 기준점). 호출자는 표시 유닛
/// 전이 외의 리셋 지점(재조회·이탈 복귀·모드 전환)에서 prev=nil + 새 baselineD를
/// 넘긴다 — 클램프·램프인이 함께 새 기준으로 시작한다.
public func guideLiveRows(
    prev: LiveRowsState?,
    units: [DisplayUnit],
    d: Double,
    baselineD: Double,
    phase: GuidePhase
) -> LiveRowsOutput {
    if units.isEmpty { return LiveRowsOutput(state: nil, top: nil, next: nil) }
    // 이탈: 両행을 비운다(F2 — 낡은 예고는 따라가게 된다). 문장은 렌더 계층의 기존 키.
    if phase == .offRoute { return LiveRowsOutput(state: nil, top: .offRoute, next: nil) }
    // 최종 접근·도착(우선순위 1·2)은 이 계층 밖 — 오케스트레이터가 행을 소유한다.
    if phase == .finalApproach { return LiveRowsOutput(state: nil, top: nil, next: nil) }

    let effD = displayEffectiveD(d: d, baselineD: baselineD)
    let unitIndex = units.firstIndex { effD < $0.endD } ?? units.count - 1
    let unit = units[unitIndex]
    let raw = Int(floor(max(0, unit.endD - effD))) // F8: 버림
    // 단조 클램프(같은 표시 유닛 스코프). 국면 판정도 이 값으로 한다(F4) — "숫자는
    // 8인데 국면은 직진" 같은 자기모순이 구조적으로 불가능하다.
    let clamped = prev.flatMap { $0.unitIndex == unitIndex ? min($0.clamped, raw) : nil } ?? raw
    let state = LiveRowsState(unitIndex: unitIndex, clamped: clamped)

    // 밑국면(상태 대체와 무관한 유닛 기준 국면) — 아랫줄이 이것을 따른다(상태 중 유지).
    let isLast = unitIndex == units.count - 1
    let turnApproach =
        !unit.crossing && Double(clamped) <= turnApproachMeters && unit.endAction != nil
    let next: LiveNextRow? = isLast
        ? nil // 최종 유닛은 비운다(§4.3)
        : (unit.crossing || turnApproach)
            ? previewOf(units[unitIndex + 1]) // 행동 실행 중 → 그 행동 뒤 유닛 예고
            : .action(action: unit.endAction!, anchor: unit.endAnchor) // 직진 중 → 끝 행동 예고

    // 상태 대체(우선순위 4·5): 윗줄만 바꾸고 아랫줄·클램프는 유지(해소 시 그 자리 복귀).
    if phase == .reacquiring { return LiveRowsOutput(state: state, top: .reacquiring, next: next) }
    if phase == .uncertain { return LiveRowsOutput(state: state, top: .uncertain, next: next) }

    let top: LiveTopRow
    if unit.crossing {
        top = .crossing(text: unit.crossingText ?? "")
    } else if turnApproach {
        top = clamped <= 0
            ? .turnSoon(action: unit.endAction!)
            : .turnIn(meters: clamped, action: unit.endAction!)
    } else {
        top = .straight(meters: clamped, target: unit.target)
    }
    return LiveRowsOutput(state: state, top: top, next: next)
}
