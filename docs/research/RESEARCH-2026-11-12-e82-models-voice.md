# E82 베르길리우스 설계 전 조사: 모델·요금·음성 자산·오디오 공존

조사일 2026-11-12. 읽기 전용(코드·문서 수정 없음, 커밋 없음). 과금 호출 0건.
각 절에서 **[확인]** 은 파일·공식 페이지를 직접 읽은 것, **[추정]** 은 근거는 있으나 직접 재지 않은 것이다.

---

## 1. OpenAI 모델 목록·요금

### 1.1 자격증명

- **[확인] 키 없음.** `gildongmu/.env.local`·`.env.example` 어디에도 `OPENAI_API_KEY=` 줄이 없다(줄 수 0). 다른 프로젝트의 env는 열지 않았다.
- 그래서 `GET /v1/models`(계정에 실제로 열려 있는 모델 목록)는 **부르지 못했다.** 아래 모델 이름은 공식 문서 기준이고, 이 계정에서 호출 가능한지는 키를 넣은 뒤 목록 호출 한 번으로 확인해야 한다.

### 1.2 공식 요금 (확인일 2026-11-12)

출처: `https://developers.openai.com/docs/pricing`, 모델별 페이지 `https://developers.openai.com/docs/models/gpt-6-astra`·`/gpt-6-luna`·`/gpt-6.1-terra`·`/gpt-realtime-2.1`. 요금 페이지에 갱신일 표기는 없다. 단위는 100만 토큰당 달러, 표준 등급.

**텍스트 모델 [확인]**

| 모델 | 입력 | 캐시 입력 | 출력 | 추론 강도 선택지 | 비고 |
|---|---|---|---|---|---|
| `gpt-6-astra` | 10 | 1 | 50 | low·medium·high·xhigh·max (**none 없음**) | "가장 어려운 일을 위한 최상위 모델". Realtime 미지원. 입력은 글·이미지, 출력은 글 |
| `gpt-6.1-sol` | 2 | 0.10 | 10 | (모델 페이지 미확인) | |
| `gpt-6.1-terra` | 1 | 0.05 | 5 | none·low·medium(기본)·high·xhigh·max | "빠르고 효율적", 이미지 입력 가능. 도구 호출은 Responses API 필요 |
| `gpt-6-luna` | 0.10 | 0.01 | 0.50 | none·low·medium(기본)·high·xhigh·max | "가장 효율적, 집중된 대량 작업". Chat Completions의 함수 호출은 추론 none일 때만 |

- Fast 모드는 2배, Batch·Flex는 절반(지연이 길어 이 용도에는 부적합).
- Astra의 Ultrafast 등급은 60 / 6 / 300.
- 어느 페이지에도 **지연 시간 수치는 없다.** "2~3초 안에"는 실호출로만 판정된다.

**실시간 음성 모델 [확인]**

| 모델 | 오디오 입력 | 오디오 캐시 | 오디오 출력 | 글 입력 | 글 출력 | 이미지 입력 |
|---|---|---|---|---|---|---|
| `gpt-realtime-2.1` | 32 | 0.40 | 64 | 4 | 24 | 5 |
| `gpt-realtime-2.1-mini` | 10 | 0.30 | 20 | 0.60 | 2.40 | 0.80 |

- `gpt-realtime-2.1`: 입력 글·오디오·이미지, 출력 글·오디오. 함수 호출·프롬프트 캐시·추론 강도 설정 지원. 컨텍스트 128,000, 지식 기준일 2024-09-30. "추론 강도를 올리면 지연과 출력 토큰이 는다"는 경고가 있다.
- 그 밖: 실시간 전사 `gpt-live-transcribe`·`gpt-realtime-whisper` 분당 0.017달러, 일반 전사 `gpt-transcribe` 분당 0.0045달러, 음성 합성 `gpt-4o-mini-tts`(글 입력 0.60, 오디오 출력 12), `tts-1` 100만 자당 15달러.

### 1.3 「Astra」에 대한 판정 재료

- **[확인] Astra는 실시간 음성 모델이 아니다.** Realtime 엔드포인트 미지원이고, 음성은 별도 계열(`gpt-realtime-*`)이다. 위원장이 말한 "Astra·실시간 음성 모델"은 서로 다른 두 모델이다.
- **[확인] Astra는 추론을 끌 수 없다**(최저가 low). **[추정]** 한두 문장 답을 2~3초에 내는 용도에는 단가(출력 50)와 추론 지연 양쪽에서 불리하다. 추론을 끌 수 있는 `gpt-6.1-terra`·`gpt-6-luna`가 지연 면에서 1차 후보로 보인다. 다만 지연은 재지 않았다.
- Astra가 맞는 자리는 **[추정]** "여기서 ○○까지 어떤 수단 조합이 가장 빠른가" 같은 계획형 질문이나 품질 기준선(상한 대조군) 쪽이다.

### 1.4 월 100달러로 몇 회인가 (산술은 스크립트)

스크립트: `~/gildongmu-private/field-logs/outing-coverage-replay-2026-11-12/e82-budget.py`

**가정(전부 [추정])**: 문답 한 번에 입력 2,000토큰(지시문 + 앱이 계산한 주변 목록), 출력 100토큰(한국어 한두 문장). 도구 왕복이 끼면 호출 2회·입력 2,500씩. 추론 low는 추론 토큰 300을 출력 단가로 더한다.

| 모델 | 한 번 호출·추론 없음 | 지시문 캐시 적중 | 도구 1회 왕복 | 추론 low |
|---|---|---|---|---|
| `gpt-6-astra` | (추론 못 끔) | | 1,739회 | **2,500회** (1회 0.04달러) |
| `gpt-6.1-sol` | 20,000회 | 36,764회 | 8,695회 | 12,500회 |
| `gpt-6.1-terra` | 40,000회 | 73,529회 | 17,391회 | 25,000회 |
| `gpt-6-luna` | 400,000회 | 704,225회 | 173,913회 | 250,000회 |

**먼저 말해 주기**(입력 1,500·출력 60, 하루 20회·30일 = 600회): Astra 약 10.80달러(추론 토큰 제외), terra 1.08달러, luna 0.11달러.

**실시간 음성**(질문 4초·답 6초·글 맥락 2,000토큰):

| 모델 | 맥락 비캐시 | 맥락 캐시 적중 |
|---|---|---|
| `gpt-realtime-2.1` | 5,896회 (1회 0.017달러) | 10,245회 |
| `gpt-realtime-2.1-mini` | 25,000회 | 34,246회 |

- ⚠ **오디오 토큰 환산(입력 초당 10토큰, 출력 초당 20토큰)은 공식 문서에서 확인하지 못한 가정이다.** 비용 안내 페이지는 404였고 모델 페이지에는 환산이 없다. 실제 값은 시험 세션의 `usage`(오디오·글 토큰 분리)로 재야 한다.
- 마이크를 계속 열어 두면 같은 가정에서 입력 오디오만 `gpt-realtime-2.1` 분당 0.0192달러(100달러 = 약 87시간), mini 분당 0.006달러(약 278시간). 한 세션 안에서 대화가 쌓이면 이전 맥락이 턴마다 다시 과금되므로 실제는 이보다 나쁘다 **[추정]**.
- 대조 **[확인, 2026-09-16 dodo 리포트 기준]**: `gemini-3.8-live`는 오디오 입력 분당 0.005달러·출력 분당 0.018달러(2026-12-31까지 유효, 이후 인상 예정 표기). 같은 4초+6초 문답이 맥락 제외 약 0.002달러다. 단, 이 단가는 오늘 다시 확인하지 않았다.

**읽는 법**: 텍스트 경로는 Astra만 아니면 100달러가 사실상 넉넉하다. 예산이 실제로 조이는 축은 ①Astra를 기본 답변 모델로 쓸 때 ②실시간 음성을 상시 열어 둘 때 ③카메라 프레임(이미지 토큰 수 미확인) 셋이다.

---

## 2. 기존 자산

### 2.1 PORTS 원장의 Live 행

- **[확인]** `~/Mac-Projects/PORTS.md` 85행, 상태 `[open]`, 등록 2026-09-16. 요지:
  - dodo가 `gemini-3.1-flash-live-preview` → `gemini-3.8-live`로 전환. gildongmu는 Live를 쓰지 않아 모델 판정은 미소비이고 "음성 대화를 붙이는 날 0단계에서 이 행을 연다"고 적혀 있다. **E82가 그날이다.**
  - 기법 ① WebSocket 모델은 `generateContent`로 못 재서 은퇴 감지 그물 밖에 남는다. 처방은 임시 토큰에 운영 설정을 통째로 잠그고 `setup` 프레임까지만 보내 `setupComplete` 수신을 보는 것(오디오 0프레임이라 과금이 사실상 없고 모델 생사와 설정 수용을 한 번에 잰다).
  - 기법 ② 모델 교체가 코드 변경 없이 동작을 바꾼다: 3.8은 proactive audio 영구 활성(끄면 오류), 비동기 함수 호출 기본값. "관련 없다고 판단하면 응답 안 함"은 **화면 없는 사용자에게 침묵이 실패와 구분되지 않는 축**이다.

### 2.2 출처 리포트

- **[확인]** `~/Mac-Projects/dodo-planet/docs/evals/2026-09-16-live-model-3.8-probe.md`(78줄).
  - 측정법: 텍스트 A/B 하네스는 오디오-투-오디오를 못 재서 `scripts/live-diagnostics/` 골격의 **실발화 프로브**(발화 A 직접 질문, 발화 B 혼잣말, 모델당 3회).
  - 결과: 도구 호출 3.1은 1/3, 3.8은 3/3. 3.1은 1회 같은 문장을 100회 넘게 반복하며 턴을 못 끝냈다. 3.8이 지고 3.1이 이긴 케이스 0건. 혼잣말 3/3 응답(침묵 0회).
  - 접지: 빈 도구 응답에 3.8은 "조회된 정보가 없다"까지만 말했다(날조 없음). 단 스텁 없는 세션 관측이라 분리해 읽으라고 적혀 있다.
  - **미측정 축**: 안전(safety) 케이스 없음, 첫 소리까지의 시간(TTFT) 분리 측정 없음. 참고값으로 발화 종료 후 첫 도구 호출 약 2초, 턴 완료 약 4초.
  - `gemini-3.8-live-extended-thinking`은 setup에서 1007로 거부돼 기각.

### 2.3 moment 「설명 듣기」·「말로 묻기」

**[확인] 모델·연결**

| 항목 | 값 | 파일 |
|---|---|---|
| 모델 | `gemini-3.8-live` | `~/Mac-Projects/moment/web/src/lib/server/gemini.ts:26` (`MODELS.live`) |
| 임시 토큰 발급 | `uses: 1`, v1alpha 전용, 수명 = 선점량(최대 180초), 전 필드 잠금 | 같은 파일 `createLiveToken` 505~542행, 라우트 `web/src/app/api/live/session/route.ts` |
| 잠긴 서버 설정 | 응답 오디오만, VAD 침묵 300ms·앞 여유 20ms, 출력 전사 켬, 컨텍스트 압축 32000/12800 | 같은 파일 524~535행 |
| 시스템 지시 | 영어 한 벌 + 응답 언어 문장 + 위치·장소명·프로필 줄 | `web/src/lib/server/live.ts:45` `liveSystemInstruction` |
| 연결 방식 | 앱이 Google로 **직접 WebSocket**(`URLSessionWebSocketTask`), 경로 `…v1alpha.GenerativeService.BidiGenerateContentConstrained`, `access_token` 쿼리. 앱 setup은 모델 이름만 보낸다 | `ios/Moment/Core/Live/LiveSocket.swift:72~77`, `93`, `127`, `136` |
| 메시지 형식 | 오디오 `audio/pcm;rate=16000`, 프레임 `image/jpeg`, 설명 요청은 JPEG+질문을 한 `clientContent` user 턴으로 | `ios/Moment/Core/Live/LiveMessages.swift:24~42` |
| 응답 경계·교체 | `generationComplete`·`interrupted`·`turnComplete` 구분, 최신 요청 하나로 합치기, 신선도 2초·총기한 30초 | `ios/Moment/Core/Live/LiveRelay.swift`(55, 249, 262, 277, 357행) |
| 말로 묻기 상태기계 | 홀드 전용, 불변식 ①~⑨ | `ios/Moment/Core/Live/LiveRules.swift` `LiveAskState` |
| 화면 진입점 | 짧은 탭 = 설명, 누른 채 = 묻기 | `ios/Moment/Features/Capture/CaptureView.swift:344`(`describeAskControl`), `CaptureModel.swift:792`(`describe`), `915`(`wakeLive`) |

**[확인] 카메라 프레임**: 캡처 세션 하나에서 **1초에 한 장**(`FrameSampling.intervalMs` 1000), 한 변 640px, JPEG 품질 0.6, base64. `ios/Moment/Core/Camera/CameraCapture.swift:26`, `84~85`, `336~346`, `355`.

**[확인] iOS 오디오**

- 세션은 `AudioSessionOwner` 한 곳만 만진다. Live는 `.playAndRecord` + `.voiceChat` 모드 + `[.defaultToSpeaker, .allowBluetoothA2DP]`. `ios/Moment/Core/Audio/AudioSessionOwner.swift:27`, `33~44`. 계약 정본은 `AudioSessionOwnership.swift` 머리(소비자 종류 집합 점유, `claimIfReady`·`release`, 114~116행 프로파일 대응).
- 엔진: 캡처 16kHz mono Int16 640샘플(40ms), 재생 24kHz, **상한 없는 큐**, 에코 제거(VPIO) 켬, `AVAudioEngineConfigurationChange`에서 탭 재설치. `ios/Moment/Core/Live/LiveAudioEngine.swift:45~47`, `75`, `149~152`, `206`, `281`, `290`.
- `.record` 범주 금지(VoiceOver까지 무음), VPIO Live와 영상 녹화는 마이크를 못 나눔. `moment/.claude/rules/ios-app.md` 18·27행.
- 실측·잠금 계약 정본: `moment/docs/INTEGRATIONS.md` 50~69행("Live 임시 토큰" 이하).

### 2.4 물려받을 것과 다시 판정할 것

**물려받을 수 있는 것**

1. 무과금 생사 게이트(setup 프레임까지만) 기법과 실발화 프로브 절차. OpenAI Realtime에도 같은 발상(세션 설정까지만)이 통하는지는 확인 필요 **[추정]**.
2. 임시 토큰 패턴: 서버가 지시·설정을 잠그고 수명으로 비용 상한을 건다(`expireTime`에 서버가 실제로 끊는 것까지 실측돼 있다).
3. `LiveSocket`·`LiveMessages`·`LiveAudioEngine`(dodo → moment로 이미 한 번 옮겨진 코드. 캡처 640샘플@16kHz, 24kHz 재생, 상한 없는 큐).
4. 응답 경계 처리(`LiveRelay`의 완료·끊김·옛 턴 구분, 유령 턴 방어)와 홀드 묻기 상태기계.
5. 카메라 프레임 규격(1FPS·640px·품질 0.6)과 "누른 뒤 찍은 프레임만 쓴다"는 신선도 규칙.
6. "설명은 발화만, 화면 텍스트로 복제하지 않는다" 원칙. 다만 E82 판정 4(말한 것을 다시 확인할 수 있어야 한다)와 부딪히므로 그대로는 못 쓴다(아래).

**다시 판정해야 하는 것**

1. **오디오 세션 모델이 다르다.** moment는 소비자 집합 점유(`AudioSessionOwner`), 길동무는 안내 톤 재생기가 카테고리를 소유하는 리듀서(`GuideAudioSession`). moment에는 "안내 톤·기기 음성 안내가 도는 중에 Live가 끼어드는" 상황이 없다. `.voiceChat` + VPIO가 `BeaconTonePlayer`의 `.playback`·`.mixWithOthers`와 한 세션에서 어떻게 되는지는 **실기기 스파이크가 필요**하다.
2. **백그라운드.** moment는 Live를 `scenePhase .background`에서 스스로 멈춘다. 베르길리우스는 폰을 잠가도 이어져야 한다(E82 제안 ⓑ). 잠금 상태에서 마이크를 여는 권한·세션 유지는 moment에 선례가 없다.
3. **연결 길이.** moment는 180초 토큰·최대 6회 재접속(약 20분)·누를 때만 접속이다. 산책 내내 켜 두는 용도와는 비용·끊김 구조가 다르다.
4. **도구.** moment Live는 함수 선언이 없다(지시와 프레임만). 베르길리우스는 앱이 계산한 목록만 재료로 주는 구조라 도구 호출 또는 맥락 주입 방식을 새로 정해야 한다. dodo는 음성 함수 선언 32종을 쓴다.
5. **침묵 축.** proactive audio 영구 활성에서 "응답 안 함"이 실사용에서 나는지는 dodo에서도 열려 있다. 걷는 중 주변 소음·혼잣말이 많은 환경에서 다시 재야 한다.
6. **안전 축·TTFT**는 dodo 프로브에서 미측정이다. "2~3초" 목표는 TTFT를 분리해 재는 프로브를 새로 짜야 판정된다.
7. **OpenAI 대 Gemini.** 발화 프로브를 같은 발화로 양쪽에 돌려야 한다(BACKLOG E82 착수 ②). OpenAI 쪽은 키가 없어 지금은 시작도 못 한다.
8. **개인정보 3자 일치.** 음성·영상을 서버(제3자)로 보내는 순간 웹 privacy·`PrivacyInfo.xcprivacy`·ASC 라벨을 함께 고쳐야 한다. 지금 받아쓰기 오디오는 "미신고가 정본"(기기 안 처리)이다.

---

## 3. 길동무 현재 상태

### 3.1 채팅 모델·thinking

- **[확인]** 모델 `gemini-3.6-flash`. `src/lib/gemini/client.ts:21`. 3.7·3.8-flash는 실호출 A/B에서 기각됐다는 주석이 같은 파일 8~20행에 있다(3.8은 safety pass^3이 3/5 → 0/5).
- **[확인]** 본 채팅은 **thinking 설정을 주지 않는다**(모델 기본값). `src/lib/chat/agent-loop.ts:42~43`, `80~81`의 config는 `{ systemInstruction, tools }`뿐이고, 재시도(`88~89`)는 도구 없이 `{ systemInstruction }`만이다. 호출은 `src/app/api/chat/route.ts:91`.
- **[확인]** follow-up 칩만 `thinkingLevel: LOW`·도구 없음. `src/app/api/chat/suggestions/route.ts:49`. 같은 파일 2행 주석: 3.6-flash는 `thinkingBudget: 0`을 400으로 거부한다(실호출 2026-08-24). **즉 현행 Gemini 모델로는 추론을 완전히 끌 수 없다.**
- **[추정]** 지금 채팅 구조(도구 다중 라운드 + 기본 thinking)는 "2~3초 한두 문장"과 맞지 않는다. 베르길리우스는 별도 경로(짧은 지시·도구 없음 또는 1회·추론 최소)가 필요해 보인다. 현행 채팅의 실제 지연 분포는 이번에 재지 않았다.

### 3.2 iOS 받아쓰기 (온디바이스)

- **[확인]** 엔진은 OS 버전이 정한다: iOS 26 이상 `SpeechAnalyzer` + `SpeechTranscriber`(`ios/Gildongmu/SpeechEngineAnalyzer.swift:9`, `28`, `75`), 그 아래 `SFSpeechRecognizer` + `requiresOnDeviceRecognition`(`SpeechEngineLegacy.swift:8`). 선택은 `SpeechEngine.swift:36` `makeSpeechEngine`.
- **[확인]** iOS 앱은 서버 `speech-to-text` 라우트를 부르지 않는다(앱 소스에 해당 문자열 0건). 과금·전송 없음.
- **[확인]** 세션: `.playAndRecord`, 모드 `.spokenAudio`, `[.duckOthers, .defaultToSpeaker]`, `setActive(true, .notifyOthersOnDeactivation)`. `ios/Gildongmu/SpeechService.swift:219~221`. 끝나면 `setActive(false, .notifyOthersOnDeactivation)` `259`행.

### 3.3 안내 음성·VoiceOver·톤의 공존 구조

소리를 내는 주체는 넷이다.

| 주체 | 수단 | 세션 설정 | 파일 |
|---|---|---|---|
| 안내 톤 | `AVAudioPlayer` | 안내 세션 중 `.playback`, 밖은 `.ambient`, 둘 다 `.mixWithOthers`. **카테고리의 소유자** | `ios/Gildongmu/Directions/BeaconTonePlayer.swift:103`, `516~521`, 실패 시 `.ambient` 후퇴 `537` |
| 안내 기기 음성 | `AVSpeechSynthesizer`(`TtsPlayer.speakGuidance`) | **세션을 건드리지 않는다**(톤 재생기의 `.playback`에 얹힌다) | `ios/Gildongmu/Chat/TtsPlayer.swift:77~86` |
| 채팅 듣기 | `AVAudioPlayer`·합성기 | `.playback` + `.duckOthers` | `TtsPlayer.swift:219~220` |
| 받아쓰기 | `AVAudioEngine` | `.playAndRecord`·`.spokenAudio`·`.duckOthers` | `SpeechService.swift:219~221` |

VoiceOver 통지는 앱 세션 밖(시스템 발화)이다.

- **[확인]** 세션 소유권 판정은 Kit의 순수 리듀서다: 원하는 카테고리·원복 자격(`didPromote`)·다른 소비자 점유(`isSuppressed`)·활성 축(`isActive`)·소유권 이전. 받아쓰기·채팅 듣기가 카테고리를 갈아치우면 route 변경 통지에서 `.categoryTakenOver`로 잡아 재적용한다. `ios/GildongmuKit/Sources/GildongmuKit/GuideAudioSession.swift:1~69`, 앱 쪽 관찰 `BeaconTonePlayer.swift:553`, `574~583`.

### 3.4 겹침 제어 지점 (우선순위·끊기·대기)

**(가) 어느 채널로 말할지: 한 술어**

- `ios/GildongmuKit/Sources/GildongmuKit/GuideSpeechChannel.swift:40~58` `guideSpeechChannel`
  - 전경 ∧ VoiceOver 켬 → VoiceOver 통지
  - 전경 ∧ VoiceOver 끔 → 나들이만 기기 음성(`foregroundDeviceSpeech`), 나머지는 VoiceOver 통지 게시(듣는 사람 없으면 무발화)
  - 백그라운드 → 토글 켬 ∧ 소리 가능(`backgroundAudible`)일 때 **행동 문장(`actionable`·`urgent`)만** 기기 음성, 주기·상태(`deferrable`)는 버림
- 앱 배선: `ios/Gildongmu/Directions/GuideSpeechOutput.swift:26~36`. 나들이의 전경 기기 음성은 `OutingModel.swift:161`, `1110`.
- 자동차 운전자 채널은 이 술어 위에서 먼저 기기 음성으로 낸다(`BeaconModel.post`, `GuideSpeechChannel.swift:39` 주석).

**(나) VoiceOver 통지 창구: 하나**

- `GuideSpeechOutput.swift:40~49` `postVoiceOver`. 버튼 활성화의 직접 응답만 `.high`. 게시한 통지를 장부에 적고 `announcementDidFinishNotification`으로 끝을 받는다(`65~84`). "안내 통지가 모두 끝났는가"는 `57`행 `announcementsFinished`.
- 기본 우선순위 통지도 진행 중 발화를 끊는다(`GuideSpeechChannel.swift:13` 주석). 통지 둘을 잇달아 내면 뒤가 앞을 자른다(`DeviceSpeechQueue.swift:52~53` 주석).
- 다음 통지를 미루는 장치: Kit `DeferredAnnouncer.swift:11`, 착지 대기는 `GuideSessionCoordinator.swift:381~388`, `587~594`와 `BeaconTrackingSheet.swift:698~705`.

**(다) 기기 음성 대기 칸: 선점·한 칸 대기·만료**

- `ios/GildongmuKit/Sources/GildongmuKit/DeviceSpeechQueue.swift` 계약 `40~62`행
  - 말하는 안내가 없으면 즉시
  - `.high`와 `urgent`는 **선점**(칸을 비우고 말하는 중인 안내를 끊는다) `83`, `148~156`
  - 그 밖은 **한 칸 대기, 최신이 이긴다**. 보호 문장(나들이 시작·횡단보도)은 밀리지 않는다
  - 칸 문장의 유효 시간 6초 `69`, 확인 간격 0.3초 `71`
  - 꺼내는 순간 받아쓰기 억제 중이면 버린다 `200`, `256`
  - 전경 복귀 때는 게시하지 않고 넘길 문장 목록을 돌려준다(`handOver`, `190`)
- 톤 뒤 발화: 톤이 울리는 중이면 끝난 뒤 0.15초 간격, 한 번의 대기 상한 3초. `GuideSpeechGate.swift:19`, `21`.
- 합성기는 **세 안내 모델 공용 하나**이고 `speakGuidance`는 직전 안내와 채팅 듣기를 끊는다(latest-wins). `TtsPlayer.swift:86~`, 정지 `119`(인계용)·`133`(전체)·`144`(`halt`). 칸 밖 정지가 발화를 끊으면 관찰자로 알린다(`TtsPlayer.swift:128~`, 배선 `GuideSpeechOutput.swift:105~107`).

**(라) 받아쓰기 중: 안내 출력 전면 억제**

- 시작 전부터 억제를 건다: `SpeechService.swift:90~94`, `109`. 모든 종료 경로에서 푼다(`112`, `144`, `166`, `189`, `237`).
- 억제의 실체: `GuideSessionCoordinator.swift:748~765` `setDictationActive`가 세 모델(`beacon`·`transit`·`outing`)의 `outputSuppressed`를 올린다. 소유자 집합이라 여러 받아쓰기 화면이 겹쳐도 맞는다.
- 마이크가 뜨거워지기 직전 VoiceOver 낭독을 끊는다: 빈 문자열 `.high` 통지. `SpeechService.swift:247`(엔진 시작 직전), `137`(청취 진입), 구현 `307~311`. 홀드 버튼은 누르는 즉시 `HoldDictationButton.swift:226`.

**(마) 세션 종료 다리**

- 백그라운드 ∧ 토글 켬이면 종료·도착 문장이 나갈 때까지 오디오 원복을 붙든다. `GuideSpeechOutput.swift:114~123`.

### 3.5 「새 비서 음성」이 들어올 때 지금 구조에 없는 것

- **[확인] 안내가 아닌 발화자를 위한 자리가 없다.** 채널 술어·대기 칸·분류(`actionable`·`urgent`·`deferrable`)는 전부 안내 문장 전용이다. 채팅 듣기는 "안내가 채팅을 끊는다"로만 정리돼 있다(`DeviceSpeechQueue.swift:60` 주석).
- **[확인] 받아쓰기는 안내를 통째로 막는다.** 말로 묻는 동안(그리고 권한·모델 준비 중에도) 횡단보도 경고 같은 안전 문장이 버려진다(1회성 경고는 장부가 되살리지만 그 순간에는 들리지 않는다). 걷는 중 질문이 잦아지면 이 창이 길어진다.
- **[추정] 우선순위 판정이 설계의 첫 축이다.** 후보 순서는 "안전 경고(횡단보도·이탈) > 사용자가 방금 물은 답 > 임박 안내 > 먼저 말해 주기 > 주기 안내"쯤으로 보이나, 현재 코드에 이 서열을 담을 타입이 없다. 가장 값싼 길은 비서 발화를 `DeviceSpeechQueue`의 새 분류로 태우는 것이고(선점·한 칸·만료·억제·톤 뒤 발화를 그대로 얻는다), 실시간 음성(서버가 오디오를 직접 흘리는 방식)은 이 칸을 우회하므로 별도 중재가 필요하다.
- **[추정] 전경 VoiceOver 사용자에게는 채널이 둘로 갈린다.** 지금 규칙으로는 전경 ∧ VoiceOver 켬이면 안내가 VoiceOver 통지로 나간다. 비서 답을 기기 음성으로 내면 VoiceOver 낭독과 겹치고, VoiceOver 통지로 내면 사용자가 화면을 쓸어 넘기는 순간 끊긴다. 나들이는 VoiceOver가 켜져 있으면 통지로 낸다(`foregroundDeviceSpeech`는 VoiceOver 끔일 때만 효력).
- **[추정] 실시간 음성은 세션 범주 충돌이 난다.** 에코 제거를 쓰려면 `.playAndRecord` + `.voiceChat`인데, 톤 재생기는 `.playback`/`.ambient`만 알고 다른 범주를 보면 `.categoryTakenOver`로 **되돌려 놓는다**. 리듀서에 새 소비자를 가르치지 않으면 두 주체가 카테고리를 서로 빼앗는다.
- **[확인] 침묵과 실패의 구분 장치는 톤뿐이다.** 백그라운드에서 `deferrable`은 버려지고 효과음과 전경 복귀 상환이 맡는다. 비서가 "생각 중"인 2~3초를 알릴 소리·진동 규약은 아직 없다.

---

## 4. 확인하지 못한 것 (설계 세션이 먼저 메울 것)

1. OpenAI 키가 없어 계정의 실제 모델 목록·호출 가능 여부 미확인.
2. 어느 OpenAI 모델도 지연을 재지 않았다. "2~3초"는 TTFT 분리 프로브가 있어야 판정된다.
3. Realtime 오디오 토큰 환산(초당 토큰)·이미지 한 장의 토큰 수·세션 내 맥락 재과금 방식은 공식 문서에서 찾지 못했다.
4. `gpt-6.1-sol`의 추론 선택지·한국어 음성 품질·Realtime의 연결 방식(WebRTC·WebSocket)은 모델 페이지에 없었다.
5. Gemini 쪽 오늘 요금(특히 2026-12-31 이후 Live 인상분)은 다시 확인하지 않았다.
6. 길동무 현행 채팅의 실제 응답 지연 분포.
7. `.voiceChat` + VPIO가 안내 톤·기기 음성·VoiceOver와 한 세션에서 공존하는지(실기기).

## 출처

- https://developers.openai.com/docs/pricing (2026-11-12 확인)
- https://developers.openai.com/docs/models/gpt-6-astra (2026-11-12 확인)
- https://developers.openai.com/docs/models/gpt-6-luna (2026-11-12 확인)
- https://developers.openai.com/docs/models/gpt-6.1-terra (2026-11-12 확인)
- https://developers.openai.com/docs/models/gpt-realtime-2.1 (2026-11-12 확인)
- `~/Mac-Projects/PORTS.md` 85행
- `~/Mac-Projects/dodo-planet/docs/evals/2026-09-16-live-model-3.8-probe.md`
- `~/Mac-Projects/moment/docs/INTEGRATIONS.md` 41~69행, `~/Mac-Projects/moment/.claude/rules/ios-app.md` 18~27행
