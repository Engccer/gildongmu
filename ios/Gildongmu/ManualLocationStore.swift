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

    /// **마지막 판정 시도의 결과**. `nil` = 아직 판정하지 않음(지정 직후·복원 직후).
    ///
    /// 영속하지 않는다 — 저장하면 며칠 전 판정이 새 세션의 라벨을 정한다. 수명은
    /// 지금 담긴 수동 위치와 같아 `set`/`clear`가 함께 초기화한다. 웹
    /// `manual-location-store.ts`의 같은 이름 상태와 미러다.
    private(set) var verdict: ManualVerdict?

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
        // 새 위치에는 아직 판정이 없다(옛 위치의 결과를 물려주면 라벨이 거짓말한다).
        verdict = nil
        if let data = try? JSONEncoder().encode(next) {
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        }
    }

    /// 판정 결과 기록. `ManualLocationJudge.run()`만 부른다.
    ///
    /// ⚠ 호출부가 CAS(revision 동일)를 통과한 뒤에만 부를 것 — 판정 왕복 중 재지정이
    /// 있었다면 이 결과는 다른 위치에 대한 판정이다.
    func setVerdict(_ next: ManualVerdict) {
        guard verdict != next else { return }
        verdict = next
    }

    func clear() {
        guard current != nil else { return }
        current = nil
        verdict = nil
        UserDefaults.standard.removeObject(forKey: Self.storageKey)
    }
}
