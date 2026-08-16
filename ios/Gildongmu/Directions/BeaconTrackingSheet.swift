import GildongmuKit
import SwiftUI

/// 실시간 길 안내 중 화면. **시작이 곧 이 시트의 표시이고, 중지가 곧 닫힘이다(1:1)** —
/// 단 하나의 예외가 도착 종료 화면이다(아래).
///
/// 인라인 섹션에서 분리한 이유는 걷는 중의 탐색 비용이다. 길찾기 결과 화면에는 수단
/// 섹션이 이어지고 도보는 인라인 전개라 수백 행이 될 수 있어(천호역 실측), 추적을
/// 멈추려면 그 목록 안에서 버튼을 찾아야 했다. 시트는 VoiceOver 스코프를 이 화면으로
/// 가두므로 스와이프 몇 번이면 상태와 중지 버튼에 닿는다(위원장 실보행 피드백 2026-08-02).
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
    /// 목적지 전환 확정 통보(스펙 2026-08-12 §5) — 탭이 폼 동기화(도착지 필드·무통지
    /// 재조회)를 맡는다. 세션에 반영되지 않은 선택(§3.2)은 통보하지 않는다.
    let onDestinationCommitted: (DirectionsEndpoint) -> Void

    @Environment(\.dismiss) private var dismiss
    @AccessibilityFocusState private var stopFocused: Bool
    /// 도착 종료 화면의 도착 문장 착지(헌장 §5 — 도착 전이가 포커스를 쥔 컨트롤을
    /// 통째로 제거한다).
    @AccessibilityFocusState private var arrivedFocused: Bool
    /// 전 구간 조망 모달(위원장 판정 개정 2026-08-10): 인라인 펼침은 같은 화면의
    /// 탐색 개체를 너무 늘렸다 — 별도 시트로 스코프를 가둬 "딱 확인하고 닫기"가
    /// 성립한다. 닫으면 시스템이 트리거 버튼으로 포커스를 복원한다(표준 dismiss).
    @State private var showRouteList = false
    /// 목적지 검색 시트(스펙 §3) — 열린 동안 톤·통지 전부 억제(받아쓰기 마이크).
    @State private var changeDestPresented = false
    /// 장소 상세 시트(스펙 §2) — 안내 신호는 유지(억제 없음, 임박 큐는 안전 계층).
    @State private var showPlaceDetail = false
    /// 재조회 버튼을 눌렀다는 표식. 성공(offRoute 해제)으로 버튼이 사라질 때 커서를
    /// 중지 버튼으로 되돌리는 근거(사용자가 누른 결과로 사라지는 경로만 결정론 처리).
    @State private var reroutePressed = false

    var body: some View {
        // "더 보기" 가시화용 proxy(WhereAmIView 동형 래핑 — List는 화면 밖 행을
        // AX 트리에서 컬링하므로 scrollTo 선행이 필요하다).
        ScrollViewReader { proxy in
        List {
            if let arrival = model.arrivalDest {
                arrivalSection(dest: arrival, proxy: proxy)
            } else {
            Section {
                Button(appLocalized("beacon.stop"), action: onStop)
                    .accessibilityFocused($stopFocused)
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
                // 재조회: 이탈 확정 시에만 노출. 자동 재조회 금지(스펙 §5.6)의 수동 출구.
                // 진행 신호는 라벨 교체가 정본(라벨이 곧 상태 신호 — 별도 통지 중복 금지).
                // 성공하면 이 버튼 자체가 사라지므로, 누른 결과로 사라질 때는 항상
                // 존재하는 중지 버튼으로 포커스를 되돌린다(헌장 §5, a11y 감사 HIGH).
                if model.offRoute {
                    // 제안이 준비되면 같은 버튼의 라벨만 바뀐다(E10ⓑ — 별도 버튼
                    // 추가 금지: SR 읽기 순서 비용. 라벨이 지속 신호의 정본이다).
                    Button(appLocalized(
                        model.isRerouting ? "guide.rerouteBusy"
                            : model.hasPreparedProposal ? "guide.proposalAdopt"
                            : "guide.rerouteButton"
                    )) {
                        reroutePressed = true
                        model.requestReroute()
                    }
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
                if model.mode == .detail, !model.offRoute, let remaining = model.remainingText {
                    distanceText(remaining)
                }
                // 하단 2행(spec 2026-08-11, walk 상세 전용): 윗줄 = 현재 행동(동적
                // 카운트다운·상태 대체·최종 접근 문형), 아랫줄 = 다음 예고. 이탈 중에도
                // 가리지 않는다 — 리듀서가 윗줄(이탈 문장)·아랫줄(비움)을 소유한다(F2).
                // 낭독은 distanceText(spokenDistanceUnits) 경유, live region 없음 —
                // 능동 통지는 모델의 단일 Announcement 채널이 담당한다(이중 낭독 금지).
                if model.sessionKind == .walk, model.mode == .detail {
                    if let top = model.liveTopText { distanceText(top) }
                    if let next = model.liveNextText {
                        distanceText(next).foregroundStyle(.secondary)
                    }
                } else {
                    // car·간략 세션은 종전 행 유지(spec §7 비범위). walk 상세의 statusText
                    // 중 fail·handoff는 모드가 brief/idle로 바뀌어 이 분기가 받고, 복귀·
                    // 재획득 해소·속도 제안 같은 1회 확인 문장은 **의도적으로 화면에 남지
                    // 않는다**(spec §2-1 상태 행 폐지 — 시각 신호는 윗줄이 상태 문장에서
                    // 그 자리 숫자로 되돌아오는 전환 자체다. 리뷰 지적 기각 근거,
                    // 실사용 판정은 BACKLOG H M0 축 4).
                    if model.mode == .detail, !model.offRoute,
                       let current = model.currentGuidanceText {
                        distanceText(current)
                    }
                    if !model.statusText.isEmpty {
                        distanceText(
                            model.statusIsNextPreview
                                ? appLocalized("guide.progressNext", model.statusText)
                                : model.statusText
                        ).foregroundStyle(.secondary)
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
                GuideTitleMenu(
                    heading: appLocalized(
                        model.sessionKind == .car ? "beacon.carHeading" : "beacon.walkHeading"
                    ),
                    label: model.destinationLabel,
                    onShowDetail: { showPlaceDetail = true },
                    onChangeDestination: { changeDestPresented = true })
            }
            }
        }
        .task { await landStopFocus() }
        // 전 구간 조망 모달(판정 개정 2026-08-10). 시트 위 시트는 표준 중첩 표시.
        .sheet(isPresented: $showRouteList) { RouteOverviewSheet(model: model) }
        // 목적지 검색(스펙 §3): 최근 목록 포함 기존 시트 재사용. 세션이 죽었으면
        // changeDestination이 false를 돌려 폼도 건드리지 않는다(§3.2 확정 가드).
        .sheet(isPresented: $changeDestPresented) {
            DirectionsEndpointSearchView(target: .to) { endpoint in
                guard case .place(let label, let lat, let lng) = endpoint else { return }
                if model.changeDestination(dest: BeaconDest(lat: lat, lng: lng), label: label) {
                    onDestinationCommitted(endpoint)
                }
                // 검색 시트가 닫히면 중지 버튼 착지(§3.3 — dismiss 후 지연·검증·재시도 정본).
                Task { await landStopFocus() }
            }
        }
        // 검색 시트에 받아쓰기 마이크가 있다 — 열린 동안 톤·통지 전부 억제(스펙 §5.4,
        // 메인 화면 검색 시트의 outputSuppressed 계약 동형).
        .onChange(of: changeDestPresented) { _, presented in
            model.outputSuppressed = presented
        }
        // 장소 상세(스펙 §2): 표준 중첩 시트. 목적지는 이름+좌표뿐이라 최소 Place로
        // 열고, 길찾기 진입 버튼은 숨긴다(이미 그곳으로 안내 중).
        .sheet(isPresented: $showPlaceDetail) {
            if let dest = model.dest {
                NavigationStack {
                    PlaceDetailView(
                        place: guideDestinationPlace(dest: dest, label: model.destinationLabel),
                        showsDirectionsEntry: false)
                }
            }
        }
        // 재조회 성공으로 버튼이 사라진 순간 커서를 중지 버튼으로(헌장 §5 이탈 방지).
        .onChange(of: model.offRoute) { _, isOff in
            guard !isOff, reroutePressed else { return }
            reroutePressed = false
            Task { await landStopFocus() }
        }
        // 프리뷰 채택 성공: 조망(과 그 위 프리뷰)을 닫고 중지 버튼으로 복귀(spec
        // 2026-08-14 §4 — 포커스를 쥔 시트가 통째로 사라지는 전이, 재조회 성공 동형).
        .onChange(of: model.variantAdoptedSeq) {
            showRouteList = false
            Task { await landStopFocus() }
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
            Task { await landArrivedFocus() }
        }
        }
    }

    /// 도착 종료 화면(위원장 판정 2026-08-11). 헤딩이 무엇에 도착했는지를, 본문
    /// 첫 행이 도착 사실을, 주변 확인이 다음 행동을 담는다. 닫기는 표준 dismiss —
    /// presentation 바인딩이 `clearArrival()`로 소거한다(스와이프·VO escape 동일).
    private func arrivalSection(dest: BeaconDest, proxy: ScrollViewProxy) -> some View {
        Section {
            // 확정/추정 분기(3-state 정직성, spec 2026-08-13 §4-5): 추정 종료를
            // 확정 도착과 뭉개지 않는다.
            Text(appLocalized(
                model.arrivalPresumed ? "guide.arrivedPresumed" : "guide.arrived"
            ))
                .accessibilityFocused($arrivedFocused)
            // 걸음·칼로리 요약(spec 2026-08-17). 값이 없으면 행이 없다 — 부재를 설명하지
            // 않는다. 한 줄 = 한 접근성 객체(joinText). 도착 낭독 문장에는 넣지 않는다.
            if let health = model.arrivalHealth {
                Text(joinText(
                    appLocalized(
                        "ios.beacon.healthSummary",
                        Self.decimal.string(from: NSNumber(value: health.steps)) ?? "\(health.steps)",
                        "\(health.kcal)"),
                    health.usedDefaultWeight
                        ? appLocalized("ios.beacon.healthDefaultWeight", "\(Int(WalkHealth.defaultWeightKg))")
                        : nil
                ))
            }
            SurroundingsSceneSection(
                anchor: (lat: dest.lat, lng: dest.lng), proxy: proxy)
            Button(appLocalized("actions.close")) { dismiss() }
        } header: {
            Text(joinText(
                appLocalized(
                    model.arrivalPresumed
                        ? "ios.beacon.arrivedPresumedHeading" : "ios.beacon.arrivedHeading"
                ),
                model.destinationLabel
            ))
            .accessibilityAddTraits(.isHeader)
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

    /// 도착 문장 착지 — 지연·검증·1회 재시도(`landStopFocus` 동형).
    private func landArrivedFocus() async {
        try? await Task.sleep(for: .milliseconds(400))
        arrivedFocused = true
        try? await Task.sleep(for: .milliseconds(600))
        guard !arrivedFocused else { return }
        arrivedFocused = true
    }

    /// 열릴 때 포커스를 **중지 버튼**에 둔다. 걷는 중 필요한 유일한 행동이고, 시트
    /// 수명 내내 존재해 헌장 §5의 "포커스를 쥔 요소가 사라지는 전이"가 생기지 않는다.
    /// (실기기에서는 시스템이 섹션 헤딩에 착지시키는 것을 위원장이 수용 — 재조정 금지.)
    ///
    /// 지연·검증·1회 재시도는 이 저장소의 검증된 착지 패턴을 따른다(`ChatConversationView`·
    /// `landFocusAfterResolve`). 시트 표시 애니메이션이 끝나며 시스템이 포커스를 옮기므로
    /// 그보다 늦게 대입해야 이긴다.
    private func landStopFocus() async {
        try? await Task.sleep(for: .milliseconds(400))
        stopFocused = true
        try? await Task.sleep(for: .milliseconds(600))
        // 먹지 않았을 때만 1회 재시도(무한 재대입은 커서를 붙잡아 되레 방해가 된다).
        guard !stopFocused else { return }
        stopFocused = true
    }

}

/// 전 구간 조망 모달(위원장 판정 개정 2026-08-10 — 인라인 펼침에서 전환).
///
/// 조망 문장(서수+잔여+현재+다음)은 **섹션 헤더가 전달한다**: 시트 표시와
/// Announcement는 경합하므로(착지 낭독이 통지를 잠식) 발화 채널 대신, 시스템이
/// 섹션 헤딩에 착지하는 실기기 선례(BeaconTrackingSheet 열림)를 그대로 쓴다.
/// 헤더는 fix 갱신에 따라 조용히 최신화된다(live region 아님 — 조회형 정보).
///
/// 행은 "{n}. {스텝}" 단일 텍스트(한 줄 = 한 객체), 현재 구간 행만 "지금 이 구간"
/// 표식. 닫기는 스와이프·VO escape·말미 닫기 버튼 — 닫으면 시스템이 트리거
/// 버튼(진행 상황)으로 포커스를 복원한다(표준 dismiss, 실기기 확인은 BACKLOG ⑤).
private struct RouteOverviewSheet: View {
    let model: BeaconModel
    @Environment(\.dismiss) private var dismiss
    /// 대안 경로 프리뷰(spec 2026-08-14 §3) — 시트 위 시트(조망과 같은 문법).
    @State private var showAltPreview = false

    var body: some View {
        List {
            Section {
                // 자동 인계 등으로 모달이 열린 채 상세가 풀리면 목록만 비고 헤더가
                // 그 시점의 정직한 진행 상황(직선거리)을 계속 전달한다(3-state).
                if let steps = model.routeStepDescriptions {
                    // 상단 닫기(위원장 판정 2026-08-10): 행 수가 많으면 말미 닫기까지
                    // 스크롤 압박 — 헤더 착지(조망 낭독) 다음 한 스와이프에 출구를 둔다.
                    // 나브바 toolbar 닫기(ChatView 관례)를 쓰지 않는 이유: 나브바 요소는
                    // 섹션 헤더보다 먼저 착지 후보가 되어 "모달 착지 = 조망 낭독" 계약을
                    // 깬다. 말미 닫기는 유지(전 구간을 훑고 난 자리에서 되스크롤 방지).
                    Button(appLocalized("actions.close")) { dismiss() }
                    ForEach(Array(steps.enumerated()), id: \.offset) { i, desc in
                        if i == model.currentStepIndex {
                            distanceText(appLocalized(
                                "ios.guide.routeListCurrent", String(i + 1), desc
                            ))
                        } else {
                            distanceText(appLocalized(
                                "ios.guide.routeListRow", String(i + 1), desc
                            ))
                        }
                    }
                }
                // 대안 경로 보기(spec 2026-08-14 §2): 스텝 목록 뒤·말미 닫기 앞 —
                // 조망의 주 목적(진행 확인)을 밀지 않으면서 "조망하다 대안 탐색"
                // 흐름과 읽기 순서가 일치한다. 노출은 반대 축 성립 세션만(죽은 버튼 금지).
                if model.alternativePreviewAvailable {
                    Button(appLocalized("guide.viewAlternative")) {
                        model.openAlternativePreview()
                        showAltPreview = true
                    }
                }
                Button(appLocalized("actions.close")) { dismiss() }
            } header: {
                distanceText(model.progressText())
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .sheet(isPresented: $showAltPreview) { AlternativeRoutePreviewSheet(model: model) }
        // 닫힘(스와이프·VO escape 포함) 시 진행 중 조회 폐기 — 늦은 응답이 닫힌
        // 화면 상태를 되살리지 않는다(spec 2026-08-14 §3 latest-wins). 도착 전이는
        // 부모(showRouteList=false)가 이 시트까지 연쇄 소거한다.
        .onChange(of: showAltPreview) { _, presented in
            if !presented { model.closeAlternativePreview() }
        }
    }
}

/// 대안 경로 미리 보기(spec 2026-08-14 §3·§4). 헤더(요약·비교) → 전환 버튼 →
/// 스텝 행 → 말미 닫기. 시스템 헤더 착지가 요약을 낭독하고(조망 선례), 결과 도착은
/// 모델의 polite 통지 1회가 알린다(헤더는 조용 갱신 — 조회형 정보). 전환 버튼이
/// 헤더 다음 한 스와이프인 이유: 이 화면의 결정 행동이고, 사용자가 능동적으로 연
/// 화면이라 압박 문제가 없다(spec §0-1의 압박은 "걷는 내내 상시 노출"이었다).
private struct AlternativeRoutePreviewSheet: View {
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
