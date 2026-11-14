import GildongmuKit
import SwiftUI

/// 나들이 시트(E51 spec §8). 읽기 순서: 제목 행(+접기) → 주변 낭독 → 주변 보기 → **상태 행(착지 — 열림·띠바 복귀)** →
/// 걸은 거리 → 방향 → 「방금 말한 것」 목록(E82 V11), 최하단 고정 "나들이 종료". 버튼은 위, 실시간 갱신 정보는 아래
/// (위원장 판정) — 착지 행에서 위로 한 번 쓸면 버튼에 닿는다. "출발점으로"는 종료 화면에만 있다(E54).
///
/// 착지 행은 이벤트로만 바뀌는 상태 행이다(출발점 잡는 중 → 출발점 {라벨}). 걸을 때마다 바뀌는 걸은 거리를
/// 착지 행에 두면 커서가 머무는 동안 VoiceOver가 바뀔 때마다 다시 읽는다(spec 리뷰 M9).
///
/// 문장 통지는 모델의 한 창구(`OutingModel.post`)뿐이고 이 뷰엔 live region이 없다.
struct OutingSheet: View {
    let model: OutingModel
    let onMinimize: () -> Void
    let onReturn: () -> Void
    /// 기록의 가게 줄에서 그 가게까지 도보 안내로 넘긴다(`GuideSession.handOverOuting` — 이 뷰는 세션을 직접 시작하지 않는다).
    let onStartWalk: (GuideDestination) -> Void

    @AppStorage(OutingNarration.storageKey) private var narrationRaw = OutingNarration.default.rawValue
    @AccessibilityFocusState private var statusFocused: Bool
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
                historySection
            }
        }
        .safeAreaInset(edge: .bottom) {
            if model.endScreen == nil {
                Button { model.stopByUser() } label: {
                    Text(appLocalized("ios.outing.stop")).frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(.bar, ignoresSafeAreaEdges: [])
            }
        }
        .task {
            // 띠바에서 돌아온 시트도 새로 열림과 같은 착지다(E57 위원장 판정 Q1 — 종전 접기 버튼 착지 폐기).
            if model.endScreen != nil {
                await land($endFocused, "end")
            } else {
                await land($statusFocused, "status")
            }
        }
        // 종료 전이: 포커스를 쥔 버튼이 통째로 사라진다 — 사유 문장으로 선점(헌장 §5). 조망이 열려 있으면 닫는다.
        .onChange(of: model.endScreen) { previous, end in
            guard previous == nil, end != nil else { return }
            overviewAdapter = nil
            Task { await land($endFocused, "end") }
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
            if model.endScreen != nil { Task { await land($endFocused, "end") } }
        }) { place in
            PlaceDetailSheet(place: place, showsDirectionsEntry: false)
        }
        .sheet(isPresented: $showsSettings, onDismiss: {
            model.recomputeHealth()
            if model.endScreen?.health?.usedDefaultWeight == false { Task { await land($healthSummaryFocused, "healthSummary") } }
        }) {
            SettingsView(focusWeightOnAppear: true)
        }
    }

    private var trackingSection: some View {
        Section {
            // 누를 때마다 다음 단계로(E54). 라벨 변화가 곧 상태 신호라 별도 통지는 없다(헌장 §5).
            Button(appLocalized("ios.outing.narration", narrationLabel(narration))) {
                narrationRaw = narration.next.rawValue
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
            }
        }
    }

    /// 「방금 말한 것」(E82 V11) — 끝까지 말한 문장과 말하지 못하고 지나온 가게, 최신이 위. 제목 하나만 heading이고
    /// 한 줄이 한 접근성 객체다. 행의 정체성은 기록 순번이라 새 줄이 들어와도 커서가 있던 줄은 그대로다. 지난 시간은
    /// 화면을 그릴 때의 값이다(초 단위로 다시 그리지 않는다 — 커서가 머문 줄을 VoiceOver가 다시 읽는다).
    private var historySection: some View {
        Section {
            if model.history.entries.isEmpty {
                Text(appLocalized("ios.outing.historyEmpty"))
            } else {
                let now = Date().timeIntervalSince1970
                ForEach(model.history.entries) { entry in
                    historyRow(entry, now: now)
                }
            }
        } header: {
            Text(appLocalized("ios.outing.historyHeading"))
                .accessibilityAddTraits(.isHeader)
        }
    }

    /// 가게 줄에는 「도보 안내 시작」을 행 뿌리의 밀기 버튼으로 둔다 — VoiceOver에서는 같은 줄의 동작(로터)으로 들린다
    /// (E72 판별선: 장소 하나인 `List` 행). 끝까지 밀기 실행은 끈다(나들이를 끝내고 안내를 시작하는 되돌릴 수 없는 동작).
    @ViewBuilder
    private func historyRow(_ entry: OutingHistoryEntry, now: Double) -> some View {
        if case .place(let place, _, _) = entry.content {
            Text(historyLine(entry, now: now))
                .swipeActions(edge: .leading, allowsFullSwipe: false) {
                    Button(appLocalized("beacon.guideStartWalk")) {
                        onStartWalk(GuideDestination(
                            dest: BeaconDest(lat: place.lat, lng: place.lng), label: place.name,
                            labelRoman: place.nameRoman))
                    }
                }
        } else {
            Text(historyLine(entry, now: now))
        }
    }

    /// 한 줄 = 한 문장(쉼표로 이은 한 객체): 「○○카페, 왼쪽, 2분 전」. 가게가 아닌 줄은 말한 문장 그대로다.
    private func historyLine(_ entry: OutingHistoryEntry, now: Double) -> String {
        let minutes = outingHistoryAgeMinutes(at: entry.at, now: now)
        let age = minutes == 0
            ? appLocalized("ios.outing.historyJustNow") : appLocalized("ios.outing.historyMinutesAgo", "\(minutes)")
        switch entry.content {
        case .place(let place, let side, let passedBy):
            // 말한 가게의 방향 모름은 「옆」으로 말했다. 지나온 가게는 방향을 알 때만 붙인다.
            let sideWord: String? = switch side {
            case .left: appLocalized("ios.outing.historyLeft")
            case .right: appLocalized("ios.outing.historyRight")
            case .unknown: passedBy ? nil : appLocalized("ios.outing.historyBeside")
            }
            return joinText(
                bilingual(place.name, roman: place.nameRoman).primary, sideWord,
                passedBy ? appLocalized("ios.outing.historyPassedBy") : nil, age)
        case .crosswalk(let audioSignal):
            return joinText(
                audioSignal ? appLocalized("ios.outing.crosswalkAheadAudio") : appLocalized("ios.outing.crosswalkAhead"),
                age)
        case .junction(let shape):
            return joinText(OutingModel.junctionLine(shape), age)
        case .road(let name):
            return joinText(appLocalized("ios.outing.roadEntered", name), age)
        case .answer(let text):
            return joinText(text, age)
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

    /// 착지 — 지연·검증·1회 재시도(이 저장소의 정본 패턴). 결과는 도보 시트와 같은 계측 한 줄로 남긴다(E57 spec §4 —
    /// 종전엔 기록이 없어 실보행 로그가 착지 성패를 말하지 못했다).
    private func land(_ binding: AccessibilityFocusState<Bool>.Binding, _ target: String) async {
        try? await Task.sleep(for: .milliseconds(400))
        binding.wrappedValue = true
        try? await Task.sleep(for: .milliseconds(600))
        let retried = !binding.wrappedValue
        if retried {
            binding.wrappedValue = true
            try? await Task.sleep(for: .milliseconds(600))
        }
        guideDiagLog("sheetFocus sheet=outing target=\(target) landed=\(binding.wrappedValue) attempts=\(retried ? 2 : 1)"
            + " vo=\(voFocusedLabel().map { "\"\($0)\"" } ?? "nil")")
    }
}
