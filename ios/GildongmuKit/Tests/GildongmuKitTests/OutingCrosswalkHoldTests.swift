import Testing
@testable import GildongmuKit

@Suite("나들이 받아쓰기 중 횡단보도 경고")
struct OutingCrosswalkHoldTests {
    private let lat0 = 37.5
    private let lng0 = 127.0
    private let metersPerDegLat = 111_320.0

    /// 기준점에서 북쪽으로 `north`미터 떨어진 횡단보도. `probe`: 카카오 탐침의 연석점(정적 중심점과 근접 짝이 된다).
    private func crosswalk(_ id: String, north: Double, probe: Bool = false) -> OutingCrosswalk {
        OutingCrosswalk(id: id, lat: lat0 + north / metersPerDegLat, lng: lng0, fromProbe: probe)
    }

    private func notice(_ id: String) -> OutingCrosswalkNotice {
        OutingCrosswalkNotice(id: id, hasAudioSignal: false)
    }

    /// 앱의 fix 한 번(`OutingModel`의 평가와 같은 순서): 북쪽을 보고 걷는 사람이 기준점에서 본 예고 판정 → 근접 짝 →
    /// 장부. 고를 횡단보도가 없으면 nil.
    private func fix(
        _ crosswalks: [OutingCrosswalk], _ ledger: inout OutingCrosswalkLedger, suppressed: Bool
    ) -> OutingCrosswalkAction? {
        let pairs = crosswalks.map { c in
            (crosswalk: c, relation: outingProject(
                fixLat: lat0, fixLng: lng0, accuracy: 5, heading: .valid(bearing: 0, uncertaintyDeg: 5),
                placeLat: c.lat, placeLng: c.lng))
        }
        guard let notice = outingCrosswalkNoticeStep(crosswalks: pairs, audioSignals: [], spoken: ledger.spoken)
        else { return nil }
        let silencing = outingCrosswalkSilenced(after: notice.id, crosswalks: pairs)
        return ledger.notice(notice, silencing: silencing, suppressed: suppressed)
    }

    @Test("막히지 않았으면 그 자리에서 내고, 「말했다」 표시는 끝 신호에서 근접 짝과 함께 선다")
    func speaksWhenOpen() {
        var ledger = OutingCrosswalkLedger()
        do { let result = ledger.notice(notice("a"), silencing: ["a2"], suppressed: false); #expect(result == .speak) }
        // 낸 것만으로는 「말했다」가 아니다 — 끝 신호를 기다리는 동안에도 다음 fix가 다시 예고하지는 않는다.
        #expect(ledger.spoken.isEmpty)
        #expect(ledger.busy)
        do { let result = fix([crosswalk("a", north: 20)], &ledger, suppressed: false); #expect(result == .hold) }
        ledger.spoke("a")
        #expect(ledger.spoken == ["a", "a2"])
        #expect(ledger.inFlight == nil)
        #expect(ledger.held == nil)
        #expect(ledger.vibrated.isEmpty)
    }

    @Test("막힌 동안: 진동은 한 번, 문장은 쥐고, 「말했다」 표시는 서지 않는다")
    func holdsWhileSuppressed() {
        var ledger = OutingCrosswalkLedger()
        let ahead = crosswalk("a", north: 20)
        do { let result = fix([ahead], &ledger, suppressed: true); #expect(result == .vibrate) }
        // 표시가 먼저 서면 문장 없이 「말한 횡단보도」가 된다.
        #expect(ledger.spoken.isEmpty)
        // 쥔 것은 다시 내지 않는다(풀릴 때 장부가 낸다) — 막힘이 잠시 풀린 fix가 와도 그렇다.
        do { let result = fix([ahead], &ledger, suppressed: false); #expect(result == .hold) }
        // 받아쓰기 준비가 길어져 같은 예고가 fix마다 와도 진동은 한 번이고 쥔 것은 그대로다(V26).
        for _ in 1...30 {
            do { let result = ledger.notice(notice("a"), silencing: [], suppressed: true); #expect(result == .hold) }
        }
        #expect(ledger.held == notice("a"))
        #expect(ledger.spoken.isEmpty)
    }

    @Test("풀리면 한 번 내놓는다 — 두 번 내놓지 않고, 끝 신호 전에도 다음 fix가 다시 예고하지 않는다")
    func releasesOnce() {
        var ledger = OutingCrosswalkLedger()
        let ahead = crosswalk("a", north: 20)
        _ = ledger.notice(notice("a"), silencing: [], suppressed: true)
        do { let result = ledger.release(verdict: .speak, silencing: ["a2"]) == notice("a"); #expect(result) }
        #expect(ledger.spoken.isEmpty)
        #expect(ledger.held == nil)
        do { let result = ledger.release(verdict: .speak, silencing: []); #expect(result == nil) }
        do { let result = fix([ahead], &ledger, suppressed: false); #expect(result == .hold) }
        ledger.spoke("a")
        #expect(ledger.spoken == ["a", "a2"])
    }

    @Test("쥔 것이 없으면 풀려도 아무것도 내놓지 않는다")
    func releaseWithoutHold() {
        var ledger = OutingCrosswalkLedger()
        do { let result = ledger.release(verdict: .speak, silencing: []); #expect(result == nil) }
        _ = ledger.notice(notice("a"), silencing: [], suppressed: false)
        do { let result = ledger.release(verdict: .speak, silencing: []); #expect(result == nil) }
    }

    @Test("풀릴 때 말하지 않는 판정이면 표시도 세우지 않는다 — 돌아서서 다가가면 다시 예고한다")
    func skipsWhenNotSpeakable() {
        for verdict in [OutingHeldCrosswalkVerdict.behind, .far, .gone] {
            var ledger = OutingCrosswalkLedger()
            _ = ledger.notice(notice("a"), silencing: [], suppressed: true)
            do { let result = ledger.release(verdict: verdict, silencing: ["a2"]); #expect(result == nil) }
            #expect(ledger.held == nil)
            #expect(ledger.spoken.isEmpty)
            #expect(ledger.inFlight == nil)
            do { let result = fix([crosswalk("a", north: 20)], &ledger, suppressed: false); #expect(result == .speak) }
        }
    }

    @Test("진동 표시는 「말했다」 표시와 따로다 — 같은 횡단보도는 다시 막혀도 진동을 한 번만 낸다")
    func vibrationMarkIsSeparate() {
        var ledger = OutingCrosswalkLedger()
        do { let result = ledger.notice(notice("a"), silencing: [], suppressed: true); #expect(result == .vibrate) }
        #expect(ledger.vibrated == ["a"])
        #expect(ledger.spoken.isEmpty)
        do { let result = ledger.release(verdict: .behind, silencing: []); #expect(result == nil) }
        do { let result = ledger.notice(notice("a"), silencing: [], suppressed: true); #expect(result == .hold) }
        // 다른 횡단보도는 따로 진동한다(쥔 것이 끝난 뒤에 — 한 번에 하나).
        _ = ledger.release(verdict: .behind, silencing: [])
        do { let result = ledger.notice(notice("b"), silencing: [], suppressed: true); #expect(result == .vibrate) }
        #expect(ledger.held == notice("b"))
    }

    @Test("막히기 직전의 버림(받아쓰기 시작이 기기 음성을 억제보다 먼저 멈춤): 다시 쥐고, 다시 낼 때 막혀 있으면 진동 후 풀릴 때 낸다")
    func dropJustBeforeSuppression() {
        var ledger = OutingCrosswalkLedger()
        do { let result = ledger.notice(notice("a"), silencing: ["a2"], suppressed: false); #expect(result == .speak) }
        // 끊김은 억제가 서기 전에 닿는다 — 막혀 있지 않아도 버리지 않는다.
        do { let result = ledger.dropped(notice("a"), suppressed: false); #expect(result == .retry) }
        #expect(ledger.held == notice("a"))
        #expect(ledger.spoken.isEmpty)
        // 재시도 지연 사이에 억제가 섰다: 쥔 채 진동 한 번.
        do { let first = ledger.stillSuppressed(); #expect(first) }
        do { let again = ledger.stillSuppressed(); #expect(!again) }
        #expect(ledger.held == notice("a"))
        // 풀릴 때 내고, 끝 신호에서 「말했다」.
        do { let result = ledger.release(verdict: .speak, silencing: ["a2"]) == notice("a"); #expect(result) }
        ledger.spoke("a")
        #expect(ledger.spoken == ["a", "a2"])
        do { let result = fix([crosswalk("a", north: 20)], &ledger, suppressed: false); #expect(result == nil) }
    }

    @Test("막힌 동안의 버림(VoiceOver 끝 신호가 억제 뒤에 닿음): 다시 쥐고 진동은 횡단보도마다 한 번")
    func dropWhileSuppressed() {
        var ledger = OutingCrosswalkLedger()
        _ = ledger.notice(notice("a"), silencing: [], suppressed: false)
        do { let result = ledger.dropped(notice("a"), suppressed: true); #expect(result == .hold(vibrate: true)) }
        #expect(ledger.held == notice("a"))
        do { let result = ledger.release(verdict: .speak, silencing: []) == notice("a"); #expect(result) }
        do { let result = ledger.dropped(notice("a"), suppressed: true); #expect(result == .hold(vibrate: false)) }
    }

    @Test("풀린 직후의 버림(받아쓴 원문 통지·포커스 이동이 끊음): 다시 쥐고 잠시 뒤 다시 낸다")
    func dropJustAfterRelease() {
        var ledger = OutingCrosswalkLedger()
        _ = ledger.notice(notice("a"), silencing: [], suppressed: true)
        do { let result = ledger.release(verdict: .speak, silencing: []) == notice("a"); #expect(result) }
        do { let result = ledger.dropped(notice("a"), suppressed: false); #expect(result == .retry) }
        #expect(ledger.spoken.isEmpty)
        do { let result = ledger.release(verdict: .speak, silencing: ["a2"]) == notice("a"); #expect(result) }
        ledger.spoke("a")
        #expect(ledger.spoken == ["a", "a2"])
    }

    @Test("풀리는 순간 채널이 없어(화면 꺼짐·음성 토글 끔) 곧장 버려져도 다시 낸다")
    func dropWhenChannelMissingAtRelease() {
        var ledger = OutingCrosswalkLedger()
        _ = ledger.notice(notice("a"), silencing: [], suppressed: true)
        _ = ledger.release(verdict: .speak, silencing: [])
        do { let result = ledger.dropped(notice("a"), suppressed: false); #expect(result == .retry) }
        #expect(ledger.held == notice("a"))
    }

    @Test("재시도는 횡단보도마다 두 번까지 — 세 번째 버림은 포기하고 「말했다」로 적어 다시 예고하지 않는다")
    func retryLimit() {
        var ledger = OutingCrosswalkLedger()
        _ = ledger.notice(notice("a"), silencing: ["a2"], suppressed: false)
        for _ in 1...outingCrosswalkRetryLimit {
            do { let result = ledger.dropped(notice("a"), suppressed: false); #expect(result == .retry) }
            do { let result = ledger.release(verdict: .speak, silencing: ["a2"]) == notice("a"); #expect(result) }
        }
        do { let result = ledger.dropped(notice("a"), suppressed: false); #expect(result == .giveUp) }
        #expect(ledger.held == nil)
        #expect(ledger.inFlight == nil)
        #expect(ledger.spoken == ["a", "a2"])
        do { let result = fix([crosswalk("a", north: 20)], &ledger, suppressed: false); #expect(result == nil) }
        // 다른 횡단보도의 횟수는 따로다.
        _ = ledger.notice(notice("b"), silencing: [], suppressed: false)
        do { let result = ledger.dropped(notice("b"), suppressed: false); #expect(result == .retry) }
    }

    @Test("지금 낸 채 기다리는 것이 아닌 횡단보도의 늦은 신호는 아무것도 하지 않는다")
    func lateSignalOfOtherIsSuperseded() {
        var ledger = OutingCrosswalkLedger()
        _ = ledger.notice(notice("a"), silencing: [], suppressed: false)
        let before = ledger
        do { let result = ledger.dropped(notice("z"), suppressed: false); #expect(result == .superseded) }
        ledger.spoke("z")
        #expect(ledger == before)
        // 끝까지 말한 뒤 늦게 온 버림은 다시 쥐지 않는다.
        ledger.spoke("a")
        do { let result = ledger.dropped(notice("a"), suppressed: false); #expect(result == .superseded) }
        #expect(ledger.held == nil)
        #expect(ledger.spoken == ["a"])
    }

    @Test("쥔 동안 다른 횡단보도는 받지 않는다 — 풀릴 때 쥔 것 하나만 내고 진동도 하나다")
    func holdBlocksOthers() {
        var ledger = OutingCrosswalkLedger()
        do { let result = ledger.notice(notice("a"), silencing: [], suppressed: true); #expect(result == .vibrate) }
        do { let result = ledger.notice(notice("b"), silencing: [], suppressed: true); #expect(result == .hold) }
        do { let result = ledger.notice(notice("b"), silencing: [], suppressed: false); #expect(result == .hold) }
        #expect(ledger.vibrated == ["a"])
        do { let result = ledger.release(verdict: .speak, silencing: []); #expect(result == notice("a")) }
        do { let result = ledger.release(verdict: .speak, silencing: []); #expect(result == nil) }
    }

    // MARK: 한 번에 하나(재리뷰 M-1) — 앱의 fix 순서로 돌린 시나리오

    @Test("근접 짝 동시 진입: 연석점을 내면 끝 신호 전까지 중심점을 내지 않고, 끝까지 말하면 함께 침묵한다")
    func nearPairEnteringTogether() {
        var ledger = OutingCrosswalkLedger()
        let curb = crosswalk("a", north: 12, probe: true)
        let center = crosswalk("a2", north: 25)
        do { let result = fix([curb, center], &ledger, suppressed: false); #expect(result == .speak) }
        #expect(ledger.inFlight?.id == "a")
        // 끝 신호를 기다리는 동안: 짝이 기본 우선순위로 나가 앞의 경고를 끊지 않고, 기기 음성 칸에도 들지 않는다.
        for _ in 1...10 {
            do { let result = fix([curb, center], &ledger, suppressed: false); #expect(result == .hold) }
        }
        // 말하는 사이 연석점을 지나 중심점만 앞에 남아도 그렇다.
        do { let result = fix([center], &ledger, suppressed: false); #expect(result == .hold) }
        ledger.spoke("a")
        #expect(ledger.spoken == ["a", "a2"])
        do { let result = fix([curb, center], &ledger, suppressed: false); #expect(result == nil) }
    }

    @Test("풀린 뒤 대기열 뒤로 낸 경고의 끝 신호 전에는 짝이 기본 우선순위로 나가지 않는다(M2 순서)")
    func releasedWarningIsNotOvertakenByPair() {
        var ledger = OutingCrosswalkLedger()
        let curb = crosswalk("a", north: 12, probe: true)
        let center = crosswalk("a2", north: 25)
        do { let result = fix([curb, center], &ledger, suppressed: true); #expect(result == .vibrate) }
        do { let result = ledger.release(verdict: .speak, silencing: ["a2"]); #expect(result?.id == "a") }
        do { let result = fix([curb, center], &ledger, suppressed: false); #expect(result == .hold) }
        do { let result = fix([center], &ledger, suppressed: false); #expect(result == .hold) }
    }

    @Test("30m 안의 다른 두 횡단보도: 앞의 것이 끝난 뒤에 다음 것을 낸다 — 서로 끊지 않는다")
    func distinctCrosswalksInSequence() {
        var ledger = OutingCrosswalkLedger()
        let near = crosswalk("c", north: 14)
        let next = crosswalk("d", north: 26)
        do { let result = fix([near, next], &ledger, suppressed: false); #expect(result == .speak) }
        #expect(ledger.inFlight?.id == "c")
        do { let result = fix([near, next], &ledger, suppressed: false); #expect(result == .hold) }
        ledger.spoke("c")
        do { let result = fix([near, next], &ledger, suppressed: false); #expect(result == .speak) }
        #expect(ledger.inFlight?.id == "d")
    }

    @Test("교대 상한: 낸 경고가 매번 끊겨도 한 횡단보도는 1 + 재시도 상한 번까지만 나가고 짝은 나가지 않는다")
    func alternationIsBounded() {
        var ledger = OutingCrosswalkLedger()
        let curb = crosswalk("a", north: 12, probe: true)
        let center = crosswalk("a2", north: 25)
        var posts: [String: Int] = [:]
        for _ in 1...20 {
            if fix([curb, center], &ledger, suppressed: false) == .speak, let id = ledger.inFlight?.id {
                posts[id, default: 0] += 1
            }
            // 재시도 예약이 돌았다.
            if ledger.held != nil, let n = ledger.release(verdict: .speak, silencing: ["a2"]) {
                posts[n.id, default: 0] += 1
            }
            // 낸 것은 모두 끊긴다(가장 나쁜 경우).
            if let flight = ledger.inFlight {
                _ = ledger.dropped(OutingCrosswalkNotice(id: flight.id, hasAudioSignal: false), suppressed: false)
            }
        }
        #expect(posts == ["a": 1 + outingCrosswalkRetryLimit])
        #expect(ledger.spoken == ["a", "a2"])
        #expect(!ledger.busy)
    }

    @Test("막힌 동안 짝·다음 횡단보도가 fix마다 오가도 쥔 것은 처음 것 그대로이고 진동은 한 번이다")
    func heldDoesNotAlternateWhileSuppressed() {
        var ledger = OutingCrosswalkLedger()
        let curb = crosswalk("a", north: 12, probe: true)
        let center = crosswalk("a2", north: 25)
        let other = crosswalk("b", north: 29)
        let sets = [[curb, center], [center], [curb, center, other], [center, other], [other]]
        var vibrations = 0
        for i in 0..<25 where fix(sets[i % sets.count], &ledger, suppressed: true) == .vibrate { vibrations += 1 }
        #expect(vibrations == 1)
        #expect(ledger.held?.id == "a")
        #expect(ledger.vibrated == ["a"])
    }

    @Test("쥔 것을 낼지: 후보에 없으면 gone, 예고 범위와 오차 밖이면 far, 뒤쪽이 확실하면 behind, 위치를 모르면 말한다")
    func heldVerdict() {
        let fix = (lat: lat0, lng: lng0, accuracy: 5.0)
        let north = OutingHeading.stale(bearing: 0)
        #expect(outingHeldCrosswalkVerdict(fix: fix, heading: north, crosswalk: nil) == .gone)
        #expect(outingHeldCrosswalkVerdict(fix: fix, heading: north, crosswalk: crosswalk("a", north: 20)) == .speak)
        // 예고가 서는 가장 먼 점(앞 30m·옆 15m, 약 33.5m) + 오차 5m 안이면 말한다.
        #expect(outingHeldCrosswalkVerdict(fix: fix, heading: north, crosswalk: crosswalk("a", north: 38)) == .speak)
        #expect(outingHeldCrosswalkVerdict(fix: fix, heading: north, crosswalk: crosswalk("a", north: 40)) == .far)
        // 걸어 멀어진 것은 방향과 무관하다(방위 없음).
        #expect(outingHeldCrosswalkVerdict(fix: fix, heading: .none, crosswalk: crosswalk("a", north: -60)) == .far)
        #expect(outingHeldCrosswalkVerdict(fix: fix, heading: north, crosswalk: crosswalk("a", north: -25)) == .behind)
        #expect(outingHeldCrosswalkVerdict(fix: nil, heading: north, crosswalk: crosswalk("a", north: -25)) == .speak)
        #expect(outingHeldCrosswalkVerdict(
            fix: (lat: lat0, lng: lng0, accuracy: .infinity), heading: .none, crosswalk: crosswalk("a", north: 80)) == .speak)
    }

    @Test("뒤쪽이 확실한가: 마지막으로 알던 방위로 본다(지금 방위든 마지막 진행 방향이든)")
    func surelyBehindUsesLastKnownBearing() {
        let fix = (lat: lat0, lng: lng0, accuracy: 5.0)
        let behind = crosswalk("a", north: -25)
        let ahead = crosswalk("b", north: 25)
        #expect(outingCrosswalkSurelyBehind(fix: fix, heading: .valid(bearing: 0, uncertaintyDeg: 5), crosswalk: behind))
        // 사람은 물을 때 선다 — 정지해서 「마지막 진행 방향」만 남아도 그 방위로 본다.
        #expect(outingCrosswalkSurelyBehind(fix: fix, heading: .stale(bearing: 0), crosswalk: behind))
        #expect(!outingCrosswalkSurelyBehind(fix: fix, heading: .stale(bearing: 0), crosswalk: ahead))
        // 돌아서 있었다면(남쪽을 보고 걸었다면) 남쪽의 횡단보도는 앞이다.
        #expect(!outingCrosswalkSurelyBehind(fix: fix, heading: .stale(bearing: 180), crosswalk: behind))
    }

    @Test("모르면 뒤쪽이 아니다(말한다): 방위 없음·위치 없음·횡단보도 없음·오차 안")
    func unknownIsNotBehind() {
        let fix = (lat: lat0, lng: lng0, accuracy: 5.0)
        let behind = crosswalk("a", north: -25)
        #expect(!outingCrosswalkSurelyBehind(fix: fix, heading: .none, crosswalk: behind))
        #expect(!outingCrosswalkSurelyBehind(fix: nil, heading: .stale(bearing: 0), crosswalk: behind))
        #expect(!outingCrosswalkSurelyBehind(fix: fix, heading: .stale(bearing: 0), crosswalk: nil))
        // 뒤로 8m는 옆 띠(10m) 안이다.
        #expect(!outingCrosswalkSurelyBehind(fix: fix, heading: .stale(bearing: 0), crosswalk: crosswalk("c", north: -8)))
        // 뒤로 25m여도 위치 오차가 40m면 확실하지 않다. 오차를 모르면(무한대) 확실하지 않다.
        #expect(!outingCrosswalkSurelyBehind(
            fix: (lat: lat0, lng: lng0, accuracy: 40), heading: .stale(bearing: 0), crosswalk: behind))
        #expect(!outingCrosswalkSurelyBehind(
            fix: (lat: lat0, lng: lng0, accuracy: .infinity), heading: .stale(bearing: 0), crosswalk: behind))
    }
}
