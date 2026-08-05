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

    @AccessibilityFocusState private var stopFocused: Bool
    @AccessibilityFocusState private var advanceFocused: Bool
    /// 목록 포커스 소실 복귀 착지점(§13.4) — 항목이 사라지면 라벨로 선점 복귀.
    @AccessibilityFocusState private var waitingLabelFocused: Bool
    /// 포커스가 얹힌 후보의 정체성(항목 정체성 옵셔널 바인딩 — Bool equals 금지 정본).
    @AccessibilityFocusState private var focusedCandidate: String?

    var body: some View {
        List {
            Section {
                Button(appLocalized("beacon.stop"), action: onStop)
                    .accessibilityFocused($stopFocused)
                Button(appLocalized("guide.progressButton")) { model.announceProgress() }
                statusRows
                phaseControls
            } header: {
                Text(joinText(appLocalized("beacon.transitHeading"), model.destinationLabel))
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .task { await landStopFocus() }
        // arrived 진입 시 "다음 구간"으로 선점(사라진 컨트롤 대신 다음 행동, 헌장 §5).
        .onChange(of: model.state?.phase) { _, phase in
            guard phase == .arrived else { return }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(400))
                advanceFocused = true
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

    @ViewBuilder private var phaseControls: some View {
        if let state = model.state, let leg = model.currentLeg {
            if state.signal == .untrackable {
                Text(appLocalized("transitGuide.untrackable"))
                    .foregroundStyle(.secondary)
                Button(appLocalized("transitGuide.advanceUntrackable")) { model.advance() }
            } else if state.phase == .waiting {
                waitingList(leg: leg, previousLock: state.previousLock)
            } else {
                // 근사 잠금은 advance 상시(§13.2 소비 한계 — arrived 전이가 없다).
                if state.phase == .arrived || (state.lock.map(isApproxTransitLock) ?? false) {
                    Button(appLocalized("transitGuide.advance")) { model.advance() }
                        .accessibilityFocused($advanceFocused)
                }
                if state.phase == .riding, leg.trackMode != .tagoBus {
                    Button(appLocalized("transitGuide.changeBoarding")) { model.changeBoarding() }
                }
            }
        }
    }

    @ViewBuilder private func waitingList(
        leg: TransitGuideLeg, previousLock: TransitLock?
    ) -> some View {
        if leg.trackMode == .tagoBus {
            Button(appLocalized("transitGuide.boardApprox")) { model.boardApprox() }
        } else {
            let classified = classifyTransitBoardingCandidates(
                model.waitingLive + model.waitingDeparted.map(\.item), leg: leg)
            let candidateIds = classified.candidates.map(\.listId)
            Text(appLocalized("transitGuide.waitingLabel"))
                .accessibilityFocused($waitingLabelFocused)
                // 목록 포커스 소실 복귀(§13.4, 헌장 §5): 폴링 갱신으로 포커스가 얹힌
                // 항목이 사라지면 라벨로 선점 복귀(목록 밖 포커스는 강탈 금지).
                .onChange(of: candidateIds) { _, ids in
                    guard let focused = focusedCandidate, !ids.contains(focused) else { return }
                    focusedCandidate = nil
                    transitGuideLog("focusRecovery lostCandidate=\(focused)")
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(400))
                        waitingLabelFocused = true
                    }
                }
            if classified.directionUncertain, !classified.candidates.isEmpty {
                Text(appLocalized("transitGuide.directionCheck")).foregroundStyle(.secondary)
            }
            if classified.candidates.isEmpty {
                // 0건 사유 3-state(§13.3): 진짜 0건 / 필터 전멸 / 조회 실패.
                Text(model.reasonText(model.waitingReason ?? TransitWaitingEmptyReason.none))
                    .foregroundStyle(.secondary)
            }
            // 항목 정체성 = 차량·열차 식별자(폴링 갱신이 포커스를 흔들지 않게, §5.1).
            // vehId 없는 후보가 복수면 nil 충돌 — 웹과 동형으로 message 폴백(독립 리뷰).
            ForEach(classified.candidates, id: \.listId) { candidate in
                candidateRow(candidate, leg: leg)
                    .accessibilityFocused($focusedCandidate, equals: candidate.listId)
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
