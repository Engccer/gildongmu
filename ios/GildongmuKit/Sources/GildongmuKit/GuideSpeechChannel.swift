import Foundation

// 백그라운드 음성 안내(E53, spec `docs/superpowers/specs/2026-09-30-background-speech-design.md`).
// 안내 문장이 어느 채널로 나가는가(§2)와 문장이 어느 분류인가(§3)의 판정. 앱은 게시 시점에 이 함수를
// 부르기만 한다 — 판정을 앱에 흩으면 정식판 불변(§1)을 테스트로 잠글 자리가 없다.

/// 문장 분류(spec §3.1). 백그라운드에서 말하는가를 가른다.
public enum GuideSpeechClass: String, Sendable, CaseIterable {
    /// 행동을 바꾸는 문장 — 예고·임박·이탈(회차 시작)·복귀·도착·1회성 경고·시작·직접 응답.
    case actionable
    /// 주기·상태·사후 정리 — 백그라운드에서는 효과음과 전경 복귀 상환이 맡는다.
    case deferrable
}

/// 게시 채널(spec §2).
public enum GuideSpeechChannel: String, Sendable, CaseIterable {
    /// VoiceOver 통지(`AccessibilityNotification.Announcement`).
    case voiceOver
    /// 기기 음성(`AVSpeechSynthesizer`) — 대기 칸(`DeviceSpeechQueue`)을 지난다.
    case device
    /// 게시하지 않는다 — 호출부가 상환 장부(`missedAnnouncement`·`onDropped`)를 세운다.
    case drop
}

/// 채널 선택 술어(spec §2). 인자는 전부 기본값이 없다(안전 인자 — 생략이 컴파일을 통과하면 조용한 결함이 된다).
///
/// - `foregroundDeviceSpeech`: 전경 ∧ VoiceOver 꺼짐에서도 기기 음성으로 낼 것인가. 나들이만 참이다(나들이 spec §7.3).
///   도보·자동차·대중교통은 거짓 — 그 경우 종전처럼 VoiceOver 통지 게시다(듣는 사람이 없으면 무발화).
/// - `backgroundSpeechEnabled`: 토글 실효값(`BackgroundSpeech.isEnabled`). 정식판에서는 상수 거짓이고, 그 값에서
///   이 함수는 종전 "전경이면 게시, 백그라운드면 버림"과 같다(테스트가 전수로 잠근다).
/// - `backgroundAudible`: 지금 백그라운드에서 소리가 나는가(그 모델 재생기의 `isBackgroundAudible`). 승격 실패·지연이면
///   기기 음성도 들리지 않으므로 버림으로 판정한다 — "전달"로 치면 1회성 경고 latch와 복귀 상환이 들리지 않은 문장에
///   소비된다(설계 리뷰 B1).
///
/// ⚠ 자동차 운전자 채널은 이 술어 위에 있다 — `BeaconModel.post`가 먼저 기기 음성으로 낸다(spec §2).
public func guideSpeechChannel(
    foreground: Bool,
    voiceOverRunning: Bool,
    speechClass: GuideSpeechClass,
    backgroundSpeechEnabled: Bool,
    backgroundAudible: Bool,
    foregroundDeviceSpeech: Bool
) -> GuideSpeechChannel {
    if foreground {
        if voiceOverRunning { return .voiceOver }
        return foregroundDeviceSpeech ? .device : .voiceOver
    }
    return backgroundSpeechEnabled && backgroundAudible && speechClass == .actionable ? .device : .drop
}

/// 토글 "백그라운드 음성 안내"(spec §6). 키·기본값·실효값의 정본.
public enum BackgroundSpeech {
    public static let storageKey = "backgroundSpeechEnabled"
    /// 기본값 켬(위원장 판정 2026-09-30).
    public static let defaultEnabled = true

    /// 실효값 = 이 구성에서 쓸 수 있는가 ∧ 저장값(없으면 기본값). `available`은 실험 구성 플래그
    /// (`AppConfig.experimentalBackgroundSpeechEnabled`) — 정식판에서는 거짓이라 저장값과 무관하게 거짓이다.
    public static func isEnabled(stored: Bool?, available: Bool) -> Bool {
        available && (stored ?? defaultEnabled)
    }
}

/// 도보·자동차 경로 이벤트의 문장 분류(spec §3.2). 이벤트 기본 문장의 분류이고, 호출부가 문장을 더 붙이면
/// (자동차 재획득의 현재 구간 전문) 호출부가 밝힌다.
/// - `offRouteEpisodeStart`: 이탈 확정 회차의 첫 통지인가. 재통지(walk 60초·car 180초)는 주기라 거짓이면 `.deferrable`.
public func guideEventSpeechClass(_ event: GuideEvent, offRouteEpisodeStart: Bool) -> GuideSpeechClass {
    switch event {
    case .announceSteps, .imminent, .farNotice, .waypointReached, .waypointApproaching, .backOnRoute:
        return .actionable
    case .offRoute:
        return offRouteEpisodeStart ? .actionable : .deferrable
    case .bundleReread, .periodic, .uncertainEnter, .uncertainExit, .reacquiring, .reacquired, .speedSuggest,
         .finalApproachEnter:
        // `finalApproachEnter`·`speedSuggest`는 문장을 내지 않는다(진입 서술은 fix를 쥔 자리가 낸다) — 분류만 닫는다.
        return .deferrable
    }
}

/// 간략 안내(직선거리) 비콘 통지의 분류(spec §3.2). `nearby`만 도착 신호다.
public func beaconNoticeSpeechClass(_ notice: BeaconNotice) -> GuideSpeechClass {
    switch notice {
    case .nearby: return .actionable
    case .first, .closer, .farther, .weak: return .deferrable
    }
}

/// 대중교통 이벤트의 분류(spec §3.3). 사다리(잔여 ≥2)·상태 문장은 주기·상태, 잔여 ≤1·임박·도착·국면 전이·
/// 1회성 행동 문장은 행동 문장이다. `trackingStarted`는 백그라운드 톤이 있는 유일한 이벤트라(E36) 그 톤이 자리를 맡는다.
public func transitEventSpeechClass(_ event: TransitGuideEvent) -> GuideSpeechClass {
    switch event {
    case let .approaching(remaining, _, _):
        return (remaining ?? .max) <= 1 ? .actionable : .deferrable
    case let .countdown(remaining, _, _, _, _, _):
        return remaining <= 1 ? .actionable : .deferrable
    case .vehicleSelected, .vehiclePassed, .arrivingAtBoardStop, .arrivingAtAlightStop, .boarded, .arrived,
         .legAdvanced, .neverSeen:
        return .actionable
    case .trackingStarted, .messageChanged, .backOnTrack, .approxVehicleChanged, .signalLost, .upstreamFailed,
         .signalRecovered, .boardingReset, .capSlowed:
        return .deferrable
    }
}

/// 세션 종료 뒤 오디오 원복을 미루는 다리(초, spec §7). 종료·도착 문장은 `stop()` 뒤에 톤 뒤 발화(간격 0.15초)를 거쳐
/// 게시되는데 원복도 톤 잔여 + 0.15초에 떨어져 경합한다 — 이 다리가 문장이 말하기 시작할 때까지 원복을 붙들고, 그 뒤는
/// `BeaconTonePlayer.endSession`의 발화 대기(말하는 동안·대기 칸이 찬 동안 원복하지 않는다)가 잇는다.
/// 문장 길이로 어림하지 않는다 — 어림은 앞 문장이 길면 모자란다(설계 리뷰 M4).
public let deviceSpeechEndBridgeSeconds = 1.0
/// 발화 대기의 상한(초). 기기 음성이 끝나지 않는 이상 상황에서도 세션 카테고리가 영영 `.playback`에 남지 않게 한다.
public let deviceSpeechEndWaitMaxSeconds = 20.0
