import SwiftUI
import Observation
import GildongmuKit

/// 두 조각을 한 커밋으로 묶는 payload. weather·air의 nil = 조회 실패 또는 데이터 부재
/// (둘 다 "가져오지 못했습니다"로 표시), fresh*는 이번 호출의 성공 여부로 통지 판정 전용.
struct ConditionsPayload: Sendable {
    let weather: Weather?
    let air: AirQuality?
    let freshWeather: Bool
    let freshAir: Bool
}

/// 날씨·공기질 — NearbyLoadCore 껍데기. 두 fetch를 async let으로 독립 실행해
/// 한쪽 실패가 다른 쪽을 안 죽인다(웹 allSettled 미러). 조각의 null·실패는 동일하게
/// "가져오지 못했습니다" 문장으로 노출(자동 등장 보조 정보의 graceful degrade).
@Observable @MainActor
final class ConditionsModel {
    private let core: NearbyLoadCore<ConditionsPayload>
    var phase: NearbyLoadPhase<ConditionsPayload> { core.phase }

    init() {
        let service = ConditionsService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, previous in
                guard let coord else { preconditionFailure("current 소스는 좌표 보장") }
                async let weatherOutcome = Self.fetchWeather(service, lat: coord.lat, lng: coord.lng)
                async let airOutcome = Self.fetchAir(service, lat: coord.lat, lng: coord.lng)
                let (weatherResult, airResult) = await (weatherOutcome, airOutcome)
                // 서버 마커 이중 방어: 좌표 선분기를 통과했어도 fetch 시점에 커버리지 밖 마커를
                // 만날 수 있다 — 한쪽이라도 감지하면 부분 데이터를 버리고 화면 전체를 전환한다.
                if weatherResult.outOfCoverage || airResult.outOfCoverage { throw APIError.outOfCoverage }
                // 새로고침에 실패한 조각은 직전 성공을 유지(재조회이지 데이터 포기 아님, M2 계약)
                return ConditionsPayload(
                    weather: weatherResult.value ?? previous?.weather,
                    air: airResult.value ?? previous?.air,
                    freshWeather: weatherResult.value != nil,
                    freshAir: airResult.value != nil)
            },
            onEvent: nearbyAnnouncer(loaded: { payload in
                // 완료 통지 1회(진행 통지 없음): 이번 호출의 두 결과로만 판정
                // (병합된 weather·air 검사 금지 — 직전 성공이 새로고침 실패를 성공으로 오통지)
                if payload.freshWeather && payload.freshAir {
                    appLocalized("ios.nearby.conditionsReady")
                } else if payload.freshWeather || payload.freshAir {
                    appLocalized("ios.nearby.conditionsPartial")
                } else {
                    appLocalized("ios.common.failedTitle")
                }
            }))
    }

    func load(force: Bool = false) async { await core.load(force: force) }

    /// 날씨 fetch: 커버리지 마커는 nil(실패)과 구분해 표시(이중 방어 판정용).
    /// 그 외 실패는 nil로 흡수(기존 graceful degrade 계약 유지 — 한쪽 실패가 다른 쪽을 안 죽임).
    /// ⚠ 이 catch-all은 취소도 흡수해 "両조각 실패" 페이로드를 정상 반환한다 — 떠난 화면에
    /// 실패 통지가 나가는 것을 막는 방어는 코어의 커밋 게이트가 정본이다(조각 catch 수정 금지).
    nonisolated private static func fetchWeather(
        _ service: ConditionsService, lat: Double, lng: Double
    ) async -> (value: Weather?, outOfCoverage: Bool) {
        do {
            return (try await service.weather(lat: lat, lng: lng), false)
        } catch APIError.outOfCoverage {
            return (nil, true)
        } catch {
            return (nil, false)
        }
    }

    /// 공기질 fetch: 위 fetchWeather와 동형.
    nonisolated private static func fetchAir(
        _ service: ConditionsService, lat: Double, lng: Double
    ) async -> (value: AirQuality?, outOfCoverage: Bool) {
        do {
            return (try await service.air(lat: lat, lng: lng), false)
        } catch APIError.outOfCoverage {
            return (nil, true)
        } catch {
            return (nil, false)
        }
    }
}

/// 날씨·공기질 화면. 등급·상태 단어가 낭독 정본이고 수치는 보강(value null이면 단어만).
/// 섹션 헤더 heading이 발견 경로(.isHeader), 라벨-값은 평문 단일 텍스트.
struct ConditionsView: View {
    @State private var model = ConditionsModel()

    var body: some View {
        List {
            if case .loaded(let payload) = model.phase {
                weatherSection(payload.weather)
                airSection(payload.air)
            }
        }
        .navigationTitle(appLocalized("ios.nearby.conditions"))
        .nearbyStateOverlay {
            NearbyStateOverlayView(phase: model.phase, descriptor: .plain())
        }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }

    @ViewBuilder private func weatherSection(_ weather: Weather?) -> some View {
        Section {
            if let weather {
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

    @ViewBuilder private func airSection(_ air: AirQuality?) -> some View {
        Section {
            if let air {
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
