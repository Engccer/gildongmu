import GildongmuKit
import SwiftUI

/// 대중교통 실시간 안내 시트(B2 §3.2·§5). BeaconTrackingSheet와 같은 계약 —
/// **시작이 곧 표시, 중지가 곧 닫힘(1:1)**, 열릴 때 중지 버튼 착지, 스와이프·
/// VoiceOver escape 닫기 = 중지(좀비 세션 금지).
///
/// 컨트롤은 국면별 집합(§4.2·§5): 대기=열차·차량 선택 목록(행위구 라벨·종착 차단·
/// 급행 병기), 승차 중=탑승 변경(잠금형)·다음 구간(근사형 상시), 도착=다음 구간
/// (포커스 선점 — 다음 행동이 있는 곳, 헌장 §5), 추적 불가=수동 전진. 공통=중지·
/// 진행 상황·상시 표시(신호 상태·마지막 갱신 — 무통지 구간에도 상태가 보인다, §6.1).
struct TransitTrackingSheet: View {
    let model: TransitGuideModel
    let onStop: () -> Void
    /// 완료 후 도보 핸드오프 수락(§14.2) — nil이면 제안 버튼 미노출(목적지 소실 등).
    let onWalkHandoff: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @AccessibilityFocusState private var stopFocused: Bool
    @AccessibilityFocusState private var advanceFocused: Bool
    @AccessibilityFocusState private var changeBoardingFocused: Bool
    @AccessibilityFocusState private var walkHandoffFocused: Bool
    /// 목록 포커스 소실 복귀 착지점(§13.4) — 항목이 사라지면 라벨로 선점 복귀.
    @AccessibilityFocusState private var waitingLabelFocused: Bool
    /// 포커스가 얹힌 후보의 정체성(항목 정체성 옵셔널 바인딩 — Bool equals 금지 정본).
    @AccessibilityFocusState private var focusedCandidate: String?
    /// 경유역 목록 펼침(§14.1) — leg가 바뀌면 접는다(다음 구간의 목록은 다른 목록).
    @State private var viaExpanded = false

    private static let waitingLabelId = "transit-waiting-label"

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if model.state != nil {
                    Section {
                        Button(appLocalized("beacon.stop"), action: onStop)
                            .accessibilityFocused($stopFocused)
                        Button(appLocalized("guide.progressButton")) { model.announceProgress() }
                        statusRows
                        viaStopsRows
                        phaseControls(proxy: proxy)
                    } header: {
                        Text(joinText(appLocalized("beacon.transitHeading"), model.destinationLabel))
                            .accessibilityAddTraits(.isHeader)
                    }
                } else if let handoff = model.pendingWalkHandoff {
                    walkHandoffSection(handoff)
                }
            }
            .task { await landStopFocus() }
            .onChange(of: model.state?.legIndex) { viaExpanded = false }
            // 완료 전이(세션 소거 + 핸드오프 제안): 사라진 "다음 구간" 대신 다음
            // 행동(도보 안내 시작)으로 선점(헌장 §5, arrived 전이와 동형 패턴).
            .onChange(of: model.pendingWalkHandoff) { _, handoff in
                guard handoff != nil, onWalkHandoff != nil else { return }
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(400))
                    walkHandoffFocused = true
                    try? await Task.sleep(for: .milliseconds(600))
                    guard !walkHandoffFocused else { return }
                    walkHandoffFocused = true
                }
            }
            .onChange(of: model.state?.phase) { previous, phase in
                // arrived 진입 시 "다음 구간"으로 선점(사라진 컨트롤 대신 다음 행동,
                // 헌장 §5).
                if phase == .arrived {
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(400))
                        advanceFocused = true
                    }
                    return
                }
                // 탑승 계열 전이(waiting→riding)는 포커스를 쥔 대기 컨트롤을 통째로
                // 제거한다 — riding 컨트롤로 선점(헌장 §5, 감사 M2). arrived→riding
                // 자동 복귀(backOnTrack)는 사용자 행동이 아니라 제외.
                if phase == .riding, previous == .waiting {
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(400))
                        if model.state?.lock.map(isApproxTransitLock) == true {
                            advanceFocused = true
                        } else {
                            changeBoardingFocused = true
                        }
                    }
                }
            }
        }
    }

    /// 완료 후 도보 핸드오프(§14.2, 피드백 #6) — A안 제안형. 자동 연결(B안)은
    /// 지하 역사 GPS 공백으로 기각. 닫기는 presentation 바인딩이 제안을 소거한다.
    private func walkHandoffSection(_ handoff: TransitWalkHandoff) -> some View {
        Section {
            Text(appLocalized("transitGuide.doneWalk", String(handoff.walkMinutes)))
                .foregroundStyle(.secondary)
            if let onWalkHandoff {
                Button(appLocalized("transitGuide.walkHandoffStart")) { onWalkHandoff() }
                    .accessibilityFocused($walkHandoffFocused)
            }
            Button(appLocalized("actions.close")) { dismiss() }
        } header: {
            Text(joinText(appLocalized("beacon.transitHeading"), handoff.destinationLabel))
                .accessibilityAddTraits(.isHeader)
        }
    }

    /// 경유역 목록 1단계(§14.1, 피드백 #3): 기보유 viaStops의 정적 표시 — 추가
    /// upstream 0회. 항목 무헤딩(도착편 관례)·단일 텍스트, 승차·하차 라벨과 현재
    /// 위치(arvlMsg3 매칭, 지하철 잠금 추적에서만)를 쉼표로 흡수. 펼침 시맨틱은
    /// DisclosureGroup이 정본(시뮬 무라벨 셰브런은 아티팩트 — 실기기 비문제).
    /// 단계 공개(더 보기) 비적용: 정적 텍스트라 절단 너머가 행동을 바꾸지 않는다.
    @ViewBuilder private var viaStopsRows: some View {
        if let state = model.state, let leg = model.currentLeg, !leg.viaStops.isEmpty {
            DisclosureGroup(isExpanded: $viaExpanded) {
                let currentIndex = viaStopCurrentIndex(leg: leg, currentLocation: state.currentLocation)
                ForEach(Array(leg.viaStops.enumerated()), id: \.offset) { index, stop in
                    Text(joinText(
                        stop.name,
                        index == 0
                            ? appLocalized("transitGuide.viaBoard")
                            : index == leg.viaStops.count - 1
                                ? appLocalized("transitGuide.viaAlight")
                                : "",
                        index == currentIndex ? appLocalized("transitGuide.viaCurrent") : ""
                    ))
                }
            } label: {
                Text(appLocalized(
                    leg.mode == "subway" ? "transitGuide.viaStopsTrain" : "transitGuide.viaStopsBus",
                    String(leg.viaStops.count)
                ))
            }
        }
    }

    @ViewBuilder private var statusRows: some View {
        if let state = model.state, let leg = model.currentLeg {
            // 상시 표시(통지 채널 밖) — 통지와 같은 조립기 공유(§12.3: 완성 문장
            // 공백 연결, 쉼표 조립(joinText)은 이중 구두점을 만들어 폐기). 여전히
            // 한 줄 = 한 접근성 객체(단일 텍스트).
            distanceText(model.statusLineText(state: state, leg: leg))
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func phaseControls(proxy: ScrollViewProxy) -> some View {
        if let state = model.state, let leg = model.currentLeg {
            if state.signal == .untrackable {
                Text(appLocalized("transitGuide.untrackable"))
                    .foregroundStyle(.secondary)
                Button(appLocalized("transitGuide.advanceUntrackable")) { model.advance() }
            } else if state.phase == .waiting {
                waitingList(leg: leg, previousLock: state.previousLock, proxy: proxy)
            } else {
                // 근사 잠금은 advance 상시(§13.2 소비 한계 — arrived 전이가 없다).
                if state.phase == .arrived || (state.lock.map(isApproxTransitLock) ?? false) {
                    Button(appLocalized("transitGuide.advance")) { model.advance() }
                        .accessibilityFocused($advanceFocused)
                }
                if state.phase == .riding, leg.trackMode != .tagoBus {
                    Button(appLocalized("transitGuide.changeBoarding")) { model.changeBoarding() }
                        .accessibilityFocused($changeBoardingFocused)
                }
            }
        }
    }

    @ViewBuilder private func waitingList(
        leg: TransitGuideLeg, previousLock: TransitLock?, proxy: ScrollViewProxy
    ) -> some View {
        if leg.trackMode == .tagoBus {
            Button(appLocalized("transitGuide.boardApprox")) { model.boardApprox() }
        } else {
            let classified = classifyTransitBoardingCandidates(
                model.waitingLive + model.waitingDeparted.map(\.item), leg: leg)
            // 항목 정체성 = 차량·열차 식별자(폴링 갱신이 포커스를 흔들지 않게, §5.1).
            // vehId 없는 후보의 키를 완성 문장으로 두면 문장 갱신마다 remount되어
            // 포커스가 폴마다 튕긴다(감사 L2) — 슬롯 위치 폴백(웹 동형).
            let rows = classified.candidates.enumerated().map { index, candidate in
                (id: candidate.item.vehicleId.flatMap { $0.isEmpty ? nil : $0 } ?? "slot-\(index)",
                 candidate: candidate)
            }
            Text(appLocalized("transitGuide.waitingLabel"))
                .accessibilityFocused($waitingLabelFocused)
                .id(Self.waitingLabelId)
                // 목록 포커스 소실 복귀(§13.4, 헌장 §5): 폴링 갱신으로 포커스가 얹힌
                // 항목이 사라지면 라벨로 선점 복귀(목록 밖 포커스는 강탈 금지).
                .onChange(of: rows.map(\.id)) { _, ids in
                    guard let focused = focusedCandidate, !ids.contains(focused) else { return }
                    focusedCandidate = nil
                    recoverWaitingLabelFocus(proxy, lost: focused)
                }
            if classified.directionUncertain, !classified.candidates.isEmpty {
                Text(appLocalized("transitGuide.directionCheck")).foregroundStyle(.secondary)
            }
            // 빠른하차(E5) — 열차 목록 **앞**. 국면 전환으로 조용히 나타나는 문장이라
            // 포커스 착지점(waitingLabel) 뒤에 두어야 앞으로 스와이프해서 만난다.
            // 통지는 만들지 않는다(정적 정보라 상태 변화가 없다).
            if let quickExit = quickExitText(
                leg.quickExit, station: leg.alightName, lang: AppLanguage.current)
            {
                Text(quickExit)
            }
            if classified.candidates.isEmpty {
                // 0건 사유 3-state(§13.3): 진짜 0건 / 필터 전멸 / 조회 실패.
                Text(model.reasonText(model.waitingReason ?? TransitWaitingEmptyReason.none))
                    .foregroundStyle(.secondary)
            }
            ForEach(rows, id: \.id) { row in
                candidateRow(row.candidate, leg: leg)
                    .accessibilityFocused($focusedCandidate, equals: row.id)
            }
            // 대기 국면 탈출구(§13.2) + 탑승 변경 취소(§13.1).
            Button(appLocalized("transitGuide.refresh")) { model.refreshWaiting() }
            Button(appLocalized("transitGuide.boardAlready")) { model.boardAlready() }
            if previousLock != nil {
                Button(appLocalized("transitGuide.cancelChangeBoarding")) {
                    model.cancelChangeBoarding()
                }
            }
        }
    }

    /// 라벨 복귀는 정본 시퀀스를 따른다(감사 M3): 가시화(scrollTo) → 지연 → 대입 →
    /// 검증 → 1회 재시도. List 오프스크린 행은 AX 컬링으로 대입이 조용히 되돌아가는
    /// 실기기 확정 함정이라 동기 대입 한 줄은 실패한다. 로그는 착지 결과까지 남긴다.
    private func recoverWaitingLabelFocus(_ proxy: ScrollViewProxy, lost: String) {
        Task { @MainActor in
            proxy.scrollTo(Self.waitingLabelId)
            try? await Task.sleep(for: .milliseconds(400))
            waitingLabelFocused = true
            try? await Task.sleep(for: .milliseconds(600))
            if !waitingLabelFocused {
                waitingLabelFocused = true
                try? await Task.sleep(for: .milliseconds(400))
            }
            transitGuideLog("focusRecovery lost=\(lost) landed=\(waitingLabelFocused)")
        }
    }

    @ViewBuilder private func candidateRow(
        _ candidate: TransitBoardingCandidate, leg: TransitGuideLeg
    ) -> some View {
        let item = candidate.item
        let departedMinutes = model.waitingDeparted.first {
            $0.item.vehicleId == item.vehicleId
        }?.minutes
        let desc = joinText(
            item.destinationName.map { appLocalized("transitGuide.bound", $0) } ?? "",
            item.direction,
            item.message,
            candidate.express ? appLocalized("transitGuide.expressCheck", leg.alightName) : "",
            departedMinutes.map { appLocalized("transitGuide.departed", String($0)) } ?? ""
        )
        if item.vehicleId == nil || item.vehicleId?.isEmpty == true {
            // vehId 없는 슬롯은 잠금 불가(§5.1 "vehId 보유 슬롯만 활성화") — 빈 잠금은
            // 어떤 항목과도 매칭되지 않는 조용한 고장이 된다(독립 리뷰 BLOCKER).
            Text(desc).foregroundStyle(.secondary)
        } else if candidate.terminatesEarly {
            // 결정적 미도달(§5.1) — 활성화 차단, 사유 병기.
            Text(joinText(
                desc,
                appLocalized(
                    "transitGuide.terminatesEarly", item.destinationName ?? "", leg.alightName)
            ))
            .foregroundStyle(.secondary)
        } else {
            Button(appLocalized(
                leg.mode == "subway" ? "transitGuide.boardTrain" : "transitGuide.boardBus", desc
            )) { model.board(item: item) }
        }
    }

    /// 열릴 때 중지 버튼 착지(BeaconTrackingSheet 동형 — 지연·검증·1회 재시도).
    private func landStopFocus() async {
        try? await Task.sleep(for: .milliseconds(400))
        stopFocused = true
        try? await Task.sleep(for: .milliseconds(600))
        guard !stopFocused else { return }
        stopFocused = true
    }
}
