import Foundation

// 장소명 영문 병기 조립(E28) — 웹 `src/lib/bilingual-name.ts` 미러. 규칙은 공유 fixture
// `src/lib/__tests__/fixtures/bilingual-name-cases.json`이 못 박는다(`BilingualNameTests`).
// spec `docs/superpowers/specs/2026-08-31-place-name-bilingual-design.md` §4·§6.
//
// 위원장 판정(2026-08-31): 영문 원천 없는 이름은 한글 + 로마자(서버 `nameRoman`) 한 줄 괄호
// `Roman (한글)`, **접근 가능한 이름은 괄호 앞만**. 이 타입은 "무엇을 1순위로 보이고 무엇을
// 괄호에 넣는가"만 정한다 — 뷰는 `Text(display)`에 `.accessibilityLabel(Text(primary))`를 건다.

public struct BilingualName: Equatable, Sendable {
    /// 시각·낭독 모두의 1순위 이름. 병기하지 않으면 ko 원문.
    public let primary: String
    /// 괄호에 넣을 한글 원문. nil이면 병기 없음.
    public let secondary: String?

    public init(primary: String, secondary: String?) {
        self.primary = primary
        self.secondary = secondary
    }

    /// 시각 문자열 `Primary (한글)` — 병기 없으면 primary만.
    public var display: String {
        guard let secondary else { return primary }
        return "\(primary) (\(secondary))"
    }
}

/// 한글(음절·호환 자모)이 하나라도 있는가 — 웹 `hasHangul` 미러.
public func hasHangul(_ text: String) -> Bool {
    text.unicodeScalars.contains { scalar in
        (0x3131...0x318E).contains(scalar.value) || (0xAC00...0xD7A3).contains(scalar.value)
    }
}

/// 원천이 이미 `Latin (한글)` 병기 형태(TourAPI en `title`)면 라틴 선두가 primary, 괄호 안이 secondary다 —
/// 웹 `EMBEDDED_BILINGUAL`·서버 `romanNameOf` 게이트와 같은 정규식.
private let embeddedBilingual = try! NSRegularExpression(
    pattern: "^([^가-힣()]*[A-Za-z][^가-힣()]*?)\\s*\\(([^()]*[가-힣][^()]*)\\)\\s*$")

func parseEmbeddedBilingual(_ name: String) -> BilingualName? {
    let nfc = name.precomposedStringWithCanonicalMapping
    let range = NSRange(nfc.startIndex..., in: nfc)
    guard let m = embeddedBilingual.firstMatch(in: nfc, range: range),
          let r1 = Range(m.range(at: 1), in: nfc), let r2 = Range(m.range(at: 2), in: nfc) else { return nil }
    let primary = nfc[r1].trimmingCharacters(in: .whitespaces)
    guard !primary.isEmpty else { return nil }
    return BilingualName(primary: primary, secondary: nfc[r2].trimmingCharacters(in: .whitespaces))
}

/// 한글이 섞인 후보는 후보가 아니다 — 접근 가능한 이름에 한글이 새는 유일한 경로를 막는다.
private func latinCandidate(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty,
          !hasHangul(trimmed) else {
        return nil
    }
    return trimmed
}

/// 규칙(순서가 곧 우선순위):
/// 1. ko 언어 → 병기 없음(ko 화면은 byte-identical).
/// 2. 후보 = en 원천 → 로마자 → 없음(한글이 섞인 후보는 후보가 아니다). 없으면 한글 그대로.
/// 3. 한글이 없는 이름(`CU`)은 괄호가 잉여 — 후보만.
/// 4. 후보가 한글 원문과 같으면 병기 없음.
/// `lang`은 `AppLanguage.current`(ko 외 전부 영문 데이터, 웹 `prefersEnglish` 동형).
public func bilingualName(lang: String, ko: String, en: String?, roman: String?) -> BilingualName {
    if lang == "ko" { return BilingualName(primary: ko, secondary: nil) }
    if let embedded = parseEmbeddedBilingual(ko) { return embedded }
    guard let candidate = latinCandidate(en) ?? latinCandidate(roman) else {
        return BilingualName(primary: ko, secondary: nil)
    }
    if !hasHangul(ko) { return BilingualName(primary: candidate, secondary: nil) }
    let koKey = ko.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
    if candidate.precomposedStringWithCanonicalMapping == koKey {
        return BilingualName(primary: ko, secondary: nil)
    }
    return BilingualName(primary: candidate, secondary: ko)
}
