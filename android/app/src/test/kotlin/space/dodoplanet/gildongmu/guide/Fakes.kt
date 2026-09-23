package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import space.dodoplanet.gildongmu.directions.CatalogStrings
import space.dodoplanet.gildongmu.kit.BeaconDest
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.DataLocale
import space.dodoplanet.gildongmu.kit.GuideSessionCoordinator
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.RoutePoint
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.StubTransport
import space.dodoplanet.gildongmu.kit.APIClient
import space.dodoplanet.gildongmu.kit.models.WalkLineKind
import space.dodoplanet.gildongmu.location.LocationPermission

// 페이크 포트(spec §10 — 판정은 :kit, 여기는 "실제로 했는가"를 기록한다).

class FakeController : GuideForegroundController {
    var starts = 0
    var stops = 0
    /** start()가 이 예외로 실패한 것처럼 콜백을 되부른다(서비스 안 `startForeground` 실패 모양). */
    var failOnStart: Throwable? = null
    lateinit var model: WalkGuideModel
    override fun start() {
        starts++
        failOnStart?.let { model.onServiceStartFailed(it) }
    }
    override fun stop() { stops++ }
}

class FakePermissions(
    var location: LocationPermission = LocationPermission.Fine,
    var enabled: Boolean = true,
    var activity: Boolean = true,
) : GuidePermissions {
    var requestResult: LocationPermission? = null
    var locationRequests = 0
    var notificationRequests = 0
    override fun isLocationEnabled() = enabled
    override fun currentLocation() = location
    override suspend fun requestLocation(): LocationPermission { locationRequests++; return requestResult ?: location }
    override suspend fun requestNotifications() { notificationRequests++ }
    override suspend fun requestActivityRecognition() = activity
}

class FakeTones : GuideTones {
    val played = mutableListOf<BeaconTone>()
    var sessions = 0
    var ends = 0
    var preloads = 0
    override var toneEndsAt: Double? = null
    override var isSilenced = false
    override var focusDenied = false
    override var isMediaVolumeZero = false
    override var isSuppressed = false
    /** 다음 N회 재생을 포커스 거절로 흉내 낸다(3회째에 `focusDenied`). */
    var focusDeniedNext = 0
    /** 0보다 크면 재생마다 `toneEndsAt = clock() + 길이`(톤 뒤 발화 지연 경로가 돈다). */
    var toneDurationSeconds = 0.0
    var clock: () -> Double = { 0.0 }
    private var streak = 0
    override fun preload() { preloads++ }
    override fun beginSession() { sessions++ }
    override fun endSession() { ends++ }
    override fun play(tone: BeaconTone) {
        toneEndsAt = null
        if (isSuppressed) return
        if (focusDeniedNext > 0) {
            focusDeniedNext--
            streak++
            if (streak >= 3) focusDenied = true
            return
        }
        streak = 0
        focusDenied = false
        played += tone
        if (toneDurationSeconds > 0) toneEndsAt = clock() + toneDurationSeconds
    }
}

class FakeSpeaker : GuideSpeaker {
    val spoken = mutableListOf<Pair<String, Boolean>>()
    var allow = true
    var prepares = 0
    override var isUnavailable = false
    override fun prepare() { prepares++ }
    override fun speak(text: String, highPriority: Boolean): Boolean {
        if (!allow) return false
        spoken += text to highPriority
        return true
    }
    val texts: List<String> get() = spoken.map { it.first }
}

class FakeHaptics : GuideHaptics {
    val fired = mutableListOf<ResultHapticKind>()
    override fun result(kind: ResultHapticKind) { fired += kind }
}

class FakeSteps : StepCounter {
    var starts = 0
    var stops = 0
    override var liveSample: StepSample? = null
    override fun start() { starts++ }
    override fun stop() { stops++ }
}

class FakeEnv(var foreground: Boolean = true, var interactive: Boolean = true) : GuideEnvironment {
    override fun isForeground() = foreground
    override fun isInteractive() = interactive
}

class FakeClock(var now: Double = 0.0) {
    val read: () -> Double = { now }
}

/** 도보 브리핑 JSON 합성 — `route-walk.json` fixture엔 `pathCoords`가 없어 상세 적격 응답은 여기서 만든다. */
data class TestStep(
    val description: String,
    val path: List<RoutePoint>,
    val target: String? = null,
    val anchor: String? = null,
    val action: String? = null,
    val crossing: Boolean? = null,
)

fun walkBriefingJson(
    steps: List<TestStep>,
    distanceMeters: Int = 300,
    durationSeconds: Int = 260,
    stepFree: String? = null,
    stepFreeNotice: String? = null,
    finalApproach: String? = null,
    waypointStepIndex: Int? = null,
): String {
    val stepsJson = steps.joinToString(",") { s ->
        buildString {
            append("{\"description\":\"${s.description}\"")
            append(",\"pathCoords\":[" + s.path.joinToString(",") { "{\"lat\":${it.lat},\"lng\":${it.lng}}" } + "]")
            if (s.target != null || s.anchor != null) {
                append(",\"live\":{")
                append(listOfNotNull(s.target?.let { "\"target\":\"$it\"" }, s.anchor?.let { "\"anchor\":\"$it\"" }).joinToString(","))
                append("}")
            }
            if (s.action != null) append(",\"action\":\"${s.action}\"")
            if (s.crossing != null) append(",\"crossing\":${s.crossing}")
            append("}")
        }
    }
    return buildString {
        append("{\"result\":{\"distanceMeters\":$distanceMeters,\"durationSeconds\":$durationSeconds,\"steps\":[$stepsJson]")
        if (stepFree != null) append(",\"stepFree\":\"$stepFree\"")
        if (stepFreeNotice != null) append(",\"stepFreeNotice\":\"$stepFreeNotice\"")
        if (finalApproach != null) append(",\"finalApproach\":$finalApproach")
        if (waypointStepIndex != null) {
            val p = steps[waypointStepIndex].path.first()
            append(",\"waypoint\":{\"stepIndex\":$waypointStepIndex,\"coord\":{\"lat\":${p.lat},\"lng\":${p.lng}}}")
        }
        append("}}")
    }
}

/** 위도 1m ≈ 1/111_320°. 북쪽으로 `meters` 떨어진 점. */
const val meterLat = 1.0 / 111_320.0
const val lat0 = 37.5385
const val lng0 = 127.1355
fun north(meters: Double) = RoutePoint(lat0 + meters * meterLat, lng0)

/** 300m 북진 단일 스텝 + 목적지 = 종점 15m 앞(오프셋 15m, 정면). */
fun straightRouteJson(lengthMeters: Double = 300.0, target: String? = "길동역", extra: String? = null): String = walkBriefingJson(
    steps = listOf(TestStep("천호대로를 따라 ${lengthMeters.toInt()}m 이동", listOf(north(0.0), north(lengthMeters)), target = target)),
    distanceMeters = lengthMeters.toInt(),
    finalApproach = extra ?: "{\"offsetMeters\":20,\"relativeBearing\":0,\"bearingUnavailable\":null}",
)

class GuideTestHarness(
    dispatcher: CoroutineDispatcher,
    val clock: FakeClock = FakeClock(100.0),
    walkResponder: (url: String) -> HttpResponse = { HttpResponse(200, straightRouteJson()) },
) {
    val catalog = CatalogStrings("ko")
    val controller = FakeController()
    val perms = FakePermissions()
    val tones = FakeTones()
    val speaker = FakeSpeaker()
    val haptics = FakeHaptics()
    val steps = FakeSteps()
    val env = FakeEnv()
    val coordinator = GuideSessionCoordinator()
    val store = InMemoryKeyValueStore()
    val transport = StubTransport(walkResponder).also { tones.clock = clock.read }
    /** 모델 스코프의 잡 — 워치독이 무한 루프라 테스트가 끝나면 `close()`로 끊는다(runTest 종료 대기 차단). */
    val job = SupervisorJob()
    val model = WalkGuideModel(
        routes = RouteService(APIClient("https://example.test", transport)),
        strings = catalog,
        dataLocale = { DataLocale.ko },
        controller = controller,
        permissions = perms,
        tones = tones,
        speaker = speaker,
        haptics = haptics,
        steps = steps,
        env = env,
        coordinator = coordinator,
        store = store,
        scope = CoroutineScope(job + dispatcher),
        clock = clock.read,
        io = dispatcher,
    ).also { controller.model = it }

    val dest = BeaconDest(north(315.0).lat, lng0)
    val request = WalkStartRequest(dest = dest, label = "길동역", accessible = false, variant = null, line = WalkLineKind.broad, waypoint = null)

    fun close() { job.cancel() }

    /** 지금 시각의 fix(정확도 5m, 속도 1.3m/s, 방위 없음). */
    fun fix(meters: Double, accuracy: Double = 5.0, speed: Double? = 1.3, course: Double = -1.0, courseAccuracy: Double = -1.0, ageSeconds: Double = 0.0): GuideFixPayload {
        val p = north(meters)
        return GuideFixPayload(p.lat, p.lng, accuracy, speed, speed?.let { 0.3 }, course, courseAccuracy, ((clock.now - ageSeconds) * 1000).toLong())
    }

    /** 시계를 `seconds`만큼 밀고 그 시점의 fix를 넣는다. 가상 시간은 호출부가 `advanceTimeBy`로 맞춘다. */
    fun walkTo(meters: Double, seconds: Double = 1.0, accuracy: Double = 5.0) {
        clock.now += seconds
        model.handleFix(fix(meters, accuracy))
    }
}

/**
 * `runTest`는 끝날 때 공유 스케줄러를 idle까지 돌리는데 워치독은 2초 주기 무한 루프라 영영 idle이 되지 않는다 —
 * 본문이 끝나면 **runTest가 반환하기 전에** 모델 스코프를 끊는다.
 */
fun guideTest(
    dispatcher: TestDispatcher,
    walkResponder: (url: String) -> HttpResponse = { HttpResponse(200, straightRouteJson()) },
    body: suspend TestScope.(GuideTestHarness) -> Unit,
) = runTest(dispatcher) {
    val h = GuideTestHarness(dispatcher, walkResponder = walkResponder)
    try { body(h) } finally { h.close() }
}
