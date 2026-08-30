import Foundation

/// 한 줄(한 접근성 객체)의 언어 선택 — 웹 `place-lines/pick-line.ts` 미러(E27 §3.6).
///
/// 한 줄 안에서 언어를 섞지 않는다: 영문 조각(`*En`)이 **전부** 있을 때만 영어 줄이고, 하나라도
/// 없으면 줄 전체를 한국어 원문으로 둔다. 필드 단위 optional로는 이 원자성을 보장할 수 없어 줄을
/// 만드는 모든 자리가 이 함수만 지난다. iOS 언어 태깅(`lang`)은 E28 실기기 판정 항목이라 여기서는
/// 문자열만 고른다.
public enum TransitDisplay {
    /// `isEn`이고 `enParts`가 전부 비어 있지 않으면 `build(enParts)`, 아니면 `ko`.
    public static func pickLine(
        isEn: Bool, ko: String, enParts: [String?], build: ([String]) -> String
    ) -> String {
        guard isEn else { return ko }
        let parts = enParts.compactMap { $0 }.filter { !$0.isEmpty }
        guard parts.count == enParts.count else { return ko }
        return build(parts)
    }

    /// 이름 하나 — 영문이 있으면 영문, 없으면 한국어.
    public static func pickName(isEn: Bool, ko: String, en: String?) -> String {
        pickLine(isEn: isEn, ko: ko, enParts: [en]) { $0[0] }
    }
}
