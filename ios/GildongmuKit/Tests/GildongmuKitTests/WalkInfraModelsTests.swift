import Testing
import Foundation
@testable import GildongmuKit

// 보행 인프라 계약 테스트. 픽스처 3종 전부 프로덕션 실호출 캡처(2026-07-29, 강남·부산):
// walk-nearby.json(両소스 ok) · walk-nearby-degraded.json(osm error 부분 강등 200) ·
// walk-nearby-unsupported.json(서울 밖 — audio unsupported + osm error).

@Test func walkNearbyDecodesBothSourcesOk() throws {
    let envelope = try JSONDecoder().decode(WalkInfraEnvelope.self, from: fixture("walk-nearby"))
    guard case .ok(let audio) = envelope.walk.audioSignals else {
        Issue.record("audioSignals가 ok가 아님"); return
    }
    #expect(audio.deviceCount == 5)
    #expect(audio.sites.count == 5)
    #expect(audio.sites[0].distanceMeters == 183)
    #expect(audio.sites[0].bearing == "nw")
    #expect(audio.baseDate == "2026-05-28")

    guard case .ok(let osm) = envelope.walk.osm else {
        Issue.record("osm이 ok가 아님"); return
    }
    #expect(osm.listedCount == osm.features.count)
    #expect(osm.truncated)
    // cap 전 실개수는 절단 후 목록보다 크거나 같다(침묵 절단 금지 계약의 데이터 근거)
    #expect(osm.crossingTotal >= osm.crossings.count)
    #expect(osm.tactileTotal >= osm.tactiles.count)
    // projection 분리: crossing과 비-crossing tactile은 서로소(웹 filter 미러)
    #expect(osm.crossings.allSatisfy { $0.crossing })
    #expect(osm.tactiles.allSatisfy { !$0.crossing && $0.tactilePaving })
    // hostFeature는 옵셔널(실데이터에 부재 항목 존재) — 디코딩이 깨지지 않아야 한다
    #expect(osm.features.allSatisfy { $0.distanceMeters >= 0 })
}

/// 부분 강등: 한 소스 실패는 200으로 보존된다(両소스 독립, 3-state 불변식).
@Test func walkNearbyPreservesPartialFailure() throws {
    let envelope = try JSONDecoder().decode(WalkInfraEnvelope.self, from: fixture("walk-nearby-degraded"))
    guard case .ok = envelope.walk.audioSignals else {
        Issue.record("audioSignals가 ok가 아님"); return
    }
    guard case .error = envelope.walk.osm else {
        Issue.record("osm이 error가 아님"); return
    }
}

/// 서울 밖: 음향신호기는 unsupported(미제공 ≠ 실패, 다른 문구 분기 근거).
@Test func walkNearbyDecodesUnsupportedOutsideSeoul() throws {
    let envelope = try JSONDecoder().decode(WalkInfraEnvelope.self, from: fixture("walk-nearby-unsupported"))
    guard case .unsupported = envelope.walk.audioSignals else {
        Issue.record("audioSignals가 unsupported가 아님"); return
    }
}

/// 미지의 status는 웹 소비자와 동형으로 error 취급(신규 상태 추가에 크래시 금지).
@Test func walkSourceUnknownStatusFallsBackToError() throws {
    let json = #"{"walk":{"audioSignals":{"status":"future-new"},"osm":{"status":"error"}}}"#
    let envelope = try JSONDecoder().decode(WalkInfraEnvelope.self, from: Data(json.utf8))
    guard case .error = envelope.walk.audioSignals else {
        Issue.record("미지 status가 error로 강등되지 않음"); return
    }
}
