import Foundation
import Observation
import GildongmuKit

/// 수동 위치의 **런타임 정본**. `UserDefaults`는 그 뒤의 영속 매체다.
///
/// 웹 `src/lib/manual-location-store.ts` 미러. 화면이 `UserDefaults`를 직접
/// 읽고 쓰면 이미 열린 표시줄·길찾기 출발지가 즉시 갱신되지 않는다.
@Observable
@MainActor
final class ManualLocationStore {
    static let shared = ManualLocationStore()

    private static let storageKey = "gildongmu.manualLocation"

    private(set) var current: ManualLocation?

    private init() {
        current = Self.load()
    }

    private static func load() -> ManualLocation? {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else { return nil }
        guard let decoded = try? JSONDecoder().decode(ManualLocation.self, from: data),
              isValid(decoded) else {
            // 손상된 값을 복원하면 haversine이 NaN을 내고 모든 비교가 false가 되어
            // 영구 유지된다(가장 나쁜 실패 방향). 폐기한다.
            UserDefaults.standard.removeObject(forKey: storageKey)
            return nil
        }
        return decoded
    }

    private static func isValid(_ m: ManualLocation) -> Bool {
        guard m.lat.isFinite, m.lng.isFinite,
              (-90...90).contains(m.lat), (-180...180).contains(m.lng),
              !m.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        if let o = m.origin {
            guard o.lat.isFinite, o.lng.isFinite, o.accuracy.isFinite, o.accuracy > 0,
                  (-90...90).contains(o.lat), (-180...180).contains(o.lng) else { return false }
        }
        return true
    }

    /// 지정. `revision`은 이 메서드만 증가시킨다(CAS 토큰의 단일 발급처).
    func set(label: String, lat: Double, lng: Double, origin: ManualFix?) {
        let next = ManualLocation(
            revision: (current?.revision ?? 0) + 1,
            label: label, lat: lat, lng: lng,
            origin: origin,
            setAt: Date().timeIntervalSince1970
        )
        guard Self.isValid(next) else { return }
        current = next
        if let data = try? JSONEncoder().encode(next) {
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        }
    }

    func clear() {
        guard current != nil else { return }
        current = nil
        UserDefaults.standard.removeObject(forKey: Self.storageKey)
    }
}
