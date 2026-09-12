import UIKit
import GildongmuKit

/// 결과 진동 — 앱 전반의 1회성 결과·전이를 손에 알리는 **단일 창구**(E30 확장, 위원장 판정 2026-09-13).
///
/// 어휘는 iOS 표준 3종뿐이다(`UINotificationFeedbackGenerator` — 이미 몸이 아는 진동이고, 안내 톤
/// 13종의 맞춤 패턴과 질감이 다르다. 화면별 맞춤 패턴은 기각). 3-state를 촉각에도 지킨다:
/// - `success` = 결과 있음(검색 건수·경로 조회 완료·복사됨·경로 복귀)
/// - `attention` = 0건·정보 없음·상태 변화(커버리지 밖·최종 접근 진입·소리 백그라운드 불가)
/// - `failure` = 오류·거부(조회 실패·권한 거부·재조회 실패·소리 재생 불가)
///
/// **1회성 결과·전이에만** 쓴다 — 반복 상태 통지(간략 거리·최종 접근 틱·직진 잔여·채팅 진행)에는
/// 넣지 않는다(정상 진행·경고 빈도 비대칭 정책과 같은 선). 통지(`AccessibilityNotification`)와 짝으로
/// 그 통지를 게시하는 자리에 한 줄씩 두고, 통지가 삼켜지는 경로(무통지 조회)는 진동도 삼킨다.
///
/// 전부 **"진동 알림 확장" 스위치 뒤**다(`TrendHaptics.storageKey`, 실험판 설정 — 꺼짐 = 종전 동작).
/// 정식 2.0에서 "결과 진동은 항상 낼지"를 다시 판정한다. 백그라운드에서는 플랫폼이 내지 않는다(수용).
/// 기존 발원지 4곳(안내 톤 재생기·받아쓰기 시작/정지·홀드 제스처·채팅 답변 도착)은 이 창구 밖이고
/// 스위치와 무관하다 — 소스 가드 `result-haptic-guard.test.ts`가 직접 생성 자리를 그 집합으로 잠근다.
@MainActor
enum ResultHaptic {
    enum Kind {
        case success, attention, failure
    }

    /// 재사용 인스턴스 — 호출마다 새로 만들면 첫 진동이 늦는다. `prepare()`는 발화 직전에.
    private static let generator = UINotificationFeedbackGenerator()

    static func fire(_ kind: Kind) {
        guard UserDefaults.standard.bool(forKey: TrendHaptics.storageKey) else { return }
        generator.prepare()
        switch kind {
        case .success: generator.notificationOccurred(.success)
        case .attention: generator.notificationOccurred(.warning)
        case .failure: generator.notificationOccurred(.error)
        }
    }
}
