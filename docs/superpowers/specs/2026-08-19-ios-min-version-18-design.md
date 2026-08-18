# iOS 최소 지원 버전 하향(26 → 18) 설계

- 날짜: 2026-08-19
- 출처: `docs/BACKLOG.md` E23(사용자 피드백 2026-08-18 "요구 iOS 버전이 높아 설치하지 못했다")
- 위원장 결정(2026-08-19): ①26 미만은 `SFSpeechRecognizer` 온디바이스 폴백 ②하한 iOS 18 ③검증은 시뮬레이터(iOS 18 실기기 창구 없음)로 하고 출시

## 1. 판정 근거

- **코드 장벽은 받아쓰기 엔진 한 파일**: 타깃 18.0·Kit `.v18` 임시 하향 빌드에서 앱 68파일 중 `SpeechService.swift`만 6건 컴파일 오류(`SpeechAnalyzer`·`AnalyzerInput`, iOS 26 신규). Kit 무오류.
- **iOS 18에도 온디바이스 STT API가 있다**: `SFSpeechRecognizer`(iOS 13+). `SFSpeechAudioBufferRecognitionRequest.requiresOnDeviceRecognition = true`로 강제하면 오디오가 기기를 떠나지 않아 **개인정보 3자 일치 불변식(웹 privacy 카피 "기기 안에서 처리"·`PrivacyInfo.xcprivacy`·ASC 라벨)이 그대로 유지**된다. 서버 폴백은 어떤 경우에도 만들지 않는다.
- **온디바이스 지원은 언어·기기별**: 이 Mac Speech 프레임워크 실측(iOS 18 대용, 같은 계열) ko-KR·en-US `supportsOnDeviceRecognition == true`, es·fr·it·ja는 기기에 그 언어 받아쓰기 자산이 없으면 `false`. `SpeechAnalyzer`는 앱이 모델을 직접 내려받지만(`preparing`), `SFSpeechRecognizer`는 앱이 못 내려받는다 → **미지원은 정직한 미지원 문구**로(3-state).
- **권한이 하나 더 든다**: `SFSpeechRecognizer.requestAuthorization`(음성 인식 권한). Info.plist 문구 `NSSpeechRecognitionUsageDescription`은 이미 있다. 26 미만에서만 두 번 묻는다.
- **설계 리뷰 판정**: codex adversarial-review **생략**. 새 불변식·상태 머신 신설 없음(기존 `SpeechService` 표면 유지, 엔진만 교체), 개인정보 경계는 검증된 API의 옵션 하나(`requiresOnDeviceRecognition`)가 지키며 경계 자체는 불변. 잔여 리스크(온디바이스 강제 누락·서버 경로 혼입)는 구현 리뷰의 명시 포커스로 커버한다.

## 2. 범위

- `IPHONEOS_DEPLOYMENT_TARGET` 26.0 → 18.0(3구성), Kit `platforms: .iOS(.v18)`(macOS는 `.v26` 유지 — 테스트 호스트일 뿐).
- `SpeechService`를 엔진 추상화 위에 올린다: 공개 표면(`phase`·`lastError`·`isListening`·`isStarting`·`start`·`stop`·`cancel`·`reset`, `speechAlertText`) **불변**. 소비 3뷰·`HoldDictationButton`·단축어 경로 무수정.
- 26 이상: `SpeechAnalyzer` 엔진(현행 동작 byte-identical 목표). 26 미만: `SFSpeechRecognizer` 온디바이스 엔진.

## 3. 엔진 계약 (`SpeechEngine`, MainActor)

| 단계 | Analyzer(26+) | Legacy(<26) |
|---|---|---|
| `prepare(locale, willDownload)` | `supportedLocale` 없으면 `.localeUnsupported`; 미설치면 `willDownload()` 후 `AssetInventory` 설치(실패 `.assetDownloadFailed`); 예약 정리 | `SFSpeechRecognizer(locale:)` nil → `.localeUnsupported`; `supportsOnDeviceRecognition == false` → **`.onDeviceUnsupported`(신설)**; 음성 인식 권한 미허용 → **`.recognitionDenied`(신설)**. `willDownload` 미호출(준비 단계 없음) |
| `attach(audioEngine, onPartial, onFailure)` | 탭 설치 + 포맷 변환 → `AnalyzerInput` 스트림 | 탭 설치 → `request.append(buffer)` (`requiresOnDeviceRecognition = true`, `shouldReportPartialResults = true`, `addsPunctuation = true` — SpeechTranscriber 문장부호 관례와 맞춤) |
| `run()` | `analyzer.start(inputSequence:)` | `recognitionTask(with:)` 개시 |
| `finish() -> String` | `finalizeAndFinishThroughEndOfInput` + 결과 Task 대기 | `request.endAudio()` 후 최종 콜백(`isFinal` 또는 error) 대기, **3초 상한**(무발화 등으로 최종이 안 오면 현재 전사로 확정) |
| `cancel()` | `cancelAndFinishNow` + Task 취소 | `task.cancel()` |

- `onPartial(text)`는 **세션 누적 전사**(volatile 포함)로 통일한다 — Analyzer는 청크 누적, Legacy는 `bestTranscription.formattedString`이 이미 누적본. 서비스는 `phase = .listening(partial:)`만 갱신한다.
- `onFailure()`는 인식 스트림 사망(청취 중·정지 중 아닐 때만 서비스가 `.failed`로 전이) — 현행 규칙 그대로.
- 마이크 hot 직전 VO 차단·오디오 세션 카테고리·`audioEngine.start()`·세대(gen) 취소 가드는 **서비스에 남는다**(엔진 무관 계약).

## 4. 문구(6 로케일, `ios/i18n/ios-extra`)

- `ios.voice.errorOnDevice`: "이 기기는 이 언어의 온디바이스 음성 인식을 지원하지 않습니다"
- `ios.voice.deniedRecognition`: "설정에서 음성 인식을 허용해 주세요"
- 뒷문장 없음(재시도·설정 경로 안내는 자명하거나 근거 불명 — CLAUDE.md 꼬리 문장 규칙).

## 5. 검증

- 게이트: Kit 테스트(macOS), 앱 빌드 3구성(Debug/Release/Experimental) 타깃 18.0.
- iOS 18.6 시뮬레이터: 검색·길찾기·안내 시트·설정 화면 회귀(시각 배치 차이는 컴파일 게이트 밖). 받아쓰기 폴백은 시뮬레이터에서 마이크·온디바이스 판정이 불완전 → **실기기 미판정 상태로 출시**(위원장 결정). 폴백 실패는 `.failed`·미지원 문구로 떨어지므로 최악은 "받아쓰기 안 됨"의 정직 표시이며, 시스템 키보드 받아쓰기는 별개로 동작한다.
- 26 경로 회귀 없음: iOS 26.5 시뮬레이터 빌드·실기기 배포(정식·실험 두 구성).

## 6. 문서 파급

- 웹 privacy 카피·`PrivacyInfo.xcprivacy`·ASC 라벨: **변경 없음**(온디바이스 유지).
- `docs/BACKLOG.md` E23 종결 → `CHANGELOG.md`, `PROGRESS.md` 상태 한 줄, `CLAUDE.md`에 함정(온디바이스 강제·서버 폴백 금지·`SpeechEngine` 계약) 한 줄.

## 7. 검증 결과 (2026-08-19)

- 빌드 Debug/Release/Experimental(타깃 18.0) 성공·경고 0, Kit 557 테스트·웹 vitest 2,804 통과.
- 독립 리뷰(서브에이전트): 개인정보 불변식 clean, 26 경로 회귀 없음. WARNING 1건 반영 — `prepare()` 중 취소 시 로컬 engine이 완주해 청소 경로가 nil을 보는 고아화 → prepare 직후 세대 가드 + run 뒤 `self.engine` 재동기화.
- iOS 18.6 시뮬레이터(iPhone 16): 온보딩·채팅·검색·길찾기·내 주변 렌더 정상. 받아쓰기 시작 시 마이크 → **음성 인식 권한 2단 팝업** → 청취(en-US 온디바이스 지원 판정 통과) → 정지 → idle 복귀 확인. **실측 크래시 1건 수정**: `requestAuthorization` 콜백 클로저가 MainActor 격리를 상속해 TCC 큐에서 SIGTRAP — `@Sendable` 명시(결과 콜백도 동일 처리).
- 26 미만 **실기기** 판정은 미실시(창구 없음, 위원장 결정으로 출시).
