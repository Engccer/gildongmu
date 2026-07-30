import Foundation

// 거리·문자열 포맷 헬퍼 — 여러 서비스·산문 빌더 공용.

/// 웹 `src/lib/format.ts` formatDistance 미러 — 단일 정본, 앱 로컬 사본 금지.
/// 1000m 미만은 "{m}m", 이상은 소수 첫째자리 "{km}km". 단위 표기는 전 로케일 공통(로케일 무관).
public func formatDistance(_ meters: Int) -> String {
    if meters < 1000 { return "\(meters)m" }
    return String(format: "%.1fkm", Double(meters) / 1000)
}

/// 첫 non-nil·non-empty 값 반환(웹 `||` 폴백 동형). 빈 문자열 조각이 트레일링 쉼표로
/// 낭독되는 것을 막는다.
func firstNonEmpty(_ values: String?...) -> String? {
    for value in values {
        if let value, !value.isEmpty { return value }
    }
    return nil
}
