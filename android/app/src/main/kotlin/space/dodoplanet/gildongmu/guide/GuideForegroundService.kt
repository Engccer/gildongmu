package space.dodoplanet.gildongmu.guide

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
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * 도보 안내 전경 서비스(`location` 타입, spec §4-1). 하는 일은 넷 — 지속 알림, **서비스 수명 wake lock**(워치독이 절전과
 * 함께 멎는 침묵 실패 차단, 리뷰 B-1), 전용 1초 위치 스트림, 알림 본문 갱신. 판정은 전부 `GuideSession.walk`(매 호출 조회).
 *
 * ⚠ `startForeground` 실패(백그라운드 시작·Android 14+ 위치 권한 미보유)는 여기서만 잡힌다(리뷰 B-3) — 잡아서 `stopSelf()` +
 * `onServiceStartFailed`로 모델에 되돌린다. 잡지 못하면 5초 뒤 `ForegroundServiceDidNotStartInTimeException`으로 프로세스가 죽는다.
 * `onTaskRemoved`는 세션을 유지한다(사용자가 명시로 끄기 전엔 산다). `START_NOT_STICKY` — 프로세스가 죽으면 되살리지 않는다.
 */
class GuideForegroundService : Service() {
    private var stream: GuideLocationStream? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var uiJob: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val main = Handler(Looper.getMainLooper())

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                if (GuideSession.isAttached) GuideSession.walk.stopByUser() else stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> start()
        }
        return START_NOT_STICKY
    }

    private fun start() {
        if (!GuideSession.isAttached) { stopSelf(); return }
        // 같은 인스턴스가 ACTION_START를 두 번 받으면(stopService와 새 시작이 onDestroy 전에 겹침) 스트림·wake lock을 덮어써
        // 옛 wake lock이 영구 보유되고 리스너가 이중 등록된다 — 살아 있는 자원은 그대로 새 세션이 쓴다(모델은 매 호출 조회).
        if (stream != null) { GuideDiag.log("service start reused"); return }
        val walk = GuideSession.walk
        val strings = guideStrings(resources)
        GuideDiag.attachFileSink(this)
        GuideNotification.ensureChannel(this, strings)
        val ui = walk.ui.value
        val notification = GuideNotification.build(this, strings, notificationTitleText(ui, strings), notificationBodyText(ui, strings))
        try {
            startForeground(GuideNotification.ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } catch (e: Exception) {
            GuideDiag.log("service start failed=${e::class.simpleName}")
            stopSelf()
            main.post { GuideSession.walk.onServiceStartFailed(e) }
            return
        }
        wakeLock = getSystemService(PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gildongmu:guide")
            ?.apply { setReferenceCounted(false); acquire() }
        val s = GuideLocationStream(this)
        stream = s
        val opened = s.open(
            onFix = { GuideSession.walk.handleFix(it) },
            onProviderDisabled = { GuideSession.walk.handleProviderDisabled() },
        )
        if (!opened) main.post { GuideSession.walk.handleProviderDisabled() }
        observeUi(strings)
        GuideDiag.log("service start ok")
    }

    /** 본문·제목이 바뀔 때만 `notify`(매 fix 갱신 금지 — 띠바 거리 10m 양자화가 빈도를 정한다). */
    private fun observeUi(strings: space.dodoplanet.gildongmu.directions.Strings) {
        uiJob?.cancel()
        val manager = getSystemService(NotificationManager::class.java)
        if (manager == null) { GuideDiag.log("notify manager=null"); return }
        uiJob = scope.launch {
            GuideSession.walk.ui
                .map { notificationTitleText(it, strings) to notificationBodyText(it, strings) }
                .distinctUntilChanged()
                .collect { (title, body) ->
                    if (!GuideSession.walk.isTracking) return@collect
                    manager.notify(GuideNotification.ID, GuideNotification.build(this@GuideForegroundService, strings, title, body))
                }
        }
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)  // spec §3-3 ⑦ — 전경 이탈·알림 제거를 명시(OEM 잔존 변종 차단, 멱등)
        uiJob?.cancel()
        uiJob = null
        scope.cancel()
        stream?.close()
        stream = null
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "space.dodoplanet.gildongmu.guide.START"
        const val ACTION_STOP = "space.dodoplanet.gildongmu.guide.STOP"
    }
}

/** 전경 서비스 손잡이(시작은 전경에서만 — 버튼 활성화가 곧 전경이다). 실패는 서비스 안에서 되돌아온다. */
class AndroidGuideController(context: Context) : GuideForegroundController {
    private val app = context.applicationContext
    override fun start() {
        app.startForegroundService(Intent(app, GuideForegroundService::class.java).setAction(GuideForegroundService.ACTION_START))
    }

    override fun stop() {
        app.stopService(Intent(app, GuideForegroundService::class.java))
    }
}
