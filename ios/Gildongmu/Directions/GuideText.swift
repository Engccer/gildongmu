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

    // MARK: - 최종 접근 (spec 2026-08-08 §3.3·§3.4·§3.6)

    /// 최종 접근 거리 사다리(§3.6). **비교는 반올림 전 원거리로 한다** —
    /// `formatDistance` 통과 후 값으로 비교하면 15.4m가 런타임 반올림에 따라
    /// "근처"와 "약 15미터"로 갈린다.
    ///
    /// ⚠ **정확도가 좋아도 헤지를 빼지 않는다.** §2.8이 인용한 RouteNav 실측이
    /// "보고 정확도 5.4m, 실오차 36.5m"라, 보고값이 좋다는 이유로 확신 문장을 내는 것은
    /// 그 근거와 정면으로 충돌한다. 최종 접근 구간에서는 최소 "약"을 붙인다
    /// (일반 안내의 `confidenceDistance`가 ≤10m에서 원문을 쓰는 것과 갈리는 지점).
    static func approachDistance(_ meters: Double, accuracy: Double) -> String {
        let base = formatDistance(Int(meters.rounded()))
        if accuracy <= 20 { return appLocalized("guide.approx", base) }
        return appLocalized("guide.rough", base)
    }

    static func directionWord(_ d: RelativeDirection) -> String {
        switch d {
        case .ahead: appLocalized("guide.dirAhead")
        case .left: appLocalized("guide.dirLeft")
        case .right: appLocalized("guide.dirRight")
        case .behind: appLocalized("guide.dirBehind")
        }
    }

    /// 방향·거리 한 조각. 방향을 모르면 거리만 남긴다(빈 문자열 보간 금지 —
    /// "…, , 16미터"처럼 구분자가 겹친다). 어순은 로케일 문구가 소유한다.
    static func approachDetail(distance: String, direction: String?) -> String {
        guard let direction else { return distance }
        return appLocalized("guide.finalApproachDetail", direction, distance)
    }

    /// 최종 접근 진입 1회 배치 서술(§3.3).
    ///
    /// **이 문장은 사용자가 경로 종점에 서 있을 때 나가므로 거리·방향이 곧 현재 위치
    /// 기준이다.** 초판이 이것을 인계 시점(경로 잔여 50m)에 냈다가 기준이 어긋났다.
    ///
    /// 조사를 쓰지 않는다 — 한국어 주격·목적격 조사는 받침 유무로 갈리는데
    /// (`강동구청은`/`이마트는`, `성내로를`/`양재대로116길을`) 목적지·도로명이 임의
    /// 고유명사다. 조사 헬퍼를 만드는 대신 쉼표로 잇는다(접근성 헌장 §4 정합).
    static func finalApproachEnter(
        destination: String, geometry: FinalApproachPayload, accuracy: Double
    ) -> String {
        // ⚠ 진입 서술은 §3.6 사다리의 "≤15m는 수치 없이" 행을 타지 않는다. 그 행의
        //   전제는 **fix에서 온 거리의 잡음**인데, 여기서 말하는 오프셋은 폴리라인에서
        //   정적으로 계산된 값이라 그 전제가 성립하지 않는다. 12m는 열다섯 걸음이고
        //   숫자를 지워서 얻을 것이 없다(정확도 헤지는 그대로 붙는다 — 사용자의
        //   현재 위치는 여전히 fix에서 오기 때문이다).
        let detail = approachDetail(
            distance: approachDistance(geometry.offsetMeters, accuracy: accuracy),
            direction: directionOf(geometry)
        )
        guard let road = geometry.roadName else {
            return appLocalized("guide.finalApproachEnterNoRoad", destination, detail)
        }
        return appLocalized("guide.finalApproachEnter", road, destination, detail)
    }

    /// 최종 접근 주기 통지(§3.4). 거리는 **현재 fix → 목적지 직선거리**다 —
    /// 진입 서술의 `offsetMeters`를 재사용하지 않는다(두 거리 혼동 차단).
    ///
    /// ⚠ "근처" 분기는 지금 도달하지 않는다 — 도착 반경과 사다리 하한이 둘 다 15m라
    /// 도착이 먼저 발화하기 때문이다. 지운 것이 아니라 남겨 둔다:
    /// `finalApproachArriveMeters`는 위원장 실보행 판정 대상(spec §6-3)이고, 도착
    /// 선언이 이르다는 판정이 나오면 그 사이 거리가 곧바로 이 분기로 들어온다.
    static func finalApproachTick(
        distance meters: Double, direction: String?, accuracy: Double
    ) -> String {
        if meters <= finalApproachArriveMeters { return nearText(direction: direction) }
        return approachDetail(
            distance: approachDistance(meters, accuracy: accuracy), direction: direction
        )
    }

    private static func nearText(direction: String?) -> String {
        guard let direction else { return appLocalized("guide.finalApproachNear") }
        return appLocalized("guide.finalApproachNearDir", direction)
    }

    /// 진입 서술의 방향 어휘. 기하가 사유를 실었으면(tooClose·degenerate) 말하지 않는다.
    private static func directionOf(_ geometry: FinalApproachPayload) -> String? {
        geometry.relativeBearing.map { directionWord(relativeDirection($0)) }
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
