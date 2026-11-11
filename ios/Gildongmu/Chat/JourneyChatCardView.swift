import SwiftUI
import GildongmuKit

/// 채팅 여정 카드(E70-b 실험판, spec `2026-11-12-e70b-chat-journey-design.md` P1·D10·D11·D13·D14·D15·D16).
///
/// 읽기 순서: 제목 → (지정한 역으로 못 찾았으면) 그 사실 줄 → 합계 → [안내 시작] → [길찾기에서 열기]. 줄마다 한 접근성 객체다.
/// - 제목·못 찾음 줄·합계는 길찾기 결과 화면(`JourneyResultRows`)과 같은 함수·같은 문자열이다. 싣는 계획은 추천 순서 첫 변형
///   (`variants[0]`)과 첫 출구다(그 화면의 기본 선택과 같다). 구간·다른 경로·출구는 [길찾기에서 열기]로 간다.
/// - 제목은 heading이 아니다(D15) — 턴 점프는 질문 heading이 맡고, 답 안의 heading은 회전자를 오염시킨다.
/// - 수동 지정 위치에서 조회한 여정(`manualOrigin`)은 [안내 시작]을 내지 않는다(D2).
/// - 이 뷰는 `AppConfig.experimentalJourneyEnabled` 뒤에서만 그려지고(`ChatConversationView`), 두 동작도 같은 봉인을 한 번 더 확인한다.
/// - 측위를 기다리는 동안 버튼을 `disabled`로 만들지 않는다 — 포커스가 버튼에 남아야 한다(재진입은 `busy` 가드로 막는다).
struct JourneyChatCardView: View {
    let payload: JourneyChatPayload

    /// 재진입 가드(웹 in-flight ref 미러). 측위 대기 중 재탭은 무시하고, 시각 표식(흐림)만 바꾼다.
    @State private var busy = false

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
                if !payload.manualOrigin {
                    Button(appLocalized("beacon.start")) { start(variant) }
                        .buttonStyle(.bordered)
                        .opacity(busy ? 0.5 : 1)
                }
                Button(appLocalized("ios.journey.openInDirections")) { openInDirections(requery: false) }
                    .buttonStyle(.bordered)
                    .opacity(busy ? 0.5 : 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.4)))
        }
    }

    /// [안내 시작](D13·D16): 위치를 새로 받아 카드의 출발 좌표·조회 시각과 견준다. 신선하면 카드의 결과로 바로 이어 안내를 시작하고,
    /// 아니면(낡음·이동·측위 실패) 시작하지 않고 길찾기 탭에서 같은 여정을 지금 위치로 다시 조회한다. 전송이 아니라 AI 동의와 무관하다.
    private func start(_ variant: JourneyVariant) {
        guard AppConfig.experimentalJourneyEnabled, !payload.manualOrigin, !busy else { return }
        busy = true
        Task { @MainActor in
            defer { busy = false }
            // 실측위 — 수동 위치 스토어를 거치지 않는다(안내는 늘 실좌표에서 시작한다). 실패하면 `noFix`로 다시 조회한다.
            let fix = try? await LocationService.shared.currentCoordinate(force: true)
            let freshness = journeyCardFreshness(
                origin: payload.origin, queriedAtMs: payload.queriedAt,
                fix: fix.map { RoutePoint(lat: $0.lat, lng: $0.lng) }, nowMs: Date().timeIntervalSince1970 * 1000)
            guard freshness == .fresh else {
                openInDirections(requery: true)
                return
            }
            // 봉인 조건을 호출 자리의 머리말에 둔다(위 가드와 같은 술어 — `guidance-gate-drift.test.ts`가 이 자리를 잠근다).
            if AppConfig.experimentalJourneyEnabled {
                GuideSession.shared.startJourney(plan: JourneyPlan(
                    variant: variant, egress: variant.egress?.options.first, destLabel: payload.destLabel,
                    destRoman: payload.destRoman, dest: BeaconDest(lat: payload.dest.lat, lng: payload.dest.lng),
                    aboard: nil))
            }
        }
    }

    /// [길찾기에서 열기](D14): 길찾기 탭에 도착지·갈아탈 곳을 채운다. `requery`가 거짓이면 카드의 결과를 재조회 없이 그대로 보여 주고,
    /// 참이면(낡은 카드의 [안내 시작]) 같은 여정을 지금 위치로 다시 조회하며 사유를 조회 완료 통지에 합쳐 한 번 말한다.
    private func openInDirections(requery: Bool) {
        guard AppConfig.experimentalJourneyEnabled, !busy || requery else { return }
        DirectionsPrefillStore.shared.pending = DirectionsPrefill(
            role: .to,
            endpoint: .place(label: payload.destLabel, lat: payload.dest.lat, lng: payload.dest.lng, labelRoman: payload.destRoman),
            journey: JourneyPrefill(
                board: payload.board, alight: payload.alight, result: requery ? nil : payload.result,
                manualOrigin: payload.manualOrigin,
                requeryNotice: requery ? appLocalized("ios.journey.cardStaleRequery") : nil))
    }
}
