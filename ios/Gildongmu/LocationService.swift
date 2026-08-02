import Foundation
import CoreLocation
import Observation
import GildongmuKit

/// 현재 위치 공유 싱글턴 — 웹 geolocation 모듈 싱글턴(`src/lib/geolocation.ts`)의 iOS 판.
/// 각 화면은 CLLocationManager 직접 생성 금지, 반드시 이 서비스 경유(spec §3).
/// 권한 요청은 "내 주변" 기능 최초 사용 시점(앱 시작 즉시 금지, When In Use만).
@Observable @MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    static let shared = LocationService()

    enum LocationError: Error {
        case denied           // 권한 거부/제한
        case reducedAccuracy  // 권한은 있으나 "정확한 위치" 꺼짐(좌표 1~20km 오차)
        case unavailable      // 취득 실패
    }

    /// 저장된 fix. **좌표·정확도·시각을 한 값으로 묶는다** — 셋이 갈라지면 읽는 쪽이
    /// 그 좌표가 40m인지 2km인지 구분할 수 없어, 게이트가 거부한 좌표가 캐시를 통해
    /// "현재 위치"로 승격된다.
    private struct StoredFix {
        let coord: (lat: Double, lng: Double)
        let accuracy: Double
        /// **fix가 실제로 측정된 시각**(수신 시각이 아니다). 수신 시각으로 도장을
        /// 찍으면 나이가 최대 `acceptAge`만큼 과소평가되어 실효 수명이 늘어난다.
        let fixedAt: Date

        var age: Double { -fixedAt.timeIntervalSinceNow }
    }

    private var stored: StoredFix?

    /// 직전 성공 좌표 — 재취득 실패 시에도 보존(새로고침=재조회이지 데이터 포기 아님)
    var lastCoordinate: (lat: Double, lng: Double)? { stored?.coord }

    private let manager = CLLocationManager()
    /// 위치 쪽과 동일하게 배열 — 최초 권한 요청 구간에 동시 호출이 겹쳐도 전부 resume(스칼라면 덮어써 영구 대기)
    private var authContinuations: [CheckedContinuation<Void, Never>] = []

    /// 대기 중인 단발 취득. **세대를 함께 든다.**
    ///
    /// 단일 배열로 두면 소비자마다 다른 타임아웃이 섞인다: 검색(2초)의 타이머가
    /// "내 주변"(8초)의 continuation까지 재개해 **8초를 요구한 취득이 3초 만에
    /// 실패로 판정**된다. 좋은 fix는 모두에게 답이 되므로 성공은 전량 재개하고,
    /// 타임아웃 판정만 자기 세대로 좁힌다.
    private struct PendingFix {
        let epoch: UInt64
        let continuation: CheckedContinuation<(lat: Double, lng: Double), any Error>
    }
    private var pendingFixes: [PendingFix] = []

    // MARK: - 비콘 연속 모드 (거리 추적 전용)

    /// 연속 fix 페이로드. `timestamp`가 있어야 캐시 위치를 가려낼 수 있다
    /// (`startUpdatingLocation()`의 첫 콜백은 흔히 캐시라 앵커가 수백 m 어긋난다).
    struct BeaconFixPayload: Sendable {
        let lat: Double
        let lng: Double
        /// 미터. **음수는 좌표 무효 신호**이므로 소비자가 걸러야 한다.
        let accuracy: Double
        let timestamp: Date
    }

    private var beaconFixSink: ((BeaconFixPayload) -> Void)?
    private var beaconErrorSink: ((CLError.Code) -> Void)?
    private var beaconAuthSink: ((CLAuthorizationStatus) -> Void)?
    private var beaconAccuracySink: ((CLAccuracyAuthorization) -> Void)?

    // MARK: - 단발 취득 상태

    /// 단발 취득이 스트림을 켠 상태인지. 비콘과 매니저를 공유하므로 **끄는 쪽이
    /// 서로를 죽이지 않게** 이 플래그로 소유권을 가른다.
    private var isOneShotActive = false

    /// 취득 세대. ⚠ **타임아웃 감시 Task는 비구조 태스크라 성공한 취득의 타이머도
    /// 끝까지 잔다.** 그 사이 새 취득이 시작되면 옛 타이머가 새 취득의 continuation을
    /// 판정해 8초 예산을 임의로 잘라먹는다(새로고침이 정확히 이 경로다). 타이머가
    /// 자기 세대만 판정하게 해 조기 종료·후보 소실·교차 판정을 함께 닫는다.
    private var oneShotEpoch: UInt64 = 0

    /// 이번 단발 취득에서 본 최선 fix(타임아웃 시 반환분).
    private var oneShotBest: StoredFix?

    /// 추적 중인지. one-shot 경로가 이 값을 보고 분기한다.
    private(set) var isBeaconTracking = false

    /// 현재 권한 상태. ⚠ `currentCoordinate()`는 **캐시 우선**이라 권한을 보지 않고
    /// 반환하는 경로가 있다. 권한 게이트가 필요한 호출부는 이 값을 직접 봐야 한다
    /// (그러지 않으면 권한 회수 후에도 캐시 좌표로 "성공"해 무한 침묵이 된다).
    var authorizationSnapshot: CLAuthorizationStatus { manager.authorizationStatus }

    /// 현재 정밀도 허가. 권한(허용/거부)과 **다른 축**이라 따로 노출한다 —
    /// reduced면 좌표가 1~20km 오차이고 `desiredAccuracy` 변경이 무효가 된다.
    var accuracySnapshot: CLAccuracyAuthorization { manager.accuracyAuthorization }

    /// 기기 위치 서비스 자체가 꺼져 있는지. 권한(앱별)과 다른 축이라 문구도 달라야 한다.
    nonisolated var isLocationServiceEnabled: Bool { CLLocationManager.locationServicesEnabled() }

    /// 연속 위치 업데이트 시작. 매니저는 이 싱글턴이 단독 소유하므로
    /// 화면이 별도 `CLLocationManager`를 만들지 않는다(spec §3.5).
    ///
    /// ⚠ 권한 요청은 호출부(`BeaconModel`)가 먼저 처리한다. 여기서는 이미 허용된
    /// 상태를 전제로 스트림만 연다.
    func startBeaconUpdates(
        onFix: @escaping (BeaconFixPayload) -> Void,
        onError: @escaping (CLError.Code) -> Void,
        onAuthChange: @escaping (CLAuthorizationStatus) -> Void,
        onAccuracyChange: @escaping (CLAccuracyAuthorization) -> Void
    ) {
        beaconFixSink = onFix
        beaconErrorSink = onError
        beaconAuthSink = onAuthChange
        beaconAccuracySink = onAccuracyChange
        isBeaconTracking = true

        // 서 있는 동안 시스템이 업데이트를 자동 정지하면 tick이 사라져 "죽었나"와
        // 구분되지 않는다(기본값 true). 보행 프로파일로 고정하고 거리 필터는 끈다
        // (데드밴드가 이미 필터라 이중 필터링 금지).
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .fitness
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.startUpdatingLocation()
    }

    func stopBeaconUpdates() {
        guard isBeaconTracking else { return }
        manager.stopUpdatingLocation()
        manager.pausesLocationUpdatesAutomatically = true
        isBeaconTracking = false
        beaconFixSink = nil
        beaconErrorSink = nil
        beaconAuthSink = nil
        beaconAccuracySink = nil
    }

    private override init() {
        super.init()
        manager.delegate = self
    }

    /// **순위 가중용**(검색 근접 블렌딩, 2026-07-21). 낡거나 거친 좌표도 좌표
    /// 없음보다 낫다: 순위가 이상하면 결과 목록을 훑어 알 수 있으므로 반증 가능하고,
    /// 좌표 없이 나가면 전국 정확도순이 되어 근처 지점이 매몰된다(아쿠아리움 실측:
    /// 충주 1위). 미허용·거부·취득 실패는 조용히 nil.
    ///
    /// ⚠ TTL과 함께 **정확도 바도 연다**(`storeCeiling`). TTL만 늘리고 바를 30m로
    /// 두면 실내·도심 협곡처럼 정확도가 계속 30m를 넘는 환경에서 캐시가 **한 번도
    /// 재사용되지 않아** 매 검색이 재측위한다. `softTTL`을 둔 근거가 정확히 그 근거가
    /// 필요한 환경에서 무효가 된다.
    ///
    /// ⚠ 그래도 reduced 좌표는 오지 않는다. 저장 게이트가 `accuracyAuthorization`을
    /// 직접 보므로 `stored`에는 정밀 fix만 담긴다. 순위 가중만 놓고 보면 reduced를
    /// 받아도 거짓 주장이 아니지만(반증 가능), 열려면 저장 게이트를 우회하는 별도
    /// 경로가 필요하고 이득은 "정밀 위치를 끈 사용자의 검색 순위"뿐이라 두지 않았다.
    func coordinateForRanking() async -> (lat: Double, lng: Double)? {
        guard isAuthorized else { return nil }
        let coord = try? await currentCoordinate(
            timeout: LocationFixPolicy.softTimeout,
            ttl: LocationFixPolicy.softTTL,
            acceptAccuracy: LocationFixPolicy.storeCeiling
        )
        return coord ?? stored?.coord
    }

    /// **표시용.** 게이트를 통과한 좌표만 준다. 실패는 nil이고 호출부는 라벨을
    /// 그대로 둔다("현재 위치" 단독 — 주소 없음은 정보 없음이지 거짓이 아니다).
    ///
    /// ⚠ **가중용과 갈라 두는 이유**: 이 좌표는 역지오코딩되어 "현재 위치, 〈주소〉"로
    /// 화면에 **표시**된다. 낡은 좌표로 만든 주소는 화면으로 반증할 수 없는 거짓
    /// 위치 주장이다(아침에 잡은 좌표가 점심에 "현재 위치"로 낭독되는 경로). 거칢을
    /// 이유로 reduced를 막은 것과 같은 판단이고 축만 다르다(낡음).
    func coordinateForDisplay() async -> (lat: Double, lng: Double)? {
        guard isAuthorized else { return nil }
        return try? await currentCoordinate(timeout: LocationFixPolicy.softTimeout)
    }

    /// 이미 허용된 세션인가. ⚠ 이 가드가 있어야 `currentCoordinate`의 `.notDetermined`
    /// 분기에 닿지 않는다 — 닿으면 탭 진입만으로 권한 팝업이 뜬다(계약: 권한 요청은
    /// "내 주변" 최초 사용 시점).
    private var isAuthorized: Bool {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: true
        default: false
        }
    }

    /// 권한 팝업만 띄우고 좌표는 취득하지 않는다.
    ///
    /// 쓰는 곳은 **좌표를 정말로 버리는** 소비자 하나뿐이다: 비콘의 `.notDetermined`
    /// 분기는 팝업만 필요하고 곧바로 `startBeaconUpdates`로 스트림을 연다. 거기서
    /// `currentCoordinate()`를 부르면 목적이 팝업인데 최대 8초 측위를 완주한다.
    ///
    /// ⚠ **반환값을 버린다고 이 함수로 바꾸면 안 되는 호출이 있다.** 채팅 전송 전
    /// 호출은 반환값을 버리지만 공유 스토어 갱신이 목적이라, 이 함수로 바꾸면 이미
    /// 허용된 세션에서 즉시 반환해 좌표 없이 전송된다(실제로 그렇게 깼다가 되돌렸다).
    func primeAuthorization() async {
        guard manager.authorizationStatus == .notDetermined else { return }
        await withCheckedContinuation { continuation in
            authContinuations.append(continuation)
            manager.requestWhenInUseAuthorization()
        }
    }

    /// 권한 요청(최초 1회 시스템 팝업) + 현재 위치 1회 취득.
    /// force=true면 캐시를 버리고 정밀 재취득(웹 awaitGeolocation({force:true}) 계약).
    /// 실패해도 저장된 좌표는 유지된다.
    func currentCoordinate(
        force: Bool = false,
        timeout: Double = LocationFixPolicy.timeout,
        ttl: Double = LocationFixPolicy.freshTTL,
        acceptAccuracy: Double = LocationFixPolicy.acceptAccuracy
    ) async throws(LocationError) -> (lat: Double, lng: Double) {
        // 추적 중에는 별도 취득을 걸지 않고 최신 스트림 fix로 답한다(spec §3.5).
        // 스트림이 이미 최고 정확도로 돌고 있어 더 나은 값을 만들 수 없고, 같은
        // 매니저를 두 주체가 켜고 끄면 소유권이 꼬인다. 스트림 fix가 저장 스토어를
        // 갱신하므로 이 값이 오히려 더 신선하다.
        //
        // ⚠ **여기도 재사용 게이트를 지난다.** 스트림이 살아 있어도 `stored`는 동결될
        // 수 있다: 추적 중 품질이 떨어져 accuracy가 저장 상한을 계속 넘으면 저장이
        // 전부 거부되어 마지막 양호값에 멈추고 나이만 자란다. 그대로 반환하면 몇 분
        // 전 좌표가 "현재 위치"로 나간다(비콘 워치독은 fix 부재를 잡지 이 동결을
        // 잡지 않는다). 추적 중 잠깐 조용할 때 "내 주변"이 실패하는 값을 치르더라도,
        // 조용히 옛 좌표로 답하는 것보다 낫다(3-state).
        if isBeaconTracking {
            guard let latest = stored,
                  canReuseCachedFix(accuracy: latest.accuracy, age: latest.age, ttl: ttl, acceptAccuracy: acceptAccuracy)
            else { throw LocationError.unavailable }
            return latest.coord
        }

        // ⚠ 나이만 보지 않는다. 저장 상한(100m)이 재사용 기준(30m)보다 느슨하므로
        // 나이만 보는 읽기는 게이트가 거부한 좌표를 "현재 위치"로 승격시킨다.
        if !force, let cached = stored,
           canReuseCachedFix(accuracy: cached.accuracy, age: cached.age, ttl: ttl, acceptAccuracy: acceptAccuracy) {
            return cached.coord
        }

        if manager.authorizationStatus == .notDetermined {
            await withCheckedContinuation { continuation in
                authContinuations.append(continuation)
                manager.requestWhenInUseAuthorization()
            }
        }
        switch manager.authorizationStatus {
        case .denied, .restricted:
            throw LocationError.denied
        default:
            break
        }

        // "정확한 위치"가 꺼져 있으면 좌표가 1~20km 오차이고 desiredAccuracy 변경이
        // 무효가 된다(Apple 문서). 그 좌표로 "주변"을 말하면 있지도 않은 정보를
        // 안내하게 되므로, 조회하지 않고 별개 상태로 돌린다(3-state 불변식).
        if manager.accuracyAuthorization == .reducedAccuracy {
            throw LocationError.reducedAccuracy
        }

        do {
            // 저장은 fix 수신 지점(`didUpdateLocations`)이 담당한다. 여기서 다시 쓰면
            // **수신 시각으로 도장을 덮어써** 나이가 과소평가되고 실효 수명이 늘어난다.
            return try await acquireGatedFix(timeout: timeout)
        } catch let error as LocationError {
            throw error
        } catch {
            throw LocationError.unavailable
        }
    }

    /// 정확도·신선도 게이트를 통과하는 fix를 기다린다. 타임아웃이면 그때까지의
    /// 최선 fix를 쓰고, 하나도 못 받았으면 실패한다.
    ///
    /// ⚠ `requestLocation()`을 쓰지 않는 이유: 목표 정확도에 못 미치면 오류가 아니라
    /// **더 나쁜 값을 조용히 주고 스스로 멈춘다**(Apple 문서). 여러 fix를 받아 개선을
    /// 기다리는 것이 문서가 뒷받침하는 패턴이다.
    private func acquireGatedFix(timeout: Double) async throws -> (lat: Double, lng: Double) {
        oneShotEpoch &+= 1
        let epoch = oneShotEpoch
        // ⚠ 이미 진행 중이면 **후보를 지우지 않는다.** 두 번째 호출자가 진입하면서
        // 첫 번째가 모아 둔 최선 fix를 비우면, 그 뒤 fix가 끊겼을 때 둘 다 실패한다
        // (혼자였으면 성공했을 취득이다). 좋은 fix는 모두에게 답이라 공유가 맞다.
        if !isOneShotActive { oneShotBest = nil }
        isOneShotActive = true
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.startUpdatingLocation()
        defer { endOneShotIfIdle() }

        return try await withCheckedThrowingContinuation { continuation in
            pendingFixes.append(PendingFix(epoch: epoch, continuation: continuation))
            // 타임아웃 감시. 게이트 통과분이 먼저 오면 이 세대의 대기가 이미 비어 있어
            // 재개가 no-op이 된다.
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(timeout))
                guard let self else { return }
                // **자기 세대만** 판정한다. `isOneShotActive`로 가드하지 않는 이유는
                // 다른 취득이 먼저 끝나며 그 값을 내렸을 수 있고, 그러면 이 세대가
                // 영영 재개되지 않아 화면이 로딩에 고착되기 때문이다.
                if let best = self.oneShotBest {
                    self.resumeFixes(epoch: epoch, with: .success(best.coord))
                } else {
                    self.resumeFixes(epoch: epoch, with: .failure(LocationError.unavailable))
                }
            }
        }
    }

    /// 단발 취득 종료. **마지막 대기자가 나갈 때만** 정리한다.
    ///
    /// ⚠ 먼저 끝난 호출자가 무조건 정리하면, 아직 기다리는 다른 취득의 스트림이
    /// 끊기고 그 뒤 fix가 무시되어 **영영 재개되지 않는다**(화면이 로딩에 고착되고
    /// 새로고침도 먹지 않아 시각장애 사용자에겐 크래시와 구분되지 않는다).
    ///
    /// ⚠ 비콘이 그 사이 시작됐으면 매니저를 멈추지 않는다 — 멈추면 추적이 조용히
    /// 죽고 라벨은 "중지"인데 소리만 사라진다.
    private func endOneShotIfIdle() {
        guard pendingFixes.isEmpty else { return }
        isOneShotActive = false
        oneShotBest = nil
        guard !isBeaconTracking else { return }
        manager.stopUpdatingLocation()
    }

    // MARK: - CLLocationManagerDelegate (콜백 스레드 비보장 → 원시값만 MainActor로 반입)

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        // ⚠ `manager`는 nonisolated 인자라 MainActor Task 안으로 넘기면 데이터 레이스다.
        // status와 같이 여기서 값으로 읽어 반입한다.
        let accuracy = manager.accuracyAuthorization
        Task { @MainActor in
            let continuations = self.authContinuations
            self.authContinuations = []
            for continuation in continuations { continuation.resume() }
            // 추적 중 권한 회수는 continuation이 비어 있어 소실된다. 별도 싱크로 알린다
            // (라벨은 "중지"인데 소리만 사라지는 무한 침묵 방지).
            // ⚠ 이 델리게이트는 **정확도 허가가 바뀔 때도** 불린다. status만 실어
            // 보내면 세션 중 "정확한 위치"가 꺼져도 비콘이 못 잡고, 1~20km 오차
            // 좌표로 "가까워지는 중"을 계속 소리로 안내한다.
            if self.isBeaconTracking {
                self.beaconAuthSink?(status)
                self.beaconAccuracySink?(accuracy)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let accuracy = location.horizontalAccuracy
        let timestamp = location.timestamp
        // ⚠ 정밀도 허가를 **값으로 직접 읽는다.** `storeCeiling`만으로 reduced 좌표를
        // 막는 것은 "reduced fix가 km급 accuracy로 보고된다"는 가정에 기대는 것이고,
        // 그 가정이 틀리면 흐릿한 좌표가 공유 스토어에 들어가 앱 전역이 오염된다.
        // 여기서 읽는 이유는 `manager`가 nonisolated 인자라 Task 안으로 못 넘겨서다.
        let isPrecise = manager.accuracyAuthorization == .fullAccuracy
        Task { @MainActor in
            let age = -timestamp.timeIntervalSinceNow
            let fix = StoredFix(coord: (lat: lat, lng: lng), accuracy: accuracy, fixedAt: timestamp)
            // 단발 취득의 수용 기준(정확도 상한 30m까지 본다) — 여러 fix 중 최선을
            // 고르는 창이 있으므로 엄격해도 된다.
            let accepted = shouldAcceptFix(accuracy: accuracy, age: age)
            // 저장 기준은 상한이 느슨하다(100m). 근거와 경계는 `isStorableFix` 참조.
            // 정밀 위치가 꺼진 세션의 fix는 값과 무관하게 저장하지 않는다(위 주석).
            let storable = isPrecise && isStorableFix(accuracy: accuracy, age: age)

            // 스트림 fix도 공유 스토어를 갱신한다. 안 하면 500m 걷고 조회했을 때
            // 출발 전 캐시 좌표로 경로가 계산된다("현재 위치는 한 곳" 불변식은
            // 호출 경로만이 아니라 값의 단일성까지를 뜻한다).
            if storable { self.stored = fix }

            if self.isOneShotActive {
                if accepted {
                    self.resumeLocationContinuations(with: .success(fix.coord))
                } else if storable, isBetterFix(accuracy, than: self.oneShotBest?.accuracy) {
                    // 정확도 게이트는 못 넘었지만 타임아웃 시 쓸 후보로 보관한다.
                    // ⚠ `storable` 조건이 필수다: 나이 검사 없이 후보로 받으면 **낡은
                    // 캐시 fix가 타임아웃 폴백으로 나가** 이번에 고치려던 결함이
                    // 폴백 경로로 되살아난다. 폴백은 "정밀하지 않을 수 있다"이지
                    // "옛날 것일 수 있다"가 아니다.
                    self.oneShotBest = fix
                }
            }

            if self.isBeaconTracking {
                self.beaconFixSink?(
                    BeaconFixPayload(lat: lat, lng: lng, accuracy: accuracy, timestamp: timestamp)
                )
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        let code = (error as? CLError)?.code
        Task { @MainActor in
            // ⚠ `startUpdatingLocation()`은 준비 중에 locationUnknown을 반복해서 낸다.
            // Apple이 무시를 권하는 일시 오류이므로 단발 취득을 여기서 끝내지 않고
            // 타임아웃이 판정하게 둔다(`requestLocation()` 시절엔 종료성 오류였다).
            if self.isOneShotActive, code == .locationUnknown {
                return
            }
            self.resumeLocationContinuations(with: .failure(error))
            // 오류 코드를 버리면 "위치 서비스 꺼짐"과 "일시적 취득 실패"가 한 문구로
            // 뭉개진다. locationUnknown은 Apple이 무시를 권하는 일시 오류다.
            if self.isBeaconTracking {
                self.beaconErrorSink?((error as? CLError)?.code ?? .locationUnknown)
            }
        }
    }

    /// 대기 중인 모든 세대를 재개한다. 좋은 fix와 진짜 오류(권한 회수 등)는 세대를
    /// 가리지 않고 모두에게 같은 답이다.
    private func resumeLocationContinuations(with result: Result<(lat: Double, lng: Double), any Error>) {
        let pending = pendingFixes
        pendingFixes = []
        for entry in pending { entry.continuation.resume(with: result) }
    }

    /// 한 세대만 재개한다(타임아웃 전용). 소비자마다 예산이 다르므로 짧은 쪽의
    /// 타이머가 긴 쪽을 대신 판정하면 안 된다.
    private func resumeFixes(epoch: UInt64, with result: Result<(lat: Double, lng: Double), any Error>) {
        let mine = pendingFixes.filter { $0.epoch == epoch }
        guard !mine.isEmpty else { return }
        pendingFixes.removeAll { $0.epoch == epoch }
        for entry in mine { entry.continuation.resume(with: result) }
    }
}
