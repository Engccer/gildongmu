# 길동무 iOS M6 구현 계획: 온디바이스 음성 입력

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문.

**Goal:** 검색과 채팅에 마이크 버튼을 추가하고 온디바이스 음성 인식(iOS 26 SpeechAnalyzer/SpeechTranscriber)으로 받아쓴다. 한국어 품질 실측이 게이트이며, 미달 시 기존 `/api/speech-to-text`(Deepgram) 폴백을 후속 결정한다(spec §2 결정).

## Global Constraints (M0~M5 유지 + 추가)

- **권한은 사용 시점 요청**: 마이크 버튼 첫 활성화 때. pbxproj 두 buildSettings에 `INFOPLIST_KEY_NSMicrophoneUsageDescription = "검색어와 질문을 음성으로 입력하기 위해 마이크를 사용합니다.";` 추가(2026-06-21 spec 문구). SpeechAnalyzer는 온디바이스라 `NSSpeechRecognitionUsageDescription` 불요이나 SFSpeechRecognizer 폴백 경로를 넣는 경우에만 추가.
- **시작·정지를 소리+햅틱 이중 채널로 통지**(웹 효과음 계약의 iOS 문법): 시스템 사운드 또는 짧은 햅틱. 녹음 중 시각 상태 + 버튼 라벨 변화("음성 입력"→"입력 마침")가 SR 상태 신호(라벨 변화 = 상태 전달, 별도 announce 중복 금지).
- **포커스 유지**: 녹음 시작·종료에서 포커스를 쥔 컨트롤을 disabled로 바꾸지 않는다. 인식 결과는 기존 텍스트 필드에 삽입(대체가 아니라 append 아님: 웹 계약 확인 불요, 빈 필드 기준 대체).
- **언어**: ko 고정(`Locale(identifier: "ko-KR")`). detect_language 금지 교훈([[deepgram-prod-key-401]] 병기 코드 결함)과 동형: 자동 감지 금지.

### Task 1 (앱): SpeechService

- `ios/Gildongmu/SpeechService.swift` 신규: `@Observable @MainActor final class SpeechService`.
  - 상태: `enum Phase { idle, requesting, listening(partial: String), denied, failed }`.
  - `start() async`: AVAudioSession 권한 요청(`AVAudioApplication.requestRecordPermission`) → 거부면 `.denied`. 허용이면 `AVAudioEngine` 탭 + iOS 26 `SpeechAnalyzer`+`SpeechTranscriber(locale: ko-KR)` 스트리밍 인식. partial 결과를 `listening(partial:)`로 갱신.
  - `stop() async -> String?`: 인식 종료, 최종 텍스트 반환. 오디오 세션 해제.
  - 모델 에셋: `AssetInventory` 설치 필요 시 요청(최초 1회 다운로드, 진행 상태 `.requesting`).
  - SpeechAnalyzer API가 SDK와 다르면 실제 SDK 시그니처에 맞게 조정(빌드가 판정자), 조정 내용 보고. 구현 불가 판정 시 SFSpeechRecognizer(ko-KR, `requiresOnDeviceRecognition = true`)로 대체하고 usage description 추가.
- 시작·정지 시 햅틱(`UIImpactFeedbackGenerator`)과 시스템 사운드(id 1113/1114 계열) 통지.

### Task 2 (앱): 검색·채팅 마이크 버튼

- **검색**(`SearchView`): toolbar에 마이크 버튼("음성 입력"). 활성화→listening이면 라벨 "입력 마침"으로 변화, 재활성화→stop()→결과를 `model.query`에 넣고 `model.submit()` 자동 실행(웹 음성 검색 계약: 받아쓰기 후 즉시 검색). partial은 검색 필드에 실시간 반영하지 않는다(필드 값 경합 회피, 최종만).
- **채팅**(`ChatView`): 입력줄에 마이크 버튼 동일 패턴, 최종 텍스트를 입력 필드에 넣기만(자동 전송 안 함: 질문은 검토 후 전송, 웹 계약 미러).
- denied면 "설정에서 마이크 접근을 허용해 주세요" 안내(텍스트 입력은 계속 가능).

### Task 3 (통합·게이트): 빌드·테스트·커밋. **실기기 게이트(사용자)**: 한국어 받아쓰기 품질(장소명·역명 고유명사 포함 문장 5개), 시작·정지 통지, 거부 후 재허용 경로. 품질 미달 시 Deepgram 폴백 태스크를 후속 plan으로.

## Self-Review: 로드맵 M6 항목(SpeechAnalyzer·효과음+햅틱·폴백 판정 절차) 매핑. Kit 변경 없음(순수 기기 계층). 마이크 usage description 필수 반영.
