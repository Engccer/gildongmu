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
    /// 마지막 leg의 단일 버튼 "남은 도보 안내 시작"(E34, spec 2026-09-11 §4.3)이 leg 종료 뒤 부르는 인계
    /// (`GuideSession.acceptWalkHandoff`). nil이면 종전 [다음 구간](세션 시작 뒤엔 nil이 되는 경로가 없다).
    let onWalkHandoff: (() -> Void)?
    /// 장소 상세 앵커(스펙 2026-08-12 §2) — 모델은 라벨만 알므로 탭의
    /// trackedDestination 좌표를 받는다. nil이면 상세 시트는 열리지 않는다.
    let detailDest: BeaconDest?
    /// 목적지 전환 확정 통보(스펙 §5) — 후보 선택으로 세션이 실제 교체됐을 때만.
    let onDestinationCommitted: (DirectionsEndpoint) -> Void
    /// 최소화(N1) — 루트가 `isMinimized`를 올린다.
    let onMinimize: () -> Void

    /// 목적지 검색 시트(스펙 §4.1 1단) — 열린 동안 통지·톤 억제(받아쓰기 마이크).
    @State private var changeDestPresented = false
    /// 장소 상세 시트(스펙 2026-08-12 §2 + E33) — 안내 신호 유지(억제 없음). 목적지(제목 메뉴)와
    /// 지하철 경유역(경유역 행·상태 문장 언급)이 **같은 중첩 시트 하나**를 지난다(`.sheet(item:)`).
    /// ⚠ N1 M3가 기각한 것은 반대 방향(장소 상세가 떠 있는데 루트 안내 시트를 올리기)이다 —
    /// 안내 시트 위 장소 상세는 현행 정본(spec 2026-09-11 §1.2).
    @State private var detailPlace: Place?
    /// 후보 항목 착지 — 항목 정체성 = routeKey(Bool equals 금지 정본).
    @AccessibilityFocusState private var focusedDestChangeRoute: String?
    /// 시트 고정 컨트롤의 착지 대상(A19, 2026-08-22). 종전엔 컨트롤마다 `Bool`
    /// 바인딩이 따로 있어, 사라진 버튼의 `true`가 남은 채 새 대상에 `true`를 대입하면
    /// 둘이 경합해 대입이 조용히 되돌아갔다(실승차 `reboardPromptFocus landed=false`
    /// 2/2). 옵셔널 단일 바인딩은 "다른 바인딩을 먼저 놓는다"를 구조로 만든다
    /// (`SearchView.applyRowFocus`의 교훈). 후보·경로 목록은 정체성 바인딩을 따로 둔다.
    enum SheetControl: Hashable {
        case advance, changeBoarding, confirmBoarded, waitingLabel, reboardPrompt
        /// [이미 탑승했습니다] — "이미 탑승" 흐름의 역 선택 취소가 돌아오는 자리(A34 ②, riding 취소의 `.changeBoarding` 동형).
        case boardAlready
        /// 급행 확인 프롬프트 헤딩(§6) — 펼친 직후 착지.
        case expressPrompt
        /// 급행 거절 상시 문장(§6) — 프롬프트 버튼이 사라진 자리의 착지.
        case expressBlocked
        /// 제목 행(제목 메뉴) — 시트 진입 기본 착지이자 사라지는 컨트롤의 복귀 앵커(항상
        /// 존재). 종전 앵커였던 중지는 최하단 고정으로 내려갔다(위원장 판정 2026-08-23).
        case title
        /// 접기 버튼(N1, 헤더 행 우측 아이콘) — 띠바에서 돌아온 시트의 첫 착지.
        case minimize
        /// 목적지 전환 후보 상태 행(조회 중·0건·오류, 스펙 §4.4).
        case destChangeStatus
    }
    @AccessibilityFocusState private var focusedControl: SheetControl?
    /// 착지 대상 중 지금 List에 **실현된** 것(A35 spec §4.1 ①). `landingTarget`의 onAppear/onDisappear가
    /// 유지한다 — List는 lazy라 화면 밖 행은 실현되지 않고 AX 트리에도 없다. 착지 헬퍼는 대입 전에
    /// 이것을 기다리고, 실패 사유(`notRendered`/`stolen`)를 이것으로 가른다.
    /// ⚠ **관찰 대상이 아닌 참조 상자**다(설계 리뷰 L2): `@State Set`이면 스와이프로 행이 실현 창을 드나들 때마다
    /// 시트 전체가 재렌더돼 고치려는 결함(포커스 흔들림)과 같은 계열이 된다. 착지 Task는 값을 읽기만 한다.
    /// **참조 카운트**인 이유(L3): 같은 대상이 뷰 둘로 교체될 때(전환 상태 3형·픽커 두 호출부) SwiftUI가 새 뷰의
    /// onAppear와 옛 뷰의 onDisappear 순서를 보장하지 않아 Set이면 화면에 있는데 빠질 수 있다.
    @State private var rendered = RenderedControls()
    /// 백그라운드에서 난 국면 전이의 착지 대상(A35 L4). VO 커서가 없는 배경에서 시도하지 않고 여기 적어 두었다가
    /// 전경 복귀에 한 번 착지한다(latest-wins). 시트 `.task`는 재표시에만 돌아 이 자리를 대신하지 못한다.
    @State private var deferredLanding: SheetControl?
    @Environment(\.scenePhase) private var scenePhase
    /// 포커스가 얹힌 후보의 정체성(항목 정체성 옵셔널 바인딩 — Bool equals 금지 정본).
    @AccessibilityFocusState private var focusedCandidate: String?
    /// 진행 중인 컨트롤 착지 작업 — 새 착지·국면 전이가 먼저 취소한다(지연 착지가
    /// 국면 전이를 추월해 사라진 컨트롤을 좇는 경로 차단, 설계 리뷰 M8).
    @State private var controlFocusTask: Task<Void, Never>?
    /// 경유역 목록 펼침(§14.1) — leg가 바뀌면 접는다(다음 구간의 목록은 다른 목록).
    @State private var viaExpanded = false
    /// 진행 상황 조망(E15-1 spec §4.3). 어댑터는 열 때마다 새로 만든다 — 침묵 행 래치가
    /// 조망 수명이라서(§4.1).
    @State private var overviewAdapter: TransitOverviewAdapter?
    /// "닫힌 뒤 행동" 계약(§4.3): 조망이 열린 채 국면이 바뀌거나 조망 안 행동이 조망을
    /// 떠나야 할 때, 행동·착지는 여기 적어 두었다가 조망 `onDismiss`에서 한 곳이 실행한다.
    /// 단일 슬롯 latest-wins — 전이가 겹치면 마지막 전이의 착지가 맞다. ⚠ 모달 뒤의
    /// 컨트롤에 착지하면 조용히 되돌아가고(`showOverview = false`는 dismiss 완료가
    /// 아니다), 조망이 열린 채 `beginReboard()`를 부르면 부모 waiting 착지와 프롬프트
    /// 착지가 경쟁한다(설계 리뷰 F2·F4).
    enum OverviewFollowUp: Equatable {
        case land(SheetControl)
        case beginReboard
        case routeSwitched
    }
    @State private var pendingFollowUp: OverviewFollowUp?

    /// 급행 확인 프롬프트 표시(spec 2026-09-02 §6) — "이미 탑승했습니다" 뒤, 급행 집합이 있는 노선만.
    @State private var expressPromptActive = false

    var body: some View {
        // 접기 버튼은 섹션 헤더(제목 메뉴) 행 우측 아이콘(BeaconTrackingSheet 동형,
        // 위원장 판정 2026-08-23).
        sheetBody
    }

    private var sheetBody: some View {
        ScrollViewReader { proxy in
            List {
                if model.state != nil {
                    Section {
                        // 조망 모달이 응답이다(도보 동형). `announceProgress()`를 부르지 않는다 —
                        // 헤더 착지가 같은 문장을 낭독하므로 통지를 먼저 내면 둘이 잠식한다(§4.3).
                        Button(appLocalized("guide.progressButton")) {
                            overviewAdapter = TransitOverviewAdapter(model: model)
                            transitGuideLog("overview open adapter=\(overviewAdapter != nil)")
                        }
                        statusRows
                        viaStopsRows
                        phaseControls(proxy: proxy)
                    } header: {
                        // 제목이 곧 목적지 메뉴다(스펙 2026-08-12 §1).
                        GuideTitleRow {
                            landingTarget(GuideTitleMenu(
                                heading: appLocalized("beacon.transitHeading"),
                                label: model.destinationLabel,
                                onShowDetail: {
                                    if let dest = detailDest {
                                        detailPlace = guideDestinationPlace(dest: dest, label: model.destinationLabel)
                                    }
                                },
                                onChangeDestination: { changeDestPresented = true }), .title)
                        } trailing: {
                            landingTarget(GuideMinimizeButton(action: onMinimize), .minimize)
                        }
                    }
                    surroundingsSection(proxy: proxy)
                    destChangeSection(proxy: proxy)
                }
                // ⚠ 인계 제안 화면("대중교통 구간이 끝났습니다…" + 시작·닫기)은 2026-09-11 E34로 삭제됐다 —
                // 마지막 leg의 버튼이 곧 인계라 도달 경로가 없다(`onWalkHandoff`는 세션 시작 뒤 항상 non-nil).
            }
            // 안내 종료는 목록 밖 최하단 고정(GuideStopButton 주석).
            .safeAreaInset(edge: .bottom) {
                if model.state != nil {
                    GuideStopButton(action: onStop)
                }
            }
            // 띠바에서 돌아온 경우 첫 착지는 최소화 버튼(떠난 자리, 설계 리뷰 m1).
            .task {
                if GuideSession.shared.returnedFromBand == .transit {
                    GuideSession.shared.returnedFromBand = nil
                    landControlFocus(.minimize, proxy: proxy)
                } else {
                    landControlFocus(.title, proxy: proxy)
                }
            }
            .onChange(of: model.state?.legIndex) { viaExpanded = false }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, let target = deferredLanding else { return }
                deferredLanding = nil
                landControlFocus(target, proxy: proxy, note: "deferred")
            }
            // 역 선택 화면 착지(A35 §4.1 ③): 트리거는 **화면이 열리는 상태 변화**다. 종전엔 프롬프트 헤딩 자체의
            // `.task`가 불렀는데, 헤딩이 경유역 목록 아래라 실현되지 않으면 시도 자체가 없었다(로그에 남는
            // 시도는 실현된 것만 — 표본 편향). 두 흐름(승차 중 탑승 변경·이미 탑승 pickStation) 공용.
            .onChange(of: model.reboardPickerActive) { _, active in
                if active { landControlFocus(.reboardPrompt, proxy: proxy) }
            }
            .onChange(of: model.aboardStep) { _, step in
                if step == .pickStation { landControlFocus(.reboardPrompt, proxy: proxy) }
            }
            // 급행 확인 프롬프트(§6)는 연 국면 세대에 묶인다 — 경로 교체(waiting→waiting)도 세대가 바뀐다(코드 리뷰 #4).
            .onChange(of: model.state?.phaseGen) { expressPromptActive = false }
            .onChange(of: model.state?.phase) { previous, phase in
                // 국면이 바뀌면 진행 중 착지는 낡은 대상을 좇는다 — 먼저 끊는다.
                controlFocusTask?.cancel()
                // 급행 확인 프롬프트는 대기 국면 전용(§6) — 국면이 바뀌면 접는다.
                expressPromptActive = false
                // 세션 종료(state nil)도 여기로 온다(.some → nil 변화) — 조망을 닫는다.
                let target = phaseTransitionLanding(previous: previous, phase: phase)
                // 조망이 열려 있으면 그 행·행동은 낡았다 — 닫고, 착지는 onDismiss로 미룬다(§4.3).
                // 경로 전환이 만든 전이(→waiting)도 여기로 온다: 전환 뒤 착지는 새 세션의
                // 전이 착지(대기 라벨)가 정본이고, 전이 착지가 없을 때만 중지 버튼
                // (메뉴 경유 목적지 전환도 같은 덮임 — spec §7).
                if overviewAdapter != nil {
                    if let target { pendingFollowUp = .land(target) }
                    overviewAdapter = nil
                    return
                }
                if let target { landControlFocus(target, proxy: proxy) }
            }
            // 진행 상황 조망(E15-1). 닫힌 뒤 한 곳에서 행동·착지(닫힌 뒤 행동 계약).
            .sheet(item: $overviewAdapter, onDismiss: { runPendingFollowUp(proxy: proxy) }) { adapter in
                GuideOverviewSheet(capability: adapter) { followUp in
                    pendingFollowUp = switch followUp {
                    case .beginReboard: .beginReboard
                    case .routeSwitched: .routeSwitched
                    }
                }
            }

            // 목적지 검색(스펙 §4.1 1단): 선택은 아직 아무것도 확정하지 않는다 —
            // 사이드 채널 후보 조회만 시작한다(취소 시 전체 무효).
            .sheet(isPresented: $changeDestPresented) {
                DirectionsEndpointSearchView(target: .to) { endpoint in
                    guard case .place(let label, let lat, let lng, _) = endpoint else { return }
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
            // 장소 상세(스펙 §2·E33): 표준 중첩 시트, 안내 신호 유지. 길찾기 진입 버튼은 숨긴다 —
            // 목적지는 이미 그곳으로 안내 중이고, 경유역은 시트 뒤 길찾기 폼을 조작해 보이지 않는 상태
            // 변화를 만든다(같은 게이트라 "여기로 목적지 변경"도 숨는다 — 그 일은 제목 메뉴가 맡는다).
            // 닫힌 뒤 VO 커서 복원은 시스템 몫(표시 직전 요소) — 별도 착지 코드 없음(실기기 판정 §7 ②).
            .sheet(item: $detailPlace) { place in
                NavigationStack {
                    PlaceDetailView(place: place, showsDirectionsEntry: false)
                }
            }
        }
    }

    /// 주변 확인(E15-2, spec 2026-08-23-transit-surroundings-anchor §4). 앵커는 Kit 판정
    /// (`transitSurroundingsAnchor`) — 조망 `here`가 역으로 확정됐을 때만 현재역, 그 밖은
    /// 하차역. 도보 시트와 달리 앵커가 둘 중 하나로 바뀌므로 **어느 역 주변인지가 곧
    /// 정보**라 헤더가 그 역을 말한다. 본 Section 뒤에 두는 이유: 대기 후보·탑승 변경
    /// 같은 자주 쓰는 컨트롤 앞에 끼우면 SR 읽기 순서 비용이 커진다. 하차역 좌표가
    /// 없으면(정차역 목록 미보유) 섹션 자체를 내지 않는다. 앵커가 바뀌면
    /// `SurroundingsSceneSection`의 `onChange(of: anchorKey)`가 지난 역 장면을 버린다.
    @ViewBuilder private func surroundingsSection(proxy: ScrollViewProxy) -> some View {
        if let state = model.state, let leg = model.currentLeg,
           let anchor = transitSurroundingsAnchor(state: state, leg: leg) {
            Section {
                SurroundingsSceneSection(
                    anchor: (lat: anchor.stop.lat, lng: anchor.stop.lng), proxy: proxy)
            } header: {
                Text(surroundingsHeading(anchor))
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }

    private func surroundingsHeading(_ anchor: TransitSurroundingsAnchor) -> String {
        switch anchor {
        case let .currentStation(s): appLocalized("transitGuide.surroundingsAnchorCurrent", s.name)
        case let .alightStop(s): appLocalized("transitGuide.surroundingsAnchorAlight", s.name)
        }
    }

    /// 새 경로 후보 섹션(스펙 §4). 확정 전이라 메인 컨트롤(옛 목적지 안내)은 그대로
    /// 남는다 — 중간 상태를 만들지 않는 것이 계약이고, 두 섹션 공존이 그 표현이다.
    @ViewBuilder private func destChangeSection(proxy: ScrollViewProxy) -> some View {
        if let pending = model.pendingDestChange {
            Section {
                switch pending.phase {
                case .loading:
                    landingTarget(Text(appLocalized("ios.transitGuide.destChangeLoading")), .destChangeStatus)
                case .empty:
                    // 3-state: 경로 없음 ≠ 조회 실패. 출구는 취소뿐(재시도는 메뉴 재진입).
                    landingTarget(Text(appLocalized("ios.transitGuide.destChangeNone")), .destChangeStatus)
                case .failed:
                    landingTarget(Text(appLocalized("ios.transitGuide.destChangeError")), .destChangeStatus)
                case .loaded(let result):
                    ForEach(transitRouteEntries(result), id: \.route.routeKey) { entry in
                        // 후보 선택 = 확정(§4.1 2단). 라벨은 결과 목록과 같은 조립
                        // (이름+요약)이라 VO 로터에서 같은 것으로 들린다.
                        Button(joinText(entry.name, transitSummaryText(entry.route.summary))) {
                            if model.commitDestinationChange(entry.route) {
                                onDestinationCommitted(.place(
                                    label: pending.label,
                                    lat: pending.dest.lat, lng: pending.dest.lng))
                                landControlFocus(.title, proxy: proxy)
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
                    landControlFocus(.title, proxy: proxy)
                }
            } header: {
                Text(appLocalized("ios.transitGuide.destChangeHeading", pending.label))
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }

    /// 국면 전이의 착지 대상(기존 분기 그대로): arrived→"다음 구간"(사라진 컨트롤 대신
    /// 다음 행동, 헌장 §5) / 탑승 변경·다른 차량 선택(→waiting)→대기 목록 라벨 / 차량
    /// 선택(waiting→boarding)→"탑승했습니다"(N3) / 탑승 계열(waiting·boarding→riding)→
    /// riding 컨트롤(감사 M2; arrived→riding 자동 복귀는 사용자 행동이 아니라 제외).
    private func phaseTransitionLanding(previous: TransitPhase?, phase: TransitPhase?) -> SheetControl? {
        if phase == .arrived { return .advance }
        if phase == .waiting, previous != nil, previous != .waiting { return .waitingLabel }
        if phase == .boarding, previous == .waiting { return .confirmBoarded }
        if phase == .riding, previous == .waiting || previous == .boarding {
            return model.state?.lock.map(isApproxTransitLock) == true ? .advance : .changeBoarding
        }
        return nil
    }

    /// 조망 `onDismiss` — 닫힌 뒤 행동 계약의 실행 지점(한 곳).
    private func runPendingFollowUp(proxy: ScrollViewProxy) {
        // 하위 시트가 열린 채 조망이 통째로 닫힌 경우 그 조회를 폐기(spec §5.2 — 늦은
        // 응답이 모델에 남지 않게).
        if let token = model.pendingAltRoutes?.token { model.cancelAltRoutes(token: token) }
        guard let followUp = pendingFollowUp else { return }
        pendingFollowUp = nil
        switch followUp {
        case let .land(target):
            landControlFocus(target, proxy: proxy)
        case .beginReboard:
            // 지하철은 `reboardPickerActive` 전이의 프롬프트 착지가, 버스는 waiting 전이의 waitingLabel 착지가 맡는다.
            model.beginReboard()
        case .routeSwitched:
            landControlFocus(.title, proxy: proxy)
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

    /// 경유역 목록 1단계(§14.1, 피드백 #3): 기보유 viaStops의 정적 표시 — 추가
    /// upstream 0회. 항목 무헤딩(도착편 관례)·단일 텍스트, 승차·하차 라벨과 현재
    /// 위치(arvlMsg3 매칭, 지하철 잠금 추적에서만)를 쉼표로 흡수. 펼침 시맨틱은
    /// DisclosureGroup이 정본(시뮬 무라벨 셰브런은 아티팩트 — 실기기 비문제).
    /// 단계 공개(더 보기) 비적용: 정적 텍스트라 절단 너머가 행동을 바꾸지 않는다.
    ///
    /// **지하철 leg의 각 행은 행 전체가 그 역의 장소 상세를 여는 버튼**(E33, 채팅 산문 선례 "언급 1개 =
    /// 블록 전체 버튼"). 라벨 뷰는 종전 단일 `Text` 그대로라 한 줄 = 한 객체가 유지되고, VO는
    /// "{역}, 승차, 버튼"으로 읽는다. 버스 leg는 종전 `Text`(정류장 상세는 범위 밖, spec §2).
    @ViewBuilder private var viaStopsRows: some View {
        if let state = model.state, let leg = model.currentLeg, !leg.viaStops.isEmpty {
            DisclosureGroup(isExpanded: $viaExpanded) {
                // ⚠ 현재역 인덱스 판정은 **조인**이라 한국어 원문으로 한다.
                let currentIndex = viaStopCurrentIndex(leg: leg, currentLocation: state.currentLocation)
                let display = model.displayLeg(leg, useOverride: false)
                // `display.stops`는 `leg.viaStops.map(stopLabel)`이라 인덱스가 1:1 — 상세 진입은 원본 stop(좌표·ID).
                ForEach(Array(display.stops.enumerated()), id: \.offset) { index, stop in
                    let isAlight = index == display.stops.count - 1
                    let line = Text(TransitGuideTextRenderer.render(transitViaStopLine(
                        isEn: transitGuideIsEn, stop: stop,
                        role: index == 0 ? "board" : isAlight ? "alight" : "via",
                        here: index == currentIndex,
                        // 하차역 행에 출구 번호 병기(E25) — 정적 표시, 통지 없음.
                        exit: isAlight ? display.exitAlight : nil)))
                    if leg.mode == "subway", leg.viaStops.indices.contains(index) {
                        Button {
                            openStationDetail(leg.viaStops[index], source: "via")
                        } label: {
                            line.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    } else {
                        line
                    }
                }
            } label: {
                Text(appLocalized(
                    leg.mode == "subway" ? "transitGuide.viaStopsTrain" : "transitGuide.viaStopsBus",
                    leg.viaStops.count
                ))
            }
        }
    }

    @ViewBuilder private var statusRows: some View {
        if let state = model.state, let leg = model.currentLeg {
            // 상시 표시(통지 채널 밖) — 통지와 같은 조립기 공유(§12.3: 완성 문장
            // 공백 연결, 쉼표 조립(joinText)은 이중 구두점을 만들어 폐기). 여전히
            // 한 줄 = 한 접근성 객체(단일 텍스트).
            let text = model.statusLineText(state: state, leg: leg)
            // 문장 안 역명은 산문이라 채팅 산문 선례의 **로터 액션** 갈래만 쓴다(E33): 언급 N개 = 커스텀 액션
            // "{역} 상세 보기" N개(역순 선언 = 등장 순 노출). 채팅의 "1개면 블록 전체 버튼"은 쓰지 않는다 — 이 문장은
            // 폴마다 바뀌어 언급 수가 오가고, 뷰 종류가 Button↔Text로 갈리면 포커스가 얹힌 줄이 15초마다 파괴·재생성
            // 된다(헌장 §5, 설계 리뷰 E2). 뷰는 언제나 같은 `Text`이고 액션 목록만 바뀐다. 시각 사용자는 경유역
            // 목록 행으로 같은 곳에 간다(정보 정본은 목록). 지하철 leg에서만 판정한다.
            let mentions = leg.mode == "subway" ? transitStationMentions(in: text, stops: leg.viaStops) : []
            let display = model.displayLeg(leg, useOverride: false)
            distanceText(text)
                .foregroundStyle(.secondary)
                // ⚠ 선언은 역순: VoiceOver 로터가 빌더 선언의 역순으로 노출된다(PlaceRow·채팅 실측).
                // 액션 라벨은 문장 계층(descriptor)을 지나 영문이 없으면 라벨 전체가 ko(설계 리뷰 E1).
                .accessibilityActions {
                    ForEach(Array(mentions.reversed()), id: \.self) { index in
                        Button(TransitGuideTextRenderer.render(
                            transitOpenStationLine(isEn: transitGuideIsEn, station: display.stops[index])
                        )) { openStationDetail(leg.viaStops[index], source: "status") }
                    }
                }
        }
    }

    /// 지하철 경유역의 장소 상세(E33): 좌표·ID·한국어 이름으로 곧장 연다(이름 재검색 없음). 사용자 조작이라
    /// 유휴 시계를 되돌린다(E36 `touchUserAction`).
    private func openStationDetail(_ stop: TransitLegStop, source: String) {
        model.touchUserAction()
        transitGuideLog("stationDetail open station=\(stop.name) source=\(source)")
        detailPlace = transitStopPlace(stop)
    }

    @ViewBuilder private func phaseControls(proxy: ScrollViewProxy) -> some View {
        if let state = model.state, let leg = model.currentLeg {
            if state.signal == .untrackable {
                Text(appLocalized("transitGuide.untrackable"))
                    .foregroundStyle(.secondary)
                // 마지막 leg면 라벨이 인계 자체(E34). 이 자리는 종전대로 착지 바인딩이 없다(A35 범위).
                Button(handoffNow
                    ? appLocalized("transitGuide.walkHandoffStart")
                    : appLocalized("transitGuide.advanceUntrackable")) { advanceOrHandoff() }
            } else if state.phase == .waiting {
                waitingList(leg: leg, previousLock: state.previousLock, proxy: proxy)
            } else if state.phase == .boarding {
                // 차량을 골랐고 승차 정류소 도착을 기다린다(N3). 탈출은 사용자 선언
                // ("탑승했습니다")과 재선택("다른 차량 선택") 둘 — 목록은 보이지 않는다.
                landingTarget(
                    Button(appLocalized("transitGuide.confirmBoarded")) { model.confirmBoarded() }, .confirmBoarded)
                Button(appLocalized("transitGuide.reselectVehicle")) { model.changeBoarding() }
            } else {
                // 근사 잠금은 advance 상시(§13.2 소비 한계 — arrived 전이가 없다).
                // 마지막 leg + 말미 도보면 버튼은 하나이고 라벨이 처음부터 "남은 도보 안내 시작"(E34) —
                // 한 번 누르면 leg 종료와 도보 시작이 함께. 착지 대상 정체성(`.advance`)은 불변.
                if state.phase == .arrived || (state.lock.map(isApproxTransitLock) ?? false) {
                    landingTarget(Button(advanceLabel) { advanceOrHandoff() }, .advance)
                }
                if state.phase == .riding, leg.trackMode != .tagoBus {
                    if model.reboardPickerActive {
                        // 승차 중 탑승 변경(A16 L3): 하차역이면 도착 선언(A37 ②), 그 밖은 그 역 기준 재선택.
                        stationPicker(
                            promptKey: reboardPromptKey, leg: leg, proxy: proxy,
                            onPick: { index in
                                if index == leg.viaStops.count - 1 {
                                    model.cancelReboard()
                                    model.declareArrived()
                                } else {
                                    model.changeBoarding(at: index)
                                }
                            },
                            onCancel: {
                                model.cancelReboard()
                                landControlFocus(.changeBoarding, proxy: proxy)
                            })
                    } else {
                        landingTarget(
                            Button(appLocalized("transitGuide.changeBoarding")) { model.beginReboard() }, .changeBoarding)
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
        } else if model.aboardStep == .pickStation {
            // "이미 탑승" 흐름 1단(A34 ②): 지나는 역을 묻는다 — 역 선택 화면 재사용, 질문만 전용 키
            // (목록이 성립하는 조건이 "내 열차가 그 역에 접근·정차·출발 중"이라 L3의 "지금 있는 역"과 다른 질문).
            stationPicker(
                promptKey: reboardPromptKey, leg: leg, proxy: proxy,
                onPick: { index in
                    expressPromptActive = false
                    model.pickAboardStation(at: index)
                    // 하차역이면 국면 전이 착지(arrived → .advance)가 맡는다.
                    if model.aboardStep == .pickVehicle { landControlFocus(.waitingLabel, proxy: proxy) }
                },
                onCancel: {
                    model.cancelAboard()
                    landControlFocus(.boardAlready, proxy: proxy)
                })
        } else {
            let aboardPicking = model.aboardStep == .pickVehicle
            let classified = classifyTransitBoardingCandidates(model.waitingCandidatesPool(), leg: leg)
            // 항목 정체성 = 차량·열차 식별자(폴링 갱신이 포커스를 흔들지 않게, §5.1).
            // vehId 없는 후보의 키를 완성 문장으로 두면 문장 갱신마다 remount되어
            // 포커스가 폴마다 튕긴다(감사 L2) — 슬롯 위치 폴백(웹 동형).
            let rows = classified.candidates.enumerated().map { index, candidate in
                (id: candidate.item.vehicleId.flatMap { $0.isEmpty ? nil : $0 } ?? "slot-\(index)",
                 candidate: candidate)
            }
            // pickVehicle 단계(A34 ②)는 라벨이 곧 질문("타고 계신 차량을 선택하세요") — 착지 낭독이 답한다.
            landingTarget(Text(waitingLabelText), .waitingLabel)
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
            // ⚠ 역명은 **표시 라벨**이다(E27 잔여 ①) — 조인 필드를 그대로 넣으면 영어 틀에
            // 한국어 역명이 섞인다(웹은 같은 자리를 이미 고쳤다). 영문이 없으면 문장 전체가
            // 한국어가 되도록 `lang`도 함께 ko로 내린다.
            if let quickExit = quickExitLine(leg) {
                Text(quickExit)
            }
            if classified.candidates.isEmpty {
                // 0건 사유 3-state(§13.3): 진짜 0건 / 필터 전멸 / 조회 실패. pickVehicle의 "그 역에 있는 열차가
                // 없다"(원 목록엔 후보가 있다)는 진짜 0건과 다른 상태라 따로 말한다(코드 리뷰 M3).
                let rawHasCandidates = aboardPicking && !classifyTransitBoardingCandidates(
                    model.waitingLive + model.waitingDeparted.map(\.item), leg: leg).candidates.isEmpty
                Text(rawHasCandidates
                    ? appLocalized("transitGuide.noCandidatesAboard")
                    : model.reasonText(model.waitingReason ?? TransitWaitingEmptyReason.none))
                    .foregroundStyle(.secondary)
            }
            ForEach(rows, id: \.id) { row in
                candidateRow(row.candidate, leg: leg)
                    .accessibilityFocused($focusedCandidate, equals: row.id)
            }
            // 대기 국면 탈출구(§13.2) + 탑승 변경 취소(§13.1).
            Button(appLocalized("transitGuide.refresh")) { model.refreshWaiting() }
            if aboardPicking {
                // 목록이 빌 때만 근사(비관측) 잠금으로(A34 판정) — 급행 집합 노선이면 급행 확인이 먼저.
                if classified.candidates.isEmpty {
                    Button(appLocalized("transitGuide.continueWithoutTrain")) { boardAlreadyOrAskExpress(leg, proxy: proxy) }
                }
                Button(appLocalized("transitGuide.pickAnotherStation")) {
                    expressPromptActive = false
                    model.pickAnotherAboardStation()
                    // 착지는 픽커 헤딩의 .task가 맡는다.
                }
            } else {
                // [이미 탑승했습니다]: 지하철은 역부터 묻고(A34 ②), 그 밖(서울버스)은 종전대로 곧장 잠금.
                landingTarget(Button(appLocalized("transitGuide.boardAlready")) {
                    if leg.trackMode == .subway, !leg.viaStops.isEmpty {
                        expressPromptActive = false
                        model.beginAboard()
                    } else {
                        boardAlreadyOrAskExpress(leg, proxy: proxy)
                    }
                }, .boardAlready)
            }
            if expressPromptActive {
                // 버튼으로 펼친 것이라 헤딩이 발견 경로(헌장 §3). 답하면 프롬프트는 사라지고 착지는 국면 전이
                // (riding → 다음 구간) 또는 거절 문장이 맡는다.
                landingTarget(
                    Text(appLocalized("transitGuide.expressPrompt")).accessibilityAddTraits(.isHeader),
                    .expressPrompt)
                Button(appLocalized("transitGuide.expressYes")) {
                    expressPromptActive = false
                    model.boardAlready(express: true)
                    // 거절이면 문장 행 착지(착지 낭독 = 답). 착지 실패 폴백(`.high` 통지)은 전 대상 공용(A35).
                    if model.expressBlockedNote != nil {
                        landControlFocus(.expressBlocked, proxy: proxy)
                    }
                }
                Button(appLocalized("transitGuide.expressNo")) {
                    expressPromptActive = false
                    model.boardAlready(express: false)
                }
            }
            if let note = model.expressBlockedNote {
                landingTarget(Text(note), .expressBlocked)
            }
            if previousLock != nil, !aboardPicking {
                Button(appLocalized("transitGuide.cancelChangeBoarding")) {
                    model.cancelChangeBoarding()
                }
            }
        }
    }

    /// 근사(비관측) 잠금 진입 — 급행 집합이 있는 노선만 급행 확인을 묻는다(§6), 없으면 즉시 잠금.
    /// [이미 탑승했습니다](서울버스)와 [열차 정보 없이 계속](지하철 pickVehicle 0건) 공용.
    private func boardAlreadyOrAskExpress(_ leg: TransitGuideLeg, proxy: ScrollViewProxy) {
        if transitNeedsExpressPrompt(leg) {
            expressPromptActive = true
            landControlFocus(.expressPrompt, proxy: proxy)
        } else {
            model.boardAlready()
        }
    }

    /// E34 조건: 마지막 leg ∧ 말미 도보 ∧ 인계 가능. 참이면 `advance` 자리 버튼이 "남은 도보 안내 시작".
    private var handoffNow: Bool {
        model.finalLegWalkMinutes != nil && onWalkHandoff != nil
    }

    // 착지 대상 라벨 셋 — 뷰와 착지 폴백(`landingFallbackText`)이 **같은 식**을 읽는다(둘로 적으면 드리프트한다).
    private var advanceLabel: String {
        handoffNow ? appLocalized("transitGuide.walkHandoffStart") : appLocalized("transitGuide.advance")
    }
    private var waitingLabelText: String {
        appLocalized(model.aboardStep == .pickVehicle ? "transitGuide.waitingLabelAboard" : "transitGuide.waitingLabel")
    }
    /// 역 선택 질문 키 — riding 픽커 "지금 어느 역에 계신가요?", waiting pickStation "지금 어느 역을 지나고 계신가요?".
    private var reboardPromptKey: String {
        model.aboardStep == .pickStation ? "transitGuide.aboardStationPrompt" : "transitGuide.reboardStationPrompt"
    }

    /// `advance` 자리 버튼의 동작 — E34면 leg 종료 뒤 **인계가 실제로 남았을 때만** 도보 시작을 부른다
    /// (전이가 no-op이면 세션을 끊지 않는다).
    private func advanceOrHandoff() {
        if handoffNow {
            if model.advanceIntoWalkHandoff() { onWalkHandoff?() }
        } else {
            model.advance()
        }
    }

    /// 라벨 복귀는 정본 시퀀스를 따른다(감사 M3): 가시화(scrollTo) → 지연 → 대입 →
    /// 검증 → 1회 재시도. List 오프스크린 행은 AX 컬링으로 대입이 조용히 되돌아가는
    /// 실기기 확정 함정이라 동기 대입 한 줄은 실패한다. 로그는 착지 결과까지 남긴다.
    /// 역 선택 화면 — 두 흐름이 재사용한다: 승차 중 탑승 변경(A16 L3, "지금 어느 역에 계신가요?")과
    /// "이미 탑승"(A34 ②, "지금 어느 역을 지나고 계신가요?"). 질문·선택 응답만 다르고 행·취소·착지는 같다.
    /// 마지막 행(하차역)은 두 흐름 모두 도착 선언이다(A37 ②).
    ///
    /// ⚠ 위치가 아니라 목록인 근거(위원장 판정): 지하철 안에서는 GPS가 잡히지
    /// 않는다. 역 이름은 안내방송으로 사용자가 이미 아는 정보라 목록이 지하·지상
    /// 무관하게 항상 성립한다.
    @ViewBuilder private func stationPicker(
        promptKey: String, leg: TransitGuideLeg, proxy: ScrollViewProxy,
        onPick: @escaping (Int) -> Void, onCancel: @escaping () -> Void
    ) -> some View {
        // 착지는 이 뷰가 아니라 화면이 열리는 상태 변화(`reboardPickerActive`·`aboardStep`)가 부른다(A35 §4.1 ③).
        landingTarget(Text(appLocalized(promptKey)).accessibilityAddTraits(.isHeader), .reboardPrompt)
        // 항목 정체성은 순번(웹은 순번+이름 복합) — 동명 정차가 있어도 행이 합쳐지지
        // 않는다. 두 표기가 다르지만 고유성은 양쪽 다 순번이 보장한다.
        // ⚠ **라벨은 표시(en 가능)이고 값은 인덱스**다 — 조회 쿼리는 모델이 인덱스로
        // viaStops의 한국어 원문을 되찾는다(조인/표시 분리, spec §3.5·§3.6).
        ForEach(Array(model.displayLeg(leg, useOverride: false).stops.enumerated()), id: \.offset) { index, stop in
            // ⚠ 언어 축은 로케일(`transitGuideIsEn`)이지 **데이터 유무가 아니다** — 데이터로
            // 고르면 세션 도중 ko로 바꿨을 때 이 버튼만 영어로 남는다(spec §3.9가 세션 재시작을
            // 하지 않기로 했다).
            Button(transitGuideIsEn ? (stop.en ?? stop.ko) : stop.ko) { onPick(index) }
        }
        Button(appLocalized("transitGuide.reboardCancel")) { onCancel() }
    }

    /// 착지 대상 부착 헬퍼(A35 spec §4.1 ①) — `focusedControl` 바인딩의 **유일한 부착 자리**(소스 가드
    /// `transit-landing-guard.test.ts`). 셋을 한 번에 단다: 정체성 옵셔널 바인딩 · `scrollTo` 키(`.id`) ·
    /// 실현 관측(onAppear/onDisappear → `rendered`). 대상마다 따로 달면 하나가 빠지고, 빠진 대상은 가시화나
    /// 사유 판정 없이 조용히 실패한다(종전 `default: break` 5대상이 정확히 그 자리였다).
    private func landingTarget<V: View>(_ view: V, _ control: SheetControl) -> some View {
        view
            .accessibilityFocused($focusedControl, equals: control)
            .id(Self.controlId(control))
            .onAppear { rendered.appear(control) }
            .onDisappear { rendered.disappear(control) }
    }

    /// `scrollTo` 키 — `SheetControl`마다 하나(exhaustive switch 대신 case 이름으로 유도해 새 대상 누락이 없다).
    private static func controlId(_ control: SheetControl) -> String { "transit-control-\(control)" }

    /// 실현 관측 상자(설계 리뷰 L2·L3 — 비관찰 참조 + 카운트). `@Observable` 아님이 의도다.
    final class RenderedControls {
        private var counts: [SheetControl: Int] = [:]
        func appear(_ c: SheetControl) { counts[c, default: 0] += 1 }
        func disappear(_ c: SheetControl) { counts[c] = max(0, (counts[c] ?? 0) - 1) }
        func contains(_ c: SheetControl) -> Bool { (counts[c] ?? 0) > 0 }
    }

    /// 착지 시도의 끝. 로그 `reason=`의 값이고 다음 로그 회수가 이것으로 원인을 가른다(§4.5).
    private enum LandingOutcome: String { case ok, notRendered, stolen, vanished, background }

    /// 컨트롤 착지 정본 시퀀스(`docs/PATTERNS.md` "iOS 목록 포커스 이동", A35 재설계 spec 2026-09-11 §4.1):
    /// 직전 착지 취소 → 경합 바인딩 해제 → [가시화(scrollTo, 실현될 때까지 150ms마다 반복) → **실현 대기**(≤500ms) →
    /// 존재 재검증 → 대입 → **늦은 검증**(600·900·1200ms 체증, 100ms마다 조기 확정)] × 최대 3회 → 로그 →
    /// 실패면 **폴백 통지**(`.high`).
    ///
    /// 세 실패 기제(spec §1.1)에 하나씩 대응한다: ①오프스크린 AX 컬링(가설 — `vo=`로 판정) → 전수 가시화 + 실현 관측
    /// ②VoiceOver 자체 재배치(프레젠테이션·전경 복귀 뒤 screen-changed가 헤더로 옮김)가 대입 뒤에 오는 경합 → 검증을
    /// 늦추고 재시도(`stolen`) ③트리거 결손 → 호출부 규칙(대상 뷰 `.task` 금지).
    /// **동기 대입 한 줄은 실패한다**(실기기 확정). 폴백은 그 자리에서 낭독됐을 라벨 — 착지 못 하면 통지가 유일한
    /// 증거(헌장 §5). 국면 전이·새 착지는 이 Task를 즉시 취소한다(latest-wins, 설계 리뷰 M8).
    /// ⚠ 배경에선 시도하지 않는다(L4) — VO 커서가 없어 전부 실패로 기록돼 판정 축을 오염시킨다. 전경 복귀에 한 번 착지.
    private func landControlFocus(_ target: SheetControl, proxy: ScrollViewProxy, note: String = "") {
        controlFocusTask?.cancel()
        guard model.isForeground else {
            deferredLanding = target
            transitGuideLog("controlFocus target=\(target) reason=\(LandingOutcome.background.rawValue) deferred=true"
                + (note.isEmpty ? "" : " \(note)"))
            return
        }
        deferredLanding = nil
        controlFocusTask = Task { @MainActor in
            let started = ProcessInfo.processInfo.systemUptime
            // 경합 바인딩 해제(설계 리뷰 M7) — 후보·경로 정체성 바인딩이 사라진 항목을
            // 계속 가리키면 새 대상 대입과 경쟁한다.
            focusedCandidate = nil
            focusedDestChangeRoute = nil
            let verifyDelaysMs = [600, 900, 1200]
            var outcome = LandingOutcome.notRendered
            var attempts = 0
            var wasRendered = false
            attemptLoop: for delay in verifyDelaysMs {
                attempts += 1
                // 실현 대기: 아직 없는 id에 `scrollTo`는 조용히 무효라(설계 리뷰 L1) 실현될 때까지 150ms마다 다시 부른다.
                var waited = 0
                scrollTo(target, proxy)
                while !rendered.contains(target), waited < 500 {
                    try? await Task.sleep(for: .milliseconds(50))
                    guard !Task.isCancelled else { return }
                    waited += 50
                    if waited % 150 == 0 { scrollTo(target, proxy) }
                }
                guard controlExists(target) else { outcome = .vanished; break }
                wasRendered = rendered.contains(target)
                if wasRendered { scrollTo(target, proxy) }
                focusedControl = target
                // 늦은 검증 — 100ms마다 본다: 착지 확정은 조기 종료, 대상 소멸은 지연 끝이 아니라 그 시점에(L6).
                var verified = 0
                while verified < delay {
                    try? await Task.sleep(for: .milliseconds(100))
                    guard !Task.isCancelled else { return }
                    verified += 100
                    if focusedControl == target { outcome = .ok; break attemptLoop }
                    guard controlExists(target) else { outcome = .vanished; break attemptLoop }
                }
                outcome = wasRendered ? .stolen : .notRendered
            }
            let elapsedMs = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
            let landed = focusedControl == target
            let voLabel = transitFocusedLabel()
            transitGuideLog(
                "controlFocus target=\(target) landed=\(landed)"
                    + " actual=\(focusedControl.map { "\($0)" } ?? "nil")"
                    + " attempts=\(attempts) elapsedMs=\(elapsedMs) rendered=\(wasRendered) reason=\(outcome.rawValue)"
                    + " vo=\(voLabel.map { "\"\($0)\"" } ?? "nil")"
                    + (note.isEmpty ? "" : " \(note)"))
            guard !landed, outcome != .vanished else { return }
            // 착지 못 했으면 그 자리에서 낭독됐을 라벨을 통지한다(헌장 §5 — 통지가 유일한 증거).
            // `vanished`는 대상이 사라진 것이라 그 라벨을 읽으면 거짓이 된다 — 새 국면의 착지가 대신한다.
            // VO 커서가 실제로는 대상 위인데 바인딩만 늦은 경우(`vo` == 라벨)는 이중 낭독이라 내지 않는다(L5 일부).
            let text = landingFallbackText(target)
            if let voLabel, text.hasPrefix(voLabel) {
                transitGuideLog("landingFallback target=\(target) skipped=voMatchesLabel")
                return
            }
            transitGuideLog("landingFallback target=\(target) text=\(text.prefix(40))")
            model.announceLandingFallback(text)
        }
    }

    /// 가시화 — 전 대상(A35 §4.1 ①). 종전 "섹션 상단 버튼은 첫 화면 안"이라는 전제는 거짓이었다(`advance`·
    /// `changeBoarding`은 진행 상황·상태 문장·경유역 목록 뒤). anchor 미지정(sticky 헤더 뒤로 잘리지 않게).
    private func scrollTo(_ target: SheetControl, _ proxy: ScrollViewProxy) {
        proxy.scrollTo(Self.controlId(target))
    }

    /// 착지 실패 폴백 문장 — **그 대상에 착지했다면 VoiceOver가 읽었을 라벨**(같은 키). 대상별로 갈리는 라벨은
    /// 그 시점 상태로 고른다(`advance`의 E34 라벨·대기 라벨의 pickVehicle·프롬프트의 두 흐름·전환 상태 3형).
    private func landingFallbackText(_ target: SheetControl) -> String {
        switch target {
        case .title: return joinText(appLocalized("beacon.transitHeading"), model.destinationLabel)
        case .minimize: return appLocalized("guide.minimize")
        case .advance: return advanceLabel
        case .changeBoarding: return appLocalized("transitGuide.changeBoarding")
        case .confirmBoarded: return appLocalized("transitGuide.confirmBoarded")
        case .waitingLabel: return waitingLabelText
        case .reboardPrompt: return appLocalized(reboardPromptKey)
        case .boardAlready: return appLocalized("transitGuide.boardAlready")
        case .expressPrompt: return appLocalized("transitGuide.expressPrompt")
        case .expressBlocked: return model.expressBlockedNote ?? ""
        case .destChangeStatus:
            switch model.pendingDestChange?.phase {
            case .loading: return appLocalized("ios.transitGuide.destChangeLoading")
            case .empty: return appLocalized("ios.transitGuide.destChangeNone")
            case .failed: return appLocalized("ios.transitGuide.destChangeError")
            case .loaded, .none: return ""
            }
        }
    }

    /// 대상이 현재 국면에 렌더되는지(지연 중 국면이 바뀌었으면 대입하지 않는다).
    private func controlExists(_ target: SheetControl) -> Bool {
        let phase = model.state?.phase
        switch target {
        case .title, .minimize: return model.state != nil
        case .advance: return phase == .arrived
            || (phase == .riding && (model.state?.lock.map(isApproxTransitLock) ?? false))
        case .changeBoarding: return phase == .riding && !model.reboardPickerActive
        case .confirmBoarded: return phase == .boarding
        case .waitingLabel: return phase == .waiting && model.aboardStep != .pickStation
        case .reboardPrompt:
            return (phase == .riding && model.reboardPickerActive)
                || (phase == .waiting && model.aboardStep == .pickStation)
        case .boardAlready:
            return phase == .waiting && model.aboardStep == nil && model.currentLeg?.trackMode != .tagoBus
        case .expressPrompt: return phase == .waiting && expressPromptActive
        case .expressBlocked: return phase == .waiting && model.expressBlockedNote != nil
        case .destChangeStatus:
            if case .loaded = model.pendingDestChange?.phase { return false }
            return model.pendingDestChange != nil
        }
    }

    /// 빠른하차 줄 — 하차역명을 표시 라벨로 넘긴다(영문 없으면 한국어 원문).
    private func quickExitLine(_ leg: TransitGuideLeg) -> String? {
        let alight = model.displayLeg(leg, useOverride: false).alight
        let station = transitGuideIsEn ? (alight.en ?? alight.ko) : alight.ko
        return quickExitText(leg.quickExit, station: station, lang: AppLanguage.current)
    }

    /// 선택 차량 설명을 ko·en 쌍으로 얼린다. **비면 nil** — 서울버스는 행선·방향이 둘 다 없어
    /// 설명이 빈 문자열인데, 빈 라벨은 non-nil이라 상시 표시에 "선택한 차량: ." 빈 슬롯이 뜬다.
    private func vehicleDescLabel(_ item: TransitDisplayItem) -> TransitLabel? {
        let ko = TransitGuideTextRenderer.render(transitVehicleDescLine(isEn: false, item: item))
        guard !ko.isEmpty else { return nil }
        let en = transitVehicleDescLine(isEn: true, item: item)
        return TransitLabel(ko: ko, en: en.lang == "en" ? TransitGuideTextRenderer.render(en) : nil)
    }

    @ViewBuilder private func candidateRow(
        _ candidate: TransitBoardingCandidate, leg: TransitGuideLeg
    ) -> some View {
        let item = candidate.item
        let departedMinutes = model.waitingDeparted.first {
            $0.item.vehicleId == item.vehicleId
        }?.minutes
        let displayLeg = model.displayLeg(leg, useOverride: false)
        let displayItem = transitDisplayItem(item)
        // 차단 행은 급행 조각을 빼고 사유 줄만 결정 문장으로 둔다(a11y 감사 2026-09-02 — 종착 앞 + 급행
        // 정차/미결 조각이 함께 붙으면 "정차한다, 가지 않는다" 모순 낭독).
        let desc = TransitGuideTextRenderer.render(transitCandidateDescLine(
            isEn: transitGuideIsEn, leg: displayLeg, item: displayItem,
            express: candidate.unreachable == nil ? candidate.express : nil,
            departedMinutes: departedMinutes))
        // 결정적 미도달 사유는 vehId 유무보다 앞이다(웹과 같은 순서) — "왜 못 고르는가"가 먼저다.
        if let reason = candidate.unreachable {
            // 결정적 미도달(§5.1·A16 L1) — 활성화 차단의 단일 술어, 사유별 문장 병기.
            let note: TransitTextLine = switch reason {
            case .terminatesEarly:
                transitTerminatesEarlyLine(isEn: transitGuideIsEn, leg: displayLeg, item: displayItem)
            case .expressSkipsAlight:
                transitExpressSkipsAlightLine(isEn: transitGuideIsEn, leg: displayLeg)
            }
            Text(joinText(desc, TransitGuideTextRenderer.render(note)))
                .foregroundStyle(.secondary)
        } else if item.vehicleId == nil || item.vehicleId?.isEmpty == true {
            // vehId 없는 슬롯은 잠금 불가(§5.1 "vehId 보유 슬롯만 활성화") — 빈 잠금은
            // 어떤 항목과도 매칭되지 않는 조용한 고장이 된다(독립 리뷰 BLOCKER).
            Text(desc).foregroundStyle(.secondary)
        } else {
            // 라벨은 "선택"이다(N3) — 탑승 여부는 앱이 승차 정류소 도착으로 판정한다.
            // 선택 차량 설명은 폴마다 바뀌는 완성 문장을 뺀 안정 조각(행선·방향)만.
            Button(appLocalized(
                leg.mode == "subway" ? "transitGuide.selectTrain" : "transitGuide.selectBus", desc
            )) {
                // 설명은 ko·en 쌍으로 얼린다 — 렌더 문자열을 저장하면 세션 도중 언어를
                // 바꿨을 때 그 조각만 옛 언어로 남는다.
                if model.aboardStep == .pickVehicle {
                    model.boardAboard(item: item, description: vehicleDescLabel(displayItem))
                } else {
                    model.board(item: item, description: vehicleDescLabel(displayItem))
                }
            }
        }
    }

}
