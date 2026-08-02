import Foundation

// 거리·문자열 포맷 헬퍼 — 여러 서비스·산문 빌더 공용.

/// 웹 `src/lib/format.ts` formatDistance 미러 — 단일 정본, 앱 로컬 사본 금지.
/// 1000m 미만은 "{m}m", 이상은 "{km}km" 또는 "{km}km {m}m". 단위 표기는 전 로케일 공통.
///
/// 소수 km("3.6km")를 쓰지 않는 이유는 낭독이다. VoiceOver가 "삼 점 육 킬로미터"로
/// 읽는 것보다 "3km 600m"가 짧다(위원장 실보행 피드백 2026-08-02).
///
/// ⚠ **100m 단위 반올림을 먼저 하고 나서 km과 나머지로 가른다.** 따로 반올림하면
/// 1,999m에서 나머지가 1,000으로 올라가 "1km 1000m"이 된다.
public func formatDistance(_ meters: Int) -> String {
    if meters < 1000 { return "\(meters)m" }
    // 1km 이상은 소수 km(위원장 지시 2026-08-02: 나눠쓰기 폐기, 원값 그대로
    // 후행 0 없이: 1.1km·10.6km·6.285km). ⚠ Swift의 String(Double)은 정수에
    // "1.0"을 남기므로 1,000의 배수만 정수 표기로 가른다.
    if meters % 1000 == 0 { return "\(meters / 1000)km" }
    return "\(Double(meters) / 1000)km"
}

/// 첫 non-nil·non-empty 값 반환(웹 `||` 폴백 동형). 빈 문자열 조각이 트레일링 쉼표로
/// 낭독되는 것을 막는다.
func firstNonEmpty(_ values: String?...) -> String? {
    for value in values {
        if let value, !value.isEmpty { return value }
    }
    return nil
}

/// 낭독 전용: 미터 약어를 로케일 단어로 풀어 쓴다(순수 변환, 단어는 주입).
///
/// iOS VoiceOver가 숫자 뒤 "m"을 meters가 아니라 **minutes로 낭독**하는 시스템
/// 버그 대응. 시각 표기는 `formatDistance` 원문("900m")을 유지하고, 이 결과는
/// `accessibilityLabel`에만 쓴다.
///
/// ⚠ **km는 치환하지 않는다**(위원장 실기기 확인 2026-08-02: "10.6km"류 소수
/// 포함 km 표기를 VO가 오류 없이 kilometers로 발화한다. 오독은 m뿐이다).
public func spokenDistanceUnits(_ text: String, meters: String) -> String {
    // ⚠ `\b`를 쓰지 않는다. ICU는 한글·한자를 word character로 보므로 "35m입니다"
    // 같은 CJK 직결 꼴에서 경계가 성립하지 않아 치환이 조용히 no-op이 된다
    // (리뷰 실측 2026-08-02: whereAmI 산문 "약 {distance}입니다"가 정확히 이 꼴).
    // 부정 전방탐색으로 "라틴 문자가 뒤따르지 않음"만 요구하면 "markets"·"mm"은
    // 계속 막히고 CJK·문장부호·공백·문자열 끝은 풀린다. "10.6km"의 m은 앞이
    // k라 애초에 매칭되지 않는다.
    text.replacingOccurrences(
        of: #"(\d)m(?![A-Za-z])"#, with: "$1 \(meters)", options: .regularExpression)
}
