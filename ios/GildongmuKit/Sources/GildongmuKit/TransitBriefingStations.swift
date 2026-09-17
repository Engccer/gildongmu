import Foundation

// 경로 브리핑에서 지하철역 상세·전화(E45) — spec docs/superpowers/specs/2026-09-18-briefing-station-entry-design.md §3.2·§5.1.
// ⚠ 안드로이드 :kit 이식 규칙상 정규식 약칭 클래스를 쓰지 않는다(조인 정규화는 기존 `normalizeStopName` 재사용).

/// 브리핑 렌더 순서의 한 줄.
public enum TransitBriefingRow: Sendable, Hashable {
    /// 도보 구간 줄 — 행선지가 다음에 탈 역이다.
    case walk(legIndex: Int)
    /// 탑승 구간 줄 — 승차·하차가 함께 들린다.
    case transit(legIndex: Int)
    /// 하차 줄(빠른하차·하차 출구) — 하차역만 들린다.
    case alight(legIndex: Int)
}

/// 그 줄에서 열 수 있는 역 하나. 순서는 줄에 이름이 들리는 순서다.
public struct TransitBriefingStation: Sendable, Hashable {
    public let stop: TransitLegStop
    /// 전화번호 조회 노선 힌트(spec §4). `leg.lineName`의 빈 문자열만 접어 넘긴다 —
    /// 노선 표 판정은 `StationPhoneStore.key` 한 곳이 한다(복제하면 표 갱신 때 두 자리가 갈린다).
    public let lineName: String?
    /// **그 줄이 이 역을 부른 영문 이름**(`leg.fromNameEn`/`toNameEn`). 영문이 없으면 nil.
    ///
    /// ⚠ `stop.nameEn`을 쓰지 않는다. 줄의 영어 자격 술어(`transitLegUsesEnglish`)는 **leg 필드**를 보는데
    ///   `stop.nameEn`은 서버가 다른 원본(`passStopList.stations[].stationName`)에서 채우므로, 한쪽만 빈
    ///   응답에서 **줄은 영어인데 라벨만 한국어**가 된다(구현 리뷰 2026-09-18). 판정과 값이 같은 필드를
    ///   보면 술어가 참일 때 이 값의 존재가 함께 보장된다.
    public let nameEn: String?

    public init(stop: TransitLegStop, lineName: String?, nameEn: String? = nil) {
        self.stop = stop
        self.lineName = lineName
        self.nameEn = nameEn
    }
}

/// 이 줄에 달릴 역 진입점들.
///
/// **불변식**: 지하철 구간이 만든 줄에서 들린 역 이름에는 그 역으로 가는 수단이 있고, 그 밖의 줄에는 없다.
/// 위험한 것은 존재가 아니라 **정체성**이다 — 들린 이름과 열리는 역이 다르면 불변식을 지킨 채로 틀린 역이 열린다.
///
/// ⚠ `stops.first`/`stops.last`를 승차·하차역으로 쓰지 않는다. 서버 `toLegStops`가 이름·좌표가 무효한 항목을
///   `flatMap`으로 떨어뜨리므로 목록의 첫·마지막이 조용히 중간역이 될 수 있고, 그때 나오는 값은 반대편 승강장
///   안내가 된다(provider `previousStopName`이 같은 이유로 정규화 비교를 거친 뒤에만 쓴다).
///   **그래서 줄에서 들린 이름으로 조인하고, 조인에 실패하면 진입점은 없다**(추측으로 고르지 않는다).
public func transitBriefingStations(
    _ legs: [TransitRouteLeg], row: TransitBriefingRow
) -> [TransitBriefingStation] {
    switch row {
    case .walk(let index):
        guard legs.indices.contains(index), legs[index].mode == "walk" else { return [] }
        // "다음 leg"는 `legs[index + 1]`이 아니라 **다음 non-walk leg**다 — 서버가 도보 줄의 행선지 이름을
        // 그렇게 유도하므로(odsay `legs.slice(i + 1).find(l => l.mode !== "walk")`), 게이트가 이름의 출처와
        // 같은 술어를 써야 도보가 연달아 나오는 응답에서 "같은 이름인데 한 줄에만 진입점"이 생기지 않는다.
        //
        // 줄에 들리는 이름은 `legs[index].toName`이지만 서버가 그 값을 `next.fromName`으로 **덮으므로**
        // (odsay.ts:413-422) 두 필드는 같은 값이고, `fromName`이 비면 서버가 덮지 않아 줄에도 역 이름이
        // 들리지 않는다. 그래서 `fromName` 하나만 보는 것이 곧 "줄에 들린 이름" 게이트다.
        // ⚠ 이 동치는 서버 계약에 걸려 있다 — 실호출 게이트가 두 필드의 일치를 함께 잰다.
        guard let next = legs[legs.index(after: index)...].first(where: { $0.mode != "walk" }),
              next.mode == "subway" else { return [] }
        // 영문 이름은 **이 도보 줄**이 쓴 값이다(다음 leg의 `fromNameEn`이 아니다) — 줄의 자격 술어도
        // 도보 leg 자신을 보므로 판정과 값이 같은 필드에서 온다.
        return joinedStation(next, name: next.fromName, nameEn: legs[index].toNameEn, fromEnd: false)
            .map { [$0] } ?? []
    case .transit(let index):
        guard let leg = subwayLeg(legs, at: index) else { return [] }
        var stations: [TransitBriefingStation] = []
        if let board = joinedStation(leg, name: leg.fromName, nameEn: leg.fromNameEn, fromEnd: false) { stations.append(board) }
        if let alight = joinedStation(leg, name: leg.toName, nameEn: leg.toNameEn, fromEnd: true),
           // 승차와 하차가 같은 역이면 한 건으로 접는다(판정은 조인과 같은 정규화).
           stations.first.map({ normalizeStopName($0.stop.name) != normalizeStopName(alight.stop.name) }) ?? true {
            stations.append(alight)
        }
        return stations
    case .alight(let index):
        // 줄 존재 판정(`alightLineText`의 `station`)과 대상 판정이 **같은 필드**를 본다 — 갈라 두면
        // 줄에는 `toName`이 들리는데 다른 역이 열릴 수 있다.
        guard let leg = subwayLeg(legs, at: index) else { return [] }
        return joinedStation(leg, name: leg.toName, nameEn: leg.toNameEn, fromEnd: true).map { [$0] } ?? []
    }
}

/// 버스 정류장은 진입점을 갖지 않는다 — `transitStopPlace`가 `category: "지하철역"`을 박고 그 계약이
/// "버스 정류장은 이 함수를 지나지 않는다"이기 때문이다(spec §7).
private func subwayLeg(_ legs: [TransitRouteLeg], at index: Int) -> TransitRouteLeg? {
    guard legs.indices.contains(index), legs[index].mode == "subway" else { return nil }
    return legs[index]
}

/// 줄에서 들린 이름으로 그 leg의 정차역을 찾는다. 승차는 앞에서부터, 하차는 뒤에서부터 — 같은 역을 두 번
/// 지나는 노선(순환·왕복)에서 어느 통과를 가리키는지가 이 방향으로 갈린다.
private func joinedStation(
    _ leg: TransitRouteLeg, name: String?, nameEn: String?, fromEnd: Bool
) -> TransitBriefingStation? {
    guard let name, let stops = leg.stops, !stops.isEmpty else { return nil }
    // 이름 게이트는 non-nil이 아니라 **정규화 뒤 non-empty**다 — `transitLegText`는 `""`도 값으로 통과시켜
    // "에서 승차"를 내므로, non-nil로 두면 정차역 목록에 이름이 빈 항목이 남아 있을 때 빈 이름끼리
    // 맞아떨어져 액션 라벨이 " 상세 보기"가 된다.
    // ⚠ 원문 `isEmpty` 검사를 앞에 겹쳐 두지 말 것 — `name`이 비면 `target`도 반드시 비므로 어떤 입력에서도
    //   차이를 만들지 않는다(변이 주입 실측 2026-09-18). 겹쳐 두면 검증됐다는 인상만 남는다.
    let target = normalizeStopName(name)
    guard !target.isEmpty else { return nil }
    let ordered = fromEnd ? Array(stops.reversed()) : stops
    guard let stop = ordered.first(where: { normalizeStopName($0.name) == target }) else { return nil }
    let line = leg.lineName
    return TransitBriefingStation(
        stop: stop, lineName: (line?.isEmpty == false) ? line : nil,
        nameEn: (nameEn?.isEmpty == false) ? nameEn : nil)
}

/// 결과 진동 어휘(앱 `ResultHaptic.Kind` 미러). Kit은 UIKit을 모르므로 판정만 여기서 내고 발화는 앱이 한다.
public enum ResultHapticKind: Sendable, Hashable {
    case success, attention, failure
}

/// 역 전화 액션의 통지·진동(spec §5.1). **번호가 있으면 nil** — 전화 앱으로 넘어가는 것이 곧 응답이라 통지가
/// 잉여다. 그 밖의 세 상태는 문장과 진동을 함께 낸다(3-state를 촉각에도).
///
/// ⚠ `nil`은 세 상태를 겹쳐 든다(조회 전 · 첫 조회 중 · 갱신 시도 없이 보관 한도로 지워짐). "찾고 있습니다"가
///   거짓이 되지 않게 하는 것은 호출부의 몫이다 — 통지 전에 `resolve`를 킥오프해 문장이 사후적으로 참이 되게 한다.
///
/// 통지 문구에 역 이름을 넣지 않는다. 방금 누른 액션 라벨이 그 역을 말했다(뻔한 꼬리 문장 금지).
///
/// ⚠ 돌려주는 것은 **키**다. 호출부는 `appLocalized(변수)`로 넘기지 말고 리터럴 `switch`로 되받아야 한다 —
///   `check-xcstrings-keys.mjs`가 문자열 리터럴만 스캔하므로 변수 키는 카탈로그 대조에서 빠지고, 키가
///   사라지면 VoiceOver가 키 문자열을 그대로 낭독한다(`TransitWalkLegText` 소비자와 같은 관례).
public func briefingPhoneAnnouncement(
    _ result: StationPhoneResult?
) -> (key: String, haptic: ResultHapticKind)? {
    switch result {
    case .direct, .representative: return nil
    case .unavailable: return ("ios.station.phoneMissing", .attention)
    case .failed: return ("ios.station.phoneError", .failure)
    case nil: return ("ios.station.phonePending", .attention)
    }
}
