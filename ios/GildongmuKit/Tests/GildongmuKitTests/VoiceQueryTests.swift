import Testing
@testable import GildongmuKit

// 웹 `src/lib/__tests__/format.test.ts` normalizeVoiceQuery 블록의 미러.
// 같은 입력에 같은 결과를 내야 두 플랫폼의 음성 검색이 갈리지 않는다.

@Suite("normalizeVoiceQuery (음성 전사 → 검색어)")
struct VoiceQueryTests {
    @Test("후행 마침표를 제거한다: juso가 0건으로 전멸하던 실측 케이스")
    func stripsTrailingPeriod() {
        #expect(normalizeVoiceQuery("강동구 성내로 12.") == "강동구 성내로 12")
        #expect(normalizeVoiceQuery("서울 강동구 양재대로 1401.") == "서울 강동구 양재대로 1401")
    }

    @Test("물음표·느낌표·말줄임표와 연속 부호도 제거한다")
    func stripsOtherPunctuation() {
        #expect(normalizeVoiceQuery("강동구 맛집?") == "강동구 맛집")
        #expect(normalizeVoiceQuery("길동역!") == "길동역")
        #expect(normalizeVoiceQuery("천호동...") == "천호동")
    }

    @Test("부호 뒤 공백까지 함께 제거한다")
    func stripsTrailingWhitespace() {
        #expect(normalizeVoiceQuery("천호대로 1077.  ") == "천호대로 1077")
        #expect(normalizeVoiceQuery("  강동구청  ") == "강동구청")
    }

    @Test("부호와 공백이 섞인 꼬리도 한 번에 걷는다(웹 미러 동형성)")
    func stripsMixedTail() {
        #expect(normalizeVoiceQuery("강동구청 . , ") == "강동구청")
    }

    @Test("중간 문장부호는 보존한다(사용자가 실제 발화한 구분일 수 있다)")
    func keepsInnerPunctuation() {
        #expect(normalizeVoiceQuery("길동 442-1, 3층.") == "길동 442-1, 3층")
        #expect(normalizeVoiceQuery("S.M. 엔터테인먼트") == "S.M. 엔터테인먼트")
    }

    @Test("부호를 지우면 빈 문자열이 되는 입력은 원문을 되돌린다")
    func keepsPunctuationOnlyInput() {
        #expect(normalizeVoiceQuery(".") == ".")
        #expect(normalizeVoiceQuery("  ...  ") == "...")
    }

    @Test("부호가 없으면 그대로 통과한다")
    func passesThrough() {
        #expect(normalizeVoiceQuery("강동구 길동 맛집") == "강동구 길동 맛집")
        #expect(normalizeVoiceQuery("") == "")
    }
}
