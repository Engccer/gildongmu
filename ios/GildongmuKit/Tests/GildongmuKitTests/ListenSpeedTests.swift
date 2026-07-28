import AVFoundation
import Testing
@testable import GildongmuKit

/// 듣기 속도 순수 규칙 검증(dodo `TtsRulesTests` 속도 절 미러, 2026-07-28 이식).
struct ListenSpeedTests {
    // MARK: - normalizeSpeed

    @Test func 허용값은_그대로_통과() {
        #expect(ListenSpeed.normalizeSpeed(1) == 1)
        #expect(ListenSpeed.normalizeSpeed(1.5) == 1.5)
        #expect(ListenSpeed.normalizeSpeed(2) == 2)
    }

    @Test func 미설정과_이상값은_1로_정규화() {
        #expect(ListenSpeed.normalizeSpeed(nil) == 1)
        #expect(ListenSpeed.normalizeSpeed(0) == 1)
        #expect(ListenSpeed.normalizeSpeed(3) == 1)
        #expect(ListenSpeed.normalizeSpeed(1.25) == 1)
        #expect(ListenSpeed.normalizeSpeed(-1) == 1)
    }

    // MARK: - speechRate(forMultiplier:)

    /// 1배 앵커(0.55)는 위원장이 "듣기 좋다" 확정한 불변값이다.
    @Test func 기본_배율은_고정_앵커와_일치() {
        #expect(ListenSpeed.speechRate(forMultiplier: 1) == ListenSpeed.baseSpeechRate)
        #expect(ListenSpeed.speechRate(forMultiplier: 1) == 0.55)
    }

    /// 1.5배·2배는 곱셈이 아니라 실측 duration 기반 캘리브레이션 테이블 값이다
    /// (`ListenSpeed.speechRate` 문서 주석의 실측 표 참조). 곱셈 매핑이라면 각각
    /// 0.825·1.0(클램프)이었을 값이 0.65·0.75인 것이 dodo 실기기 결함 수정의 핵심 —
    /// 곱셈 재도입 시 이 테스트가 깨진다.
    @Test func 캘리브레이션_테이블이지_선형_곱셈이_아니다() {
        #expect(ListenSpeed.speechRate(forMultiplier: 1.5) == 0.65)
        #expect(ListenSpeed.speechRate(forMultiplier: 2) == 0.75)
        #expect(ListenSpeed.speechRate(forMultiplier: 1.5) != ListenSpeed.baseSpeechRate * 1.5)
        #expect(ListenSpeed.speechRate(forMultiplier: 2) != min(ListenSpeed.baseSpeechRate * 2, 1.0))
    }

    /// 세 값이 서로 명확히 구분되고 상한 안이어야 한다 — 옛 선형 매핑이 0.825 vs 1.0(클램프)을
    /// 상한 압축 구간에 몰아 청감상 동일했던 결함(dodo 위원장 실기기 보고)의 회귀 가드.
    @Test func 세_배율_값은_상호_구분되고_상한_이내() {
        let rate1 = ListenSpeed.speechRate(forMultiplier: 1)
        let rate15 = ListenSpeed.speechRate(forMultiplier: 1.5)
        let rate2 = ListenSpeed.speechRate(forMultiplier: 2)
        #expect(rate1 < rate15)
        #expect(rate15 < rate2)
        #expect(rate2 <= Float(AVSpeechUtteranceMaximumSpeechRate))
    }

    /// 허용 밖 배율(정규화 전 값이 흘러들어온 경우)도 안전하게 앵커로 낙착한다.
    @Test func 미지_배율은_앵커로_낙착() {
        #expect(ListenSpeed.speechRate(forMultiplier: 3) == ListenSpeed.baseSpeechRate)
    }
}
