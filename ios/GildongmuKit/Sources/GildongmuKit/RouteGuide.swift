import Foundation

/// 경로 추종형 안내 순수 리듀서 — 웹 정본 `src/lib/route-guide.ts`의 1:1 미러
/// (스펙 2026-08-03 §5). 공유 fixture(route-guide-scenarios.json)가 동조를 강제한다.
///
/// 시간은 전부 주입된 단조 시각(now, 초)이다. Date() 직접 호출 금지 — 역순 fix
/// 폐기·타이머 정지 계약이 주입 시각 위에서만 성립한다.

/// 다음 안내 전문을 낭독하는 잔여 거리 — 결정 지점 앞에서 들려야 한다(낭독 선행 원칙).
public let announceAheadMeters = 40.0
/// 결정 지점 **임박** 큐의 잔여 거리(m). 40m 전문 낭독이 *무엇을* 할지 알린다면 이 큐는
/// *지금이다*를 알린다 — 위원장 실보행 피드백 2026-08-09: "모퉁이를 돌기 전, 횡단보도를
/// 건너기 전 10m에서 사운드·진동·짧은 문장으로 알려 달라".
///
/// ⚠ **40m 낭독을 대체하지 않는다.** 짧은 명령형 전용이라 전문을 옮기면 들으면서
/// 이미 모퉁이를 지난다. 옮긴 것은 **`ahead` 톤 하나**다(종전에는 40m 전문에 붙어
/// "지금이다"를 못 말했다).
///
/// 25m 근거(위원장 실보행 판정 2026-08-10): 초기값 10m는 GPS·투영 지연(~15m 관측)에
/// 잡아먹혀 실위치 기준으로는 회전 지점을 **지난 뒤** 발화했다 — 명령을 따르면 차도로
/// 진입하는 위험 실사고. 관측 지연 15m + 종전 여유 10m. 상수는 계속 실보행 판정 대상.
///
/// 2026-08-11부터 유도식(10 + projectionLagMeters)으로 재정의 — 값 25 불변(spec §3).
/// 표시 좌표계의 표시 잔여 10 = 원시 계산 25 = 임박 큐 시점이 유도식으로 일치한다.
///
/// 표시 계층의 투영 지연 추정(m) — 웹 `PROJECTION_LAG_M` 미러. ⚠ **이 값의 갱신은
/// imminentAheadMeters를 함께 움직이는 의도적 행동 변경이다**(불변식 A "음성 불변"은
/// 이번 변경 한정) — 실보행 리플레이 근거 + spec 개정 + 실보행 재판정 없이 바꾸지 말
/// 것. 표시 계층에 15·25를 직접 쓰면 drift다(불변식 B: lag 상수와 effectiveD 유도는
/// route-guide.ts ↔ 이 파일 한 쌍에만 존재한다).
public let projectionLagMeters = 15.0
public let imminentAheadMeters = 10.0 + projectionLagMeters // = 25, 값 불변(유도식 재정의)

/// 표시 좌표계 유효 진행거리(spec 2026-08-11 §3) — 웹 `displayEffectiveD` 미러.
/// 표시 계층(GuideLiveRows)의 구간 선택·국면·잔여가 전부 이 좌표를 쓴다.
/// **음성·톤·햅틱 계층은 원시 d 유지.** 램프인: 기준점(세션·재조회 시작 시점의 d)
/// 직후에는 걸은 거리만큼만 차오른다(F7 — 출발·재조회 직후 과소 표시 방지).
public func displayEffectiveD(d: Double, baselineD: Double) -> Double {
    d + min(projectionLagMeters, max(0, d - baselineD))
}
public let advanceMarginBaseMeters = 15.0
/// **기하를 모르는 세션의** 최종 접근 진입 거리(m). 기하를 아는 세션은 경로 종점까지
/// 따라간다(아래 `arrivalToleranceMinMeters`) — 이 50m는 "경로 종점 = 목적지"를 전제한
/// 판단이었고, 실측에서 종점→목적지 오프셋 16~89m가 확인돼 무효화됐다
/// (spec 2026-08-08 §1.2·§3.2).
public let handoffDistMeters = 50.0
public let handoffRearmMeters = handoffDistMeters + 20
/// 경로 종점 도달 판정의 하한(m). 실제 임계는 `max(이 값, fix.accuracy)`다 —
/// 경로 잔여 5m를 정확도 30m fix로 판정하는 것은 거짓 정밀도이고, 정확도가 나쁘면
/// 종점 도달을 일찍 인정하는 것이 정직하다(spec 2026-08-08 §3.2).
/// ⚠ 실보행 판정 전까지 동결(spec §6-1).
public let arrivalToleranceMinMeters = 10.0
public let uncertainAccuracyMeters = 50.0
public let offRouteBaseMeters = 30.0
public let offRouteHoldSeconds = 20.0
public let offRouteRenotifySeconds = 60.0
public let reacquireGapSeconds = 10.0
public let windowBackMeters = 20.0
public let windowAheadMinMeters = 50.0
public let edgeHitsMax = 3
public let speedEnterMps = 3.0
public let speedClearMps = 2.0
public let speedWindowSeconds = 10.0
/// 속도 표본 수집의 정확도 상한. uncertain 게이트(50m)보다 좁다 — 계단·실내 진입의
/// 30~50m fix가 진행거리 점프를 만들어 "속도 빠름" 오판을 낳는다(피드백 라운드1 #7).
public let speedSampleMaxAccuracyMeters = 20.0
public let resolveTimeoutSeconds = 30.0
public let bundleRereadSeconds = 15.0

/// 수단별 튜닝 프로파일(B1 스펙 §4.3) — 웹 `GuideTuning` 미러. walk는 현행 상수의
/// 동결이고, 리듀서 본문 변경은 "상수 참조 → 인자 참조 치환"에 한정한다.
public struct GuideTuning: Sendable, Equatable {
    /// 임박(선행) 낭독: 잔여 ≤ max(announceAheadM, v×announceAheadSpeedS)
    public var announceAheadM: Double
    public var announceAheadSpeedS: Double
    /// 결정 지점 임박 큐 경계(m). nil=미사용.
    ///
    /// ⚠ **보행 전용이다.** 25m는 보행 ~20초이지만 15m/s 주행에서는 2초 미만이라 소리를 듣고
    /// 반응할 시간이 없고, 애초에 자동차 안내는 실주행을 네이티브 앱에 위임한다.
    /// 값도 문구도(`walkStepAction`이 도보 문형만 안다) 차량에서 재본 적이 없다.
    public var imminentAheadM: Double?
    /// 원거리 예고 경계(m). nil=미사용(walk)
    public var farNoticeM: Double?
    public var windowAheadMinM: Double
    public var windowAheadSpeedS: Double
    public var offRouteBaseM: Double
    public var offRouteHoldS: Double
    /// 이탈 확정에 "수직거리 비감소 추세" 요구(복귀 중 오확정 차단)
    public var offRouteTrend: Bool
    public var offRouteRenotifyS: Double
    /// 이탈 재통지의 warning 톤 여부(첫 확정은 항상 warning)
    public var offRouteRenotifyWarns: Bool
    public var handoffDistM: Double
    public var handoffRearmM: Double
    /// 재획득 전방 연속성 타이브레이크(재획득 경로 한정)
    public var reacquireTieBreak: Bool
    /// 보행 속도 가드. false면 가드 기계 전체 비활성(차량 상시 활성 → 이탈 재통지 잠식 차단).
    public var speedSuggest: Bool
    /// 이탈 판정 방위 축(spec 2026-08-09). **보행 전용이다.**
    ///
    /// ⚠ 이 축의 상수는 전부 보행 궤적으로 쟀다(속도 1.2m/s, 앞뒤 10m 접선 표본).
    /// "모퉁이 헛경고를 ±10m 표본이 막는다"는 핵심 논거가 차량 속도에서 성립하지
    /// 않는다 — 15m/s면 그 대역을 1.3초에 통과하고 fix 하나당 진행거리가 15m씩 뛴다.
    /// 차량에서의 헛경고율은 **측정된 적이 없다.**
    public var courseAxisEnabled: Bool
    /// 수단별 물리 속도 상한(m/s) — 투영 점프 판정의 기준(웹 `maxSpeedMps` 미러).
    /// 직전 fix 대비 진행거리 증가가 `maxSpeedMps × dt × 1.5`를 넘으면 투영이 튄 것이다.
    ///
    /// ⚠ **이 판정은 리듀서 소유다(A10, 2026-08-11).** 종전에는 오케스트레이터
    /// (`BeaconModel.projectionJumped`)가 별도 기준값으로 판정해 `finalApproachEnter`를
    /// 상태 커밋 **뒤에** 거부했는데, 거부된 세션이 0a 가드 국면에 갇혀 영구 정지했다
    /// (하교 실보행 실사고). 리듀서 안에서는 직전 d가 `state.d`, 직전 시각이
    /// `state.lastFixAt`이라 별도 기준값 없이 진입 확정 **전에** 같은 판정이 성립하고,
    /// 진입 이벤트와 phase 전이가 원자적이 된다.
    public var maxSpeedMps: Double

    public static let walk = GuideTuning(
        announceAheadM: announceAheadMeters, announceAheadSpeedS: 0,
        imminentAheadM: imminentAheadMeters, farNoticeM: nil,
        windowAheadMinM: windowAheadMinMeters, windowAheadSpeedS: 0,
        offRouteBaseM: offRouteBaseMeters, offRouteHoldS: offRouteHoldSeconds,
        offRouteTrend: false,
        offRouteRenotifyS: offRouteRenotifySeconds, offRouteRenotifyWarns: true,
        handoffDistM: handoffDistMeters, handoffRearmM: handoffRearmMeters,
        reacquireTieBreak: false, speedSuggest: true,
        courseAxisEnabled: true,
        maxSpeedMps: MotionConstants.maxWalkSpeedMps
    )

    /// 자동차 초기값(스펙 §4.3 표) — 최초 실주행 판정까지 고정.
    public static let car = GuideTuning(
        announceAheadM: 120, announceAheadSpeedS: 15,
        // ⚠ 보행 궤적으로만 쟀다(위 필드 주석). 켜려면 먼저 재라.
        imminentAheadM: nil, farNoticeM: 1500,
        windowAheadMinM: 150, windowAheadSpeedS: 5,
        offRouteBaseM: 50, offRouteHoldS: 10,
        offRouteTrend: true,
        offRouteRenotifyS: 180, offRouteRenotifyWarns: false,
        handoffDistM: 150, handoffRearmM: 200,
        reacquireTieBreak: true, speedSuggest: false,
        // ⚠ 차량 궤적으로 측정된 적이 없다. 켜려면 먼저 재라(위 필드 주석).
        courseAxisEnabled: false,
        maxSpeedMps: MotionConstants.maxCarSpeedMps
    )
}

/// 속도 추정 v(§4.3): max(직전 구간 속도, 중앙값). 표본은 직전 fix까지의 창 —
/// 구속 창 크기는 현재 fix 수용 전에 정해져야 하므로(인과) 현재 fix 미포함.
private func estimateSpeedMps(_ samples: [GuideSpeedSample]) -> Double {
    guard samples.count >= 2 else { return 0 }
    var speeds: [Double] = []
    for i in 1..<samples.count where samples[i].at > samples[i - 1].at {
        speeds.append((samples[i].d - samples[i - 1].d) / (samples[i].at - samples[i - 1].at))
    }
    guard let lastSeg = speeds.last else { return 0 }
    let sorted = speeds.sorted()
    return max(lastSeg, sorted[sorted.count / 2])
}

/// `finalApproach`는 **경로 종점 이후 오프셋 구간을 직선으로 추적**하는 국면이다
/// (spec 2026-08-08 §3.0). 단방향 래치라 리듀서가 스스로 다른 국면으로 돌아가지 않는다.
public enum GuidePhase: Sendable, Equatable {
    case following, bundle, uncertain, reacquiring, offRoute, finalApproach
}

public struct GuideFix: Sendable, Equatable {
    public let lat: Double
    public let lng: Double
    public let accuracy: Double

    public init(lat: Double, lng: Double, accuracy: Double) {
        self.lat = lat
        self.lng = lng
        self.accuracy = accuracy
    }

    var point: RoutePoint { RoutePoint(lat: lat, lng: lng) }
}

public struct GuideSpeedSample: Sendable, Equatable {
    public let at: Double
    public let d: Double
}

public struct GuideState: Sendable, Equatable {
    public var phase: GuidePhase
    /// uncertain·reacquiring·offRoute에서 복귀할 기본 국면(following 또는 bundle).
    public var resumePhase: GuidePhase
    public var d: Double
    public var stepIndex: Int
    /// 낭독 완료된 마지막 스텝 index(선행 낭독 포함).
    public var announcedUpTo: Int
    /// 임박 큐를 마친 마지막 스텝 index. 항상 `imminentUpTo <= announcedUpTo`다.
    ///
    /// ⚠ **스텝 단위로 전진한다 — `announcedUpTo`처럼 유닛 끝으로 뛰지 않는다.** 전문
    /// 낭독은 짧은 스텝들을 한 문장으로 묶어 읽지만 결정 지점은 그 묶음 **안에도** 있다.
    /// 유닛 끝으로 뛰면 묶음의 첫 스텝만 분류되고 나머지 회전·횡단보도는 큐를 받을
    /// 기회가 구조적으로 사라진다(6a 주석의 실측 두 건).
    ///
    /// ⚠ 행동이 없는 경계(단순 직진 연결)에서도 **전진한다**. 전진하지 않으면 그 경계에
    /// 영원히 걸려 다음 회전의 큐가 영영 나가지 않는다.
    public var imminentUpTo: Int
    /// 어떤 발화든 갱신 — 주기 통지의 기준.
    public var lastAnnouncedAt: Double
    public var lastFixAt: Double?
    public var windowEdgeHits: Int
    public var offRouteSince: Double?
    public var lastOffRouteNoticeAt: Double?
    public var speedSamples: [GuideSpeedSample]
    public var speedGuardActive: Bool
    public var speedWarned: Bool
    /// 자동 인계 무장 여부. 수동 상세 복귀 후엔 재무장선(70m) 밖으로 나가야 true.
    public var autoHandoffArmed: Bool
    /// 이 세션이 종점 오프셋 기하(`WalkRouteBriefing.finalApproach`)를 아는가.
    ///
    /// - `true`  → 최종 접근 진입 조건은 **경로 종점 도달**(`max(arrivalToleranceMinMeters, accuracy)`).
    /// - `false` → 구버전 응답이다. **현행 50m 인계를 그대로 쓴다**(spec §3.2, 검토 #33).
    ///
    /// ⚠ **fix 인자가 아니라 상태에 둔다.** 세션(경로 응답)의 성질이라 매 fix마다 다시
    /// 넘길 값이 아니고, 넘기게 하면 호출 지점 하나만 어긋나도 컴파일러가 못 잡는다.
    public var hasFinalApproachGeometry: Bool
    /// 원거리 예고를 마친 마지막 스텝 index(임박 발화 시 함께 전진). walk에선 불변.
    public var farNoticedUpTo: Int
    /// 이탈 누적 중 관측 최대 수직거리 — offRouteTrend 프로파일의 복귀 유예 기준.
    public var offRoutePeakPerp: Double?
    /// 재획득 타이브레이크 기준: reacquiring 진입 직전 진행거리·속도·진입 시각.
    public var reacquirePrevD: Double?
    public var reacquireV: Double
    public var reacquireSince: Double?
    /// reacquiring 진입 직전 국면이 offRoute였는가. 없으면 이탈 확정이 GPS 공백을
    /// 경유하며 무통지로 소실된다(복귀가 backOnRoute 대신 reacquired로 나감 — 리뷰 HIGH).
    public var reacquiringFromOffRoute: Bool
    /// 축별 이탈 latch. 확정은 OR, 복귀는 평가 가능한 활성 축 전체 해제다.
    /// ⚠ 단일 "원인"으로 접지 않는다 — 거리로 이탈한 뒤 역주행해도 방위 상태가
    /// 기록되지 않아 방향이 어긋난 채 복귀가 선언된다.
    public var offRouteAxes: OffRouteAxes
    /// 방위 표결 창. 상태 재구성 시 비워진다(경로 identity 바인딩).
    public var courseVotes: [CourseVoteSample]
    /// 방위 관측 유도기 버퍼(fix 이력). ⚠ 표결 창과 수명이 다르다 — 궤적은 경로의
    /// 함수가 아니므로 경로 교체·재구성(§2.8)에서 비우지 않고(age 30s로 자체 소멸),
    /// 새 세션에서만 초기화한다(spec §2.9).
    public var courseDerivation: CourseDerivationState
}

public struct OffRouteAxes: Sendable, Equatable {
    public var distance: Bool
    public var course: Bool

    public init(distance: Bool = false, course: Bool = false) {
        self.distance = distance
        self.course = course
    }
}

public enum GuideEvent: Sendable, Equatable {
    case announceSteps([Int])
    /// 결정 지점 임박(25m) 앞. `action`은 낭독 문구를 고르는 키이고 `indices`는 **그 행동을
    /// 담은 스텝 하나**다(유닛이 아니다 — 결정 지점은 유닛 안에도 있다).
    case imminent(indices: [Int], action: WalkAction)
    case farNotice(indices: [Int], remainingMeters: Int)
    case periodic(stepIndex: Int, remainingMeters: Int, accuracy: Double)
    case bundleReread([Int])
    case finalApproachEnter
    case offRoute
    case backOnRoute
    case uncertainEnter
    case uncertainExit
    case reacquiring
    case reacquired
    case speedSuggest
}

public enum GuideTone: Sendable, Equatable {
    case ahead, warning
}

public struct GuideOutput: Sendable, Equatable {
    public let state: GuideState
    public let event: GuideEvent?
    public let tone: GuideTone?
    /// 진단 계측용(spec §7 1단계). **판정에 쓰이지 않는다.**
    ///
    /// 실보행 로그로 §6 상수를 정하려면 "왜 그렇게 판정했나"를 되짚을 수 있어야 한다.
    /// `verdict=unknown, votes=20`만으로는 표가 없어서인지 회색지대여서인지 구분되지
    /// 않고, 수직거리 없이는 두 축의 상관을 볼 수 없다. 판정 전 국면에서 조기 반환하면
    /// 계산된 적이 없으므로 `nil`이고, 그것이 정직한 값이다(0으로 접지 않는다).
    public let perpMeters: Double?
    /// 이 fix가 실제로 창에 넣은 표. 이탈 중에는 `entryProjection` 기준이다.
    /// 관측이 없어 표를 내지 않았으면 `nil`이다(spec §2.10 — 표 없음).
    public let courseVote: CourseVote?
    /// 이 fix에서 유도된 방위 관측(진단용). 프로파일 게이트 통과 후 값 — 없으면 nil.
    public let derivedCourse: DerivedCourse?
    /// 이 fix의 진행거리 전진이 물리적으로 불가능했는가(투영 점프). 오케스트레이터의
    /// 추세 톤 게이트가 소비한다 — 튄 잔여 거리를 추세로 읽으면 거짓 closer가 난다.
    /// 판정 자체는 리듀서가 소유하고 최종 접근 진입(6b)을 한 fix 미룬다(A10).
    /// 투영에 도달하지 못한 조기 반환 경로에서는 `nil`(판정 없음). 웹 미러.
    public let projectionJumped: Bool?

    public init(
        state: GuideState, event: GuideEvent?, tone: GuideTone?,
        perpMeters: Double? = nil, courseVote: CourseVote? = nil,
        derivedCourse: DerivedCourse? = nil, projectionJumped: Bool? = nil
    ) {
        self.state = state
        self.event = event
        self.tone = tone
        self.perpMeters = perpMeters
        self.courseVote = courseVote
        self.derivedCourse = derivedCourse
        self.projectionJumped = projectionJumped
    }
}

/// 스텝 index가 속한 유닛(긴 스텝=자기 하나, 짧은 스텝=연속 묶음 전체)의 index 목록.
public func unitAt(route: GuideRoute, index: Int) -> [Int] {
    guard index >= 0, index < route.steps.count else { return [] }
    if route.steps[index].isLong { return [index] }
    var a = index
    var b = index
    while a > 0 && !route.steps[a - 1].isLong { a -= 1 }
    while b < route.steps.count - 1 && !route.steps[b + 1].isLong { b += 1 }
    return route.steps[a...b].map(\.index)
}

private func stepAt(route: GuideRoute, d: Double) -> GuideStepSpan {
    for s in route.steps where d < s.endD { return s }
    return route.steps[route.steps.count - 1]
}

/// 임의 진행거리에서의 초기 상태(전환·재획득·재조회 리셋 공용).
///
/// ⚠ **`courseDerivation`은 같은 세션의 재구성(재조회·brief↔detail 전환)이라면 반드시
/// 직전 상태의 버퍼를 넘긴다**(spec §2.9 — 궤적은 경로의 함수가 아니라서 경로 교체는
/// 버퍼를 비울 사유가 아니다. 비우면 갈림 직후 재조회에서 축이 ~10m 냉시동된다).
/// 기본값(빈 버퍼)은 **새 세션(안내 시작)에서만** 정당하다.
public func guideStateAt(
    route: GuideRoute, d: Double, now: Double, autoHandoffArmed: Bool = true,
    hasFinalApproachGeometry: Bool = false,
    courseDerivation: CourseDerivationState = initialDerivationState
) -> GuideState {
    let step = stepAt(route: route, d: d)
    let unit = unitAt(route: route, index: step.index)
    return GuideState(
        phase: step.isLong ? .following : .bundle,
        resumePhase: step.isLong ? .following : .bundle,
        d: d,
        stepIndex: step.index,
        announcedUpTo: unit[unit.count - 1],
        // ⚠ **유닛 끝이 아니라 지금 서 있는 스텝이다.** 지나온 것은 이 스텝의 시작
        // 결정뿐이고, 같은 유닛의 뒤쪽 스텝들은 아직 앞에 있다 — 유닛 끝으로 두면
        // 묶음 안의 회전이 통째로 사라진다.
        imminentUpTo: step.index,
        lastAnnouncedAt: now,
        lastFixAt: nil,
        windowEdgeHits: 0,
        offRouteSince: nil,
        lastOffRouteNoticeAt: nil,
        speedSamples: [],
        speedGuardActive: false,
        speedWarned: false,
        autoHandoffArmed: autoHandoffArmed,
        // 기본은 false(옛 50m 인계) — 기하를 안다고 주장하려면 명시해야 한다.
        hasFinalApproachGeometry: hasFinalApproachGeometry,
        // 재진입 유닛은 원거리 예고 소비 처리 — 경계 안 시작은 크로싱 불성립(§4.3).
        farNoticedUpTo: unit[unit.count - 1],
        offRoutePeakPerp: nil,
        reacquirePrevD: nil,
        reacquireV: 0,
        reacquireSince: nil,
        reacquiringFromOffRoute: false,
        offRouteAxes: OffRouteAxes(),
        courseVotes: [],
        courseDerivation: courseDerivation
    )
}

/// 시작 상태 + 원자 시작 발화(스펙 §5.3)에 넣을 첫 유닛. 문장 조립은 오케스트레이터 몫.
public func initialGuideState(
    route: GuideRoute, now: Double, hasFinalApproachGeometry: Bool = false,
    courseDerivation: CourseDerivationState = initialDerivationState
) -> (state: GuideState, firstIndices: [Int]) {
    (
        guideStateAt(
            route: route, d: 0, now: now,
            hasFinalApproachGeometry: hasFinalApproachGeometry,
            // 재조회(같은 세션의 새 경로)는 직전 버퍼를 넘긴다 — guideStateAt ⚠ 참조.
            courseDerivation: courseDerivation
        ),
        unitAt(route: route, index: 0)
    )
}

/// 같은 세션 안에서 진행거리만 바꿔 상태를 다시 만든다(재획득·복귀 공용).
///
/// ⚠ **세션 성질의 승계 목록은 여기 한 곳에만 둔다.** 호출 지점마다 나열하면 새 필드를
/// 더할 때 하나를 빠뜨리고, 그 결과는 조용하다 — 웹에서 실제로 `hasFinalApproachGeometry`가
/// 재획득 경로에서만 떨어져 진입선이 옛 50m로 되돌아간 적이 있다(계측으로 발견).
func restateAt(
    route: GuideRoute, d: Double, now: Double, prev: GuideState
) -> GuideState {
    // 유도기 버퍼는 궤적의 사실이라 재구성에서도 잇는다(spec §2.9 — 비우는 것은
    // 표결 창이지 버퍼가 아니다. 버퍼는 age 상한으로 자체 소멸한다).
    guideStateAt(
        route: route, d: d, now: now,
        autoHandoffArmed: prev.autoHandoffArmed,
        hasFinalApproachGeometry: prev.hasFinalApproachGeometry,
        courseDerivation: prev.courseDerivation
    )
}

/// 최종 접근 진입선(경로 잔여 m). 기하를 알면 경로 종점까지 가고, 모르면 옛 50m다
/// (spec 2026-08-08 §3.2). 웹 `finalApproachEntryM` 미러.
public func finalApproachEntryMeters(
    state: GuideState, accuracy: Double, tuning: GuideTuning
) -> Double {
    guard state.hasFinalApproachGeometry else { return tuning.handoffDistM }
    return max(arrivalToleranceMinMeters, accuracy)
}

public enum GuideEntryProjection: Sendable, Equatable {
    case ok(d: Double)
    case ambiguous
    case none
}

/// 간략→상세 전환·재조회 후 초기 투영(스펙 §6). 후보가 복수면 확정하지 않는다 —
/// 잘못 고른 후보도 폴리라인 위라 수직거리 이탈 판정이 영영 못 잡는다.
public func entryProjection(
    route: GuideRoute, fix: GuideFix, tuning: GuideTuning = .walk
) -> GuideEntryProjection {
    let maxPerp = max(tuning.offRouteBaseM, 2 * fix.accuracy)
    let cands = globalCandidates(route.polyline, p: fix.point, maxPerp: maxPerp)
    if cands.isEmpty { return .none }
    if cands.count > 1 { return .ambiguous }
    return .ok(d: cands[0].d)
}

private func periodicIntervalSeconds(remaining: Double) -> Double {
    if remaining > 500 { return 60 }
    if remaining >= 150 { return 30 }
    return 15
}

/// 방위 관측은 인자가 아니라 **리듀서가 fix 이력에서 직접 유도한다**(spec §2.9 재설계).
/// 플랫폼이 관측을 만들어 넘길 수 없는 구조가 1선 방어다 — 두 플랫폼의 유도가
/// 갈리는 drift(사슬 U·전진 게이트가 플랫폼별로 달라짐)를 시그니처가 차단한다.
public func guideStep(
    state: GuideState, fix: GuideFix, route: GuideRoute, now: Double,
    tuning: GuideTuning
) -> GuideOutput {
    // 0) 역순 시각 방어: now가 과거로 가면 fix 폐기(상태 불변).
    if let last = state.lastFixAt, now < last {
        return GuideOutput(state: state, event: nil, tone: nil)
    }

    // 유도기 갱신은 국면과 무관하게 매 fix 1회 — 버퍼는 궤적의 사실이다(spec §2.9).
    // finalApproach·uncertain 조기 반환보다 앞이라 어느 국면에서도 버퍼가 이어진다.
    var state = state
    let dv = deriveCourse(state.courseDerivation, lat: fix.lat, lng: fix.lng, at: now)
    state.courseDerivation = dv.state
    // 프로파일 게이트는 여기 한 곳뿐이다 — 조건을 하위 분기마다 흩으면 하나를
    // 빠뜨리고, 그 하나가 조용히 축을 살린다(기존 계약 유지).
    let derived: DerivedCourse? = tuning.courseAxisEnabled ? dv.obs : nil
    // 관측이 없으면 표를 내지 않는다(spec §2.10 — 창에 안 쌓임). 대신 창은 시간으로
    // 낡는다: 정지가 길어지면 표가 말라 verdict가 unknown으로 돌아간다(§2.0 ⚠).
    func pruneVotes(_ samples: [CourseVoteSample]) -> [CourseVoteSample] {
        samples.filter { $0.at > now - courseAxisWindowSeconds }
    }

    // 0a) 최종 접근 중에는 리듀서가 아무 판정도 하지 않는다(spec §4 전이표).
    //     발화 소유권이 최종 접근 층으로 넘어갔고, 이 국면은 **경로를 이미 벗어난**
    //     구간을 다루므로 낡은 폴리라인으로 이탈·재획득을 주장하면 거짓이다.
    //     ⚠ **이 가드는 반드시 uncertain 게이트보다 앞에 온다.** 뒤에 두면 정확도가
    //     나빠질 때 uncertain을 경유했다가 resumePhase(.following)로 복귀하면서
    //     단방향 래치가 조용히 풀린다.
    if state.phase == .finalApproach {
        var s = state
        s.lastFixAt = now
        // 낡은 폴리라인 기준 표는 이 국면에서 근거가 아니다(경로를 이미 벗어난 구간).
        s.courseVotes = []
        return GuideOutput(state: s, event: nil, tone: nil)
    }

    // 1) uncertain 게이트(정확도 무효 포함): 자동 낭독·타이머 전부 정지.
    let accBad = !(fix.accuracy > 0) || fix.accuracy > uncertainAccuracyMeters
    if state.phase == .uncertain {
        if accBad {
            var s = state
            s.lastFixAt = now
            return GuideOutput(state: s, event: nil, tone: nil)
        }
        var s = state
        s.phase = state.resumePhase
        s.lastFixAt = now
        s.lastAnnouncedAt = now
        return GuideOutput(state: s, event: .uncertainExit, tone: nil)
    }
    if accBad {
        var s = state
        s.phase = .uncertain
        // 이탈 중 진입이면 복귀도 이탈로(이탈 상태 소실 방지 — 리뷰 HIGH의 대칭 경로).
        s.resumePhase = state.phase == .offRoute ? .offRoute : state.resumePhase
        s.lastFixAt = now
        s.speedSamples = []
        // ⚠ 창은 비우고 latch(offRouteAxes)는 보존한다. 투영을 못 믿는 기간의 표는
        //   근거가 아니지만, 이탈 사실이 정확도 악화로 소실되면 안 된다.
        s.courseVotes = []
        return GuideOutput(state: s, event: .uncertainEnter, tone: nil)
    }

    // 2) reacquiring: 전역 재탐색(모호하면 유지 — 다음 fix에서 재시도).
    if state.phase == .reacquiring {
        var entryD: Double?
        if case let .ok(d) = entryProjection(route: route, fix: fix, tuning: tuning) {
            entryD = d
        } else if case .ambiguous = entryProjection(route: route, fix: fix, tuning: tuning),
                  tuning.reacquireTieBreak,
                  let prevD = state.reacquirePrevD,
                  let since = state.reacquireSince {
            // 재획득 전방 연속성 타이브레이크(§4.3): 전방 창 안 후보가 정확히 1개일
            // 때만 채택. 0·복수는 거부 유지 — 평행도로 이탈 은폐 차단.
            // elapsed는 "마지막으로 확실했던 시점"부터의 경과(고정 보정 없음 —
            // gap 트리거는 진입 시 직전 fix 시각을 reacquireSince에 담는다).
            let elapsed = now - since
            let maxAheadD = prevD + state.reacquireV * elapsed * 1.5 + 100
            let maxPerp = max(tuning.offRouteBaseM, 2 * fix.accuracy)
            let inWindow = globalCandidates(route.polyline, p: fix.point, maxPerp: maxPerp)
                .filter { $0.d >= prevD && $0.d <= maxAheadD }
            if inWindow.count == 1 { entryD = inWindow[0].d }
        }
        guard let d = entryD else {
            var s = state
            s.lastFixAt = now
            return GuideOutput(state: s, event: nil, tone: nil)
        }
        // ⚠ 재획득 성공도 복귀다. 방위 축이 잠겨 있으면 위치만으로 풀지 않는다.
        //   이 경로가 §5의 offRoute 분기보다 **먼저** 실행되므로, 여기를 빼면
        //   fix 공백 10초만으로 복귀 계약이 통째로 우회된다.
        // ⚠ 이 판정은 **구조상 항상 hold다.** 재획득 진입에서 창이 비워졌으므로 표가
        //   하나뿐이고 courseAxisMinVotes(8)에 못 미쳐 verdict가 반드시 unknown이다.
        //   그래도 verdict를 부르는 형태로 두는 이유는, 창 초기화 정책이 바뀌면 이
        //   자리가 자동으로 증거 평가로 돌아가야 하기 때문이다.
        let reVotes = derived == nil
            ? pruneVotes(state.courseVotes)
            : recordVote(
                state.courseVotes, at: now,
                vote: courseVote(derived, poly: route.polyline, d: d)
            )
        if state.offRouteAxes.course, courseAxisVerdict(reVotes) != .on {
            // 위치는 되찾았지만 방향이 확인되지 않았다 — 이탈 상태를 유지한다.
            // `reacquiringFromOffRoute`를 내리는 이유: 국면을 offRoute로 되돌리므로
            // 재획득 상태가 아니다. 남기면 다음 재획득에서 이벤트 종류를 잘못 가른다.
            var held = state
            held.phase = .offRoute
            held.lastFixAt = now
            held.courseVotes = reVotes
            held.reacquiringFromOffRoute = false
            return GuideOutput(state: held, event: nil, tone: nil)
        }
        var s = restateAt(route: route, d: d, now: now, prev: state)
        s.speedWarned = state.speedWarned
        s.lastFixAt = now
        // 이탈 확정 상태에서 공백으로 넘어온 재확보는 곧 이탈 종료다 — backOnRoute를
        // 내야 UI의 이탈 상태(재조회 버튼)가 함께 닫힌다(리뷰 HIGH).
        return GuideOutput(
            state: s,
            event: state.reacquiringFromOffRoute ? .backOnRoute : .reacquired,
            tone: nil
        )
    }
    let gap = state.lastFixAt.map { now - $0 > reacquireGapSeconds } ?? false
    if gap || state.windowEdgeHits >= edgeHitsMax {
        var s = state
        s.phase = .reacquiring
        s.windowEdgeHits = 0
        s.speedSamples = []
        // 위치를 잃은 동안의 표는 근거가 아니다(latch는 보존).
        s.courseVotes = []
        s.lastFixAt = now
        s.reacquiringFromOffRoute = state.phase == .offRoute
        // 타이브레이크 기준 보관 — 표본은 지금 리셋되므로 진입 시점에 계산해 둔다.
        // 기준 시각은 "마지막으로 확실했던 시점"(gap=직전 fix 시각·edgeHits=지금).
        s.reacquirePrevD = state.d
        s.reacquireV = estimateSpeedMps(state.speedSamples)
        s.reacquireSince = gap ? state.lastFixAt : now
        return GuideOutput(state: s, event: .reacquiring, tone: nil)
    }

    // 3) 구속 창 투영 + 단조 전진(스펙 §5.1). 창 크기는 직전 창 속도로 되먹인다
    //    (walk는 속도 계수 0이라 현행 동일).
    let vPrev = estimateSpeedMps(state.speedSamples)
    let ahead = max(tuning.windowAheadMinM, 3 * fix.accuracy, vPrev * tuning.windowAheadSpeedS)
    guard let proj = projectOnPolyline(
        route.polyline, p: fix.point, fromD: state.d - windowBackMeters, toD: state.d + ahead
    ) else {
        var s = state
        s.lastFixAt = now
        return GuideOutput(state: s, event: nil, tone: nil)
    }
    let d = max(state.d, proj.d)
    // 투영 점프: 직전 수용 fix 대비 물리 불가능한 전진(tuning.maxSpeedMps 주석 — A10).
    // 단조 전진이라 감소 방향은 없고, 재구성 직후(lastFixAt 초기화)는 기준이 없어 false다.
    // dt=0(동시각 fix)은 전진이 있을 때만 점프다 — 종전 오케스트레이터는 무조건 true였는데,
    // 전진 0을 점프로 보면 직전 fix에서 거부된 진입이 동시각 중복 fix에서도 계속 막힌다
    // (의도적 변경, 독립 리뷰 2026-08-11 확인).
    let jumped = state.lastFixAt.map {
        d - state.d > tuning.maxSpeedMps * max(0, now - $0) * 1.5
    } ?? false
    // 방위 축 표결(spec §2.1). 추종 중 기준은 구속 창 투영 결과다. 관측 없으면 표 없음.
    let vote: CourseVote? = derived == nil ? nil : courseVote(derived, poly: route.polyline, d: d)
    // 진단 계측: 이 fix가 실제로 넣은 표. 이탈 분기에서 entry 기준으로 덮인다.
    var loggedVote = vote
    func emit(_ s: GuideState, _ event: GuideEvent?, _ tone: GuideTone?) -> GuideOutput {
        GuideOutput(
            state: s, event: event, tone: tone,
            perpMeters: proj.perpMeters, courseVote: loggedVote, derivedCourse: derived,
            projectionJumped: jumped
        )
    }
    let courseVotes = vote.map { recordVote(state.courseVotes, at: now, vote: $0) }
        ?? pruneVotes(state.courseVotes)
    // 창 경계 적중은 "경로 위인데 창이 못 따라간" 신호일 때만 센다. 수직거리가 크면
    // 그것은 이탈 증거이지 창 기아가 아니다.
    let offThreshold = max(tuning.offRouteBaseM, 2 * fix.accuracy)
    let edgeHit = proj.d >= state.d + ahead - 1 && proj.perpMeters <= offThreshold
    let windowEdgeHits = edgeHit ? state.windowEdgeHits + 1 : 0

    // 4) 속도 창(10초 중앙값) — uncertain·reacquiring 밖에서만 표본 수집.
    //    정확도 나쁜 fix(>20m)는 표본에서 배제한다(투영·전진은 유지 — 위치 축과 속도
    //    축의 품질 요구가 다르다). 배제가 이어지면 창이 짧아져 가드 판정이 멈춘다.
    var samples = state.speedSamples
    if fix.accuracy <= speedSampleMaxAccuracyMeters {
        samples.append(GuideSpeedSample(at: now, d: d))
    }
    samples.removeAll { now - $0.at > speedWindowSeconds }
    var speeds: [Double] = []
    for i in 1..<max(samples.count, 1) where samples[i].at > samples[i - 1].at {
        speeds.append((samples[i].d - samples[i - 1].d) / (samples[i].at - samples[i - 1].at))
    }
    speeds.sort()
    let median = speeds.isEmpty ? 0 : speeds[speeds.count / 2]
    let windowSpan = samples.count >= 2 ? samples[samples.count - 1].at - samples[0].at : 0
    var speedGuardActive = state.speedGuardActive
    // 가드 기계는 speedSuggest 프로파일에서만 동작한다(차량 상시 활성 → 재통지 잠식 차단).
    if tuning.speedSuggest {
        if windowSpan >= speedWindowSeconds * 0.8 {
            if !speedGuardActive && median > speedEnterMps {
                speedGuardActive = true
            } else if speedGuardActive && median < speedClearMps {
                speedGuardActive = false
            }
        } else if speedGuardActive, samples.isEmpty {
            // 표본이 전무하면(정확도 배제·시간창 배수로 소멸) 판정 근거가 없다 —
            // 낡은 판정을 쥔 채 이탈 재통지를 무기한 억제하는 고착 차단(독립 리뷰).
            speedGuardActive = false
        }
    }

    let remainingTotal = route.totalMeters - d
    var next = state
    next.d = d
    next.stepIndex = stepAt(route: route, d: d).index
    next.lastFixAt = now
    next.windowEdgeHits = windowEdgeHits
    next.speedSamples = samples
    next.speedGuardActive = speedGuardActive
    next.courseVotes = courseVotes
    // 재무장: 수동 복귀 세션은 잔여가 재무장선 밖으로 나가야 자동 인계 허용.
    if !next.autoHandoffArmed && remainingTotal > tuning.handoffRearmM {
        next.autoHandoffArmed = true
    }

    // 5) 이탈 판정(스펙 §5.6).
    if state.phase == .offRoute {
        // 이탈 중 복귀 감지는 구속 창이 아니라 전역 후보로 한다. 이탈 동안 창이 뒤에
        // 머물러, 사용자가 경로 앞쪽으로 복귀해도 창 안 투영으로는 영영 못 잡는다.
        // ⚠ 이탈 중 표결 기준은 `state.d`가 아니라 `entryProjection`이 고른 지점이다.
        //   `state.d`는 단조 전진이라 역주행·되돌아가기에서 실제 복귀 지점과 다르다.
        //   후보가 모호하면 방위가 맞아도 복귀를 확정하지 않는다(판정 근거 없음).
        // ⚠ 이탈 중에는 창을 비우지 않는다 — 비우면 복귀 판정 표본이 영영 최소치에
        //   못 미친다(국면 초기화는 uncertain·reacquiring·finalApproach에만).
        let entry = entryProjection(route: route, fix: fix, tuning: tuning)
        var offVote: CourseVote?
        if derived != nil {
            // 관측은 있는데 기준점이 모호하면 판정 불가 표, 관측이 없으면 표 없음.
            offVote = .unknown
            if case let .ok(entryD) = entry {
                offVote = courseVote(derived, poly: route.polyline, d: entryD)
            }
        }
        let offVotes = offVote.map { recordVote(state.courseVotes, at: now, vote: $0) }
            ?? pruneVotes(state.courseVotes)
        next.courseVotes = offVotes
        loggedVote = offVote // 진단: 이 국면에서 창에 들어간 표는 entry 기준이다.
        if case let .ok(entryD) = entry {
            // 축별 해제. 평가 불가(`unknown`)는 해제가 아니다.
            let courseCleared =
                !state.offRouteAxes.course || courseAxisVerdict(offVotes) == .on
            if courseCleared {
                // restateAt이 guideStateAt을 거치므로 창과 latch가 함께 초기화된다(§2.8).
                var back = restateAt(route: route, d: entryD, now: now, prev: state)
                back.speedSamples = samples
                back.speedGuardActive = speedGuardActive
                back.speedWarned = state.speedWarned
                back.lastFixAt = now
                return emit(back, .backOnRoute, nil)
            }
        }
        let canRenotify = !speedGuardActive &&
            (state.lastOffRouteNoticeAt.map { now - $0 >= tuning.offRouteRenotifyS } ?? true)
        if canRenotify {
            next.lastOffRouteNoticeAt = now
            // 재통지 톤은 프로파일 몫(차량은 이탈=정보라 무톤, 첫 확정만 경고 — §4.3).
            return emit(next, .offRoute, tuning.offRouteRenotifyWarns ? .warning : nil)
        }
        return emit(next, nil, nil)
    }
    let courseVerdict = courseAxisVerdict(courseVotes)
    let isOff = proj.perpMeters > offThreshold
    if isOff {
        var since = state.offRouteSince ?? now
        var peak = max(state.offRoutePeakPerp ?? 0, proj.perpMeters)
        // 복귀 추세 유예(offRouteTrend): 관측 최대 대비 5m 이상 줄면 누적 리셋(§4.3).
        if tuning.offRouteTrend, proj.perpMeters < peak - 5 {
            since = now
            peak = proj.perpMeters
        }
        next.offRouteSince = since
        next.offRoutePeakPerp = peak
        if now - since >= tuning.offRouteHoldS {
            next.phase = .offRoute
            next.resumePhase = stepAt(route: route, d: d).isLong ? .following : .bundle
            next.lastOffRouteNoticeAt = now
            next.offRoutePeakPerp = nil
            next.offRouteAxes.distance = true
            return emit(next, .offRoute, .warning)
        }
    } else if state.offRouteSince != nil {
        next.offRouteSince = nil
        next.offRoutePeakPerp = nil
    }
    // 방위 축은 거리 축과 독립이다. 수직거리가 임계 안이어도 확정한다 — 자기근접으로
    // 수직거리가 무너지는 갈림에서 이 축이 유일한 증거다(spec §1.2).
    if courseVerdict == .off {
        next.phase = .offRoute
        next.resumePhase = stepAt(route: route, d: d).isLong ? .following : .bundle
        next.lastOffRouteNoticeAt = now
        // 거리 축 확정과 같은 상태를 남긴다 — 두 확정 경로가 서로 다른 잔여를 남기면
        // 다음 사람이 어느 쪽을 믿어야 할지 알 수 없다(무해하더라도 읽는 비용이다).
        next.offRouteSince = nil
        next.offRoutePeakPerp = nil
        next.offRouteAxes.course = true
        return emit(next, .offRoute, .warning)
    }

    // 6) 국면·낭독.
    let cur = stepAt(route: route, d: d)
    next.phase = cur.isLong ? .following : .bundle
    next.resumePhase = cur.isLong ? .following : .bundle

    // 6a) 결정 지점 임박 큐(25m, walk 전용 — 10m→25m 실보행 판정 2026-08-10): 소리·진동과 짧은 명령형 한 문장으로
    //     "지금이다"를 알린다.
    //
    //     ⚠ **래치가 스텝 단위인 것이 계약이다 — 유닛 단위로 뛰면 안 된다.** 전문 낭독(6c)이
    //     유닛 단위인 이유는 짧은 스텝들을 한 문장으로 묶어 읽기 위함인데, 결정 지점은
    //     그 유닛 **안에도** 있다. 유닛 끝까지 래치를 뛰게 하면 유닛의 첫 스텝만 분류되고
    //     나머지 결정 지점은 큐를 받을 기회가 구조적으로 사라진다(실측: 자택→고우헤어
    //     경로의 유닛 [4,5]에서 [4]가 단순 이동이라 [5]의 마지막 좌회전이 통째로 침묵했다.
    //     경복궁 경로는 33·36·28m 간격 3연속 회전 중 첫 회전만 울렸다).
    //     "무엇을"은 유닛 단위, "지금이다"는 결정 지점 단위 — 같은 수열일 이유가 없다.
    //
    //     ⚠ **불변식: 전문이 나간 스텝만 큐를 받는다**(`imminentUpTo < announcedUpTo`).
    //     "잠시 후 왼쪽으로 도세요"를 무엇을 향한 회전인지 말하기 전에 내보내면 명령만
    //     남는다. 두 래치가 같으면 그 스텝은 아직 전문 전이므로 6c에 자리를 내준다.
    //
    //     ⚠ **6c(전문 낭독)보다 앞이고, 6b(최종 접근)에는 양보하지 않는다.**
    //     6c에 밀리는 것은 짧은 유닛에서 재현되므로 앞에 둔다(다음 유닛 전문 38m와 이번
    //     횡단보도 8m가 같은 fix에 걸리는데 급한 쪽은 8m다).
    //     ⚠ **알려진 한계**: 최종 접근이 먼저 래치되면 마지막 결정 지점의 큐가 사라진다.
    //     두 조건은 같은 fix에서 경쟁하는 게 아니라 거리가 달라서(최종 접근은 잔여 50m,
    //     큐는 경계 25m 앞), 블록 순서만으로는 못 막는다. **"결정 지점이 남았으면 최종
    //     접근을 미룬다"를 실제로 구현해 봤고 되돌렸다** — 이탈 판정이 마지막 50m까지
    //     연장되면서 A6 헛경고율이 2배가 됐다(실측: BIASED 2.x% → 6.7%, HARSH 10.5%,
    //     `a6-probe.test.ts` 상한 전부 초과). 도착 직전의 거짓 "경로 이탈" 경고가 놓친
    //     큐 하나보다 나쁘다. **프로덕션 영향은 좁다**: 앱은 `includeGeometry=1`을 보내
    //     진입선이 `max(10, accuracy)`라 큐가 먼저 나간다. 기하 없는 구버전 응답과
    //     `accuracy > 마지막스텝길이 + 10`인 경우에만 사라진다. A6 상수 확정 뒤 재검토
    //     대상이다(`docs/BACKLOG.md`).
    //
    //     ⚠ **경계를 이미 지났으면 발화하지 않는다**(`rem >= 0`). 하한이 없으면 uncertain
    //     구간을 지나 창이 `d`를 경계 너머로 끌어올린 fix에서 "잠시 후 왼쪽으로 도세요"가
    //     **모퉁이를 돈 뒤에** 나간다(실측: 정확도 악화 → 회복 후 d가 214m로 착지, 경계는
    //     200m). 6c의 서술문과 달리 이 문장은 시점이 박힌 명령문이라 오독의 대가가 다르다.
    //     지나친 경계는 한 fix 안에서 전부 흘려보낸다 — 한 개씩 따라잡으면 그 사이의
    //     진짜 결정 지점을 놓친다.
    //
    //     ⚠ **행동이 없는 경계에서도 래치는 전진시키고 발화만 건너뛴다.** 직진 연결마다
    //     소리를 내면 큐가 신호이기를 그만두고, 반대로 래치를 세워 두면 그 경계에 걸려
    //     다음 회전을 영영 못 알린다.
    //
    //     ⚠ `!isOff`는 6b와 같은 이유다(아래 주석) — 이 fix가 이탈로 판정됐지만 확정
    //     유예를 못 채운 중간 상태에서, 의심 중인 투영을 근거로 명령을 내지 않는다.
    if let imminentAheadM = tuning.imminentAheadM, !isOff {
        while next.imminentUpTo < next.announcedUpTo,
              route.steps[next.imminentUpTo].endD < d {
            next.imminentUpTo += 1
        }
        if next.imminentUpTo < next.announcedUpTo,
           route.steps[next.imminentUpTo].endD - d <= imminentAheadM {
            let target = next.imminentUpTo + 1
            let action = walkStepAction(route.steps[target].description)
            next.imminentUpTo = target
            if let action {
                next.lastAnnouncedAt = now
                return emit(next, .imminent(indices: [target], action: action), .ahead)
            }
        }
    }

    // 6b) 최종 접근 진입: 전 스텝 낭독 완료 AND 진입선 도달 AND 재무장
    //     (스펙 2026-08-03 §5.3 + 2026-08-08 §3.2) — 웹 route-guide.ts 미러.
    //
    //     기하를 아는 세션의 진입선은 **경로 종점**이다. 종전 50m는 "경로 종점 = 목적지"를
    //     전제한 판단이었고, 실측에서 오프셋 16~89m가 확인돼 무효화됐다.
    //
    //     ⚠ 단방향 래치다. 진입하면 0a) 가드가 이후 모든 판정을 멈춘다.
    //     ⚠ **`isOff`를 직접 본다** — 5절 early-return은 이미 확정된 offRoute만 막고,
    //     새로 이탈 판정됐으나 확정 유예 전인 중간 상태는 6절이 phase를 되돌려 통과시킨다.
    //     ⚠ **방위 축은 여기서 다시 보지 않는다 — 순서가 곧 불변식이다.** 방위 확정
    //     블록이 위에서 무조건 return하므로 이 지점의 `courseVerdict`는 결코 .off가
    //     아니다. 그 배선을 이 블록 **뒤로** 옮기면 종점 부근에서 finalApproachEnter가
    //     먼저 반환되고, 다음 fix부터 0a 가드가 모든 판정을 멈춰 확인된 이탈이 영구히
    //     소실된다. 순서를 바꾸지 말 것(웹 route-guide.ts 동형).
    //     ⚠ **`!jumped`: 튄 잔여 거리로 진입을 확정하지 않는다**(A10, 2026-08-11 하교
    //     실사고). 종전에는 오케스트레이터가 진입 이벤트를 사후 거부했는데, phase는
    //     이미 커밋된 뒤라 0a 가드에 갇혀 세션이 영구 정지했다. 여기서 미루면 진입과
    //     phase 전이가 원자적이고, d가 유계라 반복 점프는 자기 종결된다 — 조건이
    //     참이면 다음 fix(전진 0 = 점프 아님)에서 진입한다.
    if !isOff,
       !jumped,
       next.autoHandoffArmed,
       next.announcedUpTo >= route.steps.count - 1,
       remainingTotal <= finalApproachEntryMeters(
           state: next, accuracy: fix.accuracy, tuning: tuning
       ) {
        next.phase = .finalApproach
        return emit(next, .finalApproachEnter, nil)
    }

    // 6c) 선행 낭독: 낭독 완료 유닛의 끝까지 잔여 ≤ 임박선이면 다음 유닛 전문.
    //     임박선은 max(거리 하한, v×시간 계수) — walk는 시간 계수 0이라 40m 고정 동일.
    if next.announcedUpTo < route.steps.count - 1 {
        let announcedEnd = route.steps[next.announcedUpTo].endD
        let announceAhead = max(tuning.announceAheadM, vPrev * tuning.announceAheadSpeedS)
        if announcedEnd - d <= announceAhead {
            let indices = unitAt(route: route, index: next.announcedUpTo + 1)
            next.announcedUpTo = indices[indices.count - 1]
            // 임박이 나가면 그 유닛의 원거리 예고는 소비된다(뒤늦은 원거리 예고 금지).
            next.farNoticedUpTo = max(next.farNoticedUpTo, indices[indices.count - 1])
            next.lastAnnouncedAt = now
            // ⚠ **톤은 임박 층이 있는 프로파일에서만 뗀다.** walk는 `ahead`가 6a로 옮겨
            //   갔으므로 여기서 또 울리면 소리가 "곧 뭔가 있다"와 "지금이다" 둘 다를 뜻하게
            //   되어 신호가 흐려진다(실보행 피드백 2026-08-09). 반대로 car는 임박 층이
            //   없으므로 여기가 **그 자리의 유일한 소리**다 — 무조건 떼면 자동차 세션은
            //   이탈 경고를 빼고 우선 톤이 0이 되고, `ahead`가 열던 3초 정숙 구간까지
            //   함께 사라진다(리뷰 검출 회귀).
            //   ⚠ walk에서 그 정숙 구간이 40m 시점에 사라지는 것은 **아는 대가**다. 이 fix의
            //   추세음은 `eventOwned`가 막지만 다음 fix부터는 막지 않으므로, 낭독 첫 3초
            //   보호가 없어진다. 실보행 판정 대상이다(`docs/BACKLOG.md`).
            let tone: GuideTone? = tuning.imminentAheadM == nil ? .ahead : nil
            return emit(next, .announceSteps(indices), tone)
        }
    }

    // 6b') 원거리 예고(§4.3 car 전용): 다음 분기 경계선을 하향 통과하는 fix에서 1회.
    //      세션 시작·재획득 재진입이 이미 경계 안이면 크로싱 불성립으로 자연 생략.
    if let farNoticeM = tuning.farNoticeM,
       next.announcedUpTo < route.steps.count - 1,
       next.farNoticedUpTo <= next.announcedUpTo {
        let boundary = route.steps[next.announcedUpTo].endD
        let prevRemaining = boundary - state.d
        let nowRemaining = boundary - d
        if prevRemaining > farNoticeM, nowRemaining <= farNoticeM {
            let indices = unitAt(route: route, index: next.announcedUpTo + 1)
            next.farNoticedUpTo = indices[indices.count - 1]
            next.lastAnnouncedAt = now
            // 낭독 거리는 크로싱 시점의 실측 잔여(§4.7 — 상수 낭독 금지, 리뷰 검출).
            return emit(
                next,
                .farNotice(indices: indices, remainingMeters: Int(nowRemaining.rounded())),
                nil
            )
        }
    }

    // 6c) 주기: following=구간 잔여, bundle=묶음 재통독. 기준은 lastAnnouncedAt.
    let sinceAnnounce = now - next.lastAnnouncedAt
    if cur.isLong {
        let remainingStep = cur.endD - d
        if sinceAnnounce >= periodicIntervalSeconds(remaining: remainingStep) {
            next.lastAnnouncedAt = now
            return emit(
                next,
                .periodic(
                    stepIndex: cur.index,
                    remainingMeters: Int(remainingStep.rounded()),
                    accuracy: fix.accuracy
                ),
                nil
            )
        }
    } else if sinceAnnounce >= bundleRereadSeconds {
        let indices = unitAt(route: route, index: cur.index)
        next.lastAnnouncedAt = now
        return emit(next, .bundleReread(indices), nil)
    }

    // 6d) 속도 제안(최하위, 세션당 1회).
    if speedGuardActive && !next.speedWarned {
        next.speedWarned = true
        return emit(next, .speedSuggest, nil)
    }
    return emit(next, nil, nil)
}
