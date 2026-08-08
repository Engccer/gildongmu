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
    ///
    /// 그 자리에 들어오는 값의 **타입에 맞는 틀**을 고른다(위원장 실사용 피드백
    /// 2026-08-07). 다음 스텝이 있으면 값은 완결 서술문이고("수서역에서 …밤고개로를
    /// 따라 300m 이동"), 마지막이면 목적지 이름(명사)이다. 종전에는 둘을 한 틀
    /// "{step}까지 {distance}"에 넣어 명사에는 맞고 서술문에는 어긋났다 —
    /// "…300m 이동까지 약 129m"처럼 두 거리가 역할 표지 없이 인접해 어느 쪽이
    /// 남은 거리인지 낭독으로 구분되지 않았고, "…까지"로 끝나는 도보 원문에는
    /// 조사가 겹쳤다. 서술문에는 잔여 거리를 앞세우고 "앞"으로 역할을 표시한다
    /// (내비 관용구 "300m 앞 좌회전" 어순 — 필요한 순서는 "얼마 뒤에 → 무엇을").
    static func periodic(
        route: GuideRoute, stepIndex: Int, remainingMeters: Int,
        accuracy: Double, destinationLabel: String
    ) -> String {
        let distance = confidenceDistance(Double(remainingMeters), accuracy: accuracy)
        guard route.steps.indices.contains(stepIndex + 1) else {
            return appLocalized("guide.nextDestination", destinationLabel, distance)
        }
        return appLocalized("guide.next", distance, route.steps[stepIndex + 1].description)
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
            // 뒤쪽 어순은 periodic과 같은 계약(거리 먼저 + 타입에 맞는 틀).
            let segment = formatDistance(Int(max(0, cur.endD - state.d).rounded()))
            guard route.steps.indices.contains(state.stepIndex + 1) else {
                return appLocalized(
                    "guide.progressFollowingDestination", total, destinationLabel, segment
                )
            }
            return appLocalized(
                "guide.progressFollowing", total, segment,
                route.steps[state.stepIndex + 1].description
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
        case .finalApproach:
            // 경로 잔여는 이 국면에서 의미가 없다(이미 종점을 지났다). 정직한 값은
            // 목적지 직선거리뿐이고, 그것이 없으면 마지막 안내를 되돌려 준다.
            guard let straight = straightLineMeters else {
                return appLocalized(
                    "guide.progressUncertain",
                    lastGuidance ?? appLocalized("guide.noGuidanceYet")
                )
            }
            return appLocalized(
                "guide.progressFinalApproach", formatDistance(Int(straight.rounded()))
            )
        }
    }
}
