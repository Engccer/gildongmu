import GildongmuKit
import SwiftUI

/// 실시간 길 안내 중 화면. **시작이 곧 이 시트의 표시이고, 중지가 곧 닫힘이다(1:1)** —
/// 단 하나의 예외가 도착 종료 화면이다(아래).
///
/// 인라인 섹션에서 분리한 이유는 걷는 중의 탐색 비용이다. 길찾기 결과 화면에는 수단
/// 섹션이 이어지고 도보는 인라인 전개라 수백 행이 될 수 있어(천호역 실측), 추적을
/// 멈추려면 그 목록 안에서 버튼을 찾아야 했다. 시트는 VoiceOver 스코프를 이 화면으로
/// 가두므로 스와이프 몇 번이면 상태에 닿고, 종료는 최하단 고정 버튼이라 네 손가락 아래쪽
/// 탭 한 번이다(위원장 실보행 피드백 2026-08-02, 종료 하단 고정 2026-08-23).
///
/// 컨트롤 집합: 중지·진행 상황·주변 확인·재조회(이탈 시). "다음으로 건너뛰기"는 두지
/// 않는다(선례 부재 + 사용자가 진행을 주장하게 만드는 실패 모드, 조사 §5.4). 상세⇄간략
/// 전환 버튼은 위원장 실사용 판정으로 폐지(2026-08-11 — 무용). 주변 확인은 그 자리로
/// 올라왔다(말미 배치는 안내 정보 행을 읽다 보면 다음 스와이프가 자꾸 이 버튼에 닿는
/// 불편 — 같은 판정).
///
/// **도착 종료 화면**(위원장 판정 2026-08-11): 도착으로 세션이 끝나면 시트를 닫지 않고
/// 도착 화면으로 전환한다 — 즉시 닫혀 경로 조회 결과로 떨어지는 전이가 어색했고, 도착
/// 직후의 자연스러운 다음 행동이 목적지 주변 확인이다. 대중교통 시트의 완료 후 핸드오프
/// 제안(§14.2)과 같은 "세션 없이 유지되는 시트"이며, 닫기·스와이프·VO escape가 소거한다.
///
/// 스와이프·VoiceOver escape로 닫아도 추적이 멈춘다(`interactiveDismissDisabled` 미사용).
/// 걷는 중 오조작으로 꺼지는 위험보다, 시각장애 사용자가 닫을 수 없는 화면에 갇히는 쪽이
/// 나쁘다. 실수로 닫히면 다시 시작하면 된다.
struct BeaconTrackingSheet: View {
    let model: BeaconModel
    let onStop: () -> Void
    /// 최소화(N1) — 시트를 내리고 띠바로 세션을 대표시킨다. 루트가 `isMinimized`를 올린다.
    let onMinimize: () -> Void
    /// 목적지 전환 확정 통보(스펙 2026-08-12 §5) — 탭이 폼 동기화(도착지 필드·무통지
    /// 재조회)를 맡는다. 세션에 반영되지 않은 선택(§3.2)은 통보하지 않는다.
    let onDestinationCommitted: (DirectionsEndpoint) -> Void
    /// 경유지 추가·변경 확정 통보(N4) — 목적지 전환과 같은 채널·같은 가드.
    let onWaypointCommitted: (DirectionsEndpoint) -> Void
    /// 자동차 도착 종료 화면의 도보 인계(K2 §6.4, 위원장 판정 ④). nil이면 버튼이 없다.
    let onCarWalkHandoff: (() -> Void)?

    /// 착지 대상(E57, spec 2026-09-30-guide-sheet-info-row-landing). **시트가 열리거나 이어지거나 띠바에서 돌아올 때의
    /// 첫 착지는 첫 정보 행**(위원장 2026-09-30: "최상단 헤딩이 아닌 남은 거리 행", 띠바 복귀 Q1) — 종전 제목·접기 버튼
    /// 착지는 폐기했다. 옵셔널 단일 바인딩인 이유는 "커서가 지금 어느 대상에 있는가"를 읽어야 해서다(소실 복구·자동
    /// 채택 판정, spec §3.1) — 부착은 헬퍼 한 자리(`focusTarget`).
    enum SheetFocus: Hashable {
        /// 정보 행(첫 정보 행 후보 — `firstInfoRow`의 순서가 곧 우선순위다). 자동차 "현재 도로"·아랫줄·직선거리
        /// 주석은 후보가 아니다: 남은 거리·윗줄이 없을 때 함께 없거나 상태 문장보다 늘 뒤다(설계 리뷰 M6).
        case remaining, liveTop, status
        /// 재조회 버튼 — 착지 대상이 아니라 "커서가 사라지는 버튼 위에 있었는가"를 읽는 자리(자동 채택, spec §3.4).
        case reroute
        /// 종료 화면의 도착(중지) 문장 — 종료 화면의 첫 정보 행(헌장 §5: 도착 전이가 포커스를 쥔 컨트롤을 통째로 없앤다).
        case arrived
        /// 체중 입력 뒤 갱신된 걸음 요약 문장 — [체중 입력하기](트리거)가 사라져 표준 dismiss의 포커스 복원이
        /// 착지할 곳을 잃는다(헌장 §5, 라벨 변화가 곧 상태 신호).
        case healthSummary

        var isInfoRow: Bool {
            switch self {
            case .remaining, .liveTop, .status: true
            case .reroute, .arrived, .healthSummary: false
            }
        }
    }
    @AccessibilityFocusState private var focusedRow: SheetFocus?
    /// 진행 중인 착지(latest-wins — 새 착지가 먼저 취소한다)와 그 대상·세대(배경 전환이 끊고 이월할 때 읽는다).
    @State private var focusTask: Task<Void, Never>?
    @State private var landingInFlight: SheetFocus?
    @State private var landingGen = 0
    /// 배경에서 난 착지 요청 — 전경 복귀에 한 번 착지한다(대중교통 A35 L4·코드 리뷰 M1 동형).
    @State private var deferredLanding: SheetFocus?
    /// 경로 조회·통지 발화를 기다리는 첫 정보 행 착지(spec §3.3).
    @State private var pendingInfoLanding: PendingInfoLanding?
    @State private var pendingTimeoutTask: Task<Void, Never>?
    @State private var announcementWaitTask: Task<Void, Never>?
    /// 관찰 대상이 아닌 참조 상자 — 통지 완료 기록·스크롤 proxy. `@State` 값이면 통지가 끝날 때마다 시트 전체가
    /// 다시 그려진다(코드 리뷰 m6, 대중교통 `RenderedControls` 동형).
    @State private var landingBox = LandingBox()
    /// 자식 시트(조망·목적지/경유지 검색·장소 상세) 안에서 일어난 전이의 착지 — 그 시트가 **닫힌 뒤** 한 곳에서 부른다
    /// (설계 리뷰 M3, 대중교통 `pendingFollowUp` 동형). 모달 뒤의 행에 대입하면 조용히 되돌아간다.
    @State private var landAfterDismiss: DismissLanding?
    @Environment(\.scenePhase) private var scenePhase
    /// 전 구간 조망 모달(위원장 판정 개정 2026-08-10): 인라인 펼침은 같은 화면의
    /// 탐색 개체를 너무 늘렸다 — 별도 시트로 스코프를 가둬 "딱 확인하고 닫기"가
    /// 성립한다. 닫으면 시스템이 트리거 버튼으로 포커스를 복원한다(표준 dismiss).
    @State private var showRouteList = false
    /// 목적지 검색 시트(스펙 §3) — 열린 동안 톤·통지 전부 억제(받아쓰기 마이크).
    @State private var changeDestPresented = false
    /// 경유지 검색 시트(N4) — 억제 계약은 목적지 검색 시트와 같다.
    @State private var waypointPresented = false
    /// 장소 상세 시트(스펙 §2) — 안내 신호는 유지(억제 없음, 임박 큐는 안전 계층).
    @State private var showPlaceDetail = false
    /// 재조회 버튼을 눌렀다는 표식. 성공(offRoute 해제)으로 버튼이 사라질 때 커서를 첫 정보 행으로
    /// 옮기는 근거(사용자가 누른 결과로 사라지는 경로). 이탈이 풀리면 결과와 무관하게 지운다(코드 리뷰 m9).
    @State private var reroutePressed = false
    /// 도착 화면 "체중 입력하기" → 설정 시트(표준 중첩 시트). 루트의 `openSettings`
    /// 환경값을 쓰지 않는 이유: 이 시트가 떠 있는 동안 루트가 또 시트를 올리면 표시되지 않는다.
    @State private var showsSettings = false
    /// 체중 입력 권유를 무시한 횟수(E31, spec 2026-09-11). 상한에 닿으면 권유 두 줄이
    /// 사라지고 기준 체중이 칼로리 문장 안으로 들어간다. 판정은 Kit `WalkHealth`.
    @AppStorage(WalkHealth.weightPromptDismissalsKey) private var weightPromptDismissals = 0
    /// 권유가 뜬 화면에서 [체중 입력하기]를 눌렀는가 — 눌렀다면 뒤이은 [닫기]는 무시가
    /// 아니다("아무 행동도 하지 않고 닫기를 누르는 경우", 위원장 2026-09-08).
    /// ⚠ **`@State`가 아니라 영속 상태여야 한다**: 시트를 최소화하면 루트의
    /// `presentedScreen`(`isMinimized ? nil : screen`)이 nil이 되어 콘텐츠 뷰가 통째로
    /// 파괴되고 뷰 상태가 초기값으로 돌아간다. 그러면 [체중 입력하기]를 누른 뒤 스와이프로
    /// 내렸다 띠바로 돌아와 닫은 화면이 무시로 계상된다(리뷰 검출, 예산이 2회라 절반이 탄다).
    /// 소비 지점은 [닫기] 하나이고 **거기서 읽고 거기서 지운다**.
    @AppStorage(WalkHealth.weightPromptEngagedKey) private var weightPromptEngaged = false

    var body: some View {
        // 접기 버튼은 섹션 헤더(제목 메뉴) 행 우측의 작은 아이콘이다(위원장 판정 2026-08-23 —
        // 한 행을 차지하지 않고, 빈 내비게이션 바도 두지 않는다). GuideTitleMenu가 배치·라벨·
        // 착지 바인딩을 들고, 도착 화면에서는 헤더에 붙이지 않는다.
        sheetBody
    }

    private var sheetBody: some View {
        // "더 보기" 가시화용 proxy(WhereAmIView 동형 래핑 — List는 화면 밖 행을
        // AX 트리에서 컬링하므로 scrollTo 선행이 필요하다).
        ScrollViewReader { proxy in
        List {
            if let arrival = model.arrivalDest {
                arrivalSection(dest: arrival, proxy: proxy)
            } else {
            Section {
                // 경유지(N4, 위원장 판정: 목적지 팝업과 안내 종료 사이). 라벨이 곧 상태 —
                // 미도착 경유지가 있으면 "C, 경유지 변경", 없으면(도착 뒤 포함) "경유지 추가".
                // ko 전용 기능이라 상세 조회가 없는 로케일에는 두지 않는다(`waypointAvailable`).
                if GuideSession.shared.waypointAvailable {
                    Button(model.waypoint.map { appLocalized("ios.guide.waypointChange", $0.label) }
                           ?? appLocalized("directions.addVia")) {
                        waypointPresented = true
                    }
                    // 경유지 삭제(N4 잔여, K2 §6.5): 미도착 경유지가 있을 때만. 누르면 자신이
                    // 사라지므로 첫 정보 행으로 옮긴다(E57 — 경로를 다시 조회하니 조회 끝까지 기다린다).
                    if model.waypoint != nil {
                        Button(appLocalized("ios.guide.waypointRemove")) {
                            if model.removeWaypoint() { requestInfoLanding(note: "waypointRemoved", summarySince: nil) }
                        }
                    }
                }
                // 반복 버튼은 위원장 실사용 판정으로 제거 확정(2026-08-03 묶음 A).
                // 진행 상황: 자동 통지를 기다리지 않는 임의 시점 조회(Soundscape Where Am I).
                // 경로 보유(상세) 세션은 조망 모달이 응답이다 — 모달 표시와 Announcement가
                // 경합하므로 발화하지 않고, 조망 문장은 모달 헤더 착지가 낭독한다.
                // 간략·경로 미보유 세션은 종전대로 낭독뿐(죽은 모달 금지).
                Button(appLocalized("guide.progressButton")) {
                    if model.routeStepDescriptions != nil {
                        showRouteList = true
                    } else {
                        model.announceProgress()
                    }
                }
                // 주변 확인(M1 부근 재구성) — 전환 버튼이 있던 자리(위원장 판정
                // 2026-08-11, 전환 버튼은 무용으로 폐지): 말미 별도 섹션이던 시절엔
                // 안내 정보 행을 읽다 보면 다음 스와이프가 자꾸 이 버튼에 닿았다.
                // 앵커는 **목적지** 좌표다(실시간 안내는 실좌표를 쓰지만 이 기능은
                // "도착지 부근이 어떤 모습인가"를 묻는다, spec §5). 펼친 결과가 아래
                // 상태 행을 밀지만 펼침은 사용자가 방금 누른 행동이다.
                if let dest = model.dest {
                    SurroundingsSceneSection(
                        anchor: (lat: dest.lat, lng: dest.lng), proxy: proxy)
                }
                // 재조회: 이탈 확정 시에만 노출. 이탈 확정 시 자동 재조회·채택(E10ⓑ 자동
                // 채택, 2026-09-02)이 실패·만료·상한 도달로 경로를 못 바꿨을 때의 수동 예비
                // 출구다(종전 "준비된 새 경로로 안내" 확인 라벨은 폐기 — 누르지 않을 이유가
                // 없는 확인은 군더더기).
                // 진행 신호는 라벨 교체가 정본(라벨이 곧 상태 신호 — 별도 통지 중복 금지).
                // 성공하면 이 버튼 자체가 사라지므로, 누른 결과로 사라질 때는 첫 정보 행
                // (새 경로의 남은 거리)으로 포커스를 옮긴다(헌장 §5, a11y 감사 HIGH · E57).
                if model.offRoute {
                    focusTarget(Button(appLocalized(
                        model.isRerouting ? "guide.rerouteBusy" : "guide.rerouteButton"
                    )) {
                        reroutePressed = true
                        model.requestReroute()
                    }, .reroute)
                    // busy는 isRerouting만 본다(전환 진행은 isSwitchingVariant —
                    // 공유하면 진행 중이 아닌 버튼에 "조회 중"이 오귀속된다).
                }
                // 수동 전환 버튼은 폐기(spec 2026-08-14 §1 — 상시 노출이 경로 변경
                // 압박으로 읽힘). 전환 진입점은 진행 상황 조망의 프리뷰다(§2).
                // 직선거리 주석은 간략 안내에서만 참이다 — 상세는 경로 기반 거리를 쓴다.
                // 시트가 인라인 섹션을 덮으므로 걷는 중 닿을 수 있는 곳은 여기뿐.
                if model.mode == .brief {
                    Text(appLocalized("beacon.straightLineNote"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                // 경로 기준 잔여 거리·예상 시간 상시 표시(위원장 실측 판정 2026-08-03).
                // 매 fix 갱신되는 값이라 통지 채널에 태우지 않는다 — 스와이프로 닿는
                // 정적 행 하나. 이탈 중엔 경로 잔여가 거짓이므로 숨긴다(3-state 정직).
                // 시트가 열리거나 이어질 때의 첫 착지다(E57 — 위원장 "실질적 정보가 시작되는 행").
                if model.mode == .detail, !model.offRoute, let remaining = model.remainingText {
                    focusTarget(distanceText(remaining), .remaining)
                }
                // 하단 2행(spec 2026-08-11, walk 상세 전용): 윗줄 = 현재 행동(동적
                // 카운트다운·상태 대체·최종 접근 문형), 아랫줄 = 다음 예고. 이탈 중에도
                // 가리지 않는다 — 리듀서가 윗줄(이탈 문장)·아랫줄(비움)을 소유한다(F2).
                // 낭독은 distanceText(spokenDistanceUnits) 경유, live region 없음 —
                // 능동 통지는 모델의 단일 Announcement 채널이 담당한다(이중 낭독 금지).
                if model.mode == .detail {
                    // walk·car 상세(K2 §4로 car 확장). car는 "현재 도로, {이름}" 행을 맨 앞에 둔다
                    // (E56 — 주행 중 "지금 어느 도로"가 정보다. 이름을 모르면 행이 없다).
                    if model.sessionKind == .car, !model.offRoute,
                       let road = model.currentRoadText {
                        distanceText(road)
                    }
                    if let top = model.liveTopText { focusTarget(distanceText(top), .liveTop) }
                    if let next = model.liveNextText {
                        distanceText(next).foregroundStyle(.secondary)
                    }
                } else {
                    // 간략 세션은 종전 행 유지. walk 상세의 statusText
                    // 중 fail·handoff는 모드가 brief/idle로 바뀌어 이 분기가 받고, 복귀·
                    // 재획득 해소·속도 제안 같은 1회 확인 문장은 **의도적으로 화면에 남지
                    // 않는다**(spec §2-1 상태 행 폐지 — 시각 신호는 윗줄이 상태 문장에서
                    // 그 자리 숫자로 되돌아오는 전환 자체다. 리뷰 지적 기각 근거,
                    // 실사용 판정은 BACKLOG H M0 축 4).
                    if !model.statusText.isEmpty {
                        focusTarget(distanceText(
                            model.statusIsNextPreview
                                ? appLocalized("guide.progressNext", model.statusText)
                                : model.statusText
                        ).foregroundStyle(.secondary), .status)
                    }
                }
                // 잠금 중 무음 예고. 세션 내내 참인 지속 상태라 상태 1줄과 자리를
                // 다투지 않는다 — 시작 시 음성 1회는 놓치면 끝이고, 비-VO 사용자에게는
                // 이 행이 잠금 후 무음의 유일한 단서다.
                if model.soundDegraded {
                    Text(appLocalized("ios.beacon.soundBackgroundUnavailable"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                // 화면 켜기 힌트는 정식 백그라운드 승격으로 삭제(spec 2026-08-15 §4.4) —
                // 진짜 무음 상황은 위 soundDegraded 행이 런타임 판정으로, 더 정확한
                // 문구로 알린다. 상시 문장을 재도입하지 말 것(런타임 판정이 있는 자리에
                // 언제나 참인 척하는 문장을 얹으면 플랫폼 능력이 바뀔 때 거짓만 남는다).
            } header: {
                // 무엇을 추적 중인지가 화면에 있어야 한다. 시트로 분리되면서 주변 맥락이
                // 통째로 사라졌으므로 여기서만 알 수 있다. 수단 라벨(B1 §3.3)이 heading.
                // 제목이 곧 목적지 메뉴다(스펙 2026-08-12 §1 — 장소 상세·목적지 바꾸기).
                GuideTitleRow {
                    GuideTitleMenu(
                        heading: appLocalized(
                            model.sessionKind == .car ? "beacon.carHeading" : "beacon.walkHeading"
                        ),
                        label: model.destinationLabel,
                        onShowDetail: { showPlaceDetail = true },
                        onChangeDestination: { changeDestPresented = true })
                } trailing: {
                    GuideMinimizeButton(action: onMinimize)
                }
            }
            }
        }
        // 안내 종료는 목록 밖 최하단 고정(GuideStopButton 주석). 도착 화면엔 없다(닫기가 그 자리).
        .safeAreaInset(edge: .bottom) {
            if model.arrivalDest == nil {
                VStack(spacing: 0) {
                    // 승차 전 도보(A25 §4.3): 도착 판정이 닿지 않을 때의 사용자 선언. 라벨에 역명을
                    // 넣어 무엇을 선언하는지 말한다(오조작 방지의 1선).
                    if let station = model.prewalkTarget {
                        Button {
                            model.declarePrewalkArrival()
                        } label: {
                            Text(TransitGuideTextRenderer.render(
                                transitPrewalkArrivedButtonLine(
                                    isEn: transitGuideIsEn, station: station)))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .padding(.horizontal)
                        .padding(.top, 8)
                        .background(.bar, ignoresSafeAreaEdges: [])
                    }
                    GuideStopButton(action: onStop)
                }
            }
        }
        // 시트 열림 착지(E57). 새로 열림은 시작과 **모든 인계**(대중교통 → 도보·자동차 도착 → 도보·나들이 귀환)를
        // 포함한다 — 인계가 전부 화면을 한 번 nil로 지나 루트 `.sheet(item:)`이 새 시트를 올리기 때문이다(spec §0 ③).
        // 띠바에서 돌아온 시트도 같다(위원장 판정 Q1 2026-09-30 — 종전 접기 버튼 착지 폐기). 둘은 경로 유무로 저절로
        // 갈린다: 새로 열림은 조회 중이라 조회와 시작 요약을 기다리고, 띠바 복귀는 경로가 있어 곧장 앉는다.
        .task {
            if model.arrivalDest != nil {
                landFocus(.arrived)
            } else {
                requestInfoLanding(note: "open", summarySince: nil)
            }
        }
        .onAppear { landingBox.proxy = proxy }
        // 같은 콘텐츠 뷰 안에서 새 세션이 서는 경로(spec §3.5 — 종료 화면 → 추적 화면을 SwiftUI가 한 트랜잭션으로
        // 합치면 `.task`가 다시 돌지 않는다). 두 경로가 모두 오면 뒤 요청이 앞을 대신한다.
        .onChange(of: model.isTracking) { _, tracking in
            if tracking { requestInfoLanding(note: "newSession", summarySince: nil) }
        }
        // 경로 조회가 끝난 순간 기다리던 착지를 푼다(spec §3.3) — 이 커밋이 낸 시작 요약이 끝난 뒤 그때의 첫 정보 행에.
        .onChange(of: model.awaitingRoute) { _, awaiting in
            guard !awaiting else { return }
            let now = ProcessInfo.processInfo.systemUptime
            landingBox.routeCommittedAt = now
            guard pendingInfoLanding != nil else { return }
            pendingInfoLanding?.summarySince = now
            resolvePendingInfoLanding()
        }
        // 소실 복구(spec §3.4, 설계 리뷰 B1): 커서가 앉아 있던 정보 행이 사라지면(이탈 확정·최종 접근 진입·간략 강등)
        // SwiftUI List는 커서를 시트 맨 위로 보내기도 한다. 판정은 바인딩의 nil 전이가 아니라 **행 집합이 바뀌는 순간의
        // 바인딩**이다(대중교통 A47 iOS 동형). 스와이프로 떠난 경우는 커서가 그 행에 없어 걸리지 않고, 종료 화면 전이는
        // 도착 착지가 맡는다. 같은 커밋이 낸 통지(이탈 경고·강등 문장)가 끝난 뒤에 앉는다(spec 준수 리뷰 — 끊지 않게).
        .onChange(of: presentInfoRows) { old, new in
            guard let focused = focusedRow, old.contains(focused), !new.contains(focused),
                  model.isTracking, model.arrivalDest == nil else { return }
            requestInfoLanding(note: "lost=\(focused)", summarySince: ProcessInfo.processInfo.systemUptime)
        }
        // 통지 발화가 끝났다는 신호(spec §3.3) — 문자열과 시각으로 우리 통지를 가른다.
        .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.announcementDidFinishNotification)) { note in
            guard let text = note.userInfo?[UIAccessibility.announcementStringValueUserInfoKey] as? String else { return }
            landingBox.finished = (text, ProcessInfo.processInfo.systemUptime)
        }
        // 기다리는 동안 사용자가 커서를 옮겼으면 착지하지 않는다(설계 리뷰 M4, a11y 감사 M2). VoiceOver 초점 이동
        // 신호로 본다 — 바인딩 없는 버튼 사이 이동도 잡힌다. 대기를 세운 뒤 1초는 시스템이 커서를 두는 창이라(시트
        // 표시·검색 시트 닫힘의 트리거 복원) 세지 않는다. 배경 전환이 커서를 앱 밖으로 보내는 것도 세지 않는다.
        .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.elementFocusedNotification)) { _ in
            guard Self.isForeground, let pending = pendingInfoLanding,
                  ProcessInfo.processInfo.systemUptime - pending.since > Self.systemFocusGrace else { return }
            pendingInfoLanding?.userMoved = true
        }
        // 배경 경계(코드 리뷰 M1, 대중교통 M1 동형): 진행 중인 착지·대기는 VO 커서 없는 배경에서 실패한다 — 끊고 전경
        // 복귀로 이월한다. 복귀 때는 모델이 놓친 통지를 갚으므로 그 발화가 끝난 뒤 앉는다(a11y 감사 H1).
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                let carried: SheetFocus? = pendingInfoLanding != nil ? .remaining : landingInFlight
                guard let carried else { return }
                focusTask?.cancel()
                landingInFlight = nil
                clearPendingInfoLanding()
                deferredLanding = carried
                logFocus("target=\(carried) reason=background deferred=true", note: "inFlight")
            case .active:
                guard let target = deferredLanding else { return }
                deferredLanding = nil
                // 정보 행은 복귀 시점 상태로 다시 고른다(배경 동안 이탈·강등이 났을 수 있다).
                if target.isInfoRow {
                    requestInfoLanding(note: "deferred", summarySince: ProcessInfo.processInfo.systemUptime)
                } else {
                    landFocus(target, note: "deferred")
                }
            default:
                break
            }
        }
        // 최소화는 콘텐츠 뷰 파괴다 — `@State` 핸들은 사라져도 Task는 돈다. 끊는다(대중교통 M2 동형).
        .onDisappear {
            focusTask?.cancel()
            pendingTimeoutTask?.cancel()
            announcementWaitTask?.cancel()
        }
        // 전 구간 조망 모달(판정 개정 2026-08-10). 시트 위 시트는 표준 중첩 표시.
        // 셸·프리뷰는 GuideOverviewSheet.swift로 이동(E15-1 능력 공유) — 도보 행·행동은
        // BeaconOverviewAdapter가 종전 그대로 투영한다(동작 변경 0).
        .sheet(isPresented: $showRouteList, onDismiss: landAfterSubSheet) {
            GuideOverviewSheet(capability: BeaconOverviewAdapter(model: model)) { _ in }
        }
        .sheet(isPresented: $showsSettings, onDismiss: {
            model.recomputeArrivalHealth()
            if model.arrivalHealth?.usedDefaultWeight == false {
                landFocus(.healthSummary)
            }
        }) {
            SettingsView(focusWeightOnAppear: true)
        }
        // 목적지 검색(스펙 §3): 최근 목록 포함 기존 시트 재사용. 세션이 죽었으면
        // changeDestination이 false를 돌려 폼도 건드리지 않는다(§3.2 확정 가드).
        // 착지는 시트가 닫힌 뒤 첫 정보 행(E57 — 종전 제목. 새 목적지는 확인 통지가 이미 말했다).
        .sheet(isPresented: $changeDestPresented, onDismiss: landAfterSubSheet) {
            DirectionsEndpointSearchView(target: .to) { endpoint in
                guard case .place(let label, let lat, let lng, _) = endpoint else { return }
                if model.changeDestination(dest: BeaconDest(lat: lat, lng: lng), label: label) {
                    onDestinationCommitted(endpoint)
                    landAfterDismiss = DismissLanding(note: "destinationChanged", expectsSummary: model.awaitingRoute)
                }
            }
        }
        // 경유지 검색(N4): 목적지 검색과 같은 시트·같은 억제·같은 착지 계약.
        .sheet(isPresented: $waypointPresented, onDismiss: landAfterSubSheet) {
            DirectionsEndpointSearchView(target: .via) { endpoint in
                guard case .place(let label, let lat, let lng, _) = endpoint else { return }
                if model.setWaypoint(dest: BeaconDest(lat: lat, lng: lng), label: label) {
                    onWaypointCommitted(endpoint)
                    landAfterDismiss = DismissLanding(note: "waypointChanged", expectsSummary: model.awaitingRoute)
                }
            }
        }
        // 검색 시트에 받아쓰기 마이크가 있다 — 열린 동안 톤·통지 전부 억제(스펙 §5.4,
        // 메인 화면 검색 시트의 outputSuppressed 계약 동형). 두 시트 중 하나라도 열려
        // 있으면 억제(경유지 시트 추가, N4).
        .onChange(of: changeDestPresented) { _, presented in
            model.outputSuppressed = presented || waypointPresented
        }
        .onChange(of: waypointPresented) { _, presented in
            model.outputSuppressed = presented || changeDestPresented
        }
        // 장소 상세(스펙 §2): 표준 중첩 시트. 목적지는 이름+좌표뿐이라 최소 Place로
        // 열고, 길찾기 진입 버튼은 숨긴다(이미 그곳으로 안내 중).
        .sheet(isPresented: $showPlaceDetail, onDismiss: landAfterSubSheet) {
            if let dest = model.dest {
                PlaceDetailSheet(
                    place: guideDestinationPlace(dest: dest, label: model.destinationLabel),
                    showsDirectionsEntry: false)
            }
        }
        // 재조회 성공으로 버튼이 사라진 순간 커서를 첫 정보 행(새 경로의 남은 거리)으로(헌장 §5 이탈 방지, E57).
        // 자동 채택(E10ⓑ 2026-09-02)은 사용자가 누르지 않은 전이라 **커서가 그 버튼 위에 있었을 때만** 옮긴다(a11y 감사
        // M1 — 다른 행을 읽는 사람을 끌어가지 않는다). 자연 복귀(backOnRoute)는 무이동. 착지는 재조회 요약이 끝난 뒤다.
        .onChange(of: model.offRoute) { _, isOff in
            guard !isOff else { return }
            let pressed = reroutePressed
            reroutePressed = false
            guard model.offRouteEndedByReroute, pressed || focusedRow == .reroute else { return }
            requestInfoLanding(note: "rerouted", summarySince: ProcessInfo.processInfo.systemUptime)
        }
        // 프리뷰 채택 성공: 조망(과 그 위 프리뷰)을 닫고, 닫힌 뒤 첫 정보 행으로 복귀(spec
        // 2026-08-14 §4 — 포커스를 쥔 시트가 통째로 사라지는 전이, 재조회 성공 동형 · E57 설계 리뷰 M3). 조망이 이미
        // 닫힌 뒤 채택이 끝났으면(낡음 폴백) 곧장 요청한다 — 표식을 남기면 다음에 조망을 그냥 열고 닫을 때 튄다.
        .onChange(of: model.variantAdoptedSeq) {
            if showRouteList {
                landAfterDismiss = DismissLanding(note: "variantAdopted", expectsSummary: true)
                showRouteList = false
            } else {
                requestInfoLanding(note: "variantAdopted", summarySince: ProcessInfo.processInfo.systemUptime)
            }
        }
        // 도착 전이: 포커스를 쥔 컨트롤(중지 등)이 통째로 사라진다 — 도착 문장으로
        // 선점한다(헌장 §5, 대중교통 arrived 전이 동형). 착지 낭독이 `.high` 도착
        // 통지와 **같은 문장**이라 겹쳐 끊겨도 정보 손실이 없고, 다음 스와이프가
        // 곧장 주변 확인 버튼이다.
        .onChange(of: model.arrivalDest) { previous, arrival in
            guard previous == nil, arrival != nil else { return }
            // 조망 모달이 열린 채 도착하면 명시적으로 닫는다(독립 리뷰 MAJOR).
            // 종전엔 도착 = 시트 닫힘이라 자식 모달도 계단식으로 함께 닫혔는데,
            // 시트가 도착 화면으로 유지되면서 그 계단이 사라졌다 — 방치하면 stop()이
            // 지운 경로 위에서 "아직 안내가 없습니다" 헤더가 도착 통지와 모순된다.
            showRouteList = false
            clearPendingInfoLanding()
            // 검색·장소 상세가 떠 있으면 닫힌 뒤 도착 문장에(spec 준수 리뷰 — 종전엔 모달 뒤 대입이 조용히 사라졌다).
            if changeDestPresented || waypointPresented || showPlaceDetail {
                landAfterDismiss = DismissLanding(note: "arrived", expectsSummary: false, target: .arrived)
            } else {
                landAfterDismiss = nil
                landFocus(.arrived)
            }
        }
        }
    }

    /// 종료 화면(위원장 판정 2026-08-11, 중지 종료 확장 2026-08-19). 헤딩이 어느 목적지의
    /// 어떤 종료인지를, 본문 첫 행이 도착 사실(또는 중지 사유)을, 도착이면 주변 확인이
    /// 다음 행동을 담는다. 닫기는 명시 `clearArrival()` — 스와이프·VO escape는 N1부터
    /// 소거가 아니라 최소화라(띠바에 "도착" 요약이 남는다) 이 버튼이 유일한 소거 경로다
    /// (설계 리뷰 C3·C4: dismiss 콜백이 모델 상태로 뜻을 정하던 경합의 해소). 도착이 아닌 종료(`.stopped`)는 걸음·칼로리
    /// 요약을 위해서만 남는 화면이라 주변 확인이 없고, 요약이 없으면 모델이 곧 소거한다.
    private func arrivalSection(dest: BeaconDest, proxy: ScrollViewProxy) -> some View {
        Section {
            // 확정/추정/중지 분기(3-state 정직성, spec 2026-08-13 §4-5): 추정 종료를
            // 확정 도착과, 중지를 도착과 뭉개지 않는다.
            focusTarget(Text(endSentence), .arrived)
            // 걸음·칼로리 요약(spec 2026-08-17, 문장형·음식 비유는 2026-08-18 개정). 값이
            // 없으면 행이 없다 — 부재를 설명하지 않는다. 걸음·칼로리·비유는 한 문단이라
            // 한 접근성 객체(joinText). 도착 낭독 문장에는 넣지 않는다.
            if let health = model.arrivalHealth {
                // 완결 문장끼리라 공백으로 잇는다(joinText의 쉼표는 라벨·값 조각용 — 마침표
                // 뒤에 쉼표가 붙는다).
                focusTarget(Text([
                    healthSummaryLine(health: health, showsPrompt: showsWeightPrompt),
                    Self.foodLine(kcal: health.kcal),
                ].compactMap { $0 }.joined(separator: " ")), .healthSummary)
                // 체중 미입력자에게만, 그것도 무시 상한 전까지만: 기준값 고지 + 설정으로
                // 가는 버튼(입력한 사람에겐 이 두 줄이 없다 — 이미 아는 것을 다시 말하지
                // 않는다. 두 번 무시한 사람에게도 없다 — E31).
                if showsWeightPrompt {
                    Text(appLocalized("ios.beacon.healthWeightNotice", "\(Int(WalkHealth.defaultWeightKg))"))
                    Button(appLocalized("ios.beacon.healthEnterWeight")) {
                        weightPromptEngaged = true
                        showsSettings = true
                    }
                }
            }
            // 자동차 도착 → 도보 인계(K2 §6.4): 대중교통 하차 인계 틀, 걸음 요약 없음.
            if model.arrivalSessionKind == .car, let onCarWalkHandoff {
                Button(appLocalized("ios.beacon.carWalkHandoffStart"), action: onCarWalkHandoff)
            }
            if model.endKind != .stopped {
                SurroundingsSceneSection(
                    anchor: (lat: dest.lat, lng: dest.lng), proxy: proxy)
            }
            Button(appLocalized("actions.close")) {
                // 권유가 실제로 떠 있던 화면을 아무 행동 없이 닫은 것만 무시로 센다(E31).
                // 표식은 여기서 소비한다 — 이 화면의 응답이 다음 화면으로 새지 않게.
                // ⚠ 순서가 load-bearing이다: `clearArrival()`이 먼저 돌면 `arrivalHealth`가
                // nil이 되어 `showsWeightPrompt`가 false로 떨어지고 카운터가 영영 오르지
                // 않는다(기능이 조용히 죽는다). 가드 `weight-prompt-wiring.test.ts`.
                weightPromptDismissals = WalkHealth.nextWeightPromptDismissals(
                    current: weightPromptDismissals,
                    promptShown: showsWeightPrompt,
                    promptEngaged: weightPromptEngaged)
                weightPromptEngaged = false
                model.clearArrival()
            }
        } header: {
            Text(joinText(endHeading, model.destinationLabel))
                .accessibilityAddTraits(.isHeader)
        }
    }

    /// 이번 종료 화면이 체중 입력 권유를 내고 있는가. **렌더와 [닫기]가 같은 술어를 읽는다** —
    /// 두 자리가 각자 조건을 조립하면 "표시되지 않았는데 셌다"가 조용히 생긴다.
    private var showsWeightPrompt: Bool {
        WalkHealth.shouldShowWeightPrompt(
            usedDefaultWeight: model.arrivalHealth?.usedDefaultWeight ?? false,
            dismissals: weightPromptDismissals)
    }

    /// 걸음·칼로리 문장. 권유가 숨겨진 뒤(체중 미입력·무시 상한)에는 기준 체중이 이 문장
    /// 안으로 들어온다 — 줄을 늘리지 않고 수치의 근거를 남긴다(위원장 판정 2026-09-10).
    /// 체중을 입력한 사용자는 종전 문장 그대로다(두 벌 키).
    private func healthSummaryLine(health: WalkHealthSummary, showsPrompt: Bool) -> String {
        let steps = Self.decimal.string(from: NSNumber(value: health.steps)) ?? "\(health.steps)"
        if health.usedDefaultWeight, !showsPrompt {
            return appLocalized(
                "ios.beacon.healthSummaryWithWeight",
                steps,
                "\(Int(WalkHealth.defaultWeightKg))",
                "\(health.kcal)")
        }
        return appLocalized("ios.beacon.healthSummary", steps, "\(health.kcal)")
    }

    private var endSentence: String {
        switch model.endKind {
        case .arrived: appLocalized("guide.arrived")
        case .presumed: appLocalized("guide.arrivedPresumed")
        case .stopped: model.endText
        }
    }

    // 키는 리터럴로만 (check-xcstrings-keys 린터 계약).
    private var endHeading: String {
        switch model.endKind {
        case .arrived: appLocalized("ios.beacon.arrivedHeading")
        case .presumed: appLocalized("ios.beacon.arrivedPresumedHeading")
        case .stopped: appLocalized("ios.beacon.endedHeading")
        }
    }

    /// 칼로리 → 음식 비유 문장. 판정은 Kit `WalkHealth.foodComparison`(비율 최근접), 여기는
    /// 키를 문자열 리터럴로만 잇는다(check-xcstrings-keys 린터 계약 — 동적 조립 금지).
    /// 사다리에 항목을 더하면 이 switch도 함께 늘린다(누락은 default가 nil로 삼킨다).
    static func foodLine(kcal: Int) -> String? {
        guard let food = WalkHealth.foodComparison(kcal: kcal) else { return nil }
        if food.count > 1 {
            switch food.key {
            case "ramyeon": return appLocalized("ios.beacon.food.ramyeonMany", food.count)
            default: return nil
            }
        }
        switch food.key {
        case "cherryTomato": return appLocalized("ios.beacon.food.cherryTomato")
        case "cucumberHalf": return appLocalized("ios.beacon.food.cucumberHalf")
        case "kimchi": return appLocalized("ios.beacon.food.kimchi")
        case "tangerine": return appLocalized("ios.beacon.food.tangerine")
        case "boiledEgg": return appLocalized("ios.beacon.food.boiledEgg")
        case "apple": return appLocalized("ios.beacon.food.apple")
        case "banana": return appLocalized("ios.beacon.food.banana")
        case "riceHalfBowl": return appLocalized("ios.beacon.food.riceHalfBowl")
        case "hotteok": return appLocalized("ios.beacon.food.hotteok")
        case "riceBowl": return appLocalized("ios.beacon.food.riceBowl")
        case "ramyeon": return appLocalized("ios.beacon.food.ramyeon")
        default: return nil
        }
    }

    /// 걸음 수 천 단위 구분. 문장이 `appLocalized`(앱 선택 언어)로 나가므로 구분자도
    /// 기기 로케일이 아니라 앱 언어를 따른다(`SpeechService` 선례). 언어 전환에 따라가도록 매 호출 생성.
    private static var decimal: NumberFormatter {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: AppLanguage.current)
        return f
    }

    // MARK: - 착지 (E57, spec 2026-09-30-guide-sheet-info-row-landing)

    /// 착지 대상이 지금 렌더되는가 — 행 렌더 조건의 사본이다(대중교통 `controlExists` 동형). 렌더 조건을 바꾸면
    /// 여기도 바꾼다(가드 `guide-sheet-landing-guard.test.ts`가 짝을 본다).
    private func rowExists(_ row: SheetFocus) -> Bool {
        let tracking = model.arrivalDest == nil
        switch row {
        case .remaining: return tracking && model.mode == .detail && !model.offRoute && model.remainingText != nil
        case .liveTop: return tracking && model.mode == .detail && model.liveTopText != nil
        case .status: return tracking && model.mode == .brief && !model.statusText.isEmpty
        case .reroute: return tracking && model.offRoute
        case .arrived: return !tracking
        case .healthSummary: return !tracking && model.arrivalHealth != nil
        }
    }

    /// 지금 렌더된 정보 행 — 소실 복구가 이 집합의 변화로 판정한다(spec §3.4).
    private var presentInfoRows: Set<SheetFocus> {
        Set([SheetFocus.remaining, .liveTop, .status].filter(rowExists))
    }

    /// 첫 정보 행(spec §2.1) — 화면의 행 순서 그대로다. 추적 중엔 비지 않는다(상세면 윗줄, 간략이면 상태 문장이
    /// 선다). 그래도 nil이면 착지하지 않는다 — 제목으로 올리는 것은 요청과 반대 방향이다(a11y 감사 LOW).
    private var firstInfoRow: SheetFocus? {
        [SheetFocus.remaining, .liveTop, .status].first(where: rowExists)
    }

    /// 시트 위에 떠 있는 다른 시트 — 그동안은 착지하지 않는다(커서가 그 시트 안이다).
    private var subSheetPresented: Bool {
        showRouteList || changeDestPresented || waypointPresented || showPlaceDetail || showsSettings
    }

    /// 전경인가 — 대입 시점의 실제 값이다(모델 `isForeground`와 같은 식). `@Environment` scenePhase는 Task가 잡은
    /// 사본이라 대기 뒤엔 낡는다(코드 리뷰 M1).
    private static var isForeground: Bool { UIApplication.shared.applicationState != .background }

    /// 대기를 세운 뒤 VoiceOver 초점 이동을 사용자 이동으로 세지 않는 창(시스템이 커서를 두는 시간).
    private static let systemFocusGrace: TimeInterval = 1.0
    /// 경로 조회를 기다리는 상한. 위치 대기(`noFixTimeout` 15초) + 조회 왕복. 넘기면 착지하지 않는다.
    private static let routeWaitLimit: Duration = .seconds(20)
    /// 통지 발화를 기다리는 상한(ms). 첫 안내를 담은 긴 요약도 이 안에 끝난다. 통지가 버려져 완료 신호가 오지 않는
    /// 경우의 안전망이다.
    private static let summaryWaitLimitMs = 12_000

    /// 경로 조회·통지 발화를 기다리는 첫 정보 행 착지(spec §3.3).
    private struct PendingInfoLanding {
        let since: TimeInterval
        let note: String
        /// 이 시각 **이후에** 끝난 `statusText` 발화를 기다린다. nil이면 기다리지 않는다(경로 조회 중이면 커밋 시각이 채운다).
        var summarySince: TimeInterval?
        /// 기다리는 동안 사용자가 커서를 옮겼다(설계 리뷰 M4) — 그러면 착지하지 않는다.
        var userMoved = false
    }

    /// 자식 시트가 닫힌 뒤의 착지(설계 리뷰 M3).
    private struct DismissLanding {
        let note: String
        let since = ProcessInfo.processInfo.systemUptime
        /// 그 전이가 경로를 다시 조회·커밋해 요약 통지를 내는가(같은 곳을 다시 고르면 없다).
        let expectsSummary: Bool
        /// nil이면 첫 정보 행. 도착처럼 대상이 정해진 착지만 값을 준다.
        var target: SheetFocus? = nil
    }

    /// 관찰 대상이 아닌 참조 상자(코드 리뷰 m6).
    @MainActor final class LandingBox {
        var finished: (text: String, at: TimeInterval)?
        var routeCommittedAt: TimeInterval?
        var proxy: ScrollViewProxy?
    }

    /// 첫 정보 행 착지 요청 — 시트 열림·띠바 복귀·사용자 전이·소실 복구의 공통 입구.
    /// `summarySince`: 이 전이가 통지를 냈다면 그 시각 — 그 발화가 **끝난 뒤** 착지한다(설계 리뷰 M1: 착지 낭독이
    /// 통지를 끊을 수 있다는 것이 이 저장소의 전제다, 도착 착지 주석). 경로 조회 중이면 조회가 끝날 때까지 먼저
    /// 기다리고, 그 커밋의 요약을 기다린다.
    private func requestInfoLanding(note: String, summarySince: TimeInterval?) {
        guard model.arrivalDest == nil else { return }
        focusTask?.cancel()
        clearPendingInfoLanding()
        guard summarySince != nil || model.awaitingRoute else {
            landFirstInfoRow(note: note)
            return
        }
        let since = ProcessInfo.processInfo.systemUptime
        pendingInfoLanding = PendingInfoLanding(since: since, note: note, summarySince: summarySince)
        guard model.awaitingRoute else {
            resolvePendingInfoLanding()
            return
        }
        pendingTimeoutTask = Task { @MainActor in
            try? await Task.sleep(for: Self.routeWaitLimit)
            guard !Task.isCancelled, pendingInfoLanding?.since == since, model.awaitingRoute else { return }
            pendingInfoLanding = nil
            logFocus("target=pending reason=timeout", note: note)
        }
    }

    /// 기다릴 조회가 없다 — `summarySince` 이후에 끝난 `statusText` 발화(게시 창구가 `spokenUnits`를 지난다)를 본 뒤 그때의
    /// 첫 정보 행에 앉는다. VoiceOver가 꺼져 있거나 운전자 채널(기기 음성이라 완료 신호가 없다)이면 기다리지 않는다.
    private func resolvePendingInfoLanding() {
        guard let pending = pendingInfoLanding else { return }
        pendingTimeoutTask?.cancel()
        announcementWaitTask?.cancel()
        let expected = spokenUnits(model.statusText)
        let driverChannel = model.sessionKind == .car && model.listener == .driver
        let waitsSummary = pending.summarySince != nil && UIAccessibility.isVoiceOverRunning
            && !expected.isEmpty && !driverChannel
        announcementWaitTask = Task { @MainActor in
            var waited = 0
            while waitsSummary, waited < Self.summaryWaitLimitMs,
                  !(landingBox.finished.map { $0.text == expected && $0.at >= (pending.summarySince ?? 0) } ?? false) {
                try? await Task.sleep(for: .milliseconds(100))
                guard !Task.isCancelled else { return }
                waited += 100
            }
            guard !Task.isCancelled, let current = pendingInfoLanding, current.since == pending.since else { return }
            pendingInfoLanding = nil
            guard model.isTracking, model.arrivalDest == nil else { return }
            let waitedMs = Int((ProcessInfo.processInfo.systemUptime - current.since) * 1000)
            guard !current.userMoved else {
                logFocus("target=pending reason=userMoved waitedMs=\(waitedMs)", note: current.note)
                return
            }
            landFirstInfoRow(note: current.note, waitedMs: waitedMs)
        }
    }

    private func landFirstInfoRow(note: String, waitedMs: Int = 0) {
        guard let row = firstInfoRow else {
            logFocus("target=none reason=noInfoRow", note: note)
            return
        }
        landFocus(row, note: note, waitedMs: waitedMs)
    }

    private func clearPendingInfoLanding() {
        pendingInfoLanding = nil
        pendingTimeoutTask?.cancel()
        announcementWaitTask?.cancel()
    }

    /// 자식 시트가 닫힌 뒤 한 곳(설계 리뷰 M3) — 그 안에서 일어난 전이의 착지. 아무 전이 없이 열고 닫았으면 표식이
    /// 없어 시스템의 트리거 복원 그대로다. 경로를 다시 조회하는 전이는 조회 중이면 그 커밋을, 이미 끝났으면 고른
    /// 시각 이후의 요약을 기다린다.
    private func landAfterSubSheet() {
        guard let landing = landAfterDismiss else { return }
        landAfterDismiss = nil
        if let target = landing.target {
            landFocus(target, note: landing.note)
        } else {
            requestInfoLanding(note: landing.note, summarySince: landing.expectsSummary ? landing.since : nil)
        }
    }

    /// 착지 부착 헬퍼 — `focusedRow` 바인딩의 **유일한 부착 자리**(가드가 개수를 센다). `.id`는 가시화 키다.
    private func focusTarget<V: View>(_ view: V, _ target: SheetFocus) -> some View {
        view
            .accessibilityFocused($focusedRow, equals: target)
            .id(Self.focusId(target))
    }

    private static func focusId(_ target: SheetFocus) -> String { "beacon-focus-\(target)" }

    /// 착지 — 지연 400ms · 가시화 · 대입 · 600ms 뒤 검증 · 1회 재시도(이 저장소의 2단 정본, 대중교통 시트만 3단이다 —
    /// PATTERNS "iOS 목록 포커스 이동": 승격 조건은 실승차 성공률, 설계 리뷰 M5). 가시화(`scrollTo`)는 큰 글자에서 행이
    /// 화면 밖이면 AX 트리에서 컬링되기 때문이다(a11y 감사 M3). **폴백 통지는 없다**(spec §3.2): 정보 행의 폴백 문장은
    /// 곧 그 행의 값이라 같은 순간의 통지와 겹친다. 실패는 로그로만 판정한다.
    private func landFocus(_ target: SheetFocus, note: String = "", waitedMs: Int = 0) {
        focusTask?.cancel()
        landingInFlight = nil
        guard Self.isForeground else {
            deferredLanding = target
            logFocus("target=\(target) reason=background deferred=true", note: note)
            return
        }
        guard !subSheetPresented else {
            logFocus("target=\(target) reason=modal", note: note)
            return
        }
        deferredLanding = nil
        landingGen += 1
        let gen = landingGen
        landingInFlight = target
        focusTask = Task { @MainActor in
            defer { if landingGen == gen { landingInFlight = nil } }
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            guard rowExists(target) else {
                logFocus("target=\(target) reason=vanished", note: note)
                return
            }
            landingBox.proxy?.scrollTo(Self.focusId(target))
            focusedRow = target
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            var attempts = 1
            // 먹지 않았을 때만 1회 재시도(무한 재대입은 커서를 붙잡아 되레 방해가 된다).
            if focusedRow != target, rowExists(target) {
                attempts = 2
                landingBox.proxy?.scrollTo(Self.focusId(target))
                focusedRow = target
                try? await Task.sleep(for: .milliseconds(600))
                guard !Task.isCancelled else { return }
            }
            logFocus(
                "target=\(target) landed=\(focusedRow == target) actual=\(focusedRow.map { "\($0)" } ?? "nil")"
                    + " attempts=\(attempts) waitedMs=\(waitedMs) vo=\(voFocusedLabel().map { "\"\($0)\"" } ?? "nil")",
                note: note)
        }
    }

    /// 착지 계측 한 줄(spec §4) — 도보·자동차 `guide-diag.log`. 릴리스 빌드는 no-op.
    private func logFocus(_ body: String, note: String) {
        guideDiagLog("sheetFocus sheet=beacon \(body)" + (note.isEmpty ? "" : " note=\(note)"))
    }

}
