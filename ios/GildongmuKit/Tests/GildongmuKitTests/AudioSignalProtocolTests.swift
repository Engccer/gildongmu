import Foundation
import Testing
@testable import GildongmuKit

// 음향신호기 BLE 순수 층 계약(spec 2026-08-17 §8). 규격서 Ⅶ (다) 바이트가 정본.

// MARK: - 이름 파싱 (규격서 Ⅶ (다) ①)

@Test func nameParsesSpecForm() {
    let name = AudioSignalName.parse("AHG001+A1B2C3D4E5F6+")
    #expect(name == AudioSignalName(mac: "A1B2C3D4E5F6"))
}

@Test func nameNormalizesLowercaseMac() {
    #expect(AudioSignalName.parse("AHG001+a1b2c3d4e5f6+")?.mac == "A1B2C3D4E5F6")
}

@Test func nameRejectsWrongPrefix() {
    #expect(AudioSignalName.parse("AHG002+A1B2C3D4E5F6+") == nil)
    #expect(AudioSignalName.parse("ahg001+A1B2C3D4E5F6+") == nil)
}

@Test func nameRejectsWrongLength() {
    #expect(AudioSignalName.parse("AHG001+A1B2C3D4E5F+") == nil)     // 19
    #expect(AudioSignalName.parse("AHG001+A1B2C3D4E5F67+") == nil)   // 21
}

@Test func nameRejectsMissingTrailingPlus() {
    #expect(AudioSignalName.parse("AHG001+A1B2C3D4E5F6X") == nil)
}

@Test func nameRejectsNonHexMac() {
    #expect(AudioSignalName.parse("AHG001+A1B2C3D4E5G6+") == nil)
}

@Test func nameRejectsNil() {
    #expect(AudioSignalName.parse(nil) == nil)
}

// MARK: - 명령 (규격서 Ⅶ (다) ③ 1))

@Test func commandPackets() {
    #expect(AudioSignalCommand.locate.packet == Data([0x31, 0x00, 0x01]))
    #expect(AudioSignalCommand.signal.packet == Data([0x31, 0x00, 0x02]))
    #expect(AudioSignalCommand.describe.packet == Data([0x31, 0x00, 0x03]))
}

// MARK: - 응답 (규격서 Ⅶ (다) ③ 3))

@Test func replyAckAndNak() {
    #expect(AudioSignalReply.parse(Data([0x32, 0x00, 0x00])) == .ack(spec: 0))
    #expect(AudioSignalReply.parse(Data([0x32, 0x00, 0x01])) == .nak(spec: 0))
}

@Test func replyCarriesSpecInUpperNibble() {
    #expect(AudioSignalReply.parse(Data([0x32, 0x00, 0x10])) == .ack(spec: 1))
    #expect(AudioSignalReply.parse(Data([0x32, 0x00, 0xF1])) == .nak(spec: 15))
    #expect(AudioSignalReply.parse(Data([0x32, 0x00, 0xA0])) == .ack(spec: 10))
}

@Test func replyMalformedKeepsRawBytes() {
    let short = Data([0x32, 0x00])
    #expect(AudioSignalReply.parse(short) == .malformed(short))
    let long = Data([0x32, 0x00, 0x00, 0x00])
    #expect(AudioSignalReply.parse(long) == .malformed(long))
    let wrongHeader = Data([0x31, 0x00, 0x00])
    #expect(AudioSignalReply.parse(wrongHeader) == .malformed(wrongHeader))
    let wrongOpcode = Data([0x32, 0x01, 0x00])
    #expect(AudioSignalReply.parse(wrongOpcode) == .malformed(wrongOpcode))
    // 하위니블 2~F는 규격에 없다 — ACK로 뭉개지 않는다.
    let unknownLow = Data([0x32, 0x00, 0x02])
    #expect(AudioSignalReply.parse(unknownLow) == .malformed(unknownLow))
    #expect(AudioSignalReply.parse(Data()) == .malformed(Data()))
}

@Test func hexFormatting() {
    #expect(audioSignalHex(Data([0x32, 0x00, 0x10])) == "32 00 10")
    #expect(audioSignalHex(Data()) == "(empty)")
}
