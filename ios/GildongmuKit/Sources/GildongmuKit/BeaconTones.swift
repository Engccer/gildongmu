import Foundation

/// 실시간 길 안내 효과음 식별자.
///
/// 2026-08-03 위원장 청취 선정으로 **소리 정본이 합성 데이터에서 파일로 바뀌었다**:
/// 웹 `public/sounds/guide/<이름>.mp3` ↔ 앱 리소스 `guide-<이름>.mp3`(바이트 동일,
/// `sounds-drift.test.ts`가 강제). closer·farther는 종전 합성 음가(660↔990Hz 2음)를
/// 그대로 렌더한 파일이라 소리는 불변이고, 나머지 6종은 ElevenLabs 생성본이다.
/// 종전 `ToneStep`/`toneSteps` 합성 시퀀스는 이 전환으로 폐기됐다.
///
/// **의미 계약(불변)**: 가까워짐=상승, 멀어짐=하강, 도착=연타 종(마지막 바퀴 종 —
/// 여정 끝 1회), tick=아주 짧은 저자극 하트비트, 예고=가벼운 트릴(상세 안내에서
/// 결정 지점 40m 전 반복), 경고=낮은 이중음(이탈).
public enum BeaconTone: String, Sendable, Equatable, CaseIterable {
    case closer, farther, nearby, tick, start, stop, ahead, warning

    /// 앱 번들 리소스 파일명(확장자 제외). 웹 파일명과 1:1 대응.
    public var resourceName: String { "guide-\(rawValue)" }
}
