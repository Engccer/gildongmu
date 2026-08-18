import Foundation
@preconcurrency import AVFoundation

/// 받아쓰기 인식 엔진 계약. `SpeechService`가 세션마다 하나를 만들어 아래 순서로 부른다:
/// `prepare` → (오디오 세션 설정) → `attach` → (VO 차단·`audioEngine.start`) → `run` →
/// `finish`(정지) 또는 `cancel`(폐기). 권한·취소 세대·상태 전이·통지는 서비스 몫이고,
/// 엔진은 "이 OS의 온디바이스 인식 API를 어떻게 부르는가"만 안다.
///
/// **불변식: 어느 구현도 오디오를 기기 밖으로 보내지 않는다**(개인정보 3자 일치 —
/// 웹 privacy 카피 "기기 안에서 처리"·PrivacyInfo·ASC 라벨의 근거). 서버 인식 폴백 금지.
@MainActor
protocol SpeechEngine: AnyObject {
    /// 로케일 지원·엔진 고유 권한·모델 준비. 오래 걸리는 준비(모델 다운로드)에 앞서
    /// `willDownload`를 1회 부른다 — 서비스가 취소 여부를 판정하고(throw로 중단) 화면에
    /// "준비 중"을 낸다. 준비 단계가 없는 엔진은 부르지 않는다.
    func prepare(locale: Locale, willDownload: () throws -> Void) async throws
    /// 마이크 탭 설치 + 인식 입력 경로 구성. `onPartial`은 **세션 누적 전사**(volatile 포함),
    /// `onFailure`는 인식 스트림 사망(정상 종료·취소는 부르지 않는다).
    func attach(
        to audioEngine: AVAudioEngine,
        onPartial: @escaping @MainActor (String) -> Void,
        onFailure: @escaping @MainActor () -> Void
    ) async throws
    /// 오디오 엔진 기동 뒤 인식 개시.
    func run() async throws
    /// 정지: 남은 입력을 최종으로 확정하고 스트림 종료까지 기다린 뒤 최종 전사를 돌려준다.
    func finish() async -> String
    /// 결과 없이 폐기.
    func cancel() async
}

/// OS 버전이 엔진을 정한다. iOS 26+는 SpeechAnalyzer(앱이 모델을 내려받는 신형),
/// 그 아래는 SFSpeechRecognizer 온디바이스 강제(최소 지원 버전 18 하향의 근거,
/// spec `2026-08-19-ios-min-version-18-design.md`).
@MainActor
func makeSpeechEngine() -> any SpeechEngine {
    if #available(iOS 26, *) {
        return AnalyzerSpeechEngine()
    } else {
        return LegacySpeechEngine()
    }
}
