import Foundation

// 음향신호기 BLE 프로토콜 — 순수 층(spec 2026-08-17 §3.1).
// 규격서 「시각장애인용 음향신호기 규격서」(경찰청 2022.4.27) Ⅶ (다)의 이름·명령·응답을
// 바이트 그대로 옮긴 것이고, 파싱본은 `docs/research/refs/police-audio-signal-spec-2022-04-27.md`.
//
// ⚠ 이 파일에 `import CoreBluetooth`를 넣지 말 것. 이유 둘: ①Kit은 macOS도 플랫폼으로
// 선언하고 `swift test`가 거기서 돈다 — 전송 층에 의존하는 순간 스캔 권한 없는 CI/로컬에서
// 이 계약 테스트를 잃는다(toneLayerStep·WalkAction 등 순수 판정 + fixture 관례와 같은
// 분리). ②Kit은 정식판에도 통째로 링크되는데 Apple은 CoreBluetooth **심볼 참조만으로**
// 권한 문구를 요구한다(ITMS-90683) — 그래서 전송 층(`AudioSignalController`)은 앱 타깃의
// `#if DEBUG || EXPERIMENTAL` 안에 있다. 진단 UI가 버려져도 이 층은 제품이 그대로 쓴다.

/// 규격서 Ⅶ (다) ① — DEVICE NAME 20 Bytes: `"AHG001" + "+" + MAC 12자리 + "+"`.
public struct AudioSignalName: Sendable, Equatable {
    /// 접두사(6자)+구분자. 뒤에 MAC 12자리 HEX ASCII, 끝에 `+` — 합계 20바이트.
    public static let prefix = "AHG001+"
    public static let byteLength = 20

    /// MAC 12자리 HEX ASCII, 대문자 정규화(광고 원문이 소문자여도 같은 기기로 본다).
    public let mac: String

    public init(mac: String) { self.mac = mac }

    /// 접두사·총 20바이트·끝 `+`·MAC 12자리 HEX **전부** 만족할 때만 유효.
    /// 하나라도 어긋나면 nil — 그 기기는 "형식 불일치"로 따로 관측한다(spec §11.1:
    /// 규격과 다른 이름을 조용히 흡수하면 "없다"와 "형식이 다르다"를 못 가른다).
    public static func parse(_ advertisedName: String?) -> AudioSignalName? {
        guard let name = advertisedName,
              name.utf8.count == byteLength,
              name.hasPrefix(prefix),
              name.hasSuffix("+")
        else { return nil }
        let mac = String(name.dropFirst(prefix.count).dropLast(1))
        guard mac.count == 12, mac.allSatisfy(\.isHexDigit) else { return nil }
        return AudioSignalName(mac: mac.uppercased())
    }
}

/// 규격서 Ⅶ (다) ③ — 앱→신호기 3바이트 명령 `[HEADER 0x31, OPCODE 0x00, DATA]`.
/// ⚠ 가운데 바이트는 2021 규격까지 기기 주소였고 `0x00`이 "모두 동작"이었다(research §2.4).
/// 구세대 기기에서는 한 번 눌렀을 때 여러 대가 울 수 있다 — 결함이 아니라 관측 대상.
public enum AudioSignalCommand: UInt8, Sendable {
    /// 위치안내(리모컨의 위치 알림 버튼 대응)
    case locate = 0x01
    /// 신호안내(신호 상태 안내) — 오작동이 곧 안전 문제라 시험 순서의 마지막(spec §4)
    case signal = 0x02
    /// 음성안내(설치 위치 정보) — 스캔 목록의 MAC을 장소 이름으로 바꾸는 유일한 채널
    case describe = 0x03

    public static let header: UInt8 = 0x31
    public static let opcode: UInt8 = 0x00

    public var packet: Data { Data([Self.header, Self.opcode, rawValue]) }
}

/// 규격서 Ⅶ (다) ③ 3) — 신호기→앱 3바이트 응답 `[0x32, 0x00, DATA]`.
/// DATA 하위니블 0 = ACK, 1 = NAK, 상위니블 = 수신기 사양 정보.
public enum AudioSignalReply: Sendable, Equatable {
    case ack(spec: UInt8)
    case nak(spec: UInt8)
    /// 길이·헤더·하위니블 어느 하나라도 규격과 다른 응답. 원시 바이트를 그대로 들고
    /// 있는다 — 실기기가 규격과 다르게 답하는 것 자체가 관측 대상이고, 버리면
    /// "응답이 없다"와 구분되지 않는다.
    case malformed(Data)

    public static let header: UInt8 = 0x32
    public static let opcode: UInt8 = 0x00

    public static func parse(_ data: Data) -> AudioSignalReply {
        let bytes = [UInt8](data)
        guard bytes.count == 3, bytes[0] == header, bytes[1] == opcode else {
            return .malformed(data)
        }
        let spec = bytes[2] >> 4
        switch bytes[2] & 0x0F {
        case 0: return .ack(spec: spec)
        case 1: return .nak(spec: spec)
        default: return .malformed(data)
        }
    }
}

/// 로그·화면용 원시 바이트 표기(`"32 00 10"`). 빈 데이터는 `"(empty)"`.
public func audioSignalHex(_ data: Data) -> String {
    data.isEmpty ? "(empty)" : data.map { String(format: "%02X", $0) }.joined(separator: " ")
}
