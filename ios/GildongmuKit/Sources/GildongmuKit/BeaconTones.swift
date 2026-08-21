import Foundation

/// 실시간 길 안내 효과음 식별자.
///
/// 2026-08-03 위원장 청취 선정으로 **소리 정본이 합성 데이터에서 파일로 바뀌었다**:
/// 웹 `public/sounds/guide/<이름>.mp3` ↔ 앱 리소스 `guide-<이름>.mp3`(바이트 동일,
/// `sounds-drift.test.ts`가 강제). closer·farther는 종전 합성 음가(660↔990Hz 2음)를
/// 그대로 렌더한 파일이라 소리는 불변이고, 나머지 6종은 ElevenLabs 생성본이다.
/// 종전 `ToneStep`/`toneSteps` 합성 시퀀스는 이 전환으로 폐기됐다.
///
/// **의미 계약**: 가까워짐=상승, 멀어짐=하강, 도착=연타 종(마지막 바퀴 종 — 여정 끝
/// 1회), **tick=정지**, 예고=가벼운 트릴(상세 안내에서 결정 지점 40m 전 반복),
/// 경고=낮은 이중음(이탈), **신뢰 불가=현재 안내를 믿을 수 없음**.
///
/// ⚠ **`tick`의 뜻이 2026-08-08에 바뀌었다.** 종전에는 간략에서 정체(`hold`) 신호,
/// 상세에서 무이벤트 fix마다 나는 생존 하트비트라는 **두 뜻**이었다. 사용자에게는
/// 같은 소리이므로 내부 구조가 밖으로 샌 것이었고, 데드밴드가 `max(15m, accuracy)`라
/// 도보에서는 tick이 지배적이고 차량에서는 거의 안 나 같은 소리가 수단에 따라 정반대
/// 빈도가 됐다. 지금은 도플러 속도로 판정한 **정지** 하나만 뜻한다(`GuideMotion`).
///
/// ⚠ **`unreliable`은 원인이 아니라 상태를 뜻한다.** 원인이 셋(GPS 정확도 불량·fix
/// 부재·경로 재획득)인데 사용자가 취할 행동은 같아서(기다리거나 하늘이 트인 곳으로
/// 이동) 소리를 나누면 학습 부담만 는다. 원인 구분은 전경 음성이 담당한다.
///
/// **결정 지점 행동 톤 4종(N2, 2026-08-22)**: 횡단보도=음향신호기식 비프 4연음×2,
/// 왼쪽·오른쪽=상승 2음 모티프(좌우 구분은 `LeftRightToneScheme`), 뒤로 돌기=하강
/// 글라이드 2회. `ahead`는 "그 외"(지하보도 등)로 남는다. 백그라운드·잠금에서 문장이
/// 나가지 않으므로 이 소리가 다음 행동을 알리는 유일한 채널이다. 소리 정본은
/// `scripts/build-guide-tones.py`(합성, 결정론 재생성).
public enum BeaconTone: String, Sendable, Equatable, CaseIterable {
    case closer, farther, nearby, tick, start, stop, ahead, crosswalk, left, right, back, warning, unreliable

    /// 앱 번들 리소스 파일명(확장자 제외). 웹 파일명과 1:1 대응.
    /// ⚠ `left`·`right`는 케이스가 행동이고 파일은 표현이라 scheme이 파일을 고른다.
    public func resourceName(_ scheme: LeftRightToneScheme) -> String {
        switch self {
        case .left: "guide-left-\(scheme.rawValue)"
        case .right: "guide-right-\(scheme.rawValue)"
        default: "guide-\(rawValue)"
        }
    }

    /// 리듀서 우선 톤 → 재생 톤. 이름이 같은 케이스끼리 1:1이며 변환은 여기 한 곳이다.
    public init(guide: GuideTone) {
        switch guide {
        case .ahead: self = .ahead
        case .crosswalk: self = .crosswalk
        case .left: self = .left
        case .right: self = .right
        case .back: self = .back
        case .warning: self = .warning
        }
    }
}

/// 왼쪽·오른쪽 톤의 구분 방식 — 실기기 선택 대기 중인 두 후보(spec
/// `2026-08-22-walk-tone-taxonomy-design.md` §3). 판정 뒤 패자와 이 타입을 지운다.
///
/// - `pan`: 같은 모티프를 좌·우 채널에 하드 패닝. 이어폰에서 직관적이지만 주머니 속
///   스피커·세로 방향 폰에서는 좌우가 거의 갈리지 않는다.
/// - `pitch`: 왼쪽=낮은 모티프, 오른쪽=높은 모티프(모노). 스피커에서도 성립하는 쪽이라
///   **기본값**이다.
public enum LeftRightToneScheme: String, Sendable, CaseIterable {
    case pan, pitch
    public static let storageKey = "leftRightToneScheme"
    public static let `default`: LeftRightToneScheme = .pitch
}
