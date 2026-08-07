import Foundation

/// 안내 톤 오디오 세션의 **소유권 판정**(순수 함수). AVAudioSession 호출은 앱이 한다.
///
/// 세션은 프로세스 전역 자원이고 소비자가 셋(안내 톤·TTS `.playback`·받아쓰기
/// `.playAndRecord`)이다. "시작하면 승격, 끝나면 원복"만으로는 다른 소비자의
/// 카테고리를 파괴하므로 세 값을 든다: 원하는 카테고리(`desired`), 우리가 실제로
/// 승격했는가(`didPromote` = 원복 자격), 다른 소비자가 점유 중인가(`isSuppressed`).
///
/// **재조정(reconcile)이 이 모델의 심장이다.** suppression 해제·인터럽션 종료·route
/// 변경이 전부 같은 경로로 모이므로 "인터럽션 종료가 suppression 중에 도착해 영영
/// 복구 못 함"이 성립하지 않는다. 없으면 "받아쓰기 중 안내 시작"이 영구히 `.ambient`로
/// 남아 잠금 시 무음이 된다.
///
/// 앱이 아니라 여기 있는 이유: 앱 타깃 테스트 번들이 없어 `BeaconTonePlayer` 안에
/// 두면 이 계약에 변이 주입조차 할 수 없다(`beaconGateStep` 선례 동형).
///
/// 설계 정본: `docs/superpowers/specs/2026-08-08-background-tone-coverage-design.md` §3.2

public enum GuideAudioCategory: Sendable, Equatable {
    /// 세션 밖 기본값. **정의상 백그라운드에서 무음**이다.
    case ambient
    /// 안내 세션 중. 잠금·백그라운드에서도 소리가 나고 무음 스위치를 무시한다
    /// (무음 스위치 무시는 위원장이 수용한 트레이드오프 — 영향이 세션에 갇힌다).
    case playback
}

public enum GuideAudioEvent: Sendable, Equatable {
    case sessionStarted
    case sessionEnded
    /// 다른 소비자(받아쓰기·TTS)의 점유 여부 변화.
    case suppressionChanged(Bool)
    /// 인터럽션 종료(전화 등). 세션이 멎었으므로 되살려야 한다.
    case interrupted
    /// 출력 route 변경·media services reset. 플레이어 재생성이 필요하다.
    case routeChanged
    /// 세션 밖 단발 재생 직전의 세션 확보. **이것만 원복 자격 없이도 적용한다** —
    /// 종전 `ensureSession()`과 동형이라 회귀가 없고, 여기서 막으면 안내 세션 밖의
    /// 톤(설정 미리듣기 등)이 아예 나지 않는다.
    case ensureActive
}

public enum GuideAudioAction: Sendable, Equatable {
    case none
    /// 카테고리를 설정하고 활성화한다.
    case apply(GuideAudioCategory)
    /// 카테고리 적용 + **플레이어 재생성**(route 변경·media reset은 기존 플레이어를
    /// 무효화하므로 재사용하면 조용한 무음이 된다).
    case rebuild(GuideAudioCategory)
}

public struct GuideAudioSessionState: Sendable, Equatable {
    public var desired: GuideAudioCategory
    /// 우리가 `.playback`을 실제로 적용했는가. **원복 자격**이다 — 우리가 승격하지
    /// 않았다면 다른 소비자가 잡은 카테고리이므로 건드리면 그쪽이 깨진다.
    public var didPromote: Bool
    public var isSuppressed: Bool

    public static let initial = GuideAudioSessionState(
        desired: .ambient, didPromote: false, isSuppressed: false
    )
}

public func guideAudioStep(
    state: GuideAudioSessionState,
    event: GuideAudioEvent
) -> (state: GuideAudioSessionState, action: GuideAudioAction) {
    var next = state

    switch event {
    case .sessionStarted:
        next.desired = .playback
        return reconcile(next, rebuild: false)

    case .sessionEnded:
        next.desired = .ambient
        guard state.didPromote else { return (next, .none) }
        // ⚠ 억제 중이면 자격을 **유지한다**. 원복 자격은 "원복할 의무가 남아 있다"는
        // 뜻이라, 실제로 원복하기 전에 반납하면 억제가 풀려도 `.playback`이 그대로
        // 남는다(억제 해제 재조정이 우리 카테고리를 남의 것으로 오인한다).
        guard !next.isSuppressed else { return (next, .none) }
        next.didPromote = false
        return (next, .apply(.ambient))

    case let .suppressionChanged(suppressed):
        next.isSuppressed = suppressed
        // 억제 진입에는 아무것도 하지 않는다. 점유자의 카테고리를 되돌리면 진행 중인
        // 녹음 세션이 깨진다.
        guard !suppressed else { return (next, .none) }
        return reconcile(next, rebuild: false)

    case .interrupted:
        guard !next.isSuppressed, ownsSession(next) else { return (next, .none) }
        return reconcile(next, rebuild: false)

    case .routeChanged:
        guard !next.isSuppressed, ownsSession(next) else { return (next, .none) }
        return reconcile(next, rebuild: true)

    case .ensureActive:
        guard !next.isSuppressed else { return (next, .none) }
        return reconcile(next, rebuild: false)
    }
}

/// 우리가 이 세션의 주인인가. **안내가 돌지 않는 동안에는 공유 세션을 건드리지 않는다**
/// (스펙 §3.2 규칙 3). 이 가드가 없으면 route 변경 옵서버(신설)와 억제 해제가 세션 밖
/// 에서도 `.ambient`를 강제해, 온디바이스 TTS가 낭독 중인 카테고리를 바꿀 수 있다.
private func ownsSession(_ state: GuideAudioSessionState) -> Bool {
    state.desired == .playback || state.didPromote
}

/// 저장된 의도를 지금 적용한다. 억제 중이면 의도만 남기고 나중에 다시 지난다.
private func reconcile(
    _ state: GuideAudioSessionState, rebuild: Bool
) -> (state: GuideAudioSessionState, action: GuideAudioAction) {
    var next = state
    guard !next.isSuppressed else { return (next, .none) }
    // 자격은 지금 적용하는 카테고리를 따른다 — `.ambient`를 적용하는 순간이 곧
    // 원복을 마친 순간이다.
    next.didPromote = next.desired == .playback
    return (next, rebuild ? .rebuild(next.desired) : .apply(next.desired))
}
