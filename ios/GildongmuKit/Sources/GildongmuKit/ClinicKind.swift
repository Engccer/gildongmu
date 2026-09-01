import Foundation

/// 진료 기관 종별(`NightClinic.kind`, NMC `dutyDivNam`)의 i18n 키 — 웹 `src/lib/clinic-kind.ts` 미러.
/// 값이 두 종("의원"·"병원")뿐이라 사전이 아니라 키 둘이고, 그 밖은 nil(원문 그대로).
/// 앱은 `clinicNearby.kind.<키>`를 리터럴로 조회한다(xcstrings 린터 계약).
public func clinicKindKey(_ kind: String) -> String? {
    switch kind.trimmingCharacters(in: .whitespacesAndNewlines) {
    case "의원": return "clinic"
    case "병원": return "hospital"
    default: return nil
    }
}
