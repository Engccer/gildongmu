import Foundation

/// 톤 뒤 발화 판정(spec 2026-08-14) — 웹 `src/lib/guide-speech-gate.ts` 미러
/// (웹 `guide-speech-gate.test.ts`의 드리프트 가드가 상수 동조를 강제).
///
/// 안내 효과음이 재생 중이면 그 소리가 끝난 뒤에 음성 통지를 게시한다 — 톤과 발화가
/// 같은 청각 채널이라 겹치면 스크린 리더 사용자는 문장 앞머리를 통째로 잃는다
/// (임박 큐 0.73초·도착 종 2.25초가 실사고).
///
/// ⚠ **판정 축은 톤 이름이 아니라 "지금 남은 재생 시간"이다.** 톤 이름 목록을 코드에
/// 두면 mp3를 교체할 때 조용히 어긋나지만, 실측 길이는 따라온다. 재생 직후의
/// remaining은 곧 톤 전체 길이라 0.6초 선이 톤 표를 정확히 가른다(§3 상수 근거 —
/// 단 이 성립 범위는 톤 직후 처음 짝지어진 통지까지다. 재생 도중 들어온 통지는
/// 잔여로만 판정하며, 꼬리 0.6초 미만과의 겹침을 수용하는 것이 의도다).
public enum SpeechDeferConstants {
    /// 이 미만의 잔여와는 겹쳐도 지연하지 않는다(짧은 톤·이미 끝나가는 꼬리).
    public static let speechDeferThresholdSeconds = 0.6
    /// 소리 꼬리와 발화가 붙지 않게 하는 여유(`BeaconTonePlayer.endSession` 동값).
    public static let speechDeferGapSeconds = 0.15
    /// 총 대기 상한(게시 직전 재평가 루프 포함) — 가장 긴 톤 2.246 + 여유.
    public static let speechDeferMaxSeconds = 3.0
}

/// 발화를 미룰 초. 0이면 즉시 게시.
///
/// ⚠ 상한은 잘라내기(clamp)이지 무효화가 아니다 — 초과를 0으로 만들면 3.000초는
/// 대기하고 3.001초는 즉시라는 역전이 생긴다(리뷰 MINOR 1). 비유한 값은 両인자 모두
/// 검사한다(리뷰 MINOR 2 — NaN은 나노초 정수 변환에서 trap).
public func speechDeferStep(now: Double, toneEndsAt: Double?) -> Double {
    guard let toneEndsAt, toneEndsAt.isFinite, now.isFinite else { return 0 }
    let remaining = toneEndsAt - now
    guard remaining >= SpeechDeferConstants.speechDeferThresholdSeconds else { return 0 }
    return min(
        remaining + SpeechDeferConstants.speechDeferGapSeconds,
        SpeechDeferConstants.speechDeferMaxSeconds)
}
