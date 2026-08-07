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
public enum BeaconTone: String, Sendable, Equatable, CaseIterable {
    case closer, farther, nearby, tick, start, stop, ahead, warning, unreliable

    /// 앱 번들 리소스 파일명(확장자 제외). 웹 파일명과 1:1 대응.
    public var resourceName: String { "guide-\(rawValue)" }
}
