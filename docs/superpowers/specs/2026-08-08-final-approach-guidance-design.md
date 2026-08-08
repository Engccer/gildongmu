# 최종 접근 안내 설계 (마지막 몇 미터)

> 2026-08-08. 위원장이 실험판으로 도보 실시간 안내를 실보행하고 준 피드백 중 **"마지막 15미터에 안내가 없다"**를 닫는다. 백로그 `docs/BACKLOG.md` §F-a "실시간 길 안내(E4) 최종 판정 3묶음 ①실보행 완주 — 상수 튜닝(40m·50m·주기) 판정"이 이 spec으로 소비된다. 관련 항구 규칙은 `CLAUDE.md`의 "도보 경로"·"3-state 불변식" 행, `docs/INTEGRATIONS.md` §실시간 길 안내, 접근성 헌장 §1·§5.
>
> 같은 실보행에서 나온 **주기 통지 중복 낭독**은 위원장 판정으로 이 spec에서 분리해 백로그 §A5로 보냈다(2026-08-08). 두 사안은 원인이 같지만("리듀서가 말할 값이 있는지 보지 않고 말할 시각인지만 본다") 신규 설계 판정과 기존 결함 수정을 한 리뷰에 섞지 않는다.

## 1. 문제

> "목적지에 근접했을 때 '직선거리로 전환합니다'라는 메시지가 뜨면서 별다른 안내를 하지 않아. 그런데 사실 도보 안내를 받다 보면 마지막 15미터가 가장 중요하거든. 목적지가 진행 경로에서 정면에 있는지, 좌측에 있는지, 우측에 있는지, 바로 옆에는 어떤 건물이 있는지 등." (위원장 2026-08-08)

### 1.1 실재 확인 (코드 대조)

`handoff` 이후 사용자가 듣는 것은 셋뿐이다.

| 순서 | 발화 | 조건 |
|---|---|---|
| 1 | `guide.handoff` "목적지까지 직선 안내로 전환합니다" | 경로 잔여 ≤ 50m ∧ 전 스텝 낭독 완료 |
| 2 | `beacon.first` "목적지까지 약 {거리}" | `rebaseForAxisChange` 후 첫 수용 fix |
| 3 | `beacon.nearby` "목적지 근처 (약 ±{n}m)" | 직선거리 ≤ `max(20, accuracy)`, **존당 1회 래치** |

그 사이는 **음성 0**이다. `closerSpeakInterval(distance)`가 300m 이하에서 **100m**를 반환하므로(`beacon.ts`), 50m→20m 구간에서 마일스톤을 넘길 수 없다. `nearby` 진입 후에는 `kind: "hold", speak: false`로 완전 침묵하고, 톤도 `BeaconGate`의 `nearbyToneDone` 래치로 존당 1회다.

정확도가 나쁘면 `arrivalThreshold = max(20, accuracy)`가 커지므로 **침묵 구간이 20m 이상으로 넓어진다.** GPS가 나쁠수록 안내가 줄어든다.

조사가 정리한 안티패턴 9종 중 1번이 정확히 이 상태다: **"도착 존에서 한 번 알리고 침묵"**.

### 1.2 실측이 뒤집은 전제 — 경로는 목적지까지 가지 않는다

**카카오 도보 경로는 목적지 좌표가 아니라 가장 가까운 보행로 지점에서 끝난다.** 프로덕션 실호출 4건:

| 목적지 | 종점→목적지 | 진행 방향 기준 상대각 (종점 직전 40m 평균) |
|---|---|---|
| 강동구청 | 16.1m | −99° |
| 강동성심병원 | 31.0m | −60° |
| 이마트 명일점 | 48.6m | +46° |
| 서울길동초등학교 | 89.4m | −72° |

**함의 셋.**

1. `handoff` 임계 50m는 **경로 잔여** 기준이므로, 그 시점의 실제 목적지까지 직선거리는 50~130m다. "마지막 15m"는 그보다 뒤에 온다.
2. 서울길동초등학교처럼 오프셋이 89m면 **경로를 완주해도 목적지까지 89m가 남는다.**
3. **이 오프셋의 거리와 방향은 경로 수신 시점에 결정론적으로 계산된다.** GPS도 나침반도 필요 없다. 이것이 §3의 토대다.

⚠ 부수 발견: `kakao-walk.ts:130`이 목적지 좌표를 `roundCoord(dest.lng, 4)`로 반올림해 보낸다(±5.5m). `coord-round.ts`의 판단 기준이 "반올림 오차가 결과를 못 바꾸는 곳에만 쓴다"인데, **최종 접근 안내를 도입하면 그 전제가 깨진다**(§3.1 참조).

## 2. 조사 근거

네 갈래 조사(선행 앱·학술 문헌·방위 관례·국내 데이터)의 결론 중 **설계를 바꾼 것만** 옮긴다. **조사 원자료는 `docs/research/RESEARCH-2026-08-08-last-few-meters.md`**(여기 인용하지 않은 것 — Wayfindr 어휘 목록·안티패턴 9종·상용 앱 방향 규약 비교·OSM 지역별 실측·확인 못 한 항목 — 이 그 문서에 있다. §9가 "반영하지 않은 것"과 그 근거를 따로 적어 둔다).

### 2.1 문제가 학술 정본이다

Saha, Fiannaca, Kneisel, Cutrell, Morris (2019), "Closing the Gap: Designing for the Last-Few-Meters Wayfinding Problem for People with Visual Impairments", ASSETS '19. https://doi.org/10.1145/3308561.3353776

> "smartphone GPS can guide a user to the vicinity of their destination, but not to the precise location (e.g., to the front of a building, but not to the actual door)."

맹인 22명 실측에서 가장 어려운 것이 **의도한 출입문 찾기**(11명)였고, 대처법으로 "완전히 포기"를 든 사람이 2명이다.

### 2.2 인계 조건이 우리와 같은 상용 선례 — Sendero "Getting Warmer"

https://senderogroup.com/products/RNIBGPS/RNIBGPSUserGuide.htm

> "the Getting Warmer function takes over once you are near your destination **just in case it is a sizable distance off the street**"
> "It is also used when **a route with turns ends short of the destination** so you have some indication of where that destination is located in the final short distance."
> "you will hear the distance and compass direction to your destination **every 15 seconds**" (모드 상한 2분)

도착 임계 선택지가 미터 단위로 **15m / 25m / 30m**다. 위원장이 말한 "마지막 15미터"가 이 제품의 첫 선택지와 같다.

### 2.3 Soundscape 오픈소스 실측 상수 (MIT, 코드 직접 확인)

https://github.com/soundscape-community/soundscape

| 상수 | 값 |
|---|---|
| `enterImmediateVicinityDistance` | 15.0 m |
| `leaveImmediateVicinityDistance` | 30.0 m (히스테리시스) |
| `closeByDistance` | 15.0 m — **이 미만은 수치를 말하지 않는다** |
| `goodAccuracy` / `averageAccuracy` | 10 m / 20 m (헤지 부사 경계) |
| course 게이트 | 모션 "이동 중" ∧ `speed ≥ 0.4 m/s` ∧ **3초 워치독** → 만료 시 `nil` |

FAQ 원문:
> "since Location Services is only accurate to about 10 meters, we cannot guarantee the behavior of the beacon when you are within a few meters of your destination."
> "When Soundscape is uncertain about which way you are facing, **it lowers the volume of the beacon.**"

**방향 미상을 말이 아니라 볼륨으로 알린다.** 그리고 상대 방향은 8버킷(정면·좌우 각 30°, 대각 각 60°)이며 **시계 방향을 쓰지 않는다.**

### 2.4 표준 — 도착 안내는 "도착했습니다"가 아니다

Wayfindr Open Standard(ITU-T F.921 모체, 2018-08 승인). https://www.wayfindr.net/open-standard/designing-for-vision-impaired-people/different-types-of-navigation-instructions

> "Route endings are instructions that inform users that they have reached their destination... **This instruction can include information about the physical layout of the destination in order to help vision impaired people make better sense of the space and position themselves in relation to other objects.**"

예시 문형: "You are now at the platform. **The platform edge is on your left.**" — 현재 위치 확정 + 몸 기준 상대 배치, **거리 수치 없음**.

### 2.5 랜드마크는 "검증 가능한 것"이어야 한다

Padmanaban & Krukar (2017), "Increasing the Density of Local Landmarks in Wayfinding Instructions for the Visually Impaired". https://doi.org/10.1007/978-3-319-47289-8_7

랜드마크를 늘려도 주관적 복잡도가 오르지 않았으나 저자가 조건을 명시한다:

> "**the key to useful local landmark selection is in understanding which spatial objects would be detected by the blind navigator spontaneously** over the course of regular locomotion."

지팡이 감지 가능 응답(10명): 출입구 10/10 · 음향신호기 10/10 · 노면 재질 10/10 · 점자블록 10/10 · 난간 8/10 · **쉘터 없는 정류장 0/10**.

→ **카카오 POI 이름(카페·은행 상호)은 간판이라 검증 수단이 없다.** 우리가 이미 가진 `walk-infra`(음향신호기 seed + Overpass 횡단보도·점자블록)가 문헌이 말하는 랜드마크다.

### 2.6 가까울수록 발화를 줄여야 한다 (요청과 충돌 → §3.2에서 해소)

Loomis, Marston, Golledge, Klatzky (2005), JVIB. https://pmc.ncbi.nlm.nih.gov/articles/PMC2801896/ — 음성 안내가 환경음을 **occlusion**과 **perceptual masking** 두 경로로 덮는다. Wayfindr도 같은 원칙("less is more", "as few distractions as possible")을 명시한다.

마지막 구간이야말로 소리·바람·냄새 랜드마크의 구간이므로, 그때 말을 늘리면 **앱이 자기 안내로 사용자의 랜드마크를 지운다.**

### 2.7 시계 방향은 쓰지 않는다

- Wayfindr 트라이얼: "many reported that it is difficult to distinguish between 1 and 2 o'clock... **clock faces should be used to communicate the general direction**" (정밀 지시에서 격하)
- Ahmetovic, Oh, Mascetti, Asakawa (2018), ASSETS '18, 시각장애인 11명·회전 286회 로그: **평균 실행 오차 14.9°**(SD 9.9). 90° 교차로 성공률 88.3% 대 45° 교차로 73.0%. https://doi.org/10.1145/3234695.3236363
- 시계 12분할의 허용 오차는 ±15°라 신체 오차만으로 잠긴다.
- 한국어 1차 자료에서 시계 방향의 서식지는 **식탁 안내**이고, 보행 안내는 좌/우/앞/뒤다.

위원장 요청도 "정면인지, 좌측인지, 우측인지"였다. **세 근거가 같은 곳을 가리킨다.**

### 2.8 `horizontalAccuracy`는 거짓말을 한다

Ren, Lam, Manduchi, Mirzaei (2023), "Experiments with RouteNav", ASSETS '23. https://pmc.ncbi.nlm.nih.gov/articles/PMC10691587/

> "**in the example to the right the uncertainty radius is small (5.4 m) in spite of the very large error (36.5 m)**"
> "**The distance to the next tile is expressed only as more/less than 10 meters. Using higher resolution would not be advisable given possible localization errors.**"

우리 데드밴드와 `confidenceDistance`가 이 값을 신뢰해 스케일한다. 최종 구간 판정을 GPS가 아니라 **경로 기하**에 거는 근거가 하나 더 생겼다.

## 3. 설계

`handoff` 이후를 침묵에서 주기 루프로 바꾼다. Sendero "Getting Warmer"의 구조를 따르되 상수는 §5에서 위원장 판정을 받는다.

### 3.1 종점 오프셋 기하 (GPS 무관, 정적)

서버가 도보 경로 응답에 `finalApproach`를 싣는다.

```ts
interface FinalApproach {
  /** 경로 종점 → 목적지 직선거리(m). 반올림 전 원값. */
  offsetMeters: number;
  /** 종점 직전 진행 방위 대비 목적지 상대각(-180~180, +우 -좌). */
  relativeBearing: number;
  /** 기준으로 삼은 마지막 도로명(있으면). 문장의 "…를 따라 온 방향에서"에 쓴다. */
  roadName?: string;
}
```

**진행 방위는 종점 직전 15m 구간의 평균**으로 잡는다. 마지막 세그먼트 하나만 쓰면 짧은 꼬리에 흔들린다(실측: 강동구청 −64° vs −99°, 성심병원 −96° vs −60°로 판정이 갈렸다). 15m는 Soundscape `closeByDistance`와 같은 값이고, 사용자가 종점에서 향하고 있을 방향의 근사로 타당하다.

**오프셋이 작으면 방향을 주장하지 않는다.** `offsetMeters < 10`이면 `relativeBearing`을 **생략**한다(3-state). 근거: `roundCoord(…, 4)`의 좌표 반올림만으로 ±5.5m가 실리고, 그 규모에서 방위는 뒤집힐 수 있다.

⚠ **`kakao-walk.ts`·`tmap-pedestrian.ts`의 목적지 좌표 반올림을 최종 접근 계산에 쓰지 않는다.** `finalApproach`는 **요청받은 원좌표**로 계산한다. provider에 보내는 값만 반올림된 채로 두면 캐시 히트율은 유지되고 우리 계산은 정확해진다.

### 3.2 진입 1회 배치 서술 — 요청과 문헌의 충돌을 여기서 해소한다

§2.6(가까울수록 줄여라)과 위원장 요청(마지막 15m에 더 상세히)은 정면으로 부딪힌다. **해소는 양이 아니라 시점이다.**

`handoff` 시점(경로 잔여 50m, 즉 **최종 구간에 들어가기 전**)에 현행 `guide.handoff` 한 문장을 배치 서술로 교체한다.

```
현행:  목적지까지 직선 안내로 전환합니다
신규:  성내로를 따라 온 방향에서 강동구청은 왼쪽 약 16미터입니다.
```

세 가지가 이 문장에 들어간다.

1. **기준**("…를 따라 온 방향에서") — 방향을 절대적으로 주장하지 않는다. 사용자가 그 사이 몸을 돌렸어도 스스로 보정할 수 있다. Wayfindr가 랜드마크 기준 표현을 권하는 이유와 같다.
2. **상대 방향** — 4분할(정면 / 왼쪽 / 오른쪽 / 뒤). §2.7의 오차 예산상 ±45°가 안전 구간이다.
3. **거리** — §3.5의 정직 사다리를 통과한 값.

`roadName`이 없으면 기준절을 생략한다(문장을 지어내지 않는다).

**이 문장은 세션당 1회다.** 반복하지 않는다.

### 3.3 주기 루프

진입 서술 뒤, 최종 접근 구간에서 **15초 주기 · 상한 2분**의 거리+방향 통지를 켠다(Sendero 실사양).

- 상한 도달 시 루프를 끄고 톤만 남긴다. 위원장이 목적지를 못 찾은 채 계속 걸으면 무한 발화가 되는 것을 막는다.
- 사용자가 존을 벗어나면(히스테리시스 `leave`) 루프를 끄고, 재진입 시 다시 켠다.
- **문장은 짧다**: "{방향} 약 {거리}" 또는 방향 미상이면 "{거리}". 배치 서술은 §3.2에서 이미 한 번 했다.

⚠ 이 루프는 기존 톤 계층의 주기 계산을 **우회하는 별도 우선 층**이다. `maxNormalSilenceS = 21`을 비롯한 톤 상수와 경합시키지 않는다(`docs/INTEGRATIONS.md` §실시간 길 안내의 "배타적 계층 순서"에 최종 접근 층을 추가한다).

### 3.4 방향 3-state

방향은 값이 아니라 상태다.

| 상태 | 조건 | 동작 |
|---|---|---|
| 유효 | `motionStep`이 `moving` ∧ `course ≥ 0` ∧ `courseAccuracy ≥ 0` ∧ 마지막 갱신 3초 이내 | 상대 방향 발화 |
| 방향 모름 | 정지 · 속도 미달 · 워치독 만료 | **방향 어절을 문장에서 제거**하고 거리만. 신호는 톤으로 |
| 실패 | `course < 0` 등 무효 | 방향 발화 금지 |

근거: Apple 공식 문서가 `course`·`courseAccuracy`·`speed` 셋 다 음수로 무효를 신호한다. Soundscape는 그 위에 `speed ≥ 0.4 m/s`와 3초 워치독을 얹었다.

⚠ **도착 직전은 사람이 속도를 줄이고 두리번거리는 구간이라 "방향 모름"이 가장 자주 발생하는 시점이 하필 방향이 가장 필요한 시점이다.** 이것은 회피가 아니라 정직으로만 다룬다 — 거짓 방향보다 침묵이 낫다. 그리고 §3.2의 정적 배치 서술이 이 구멍을 메우는 장치다(그 문장은 course를 쓰지 않으므로 항상 나간다).

⚠ **`CLLocation.course`를 `BeaconFixPayload`에 추가해야 한다.** 현재 payload는 `speed`·`speedAccuracy`만 싣는다.

⚠ **나침반(`CLHeading`)은 쓰지 않는다.** 기기 방향이지 몸 방향이 아니고(Apple 문서 명시), 팔 흔들림만으로 약 60° 요동하며(arXiv 2410.06400 실험), 8자 캘리브레이션 알럿이 **시각 애니메이션 지시**라 스크린 리더 사용자에게는 완료 시점을 알 수단이 없다. 한 손이 흰지팡이에 묶여 있으면 물리적으로도 성립하지 않는다.

### 3.5 거리 정직 사다리

| 조건 | 문장 |
|---|---|
| 반올림 거리 ≤ 15m | **수치 없이** "목적지 근처" |
| > 15m, `accuracy ≤ 10` | "목적지까지 {distance}" |
| > 15m, `accuracy ≤ 20` | "목적지까지 약 {distance}" |
| 그 외 | "목적지까지 {distance}쯤" |

Soundscape `DistanceStyle`의 상수 그대로다. 15m 미만에서 수치를 말하지 않는 것이 핵심이다 — GPS가 못 하는 정밀도를 문장으로 참칭하지 않는다.

숫자 포맷은 **기존 `formatDistance`를 그대로 통과**시킨다(3벌 미러 규율 `format-drift.test.ts`를 깨지 않는다). 사다리는 문구 선택 계층에만 둔다.

⚠ 현행 `beacon.nearby` "목적지 근처 (약 ±{n}m)"의 `±` 표기는 `CLAUDE.md`가 `formatDistance`의 **명시적 예외**로 인정한 오차 반경 축이다. 15m 미만에서 "±15m"를 듣는 것은 사실상 무정보이므로 제거가 맞다고 보지만, 정확도 정보를 잃는 변경이라 §5 판정 대상으로 남긴다.

### 3.6 랜드마크

진입 서술(§3.2)에 **보행 인프라 1개까지** 덧붙인다. 목적지 반경 30m의 `getWalkInfrastructure()` 결과에서 고른다(음향신호기 · 횡단보도 · 점자블록).

- **카카오 POI 이름은 기본으로 쓰지 않는다.** §2.5의 검증 가능성 기준에 걸린다. 위원장이 "바로 옆에는 어떤 건물이 있는지"를 명시 요청했으므로 **보조로만** 남기되, 보행 인프라가 없을 때의 폴백으로 순서를 둔다.
- **1개까지, 1회만.** Soundscape "Around Me"가 분면당 1개로 자르고, Nearby Explorer 가이드가 "keep 'chatter' to a minimum"을 명시하는 이유가 §2.6이다.

### 3.7 출입구 좌표 (보강, 키 발급 후)

행안부 **좌표제공 API**(`business.juso.go.kr/addrlink/addrCoordApi.do`)가 `entX`/`entY`로 **건물 출입구 좌표**를 준다. 이것이 붙으면 §3.1의 목적지 좌표가 건물 중심에서 **출입문**으로 올라간다.

- 파라미터 `admCd`·`rnMgtSn`·`udrtYn`·`buldMnnm`·`buldSlno`는 **이미 쓰고 있는 `addrLinkApi.do` 검색 응답에 전부 들어 있다**(실호출 확인).
- ⚠ **별도 승인키가 필요하다.** 보유한 `JUSO_CONFM_KEY`로 호출하면 `E0001 "승인되지 않은 KEY 입니다"`. 즉시 자동승인·무료이며 **위원장 액션**이다(백로그 §F-b).
- ⚠ 파라미터가 빠지면 `E0002`(파라미터 누락)가 먼저 떠서 **키가 유효한 줄 착각하기 쉽다.** 키 검증은 파라미터를 다 채운 요청으로 한다.
- ⚠ **좌표계 EPSG:5179**(UTM-K/GRS80). 이 repo가 이미 쓰는 EPSG:2097(에어코리아)·5181(카카오)·5186(음향신호기 OA-15543)과 **전부 다르다.** `proj4` 변환을 provider 내부에 명시 분리한다.
- 게이트: 키 없으면 `finalApproach`가 카카오 목적지 좌표를 그대로 쓴다(死기능 0, 조용한 열화 아님 — 정밀도만 낮아지고 문장 구조는 같다).

**OSM `entrance`는 쓰지 않는다.** 전국 실측에서 건물 폴리곤 2,847,503개 대비 출입구 노드 21,739개(0.29%)이고, **강동구 길동·강남역·판교역·부산 서면은 반경 300m에 0개**다. 단 `railway=subway_entrance` 4,669개는 커버리지가 양호해 역 출구 안내에는 유효하다.

## 4. 3-state 계약 요약

| 축 | 있음 | 모름 | 실패 |
|---|---|---|---|
| 종점 오프셋 방향 | `relativeBearing` 발화 | `offsetMeters < 10` → 방향절 생략 | (없음 — 정적 계산이라 실패하지 않는다) |
| 실시간 상대 방향 | course 유효 → 발화 | 정지·워치독 만료 → 어절 제거 + 톤 | `course < 0` → 발화 금지 |
| 거리 | 수치 + 헤지 부사 | ≤15m → "근처"(수치 없음) | fix 부재 → 워치독 톤 |
| 출입구 좌표 | juso `entX/entY` | 키 없음 → 카카오 좌표 폴백 | upstream 오류 → 폴백(문장 구조 불변) |

## 5. 미결 — 위원장 실보행 판정 대상

**판정 전 임의 변경 금지**(B1 프로파일 상수와 같은 규율).

1. **주기 루프 15초 · 상한 2분**(§3.3) — Sendero 실사양이나 우리 톤 계층과의 체감 경합은 실보행에서만 안다.
2. **`beacon.nearby`의 `±{n}m` 제거 여부**(§3.5).
3. **랜드마크 순서**(§3.6) — 보행 인프라 우선이 문헌 근거이나, 위원장 요청은 "옆 건물"이었다. 실사용에서 어느 쪽이 정위에 쓸모 있는지.
4. **4분할 vs 8버킷**(§3.2) — §2.7은 4분할을 지지하고 Soundscape는 8버킷(정면·좌우 각 30°)을 쓴다. 초기값은 4분할.
5. **진입 서술 시점** — 현행 `handoff` 임계 50m를 그대로 쓸지, 오프셋이 큰 목적지(89m 실측)에서 별도 시점을 둘지.

## 6. 검증

- **게이트 테스트**: `finalApproach` 기하는 §1.2 실측 4건을 golden으로. 방향 4분할 경계(±45°·±135°)와 `offsetMeters < 10` 생략을 fixture로 못 박는다.
- **변이 주입**: 진행 방위를 "마지막 세그먼트 하나"로 되돌리면 강동구청·성심병원 golden이 깨져야 한다(그 선택이 판정을 뒤집은 실측이 §3.1의 근거다).
- **실호출 게이트**: 도보 경로 4건으로 `finalApproach`가 실제 응답에 실리는지, 오프셋 10m 미만 목적지에서 방향이 생략되는지. juso 좌표제공 API는 키 발급 후 별도 게이트.
- **실기기**: 위원장 실보행. §5 다섯 항목이 판정 대상이고, 그 전까지 상수는 동결이다.

## 7. 부활 금지

- **시계 방향 표기** — §2.7 근거 셋. 도입하려면 설정 선택지여야 하고 기본값이 될 수 없다.
- **나침반(`CLHeading`) 기반 방향** — §3.4 근거 셋.
- **OSM `entrance`를 출입구 1차 소스로 삼는 설계** — §3.7 실측.
- **`bearing.ts`의 절대 8방위를 상대 방향으로 바꾸는 것** — 그 주석의 전제("사용자가 바라보는 방향을 모른다")는 **정지 상태의 "내 주변" 조회에서 참이다.** 최종 접근에서만 상대 방향이 성립하며, 두 문맥은 course 가용성이 다르므로 서로 다른 규칙이 정당하다.
