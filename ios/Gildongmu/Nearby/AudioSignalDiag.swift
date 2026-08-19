import Foundation

// 음향신호기 BLE 진단 로그(spec 2026-08-17 §7). 콘솔 + 공용 DiagFileLog
// (Documents/audio-signal-diag.log). 이 파일이 걸음의 실제 산출물이다: 회수는
// `xcrun devicectl device copy from --domain-type appDataContainer`.
// ⚠ Experimental 구성은 DEBUG를 정의하지 않으므로 게이트에 EXPERIMENTAL 명시 필수.
// 진단 UI와 함께 버려지는 층이다(제품은 이 로그를 쓰지 않는다).

#if DEBUG || EXPERIMENTAL
/// ISO8601DateFormatter는 문서상 스레드 안전 — 컴파일러가 Sendable을 증명 못 해
/// unsafe 표기만 붙인다(GuideDiag 동형).
private nonisolated(unsafe) let audioSignalDiagDateFormatter = ISO8601DateFormatter()

/// 한 줄 = `ISO8601 | event | mac | rssi | localName | peripheralName | advServiceUUIDs |
/// 좌표 | seed최근접거리(m 정수) | 비고 | peripheralId앞8자 | manufacturer(회사ID:길이) |
/// connectable`(spec §7, 뒤 3열은 2026-08-20 1차 실측 뒤 추가 — 무명 기기를 가를 식별자가
/// 없어 "이름 없는 모듈" 가설을 로그로 못 갈랐다. 옛 로그는 10열이라 **뒤에 붙인다**).
/// 빈 칸은 `-`. 파이프 구분·한 이벤트 한 줄이라 필드 안의 `|`와 개행(여러 줄
/// localizedDescription)은 치환한다.
struct AudioSignalDiagLine {
    var event: String
    var mac: String? = nil
    var rssi: Int? = nil
    var localName: String? = nil
    var peripheralName: String? = nil
    var advServiceUUIDs: [String]? = nil
    var coordinate: (lat: Double, lng: Double)? = nil
    var seedNearestMeters: Int? = nil
    var note: String? = nil
    var peripheralId: UUID? = nil
    /// 회사 ID 16진 4자리 + 바이트 길이(예 `004C:25`). manufacturer data 부재는 `-`.
    var manufacturer: String? = nil
    var connectable: Bool? = nil

    var rendered: String {
        let fields: [String] = [
            audioSignalDiagDateFormatter.string(from: Date()),
            event,
            mac ?? "-",
            rssi.map(String.init) ?? "-",
            localName ?? "-",
            peripheralName ?? "-",
            advServiceUUIDs.map { $0.isEmpty ? "(none)" : $0.joined(separator: ",") } ?? "-",
            coordinate.map { String(format: "%.6f,%.6f", $0.lat, $0.lng) } ?? "-",
            seedNearestMeters.map(String.init) ?? "-",  // 미터 정수 원값(분석용, 단위 없음)
            note ?? "-",
            peripheralId.map { String($0.uuidString.prefix(8)) } ?? "-",
            manufacturer ?? "-",
            connectable.map { $0 ? "conn" : "nonconn" } ?? "-",
        ]
        return fields
            .map { $0.replacingOccurrences(of: "|", with: "/").replacingOccurrences(of: "\n", with: " ") }
            .joined(separator: " | ")
    }
}

nonisolated func audioSignalDiagLog(_ line: AudioSignalDiagLine) {
    let text = "[AudioSignalDiag] " + line.rendered
    print(text)
    DiagFileLog.audioSignal.append(text)
}
#endif
