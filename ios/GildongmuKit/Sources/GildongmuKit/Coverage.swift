import Foundation

/// 대한민국 서비스 커버리지 정본 술어 — 웹 src/lib/coverage.ts 미러(값 변경 시 동조).
public func isInKorea(lat: Double, lng: Double) -> Bool {
    (31.43...44.35).contains(lat) && (122.37...132.0).contains(lng)
}
