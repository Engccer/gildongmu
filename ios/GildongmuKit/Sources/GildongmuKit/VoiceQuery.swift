import Foundation

// 음성 전사를 검색어로 쓰기 전의 정규화. 웹 `src/lib/format.ts` normalizeVoiceQuery
// 미러(계약 정본은 웹). 순수 함수만(뷰·서비스 비의존).

/// 후행 문장부호로 제거 대상. 중간에 나온 같은 문자는 건드리지 않는다.
private let trailingPunctuation = CharacterSet(charactersIn: ".,!?…。、．，！？·")
    .union(.whitespacesAndNewlines)

/// 음성 전사에서 후행 문장부호를 제거한다.
///
/// STT는 발화를 문장으로 보고 끝에 마침표를 붙이는데, 검색 API는 그 마침표를
/// 질의어의 일부로 받아 매칭이 무너진다. 실호출 확정(2026-07-26):
/// - juso: "강동구 성내로 12" 15건 → "강동구 성내로 12." **0건**. 마지막 토큰을
///   건물번호로 파싱하는데 "12."가 유효 번호가 아니라 전멸한다. 주소는 대부분
///   숫자로 끝나므로 주소 검색만 유독 결과가 사라졌다("강동구청."은 6건 그대로).
/// - 카카오 키워드: "강동구 길동 맛집" 4,663건 → 마침표 붙이면 19건.
///
/// 전사 엔진에서 끄지 않는 이유: iOS 온디바이스 `SpeechTranscriber`에는 문장부호
/// 옵션 자체가 없다(SDK 헤더 확인 결과 `TranscriptionOption`은
/// `etiquetteReplacements` 하나뿐). 형제 API `DictationTranscriber`엔
/// `punctuation`이 있으나 엔진 교체는 채팅 산문의 문장부호까지 함께 잃는다.
/// 마침표가 노이즈인 곳은 검색 질의뿐이므로 소비 지점에서 지우는 것이 정확한 계층이다.
///
/// 후행만 제거한다. 중간 문장부호는 사용자가 실제로 발화한 구분일 수 있다.
/// 전부 지워 빈 문자열이 되면 원문을 되돌린다(정규화는 개선이지 파괴가 아니다).
/// 전사에 실제 발화가 담겼는지 판정한다(글자·숫자가 하나라도 있으면 발화로 본다).
///
/// 받아쓰기를 시작했다가 아무 말 없이 끝내면 STT가 무음 구간에 문장부호만 내놓는다
/// (실측 2026-08-01: 홀드 후 무발화 릴리스에 전사 "."). 그 전사를 그대로 소비하면
/// 채팅은 "."을 전송해 답변을 받아오고 검색은 "."으로 조회한다 — 사용자가 한 적 없는
/// 행동이다. `normalizeVoiceQuery`는 이걸 구제하지 못한다: 부호를 지우면 빈 문자열이
/// 되므로 "정규화는 개선이지 파괴가 아니다" 규칙에 따라 원문을 되돌리기 때문이다.
/// 두 함수의 책임이 다르다 — 정규화는 *검색어를 다듬고*, 이 판정은 *소비할지 말지*를
/// 가른다.
///
/// 판정은 소비 지점이 아니라 `SpeechService.stop()` 한 곳에서 쓴다(전사 소비 지점이
/// 검색·길찾기·채팅 전송·채팅 잠금 네 곳이라, 가드를 흩뿌리면 한 곳이 누락된다).
/// 내용 없는 전사는 빈 전사와 같은 `nil`이 되어 기존 침묵 경로에 합류한다 — 새 상태도
/// 새 통지도 만들지 않는다(위원장 판정 2026-08-01).
public func hasSpeechContent(_ text: String) -> Bool {
    text.contains { $0.isLetter || $0.isNumber }
}

public func normalizeVoiceQuery(_ text: String) -> String {
    var end = text.endIndex
    while end > text.startIndex {
        let previous = text.index(before: end)
        guard text[previous].unicodeScalars.allSatisfy(trailingPunctuation.contains) else { break }
        end = previous
    }
    let stripped = String(text[text.startIndex..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
    return stripped.isEmpty ? text.trimmingCharacters(in: .whitespacesAndNewlines) : stripped
}
