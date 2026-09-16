package space.dodoplanet.gildongmu.guide

import android.content.Context
import android.os.PowerManager
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.location.LocationPermission

// 플랫폼 포트 실구현 모음. ⚠ 조각 ①에서는 **임시 no-op**이 섞여 있다 — 서비스·권한 런처는 Task 5, 오디오·진동·TTS는 조각 ②
// (Task 9~12)가 자기 파일로 교체하고 여기서 지운다. 남는 것은 `AndroidGuideEnvironment`뿐이다.

/** 전경 판정 입력(§5-3): 앱 Activity STARTED 플래그 + `PowerManager.isInteractive` 실조회. */
class AndroidGuideEnvironment(context: Context) : GuideEnvironment {
    private val power = context.getSystemService(PowerManager::class.java)

    @Volatile var foreground = false
    override fun isForeground(): Boolean = foreground
    override fun isInteractive(): Boolean = power?.isInteractive ?: true
}

/** 임시(Task 5가 교체): 전경 서비스 시작·정지. */
class AndroidForegroundController(@Suppress("unused") private val context: Context) : GuideForegroundController {
    override fun start() = Unit
    override fun stop() = Unit
}

/** 임시(Task 5가 런처를 붙인다): 위치 권한만 M2 손(`AppConfig.permissionGate`)을 지나고 나머지는 거부로 접는다. */
class GuidePermissionsImpl(@Suppress("unused") private val context: Context) : GuidePermissions {
    override fun isLocationEnabled(): Boolean = AppConfig.locationStore.isLocationEnabled()
    override fun currentLocation(): LocationPermission = AppConfig.permissionGate.current()
    override suspend fun requestLocation(): LocationPermission = AppConfig.permissionGate.request()
    override suspend fun requestNotifications() = Unit
    override suspend fun requestActivityRecognition(): Boolean = false
}

/** 임시(Task 11이 `GuideTonePlayer`로 교체). */
object NoopTones : GuideTones {
    override fun preload() = Unit
    override fun beginSession() = Unit
    override fun endSession() = Unit
    override fun play(tone: BeaconTone) = Unit
    override val toneEndsAt: Double? get() = null
    override val isSilenced: Boolean get() = false
    override val focusDenied: Boolean get() = false
    override val isMediaVolumeZero: Boolean get() = false
    override var isSuppressed: Boolean = false
}

/** 임시(Task 12가 `GuideSpeaker` 실구현으로 교체). */
object NoopSpeaker : GuideSpeaker {
    override fun prepare() = Unit
    override fun speak(text: String, highPriority: Boolean): Boolean = false
    override val isUnavailable: Boolean get() = false
}

/** 임시(Task 10이 `ResultHaptic`으로 교체). */
object NoopHaptics : GuideHaptics {
    override fun result(kind: ResultHapticKind) = Unit
}

/** 임시(Task 5가 `AndroidStepCounter`로 교체). */
object NoopStepCounter : StepCounter {
    override fun start() = Unit
    override fun stop() = Unit
    override val liveSample: StepSample? get() = null
}
