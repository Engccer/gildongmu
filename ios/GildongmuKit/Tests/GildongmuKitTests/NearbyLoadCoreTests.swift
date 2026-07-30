import Testing
import Foundation
@testable import GildongmuKit

/// NearbyLoadCore 계약 테스트 — 스펙 §5 전이표가 동결 계약(케이스 번호 주석 병기).
/// stub은 클로저 주입: 좌표·fetch를 CheckedContinuation으로 보류해 in-flight·취소를 재현한다.

private typealias Payload = String

private let seoulCoord: NearbyCoord = (lat: 37.5385, lng: 127.1237)
/// 커버리지 밖 좌표(도쿄) — isInKorea 거짓
private let tokyoCoord: NearbyCoord = (lat: 35.68, lng: 139.69)

private enum StubError: Error { case boom }

/// 스텁 기록기: 호출 횟수·인자·이벤트를 모으고, 각 테스트가 stub 클로저를 갈아끼운다.
@MainActor
private final class Recorder {
    var coordCallCount = 0
    var coordForces: [Bool] = []
    var fetchCallCount = 0
    var fetchCoords: [NearbyCoord?] = []
    var fetchPrevious: [Payload?] = []
    /// willCommit·phase 커밋·이벤트의 순서 단언용 단일 로그(불변식 ⑤)
    var log: [String] = []
    var events: [String] = []
    /// willCommit 시점에 관측된 phase — 부가 상태가 phase 대입보다 앞서는지 판정(로그 순서만으론 구분 불가)
    var phaseAtWillCommit: String?
    weak var core: NearbyLoadCore<Payload>?

    var coordStub: @MainActor (Bool) async throws -> NearbyCoord = { _ in seoulCoord }
    var fetchStub: @MainActor (NearbyCoord?, Payload?) async throws -> Payload? = { _, _ in "P1" }

    /// 사전 로드로 entry 상태를 만든 뒤 관측을 리셋한다(이후 단언은 이번 호출 결과만 본다).
    /// phaseAtWillCommit도 반드시 함께 비운다 — 사전 로드의 잔값이 남으면 willCommit 누락을 가린다.
    func resetLog() {
        log.removeAll()
        events.removeAll()
        phaseAtWillCommit = nil
    }
}

/// 스텁 보류·재개 게이트: 테스트가 "스텁 진입"을 기다렸다가 취소·재호출을 끼워 넣는다.
/// 협력적 취소 재현이 목적이라 취소에 반응하지 않는다(취소돼도 성공값을 반환할 수 있어야 한다).
@MainActor
private final class Gate {
    private var arrivalWaiter: CheckedContinuation<Void, Never>?
    private var releaseWaiter: CheckedContinuation<Void, Never>?
    private var hasArrived = false
    private var isReleased = false

    /// 스텁 쪽: 도착을 알리고 release까지 보류
    func arriveAndWait() async {
        hasArrived = true
        arrivalWaiter?.resume()
        arrivalWaiter = nil
        guard !isReleased else { return }
        guard releaseWaiter == nil else {
            // 게이트에 동시 진입 = 상태 머신이 두 번째 load()를 막지 못했다는 뜻.
            // 여기서 보류하면 테스트 태스크 자신이 갇혀 release()를 부를 주체가 사라지고
            // 무한 hang이 된다(.timeLimit도 취소 비반응 continuation은 못 깬다 — 실측).
            // 실패로 기록하고 즉시 통과시켜 hang을 실패로 바꾼다.
            Issue.record("Gate 동시 진입 — load() 재진입 가드가 동작하지 않는다")
            return
        }
        await withCheckedContinuation { continuation in releaseWaiter = continuation }
    }

    /// 테스트 쪽: 스텁이 진입할 때까지 대기.
    /// 워치독 필수 — load()가 조기 반환하면(in-flight 가드 미해제 등) 진입이 영영 오지 않아
    /// 테스트 태스크 자신이 갇힌다. .timeLimit은 취소 비반응 continuation을 못 깨므로(실측)
    /// 벽시계 워치독으로 hang을 실패로 바꾼다.
    func waitForArrival() async {
        guard !hasArrived else { return }
        let watchdog = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, !hasArrived else { return }
            Issue.record("스텁이 게이트에 진입하지 않았다 — load()가 조기 반환했다")
            arrivalWaiter?.resume()
            arrivalWaiter = nil
        }
        await withCheckedContinuation { continuation in arrivalWaiter = continuation }
        watchdog.cancel()
    }

    /// 테스트 쪽: 보류 해제
    func release() {
        isReleased = true
        releaseWaiter?.resume()
        releaseWaiter = nil
    }
}

@MainActor
private func makeCore(
    _ recorder: Recorder,
    coverage: NearbyCoverage = .none,
    hasCoordinateSource: Bool = true
) -> NearbyLoadCore<Payload> {
    let source: NearbyCoordinateSource = hasCoordinateSource
        ? .current { force in
            recorder.coordCallCount += 1
            recorder.coordForces.append(force)
            return try await recorder.coordStub(force)
        }
        : .none
    let core = NearbyLoadCore<Payload>(
        coordinate: source,
        coverage: coverage,
        fetch: { coord, previous in
            recorder.fetchCallCount += 1
            recorder.fetchCoords.append(coord)
            recorder.fetchPrevious.append(previous)
            return try await recorder.fetchStub(coord, previous)
        },
        willCommit: { _ in
            recorder.phaseAtWillCommit = phaseName(recorder.core?.phase ?? .idle)
            recorder.log.append("willCommit")
        },
        onEvent: { event in
            // 이벤트 시점의 phase를 함께 남긴다 — "커밋 → 이벤트" 순서 증명(불변식 ⑤)
            recorder.log.append("phase=" + phaseName(recorder.core?.phase ?? .idle))
            recorder.log.append("event=" + eventName(event))
            recorder.events.append(eventName(event))
        }
    )
    recorder.core = core
    return core
}

private func phaseName(_ phase: NearbyLoadPhase<Payload>) -> String {
    switch phase {
    case .idle: "idle"
    case .loading: "loading"
    case .loaded: "loaded"
    case .empty: "empty"
    case .denied: "denied"
    case .outOfCoverage: "outOfCoverage"
    case .failedLocation: "failedLocation"
    case .failedServer: "failedServer"
    }
}

private func loadedPayload(_ phase: NearbyLoadPhase<Payload>) -> Payload? {
    if case .loaded(let payload) = phase { return payload }
    return nil
}

private func eventName(_ event: NearbyLoadEvent<Payload>) -> String {
    switch event {
    case .loaded: "loaded"
    case .emptyResult: "emptyResult"
    case .refreshFailed: "refreshFailed"
    case .permissionLost: "permissionLost"
    case .wentOutOfCoverage: "wentOutOfCoverage"
    }
}

/// Gate 기반 테스트는 상태 머신이 멈추면(재진입 가드 소실 등) 실패가 아니라 무한 hang으로 나타난다
/// — 시간 제한으로 hang을 실패로 바꾼다(Swift Testing 최소 단위가 1분이라 1분).
@MainActor
@Suite(.timeLimit(.minutes(1)))
struct NearbyLoadCoreTests {

    // MARK: - #1 재진입 가드

    /// #1 — 진행 중 load() 재호출은 즉시 무시(fetch 2회째를 만들지 않는다).
    @Test func inFlightReentryDoesNotStartSecondFetch() async {
        let recorder = Recorder()
        let gate = Gate()
        recorder.fetchStub = { _, _ in await gate.arriveAndWait(); return "P1" }
        let core = makeCore(recorder)

        let task = Task { await core.load() }
        await gate.waitForArrival()
        await core.load()  // 재진입 — 무시되어야 한다
        #expect(recorder.fetchCallCount == 1)
        #expect(recorder.coordCallCount == 1)

        gate.release()
        await task.value
        #expect(phaseName(core.phase) == "loaded")
    }

    // MARK: - #2·#3 시작 전이

    /// #3 — loaded가 아닌 상태에서 시작하면 loading을 표시한다.
    @Test func startFromIdleEntersLoading() async {
        let recorder = Recorder()
        let gate = Gate()
        recorder.fetchStub = { _, _ in await gate.arriveAndWait(); return "P1" }
        let core = makeCore(recorder)

        let task = Task { await core.load() }
        await gate.waitForArrival()
        #expect(phaseName(core.phase) == "loading")

        gate.release()
        await task.value
        #expect(loadedPayload(core.phase) == "P1")
    }

    /// 승인 예외 2호(Conditions 스테일 미부활)의 파생 원천 계약 — previous는 loaded entry
    /// 한정이다. loaded(P1) → denied 전락(#4, 직전 성공 payload가 실제로 존재했던 상태) →
    /// 회복 재로드에서 fetch가 받는 previous가 nil이어야 한다(전락 후 복귀 재로드에서 직전
    /// 성공 payload를 previous로 되살리지 않는다). entry가 아니라 "마지막 성공 payload"를
    /// 별도로 저장해 항상 전달하는 변형 구현이 있다면 이 테스트가 그 회귀를 잡는다 — entry가
    /// 처음부터 loaded가 아니었던 경로(직전 성공이 존재한 적이 없는 경로)만으로는 구현 정오와
    /// 무관하게 previous가 항상 nil이라 동어반복이 된다(리뷰 지적, 변이 테스트로 실증).
    @Test func fetchPreviousIsNilAfterPermissionLostRecovery() async {
        let recorder = Recorder()
        let core = makeCore(recorder)
        await core.load()
        #expect(loadedPayload(core.phase) == "P1")

        recorder.coordStub = { _ in throw NearbyLocationError.denied }
        await core.load()
        #expect(phaseName(core.phase) == "denied")
        recorder.resetLog()

        recorder.coordStub = { _ in seoulCoord }
        recorder.fetchStub = { _, _ in "P2" }
        await core.load()
        #expect((recorder.fetchPrevious.last ?? nil) == nil)
        #expect(loadedPayload(core.phase) == "P2")
    }

    /// #2 — loaded에서 시작하면 직전 payload를 유지한 채 재조회하고, previous로 전달한다.
    @Test func startFromLoadedKeepsPreviousPayload() async {
        let recorder = Recorder()
        let core = makeCore(recorder)
        await core.load()
        recorder.resetLog()

        let gate = Gate()
        recorder.fetchStub = { _, _ in await gate.arriveAndWait(); return "P2" }
        let task = Task { await core.load() }
        await gate.waitForArrival()
        #expect(phaseName(core.phase) == "loaded")
        #expect(loadedPayload(core.phase) == "P1")  // 보류 중에도 데이터 유지
        #expect((recorder.fetchPrevious.last ?? nil) == "P1")
        #expect(recorder.events.isEmpty)

        gate.release()
        await task.value
        #expect(loadedPayload(core.phase) == "P2")
        // 재조회 성공도 #10 그대로 — 통지 억제나 willCommit 생략이 있으면 안 된다
        // (entry=loaded 분기를 여기서 안 잡으면 11개 이관 커밋 어디서도 안 잡힌다).
        #expect(recorder.events == ["loaded"])
        #expect(recorder.log == ["willCommit", "phase=loaded", "event=loaded"])
        #expect(recorder.phaseAtWillCommit == "loaded")  // 직전 payload가 아직 살아 있는 시점
    }

    // MARK: - #4·#5 좌표 denied

    /// #5 — 첫 로드의 denied는 상태만 바꾸고 통지하지 않는다(전락이 아니라 초기 거부).
    @Test func coordinateDeniedOnFirstLoadIsSilent() async {
        let recorder = Recorder()
        recorder.coordStub = { _ in throw NearbyLocationError.denied }
        let core = makeCore(recorder)

        await core.load()
        #expect(phaseName(core.phase) == "denied")
        #expect(recorder.events.isEmpty)
        #expect(recorder.fetchCallCount == 0)
    }

    /// #4 — loaded 중 denied 전락은 무신호 화면 전환을 막기 위해 permissionLost를 통지한다.
    @Test func coordinateDeniedWhileLoadedNotifiesPermissionLost() async {
        let recorder = Recorder()
        let core = makeCore(recorder)
        await core.load()
        recorder.resetLog()

        recorder.coordStub = { _ in throw NearbyLocationError.denied }
        await core.load()
        #expect(phaseName(core.phase) == "denied")
        #expect(recorder.events == ["permissionLost"])
        // 불변식 ⑤ — 커밋이 이벤트보다 앞선다
        #expect(recorder.log == ["phase=denied", "event=permissionLost"])
    }

    // MARK: - #6·#7 좌표 unavailable

    /// #7 — 첫 로드의 위치 실패는 failedLocation(서버 실패와 구분), 통지 없음.
    @Test func coordinateUnavailableOnFirstLoadIsFailedLocation() async {
        let recorder = Recorder()
        recorder.coordStub = { _ in throw NearbyLocationError.unavailable }
        let core = makeCore(recorder)

        await core.load()
        #expect(phaseName(core.phase) == "failedLocation")
        #expect(recorder.events.isEmpty)
        #expect(recorder.fetchCallCount == 0)
    }

    /// #6 — loaded 중 위치 실패는 데이터를 유지하고 refreshFailed만 통지한다(재조회이지 포기 아님).
    @Test func coordinateUnavailableWhileLoadedKeepsData() async {
        let recorder = Recorder()
        let core = makeCore(recorder)
        await core.load()
        recorder.resetLog()

        recorder.coordStub = { _ in throw NearbyLocationError.unavailable }
        await core.load()
        #expect(phaseName(core.phase) == "loaded")
        #expect(loadedPayload(core.phase) == "P1")
        #expect(recorder.events == ["refreshFailed"])
    }

    // MARK: - #8·#9 커버리지 선분기

    /// #9 — coverage=korea에서 해외 좌표는 fetch를 생략하고 outOfCoverage로(쿼터 보호).
    @Test func foreignCoordUnderKoreaCoverageSkipsFetch() async {
        let recorder = Recorder()
        recorder.coordStub = { _ in tokyoCoord }
        let core = makeCore(recorder, coverage: .korea)

        await core.load()
        #expect(phaseName(core.phase) == "outOfCoverage")
        #expect(recorder.fetchCallCount == 0)
        #expect(recorder.events.isEmpty)
    }

    /// #8 — loaded 중 커버리지 밖 전락은 wentOutOfCoverage를 통지한다.
    @Test func foreignCoordWhileLoadedNotifiesWentOutOfCoverage() async {
        let recorder = Recorder()
        let core = makeCore(recorder, coverage: .korea)
        await core.load()
        recorder.resetLog()

        recorder.coordStub = { _ in tokyoCoord }
        await core.load()
        #expect(phaseName(core.phase) == "outOfCoverage")
        #expect(recorder.events == ["wentOutOfCoverage"])
        #expect(recorder.log == ["phase=outOfCoverage", "event=wentOutOfCoverage"])
        #expect(recorder.fetchCallCount == 1)  // 1차 성공분뿐 — 2차는 선분기로 생략
    }

    /// coverage=none은 선분기가 없다 — 해외 좌표도 그대로 fetch로 내려간다.
    @Test func coverageNoneAllowsForeignCoord() async {
        let recorder = Recorder()
        recorder.coordStub = { _ in tokyoCoord }
        let core = makeCore(recorder, coverage: .none)

        await core.load()
        #expect(recorder.fetchCallCount == 1)
        #expect(recorder.fetchCoords[0]?.lat == tokyoCoord.lat)
        #expect(phaseName(core.phase) == "loaded")
    }

    // MARK: - #10 성공

    /// #10 — willCommit이 phase 대입보다 앞서고, 이벤트는 커밋 후 1회(불변식 ⑤).
    @Test func successCommitsPayloadBeforeEvent() async {
        let recorder = Recorder()
        let core = makeCore(recorder)

        await core.load()
        #expect(loadedPayload(core.phase) == "P1")
        #expect(recorder.log == ["willCommit", "phase=loaded", "event=loaded"])
        #expect(recorder.events == ["loaded"])
        // 부가 상태(willCommit)는 phase 대입 전에 끝나 있어야 원자 커밋이다
        #expect(recorder.phaseAtWillCommit == "loading")
    }

    // MARK: - #11·#12 fetch 부재(nil)

    /// #11 — loaded 중 부재는 데이터를 유지하고 refreshFailed만 통지한다.
    @Test func fetchNilWhileLoadedKeepsDataAndNotifiesRefreshFailed() async {
        let recorder = Recorder()
        let core = makeCore(recorder)
        await core.load()
        recorder.resetLog()

        recorder.fetchStub = { _, _ in nil }
        await core.load()
        #expect(phaseName(core.phase) == "loaded")
        #expect(loadedPayload(core.phase) == "P1")
        #expect(recorder.events == ["refreshFailed"])
    }

    /// #12 — 첫 로드의 부재는 empty(실패와 구분되는 정상적 부재).
    @Test func fetchNilOnFirstLoadIsEmpty() async {
        let recorder = Recorder()
        recorder.fetchStub = { _, _ in nil }
        let core = makeCore(recorder)

        await core.load()
        #expect(phaseName(core.phase) == "empty")
        #expect(recorder.events == ["emptyResult"])
        #expect(recorder.log == ["phase=empty", "event=emptyResult"])
    }

    // MARK: - #13·#14 서버 커버리지 마커

    /// #14 — 서버 outOfCoverage 마커도 같은 상태로(선분기와 이중 방어).
    @Test func serverOutOfCoverageOnFirstLoad() async {
        let recorder = Recorder()
        recorder.fetchStub = { _, _ in throw APIError.outOfCoverage }
        let core = makeCore(recorder)

        await core.load()
        #expect(phaseName(core.phase) == "outOfCoverage")
        #expect(recorder.events.isEmpty)
    }

    /// #13 — loaded 중 서버 마커는 wentOutOfCoverage를 통지한다.
    @Test func serverOutOfCoverageWhileLoadedNotifies() async {
        let recorder = Recorder()
        let core = makeCore(recorder)
        await core.load()
        recorder.resetLog()

        recorder.fetchStub = { _, _ in throw APIError.outOfCoverage }
        await core.load()
        #expect(phaseName(core.phase) == "outOfCoverage")
        #expect(recorder.events == ["wentOutOfCoverage"])
    }

    // MARK: - #15·#16 fetch 일반 실패

    /// #16 — 첫 로드의 서버 실패는 failedServer(위치 실패와 구분).
    @Test func fetchThrowOnFirstLoadIsFailedServer() async {
        let recorder = Recorder()
        recorder.fetchStub = { _, _ in throw StubError.boom }
        let core = makeCore(recorder)

        await core.load()
        #expect(phaseName(core.phase) == "failedServer")
        #expect(recorder.events.isEmpty)
    }

    /// #15 — loaded 중 서버 실패는 데이터를 유지하고 refreshFailed만 통지한다.
    @Test func fetchThrowWhileLoadedKeepsData() async {
        let recorder = Recorder()
        let core = makeCore(recorder)
        await core.load()
        recorder.resetLog()

        recorder.fetchStub = { _, _ in throw StubError.boom }
        await core.load()
        #expect(phaseName(core.phase) == "loaded")
        #expect(loadedPayload(core.phase) == "P1")
        #expect(recorder.events == ["refreshFailed"])
    }

    // MARK: - 좌표 소스·force

    /// 파라미터형(.none) 소스는 좌표 단계를 통째로 생략한다 — coverage=korea여도 선분기가 없다.
    @Test func noneCoordinateSourceSkipsCoordinateStage() async {
        let recorder = Recorder()
        let core = makeCore(recorder, coverage: .korea, hasCoordinateSource: false)

        await core.load()
        #expect(recorder.coordCallCount == 0)
        #expect(recorder.fetchCallCount == 1)
        #expect(recorder.fetchCoords[0] == nil)
        #expect(phaseName(core.phase) == "loaded")
    }

    /// 불변식 ⑥ — force는 getCoordinate로 그대로 전달될 뿐 전이에 영향이 없다.
    @Test func forceIsForwardedToCoordinateSource() async {
        let recorder = Recorder()
        let core = makeCore(recorder)

        await core.load()
        await core.load(force: true)
        #expect(recorder.coordForces == [false, true])
    }

    // MARK: - #17 취소 (오류형)

    /// #17 — idle에서 시작한 로드가 취소되면 loading에 고착되지 않고 idle로 복원된다.
    @Test func cancellationErrorFromIdleRestoresIdle() async {
        let recorder = Recorder()
        recorder.fetchStub = { _, _ in throw CancellationError() }
        let core = makeCore(recorder)

        await core.load()
        #expect(phaseName(core.phase) == "idle")
        #expect(recorder.events.isEmpty)
    }

    /// #17 — 재시도(entry=failedServer)의 취소는 failedServer로 복원한다(loading 고착 금지).
    @Test func cancellationErrorFromFailedServerRestoresFailedServer() async {
        let recorder = Recorder()
        recorder.fetchStub = { _, _ in throw StubError.boom }
        let core = makeCore(recorder)
        await core.load()
        #expect(phaseName(core.phase) == "failedServer")
        recorder.resetLog()

        recorder.fetchStub = { _, _ in throw CancellationError() }
        await core.load()
        #expect(phaseName(core.phase) == "failedServer")
        #expect(recorder.events.isEmpty)
    }

    /// #17 — loaded 중 취소는 payload를 그대로 유지하고 아무 통지도 내지 않는다.
    @Test func cancellationErrorWhileLoadedKeepsPayload() async {
        let recorder = Recorder()
        let core = makeCore(recorder)
        await core.load()
        recorder.resetLog()

        recorder.fetchStub = { _, _ in throw CancellationError() }
        await core.load()
        #expect(loadedPayload(core.phase) == "P1")
        #expect(recorder.events.isEmpty)
    }

    /// #17 — URLSession 계열의 취소(URLError.cancelled)도 같은 복원 경로를 탄다.
    @Test func urlErrorCancelledRestoresEntryState() async {
        let idleRecorder = Recorder()
        idleRecorder.fetchStub = { _, _ in throw URLError(.cancelled) }
        let idleCore = makeCore(idleRecorder)
        await idleCore.load()
        #expect(phaseName(idleCore.phase) == "idle")  // failedServer가 아니다
        #expect(idleRecorder.events.isEmpty)

        let loadedRecorder = Recorder()
        let loadedCore = makeCore(loadedRecorder)
        await loadedCore.load()
        loadedRecorder.resetLog()
        loadedRecorder.fetchStub = { _, _ in throw URLError(.cancelled) }
        await loadedCore.load()
        #expect(loadedPayload(loadedCore.phase) == "P1")
        #expect(loadedRecorder.events.isEmpty)  // refreshFailed 미발화
    }

    // MARK: - #17 취소 (커밋 게이트 — 협력적 취소가 성공값을 반환하는 경우)

    /// #17 — 취소된 태스크의 fetch가 성공값을 반환해도 커밋·통지하지 않는다(떠난 화면 보호).
    @Test func cooperativeCancellationDiscardsSuccessfulFetch() async {
        let recorder = Recorder()
        let gate = Gate()
        recorder.fetchStub = { _, _ in
            await gate.arriveAndWait()
            return "P-late"  // 취소를 무시하고 성공값을 반환하는 스텁
        }
        let core = makeCore(recorder)

        let task = Task { await core.load() }
        await gate.waitForArrival()
        task.cancel()
        gate.release()
        await task.value

        #expect(phaseName(core.phase) == "idle")  // entry 복원
        #expect(recorder.events.isEmpty)
        #expect(recorder.log.isEmpty)  // willCommit도 호출되지 않았다
    }

    /// #17 — 좌표 단계 판: 취소 후 좌표가 성공 반환해도 fetch로 내려가지 않는다.
    @Test func cooperativeCancellationAtCoordinateStageSkipsFetch() async {
        let recorder = Recorder()
        let gate = Gate()
        recorder.coordStub = { _ in
            await gate.arriveAndWait()
            return seoulCoord
        }
        let core = makeCore(recorder)

        let task = Task { await core.load() }
        await gate.waitForArrival()
        task.cancel()
        gate.release()
        await task.value

        #expect(recorder.fetchCallCount == 0)
        #expect(phaseName(core.phase) == "idle")
        #expect(recorder.events.isEmpty)
    }

    /// #17 — 래핑 취소 방어: 취소 상태에서 온 임의 오류를 서버 실패로 오판하지 않는다.
    @Test func wrappedErrorUnderCancellationRestoresWithoutNotice() async {
        let recorder = Recorder()
        let core = makeCore(recorder)
        await core.load()
        recorder.resetLog()

        let gate = Gate()
        recorder.fetchStub = { _, _ in
            await gate.arriveAndWait()
            throw StubError.boom  // 취소가 도메인 오류로 래핑되어 돌아온 경우
        }
        let task = Task { await core.load() }
        await gate.waitForArrival()
        task.cancel()
        gate.release()
        await task.value

        #expect(loadedPayload(core.phase) == "P1")
        #expect(recorder.events.isEmpty)  // refreshFailed 미발화
    }

    /// 불변식 ④ — 취소 경로에서도 in-flight 가드가 해제되어 후속 load가 정상 완주한다.
    @Test func inFlightGuardIsReleasedAfterCancellation() async {
        let recorder = Recorder()
        let gate = Gate()
        recorder.fetchStub = { _, _ in await gate.arriveAndWait(); return "P-late" }
        let core = makeCore(recorder)

        let task = Task { await core.load() }
        await gate.waitForArrival()
        task.cancel()
        gate.release()
        await task.value
        #expect(phaseName(core.phase) == "idle")

        recorder.fetchStub = { _, _ in "P2" }
        await core.load()
        #expect(loadedPayload(core.phase) == "P2")
        #expect(recorder.events == ["loaded"])
    }
}
