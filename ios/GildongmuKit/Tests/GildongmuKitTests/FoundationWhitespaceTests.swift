import Foundation
import Testing

/// Foundation `CharacterSet` 공백 집합 실측(E43 iOS 확인 후보 ②). 안드로이드 `:kit` `SwiftSemantics.kt`가
/// 이 집합을 미러한다(`inSwiftWhitespaces`·`inSwiftWhitespacesAndNewlines`) — iOS 쪽 정본이 테스트로 있어야
/// Foundation이 바뀌었을 때 드리프트가 보인다. 전 코드포인트를 훑어 집합을 통째로 대조한다.
/// ⚠ U+200B(폭 없는 공백)는 유니코드상 Cf지만 두 집합에 든다. U+0085(NEL)는 줄바꿈 집합에만, U+00A0은 둘 다.
private func members(_ set: CharacterSet) -> [UInt32] {
    (0...0x10FFFF).compactMap { Unicode.Scalar($0) }.filter { set.contains($0) }.map(\.value)
}

private let spaceSeparators: [UInt32] = [
    0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
    0x202F, 0x205F, 0x3000,
]

@Test func foundationWhitespacesMembership() {
    let expected = ([0x09, 0x200B] + spaceSeparators).sorted()
    #expect(members(.whitespaces) == expected)
}

@Test func foundationWhitespacesAndNewlinesMembership() {
    let expected = ([0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x85, 0x200B, 0x2028, 0x2029] + spaceSeparators).sorted()
    #expect(members(.whitespacesAndNewlines) == expected)
}
