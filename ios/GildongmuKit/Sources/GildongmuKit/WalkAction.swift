import Foundation

/// 결정 지점 행동(웹 `WalkAction` 미러). 값은 **서버가 투영한다**(E16 축3, 2026-08-23):
/// 도보는 `WalkRouteStep.action`(카카오 스텝은 서버가 최종 문장을 분류, Tmap 스텝은 turnType 표),
/// 자동차는 `CarAction`(turnType 표). Kit은 문장을 분류하지 않는다 — 종전 ko 부분 문자열
/// 분류기(`walkStepAction`)는 호출자가 사라져 2026-09-02에 지웠고, 웹 정본
/// `src/lib/walk-action.ts`는 서버에서 계속 쓰인다(삭제 대상 아님).
///
/// 쓰임은 둘이다: 결정 지점 임박 큐(`guideStep` 6a)가 무엇을 말할지 고르고, 하단 2행
/// (`buildDisplayUnits`)이 유닛 경계를 나눈다. 행동이 없으면 큐는 나가지 않는다 —
/// **미투영의 결과는 오안내가 아니라 침묵**이다.
public enum WalkAction: String, Sendable, Equatable, CaseIterable {
    case left, right, back, crosswalk, underpass
    /// 자동차 갈래 선택(K2 spec §3.1) — 서버 `turnType` 투영(`CarAction`)으로만 들어온다.
    case keepLeft, keepRight
}

/// 수단 중립 별칭(웹 `GuideAction` 미러).
public typealias GuideAction = WalkAction

/// 결정 지점 임박 큐의 **소리**. 행동별로 가른다(N2, 2026-08-22 위원장 판정: 횡단보도·
/// 왼쪽·오른쪽·뒤로 돌기·그 외). 백그라운드·잠금에서는 문장이 나가지 않으므로 이 소리가
/// 다음 행동을 알리는 유일한 채널이다. `underpass`는 "그 외"다 — 횡단보도 비프는
/// 음향신호기의 인용이라 지하보도에 붙이면 거짓 인용이 된다.
/// 웹 `imminentTone` 미러. 소리 정본은 `scripts/build-guide-tones.py`.
public func imminentTone(_ action: WalkAction) -> GuideTone {
    switch action {
    case .crosswalk: .crosswalk
    case .left: .left
    case .right: .right
    case .back: .back
    case .underpass: .ahead
    // 갈래 선택은 회전과 같은 소리(소리 5종 유지 — N2 판정).
    case .keepLeft: .left
    case .keepRight: .right
    }
}
