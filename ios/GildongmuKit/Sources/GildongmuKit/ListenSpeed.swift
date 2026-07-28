import Foundation

/// 채팅 응답 듣기 속도(1/1.5/2배) 순수 규칙(dodo-planet `TtsRules` 속도 절 이식, 2026-07-28).
/// 재생 계층(`TtsPlayer`)과 분리해 단위 테스트만으로 검증한다. gildongmu는 요약 자동 듣기가
/// 없어 속도 값을 하나만 둔다(dodo의 full/summary 이원화 비이식).
public enum ListenSpeed {
    /// 설정 픽커가 노출하는 허용 배속.
    public static let allowedSpeeds: [Double] = [1, 1.5, 2]

    /// `@AppStorage`/`UserDefaults` 공유 키. 무인증 앱이라 기기 로컬 저장이 정본이다.
    public static let storageKey = "listenSpeed"

    /// 허용값(1/1.5/2) 외의 값(미설정·이상값)은 1로 정규화한다(dodo `normalizeSpeed` 동일 계약).
    public static func normalizeSpeed(_ value: Double?) -> Double {
        guard let value, allowedSpeeds.contains(value) else { return 1 }
        return value
    }

    /// 온디바이스 낭독 기준 속도(배속 1일 때 값) — 시스템 기본
    /// `AVSpeechUtteranceDefaultSpeechRate`(0.5)보다 약간 빠르게(위원장 선호, 2026-07-27).
    public static let baseSpeechRate: Float = 0.55

    /// `AVSpeechUtterance.rate` 축은 선형 재생 배속이 아니라 비선형 정규화 컨트롤이다(2026-07-28
    /// dodo 위원장 실기기 보고: 1.5배·2배 설정이 청감상 구분되지 않음 — 원인은 곱셈 매핑
    /// `baseSpeechRate × multiplier`가 두 값을 상한 근처(0.825·1.0클램프)로 몰아 그 구간에서
    /// 실제 발화가 압축·포화되기 때문). 곱셈 대신 실측 duration 기반 3점 캘리브레이션 테이블을
    /// 쓴다. 1배 앵커(`baseSpeechRate` 0.55)는 위원장이 "듣기 좋다" 확정한 불변값이고,
    /// 1.5배·2배는 dodo가 시뮬레이터 ko-KR 보이스로 채팅 응답 풍 고정 문장(2~3문장)을
    /// `AVSpeechSynthesizer.write(_:toBufferCallback:)`로 rate 0.50~1.00(0.05 간격 + 0.825)에서
    /// 합성해 오디오 총 길이를 실측한 뒤, `duration(0.55)/1.5`·`duration(0.55)/2.0`에 가장
    /// 가까운 rate를 역산해 채택했다(dodo 3a4d72eb, 진단 코드는 일회성이라 커밋에 없음).
    ///
    /// 실측 표(2026-07-28, 시뮬레이터 iPhone 17 iOS 26.5, ko-KR 보이스):
    /// rate=0.50→8.769s / 0.55→6.777s(앵커) / 0.60→5.515s / 0.65→4.797s / 0.70→4.160s /
    /// 0.75→3.522s / 0.825→3.129s / 0.90→2.492s / 1.00→2.179s.
    /// 목표 1.5배=4.518s → 최근접 rate 0.65(실측 4.797s, 실제 달성 배율 약 1.41배).
    /// 목표 2.0배=3.389s → 최근접 rate 0.75(실측 3.522s, 실제 달성 배율 약 1.92배).
    /// ⚠ 곱셈 매핑 재도입 금지. 캘리브레이션은 ko-KR 기준 — 타 로케일 보이스는 곡선이 다를 수
    /// 있으나 단일 테이블을 쓴다(로케일별 테이블은 실기기 불만 보고가 나올 때만, YAGNI).
    public static func speechRate(forMultiplier multiplier: Double) -> Float {
        switch multiplier {
        case 1.5: 0.65
        case 2: 0.75
        default: baseSpeechRate
        }
    }
}
