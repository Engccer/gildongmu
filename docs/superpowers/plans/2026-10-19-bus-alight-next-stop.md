# A69 버스 하차 통지 구현 계획

spec: `docs/superpowers/specs/2026-10-19-bus-alight-next-stop-design.md`

구현 방식 판정: 태스크 1·2(웹 기준본)는 inline(같은 파일 다중 편집·후속 인터페이스 결정), 태스크 3(Kit·`:kit` 미러)은 웹 기준본 확정 뒤 `model: sonnet` 서브에이전트 1건, 태스크 4(iOS 앱 배선)는 inline(소스 가드와 맞물림).

## 태스크 1. 문자열과 descriptor (웹 기준본)
- `messages/{ko,en,ja,es,fr,it}.json` `transitGuide`: `arrivingAtAlightStop` 교체 + `arrivingAtAlightStopUnnamed`·`alightStopReached`·`alightStopReachedUnnamed` 추가.
- `src/lib/transit-guide-text.ts`: `arrivingAtAlightStopLine(isEn, leg)`·`alightStopReachedLine(isEn, leg)` — `alight.ko`가 비면 `Unnamed` 키(인자 없음, `lang`은 세션 언어). `TRANSIT_TEXT_KEYS`에 네 키.
- fixture `transit-guide-text-cases.json` 사례 추가, 웹 텍스트 테스트 디스패치에 두 fn.
- `useTransitGuide.ts` `arrivingAtAlightStop` 분기를 descriptor로.

## 태스크 2. GPS 판정(웹 기준본)
- `src/lib/transit-bus-stop.ts`: `TransitBusAlightNotice`·`busAlightNoticeStep(prev, state, leg, result, fix, now)`·문턱 상수 둘(spec §2.1, 설계 리뷰 H3·H4 반영).
- fixture `transit-bus-stop-cases.json`에 `fn: "alightNotice"` 시퀀스 사례(단계마다 `busStopStep` → `busAlightNoticeStep`), `transit-bus-stop.test.ts` 디스패치.
- `useTransitGuide.ts`: 래치 ref, `watchPosition` 콜백에서 판정·announce, 세션 시작·경로 변경·종료에서 비움, 역순 방지.
- 가드 `transit-bus-stop-guard.test.ts`: 허용 목록(플랫폼별 호출 1곳, 리듀서 입력 금지), iOS 배선 축.

## 태스크 3. 미러(sonnet 서브에이전트)
- Kit `TransitGuideText.swift`(두 함수·키 목록)·`TransitBusStop.swift`(`TransitBusAlightNotice`·`transitBusAlightNoticeStep`)와 테스트 디스패치, `:kit` `TransitGuideText.kt`와 테스트 디스패치. 공유 fixture 통과.

## 태스크 4. iOS 앱 배선(inline)
- `TransitGuideTextRenderer.swift` 리터럴 switch 네 키.
- `TransitGuideModel.swift`: `announcementText`의 `.arrivingAtAlightStop`을 descriptor로, `ingestKeepAliveFix`에서 판정 → 톤 `.nearby`(false) + `announce(high, .actionable, onDropped: 장부 되돌림)` + 로그 `busAlightReached leg=`, 기록 비우기 세 자리, `dispatch`에서 역순 방지(`reached`).
- 생성물: `node ios/scripts/messages-to-xcstrings.mjs`(필요 시 `--update-arg-order`), `node android/scripts/messages-to-android-strings.mjs`, 안드로이드 kit strings 스크립트.
- `android/kit/mirrors/guide.json` `TransitBusStop.swift` note에 A69 한 구절.

## 태스크 5. 게이트·리뷰·문서
- `test:run`·`tsc`·`lint`·Kit `swift test`·xcodebuild Release·Experimental·`:kit` gradle 테스트(+`:app` 문자열 참조).
- 구현 리뷰(opus), a11y 점검(opus, a11y-auditor 지시), 안전 최종 검토(fable 1회).
- 문서: BACKLOG A69 종결 + §2 행 + 안드로이드 대기 문구, FIELD-TEST 행, CHANGELOG, PROGRESS 한 줄, INTEGRATIONS A41 절 개정·E48 절에 예외 한 줄.
