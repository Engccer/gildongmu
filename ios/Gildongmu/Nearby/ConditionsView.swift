import SwiftUI
import Observation
import GildongmuKit

/// 세 조각을 한 커밋으로 묶는 payload. weather·air의 nil = 조회 실패 또는 데이터 부재
/// (둘 다 "가져오지 못했습니다"로 표시), fresh*는 이번 호출의 성공 여부로 통지 판정 전용.
/// congestion의 nil은 성격이 다르다: 부재가 정상이라 아무것도 그리지 않는다(아래 congestionSection).
struct ConditionsPayload: Sendable {
    let weather: Weather?
    let air: AirQuality?
    let congestion: Congestion?
    let freshWeather: Bool
    let freshAir: Bool
}

/// 날씨·공기질·혼잡도를 담는 NearbyLoadCore 껍데기. 세 fetch를 async let으로 독립 실행해
/// 한쪽 실패가 다른 쪽을 안 죽인다(웹 allSettled 미러). 날씨·공기질 조각의 null·실패는 동일하게
/// "가져오지 못했습니다" 문장으로 노출(자동 등장 보조 정보의 graceful degrade).
@Observable @MainActor
final class ConditionsModel {
    private let core: NearbyLoadCore<ConditionsPayload>
    var phase: NearbyLoadPhase<ConditionsPayload> { core.phase }

    /// anchor: nil = 현재 위치(내 주변 허브), 좌표 = 그 좌표 고정(장소 상세 "이 장소 주변").
    init(anchor: PlaceAnchor? = nil) {
        let service = ConditionsService(client: APIClient(baseURL: AppConfig.apiBaseURL))
        core = NearbyLoadCore(
            coordinate: anchor.map { .fixed($0.coord) } ?? LocationService.nearbyCoordinateSource(),
            coverage: .korea,
            fetch: { coord, previous in
                guard let coord else { preconditionFailure("current·fixed 소스는 좌표 보장") }
                async let weatherOutcome = Self.fetchWeather(service, lat: coord.lat, lng: coord.lng)
                async let airOutcome = Self.fetchAir(service, lat: coord.lat, lng: coord.lng)
                async let congestionOutcome = Self.fetchCongestion(service, lat: coord.lat, lng: coord.lng)
                let (weatherResult, airResult, congestionResult) =
                    await (weatherOutcome, airOutcome, congestionOutcome)
                // 서버 마커 이중 방어: 좌표 선분기를 통과했어도 fetch 시점에 커버리지 밖 마커를
                // 만날 수 있다 — 한쪽이라도 감지하면 부분 데이터를 버리고 화면 전체를 전환한다.
                if weatherResult.outOfCoverage || airResult.outOfCoverage || congestionResult.outOfCoverage {
                    throw APIError.outOfCoverage
                }
                // 새로고침에 실패한 조각은 직전 성공을 유지(재조회이지 데이터 포기 아님, M2 계약)
                return ConditionsPayload(
                    weather: weatherResult.value ?? previous?.weather,
                    air: airResult.value ?? previous?.air,
                    // 혼잡도만 병합 규칙이 다르다: **성공한 조회의 nil은 "여기는 핫스팟이 아니다"라는
                    // 답**이라 직전 값으로 되살리면 안 된다(이동 후 새로고침에서 옛 영역이 남아
                    // 다른 동네 혼잡도를 이 자리 정보로 낭독하게 된다). 실패했을 때만 직전 값 유지.
                    congestion: congestionResult.ok ? congestionResult.value : previous?.congestion,
                    freshWeather: weatherResult.value != nil,
                    freshAir: airResult.value != nil)
            },
            onEvent: nearbyAnnouncer(loaded: { payload in
                // 완료 통지 1회(진행 통지 없음): 이번 호출의 두 결과로만 판정
                // (병합된 weather·air 검사 금지 — 직전 성공이 새로고침 실패를 성공으로 오통지)
                // ⚠ 혼잡도는 판정에 넣지 않는다: 서울 121개 핫스팟 밖이 정상 상태(서울의 91%)라
                // 부재를 실패로 세면 대다수 사용자가 매번 "일부 정보를 가져오지 못했습니다"를 듣는다.
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

    /// 혼잡도 fetch: 성공 여부를 `ok`로 따로 들고 온다. 성공한 nil("핫스팟 아님")과
    /// 실패한 nil을 값 하나로 뭉개면 위 병합 규칙(성공 nil은 덮어쓰기, 실패는 유지)이 성립하지 않는다.
    nonisolated private static func fetchCongestion(
        _ service: ConditionsService, lat: Double, lng: Double
    ) async -> (value: Congestion?, ok: Bool, outOfCoverage: Bool) {
        do {
            return (try await service.congestion(lat: lat, lng: lng), true, false)
        } catch APIError.outOfCoverage {
            return (nil, false, true)
        } catch {
            return (nil, false, false)
        }
    }
}

/// 날씨·공기질·혼잡도 화면(웹 LocalConditions 대응). 등급·상태 단어가 낭독 정본이고
/// 수치는 보강(value null이면 단어만). 섹션 헤더 heading이 발견 경로(.isHeader),
/// 라벨-값은 평문 단일 텍스트.
struct ConditionsView: View {
    private let anchor: PlaceAnchor?
    @State private var model: ConditionsModel
    /// 이 화면만 목록이 아니라 섹션 구조라 착지 대상이 첫 섹션 헤더(날씨)다.
    @AccessibilityFocusState private var focusedSection: String?
    @State private var lander = NearbyFocusLander()

    /// 첫 섹션 헤더의 포커스·스크롤 공용 키(둘이 달라지면 가시화가 조용히 실패한다).
    private static let weatherAnchorID = "conditions-weather"

    /// anchor 기본값 nil = 현재 위치(내 주변 허브 호출처 무변경).
    init(anchor: PlaceAnchor? = nil) {
        self.anchor = anchor
        _model = State(initialValue: ConditionsModel(anchor: anchor))
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if case .loaded(let payload) = model.phase {
                    weatherSection(payload.weather)
                    airSection(payload.air)
                    congestionSection(payload.congestion)
                }
            }
            .navigationTitle(nearbyTitle(appLocalized("ios.nearby.conditions"), anchor: anchor))
            .nearbyStateOverlay {
                NearbyStateOverlayView(
                phase: model.phase,
                onPreciseGranted: { Task { await model.load(force: true) } },
                descriptor: .plain())
            }
            .task { await model.load() }
            .nearbyRefreshable { await model.load(force: true) }
            .nearbyFocusOnLoad(
                id: loadedAnchorID, lander: lander, proxy: proxy,
                current: { focusedSection },
                apply: { focusedSection = $0 })
        }
    }

    /// 로드 완료 신호 — 이 화면은 payload가 단일 구조체라 항목 id가 없다.
    /// 완료되면 고정 앵커 키를 내보내 nil→값 전이를 만든다(실패는 nil로 남는다).
    private var loadedAnchorID: String? {
        guard case .loaded = model.phase else { return nil }
        return Self.weatherAnchorID
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
            Text(appLocalized("ios.nearby.weatherHeading"))
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($focusedSection, equals: Self.weatherAnchorID)
                .id(Self.weatherAnchorID)   // scrollTo 대상(포커스 키와 같은 값)
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

    /// 실시간 인구 혼잡도. **없으면 줄 자체가 없다**. 서울 121개 핫스팟이 아닌 곳이 서울의
    /// 91%라 부재가 정상이고, 부재를 설명하면 대다수 사용자가 매번 그 안내를 듣는다(날씨·공기질이
    /// 실패 문장을 내는 것과 다른 이유: 그 둘은 어디서나 값이 있는 게 정상이다). 조회 실패도
    /// 같은 침묵인데, 사용자가 핫스팟 안에 있었는지를 실패한 응답으로는 알 수 없어 "가져오지
    /// 못했습니다"가 핫스팟 밖 사용자에게까지 나가기 때문이다(없는 것을 잃었다고 말하지 않는다).
    /// 별도 헤더를 두지 않는다. 요약 줄이 스스로 "혼잡도"를 말한다(스펙 §3).
    @ViewBuilder private func congestionSection(_ congestion: Congestion?) -> some View {
        if let congestion {
            Section {
                Text(appLocalized("congestion.summary", congestion.name, levelWord(congestion.level)))
                // 완성 문장은 API가 한국어로만 주는 자유 텍스트라 번역 수단이 없다.
                // 비한국어 사용자에겐 닫힌 집합이라 번역되는 등급어만 남긴다(웹 데이터 언어 분리 미러).
                if AppLanguage.current == "ko", !congestion.message.isEmpty {
                    Text(congestion.message)
                }
                Text(appLocalized("congestion.asOf", congestion.asOf))
            }
        }
    }

    /// 혼잡도 등급 단어(낭독 정본). 번역표에 없는 신설 등급은 원문 그대로 읽는다
    /// (정보를 잃느니 한국어를 낭독한다. 등급을 임의로 접으면 없는 단정이 된다).
    private func levelWord(_ raw: String) -> String {
        switch CongestionLevelKey(levelText: raw) {
        case .relaxed: appLocalized("congestion.levels.relaxed")
        case .normal: appLocalized("congestion.levels.normal")
        case .slightlyBusy: appLocalized("congestion.levels.slightlyBusy")
        case .busy: appLocalized("congestion.levels.busy")
        case nil: raw
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
