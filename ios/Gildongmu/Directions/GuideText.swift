import Foundation
import GildongmuKit

/// 상세 안내 이벤트 → 낭독 문장 조립(스펙 §5.3·§5.4).
///
/// 원칙 둘: ①스텝 문장(description)은 낭독 정본이라 **재조합하지 않는다** — 그대로
/// 싣거나 통독 틀(guide.bundle)에 담기만 한다 ②거리 문자열은 `formatDistance` 정본
/// + 확신도 3단 래핑만 거친다. 낭독 채널(spokenUnits)은 BeaconModel.announce가 담당.
enum GuideText {
    /// 확신도 3단(Soundscape 패턴): ≤10m 원문 / ≤20m "약 N" / >20m "N쯤".
    /// 잔여 200m 이상은 상대 오차가 작아 원문 유지(스펙 §5.4).
    static func confidenceDistance(_ meters: Double, accuracy: Double) -> String {
        let base = formatDistance(Int(meters.rounded()))
        if meters >= 200 || accuracy <= 10 { return base }
        if accuracy <= 20 { return appLocalized("guide.approx", base) }
        return appLocalized("guide.rough", base)
    }

    /// 유닛(단일 스텝 또는 통독 묶음) 전문. 단일이면 문장 그대로, 묶음이면 통독 틀.
    static func unit(route: GuideRoute, indices: [Int]) -> String {
        let descs = indices.compactMap { i in
            route.steps.indices.contains(i) ? route.steps[i].description : nil
        }
        guard descs.count > 1 else { return descs.first ?? "" }
        return appLocalized("guide.bundle", String(descs.count), descs.joined(separator: ". "))
    }

    /// 시작 원자 발화(스펙 §5.3 — 요약과 첫 안내를 한 문장으로, 발화 경합 제거).
    static func start(route: GuideRoute, firstIndices: [Int]) -> String {
        appLocalized(
            "guide.detailStart",
            String(route.steps.count),
            formatDistance(Int(route.totalMeters.rounded())),
            unit(route: route, indices: firstIndices)
        )
    }

    /// 자동차 시작 원자 발화(B1 — 시작 통지가 수단·모드를 말한다).
    static func carStart(route: GuideRoute, firstIndices: [Int]) -> String {
        appLocalized(
            "guide.carStart",
            String(route.steps.count),
            formatDistance(Int(route.totalMeters.rounded())),
            unit(route: route, indices: firstIndices)
        )
    }

    /// 원거리 예고(B1 §4.7): 크로싱 시점의 **실측 잔여**(리듀서가 기하에서 계산) +
    /// 원문을 독립 문장으로 결합(문법 결합 금지 — 거리 기준 혼동 차단).
    static func farNotice(route: GuideRoute, indices: [Int], remainingMeters: Int) -> String {
        appLocalized(
            "guide.farNotice",
            formatDistance(remainingMeters),
            unit(route: route, indices: indices)
        )
    }

    /// 주기 통지: 다음 안내 지점까지 구간 잔여(마지막 스텝이면 목적지 라벨).
    static func periodic(
        route: GuideRoute, stepIndex: Int, remainingMeters: Int,
        accuracy: Double, destinationLabel: String
    ) -> String {
        let target = route.steps.indices.contains(stepIndex + 1)
            ? route.steps[stepIndex + 1].description
            : destinationLabel
        return appLocalized(
            "guide.next", target,
            confidenceDistance(Double(remainingMeters), accuracy: accuracy)
        )
    }

    /// 진행 상황 버튼 응답(스펙 §4.2 — 상태별로 거짓 정밀을 만들지 않는다).
    /// straightLineMeters는 이탈 상태 전용(마지막 fix→목적지 직선거리 — 경로 잔여는
    /// 이탈 중엔 거짓이므로 직선만 정직하다).
    static func progress(
        route: GuideRoute, state: GuideState, destinationLabel: String,
        lastGuidance: String?, straightLineMeters: Double?
    ) -> String {
        let total = formatDistance(Int(max(0, route.totalMeters - state.d).rounded()))
        switch state.phase {
        case .following:
            let cur = route.steps[state.stepIndex]
            return appLocalized(
                "guide.progressFollowing", total,
                route.steps.indices.contains(state.stepIndex + 1)
                    ? route.steps[state.stepIndex + 1].description
                    : destinationLabel,
                formatDistance(Int(max(0, cur.endD - state.d).rounded()))
            )
        case .bundle:
            let count = unitAt(route: route, index: state.stepIndex).count
            return appLocalized("guide.progressBundle", total, String(count))
        case .uncertain, .reacquiring:
            return appLocalized(
                "guide.progressUncertain",
                lastGuidance ?? appLocalized("guide.noGuidanceYet")
            )
        case .offRoute:
            // 스펙 §4.2: 이탈 상태 명시 + 목적지 직선거리(웹 useRouteGuide와 동일 키).
            guard let straight = straightLineMeters else {
                return appLocalized("guide.offRoute")
            }
            return appLocalized(
                "guide.progressOffRoute", formatDistance(Int(straight.rounded()))
            )
        }
    }
}
