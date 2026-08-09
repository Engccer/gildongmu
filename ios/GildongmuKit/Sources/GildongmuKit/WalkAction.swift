import Foundation

/// 도보 스텝 문장에서 **결정 지점의 행동**을 뽑아내는 순수 분류기(ko 전용) —
/// 웹 정본 `src/lib/walk-action.ts`의 1:1 미러. 공유 fixture(walk-action-cases.json)가
/// 동조를 강제한다.
///
/// 쓰임은 하나다: 결정 지점 10m 앞 임박 큐(`guideStep` 6b'')가 무엇을 말할지 고른다.
/// 분류가 없으면 큐 자체가 나가지 않으므로, **미분류의 결과는 오안내가 아니라 침묵**이다.
///
/// ⚠ **입력은 서버가 재작성한 문장이다**(`rewriteWalkGuidance`). 카카오 원문
/// "…왼쪽길로 107m 이동"은 앱에 도달하기 전에 "…왼쪽으로 돌아 …107m 이동"으로 바뀌어
/// 있고, 재작성이 미매칭 문장을 원문 그대로 통과시키므로 Tmap 폴백 문형("좌회전")도
/// 함께 받는다.
///
/// ⚠ **정규식이 아니라 부분 문자열로 판정한다.** 두 언어의 정규식 엔진·이스케이프는
/// 갈리지만 부분 문자열 포함은 같다. 문형이 단순해 정규식이 주는 것이 없다.
public enum WalkAction: String, Sendable, Equatable, CaseIterable {
    case left, right, crosswalk, underpass
}

/// **회전 표지가 건널목 표지보다 먼저다.** 회전 표지는 행동을 서술하는 동사구라 지명에
/// 섞일 수 없지만, "횡단보도"는 **지명의 일부로 등장한다** — 카카오 재작성 문장의
/// `{어디서}`·`{어디까지}` 자리가 그렇다. 건널목을 먼저 보면 "천호역 횡단보도에서
/// 왼쪽으로 돌아 40m 이동"이 crosswalk로 분류돼, 좌회전 지점에서 "잠시 후 횡단보도를
/// 건너세요"가 나간다.
///
/// 반대 방향의 오분류는 성립하지 않는다: 건널목 문장은 `… 이동, 횡단보도 이용` 꼴이고
/// 그 안에 회전 동사구가 들어갈 자리가 없다. Tmap "좌측 횡단보도 진입"의 "좌측"은 회전이
/// 아니라 어느 쪽 횡단보도인지를 뜻하므로 **애초에 마커가 아니다**(이 목록에 "좌측"·
/// "우측"이 없는 이유).
private let walkActionMarkers: [(String, WalkAction)] = [
    ("왼쪽으로 돌아", .left),
    ("오른쪽으로 돌아", .right),
    ("좌회전", .left),
    ("우회전", .right),
    ("횡단보도", .crosswalk),
    ("지하보도", .underpass),
]

/// 문장이 알리는 행동. 확실한 문형이 아니면 `nil`(임박 큐 미발화).
public func walkStepAction(_ description: String) -> WalkAction? {
    for (marker, action) in walkActionMarkers where description.contains(marker) {
        return action
    }
    return nil
}
