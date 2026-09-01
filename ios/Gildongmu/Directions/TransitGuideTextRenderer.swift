import Foundation
import GildongmuKit

/// Kit descriptor → 앱 카탈로그 문자열(E27 잔여 ①, spec 2026-09-01 §3.7).
///
/// 판정(키·인자 순서·줄 언어)은 Kit `TransitGuideText`가 하고 여기서는 **리터럴 키 조회**만 한다.
/// 리터럴인 이유는 `check-xcstrings-keys.mjs`의 추출 계약이다(동적 키는 린터가 못 센다) —
/// `TransitWalkLegText` 선례와 같은 배치이며, `switch` 망라성은 웹 소스 가드가
/// `transitTextKeys`와 대조해 강제한다(앱 타깃엔 테스트 레인이 없다).
enum TransitGuideTextRenderer {
    /// 한 줄 → 문자열. 조각을 각자 조회해 쉼표로 잇는다(빈 조각 제거 — 웹 `joinText` 미러).
    ///
    /// ⚠ **en 세션에서 ko로 떨어진 줄은 계측한다**(spec §3.8). iOS는 줄 단위 언어 태깅 수단이
    /// 아직 없어 한국어 폴백이 영어 음성에 삼켜질 수 있는데, 그것을 수용 위험으로 넘기는 대신
    /// **관측 가능하게** 만드는 것이 그 절의 조건이다. 실승차에서 한글이 들렸을 때 이 로그가
    /// 있으면 "서버가 영문을 못 만든 정상 폴백", 없으면 "배선 누락"으로 갈린다 — 화면만으로는
    /// 못 가르는 구분이고 FIELD-TEST §5-6이 그 회수를 전제한다.
    static func render(_ line: TransitTextLine) -> String {
        if transitGuideIsEn, line.lang == "ko", !line.parts.isEmpty {
            let keys = line.parts.compactMap(\.key).joined(separator: ",")
            transitGuideLog("koFallback keys=\(keys.isEmpty ? "(raw)" : keys)")
        }
        return line.parts.map(part).filter { !$0.isEmpty }.joined(separator: ", ")
    }

    private static func part(_ p: TransitTextPart) -> String {
        if let text = p.text { return text }
        guard let key = p.key else { return "" }
        let args = p.args ?? []
        switch key {
        case "waitContext": return appLocalized("transitGuide.waitContext", arguments: args)
        case "waitContextWalk": return appLocalized("transitGuide.waitContextWalk", arguments: args)
        case "boardingContext": return appLocalized("transitGuide.boardingContext", arguments: args)
        case "context": return appLocalized("transitGuide.context", arguments: args)
        case "messageFrame": return appLocalized("transitGuide.messageFrame", arguments: args)
        case "subwayNextStop": return appLocalized("transitGuide.subwayNextStop", arguments: args)
        case "subwayArriving": return appLocalized("transitGuide.subwayArriving", arguments: args)
        case "subwayAtStop": return appLocalized("transitGuide.subwayAtStop", arguments: args)
        case "subwayDeparted": return appLocalized("transitGuide.subwayDeparted", arguments: args)
        case "approachFrame": return appLocalized("transitGuide.approachFrame", arguments: args)
        case "vehicleSelected": return appLocalized("transitGuide.vehicleSelected", arguments: args)
        case "selectedVehicle": return appLocalized("transitGuide.selectedVehicle", arguments: args)
        case "vehiclePassed": return appLocalized("transitGuide.vehiclePassed", arguments: args)
        case "arrivedAtBoardStop": return appLocalized("transitGuide.arrivedAtBoardStop", arguments: args)
        case "boarded": return appLocalized("transitGuide.boarded", arguments: args)
        case "boardedCount": return appLocalized("transitGuide.boardedCount", arguments: args)
        case "currentStation": return appLocalized("transitGuide.currentStation", arguments: args)
        case "bound": return appLocalized("transitGuide.bound", arguments: args)
        case "expressCheck": return appLocalized("transitGuide.expressCheck", arguments: args)
        case "departed": return appLocalized("transitGuide.departed", arguments: args)
        case "terminatesEarly": return appLocalized("transitGuide.terminatesEarly", arguments: args)
        case "viaBoard": return appLocalized("transitGuide.viaBoard", arguments: args)
        case "viaAlight": return appLocalized("transitGuide.viaAlight", arguments: args)
        case "viaCurrent": return appLocalized("transitGuide.viaCurrent", arguments: args)
        case "overviewLeg": return appLocalized("transitGuide.overviewLeg", arguments: args)
        case "prewalkStart": return appLocalized("transitGuide.prewalkStart", arguments: args)
        case "prewalkArrived": return appLocalized("transitGuide.prewalkArrived", arguments: args)
        case "prewalkArrivedButton": return appLocalized("transitGuide.prewalkArrivedButton", arguments: args)
        default:
            // Kit이 키를 늘렸는데 여기 case가 빠진 것 — 문자열 switch라 컴파일러가 못 잡으므로
            // 디버그에서 즉시 드러내고, 릴리스는 키를 그대로 노출해 침묵을 피한다.
            assertionFailure("TransitGuideText 키 미매핑: \(key)")
            return key
        }
    }
}

/// 데이터 언어 축 — 비-ko 로케일은 전부 영문 데이터를 공유한다(E27 잔여 ① §3.1).
var transitGuideIsEn: Bool { AppLanguage.dataLocale == "en" }
