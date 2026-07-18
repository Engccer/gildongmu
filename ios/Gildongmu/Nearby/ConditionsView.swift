import SwiftUI
import Observation
import Accessibility
import GildongmuKit

/// 날씨·공기질. NearbyLoadState 대신 조각별 상태: 두 fetch를 async let으로 독립 실행해
/// 한쪽 실패가 다른 쪽을 안 죽인다(웹 allSettled 미러). 조각의 null·실패는 동일하게
/// "가져오지 못했습니다" 문장으로 노출(자동 등장 보조 정보의 graceful degrade).
@Observable @MainActor
final class ConditionsModel {
    /// 화면 공통 단계(권한 거부·위치 실패는 두 조각 공통 전제라 화면 단위)
    enum Phase { case idle, loading, denied, failed, done }

    private(set) var phase: Phase = .idle
    /// nil = 조회 실패 또는 데이터 부재(둘 다 "가져오지 못했습니다"로 표시)
    private(set) var weather: Weather?
    private(set) var air: AirQuality?
    private let service = ConditionsService(client: APIClient(baseURL: AppConfig.apiBaseURL))
    /// 재진입 가드(웹 in-flight ref 가드 미러): 로드 진행 중 재호출은 즉시 무시
    private var isLoadingInFlight = false

    func load(force: Bool = false) async {
        if isLoadingInFlight { return }
        isLoadingInFlight = true
        defer { isLoadingInFlight = false }
        // 직전 성공 데이터가 있으면 유지한 채 재조회, 그 외(첫 로드·실패 후 재시도)는 로딩 표시
        if case .done = phase {} else { phase = .loading }
        do {
            let coord = try await LocationService.shared.currentCoordinate(force: force)
            async let weatherTask: Weather? = (try? service.weather(lat: coord.lat, lng: coord.lng)) ?? nil
            async let airTask: AirQuality? = (try? service.air(lat: coord.lat, lng: coord.lng)) ?? nil
            let newWeather = await weatherTask
            let newAir = await airTask
            // 새로고침 실패 시 직전 성공 데이터 유지(재조회이지 데이터 포기 아님, M2 계약)
            if newWeather != nil { weather = newWeather }
            if newAir != nil { air = newAir }
            phase = .done
            // 완료 통지 1회(진행 통지 없음): 이번 호출의 두 결과로만 판정
            // (누적 프로퍼티 weather·air 검사 금지 — 직전 성공이 새로고침 실패를 성공으로 오통지)
            let message = if newWeather != nil && newAir != nil {
                appLocalized("ios.nearby.conditionsReady")
            } else if newWeather != nil || newAir != nil {
                appLocalized("ios.nearby.conditionsPartial")
            } else {
                appLocalized("ios.common.failedTitle")
            }
            AccessibilityNotification.Announcement(message).post()
        } catch let error as LocationService.LocationError {
            if case .denied = error {
                // done에서 권한 취소로 전락하면 내용이 통째로 사라진다 — 무신호 화면 전환 방지 통지
                if case .done = phase { announcePermissionLost() }
                phase = .denied
            } else if case .done = phase { announceRefreshFailed() } else { phase = .failed }
        } catch {
            if case .done = phase { announceRefreshFailed() } else { phase = .failed }
        }
    }
}

/// 날씨·공기질 화면. 등급·상태 단어가 낭독 정본이고 수치는 보강(value null이면 단어만).
/// 섹션 헤더 heading이 발견 경로(.isHeader), 라벨-값은 평문 단일 텍스트.
struct ConditionsView: View {
    @State private var model = ConditionsModel()

    var body: some View {
        List {
            if case .done = model.phase {
                weatherSection
                airSection
            }
        }
        .navigationTitle(appLocalized("ios.nearby.conditions"))
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }

    @ViewBuilder private var weatherSection: some View {
        Section {
            if let weather = model.weather {
                Text(appLocalized("ios.nearby.skyLine", skyWord(weather.sky.label)))
                Text(appLocalized("ios.nearby.precipLine", precipWord(weather.precipitation.label)))
                if let temp = weather.tempC { Text(appLocalized("ios.nearby.tempNow", numberText(temp))) }
                // 둘 다 null이면 생략, 한쪽만이면 있는 쪽만
                if weather.tempMax != nil || weather.tempMin != nil {
                    Text(joinText(
                        weather.tempMax.map { appLocalized("ios.nearby.tempMax", numberText($0)) },
                        weather.tempMin.map { appLocalized("ios.nearby.tempMin", numberText($0)) }))
                }
                if let humidity = weather.humidity { Text(appLocalized("weather.humidity", numberText(humidity))) }
                if let probability = weather.precipProbability { Text(appLocalized("weather.precipProbability", numberText(probability))) }
                Text(appLocalized("ios.nearby.baseTime", weather.baseTime))
            } else {
                Text(appLocalized("ios.nearby.weatherFailed"))
            }
        } header: {
            Text(appLocalized("ios.nearby.weatherHeading")).accessibilityAddTraits(.isHeader)
        }
    }

    @ViewBuilder private var airSection: some View {
        Section {
            if let air = model.air {
                Text(appLocalized("ios.nearby.airStationLine", air.stationName, numberText(air.distanceKm)))
                Text(pollutantText(appLocalized("airQuality.khai"), air.khai))
                Text(pollutantText(appLocalized("airQuality.pm10"), air.pm10))
                Text(pollutantText(appLocalized("airQuality.pm25"), air.pm25))
                Text(appLocalized("ios.nearby.dataTime", air.dataTime))
            } else {
                Text(appLocalized("ios.nearby.airFailed"))
            }
        } header: {
            Text(appLocalized("weather.airLabel")).accessibilityAddTraits(.isHeader)
        }
    }

    @ViewBuilder private var stateOverlay: some View {
        switch model.phase {
        case .loading: ProgressView(appLocalized("ios.common.checking"))
        case .denied:
            ContentUnavailableView(appLocalized("ios.common.geoDeniedTitle"), systemImage: "location.slash",
                description: Text(appLocalized("ios.common.geoDeniedDesc")))
        case .failed:
            ContentUnavailableView(appLocalized("ios.common.failedTitle"), systemImage: "wifi.exclamationmark",
                description: Text(appLocalized("ios.common.retryLater")))
        default: EmptyView()
        }
    }

    /// 등급 단어(낭독 정본) + 수치(보강, value 있으면 괄호로)
    private func pollutantText(_ label: String, _ pollutant: AirPollutant) -> String {
        let grade = gradeWord(pollutant.grade)
        guard let value = pollutant.value else { return "\(label), \(grade)" }
        return "\(label), \(grade) (\(numberText(value)))"
    }

    /// 공기질 등급 단어. 미지의 값은 "정보 없음"으로(잘못된 단정 금지)
    private func gradeWord(_ grade: String) -> String {
        switch grade {
        case "good": appLocalized("airQuality.grade.good")
        case "moderate": appLocalized("airQuality.grade.moderate")
        case "bad": appLocalized("airQuality.grade.bad")
        case "veryBad": appLocalized("airQuality.grade.veryBad")
        default: appLocalized("airQuality.unknown")
        }
    }

    private func skyWord(_ label: String) -> String {
        switch label {
        case "clear": appLocalized("weather.sky.clear")
        case "partlyCloudy": appLocalized("ios.nearby.skyPartly")
        case "cloudy": appLocalized("weather.sky.cloudy")
        default: appLocalized("weather.unknown")
        }
    }

    private func precipWord(_ label: String) -> String {
        switch label {
        case "none": appLocalized("weather.precipitation.none")
        case "rain": appLocalized("weather.precipitation.rain")
        case "rainSnow": appLocalized("ios.nearby.rainSnow")
        case "snow": appLocalized("weather.precipitation.snow")
        case "shower": appLocalized("weather.precipitation.shower")
        default: appLocalized("weather.unknown")
        }
    }

    /// 정수값 소수점 제거("31.0도" 방지), 소수는 그대로("24.2도"·"0.3km")
    private func numberText(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(value)
    }
}
