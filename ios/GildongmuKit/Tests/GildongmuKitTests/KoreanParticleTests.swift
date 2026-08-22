import Testing
@testable import GildongmuKit

/// ⚠ 이 표는 웹 `src/lib/__tests__/korean-particle.test.ts`의 `PARTICLE_CASES`와
/// **같은 케이스**를 든다. 한쪽만 고치면 두 플랫폼의 낭독이 갈리므로
/// `korean-particle-drift.test.ts`가 이 표를 파싱해 대조한다.
///
/// 판정 불가(`nil`)는 `"-"`로 적는다 — 튜플 타입을 단순하게 두어 드리프트 가드가
/// 파싱할 수 있게 하기 위해서다.
/// 열: (단어, 목적격 을/를, 주격 이/가, 보조사 은/는, 방향 (으)로).
let particleCases: [(String, String, String, String, String)] = [
    ("성내로", "를", "가", "는", "로"),
    ("천호대로", "를", "가", "는", "로"),
    ("이마트", "를", "가", "는", "로"),
    ("명일로24길", "을", "이", "은", "로"),
    ("강동구청", "을", "이", "은", "으로"),
    ("봉래면옥", "을", "이", "은", "으로"),
    ("GS25", "-", "-", "-", "-"),
    ("스타벅스 R", "-", "-", "-", "-"),
    ("자택 아파트 101", "-", "-", "-", "-"),
    ("카페(임시)", "-", "-", "-", "-"),
    ("", "-", "-", "-", "-"),
]

@Suite struct KoreanParticleTests {
    @Test func 표대로_조사를_고른다() {
        for (word, object, subject, topic, direction) in particleCases {
            #expect(KoreanParticle.object(word) ?? "-" == object, "\(word) 목적격")
            #expect(KoreanParticle.subject(word) ?? "-" == subject, "\(word) 주격")
            #expect(KoreanParticle.topic(word) ?? "-" == topic, "\(word) 보조사")
            #expect(KoreanParticle.direction(word) ?? "-" == direction, "\(word) 방향")
        }
    }


    /// ⚠ 판정 불가에 빈 문자열이나 옵셔널 문자열 보간을 돌려주면 그대로 낭독된다.
    @Test func 판정_불가면_nil이라_호출자가_대체_문형을_고른다() {
        #expect(KoreanParticle.object("GS25") == nil)
        #expect(KoreanParticle.hasFinalConsonant("") == nil)
    }
}
