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

@Suite("hasSpeechContent (전사에 실제 발화가 담겼는가)")
struct SpeechContentTests {
    @Test("문장부호만 남은 전사는 내용 없음: 무음 구간에서 STT가 내는 산출물")
    func rejectsPunctuationOnly() {
        // 실측(2026-08-01): 홀드하고 아무 말 없이 뗐을 때 전사가 "." 하나였다.
        // normalizeVoiceQuery는 이걸 구제하지 못한다 — 부호를 지우면 빈 문자열이
        // 되므로 "정규화는 파괴가 아니다" 규칙에 따라 원문 "."을 되돌리기 때문이다.
        #expect(hasSpeechContent(".") == false)
        #expect(hasSpeechContent("...") == false)
        #expect(hasSpeechContent("?") == false)
        #expect(hasSpeechContent("。") == false)
        #expect(hasSpeechContent(". , !") == false)
    }

    @Test("공백뿐인 전사도 내용 없음")
    func rejectsBlank() {
        #expect(hasSpeechContent("") == false)
        #expect(hasSpeechContent("   ") == false)
        #expect(hasSpeechContent("\n\t") == false)
    }

    @Test("글자나 숫자가 하나라도 있으면 내용 있음")
    func acceptsAnyLetterOrDigit() {
        #expect(hasSpeechContent("네.") == true)
        #expect(hasSpeechContent("강동구청") == true)
        #expect(hasSpeechContent("12") == true)
        #expect(hasSpeechContent("ok") == true)
    }

    @Test("부호에 둘러싸인 한 글자도 발화로 인정한다(짧은 대답을 삼키지 않는다)")
    func acceptsSingleCharacterAnswer() {
        // "응.", "네?" 같은 최단 응답이 전사의 대부분이 부호여도 살아남아야 한다.
        #expect(hasSpeechContent("응.") == true)
        #expect(hasSpeechContent("...네...") == true)
    }
}
