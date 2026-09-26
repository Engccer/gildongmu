import GildongmuKit
import SwiftUI

/// 나들이 시트(E51 spec §8). 읽기 순서: 제목 행(+접기) → 주변 낭독 → 주변 보기 → **상태 행(착지)** →
/// 걸은 거리 → 방향, 최하단 고정 "출발점으로"·"나들이 종료". 버튼은 위, 실시간 갱신 정보는 아래
/// (위원장 판정) — 착지 행에서 위로 한 번 쓸면 버튼에 닿는다.
///
/// 착지 행은 이벤트로만 바뀌는 상태 행이다(출발점 잡는 중 → 출발점 {라벨}). 10m마다 바뀌는 걸은 거리를
/// 착지 행에 두면 커서가 머무는 동안 VoiceOver가 바뀔 때마다 다시 읽는다(spec 리뷰 M9).
///
/// 문장 통지는 모델의 한 창구(`OutingModel.post`)뿐이고 이 뷰엔 live region이 없다.
struct OutingSheet: View {
    let model: OutingModel
    let onMinimize: () -> Void
    let onReturn: () -> Void

    @AppStorage(OutingNarration.storageKey) private var narrationRaw = OutingNarration.default.rawValue
    @AccessibilityFocusState private var statusFocused: Bool
    @AccessibilityFocusState private var minimizeFocused: Bool
    @AccessibilityFocusState private var endFocused: Bool
    @AccessibilityFocusState private var healthSummaryFocused: Bool
    @State private var overviewAdapter: OutingOverviewAdapter?
    /// 조망에서 고른 장소 — 조망이 닫힌 **뒤** 상세를 연다(닫힌 뒤 행동 계약).
    @State private var pendingPlace: Place?
    @State private var detailPlace: Place?
    @State private var showsSettings = false
    /// 체중 입력 권유(도보 종료 화면과 같은 저장 키·같은 판정, E31).
    @AppStorage(WalkHealth.weightPromptDismissalsKey) private var weightPromptDismissals = 0
    @AppStorage(WalkHealth.weightPromptEngagedKey) private var weightPromptEngaged = false

    private var narration: OutingNarration { OutingNarration(rawValue: narrationRaw) ?? .default }

    var body: some View {
        List {
            if let end = model.endScreen {
                endSection(end)
            } else {
                trackingSection
            }
        }
        .safeAreaInset(edge: .bottom) {
            if model.endScreen == nil {
                VStack(spacing: 0) {
                    // 미확정이면 disabled가 아니라 라벨이 상태를 말한다(포커스를 지우지 않는다, spec §13).
                    Button {
                        guard model.origin != nil else { return model.announceOriginPending() }
                        onReturn()
                    } label: {
                        Text(model.origin == nil
                             ? joinText(appLocalized("ios.outing.returnToOrigin"), appLocalized("ios.outing.originPending"))
                             : appLocalized("ios.outing.returnToOrigin"))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding(.horizontal)
                    .padding(.top, 8)
                    Button { model.stopByUser() } label: {
                        Text(appLocalized("ios.outing.stop")).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }
                .background(.bar, ignoresSafeAreaEdges: [])
            }
        }
        .task {
            if GuideSession.shared.returnedFromBand == .outing {
                GuideSession.shared.returnedFromBand = nil
                if model.endScreen != nil { await land($endFocused) } else { await land($minimizeFocused) }
            } else if model.endScreen != nil {
                await land($endFocused)
            } else {
                await land($statusFocused)
            }
        }
        // 종료 전이: 포커스를 쥔 버튼이 통째로 사라진다 — 사유 문장으로 선점(헌장 §5). 조망이 열려 있으면 닫는다.
        .onChange(of: model.endScreen) { previous, end in
            guard previous == nil, end != nil else { return }
            overviewAdapter = nil
            Task { await land($endFocused) }
        }
        .sheet(item: $overviewAdapter, onDismiss: {
            if let place = pendingPlace {
                pendingPlace = nil
                detailPlace = place
            }
        }) { adapter in
            GuideOverviewSheet(capability: adapter) { _ in }
        }
        // 상세를 읽는 동안 세션이 끝났으면(안전망 5분) 닫은 뒤 사유 문장으로 착지한다(종료 전이의 착지가 시트에 가렸다).
        .sheet(item: $detailPlace, onDismiss: {
            if model.endScreen != nil { Task { await land($endFocused) } }
        }) { place in
            PlaceDetailSheet(place: place, showsDirectionsEntry: false)
        }
        .sheet(isPresented: $showsSettings, onDismiss: {
            model.recomputeHealth()
            if model.endScreen?.health?.usedDefaultWeight == false { Task { await land($healthSummaryFocused) } }
        }) {
            SettingsView(focusWeightOnAppear: true)
        }
    }

    private var trackingSection: some View {
        Section {
            Menu(appLocalized("ios.outing.narration", narrationLabel(narration))) {
                ForEach(OutingNarration.allCases, id: \.self) { option in
                    Button(narrationLabel(option)) { narrationRaw = option.rawValue }
                        .accessibilityAddTraits(option == narration ? .isSelected : [])
                }
            }
            Button(appLocalized("ios.outing.overviewButton")) {
                model.refreshForOverview()
                overviewAdapter = OutingOverviewAdapter(model: model) { pendingPlace = $0 }
            }
            Text(model.statusLine)
                .accessibilityFocused($statusFocused)
            distanceText(model.walkedLine)
            distanceText(model.directionLine)
            // 잠금 중 무음 예고 — 세션 내내 참인 지속 상태라 행으로 남긴다(도보 시트 동형, 시작 시 1회 통지와 짝).
            if model.soundDegraded {
                Text(appLocalized("ios.beacon.soundBackgroundUnavailable"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } header: {
            GuideTitleRow {
                Text(appLocalized("ios.outing.heading"))
                    .accessibilityAddTraits(.isHeader)
            } trailing: {
                GuideMinimizeButton(action: onMinimize)
                    .accessibilityFocused($minimizeFocused)
            }
        }
    }

    // 키는 리터럴로만(check-xcstrings-keys 린터 계약).
    private func narrationLabel(_ option: OutingNarration) -> String {
        switch option {
        case .off: appLocalized("ios.outing.narrationOff")
        case .landmarks: appLocalized("ios.outing.narrationLandmarks")
        case .all: appLocalized("ios.outing.narrationAll")
        }
    }

    /// 종료 화면(spec §8.3). 걸음 요약은 도보 종료 화면과 같은 판정·같은 문자열, 귀환 버튼은 출발점이 있을 때만.
    private func endSection(_ end: OutingModel.EndScreen) -> some View {
        Section {
            Text(end.reason)
                .accessibilityFocused($endFocused)
            if let health = end.health {
                Text([healthLine(health), BeaconTrackingSheet.foodLine(kcal: health.kcal)]
                    .compactMap { $0 }.joined(separator: " "))
                    .accessibilityFocused($healthSummaryFocused)
                if showsWeightPrompt {
                    Text(appLocalized("ios.beacon.healthWeightNotice", "\(Int(WalkHealth.defaultWeightKg))"))
                    Button(appLocalized("ios.beacon.healthEnterWeight")) {
                        weightPromptEngaged = true
                        showsSettings = true
                    }
                }
            }
            if end.origin != nil {
                Button(appLocalized("ios.outing.returnToOrigin"), action: onReturn)
            }
            Button(appLocalized("actions.close")) {
                // 권유가 떠 있던 화면을 아무 행동 없이 닫은 것만 무시로 센다 — clearEnd 앞(E31 순서 계약).
                weightPromptDismissals = WalkHealth.nextWeightPromptDismissals(
                    current: weightPromptDismissals, promptShown: showsWeightPrompt, promptEngaged: weightPromptEngaged)
                weightPromptEngaged = false
                model.clearEnd()
            }
        } header: {
            Text(appLocalized("ios.outing.ended"))
                .accessibilityAddTraits(.isHeader)
        }
    }

    private var showsWeightPrompt: Bool {
        WalkHealth.shouldShowWeightPrompt(
            usedDefaultWeight: model.endScreen?.health?.usedDefaultWeight ?? false,
            dismissals: weightPromptDismissals)
    }

    private func healthLine(_ health: WalkHealthSummary) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: AppLanguage.current)
        let steps = f.string(from: NSNumber(value: health.steps)) ?? "\(health.steps)"
        if health.usedDefaultWeight, !showsWeightPrompt {
            return appLocalized(
                "ios.beacon.healthSummaryWithWeight", steps, "\(Int(WalkHealth.defaultWeightKg))", "\(health.kcal)")
        }
        return appLocalized("ios.beacon.healthSummary", steps, "\(health.kcal)")
    }

    /// 착지 — 지연·검증·1회 재시도(이 저장소의 정본 패턴, `BeaconTrackingSheet.landTitleFocus` 동형).
    private func land(_ binding: AccessibilityFocusState<Bool>.Binding) async {
        try? await Task.sleep(for: .milliseconds(400))
        binding.wrappedValue = true
        try? await Task.sleep(for: .milliseconds(600))
        guard !binding.wrappedValue else { return }
        binding.wrappedValue = true
    }
}
