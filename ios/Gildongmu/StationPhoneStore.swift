import Foundation
import Observation
import SwiftUI
import GildongmuKit

/// 경유역 전화번호 조회 결과 저장소(E44 spec §5.6). 역 상세 전화 줄과 경유역 행 로터가 같은 키로 공유한다.
///
/// - 메모리만. 표시(`result`)는 마지막으로 기록된 값을 그대로 돌려주고 신선도를 보지 않는다 — 오래된 번호는
///   갱신이 끝날 때까지 보이고, 재렌더만으로 조용히 사라지지 않는다.
/// - **줄 종류는 정보가 실제로 바뀔 때만 한 번 바뀐다.** 전화 줄이 번호·실패·빈 줄 사이를 오가면 VoiceOver 커서가
///   그 줄에서 떨어진다(재확인이 30초마다 도는 화면에서 특히).
/// - 신선도는 `resolve`만 본다. "번호·없음"은 5분(서버 `kakao-local` 캐시 300초와 같은 수명) 안이면 그대로 쓰고,
///   지나면 다시 조회한다. 화면에 떠 있는 소비자는 `recheckSeconds`(30초)마다 `resolve`를 다시 불러 낡은 값을 갱신한다.
/// - 기록 뒤 갱신되지 않은 값은 `evictAfterSeconds`(6분)에 지운다 — 몇 시간 사는 안내 세션에서 카카오 결과를 무기한
///   들고 있지 않는다. 그사이 갱신이 실패했으면 지우지 않고 곧바로 실패로 바꾼다(번호 → 빈 줄 → 실패 줄로 두 번 바뀌지 않게).
/// - 실패는 도장(신선도)을 남기지 않아 다음 조회가 재시도한다. "마지막 시도가 실패했다"는 재시도 중에도 참이므로
///   실패 줄은 재시도가 성공할 때까지 그대로 둔다. 낡은 번호·없음 위의 갱신 실패는 값을 덮지 않고 표식만 남긴다.
/// - 같은 키 진행 중 조회는 공유한다. 조회 Task는 소비자와 무관한 비구조적 Task라 소비자가 사라져도 취소되지 않고,
///   기록도 그 Task가 한다.
/// - ⚠ `results`만 관찰 대상이다. 시트 본문은 이것을 읽지 않는다 — 경유역 행 하위 뷰와 역 상세만 읽는다(spec §6).
@Observable @MainActor
final class StationPhoneStore {
    static let shared = StationPhoneStore()
    private init() {}

    struct Key: Hashable {
        let station: String
        let line: String
        let lat: Int
        let lng: Int
    }

    /// 번호·없음의 신선 수명(서버 `kakao-local` 캐시 300초와 같다). 이보다 오래된 값은 `resolve`가 다시 조회한다.
    static let freshSeconds: TimeInterval = 300
    /// 화면에 떠 있는 소비자가 `resolve`를 다시 부르는 간격. 신선한 동안은 네트워크 없이 바로 돌아오고, 값이 낡은 뒤
    /// 이 간격 안에 갱신이 시작된다 — 소비자가 나타난 시각과 값의 도장이 어긋나도 갱신이 늦지 않게.
    static let recheckSeconds: TimeInterval = 30
    /// 갱신되지 않은 값을 메모리에서 지우기까지의 시간. 최악의 갱신은 도장 뒤 `freshSeconds + recheckSeconds`에 시작해
    /// 조회 상한(3초) 안에 기록되므로, 재확인 간격 하나를 더 두어 지우는 순간이 갱신을 앞지르지 않게 한다(전화 줄 깜빡임 방지).
    static let evictAfterSeconds: TimeInterval = freshSeconds + 2 * recheckSeconds

    private var results: [Key: StationPhoneResult] = [:]
    @ObservationIgnored private var fetchedAt: [Key: Date] = [:]
    /// 갱신 실패 표식 — 낡은 번호·없음 위의 갱신이 실패했음을 기억한다(값은 덮지 않는다). 보관 한도에서 실패로 바꿀지 가른다.
    @ObservationIgnored private var refreshFailed: Set<Key> = []
    @ObservationIgnored private var inflight: [Key: Task<StationPhoneResult, Never>] = [:]
    /// 조회 전용 세션 — URL 캐시가 없어 카카오 결과가 디스크(`Cache.db`)에 남지 않는다(spec §7 약관 판정: 보관은 이 저장소의
    /// 메모리 최대 6분뿐). `/api/places`는 캐시 헤더를 싣지 않아 공유 세션이면 자동 조회 응답이 디스크 캐시에 쌓인다.
    /// 기존 장소 검색 경로의 공유 세션은 범위 밖이다.
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()
    @ObservationIgnored private let service = StationPhoneService(
        client: APIClient(baseURL: AppConfig.apiBaseURL, session: StationPhoneStore.session))

    /// 노선 표가 모르는 노선이면 nil — 그 역은 조회하지 않고 "없음"이다(spec §5.4-4).
    static func key(stationName: String, lat: Double, lng: Double, lineName: String) -> Key? {
        let station = stationNameKey(stationName)
        guard !station.isEmpty, let line = subwayLineIdentity(lineName) else { return nil }
        return Key(
            station: station, line: line,
            lat: Int((lat * 10_000).rounded()), lng: Int((lng * 10_000).rounded()))
    }

    /// 표시용 마지막 값. nil = 아직 모름(조회 전·첫 조회 중·갱신 시도 없이 보관 한도로 지워짐).
    /// `.failed` = 마지막 시도가 실패했다 — 재시도 중에도 그대로이고, 재시도가 성공할 때 번호·없음으로 한 번 바뀐다.
    /// 신선도는 보지 않는다 — 오래된 번호는 갱신이 끝날 때까지 그대로 보인다(재렌더 때 번호가 조용히 사라지지 않게).
    func result(stationName: String, lat: Double, lng: Double, lineName: String) -> StationPhoneResult? {
        guard let key = Self.key(stationName: stationName, lat: lat, lng: lng, lineName: lineName) else {
            return .unavailable
        }
        return results[key]
    }

    @discardableResult
    func resolve(stationName: String, lat: Double, lng: Double, lineName: String) async -> StationPhoneResult {
        guard let key = Self.key(stationName: stationName, lat: lat, lng: lng, lineName: lineName) else {
            return .unavailable
        }
        if let value = results[key], value != .failed,
           let at = fetchedAt[key], Date().timeIntervalSince(at) < Self.freshSeconds {
            return value
        }
        if let running = inflight[key] { return await running.value }
        let service = self.service
        let task = Task {
            let value = await service.lookup(stationName: stationName, lat: lat, lng: lng, lineName: lineName)
            // 기록은 조회 Task가 한다 — 기다리던 소비자가 사라져도 장부가 정리된다(공유 조회는 취소하지 않는다).
            self.inflight[key] = nil
            self.record(value, for: key)
            return value
        }
        inflight[key] = task
        return await task.value
    }

    /// 결과 기록. **줄 종류는 정보가 실제로 바뀔 때만 한 번 바뀐다** — 전화 줄이 번호·실패·빈 줄 사이를 오가면 VoiceOver 커서가
    /// 그 줄에서 떨어진다(태스크 4 재검토). 실패는 도장 없이 두어 다음 resolve가 재시도하고, 낡은 번호·없음은 갱신 실패로 덮지 않는다.
    /// 번호·없음은 도장을 찍고, 그 도장이 그대로면 보관 한도 뒤 지운다(카카오 결과를 무기한 들고 있지 않는다, spec §5.6·§7).
    private func record(_ value: StationPhoneResult, for key: Key) {
        if value == .failed {
            if let current = results[key], current != .failed {
                refreshFailed.insert(key)
            } else if results[key] != .failed {
                // 이미 실패 줄이면 다시 대입하지 않는다 — 30초 재확인마다 같은 값으로 관찰자를 깨우지 않게.
                results[key] = .failed
            }
            return
        }
        results[key] = value
        refreshFailed.remove(key)
        let stamp = Date()
        fetchedAt[key] = stamp
        Task {
            try? await Task.sleep(for: .seconds(Self.evictAfterSeconds))
            guard self.fetchedAt[key] == stamp else { return }
            self.fetchedAt[key] = nil
            // 한도까지 갱신이 성공하지 못했고 그사이 갱신이 실패했다면(화면에 떠 있는데 통신 불가) 곧바로 실패로 — 번호 → 빈 줄 →
            // 실패 줄로 두 번 바뀌지 않게. 아무도 갱신하지 않았으면 모름(nil)으로 지운다.
            self.results[key] = self.refreshFailed.remove(key) != nil ? .failed : nil
        }
    }

    /// 경유역 목록을 펼치는 순간 그 구간 역 전부를 미리 조회한다(spec §6, 리뷰 M6 — 행 실현 시 조회는 액션이 조용히 늦게 생긴다).
    ///
    /// ⚠ 받은 배열 **전부**에 `resolve`를 돈다. 경유역 목록(수십 건)에 맞춰 만든 것이므로, 브리핑처럼 줄마다
    ///   부르는 소비자는 그 줄의 역만 넘긴다(E45 spec §5.2 — `leg.stops`를 그대로 주면 leg 하나에 12~20건이 돈다).
    func prefetch(stops: [TransitLegStop], lineName: String) {
        for stop in stops {
            Task { await resolve(stationName: stop.name, lat: stop.lat, lng: stop.lng, lineName: lineName) }
        }
    }
}

/// 역 전화 액션의 단일 창구(E45 spec §5.1). 경로 브리핑 로터와 안내 시트 경유역 로터가 같은 한 벌을 지난다 —
/// 두 벌이면 한쪽만 고쳐져 같은 상황에서 다른 말을 하게 된다.
///
/// - 번호가 있으면 걸고 **통지하지 않는다**(전화 앱으로 넘어가는 것이 곧 응답이라 통지가 잉여다).
/// - 없음·모름·실패는 `.high` 통지와 진동을 함께 낸다. 화면이 바뀌지 않는 활성화 응답이라 통지가 유일한
///   증거이고, 기본 우선순위면 VoiceOver의 활성화 처리에 잠식돼 아무 말도 들리지 않는다(헌장 §5).
/// - ⚠ 모름(`nil`)은 조회 전·첫 조회 중·보관 한도 축출을 겹쳐 든다. 그대로 "찾고 있습니다"라고만 하면 아무도
///   다시 조회하지 않는 경우 그 문장이 영영 거짓이므로, **통지 전에 `resolve`를 킥오프**해 사후적으로 참이 되게 한다.
///
/// 상태 판정(문구 키·진동 종류)은 Kit 순수 함수 `briefingPhoneAnnouncement`가 한다(뷰 안에 두면 테스트 레인이 없다).
@MainActor
func callStationPhone(
    stationName: String, lat: Double, lng: Double, lineName: String, openURL: OpenURLAction
) {
    let store = StationPhoneStore.shared
    let result = store.result(stationName: stationName, lat: lat, lng: lng, lineName: lineName)
    switch result {
    case .direct(let phone)?, .representative(let phone)?:
        // ⚠ **번호가 있어도 걸지 못할 수 있다** — 카카오 `phone`에 내부 공백·부기가 남아 URL 조립이
        //   실패하거나, 전화 앱이 없는 기기가 열기를 거부한다. 그때 조용히 반환하면 통지 0·진동 0·
        //   화면 변화 0이고 라벨은 "…에 전화 걸기" 그대로라, 스크린 리더 사용자에게 남는 단서가 **없다**
        //   (보이는 전화 줄은 같은 조건에서 줄 자체가 사라져 부재가 단서가 되지만 로터 액션은 그렇지 않다).
        //   실패는 조회 실패와 같은 창구로 떨어뜨린다 — 사용자가 할 일("다른 수단으로 건다")이 같다.
        if let url = URL(string: "tel:\(phone.replacingOccurrences(of: "-", with: ""))") {
            openURL(url) { accepted in
                if !accepted { announceStationPhone(.failed) }
            }
            return
        }
        announceStationPhone(.failed)
        return
    default:
        break
    }
    if result == nil {
        Task { await store.resolve(stationName: stationName, lat: lat, lng: lng, lineName: lineName) }
    }
    announceStationPhone(result)
}

/// 전화 액션의 결과 통지·진동 한 자리. 번호를 걸었으면 통지가 없다(전화 앱 전환이 응답이다).
@MainActor
private func announceStationPhone(_ result: StationPhoneResult?) {
    guard let notice = briefingPhoneAnnouncement(result) else { return }
    // ⚠ Kit이 돌려준 키를 그대로 `appLocalized(변수)`로 넘기지 않는다. `check-xcstrings-keys.mjs`는
    //   **문자열 리터럴만** 스캔하므로 변수 키는 카탈로그 대조에서 통째로 빠지고, 키가 없으면 VoiceOver가
    //   키 문자열을 그대로 낭독한다. 리터럴로 되받는 이 스위치가 그 게이트를 살려 둔다
    //   (`transitAlternativeName`·`TransitWalkLegText` 소비자와 같은 관례).
    let text: String
    switch notice.key {
    case "ios.station.phoneMissing": text = appLocalized("ios.station.phoneMissing")
    case "ios.station.phonePending": text = appLocalized("ios.station.phonePending")
    case "ios.station.phoneError": text = appLocalized("ios.station.phoneError")
    default:
        // Kit이 키를 늘렸는데 여기 case가 빠진 것 — 문자열 switch라 컴파일러가 못 잡으므로 디버그에서
        // 즉시 드러내고, 릴리스는 키를 그대로 노출해 침묵을 피한다.
        assertionFailure("briefingPhoneAnnouncement 키 미매핑: \(notice.key)")
        text = notice.key
    }
    var message = AttributedString(text)
    message.accessibilitySpeechAnnouncementPriority = .high
    AccessibilityNotification.Announcement(message).post()
    ResultHaptic.fire(appHaptic(notice.haptic))
}

/// Kit 판정 어휘 → 앱 진동 창구(`ResultHaptic`은 UIKit에 기대므로 Kit에 둘 수 없다).
private func appHaptic(_ kind: ResultHapticKind) -> ResultHaptic.Kind {
    switch kind {
    case .success: return .success
    case .attention: return .attention
    case .failure: return .failure
    }
}
