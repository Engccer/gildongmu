# E79 대중교통 승차 중 진행 효과음을 백그라운드에서도 낸다 (설계)

- 날짜: 2026-11-07 · 세션 `e79-bg-tone` · 정본 판정: `docs/BACKLOG.md` §5 E79(위원장 판정 2026-11-02·2026-11-07)
- 범위: iOS만. 웹은 백그라운드 재생 경로가 없고(탭이 살아 있어야 돈다), 안드로이드는 대중교통 안내가 없다(BACKLOG §4 B14).
- 설계 리뷰: 생략한다. 새 판정 계층·새 외부 계약이 아니라 E36이 만든 허용 집합(`playTone(_:allowedInBackground:)`)의 원소를 늘리는 일이다.

## 1. 판정 (바꾸지 않는다)

- ① 백그라운드 허용 톤 = **추세 톤(closer·farther)·사다리 톤(잔여 3·2·1, 1은 임박)·도착 톤**. 신호를 잃었을 때의 60초 반복음(unreliable)은 내지 않는다.
- ③ 백그라운드 음성 안내 토글이 꺼져 있어도 톤은 낸다(도보와 같은 축 — 소리는 항상, 음성만 토글).
- (구현 뒤 두 번째 판정, 같은 날) 고른 차량을 기다리는 동안(boarding)의 다가옴 소리도 낸다(§2.1).

## 2. 허용 집합을 어디서 가르는가

판정은 Kit 순수 함수 하나 `transitToneAllowedInBackground(_ source:)`(새 파일 `TransitBackgroundTone.swift`)가 하고, `TransitGuideModel`의 톤 호출부는 전부 이 함수의 결과나 리터럴 `false`를 넘긴다. 리터럴 `true`는 0곳이다(소스 가드). 종전의 "허용 대입 한 자리"(`if case .trackingStarted = event`)는 이 함수로 대체된다.

| 톤의 출처 (`TransitBackgroundToneSource`) | 소리 | 백그라운드 |
|---|---|---|
| `.event(.trackingStarted)` riding 첫 관측 | closer | 낸다(E36 그대로) |
| `.event(.countdown)` riding 사다리 3·2 / 1 | closer / ahead | 낸다 |
| `.event(.arrivingAtAlightStop)` 서울버스 하차 정류소 잔여 0 | ahead | 낸다(사다리 1과 같은 축, A41) |
| `.event(.arrived)` 도착(확정·추정) | nearby | 낸다 |
| `.event(.legAdvanced(final: true))` 여정 끝 | nearby | 낸다(도착 톤) |
| `.alightReached` 기기 위치 하차 정류장 50m(A69) | nearby | 낸다(도착 톤) |
| `.trend(.closer / .farther)` 추세 층 | closer / farther | 낸다 |
| `.trend(.unreliable)` 신호 잃음 60초 반복 | unreliable | **내지 않는다**(판정 ①) |
| `.event(.signalLost / .neverSeen / .upstreamFailed / .vehiclePassed)` | warning | 내지 않는다(①의 집합 밖, 신호 잃음과 같은 갈래) |
| `.event(.approaching)` boarding 접근 사다리 3·2 / 1 | closer / ahead | 낸다(§2.1) |
| `.event(.arrivingAtBoardStop)` 서울버스 「곧 도착」 | ahead | 낸다(§2.1) |
| `.event(.boarded(observed / departed))` 관측 승차(지하철 도착 관측·서울버스 출발 관측) | start | 낸다(§2.1) |
| `.event(.boarded(declared))`·`.legAdvanced(final: false)` 사용자 선언·중간 구간 시작 | start | 내지 않는다(사용자 조작 응답, 전경) |
| 세션 시작·종료음 `.start`·`.stop` | start·stop | 내지 않는다(사용자 조작 응답, 전경) |

### 2.1 boarding 국면(고른 차량을 기다리는 동안)도 낸다 — 위원장 판정 2026-11-07 두 번째

첫 구현은 판정문의 "승차 중"을 따라 고른 차량이 승차 정류소로 다가오는 사다리(`approaching` 3·2·1)·「곧 도착」(`arrivingAtBoardStop`)·「지금 타세요」(`boarded(observed)`)를 전경만으로 두고 판정을 물었다. 위원장 답은 **기다리는 동안에도 낸다**(선택지 2). boarding은 keep-alive(A46)로 앱이 깨어 있는 국면이라 소리 낼 기회가 실제로 있다. 승차 전이 시작음은 관측 둘 다 낸다: 도착 관측(`boarded(observed)`)은 지하철만 내고, 서울버스는 정차 신호가 API에 없어 자동 승차 전이가 출발 관측(`boarded(departed)`, 문장 「탑승했습니다. 하차: …」)뿐이라 이것을 빼면 판정문이 그린 서울버스 흐름의 마지막 소리가 사라진다(리뷰 MAJOR). 지방버스는 boarding을 거치지 않는다(근사 잠금). 고른 직후 첫 관측은 몇 정거장 앞이든 가까워짐 소리 한 번이다(사다리와 같은 소리). 차량을 고르기 전(waiting)은 keep-alive가 없어 앱이 잠들고, 허용 집합에도 waiting 이벤트가 없다.

### 2.2 국면 밖에서 소리가 날 수 없는가

- 추세 층(`transitToneStep`)은 riding·arrived에서만 톤을 낸다(Kit 구조). 확정 도착은 층이 전부 억제한다.
- 허용 이벤트 중 `countdown`·`trackingStarted`·`arrivingAtAlightStop`·`arrived`는 리듀서가 riding에서만 낸다. `legAdvanced(final: true)`는 사용자 조작(전경)이 정상 경로다. `approaching`·`arrivingAtBoardStop`·관측 `boarded`는 boarding에서만 난다(§2.1).
- 백그라운드에서 프로세스를 살리는 keep-alive 위치 스트림(E36·A46)은 (boarding ∨ riding) ∧ 폴 주기 > 0 ∧ 비유휴에서만 켜진다. waiting에서 화면을 끄면 앱이 잠들어 폴 자체가 멎으므로 소리 낼 기회가 없고, 허용 집합에도 waiting 이벤트는 없다. 확정 도착·비관측 잠금은 폴 주기 0이라 keep-alive가 꺼지지만, 그 순간의 도착 톤은 꺼지기 전 같은 스텝에서 난다.

## 3. 톤 뒤 발화 계약 — 톤과 「내리세요」가 겹치는가 (판정 ②)

순서는 전경과 같고, 백그라운드에서 새로 생기는 겹침은 없다.

1. 이벤트 한 스텝 = `handle(event:)`가 톤을 먼저 재생하고(재생기가 `toneEndsAt`을 세운다) 문장을 `DeferredAnnouncer.announce`에 넣는다.
2. `DeferredAnnouncer`는 `speechDeferStep(toneEndsAt)`만큼 기다렸다가 `post`를 부른다 — 이 대기는 전경·백그라운드 구분이 없다. 종전 백그라운드에서는 톤이 안 나서 `toneEndsAt`이 비어 즉시 게시됐고, 이제는 톤 길이만큼 늦게 게시된다.
3. `post`는 채널 술어(E53)를 지나 백그라운드 ∧ 토글 켬이면 `DeviceSpeechQueue.submit`. 칸은 말하는 중이 아니면 즉시 말하고, 말하는 중이면 한 칸에 기다렸다 꺼낼 때 다시 `speechDeferStep`(상한 3초)으로 톤 뒤를 지킨다. `.high`(사다리 1 「다음 역 {하차역}에서 내리세요.」(A71)·「{하차 정류장} 도착. 내리세요.」(A69) — 분류는 `.actionable`, 선점은 우선순위로)는 선점한다 — 이미 지연 창구가 톤 뒤로 미룬 뒤라 톤을 자르지 않는다.
4. 같은 스텝에서 이벤트와 추세 톤은 배타다(`eventOwned`면 추세 톤 nil). 다음 추세 톤은 다음 폴(15초 이상 뒤)이다. 기기 음성이 말하는 도중 다음 폴의 톤이 나면 겹쳐 들리지만 발화를 끊지는 않는다(재생기와 합성기는 다른 플레이어) — 전경 VoiceOver와 같은 성질이고, 15초 주기에서 4초 남짓한 문장과 겹칠 확률은 낮다. 실승차 판정 행에 넣는다.

## 4. 승격 실패 고지가 여전히 참인가 (판정 ④)

`isBackgroundAudible` 거짓(오디오 세션 `.playback` 승격 실패)이면 백그라운드 톤은 재생기를 지나도 들리지 않는다. 고지 「화면이 꺼지거나 다른 앱을 쓰는 동안에는 안내 소리가 나지 않습니다」는 이제 **더 정확하다**(종전엔 정상일 때도 첫 관측 하나 말고는 나지 않았다). 고지 장부는 종전대로 세션당 1회 발화 성공에 걸리고, 백그라운드에서 버려지면(승격 실패면 기기 음성도 들리지 않아 채널이 버림) 다음 톤에서 다시 시도하며 진동은 세션당 1회다. 종전보다 백그라운드 재시도 횟수가 늘 뿐(톤마다) 문장은 결국 전경에서 한 번 들린다. 그 버림이 `missedAnnouncement`를 세워 복귀 때 상태 한 문장이 나오는 것은 종전 첫 관측 때와 같다.

## 5. 함께 고치는 것 (판정 ⑤)

- 소스 가드 `src/lib/__tests__/transit-background-guards.test.ts`: "허용 대입 1곳(trackingStarted)" → "모든 `playTone` 호출부의 인자가 `transitToneAllowedInBackground(` 또는 `false`, 리터럴 `true` 0곳, 추세 톤 자리와 하차 정류장 도착 자리가 Kit 판정을 지난다".
- Kit 테스트 `TransitBackgroundToneTests`: 위 표 전수(허용·불허).
- 저장소 `CLAUDE.md` 「백그라운드 톤은 `trackingStarted` 하나」 → 새 집합. `docs/INTEGRATIONS.md` 같은 제목 절의 허용 집합 불릿.
- `docs/BACKLOG.md` §2 E36 실승차 ①(그 뒤 사다리·도착은 화면을 켜야 난다는 전제)·E53 실주행·실승차 ②(톤이 첫 관측 하나뿐)·E79 새 행, `docs/FIELD-TEST.md` §5-2의 같은 전제를 가진 행.
- 안드로이드 미러 등록부 `android/kit/mirrors/guide.json`에 새 Kit 파일 `pending`(대중교통 안내 미구현, B14).

## 6. 남는 판정

- 실승차(BACKLOG §2 E79 행·대본 §5-2): 잠근 채 정거장마다 진행음·3·2·1 단계음·도착음이 들리는가, 신호 잃음 반복음이 없는가, 톤 뒤 「내리세요」가 잘리지 않는가, 다른 앱 음악 위에서 어떤가, 무음 스위치.
- ~~boarding 국면 접근 사다리를 백그라운드에 넣는가~~ ✅ 2026-11-07 위원장 판정: 넣는다(§2.1).
