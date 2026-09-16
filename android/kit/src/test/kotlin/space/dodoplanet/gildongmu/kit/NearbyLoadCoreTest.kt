package space.dodoplanet.gildongmu.kit

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private typealias Payload = String

private val seoulCoord = NearbyCoord(lat = 37.5385, lng = 127.1237)

/** 커버리지 밖 좌표(도쿄) — isInKorea 거짓 */
private val tokyoCoord = NearbyCoord(lat = 35.68, lng = 139.69)

private class StubError : Exception("boom")

/**
 * NearbyLoadCore 계약 테스트 — Kit `NearbyLoadCoreTests` 미러. 스펙 §5 전이표가 동결 계약(케이스 번호 주석 병기).
 * 스텁은 클로저 주입: 좌표·fetch를 게이트로 보류해 in-flight·취소를 재현한다.
 * Kit의 `urlErrorCancelledRestoresEntryState`(URLError.cancelled)는 대응하는 플랫폼 표준 오류형이 없어 옮기지 않았다
 * (전송 취소는 코루틴 `CancellationException`으로 오고 그 경로는 `cancellationError*`가 덮는다).
 */
class NearbyLoadCoreTest {
    /** 스텁 기록기: 호출 횟수·인자·이벤트를 모으고, 각 테스트가 stub 클로저를 갈아끼운다. */
    private class Recorder {
        var coordCallCount = 0
        val coordForces = mutableListOf<Boolean>()
        var fetchCallCount = 0
        val fetchCoords = mutableListOf<NearbyCoord?>()
        val fetchPrevious = mutableListOf<Payload?>()

        /** willCommit·phase 커밋·이벤트의 순서 단언용 단일 로그(불변식 ⑤) */
        val log = mutableListOf<String>()
        val events = mutableListOf<String>()

        /** willCommit 시점에 관측된 phase — 부가 상태가 phase 대입보다 앞서는지 판정(로그 순서만으론 구분 불가) */
        var phaseAtWillCommit: String? = null
        lateinit var core: NearbyLoadCore<Payload>

        var coordStub: suspend (Boolean) -> NearbyCoord = { seoulCoord }
        var fetchStub: suspend (NearbyCoord?, Payload?) -> Payload? = { _, _ -> "P1" }

        /** 사전 로드로 entry 상태를 만든 뒤 관측을 리셋한다. phaseAtWillCommit도 함께 비운다(잔값이 willCommit 누락을 가린다). */
        fun resetLog() {
            log.clear(); events.clear(); phaseAtWillCommit = null
        }
    }

    /**
     * 스텁 보류·재개 게이트: 테스트가 "스텁 진입"을 기다렸다가 취소·재호출을 끼워 넣는다. 협력적 취소 재현이 목적이라
     * 보류는 **취소에 반응하지 않는다**(`suspendCoroutine`, Swift `CheckedContinuation` 대응 — 취소돼도 성공값을 반환할
     * 수 있어야 한다. `withContext(NonCancellable)`은 빠져나올 때 결과를 버리고 CancellationException을 던져 이 경로를 못 만든다).
     */
    private class Gate {
        private val arrived = CompletableDeferred<Unit>()
        private var releaseWaiter: Continuation<Unit>? = null
        private var isReleased = false

        /** 게이트 동시 진입 = 상태 머신이 두 번째 load()를 막지 못했다는 뜻. 보류하지 않고 기록만 한다(hang 대신 실패). */
        var concurrentEntry = false

        suspend fun arriveAndWait() {
            arrived.complete(Unit)
            if (isReleased) return
            if (releaseWaiter != null) {
                concurrentEntry = true
                return
            }
            suspendCoroutine { releaseWaiter = it }
        }

        /** 워치독 — load()가 조기 반환하면 진입이 영영 오지 않는다(가상 시간 2초로 hang을 실패로 바꾼다). */
        suspend fun waitForArrival() = withTimeout(2_000) { arrived.await() }

        fun release() {
            isReleased = true
            releaseWaiter?.resume(Unit)
            releaseWaiter = null
        }
    }

    /** 좌표 소스 선택(코어의 3종과 1:1). */
    private sealed class SourceKind {
        data object Current : SourceKind()
        data class Fixed(val coord: NearbyCoord) : SourceKind()
        data object None : SourceKind()
    }

    private fun makeCore(recorder: Recorder, coverage: NearbyCoverage = NearbyCoverage.none, sourceKind: SourceKind = SourceKind.Current): NearbyLoadCore<Payload> {
        val source = when (sourceKind) {
            SourceKind.Current -> NearbyCoordinateSource.Current { force ->
                recorder.coordCallCount += 1
                recorder.coordForces.add(force)
                recorder.coordStub(force)
            }
            is SourceKind.Fixed -> NearbyCoordinateSource.Fixed(sourceKind.coord)
            SourceKind.None -> NearbyCoordinateSource.None
        }
        val core = NearbyLoadCore<Payload>(
            coordinate = source,
            coverage = coverage,
            fetch = { coord, previous ->
                recorder.fetchCallCount += 1
                recorder.fetchCoords.add(coord)
                recorder.fetchPrevious.add(previous)
                recorder.fetchStub(coord, previous)
            },
            willCommit = {
                recorder.phaseAtWillCommit = phaseName(recorder.core.phase.value)
                recorder.log.add("willCommit")
            },
            onEvent = { event ->
                // 이벤트 시점의 phase를 함께 남긴다 — "커밋 → 이벤트" 순서 증명(불변식 ⑤)
                recorder.log.add("phase=" + phaseName(recorder.core.phase.value))
                recorder.log.add("event=" + eventName(event))
                recorder.events.add(eventName(event))
            },
        )
        recorder.core = core
        return core
    }

    private fun phaseName(phase: NearbyLoadPhase<Payload>): String = when (phase) {
        NearbyLoadPhase.Idle -> "idle"
        NearbyLoadPhase.Loading -> "loading"
        is NearbyLoadPhase.Loaded -> "loaded"
        NearbyLoadPhase.Empty -> "empty"
        NearbyLoadPhase.Denied -> "denied"
        NearbyLoadPhase.ReducedAccuracy -> "reducedAccuracy"
        NearbyLoadPhase.OutOfCoverage -> "outOfCoverage"
        is NearbyLoadPhase.UnavailableHere -> "unavailableHere:${phase.reason.name}"
        NearbyLoadPhase.FailedLocation -> "failedLocation"
        NearbyLoadPhase.FailedServer -> "failedServer"
    }

    private fun NearbyLoadCore<Payload>.phaseName() = phaseName(phase.value)

    private fun NearbyLoadCore<Payload>.loadedPayload(): Payload? = (phase.value as? NearbyLoadPhase.Loaded)?.payload

    private fun eventName(event: NearbyLoadEvent<Payload>): String = when (event) {
        is NearbyLoadEvent.Loaded -> "loaded"
        NearbyLoadEvent.EmptyResult -> "emptyResult"
        NearbyLoadEvent.RefreshFailed -> "refreshFailed"
        NearbyLoadEvent.PermissionLost -> "permissionLost"
        NearbyLoadEvent.AccuracyLost -> "accuracyLost"
        NearbyLoadEvent.WentOutOfCoverage -> "wentOutOfCoverage"
    }

    // #1 재진입 가드

    /** #1 — 진행 중 load() 재호출은 즉시 무시(fetch 2회째를 만들지 않는다). */
    @Test fun inFlightReentryDoesNotStartSecondFetch() = runTest {
        val recorder = Recorder()
        val gate = Gate()
        recorder.fetchStub = { _, _ -> gate.arriveAndWait(); "P1" }
        val core = makeCore(recorder)

        val job = launch { core.load() }
        gate.waitForArrival()
        core.load() // 재진입 — 무시되어야 한다
        assertEquals(1, recorder.fetchCallCount)
        assertEquals(1, recorder.coordCallCount)

        gate.release()
        job.join()
        assertFalse(gate.concurrentEntry)
        assertEquals("loaded", core.phaseName())
    }

    // #2·#3 시작 전이

    /** #3 — loaded가 아닌 상태에서 시작하면 loading을 표시한다. */
    @Test fun startFromIdleEntersLoading() = runTest {
        val recorder = Recorder()
        val gate = Gate()
        recorder.fetchStub = { _, _ -> gate.arriveAndWait(); "P1" }
        val core = makeCore(recorder)

        val job = launch { core.load() }
        gate.waitForArrival()
        assertEquals("loading", core.phaseName())

        gate.release()
        job.join()
        assertEquals("P1", core.loadedPayload())
    }

    /**
     * previous는 loaded entry 한정이다. loaded(P1) → denied 전락(#4) → 회복 재로드에서 fetch가 받는 previous가 null이어야
     * 한다(전락 후 복귀 재로드에서 직전 성공 payload를 되살리지 않는다). "마지막 성공 payload"를 따로 저장해 항상 전달하는
     * 변형 구현을 이 테스트가 잡는다.
     */
    @Test fun fetchPreviousIsNilAfterPermissionLostRecovery() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        assertEquals("P1", core.loadedPayload())

        recorder.coordStub = { throw NearbyLocationError.Denied }
        core.load()
        assertEquals("denied", core.phaseName())
        recorder.resetLog()

        recorder.coordStub = { seoulCoord }
        recorder.fetchStub = { _, _ -> "P2" }
        core.load()
        assertNull(recorder.fetchPrevious.last())
        assertEquals("P2", core.loadedPayload())
    }

    /** #2 — loaded에서 시작하면 직전 payload를 유지한 채 재조회하고, previous로 전달한다. */
    @Test fun startFromLoadedKeepsPreviousPayload() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        recorder.resetLog()

        val gate = Gate()
        recorder.fetchStub = { _, _ -> gate.arriveAndWait(); "P2" }
        val job = launch { core.load() }
        gate.waitForArrival()
        assertEquals("loaded", core.phaseName())
        assertEquals("P1", core.loadedPayload()) // 보류 중에도 데이터 유지
        assertEquals("P1", recorder.fetchPrevious.last())
        assertTrue(recorder.events.isEmpty())

        gate.release()
        job.join()
        assertEquals("P2", core.loadedPayload())
        // 재조회 성공도 #10 그대로 — 통지 억제나 willCommit 생략이 있으면 안 된다.
        assertEquals(listOf("loaded"), recorder.events)
        assertEquals(listOf("willCommit", "phase=loaded", "event=loaded"), recorder.log)
        assertEquals("loaded", recorder.phaseAtWillCommit) // 직전 payload가 아직 살아 있는 시점
    }

    // #4·#5 좌표 denied

    /** #5 — 첫 로드의 denied는 상태만 바꾸고 통지하지 않는다(전락이 아니라 초기 거부). */
    @Test fun coordinateDeniedOnFirstLoadIsSilent() = runTest {
        val recorder = Recorder()
        recorder.coordStub = { throw NearbyLocationError.Denied }
        val core = makeCore(recorder)

        core.load()
        assertEquals("denied", core.phaseName())
        assertTrue(recorder.events.isEmpty())
        assertEquals(0, recorder.fetchCallCount)
    }

    /** #4 — loaded 중 denied 전락은 무신호 화면 전환을 막기 위해 permissionLost를 통지한다. */
    @Test fun coordinateDeniedWhileLoadedNotifiesPermissionLost() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        recorder.resetLog()

        recorder.coordStub = { throw NearbyLocationError.Denied }
        core.load()
        assertEquals("denied", core.phaseName())
        assertEquals(listOf("permissionLost"), recorder.events)
        // 불변식 ⑤ — 커밋이 이벤트보다 앞선다
        assertEquals(listOf("phase=denied", "event=permissionLost"), recorder.log)
    }

    // 정밀 위치 꺼짐 (denied·unavailable과 별개 축)

    /** 첫 로드의 reducedAccuracy는 상태만 바꾼다. ⚠ 핵심은 phase가 denied도 failedLocation도 아니라는 것이다. */
    @Test fun reducedAccuracyOnFirstLoadIsSilentAndDistinct() = runTest {
        val recorder = Recorder()
        recorder.coordStub = { throw NearbyLocationError.ReducedAccuracy }
        val core = makeCore(recorder)

        core.load()
        assertEquals("reducedAccuracy", core.phaseName())
        assertTrue(recorder.events.isEmpty())
        // 좌표가 없으므로 upstream을 부르지 않는다(쿼터 보호 + 거짓 주변 정보 차단)
        assertEquals(0, recorder.fetchCallCount)
    }

    /** loaded 중 정밀 위치가 꺼지면 목록이 통째로 사라지므로 무신호가 되지 않게 통지한다. */
    @Test fun reducedAccuracyWhileLoadedNotifiesPermissionLost() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        recorder.resetLog()

        recorder.coordStub = { throw NearbyLocationError.ReducedAccuracy }
        core.load()
        assertEquals("reducedAccuracy", core.phaseName())
        assertEquals(listOf("accuracyLost"), recorder.events)
        assertEquals(listOf("phase=reducedAccuracy", "event=accuracyLost"), recorder.log)
    }

    // #6·#7 좌표 unavailable

    /** #7 — 첫 로드의 위치 실패는 failedLocation(서버 실패와 구분), 통지 없음. */
    @Test fun coordinateUnavailableOnFirstLoadIsFailedLocation() = runTest {
        val recorder = Recorder()
        recorder.coordStub = { throw NearbyLocationError.Unavailable }
        val core = makeCore(recorder)

        core.load()
        assertEquals("failedLocation", core.phaseName())
        assertTrue(recorder.events.isEmpty())
        assertEquals(0, recorder.fetchCallCount)
    }

    /** #6 — loaded 중 위치 실패는 데이터를 유지하고 refreshFailed만 통지한다(재조회이지 포기 아님). */
    @Test fun coordinateUnavailableWhileLoadedKeepsData() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        recorder.resetLog()

        recorder.coordStub = { throw NearbyLocationError.Unavailable }
        core.load()
        assertEquals("loaded", core.phaseName())
        assertEquals("P1", core.loadedPayload())
        assertEquals(listOf("refreshFailed"), recorder.events)
    }

    // #8·#9 커버리지 선분기

    /** #9 — coverage=korea에서 해외 좌표는 fetch를 생략하고 outOfCoverage로(쿼터 보호). */
    @Test fun foreignCoordUnderKoreaCoverageSkipsFetch() = runTest {
        val recorder = Recorder()
        recorder.coordStub = { tokyoCoord }
        val core = makeCore(recorder, coverage = NearbyCoverage.korea)

        core.load()
        assertEquals("outOfCoverage", core.phaseName())
        assertEquals(0, recorder.fetchCallCount)
        assertTrue(recorder.events.isEmpty())
    }

    /** #8 — loaded 중 커버리지 밖 전락은 wentOutOfCoverage를 통지한다. */
    @Test fun foreignCoordWhileLoadedNotifiesWentOutOfCoverage() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder, coverage = NearbyCoverage.korea)
        core.load()
        recorder.resetLog()

        recorder.coordStub = { tokyoCoord }
        core.load()
        assertEquals("outOfCoverage", core.phaseName())
        assertEquals(listOf("wentOutOfCoverage"), recorder.events)
        assertEquals(listOf("phase=outOfCoverage", "event=wentOutOfCoverage"), recorder.log)
        assertEquals(1, recorder.fetchCallCount) // 1차 성공분뿐 — 2차는 선분기로 생략
    }

    /** coverage=none은 선분기가 없다 — 해외 좌표도 그대로 fetch로 내려간다. */
    @Test fun coverageNoneAllowsForeignCoord() = runTest {
        val recorder = Recorder()
        recorder.coordStub = { tokyoCoord }
        val core = makeCore(recorder, coverage = NearbyCoverage.none)

        core.load()
        assertEquals(1, recorder.fetchCallCount)
        assertEquals(tokyoCoord.lat, recorder.fetchCoords[0]?.lat)
        assertEquals("loaded", core.phaseName())
    }

    // #10 성공

    /** #10 — willCommit이 phase 대입보다 앞서고, 이벤트는 커밋 후 1회(불변식 ⑤). */
    @Test fun successCommitsPayloadBeforeEvent() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)

        core.load()
        assertEquals("P1", core.loadedPayload())
        assertEquals(listOf("willCommit", "phase=loaded", "event=loaded"), recorder.log)
        assertEquals(listOf("loaded"), recorder.events)
        // 부가 상태(willCommit)는 phase 대입 전에 끝나 있어야 원자 커밋이다
        assertEquals("loading", recorder.phaseAtWillCommit)
    }

    // #11·#12 fetch 부재(null)

    /** #11 — loaded 중 부재는 데이터를 유지하고 refreshFailed만 통지한다. */
    @Test fun fetchNilWhileLoadedKeepsDataAndNotifiesRefreshFailed() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        recorder.resetLog()

        recorder.fetchStub = { _, _ -> null }
        core.load()
        assertEquals("loaded", core.phaseName())
        assertEquals("P1", core.loadedPayload())
        assertEquals(listOf("refreshFailed"), recorder.events)
    }

    /** #12 — 첫 로드의 부재는 empty(실패와 구분되는 정상적 부재). */
    @Test fun fetchNilOnFirstLoadIsEmpty() = runTest {
        val recorder = Recorder()
        recorder.fetchStub = { _, _ -> null }
        val core = makeCore(recorder)

        core.load()
        assertEquals("empty", core.phaseName())
        assertEquals(listOf("emptyResult"), recorder.events)
        assertEquals(listOf("phase=empty", "event=emptyResult"), recorder.log)
    }

    // #13·#14 서버 커버리지 마커

    /** #14 — 서버 outOfCoverage 마커도 같은 상태로(선분기와 이중 방어). */
    @Test fun serverOutOfCoverageOnFirstLoad() = runTest {
        val recorder = Recorder()
        recorder.fetchStub = { _, _ -> throw APIError.OutOfCoverage }
        val core = makeCore(recorder)

        core.load()
        assertEquals("outOfCoverage", core.phaseName())
        assertTrue(recorder.events.isEmpty())
    }

    /** 서비스 지역 미제공 마커 — outOfCoverage와 **다른 상태**로 남는다. 뭉개면 "대한민국 밖" 안내가 부산 사용자에게 낭독된다. */
    @Test fun serverUnavailableHereOnFirstLoad() = runTest {
        val recorder = Recorder()
        recorder.fetchStub = { _, _ -> throw APIError.UnavailableHere(UnavailableHereReason.seoulOnly) }
        val core = makeCore(recorder)

        core.load()
        assertEquals("unavailableHere:seoulOnly", core.phaseName())
        assertTrue(recorder.events.isEmpty())
    }

    /** loaded 중 미제공 지역으로 전락하면(앵커 변경) 데이터를 잃되 침묵하지 않는다. */
    @Test fun serverUnavailableHereWhileLoadedNotifies() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        recorder.resetLog()

        recorder.fetchStub = { _, _ -> throw APIError.UnavailableHere(UnavailableHereReason.seoulOnly) }
        core.load(force = true)
        assertEquals("unavailableHere:seoulOnly", core.phaseName())
        assertEquals(listOf("phase=unavailableHere:seoulOnly", "event=refreshFailed"), recorder.log)
    }

    /** 사유가 그대로 전달돼야 화면이 다른 문장을 고를 수 있다. 뭉개면 강릉 사용자가 "서울에서만 제공됩니다"를 듣는다. */
    @Test fun unavailableHereReasonPropagates() = runTest {
        val recorder = Recorder()
        recorder.fetchStub = { _, _ -> throw APIError.UnavailableHere(UnavailableHereReason.noBusData) }
        val core = makeCore(recorder)

        core.load()
        assertEquals("unavailableHere:noBusData", core.phaseName())
    }

    /** #13 — loaded 중 서버 마커는 wentOutOfCoverage를 통지한다. */
    @Test fun serverOutOfCoverageWhileLoadedNotifies() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        recorder.resetLog()

        recorder.fetchStub = { _, _ -> throw APIError.OutOfCoverage }
        core.load()
        assertEquals("outOfCoverage", core.phaseName())
        assertEquals(listOf("wentOutOfCoverage"), recorder.events)
    }

    // #15·#16 fetch 일반 실패

    /** #16 — 첫 로드의 서버 실패는 failedServer(위치 실패와 구분). */
    @Test fun fetchThrowOnFirstLoadIsFailedServer() = runTest {
        val recorder = Recorder()
        recorder.fetchStub = { _, _ -> throw StubError() }
        val core = makeCore(recorder)

        core.load()
        assertEquals("failedServer", core.phaseName())
        assertTrue(recorder.events.isEmpty())
    }

    /** #15 — loaded 중 서버 실패는 데이터를 유지하고 refreshFailed만 통지한다. */
    @Test fun fetchThrowWhileLoadedKeepsData() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        recorder.resetLog()

        recorder.fetchStub = { _, _ -> throw StubError() }
        core.load()
        assertEquals("loaded", core.phaseName())
        assertEquals("P1", core.loadedPayload())
        assertEquals(listOf("refreshFailed"), recorder.events)
    }

    /** `withTimeout` 만료는 화면 이탈이 아니라 조회 실패다(Kotlin 고유 — 타임아웃 예외가 취소 예외의 하위형). */
    @Test fun timeoutInsideFetchIsServerFailureNotCancellation() = runTest {
        val recorder = Recorder()
        recorder.fetchStub = { _, _ -> withTimeout(10) { CompletableDeferred<Payload>().await() } }
        val core = makeCore(recorder)

        core.load()
        assertEquals("failedServer", core.phaseName())
    }

    // 좌표 소스·force

    /** 파라미터형(None) 소스는 좌표 단계를 통째로 생략한다 — coverage=korea여도 선분기가 없다. */
    @Test fun noneCoordinateSourceSkipsCoordinateStage() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder, coverage = NearbyCoverage.korea, sourceKind = SourceKind.None)

        core.load()
        assertEquals(0, recorder.coordCallCount)
        assertEquals(1, recorder.fetchCallCount)
        assertNull(recorder.fetchCoords[0])
        assertEquals("loaded", core.phaseName())
    }

    // Fixed 앵커(장소 상세 "이 장소 주변")

    /** 앵커 좌표가 fetch에 그대로 전달되고, force 재조회에도 같은 좌표가 간다(측위 단계가 없으므로 force는 재조회 의미만). */
    @Test fun fixedSourcePassesAnchorAndIgnoresForce() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder, coverage = NearbyCoverage.korea, sourceKind = SourceKind.Fixed(seoulCoord))

        core.load()
        core.load(force = true)

        assertEquals(0, recorder.coordCallCount) // 위치 어댑터 미사용
        assertEquals(2, recorder.fetchCallCount)
        assertTrue(recorder.fetchCoords.all { it == seoulCoord })
        assertEquals("loaded", core.phaseName())
    }

    /**
     * 커버리지 선분기는 좌표 출처를 가리지 않는다 — 앵커가 한국 밖이면 upstream을 **호출하지 않고** outOfCoverage.
     * fetchCallCount 단언이 핵심: 이게 없으면 선분기를 지워도 서버 마커가 같은 phase를 만들어 통과한다.
     */
    @Test fun fixedSourceOutsideKoreaSkipsUpstream() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder, coverage = NearbyCoverage.korea, sourceKind = SourceKind.Fixed(tokyoCoord))

        core.load()

        assertEquals(0, recorder.fetchCallCount)
        assertEquals("outOfCoverage", core.phaseName())
        assertTrue(recorder.events.isEmpty()) // 첫 진입은 통지 없음(#13 동형)
    }

    /** 실패는 fetch throw → failedServer 하나로만 분류된다(fixed 소스엔 위치 어댑터 자체가 없다). */
    @Test fun fixedSourceHasNoLocationFailurePath() = runTest {
        val recorder = Recorder()
        recorder.fetchStub = { _, _ -> throw StubError() }
        val core = makeCore(recorder, coverage = NearbyCoverage.korea, sourceKind = SourceKind.Fixed(seoulCoord))

        core.load()

        assertEquals("failedServer", core.phaseName())
    }

    /** 불변식 ⑥ — force는 getCoordinate로 그대로 전달될 뿐 전이에 영향이 없다. */
    @Test fun forceIsForwardedToCoordinateSource() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)

        core.load()
        core.load(force = true)
        assertEquals(listOf(false, true), recorder.coordForces)
    }

    // #17 취소 (오류형)

    /** #17 — idle에서 시작한 로드가 취소 오류를 받으면 loading에 고착되지 않고 idle로 복원된다. */
    @Test fun cancellationErrorFromIdleRestoresIdle() = runTest {
        val recorder = Recorder()
        recorder.fetchStub = { _, _ -> throw CancellationException("stub") }
        val core = makeCore(recorder)

        core.load()
        assertEquals("idle", core.phaseName())
        assertTrue(recorder.events.isEmpty())
    }

    /** #17 — 재시도(entry=failedServer)의 취소는 failedServer로 복원한다(loading 고착 금지). */
    @Test fun cancellationErrorFromFailedServerRestoresFailedServer() = runTest {
        val recorder = Recorder()
        recorder.fetchStub = { _, _ -> throw StubError() }
        val core = makeCore(recorder)
        core.load()
        assertEquals("failedServer", core.phaseName())
        recorder.resetLog()

        recorder.fetchStub = { _, _ -> throw CancellationException("stub") }
        core.load()
        assertEquals("failedServer", core.phaseName())
        assertTrue(recorder.events.isEmpty())
    }

    /** #17 — loaded 중 취소는 payload를 그대로 유지하고 아무 통지도 내지 않는다. */
    @Test fun cancellationErrorWhileLoadedKeepsPayload() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        recorder.resetLog()

        recorder.fetchStub = { _, _ -> throw CancellationException("stub") }
        core.load()
        assertEquals("P1", core.loadedPayload())
        assertTrue(recorder.events.isEmpty())
    }

    // #17 취소 (커밋 게이트 — 협력적 취소가 성공값을 반환하는 경우)

    /** #17 — 취소된 코루틴의 fetch가 성공값을 반환해도 커밋·통지하지 않는다(떠난 화면 보호). */
    @Test fun cooperativeCancellationDiscardsSuccessfulFetch() = runTest {
        val recorder = Recorder()
        val gate = Gate()
        recorder.fetchStub = { _, _ ->
            gate.arriveAndWait()
            "P-late" // 취소를 무시하고 성공값을 반환하는 스텁
        }
        val core = makeCore(recorder)

        val job = launch { core.load() }
        gate.waitForArrival()
        job.cancel()
        gate.release()
        job.join()

        assertEquals("idle", core.phaseName()) // entry 복원
        assertTrue(recorder.events.isEmpty())
        assertTrue(recorder.log.isEmpty()) // willCommit도 호출되지 않았다
    }

    /** #17 — 좌표 단계 판: 취소 후 좌표가 성공 반환해도 fetch로 내려가지 않는다. */
    @Test fun cooperativeCancellationAtCoordinateStageSkipsFetch() = runTest {
        val recorder = Recorder()
        val gate = Gate()
        recorder.coordStub = {
            gate.arriveAndWait()
            seoulCoord
        }
        val core = makeCore(recorder)

        val job = launch { core.load() }
        gate.waitForArrival()
        job.cancel()
        gate.release()
        job.join()

        assertEquals(0, recorder.fetchCallCount)
        assertEquals("idle", core.phaseName())
        assertTrue(recorder.events.isEmpty())
    }

    /** #17 — 래핑 취소 방어: 취소 상태에서 온 임의 오류를 서버 실패로 오판하지 않는다. */
    @Test fun wrappedErrorUnderCancellationRestoresWithoutNotice() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder)
        core.load()
        recorder.resetLog()

        val gate = Gate()
        recorder.fetchStub = { _, _ ->
            gate.arriveAndWait()
            throw StubError() // 취소가 도메인 오류로 래핑되어 돌아온 경우
        }
        val job = launch { core.load() }
        gate.waitForArrival()
        job.cancel()
        gate.release()
        job.join()

        assertEquals("P1", core.loadedPayload())
        assertTrue(recorder.events.isEmpty()) // refreshFailed 미발화
    }

    /**
     * #17 × #8 — 좌표 취득 후 커버리지 선분기 앞에서 취소되면, 커버리지 밖 좌표를 받았더라도 outOfCoverage로 커밋하거나
     * wentOutOfCoverage를 통지하지 않는다(취소 게이트가 선분기보다 뒤로 밀리면 떠난 화면에 "서비스 지역 밖"이 오발화한다).
     */
    @Test fun cooperativeCancellationBeforeCoveragePrecheckDiscards() = runTest {
        val recorder = Recorder()
        val core = makeCore(recorder, coverage = NearbyCoverage.korea)
        core.load()
        assertEquals("P1", core.loadedPayload())
        recorder.resetLog()

        val gate = Gate()
        recorder.coordStub = {
            gate.arriveAndWait()
            tokyoCoord // 취소를 무시하고 커버리지 밖 좌표를 반환하는 스텁
        }
        val job = launch { core.load() }
        gate.waitForArrival()
        job.cancel()
        gate.release()
        job.join()

        assertEquals("P1", core.loadedPayload()) // outOfCoverage로 전락하지 않는다
        assertTrue(recorder.events.isEmpty()) // wentOutOfCoverage 미발화
    }

    /** 불변식 ④ — 취소 경로에서도 in-flight 가드가 해제되어 후속 load가 정상 완주한다. */
    @Test fun inFlightGuardIsReleasedAfterCancellation() = runTest {
        val recorder = Recorder()
        val gate = Gate()
        recorder.fetchStub = { _, _ -> gate.arriveAndWait(); "P-late" }
        val core = makeCore(recorder)

        val job = launch { core.load() }
        gate.waitForArrival()
        job.cancel()
        gate.release()
        job.join()
        assertEquals("idle", core.phaseName())

        recorder.fetchStub = { _, _ -> "P2" }
        core.load()
        assertEquals("P2", core.loadedPayload())
        assertEquals(listOf("loaded"), recorder.events)
    }
}
