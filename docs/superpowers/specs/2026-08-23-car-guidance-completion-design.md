# K2 자동차 실시간 안내 완성 — 설계 (2026-08-23)

> 브리프: `docs/superpowers/plans/2026-08-23-feedback-260822-parallel-plan.md` §1 K2 행. 위원장 판정 4건(①"실주행은 딥링크 위임" 폐기 ②동승자/운전자 설정 전환, 운전자 모드는 `TtsPlayer` 음성 채널·짧은 명령형·낮은 빈도 ③임박 신호 시간 축 5초(운전자 8초) 잠정 ④도착 종 + 종료 화면 + 도보 인계 버튼)은 재론하지 않는다. 코디네이터 설계 결정(행동 분류는 Tmap `turnType`, 행동별 임박 톤·햅틱·하단 2행·자동 대안 제안 car 확장, 주기 통지 단문화, 방위 축·도착 추정·최종 접근 6b는 범위 밖)을 그대로 받는다.
>
> **설계 리뷰 판정**: 실행한다 — 헌장 조건 ①(새 판정 층: 시간 축 임박·자동차 행동 분류·도착 판정) ④(실주행 안전 축)에 해당. 결과는 §10.

## 0. 실측 근거 (2026-08-22 자택→송추가마골, 실험판, fix 2,424건)

로그 원본 `~/gildongmu-private/field-logs/2026-08-23/guide-diag-2026-08-23.log.gz`(커밋 금지). 산출 스크립트는 세션 스크래치에서 돌렸고 수치만 여기 적는다.

| 축 | 값 |
|---|---|
| 속도 분위(m/s, 음수 제외 n=2,318) | p10 2.1 · p25 5.1 · **p50 8.6** · p75 16.7 · p90 20.8 · p95 23.3 · p99 25.8 · max 26.9 |
| 5m/s(18km/h) 이상 비율 | 75% (1m/s 미만 6%) |
| fix 간격 | p50 1.0초 · p99 4.3초 — **관측 지연 ≈ 1초** |
| 정확도 | p50 8m · p90 8m · p99 831m(터널) |
| 이벤트 | farNotice 3 · announceSteps 7 · periodic 38 · uncertainEnter/Exit 3쌍 · finalApproachEnter 1 (경로 8스텝, 33km, 62분) |
| uncertain 구간 | 315초·752초·313초 — 정확도 50m 초과(터널·고가 하부, acc 336~3,386m, speed -1). 이 동안 **발화 0** |
| 복귀 뒤 따라잡기 | 5분 공백 뒤 d가 25,780→29,786(4km)로 뛰고 **이미 지난 스텝 3개의 전문이 1초 간격으로 연달아 발화** (+3557·3558·3559초) |

판단에 쓴 것:
- **임박 시간 축은 거리 바닥이 필요하다**: 속도 표본이 없거나(세션 시작·정확도 20m 초과 배제) 정지 중이면 `v×T=0`이라 임계가 0이 되고, `rem ≥ 0` 하한과 만나면 큐가 구조적으로 안 나간다. p10 2.1m/s × 5초 = 10m라 바닥 15m면 서행에서도 7초 이상 여유다.
- **관측 지연 1초는 시간 축에 더한다**(도보의 `10 + PROJECTION_LAG_M` 동형): 5초 의도는 `5 + 1`로 구현하고 lag 상수는 하나만 둔다.
- **고속 중앙값 8.6m/s에서 종전 car 임계(announceAhead v×15s=130m, imminent 없음)는 "무엇을"만 있고 "지금이다"가 없다** — 도보 2026-08-09 판정과 같은 공백.
- **지난 스텝 전문 연속 발화는 자동차에서 위험 오안내다**("교차로에서 우회전"을 이미 지난 교차로에 대해 듣는다). §3.4.

## 1. 범위

| # | 과제 | 소유 파일 |
|---|---|---|
| ① | 행동 분류: 서버 Tmap `turnType` → `action` 투영 | `src/lib/providers/tmap-car.ts`, `src/lib/types.ts`, Kit `Models/RouteModels.swift` |
| ② | 리듀서: car 임박 시간 축·지난 스텝 무발화 따라잡기·운전자 프로파일 | `src/lib/route-guide.ts` ↔ Kit `RouteGuide.swift`, `walk-action.ts` ↔ `WalkAction.swift`, `route-geometry.ts` ↔ `RouteGeometry.swift`, `car-route-guide.ts` ↔ `CarRouteGuide.swift`, 공유 fixture |
| ③ | 하단 2행 car 확장 | `guide-live-rows.ts` ↔ `GuideLiveRows.swift`, fixture |
| ④ | iOS 청취자 모드(동승자/운전자) + 운전자 음성 채널 | `SettingsView.swift`, `Chat/TtsPlayer.swift`, `BeaconModel.swift`, Kit 신규 `CarListener.swift` |
| ⑤ | iOS 자동차 도착: 정차 판정·도착 종·종료 화면·도보 인계 버튼 | `BeaconModel.swift`, `BeaconTrackingSheet.swift`, `GuideSessionCoordinator.swift`, `GildongmuApp.swift`(인계 콜백 배선만) |
| ⑥ | 자동 대안 제안 car 확장·주기 통지 단문화·임박 문구 | `BeaconModel.swift`, `GuideText.swift`, 웹 `useRouteGuide.ts` `eventText` |
| ⑦ | 안내 중 경유지 삭제(N4 잔여) | `BeaconTrackingSheet.swift`, `BeaconModel.swift` |
| ⑧ | 로그 `session kind=` 표식 | `BeaconModel.swift`(`GuideDiag` 호출) |
| ⑨ | `guidance-gate-drift` 진입점 수 6→7 | `src/lib/__tests__/guidance-gate-drift.test.ts` |

**비범위(브리프 확정)**: 방위 축 car 적용, 도착 추정 자동 종료(presumedArrival), 최종 접근 6b 재설계. **추가로 범위 밖에 두는 것**: car `UNCERTAIN_ACCURACY_M`(50m) 완화 — 이번 로그의 uncertain 3구간은 acc 300m 이상의 터널 공백이라 임계를 올려도 구하지 못한다(§0). B1 관찰 항목으로만 남긴다. 딥링크 버튼은 장소 상세에 그대로 둔다(보조). `BeaconTrackingSheet`의 `RouteOverviewSheet`·`AlternativeRoutePreviewSheet` 두 struct는 구조·이름을 바꾸지 않는다(E15-1이 파일 이동 예정, 코디네이터 전파 2026-08-23).

## 2. 행동 분류 — 서버 `turnType` 투영

### 2.1 왜 문자열 마커가 아닌가
도보는 재작성 문장의 부분 문자열(`walkStepAction`)로 행동을 고른다. 자동차 문장은 **"오른쪽 방향"이 회전이 아니다**(turnType 117, 코퍼스 48%가 같은 도로로 이어지는 갈래 선택 — `car-guidance.ts` 주석) 같은 함정이 있고, 재작성 규칙이 바뀌면 판정이 함께 흔들린다. Tmap은 행동을 정수 코드로 준다. 문장이 아니라 코드를 투영하면 재작성과 판정이 분리되고(`INTEGRATIONS.md` §자동차 경로의 "임박 층 도입 시 재검토" 항목이 이것이다), 낭독 재조합 금지 조항과도 충돌하지 않는다 — 문장은 여전히 서버 `rewriteCarGuidance`가 만들고 `action`은 문장이 아니라 **별도 필드**다.

### 2.2 `CarAction` 집합과 매핑

낭독 문구·소리를 가르는 단위만 둔다(문구가 같으면 구분하지 않는다).

| `action` | turnType | 임박 톤 | 동승자 문구(`guide.carImminent.*`) | 운전자 명령(`guide.carCommand.*`) |
|---|---|---|---|---|
| `left` | 12, 16, 17(공식 표 어휘 "N시 방향 **좌회전**" — 회전이다) | `left` | 잠시 후 좌회전하세요 | 좌회전 |
| `right` | 13, 18, 19 | `right` | 잠시 후 우회전하세요 | 우회전 |
| `back` | 14(U턴), 136(6시 방향) | `back` | 잠시 후 유턴하세요 | 유턴 |
| `keepLeft` | 118(왼쪽 방향), 102·105·112·115(왼쪽 입구/출구), 137~141(7~11시 방향) | `left` | 잠시 후 왼쪽 길로 가세요 | 왼쪽 길 |
| `keepRight` | 117(오른쪽 방향), 101·104·111·114(오른쪽 입구/출구), 131~135(1~5시 방향) | `right` | 잠시 후 오른쪽 길로 가세요 | 오른쪽 길 |
| *(없음)* | 11 직진, 15 P턴, 43·44(차선), 71~76(출구·갈림길 — 번호별 의미 불명), 103·106·113·116(전방 입구/출구), 119~124(지하차도·고가·터널·교량·옆길), 130(토끼굴), 142(12시), 150·151, **182·183(도착안내 왼쪽/오른쪽 — 목적지 위치이지 회전이 아니다)**, 184~189(경유지), 191~194(주의), 200·201·203, 그 외 전부 | — | — | — |

- **정본은 Tmap 공식 코드표**(readme.io "경로안내 샘플예제", 2026-08-23 확인 — 설계 리뷰 B2·M8로 대조): 16~19는 문서 어휘가 "N시 방향 좌회전/우회전"이라 회전으로 둔다, 130은 톨게이트가 아니라 토끼굴, 131~142가 시계 방위, 182·183은 초안의 "비보호 좌/우"가 틀렸고 "도착안내 왼쪽/오른쪽"이라 null. 코퍼스(`tmap-car-corpus.json` 212문장) 관측 코드는 전부 표에 있다. **표에 없는 코드는 "없음"이다** — 미분류의 결과는 오안내가 아니라 침묵(도보 분류기 계약 동형).
- 102·105·112·115·131~141은 **미관측이지만 공식 표의 좌우 대칭·시계 방위 코드**라 넣는다. 43·44(차선 오른쪽/왼쪽)·71~76은 공식 표에 번호별 의미가 모호해 null.
- `keepLeft`/`keepRight`의 톤은 `left`/`right`와 같다. 소리 5종을 늘리지 않는다(N2 판정 5종 유지).

### 2.3 투영 위치와 계약
- `normalizeTmapCarRoute`가 `includeGeometry` 모드에서만 `guides[i].action?: CarAction`을 싣는다(`terminalCoord` 선례 — 기하 미지정 응답은 byte-호환 유지, 스키마 스냅숏이 강제). 순수 함수 `carActionFromTurnType(turnType: number): CarAction | null`은 `src/lib/car-action.ts`(신규) ↔ Kit `CarAction.swift`(신규) 미러, fixture `car-action-cases.json`이 코드 표를 동조한다.
- 카카오 폴백은 `turnType`이 없어 `action` 부재 → 임박 큐 없음(침묵). 폴백 응답은 기하도 없어 애초에 상세 안내 부적격이다(B1 §3.1).
- `buildCarGuide`(웹·Kit)가 `action`을 `GuideRoute.steps[i].action`으로 옮긴다. `buildGuideRoute` 입력 스텝에 `action?` 선택 필드 추가 — 도보 스텝은 싣지 않는다.
- iOS `CarRouteGuide` 디코딩에 `action: CarAction?` 선택 필드(미지 값은 **nil로 떨어뜨린다** — 서버가 코드를 더했을 때 구버전 앱이 디코딩 실패로 상세 전체를 잃지 않게. `RouteModels` 디코더에 `init(from:)`로 unknown→nil).

## 3. 리듀서 (`guideStep`)

### 3.1 행동 타입 통합
`WalkAction`에 `keepLeft`·`keepRight` 두 케이스를 더하고 `GuideAction = WalkAction` 별칭을 둔다(TS `type GuideAction = WalkAction`, Swift `typealias GuideAction = WalkAction`). 이름을 갈아엎지 않는 이유: `walkStepAction`·`guide-live-rows`·fixture·문구 키가 전부 이 이름을 물고 있고, 의미는 "결정 지점에서의 행동"으로 이미 수단 중립이다. `walkStepAction`은 keep* 를 내지 않는다(도보 문형에 없다). `imminentTone`: `keepLeft→left`, `keepRight→right`.

`imminent` 이벤트의 행동 출처는 **프로파일이 정한다**(`GuideTuning.actionSource`: walk `text`, car `step`):
```ts
stepActionFor(step, source) = source === "step" ? (step.action ?? null) : walkStepAction(step.description)
```
⚠ 초안의 `step.action ?? walkStepAction(desc)` 폴백은 설계 리뷰 B1로 기각했다 — car에서 `action` 부재가 문장 분류로 되돌아가면 "왼쪽 옆길"·"오른쪽 방향" 문장이 회전으로 분류돼 코드 판정 층을 만든 목적이 무효가 된다. car는 `action`이 없으면 **침묵**이다. 표시 계층 `buildDisplayUnits(steps, source)`도 같은 함수를 쓴다.

### 3.2 임박 시간 축 (`GuideTuning`)
`imminentAheadM: number | null`(큐 사용 여부 게이트 + 거리 바닥)은 유지하고 `imminentAheadS: number`를 더한다. 임계는 `announceAhead`와 같은 구조:
```
imminentAhead = max(tuning.imminentAheadM, vPrev × tuning.imminentAheadS)
```
- walk: `imminentAheadM = 20`, `imminentAheadS = 0` → 종전과 byte-동일.
- car(동승자): `imminentAheadM = CAR_IMMINENT_FLOOR_M = 15`, `imminentAheadS = 5 + CAR_FIX_LAG_S(1) = 6`.
- car(운전자): `imminentAheadS = 8 + 1 = 9`, 나머지 동일. `CAR_DRIVER_TUNING = { ...CAR_TUNING, imminentAheadS: 9 }`. Kit `GuideTuning.carDriver`.
- `vPrev`는 6c가 이미 쓰는 `estimateSpeedMps(state.speedSamples)`(직전 10초 창, 정확도 ≤20m 표본). 표본이 없으면 0 → 바닥 15m. 차량은 `speedSuggest=false`라 가드 기계는 안 돌지만 **표본 수집은 프로파일과 무관하게 매 fix 한다**(4절) — 확인했다.
- 6a의 나머지 불변식(전문 선행 `imminentUpTo < announcedUpTo`, `rem ≥ 0`, 행동 없는 경계 래치 전진, `!isOff`)은 그대로 car에 적용된다. 6c의 "car는 임박 층이 없어 전문에 `ahead` 톤을 붙인다" 분기는 **car에도 임박 층이 생기므로 자연히 무톤이 된다**(`tuning.imminentAheadM === null ? "ahead" : null` — 코드 불변, 의미만 바뀜). ⚠ 이로써 car의 `QUIET_AFTER_ACTION_S` 정숙 창은 40m 전문이 아니라 임박 큐가 연다(도보와 같아진다).
- car `imminentAheadM`이 null이 아니게 되므로 `GuideTuning` 주석의 "보행 전용" 경고는 지우고 이 spec을 가리킨다.
- **속도 표본이 2개 미만이면 `imminentUnknownSpeedM`**(car 60m ≈ 10m/s×6초, walk 20=바닥)을 쓴다(설계 리뷰 B4 — 터널 복귀·시작 직후 표본이 비면 바닥 15m만 남아 30m 앞 교차로가 침묵한다).
- **속도 표본 정확도 상한은 프로파일 값**(`speedSampleMaxAccM`: walk 20, car 50=uncertain 게이트). 차량은 임계가 `v×T`라 정확도 21~50m 구간에서 표본이 끊기면 시간 축이 죽는다.
- **car는 전문 선행을 요구하지 않는다**(`imminentNeedsAnnounce: false`, 설계 리뷰 B3): 명령 "우회전"은 자기 완결이고, 재획득·시작 직후 경계가 임계 안이면 전문을 기다리는 한 fix(20m/s에서 20m)에 경계를 지나 큐가 영영 사라진다. 명령이 전문보다 먼저 나가면 `announcedUpTo`도 함께 올려 6c가 지난 행동의 전문을 회전 뒤에 읽지 않는다(도로 정보는 주기 통지 몫). walk는 종전대로 선행 요구.

### 3.3 운전자 프로파일의 정의
운전자 모드는 리듀서에서 **`imminentAheadS` 하나만** 다르다. "낮은 빈도"는 리듀서가 아니라 **오케스트레이터가 이벤트를 거르는 것**으로 구현한다(§6.2) — 리듀서에 발화 정책을 넣으면 웹·Kit 미러와 fixture가 청취자 축까지 곱해진다. 리듀서는 같은 이벤트를 내고 iOS가 운전자 모드에서 `periodic`·`uncertain*`·`reacquir*`를 **발화하지 않는다**(상태 행은 갱신).

### 3.4 공백 뒤 따라잡기 안전 (`silentCatchUp`, car 전용)
§0의 "4km 점프 뒤 지난 스텝 3개 연속 전문"의 기제는 유닛 건너뛰기만으로 막히지 않는다 — 로그를 다시 보면 d는 한 번에 뛴 것이 아니라 **구속 창이 fix마다 150m씩 기어가며** 지난 교차로를 차례로 지났고, 그 기어가는 fix의 표본(150m/s)이 속도 추정을 부풀려 창이 커지는 바람에 창 기아 3회(재획득)도 걸리지 않았다. 그래서 플래그 하나가 세 가지를 바꾼다:
1. **투영 점프 fix(`jumped`)는 속도 표본에 넣지 않고 6a 이후 발화를 전부 건너뛴다.** 상태(d·창 기아 카운트)는 커밋되므로 창이 실위치를 따라잡거나(차량이 창보다 느리면 몇 fix 안에 따라잡는다 — fixture "촘촘한 uncertain") 기아 3회로 재획득(전역 재투영 + `restateAt` 래치 재구성)에 든다. 점프 fix에서 래치를 움직이지 않으므로 노이즈 한 fix가 래치를 비가역 전진시키는 경로가 없다(설계 리뷰 B5).
2. **uncertain 복귀 fix의 공백이 `REACQUIRE_GAP_S`(10초)를 넘으면 복귀 대신 재획득으로 간다**(fixture "복귀 공백"). uncertain 분기가 `lastFixAt`을 갱신해 아래 gap 검사가 이 공백을 못 본다 — 터널 5분 뒤 `resumePhase`로 돌아가면 1번의 기어가기가 시작된다.
3. **유닛 끝이 `d`보다 앞에(작게) 있는 유닛은 전문 없이 래치 3종을 유닛 끝으로 옮긴다**(6b 뒤·6c 앞, `!isOff`일 때만). 끝이 `d` 뒤(크게)에 있는 유닛은 6c가 발화하되 **묶음 안에서 이미 끝난 스텝(`endD < d`)은 빼고 읽는다**(설계 리뷰 B6 — 남는 것이 없으면 마지막 스텝 하나).

walk는 전부 종전 동작이다(fixture "walk: 촘촘한 uncertain" — 순차 발화 유지). 도보도 같은 증상이 가능하지만 실보행 판정이 종전을 전제하므로 도보 적용은 별도 판정(`docs/BACKLOG.md`). 리뷰 M7(`announcedUpTo`가 "낭독 완료"와 "처리 완료" 두 뜻)은 받아들이되 필드를 가르지 않는다 — 6b가 요구하는 것은 "지난 스텝이 더 없다"이고 3번이 옮기는 유닛은 전부 지난 것이라 두 뜻이 갈리는 입력이 없다. 갈리는 입력이 생기면 그때 `resolvedUpTo`를 뗀다.

### 3.5 주기 통지 간격
`periodicIntervalS(remaining)`(60/30/15초)는 차량에서도 유지한다. 단문화(§6.3)가 부담을 줄이고, 운전자 모드는 주기 통지 자체를 내지 않는다(§3.3).

### 3.6 fixture 추가 (`route-guide-scenarios.json`, 웹·Kit 공용)
| 이름 | 검증 |
|---|---|
| car: 시간 축 임박 — 20m/s에서 경계 140m 앞 fix 무발화, 120·100m 앞 fix 중 하나에서 `imminent(right)`+`right` 톤 | `v×6=120`, 등호는 어느 쪽이든 허용(`afterFixAny`) |
| car: 저속(1.5m/s) 임박은 바닥 15m — 18m 앞 무발화, 14m 앞 발화 | 바닥 |
| car: 정확도 30m fix도 표본(상한 50) — 시간 축 유지 | `speedSampleMaxAccM` |
| car: `action` 없는 스텝 경계(터널)는 큐 없이 래치 전진, 다음 회전 정상 | 침묵 계약 |
| car: 운전자 프로파일은 같은 fix열에서 임박이 더 앞(9초) | `CAR_DRIVER_TUNING` |
| car: 전문 낭독은 무톤, 임박이 톤을 든다(도보 동형) | 종전 "car 전문 ahead 톤" 시나리오 **교체** |
| car: 촘촘한 uncertain 뒤 창 따라잡기 — 점프 fix 무발화, 따라잡은 뒤 현재 유닛 전문만 | `silentCatchUp` ①③ |
| car: uncertain 복귀 공백 >10초는 재획득 | `silentCatchUp` ② |
| walk: 같은 점프에서 종전대로 순차 발화 | 도보 불변 |

fixture 스텝 선언에 `action` 선택 필드 추가(러너가 `buildGuideRoute`에 전달). `walk-action-cases.json`에 `imminentTone(keepLeft)=left`·`(keepRight)=right` 2건.

## 4. 하단 2행 car 확장 (`guideLiveRows`)
- `LiveStepInput.action?: GuideAction` 추가. `buildDisplayUnits`는 `step.action ?? walkStepAction(description)`으로 행동을 고른다(§3.1 동형). car는 `live` 조각이 없어 `target`·`anchor`는 null → 윗줄 "{n}m 직진"(`straight` target null), 아랫줄 `action` anchor null("{action}" 단독 틀은 이미 `nextAction` anchor 생략 경로가 있는지 확인해 없으면 `guide.nextActionNoAnchor` 추가).
- 회전 접근 전환 잔여 `TURN_APPROACH_M`(10m)는 도보 상수다. 차량은 임박 큐 시점과 맞추기 위해 `guideLiveRows(prev, units, d, baselineD, phase, turnApproachM)`에 인자를 추가한다 — walk는 `TURN_APPROACH_M`, car는 오케스트레이터가 **리듀서와 같은 식**(`max(15, vPrev×S)`에서 표시 lag 10m를 뺀 값, 하한 0)을 넘긴다. 기본값 없음(안전 인자 계약 [[no-default-for-safety-parameters]]).
- `displayEffectiveD`의 `PROJECTION_LAG_M`(10m)은 그대로 쓴다. 차량 관측 지연(1초×v)을 표시에도 보정하려면 lag가 속도 함수가 되어야 하는데, 표시 행은 숫자 일관성이 순간 정확성보다 중요하다([[live-display-coordinate-consistency]]). B1 판정 뒤 재검토.
- 틀 키는 도보 것을 재사용하고(`guide.nextAction`·`nextStraightNoName`·`liveTurnIn`·`progressNext`), 행동 구는 수단별이다: walk `guide.liveAction.*`(기존 5키, keep*는 도보 문형에 없어 추가하지 않는다) / car `guide.carLiveAction.*`(left·right·back·keepLeft·keepRight — "좌회전하세요"·"왼쪽 길로 가세요"). `GuideText.liveActionPhrase`와 웹 렌더가 `sessionKind`를 받는다. 러너(fixture)는 디스크립터 수준에서 비교하므로 문구 분기는 러너 밖이다.
- fixture `guide-live-rows-scenarios.json`에 car 시나리오 2건(회전 접근 전환이 인자 값에서 일어남, action 없는 경계 흡수).
- iOS `refreshLiveRows`의 `sessionKind == .walk` 가드 제거, `BeaconTrackingSheet` 142행 분기(`sessionKind == .walk, mode == .detail`)를 `mode == .detail`로. "현재 안내" 행(`currentGuidanceText`)은 car에서도 liveRows가 대체한다.

## 5. 자동 대안 제안 car 확장
`maybeFetchProposal`의 `sessionKind == .walk` 가드를 제거한다. `fetchProposal`→`fetchDetailData`는 이미 `sessionKind`로 `routeService.car`를 고르고 `via`를 싣는다. `RerouteProposalGate`(세션 예산 5회·만료)는 수단 중립이다 — 확인했다. `adoptProposal`·`commitReroutedRoute`의 car 분기(`roadSpans` 재설정)는 기존 재조회 경로와 같다. 제안 통지 문장(`guide.proposalReady`)은 수단을 말하지 않아 그대로.

## 6. iOS 오케스트레이션 (`BeaconModel`)

### 6.1 청취자 모드
Kit `CarListener: String, CaseIterable { passenger, driver }`, `storageKey = "carListener"`, 기본 `.passenger`. `SettingsView`에 `Picker(ios.settings.carListener)`를 `#if DEBUG || EXPERIMENTAL` 안 `leftRightTone` 피커 옆에 둔다(자동차 안내가 봉인 안이라 정식판엔 뜻이 없는 설정이다 — 졸업 때 `#if`를 함께 지운다). 세션 시작 시 읽어 `listener`로 고정한다(세션 중 설정 변경은 다음 세션부터 — 발화 채널이 중간에 바뀌면 진행 중 통지 슬롯이 갈린다). `tuning`은 `sessionKind == .car ? (listener == .driver ? .carDriver : .car) : .walk`.

### 6.2 운전자 음성 채널
- `post()`가 `sessionKind == .car && listener == .driver`면 `AccessibilityNotification` 대신 `TtsPlayer.shared.speakGuidance(text)`를 부른다. **전경 가드를 지나지 않는다** — 운전자 채널은 스피커 재생이고 백그라운드 오디오 모드가 있으며, 잠금 중 발화가 목적 그 자체다(`guideAudioStep`의 "백그라운드는 톤만" 규칙은 VO 통지에 관한 것이다. 이 채널은 톤과 같은 취급). `outputSuppressed`(받아쓰기 중) 가드는 유지(마이크 오염).
- `TtsPlayer.speakGuidance(_:)`(신규): 기존 `synthesizer`로 즉시 발화, **직전 안내 발화를 끊는다**(latest-wins — 임박 명령이 전문 뒤에 줄 서면 시점을 놓친다). `activatePlaybackSession()`을 **부르지 않는다** — 안내 세션의 오디오 카테고리는 `BeaconTonePlayer`가 소유하고(`.playback`, `didPromote` 원복 규칙) TtsPlayer가 `.duckOthers`로 다시 세팅하면 `GuideAudioSession` 판정 밖에서 카테고리가 바뀐다. 채팅 재생 중이면 `stop()`으로 끊는다(generation 증가).
- `DeferredAnnouncer` 지연(톤 뒤 발화)은 그대로 지난다 — 채널이 바뀌어도 "소리와 음성은 같은 청각 채널"은 참이다.
- 운전자 모드에서 **거르는 이벤트**: `periodic`·`bundleReread`·`uncertainEnter/Exit`·`reacquiring/reacquired`·`speedSuggest`(이미 무시). 내는 것: `announceSteps`·`farNotice`(둘 다 **짧게** — `{distance} 앞 {command}`, 행동 없는 스텝은 무발화. 설계 리뷰 M5: 재작성 전문·복합 유닛을 AVSpeech로 읽으면 임박 명령과 경쟁한다)·`imminent`(명령)·`offRoute`/`backOnRoute`·`waypointReached`·최종 접근 진입·도착·시작·재조회. 동승자 모드는 종전 도보와 같다(전부 VO 통지). 리뷰 B8("걸러진 이벤트가 판정 슬롯을 소비한다")은 기각 — 걸러지는 이벤트는 전부 판정 사슬의 끝(`periodic`·`bundleReread`)이거나 어떤 임박도 평가되지 않는 조기 반환(`uncertain*`·`reacquir*`)이라 같은 fix에서 잃는 하위 판정이 없다.
- 햅틱은 운전자 모드에서 `BeaconTonePlayer.play`의 햅틱을 **끄지 않는다** — 끄는 코드가 하나 더 늘 뿐 해롭지 않고(기기가 홀더에 있으면 진동이 안 느껴질 뿐), 동승자가 같은 기기를 들고 있을 수도 있다. 톤은 두 모드 모두 낸다(스피커·이어폰 모두 유효).
- 운전자 모드에서 `highPriority`는 무의미(VO 우선순위)라 무시한다.

### 6.3 문구
- 임박: `imminentText(action)`는 `sessionKind`·`listener`를 본다 — walk `guide.imminent.*`(기존 5키), car 동승자 `guide.carImminent.*`(5키), car 운전자 `guide.carCommand.*`(5키). 키는 리터럴 switch(린터 계약). 웹 `eventText`는 `kind === "car" ? t(\`carImminent.${action}\`) : t(\`imminent.${action}\`)`(웹엔 운전자 모드가 없다 — 웹 실시간 안내는 VO 채널뿐이고 차 안에서 웹을 쓰는 시나리오는 판정 밖).
- 주기 통지 단문화(car): 다음 스텝에 `action`이 있으면 `guide.carPeriodic = {distance} 앞 {command}`(command는 `guide.carCommand.*` 단어 — "약 1.2km 앞 우회전"), 없으면 종전 `guide.next`(전문) 유지, 마지막 스텝은 `guide.nextDestination`. `GuideText.periodicCar` ↔ 웹 `carPeriodicLine`. 운전자 모드는 주기 통지를 내지 않으므로 이 문구는 동승자 전용이다.
- 시작 문장 `guide.carStart`는 그대로. 도착 `guide.arrived` 그대로(수단을 말하지 않는다).

### 6.4 자동차 도착(판정 ④)
현행: car는 `hasFinalApproachGeometry=false`라 잔여 150m에서 최종 접근에 들어가 직선 추적하고, `distance ≤ 15m`에서 도착한다. 차량은 목적지 15m 안에 세우지 못하는 경우가 흔하다(주차장·건너편 정차).

- Kit 순수 함수 `carArrivalStep(distance:accuracy:motion:) -> Bool`(신규 `CarArrival.swift` ↔ 웹 `car-arrival.ts`, fixture): `distance ≤ CAR_ARRIVAL_STOP_M(40) && accuracy ≤ CAR_ARRIVAL_MAX_ACC_M(30) && motion == .stopped`. 도플러 정지 3-state를 그대로 쓴다(`speedUnknown`은 정지가 아니다). 초안의 `distance ≤ 15` 무조건 분기는 설계 리뷰 M4로 뺐다 — 목적지 옆 차로를 50km/h로 지나며 종료되는 경로였다. 차량은 어차피 서야 도착이다. 판정은 최종 접근 국면 안에서만 돈다(경로 종점 150m 안 — 평행도로 오판의 1차 방어, M3).
- `handleFinalApproach`의 `arrived` 판정을 `sessionKind == .car ? carArrivalStep(...) : distance <= finalApproachArriveMeters`로 가른다. 도착 뒤 경로는 종전과 같다(종 `.nearby` → `stop()` → `arrivalDest` → `announce("guide.arrived", .high)`).
- ⚠ **신호 대기 오판 위험은 잠정 수용**: 목적지 40m 안 적신호 정차가 도착으로 잡힐 수 있다. B1 실주행 판정 축에 적고(§9), 오판이 실측되면 "정지 지속 N초"를 더한다(지금은 넣지 않는다 — 적신호도 N초를 넘기므로 지속 시간은 답이 아닐 가능성이 높고, 그때는 거리 축을 좁히는 쪽이 맞다).
- 종료 화면: `BeaconTrackingSheet.arrivalSection`은 이미 수단 무관이다. 자동차 세션의 종료 화면에 **"여기서 도보 안내 시작"** 버튼을 더한다(`ios.beacon.carWalkHandoffStart`, 대중교통 `transitGuide.walkHandoffStart` 틀). 걸음 요약 없음(`sessionStartedAt`이 car에서 nil이라 이미 나오지 않는다).
- `stop()`이 `sessionKind`를 `.walk`로 되돌리므로 시트가 car 세션이었음을 알 수 없다 → `BeaconModel.arrivalSessionKind: GuideSessionKind?`를 **`stop()` 앞에서** 기록하고 `clearArrival()`이 비운다(설계 리뷰 B10 — 초안의 "`arrivalDest` 대입 직전"은 `stop()` 뒤라 항상 walk가 적힌다). 시트는 `arrivalSessionKind == .car`일 때만 인계 버튼을 보인다. 발화 채널 판정도 `sessionKind`가 아니라 `stop()`이 지우지 않는 `outputProfile`(세션 시작에 고정, 다음 시작에 교체)을 본다 — 도착 문장이 운전자 채널로 나가야 한다. 운전자 도착 발화가 백그라운드에서 잘리지 않도록 `BeaconTonePlayer.endSession`의 카테고리 원복 유예에 발화 길이를 더한다(B9).
- 인계: `GuideSession.acceptCarWalkHandoff()` — `beacon.arrivalDest`에서 dest·label을 읽고 `beacon.clearArrival()` 뒤 `startBeacon(StartRequest(kind: .walk, accessible: false, variant: nil, shortestAvailable: false, waypoint: nil))`. 대중교통 인계의 600ms 지연은 transit→beacon 모델 전환 경합 때문이었고 여기서는 같은 모델이라 **지연 없음**. `startBeacon(` 호출이 하나 늘어 `guidance-gate-drift` 기대값 6→7, spec 표(`2026-08-04-…` §3.2 표가 정본이면 그 표, 없으면 이 spec §9 표)를 갱신한다. 도보 인계는 실험판 봉인 안에서만 도달 가능한 버튼이지만 **도보 세션 자체는 졸업한 기능**이라 게이트를 추가로 걸지 않는다.
- 포커스: 종료 화면 착지는 종전 `landArrivedFocus`(도착 문장). 인계 버튼은 그 다음 행.

### 6.5 안내 중 경유지 삭제(N4 잔여)
- 시트 경유지 행 옆에 `waypoint != nil`일 때만 **"경유지 삭제"** 버튼(`ios.guide.waypointRemove`). 누르면 `model.removeWaypoint()`: `waypoint = nil`, `syncStartRequestWithSession()`, 제안·프리뷰 소거, `performReroute(intent: .waypointRemoved)`(기존 `setWaypoint` 재조회 경로 동형)로 출발→도착 재조회, 통지 `ios.guide.waypointRemoved = 경유지 {label} 삭제, 경로를 다시 조회합니다`(`.high` — 버튼이 사라지며 포커스가 옮겨간다, 헌장 판별선). 버튼이 사라지므로 포커스는 **중지 버튼**으로 선점(`stopFocused`, 재조회 버튼 선례).
- `routeWaypointLabel`은 재조회 커밋이 nil로 갱신한다(기존 계약).

### 6.6 로그 표식
`start()`가 첫 fix 전에 `guideDiagLog("session kind=\(kind) listener=\(listener) mode=\(mode) variant=…")` 한 줄을 남긴다. 로그 색인 `docs/superpowers/specs/logs/README.md`에 "2026-08-23 이후 로그는 `session kind=`로 수단을 가른다"를 적는다.

## 7. 웹 (`useRouteGuide`)
미러 의무는 순수 함수·fixture까지이고 UI 배선은 최소로 한다: `eventText`의 car 임박 문구(§6.3)·car 주기 단문(`carPeriodicLine`)·`liveStepsFrom`이 car 스텝의 `action`을 실어 하단 2행이 car에서도 도는 것(§4, `turnApproachM` 인자는 웹 훅이 같은 식으로 계산). 운전자 모드·도착 정차 판정·인계 버튼은 웹 비범위(웹 실시간 안내는 실보행 미검증 상태이고 자동차는 더 그렇다 — BACKLOG E4 웹 축). 웹 car 최종 접근은 종전 15m 도착 유지.

## 8. 서버 (`tmap-car.ts`)
§2.3. 스키마 스냅숏 테스트(`route-coord-schema`·`tmap-car.test.ts`)에 기하 모드 `action` 단언을 더한다. 실호출 게이트: `includeGeometry=1`로 자택→주택 B 경로를 받아 `action`이 turnType과 맞는지 1회 확인(출력은 spec 말미 §11에 코드·action 열만).

## 9. 판정 축 갱신 (`docs/BACKLOG.md` B1 · `docs/FIELD-TEST.md`)
B1 행을 이 설계 기준으로 다시 쓴다: ①임박 시간 축 5초(동승자)/8초(운전자)가 교차로 **앞**에서 들리는가, 너무 이르거나 늦으면 몇 초인가 ②바닥 15m가 서행에서 충분한가 ③도착 정차 판정(40m·정지) 오판 — 적신호 정차에서 도착 종이 났는가 ④지난 스텝 무발화 따라잡기 뒤 현재 유닛 전문이 맞는가(터널 구간) ⑤운전자 모드 스피커 발화가 백그라운드·잠금에서 이어지는가, 전문이 길지 않은가 ⑥동승자 모드 하단 2행 회전 접근 전환 시점 ⑦기존 5건(원거리 1.5km·도로명 문장 길이·거짓 재확보·상수·a11y 6건) ⑧uncertain 터널 공백 뒤 복귀 시점(관찰). `guidance-gate-drift` 진입점 표에 `acceptCarWalkHandoff`를 더한다.

## 10. 설계 리뷰 (codex adversarial-review, raw `codex exec` diff 주입, 2026-08-23)

BLOCKER 10·MAJOR 8·MINOR 3. 처리(지엽 패치가 아니라 계층 대조 뒤 판정):

| # | 지적 | 판정 |
|---|---|---|
| B1 | car `action` 부재가 문장 분류로 폴백 | **채택** — `actionSource` 프로파일(§3.1) |
| B2 | 131 중복(시계 방위 vs 톨게이트) | **채택(문서 오기)** — 공식 표로 130=토끼굴·131~142=시계 확정(§2.2) |
| B3 | 전문 선행 요구로 재획득 직후 큐 소실 | **채택** — car `imminentNeedsAnnounce=false`(§3.2) |
| B4 | vPrev=0·fix 공백 4.3초 | **부분 채택** — 표본 부재 임계 60m, 표본 상한 50m. lag는 p50·p90 모두 1.0초라 1초 유지(p99 4.3초는 터널 계열이라 시간 축이 답이 아니다). 타이머 예약은 기각(리듀서 순수성 계약) |
| B5 | catch-up이 jumped·isOff 투영을 신뢰 | **채택** — 점프 fix 무발화(J 게이트), `!isOff`(§3.4) |
| B6 | 묶음 일부 통과 시 지난 회전 전문 | **채택** — 끝난 스텝 제외(§3.4 ③) |
| B7 | 불확실 통과 경유지의 늦은 도착 발화 | **기각** — 재획득 뒤 첫 신뢰 fix에서 도착이 확정돼 최종 접근 영구 차단은 성립하지 않는다(늦은 "경유지 도착"은 참인 정보). `waypointPassUncertain` 상태 신설은 N4 계약 변경이라 범위 밖, BACKLOG 관찰 |
| B8 | 운전자 필터가 판정 슬롯 소비 | **기각** — §6.2 근거 |
| B9 | 지연 closure 경합·오디오 세션 원복 | **부분 채택** — `DeferredAnnouncer`는 단일 슬롯 latest-wins라 낡은 closure가 없다(기존 계약). 도착 발화의 세션 원복 경합만 채택(§6.4 유예) |
| B10 | `stop()` 뒤 `arrivalSessionKind` 기록 | **채택** — `stop()` 앞 기록 + `outputProfile`(§6.4) |
| M1 | 10초 평균의 가속·감속 왜곡 | **기각(잠정)** — `max(lastSeg, median)`는 늦는 쪽을 막는 보수 추정이고, 이른 명령은 "잠시 후" 틀이 흡수한다. B1 실주행 축 ①로 판정 |
| M2 | `rem≥0`·정확도 | **기각** — 회전 명령에 정확도 하한을 두면 정확도 20~30m가 흔한 도심에서 큐가 통째로 죽는다. 정확도 50m 초과는 이미 uncertain |
| M3·M4 | 도착 판정 오판 | **채택** — 15m 무조건 분기 삭제, 정확도 ≤30m 요구(§6.4) |
| M5 | 운전자 전문 길이 | **채택** — 운전자 announceSteps/farNotice 단문(§6.2) |
| M6 | 받아쓰기 중 안전 이벤트 | **기각** — 운전자는 받아쓰지 않고, 동승자 모드는 톤이 남는다(종전 도보 계약) |
| M7 | `announcedUpTo` 의미 분화 | **기각(근거 §3.4)** |
| M8 | 16~19 회전 의심 | **기각(공식 표)** — 어휘가 "좌회전/우회전" |
| m1 | §3.4 문장 부호 반대 | **채택** |
| m2 | fixture 기대값 세 가지 | **채택** |
| m3 | `M=null, S>0` 무효 조합 | **채택(테스트)** — 드리프트 테스트가 `imminentAheadM===null ⇒ imminentAheadS===0`을 단언 |

## 11. 검증 기록
(구현 뒤 채운다 — fixture 수·실호출 action 열·실험판 배포 SHA.)
