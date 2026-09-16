package space.dodoplanet.gildongmu.kit

/**
 * 진료 기관 종별(`NightClinic.kind`, NMC `dutyDivNam`)의 i18n 키. 웹 `src/lib/clinic-kind.ts` ↔ Kit
 * `ClinicKind.swift` 미러. 값이 두 종("의원"·"병원")뿐이라 사전이 아니라 키 둘이고, 그 밖은 null(원문 그대로).
 * 앱은 `clinicNearby.kind.<키>`를 리터럴로 조회한다(문자열 린터 계약).
 */
fun clinicKindKey(kind: String): String? = when (kind.trim()) {
    "의원" -> "clinic"
    "병원" -> "hospital"
    else -> null
}
