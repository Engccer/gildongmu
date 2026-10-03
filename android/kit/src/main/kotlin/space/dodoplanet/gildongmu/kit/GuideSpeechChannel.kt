package space.dodoplanet.gildongmu.kit

// 백그라운드 음성 안내(E53, spec `docs/superpowers/specs/2026-09-30-background-speech-design.md`). Kit `GuideSpeechChannel.swift` 미러.
// 안내 문장이 어느 채널로 나가는가(§2)와 문장이 어느 분류인가(§3)의 판정. 앱은 게시 시점에 이 함수를 부르기만 한다 — 판정을 앱에 흩으면
// 정식판 불변(§1)을 테스트로 잠글 자리가 없다.

/** 문장 분류(spec §3.1). 백그라운드에서 말하는가를 가른다. */
enum class GuideSpeechClass {
    /** 행동을 바꾸는 문장 — 예고·이탈(회차 시작)·복귀·도착·1회성 경고·시작·직접 응답. */
    actionable,

    /**
     * 시간에 묶인 행동 문장(도보·자동차 임박 명령 "잠시 후 …"). 채널은 `actionable`과 같고, 기기 음성에서는 말하는 중인 안내를 기다리지 않고
     * 선점한다 — 전문 뒤에 줄 서면 회전 지점을 지나서 나온다.
     */
    urgent,

    /** 주기·상태·사후 정리 — 백그라운드에서는 효과음과 전경 복귀 상환이 맡는다. */
    deferrable;

    val rawValue: String get() = name
}

/** 게시 채널(spec §2). */
enum class GuideSpeechChannel {
    /** iOS: VoiceOver 통지. 안드로이드: 전경 직접 발화(안내 TTS `QUEUE_FLUSH` — 안내 문장 채널이 TTS 하나라 접근성 통지가 없다). */
    voiceOver,

    /** 기기 음성 — 대기 칸(`DeviceSpeechQueue`)을 지난다. */
    device,

    /** 게시하지 않는다 — 호출부가 상환 장부(`missedAnnouncement`·`onDropped`)를 세운다. */
    drop;

    val rawValue: String get() = name
}

/**
 * 채널 선택 술어(spec §2). 인자는 전부 기본값이 없다(안전 인자 — 생략이 컴파일을 통과하면 조용한 결함이 된다).
 *
 * - `foregroundDeviceSpeech`: 전경 ∧ VoiceOver 꺼짐에서도 기기 음성으로 낼 것인가. 나들이만 참이다.
 * - `backgroundSpeechEnabled`: 토글 실효값(`BackgroundSpeech.isEnabled`). 거짓이면 이 함수는 종전 "전경이면 게시, 백그라운드면 버림"과 같다.
 * - `backgroundAudible`: 지금 백그라운드에서 소리가 나는가. 들리지 않는데 "전달"로 치면 1회성 경고 latch와 복귀 상환이 들리지 않은 문장에
 *   소비된다(설계 리뷰 B1). 안드로이드는 미디어 볼륨 0이 아닌가(M4가 정한 iOS `isBackgroundAudible`의 대체 축).
 */
fun guideSpeechChannel(
    foreground: Boolean,
    voiceOverRunning: Boolean,
    speechClass: GuideSpeechClass,
    backgroundSpeechEnabled: Boolean,
    backgroundAudible: Boolean,
    foregroundDeviceSpeech: Boolean,
): GuideSpeechChannel {
    if (foreground) {
        if (voiceOverRunning) return GuideSpeechChannel.voiceOver
        return if (foregroundDeviceSpeech) GuideSpeechChannel.device else GuideSpeechChannel.voiceOver
    }
    if (!backgroundSpeechEnabled || !backgroundAudible) return GuideSpeechChannel.drop
    // 망라 when — 새 분류가 생기면 백그라운드에서 말할지가 컴파일 단계에서 판정되게 한다(부정 비교는 fail-open).
    return when (speechClass) {
        GuideSpeechClass.actionable, GuideSpeechClass.urgent -> GuideSpeechChannel.device
        GuideSpeechClass.deferrable -> GuideSpeechChannel.drop
    }
}

/** 토글 "백그라운드 음성 안내"(spec §6). 키·기본값·실효값의 정본. */
object BackgroundSpeech {
    const val storageKey = "backgroundSpeechEnabled"

    /** 기본값 켬(위원장 판정 2026-09-30). */
    const val defaultEnabled = true

    /** 실효값 = 저장값(없으면 기본값). */
    fun isEnabled(stored: Boolean?): Boolean = stored ?: defaultEnabled
}

/**
 * 도보·자동차 경로 이벤트의 문장 분류(spec §3.2). 이벤트 기본 문장의 분류이고, 호출부가 문장을 더 붙이면 호출부가 밝힌다.
 * 이탈은 회차의 첫 발화(`firstSpoken` — 보류 뒤 첫 발화 포함, E63)만 행동 문장이고 재통지는 주기라 `deferrable`이다.
 */
fun guideEventSpeechClass(event: GuideEvent): GuideSpeechClass = when (event) {
    is GuideEvent.Imminent -> GuideSpeechClass.urgent
    is GuideEvent.AnnounceSteps, is GuideEvent.FarNotice, GuideEvent.WaypointReached, is GuideEvent.WaypointApproaching, is GuideEvent.BackOnRoute ->
        GuideSpeechClass.actionable
    is GuideEvent.OffRoute -> if (event.firstSpoken) GuideSpeechClass.actionable else GuideSpeechClass.deferrable
    // `FinalApproachEnter`·`SpeedSuggest`는 문장을 내지 않는다(진입 서술은 fix를 쥔 자리가 낸다) — 분류만 닫는다.
    is GuideEvent.BundleReread, is GuideEvent.Periodic, GuideEvent.UncertainEnter, GuideEvent.UncertainExit, GuideEvent.Reacquiring,
    GuideEvent.Reacquired, GuideEvent.SpeedSuggest, GuideEvent.FinalApproachEnter, is GuideEvent.RerouteNeeded -> GuideSpeechClass.deferrable
}

/** 간략 안내(직선거리) 비콘 통지의 분류(spec §3.2). `Nearby`만 도착 신호다. */
fun beaconNoticeSpeechClass(notice: BeaconNotice): GuideSpeechClass = when (notice) {
    is BeaconNotice.Nearby -> GuideSpeechClass.actionable
    is BeaconNotice.First, is BeaconNotice.Closer, is BeaconNotice.Farther, BeaconNotice.Weak -> GuideSpeechClass.deferrable
}

/**
 * 대중교통 이벤트의 분류(spec §3.3). 사다리(잔여 ≥2)·상태 문장은 주기·상태, 잔여 ≤1·임박·도착·국면 전이·1회성 행동 문장은 행동 문장이다.
 * `TrackingStarted`는 백그라운드 톤이 있는 유일한 이벤트라 그 톤이 자리를 맡는다.
 */
fun transitEventSpeechClass(event: TransitGuideEvent): GuideSpeechClass = when (event) {
    is TransitGuideEvent.Approaching -> if ((event.remaining ?: Int.MAX_VALUE) <= 1) GuideSpeechClass.actionable else GuideSpeechClass.deferrable
    is TransitGuideEvent.Countdown -> if (event.remaining <= 1) GuideSpeechClass.actionable else GuideSpeechClass.deferrable
    is TransitGuideEvent.VehicleSelected, TransitGuideEvent.VehiclePassed, TransitGuideEvent.ArrivingAtBoardStop,
    TransitGuideEvent.ArrivingAtAlightStop, is TransitGuideEvent.Boarded, is TransitGuideEvent.Arrived, is TransitGuideEvent.LegAdvanced,
    TransitGuideEvent.NeverSeen -> GuideSpeechClass.actionable
    is TransitGuideEvent.TrackingStarted, is TransitGuideEvent.MessageChanged, is TransitGuideEvent.BackOnTrack,
    is TransitGuideEvent.ApproxVehicleChanged, TransitGuideEvent.SignalLost, TransitGuideEvent.UpstreamFailed, TransitGuideEvent.SignalRecovered,
    TransitGuideEvent.BoardingReset, TransitGuideEvent.CapSlowed -> GuideSpeechClass.deferrable
}

/**
 * 세션 종료 뒤 오디오 원복을 미루는 다리(초, spec §7). iOS 재생기의 카테고리 원복용이다 — 안드로이드는 오디오 포커스를 발화 단위로 쥐고
 * 완료 콜백에서 반납하므로 쓰지 않는다(미러 완결을 위해 둔다).
 */
const val deviceSpeechEndBridgeSeconds = 1.0

/** 발화 대기의 상한(초, iOS 원복 전용 — 위와 같다). */
const val deviceSpeechEndWaitMaxSeconds = 20.0
