# dodo 역이식: 채팅 응답 듣기 속도 3단 설정 (1/1.5/2배) plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dodo-planet Round 199(2026-07-28)에서 위원장 실기기 청감 확정까지 마친 듣기 속도 3단 설정을 gildongmu iOS에 이식한다. 설정에 "듣기 속도" 픽커(1배 기본/1.5배/2배)를 추가하고, 온디바이스 낭독(`AVSpeechSynthesizer`)과 서버 Chirp 폴백(`AVAudioPlayer`) 양쪽에 배속을 적용한다.

**정본(dodo-planet):**

| 항목 | 커밋 | 파일 |
|---|---|---|
| 속도 상태·정규화·적용(`allowedSpeeds`/`normalizeSpeed`/재생 경로 배선) | `0585f38c`·`b7087e42` | `ios/DodoPlanet/Core/Audio/TtsPlayer.swift` |
| **실측 캘리브레이션 테이블**(1→0.55, 1.5→0.65, 2→0.75) | `3a4d72eb` | 같은 파일 `TtsRules.speechRate` |
| 설정 UI(배속 컨트롤) | — | `ios/DodoPlanet/Features/Settings/SettingsPreferencesSection.swift` |

## 핵심 원리 (이식 시 절대 어기지 말 것)

**`AVSpeechUtterance.rate`는 시간 배율이 아니다** — 0~1 비선형 정규화 컨트롤이라 배율을 base에 곱하면(0.55×2=1.1→클램프 1.0) 1.5배·2배가 상한 압축 구간에 몰려 청감상 구분되지 않는다(dodo 실기기 결함 보고로 실증). dodo는 고정 문장 합성 duration 9점 실측(시뮬레이터 ko-KR, 앵커 0.55=6.78s)에서 목표 시간(/1.5·/2.0) 최근접 rate를 역산해 **3점 테이블(1→0.55, 1.5→0.65 실측 1.41배, 2→0.75 실측 1.92배)**로 확정했고 위원장이 실기기에서 "명확히 구분된다" 판정했다. **테이블을 그대로 이식하고 곱셈 재도입 금지**(실측 근거 주석도 함께 이식). 반면 `AVAudioPlayer.rate`(서버 MP3 폴백)는 진짜 시간 배율이므로 배율을 그대로 대입한다.

## Global Constraints

- 커밋은 원자 pathspec 커밋: `git commit -- <의도 경로들>` (`git add -A` 금지). Phase별 커밋. 리뷰 게이트 통과 후 커밋·push, 기기 연결 시 `ios/deploy-device.sh` 실기기 배포까지가 한 사이클.
- iOS 전용 i18n 키는 `ios/i18n/ios-extra/{ko,en,es,fr,it}.json`에만 추가 후 `node ios/scripts/messages-to-xcstrings.mjs` 재생성(생성물 직접 수정 금지), `check-xcstrings-keys.mjs` 린터 통과.
- UI 라벨 이모지 금지, em dash 금지, 접근성 헌장 준수(픽커 라벨이 상태 신호, 과잉 ARIA 금지).
- `TtsPlayer.swift`의 delegate 싱글턴·발신자 아이덴티티 가드 구조(8253a64)는 손대지 않는다.

## 설계 결정 기록

1. **저장은 `@AppStorage("listenSpeed")` 기기 로컬**: gildongmu는 무인증 앱이라 dodo의 서버 동기화(travelers.preferences)는 비해당. `DictationStyle`(`dictationStyle` 키) 선례와 동형.
2. **속도 값은 하나만**: gildongmu에는 dodo의 summary 모드(자동 요약 듣기)가 없으므로 dodo의 speedFull/speedSummary 이원화는 이식하지 않는다(미니멀리즘 — 쓰지 않을 옵션 금지).
3. **양 경로 적용**: 온디바이스 낭독은 캘리브레이션 테이블(`speechRate(forMultiplier:)`), 서버 Chirp 폴백 MP3는 `player.enableRate = true` + `player.rate = Float(배율)`. 폴백은 로케일 보이스 부재 시만 도달하는 안전망이지만 배속이 조용히 죽는 비대칭을 남기지 않는다.
4. **캘리브레이션은 ko-KR 실측**: 타 로케일 보이스는 곡선이 다를 수 있으나 dodo와 동일하게 단일 테이블을 쓴다(로케일별 테이블은 실기기 불만 보고가 나올 때만 — YAGNI). 실기기 확인 항목에 명시.
5. **UI 위치는 `SettingsView`**: 받아쓰기 방식 픽커와 같은 섹션 관례(segmented), 기본 1배. 라벨은 "듣기 속도", 선택지 "1배/1.5배/2배"(5로케일).

---

# Task 1: TtsPlayer 속도 상태 + 캘리브레이션 테이블 + 양 경로 적용

**Files:** `ios/Gildongmu/Chat/TtsPlayer.swift` (+ 순수 규칙 함수를 둘 곳이 필요하면 dodo `TtsRules` 동형의 nonisolated enum을 같은 파일 상단에)

- [ ] dodo `TtsRules`에서 `allowedSpeeds`([1, 1.5, 2])·`normalizeSpeed`(허용 밖 값→1)·`speechRate(forMultiplier:)`(**3점 테이블**: 1→0.55, 1.5→0.65, 2→0.75, default→0.55) 이식. 실측 표·역산 산식 주석 포함(dodo `3a4d72eb` 주석 미러). 기존 `static let speechRate: Float = 0.55`는 테이블의 1배 앵커로 흡수.
- [ ] `@AppStorage`가 아닌 재생 시점 조회로 속도 읽기(`UserDefaults` 직접 or 뷰에서 주입 — dodo처럼 TtsPlayer가 프로퍼티로 보유하고 설정 변경 시 갱신되는 단순한 쪽 선택, 재생 중 변경은 다음 재생부터 적용이면 충분).
- [ ] `speak()` 경로: `utterance.rate = speechRate(forMultiplier: 현재 배율)`.
- [ ] `play(data:)`(서버 Chirp 폴백) 경로: `player.enableRate = true`, `player.rate = Float(현재 배율)` (설계 결정 3).

# Task 2: 설정 UI + i18n

**Files:** `ios/Gildongmu/SettingsView.swift`, `ios/i18n/ios-extra/{ko,en,es,fr,it}.json`, `ios/Gildongmu/Resources/Localizable.xcstrings`(생성물)

- [ ] `SettingsView`에 "듣기 속도" Picker(segmented, 받아쓰기 방식 픽커 관례) — `@AppStorage("listenSpeed")`, 기본 1배. 표시값 "1배/1.5배/2배".
- [ ] 신규 i18n 키(예: `ios.settings.listenSpeed` + 선택지 3키 또는 포맷 1키 — 기존 설정 키 명명 관례 확인 후 결정) 5로케일 추가 → xcstrings 재생성 → 키 린터 통과.

# Task 3: 테스트 + 검증

- [ ] 순수 함수 테스트: `normalizeSpeed`(허용 밖·nil→1), `speechRate` 테이블(1배=0.55 앵커·1.5배=0.65·2배=0.75·세 값 상호 구분·2배 ≤ `AVSpeechUtteranceMaximumSpeechRate`), 곱셈이 아닌 테이블임을 고정하는 단언.
- [ ] 기존 스위트(Kit 포함) 전부 그린 + 시뮬레이터 빌드.
- [ ] 시뮬레이터: 설정 픽커 표시·영속(재실행 유지) 확인.
- [ ] 리뷰 게이트 → 커밋·push → 기기 연결 시 실기기 배포.

## 실기기 확인 항목 (배포 후, 위원장)

- 듣기 버튼 1배/1.5배/2배 청감 구분(ko 기준 — dodo와 같은 테이블이므로 동일해야 정상).
- 설정 변경 후 다음 재생부터 반영.
- (가능하면) 비-ko 로케일에서 3단 구분이 성립하는지 — 어긋나면 로케일별 테이블 후속 결정(설계 결정 4).
