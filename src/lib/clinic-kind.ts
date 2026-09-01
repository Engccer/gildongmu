/**
 * 진료 기관 종별(`NightClinic.kind`, NMC `dutyDivNam`)의 i18n 키(E28 후속, 2026-09-02).
 * Kit `ClinicKind.swift` 미러 — 값이 두 종("의원"·"병원")뿐이라 사전이 아니라 키 둘이다.
 *
 * 그 밖의 값(종합병원·보건소 등 — 명부에 드물게 섞인다)은 null이고 소비자는 원문 + `lang="ko"`로
 * 떨어진다. 카카오 분류(A28)와 다른 층이라 `kakaoCategoryEn`을 태우지 않는다. 문자열 필드 `kind`는
 * CLI/MCP 계약이라 불변이고 이 함수는 표시 계층만 쓴다.
 */
export function clinicKindKey(kind: string): "clinic" | "hospital" | null {
  switch (kind.trim()) {
    case "의원":
      return "clinic";
    case "병원":
      return "hospital";
    default:
      return null;
  }
}
