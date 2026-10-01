import Foundation
import Testing
@testable import GildongmuKit

// 나들이 판정 계층(spec 2026-09-26 §6·§5.1·§14) 단위 게이트.

private let baseLat = 37.5400
private let baseLng = 127.1400

/// 기준점에서 동쪽 east m, 북쪽 north m 떨어진 좌표.
private func point(east: Double, north: Double) -> (lat: Double, lng: Double) {
    let lat = baseLat + north / 111_320
    let lng = baseLng + east / (111_320 * cos(baseLat * .pi / 180))
    return (lat, lng)
}

/// 북쪽(0도)으로 걷는 중, 불확실성 10도.
private let northValid = OutingHeading.valid(bearing: 0, uncertaintyDeg: 10)

private func project(east: Double, north: Double, heading: OutingHeading = northValid, accuracy: Double = 5) -> OutingRelation {
    let p = point(east: east, north: north)
    return outingProject(fixLat: baseLat, fixLng: baseLng, accuracy: accuracy, heading: heading, placeLat: p.lat, placeLng: p.lng)
}

// MARK: - 방위 상태

@Suite("나들이 방위 상태")
struct OutingHeadingTests {
    let sample = DerivedCourse(bearing: 45, uncertaintyDeg: 12)

    @Test("표가 없으면 none")
    func none() {
        #expect(outingHeading(OutingHeadingState(), motion: .moving, now: 100) == .none)
    }

    @Test("이동 중 10초 안의 좋은 표면 valid")
    func valid() {
        let s = outingHeadingRecord(OutingHeadingState(), course: sample, at: 100)
        #expect(outingHeading(s, motion: .moving, now: 110) == .valid(bearing: 45, uncertaintyDeg: 12))
    }

    @Test("정지·속도 모름·나이 초과는 마지막 진행 방향(stale)")
    func stale() {
        let s = outingHeadingRecord(OutingHeadingState(), course: sample, at: 100)
        #expect(outingHeading(s, motion: .stopped, now: 101) == .stale(bearing: 45))
        #expect(outingHeading(s, motion: .speedUnknown, now: 101) == .stale(bearing: 45))
        #expect(outingHeading(s, motion: .moving, now: 110.1) == .stale(bearing: 45))
    }

    @Test("불확실성 초과 표는 valid가 아니고 마지막 좋은 방위를 덮지 않는다")
    func blurredDoesNotOverwrite() {
        var s = outingHeadingRecord(OutingHeadingState(), course: sample, at: 100)
        s = outingHeadingRecord(s, course: DerivedCourse(bearing: 120, uncertaintyDeg: 60), at: 102)
        #expect(outingHeading(s, motion: .moving, now: 102) == .stale(bearing: 45))
    }
}

// MARK: - 투영

@Suite("나들이 진행축 투영")
struct OutingProjectionTests {
    @Test("앞·옆·뒤 경계는 ±10m")
    func zones() {
        #expect(project(east: 0, north: 10.5).zone == .ahead)
        #expect(project(east: 0, north: 9.5).zone == .beside)
        #expect(project(east: 0, north: -9.5).zone == .beside)
        #expect(project(east: 0, north: -10.5).zone == .behind)
    }

    @Test("부호: 진행 방향 오른쪽이 +t, right")
    func sides() {
        let right = project(east: 20, north: 0)
        #expect(right.t > 19 && right.side == .right)
        let left = project(east: -20, north: 0)
        #expect(left.t < -19 && left.side == .left)
    }

    @Test("동쪽으로 걸으면 남쪽이 오른쪽")
    func rotated() {
        let r = project(east: 0, north: -20, heading: .valid(bearing: 90, uncertaintyDeg: 10))
        #expect(r.side == .right)
        #expect(abs(r.s) < 1)
    }

    @Test("횡거리가 정확도 이하이면 좌우 unknown")
    func accuracyMargin() {
        #expect(project(east: 6, north: 30, accuracy: 10).side == .unknown)
        #expect(project(east: 11, north: 30, accuracy: 10).side == .right)
    }

    @Test("횡거리가 d·sin U 이하이면 좌우 unknown")
    func uncertaintyMargin() {
        // d≈40, U=30 → 여유 20m. t=15는 부호를 믿을 수 없다.
        let r = project(east: 15, north: 37, heading: .valid(bearing: 0, uncertaintyDeg: 30), accuracy: 3)
        #expect(r.side == .unknown)
        let r2 = project(east: 25, north: 30, heading: .valid(bearing: 0, uncertaintyDeg: 30), accuracy: 3)
        #expect(r2.side == .right)
    }

    @Test("방위가 valid가 아니면 전부 옆·unknown이고 판정 방위가 없다")
    func notValid() {
        for h in [OutingHeading.none, .stale(bearing: 0)] {
            let r = project(east: 0, north: 50, heading: h)
            #expect(r.zone == .beside)
            #expect(r.side == .unknown)
            #expect(r.validBearing == nil)
            #expect(r.d > 49)
        }
    }
}

// MARK: - 지나침

@Suite("나들이 지나침 판정")
struct OutingPassByTests {
    func candidate(_ id: String, prev: OutingRelation?, cur: OutingRelation) -> OutingPassByCandidate {
        OutingPassByCandidate(id: id, previous: prev, current: cur)
    }

    @Test("앞에서 옆으로 넘어가면 말한다")
    func aheadToBeside() {
        let r = outingPassByStep(candidates: [
            candidate("a", prev: project(east: -8, north: 12), cur: project(east: -8, north: 3)),
        ], spoken: [])
        #expect(r.spoken == "a")
    }

    @Test("앞에서 뒤로 한 번에 넘어가도 말한다")
    func aheadToBehind() {
        let r = outingPassByStep(candidates: [
            candidate("a", prev: project(east: 5, north: 12), cur: project(east: 5, north: -12)),
        ], spoken: [])
        #expect(r.spoken == "a")
    }

    @Test("횡거리 40m 경계")
    func lateralBound() {
        let inside = outingPassByStep(candidates: [
            candidate("a", prev: project(east: 39, north: 12), cur: project(east: 39, north: 0)),
        ], spoken: [])
        #expect(inside.spoken == "a")
        let outside = outingPassByStep(candidates: [
            candidate("a", prev: project(east: 41, north: 12), cur: project(east: 41, north: 0)),
        ], spoken: [])
        #expect(outside.spoken == nil)
    }

    @Test("이미 말한 장소는 다시 말하지 않는다")
    func dedupe() {
        let r = outingPassByStep(candidates: [
            candidate("a", prev: project(east: 5, north: 12), cur: project(east: 5, north: 0)),
        ], spoken: ["a"])
        #expect(r.spoken == nil)
    }

    @Test("동시 후보는 가장 가까운 하나만, 나머지는 침묵 목록")
    func nearestOnly() {
        let r = outingPassByStep(candidates: [
            candidate("far", prev: project(east: 30, north: 12), cur: project(east: 30, north: 0)),
            candidate("near", prev: project(east: 5, north: 12), cur: project(east: 5, north: 0)),
        ], spoken: [])
        #expect(r.spoken == "near")
        #expect(r.silenced == ["far"])
    }

    @Test("앞이 아니었던 장소(옆에서 시작)는 말하지 않는다")
    func neverAhead() {
        let r = outingPassByStep(candidates: [
            candidate("a", prev: project(east: 5, north: 5), cur: project(east: 5, north: -5)),
            candidate("b", prev: nil, cur: project(east: 5, north: 0)),
        ], spoken: [])
        #expect(r.spoken == nil)
    }

    @Test("방위를 잃은 fix에서는 앞의 장소가 옆으로 떨어져도 0")
    func headingLost() {
        let r = outingPassByStep(candidates: [
            candidate("a", prev: project(east: 5, north: 40), cur: project(east: 5, north: 40, heading: .stale(bearing: 0))),
        ], spoken: [])
        #expect(r.spoken == nil)
    }

    @Test("방위를 되찾은 첫 fix도 0(직전 관계가 valid가 아니다)")
    func headingRegained() {
        let r = outingPassByStep(candidates: [
            candidate("a", prev: project(east: 5, north: 40, heading: .none), cur: project(east: 5, north: 0)),
        ], spoken: [])
        #expect(r.spoken == nil)
    }

    @Test("180도 반전 fix에서 앞의 전부가 뒤로 넘어가도 0")
    func reversal() {
        let back = OutingHeading.valid(bearing: 180, uncertaintyDeg: 10)
        let r = outingPassByStep(candidates: [
            candidate("a", prev: project(east: 5, north: 30), cur: project(east: 5, north: 30, heading: back)),
        ], spoken: [])
        #expect(r.spoken == nil)
    }

    @Test("45도 넘는 회전 fix는 0, 45도 이하는 판정")
    func turnBound() {
        let turned = OutingHeading.valid(bearing: 50, uncertaintyDeg: 10)
        let r = outingPassByStep(candidates: [
            candidate("a", prev: project(east: 5, north: 12), cur: project(east: 5, north: 0, heading: turned)),
        ], spoken: [])
        #expect(r.spoken == nil)
        let slight = OutingHeading.valid(bearing: 40, uncertaintyDeg: 10)
        let r2 = outingPassByStep(candidates: [
            candidate("a", prev: project(east: 5, north: 12), cur: project(east: -8, north: -8, heading: slight)),
        ], spoken: [])
        #expect(r2.spoken == "a")
    }
}

// MARK: - 도로명

@Suite("나들이 도로명 변경")
struct OutingRoadNameTests {
    @Test("주소 문자열에서 도로명 토큰(ko·en), 지번은 nil")
    func extract() {
        #expect(outingRoadName(fromAddress: "서울 강동구 천호대로 1095") == "천호대로")
        #expect(outingRoadName(fromAddress: "서울특별시 강동구 양재대로123길 45 (길동)") == "양재대로123길")
        #expect(outingRoadName(fromAddress: "서울 종로구 종로 1") == "종로")
        #expect(outingRoadName(fromAddress: "서울 강동구 길동 123-4") == nil)
        #expect(outingRoadName(fromAddress: "1095 Cheonho-daero, Gangdong-gu, Seoul") == "Cheonho-daero")
        #expect(outingRoadName(fromAddress: "45 Yangjae-daero 123-gil, Seoul") == "Yangjae-daero 123-gil")
        #expect(outingRoadName(fromAddress: "7 Olympic-ro 35ga-gil, Seoul") == "Olympic-ro")
        #expect(outingRoadName(fromAddress: "Gil-dong, Gangdong-gu, Seoul") == nil)
    }

    @Test("첫 확정은 말하지 않고, 변경은 두 번 연속에서 확정해 한 번 말한다")
    func confirmTwice() {
        let here = RoutePoint(lat: baseLat, lng: baseLng)
        var s = OutingRoadState()
        var out = outingRoadNameStep(s, observed: "천호대로", at: here)
        #expect(out.announce == nil && out.state.confirmed == "천호대로")
        s = out.state
        out = outingRoadNameStep(s, observed: "양재대로", at: here)
        #expect(out.announce == nil && out.state.confirmed == "천호대로")
        s = out.state
        out = outingRoadNameStep(s, observed: "양재대로", at: here)
        #expect(out.announce == "양재대로" && out.state == OutingRoadState(confirmed: "양재대로"))
        s = out.state
        out = outingRoadNameStep(s, observed: "양재대로", at: here)
        #expect(out.announce == nil)
    }

    @Test("한 번 튄 값이 돌아오면 말하지 않는다, 100m 안의 토큰 없는 응답은 상태 불변")
    func flap() {
        let here = RoutePoint(lat: baseLat, lng: baseLng)
        let near = point(east: 0, north: -99.9)
        var s = OutingRoadState(confirmed: "천호대로")
        s = outingRoadNameStep(s, observed: "양재대로", at: here).state
        let back = outingRoadNameStep(s, observed: "천호대로", at: here)
        #expect(back.announce == nil && back.state == OutingRoadState(confirmed: "천호대로"))
        let none = outingRoadNameStep(s, observed: nil, at: RoutePoint(lat: near.lat, lng: near.lng))
        #expect(none.state == s && none.announce == nil)
        // 보류가 없으면 지번 응답은 얼마를 걸어도 아무것도 바꾸지 않는다.
        let far = point(east: 0, north: -500)
        let idle = outingRoadNameStep(OutingRoadState(confirmed: "천호대로"), observed: nil, at: RoutePoint(lat: far.lat, lng: far.lng))
        #expect(idle.state == OutingRoadState(confirmed: "천호대로") && idle.announce == nil)
    }

    @Test("새 도로명을 본 자리에서 100m 이상 걷는 동안 지번만 오면 확정한다(지번은 반대 증거가 아니다)")
    func confirmByDistanceOverJibun() {
        let here = RoutePoint(lat: baseLat, lng: baseLng)
        var s = outingRoadNameStep(OutingRoadState(confirmed: "명일로24길"), observed: "천중로", at: here).state
        #expect(s.pending == "천중로" && s.pendingAt == here)
        let p99 = point(east: 0, north: -99)
        var out = outingRoadNameStep(s, observed: nil, at: RoutePoint(lat: p99.lat, lng: p99.lng))
        #expect(out.announce == nil && out.state == s)
        s = out.state
        let p101 = point(east: 0, north: -101)
        out = outingRoadNameStep(s, observed: nil, at: RoutePoint(lat: p101.lat, lng: p101.lng))
        #expect(out.announce == "천중로" && out.state == OutingRoadState(confirmed: "천중로"))
        // 확정 뒤 지번은 다시 아무것도 말하지 않는다.
        let p200 = point(east: 0, north: -200)
        let after = outingRoadNameStep(out.state, observed: nil, at: RoutePoint(lat: p200.lat, lng: p200.lng))
        #expect(after.announce == nil && after.state == out.state)
    }

    @Test("보류 중 다른 도로명이 오면 그 값과 그 자리로 보류를 바꾼다")
    func pendingReplacedResetsAnchor() {
        let here = RoutePoint(lat: baseLat, lng: baseLng)
        let p80 = point(east: 0, north: 80)
        let at80 = RoutePoint(lat: p80.lat, lng: p80.lng)
        var s = outingRoadNameStep(OutingRoadState(confirmed: "천호대로"), observed: "양재대로", at: here).state
        s = outingRoadNameStep(s, observed: "천중로", at: at80).state
        #expect(s == OutingRoadState(confirmed: "천호대로", pending: "천중로", pendingAt: at80))
        // 처음 보류한 자리에서는 120m지만 새 보류 자리에서는 40m — 확정하지 않는다.
        let p120 = point(east: 0, north: 120)
        let out = outingRoadNameStep(s, observed: nil, at: RoutePoint(lat: p120.lat, lng: p120.lng))
        #expect(out.announce == nil && out.state == s)
    }

    @Test("실보행 재생: 새 도로명 뒤 지번 셋 — 종전 확정 0, 이제 100m 뒤 지번에서 확정")
    func replayJibunRun() {
        // guide-diag-2026-10-02.log.gz 나들이 세션의 실제 재조회 지점(종전 100m 간격)과 그 좌표의 `/api/geocode/reverse`
        // 응답을 첫 지점 기준 상대 오프셋(m)으로 옮겼다(익명화 — 거리만 쓴다). 새 도로를 따라 걷는 동안 지번만 왔다.
        let seq: [(east: Double, north: Double, value: String?)] = [
            (0, 0, "명일로24길"),
            (-6, -101, "명일로24길"),
            (-65, -184, "천중로"),
            (-60, -285, nil),
            (-68, -386, nil),
            (-90, -484, nil),
        ]
        var s = OutingRoadState()
        var spoken: [String] = []
        for step in seq {
            let p = point(east: step.east, north: step.north)
            let out = outingRoadNameStep(s, observed: step.value, at: RoutePoint(lat: p.lat, lng: p.lng))
            s = out.state
            if let a = out.announce { spoken.append(a) }
        }
        #expect(spoken == ["천중로"])
        #expect(s == OutingRoadState(confirmed: "천중로"))
    }

    @Test("재조회 50m 하나가 지번이면 아직 확정하지 않는다 — 모퉁이에서 한 번 튄 교차 도로명이 다음 지번 하나로 굳지 않게")
    func cornerFlapNeedsTwoRequeries() {
        let here = RoutePoint(lat: baseLat, lng: baseLng)
        var s = outingRoadNameStep(OutingRoadState(confirmed: "천호대로"), observed: "성내로6길", at: here).state
        let p50 = point(east: 0, north: 50)
        var out = outingRoadNameStep(s, observed: nil, at: RoutePoint(lat: p50.lat, lng: p50.lng))
        #expect(out.announce == nil && out.state == s)
        // 그다음 재조회가 원래 도로를 주면 보류를 버린다.
        let p100 = point(east: 0, north: 100)
        out = outingRoadNameStep(s, observed: "천호대로", at: RoutePoint(lat: p100.lat, lng: p100.lng))
        #expect(out.announce == nil && out.state == OutingRoadState(confirmed: "천호대로"))
        // 지번이 한 번 더 오면(두 번째 재조회, 100m 넘어) 그때 확정한다.
        s = outingRoadNameStep(OutingRoadState(confirmed: "천호대로"), observed: "성내로6길", at: here).state
        let p101 = point(east: 0, north: 101)
        out = outingRoadNameStep(s, observed: nil, at: RoutePoint(lat: p101.lat, lng: p101.lng))
        #expect(out.announce == "성내로6길")
    }
}

// MARK: - 재조회·주변 상태

@Suite("나들이 재조회")
struct OutingRequeryTests {
    @Test("첫 조회는 참, 50m 경계")
    func distance() {
        let a = RoutePoint(lat: baseLat, lng: baseLng)
        #expect(outingRequeryStep(lastQuery: nil, fix: a, lastFailureAt: nil, now: 0))
        let p49 = point(east: 0, north: 49)
        let p51 = point(east: 0, north: 51)
        #expect(!outingRequeryStep(lastQuery: a, fix: RoutePoint(lat: p49.lat, lng: p49.lng), lastFailureAt: nil, now: 0))
        #expect(outingRequeryStep(lastQuery: a, fix: RoutePoint(lat: p51.lat, lng: p51.lng), lastFailureAt: nil, now: 0))
    }

    @Test("실패한 조회는 제자리에서도 20초 뒤 다시 조회한다")
    func retryAfterFailure() {
        let a = RoutePoint(lat: baseLat, lng: baseLng)
        #expect(!outingRequeryStep(lastQuery: a, fix: a, lastFailureAt: 100, now: 119.9))
        #expect(outingRequeryStep(lastQuery: a, fix: a, lastFailureAt: 100, now: 120))
        #expect(!outingRequeryStep(lastQuery: a, fix: a, lastFailureAt: nil, now: 500))
    }

    @Test("실패는 세 번째에 failed, 그 전엔 직전 상태 유지, 성공은 계수 초기화")
    func failures() {
        var st = outingSurroundingsStep(status: .ready, failures: 0, result: .failure)
        #expect(st.status == .ready && st.failures == 1)
        st = outingSurroundingsStep(status: st.status, failures: st.failures, result: .failure)
        #expect(st.status == .ready)
        st = outingSurroundingsStep(status: st.status, failures: st.failures, result: .failure)
        #expect(st.status == .failed)
        st = outingSurroundingsStep(status: st.status, failures: st.failures, result: .success)
        #expect(st == (.ready, 0))
        let loading = outingSurroundingsStep(status: .loading, failures: 0, result: .failure)
        #expect(loading.status == .loading)
        #expect(outingSurroundingsStep(status: .ready, failures: 2, result: .outOfCoverage) == (.outOfCoverage, 0))
    }
}

// MARK: - 비프·이정표·출발점

@Suite("나들이 비프·이정표·출발점")
struct OutingMiscTests {
    @Test("10m 경계·20m 점프·역행 0")
    func beep() {
        #expect(outingDistanceToneStep(previousMeters: 9.9, currentMeters: 10) == 1)
        #expect(outingDistanceToneStep(previousMeters: 10, currentMeters: 19.9) == 0)
        #expect(outingDistanceToneStep(previousMeters: 5, currentMeters: 25) == 2)
        #expect(outingDistanceToneStep(previousMeters: 30, currentMeters: 20) == 0)
        #expect(outingDistanceToneStep(previousMeters: .nan, currentMeters: 20) == 0)
        #expect(outingQuantizedMeters(327.4) == 320)
        #expect(outingQuantizedMeters(-3) == 0)
    }

    @Test("걸은 거리 표시는 1m 내림이고 비프 경계와 어긋나지 않는다(E54)")
    func displayMeters() {
        #expect(outingDisplayMeters(327.9) == 327)
        #expect(outingDisplayMeters(9.99) == 9)
        #expect(outingDisplayMeters(-3) == 0)
        #expect(outingDisplayMeters(.infinity) == 0)
        #expect(outingDisplayMeters(.nan) == 0)
        // 비프가 나는 순간 표시 숫자는 그 비프의 10m 칸에 있다(표시가 칸을 앞지르거나 뒤처지지 않는다).
        for m in stride(from: 0.3, through: 60, by: 0.7) where outingDistanceToneStep(previousMeters: m - 0.7, currentMeters: m) > 0 {
            #expect(outingDisplayMeters(m) / 10 * 10 == outingQuantizedMeters(m))
        }
    }

    @Test("이정표 표는 카테고리 키로만")
    func tiers() {
        for k in ["subway", "public", "hospital", "attraction", "school"] { #expect(outingLandmarkTier(category: k) == .landmark) }
        // 18종 중 나머지(E58 ②로 새로 오는 일곱 포함)와 미지 키는 가게.
        for k in ["convenience", "restaurant", "cafe", "bank", "pharmacy", "mart",
                  "kindergarten", "academy", "parking", "gasStation", "culture", "realEstate", "lodging", "unknown"] {
            #expect(outingLandmarkTier(category: k) == .shop)
        }
        #expect(!OutingNarration.off.speaks(.landmark))
        #expect(OutingNarration.landmarks.speaks(.landmark) && !OutingNarration.landmarks.speaks(.shop))
        #expect(OutingNarration.all.speaks(.shop))
        #expect(OutingNarration.default == .all)
        // 순환: 전부 → 이정표만 → 끔 → 전부(E54 위원장 판정). 세 번 누르면 제자리.
        #expect(OutingNarration.all.next == .landmarks)
        #expect(OutingNarration.landmarks.next == .off)
        #expect(OutingNarration.off.next == .all)
        for option in OutingNarration.allCases { #expect(option.next.next.next == option) }
    }

    func fix(_ acc: Double, age: Double = 1) -> RouteOriginFix {
        RouteOriginFix(lat: baseLat, lng: baseLng, accuracy: acc, ageSeconds: age)
    }

    @Test("수용 fix(30m 이하)는 즉시 확정")
    func acceptImmediately() {
        #expect(outingOriginStep(best: nil, fix: fix(12), elapsedSeconds: 2) == .confirm(fix(12)))
    }

    @Test("창 안에서는 최선 후보를 보관하고 창이 끝나면 그것으로")
    func windowBest() {
        var d = outingOriginStep(best: nil, fix: fix(80), elapsedSeconds: 3)
        #expect(d == .wait(best: fix(80)))
        d = outingOriginStep(best: fix(80), fix: fix(50), elapsedSeconds: 10)
        #expect(d == .wait(best: fix(50)))
        d = outingOriginStep(best: fix(50), fix: fix(70), elapsedSeconds: 20)
        #expect(d == .wait(best: fix(50)))
        #expect(outingOriginStep(best: fix(50), fix: nil, elapsedSeconds: 30) == .confirm(fix(50)))
    }

    @Test("100m 넘는 fix는 후보가 아니고, 창이 끝나도 후보가 없으면 계속 기다린다")
    func noCandidate() {
        #expect(outingOriginStep(best: nil, fix: fix(1500), elapsedSeconds: 31) == .wait(best: nil))
        #expect(outingOriginStep(best: nil, fix: fix(60), elapsedSeconds: 40) == .confirm(fix(60)))
        #expect(outingOriginStep(best: nil, fix: fix(20, age: 30), elapsedSeconds: 5) == .wait(best: nil))
    }
}

// MARK: - 횡단보도 예고

@Suite("나들이 횡단보도 예고")
struct OutingCrosswalkTests {
    func crosswalk(_ id: String, east: Double, north: Double, heading: OutingHeading = northValid)
        -> (crosswalk: OutingCrosswalk, relation: OutingRelation)
    {
        let p = point(east: east, north: north)
        return (OutingCrosswalk(id: id, lat: p.lat, lng: p.lng), project(east: east, north: north, heading: heading))
    }

    @Test("앞 30m 안·횡거리 15m 안이면 예고, 밖이면 없음")
    func bounds() {
        #expect(outingCrosswalkNoticeStep(crosswalks: [crosswalk("a", east: 3, north: 29)], audioSignals: [], spoken: [])?.id == "a")
        #expect(outingCrosswalkNoticeStep(crosswalks: [crosswalk("a", east: 3, north: 31)], audioSignals: [], spoken: []) == nil)
        #expect(outingCrosswalkNoticeStep(crosswalks: [crosswalk("a", east: 16, north: 20)], audioSignals: [], spoken: []) == nil)
        #expect(outingCrosswalkNoticeStep(crosswalks: [crosswalk("a", east: 0, north: -5)], audioSignals: [], spoken: []) == nil)
    }

    @Test("방위가 valid가 아니면 예고하지 않는다, 이미 예고한 id도")
    func guards() {
        #expect(outingCrosswalkNoticeStep(
            crosswalks: [crosswalk("a", east: 0, north: 20, heading: .stale(bearing: 0))], audioSignals: [], spoken: []) == nil)
        #expect(outingCrosswalkNoticeStep(crosswalks: [crosswalk("a", east: 0, north: 20)], audioSignals: [], spoken: ["a"]) == nil)
    }

    @Test("가장 가까운 하나, 음향신호기는 노드 20m 안 격자점만 짝짓는다")
    func nearestAndAudio() {
        let near = point(east: 0, north: 15)
        let signalNear = point(east: 5, north: 25)
        let signalFar = point(east: 0, north: 40)
        let n = outingCrosswalkNoticeStep(
            crosswalks: [crosswalk("far", east: 0, north: 28), crosswalk("near", east: 0, north: 15)],
            audioSignals: [RoutePoint(lat: signalFar.lat, lng: signalFar.lng)], spoken: [])
        #expect(n == OutingCrosswalkNotice(id: "near", hasAudioSignal: false))
        let paired = outingCrosswalkNoticeStep(
            crosswalks: [crosswalk("near", east: 0, north: 15)],
            audioSignals: [RoutePoint(lat: near.lat + 0.00005, lng: near.lng), RoutePoint(lat: signalNear.lat, lng: signalNear.lng)],
            spoken: [])
        #expect(paired?.hasAudioSignal == true)
    }

    @Test("walk/nearby 응답의 좌표는 선택 필드로 디코딩된다(옵트인·기본 모두)")
    func decode() throws {
        let json = """
        {"osmId":"node/1","crossing":true,"crossingSignal":"yes","tactilePaving":false,"distanceMeters":12,"bearing":"n","lat":37.5,"lng":127.1}
        """
        let f = try JSONDecoder().decode(WalkFeature.self, from: Data(json.utf8))
        #expect(f.lat == 37.5 && f.lng == 127.1)
        let site = try JSONDecoder().decode(AudioSignalSite.self, from: Data(#"{"distanceMeters":3,"bearing":"e","deviceCount":2}"#.utf8))
        #expect(site.lat == nil)
    }
}

// MARK: - 나들이 주변 조회(E58 ②)

// StubURLProtocol.handler 공유 상태를 쓰므로 StubNetworkTests 직렬 스위트에 편입.
extension StubNetworkTests {
    @Test func outingSurroundingsRequestsAllGroupsAndOutingLimit() async throws {
        var capturedPath: String?
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedPath = request.url?.path
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"places":[]}"#.utf8))
        }
        _ = try await NearbyService(client: stubbedClient()).outingSurroundings(lat: 37.5, lng: 127.0)
        #expect(capturedPath == "/api/places/around")
        #expect(capturedQuery?.contains(where: { $0.name == "groups" && $0.value == "all" }) == true)
        #expect(capturedQuery?.contains(where: { $0.name == "limit" && $0.value == "100" }) == true)
    }

    /// 대조: 내 주변 둘러보기는 groups를 보내지 않는다(10종 기본 응답 그대로).
    @Test func surroundingsDoesNotRequestGroups() async throws {
        var capturedQuery: [URLQueryItem]?
        StubURLProtocol.handler = { request in
            capturedQuery = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            return (200, Data(#"{"places":[]}"#.utf8))
        }
        _ = try await NearbyService(client: stubbedClient()).surroundings(lat: 37.5, lng: 127.0)
        #expect(capturedQuery?.contains(where: { $0.name == "groups" }) == false)
    }
}
