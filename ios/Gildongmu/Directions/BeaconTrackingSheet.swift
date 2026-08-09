import GildongmuKit
import SwiftUI

/// 실시간 길 안내 중 화면. **시작이 곧 이 시트의 표시이고, 중지가 곧 닫힘이다(1:1).**
///
/// 인라인 섹션에서 분리한 이유는 걷는 중의 탐색 비용이다. 길찾기 결과 화면에는 수단
/// 섹션이 이어지고 도보는 인라인 전개라 수백 행이 될 수 있어(천호역 실측), 추적을
/// 멈추려면 그 목록 안에서 버튼을 찾아야 했다. 시트는 VoiceOver 스코프를 이 화면으로
/// 가두므로 스와이프 몇 번이면 상태와 중지 버튼에 닿는다(위원장 실보행 피드백 2026-08-02).
///
/// 컨트롤은 스펙 §4.2의 집합이 전부다: 중지·반복·진행 상황·전환(경로 보유 시)·
/// 재조회(이탈 시). "다음으로 건너뛰기"는 두지 않는다(선례 부재 + 사용자가 진행을
/// 주장하게 만드는 실패 모드, 조사 §5.4).
///
/// 스와이프·VoiceOver escape로 닫아도 추적이 멈춘다(`interactiveDismissDisabled` 미사용).
/// 걷는 중 오조작으로 꺼지는 위험보다, 시각장애 사용자가 닫을 수 없는 화면에 갇히는 쪽이
/// 나쁘다. 실수로 닫히면 다시 시작하면 된다.
struct BeaconTrackingSheet: View {
    let model: BeaconModel
    let onStop: () -> Void

    @AccessibilityFocusState private var stopFocused: Bool
    /// 전 구간 조망 모달(위원장 판정 개정 2026-08-10): 인라인 펼침은 같은 화면의
    /// 탐색 개체를 너무 늘렸다 — 별도 시트로 스코프를 가둬 "딱 확인하고 닫기"가
    /// 성립한다. 닫으면 시스템이 트리거 버튼으로 포커스를 복원한다(표준 dismiss).
    @State private var showRouteList = false
    /// 재조회 버튼을 눌렀다는 표식. 성공(offRoute 해제)으로 버튼이 사라질 때 커서를
    /// 중지 버튼으로 되돌리는 근거(사용자가 누른 결과로 사라지는 경로만 결정론 처리).
    @State private var reroutePressed = false
    /// 화면 켜기 힌트 영구 해제(피드백 라운드1 13번): 학습되면 잉여인 안내가 매 세션
    /// 한 행을 차지해 스와이프 비용을 늘렸다 — 첫 사용 안내 + "다시 보지 않음"으로.
    static let screenHintDismissedKey = "beaconScreenHintDismissed"
    @State private var screenHintDismissed =
        UserDefaults.standard.bool(forKey: BeaconTrackingSheet.screenHintDismissedKey)

    var body: some View {
        // "더 보기" 가시화용 proxy(WhereAmIView 동형 래핑 — List는 화면 밖 행을
        // AX 트리에서 컬링하므로 scrollTo 선행이 필요하다).
        ScrollViewReader { proxy in
        List {
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
                // 전환: 추적을 멈추지 않고 안내 방식만 바꾼다. 라벨이 곧 상태 신호.
                // 경로 미보유 세션(비-ko·조회 실패·타 수단)에선 미노출(죽은 컨트롤 금지).
                if model.canOfferDetail {
                    Button(appLocalized(
                        model.mode == .detail ? "guide.toBriefButton" : "guide.toDetailButton"
                    )) { model.toggleMode() }
                }
                // 재조회: 이탈 확정 시에만 노출. 자동 재조회 금지(스펙 §5.6)의 수동 출구.
                // 진행 신호는 라벨 교체가 정본(라벨이 곧 상태 신호 — 별도 통지 중복 금지).
                // 성공하면 이 버튼 자체가 사라지므로, 누른 결과로 사라질 때는 항상
                // 존재하는 중지 버튼으로 포커스를 되돌린다(헌장 §5, a11y 감사 HIGH).
                if model.offRoute {
                    Button(appLocalized(
                        model.isRerouting ? "guide.rerouteBusy" : "guide.rerouteButton"
                    )) {
                        reroutePressed = true
                        model.requestReroute()
                    }
                }
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
                // "현재 안내" 행(역할 고정 2행 분리, 위원장 판정 2026-08-10): 지금 따르는
                // 유닛 전문. 실행 안내 시점에만 갱신되고 아래 상태 1줄(주기 예고·임박·
                // 상태 전이)이 덮지 않는다. 이탈 중엔 낡은 투영이라 숨긴다(3-state 정직).
                if model.mode == .detail, !model.offRoute,
                   let current = model.currentGuidanceText {
                    distanceText(current)
                }
                // 잠금 중 무음 예고. 세션 내내 참인 지속 상태라 상태 1줄과 자리를
                // 다투지 않는다 — 시작 시 음성 1회는 놓치면 끝이고, 비-VO 사용자에게는
                // 이 행이 잠금 후 무음의 유일한 단서다.
                if model.soundDegraded {
                    Text(appLocalized("ios.beacon.soundBackgroundUnavailable"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                // 가시 상태 1줄. 통지는 모델의 단일 Announcement가 담당하므로 여기서
                // 다시 알리지 않는다(보이는 콘텐츠의 live region 복제 금지).
                if !model.statusText.isEmpty {
                    distanceText(model.statusText).foregroundStyle(.secondary)
                }
                if !screenHintDismissed {
                    Text(appLocalized("beacon.screenHint"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    // 해제 버튼 자신이 사라지는 전이 — 포커스를 상시 존재하는 중지
                    // 버튼으로 되돌린다(헌장 §5, 재조회 성공 경로와 동형).
                    Button(appLocalized("beacon.screenHintDismiss")) {
                        UserDefaults.standard.set(
                            true, forKey: BeaconTrackingSheet.screenHintDismissedKey
                        )
                        screenHintDismissed = true
                        Task { await landStopFocus() }
                    }
                }
            } header: {
                // 무엇을 추적 중인지가 화면에 있어야 한다. 시트로 분리되면서 주변 맥락이
                // 통째로 사라졌으므로 여기서만 알 수 있다. 수단 라벨(B1 §3.3)이 heading.
                Text(joinText(
                    appLocalized(
                        model.sessionKind == .car ? "beacon.carHeading" : "beacon.walkHeading"
                    ),
                    model.destinationLabel
                ))
                .accessibilityAddTraits(.isHeader)
            }
            // M1 부근 재구성 — 앵커는 **목적지** 좌표다(실시간 안내는 실좌표를 쓰지만
            // 이 기능은 "도착지 부근이 어떤 모습인가"를 묻는다, spec §5). 컨트롤·상태
            // 행 뒤 별도 Section: 결과가 펼쳐져도 중지 버튼~상태 행 묶음이 밀리지
            // 않는다(걷는 중 탐색 비용, 웹 DistanceBeacon 말미 배치 미러).
            if let dest = model.dest {
                Section {
                    SurroundingsSceneSection(
                        anchor: (lat: dest.lat, lng: dest.lng), proxy: proxy)
                }
            }
        }
        .task { await landStopFocus() }
        // 전 구간 조망 모달(판정 개정 2026-08-10). 시트 위 시트는 표준 중첩 표시.
        .sheet(isPresented: $showRouteList) { RouteOverviewSheet(model: model) }
        // 재조회 성공으로 버튼이 사라진 순간 커서를 중지 버튼으로(헌장 §5 이탈 방지).
        .onChange(of: model.offRoute) { _, isOff in
            guard !isOff, reroutePressed else { return }
            reroutePressed = false
            Task { await landStopFocus() }
        }
        }
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

    var body: some View {
        List {
            Section {
                // 자동 인계 등으로 모달이 열린 채 상세가 풀리면 목록만 비고 헤더가
                // 그 시점의 정직한 진행 상황(직선거리)을 계속 전달한다(3-state).
                if let steps = model.routeStepDescriptions {
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
                Button(appLocalized("ios.guide.routeListClose")) { dismiss() }
            } header: {
                distanceText(model.progressText())
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }
}
