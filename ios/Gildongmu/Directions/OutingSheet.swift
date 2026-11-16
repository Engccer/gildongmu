import GildongmuKit
import SwiftUI

/// 나들이 시트(E51 spec §8). 읽기 순서(위에서 아래): 제목 줄(나들이 → 접기 → 종료) → 주변 낭독 → 둘러보기 →
/// **상태 행(착지 — 열림·띠바 복귀)** → 걸은 거리 → 방향 → 「지나온 곳 (최신순)」(최신이 위, 처음 20줄 + 더 보기) →
/// 「물어본 것」(물은 적이 있을 때만, 최신이 아래, 마지막 답 아래에 그 답의 버튼) → 화면 맨 아래 고정 줄 「말로 묻기」.
/// 버튼은 위, 실시간 갱신 정보는 아래(위원장 판정) — 착지 행에서 위로 한 번 쓸면 버튼에 닿는다. 「말로 묻기」는 걷는 중 엄지로
/// 겨냥 없이 누르는 맨 아래 줄을 혼자 쓰고, 종료는 기록이 지워져 되돌릴 수 없어 그 줄과 떨어진 제목 줄 끝에 둔다(위원장 판정
/// 2026-11-16 ⑨). 맨 아래에서 위로 쓸면 방금 받은 답부터 거꾸로 듣는다. "출발점으로"는 종료 화면에만 있다(E54).
///
/// 착지 행은 이벤트로만 바뀌는 상태 행이다(출발점 잡는 중 → 출발점 {라벨}). 걸을 때마다 바뀌는 걸은 거리를
/// 착지 행에 두면 커서가 머무는 동안 VoiceOver가 바뀔 때마다 다시 읽는다(spec 리뷰 M9).
///
/// 문장 통지는 모델의 한 창구(`OutingModel.post`)뿐이고 이 뷰엔 live region이 없다.
struct OutingSheet: View {
    let model: OutingModel
    let onMinimize: () -> Void
    let onReturn: () -> Void
    /// 안내로 넘긴다(`GuideSession.handOverOuting` — 이 뷰는 세션을 직접 시작하지 않는다, E82 V13): 기록의 가게 줄,
    /// 답 아래 수단 버튼(V21), 제안 버튼(V22).
    let onHandOver: (GuideDestination, GuideSession.OutingHandoverStart) -> Void

    @AppStorage(OutingNarration.storageKey) private var narrationRaw = OutingNarration.default.rawValue
    @AccessibilityFocusState private var statusFocused: Bool
    @AccessibilityFocusState private var endFocused: Bool
    @AccessibilityFocusState private var healthSummaryFocused: Bool
    /// 「둘러보기」(위원장 판정 2026-11-16 ⑤) — 내 주변 탭의 둘러보기를 지금 위치로 연다(`AroundNearbyView(host: .session)`).
    @State private var showsAround = false
    @State private var showsSettings = false
    /// 기록 줄의 지난 시간을 셀 기준 시각 — 시트가 열릴 때와 기록이 바뀔 때만 잡는다(아래 `historySection`).
    @State private var historyNow = Date().timeIntervalSince1970
    /// 「지나온 곳」의 단계 공개 창(처음 20줄, 더 보기마다 20줄 — `RevealWindow` 관례, 위원장 판정 2026-11-16 ②).
    @State private var passedWindow = RevealWindow(
        initialVisible: OutingHistory.passedRevealStep, revealStep: OutingHistory.passedRevealStep)
    /// 「지나온 곳」에서 VoiceOver 커서가 머문 줄(기록 순번) — 더 보기의 착지 대상이고, 새 줄이 위에 들어와도 이 줄은 창 밖으로
    /// 밀려나지 않는다(`outingPassedShownCount`).
    @AccessibilityFocusState private var focusedPassedID: Int?
    /// 체중 입력 권유(도보 종료 화면과 같은 저장 키·같은 판정, E31).
    @AppStorage(WalkHealth.weightPromptDismissalsKey) private var weightPromptDismissals = 0
    @AppStorage(WalkHealth.weightPromptEngagedKey) private var weightPromptEngaged = false
    /// 채팅과 같은 AI 동의(V14) — 동의 전이면 「말로 묻기」가 동의 화면을 연다.
    @AppStorage(AIChatConsent.key) private var aiConsentGranted = false
    @State private var showsConsent = false

    private var narration: OutingNarration { OutingNarration(rawValue: narrationRaw) ?? .default }

    var body: some View {
        // 「더 보기」 가시화용 proxy(List는 화면 밖 행을 접근성 트리에서 뺀다 — 내 주변 목록의 더 보기와 같은 순서).
        ScrollViewReader { proxy in
        List {
            if let end = model.endScreen {
                endSection(end)
            } else {
                trackingSection
                historySection(proxy: proxy)
                askedSection
            }
        }
        // 「말로 묻기」는 화면 맨 아래 고정 줄을 혼자 쓴다(줄 전체 폭) — 목록 밖 마지막 객체라 네 손가락 아래쪽 탭으로도 닿는다.
        .safeAreaInset(edge: .bottom) {
            if model.endScreen == nil {
                askControl
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    .background(.bar, ignoresSafeAreaEdges: [])
            }
        }
        }
        .onChange(of: model.history.entries.map(\.id)) {
            historyNow = Date().timeIntervalSince1970
        }
        .task {
            historyNow = Date().timeIntervalSince1970
            // 띠바에서 돌아온 시트도 새로 열림과 같은 착지다(E57 위원장 판정 Q1 — 종전 접기 버튼 착지 폐기).
            if model.endScreen != nil {
                await land($endFocused, "end")
            } else {
                await land($statusFocused, "status")
            }
        }
        // 종료 전이: 포커스를 쥔 버튼(제목 줄의 종료·맨 아래 말로 묻기)이 통째로 사라진다 — 사유 문장으로 선점(헌장 §5).
        .onChange(of: model.endScreen) { previous, end in
            guard previous == nil, end != nil else { return }
            Task { await land($endFocused, "end") }
        }
        // 둘러보기는 세션 상태가 아니라 위치에서 나온 화면이라 세션이 끝나도 닫지 않는다. 읽는 동안 끝났으면(안전망 5분) 닫은 뒤
        // 사유 문장으로 착지한다(종료 전이의 착지가 시트에 가렸다).
        .sheet(isPresented: $showsAround, onDismiss: {
            if model.endScreen != nil { Task { await land($endFocused, "end") } }
        }) {
            NavigationStack {
                AroundNearbyView(host: .session)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button(appLocalized("actions.close")) { showsAround = false }
                        }
                    }
            }
        }
        .sheet(isPresented: $showsConsent) {
            ChatConsentView {
                aiConsentGranted = true
                showsConsent = false
            }
        }
        // 받아쓰기 권한 거부·실패 안내(검색 화면과 같은 판정 `speechAlertText`, 확인하면 다시 시도할 수 있게 된다).
        .alert(speechAlertText(model.speech) ?? "", isPresented: Binding(
            get: { speechAlertText(model.speech) != nil },
            set: { if !$0 { model.speech.reset() } }
        )) {
            if case .denied = model.speech.phase {
                Button(appLocalized("ios.common.openSettings")) { openAppSettings() }
            }
            Button(appLocalized("ios.common.ok")) {}
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
            // 내 주변 탭의 둘러보기와 같은 화면·같은 문자열이다(위원장 판정 2026-11-16 ⑤).
            Button(appLocalized("ios.nearby.around")) { showsAround = true }
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
                stopButton
            }
        }
    }

    /// 제목 줄 오른쪽 끝의 「종료」(위원장 판정 2026-11-16 ⑨) — 읽기 순서는 나들이 → 접기 → 종료. 접기 아이콘과 같은 틀(44×44
    /// 터치 영역, 테두리 없음)이고 글자가 곧 이름이다. 누르면 기록이 지워지는 되돌릴 수 없는 동작이라 맨 아래 「말로 묻기」 줄과
    /// 떨어뜨렸다(나란히 두면 묻으려다 종료를 누른다).
    private var stopButton: some View {
        Button { model.stopByUser() } label: {
            Text(appLocalized("ios.outing.stop"))
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
    }

    /// 「말로 묻기」(E82 V14) — 받아쓰기 설정(탭 토글·홀드)을 따르고, 끝나면 모델이 질문을 보낸다(전송 버튼이 없는 자동 전송).
    /// 받아쓰기·요청·답의 상태는 모델이 쥔다(V15 — 시트를 내려도 이어진다). 맨 아래 고정 줄에서 줄 전체 폭을 쓴다.
    @ViewBuilder
    private var askControl: some View {
        if aiConsentGranted {
            HoldDictationButton(
                speech: model.speech,
                hint: appLocalized("ios.outing.askHint"),
                showsTitle: true,
                onTranscript: { model.ask($0) },
                onPause: nil,
                startTitle: appLocalized("ios.outing.askButton"),
                onNoSpeech: { model.askHeardNothing() },
                fillsWidth: true)
        } else {
            Button { showsConsent = true } label: {
                Text(appLocalized("ios.outing.askButton")).frame(maxWidth: .infinity, minHeight: 44)
            }
        }
    }

    /// 「지나온 곳 (최신순)」(E82 V11, 위원장 판정 2026-11-16 ①②) — 끝까지 말한 가게·갈림길·횡단보도·도로명 문장과 말하지
    /// 못하고 지나온 가게, 최신이 위. 말로 물은 답은 「물어본 것」(`askedSection`)에 따로 둔다. 제목 하나만 heading이고 한 줄이
    /// 한 접근성 객체다. 처음 20줄, 「더 보기」를 누를 때마다 20줄을 더 열고 커서는 첫 새 줄로(통지 없음). 행의 정체성은 기록
    /// 순번이라 새 줄이 들어와도 커서가 있던 줄은 그대로다(창 아래 끝으로 밀려도 커서가 있는 동안은 남는다). 지난 시간은 시트가
    /// 열린 때와 기록이 바뀐 때 잡은 기준 시각(`historyNow`)으로 센다 — 그리는 순간의 시각으로 세면 위치 갱신마다 다시
    /// 그려지면서 줄 글이 바뀌어 커서가 머문 줄을 VoiceOver가 다시 읽는다.
    private func historySection(proxy: ScrollViewProxy) -> some View {
        let passed = model.history.passedEntries
        let shown = outingPassedShownCount(
            windowCount: passedWindow.visibleCount, total: passed.count,
            focusedIndex: focusedPassedID.flatMap { id in passed.firstIndex { $0.id == id } })
        return Section {
            if passed.isEmpty {
                Text(appLocalized("ios.outing.historyEmpty"))
            } else {
                ForEach(passed.prefix(shown)) { entry in
                    historyRow(entry, now: historyNow)
                        .id(passedRowID(entry.id))
                        .accessibilityFocused($focusedPassedID, equals: entry.id)
                }
                if passed.count > shown {
                    Button(appLocalized("actions.showMore")) {
                        guard let index = outingPassedRevealMore(&passedWindow, shown: shown, total: passed.count) else {
                            return
                        }
                        let id = passed[index].id
                        proxy.scrollTo(passedRowID(id), anchor: .top)   // 가시화 후 포커스(내 주변 더 보기와 같은 순서)
                        DispatchQueue.main.async { focusedPassedID = id }
                    }
                }
            }
        } header: {
            Text(appLocalized("ios.outing.historyHeading"))
                .accessibilityAddTraits(.isHeader)
        }
    }

    private func passedRowID(_ id: Int) -> String { "passed-\(id)" }

    /// 「물어본 것」(위원장 판정 2026-11-16 ①⑨) — 말로 물은 답, 오래된 것이 위이고 **최신이 아래**다. 목록의 맨 끝, 맨 아래
    /// 「말로 묻기」 줄 바로 위라 그 버튼에서 위로 쓸면 방금 받은 답부터 거꾸로 듣는다. 한 번도 묻지 않았으면 묶음이 없다. 답 줄은
    /// 「지나온 곳」 줄과 같은 행 정체성(기록 순번)·같은 기준 시각을 쓴다. 마지막 답 아래에 그 답의 버튼이 붙는다.
    @ViewBuilder
    private var askedSection: some View {
        let answers = model.history.answerEntries
        if !answers.isEmpty {
            Section {
                ForEach(answers) { entry in
                    historyRow(entry, now: historyNow)
                    if let followUp = model.askFollowUp, followUp.entryID == entry.id {
                        answerButtons(followUp)
                    }
                }
            } header: {
                Text(appLocalized("ios.outing.askedHeading"))
                    .accessibilityAddTraits(.isHeader)
            }
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
                        onHandOver(destination(place), .guide(.walk(accessible: false, waypoint: nil)))
                    }
                }
        } else {
            Text(historyLine(entry, now: now))
        }
    }

    /// 한 줄 = 한 문장(쉼표로 이은 한 객체): 「○○카페, 왼쪽, 2분 전」. 가게가 아닌 줄은 말한 문장 그대로다. 문장은 질문 재료와
    /// 같은 조립기(`OutingModel.historyText`)이고 여기서 지난 시간만 붙인다.
    private func historyLine(_ entry: OutingHistoryEntry, now: Double) -> String {
        let minutes = outingHistoryAgeMinutes(at: entry.at, now: now)
        let age = minutes == 0
            ? appLocalized("ios.outing.historyJustNow") : appLocalized("ios.outing.historyMinutesAgo", "\(minutes)")
        return joinText(OutingModel.historyText(entry.content), age)
    }

    private func destination(_ place: OutingHistoryPlace) -> GuideDestination {
        GuideDestination(dest: BeaconDest(lat: place.lat, lng: place.lng), label: place.name, labelRoman: place.nameRoman)
    }

    /// 답 줄 아래의 버튼(V21·V22) — 줄마다 한 버튼이고 제목·heading은 없다(답 줄이 곧 맥락이다). 누르면 나들이를 끝내고 그
    /// 안내로 넘긴다(`onHandOver`, V13). 수단 버튼의 시작 조건은 채팅 경로 카드와 같은 판정이다(E83 R10).
    @ViewBuilder
    private func answerButtons(_ followUp: OutingModel.AskFollowUp) -> some View {
        if let place = followUp.proposal {
            Button(appLocalized("beacon.guideStartWalk")) {
                onHandOver(destination(place), .guide(.walk(accessible: false, waypoint: nil)))
            }
        }
        ForEach(followUp.routeGroups, id: \.self) { group in
            routeGroupButtons(group, showsName: followUp.routeGroups.count > 1)
        }
    }

    /// 도착지가 둘 이상이면 버튼 라벨에 도착지 이름을 합친다(「도보 안내 시작, ○○역」) — 버튼만 훑어도(로터·제스처 목록)
    /// 어느 도착지인지 들리게. 따로 둔 이름 줄은 버튼과 떨어져 읽힌다.
    @ViewBuilder
    private func routeGroupButtons(_ group: RouteStartCardGroup, showsName: Bool) -> some View {
        let dest = GuideDestination(
            dest: BeaconDest(lat: group.dest.lat, lng: group.dest.lng), label: group.destLabel, labelRoman: group.destRoman)
        let name = showsName
            ? bilingualName(lang: AppLanguage.current, ko: group.destLabel, en: nil, roman: group.destRoman).primary : nil
        if let walk = group.walk {
            Button(joinText(appLocalized("beacon.guideStartWalk"), name)) {
                onHandOver(dest, .guide(.walk(accessible: walk.accessible, waypoint: waypoint(walk))))
            }
        }
        if let car = group.car, canStartCarGuide(dataLocale: AppLanguage.dataLocale, provider: car.carProvider) {
            Button(joinText(appLocalized("beacon.guideStartCar"), name)) {
                onHandOver(dest, .guide(.car(waypoint: waypoint(car))))
            }
        }
        if let payload = group.transit, let transit = payload.transit,
           let route = transitRouteEntries(transit.result).first?.route, transitGuideStartable(route) {
            Button(joinText(appLocalized("beacon.guideStartTransit"), name)) {
                onHandOver(dest, transitStart(route: route, transit: transit, accessible: payload.accessible))
            }
        }
    }

    /// 대중교통 버튼(S4 리뷰 NIT e): 나들이가 쥔 최신 fix로 조회 결과의 신선도를 본다(채팅 카드 R6과 같은 판정 — 나들이는 위치를
    /// 계속 받고 있어 따로 측위를 기다리지 않는다). 신선하고 수동 위치 조회가 아니면 그 경로로 시작하고, 아니면 시작하지 않고
    /// 길찾기 탭에서 기기 위치로 다시 조회한다(사유는 조회 시작 때 한 번).
    private func transitStart(
        route: TransitRoute, transit: RouteStartChatPayload.Transit, accessible: Bool
    ) -> GuideSession.OutingHandoverStart {
        let freshness = journeyCardFreshness(
            origin: transit.origin, queriedAtMs: transit.queriedAt,
            fix: model.lastFix.map { RoutePoint(lat: $0.lat, lng: $0.lng) }, nowMs: Date().timeIntervalSince1970 * 1000)
        guard freshness == .fresh, !transit.manualOrigin else {
            return .directions(notice: appLocalized("journey.cardStaleRequery"))
        }
        return .guide(.transit(route: route, accessible: accessible))
    }

    private func waypoint(_ payload: RouteStartChatPayload) -> BeaconModel.Waypoint? {
        payload.via.map { BeaconModel.Waypoint(dest: BeaconDest(lat: $0.lat, lng: $0.lng), label: $0.label) }
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
