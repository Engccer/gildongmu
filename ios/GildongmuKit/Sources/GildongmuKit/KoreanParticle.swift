import Foundation

/// 한국어 조사 판정(순수 함수, ko 전용). 웹 `src/lib/korean-particle.ts` 미러 —
/// 표 대조는 `KoreanParticleTests`가 강제한다.
///
/// 한국어 조사는 앞 글자의 받침 유무로 갈린다(`강동구청이`/`이마트가`,
/// `성내로를`/`양재대로116길을`). 낭독 문장을 우리가 만드는 이상 이 판정을 피할 수
/// 없다 — 종전에는 조사를 아예 쓰지 않고 쉼표로 잇는 방식으로 우회했는데, 그 결과
/// "강동구청, 왼쪽 약 16m"처럼 관계를 듣는 사람이 복원해야 하는 명사구 나열이
/// 나갔다(위원장 판정 2026-08-09).
///
/// ⚠ **한글이 아니면 `nil`이다.** 영문·숫자·기호로 끝나는 고유명사는 읽는 법이
/// 정해지지 않아 받침을 알 수 없다. 호출자는 `nil`을 받으면 **그 자리의 조사 삽입만
/// 포기**하고 조사 없이도 문법적인 형태로 물러난다.
public enum KoreanParticle {
    private static let hangulFirst: UInt32 = 0xAC00
    private static let hangulLast: UInt32 = 0xD7A3
    private static let jongseongCount: UInt32 = 28

    /// 마지막 글자에 받침이 있는가. 한글 음절이 아니면 `nil`.
    ///
    /// 한글 음절은 `0xAC00 + (초성 × 21 + 중성) × 28 + 종성`으로 배열되므로
    /// 종성 인덱스는 `(scalar - 0xAC00) % 28`이고 0이면 받침이 없다.
    ///
    /// ⚠ `last`가 아니라 **마지막 유니코드 스칼라**를 본다 — Swift의 Character는
    /// 자모 결합·이모지 변형 선택자를 한 글자로 묶으므로 스칼라 단위가 정본이다.
    public static func hasFinalConsonant(_ word: String) -> Bool? {
        guard let scalar = word.unicodeScalars.last else { return nil }
        let value = scalar.value
        guard value >= hangulFirst, value <= hangulLast else { return nil }
        return (value - hangulFirst) % jongseongCount != 0
    }

    /// 주격 조사 `이`/`가`. 판정 불가면 `nil`.
    public static func subject(_ word: String) -> String? {
        guard let final = hasFinalConsonant(word) else { return nil }
        return final ? "이" : "가"
    }

    /// 목적격 조사 `을`/`를`. 판정 불가면 `nil`.
    public static func object(_ word: String) -> String? {
        guard let final = hasFinalConsonant(word) else { return nil }
        return final ? "을" : "를"
    }

    /// 주격 조사를 붙인 어절. 판정 불가면 `nil` — 호출자가 대체 문형을 고른다.
    public static func withSubject(_ word: String) -> String? {
        guard let particle = subject(word) else { return nil }
        return word + particle
    }
}
