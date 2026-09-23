import Foundation

/// 버스 승차 중 현재 정류장 — 기기 위치(fix)의 **표시 전용** 순수 계층(E48, spec
/// `2026-09-23-bus-current-stop-design.md` §2). 웹 `src/lib/transit-bus-stop.ts`의 1:1 미러이고
/// 공유 fixture(`transit-bus-stop-cases.json`)가 동조를 강제한다.
///
/// ⚠ 이 상태는 승차 상태 머신(`TransitGuide.swift` 리듀서) **밖**에 있다. 리듀서는 이 파일을 모르고
/// (소스 가드 `transit-bus-stop-guard.test.ts`), 도착·승격·하차·neverSeen 판정은 도착 API가 한다
/// (판정서 2026-08-23 §3). 기기 위치는 경유 정류장 목록·조망의 "현재 위치" 표식만 채운다.
///
/// E35 열차 위치(`TransitRidingPosition.swift`)와 합치지 않는다 — 결박·출처·빈도·뒤 재시작 규칙이 다르다.
/// 합류는 표식 index의 큰 값 하나다. 불변식: 표식은 "있다"만 주장한다.

/// fix 정확도 상한(m) — 앱 공유 스토어 저장 상한(`LocationFixPolicy.storeCeiling`)과 같다. ⚠ 잠정값.
public let transitBusStopMaxAccuracyM: Double = 100
/// fix 나이 상한(초) — 캐시 fix를 거른다. ⚠ 잠정값.
public let transitBusStopFixMaxAgeSeconds: Double = 10
/// 최근접 정류장까지의 거리 상한(m) — 넘으면 노선 밖이라 관측이 아니다. ⚠ 잠정값.
public let transitBusStopNearRadiusM: Double = 300
/// 비인접 정류장이 최근접보다 이만큼 안쪽이면 노선이 접힌 곳이라 모호하다. ⚠ 잠정값.
public let transitBusStopAmbiguityMarginM: Double = 50
/// 하차 정류장은 이만큼 가까워야 관측으로 친다(m). "하차, 현재 위치"는 "지금 내려라"로 들린다 — 직전 정류장에 문이
/// 열린 채 서 있는 동안 한쪽으로 치우친 fix 두 건이 중간 지점을 넘겨 그 줄을 먼저 세우지 않게(접근성 감사 MINOR-2).
/// ⚠ 잠정값.
public let transitBusStopAlightRadiusM: Double = 50
/// 마지막 관측 뒤 표식을 유지하는 창(ms). 만료는 폴 시계가 아니라 **이 시각에 맞춘 한 번짜리 타이머**가 판정한다
/// (설계 리뷰 M2 — 폴에 기대면 실효 창이 창+폴 주기로 늘어난다). ⚠ 잠정값.
public let transitBusStopHoldMs: Double = 90_000
/// 래치보다 뒤 정류장 관측이 이만큼 이어지면 그 정류장에서 다시 시작한다(ms). ⚠ 잠정값.
public let transitBusStopBehindRestartMs: Double = 60_000

/// fix 한 건. `ageSeconds`는 호출자가 **측정 시각**으로 잰다(수신 시각이 아니다).
public struct TransitDeviceFix: Sendable, Equatable, Codable {
    public let lat: Double
    public let lng: Double
    /// 수평 정확도(m). 0 이하·비유한은 판정 불가.
    public let accuracy: Double
    public let ageSeconds: Double

    public init(lat: Double, lng: Double, accuracy: Double, ageSeconds: Double) {
        self.lat = lat
        self.lng = lng
        self.accuracy = accuracy
        self.ageSeconds = ageSeconds
    }
}

public struct TransitBusStopTracker: Sendable, Equatable, Codable {
    public var legIndex: Int
    public var phaseGen: Int
    /// 단조 래치 — 버스는 뒤로 가지 않는다. 관측 전·보존 창 만료 뒤는 nil.
    public var stopIndex: Int?
    /// 마지막으로 래치를 확인·전진시킨 관측 시각(ms).
    public var lastObservedAt: Double?
    /// 래치보다 앞(또는 래치 없음)으로 한 번 관측된 정류장 — 같은 정류장이 한 번 더 이어서 관측돼야 래치가
    /// 옮겨 간다(설계 리뷰 M1: 튄 fix 한 건이 아직 오지 않은 정류장을 "현재 위치"로 만들지 않게).
    public var pendingIndex: Int?
    /// 뒤 정류장 관측이 시작된 시각(ms) — 같거나 앞 관측이 오면 끊긴다.
    public var behindSince: Double?

    public init(legIndex: Int, phaseGen: Int, stopIndex: Int? = nil, lastObservedAt: Double? = nil,
                pendingIndex: Int? = nil, behindSince: Double? = nil) {
        self.legIndex = legIndex
        self.phaseGen = phaseGen
        self.stopIndex = stopIndex
        self.lastObservedAt = lastObservedAt
        self.pendingIndex = pendingIndex
        self.behindSince = behindSince
    }
}

/// 뷰가 읽는 표식 — 시각이 빠진 (결박, 정류장)이다. fix마다 바뀌는 `lastObservedAt`을 뷰에 노출하면 관측이
/// 이어지는 동안 목록이 초마다 다시 그려진다(설계 리뷰 m3). 이 값이 바뀔 때만 관측 속성에 쓴다.
public struct TransitBusStopMark: Sendable, Equatable, Codable {
    public let legIndex: Int
    public let phaseGen: Int
    public let stopIndex: Int

    public init(legIndex: Int, phaseGen: Int, stopIndex: Int) {
        self.legIndex = legIndex
        self.phaseGen = phaseGen
        self.stopIndex = stopIndex
    }
}

public enum TransitBusStopVerdict: String, Sendable, Equatable, Codable {
    case notApplicable, inaccurate, stale, offRoute, ambiguous, approachingAlight, pending, observed, behind, restarted
}

public struct TransitBusStopStepResult: Sendable, Equatable {
    public let tracker: TransitBusStopTracker?
    public let verdict: TransitBusStopVerdict
    /// 이 fix의 최근접 정류장(원본 index) — 거리를 재기 전에 걸러졌으면 nil. 계측 전용(구현 리뷰 m3).
    public let nearestIndex: Int?

    public init(tracker: TransitBusStopTracker?, verdict: TransitBusStopVerdict, nearestIndex: Int?) {
        self.tracker = tracker
        self.verdict = verdict
        self.nearestIndex = nearestIndex
    }
}

/// 적용 조건(spec §2 ①) — 잠금 종류·신호는 보지 않는다(기기 위치는 도착 피드와 독립이다).
public func transitBusStopApplies(state: TransitGuideState, leg: TransitGuideLeg) -> Bool {
    state.phase == .riding && leg.mode == "bus" && !leg.viaStops.isEmpty
}

private func isBound(legIndex: Int, phaseGen: Int, _ state: TransitGuideState) -> Bool {
    legIndex == state.legIndex && phaseGen == state.phaseGen
}

/// 쓸 수 있는 정류장 좌표 — 비유한·(0,0)은 후보에서 뺀다(설계 리뷰 m5, `transitPrewalkTarget`과 같은 방어).
private func usableStop(_ s: TransitLegStop) -> Bool {
    s.lat.isFinite && s.lng.isFinite && !(s.lat == 0 && s.lng == 0)
}

/// fix 한 건을 반영한다(spec §2 ③). 기기 위치는 언제 도착하든 "지금 이 사람의 위치"라 요청 결박을
/// 따지지 않고 **현재 상태**의 결박에 넣는다(E35의 늦은 응답 폐기와 다른 점).
public func transitBusStopStep(
    _ prev: TransitBusStopTracker?, state: TransitGuideState, leg: TransitGuideLeg,
    fix: TransitDeviceFix, now: Double
) -> TransitBusStopStepResult {
    guard transitBusStopApplies(state: state, leg: leg) else {
        return TransitBusStopStepResult(tracker: nil, verdict: .notApplicable, nearestIndex: nil)
    }
    var next: TransitBusStopTracker
    if let prev, isBound(legIndex: prev.legIndex, phaseGen: prev.phaseGen, state) {
        next = prev
    } else {
        next = TransitBusStopTracker(legIndex: state.legIndex, phaseGen: state.phaseGen)
    }
    // 보존 창이 지난 래치는 버린다(E35 설계 리뷰 M2와 같은 이유) — 표시되지 않는 래치가 뒤의 진짜 관측을 막지 않게.
    if let at = next.lastObservedAt, now - at > transitBusStopHoldMs {
        next.stopIndex = nil
        next.lastObservedAt = nil
        next.pendingIndex = nil
        next.behindSince = nil
    }
    // 음수·0 정확도는 무효 신호(CLLocation 계약).
    guard fix.accuracy > 0, fix.accuracy.isFinite, fix.accuracy <= transitBusStopMaxAccuracyM else {
        return TransitBusStopStepResult(tracker: next, verdict: .inaccurate, nearestIndex: nil)
    }
    // 캐시 fix(스트림 첫 콜백)·미래 시각을 거른다 — 도보 안내와 같은 판정 함수, 창만 이 계층의 값(기본값 5초를
    // 쓰지 않는다 — 명시).
    guard isUsableFix(accuracy: fix.accuracy, ageSeconds: fix.ageSeconds, maxAge: transitBusStopFixMaxAgeSeconds)
    else { return TransitBusStopStepResult(tracker: next, verdict: .stale, nearestIndex: nil) }

    // 원본 index를 유지한 채 쓸 수 있는 정류장만 겨룬다.
    let distances = leg.viaStops.map {
        usableStop($0) ? haversineMeters(lat1: fix.lat, lng1: fix.lng, lat2: $0.lat, lng2: $0.lng) : .infinity
    }
    var nearest = 0
    for i in distances.indices.dropFirst() where distances[i] < distances[nearest] { nearest = i }
    func result(_ tracker: TransitBusStopTracker, _ verdict: TransitBusStopVerdict) -> TransitBusStopStepResult {
        TransitBusStopStepResult(tracker: tracker, verdict: verdict, nearestIndex: nearest)
    }
    guard distances[nearest] <= transitBusStopNearRadiusM else { return result(next, .offRoute) }
    // 노선이 접힌 곳(회차·U턴·순환 — 길 건너 정류장)은 어느 쪽인지 가를 수 없다. 인접 정류장끼리는 경합이 아니다.
    let folded = distances.indices.contains {
        abs($0 - nearest) >= 2 && distances[$0] <= distances[nearest] + transitBusStopAmbiguityMarginM
    }
    if folded { return result(next, .ambiguous) }
    if nearest == distances.count - 1, distances[nearest] > transitBusStopAlightRadiusM {
        return result(next, .approachingAlight)
    }

    if next.stopIndex == nearest {
        next.lastObservedAt = now
        next.pendingIndex = nil
        next.behindSince = nil
        return result(next, .observed)
    }
    if next.stopIndex.map({ nearest > $0 }) ?? true {
        // 앞으로는 같은 정류장이 두 번 이어서 관측돼야 옮긴다(설계 리뷰 M1). 뒤 관측의 연속은 끊긴다.
        next.behindSince = nil
        if next.pendingIndex == nearest {
            next.stopIndex = nearest
            next.lastObservedAt = now
            next.pendingIndex = nil
            return result(next, .observed)
        }
        next.pendingIndex = nearest
        return result(next, .pending)
    }
    // 뒤 정류장 — 60초 동안 이어질 때만 다시 시작한다(첫 래치가 틀렸던 경우의 복구). 중간 지점의 흔들림은
    // 사이에 끼는 같거나 앞 관측이 끊는다. 뒤 관측은 래치를 확인하지 않으므로 `lastObservedAt`을 두고 간다
    // — 그래서 래치 나이가 30초를 넘은 뒤 시작한 뒤 관측은 60초 전에 보존 창 만료가 먼저 래치를 버린다.
    next.pendingIndex = nil
    let since = next.behindSince ?? now
    if now - since >= transitBusStopBehindRestartMs {
        next.stopIndex = nearest
        next.lastObservedAt = now
        next.behindSince = nil
        return result(next, .restarted)
    }
    next.behindSince = since
    return result(next, .behind)
}

/// 표식 — 적용 조건·결박·보존 창 안일 때만. `now`가 관측보다 이르면(음수 경과) 보인다.
public func transitBusStopMark(
    state: TransitGuideState, leg: TransitGuideLeg, tracker: TransitBusStopTracker?, now: Double
) -> TransitBusStopMark? {
    guard transitBusStopApplies(state: state, leg: leg), let tracker,
          isBound(legIndex: tracker.legIndex, phaseGen: tracker.phaseGen, state),
          let index = tracker.stopIndex, let at = tracker.lastObservedAt, now - at <= transitBusStopHoldMs
    else { return nil }
    return TransitBusStopMark(legIndex: tracker.legIndex, phaseGen: tracker.phaseGen, stopIndex: index)
}

/// 표식이 지금 상태에서 유효한 index — 국면·구간·결박이 바뀌었으면 옛 표식은 nil.
private func markIndex(state: TransitGuideState, leg: TransitGuideLeg, mark: TransitBusStopMark?) -> Int? {
    guard let mark, transitBusStopApplies(state: state, leg: leg),
          isBound(legIndex: mark.legIndex, phaseGen: mark.phaseGen, state),
          mark.stopIndex < leg.viaStops.count
    else { return nil }
    return mark.stopIndex
}

/// 경유 목록 표식의 세 번째 출처(spec §2 ⑤) — E35 `transitViaStopHereIndex`(도착 `arvlMsg3`·열차 위치)와
/// 버스 표식 중 큰 값. 한 leg에서 두 출처가 겨루지 않지만(버스 ↔ 지하철) 그 사실을 가정하지 않는다.
public func transitViaStopHereIndexWithBusStop(
    state: TransitGuideState, leg: TransitGuideLeg, position: TransitRidingPosition?,
    busStop: TransitBusStopMark?, now: Double
) -> Int? {
    let train = transitViaStopHereIndex(state: state, leg: leg, position: position, now: now)
    let bus = markIndex(state: state, leg: leg, mark: busStop)
    switch (train, bus) {
    case let (t?, b?): return max(t, b)
    case let (t?, nil): return t
    case let (nil, b): return b
    }
}

/// 조망 후처리(spec §2 ⑥) — 버스 leg에서 `here`가 해당 없음일 때만 표식으로 바꾼다(추적 불가 지하철 leg도
/// 같은 `bus` 사유를 받으므로 leg 종류를 함께 본다 — 설계 리뷰 n1). silence 행·`reboardOffered`는 불변.
/// E35 후처리 뒤에 얹는다(서로 다른 leg 종류에서만 일한다).
public func transitOverviewApplyingBusStop(
    _ overview: TransitOverview, state: TransitGuideState, leg: TransitGuideLeg, mark: TransitBusStopMark?
) -> TransitOverview {
    guard overview.here == .notApplicable(reason: .bus),
          let shown = markIndex(state: state, leg: leg, mark: mark)
    else { return overview }
    let rows = overview.rows.map { row -> TransitOverviewRow in
        if case let .stop(stopIndex, name, role, _) = row {
            return .stop(stopIndex: stopIndex, name: name, role: role, here: stopIndex == shown)
        }
        return row
    }
    return TransitOverview(
        legOrdinal: overview.legOrdinal, rows: rows, here: .station(stopIndex: shown),
        reboardOffered: overview.reboardOffered, alternativesOffered: overview.alternativesOffered)
}
