package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import space.dodoplanet.gildongmu.directions.Strings
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.DeviceSpeechDrop
import space.dodoplanet.gildongmu.location.LocationPermission

// [3] 실행 계층 포트(spec 2026-09-16-android-m4 §2·§3). `WalkGuideModel`은 이 인터페이스만 보고, 실구현은 플랫폼 API
// (`GuideForegroundService`·`GuideTonePlayer`·`GuideSpeaker`·`ResultHaptic`·`AndroidStepCounter`)이며 JVM 테스트는 페이크를 쓴다.
// 판정은 전부 :kit 순수 함수이고 여기는 "실제로 하는 곳"과의 경계다(D5).

/**
 * 전경 서비스 손잡이(두 모델이 한 인스턴스를 공유한다). 시작 실패는 여기서 던져지지 않는다 — 서비스 안의 `startForeground` 실패와 Android 12+의 동기
 * 시작 거부(`startForegroundService` 예외)를 모두 같은 세대의 `GuideServiceOwner.onServiceStartFailed`로 되부른다(M4 §4-1, M5 §6-4).
 *
 * 세대(M5 §6-4): 모델은 시작마다 [nextGeneration]으로 세대를 받아 `serviceGeneration`으로 들고 [start]에 넘긴다. 서비스의 다섯 경로(fix·위치 꺼짐·알림 문장·
 * 알림 「안내 종료」·시작 실패)는 그 세대를 싣고 돌아오고 `GuideSession`이 지금 소유자의 세대와 같을 때만 전달한다 — 인계 직후 앞 세션의 늦은 이벤트가 새
 * 세션을 끝내지 않게. 발급을 공유 인스턴스 하나에 둔 것은 두 모델이 한 단조 수열을 쓰게 하려는 것이다(spec은 `GuideSession.nextServiceGeneration`).
 */
interface GuideForegroundController {
    fun nextGeneration(): Int
    fun start(generation: Int)

    /** 그 세대의 서비스를 내린다. 서비스가 이미 더 새 세대로 넘어갔으면 아무것도 하지 않는다(앞 세션의 늦은 정지가 새 세션의 서비스를 내리지 않게). */
    fun stop(generation: Int)
}

/**
 * 전경 서비스가 말을 거는 세션 쪽(M5 §6-4) — 도보·자동차(`WalkGuideModel`)와 대중교통(`TransitGuideModel`)이 구현한다. 서비스는 소유자를 붙들지 않고
 * 매 콜백 시점에 `GuideSession.serviceOwner()`로 고른다.
 */
interface GuideServiceOwner {
    /** 서비스가 열 위치 스트림의 모양. null = 서비스가 필요 없다. 바뀌면 서비스가 스트림을 다시 연다. */
    val locationProfile: StateFlow<GuideLocationProfile?>

    /** 지금 상태의 알림 (제목, 본문). 알림을 낼 상태가 아니면 null(도보는 추적 아님, 대중교통은 keep-alive 가동 아님 — 세션이 이어져도 서비스가 내려가면 null). 서비스는 [notificationChanges]마다 다시 읽고 `distinctUntilChanged`만 한다. */
    fun notificationText(strings: Strings): Pair<String, String>?

    /** 알림 문장이 바뀔 수 있는 상태 변화 신호(관찰 상태 그대로). */
    val notificationChanges: Flow<*>
    fun handleServiceFix(fix: GuideFixPayload)
    fun handleProviderDisabled()

    /** 알림 「안내 종료」 = 시트의 안내 종료와 같은 함수(정지음 + 정지 문장). */
    fun stopFromNotification()

    /** 이 소유자의 그 세대 시작이 거부됐다. 세대가 지금 든 세대와 다르면 무시한다. */
    fun onServiceStartFailed(generation: Int, error: Throwable)

    /** 이 모델이 지금 쥔 서비스 요청의 세대(없으면 null). */
    val serviceGeneration: Int?
}

/**
 * 전경 서비스가 요청받는 위치 스트림의 모양(M5 spec §6-4). `beacon` = 도보·자동차(1초·고정밀), `keepAlive` = 대중교통 boarding·riding의 프로세스 유지용
 * 저전력 스트림(60초·500m), `keepAliveBus` = 버스 승차 중 정류장 표식(E48, 고정밀·1초·거리 필터 없음). 대중교통 모델은 원하는 프로파일을
 * `keepAliveWanted`로 내보내기만 하고, 서비스를 켜고 끄는 것은 단계 4(`GuideServiceOwner`)다.
 */
enum class GuideLocationProfile { beacon, keepAlive, keepAliveBus }

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

    /** 게시 시도 → 발화 토큰. 포커스를 못 잡거나 엔진이 없으면 null(호출부가 `onDropped`·상환을 판정한다). */
    fun speak(text: String, highPriority: Boolean): Int?

    /** 현재 앱 언어를 이 기기 TTS가 지원하지 않는다(시트 행 + 진동 1회). */
    val isUnavailable: Boolean

    /** 안내 문장이 말하는 중인가(보류 포함) — 끝은 발화 완료 콜백(E57 착지 대기). */
    val isSpeaking: Boolean

    /** 말하는 안내를 끊는다(알리지 않는 정지 — 전경 복귀 인계만 부르고, 끊은 문장은 인계 목록이 처리한다). */
    fun stop()

    /** 그 토큰의 문장이 아직 엔진에 있는가(말하는 중·보류). E53 대기 칸이 "지금 이 칸의 문장"을 가른다. */
    fun isSpeakingToken(token: Int): Boolean

    /** 끝나지 않은 발화가 다른 발화에 끊기거나(superseded) 보류 문장이 버려졌다(undelivered) — 대기 칸이 그 문장의 버림을 통지한다. */
    var onInterrupted: ((token: Int, reason: DeviceSpeechDrop) -> Unit)?
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

/** 전경 상태(음성 채널 입력, E53 — 잠금·다른 앱은 같은 백그라운드다). 게시 시점 실조회. */
interface GuideEnvironment {
    /** 앱 Activity가 STARTED인가. */
    fun isForeground(): Boolean
}
