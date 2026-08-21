# N2 도보 안내 톤 5종 세분화 — 설계

> 출처: 위원장 실사용 피드백 2026-08-21 ③ + 판정 2026-08-22(`docs/superpowers/plans/2026-08-22-feedback-260821-parallel-plan.md` §1 N2, `docs/BACKLOG.md` N2). 이 문서가 설계 정본이고 브리프는 착수 지시다.
>
> **설계 리뷰 판정**: 생략. 기존 계약(행동 분류 `walkStepAction` + 임박 큐 톤 방출 + 톤 계층 정숙 창)의 재조합이고, 파급이 소리 자산·열거형 케이스에 국소·가역이며, 잔여 리스크(어느 소리가 실제로 구분되는가)는 정적 리뷰가 아니라 실기기 청취만 잡는다.

## 1. 문제

결정 지점 임박 큐(경계 20m 앞)는 행동 종류와 무관하게 `ahead` 트릴 하나를 낸다. 백그라운드·잠금 상태에서는 문장이 나가지 않으므로([[background-guidance-sound-yes-speech-no]]) 소리가 유일한 채널인데, 그 소리가 "곧 뭔가 있다"까지만 말한다. 사용자는 주머니에서 폰을 꺼내야 왼쪽인지 횡단보도인지 안다.

**성과 기준**: 백그라운드·잠금 상태에서 **소리만으로 다음 행동(횡단보도·왼쪽·오른쪽·뒤로 돌기·그 외)을 구분**할 수 있다. 판정은 위원장 실기기 청취(실험판).

## 2. 톤 체계

| 행동(`WalkAction`) | 톤(`BeaconTone`) | 소리 | 길이 |
|---|---|---|---|
| `crosswalk` | `crosswalk` | **음향신호기식 비프 4연음 ×2**(2.0kHz 60ms 비프 4개, 묶음 사이 0.25초) | 1.1초 |
| `left` | `left` | 상승 2음 모티프, 좌우 구분은 §3 후보 | 0.4초 |
| `right` | `right` | 같은 모티프, 우측 | 0.4초 |
| `back` (신설) | `back` | 하강 글라이드 2회(1200→400Hz) — "되돌아감" | 0.9초 |
| `underpass`·그 외 | `ahead` (기존) | 기존 트릴 | 0.68초 |

- `underpass`는 브리프의 "그 외"에 속한다(횡단보도 비프는 **음향신호기**의 인용이라 지하보도에 붙이면 거짓 인용이 된다). 지하보도 문장은 전경 낭독이 구분한다.
- 소리는 전부 **합성**(closer·farther 선례 — 종전 합성 음가를 파일로 렌더). 생성 스크립트 `scripts/build-guide-tones.py`가 정본이며 재생성이 결정론적이다. 햅틱 타이밍은 실측이 아니라 **생성 파라미터에서 직접** 나온다(합성이라 파형이 곧 설계값).
- 기존 9종 파일은 불변(`sounds-drift.test.ts` 대조 유지). 웹 `public/sounds/guide/<이름>.mp3` ↔ iOS `guide-<이름>.mp3` 바이트 동일 계약에 새 파일도 편입.

### 2.1 `WalkAction.back`

마커(회전 표지 자리, 건널목 표지 앞): `"유턴"`(Tmap turnType 14 문서 문형), `"뒤로 돌아"`(카카오 재작성 문형 추정). ⚠ **실호출 55개 고유 문장(카카오·Tmap, 10경로, 2026-08-22)에서 0건 관측** — 희귀 이벤트라 마커는 문서 근거이고, 관측되는 즉시 `walk-action-cases.json`에 실문장을 더한다. 미관측이어도 케이스를 넣는 이유: 마커 없이 `back`을 만들면 톤도 문구도 영영 안 나가고, 마커가 틀려도 결과는 오안내가 아니라 **침묵**(기존 분류기 계약)이다.

문구: `guide.imminent.back`("잠시 후 뒤로 도세요")·`guide.liveAction.back`("뒤로 도세요") 6개 로케일. ⚠ `guide` 네임스페이스는 N1 소유다 — 키 2개만 더하고 통합 rebase 때 N1 세션에 알린다(키 이름이 달라 병합 충돌은 줄 단위로만 난다).

## 3. 좌우 구분 후보 (실기기 선택)

| 후보 | 원리 | 장점 | 약점 |
|---|---|---|---|
| **A 패닝** | 같은 모티프(880→1175Hz)를 좌·우 채널에 하드 패닝 | 직관적(소리가 나는 쪽으로) | **스피커 재생에서 무력** — 주머니 속 단일 스피커·세로 방향 폰은 좌우가 거의 안 갈린다. 이어폰 전제 |
| **B 음높이** | 왼쪽=낮은 모티프(440→523Hz), 오른쪽=높은 모티프(880→1047Hz), 모노 | 스피커·이어폰 모두 성립 | 학습 필요("낮음=왼쪽"은 관습이 아니다) |

둘 다 빌드에 싣는다: 파일 `left-pan`·`right-pan`·`left-pitch`·`right-pitch` 4개. 선택은 `LeftRightToneScheme`(UserDefaults `leftRightToneScheme`, 기본 **B 음높이** — 스피커에서도 성립하는 쪽이 안전한 기본값) — 설정 화면 `#if DEBUG || EXPERIMENTAL` 피커로 전환. 웹은 같은 기본값 상수. **위원장 판정 뒤 패자 파일 2개와 피커를 지우고 이름을 `left`·`right`로 접는다**(후속 커밋, 이 spec 머리에 한 줄 기록).

`BeaconTone.left/.right`의 `resourceName`은 scheme 인자를 받는다 — 케이스는 행동이고 파일은 표현이라 둘을 섞지 않는다.

## 4. 계층별 변경

```
walkStepAction(desc) ─action─▶ routeGuide 6a ─tone─▶ toneLayerStep(priorityTone) ─▶ player(BeaconTone)
```

1. **분류**(`walk-action.ts` ↔ `WalkAction.swift`): `back` 케이스·마커 2개. fixture `walk-action-cases.json`에 back 케이스 + 순서 케이스("횡단보도에서 유턴" → back).
2. **톤 선택**(`route-guide.ts` ↔ `RouteGuide.swift`): 순수 함수 `imminentTone(action)`(walk-action 모듈, 표 §2) — 6a 방출부가 `"ahead"` 상수 대신 이것을 쓴다. `GuideTone`(route-guide 층)은 `"ahead" | "crosswalk" | "left" | "right" | "back" | "warning"`. car 40m 방출은 `ahead` 유지. fixture `route-guide-scenarios.json`의 imminent 톤 기대값을 행동별로 갱신(러너 `toneName` 확장) + `back` 시나리오 1개 신설(신설 매핑이 fixture 없이 남지 않도록).
3. **톤 계층**(`guide-tone-layer.ts` ↔ `GuideToneLayer.swift`): 정숙 창 조건 `tone === "ahead" || "warning"` → `isActionTone(tone)`(5종 + warning). 분기 순서·상수 불변.
4. **재생기**(`useBeaconSound.ts` ↔ `BeaconTonePlayer.swift`): 파일 6개 등록(crosswalk·back·left/right ×2 scheme), 게인 0.8(ahead 동급), 햅틱 패턴(크리티컬 "지금이다" 신호라 전부 병행 — 비프 8타·모티프 2타·글라이드 감쇠 2회).
5. **iOS 소비자** `BeaconModel`: `out.tone.map { $0 == .ahead ? .ahead : .warning }` → Kit `BeaconTone(guide:)` 변환 한 곳.
6. **가드**: `sounds-drift.test.ts` SOUNDS 16종, `BeaconTone` 케이스 대조, 웹 훅 문자열 대조.

## 5. 소유권 밖 접촉 (통합 시 고지)

- `messages/*.json` `guide.imminent.back`·`guide.liveAction.back`(N1 네임스페이스) → 키 2개.
- `ios/Gildongmu/SettingsView.swift`(미배정) → 실험 피커 1절.
- `Localizable.xcstrings` 2벌은 손으로 고치지 않고 `messages-to-xcstrings.mjs`로 재생성한 결과만 커밋한다(통합 rebase 뒤 다시 재생성).

## 6. 검증

- 게이트: `npm run test:run`(walk-action·route-guide·tone-layer fixture, drift, i18n 키), Kit `swift test`(WalkActionTests·RouteGuideTests·GuideToneLayerTests).
- 변이: `imminentTone`을 상수 `ahead`로 되돌리면 route-guide fixture가 실패해야 한다(검출력 확인).
- 실기기(위원장, 실험판): ①잠금 상태에서 5종이 구분되는가 ②A/B 중 어느 쪽이 스피커·이어폰 모두에서 성립하는가. 결과는 BACKLOG N2 종결 + 이 spec 머리에 기록.
