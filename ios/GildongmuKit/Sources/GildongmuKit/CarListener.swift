import Foundation

/// 자동차 안내 청취자(K2 spec §6.1, 위원장 판정 ②). 세션 시작 시 읽어 세션에 고정한다.
///
/// - `passenger`(기본): 내가 이어폰으로 듣는다 — VO 통지·햅틱, 도보 문형 계승(`GuideTuning.car`).
/// - `driver`: 운전하는 가족이 스피커로 듣는다 — `TtsPlayer` 음성 채널, 짧은 명령형, 낮은 빈도
///   (`GuideTuning.carDriver`, 임박 8초). 주기·상태 통지는 내지 않는다(오케스트레이터가 거른다).
public enum CarListener: String, Sendable, CaseIterable {
    case passenger, driver
    public static let storageKey = "carListener"
    public static let `default`: CarListener = .passenger
}
