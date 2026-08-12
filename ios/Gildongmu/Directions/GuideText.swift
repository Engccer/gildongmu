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

    /// 이동 방향 어휘("왼쪽으로"). 맨몸 어휘(`directionWord`)와 나누는 이유는 한국어
    /// `으로`/`로`가 받침으로 갈리기 때문이다 — 다만 이 넷은 **우리 고정 어휘**라
    /// 런타임 판정 없이 로케일 문구에 박는다(임의 고유명사인 도로명과 다른 축이다).
    static func directionTowardWord(_ d: RelativeDirection) -> String {
        switch d {
        case .ahead: appLocalized("guide.dirAheadTo")
        case .left: appLocalized("guide.dirLeftTo")
        case .right: appLocalized("guide.dirRightTo")
        case .behind: appLocalized("guide.dirBehindTo")
        }
    }

    /// 주기 통지 한 문장. 방향을 모르면 거리만 남긴다(빈 문자열 보간 금지 —
    /// "…, , 16미터"처럼 구분자가 겹친다). 어순은 로케일 문구가 소유한다.
    ///
    /// ⚠ 15초마다 반복되는 통지인데도 완성 문장인 것은 **일관성 우선 판정**이다
    /// (위원장 2026-08-09). 실보행에서 길게 느껴지면 이 한 줄만 되돌린다.
    static func approachDetail(distance: String, direction: String?) -> String {
        guard let direction else {
            return appLocalized("guide.finalApproachTickNoDir", distance)
        }
        return appLocalized("guide.finalApproachTick", direction, distance)
    }

    /// 최종 접근 진입 1회 배치 서술(§3.3).
    ///
    /// **이 문장은 사용자가 경로 종점에 서 있을 때 나가므로 거리·방향이 곧 현재 위치
    /// 기준이다.** 초판이 이것을 인계 시점(경로 잔여 50m)에 냈다가 기준이 어긋났다.
    ///
    /// 목적지가 문장 끝에서 `입니다`/`까지`에 붙으므로 **임의 고유명사여도 조사가
    /// 걸리지 않는다** — 이 어순을 고른 이유다(spec `2026-08-09-final-approach-prose`).
    /// ⚠ 기준 도로명은 두지 않는다(2026-08-09 폐기, 근거는 `final-approach.ts` 주석).
    static func finalApproachEnter(
        destination: String, geometry: FinalApproachPayload, accuracy: Double
    ) -> String {
        // ⚠ 진입 서술은 §3.6 사다리의 "≤15m는 수치 없이" 행을 타지 않는다. 그 행의
        //   전제는 **fix에서 온 거리의 잡음**인데, 여기서 말하는 오프셋은 폴리라인에서
        //   정적으로 계산된 값이라 그 전제가 성립하지 않는다. 12m는 열다섯 걸음이고
        //   숫자를 지워서 얻을 것이 없다(정확도 헤지는 그대로 붙는다 — 사용자의
        //   현재 위치는 여전히 fix에서 오기 때문이다).
        let distance = approachDistance(geometry.offsetMeters, accuracy: accuracy)
        let approach: String
        if let bearing = geometry.relativeBearing {
            approach = appLocalized(
                "guide.finalApproachToDest",
                directionTowardWord(relativeDirection(bearing)), distance, destination
            )
        } else {
            approach = appLocalized("guide.finalApproachToDestNoDir", destination, distance)
        }
        return "\(appLocalized("guide.finalApproachRouteEnd")) \(approach)"
    }


    /// 최종 접근 주기 통지(§3.4). 거리는 **현재 fix → 목적지 직선거리**다 —
    /// 진입 서술의 `offsetMeters`를 재사용하지 않는다(두 거리 혼동 차단).
    ///
    /// ⚠ "근처" 분기는 지금 도달하지 않는다 — 도착 반경과 사다리 하한이 둘 다 15m라
    /// 도착이 먼저 발화하기 때문이다. 지운 것이 아니라 남겨 둔다:
    /// `finalApproachArriveMeters`는 위원장 실보행 판정 대상(spec §6-3)이고, 도착
    /// 선언이 이르다는 판정이 나오면 그 사이 거리가 곧바로 이 분기로 들어온다.
    /// ⚠ **방향을 어절이 아니라 열거형으로 받는다.** 두 분기가 요구하는 어휘가 다르기
    /// 때문이다: "근처"는 맨몸("왼쪽입니다"), 주기는 이동형("왼쪽으로 …입니다"). 종전처럼
    /// 완성된 어절 하나를 넘기면 호출자가 고른 형태가 두 분기에 그대로 흘러 한쪽이
    /// 반드시 틀린다 — 실제로 주기 통지가 "왼쪽 약 16m입니다"로 나갔다(리뷰 검출).
    static func finalApproachTick(
        distance meters: Double, direction: RelativeDirection?, accuracy: Double
    ) -> String {
        if meters <= finalApproachArriveMeters { return nearText(direction: direction) }
        return approachDetail(
            distance: approachDistance(meters, accuracy: accuracy),
            direction: direction.map(directionTowardWord)
        )
    }

    private static func nearText(direction: RelativeDirection?) -> String {
        guard let direction else { return appLocalized("guide.finalApproachNear") }
        return appLocalized("guide.finalApproachNearDir", directionWord(direction))
    }

    /// 유닛(단일 스텝 또는 통독 묶음) 전문. 단일이면 문장 그대로, 묶음이면 통독 틀.
    /// 서두 "다음 안내."는 여러 문장이 이어진다는 신호로 유지, 개수는 행동을 바꾸지
    /// 않는 잉여라 제거(위원장 실보행 판정 2026-08-10).
    static func unit(route: GuideRoute, indices: [Int]) -> String {
        let descs = indices.compactMap { i in
            route.steps.indices.contains(i) ? route.steps[i].description : nil
        }
        guard descs.count > 1 else { return descs.first ?? "" }
        return appLocalized("guide.bundle", descs.joined(separator: ". "))
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

    /// 재조회 성공 원자 발화. **첫 안내만 내보내면 그것이 새 경로인지 원래 경로의
    /// 다음 스텝인지 낭독으로 구분되지 않는다**(실기기 실사용 발견). 화면 출발지 필드는
    /// 길찾기 입력값이라 세션이 갱신하지 않으므로, "출발지가 현재 위치로 바뀌었다"를
    /// 전할 채널은 이 문장뿐이다. 시작 발화와 같은 구조로 새 경로의 규모까지 준다.
    /// 수단별로 가르지 않는다 — 수단은 세션 시작 통지가 이미 말했다.
    static func reroute(route: GuideRoute, firstIndices: [Int]) -> String {
        appLocalized(
            "guide.rerouteDone",
            String(route.steps.count),
            formatDistance(Int(route.totalMeters.rounded())),
            unit(route: route, indices: firstIndices)
        )
    }

    /// 수동 전환 성공 발화(M3 spec §5). 재조회와 같은 구조(새 경로 규모 + 첫 안내)에
    /// 첫 문장만 variant를 밝힌다 — "다시 찾았습니다"는 전환에선 거짓 서술이라 대체.
    static func variantSwitch(route: GuideRoute, firstIndices: [Int], shortest: Bool) -> String {
        appLocalized(
            shortest ? "guide.switchedToShortest" : "guide.switchedToRecommended",
            String(route.steps.count),
            formatDistance(Int(route.totalMeters.rounded())),
            unit(route: route, indices: firstIndices)
        )
    }

    /// 제안 준비 통지(E10ⓑ). 형제(rerouteDone·switchedTo*)와 같은 "규모(개수·총
    /// 거리) → 첫 안내" 구조 — {first}가 거리 포함 서술문이라 뒤에 총 거리를 붙이면
    /// 두 거리가 인접해 판독이 흐려진다(a11y 감사 LOW, periodic 실사용 결함 계열).
    static func proposalReady(route: GuideRoute, firstIndices: [Int]) -> String {
        appLocalized(
            "guide.proposalReady",
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

    /// walk 주기 통지 단문(위원장 실보행 피드백 2026-08-12, 웹 eventText periodic 미러).
    /// 직진 구간 반복은 "{target}까지 {distance} 직진하세요"만 — 다음 스텝 전문을 실은
    /// 종전 틀은 한 문장에 행동 세 개(현재 이동·회전·다음 이동)가 실려 과잉이었고,
    /// 조망은 40m 선행 전문 1회가 담당한다. target은 서버 live 조각(재파싱 금지, 부재는
    /// 이름 생략). 마지막 스텝은 목적지 틀 유지(값이 명사라 종전에도 단문이었다).
    static func periodicWalk(
        route: GuideRoute, stepIndex: Int, remainingMeters: Int,
        accuracy: Double, destinationLabel: String, target: String?
    ) -> String {
        // 횡단 스텝(병합 횡단보도는 40m를 넘어 following으로 온다)에 "직진하세요"는
        // 오지시다 — 정본 문장(…건너세요)을 재낭독한다(웹 walkPeriodicLine 미러).
        if route.steps.indices.contains(stepIndex) {
            let cur = route.steps[stepIndex].description
            if isCrossingStep(walkStepAction(cur), cur) { return cur }
        }
        let distance = confidenceDistance(Double(remainingMeters), accuracy: accuracy)
        guard route.steps.indices.contains(stepIndex + 1) else {
            return appLocalized("guide.nextDestination", destinationLabel, distance)
        }
        guard let target else {
            return appLocalized("guide.periodicStraightNoName", distance)
        }
        return appLocalized("guide.periodicStraight", target, distance)
    }

    /// 진행 상황 서두(서수 + 잔여) — 조망의 뼈대(위원장 실보행 판정 2026-08-10).
    /// 종전 응답은 뒷부분이 주기 통지와 문자 그대로 동일해 버튼 고유 정보가 0이었다.
    /// 서수 위치("안내 12개 중 5번째")가 핵심 신규 정보이고, 잔여 시간은 근거가
    /// 있을 때만 병기한다(3-state — 날조 금지). 웹 `progressFrameLine` 미러.
    static func progressFrame(
        route: GuideRoute, state: GuideState, etaMinutes: Int?
    ) -> String {
        let total = formatDistance(Int(max(0, route.totalMeters - state.d).rounded()))
        let ordinal = appLocalized(
            "guide.progressOrdinal", String(route.steps.count), String(state.stepIndex + 1)
        )
        let remaining = joinText(
            appLocalized("guide.remainingDistance", total),
            etaMinutes.map { appLocalized("guide.remainingTime", String($0)) }
        )
        return "\(ordinal). \(remaining)"
    }

    // MARK: - 하단 2행 (spec 2026-08-11 §4.2·§4.3·§6)

    /// 행동구("왼쪽으로 도세요") — 디스크립터 렌더의 공통 조각.
    /// 보간 키는 키 린터(check-xcstrings-keys)가 못 좇는다 — 명시 switch가 관례.
    static func liveActionPhrase(_ action: WalkAction) -> String {
        switch action {
        case .left: appLocalized("guide.liveAction.left")
        case .right: appLocalized("guide.liveAction.right")
        case .crosswalk: appLocalized("guide.liveAction.crosswalk")
        case .underpass: appLocalized("guide.liveAction.underpass")
        }
    }

    /// "잠시 후 {행동구}"(표시 잔여 0) — 기존 임박 큐 문구 재사용(spec §4.2 행 7).
    static func liveTurnSoon(_ action: WalkAction) -> String {
        switch action {
        case .left: appLocalized("guide.imminent.left")
        case .right: appLocalized("guide.imminent.right")
        case .crosswalk: appLocalized("guide.imminent.crosswalk")
        case .underpass: appLocalized("guide.imminent.underpass")
        }
    }

    /// 하단 2행 윗줄 렌더. 매핑 규칙은 공유 fixture 러너(GuideLiveRowsTests·웹
    /// guide-live-rows.test.ts)와 동일해야 한다 — 규칙 변경은 반드시 러너와 함께 간다.
    static func liveTop(_ row: LiveTopRow) -> String {
        switch row {
        case .offRoute: appLocalized("guide.offRoute")
        case .uncertain: appLocalized("guide.uncertain")
        case .reacquiring: appLocalized("guide.reacquiring")
        case let .crossing(text): text
        case let .turnSoon(action): liveTurnSoon(action)
        case let .turnIn(meters, action):
            appLocalized("guide.liveTurnIn", String(meters), liveActionPhrase(action))
        case let .straight(meters, target):
            target.map { appLocalized("guide.liveStraight", $0, String(meters)) }
                ?? appLocalized("guide.liveStraightNoName", String(meters))
        }
    }

    /// 하단 2행 아랫줄 렌더 — "다음 안내," 라벨(progressNext)까지 포함한 완성 문자열.
    static func liveNext(_ row: LiveNextRow) -> String {
        let step: String
        switch row {
        case let .action(action, anchor):
            let phrase = liveActionPhrase(action)
            step = anchor.map { appLocalized("guide.nextAction", $0, phrase) } ?? phrase
        case let .straight(meters, target):
            step = target.map { appLocalized("guide.nextStraight", $0, String(meters)) }
                ?? appLocalized("guide.nextStraightNoName", String(meters))
        case let .crossing(action), let .turn(action):
            step = liveActionPhrase(action)
        }
        return appLocalized("guide.progressNext", step)
    }

    /// 진행 상황 버튼 응답(스펙 §4.2 — 상태별로 거짓 정밀을 만들지 않는다).
    /// straightLineMeters는 이탈 상태 전용(마지막 fix→목적지 직선거리 — 경로 잔여는
    /// 이탈 중엔 거짓이므로 직선만 정직하다). 웹 `progressOverviewLine` 미러 —
    /// uncertain 계열엔 서수를 붙이지 않는다(위치 확신이 낮을 때의 서수는 거짓 정밀).
    static func progress(
        route: GuideRoute, state: GuideState, destinationLabel: String,
        lastGuidance: String?, straightLineMeters: Double?, etaMinutes: Int?
    ) -> String {
        switch state.phase {
        case .following:
            let cur = route.steps[state.stepIndex]
            let frame = progressFrame(route: route, state: state, etaMinutes: etaMinutes)
            // 현재 스텝 전문 재확인 — 실행 안내를 소음으로 놓쳤을 때의 복구 수단.
            let current = appLocalized("guide.progressCurrent", cur.description)
            guard route.steps.indices.contains(state.stepIndex + 1) else {
                let segment = formatDistance(Int(max(0, cur.endD - state.d).rounded()))
                return "\(frame). \(current). "
                    + appLocalized("guide.nextDestination", destinationLabel, segment)
            }
            return "\(frame). \(current). "
                + appLocalized("guide.progressNext", route.steps[state.stepIndex + 1].description)
        case .bundle:
            // 묶음 국면은 통독 자체가 "다음 안내." 서두를 가지므로 다음 파트가 따로 없다.
            let frame = progressFrame(route: route, state: state, etaMinutes: etaMinutes)
            return "\(frame). "
                + unit(route: route, indices: unitAt(route: route, index: state.stepIndex))
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
