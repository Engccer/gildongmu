import Testing
@testable import GildongmuKit

@Suite("나들이 받아쓰기 중 횡단보도 경고")
struct OutingCrosswalkHoldTests {
    private let lat0 = 37.5
    private let lng0 = 127.0
    private let metersPerDegLat = 111_320.0

    /// 기준점에서 북쪽으로 `north`미터 떨어진 횡단보도.
    private func crosswalk(_ id: String, north: Double) -> OutingCrosswalk {
        OutingCrosswalk(id: id, lat: lat0 + north / metersPerDegLat, lng: lng0, fromProbe: false)
    }

    private func notice(_ id: String) -> OutingCrosswalkNotice {
        OutingCrosswalkNotice(id: id, hasAudioSignal: false)
    }

    /// 북쪽을 보고 걷는 사람이 기준점에서 본 예고 판정(`spoken`은 장부의 것).
    private func step(_ crosswalks: [OutingCrosswalk], ledger: OutingCrosswalkLedger) -> OutingCrosswalkNotice? {
        let pairs = crosswalks.map { c in
            (crosswalk: c, relation: outingProject(
                fixLat: lat0, fixLng: lng0, accuracy: 5, heading: .valid(bearing: 0, uncertaintyDeg: 5),
                placeLat: c.lat, placeLng: c.lng))
        }
        return outingCrosswalkNoticeStep(crosswalks: pairs, audioSignals: [], spoken: ledger.spoken)
    }

    @Test("막히지 않았으면 그 자리에서 말하고 표시를 세운다(근접 짝 포함)")
    func speaksWhenOpen() {
        var ledger = OutingCrosswalkLedger()
        do { let result = ledger.notice(notice("a"), silencing: ["a2"], suppressed: false); #expect(result == .speak) }
        #expect(ledger.spoken == ["a", "a2"])
        #expect(ledger.held == nil)
        #expect(ledger.vibrated.isEmpty)
    }

    @Test("막힌 동안: 진동은 한 번, 문장은 쥐고, 「말했다」 표시는 서지 않는다")
    func holdsWhileSuppressed() {
        var ledger = OutingCrosswalkLedger()
        let ahead = crosswalk("a", north: 20)
        let first = step([ahead], ledger: ledger)
        #expect(first?.id == "a")
        do { let result = ledger.notice(notice("a"), silencing: [], suppressed: true); #expect(result == .vibrate) }
        // 표시가 먼저 서면 문장 없이 「말한 횡단보도」가 된다 — 다음 fix에도 예고 후보로 남아 있어야 한다.
        #expect(ledger.spoken.isEmpty)
        #expect(step([ahead], ledger: ledger)?.id == "a")
        // 받아쓰기 준비가 길어져 같은 예고가 fix마다 와도 진동은 한 번이고 쥔 것은 그대로다(V26).
        for _ in 1...30 {
            do { let result = ledger.notice(notice("a"), silencing: [], suppressed: true); #expect(result == .hold) }
        }
        #expect(ledger.held == notice("a"))
        #expect(ledger.spoken.isEmpty)
    }

    @Test("풀리면 한 번 내놓고 그때 표시를 세운다 — 두 번 내놓지 않고 다음 fix가 다시 예고하지도 않는다")
    func releasesOnce() {
        var ledger = OutingCrosswalkLedger()
        let ahead = crosswalk("a", north: 20)
        _ = ledger.notice(notice("a"), silencing: [], suppressed: true)
        do { let result = ledger.release(surelyBehind: false, silencing: ["a2"]) == notice("a"); #expect(result) }
        #expect(ledger.spoken == ["a", "a2"])
        #expect(ledger.held == nil)
        do { let result = ledger.release(surelyBehind: false, silencing: []); #expect(result == nil) }
        #expect(step([ahead], ledger: ledger) == nil)
    }

    @Test("쥔 것이 없으면 풀려도 아무것도 내놓지 않는다")
    func releaseWithoutHold() {
        var ledger = OutingCrosswalkLedger()
        do { let result = ledger.release(surelyBehind: false, silencing: []); #expect(result == nil) }
        _ = ledger.notice(notice("a"), silencing: [], suppressed: false)
        do { let result = ledger.release(surelyBehind: false, silencing: []); #expect(result == nil) }
    }

    @Test("풀릴 때 뒤쪽이 확실하면 말하지 않고 표시도 세우지 않는다 — 돌아서서 다가가면 다시 예고한다")
    func skipsWhenSurelyBehind() {
        var ledger = OutingCrosswalkLedger()
        _ = ledger.notice(notice("a"), silencing: [], suppressed: true)
        do { let result = ledger.release(surelyBehind: true, silencing: ["a2"]); #expect(result == nil) }
        #expect(ledger.held == nil)
        #expect(ledger.spoken.isEmpty)
        #expect(step([crosswalk("a", north: 20)], ledger: ledger)?.id == "a")
        do { let result = ledger.notice(notice("a"), silencing: [], suppressed: false); #expect(result == .speak) }
    }

    @Test("진동 표시는 「말했다」 표시와 따로다 — 같은 횡단보도는 다시 막혀도 진동을 한 번만 낸다")
    func vibrationMarkIsSeparate() {
        var ledger = OutingCrosswalkLedger()
        do { let result = ledger.notice(notice("a"), silencing: [], suppressed: true); #expect(result == .vibrate) }
        #expect(ledger.vibrated == ["a"])
        #expect(ledger.spoken.isEmpty)
        do { let result = ledger.release(surelyBehind: true, silencing: []); #expect(result == nil) }
        do { let result = ledger.notice(notice("a"), silencing: [], suppressed: true); #expect(result == .hold) }
        // 다른 횡단보도는 따로 진동하고, 쥔 것은 최신으로 바뀐다.
        do { let result = ledger.notice(notice("b"), silencing: [], suppressed: true); #expect(result == .vibrate) }
        #expect(ledger.held == notice("b"))
    }

    @Test("낸 문장이 막힘 때문에 버려지면 다시 쥐었다가 풀릴 때 한 번 말한다")
    func droppedSentenceIsHeldAgain() {
        var ledger = OutingCrosswalkLedger()
        do { let result = ledger.notice(notice("a"), silencing: [], suppressed: false); #expect(result == .speak) }
        do { let result = ledger.droppedWhileSuppressed(notice("a")); #expect(result) }
        #expect(ledger.held == notice("a"))
        do { let result = ledger.release(surelyBehind: false, silencing: []) == notice("a"); #expect(result) }
        do { let result = ledger.release(surelyBehind: false, silencing: []); #expect(result == nil) }
    }

    @Test("막히지 않은 채 말하면 쥐고 있던 것은 내려놓는다 — 풀릴 때 한 번 더 말하지 않는다")
    func speakingClearsHold() {
        var ledger = OutingCrosswalkLedger()
        _ = ledger.notice(notice("a"), silencing: [], suppressed: true)
        do { let result = ledger.notice(notice("a"), silencing: [], suppressed: false); #expect(result == .speak) }
        do { let result = ledger.release(surelyBehind: false, silencing: []); #expect(result == nil) }
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
