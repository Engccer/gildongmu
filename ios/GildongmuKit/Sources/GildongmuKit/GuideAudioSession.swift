import Foundation

/// 안내 톤 오디오 세션의 **소유권 판정**(순수 함수). AVAudioSession 호출은 앱이 한다.
///
/// 세션은 프로세스 전역 자원이고 소비자가 셋(안내 톤·TTS `.playback`·받아쓰기
/// `.playAndRecord`)이다. "시작하면 승격, 끝나면 원복"만으로는 다른 소비자의
/// 카테고리를 파괴하므로 세 값을 든다: 원하는 카테고리(`desired`), 우리가 실제로
/// 승격했는가(`didPromote` = 원복 자격), 다른 소비자가 점유 중인가(`isSuppressed`).
/// 여기에 2026-09-11(PORTS 세 구멍·E36)이 두 축을 더했다:
/// - **활성화 축 `isActive`**: 카테고리는 남았는데 세션만 죽은 상태(인터럽션 `.began`)를
///   표현한다. 없으면 "이미 `.playback`이니 잡은 것"으로 읽어 통화 뒤 죽은 세션 위에서
///   조용한 무음이 된다(dodo 관찰 ①의 gildongmu 경로 — `.ended` 유실 + `play()`의 재확보 조건).
/// - **소유권 이전 `.ownershipTransferred`**: 재생기 인스턴스가 둘(도보·대중교통)이고 원복을
///   재생 잔여만큼 미루므로, 인계(prewalk 도착 종 → 대중교통 시작 / E34 시작음 → 도보 시작)에서
///   먼저 끝난 쪽의 미뤄진 `.ambient`가 새 소유자의 `.playback` 위에 떨어진다. 그 원복 의무를
///   새 소유자에게 넘기는 이벤트다(세션은 건드리지 않는다).
///
/// **재조정(reconcile)이 이 모델의 심장이다.** suppression 해제·인터럽션 종료·route
/// 변경·카테고리 탈취가 전부 같은 경로로 모이므로 "인터럽션 종료가 suppression 중에 도착해
/// 영영 복구 못 함"이 성립하지 않는다. 없으면 "받아쓰기 중 안내 시작"이 영구히 `.ambient`로
/// 남아 잠금 시 무음이 된다.
///
/// 앱이 아니라 여기 있는 이유: 앱 타깃 테스트 번들이 없어 `BeaconTonePlayer` 안에
/// 두면 이 계약에 변이 주입조차 할 수 없다(`beaconGateStep` 선례 동형).
///
/// 설계 정본: `docs/superpowers/specs/2026-08-08-background-tone-coverage-design.md` §3.2,
/// 개정 `2026-09-11-transit-background-poll-design.md` §4.2.1·§4.3

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
    /// 인터럽션 시작(전화 등). 시스템이 세션을 비활성화했다 — 카테고리는 남고 활성만 빠진다.
    case interruptionBegan
    /// 인터럽션 종료(전화 등). 세션이 멎었으므로 되살려야 한다.
    case interrupted
    /// 출력 route 변경·media services reset. 플레이어 재생성이 필요하다.
    case routeChanged
    /// 다른 소비자가 카테고리·옵션을 갈아치웠다(자기 `setCategory`의 메아리는 **아니다** —
    /// 앱이 현재 값을 우리가 적용한 값과 대조해 가른다, `guideAudioRouteChangeEvent`).
    /// 카테고리 변경은 플레이어를 무효화하지 않으므로 재생성 없이 재적용만 한다.
    case categoryTakenOver
    /// 세션 밖 단발 재생 직전의 세션 확보. **이것만 원복 자격 없이도 적용한다** —
    /// 종전 `ensureSession()`과 동형이라 회귀가 없고, 여기서 막으면 안내 세션 밖의
    /// 톤(설정 미리듣기 등)이 아예 나지 않는다.
    case ensureActive
    /// 다른 재생기 인스턴스가 그 사이 세션을 시작했다. 우리의 원복 의무는 그쪽으로
    /// 넘어갔으므로 자격만 내려놓고 세션은 건드리지 않는다(앱이 전역 최신 소유자 토큰으로
    /// 판정해 `.sessionEnded` 대신 보낸다).
    case ownershipTransferred
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
    /// 불변식(리듀서 층, 전수 테스트): `didPromote == (마지막으로 낸 적용 동작의 카테고리 == .playback)`.
    public var didPromote: Bool
    public var isSuppressed: Bool
    /// 세션이 활성이라고 믿는가. `.apply`·`.rebuild`를 낼 때 참, 인터럽션 시작에 거짓.
    /// 소유권 이전 뒤에는 새 소유자가 활성화하므로 참으로 둔다.
    public var isActive: Bool

    public static let initial = GuideAudioSessionState(
        desired: .ambient, didPromote: false, isSuppressed: false, isActive: false
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
        next.isActive = true
        return (next, .apply(.ambient))

    case let .suppressionChanged(suppressed):
        next.isSuppressed = suppressed
        // 억제 진입에는 아무것도 하지 않는다. 점유자의 카테고리를 되돌리면 진행 중인
        // 녹음 세션이 깨진다.
        guard !suppressed else { return (next, .none) }
        return reconcile(next, rebuild: false)

    case .interruptionBegan:
        // 카테고리는 남고 활성만 빠진다. 여기서 재적용하지 않는다(인터럽션 중 활성화는
        // 실패한다). 다음 재생·인터럽션 종료·재조정이 되살린다.
        next.isActive = false
        return (next, .none)

    case .interrupted:
        guard !next.isSuppressed, ownsSession(next) else { return (next, .none) }
        return reconcile(next, rebuild: false)

    case .routeChanged:
        guard !next.isSuppressed, ownsSession(next) else { return (next, .none) }
        return reconcile(next, rebuild: true)

    case .categoryTakenOver:
        guard !next.isSuppressed, ownsSession(next) else { return (next, .none) }
        return reconcile(next, rebuild: false)

    case .ensureActive:
        guard !next.isSuppressed else { return (next, .none) }
        return reconcile(next, rebuild: false)

    case .ownershipTransferred:
        next.desired = .ambient
        next.didPromote = false
        next.isActive = true
        return (next, .none)
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
    // 원복을 마친 순간이다. ⚠ "이미 그 카테고리면 건너뜀" 단락 분기를 넣지 말 것 —
    // 인터럽션 뒤 카테고리는 남고 활성만 빠진 세션을 되살릴 유일한 경로다(PORTS ①).
    next.didPromote = next.desired == .playback
    next.isActive = true
    return (next, rebuild ? .rebuild(next.desired) : .apply(next.desired))
}

// === route 변경 사유 → 이벤트 (PORTS ③ 메아리 식별) ===

/// 앱이 `AVAudioSession.RouteChangeReason`을 이 둘로 접어 넘긴다(Kit은 AVFoundation 비의존).
public enum GuideAudioRouteChangeReason: Sendable, Equatable {
    /// `.categoryChange` — 누군가 카테고리를 바꿨다. 우리 자신일 수도(메아리), 남일 수도 있다.
    case categoryChange
    /// 그 밖(기기 착탈·override·wake 등) — 출력 경로가 실제로 바뀌었다.
    case other
}

/// `routeChangeNotification` 한 건을 이벤트로 접는다. `matchesApplied` = 통지 시점의 세션
/// 카테고리·옵션이 우리가 마지막으로 적용한 값과 같은가(앱이 읽어 넘긴다).
/// - `.categoryChange` ∧ 같음 → nil: 자기 `setCategory`의 메아리다. 종전엔 이것도 `.routeChanged`로
///   받아 세션 시작마다 플레이어를 한 번 더 재생성했고, 통지가 시작 톤 뒤에 오면 그 톤을 잘랐다.
/// - `.categoryChange` ∧ 다름 → `.categoryTakenOver`: 다른 소비자(채팅 TTS `duckOthers`)가 갈아치웠다.
///   전면 필터하면 이 회복 신호까지 사라진다(설계 리뷰 M5). 재생성 없이 재적용만.
/// - 그 밖 → `.routeChanged`(플레이어 재생성).
/// `mediaServicesWereResetNotification`은 reason이 없어 이 함수를 지나지 않고 `.routeChanged`다.
public func guideAudioRouteChangeEvent(
    reason: GuideAudioRouteChangeReason, matchesApplied: Bool
) -> GuideAudioEvent? {
    switch reason {
    case .categoryChange:
        return matchesApplied ? nil : .categoryTakenOver
    case .other:
        return .routeChanged
    }
}
