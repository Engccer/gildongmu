package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.AppConfig
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * 안내 전경 서비스(`location` 타입, M4 spec §4-1·M5 §6-4) — 도보·자동차와 대중교통 keep-alive가 같은 서비스다. 하는 일은 넷: 지속 알림, **서비스 수명
 * wake lock**(워치독·폴이 절전과 함께 멎는 침묵 실패 차단, 리뷰 B-1), 소유자 프로파일의 위치 스트림, 알림 본문 갱신.
 *
 * 소유자(M5 §6-4): 다섯 경로(fix·위치 꺼짐·알림 문장·알림 「안내 종료」·`startForeground` 실패)는 이 서비스가 지금 든 **세대**를 싣고 `GuideSession`으로 간다.
 * 세션은 `serviceOwner()`가 고른 소유자의 세대와 같을 때만 전달한다 — 서비스는 도보 모델을 직접 부르지 않는다(소스 가드). 알림·프로파일 구독만 시작 시점의
 * 소유자에 건다(재사용 시작이면 새 세대·새 소유자로 다시 건다).
 *
 * ⚠ `startForeground` 실패(백그라운드 시작·Android 14+ 위치 권한 미보유)는 여기서만 잡힌다(리뷰 B-3) — 잡아서 `stopSelf()` + 같은 세대의 시작 실패로
 * 되돌린다. 잡지 못하면 5초 뒤 `ForegroundServiceDidNotStartInTimeException`으로 프로세스가 죽는다. Android 12+의 **동기** 시작 거부는 서비스까지 오지
 * 않는다 — 컨트롤러가 잡는다. `onTaskRemoved`는 세션을 유지한다. `START_NOT_STICKY` — 프로세스가 죽으면 되살리지 않는다.
 */
class GuideForegroundService : Service() {
    private var stream: GuideLocationStream? = null
    private var streamProfile: GuideLocationProfile? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var uiJob: Job? = null
    private var profileJob: Job? = null
    /** 이 서비스가 지금 든 세대(시작 명령이 실어 온다). 스트림 콜백은 호출 시점의 이 값을 싣는다 — 재사용 시작이면 같은 스트림이 새 세대의 것이 된다. */
    private var generation: Int? = null
    private var started = false
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val main = Handler(Looper.getMainLooper())

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val gen = intent?.getIntExtra(EXTRA_GENERATION, NO_GENERATION) ?: NO_GENERATION
        when (intent?.action) {
            ACTION_STOP -> {
                if (GuideSession.isAttached) GuideSession.serviceStopFromNotification(gen)
                // 소유자가 없으면(세션이 이미 끝났다) 남은 서비스를 스스로 내린다. 세대가 다른 늦은 「안내 종료」는 새 세션의 서비스를 건드리지 않는다.
                if (!GuideSession.isAttached || GuideSession.serviceOwner() == null) stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> start(gen)
        }
        return START_NOT_STICKY
    }

    private fun start(gen: Int) {
        if (!GuideSession.isAttached) { stopSelf(); return }
        val strings = guideStrings { AppConfig.localizedApp().resources } // 알림 문장도 앱 언어(M2 spec §14-2)
        // 같은 인스턴스가 ACTION_START를 두 번 받으면(stopService와 새 시작이 onDestroy 전에 겹침) 스트림·wake lock을 덮어써 옛 wake lock이 영구
        // 보유되고 리스너가 이중 등록된다 — 살아 있는 자원은 그대로 새 세대가 쓰고, 알림·프로파일 구독만 새 소유자로 다시 건다.
        if (started) {
            generation = gen
            GuideDiag.log("service start reused gen=$gen")
            bindOwner(strings)
            return
        }
        generation = gen
        GuideNotification.ensureChannel(this, strings)
        val (title, body) = GuideSession.serviceOwner()?.notificationText(strings) ?: (strings.get("android.guide.notificationChannel") to "")
        val notification = GuideNotification.build(this, strings, title, body, gen)
        try {
            startForeground(GuideNotification.ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } catch (e: Exception) {
            GuideDiag.log("service start failed=${e::class.simpleName} gen=$gen")
            stopSelf()
            main.post { GuideSession.serviceStartFailed(gen, e) }
            return
        }
        started = true
        GuideDiag.attachFileSink(this)   // startForeground 뒤 — 5초 창의 마진을 깎지 않는다(디렉터리 해석은 실행기 안)
        wakeLock = getSystemService(PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gildongmu:guide")
            ?.apply { setReferenceCounted(false); acquire() }
        bindOwner(strings)
        GuideDiag.log("service start ok gen=$gen")
    }

    /** 지금 소유자의 프로파일·알림 문장을 구독한다. 소유자가 이 세대를 쥐고 있지 않으면(그 사이 끝났다) 걸지 않는다 — 정지 경로가 서비스를 내린다. */
    private fun bindOwner(strings: space.dodoplanet.gildongmu.directions.Strings) {
        uiJob?.cancel()
        profileJob?.cancel()
        val owner = GuideSession.serviceOwner()
        if (owner == null || owner.serviceGeneration != generation) {
            GuideDiag.log("service owner mismatch gen=$generation owner=${owner?.serviceGeneration}")
            return
        }
        profileJob = scope.launch { owner.locationProfile.collect { openStream(it) } }
        val manager = getSystemService(NotificationManager::class.java)
        if (manager == null) { GuideDiag.log("notify manager=null"); return }
        // 본문·제목이 바뀔 때만 `notify`(매 fix 갱신 금지 — 띠바 거리 10m 양자화가 빈도를 정한다).
        uiJob = scope.launch {
            owner.notificationChanges
                .map { owner.notificationText(strings) }
                .filterNotNull()
                .distinctUntilChanged()
                .collect { (title, body) ->
                    val gen = generation ?: return@collect
                    manager.notify(GuideNotification.ID, GuideNotification.build(this@GuideForegroundService, strings, title, body, gen))
                }
        }
    }

    /** 프로파일이 바뀌면 스트림을 다시 연다(A46: boarding에서 켠 keep-alive를 버스 riding에서 정밀로 올린다). null이면 닫는다. */
    private fun openStream(profile: GuideLocationProfile?) {
        if (profile == streamProfile && (profile == null || stream != null)) return
        stream?.close()
        stream = null
        streamProfile = profile
        if (profile == null) return
        val s = GuideLocationStream(this)
        stream = s
        val opened = s.open(
            profile,
            onFix = { fix -> generation?.let { GuideSession.serviceFix(it, fix) } },
            onProviderDisabled = { generation?.let { GuideSession.serviceProviderDisabled(it) } },
        )
        if (!opened) {
            val gen = generation
            main.post { gen?.let { GuideSession.serviceProviderDisabled(it) } }
        }
    }

    /**
     * 정리는 **이 인스턴스의 자원만** 만진다. `stopService` 뒤의 새 시작은 AMS가 새 `ServiceRecord`·새 인스턴스로 올리므로(옛 레코드는
     * bringDown에서 제거) 옛 `onDestroy`가 새 세션의 스트림·wake lock을 닫는 경로는 없다 — 실기기 대본 #24가 이것을 확인한다.
     */
    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)  // spec §3-3 ⑦ — 전경 이탈·알림 제거를 명시(OEM 잔존 변종 차단, 멱등)
        uiJob?.cancel()
        uiJob = null
        profileJob?.cancel()
        profileJob = null
        scope.cancel()
        stream?.close()
        stream = null
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
        GuideDiag.log("service destroy")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "space.dodoplanet.gildongmu.guide.START"
        const val ACTION_STOP = "space.dodoplanet.gildongmu.guide.STOP"
        const val EXTRA_GENERATION = "space.dodoplanet.gildongmu.guide.GENERATION"
        private const val NO_GENERATION = -1
    }
}

/**
 * 전경 서비스 손잡이(두 모델이 공유하는 한 인스턴스, M5 §6-4). 세대를 발급하고, 지금 세대만 내린다(앞 세션의 늦은 정지가 새 세션의 서비스를 내리지 않게).
 * Android 12+의 백그라운드 `startForegroundService` 거부(`ForegroundServiceStartNotAllowedException`, 14+ 위치 타입은 `SecurityException`)는 호출 자체에서
 * 던져진다 — 잡아서 같은 세대의 시작 실패로 넘긴다(`onStartFailed`는 `GuideSession.serviceStartFailed`, 동기).
 */
class AndroidGuideController(context: Context, private val onStartFailed: (generation: Int, error: Throwable) -> Unit) : GuideForegroundController {
    private val app = context.applicationContext
    private var issued = 0
    private var current: Int? = null

    override fun nextGeneration(): Int = ++issued

    override fun start(generation: Int) {
        current = generation
        try {
            app.startForegroundService(
                Intent(app, GuideForegroundService::class.java)
                    .setAction(GuideForegroundService.ACTION_START)
                    .putExtra(GuideForegroundService.EXTRA_GENERATION, generation),
            )
        } catch (e: Exception) {
            GuideDiag.log("service start rejected=${e::class.simpleName} gen=$generation")
            if (current == generation) current = null
            onStartFailed(generation, e)
        }
    }

    override fun stop(generation: Int) {
        if (generation != current) {
            GuideDiag.log("service stop stale gen=$generation current=$current")
            return
        }
        current = null
        app.stopService(Intent(app, GuideForegroundService::class.java))
    }
}
