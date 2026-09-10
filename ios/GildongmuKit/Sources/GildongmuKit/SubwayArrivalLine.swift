import Foundation

/// 지하철 도착 한 줄의 현재역 꼬리 판정(A32) — 웹 `src/lib/place-lines/station-arrivals.ts` 미러.
/// 공유 fixture `src/lib/__tests__/fixtures/subway-arrival-tail-cases.json`이 두 구현을 한 표로 잠근다.
///
/// 낭독 정본인 완성 문장(`arvlMsg2`)이 **이미 현재역을 담는 문법이 있다**(`6분 후 (강일)`·`강일 도착`).
/// 그 위에 `현재 {역}`을 또 이으면 한 접근성 객체 안에서 같은 역 이름이 두 번 낭독된다.
///
/// ⚠ **판정 축은 값 포함이지 글자 패턴이 아니다.** 역 이름 자체에 괄호가 있어서
/// (`천호(풍납토성) 전역출발`) "괄호가 있으면 현재역이 들어 있다"는 규칙은 바로 어긋난다.
/// 알아보지 못하면 **붙이는 쪽**으로 실패한다(= 현행 동작, 정보 손실 0).
///
/// ⚠ **언어마다 자기 값으로 판정한다.** 영문 문장(`messageEn`)은 괄호 현재역을 담지 않는다
/// (`subway-arrival-en.ts`가 `currentLocationEn` 단일 채널로 뺀다 — E27 설계 리뷰 #5). 한국어
/// 값으로 en을 판정하면 중복이 없는 줄에서 꼬리를 떼어 **en 사용자만 현재역을 잃는다**.
/// 중복이 실제로 생기는 en 문법은 문장에 역명이 들어가는 `Arrived at {역}` 계열뿐이고,
/// 그 경우는 영문 값끼리의 포함 판정이 그대로 잡는다.
///
/// - Parameters:
///   - message: 그 줄에 실제로 쓸 완성 문장(ko `arvlMsg2` 또는 en `messageEn`).
///   - currentLocation: 같은 줄에 쓸 현재역(ko `arvlMsg3` 또는 en `currentLocationEn`).
/// - Returns: 꼬리(`현재 {역}`)를 붙일 것인가.
public func subwayShowsCurrentLocationTail(message: String?, currentLocation: String?) -> Bool {
    let location = (currentLocation ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    // 현재역이 애초에 없으면 붙일 것도 없다("정보 없음"이지 중복이 아니다).
    guard !location.isEmpty else { return false }
    let sentence = (message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return !sentence.contains(location)
}
