import SwiftUI
import GildongmuKit

/// 안내 화면 종류 — 루트 `.sheet(item:)`의 item. 두 시트를 독립 Bool로 경쟁시키지
/// 않는다(설계 리뷰 M2: 한 갱신에서 한 시트가 내려가며 다른 시트가 올라오면
/// presentation이 무시될 수 있다).
enum GuideScreenKind: String, Identifiable {
    /// `journey`는 여정(E70)의 단계 사이 — 다음 세션 준비 중이거나 실패해 결정을 기다리는 동안의 시트(`JourneySheet`).
    case beacon, transit, outing, journey
    var id: String { rawValue }
}

/// 실시간 안내 세션의 앱 수준 소유자(N1, spec `2026-08-22-guide-session-minimize-design.md`).
///
/// `BeaconModel`·`TransitGuideModel`이 길찾기 탭 `@State`에 살던 시절엔 탭 전환이
/// 곧 세션 종료였고 시트 닫힘이 곧 중지였다. 이제 모델은 앱 수명이고, 시트·띠바의
/// 표시 상태(`isMinimized`)는 여기 산다 — **모델은 최소화를 모른다**.
///
/// 시작 요청은 전부 `startBeacon`·`startTransit`을 지난다(설계 리뷰 C1·C2): 거부
/// 게이트 한 곳 + 다른 모델의 잔여 화면(도착·중지 종료 화면, 핸드오프 제안) 소거.
@Observable @MainActor
final class GuideSession {
    static let shared = GuideSession()

    let coordinator = GuideSessionCoordinator()
    let beacon = BeaconModel()
    let transit = TransitGuideModel()
    /// 나들이(E51) — 도착지 없는 도보 안내. 세 번째 안내 모델이고 같은 잠금·같은 시트 자리를 쓴다.
    let outing = OutingModel()

    /// 시트가 내려가 있고 띠바가 세션을 대표하는 상태. `hasScreen`이 false로 떨어질 때
    /// `GildongmuApp`이 명시적으로 되돌린다(설계 리뷰 M1).
    var isMinimized = false
    /// 경유지 지원 조건(N4): 비콘(도보·자동차) 세션 추적 중 ∧ ko 데이터 로케일(상세 경로
    /// 조회 자체가 ko 전용이라 그 밖에선 경유지가 의미 없다). 대중교통 세션은 제외(ODsay
    /// 미지원). 장소 상세 버튼과 안내 시트 버튼이 같은 게이트를 본다.
    /// 여정(E70) 단계 세션은 제외 — 경유지가 여정 계획(택시 목적지 = 승차역)과 갈라진다.
    var waypointAvailable: Bool { beacon.isTracking && AppLanguage.dataLocale == "ko" && journey == nil }

    private var walkHandoffTask: Task<Void, Never>?

    /// 승차 전 도보 연결 컨텍스트(A25 spec 2026-08-30 §4.4). 도보 세션이 끝나면 같은 시작 요청으로
    /// 대중교통 세션을 잇는다. `id`가 이전 세션의 늦은 콜백을 걸러 낸다.
    /// 환승 도보(E73)도 같은 연결이다 — `startLeg`가 걸어서 닿을 승차 구간(승차 전 도보 0)이고 경로는 처음 경로 전체다.
    private struct PrewalkContext {
        let id: UUID
        let guideRoute: TransitGuideRoute
        let startLeg: Int
        let destinationLabel: String
        let destinationRoman: String?
        let dest: BeaconDest
        let accessible: Bool
        /// 승차역 표시 라벨(ko·en 쌍)과 도보 분 — 도보 세션 표식·시작 문장이 읽는다(재시작이 같은 문장을 다시 낸다, A68).
        let station: TransitLabel
        let minutes: Int

        /// 같은 연결의 새 세대(A68 재시작) — 옛 도보 세션의 늦은 콜백이 새 연결을 소비하지 않게 `id`만 바꾼다.
        func renewed() -> PrewalkContext {
            PrewalkContext(
                id: UUID(), guideRoute: guideRoute, startLeg: startLeg, destinationLabel: destinationLabel,
                destinationRoman: destinationRoman, dest: dest, accessible: accessible, station: station,
                minutes: minutes)
        }

        /// 대중교통 세션이 이미 돌던 환승 도보인가 — 정지 꼬리 문장(「대중교통 안내도 종료했습니다」)과 위치 상실 뒤 그 구간 대기로의
        /// 재개(`endPrewalk`)를 가른다(spec D6·D14).
        var isTransfer: Bool { startLeg > 0 }
    }
    private var prewalk: PrewalkContext?
    /// 비콘의 직전 시작이 승차 전 도보였으면 그 연결 컨텍스트(A68). 길찾기 탭 [정확한 위치 허용]의 재시작(`restartBeacon`)이
    /// 이 연결을 다시 걸고 모델이 든 시작 인자로 걷기를 다시 시작해, 승차 전 도보 → 대중교통으로 잇는다. `prewalk`와 달리
    /// 도보 세션이 끝나도 남는다(쓰이는 때가 실패 뒤다). 비콘의 `lastStartRequest`와 짝이라 세우는 자리는 `launchPrewalk`
    /// (여정 안이면 비운다) 하나, 거두는 자리는 `retirePrewalkRestart` 하나다 — 그 실패 줄과 함께 거둔다(따로 지우면 남은
    /// 줄의 재시작이 연결 없는 도보가 된다).
    private var prewalkRestart: PrewalkContext?
    private var prewalkTask: Task<Void, Never>?
    /// `startTransit`의 prewalk 경로가 `startBeacon`을 부르는 동안 true — 그 호출의 취소 게이트가
    /// 자기 컨텍스트를 지우지 않게.
    private var launchingPrewalk = false
    /// 나들이 귀환 인계(E51 §5.3)의 컨텍스트 id. 도보 세션의 `.startFailed`만 인계 실패로 소비한다.
    private var outingReturnID: UUID?
    /// `acceptOutingReturn`이 `startBeacon`을 부르는 동안 true — `cancelPrewalk()`가 인계 콜백(`onSessionEnd`)을
    /// 지우지 않게(`launchingPrewalk` 동형).
    private var launchingOutingReturn = false

    // MARK: 여정(E70) 상태 — spec 2026-10-17-e70-mode-change-journey-design.md §6

    /// 여정 상태(Kit `journeyStep`이 전이를 정한다). nil이면 여정 없음 — 이때 이 타입의 모든 동작은 종전 그대로다.
    private(set) var journey: JourneyState?
    private(set) var journeyPlan: JourneyPlan?
    /// 진행 중 끊김(`.ended`)으로 실패했을 때 그 모델이 이미 낸 실패 문장 키와 해결 수단(§6.1). 실패 시트의 상태 줄이다.
    private(set) var journeyFailure: (key: String, resolution: BeaconModel.FailResolution)?
    /// 사이 상태의 준비 작업(인계 지연·측위) — 하나만 보관하고 종료·다음 전이가 취소한다.
    private var journeyTask: Task<Void, Never>?
    /// 사이 상태에 들어간 시각(복귀 시 30초 상한 판정, §6.3). 잠자기 중에도 전진하는 시계.
    private var journeyTransitionAt: ContinuousClock.Instant?
    /// 접근 도보·승차 전 도보(A67) 시작 실패 뒤 대중교통 시작이 도보 모델의 통지(원인 + 다리 문장)를 기다리는 상한(ms). 두 문장이 VoiceOver 기본
    /// 속도로 4~6초라 여유를 두고, 사이 상태 상한(`JourneyTuning.staleTransitionSeconds` 30초)보다 충분히 짧다.
    private static let walkSpeechWaitLimitMs = 8_000
    /// `startJourneyStage`가 `beginBeacon`을 부르는 동안 true — 거기서 건 종료 훅을 `cancelPrewalk()`가 지우지 않게.
    private var launchingJourneyStage = false
    /// 동기 거부로 온 시작 실패는 `beacon.lastFailure`(지난 세션의 원인)를 실패 시트에 쓰지 않는다.
    private var ignoreFailureCause = false

    private init() {}

    /// 세션 활성 = 코디네이터 점유 ∨ 비콘 시작 대기(권한 팝업 등, 설계 리뷰 M5). **단계 세션이 도는가**이고 모델
    /// 입구 셋(`BeaconModel.requestStart`·`TransitGuideModel.start`·`startAfterPrewalk`)이 보는 값이다 — 여정을
    /// 넣지 않는다(넣으면 여정 자신의 다음 세션이 모델 입구에서 막힌다, E70 빌더 점검 1).
    var isActive: Bool { coordinator.isActive || beacon.starting || outing.starting }

    /// 외부 시작을 막는가 = 단계 세션 ∨ 여정(단계 사이 포함). 공개 시작 진입점·길찾기 탭의 재시작이 본다.
    /// 여정이 없으면 `isActive`와 같다(정식판 동작 불변).
    var isOccupied: Bool { isActive || journey != nil }

    /// 안내 화면이 존재해야 하는가 — 추적 중이거나 세션 뒤에 남은 화면이 있을 때.
    var hasScreen: Bool { screen != nil }

    /// 어느 화면인가. 둘 다면 비콘(핸드오프 600ms 창에서 비콘이 이긴다).
    var screen: GuideScreenKind? {
        if beacon.isTracking || beacon.arrivalDest != nil { return .beacon }
        if outing.isTracking || outing.endScreen != nil { return .outing }
        if transit.isTracking || transit.pendingWalkHandoff != nil { return .transit }
        // 여정의 단계 세션이 없는 동안(준비·실패) — 재시도 버튼이 놓일 시트가 늘 있다(spec §6.3). `running`은 그 세션의
        // 시트다(정지 직후 한 턴 동안 여정 시트가 끼어 깜빡이지 않게).
        if let journey {
            switch journey.phase {
            case .transitioning, .failed: return .journey
            case .running: break
            }
        }
        return nil
    }

    var presentedScreen: GuideScreenKind? { isMinimized ? nil : screen }

    // MARK: - 시작 진입점

    func startBeacon(_ request: BeaconModel.StartRequest) {
        guard !refuseIfActive() else { return }
        beginBeacon(request)
    }

    /// 거부 가드 없는 비콘 시작 본문(E70 §6.3). 호출자는 공개 `startBeacon`과 내부 인계(승차 전 도보·여정 단계)뿐이다
    /// — 여정 중 외부 시작은 `startBeacon`의 거부에서 멈추고, 여정 자신의 다음 세션만 이 길로 온다(점유를 잠시 풀지 않는다).
    private func beginBeacon(_ request: BeaconModel.StartRequest) {
        if !launchingPrewalk { retirePrewalkRestart() }  // 비콘의 직전 시작 인자가 이제 승차 전 도보가 아니다(A68)
        if !launchingPrewalk, !launchingOutingReturn, !launchingJourneyStage { cancelPrewalk() }
        transit.clearWalkHandoff()
        outing.clearEnd()
        beacon.requestStart(request)
    }

    /// 나들이 시작(E51 §5.1) — 진입점 둘(제목 메뉴·길찾기 탭 거절 자리의 버튼)이 부르는 **유일한** 시작 경로.
    func startOuting() {
        guard !refuseIfActive() else { return }
        cancelPrewalk()
        retirePrewalkRestart()
        beacon.clearArrival()
        transit.clearWalkHandoff()
        outing.requestStart()
    }

    /// "출발점으로"(E51 §5.3) — 나들이 세션(또는 종료 화면)을 치우고 출발점까지 도보 안내로 인계한다.
    /// 승차 전 도보(A25)와 같은 모양: 컨텍스트 id + 인계 플래그 아래 `startBeacon`, 실패(`.startFailed`)면
    /// 길찾기 탭 도착지에 출발점을 프리필한다(§12). 인계 발화점은 이 함수 하나다.
    func acceptOutingReturn() {
        guard let target = outing.returnTarget else { return }
        outing.endForReturn()
        // 인계 고지는 도보 안내의 시작 문장("{출발점}까지 도보 안내 시작…", E40)이 맡는다 — 따로 말하면 같은 정보가 두 번이다.
        let id = UUID()
        outingReturnID = id
        beacon.onSessionEnd = { [weak self] reason in self?.endOutingReturn(id, reason: reason, target: target) }
        launchingOutingReturn = true
        self.startBeacon(BeaconModel.StartRequest(
            dest: BeaconDest(lat: target.lat, lng: target.lng), label: target.label, labelRoman: nil, kind: .walk,
            accessible: false, variant: nil, line: nil, alternate: nil,
            waypoint: nil, carListener: nil))  // 귀환 경로에 경유지는 없다. 출발점 라벨은 라틴 표기가 없다(그 이름 그대로)
        launchingOutingReturn = false
        // 동기 거부(requestStart 게이트)면 시작 Task가 없어 실패 콜백도 없다 — 여기서 잇는다.
        if !beacon.starting, !beacon.isTracking { endOutingReturn(id, reason: .startFailed, target: target) }
    }

    private func endOutingReturn(_ id: UUID, reason: BeaconModel.EndReason, target: OutingModel.ReturnTarget) {
        guard outingReturnID == id else { return }
        outingReturnID = nil
        beacon.onSessionEnd = nil
        guard reason == .startFailed else { return }
        // 도보 안내의 실패 문장은 그 모델이 이미 냈다. 사용자가 길찾기 탭에서 출발점을 찾을 수 있게만 한다.
        DirectionsPrefillStore.shared.pending = DirectionsPrefill(
            role: .to, endpoint: .place(label: target.label, lat: target.lat, lng: target.lng))
    }

    func startTransit(
        route: TransitRoute, destinationLabel: String, destinationRoman: String?, dest: BeaconDest, accessible: Bool
    ) {
        guard !refuseIfActive() else { return }
        beginTransit(
            route: route, destinationLabel: destinationLabel, destinationRoman: destinationRoman, dest: dest,
            accessible: accessible, aboard: nil)
    }

    /// 거부 가드 없는 대중교통 시작 본문(E70 §6.3, `beginBeacon` 동형). 승차 전 도보(A25)도 여기서 갈린다.
    /// `aboard`(E71)가 있으면 이미 탄 열차에서 시작이라 승차 전 도보 판정을 건너뛴다(서버가 승차 쪽을 잘라 원래 서지 않지만
    /// 구조로 막는다). ⚠ 기본값 없음(안전 인자).
    private func beginTransit(
        route: TransitRoute, destinationLabel: String, destinationRoman: String?, dest: BeaconDest, accessible: Bool,
        aboard: TransitAboardStart?
    ) {
        cancelPrewalk()
        retirePrewalkRestart()  // 새 대중교통 시작 — 승차 전 도보가 있으면 아래 `launchPrewalk`가 새 연결을 세운다
        beacon.clearArrival()
        outing.clearEnd()
        // 승차 전 도보(A25): 첫 탑승 leg 앞 도보가 있으면 도보 실시간 안내를 먼저 돌리고, 도착하면
        // 같은 요청으로 대중교통 세션을 잇는다. 판정은 순수 함수(웹 미러) — nil이면 종전 경로.
        guard let guideRoute = buildTransitGuideRoute(route), aboard == nil,
              let target = transitPrewalkTarget(guideRoute)
        else {
            transit.start(
                transitRoute: route, destinationLabel: destinationLabel, destinationRoman: destinationRoman,
                dest: dest, accessible: accessible, aboard: aboard)
            return
        }
        // 표시 라벨은 ko·en 쌍(E27 잔여 ①).
        //
        // ⚠ **도보 세션의 목적지 라벨(`label:`)도 같은 이름을 쓴다.** 종전 주석은 그 자리를
        // "조인·표시 겸용"이라고 적었는데 **틀렸다** — `destinationLabel`은 `GuideText.periodicWalk`·
        // `progress`·`finalApproachEnter`로만 가는 **표시 전용**이고 조인하는 소비자가 없다.
        // 이 자리를 한국어로 두면 한 세션 안에서 같은 역이 두 이름으로 불린다(a11y 감사 검출):
        // 시작 통지 "Walk to Cheonho" → 걷는 중 "Go straight 200 m to 천호" → 도착 "Arrived at
        // Cheonho". 화면을 못 보는 사용자에게 그 둘이 같은 곳이라는 근거가 없어 "목적지가
        // 바뀌었나"를 의심하게 된다 — 이름이 통째로 한국어인 것보다 나쁘다.
        let stationLabel = transitPrewalkLabel(target)
        let walkLabel = transitGuideIsEn ? (stationLabel.en ?? stationLabel.ko) : stationLabel.ko
        let context = PrewalkContext(
            id: UUID(), guideRoute: guideRoute, startLeg: 0, destinationLabel: destinationLabel,
            destinationRoman: destinationRoman, dest: dest, accessible: accessible, station: stationLabel,
            minutes: target.minutes)
        launchPrewalk(context) {
            beginBeacon(BeaconModel.StartRequest(
                // 역 라벨은 이미 통지 언어로 골랐다(`walkLabel`) — 라틴 표기를 따로 싣지 않는다.
                dest: BeaconDest(lat: target.lat, lng: target.lng), label: walkLabel, labelRoman: nil, kind: .walk,
                accessible: accessible, variant: nil, line: nil, alternate: nil,
                waypoint: nil, carListener: nil))  // 승차역까지의 도보에 경유지는 없다
        }
    }

    /// 환승 도보(E73 spec D1·D4) — 대중교통 모델의 「다음 구간」이 걷기 안내 대상 도보 앞 구간으로 넘어갈 때 부른다(유일한
    /// 호출자 `TransitGuideModel.completeOrAdvance`). 대중교통 세션을 정지음 없이 끝내고(여정 훅 보존) 600ms 뒤 승차 전 도보와
    /// 같은 연결로 다음 승차 지점까지 걷는다. 걸어서 닿으면 `endPrewalk`가 같은 경로로 그 구간부터 대중교통을 다시 연다.
    func transitTransferWalk(_ handoff: TransitTransferWalkHandoff) {
        transit.stopForTransferWalk()
        let stationLabel = transitPrewalkLabel(handoff.target)
        // 도보 세션 목적지 라벨도 통지와 같은 언어의 같은 이름이다(`beginTransit`의 승차 전 도보 주석과 같은 근거).
        let walkLabel = transitGuideIsEn ? (stationLabel.en ?? stationLabel.ko) : stationLabel.ko
        let context = PrewalkContext(
            id: UUID(), guideRoute: handoff.route, startLeg: handoff.legIndex,
            destinationLabel: handoff.destinationLabel, destinationRoman: handoff.destinationRoman,
            dest: handoff.dest, accessible: handoff.accessible, station: stationLabel, minutes: handoff.target.minutes)
        let walkDest = BeaconDest(lat: handoff.target.lat, lng: handoff.target.lng)
        guideDiagLog("transferWalk leg=\(handoff.legIndex) minutes=\(handoff.target.minutes)")
        // 600ms: 대중교통 시트가 내려간 뒤 도보 시트가 뜬다(E34 하차 후 인계·A25 도착 인계와 같은 값·같은 근거 — 루트 시트 하나).
        // 대기는 `prewalkTask` 한 칸이라 그 사이 다른 시작의 `cancelPrewalk()`가 함께 취소한다.
        prewalkTask?.cancel()
        prewalkTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self else { return }
            // 모든 시작이 `cancelPrewalk()`를 지나지는 않는다(길찾기 탭 정밀 위치 재시작 `restartBeacon`은 승차 전 도보 컨텍스트가 없으면 모델 재시작으로 곧장 간다) —
            // 그 사이 다른 안내가 섰으면 그 세션에 환승 표식·종료 훅을 걸지 않고 인계를 버린다(설계 리뷰 high, spec D4).
            guard !self.isActive else {
                guideDiagLog("transferWalk abandoned reason=occupied")
                // 여정의 대중교통 단계였으면 세션 없는 running에 남지 않게 실패 시트로(`endPrewalk` 두 갈래와 같은 모양, 구현 리뷰 L2).
                if let journey = self.journey, case .running(.transit) = journey.phase {
                    self.advanceJourney(.stageEnded(.startFailed), token: journey.token)
                }
                return
            }
            self.launchPrewalk(context) {
                self.beginBeacon(BeaconModel.StartRequest(
                    dest: walkDest, label: walkLabel, labelRoman: nil, kind: .walk,
                    accessible: handoff.accessible, variant: nil, line: nil, alternate: nil,
                    waypoint: nil, carListener: nil))  // 환승역까지의 도보에 경유지는 없다
            }
        }
    }

    /// 승차 전 도보 연결을 걸고 도보 세션을 시작한다 — 대중교통 시작(`beginTransit`)과 정밀 위치 재시작(`restartBeacon`, A68)이
    /// 같은 표식·같은 종료 훅·같은 시작 문장을 쓴다. `startWalk`는 도보 세션 시작 하나다(새 요청, 또는 모델이 든 인자의 재시작).
    private func launchPrewalk(_ context: PrewalkContext, startWalk: () -> Void) {
        prewalk = context
        // 여정 안의 승차 전 도보는 재시작 대상이 아니다 — 여정 재시도는 실패 시트의 [경로 다시 조회]가 맡고(E70 §6.3), 여정이
        // 끝난 뒤 남으면 여정 없는 대중교통이 시작된다. 비콘 시작 인자는 곧 바뀌므로 옛 컨텍스트도 남기지 않는다.
        prewalkRestart = journey == nil ? context : nil
        beacon.markPrewalk(target: context.station, transfer: context.isTransfer)
        beacon.onSessionEnd = { [weak self] reason in self?.endPrewalk(context.id, reason: reason) }
        // 환승 도보(E73)는 대중교통 시트가 막 내려가 커서가 밑 화면으로 옮겨 간 자리다 — 그 낭독과 도보 시트 착지에 끊기면
        // "대중교통은 걸은 뒤 이어진다"를 말해 주는 곳이 없어 `.high`(통지 우선순위 판별선, 접근성 감사 M1). A25 첫 도보는 앞 시트가 없다.
        transit.announceExternal(TransitGuideTextRenderer.render(
            transitPrewalkStartLine(
                isEn: transitGuideIsEn, station: context.station, minutes: context.minutes)),
            highPriority: context.isTransfer, speechClass: .actionable)
        launchingPrewalk = true
        startWalk()
        launchingPrewalk = false
        // 동기 거부(requestStart 게이트)면 시작 Task가 없어 실패 콜백도 없다 — 여기서 잇는다.
        if !beacon.starting, !beacon.isTracking { endPrewalk(context.id, reason: .startFailed) }
    }

    /// 승차 전 도보 세션의 종료 → 대중교통 연결(spec §4.4). 다른 도보 세션·낡은 콜백은 id로 무시.
    private func endPrewalk(_ id: UUID, reason: BeaconModel.EndReason) {
        guard let context = prewalk, context.id == id else { return }
        prewalk = nil
        beacon.onSessionEnd = nil
        switch reason {
        case .arrived:
            // 600ms: §14.2 하차 후 핸드오프와 같은 값·같은 근거(같은 계층 두 시트의 단일 presentation).
            prewalkTask?.cancel()
            prewalkTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(600))
                guard !Task.isCancelled, let self else { return }
                self.transit.startAfterPrewalk(
                    guideRoute: context.guideRoute, startLeg: context.startLeg,
                    destinationLabel: context.destinationLabel, destinationRoman: context.destinationRoman,
                    dest: context.dest, accessible: context.accessible, prewalkCompleted: true)
                // 여정의 대중교통 단계인데 세션이 서지 않았으면 세션 없는 running에 남지 않게 실패 시트로.
                if !self.transit.isTracking, let journey = self.journey, case .running(.transit) = journey.phase {
                    guideDiagLog("journey prewalkTransitStartFailed")
                    self.advanceJourney(.stageEnded(.startFailed), token: journey.token)
                }
            }
        case .startFailed:
            // 도보 안내가 불가해도 대중교통 안내는 가능하다 — 도보 문맥은 유지(아직 걷지 않았다).
            beacon.clearPrewalk()  // 동기 거부 분기는 begin() Task를 지나지 않아 표식이 남는다
            // 다리 문장(「도보 안내를 시작할 수 없어 승차 대기로 바로 넘어갑니다」)은 도보 모델이 원인 문장 뒤에 붙여 `.high` 한
            // 통지로 냈다(A67, `BeaconModel.fail`). 대중교통 창구로 따로 내면 전경에서 같은 턴에 게시돼 원인 문장을 끊는다
            // (백그라운드는 어느 창구든 세션 전이라 버리지만, 시작 실패는 탭 직후 전경에서 판정돼 닿지 않는다). 동기 거부(`beginTransit`
            // 말미)는 원인 문장도 다리 문장도 없다 — 그 경로는 `startTransit`의 `refuseIfActive`가 같은 상태를 먼저 보므로 닿지 않는다.
            resumeTransitAfterWalkSpeech(context, prewalkCompleted: false, sheetGapMs: 0, logLabel: "startFailSpeechWait")
        case .locationLost where context.isTransfer:
            // 환승 도보 중 위치 권한·정확한 위치 상실(위원장 판정 2026-10-19): 걷기만 끝내고 그 구간 승차 대기로 — 남은 대중교통
            // 안내는 위치 없이 도착 정보로 따라간다. 재진입은 도착과 같은 `startAfterPrewalk(prewalkCompleted: true)`다: 이미 걷던
            // 중이라 「도보 N분 이동 후」를 다시 말하면 지난 일을 미래형으로 말한다. 사유와 다리 문장(「도보 안내를 멈추고 승차 대기로
            // 넘어갑니다」)은 도보 모델이 한 통지로 냈다(`BeaconModel.stopAndFail`). 600ms: 걷던 시트가 내려간 뒤 대중교통 시트가
            // 뜬다(도착 갈래와 같은 근거). 여정 안이면 훅이 보존된 재개 세션이 여정을 잇는다(E73 D9). 맨 처음 승차 전 도보(A25)는
            // 아래 갈래 그대로 — 판정 범위는 환승 도보다.
            guideDiagLog("transferWalk locationLost resume leg=\(context.startLeg)")
            resumeTransitAfterWalkSpeech(context, prewalkCompleted: true, sheetGapMs: 600, logLabel: "locationLostSpeechWait")
        case .userStopped, .locationLost, .ended:
            // 여정(A 미지정)의 첫 단계가 승차 전 도보였으면 대중교통 세션은 시작되지 않으므로 여정도 끝난다(D11).
            if let journey, case .running(.transit) = journey.phase {
                advanceJourney(.transitStopped, token: journey.token)
            }
            // 문장을 내지 않는다. "대중교통 안내는 시작하지 않았다"는 도보 모델이 정지·실패 사유 뒤에 붙여 **한 통지**로 냈다
            // (사용자 정지 `BeaconModel.stopByUser`, 권한·정밀 위치 상실 `stopAndFail` — `.locationLost`. prewalk엔
            // 안전망이 돌지 않고 다른 시작 진입은 세션 중 거절된다). 대중교통 창구로 내면 그 재생기는 세션을 시작한 적이 없어
            // 도보 정지음을 기다리지 않고 겹치며(A54 접근성 감사), 화면이 꺼진 동안엔 버려지고 대중교통 복귀 상환은 추적 가드
            // 뒤라 어디서도 전달되지 않았다(E53 spec §3.3, 횡단 리뷰 F3).
            break
        }
    }

    /// 도보 모델이 낸 원인·다리 통지가 끝난 뒤 같은 경로로 그 구간의 대중교통 안내를 연다(`endPrewalk`의 시작 실패·환승 도보 위치
    /// 상실 갈래). 대중교통 시작 통지가 그 두 문장을 끊지 않게 VoiceOver 통지 장부를 기다린다(여정 접근 도보 `prepareJourneyStage`와
    /// 같은 장부·상한). `sheetGapMs`는 걷던 시트가 있었을 때 내려갈 틈이다(시작 실패는 시트가 서기 전이라 0). `logLabel`은 실기기 판정 행이
    /// 읽는 진단 로그 이름이다(`prewalk startFailSpeechWait` — BACKLOG A67).
    private func resumeTransitAfterWalkSpeech(
        _ context: PrewalkContext, prewalkCompleted: Bool, sheetGapMs: Int, logLabel: String
    ) {
        prewalkTask?.cancel()
        prewalkTask = Task { @MainActor [weak self] in
            if sheetGapMs > 0 { try? await Task.sleep(for: .milliseconds(sheetGapMs)) }
            guard !Task.isCancelled, let self else { return }
            if UIAccessibility.isVoiceOverRunning {
                var waited = 0
                while !self.beacon.announcementsSettled, waited < Self.walkSpeechWaitLimitMs {
                    try? await Task.sleep(for: .milliseconds(100))
                    guard !Task.isCancelled else { return }
                    waited += 100
                }
                guideDiagLog("prewalk \(logLabel) ms=\(waited) open=\(GuideSpeechOutput.openAnnouncements)")
            }
            guard !Task.isCancelled else { return }
            self.transit.startAfterPrewalk(
                guideRoute: context.guideRoute, startLeg: context.startLeg,
                destinationLabel: context.destinationLabel, destinationRoman: context.destinationRoman,
                dest: context.dest, accessible: context.accessible, prewalkCompleted: prewalkCompleted)
            // 여정의 대중교통 단계인데 세션이 서지 않았으면(경로 변환 실패) 세션 없는 running에 남지 않게 끝낸다.
            if !self.transit.isTracking, let journey = self.journey, case .running(.transit) = journey.phase {
                guideDiagLog("journey prewalkTransitStartFailed")
                self.advanceJourney(.stageEnded(.startFailed), token: journey.token)
            }
        }
    }

    /// 승차 전 도보 재시작 컨텍스트와 그 실패 줄(길찾기 탭 선두의 실패 문장·해결 버튼)을 함께 거둔다(A68 판정 2). 그 실패를
    /// 만든 승차 전 도보와 무관한 안내가 시작될 때(승차 전 도보가 아닌 비콘 시작·대중교통·나들이·여정 시작)와 대중교통 안내가
    /// 그 계획을 지나갔을 때(`transitPassedPrewalk`: 탔다·경로나 목적지를 바꿨다) 부른다 — 그 뒤에 누르면 지나온 승차역이나
    /// 옛 경로로 걷기가 다시 시작된다. 되돌리지 않는다: 오승격 뒤 [탑승 변경]으로 대기에 돌아가도 버튼은 다시 서지 않는다.
    /// 컨텍스트가 없으면 실패 줄은 승차 전 도보의 것이 아니라 건드리지 않는다. 재시작 창구(`restartBeacon`)와 연결의 종료
    /// (`cancelPrewalk`·`endPrewalk`·`finishJourney`)는 부르지 않는다 — 타기 전에 대중교통을 끝냈으면 그 버튼이 다시 잇는다.
    private func retirePrewalkRestart() {
        guard prewalkRestart != nil else { return }
        prewalkRestart = nil
        beacon.clearFailure()
    }

    /// 대중교통 안내가 승차 전 도보의 계획을 지나갔다(A68 판정 2) — 탔다(`TransitGuideModel.dispatch`: riding 이후 국면 ∨
    /// 다음 leg, 선언·관측·[이미 탔어요]·추적 불가 [다음 구간] 어느 길이든) 또는 경로·목적지를 바꿨다(`changeRoute`). 그 뒤엔
    /// 승차 전 도보의 실패 줄과 버튼이 가리키던 걷기가 지난 일이다.
    func transitPassedPrewalk() {
        retirePrewalkRestart()
    }

    /// 낡은 연결 폐기 — 모든 시작 진입·여정 종료에서. 추적 중인 도보 세션은 건드리지 않는다.
    private func cancelPrewalk() {
        prewalk = nil
        prewalkTask?.cancel()
        prewalkTask = nil
        beacon.clearPrewalk()
    }

    /// 길찾기 탭 [정확한 위치 허용] 뒤 재시작(A13·A68) — 그 버튼이 부르는 유일한 경로. 대중교통·여정이 진행 중이면 거부한다
    /// (「이미 안내 중」, 도보로 되돌아가지 않는다). 걷기는 언제나 모델이 든 시작 인자 한 벌로 다시 시작한다 — 세션 중 바꾼
    /// 목적지·경유지·줄이 거기 동기화돼 있다(인자를 다시 조립하지 않는다, A13). 비콘의 직전 시작이 승차 전 도보였으면 그 앞에
    /// 연결(표식·종료 훅·시작 문장)을 다시 걸어, 도착하면 대중교통으로 잇는다.
    func restartBeacon() {
        guard !refuseIfActive() else { return }
        transit.clearWalkHandoff()
        outing.clearEnd()
        guard let context = prewalkRestart else {
            beacon.restart()
            return
        }
        // 컨텍스트가 있으면 모델의 시작 인자도 그 승차 전 도보다(둘은 `launchPrewalk`의 같은 턴에 선다 — 그 시작이 동기 거부되는
        // 길은 `startTransit`의 거부 게이트가 먼저 막는다). 새 입구가 이 짝을 깨면 아래 재시작이 no-op이 되어, `launchPrewalk`의
        // 동기 거부 폴백이 원인 문장 없이 대중교통을 시작한다.
        // 시작 실패 뒤 대중교통 시작이 통지 끝을 기다리는 창(A67)이면 그 대기를 취소한다 — 걷기가 다시 시작되므로
        // 대중교통은 도착(또는 다시 실패)한 뒤에 선다.
        cancelPrewalk()
        launchPrewalk(context.renewed()) {
            beacon.restart()
        }
    }

    /// 거부 통지는 모델의 창구를 쓴다(지연 슬롯·억제 규칙을 지나야 한다). 판정은 `isOccupied` — 여정 중(단계 사이 포함)
    /// 외부 시작은 거부한다(E70 §6.3).
    private func refuseIfActive() -> Bool {
        guard isOccupied else { return false }
        beacon.announceNow(appLocalized("guide.alreadyActive"), highPriority: true, bypassSuppression: true)
        return true
    }

    /// 대중교통 완료 뒤 도보 핸드오프 수락(§14.2) — 한 전이(설계 리뷰 C5·C6):
    /// transit 종료(release 포함, 이미 끝났으면 no-op) → 제안 소거 → 600ms 뒤 비콘 시작.
    /// Task는 세션이 소유한다(탭 `onDisappear`가 취소하던 종전 구조는 탭을 떠나면
    /// 수락한 핸드오프를 죽였다).
    func acceptWalkHandoff() {
        guard let dest = transit.dest else { return }
        let label = transit.destinationLabel
        let roman = transit.destinationRoman
        let accessible = transit.accessible
        transit.stop()
        transit.clearWalkHandoff()
        walkHandoffTask?.cancel()
        walkHandoffTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self else { return }
            self.startBeacon(BeaconModel.StartRequest(
                dest: dest, label: label, labelRoman: roman, kind: .walk, accessible: accessible,
                variant: nil, line: nil, alternate: nil,
                waypoint: nil, carListener: nil))  // 대중교통 세션엔 경유지가 없다(ODsay 미지원)
        }
    }

    /// 자동차 도착 뒤 도보 인계(K2 §6.4) — 같은 모델이라 대중교통 인계의 600ms 지연이 없다:
    /// 종료 화면 소거 → 같은 목적지로 도보 시작(경유지 없음, 계단 회피 없음).
    func acceptCarWalkHandoff() {
        guard let dest = beacon.arrivalDest else { return }
        let label = beacon.destinationLabel
        let roman = beacon.destinationRoman
        beacon.clearArrival()
        self.startBeacon(BeaconModel.StartRequest(
            dest: dest, label: label, labelRoman: roman, kind: .walk, accessible: false,
            variant: nil, line: nil, alternate: nil, waypoint: nil, carListener: nil))
    }

    func handleScenePhaseChange(to phase: ScenePhase) {
        beacon.handleScenePhaseChange(to: phase)
        transit.handleScenePhaseChange(to: phase)
        outing.handleScenePhaseChange(to: phase)
        // 복귀 시 사이 상태가 30초 넘게 남아 있으면 실패로 내린다 — 조용한 영구 대기 금지(spec §6.3).
        if phase == .active, let journey, case .transitioning = journey.phase, let at = journeyTransitionAt,
           at.duration(to: .now) > .seconds(JourneyTuning.staleTransitionSeconds) {
            advanceJourney(.staleTimeout, token: journey.token)
        }
    }

    // MARK: - 여정(E70, spec §6)

    /// 여정 시작 — 길찾기 탭 여정 결과의 [안내 시작] 한 곳에서만 부른다(실험판 봉인, `guidance-gate-drift.test.ts`).
    func startJourney(plan: JourneyPlan) {
        guard !refuseIfActive() else { return }
        cancelPrewalk()
        retirePrewalkRestart()
        beacon.clearArrival()
        transit.clearWalkHandoff()
        outing.clearEnd()
        let state = JourneyState.start(id: UUID(), shape: plan.shape)
        journeyPlan = plan
        journeyFailure = nil
        journey = state
        guard case .transitioning(let first) = state.phase else { return }
        // 첫 단계는 준비할 것이 없다(인계 지연·접근 도보 판정은 단계 사이의 일) — 곧바로 시작해 여정 시트가 한 턴 끼지 않게.
        advanceJourney(.prepared(first), token: state.token)
    }

    /// 시트 버튼(「자동차에서 내렸어요」·「자동차에 탔어요」·[경로 다시 조회]·[안내 종료])의 입구 — 누른 순간의 token을 싣는다.
    func journeyAction(_ event: JourneyEvent) {
        guard let journey else { return }
        advanceJourney(event, token: journey.token)
    }

    /// 단계가 끝나는 사건의 **유일한** 입구. 전이를 동기로 커밋한 뒤(seq + 1) 준비 작업·다음 세션을 시작한다 —
    /// 늦게 도착한 콜백·조회 완료·인계 지연은 seq 불일치로 버려진다(spec §6.3 "전이는 원자적으로 예약한다").
    func advanceJourney(_ event: JourneyEvent, token: JourneyToken) {
        guard let state = journey else { return }
        // 접근 도보를 시작하지 못하면 대중교통으로 넘어간다 — 다리 문장(판정 27)은 도보 모델이 원인 문장 뒤에 붙여 한 통지로
        // 낸다(`markChained(bridgesStartFailure:)`). 대중교통 시작은 그 통지가 끝나기를 기다린다 — 600ms 인계 뒤 시작 통지가
        // 긴 두 문장을 끊지 않게. 동기 거부(`ignoreFailureCause`)는 원인 문장이 없고(거부 게이트가 「이미 안내 중」을 냈다)
        // 이어지는 대중교통도 같은 이유로 거부되므로 다리 문장도 기다림도 없다.
        let accessBridged = !ignoreFailureCause && state.phase == .running(.access) && event == .stageEnded(.startFailed)
        switch journeyStep(state, event, token: token) {
        case .ignore:
            return
        case .end:
            finishJourney(stopSessions: event == .userEnded)
        case .next(let next):
            journey = next
            switch next.phase {
            case .transitioning(let stage):
                journeyFailure = nil
                // 버튼 사건은 아직 도는 단계 세션을 멈춘다 — 그 종료 콜백은 낡은 token이라 버려진다.
                if event == .taxiDropped || event == .taxiBoarded, beacon.isTracking || beacon.starting { beacon.stop() }
                prepareJourneyStage(
                    stage, token: next.token, delayed: event != .retry, waitsForWalkSpeech: accessBridged)
            case .running(let stage):
                journeyTransitionAt = nil
                startJourneyStage(stage, token: next.token)
            case .failed:
                journeyTask?.cancel()
                journeyTask = nil
                journeyTransitionAt = nil
                // 그 모델이 낸 원인 문장(권한·정밀 위치)과 해결 수단을 보존한다 — 이미 통지했으므로 다시 말하지 않고 시트 상태
                // 줄과 버튼이 쓴다. 시작 실패도 같다(`begin`이 시작마다 `lastFailure`를 비우므로 이번 시도의 원인이다).
                journeyFailure = !ignoreFailureCause
                    && (event == .stageEnded(.ended) || event == .stageEnded(.startFailed))
                    ? beacon.lastFailure : nil
                // 준비가 30초를 넘긴 실패는 어느 모델도 말하지 않았다 — 띠바로 최소화돼 있어도 들리게 한 번 낸다.
                if event == .staleTimeout {
                    beacon.announceNow(journeyStatusText(self), highPriority: true, bypassSuppression: false)
                }
            }
        }
    }

    /// 사이 상태의 준비: 인계 지연(첫 시작·재시도는 없음) → 접근 도보면 그때 위치로 30m 판정(D6) → `prepared`.
    /// 택시 단계는 미리 측위하지 않는다 — 자동차 세션이 첫 fix로 스스로 경로를 조회하고(§6.3 "택시 세션의 경로"),
    /// 측위 실패는 그 세션의 `.startFailed`로 온다.
    private func prepareJourneyStage(
        _ stage: JourneyStage, token: JourneyToken, delayed: Bool, waitsForWalkSpeech: Bool
    ) {
        journeyTask?.cancel()
        journeyTransitionAt = .now
        journeyTask = Task { @MainActor [weak self] in
            if delayed { try? await Task.sleep(for: .milliseconds(JourneyTuning.handoffDelayMs)) }
            guard !Task.isCancelled, let self else { return }
            // 도보 모델의 통지(원인 + 다리 문장)가 끝날 때까지 — 안내 시트 첫 정보 행 착지(E57)와 같은 장부·상한 계측.
            // VoiceOver가 꺼져 있으면 장부에 적히지 않으므로 기다리지 않는다.
            if waitsForWalkSpeech, UIAccessibility.isVoiceOverRunning {
                var waited = 0
                while !self.beacon.announcementsSettled, waited < Self.walkSpeechWaitLimitMs {
                    try? await Task.sleep(for: .milliseconds(100))
                    guard !Task.isCancelled else { return }
                    waited += 100
                }
                guideDiagLog("journey accessFailSpeechWait ms=\(waited) open=\(GuideSpeechOutput.openAnnouncements)")
            }
            var ready = stage
            if stage == .access, let board = self.journeyPlan?.variant.boardStation {
                // 측위 실패면 걷기 안내를 시작한다(그 세션이 도착을 판정한다) — 빠진 안내보다 군더더기가 낫다.
                // 캐시 우선(force 없음) — 택시가 막 확정 도착했으면 정확도 30m 안 fix가 이미 있고, 주머니 속 잠금 화면에서
                // 새 측위를 걸면 지연·중단 동안 다음 단계가 말없이 늦는다.
                if let here = try? await LocationService.shared.currentCoordinate(force: false),
                   !journeyNeedsAccessWalk(
                       fromLat: here.lat, fromLng: here.lng, toLat: board.coord.lat, toLng: board.coord.lng) {
                    ready = .transit
                }
                guard !Task.isCancelled else { return }
            }
            self.advanceJourney(.prepared(ready), token: token)
        }
    }

    /// 여정 단계 세션 시작 — `begin*`을 부르는 여정 쪽 유일한 자리. token이 지금 것이고 단계 세션이 하나도 돌지 않을
    /// 때만 시작한다(점유를 잠시 푸는 방식은 그 틈에 외부 시작이 끼어든다, spec §6.3).
    private func startJourneyStage(_ stage: JourneyStage, token: JourneyToken) {
        guard journey?.token == token, !beacon.isTracking, !beacon.starting, !transit.isTracking,
              let plan = journeyPlan
        else {
            guideDiagLog("journey stageStartRefused stage=\(stage.rawValue)")
            // 낡은 token은 조용히 버린다. 지금 token인데 단계 세션이 돌고 있으면 불변식 위반 — 시작 실패로 넘겨 실패 시트(재시도)
            // 또는 다음 단계로 가게 한다(spec §6.4 "로그 + failed", 세션 없는 running에 멈추지 않게).
            if journey?.token == token { advanceJourney(.stageEnded(.startFailed), token: token) }
            return
        }
        let shape = plan.shape
        switch stage {
        case .taxiIn, .access:
            guard let board = plan.variant.boardStation else {
                return advanceJourney(.stageEnded(.startFailed), token: token)
            }
            // 추천 변형이 버스로 시작하면 타는 곳은 정류장이다 — 「역」을 붙이지 않는다(판정 5).
            let atStop = plan.variant.boardsAtBusStop
            let name = journeyStationDisplayName(board.name)
            // 택시 자동 도착은 역(정류장) 이름 문장(누르지 않은 인계라 무엇이 시작되는지 알린다, spec §6.3 통지). 기본
            // 「목적지에 도착했습니다」는 여정이 끝난 것처럼 들린다(접근성 감사 M6). 접근 도보 도착은 아래 `markPrewalk`의
            // 승차 전 도보 문장 「승차역 {이름}에 도착했습니다.」가 이긴다(정류장에도 「승차역」 — BACKLOG E70 편승).
            beacon.markChained(
                arrivalText: atStop
                    ? appLocalized("ios.journey.arrivedStop", board.name)
                    : appLocalized("ios.journey.arrivedStation", name),
                bridgesStartFailure: stage == .access)
            // 접근 도보는 승차 전 도보(A25)와 같은 자리다 — 입구가 멀어 지하로 먼저 들어가면 도착 판정이 닿지 않으므로 같은
            // 「{역} 도착」 선언 버튼을 둔다(시트의 유일한 버튼이 여정 전체 종료가 되지 않게). 도착 문장도 그 선례
            // 「승차역 {역}에 도착했습니다.」가 된다.
            if stage == .access { beacon.markPrewalk(target: TransitLabel(ko: board.name), transfer: false) }
            launchJourneyBeacon(
                dest: BeaconDest(lat: board.coord.lat, lng: board.coord.lng), label: atStop ? board.name : name + "역",
                labelRoman: nil, kind: stage == .taxiIn ? .car : .walk, token: token)
        case .transit:
            transit.onJourneyStopped = { [weak self] in self?.advanceJourney(.transitStopped, token: token) }
            if shape.alightDesignated {
                transit.onJourneyRideCompleted = { [weak self] in self?.advanceJourney(.rideCompleted, token: token) }
                transit.journeyNextIsWalk = shape.hasEgressWalk
            }
            // 역 B를 지정했으면 대중교통 구간의 끝은 그 역이다(말미 도보는 출구 도보·택시가 잇는다).
            let alight = shape.alightDesignated ? plan.variant.alightStation : nil
            let alightAtStop = plan.variant.alightsAtBusStop
            beginTransit(
                route: plan.variant.transit,
                destinationLabel: alight.map { alightAtStop ? $0.name : journeyStationDisplayName($0.name) + "역" }
                    ?? plan.destLabel,
                destinationRoman: alight == nil ? plan.destRoman : nil,
                dest: alight.map { BeaconDest(lat: $0.coord.lat, lng: $0.coord.lng) } ?? plan.dest,
                accessible: false, aboard: plan.aboard)
            // 불변식: 단계 세션 부재를 위에서 확인했으므로 대중교통 시작은 거부되지 않는다(§6.4). 깨지면 남기고 끝낸다.
            if !transit.isTracking, !beacon.isTracking, !beacon.starting {
                guideDiagLog("journey transitStartInvariantBroken")
                advanceJourney(.stageEnded(.startFailed), token: token)
            }
        case .egress:
            guard let option = plan.egress else { return advanceJourney(.stageEnded(.startFailed), token: token) }
            // 출구·승강장 도착은 그 자리 이름 문장 — 곧 택시 안내가 이어지므로 「목적지에 도착했습니다」로 끝맺지 않는다(판정 1).
            // `none`은 걷는 구간이 없어 이 단계에 오지 않는다(`hasEgressWalk`).
            switch option.kind {
            case .exit:
                beacon.markChained(
                    arrivalText: appLocalized("ios.journey.arrivedExit", option.label), bridgesStartFailure: false)
            case .stand:
                beacon.markChained(arrivalText: appLocalized("ios.journey.arrivedStand"), bridgesStartFailure: false)
            case .none: beacon.markChained(arrivalText: nil, bridgesStartFailure: false)
            }
            launchJourneyBeacon(
                dest: BeaconDest(lat: option.coord.lat, lng: option.coord.lng), label: option.placeName,
                labelRoman: nil, kind: .walk, token: token)
        case .taxiOut:
            // 여정의 마지막 세션 — chained가 아니다(일반 자동차 종료 화면을 남긴다, §6.1).
            launchJourneyBeacon(
                dest: plan.dest, label: plan.destLabel, labelRoman: plan.destRoman, kind: .car, token: token)
        }
    }

    /// 여정 단계의 비콘 시작(택시는 늘 승객 — D10). 종료 사유는 그 단계 token을 실어 `advanceJourney`로 간다.
    private func launchJourneyBeacon(
        dest: BeaconDest, label: String, labelRoman: String?, kind: BeaconModel.GuideSessionKind, token: JourneyToken
    ) {
        beacon.onSessionEnd = { [weak self] reason in
            self?.advanceJourney(.stageEnded(JourneyStageEnd(reason)), token: token)
        }
        launchingJourneyStage = true
        beginBeacon(BeaconModel.StartRequest(
            dest: dest, label: label, labelRoman: labelRoman, kind: kind, accessible: false,
            variant: nil, line: nil, alternate: nil, waypoint: nil,
            carListener: kind == .car ? .passenger : nil))
        launchingJourneyStage = false
        // 동기 거부면 시작 Task가 없어 실패 콜백도 없다 — 여기서 잇는다(승차 전 도보 동형). `begin`을 지나지 않아
        // `lastFailure`가 지난 세션의 원인이므로 그것을 실패 시트에 쓰지 않는다.
        if !beacon.starting, !beacon.isTracking {
            beacon.clearPrewalk()
            ignoreFailureCause = true
            advanceJourney(.stageEnded(.startFailed), token: token)
            ignoreFailureCause = false
        }
    }

    /// 여정 상태를 지운다. `stopSessions`는 여정 시트의 [안내 종료]만 참이다 — 단계 세션이 스스로 끝난 경우(종료 버튼·
    /// 도착)는 이미 멈췄다.
    private func finishJourney(stopSessions: Bool) {
        journey = nil
        journeyPlan = nil
        journeyFailure = nil
        journeyTask?.cancel()
        journeyTask = nil
        journeyTransitionAt = nil
        transit.onJourneyRideCompleted = nil
        transit.onJourneyStopped = nil
        transit.journeyNextIsWalk = nil
        guard stopSessions else { return }
        cancelPrewalk()
        if beacon.isTracking || beacon.starting { beacon.stop(playStopTone: true) }
        if transit.isTracking { transit.stop(playStopTone: true) }
    }

    // MARK: - 받아쓰기 중 출력 억제 (K1 ④, N1 후속)

    /// 받아쓰기 시작 직전 세 모델의 억제 값. nil이면 받아쓰기가 억제를 쥐고 있지 않다.
    private var dictationPrior: (beacon: Bool, transit: Bool, outing: Bool)?
    /// 억제를 쥔 받아쓰기 소유자들. `SpeechService`는 화면마다 인스턴스가 따로라(검색·도착지
    /// 검색·채팅) 두 세션이 겹칠 수 있다 — 마지막 소유자가 떠날 때만 푼다(리뷰 2026-08-23).
    private var dictationOwners = Set<ObjectIdentifier>()

    /// 받아쓰기(`SpeechService`)가 도는 동안 두 모델의 톤·통지를 억제한다 — 헌장 §6
    /// "녹음 중 SR 발화 0"은 검색·채팅 탭에서도 성립해야 하는데, 종전엔 길찾기 탭의
    /// 검색 시트만 억제를 걸어 다른 탭 마이크엔 안내 통지가 전사에 섞였다.
    ///
    /// 억제 플래그는 시트(목적지 검색 등)도 쓰는 **공유 Bool**이라 끝날 때 무조건 false로
    /// 되돌리면 열린 시트의 억제를 깨고, 무조건 이전 값으로 되돌리면 그 사이 닫힌 시트의
    /// 해제를 되살린다(영구 억제 = 안내 침묵). 그래서 종료는 `이전 값 ∧ 현재 값`이다:
    /// 받아쓰기 중 누군가 false로 내렸으면 false, 시작 전부터 true였고 아직 true면 유지.
    func setDictationActive(_ active: Bool, owner: ObjectIdentifier) {
        if active {
            let wasEmpty = dictationOwners.isEmpty
            dictationOwners.insert(owner)
            guard wasEmpty else { return }
            dictationPrior = (beacon.outputSuppressed, transit.outputSuppressed, outing.outputSuppressed)
            beacon.outputSuppressed = true
            transit.outputSuppressed = true
            outing.outputSuppressed = true
        } else {
            dictationOwners.remove(owner)
            guard dictationOwners.isEmpty, let prior = dictationPrior else { return }
            dictationPrior = nil
            beacon.outputSuppressed = prior.beacon && beacon.outputSuppressed
            transit.outputSuppressed = prior.transit && transit.outputSuppressed
            outing.outputSuppressed = prior.outing && outing.outputSuppressed
        }
    }
}

/// 안내 주도 목적지 변경을 길찾기 탭 폼에 동기화하는 채널(N1). 시트가 루트에 살아
/// 탭을 모르므로 스토어를 거친다(`DirectionsPrefillStore` 동형). `take()`가 읽고
/// 비우는 한 연산이라 탭 재생성의 옛 task가 새 값을 지우지 않는다(설계 리뷰 M12).
@Observable @MainActor
final class GuideFormSyncStore {
    static let shared = GuideFormSyncStore()
    private(set) var pending: DirectionsEndpoint?
    /// 안내 주도 경유지 추가·변경(N4) — 도착지 채널과 분리(둘이 한 값이면 "도착지 없이
    /// 경유지만 바뀜"을 표현할 수 없다). 경유지 **도착**은 폼에 보내지 않는다(폼은 사용자
    /// 질의이지 세션 상태가 아니다, spec §4.3).
    private(set) var pendingWaypoint: DirectionsEndpoint?
    private init() {}

    func post(_ endpoint: DirectionsEndpoint) { pending = endpoint }

    func take() -> DirectionsEndpoint? {
        defer { pending = nil }
        return pending
    }

    func postWaypoint(_ endpoint: DirectionsEndpoint) { pendingWaypoint = endpoint }

    func takeWaypoint() -> DirectionsEndpoint? {
        defer { pendingWaypoint = nil }
        return pendingWaypoint
    }
}

/// 여정 안내의 계획(길찾기 탭 여정 결과에서 고른 변형·출구 + 도착지). 모양은 여기서 유도한다.
struct JourneyPlan {
    let variant: JourneyVariant
    /// 고른 출구·승강장(역 B 미지정이면 nil). `kind == .none`이면 출구 도보 없이 곧장 택시.
    let egress: EgressOption?
    let destLabel: String
    let destRoman: String?
    let dest: BeaconDest
    /// 지금 탄 열차에서 시작하면 고른 방향(E71). nil이면 종전 대기 시작. ⚠ 기본값 없음(안전 인자).
    let aboard: TransitAboardStart?

    var shape: JourneyShape {
        JourneyShape(
            startsWithTaxi: variant.taxiIn != nil,
            alightDesignated: variant.egress != nil,
            hasEgressWalk: egress.map { $0.kind != .none } ?? false)
    }
}

extension JourneyStageEnd {
    /// 비콘 종료 사유 전부를 받는다(spec §6.1 — 빠진 사유가 있으면 세션은 사라지고 여정만 남는다). 위치 상실(`locationLost`,
    /// E73 환승 도보 재개용으로 갈라 둔 사유)은 여정 단계에선 그 밖의 정지와 같다.
    init(_ reason: BeaconModel.EndReason) {
        switch reason {
        case .arrived: self = .arrived
        case .userStopped: self = .userStopped
        case .startFailed: self = .startFailed
        case .locationLost, .ended: self = .ended
        }
    }
}
