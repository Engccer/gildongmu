package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.location.LocationPermission

// [3] 실행 계층 포트(spec 2026-09-16-android-m4 §2·§3). `WalkGuideModel`은 이 인터페이스만 보고, 실구현은 플랫폼 API
// (`GuideForegroundService`·`GuideTonePlayer`·`GuideSpeaker`·`ResultHaptic`·`AndroidStepCounter`)이며 JVM 테스트는 페이크를 쓴다.
// 판정은 전부 :kit 순수 함수이고 여기는 "실제로 하는 곳"과의 경계다(D5).

/** 전경 서비스 손잡이. 시작 실패는 여기서 던져지지 않는다 — 서비스 안에서 잡아 `WalkGuideModel.onServiceStartFailed`로 되부른다(§4-1). */
interface GuideForegroundController {
    fun start()
    fun stop()
}

/** 권한·기기 상태(§3-2 ②③). 위치 권한은 M2 `AppConfig.permissionGate`를 그대로 지난다. */
interface GuidePermissions {
    fun isLocationEnabled(): Boolean
    fun currentLocation(): LocationPermission
    suspend fun requestLocation(): LocationPermission

    /** API 33+에서만 시스템 다이얼로그. 거부는 차단이 아니다(알림 없이 진행). */
    suspend fun requestNotifications()

    /** 걸음 센서 권한. 거부면 요약만 없다. */
    suspend fun requestActivityRecognition(): Boolean
}

/** 톤 재생기(§5-1). 억제·포커스·진동·미디어 볼륨 판정을 안에 둔다. */
interface GuideTones {
    /** 소리 리소스 로드 시작(멱등). `startWalk` 게이트 통과 직후에 부른다. */
    fun preload()
    fun beginSession()
    fun endSession()
    fun play(tone: BeaconTone)

    /** 지금 재생 중인 톤이 끝나는 단조 시각(초). 미재생·실패·거절이면 null. */
    val toneEndsAt: Double?

    /** 재생 수단이 죽었는데 되살리지 못한 상태(조용한 무음 금지 — 호출부가 통지). */
    val isSilenced: Boolean

    /** 오디오 포커스 거절이 3회 연속 지속 중(3-state — 통화 등). */
    val focusDenied: Boolean

    /** 미디어 볼륨 0(iOS `isBackgroundAudible`의 안드로이드 대체 축). */
    val isMediaVolumeZero: Boolean

    /** 상위(모델)가 출력을 억제 중인지 — 참이면 `play`는 no-op. */
    var isSuppressed: Boolean
}

/** 발화 창구(§5-3). 안내 문장은 이 TTS 한 채널이다. */
interface GuideSpeaker {
    /** TTS 초기화(멱등). 초기화 전 문장은 최신 1개만 보류한다. */
    fun prepare()

    /** 게시 시도. 포커스를 못 잡거나 엔진이 없으면 false(호출부가 `onDropped`·상환을 판정한다). */
    fun speak(text: String, highPriority: Boolean): Boolean

    /** 현재 앱 언어를 이 기기 TTS가 지원하지 않는다(시트 행 + 진동 1회). */
    val isUnavailable: Boolean
}

enum class ResultHapticKind { success, attention, failure }

/** 결과 진동 3종 창구(§5-4). 모델은 `outputSuppressed`면 부르지 않는다("문장이 나가는 조건 = 진동이 나가는 조건"). */
interface GuideHaptics {
    fun result(kind: ResultHapticKind)
}

/** 세션 누적 걸음 표본. 안드로이드는 거리를 주지 않아 `distanceMeters`는 항상 null(보폭 환산은 :kit `WalkHealth`). */
data class StepSample(val steps: Int, val distanceMeters: Double?)

interface StepCounter {
    fun start()

    /** 갱신만 멈춘다 — 값은 남긴다(종료 처리가 뒤에 읽는다). */
    fun stop()
    val liveSample: StepSample?
}

/** 전경·화면 상태(§5-3 음성 게이트 입력). 게시 시점 실조회. */
interface GuideEnvironment {
    /** 앱 Activity가 STARTED인가. */
    fun isForeground(): Boolean

    /** 화면이 켜져 있는가(`PowerManager.isInteractive`). */
    fun isInteractive(): Boolean
}
