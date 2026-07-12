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
                "날씨와 공기질 정보를 불러왔습니다"
            } else if newWeather != nil || newAir != nil {
                "일부 정보를 가져오지 못했습니다"
            } else {
                "정보를 가져오지 못했습니다"
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
        .navigationTitle("날씨·공기질")
        .nearbyStateOverlay { stateOverlay }
        .task { await model.load() }
        .nearbyRefreshable { await model.load(force: true) }
    }

    @ViewBuilder private var weatherSection: some View {
        Section {
            if let weather = model.weather {
                Text("하늘, \(skyWord(weather.sky.label))")
                Text("강수, \(precipWord(weather.precipitation.label))")
                if let temp = weather.tempC { Text("현재 기온 \(numberText(temp))도") }
                // 둘 다 null이면 생략, 한쪽만이면 있는 쪽만
                if weather.tempMax != nil || weather.tempMin != nil {
                    Text(joinText(
                        weather.tempMax.map { "최고 \(numberText($0))도" },
                        weather.tempMin.map { "최저 \(numberText($0))도" }))
                }
                if let humidity = weather.humidity { Text("습도 \(numberText(humidity))%") }
                if let probability = weather.precipProbability { Text("강수확률 \(numberText(probability))%") }
                Text("기준 시각 \(weather.baseTime)")
            } else {
                Text("날씨 정보를 가져오지 못했습니다")
            }
        } header: {
            Text("날씨").accessibilityAddTraits(.isHeader)
        }
    }

    @ViewBuilder private var airSection: some View {
        Section {
            if let air = model.air {
                Text("\(air.stationName) 측정소, \(numberText(air.distanceKm))km")
                Text(pollutantText("통합대기환경지수", air.khai))
                Text(pollutantText("미세먼지", air.pm10))
                Text(pollutantText("초미세먼지", air.pm25))
                Text("측정 시각 \(air.dataTime)")
            } else {
                Text("공기질 정보를 가져오지 못했습니다")
            }
        } header: {
            Text("공기질").accessibilityAddTraits(.isHeader)
        }
    }

    @ViewBuilder private var stateOverlay: some View {
        switch model.phase {
        case .loading: ProgressView("확인 중")
        case .denied:
            ContentUnavailableView("위치 권한이 필요합니다", systemImage: "location.slash",
                description: Text("설정 앱에서 길동무 베타의 위치 접근을 허용해 주세요"))
        case .failed:
            ContentUnavailableView("정보를 가져오지 못했습니다", systemImage: "wifi.exclamationmark",
                description: Text("잠시 후 다시 시도해 주세요"))
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
        case "good": "좋음"
        case "moderate": "보통"
        case "bad": "나쁨"
        case "veryBad": "매우 나쁨"
        default: "정보 없음"
        }
    }

    private func skyWord(_ label: String) -> String {
        switch label {
        case "clear": "맑음"
        case "partlyCloudy": "구름 조금"
        case "cloudy": "흐림"
        default: "정보 없음"
        }
    }

    private func precipWord(_ label: String) -> String {
        switch label {
        case "none": "강수 없음"
        case "rain": "비"
        case "rainSnow": "비 또는 눈"
        case "snow": "눈"
        case "shower": "소나기"
        default: "정보 없음"
        }
    }

    /// 정수값 소수점 제거("31.0도" 방지), 소수는 그대로("24.2도"·"0.3km")
    private func numberText(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(value)
    }
}
