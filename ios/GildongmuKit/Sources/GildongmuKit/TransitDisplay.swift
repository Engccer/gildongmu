import Foundation

/// 한 줄(한 접근성 객체)의 언어 선택 — 웹 `place-lines/pick-line.ts` 미러(E27 §3.6).
///
/// 한 줄 안에서 언어를 섞지 않는다: 영문 조각(`*En`)이 **전부** 있을 때만 영어 줄이고, 하나라도
/// 없으면 줄 전체를 한국어 원문으로 둔다. 필드 단위 optional로는 이 원자성을 보장할 수 없어 줄을
/// 만드는 모든 자리가 이 함수만 지난다. iOS 언어 태깅(`lang`)은 E28 실기기 판정 항목이라 여기서는
/// 문자열만 고른다.
public enum TransitDisplay {
    /// `isEn`이고 `enParts`에 nil이 없으면 `build(enParts)`, 아니면 `ko`. 빈 문자열은 "이 자리는 ko에도 없다"는
    /// 자리 표시라 부재가 아니다(웹 `pickLine`은 빈 문자열을 부재로 보므로 호출부가 `""` 대신 `undefined`를 쓴다 —
    /// 두 구현의 의미 차이는 호출 관례로 맞춘다: iOS는 `nil`=부재·`""`=자리 표시).
    public static func pickLine(
        isEn: Bool, ko: String, enParts: [String?], build: ([String]) -> String
    ) -> String {
        guard isEn else { return ko }
        let parts = enParts.compactMap { $0 }
        guard parts.count == enParts.count else { return ko }
        return build(parts)
    }
}
