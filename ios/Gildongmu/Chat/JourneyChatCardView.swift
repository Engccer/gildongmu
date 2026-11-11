import SwiftUI
import GildongmuKit

/// 채팅 여정 카드(E70-b 실험판, spec `2026-11-12-e70b-chat-journey-design.md` P1·D10·D11·D13·D14·D15·D16).
///
/// 읽기 순서: 제목 → (지정한 역으로 못 찾았으면) 그 사실 줄 → 합계 → [안내 시작] → [길찾기에서 열기]. 줄마다 한 접근성 객체다.
/// - 제목·못 찾음 줄·합계는 길찾기 결과 화면(`JourneyResultRows`)과 같은 함수·같은 문자열이다. 싣는 계획은 추천 순서 첫 변형
///   (`variants[0]`)과 첫 출구다(그 화면의 기본 선택과 같다). 구간·다른 경로·출구는 [길찾기에서 열기]로 간다.
/// - 제목은 heading이 아니다(D15) — 턴 점프는 질문 heading이 맡고, 답 안의 heading은 회전자를 오염시킨다.
/// - 수동 지정 위치에서 조회한 여정(`manualOrigin`)에도 [안내 시작]을 둔다(E70-b2 ③, D2 대체): 실제 위치를 받아 카드의 결과로
///   시작하지 않고 길찾기 탭에서 현재 위치 기준으로 다시 조회한다(길찾기 화면의 「막지 않고 알린다」와 같은 쪽).
/// - 이 뷰는 `AppConfig.experimentalJourneyEnabled` 뒤에서만 그려지고(`ChatConversationView`), 두 동작도 같은 봉인을 한 번 더 확인한다.
/// - 측위를 기다리는 동안 버튼을 `disabled`로 만들지 않는다 — 포커스가 버튼에 남아야 한다(재진입은 `busy` 가드로 막는다).
struct JourneyChatCardView: View {
    let payload: JourneyChatPayload

    /// 재진입 가드(웹 in-flight ref 미러). 측위 대기 중 재탭은 무시하고, 시각 표식(흐림)만 바꾼다.
    @State private var busy = false
    /// 측위를 기다리는 [안내 시작]의 Task. 카드가 화면에서 사라지면(탭 이탈·대화 폐기) 취소해 뒤늦은 시작·탭 전환·재조회를 막는다
    /// (웹 `PlaceSearch`의 "그 선택이 이긴다"와 같은 뜻, S1).
    @State private var startTask: Task<Void, Never>?

    private var variant: JourneyVariant? { payload.result.variants.first }
    /// 첫 출구(= 서버 기본 출구). 역 B 미지정이면 nil.
    private var egress: EgressOption? { variant?.egress?.options.first }

    var body: some View {
        if let variant {
            // 변형이 없는 결과는 서버가 카드로 보내지 않는다 — 깨진 payload는 빈 카드 대신 그리지 않는다.
            let lines = journeyLineQualifiers(payload.result, board: payload.board, alight: payload.alight)
            VStack(alignment: .leading, spacing: 6) {
                Text(journeyVariantHeading(variant, board: payload.board, alight: payload.alight, lines: lines))
                    .fontWeight(.semibold)
                ForEach(journeyMissingLines(payload.result, board: payload.board, alight: payload.alight), id: \.self) {
                    Text($0).font(.subheadline)
                }
                Text(journeyTotalsLine(variant, egress: egress, aboard: false)).font(.subheadline)
                // 측위를 기다리는 동안 라벨이 바뀌는 것이 VoiceOver 신호 하나다(S2, 헌장 §5 — 포커스는 버튼에 남고 별도 통지는 없다).
                Button(busy ? appLocalized("directions.locating") : appLocalized("beacon.start")) { start(variant) }
                    .frame(minHeight: 44)
                    .buttonStyle(.bordered)
                    .opacity(busy ? 0.5 : 1)
                Button(appLocalized("ios.journey.openInDirections")) { openInDirections(requery: false) }
                    .frame(minHeight: 44)
                    .buttonStyle(.bordered)
                    .opacity(busy ? 0.5 : 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.4)))
            .onDisappear {
                startTask?.cancel()
                startTask = nil
                busy = false
            }
        }
    }

    /// [안내 시작](D13·D16): 위치를 새로 받아 카드의 출발 좌표·조회 시각과 견준다. 신선하면 카드의 결과로 바로 이어 안내를 시작하고,
    /// 아니면(낡음·이동·측위 실패·수동 지정 위치에서 조회한 카드) 시작하지 않고 길찾기 탭에서 같은 여정을 실제 위치로 다시 조회한다.
    /// 전송이 아니라 AI 동의와 무관하다.
    private func start(_ variant: JourneyVariant) {
        guard AppConfig.experimentalJourneyEnabled, !busy else { return }
        // 다른 안내가 진행 중이면 측위·재조회 전에 거부한다(S3) — 시작할 수 없는 상황에서 탭 전환·유료 조회가 일어나지 않게.
        guard !GuideSession.shared.refuseStartIfOccupied() else { return }
        busy = true
        startTask = Task { @MainActor in
            defer { busy = false }
            // 실측위 — 수동 위치 스토어를 거치지 않는다(안내는 늘 실좌표에서 시작한다). 실패하면 `noFix`로 다시 조회한다.
            let fix = try? await LocationService.shared.currentCoordinate(force: true)
            // 측위 중 카드가 사라졌으면 아무것도 하지 않는다(S1).
            guard !Task.isCancelled else { return }
            let freshness = journeyCardFreshness(
                origin: payload.origin, queriedAtMs: payload.queriedAt,
                fix: fix.map { RoutePoint(lat: $0.lat, lng: $0.lng) }, nowMs: Date().timeIntervalSince1970 * 1000)
            // 수동 지정 위치에서 조회한 카드는 신선해도 그 결과로 시작하지 않는다(E70-b2 ③ — 첫 구간부터 실제 위치와 어긋난다).
            guard freshness == .fresh, !payload.manualOrigin else {
                openInDirections(requery: true)
                return
            }
            // 봉인 조건을 호출 자리의 머리말에 둔다(위 가드와 같은 술어 — `guidance-gate-drift.test.ts`가 이 자리를 잠근다).
            if AppConfig.experimentalJourneyEnabled {
                recordJourneyRecentRoute(
                    dest: RecentEndpoint(
                        label: payload.destLabel, lat: payload.dest.lat, lng: payload.dest.lng, labelRoman: payload.destRoman),
                    board: payload.board, alight: payload.alight)
                GuideSession.shared.startJourney(plan: JourneyPlan(
                    variant: variant, egress: variant.egress?.options.first, destLabel: payload.destLabel,
                    destRoman: payload.destRoman, dest: BeaconDest(lat: payload.dest.lat, lng: payload.dest.lng),
                    aboard: nil))
            }
        }
    }

    /// [길찾기에서 열기](D14): 길찾기 탭에 도착지·갈아탈 곳을 채운다. `requery`가 거짓이면 카드의 결과를 재조회 없이 그대로 보여 주고,
    /// 참이면(낡은 카드·수동 위치 카드의 [안내 시작]) 같은 여정을 **실제 위치**로 다시 조회하며 사유를 조회 시작 때 한 번 말한다.
    private func openInDirections(requery: Bool) {
        guard AppConfig.experimentalJourneyEnabled, !busy || requery else { return }
        DirectionsPrefillStore.shared.pending = DirectionsPrefill(
            role: .to,
            endpoint: .place(label: payload.destLabel, lat: payload.dest.lat, lng: payload.dest.lng, labelRoman: payload.destRoman),
            journey: JourneyPrefill(
                board: payload.board, alight: payload.alight, result: requery ? nil : payload.result,
                manualOrigin: payload.manualOrigin, realOrigin: requery,
                requeryNotice: requery ? appLocalized("ios.journey.cardStaleRequery") : nil))
    }
}
