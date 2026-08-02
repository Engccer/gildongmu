# 도보 실시간 안내 실현 가능성 조사 (2026-08-02)

> 거리 추적(비콘)이 실보행 검증을 통과한 뒤 제기된 "직선거리만으로는 아쉽다, 실시간 길 안내가 되는가"에 대한 조사. 출처를 **[실측]**(이 조사에서 직접 호출·측정), **[공식]**(Apple·제공사 1차 문서), **[2차]**(논문·보도·사용자 기록)로 구분한다.

## 결론

**GPS 단독 자동 턴바이턴은 채택하지 않는다.** 기술적으로 불가능해서가 아니라, 이 앱의 사용자에게 **오안내의 대가가 크고 그 오안내가 구조적으로 발생**하기 때문이다. 근거 넷이 독립적으로 같은 곳을 가리킨다.

1. 턴바이턴이 요구하는 위치 정확도는 **1~3m**인데 도심 스마트폰 GPS 실측은 **7~13m**다. 한 자릿수 차이다. [2차]
2. 국내 도보 경로의 **21%가 25m 미만 구간**이고 하위 10%는 12m다. 안내 단위 자체가 GPS 오차보다 작다. [실측]
3. 같은 것을 GPS 단독으로 시도한 국내 앱이 시각장애 사용자 실사용에서 **실패로 판정**됐다. [2차]
4. **국내 3사 어디에도 보행자 턴바이턴 SDK가 없다.** 카카오내비 SDK·Tmap Navi SDK 모두 자동차 전용이다. [공식]

**대신 "경로 추종형 안내"를 채택 가능한 설계로 제시한다**(§5). 경로를 따라가며 다음 할 일을 알려 주되, 위치 확신도를 문장에 반영하고, 사용자가 언제든 수동으로 현재·다음 안내를 요청할 수 있게 한다.

---

## 1. 데이터는 이미 들어오고 있고, 우리가 버린다 [실측]

| 항목 | 결과 |
|---|---|
| 카카오 도보 스텝별 폴리라인 | `path.points`로 **매 스텝 제공** |
| Tmap 보행자 폴리라인 | LineString feature로 **제공** |
| 현재 처리 | 음향신호기 판정에 쓴 뒤 `src/lib/walk-route.ts`에서 **전량 삭제** |
| 스텝 이음매 간격 | **0.00m** (스텝 N의 끝점이 N+1의 시작점과 정확히 일치) |
| 폴리라인 길이 vs 선언 거리 | 오차 중앙 1%, 최대 11% |
| 경로 조회 지연 | 평균 77ms, 최대 152ms |

폴리라인 삭제 사유는 코드 주석상 "API 응답 스키마를 기존과 동일하게 유지"이고 법적·개인정보 근거가 아니다. 되돌리기 비용이 낮다.

이음매가 정확히 0m이므로 **전 경로를 하나의 연속 폴리라인으로 이어 누적 진행거리를 계산할 수 있다**. 실시간 안내에 필요한 기하 전제는 이미 충족돼 있다.

## 2. 진짜 제약은 안내 단위가 GPS보다 작다는 것 [실측]

세 경로(길동역→강동구청, 천호역→강동성심병원, 길동역→광화문) 109개 구간.

- **21%가 25m 미만**, 하위 10%가 12m, 중앙값 62m
- 경로가 자기 자신과 **12m까지 근접**한다(교차로를 되돌아 건너는 구간). 최근접점 매칭은 여기서 엉뚱한 스텝을 고른다
- 잡음 시뮬레이션(1.1m/s 보행, 1초 간격): σ=5m에서 스텝 오판 3%, **σ=10m에서 6%**, σ=20m에서 10% 초과

⚠ 이 시뮬레이션은 **낙관적**이다. 매 fix 독립 잡음을 가정했으나 실제 GPS 오차는 멀티패스로 수십 초간 한쪽에 치우친다.

이 결과는 외부 연구와 일치한다. NavCog(CMU)는 BLE 비콘으로 **1m대 정확도**를 확보하고도 6명 실험에서 76건 중 **missed turn 25건**을 겪었고, 저자 결론이 정확히 같은 지점을 짚는다: *"improving the localization accuracy in the proximity of decision points, such as turns or doors... In other areas, such as straight paths with no decision points, the current accuracy level is higher than needed."* [2차]

**직선 구간은 지금 정확도로 충분하고, 결정 지점만 부족하다.** 이것이 이 조사의 핵심 구조다.

## 3. 병합 방향이 설계를 가른다 [실측]

짧은 구간을 앞 구간에 흡수시키는 단순 병합은 이렇게 된다.

```
[604m] 농협입구교차로까지 577m 이동 → 횡단보도 이용 → 16m 이동
```

**횡단보도가 577m 직진 구간에 삼켜져 577m 미리 안내된다.** 시각장애 사용자에게 이는 안 알리는 것보다 나쁘다.

올바른 병합은 **짧은 구간끼리만 묶고 긴 구간은 독립으로 두는 것**이다.

```
 9. [구간 577m] 농협입구교차로까지 577m 이동(천호대로)
10. [군집  27m] 농협입구교차로에서 횡단보도 이용 + 16m 이동
11. [구간 593m] 자전거상설 할인매장까지 593m 이동(풍성로)
```

안내 발동 지점이 577m 간격이라 GPS로 충분히 가려진다. 카카오 안내문이 이미 순차 명령형이라 문장을 새로 만들 필요도 없다.

⚠ 군집화 후에도 **연속한 짧은 단위**는 남는다(임계 40m에서 단위 길이 하위 10%가 16m). 이 구간은 두 안내를 미리 합쳐 한 번에 전달해야 한다.

## 4. 선례: 성공한 앱은 둘 중 하나를 택했다 [2차]

### 4.1 GPS 단독 턴바이턴을 의도적으로 거부한 쪽

- **BlindSquare**: *"BlindSquare does not offer built-in spoken turn-by-turn navigation."* 대신 Apple Maps 등 일반 내비를 **백그라운드로 함께 돌리라**고 안내한다.
- **Microsoft Soundscape**: *"Unlike step-by-step navigation apps, Soundscape used 3D audio cues to enrich ambient awareness."*
- **GoodMaps Explore**: 실외는 방향·POI 낭독, 실내만 턴바이턴(LiDAR 측량 기반).

이 계열의 공통 패턴이 길동무 비콘과 같다. BlindSquare 공식 문서: *"announce your distance and direction to this place from time to time. The closer you are to the place, the more frequently BlindSquare will announce."* **거리에 반비례해 통지 빈도를 높이는 것**이 정석이다.

### 4.2 턴바이턴을 하되 보조 측위를 깐 쪽

- **NavCog**: BLE 비콘 지문, 실내 4~6m 간격 배치, 평균 오차 0.53m
- **StreetNav**: 가로 CCTV 활용, 발 위치 추정 오차 0.41m
- **GoodMaps**: LiDAR 측량 + 카메라 측위

### 4.3 GPS 단독으로 강행한 국내 사례의 결과

국내 시각장애인 보행 안내 앱 G-EYE에 대한 시각장애인 필자의 일주일 체험기(에이블뉴스 2022-08-08):

- *"방향을 잘못 알려주는 경우가 많다. 20번을 시도했더니 한번이 정확했다."*
- *"용산역에서 역내 카페를 가기 위해 검색을 하였더니 철로 안으로 안내를 하였다."* / *"도중에 재설정하라고 하여 방향을 정하니 도로 중앙으로 안내했다. 목숨이 위험할 수 있으니 이 앱에 손해배상보험 가입을 해 주었으면 한다."*
- *"10분이면 갈 수 있는 거리를 4시간 동안 거리를 헤매고도 도착하지 못했다."*
- *"보행자에게는 100미터 오차, 특히 시각장애인에게는 100미터의 오차는 오히려 혼란을 줄 것이다."*

**같은 필자가 직선거리의 한계도 정확히 지적한다**: *"이 정보는 직선거리로 얼마나 떨어져 있는지는 알 수 있지만 경로를 알려주지는 않는다."* 이번 요청의 문제의식과 동일하다. **문제 인식은 옳고, 그 해법으로 GPS 단독 턴바이턴을 고른 앱이 실패했다는 것이 이 절의 요지다.**

⚠ 위 평가는 2022-08 시점 기준이며 이후 개선 여부는 미확인이다.

## 5. 채택 가능한 설계: 경로 추종형 안내

턴바이턴의 실패는 **"내 위치로 안내를 자동 결정한다"**는 전제에서 나온다. 그 전제만 걷어내면 나머지는 살릴 수 있다.

### 5.1 구성

1. **폴리라인 보존**: 응답에서 스텝 좌표를 버리지 않는다. 웹·iOS·CLI 스키마에 스텝 끝점(또는 폴리라인)을 추가한다.
2. **진행거리 추적**: 전 경로 연속 폴리라인에 현재 위치를 투영해 누적 진행거리를 구한다(최근접점이 아니라 직전 진행거리 부근으로 구속).
3. **비콘 타깃을 목적지에서 "현재 단위의 끝"으로 바꾼다.** 검증 완료된 `beaconStep`·`beaconGateStep`·톤·데드밴드를 그대로 재사용한다. 남은 거리와 접근·이탈 톤이 그대로 성립한다.
4. **군집화**(§3): 짧은 구간끼리 묶고 긴 구간은 독립. 연속 짧은 단위는 안내를 미리 합쳐 전달.
5. **수동 진행 상시 제공**: "지금 안내 다시", "다음 단계"를 언제든 요청할 수 있게 한다. **GPS가 틀려도 치명적이지 않게 만드는 안전판이며, 이것이 있어야 §4.3의 실패와 갈린다.**
6. **이탈 시 자동 재조회 금지**: 이탈 가능성을 알리고 재조회는 사용자 확인 후. 근거는 쿼터(§6)와, 자동 재설정이 도로 중앙 안내로 이어진 실패 기록(§4.3)이다.

### 5.2 확신도를 문장에 반영한다 (Soundscape 패턴)

Soundscape는 정확도가 나빠도 **침묵하지 않고 문장의 확신도를 낮춘다**. 공식 문서와 코드에서 확인되는 임계값이다. [공식]

| 조건 | 발화 |
|---|---|
| 거리 ≤ 15m | "close by" (수치 없음) |
| 정확도 ≤ ±10m | 거리 수치 그대로 |
| 정확도 ≤ ±20m | "**about** [거리]" |
| 정확도 > ±20m | "**around** [거리]" |
| 거리 ≥ 200m | 정확도 무시(상대 오차가 작음) |

이 패턴은 이 저장소의 **3-state 정직성 원칙과 같은 정신**이다. "약 200m"와 "200m"를 구분해 말하는 것이 곧 확신도 전달이다. 한국어로는 "200m", "약 200m", "200m쯤"의 3단으로 옮길 수 있다.

Soundscape 교차로 통지 게이트도 참고치로 유효하다. 최대 거리 25m, 진행 방향 ±60도 이내, 같은 교차로 30초 재통지 금지, 5m 이동 + 5초 경과 스로틀. [공식]

### 5.3 방위는 course를 쓰고 heading은 쓰지 않는다

Soundscape의 교차로 판정도 나침반이 아니라 **진행 방향(course)** 기준이다. `CLHeading`은 Apple 문서가 인정하는 실패 모드가 둘(미캘리브레이션, 국소 자기장 간섭)이고, 캘리브레이션은 *"able to filter out only those magnetic fields that move with the device"*라 외부 간섭원을 못 거른다. [공식] 비콘 설계가 이미 "기기 heading은 보행 중 신뢰도가 낮다"로 방위 안내를 범위 밖에 둔 판단과 일치한다.

## 6. 제약

| 제약 | 내용 |
|---|---|
| 카카오 쿼터 | 일 1,000건. 초과는 **429 차단이지 과금이 아니다**(유료 설정 미신청 시). ⚠ 무료 쿼터는 **개발자 계정의 첫 활성화 앱에만** 붙으므로 dodo-planet과 키를 공유하는 현 구조에서 실제 쿼터 보유 여부는 콘솔 확인 필요 |
| 자체 레이트리밋 | `/api/route/walk` 60초 10회 |
| 백그라운드 위치 | 현재 `UIBackgroundModes` 미선언 |
| 약관 | §8 |

### 6.1 백그라운드 위치의 전제가 하나 틀렸다 [공식]

비콘 설계(`2026-08-01-ios-distance-beacon-design.md` §8.1)는 전경 전용을 택하며 그 비용으로 *"`UIBackgroundModes` + 항상 허용 권한이 필요"*를 들었다. **"항상 허용"은 필요 없다.** Apple 문서 원문: `CLBackgroundActivitySession`은 *"allows a when-in-use authorized app to receive location updates"*이고, `allowsBackgroundLocationUpdates`도 전경에서 시작하면 백그라운드 진입 후 업데이트가 계속된다.

필요한 것은 `UIBackgroundModes: location` + 전경에서 시작뿐이다. 다만 When In Use 권한에서는 **파란 표시줄을 앱이 끌 수 없다**(끄는 것이 가능한 쪽이 오히려 Always다).

전경 전용 결정 자체는 유효할 수 있으나 **근거 하나가 사실이 아니었으므로 재검토 시 이 문서를 근거로 삼는다.**

## 7. Apple MKDirections: 한국 도보 경로를 준다 [실측]

이 저장소는 Google Routes가 한국 도보·자동차 경로를 주지 않음을 실측으로 확정한 바 있다. **Apple은 다르다.** 이 조사에서 macOS 명령행 도구로 MapKit을 직접 호출해 독립 확인했다.

- 길동역→강동구청 `.walking`이 **2,488m / 11스텝 / 폴리라인 34점**으로 정상 응답(부산·강남 구간도 동일).
- 사용자 언어 설정에 따라 지시문이 한국어로 온다("양재대로116길(으)로 우회전"). ⚠ 조사 처리가 미흡해 `(으)로`가 리터럴로 낭독된다.
- Apple 공식 기능 제공표의 "지도: 턴 바이 턴 내비게이션" 111개국에 **대한민국이 포함**된다. [공식]

**그러나 우리 용도로는 카카오가 우월하다.** 같은 구간 대조:

| | 카카오 | Apple |
|---|---|---|
| 폴리라인 밀도 | 67점 / 2,677m | 34점 / 2,488m |
| 지시문 성격 | 랜드마크 + 도로명 | 도로명 회전만 |
| 횡단보도 언급 | **있음** | **없음** |
| 계단·지하보도 | 있음 | 없음 |

시각장애 사용자에게 가장 중요한 정보가 Apple 쪽에 빠져 있고, 이는 지도 데이터 반출 규제에 따른 구조적 공백으로 보도된 내용과 일치한다.

→ **역할 배정**: 낭독 정본은 카카오 유지. MKDirections는 쿼터 소진·장애 시의 폴백 후보이자 **약관 부담이 없는 선택지**로 기록한다.

## 8. 약관 [공식]

### 8.1 "자체 내비게이션 금지" 조항은 어디에도 없다

카카오·Tmap·NCP 약관 전수 확인 결과 **"내비게이션"이라는 단어 자체가 등장하지 않는다.** 실질 제약은 전부 **데이터 저장·캐시** 쪽에 걸려 있다.

| 사업자 | 저장 관련 문언 | 세션 유지 여지 |
|---|---|---|
| **Tmap** | "저장 후 **24시간 이상** 사용할 수 없습니다" | 문언상 세션 유지 무해 (가장 관대) |
| **카카오** | 운영정책: "사용자 환경을 개선하기 위한 목적 **외** 다른 목적으로 캐시" 금지 | 회색지대 (§8.2) |
| **NCP** | 제7조 ⑪ "값을 리턴 받는 **즉시 1회**만 허용" (가장 엄격) | 도보 경로 자체가 없어 무관 |

### 8.2 카카오 캐시 해석이 시점에 따라 갈린다

같은 조항에 대한 담당자 답변이 상충한다.

- 2024-10: *"아주 짧은 시간 단위의 캐싱이라면 가능합니다. 아무리 길게 보아도 1~2시간을 넘지 않아야 할 것"*
- 2026-07-23: Next.js `revalidate 3600`에 대해 *"사실 임시 DB 역할로 볼 수 있는데요. 이는 운영 정책에 위반한 것으로 허용되지 않으며, 실시간 호출로만 이용 가능합니다"*

**최신 답변이 더 엄격하다.** 다만 두 답변 모두 **로컬(검색) API 문맥**이고 도보 경로 API 전용 유권해석은 존재하지 않는다.

⚠ **별건 과제**: 현재 운영 코드가 카카오 응답에 `revalidate`를 쓴다(`kakao-address` 4곳 3600, `kakao-walk` 3600, `kakao-local` 300). 최신 유권해석 기준으로는 회색지대이고, 이는 실시간 안내와 **무관하게 이미 존재하는 사안**이다. 이 조사에서 부수적으로 드러났으므로 별도 항목으로 분리해 기록한다.

**한 번의 안내 세션 동안 경로를 메모리에 유지하는 것이 "저장"인지에 대한 유권해석은 어느 사업자에도 없다.** 확정하려면 직접 질의해야 한다.

### 8.3 도보 턴바이턴 SDK는 국내에 없다

| SDK | iOS | 도보 |
|---|---|---|
| 카카오내비 SDK | 지원 | **미지원**(자동차 3종 모드뿐) |
| Tmap Navi SDK | 지원 | **미지원**(`startDriving`, `CarOption` 등 자동차 API) |

카카오모빌리티 **제휴 API**에 도보 길찾기가 별도로 존재하나 *"사전에 제휴 계약이 필요"*하다. **직접 관련 선례**: 2025-11-24 시각장애인 보행 지원 앱이 도보 Directions + Navigation 권한을 신청했고(비상업·연구 목적 명시), 담당자 회신은 *"제휴가 필요한 내용으로 보이며 제휴 문의로 요청해 주시면 됩니다"*였다.

→ **정식 도보 TBT를 하려면 제휴 계약이 경로다.** 이는 비용·계약 사안이므로 착수 전 위원장 판단이 필요하다.

## 9. 별건: 현재 위치 정확도 결함 5건 [실측 + 공식]

실시간 안내와 **독립적으로** 고칠 가치가 있다. "내 주변"의 정확도가 곧 사용자가 걸어갈 곳을 정하기 때문이다.

| # | 위치 | 내용 |
|---|---|---|
| A1 | `LocationService.swift` 단발 취득 | 목표 정확도가 `kCLLocationAccuracyHundredMeters`. 새로고침일 때만 `Best` |
| A2 | `didUpdateLocations` | 반환 fix의 accuracy·timestamp 미검사. **비콘 경로에는 신선도 게이트가 있는데 단발 경로에는 없어 같은 저장소 안에서 계약이 갈린다** |
| A3 | 캐시 | TTL 없음. 한 번 잡히면 세션 내내 재사용하므로 이동해도 옛 좌표 |
| A4 | 전역 | `accuracyAuthorization` 미검사 |
| A5 | `project.pbxproj` | `NSLocationTemporaryUsageDescriptionDictionary` 없음 |

### 9.1 왜 이것이 생각보다 심각한가 [공식]

- **`horizontalAccuracy`는 "그 안에 있다"가 아니다.** Apple 엔지니어 답변: 2D RMS이며 *"a circle... contains the true latitude and longitude somewhere between roughly **63.2% and 68.3%** of the time"*. 즉 100m는 **약 3분의 1 확률로 100m 밖**이고 5%는 173m 밖이다.
- **`desiredAccuracy`는 계약이 아니라 희망값이다.** `requestLocation()` 문서: *"If obtaining the desired accuracy would take too long, the location manager delivers a **less accurate** location value rather than reporting an error."*
- **첫 콜백은 캐시일 수 있다.** Apple 자신의 가이드가 **15초 신선도 검사**를 예제로 제시하며 *"If you are implementing a navigation app, you might want to lower the threshold"*라고 덧붙인다.
- **A4가 가장 심각하다.** 사용자가 "정확한 위치"를 끄면 좌표가 *"usually within **1–20 kilometers**"*가 되고 갱신은 시간당 몇 회로 줄며 **`desiredAccuracy` 변경이 무효**가 된다. 화면으로 확인할 수 없는 사용자에게 "정확한 좌표 / 근사 좌표 / 실패"가 한 상태로 뭉개진다. 3-state 불변식 위반이다.

### 9.2 실증 [실측]

같은 자리에서 100m만 어긋나면 1순위 정류소가 완전히 바뀐다.

```
기준점       → 1. 길동역1번출구 188m
북쪽 100m    → 1. 천동초교입구사거리 114m   (길동역1번출구는 3위 밖)
동쪽 100m    → 1. 천동초교입구사거리 253m
```

### 9.3 해법의 방향 (오해 방지)

- ⚠ **`kCLLocationAccuracyBestForNavigation`이 답이 아니다.** Apple 문서가 *"use this level of accuracy only while the device is plugged in"*이라 상시 사용을 권하지 않는다.
- ⚠ **이중 주파수 GPS(L1+L5) 기종도 답이 아니다.** 시각장애인 커뮤니티 AppleVis가 iPhone 14 Pro와 14를 보행 내비 관점에서 비교한 결론: *"Don't buy an iPhone 14 Pro... on the basis that you think that it will enable apps such as Microsoft Soundscape to be more accurate."* 차이는 대체로 1~5m 수준이었다. [2차, 본문 접근 차단으로 간접 인용]
- **실효 있는 개선은 목표 정확도를 올리는 것이 아니라 반환 fix를 검사하는 것이다.** 여러 fix를 받아 정확도 임계값과 신선도를 **둘 다** 만족하면 정지하고, 타임아웃이면 최선값을 상태 플래그와 함께 반환한다(`INTULocationManager` 관행: 등급별 임계값 + 타임아웃 쌍).
- `requestTemporaryFullAccuracyAuthorization(withPurposeKey:)`는 **전경 사용 중 만료가 유예**되어 *"fitness and navigation apps"*를 위해 설계됐다. A5가 그 전제다.

---

## 부록: 출처

**[공식]**
- Soundscape 교차로 로직·통지 설계·정확도 임계값: `github.com/microsoft/soundscape` (`docs/ios-client/components/intersections-callout-logic.md`, `callout-designs.md`, `apps/ios/GuideDogs/Code/Language/LanguageFormatter.swift`)
- CoreLocation: `requestLocation()`, `desiredAccuracy`, `horizontalAccuracy`, `accuracyAuthorization`, `kCLLocationAccuracyReduced`, `requestTemporaryFullAccuracyAuthorization`, `CLBackgroundActivitySession`, `allowsBackgroundLocationUpdates`, `CLHeading`, `CLLocation.course`
- Apple 개발자 포럼 thread 699996 (`horizontalAccuracy`의 통계적 정의, Apple Staff 답변)
- Location Awareness Programming Guide (아카이브, 15초 신선도 규칙) · Energy Efficiency Guide for iOS Apps
- MapKit: `MKDirections`, `MKRoute.Step.instructions`, `MKError.Code.loadingThrottled`
- Apple 기능 제공 여부(한국): `apple.com/kr/ios/feature-availability/`
- 카카오: [운영정책](https://developers.kakao.com/terms/ko/site-policies) · [이용약관](https://developers.kakao.com/terms/ko/site-terms) · [쿼터](https://developers.kakao.com/docs/latest/ko/getting-started/quota) · [캐싱 질의 2026-07](https://devtalk.kakao.com/t/api/150800) · [캐싱 질의 2024-10](https://devtalk.kakao.com/t/api/140197) · [DB 저장 질의](https://devtalk.kakao.com/t/api-db/150560) · [도보 권한 신청 선례](https://devtalk.kakao.com/t/directions-api-navigation-api/147260) · [카카오모빌리티 제휴 API](https://developers.kakaomobility.com/affiliate/)
- Tmap: [API 약관](https://tmapapi.tmapmobility.com/terms.html) · [요금표](https://openapi.sk.com/products/calc?svcSeq=4&menuSeq=5)
- NCP: [Directions 5 가이드](https://guide.ncloud-docs.com/docs/maps-direction5-api) · Maps 서비스 이용약관(2025-03-20 시행)
- BlindSquare 사용자 가이드·FAQ: `blindsquare.com`

**[2차]**
- NavCog(CMU): `cs.cmu.edu/~kkitani/pdf/AGKITA-MHCI16.pdf`
- StreetNav: `arxiv.org/html/2310.00491`
- Merry K, Bettinger P (2019), PLoS ONE 14(7): e0219890 (도심 스마트폰 GPS 오차 7~13m)
- G-EYE 시각장애인 체험기, 에이블뉴스 2022-08-08: `ablenews.co.kr/news/articleView.html?idxno=99521`
- Korea Herald, 한국 지도 반출 규제와 도보 안내 공백: `koreaherald.com/article/10487791`
- AppleVis, 이중 주파수 GPS 보행 내비 비교 (본문 접근 차단, 간접 인용)

⚠ Clemenson et al.(2021)의 "오디오 비콘이 턴바이턴보다 공간 인지에 유리" 연구는 **인용하지 않는다.** 참가자 전원이 정안인이었고 턴바이턴 조건이 앱이 아니라 실험자 구두 안내였다. 시각장애 사용자로 일반화된 근거가 아니다.

**[실측] 재현 절차**: 카카오 도보 API를 `KAKAO_REST_API_KEY`로 직접 호출해 `route.legs[].steps[].properties.distance`와 `path.points`를 집계. MKDirections는 macOS 명령행 도구로 `transportType = .walking` 직접 호출(⚠ 완료 핸들러가 메인 스레드 실행이라 세마포어 대기는 교착한다. `RunLoop`을 돌릴 것). 좌표는 길동역(37.5384, 127.1420), 강동구청(37.5301, 127.1237), 천호역(37.5385, 127.1237), 강동성심병원(37.5476, 127.1330), 광화문(37.5759, 126.9769).
