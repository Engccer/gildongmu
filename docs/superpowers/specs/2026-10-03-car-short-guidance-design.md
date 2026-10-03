# 자동차 짧은 안내에 지점과 방면 + 자동차 안전망 두절 15분 (2026-10-03, 세션 e61-car)

정본: `docs/BACKLOG.md` E61(위원장 판정 "지점과 방면 모두 싣는다")·E51 후속 ④(위원장 판정 "자동차만 15분")와 문안 확정본 `2026-10-03-guidance-wording-confirmed.md` 바·사·라(자동차 시작 문장). 문장은 확정본을 옮긴 것이고 여기서 새로 짓지 않는다.

설계 리뷰 판정: 적대적 설계 리뷰 생략. 새 불변식·상태 머신이 없고(리듀서 무수정), 서버 변경은 기하 옵트인 응답에 선택 필드 둘을 더하는 additive이며, 두절 축은 기존 판정 함수의 임계값을 수단별 데이터로 옮기는 것뿐이다. 리뷰는 구현 뒤 spec-compliance·code-quality·a11y 감사로 한다.

## 1. 서버: `at`·`toward` (additive)

- `rewriteCarGuidance`가 쓰는 Tmap 문형 분해(`FRAME`: [지점]에서 [방면] 방면으로 [행동] 후 [꼬리])를 **재작성 전 원문**에 한 번 더 적용해 `carLandmark(description)`이 `{ at?, toward? }`를 낸다. 문장(`guidance`)은 종전 그대로다.
- **기하 옵트인(`includeGeometry=1`) 응답의 guide에만** 싣는다. 미지정 응답은 byte 불변(스키마 스냅숏 유지). 진입점 `getCarRoute`가 `rewriteCarBriefing(b, { landmarks })`에 옵트인 여부를 기본값 없이 넘긴다.
- 이름 없는 일반명사 지점은 지점 없음: `교차로`·`분기점`·`고가차도`(코퍼스 212문장·10-03 실주행에서 이름 없이 단독으로 나온 셋). 문안 바 넷째 줄("이름 없이 '교차로'뿐")의 원리를 같은 종류 낱말에 적용한 것이다.
- 방면이 지점과 같으면(`일산IC에서 일산IC 방면으로`, `호원IC에서 호원IC 방면으로`) 방면을 뺀다. 같은 이름을 두 번 말하는 것이 정보가 없다.
- 문형이 맞지 않는 문장(출발·도착·카카오 폴백 조각형)은 필드 없음. 카카오 폴백은 기하 미지원이라 실시간 안내에 오지 않는다.
- en(NCP) 경로는 대상 밖: 기하 요청은 언제나 ko 서비스(Tmap)로 가고(라우트 `useNcp` 판정), NCP 응답엔 기하가 없다.

**하위 호환(코디네이터 판정 2)**: 스토어 2.0(`ef5f2330`)·1.19(`5c3bf9bf`)의 `CarRouteGuide.init(from:)`는 `CodingKeys`에 든 키만 읽어 새 키를 무시하고, 안드로이드 `KitJson`은 `ignoreUnknownKeys = true`다. 문장 필드가 바뀌지 않으므로 ⓐ 부분 문자열 판정 ⓑ 낭독 모두 종전과 같다. 옵트인 판본은 필요 없다. 앱이 새 필드에 의존하므로 웹 배포가 앱보다 먼저다(앱은 필드 부재 시 종전 문장).

## 2. 클라이언트: 경로 스텝에 싣는다

- `buildCarGuide`가 guide의 `at`·`toward`를 경로 스텝(`StepSpan`·`GuideStepSpan`, 세 벌)의 자동차 전용 선택 필드 `carLandmark`로 옮긴다. 경로와 수명이 같아 재조회·전환 커밋 자리를 고치지 않는다(스텝과 guide는 1:1).
- **비-ko 화면에서는 한글 이름을 뺀다**(`carSpokenLandmark`, 웹·Kit·`:kit` 미러 + 공유 fixture `car-landmark-cases.json`). 영어 문장 틀에 한글 이름을 넣지 않는 E28·A52 규칙과 같다. 결과적으로 비-ko는 종전 문장이 된다.

## 3. 문장

| 자리 | ko (확정본) | 키 |
|---|---|---|
| 임박, 지점+방면 | 잠시 후 광진교남단에서 천호 사거리 방면으로 우회전하세요 | `guide.carImminentAtToward` |
| 임박, 지점만 | 잠시 후 천호대교북단에서 왼쪽 길로 가세요 | `guide.carImminentAt` |
| 임박, 방면만 | 잠시 후 구리타워 방면으로 오른쪽 길로 가세요 | `guide.carImminentToward` |
| 임박, 둘 다 없음 | 잠시 후 우회전하세요 | `guide.carImminent.*`(종전) |
| 주기, 지점 있음 | 147m 직진하다가 광진교남단에서 우회전 | `guide.carPeriodicAt` |
| 주기, 지점 없음 | 147m 직진하다가 우회전 | `guide.carPeriodic` |
| 시작 | {목적지}까지 자동차 안내 시작. {첫 안내}. 안내 {N}개, 총 {거리}. | `guide.carStart`(플레이스홀더 순서 변경 → arg-order 갱신) |

- 임박 세 키의 `{action}`은 `guide.carLiveAction.*`(행동구 "우회전하세요")이고 주기의 `{command}`는 `guide.carCommand.*`다. 주기는 방면을 싣지 않는다(확정본 사).
- **운전자 모드는 종전 문장**: 운전자 예고(`driverNotice`)는 종전 `guide.carPeriodic` 문장("{distance} 앞 {command}")을 iOS 전용 키 `guide.carDriverNotice`(ios-extra)로 옮겨 쓴다. 운전자 임박(`carCommand`)도 그대로.
- 하단 2행 "잠시 후 {행동구}"(표시 잔여 0)는 바꾸지 않는다(범위 밖, 화면 표시). 임박 문장은 종전처럼 안내 시트 상태 문장 줄에도 그대로 놓이므로 그 줄에 지점·방면이 함께 보인다.
- 자동차 재조회 문장은 `e63-offroute` 몫이라 그대로다.
- 비-ko 로케일: 임박 세 키는 ko 구조를 따른다(en "Shortly, at {at}, {action} toward {toward}"). 주기 `carPeriodic`은 각 로케일의 종전 문장("Turn right in 147 m")이 이미 같은 뜻이라 두고, `carPeriodicAt`만 더한다(en "{command} at {at} in {distance}"). 시작 문장은 같은 재배열.

## 4. 자동차 안전망 두절 15분

- `GuideTuning`에 `sessionIdleNoFixSeconds`(웹 `sessionIdleNoFixS`)를 더한다: walk 300 · car 900 · carDriver 900. `sessionIdleStep`은 두절 임계를 **기본값 없는 인자**로 받고 전역 상수 `sessionIdleNoFixSeconds`/`SESSION_IDLE_NO_FIX_S`는 지운다(수단 갈림은 데이터로만, `sessionKind` switch 금지).
- 승차 전 도보(prewalk)는 안전망 자체가 걸리지 않는다(`maybeEndIdleSession`의 `prewalkTarget == nil` 가드, 종전 그대로). 나들이(`OutingModel`)는 `GuideTuning.walk`의 값을, 안드로이드 `WalkGuideModel`(도보뿐)은 자기 튜닝 값을 넘긴다(둘 다 종전 300 그대로).
- 무이동 축·도착 추정 유예(120초)는 그대로. 자동차 도착 추정 두절(120초)은 도착 창 안에서만 돌아 터널과 무관하다.
- 공유 fixture `session-idle-scenarios.json` 입력에 `noFixSeconds`를 더하고 car 900 사례를 넣는다.

## 5. 실주행 판정 축 (BACKLOG §2 자동차 표)

지점+방면 임박 문장이 회전 전에 끝나는가 · 6~10초 전 전문과 앞부분이 겹쳐 거슬리는가 · 첫 안내가 묶음("다음 안내. …")일 때 시작 문장의 요약이 묶음과 구분되어 들리는가 · 터널 5~15분 구간에서 안내가 끝나지 않는가.
