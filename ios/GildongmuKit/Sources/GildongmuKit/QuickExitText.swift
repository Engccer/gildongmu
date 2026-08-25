import Foundation

/// 빠른하차 값 → 한 문장(웹 `src/lib/quick-exit-text.ts` 미러).
///
/// **3분기 × 2형태로 키를 나눈다.** 변수만 비우는 방식은 로케일마다 절 순서가 달라
/// 성립하지 않고, `between`이 별도 조각인 이유도 같다 — `"3-2,3-3 사이"`를 문 번호
/// 자리에 그대로 넣으면 "엘리베이터 3-2,3-3 사이 문"이 된다.
///
/// ⚠ 위치 인자 순서는 **ko 문장의 플레이스홀더 등장 순서**가 정본이다
///   (`"{station} 하차, 엘리베이터 {elevator}, 계단 {stairs}"` → station·elevator·stairs).
///   어순이 다른 로케일은 변환 스크립트가 인덱스를 재배치하므로 호출부는 이 순서 하나만
///   지킨다. 어겨도 컴파일은 통과하고 낭독만 뒤섞인다.
private func doorPhrase(_ door: QuickExitDoor, lang: String) -> String? {
    if door.kind == "between", door.doors.count >= 2 {
        return kitLocalized("route.transit.quickExitBetween", lang: lang, door.doors[0], door.doors[1])
    }
    guard let single = door.doors.first, !single.isEmpty else { return nil }
    return kitLocalized("route.transit.quickExitDoor", lang: lang, single)
}

/// 값이 없거나 시설이 하나도 없으면 nil — "빠른하차 정보 없음" 문구를 만들지 않는다(3-state).
public func quickExitText(_ quickExit: QuickExit?, station: String, lang: String) -> String? {
    guard let quickExit, !station.isEmpty else { return nil }
    // 환승 leg는 빠른환승 문 하나가 정본이다(A20) — seed 계단은 환승 통로가 아닐 수 있다.
    if let transfer = quickExit.transfer.flatMap({ doorPhrase($0, lang: lang) }) {
        return kitLocalized("route.transit.quickExitTransfer", lang: lang, station, transfer)
    }
    let elevator = quickExit.elevator.flatMap { doorPhrase($0, lang: lang) }
    let stairs = quickExit.stairs.flatMap { doorPhrase($0, lang: lang) }
    switch (elevator, stairs) {
    case let (elevator?, stairs?):
        return kitLocalized("route.transit.quickExitBoth", lang: lang, station, elevator, stairs)
    case let (elevator?, nil):
        return kitLocalized("route.transit.quickExitElevator", lang: lang, station, elevator)
    case let (nil, stairs?):
        return kitLocalized("route.transit.quickExitStairs", lang: lang, station, stairs)
    case (nil, nil):
        return nil
    }
}
