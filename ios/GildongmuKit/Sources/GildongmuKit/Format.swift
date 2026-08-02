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
    let snapped = Int((Double(meters) / 100).rounded()) * 100
    let km = snapped / 1000
    let rest = snapped % 1000
    return rest == 0 ? "\(km)km" : "\(km)km \(rest)m"
}

/// 첫 non-nil·non-empty 값 반환(웹 `||` 폴백 동형). 빈 문자열 조각이 트레일링 쉼표로
/// 낭독되는 것을 막는다.
func firstNonEmpty(_ values: String?...) -> String? {
    for value in values {
        if let value, !value.isEmpty { return value }
    }
    return nil
}
