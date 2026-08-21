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
    /// 장소 상세 앵커(스펙 2026-08-12 §2) — 모델은 라벨만 알므로 탭의
    /// trackedDestination 좌표를 받는다. nil이면 상세 시트는 열리지 않는다.
    let detailDest: BeaconDest?
    /// 목적지 전환 확정 통보(스펙 §5) — 후보 선택으로 세션이 실제 교체됐을 때만.
    let onDestinationCommitted: (DirectionsEndpoint) -> Void

    @Environment(\.dismiss) private var dismiss
    /// 목적지 검색 시트(스펙 §4.1 1단) — 열린 동안 통지·톤 억제(받아쓰기 마이크).
    @State private var changeDestPresented = false
    /// 장소 상세 시트(스펙 §2) — 안내 신호 유지(억제 없음).
    @State private var showPlaceDetail = false
    /// 후보 항목 착지 — 항목 정체성 = routeKey(Bool equals 금지 정본).
    @AccessibilityFocusState private var focusedDestChangeRoute: String?
    private static let destChangeStatusId = "transit-dest-change-status"
    /// 시트 고정 컨트롤의 착지 대상(A19, 2026-08-22). 종전엔 컨트롤마다 `Bool`
    /// 바인딩이 따로 있어, 사라진 버튼의 `true`가 남은 채 새 대상에 `true`를 대입하면
    /// 둘이 경합해 대입이 조용히 되돌아갔다(실승차 `reboardPromptFocus landed=false`
    /// 2/2). 옵셔널 단일 바인딩은 "다른 바인딩을 먼저 놓는다"를 구조로 만든다
    /// (`SearchView.applyRowFocus`의 교훈). 후보·경로 목록은 정체성 바인딩을 따로 둔다.
    enum SheetControl: Hashable {
        case stop, advance, changeBoarding, confirmBoarded, walkHandoff, waitingLabel, reboardPrompt
        /// 목적지 전환 후보 상태 행(조회 중·0건·오류, 스펙 §4.4).
        case destChangeStatus
    }
    @AccessibilityFocusState private var focusedControl: SheetControl?
    /// 포커스가 얹힌 후보의 정체성(항목 정체성 옵셔널 바인딩 — Bool equals 금지 정본).
    @AccessibilityFocusState private var focusedCandidate: String?
    /// 진행 중인 컨트롤 착지 작업 — 새 착지·국면 전이가 먼저 취소한다(지연 착지가
    /// 국면 전이를 추월해 사라진 컨트롤을 좇는 경로 차단, 설계 리뷰 M8).
    @State private var controlFocusTask: Task<Void, Never>?
    /// 경유역 목록 펼침(§14.1) — leg가 바뀌면 접는다(다음 구간의 목록은 다른 목록).
    @State private var viaExpanded = false

    private static let waitingLabelId = "transit-waiting-label"
    private static let reboardPromptId = "transit-reboard-prompt"

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if model.state != nil {
                    Section {
                        Button(appLocalized("beacon.stop"), action: onStop)
                            .accessibilityFocused($focusedControl, equals: .stop)
                        Button(appLocalized("guide.progressButton")) { model.announceProgress() }
                        statusRows
                        viaStopsRows
                        phaseControls(proxy: proxy)
                    } header: {
                        // 제목이 곧 목적지 메뉴다(스펙 2026-08-12 §1). 핸드오프 화면
                        // 헤더는 불변 — 세션이 끝나 목적지 바꾸기가 성립하지 않는다.
                        GuideTitleMenu(
                            heading: appLocalized("beacon.transitHeading"),
                            label: model.destinationLabel,
                            onShowDetail: { showPlaceDetail = true },
                            onChangeDestination: { changeDestPresented = true })
                    }
                    destChangeSection(proxy: proxy)
                } else if let handoff = model.pendingWalkHandoff {
                    walkHandoffSection(handoff)
                }
            }
            .task { landControlFocus(.stop, proxy: proxy) }
            .onChange(of: model.state?.legIndex) { viaExpanded = false }
            // 완료 전이(세션 소거 + 핸드오프 제안): 사라진 "다음 구간" 대신 다음
            // 행동(도보 안내 시작)으로 선점(헌장 §5, arrived 전이와 동형 패턴).
            .onChange(of: model.pendingWalkHandoff) { _, handoff in
                guard handoff != nil, onWalkHandoff != nil else { return }
                landControlFocus(.walkHandoff, proxy: proxy)
            }
            .onChange(of: model.state?.phase) { previous, phase in
                // 국면이 바뀌면 진행 중 착지는 낡은 대상을 좇는다 — 먼저 끊는다.
                controlFocusTask?.cancel()
                // arrived 진입 시 "다음 구간"으로 선점(사라진 컨트롤 대신 다음 행동,
                // 헌장 §5).
                if phase == .arrived {
                    landControlFocus(.advance, proxy: proxy)
                    return
                }
                // 차량 선택(waiting→boarding): 누른 후보 행이 사라진다 — 다음 행동인
                // "탑승했습니다"로 선점(N3).
                if phase == .boarding, previous == .waiting {
                    landControlFocus(.confirmBoarded, proxy: proxy)
                    return
                }
                // 탑승 계열 전이(waiting·boarding→riding)는 포커스를 쥔 컨트롤을 통째로
                // 제거한다 — riding 컨트롤로 선점(헌장 §5, 감사 M2). arrived→riding
                // 자동 복귀(backOnTrack)는 사용자 행동이 아니라 제외.
                if phase == .riding, previous == .waiting || previous == .boarding {
                    if model.state?.lock.map(isApproxTransitLock) == true {
                        landControlFocus(.advance, proxy: proxy)
                    } else {
                        landControlFocus(.changeBoarding, proxy: proxy)
                    }
                }
            }
            // 목적지 검색(스펙 §4.1 1단): 선택은 아직 아무것도 확정하지 않는다 —
            // 사이드 채널 후보 조회만 시작한다(취소 시 전체 무효).
            .sheet(isPresented: $changeDestPresented) {
                DirectionsEndpointSearchView(target: .to) { endpoint in
                    guard case .place(let label, let lat, let lng) = endpoint else { return }
                    model.prepareDestinationChange(
                        dest: BeaconDest(lat: lat, lng: lng), label: label)
                }
            }
            .onChange(of: changeDestPresented) { _, presented in
                // 검색 시트에 받아쓰기 마이크가 있다 — 열린 동안 통지·톤 억제(스펙 §5.4).
                model.outputSuppressed = presented
                // 시트가 닫히고 전환이 준비 중이면 상태 행 착지(스펙 §4.4).
                if !presented, model.pendingDestChange != nil {
                    landDestChangeStatusFocus(proxy)
                }
            }
            .onChange(of: model.pendingDestChange?.phase) { _, phase in
                guard let phase else { return }
                switch phase {
                case .loaded(let result):
                    landFirstDestChangeRouteFocus(proxy, result: result)
                case .empty, .failed:
                    // 조회 중 행이 사라지는 전이(헌장 §5) — 같은 자리 문구 행에 착지.
                    landDestChangeStatusFocus(proxy)
                case .loading:
                    break  // 검색 시트 닫힘 onChange가 이미 착지를 맡았다
                }
            }
            // 장소 상세(스펙 §2): 표준 중첩 시트, 안내 신호 유지. 길찾기 진입 버튼은
            // 숨긴다(이미 그곳으로 안내 중).
            .sheet(isPresented: $showPlaceDetail) {
                if let dest = detailDest {
                    NavigationStack {
                        PlaceDetailView(
                            place: guideDestinationPlace(dest: dest, label: model.destinationLabel),
                            showsDirectionsEntry: false)
                    }
                }
            }
        }
    }

    /// 새 경로 후보 섹션(스펙 §4). 확정 전이라 메인 컨트롤(옛 목적지 안내)은 그대로
    /// 남는다 — 중간 상태를 만들지 않는 것이 계약이고, 두 섹션 공존이 그 표현이다.
    @ViewBuilder private func destChangeSection(proxy: ScrollViewProxy) -> some View {
        if let pending = model.pendingDestChange {
            Section {
                switch pending.phase {
                case .loading:
                    Text(appLocalized("ios.transitGuide.destChangeLoading"))
                        .accessibilityFocused($focusedControl, equals: .destChangeStatus)
                        .id(Self.destChangeStatusId)
                case .empty:
                    // 3-state: 경로 없음 ≠ 조회 실패. 출구는 취소뿐(재시도는 메뉴 재진입).
                    Text(appLocalized("ios.transitGuide.destChangeNone"))
                        .accessibilityFocused($focusedControl, equals: .destChangeStatus)
                        .id(Self.destChangeStatusId)
                case .failed:
                    Text(appLocalized("ios.transitGuide.destChangeError"))
                        .accessibilityFocused($focusedControl, equals: .destChangeStatus)
                        .id(Self.destChangeStatusId)
                case .loaded(let result):
                    ForEach(transitRouteEntries(result), id: \.route.routeKey) { entry in
                        // 후보 선택 = 확정(§4.1 2단). 라벨은 결과 목록과 같은 조립
                        // (이름+요약)이라 VO 로터에서 같은 것으로 들린다.
                        Button(joinText(entry.name, transitSummaryText(entry.route.summary))) {
                            if model.commitDestinationChange(entry.route) {
                                onDestinationCommitted(.place(
                                    label: pending.label,
                                    lat: pending.dest.lat, lng: pending.dest.lng))
                                landControlFocus(.stop, proxy: proxy)
                            } else {
                                // stale 재조회(§4.2) — 선택 행들이 사라지고 조회 중
                                // 상태 행으로 돌아간다(헌장 §5 선점).
                                landDestChangeStatusFocus(proxy)
                            }
                        }
                        .accessibilityFocused($focusedDestChangeRoute, equals: entry.route.routeKey)
                    }
                }
                Button(appLocalized("ios.transitGuide.destChangeCancel")) {
                    model.cancelDestinationChange()
                    landControlFocus(.stop, proxy: proxy)
                }
            } header: {
                Text(appLocalized("ios.transitGuide.destChangeHeading", pending.label))
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }

    /// 상태 행 착지 — 공용 정본 시퀀스.
    private func landDestChangeStatusFocus(_ proxy: ScrollViewProxy) {
        landControlFocus(.destChangeStatus, proxy: proxy)
    }

    /// 첫 후보 착지(스펙 §4.4) — 도착 통지는 내지 않는다(착지 낭독이 첫 후보를 읽는다).
    private func landFirstDestChangeRouteFocus(_ proxy: ScrollViewProxy, result: TransitRouteResult) {
        guard let first = transitRouteEntries(result).first?.route.routeKey else { return }
        Task { @MainActor in
            proxy.scrollTo(first)
            try? await Task.sleep(for: .milliseconds(400))
            focusedDestChangeRoute = first
            try? await Task.sleep(for: .milliseconds(600))
            guard focusedDestChangeRoute != first else { return }
            focusedDestChangeRoute = first
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
                    .accessibilityFocused($focusedControl, equals: .walkHandoff)
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
            } else if state.phase == .boarding {
                // 차량을 골랐고 승차 정류소 도착을 기다린다(N3). 탈출은 사용자 선언
                // ("탑승했습니다")과 재선택("다른 차량 선택") 둘 — 목록은 보이지 않는다.
                Button(appLocalized("transitGuide.confirmBoarded")) { model.confirmBoarded() }
                    .accessibilityFocused($focusedControl, equals: .confirmBoarded)
                Button(appLocalized("transitGuide.reselectVehicle")) { model.changeBoarding() }
            } else {
                // 근사 잠금은 advance 상시(§13.2 소비 한계 — arrived 전이가 없다).
                if state.phase == .arrived || (state.lock.map(isApproxTransitLock) ?? false) {
                    Button(appLocalized("transitGuide.advance")) { model.advance() }
                        .accessibilityFocused($focusedControl, equals: .advance)
                }
                if state.phase == .riding, leg.trackMode != .tagoBus {
                    if model.reboardPickerActive {
                        reboardStationPicker(leg: leg, proxy: proxy)
                    } else {
                        Button(appLocalized("transitGuide.changeBoarding")) { model.beginReboard() }
                            .accessibilityFocused($focusedControl, equals: .changeBoarding)
                    }
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
                .accessibilityFocused($focusedControl, equals: .waitingLabel)
                .id(Self.waitingLabelId)
                // 목록 포커스 소실 복귀(§13.4, 헌장 §5): 폴링 갱신으로 포커스가 얹힌
                // 항목이 사라지면 라벨로 선점 복귀(목록 밖 포커스는 강탈 금지).
                .onChange(of: rows.map(\.id)) { _, ids in
                    guard let focused = focusedCandidate, !ids.contains(focused) else { return }
                    landControlFocus(.waitingLabel, proxy: proxy, note: "lost=\(focused)")
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
    /// 역 재선택 단계(A16 L3) — 갈아탄 뒤 지금 있는 역을 묻는다.
    ///
    /// ⚠ 위치가 아니라 목록인 근거(위원장 판정): 지하철 안에서는 GPS가 잡히지
    /// 않는다. 역 이름은 안내방송으로 사용자가 이미 아는 정보라 목록이 지하·지상
    /// 무관하게 항상 성립한다.
    @ViewBuilder private func reboardStationPicker(
        leg: TransitGuideLeg, proxy: ScrollViewProxy
    ) -> some View {
        Text(appLocalized("transitGuide.reboardStationPrompt"))
            .accessibilityAddTraits(.isHeader)
            .accessibilityFocused($focusedControl, equals: .reboardPrompt)
            .id(Self.reboardPromptId)
            .task { landControlFocus(.reboardPrompt, proxy: proxy) }
        // 항목 정체성은 순번(웹은 순번+이름 복합) — 동명 정차가 있어도 행이 합쳐지지
        // 않는다. 두 표기가 다르지만 고유성은 양쪽 다 순번이 보장한다.
        ForEach(Array(leg.viaStops.enumerated()), id: \.offset) { _, stop in
            Button(stop.name) { model.changeBoarding(at: stop.name) }
        }
        Button(appLocalized("transitGuide.reboardCancel")) {
            model.cancelReboard()
            landControlFocus(.changeBoarding, proxy: proxy)
        }
    }

    /// 컨트롤 착지 정본 시퀀스(`CLAUDE.md` "iOS 목록 포커스 이동"): 직전 착지 취소 →
    /// 경합 바인딩 해제 → 가시화(scrollTo) → 지연 → 대상 존재 재검증 → 대입 → 검증 →
    /// 재가시화 → 재대입 → 로그. **동기 대입 한 줄은 실패한다** — List 오프스크린 행은
    /// AX 컬링으로 대입이 조용히 되돌아가는 실기기 확정 함정이고, 종전 구현은 재시도에서
    /// 가시화를 다시 하지 않았다(A19 실승차 2/2 실패). 로그는 착지 결과까지 남긴다.
    private func landControlFocus(_ target: SheetControl, proxy: ScrollViewProxy, note: String = "") {
        controlFocusTask?.cancel()
        controlFocusTask = Task { @MainActor in
            // 경합 바인딩 해제(설계 리뷰 M7) — 후보·경로 정체성 바인딩이 사라진 항목을
            // 계속 가리키면 새 대상 대입과 경쟁한다.
            focusedCandidate = nil
            focusedDestChangeRoute = nil
            scrollTo(target, proxy)
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled, controlExists(target) else { return }
            focusedControl = target
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            if focusedControl != target, controlExists(target) {
                scrollTo(target, proxy)
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                focusedControl = target
                try? await Task.sleep(for: .milliseconds(400))
            }
            transitGuideLog(
                "controlFocus target=\(target) landed=\(focusedControl == target)"
                    + " actual=\(focusedControl.map { "\($0)" } ?? "nil")"
                    + (note.isEmpty ? "" : " \(note)"))
        }
    }

    private func scrollTo(_ target: SheetControl, _ proxy: ScrollViewProxy) {
        switch target {
        case .waitingLabel: proxy.scrollTo(Self.waitingLabelId)
        case .reboardPrompt: proxy.scrollTo(Self.reboardPromptId)
        case .destChangeStatus: proxy.scrollTo(Self.destChangeStatusId)
        default: break  // 섹션 상단 버튼들은 List 첫 화면 안이라 가시화 불필요
        }
    }

    /// 대상이 현재 국면에 렌더되는지(지연 중 국면이 바뀌었으면 대입하지 않는다).
    private func controlExists(_ target: SheetControl) -> Bool {
        let phase = model.state?.phase
        switch target {
        case .stop: return model.state != nil
        case .advance: return phase == .arrived
            || (phase == .riding && (model.state?.lock.map(isApproxTransitLock) ?? false))
        case .changeBoarding: return phase == .riding && !model.reboardPickerActive
        case .confirmBoarded: return phase == .boarding
        case .walkHandoff: return model.pendingWalkHandoff != nil
        case .waitingLabel: return phase == .waiting
        case .reboardPrompt: return phase == .riding && model.reboardPickerActive
        case .destChangeStatus:
            if case .loaded = model.pendingDestChange?.phase { return false }
            return model.pendingDestChange != nil
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
            // 라벨은 "선택"이다(N3) — 탑승 여부는 앱이 승차 정류소 도착으로 판정한다.
            // 선택 차량 설명은 폴마다 바뀌는 완성 문장을 뺀 안정 조각(행선·방향)만.
            Button(appLocalized(
                leg.mode == "subway" ? "transitGuide.selectTrain" : "transitGuide.selectBus", desc
            )) {
                model.board(item: item, description: joinText(
                    item.destinationName.map { appLocalized("transitGuide.bound", $0) } ?? "",
                    item.direction))
            }
        }
    }

}
