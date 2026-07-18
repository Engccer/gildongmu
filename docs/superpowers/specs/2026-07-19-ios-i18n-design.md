# iOS 다국어(5개 언어) 설계

- 날짜: 2026-07-19
- 상태: 승인(위원장, 세션 내 "승인. 자율적으로 끝까지 진행.")
- 범위: iOS 앱만. 웹 `messages/` 파일은 수정하지 않는다(정본 보호).
- 선행: `2026-07-19-ios-title-menu-refresh-theme-design.md` "제외 범위"에서 유예한 마일스톤.

## 배경·요구

iOS 앱은 전 문자열이 한국어 하드코딩(약 44개 파일 416줄)이다. 웹은 이미 5개 로케일(ko/en/es/fr/it, flat `messages/{locale}.json`, 438키)을 갖췄으므로 dodo-planet에서 검증한 "웹 정본에서 String Catalog 결정론 변환" 파이프라인을 이식해 iOS도 5개 언어를 지원한다. 언어 선택은 설정 시트 안 픽커(위원장 원 요구: 웹 언어 모달의 iOS 판).

## 설계

### 1. 변환 파이프라인 (결정론)
- `ios/scripts/messages-to-xcstrings.mjs`: dodo 스크립트 이식. 로더만 gildongmu 구조에 적응한다. dodo는 `messages/{locale}/{namespace}.json`, gildongmu는 flat `messages/{locale}.json`(최상위 키가 네임스페이스).
- `ios/i18n/ios-extra/{ko,en,es,fr,it}.json`: iOS 전용 키(단축어·설정·제목 메뉴·받아쓰기 오류·iOS 고유 문구)와 **웹 카피 오버라이드**(같은 키를 넣으면 iOS 값 승리, dodo 공식 경로). 웹 카피가 iOS 실문구와 다른 곳(예: 마이크 라벨 "받아쓰기 시작", 채팅 추천 질문)은 여기서 교체해 **ko 표시 문자열의 마이그레이션 전후 동일 불변식**을 지킨다.
- 출력 카탈로그 2개(네임스페이스로 분배, 재실행 byte-identical):
  - 앱 타깃: `ios/Gildongmu/Resources/Localizable.xcstrings`
  - Kit: `ios/GildongmuKit/Sources/GildongmuKit/Resources/Localizable.xcstrings` (`Bundle.module`, `defaultLocalization: "ko"` 기선언)
- 플레이스홀더는 dodo 규약 그대로: 단순 `{name}`은 positional `%1$@`로 변환, Swift `String(format:)` 소비. 리치 태그(`<name>`)·ICU 복합 키는 변환 제외(필요 시 ios-extra에 단순형으로 재정의).

### 2. 키 존재 린터 (deterministic 게이트)
Swift 소스의 `String(localized:)` 키 전수를 카탈로그와 대조하는 스크립트 `ios/scripts/check-xcstrings-keys.mjs`. 누락 키는 런타임에 키 문자열이 그대로 노출되는 무증상 결함이라 빌드가 못 잡는다. 이 린터가 머지 게이트.

### 3. 문자열 교체
- 앱 타깃 전 뷰: 한글 리터럴을 `String(localized:)`로(포맷 키는 `String(format:)`).
- Kit 표시 문자열 생성기(LocationNarrative 산문 템플릿, SearchFilters 카테고리 라벨, 모델 표시명, StationMatch 등)는 **명시 locale 인자**를 받아 `LocalizedStringResource`에 `locale`을 지정해 조회한다. 호스트 Mac 언어에 흔들리지 않는 결정론 유지. 기존 한글 단정 테스트는 ko 명시 호출로 그대로 성립한다.
- `AppShortcuts.swift`의 `LocalizedStringResource`는 카탈로그 도입만으로 로컬라이즈에 편입.

### 4. 언어 설정 UI
- 기존 `SettingsView`에 "언어" 픽커 행 추가(테마와 같은 List). 각 언어 자국어 표기(한국어/English/Español/Français/Italiano, 웹 `nav` 네임스페이스와 동일 어휘). UI 라벨 이모지 금지.
- 선택 시 `AppleLanguages` UserDefaults 오버라이드(dodo 동형). `String(localized:)`가 `Bundle.main` 기준이라 **다음 앱 실행부터 적용**되며, 선택 직후 재시작 안내를 polite 통지한다. 재시작 없는 즉시 전환(전역 주입식 리팩터)은 dodo에서 비용 대비 기각된 전례를 따른다.

### 5. 데이터·엔진 배선 (앱 언어를 각 계약에)
- 공통 헬퍼: 앱 언어 판독(`Locale.preferredLanguages` 첫 항목 기반)과 dataLocale 규칙(ko 외 전부 en, 웹 `data-locale.ts` 동형).
- 검색: `SearchModel`의 `lang: "ko"` 하드코딩을 앱 언어로. 명소 섹션의 ko 전용 게이트는 기존 iOS 동작 유지(en이면 미노출, 웹 en TourAPI 편입은 후속).
- 채팅: `/api/chat` body에 `locale` 추가(현재 미전송이라 서버 기본 ko). Gemini가 해당 언어로 답변.
- STT: `SpeechTranscriber` locale을 앱 언어로 매핑(ko-KR·en-US·es-ES·fr-FR·it-IT). 기기 미지원은 기존 `localeUnsupported` 오류 경로 재사용(자동 감지 금지 계약 유지).

### 6. 검증
- 게이트: Kit `swift test` + 키 존재 린터 + `xcodebuild` 빌드 + 실기기 배포(`ios/deploy-device.sh`).
- 실기기 스팟: 설정에서 English 선택 후 재실행해 주요 화면 영문 확인, ko 복귀 후 기존 문구 동일 확인. VoiceOver: 언어 픽커 낭독, 재시작 안내 통지.

## 제외 범위
- 즉시(무재시작) 언어 전환, 명소 섹션 en 데이터(TourAPI) 편입, 웹 `messages/` 수정.
