import GildongmuKit
import SwiftUI

// MARK: - 능력 프로토콜 (E15-1 spec 2026-08-23 §2)

/// 진행 상황 조망 능력. 뷰(셸)는 이 프로토콜만 안다. 능력이 없는 세션은 트리거 자체가
/// 안 나온다(죽은 버튼 금지 — 키 게이트 동형).
///
/// ⚠ **조망 전용으로 봉인한다.** 다음 능력(주변 확인·추세 톤)은 자기 프로토콜을 새로
/// 둔다 — 이 프로토콜을 넓히면 셸이 능력 종류별 분기 주머니가 된다(설계 리뷰 P1).
/// 판정(어느 행을·어느 순서로·어디가 지금인가)은 Kit 순수 계층(`transitProgressOverview`,
/// 도보는 `BeaconModel`의 기존 파생값)이 하고, 여기는 **배선**이다(spec §2.2).
@MainActor
protocol GuideOverviewCapability: AnyObject, Observable {
    /// 헤더 한 문장 — 시스템 헤더 착지가 이 문장을 낭독한다(별도 통지 없음).
    var overviewHeaderText: String { get }
    /// 본문 행(한 행 = 한 접근성 객체). 순서가 읽기 순서다. `id`는 조망이 열려 있는
    /// 동안 안정적이어야 한다(폴마다 문구가 바뀌어도 정체성은 유지 — 포커스가 튕기지 않게).
    var overviewRows: [GuideOverviewRow] { get }
    /// 행 목록 뒤 슬롯의 행동(대안 보기). 없으면 [].
    var overviewActions: [GuideOverviewAction] { get }
    /// 행동 실행 — **활성화 시점에 최신 상태로 재검증**한다. 만든 시점과 누른 시점 사이에
    /// 국면이 바뀌었으면 `.stale`(셸은 아무것도 덧붙이지 않는다 — 그 전이가 이미 통지·
    /// 착지를 했다). 조망을 떠나야 하는 행동은 `.dismissThen`으로 부모에 위임한다.
    func perform(_ actionId: String) -> GuideOverviewActionResult
    /// 하위 시트를 띄우기 직전 — 조회 시작(도보 프리뷰는 여는 즉시 반대 축을 조회한다).
    func subsheetWillPresent(_ subsheet: GuideOverviewSubsheet)
    /// 하위 시트가 닫혔다 — 진행 중 조회 폐기(latest-wins).
    func subsheetDismissed(_ subsheet: GuideOverviewSubsheet)
}

enum GuideOverviewRow: Identifiable, Equatable {
    case text(id: String, String)
    /// 버튼 행(침묵 탈출구 등) — 실행은 `perform(id)`.
    case action(id: String, label: String)

    var id: String {
        switch self {
        case let .text(id, _), let .action(id, _): id
        }
    }
}

struct GuideOverviewAction: Identifiable {
    let id: String
    let label: String
    /// 눌렀을 때 셸이 띄울 하위 화면.
    let presents: GuideOverviewSubsheet
}

/// 하위 화면 둘 — 도보 대안 프리뷰(2026-08-14 §3)·대중교통 대안 목록(2026-08-23 §5).
/// 국면·데이터가 달라 한 뷰로 합치지 않는다(spec 전제 1의 하위판).
enum GuideOverviewSubsheet: String, Identifiable {
    case walkAlternativePreview, transitAltRoutes
    var id: String { rawValue }
}

/// 조망을 닫은 **뒤** 부모가 실행할 것(spec §4.3 "닫힌 뒤 행동" 계약). 모달 뒤의
/// 컨트롤에 착지하면 조용히 되돌아가고, 조망이 열린 채 `beginReboard()`를 부르면 부모의
/// waiting 착지와 프롬프트 착지가 경쟁한다 — 그래서 행동·착지는 dismiss 완료 뒤다.
enum GuideOverviewFollowUp: Equatable {
    case beginReboard
    case routeSwitched
}

enum GuideOverviewActionResult {
    /// 만든 시점과 누른 시점 사이에 국면이 바뀌었다 — 셸은 아무것도 덧붙이지 않는다.
    case stale
    case dismissThen(GuideOverviewFollowUp)
}

extension GuideOverviewCapability {
    /// 행동 행이 없는 능력(도보)의 기본 구현.
    func perform(_ actionId: String) -> GuideOverviewActionResult { .stale }
    func subsheetWillPresent(_ subsheet: GuideOverviewSubsheet) {}
}

// MARK: - 공유 셸

/// 전 구간 조망 모달(판정 개정 2026-08-10) — 도보 `RouteOverviewSheet`를 능력 단위로
/// 일반화한 것(E15-1). 골격: 상단 닫기 → 행 → 행동 → 말미 닫기, 헤더가 조망 문장.
///
/// 조망 문장은 **섹션 헤더가 전달한다**: 시트 표시와 Announcement는 경합하므로(착지
/// 낭독이 통지를 잠식) 발화 채널 대신, 시스템이 섹션 헤딩에 착지하는 실기기 선례를
/// 그대로 쓴다. 헤더는 조용히 최신화된다(live region 아님 — 조회형 정보).
///
/// 상단 닫기(위원장 판정 2026-08-10): 행 수가 많으면 말미 닫기까지 스크롤 압박 —
/// 헤더 착지(조망 낭독) 다음 한 스와이프에 출구를 둔다. 나브바 toolbar 닫기를 쓰지
/// 않는 이유: 나브바 요소는 섹션 헤더보다 먼저 착지 후보가 되어 "모달 착지 = 조망
/// 낭독" 계약을 깬다. 말미 닫기는 유지(전 구간을 훑고 난 자리에서 되스크롤 방지).
struct GuideOverviewSheet<Capability: GuideOverviewCapability>: View {
    let capability: Capability
    /// 조망을 닫고 나서 부모가 실행할 것 — 셸은 기록만 하고 `dismiss()`한다.
    let onFollowUp: (GuideOverviewFollowUp) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var subsheet: GuideOverviewSubsheet?

    var body: some View {
        List {
            Section {
                // 상단 닫기는 행이 있을 때만(행이 없으면 말미 닫기 하나로 족하다 — 도보
                // 종전 동작과 같다).
                if !capability.overviewRows.isEmpty {
                    Button(appLocalized("actions.close")) { dismiss() }
                }
                ForEach(capability.overviewRows) { row in
                    switch row {
                    case let .text(_, text):
                        distanceText(text)
                    case let .action(id, label):
                        Button(label) { run(id) }
                    }
                }
                // 행동 슬롯은 행 목록 뒤·말미 닫기 앞 — 조망의 주 목적(진행 확인)을 밀지
                // 않으면서 "조망하다 대안 탐색" 흐름과 읽기 순서가 일치한다(2026-08-14 §2).
                ForEach(capability.overviewActions) { action in
                    Button(action.label) {
                        capability.subsheetWillPresent(action.presents)
                        subsheet = action.presents
                    }
                }
                Button(appLocalized("actions.close")) { dismiss() }
            } header: {
                distanceText(capability.overviewHeaderText)
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .sheet(item: $subsheet, onDismiss: {}) { which in
            subsheetView(which)
        }
        // 닫힘(스와이프·VO escape 포함) 시 진행 중 조회 폐기 — 늦은 응답이 닫힌 화면
        // 상태를 되살리지 않는다(2026-08-14 §3 latest-wins).
        .onChange(of: subsheet) { previous, current in
            if let previous, current == nil { capability.subsheetDismissed(previous) }
        }
    }

    private func run(_ id: String) {
        switch capability.perform(id) {
        case .stale:
            break
        case let .dismissThen(followUp):
            onFollowUp(followUp)
            subsheet = nil
            dismiss()
        }
    }

    @ViewBuilder private func subsheetView(_ which: GuideOverviewSubsheet) -> some View {
        switch which {
        case .walkAlternativePreview:
            if let beacon = capability as? BeaconOverviewAdapter {
                WalkAlternativePreviewSheet(model: beacon.model)
            }
        case .transitAltRoutes:
            if let transit = capability as? TransitOverviewAdapter {
                TransitAltRoutesSheet(adapter: transit) { followUp in
                    onFollowUp(followUp)
                    subsheet = nil
                    dismiss()
                }
            }
        }
    }
}

// MARK: - 도보 어댑터 (동작 변경 0 — 종전 RouteOverviewSheet의 읽기를 그대로 투영)

@Observable @MainActor
final class BeaconOverviewAdapter: GuideOverviewCapability {
    let model: BeaconModel
    init(model: BeaconModel) { self.model = model }

    var overviewHeaderText: String { model.progressText() }

    var overviewRows: [GuideOverviewRow] {
        // 자동 인계 등으로 모달이 열린 채 상세가 풀리면 목록만 비고 헤더가 그 시점의
        // 정직한 진행 상황(직선거리)을 계속 전달한다(3-state).
        guard let steps = model.routeStepDescriptions else { return [] }
        var rows: [GuideOverviewRow] = []
        for (i, desc) in steps.enumerated() {
            // 경유지 구획 행(N4): 번호 없는 평문, 스텝 번호는 원본 인덱스 유지.
            if let row = model.routeWaypointRow, row.stepIndex == i {
                rows.append(.text(id: "waypoint-\(i)", row.text))
            }
            let text = i == model.currentStepIndex
                ? appLocalized("ios.guide.routeListCurrent", String(i + 1), desc)
                : appLocalized("ios.guide.routeListRow", String(i + 1), desc)
            rows.append(.text(id: "step-\(i)", text))
        }
        return rows
    }

    var overviewActions: [GuideOverviewAction] {
        // 노출은 반대 축 성립 세션만(죽은 버튼 금지, 2026-08-14 §2).
        guard model.alternativePreviewAvailable else { return [] }
        return [GuideOverviewAction(
            id: "viewAlternative", label: appLocalized("guide.viewAlternative"),
            presents: .walkAlternativePreview)]
    }

    func subsheetWillPresent(_ subsheet: GuideOverviewSubsheet) {
        if subsheet == .walkAlternativePreview { model.openAlternativePreview() }
    }

    func subsheetDismissed(_ subsheet: GuideOverviewSubsheet) {
        if subsheet == .walkAlternativePreview { model.closeAlternativePreview() }
    }
}

/// 대안 경로 미리 보기(spec 2026-08-14 §3·§4). 헤더(요약·비교) → 전환 버튼 →
/// 스텝 행 → 말미 닫기. 시스템 헤더 착지가 요약을 낭독하고(조망 선례), 결과 도착은
/// 모델의 polite 통지 1회가 알린다(헤더는 조용 갱신 — 조회형 정보). 전환 버튼이
/// 헤더 다음 한 스와이프인 이유: 이 화면의 결정 행동이고, 사용자가 능동적으로 연
/// 화면이라 압박 문제가 없다(spec §0-1의 압박은 "걷는 내내 상시 노출"이었다).
struct WalkAlternativePreviewSheet: View {
    let model: BeaconModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                // 전환은 ready에서만(조회 중·실패에 죽은 버튼 금지). 낡음 폴백
                // 재조회 중엔 라벨 병기(한 줄 = 한 객체, 쉼표).
                if case .ready = model.alternativePreviewState {
                    Button(model.isSwitchingVariant
                        ? joinText(appLocalized("guide.adoptAlternative"),
                                   appLocalized("ios.directions.searching"))
                        : appLocalized("guide.adoptAlternative")
                    ) {
                        model.adoptAlternativePreview()
                    }
                }
                if let steps = model.alternativePreviewSteps {
                    // "지금 이 구간" 표식 없음 — 대안 경로 위에 현재 위치가 없다.
                    ForEach(Array(steps.enumerated()), id: \.offset) { i, desc in
                        distanceText(appLocalized("ios.guide.routeListRow", String(i + 1), desc))
                    }
                }
                Button(appLocalized("actions.close")) { dismiss() }
            } header: {
                distanceText(model.alternativePreviewHeaderText())
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }
}

// MARK: - 대중교통 어댑터 (E15-1 spec §4.2)

@Observable @MainActor
final class TransitOverviewAdapter: GuideOverviewCapability, Identifiable {
    let model: TransitGuideModel
    /// `.sheet(item:)` 정체성 — 열 때마다 새 인스턴스라 표시 1회 = 어댑터 1개.
    nonisolated var id: ObjectIdentifier { ObjectIdentifier(self) }
    /// 조망 수명 동안 래치된 침묵 신호(spec §4.1): 한 번 렌더된 silence·탈출구 행은
    /// 추적이 회복돼도 사라지지 않는다 — 포커스가 얹힌 행이 폴 한 번에 사라지는 경로를
    /// 구조로 막는다. 회복되면 문구만 바뀐다.
    /// ⚠ 관측 제외 — body 평가 중 갱신되는 래치라 관측 대상이면 렌더 루프를 만든다.
    @ObservationIgnored private var latchedSilence: TransitOverviewSilenceSignal?
    @ObservationIgnored private var latchedReboard = false

    static let reboardActionId = "reboard"
    static let altRoutesActionId = "altRoutes"

    init(model: TransitGuideModel) { self.model = model }

    var overviewHeaderText: String {
        guard let state = model.state, let leg = model.currentLeg, let overview = model.overview else {
            return ""
        }
        // 상시 표시·진행 상황 통지·조망 헤더가 한 조립기를 지난다(§12.3 드리프트 차단).
        return [
            appLocalized("transitGuide.overviewOrdinal",
                         String(overview.legOrdinal.count), String(overview.legOrdinal.n)),
            model.statusLineText(state: state, leg: leg),
        ].joined(separator: " ")
    }

    var overviewRows: [GuideOverviewRow] {
        guard let overview = model.overview else { return [] }
        var rows: [GuideOverviewRow] = []
        let silenceNow: TransitOverviewSilenceSignal? = overview.rows.lazy.compactMap {
            if case let .silence(signal) = $0 { signal } else { nil }
        }.first
        for (sourceIndex, row) in overview.rows.enumerated() {
            switch row {
            case let .walk(minutes):
                // id는 원본 행 인덱스 — 래치로 silence·탈출구가 늦게 끼어도 움직이지 않는다.
                rows.append(.text(id: "walk-\(sourceIndex)",
                                  appLocalized("transitGuide.overviewWalk", String(minutes))))
            case let .leg(legIndex, _, lineName, boardName, alightName, status, stationCount):
                let statusText = switch status {
                case .done: appLocalized("transitGuide.overviewLegDone")
                case .current: appLocalized("transitGuide.overviewLegCurrent")
                case .upcoming: appLocalized("transitGuide.overviewLegUpcoming")
                }
                // ⚠ 영문 라벨은 **행이 아니라 leg에서** 가져온다(E27 잔여 ①). 순수 판정 계층
                // (`transitProgressOverview`)과 그 공유 fixture를 건드리지 않기 위한 배치다 —
                // 행은 조인 문자열을 그대로 나르고 표시 언어 선택만 여기서 한다.
                let legDisplay = model.route?.legs.indices.contains(legIndex) == true
                    ? model.displayLeg(model.route!.legs[legIndex], useOverride: false)
                    : nil
                rows.append(.text(id: "leg-\(legIndex)", joinText(
                    legDisplay.map {
                        TransitGuideTextRenderer.render(transitOverviewLegLine(
                            isEn: transitGuideIsEn, n: legIndex + 1,
                            line: $0.line, board: $0.board, alight: $0.alight))
                    } ?? appLocalized("transitGuide.overviewLeg",
                                      String(legIndex + 1), lineName, boardName, alightName),
                    statusText,
                    status == .current
                        ? stationCount.map { appLocalized("transitGuide.stationCountAbout", $0) } ?? ""
                        : "")))
                if status == .current {
                    // silence·탈출구는 현재 leg 행 바로 뒤(순수 계층이 같은 자리에 낸다).
                    if let signal = silenceNow ?? latchedSilence {
                        latchedSilence = signal
                        rows.append(.text(id: "silence", silenceText(signal, recovered: silenceNow == nil)))
                    }
                    if overview.reboardOffered || latchedReboard {
                        latchedReboard = true
                        rows.append(.action(id: Self.reboardActionId,
                                            label: appLocalized("transitGuide.changeBoarding")))
                    }
                }
            case let .stop(stopIndex, name, role, here):
                // 정차역 행도 같은 배치 — 현재 leg의 표시 투영에서 이름을 고른다.
                let stopLabel = model.currentLeg.map { model.displayLeg($0, useOverride: false) }
                    .flatMap { $0.stops.indices.contains(stopIndex) ? $0.stops[stopIndex] : nil }
                    ?? TransitLabel(ko: name)
                rows.append(.text(id: "stop-\(stopIndex)", TransitGuideTextRenderer.render(
                    transitViaStopLine(
                        isEn: transitGuideIsEn, stop: stopLabel,
                        role: role == .board ? "board" : role == .alight ? "alight" : "via",
                        here: here))))
            case .stopsUnavailable:
                rows.append(.text(id: "stopsUnavailable",
                                  appLocalized("transitGuide.overviewStopsUnavailable")))
            case .silence:
                break  // 현재 leg 행에서 처리(래치 포함)
            }
        }
        return rows
    }

    private func silenceText(_ signal: TransitOverviewSilenceSignal, recovered: Bool) -> String {
        if recovered { return appLocalized("transitGuide.signalRecovered") }
        return switch signal {
        case .neverSeen: appLocalized("transitGuide.neverSeen")
        case .notYetVisible: appLocalized("transitGuide.stateRidingNotYetVisible")
        case .signalLost: appLocalized("transitGuide.stateSignalLost")
        case .upstreamFailed: appLocalized("transitGuide.stateUpstreamFailed")
        }
    }

    var overviewActions: [GuideOverviewAction] {
        guard model.overview?.alternativesOffered == true else { return [] }
        return [GuideOverviewAction(
            id: Self.altRoutesActionId, label: appLocalized("transitGuide.viewAlternatives"),
            presents: .transitAltRoutes)]
    }

    func perform(_ actionId: String) -> GuideOverviewActionResult {
        switch actionId {
        case Self.reboardActionId:
            // 재검증: riding에서만 유효(탑승 변경은 riding 컨트롤). 국면이 바뀌었으면 그
            // 전이가 이미 통지·착지를 했다.
            guard model.state?.phase == .riding else { return .stale }
            return .dismissThen(.beginReboard)
        default:
            return .stale
        }
    }

    func subsheetDismissed(_ subsheet: GuideOverviewSubsheet) {
        if subsheet == .transitAltRoutes, let token = model.pendingAltRoutes?.token {
            model.cancelAltRoutes(token: token)
        }
    }
}

/// "다른 경로" 하위 시트(E15-1 spec §5.5). 헤더(기준 위치) → 상태 행 또는 후보
/// disclosure(라벨 = 이름+요약, 본문 = 구간 행 + "이 경로로 전환") → 닫기. **미리 보고
/// 전환**(A안)이 이 펼침이다. 무엇을 기준으로 한 목록인지가 SR 사용자의 유일한
/// 정보원이라 헤더가 근거(현재 위치·현재역·승차역 선언)를 말한다.
/// 승차역 표시 문자열 — 영문 조각이 있으면 그것, 없으면 한국어 원문(E27 잔여 ①).
/// 한 버튼·한 헤딩이 각각 한 접근성 객체라 조각 하나짜리 줄이고, 여기서는 언어 태그를 두지
/// 않는다(iOS 줄 단위 태깅은 E28-① 실기기 판정 선행 — spec §3.8 수용 위험).
private func boardLabelText(_ leg: TransitDisplayLeg) -> String {
    transitGuideIsEn ? (leg.board.en ?? leg.board.ko) : leg.board.ko
}

struct TransitAltRoutesSheet: View {
    let adapter: TransitOverviewAdapter
    let onFollowUp: (GuideOverviewFollowUp) -> Void
    @Environment(\.dismiss) private var dismiss
    /// 이 시트가 연 요청의 토큰 — 취소·커밋에 되돌려 자기 요청만 건드린다.
    @State private var token: Int?
    /// 첫 후보 착지(항목 정체성 = routeKey, Bool equals 금지 정본).
    @AccessibilityFocusState private var focusedRoute: String?
    @AccessibilityFocusState private var statusFocused: Bool
    /// 전환 불발 후보(`.invalidCandidate`) — 그 자리 문구 행으로 교체(활성화의 직접 응답).
    /// 사라진 버튼 대신 그 문구 행에 선점(항목 정체성 = routeKey).
    @State private var invalidRouteKeys: Set<String> = []
    @AccessibilityFocusState private var focusedInvalid: String?

    private var model: TransitGuideModel { adapter.model }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section {
                    if let pending = model.pendingAltRoutes, pending.token == token {
                        switch pending.phase {
                        case .loading:
                            Text(appLocalized("ios.transitGuide.destChangeLoading"))
                                .accessibilityFocused($statusFocused)
                                .id("status")
                        case .empty:
                            Text(appLocalized("ios.transitGuide.altNone"))
                                .accessibilityFocused($statusFocused)
                                .id("status")
                        case let .failed(reason):
                            Text(reason == .noLocation
                                 ? appLocalized("ios.transitGuide.altNoLocation")
                                 : appLocalized("ios.transitGuide.destChangeError"))
                                .accessibilityFocused($statusFocused)
                                .id("status")
                            // 승차 전 GPS 실패: 승차역을 앱이 추정하지 않고 사용자가 선언한다(§5.3).
                            if reason == .noLocation, let leg = model.currentLeg,
                               let phase = model.state?.phase, phase == .waiting || phase == .boarding,
                               leg.boardStop != nil {
                                // 승차역명은 **표시 라벨**이다(E27 잔여 ①) — 영문이 없으면 한국어 원문.
                                Button(appLocalized(
                                    "ios.transitGuide.altFromBoardStop",
                                    boardLabelText(model.displayLeg(leg, useOverride: false)))) {
                                    token = model.prepareAltRoutes(declaredBoardStop: true)
                                }
                            }
                        case let .loaded(result):
                            ForEach(transitRouteEntries(result), id: \.route.routeKey) { entry in
                                candidate(entry, proxy: proxy)
                            }
                        }
                    }
                    Button(appLocalized("actions.close")) { dismiss() }
                } header: {
                    Text(headerText)
                        .accessibilityAddTraits(.isHeader)
                }
            }
            .task {
                token = model.prepareAltRoutes(declaredBoardStop: false)
            }
            .onChange(of: model.pendingAltRoutes?.phase) { previous, phase in
                guard let phase, model.pendingAltRoutes?.token == token else { return }
                switch phase {
                case let .loaded(result):
                    landFirstRoute(result, proxy: proxy)
                case .empty, .failed:
                    landStatus(proxy: proxy)
                case .loading:
                    // 실패 행의 "{승차역} 기준으로 조회"가 자기를 지운 전이 — 조회 중 행에
                    // 선점(헌장 §5). 첫 조회(시트 열림)는 헤더 착지가 정본이라 제외.
                    if case .failed = previous { landStatus(proxy: proxy) }
                }
            }
        }
    }

    private var headerText: String {
        switch model.pendingAltRoutes?.origin {
        case let .station(idx):
            if let leg = model.currentLeg, leg.viaStops.indices.contains(idx) {
                return appLocalized("ios.transitGuide.altHeadingFrom", leg.viaStops[idx].name)
            }
            return appLocalized("ios.transitGuide.altHeading")
        case .boardStopDeclared:
            return appLocalized(
                "ios.transitGuide.altHeadingFrom",
                model.currentLeg.map { boardLabelText(model.displayLeg($0, useOverride: false)) } ?? "")
        case .gps, nil:
            return appLocalized("ios.transitGuide.altHeading")
        }
    }

    @ViewBuilder private func candidate(_ entry: TransitRouteEntry, proxy: ScrollViewProxy) -> some View {
        let key = entry.route.routeKey
        DisclosureGroup {
            // 라벨이 이미 요약이라 본문은 구간만(인접 중복 금지).
            TransitRouteRows(route: entry.route, includeSummary: false,
                             destinationName: model.destinationLabel)
            if invalidRouteKeys.contains(key) {
                Text(appLocalized("ios.transitGuide.altInvalid")).foregroundStyle(.secondary)
                    .accessibilityFocused($focusedInvalid, equals: key)
            } else {
                Button(appLocalized("ios.transitGuide.adoptRoute")) {
                    guard let token else { return }
                    switch model.commitAltRoute(entry.route, token: token) {
                    case .committed:
                        onFollowUp(.routeSwitched)
                        dismiss()
                    case .refetching:
                        // 근거 변화·stale 재조회 — 선택 행들이 사라지고 조회 중 행으로
                        // 돌아간다(헌장 §5 선점). 토큰은 새 요청의 것으로 갈아탄다.
                        self.token = model.pendingAltRoutes?.token
                        landStatus(proxy: proxy)
                    case .invalidCandidate:
                        invalidRouteKeys.insert(key)
                        Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(300))
                            focusedInvalid = key
                        }
                    case .sessionEnded:
                        dismiss()
                    }
                }
            }
        } label: {
            Text(joinText(entry.name, transitSummaryText(entry.route.summary)))
        }
        .accessibilityFocused($focusedRoute, equals: key)
        .id(key)
    }

    /// 첫 후보 착지 — 도착 통지는 내지 않는다(착지 낭독이 첫 후보를 읽는다). 정본
    /// 시퀀스: 가시화 → 지연 → 대입 → 검증 → 1회 재시도.
    private func landFirstRoute(_ result: TransitRouteResult, proxy: ScrollViewProxy) {
        guard let first = transitRouteEntries(result).first?.route.routeKey else { return }
        Task { @MainActor in
            statusFocused = false
            proxy.scrollTo(first)
            try? await Task.sleep(for: .milliseconds(400))
            focusedRoute = first
            try? await Task.sleep(for: .milliseconds(600))
            guard focusedRoute != first else { return }
            focusedRoute = first
        }
    }

    private func landStatus(proxy: ScrollViewProxy) {
        Task { @MainActor in
            focusedRoute = nil
            proxy.scrollTo("status")
            try? await Task.sleep(for: .milliseconds(400))
            statusFocused = true
        }
    }
}
