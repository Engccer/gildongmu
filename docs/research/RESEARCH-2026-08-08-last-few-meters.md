# 마지막 몇 미터(last-few-meters) 안내 — 선행 사례·표준·문헌·국내 데이터 조사

> 조사 시점 **2026-08-08**. 계기는 위원장 실보행 피드백("목적지 근접 시 '직선 안내로 전환합니다'만 나오고 별다른 안내가 없다. 마지막 15미터가 가장 중요하다"). 설계 결론은 spec `docs/superpowers/specs/2026-08-08-final-approach-guidance-design.md`가 정본이고, **이 문서는 그 spec이 인용하지 않은 것까지 포함한 조사 원자료**다.
>
> 네 갈래 병렬 조사(선행 앱 / 학술 문헌 / 방위 관례·센서 / 국내 정적 데이터) + 이 저장소에서 직접 수행한 실측을 합쳤다.

## 신뢰도 표기

- **[실측]** 소스코드·API·PDF를 직접 내려받아 확인. 인용은 원문 그대로.
- **[2차]** 웹 요약 도구 경유. 의미는 맞으나 따옴표 안 문구가 원문 그대로라는 보장이 약하다.
- **[추론]** 조사자 해석. 출처가 그렇게 말한 것이 아니다.
- **확인 못 함** 접근 실패·미착수. 추측으로 채우지 않았다.

⚠ **핵심 공백을 먼저 밝힌다**: 조사한 앱 중 **"목적지 도착 순간의 발화문"을 원문으로 확보한 곳은 0개**다. 어느 벤더도 도착 멘트를 문서화하지 않았다. 확보한 것은 (a) 방향·거리 규약 (b) 도착 임계 거리 (c) 표준이 권장하는 문형이다. **이 공백 자체가 발견**이며, 도착 순간은 GPS 오차가 안내 정밀도를 초과하는 구간이라 벤더가 확신 있는 문장을 못 만들었다는 해석이 가능하다[추론].

---

## 1. 이 저장소에서 직접 수행한 실측

### 1.1 경로는 목적지까지 가지 않는다 [실측]

프로덕션 `/api/route/walk`(provider=kakao) 실호출. 출발지 고정(37.5380,127.1430), `includeGeometry=1`.

| 목적지 | 총거리 | 종점→목적지 | 상대각(마지막 세그) | 상대각(마지막 40m 평균) |
|---|---|---|---|---|
| 강동구청 | 2,780m | 16.1m | −64° | **−99°** |
| 강동성심병원 | 1,102m | 31.0m | −96° | **−60°** |
| 이마트 명일점 | 2,884m | 48.6m | +46° | **+46°** |
| 서울길동초등학교 | 212m | 89.4m | −72° | **−72°** |

(+우 −좌. 상대각 = 종점→목적지 방위 − 진행 방위)

**두 가지가 나왔다.**
1. 카카오 도보 경로는 목적지 좌표가 아니라 **가장 가까운 보행로 지점에서 끝난다.** 오프셋이 항상 남고 최대 89m였다.
2. **진행 방위를 어느 구간으로 잡느냐가 판정을 뒤집는다.** 강동구청·성심병원은 마지막 세그먼트 하나로 잡을 때와 40m 평균으로 잡을 때 답이 달랐다. spec은 15m 평균을 채택했다(Soundscape `closeByDistance`와 같은 값).

### 1.2 목적지 반경 POI는 충분하다 [실측]

`/api/places/around?lat=37.5301933&lng=127.1237925` (강동구청):

```
0m   강동구청 [public]              3m  아이갓에브리띵 강동구청 [cafe]
35m  우리은행 강동구청지점 [bank]    45m 시골밥상 [restaurant]
46m  리틀채스우드 [cafe]            52m 박리김밥 강동구청점 [restaurant]
```

응답이 `bearing`(8방위)·`distanceMeters`·좌표를 모두 준다. 데이터는 있다. 다만 §4.3의 검증 가능성 기준 때문에 spec은 이것을 1차 랜드마크로 쓰지 않았다.

### 1.3 주기 통지 중복 시뮬레이션 [실측]

웹 리듀서(`guideStep`)에 위 강동구청 경로와 보행 1.2m/s를 태운 결과. 상세는 백로그 §A5.

```
 160s (announceSteps) 훈훈한내과 앞에서 왼쪽으로 돌아 T world까지 …417m 이동
 175s (periodic)  22m 앞 (같은 문장)
1448s (announceSteps) 다음 안내 2개. 농협입구교차로에서 11m 이동, 횡단보도 이용, 음향신호기 있음. 퍼리모먼츠…
1485s (bundleReread)  (글자까지 같은 문장) → 1500s (또)
```

---

## 2. 선행 앱

### 2.1 Sendero Seeing Eye GPS / RNIB Navigator — "Getting Warmer" [실측]

https://senderogroup.com/products/RNIBGPS/RNIBGPSUserGuide.htm

**이 조사에서 가장 값진 발견.** 인계 조건이 §1.1의 우리 상황과 글자 그대로 같다.

> "If you have chosen one of the route modes with turns, the Getting Warmer function takes over once you are near your destination **just in case it is a sizable distance off the street**. Once you have arrived within the default arrival distance of 50 feet, the application will automatically turn on the Getting Warmer mode which will run **up to two minutes**. While in this mode, you will hear the distance and compass direction to your destination **every 15 seconds**."

> "In summary, Getting Warmer on its own provides distance and direction to a destination without any turns. It is also used when **a route with turns ends short of the destination** so you have some indication of where that destination is located in the final short distance."

**도착 임계 설정**:
> "Arrival Distance: Choose from 50 feet, 75 feet or 100 feet. 50 feet is the default. This distance controls how far away from turns, road junctions and your destination that these things will be announced. **Be careful when expanding this trigger beyond the default 50 feet.** ... If you have chosen your Units to announce in metres, your choices will be **15 metres, 25 metres or 30 metres**."

**거리별 주기**:
> "This information will repeat **every minute** when you are over 1000 feet..., **every 30 seconds** when you are 500-1000 feet..., and **every 15 seconds** when you are within 500 feet of your destination."

**발화 골격**:
> "you will hear "**Proceed Clock-face direction, Compass heading, X distance to your destination.**""

**방향 표현은 사용자 설정**:
> "Direction to POI: Choose from **Clock Face & Right/Left, Clock Face, or Right/Left.** The combination of Clock Face & Right/Left is the default."

### 2.2 Microsoft Soundscape — 오픈소스 코드 상수 [실측]

https://github.com/soundscape-community/soundscape (MIT). `SettingsContext.swift`·`Direction.swift`·`FilteredCourseProvider.swift`·`en-US.lproj/Localizable.strings` 직접 확인.

| 상수 | 값 | 의미 |
|---|---|---|
| `enterImmediateVicinityDistance` | 15.0 m | 도착 존 진입 |
| `leaveImmediateVicinityDistance` | 30.0 m | 이탈(히스테리시스 15m) |
| `beaconRingingAngle` | 15.0° | 정면 콘 반각(총 30°) |
| `closeByDistance` / `farAwayDistance` | 15.0 / 200.0 m | 거리 표현 사다리 경계 |
| `goodAccuracy` / `averageAccuracy` | 10.0 / 20.0 m | 헤지 부사 경계 |
| `maxAheadOfMeCallouts` / `maxNearbyMarkerCallouts` | 5 / 4 | 주변 안내 상한 |

**거리 표현 사다리** (`LanguageFormatter.DistanceStyle`):
```
반올림 거리 ≤ 15m              → .close   → "%@ close by"        ← 수치를 말하지 않음
15m < d < 200m, accuracy ≤ 10m → .default → "%1$@ is %2$@ away"
                accuracy ≤ 20m → .about   → "%1$@ about %2$@"
                그 외          → .around  → "%1$@ around %2$@"
```

**FAQ 원문**:
> "Soundscape can determine the location of your destination to within several meters, but not less. When Soundscape determines that you are close to your destination, you will hear a final callout that your destination is nearby, and the beacon will turn off."
> "since Location Services is only accurate to about 10 meters, we cannot guarantee the behavior of the beacon when you are within a few meters of your destination."
> "**When Soundscape is uncertain about which way you are facing, it lowers the volume of the beacon.** Most often this occurs if you have been walking with the phone stored in a pocket or bag, and you stop moving, such as to cross a street."
> "Soundscape is designed **not to be too chatty**."

**상대 방향 8버킷** (`Direction.swift`, 기본 `.combined`). 시계 방향을 쓰지 않는다:

| 각도(진행 방향 0°) | 발화 | 폭 |
|---|---|---|
| 345~15 | `ahead` | 30° |
| 15~75 | `ahead to the right` | 60° |
| 75~105 | `to the right` | 30° |
| 105~165 | `behind to the right` | 60° |
| 165~195 | `behind` | 30° |
| … | (좌측 대칭) | |

정면·좌우가 좁고 대각이 넓은 **비대칭 배분**이다 — "정면"이라 말할 땐 확실할 때만 말하겠다는 설계[추론]. 교차로 설명에는 `.leftRight`(정면 60°, 좌우 각 120°)를 따로 쓴다.

**course 3중 게이트** (`FilteredCourseProvider.swift`):
```swift
guard isInMotion else { return }                 // ① 모션 활동이 "이동 중"
if let speed = speed { guard speed >= 0.4 else { return } }   // ② 속도 하한
timer = Timer.scheduledTimer(withTimeInterval: 3.0, ...) {    // ③ 3초 워치독
    self.courseDelegate?.courseProvider(self, didUpdateCourse: nil)
}
```

**비콘 오디오 각도 4구역**: A+(±15°, 정면 확정음) / A(15~55°) / B(55~125°) / Behind(125~235°, **heading 미상 시 폴백**). 설정 설명: `"Adjust the width of the area where the beacon audio is most intense (5° to 20°)."`

**거리 통지 주기** (`BeaconUpdateFilter`, `RouteGuidanceGenerator.swift:86`):
```swift
BeaconUpdateFilter(updateDistance: 10.0 ..< 25.0, beaconDistance: 12.0 ..< 100.0, ...)
```
100m 밖이면 25m마다, 12m 이내면 즉시, 그 사이 선형 보간 — **가까울수록 촘촘**. 비콘을 음소거해도 거리 통지는 유지: `"If the beacon is muted, you will still get updates about the distance to your destination every 50 meters or so."`

**도착 판정**: `DestinationManager.isLocationWithinGeofence`가 **POI 폴리곤 안이면 거리와 무관하게 도착**으로 본다. 건물 외곽선이 반경보다 우선한다.

**"Around Me" 알고리즘** (`ExplorationGenerator.swift`·`Quadrant.swift`): 진행 방향 기준 **4분면(각 90°)** → **분면마다 최근접 1곳** → 총 4곳. 검색 반경 200m에서 시작해 200m씩 확장. 카테고리 화이트리스트 `places`·`landmarks`·`authoredActivity`. **"가까운 N개"가 아니라 "방향마다 1개"** — 목록이 아니라 지도가 머릿속에 생긴다[추론].

**자동 콜아웃 거리** (`CalloutRangeContext`): objects·safety 10m(근접 20m) / places·information·mobility 20m(30m) / **landmarks 50m(100m)**.

**사람이 쓴 도착 안내**: `ImportedLocationDetail.arrivalCallout: String?` — 큐레이션 경로의 웨이포인트마다 **저자가 직접 쓴 도착 설명**을 넣고 UI에 "Arrival Callout"으로 표시. 자동 생성으로 안 되는 "옆에 뭐가 있는지"를 사람이 채우는 통로.

관련 문자열:
```
"beacon.beacon_location_within" = "Beacon within %@";
"beacon.suggest_navilens" = "Use the NaviLens button to take you to your destination.";
```

### 2.3 GoodMaps Outdoors → "Indigo Nav" [실측 일부·2차 일부]

App Store ID 945756779가 현재 **Indigo Nav**로 서비스.

**공식 문서** https://connect.goodmaps.com/docs/app-settings/ [실측]:
> "### Routing Feedback — Change the way you hear directions if you veer off course. Your options are **Clock face directions (11 and 1 oclock) and Slight directions (slight left/slight right)**. This is set to **Clock directions by default**."

⚠ 시계 방향이 **경로 이탈 복귀** 규약으로 명시됐다. 턴 안내 일반이 아니라 미세 방향 보정 축이다.

기타: Unit Type(m/ft), Speaking Rate 기본 1.25, Sound Effects 기본 on, Haptic 기본 on, "our Chat GPT Synth 'Nova'" 기본 off.

**도착 임계를 사용자가 고른다** [2차] https://outlooken.org/resources/goodmaps-navigating-with-explore-and-outdoors/:
> "set specific items, such as arrival distance... options can be selected from **fifty to one hundred feet**." (15~30m)

**마지막 몇 미터를 사람에게 넘긴다** [실측, App Store 원문]:
> "When Indigo gets you **near your final destination**, you have both services for **visual assistance** to pinpoint your destination."

Explore(실내)도 Be My Eyes 링크를 갖는다 [2차] https://gnc3.com/review-goodmaps-explore-indoor-navigation-app/. 같은 리뷰의 비판: "The sporadic lag time in directions and at times long delay between instructions is the major hurdle", 배터리 "about ten percent power drain for every ten minutes of use".

### 2.4 Waymap [2차 — 원문 403]

Fast Company https://www.fastcompany.com/90768125/ 경유 연속 발화(두 검색 패스에서 재현):
> "Turn to 10 o'clock, then go forward for four steps. After the pedestrian crossing continue straight. In 10 steps turn to 1 o'clock for the path. In nine steps turn to 1 o'clock. Follow the path…"

**시계 방향 전용 + 걸음 수 단위.** GPS 미사용, IMU로 보폭·게이트·계단 판정 [실측] https://www.waymapnav.com/how-it-works. "accurate up to 1 meter (and 10 degrees heading)" [실측] https://www.waymapnav.com/our-tech.

⚠ **걸음 수는 Wayfindr가 명시적으로 반대하는 방식이다**(§3.1).

### 2.5 Lazarillo [실측]

https://lazarillo.app/usersupport/ — 방향 3종 선택: **Relative**("Forward, backward, etc.") / **Cardinal Points** / **Clock Format**. 거리 단위 metric/imperial 선택.

**"Where I Am"의 자기 경고**(원문):
> "tell you the address that is closest to where you are currently located. However, **it will not always be the last location announced in the scan.**"

**라디오 은유** [실측, App Store]: "Like a radio, Lazarillo will announce the things around you while you are moving."

**간격 불만** [2차, App Store 리뷰]: "I would like to see less distance announcements currently **50 m is too far** upcoming intersection" → 50m를 상한이 아니라 "이미 너무 멀다"는 반례로 쓸 수 있다[추론].

### 2.6 NaviLens [실측]

RNIB https://www.rnib.org.uk/…/navilens/:
> "If you're approaching the code, your phone will emit **a series of bleeps that'll become faster the closer you get to it.** Your phone will also tell you the distance between you and the code."

**거리는 음성, 근접은 비프 가속.** MIT Tech Review https://www.technologyreview.com/2019/06/06/135057/:
> "As users sweep their environment with a smartphone, audio cues allow them to find and center the tag in the phone's field of view. A shake of the wrist prompts the details... (**visually impaired people are often holding a guide dog or cane with their other hand**)."
> "A 5-inch-wide NaviLens card can be read by a phone from **12 meters** away, in a 30th of a second"

⚠ **오귀속 주의**: 검색에 뜨는 "9 o'clock or 3 o'clock direction"은 발화 규약이 아니라 **카메라 160도 화각 설명**이다. 앱이 시계 방향으로 말한다는 근거가 아니다.

### 2.7 RightHear [실측]

https://www.right-hear.com/guide-english/ — 위치 안내 예시 "**you are at Weizmann Street, Ra'anana**". 실외 모드에서 "define **after how many meters** you want the app to alert you where you are"(도착 임계가 아니라 **반복 통지 간격**을 사용자가 설정). "Location deviation" 버튼이 "give you information about the **position deviation** so you can know the accuracy" — **측위 오차를 그대로 노출**한다.

### 2.8 BlindSquare / Nearby Explorer / Apple / Google [2차·실측 혼합]

- **BlindSquare** [2차]: "The closer you are to your destination, the more frequently BlindSquare will announce this information". 150m 이내부터 추적 시작 옵션. 시계/도/방위 선택. **Foursquare 인기순으로 거르고 체크인 5명 미만 장소는 발화하지 않는다** — 데이터 품질이 아니라 사회적 유의미성으로 자른다[추론].
- **Nearby Explorer (APH)** [2차] https://tech.aph.org/ne_doc.htm: 주행 중인 쪽 도로의 **홀수/짝수 번지만** 안내(길 어느 편인지 추론 가능). 기본 주변 4곳(1~8 조정). 가이드 원문 `"It is important to keep 'chatter' to a minimum."`
- **Apple Maps** [실측] https://www.apple.com/newsroom/2022/05/apple-previews-innovative-accessibility-features/: "Apple Maps will offer sound and haptics feedback for VoiceOver users to identify **the starting point** for walking directions." 도착이 아니라 **출발점**이다. Door Detection은 LiDAR로 문을 찾아 "how far they are from it, and describe door attributes — including if it is open or closed, and when it's closed, whether it can be opened by pushing, turning a knob, or pulling a handle". Apple 자신이 이를 **"navigate the last few feet to your destination"**이라 표현한다.
  ⚠ "destination is on your left/right" 문구는 **확인 못 함**. AppleVis 403. 존재한다고 가정하지 말 것.
- **Google Maps** [2차]: Detailed voice guidance는 경로 유지 확인·다음 회전까지 거리·진행 방향·큰 교차로 경고. **도착 구간 전용 동작은 문서화돼 있지 않다.**

### 2.9 한국 — G-EYE / G-EYE Plus (LBSTECH)

App Store [실측] https://apps.apple.com/kr/app/g-eye-plus/id1495742951: 시각장애인 특화 보행 내비, **"출입구 정보"** 명시. 서비스 지역 극히 제한(서울 지하철역 18곳, 세종 새롬동, 대전 산성동).

**시각장애 당사자 1주일 체험기** [실측, 전문 확보] 에이블뉴스 서인환 칼럼 https://www.ablenews.co.kr/news/articleView.html?idxno=99521 (2022-08 기준):

> "'검색하기'를 선택하면 저시력인용은 **'몇 시 방향 몇 미터'**라고 알려준다."
> "시각장애인용 버전으로 목적지 검색을 하면 방향을 잡기 위해 **제자리에서 한 바퀴를 돌아야 한다. 그러면 방향이 맞추어지면 진동이 울린다.**"
> "걸어가면 **15미터 정도 간격으로** 회전구간까지 몇 미터 남았는지 음성으로 알려준다."

**반면교사 셋** (전부 원문):
> "먼 거리의 경우 검색을 하면 직선으로 가다가 꺾는 곳은 140번, 횡단보도는 75번 하는 식으로 정보를 준다. **재미로 볼 수는 있겠으나 이런 정보가 보행에 도움이 되지는 않는다.**"
> "그런데 평소 사용하지 않는 **주소로 알려주는 것은 정보 활용도가 낮다.** 주소를 듣고 현재 위치를 상상할 수 있는 것은 아니기 때문이다. (신대방로라고 하면 그 길 위에 있는 것은 알지만 신대방로는 너무나 길어서 현 위치를 알기는 어렵다)"
> "'주변 시설'은 한 줄에 하나씩 현 위치에서의 거리를 보여준다. 이 정보는 **직선거리로 얼마나 떨어져 있는지는 알 수 있지만 경로를 알려주지는 않는다.**" ← 지금 우리 비콘이 받은 피드백과 같은 계열

**가장 중요한 한 줄** (spec §2.5의 한국 근거):
> "시각장애인들은 주변에 어떤 시설물이 있는지보다 **주변 시설물을 통하여 현 위치를 파악하는 데 더 주변 정보를 활용한다.**"

정확도 실측(혹독함):
> "방향을 잘못 알려주는 경우가 많다. **20번을 시도했더니 한번이 정확했다.**"
> "용산역에서 역내 카페를 가기 위해 검색을 하였더니 **철로 안으로 안내**를 하였다."
> "방향의 실수와 통신장애, 재설정 등으로 10분이면 갈 수 있는 거리를 **4시간 동안** 거리를 헤매고도 도착하지 못했다."

음향신호기 보급률: "2020년부터 리모컨이 아닌 RF IOS 방식의 유도기와 신호기가 보급되기 시작하여 현재 **3.35%**가 스마트폰의 서비스가 가능한 실정이다."

기타 국내: "보이스맵"(1차 소스 확인 못 함) · "WalkWith"(크라우드펀딩, 출시 확인 못 함) · 현대차 "데이지"(버스 진동 알림이지 보행 내비 아님).

---

## 3. 표준

### 3.1 Wayfindr Open Standard (ITU-T F.921의 모체) [실측]

ITU-T F.921 "Audio-based indoor and outdoor network navigation system for persons with vision impairment", 승인 2018-08-29, In force. https://www.itu.int/rec/T-REC-F.921-201808-I

**음성 안내 6유형** https://www.wayfindr.net/open-standard/designing-for-vision-impaired-people/different-types-of-navigation-instructions
- Route starting / **Route ending** / Orientation 3종(progression·**reassurance**·prior to features) / Alerts 3종(location·approaching·warnings)

**Route ending 정의**(원문):
> "Route endings are instructions that inform users that they have reached their destination and that the navigation guidance is ending. This instruction can include information about **the physical layout of the destination** in order to help vision impaired people make better sense of the space and **position themselves in relation to other objects** such as the exit, a ticket machine, platform edge or bus stop edge."

**도착 문형 예시**(원문): 현재 위치 확정 + 몸 기준 상대 배치, **거리 수치 없음**
> "You are now at the platform. The trains leave in front of you."
> "You are now at the platform. The platform edge is on your left."
> "You are now at a platform where trains leave from both sides. Southbound trains leave from the right. Northbound leave from the left."

**진행·안심 문형**: "At the bottom of the stairs, turn left and walk forward to the ticket gates" / "Keep walking forward" / "You are halfway there" / "Keep walking past the ticket gates on the left" / "The down escalator is the left one" / "You are approaching the escalators"

**설계 원칙**(원문):
> "The '**less is more**' principle applies... vision impaired people **do not like long or very detailed instructions** due to the time required to think about and process the information."
> "Vision impaired people pay considerable attention to their remaining senses... It is important therefore that they should have **as few distractions as possible** from the technology that is assisting them."
> 능동태 필수: "a phrase like, 'The stairs are in front of you' does not imply any action... Instead a phrase like, '**Walk forward and take the stairs up**' makes the action clear."
> 재확인 주기: "Where vision impaired people travel on a route of more than 50 metres without needing to change direction... An audio instruction to confirm that they are on the right track is recommended to be given at **25 metre intervals**."
> 선행 안내: "The announcement should be given **8 +/-1 metres in advance**"
> **걸음 수 금지**: "The length of each step may vary based on the person's height and how tired they are feeling... it is **demanding for an individual to count or memorise the number of steps** required."
> 거리 단위 회의: 시각장애 사용자가 "distance information given in feet or metres"를 다루기 어려워한다 → 대안은 **안심 피드백 + 다음 랜드마크 접근**
> "Provide an instruction at **every decision making point** on the route, even if the user is not changing direction."

**메시지 문법 요소**: Verbs / Orientation / Environmental features / Directional delimiters / **Countable delimiters**("words or phrases that count numbers to navigate to an object") / Sequential / Descriptive.
⚠ "문을 세라"가 국제 표준의 문법 요소다 — 지팡이로 검증 가능하므로 정직성과 충돌하지 않는다[추론].

**어휘 목록**: 동사 "walk, turn, take, go, follow, keep walking, keep following, press" / 방향 "forward, up, down, to, right, left, through, in front (of you), **the left (one)**, 45 degrees to your right, turn at 2 o'clock, between, on, on your left" / 상태 "there are, it is, **you are now at**, the trains leave, you are approaching, you are halfway" / 한정어 "the _up_ (escalator); the _lower_ (concourse); the _wide_ (gate)"

**방향 5종 분류와 판정**(§4.1에서 재인용):
> "Clock faces... **This technique seems to be very popular with older people as it is taught during O&M training however the younger generations... do not have a lot of experience with clocks with fixed numbers and moving hands which makes this technique confusing for them. During Wayfindr trials many reported that it is difficult to distinguish between 1 and 2 o'clock for example. Thus, clock faces should be used to communicate the general direction.**"
> "Degrees... various vision impaired people expressed concerns around **distinguishing between 45 and 60 degrees**"
> "Proportional... **this technique is open to interpretation by users.** For example... 'how many degrees diagonally do I have to turn?' It has been observed that people interpret the word 'slightly' in different ways."
> "**Vision impaired people have reported that they find it difficult to orientate themselves based on cardinal coordinates as they have to first translate them into an egocentric frame of reference before use.**"
> 최종 결론: "vision impaired people have **no single preferred way**... **One size does not fit all.**" → 표준의 권고는 "하나를 고르라"가 아니라 "**사용자가 고르게 하라**"

### 3.2 ISO [실측 — Scope만, 본문 유료]

- **ISO 21542:2021** 건축물 접근성. Scope: "outdoor features **directly concerned with access to a building**... **This document does not deal with elements of the external environment, such as public open spaces**". 목차 §5 "Orientation and information outside and inside of a building"(5.1.2 Levels of information · 5.1.3 Principle of multiple senses · 5.1.4 TWSI).
  ⚠ **보도(도로 관할)와 건물 내부(ISO 21542) 사이의 부지 진입로를 어느 표준도 상세히 다루지 않는다** — last-few-meters가 표준 틈에 빠지는 구조적 이유[추론].
- **ISO 23599:2019** 점자블록(TWSI). Introduction: "**environmental information is not always reliable** and it is for this reason that TWSIs... have been developed." / "TWSIs were invented in Japan in 1965."
- **ANSI/CTA-2076** "Inclusive Audio-Based Network Navigation Systems…" — 유료, **확인 못 함**.

**W3C 부재 판정**: 보행 내비 안내문에 관한 W3C 표준은 **없다**. WCAG 2.2는 앱 UI에만 적용되고 도착 안내 문안·발화 빈도·불확실성 전달은 규정 밖이다. 그 자리는 ITU-T F.921 / ANSI-CTA-2076이 채운다.

---

## 4. 학술 문헌

### 4.1 문제 정의와 GPS 한계 [실측]

**Saha, M., Fiannaca, A. J., Kneisel, M., Cutrell, E., Morris, M. R. (2019). "Closing the Gap: Designing for the Last-Few-Meters Wayfinding Problem for People with Visual Impairments." ASSETS '19.** https://doi.org/10.1145/3308561.3353776 · PDF https://www.microsoft.com/en-us/research/wp-content/uploads/2019/07/LandmarkAIASSETS.pdf

> "smartphone-based GPS has a horizontal accuracy of about **±5m at best**... This means that smartphone GPS can guide a user to the **vicinity** of their destination, but not to the precise location (e.g., **to the front of a building, but not to the actual door**). This gap of a few meters is acceptable for people who can rely on their vision... but creates confusion and uncertainty for people with VI."

**N=22 맹인 실측 — 무엇에 막히는가**:
> "In most cases, the hardest part of traversing the last few meters was **finding the intended doorway (11)**. Participants reported this was caused by: (i) failure of existing guidance systems... (ii) **finding the right door from a cluster of doors (5)**; (iii) transit drop-off points being far away from the actual destination (5)."
> 해결법: "sighted assistance (17), O&M skills (11), trial and error (7), technology (2), or **completely giving up (2)**."
> "The most important concern with current technology (16) was **imprecision** in terms of localization and granularity of information"
> 기타 문제: "lack of indoor navigation (3), intermittent GPS signal (2), **use of headphones blocking ambient noise (2)**, and battery power drain (2)."

**랜드마크 5분류**: Structural(문·계단·엘리베이터·연석) / Sound / Tactile / Air / Smell. 선호도 tactile(Mdn=5) ≈ structural(Mdn=5) > sound(4) > smell·air(3). 단 결론부는 "**discovering structural landmarks was the most preferred across all participants**".

**사용자가 원한 것**(원문):
> "knowing about the **layout** of indoor and outdoor spaces was the most popular request (9)."
> S15: "Imagine being able to walk down the hallway of an office building and hear '**men's bathroom on your left**.'"
> **문 vs 창문 구분이 만장일치**: "the popularity of detecting doors was unanimous... **guide dogs, who are usually good at finding doors, often get confused and lead the VI individual to a full-pane window**"
> 거리 카운트다운: "**periodically when moving towards their target (e.g., in decrements of '50 feet, 25 feet, 10 feet' —P10)**"
> **잔존시력 유무로 표현을 가른다**: "**For completely blind users, providing granular directional guidance is key. For people with residual vision, using visual instructions... is more appropriate.**"

**GPS 오차 정량**:
- GPS.gov(공식) https://www.gps.gov/gps-accuracy: "GPS-enabled smartphones are typically accurate to within a **4.9 m (16 ft.) radius under open sky**. However, their accuracy worsens near buildings, bridges, and trees."
- StreetNav (UIST '24) https://arxiv.org/abs/2310.00491: "GPS precision can range from **5 meters at best to over tens of meters** in urban areas"; "localization errors in excess of **10-15 meters** in urban areas"
- ⭐ **RouteNav (ASSETS '23)** https://pmc.ncbi.nlm.nih.gov/articles/PMC10691587/ — `horizontalAccuracy` 자체가 거짓말한다:
  > "**in the example to the right the uncertainty radius is small (5.4 m) in spite of the very large error (36.5 m)**"
  > "When the GPS uncertainty radius is larger than 10 m... **we simply ignore the effect of GPS**."
  > "**The distance to the next tile is expressed only as more/less than 10 meters. Using higher resolution would not be advisable given possible localization errors.**"
  > "users of RouteNav are **never** given a 'turn here' or similar (e.g., '**turn in 1 meter**') direction"

### 4.2 랜드마크로 말을 늘려도 부하는 안 는다 — 조건부 [실측]

**Padmanaban, R. & Krukar, J. (2017). "Increasing the Density of Local Landmarks in Wayfinding Instructions for the Visually Impaired."** https://doi.org/10.1007/978-3-319-47289-8_7 · 무료 전문 https://kubakrukar.github.io/pdfs/Padmanaban,%20Krukar%20-%202017%20-%20Increasing%20the%20Density%20of%20Local%20Landmarks%20in%20Wayfinding%20Instructions%20for%20the%20Visually%20Impaired.pdf

**지팡이 감지 가능 응답(10명 중)**: Access/exit areas **10/10** · Traffic lights(ATS) **10/10** · Surface materials **10/10** · Tactile areas and strips **10/10** · Railings 8/10 · Walls 8/10 · Bus stops **with** a shelter 8/10 · Tree pits 8/10 · Staircases 8/10 · **Bus stops without a shelter 0/10**

**안내문 대조**(Table 2):
| Landmark-enhanced | 대조군 |
|---|---|
| Turn right and **go downstairs** | Turn right |
| Turn right onto **access and Exit area for** Platten-Peter | Turn right for Platten-Peter |
| Walk 50 m and **pass by access and Exit area** / Walk 150 m | Walk 200 m |
| Walk 25 m / **Follow right side small wall** | Walk 200 m |

> "the Landmark-Enhanced set... had a significant influence on the participants' subjective satisfaction and confidence, **while it was not seen as subjectively more complex**."
> "the density... did not result in increased subjective complexity. **This could become an issue if the communicated information was irrelevant or trivial**"
> "**the key to useful local landmark selection is in understanding which spatial objects would be detected by the blind navigator spontaneously** over the course of regular locomotion."

### 4.3 회전 실행 오차 [실측]

**Ahmetovic, D., Oh, U., Mascetti, S., Asakawa, C. (2018). "Turn Right: Analysis of Rotation Errors in Turn-by-Turn Navigation for Individuals with Visual Impairments." ASSETS '18.** https://doi.org/10.1145/3234695.3236363 · PDF https://mascetti.di.unimi.it/Sergio_Mascetti_-_home_page/Publications_files/2018_ASSETS_TurnRight.pdf

시각장애인 11명, 21,000㎡ 쇼핑몰, 400m×3경로, **회전 286회** 로그.

NavCog 음성 버킷: "'**Turn slightly left' signals turning angles between 22.5°–60° and 'Turn left' those between 60°–120°**"

| 항목 | 값 |
|---|---|
| 전체 평균 회전 오차 | **14.9° (SD 9.9°)** |
| slight turns(22.5–60°) | 17.4° (SD 4.0°) |
| ample turns(60–120°) | 13.4° (SD 3.7°) |
| ample turn 실제 수행각 | **90.4°** (지시 평균 77.03°) |
| 전맹 vs 잔존시력 | 14.96 vs 14.46 — 유의차 없음 |
| 조기실명 vs 후기 | 14.21 vs 15.01 — 유의차 없음 |

> "participants **extend rotations by 17° on average**... the error is accentuated for 'slight turns', while '**ample turns' are consistently approximated to 90°**."
> "the average rate of correct turns was significantly higher (t(8)=2.63, p=.03) for **90° intersections (88.3%, SD=12.0)** than for **45° ones (73.0%, SD=16.7)**"
> "**42% of the incorrect turns were labeled as failed**, and the navigation had to be stopped to avoid danger... in two cases the navigation was stopped to **prevent participants from walking into an incoming escalator.**"
> "**simply notifying the user when the rotation should be stopped is error prone**"

⚠ 논문 내부 불일치: 초록·결론은 "17°", 본문 측정표는 "14.9°". **본문 14.9°를 정본으로 인용**하고 17°는 "과회전 경향" 서술로만 쓴다.

**오차 예산 사다리**[추론]:
| 표현 | 버킷 폭 | 허용 오차 | 신체 오차 14.9° 대비 |
|---|---|---|---|
| 시계 12방위 | 30° | ±15° | **동급 — 노이즈에 잠김** |
| 8방위 | 45° | ±22.5° | 1.5배 — 경계선 |
| 4분할 | 90° | **±45°** | **3배 — 안전** |
| "45도 우회전" | ~15° | ±7.5° | 실행 불가 |

### 4.4 발화 빈도·인지부하·환경음 마스킹 [실측]

**StreetNav** https://arxiv.org/html/2310.00491v2:
> "We tried several intervals, such as **5, 10, and 15 seconds**, and found that **shorter intervals overwhelmed the users, whereas longer intervals practically would not be repeated enough**... **We settled on repeating the feedback every 10 seconds**."
> "**a tolerance angle of 50 degrees was introduced.** Within this angle, subtle haptic vibrations guide users... while beeping sounds indicate veering."

**RouteNav**: "**Each notification is only produced once per tile**, and is preceded by a chime sound."

→ 규칙화[추론]: **지속 상태 = 고정 주기 + 불감대 / 이산 이벤트 = 1회 + 선행 earcon.**

**과다 발화** (Saha et al.):
> P9: "**I really don't wanna hear everything that's coming in my way. That's too much information to process.**"
> P10: "**At some point, you got to leave something out to the user to use their brain.**"

**환경음 마스킹 — 30년 재현** Loomis, Marston, Golledge, Klatzky (2005), JVIB. https://pmc.ncbi.nlm.nih.gov/articles/PMC2801896/
> "Virtual speech led to the shortest travel times and the highest subjective ratings, **despite concerns about the use of headphones**."
> "Many negative comments about the headphones and the auditory signals... **blocking environmental sounds**"
> 두 축 구분: "actual **occlusion** of the acoustic signals" vs "**perceptual masking** of environmental sounds"
> 권고: "bone-conduction earphones" 또는 "small air tubes that conduct sound into the ear canals"

### 4.5 불확실성의 정직한 전달 [실측]

**Morris, M. R. (2020). "AI and Accessibility." CACM.** arXiv:1908.08939 https://arxiv.org/pdf/1908.08939
> "people who were blind were **over-trusting** of an AI image captioning system, even when the output made little sense; ... incorrect output... **could not be corrected even with human assistance**."
> "**Precision/recall tradeoffs for AI systems may need to be re-calibrated for vulnerable user populations**... where **errors may have safety consequences**. ... **Translating mathematical confidence values to user-actionable information is an open challenge**"

Saha et al.이 독립적으로 같은 결론: "**low precision causes more harm than low recall**." / P9: 시스템이 "provide the user too much of wrong information, because that will directly confuse the user more than really help them out."

**그러나 신뢰도 %는 만능이 아니다** — Alharbi, R. et al. (2024). "Misfitting With AI: How Blind People Verify and Contest AI Errors." ASSETS '24. https://doi.org/10.1145/3663548.3675659 (맹인 26명)
> "participants... had **mixed opinions about the benefits of indicating uncertainty**"
> P2(수치보다 위치): "'Uncertain,' 'Less certain,' or 'Possible.' ... But **especially indicating where** that text is"
> P23: "**if it suddenly sounds human... Are you going to take it more realistically because it sounds human rather than a robot?**"

→ 문헌이 지지하는 것은 "신뢰도 87%" 노출이 아니라 ①발화 해상도를 오차 이하로 ②어디가 불확실한지를 자연어 한정어로 ③임계 미달이면 아예 말하지 않기[추론].

### 4.6 기타 참고 문헌

- Manduchi, R. & Coughlan, J. (2014). "The Last Meter: Blind Visual Guidance to a Target." CHI '14. https://pmc.ncbi.nlm.nih.gov/articles/PMC4241272/ — "maintaining in-FOV visibility... becomes **more challenging at closer distances**."
- Varshney et al. "Navigating the Last Mile" arXiv:2504.19345 — "Outdoors, traditional GPS lacks the **doorway-scale precision**."
- Froehlich, J. E. et al. (2025). arXiv:2508.15752 — "**agents need to report uncertainty and data provenance** to build trust."
- All_Aboard: 미터 대신 **호밍 톤 4단계**, 최고 주파수가 2m 이내.
- Gaunet, F. (2006). "Verbal guidance rules…" *UAIS* 4, 338-353. DOI 10.1007/s10209-003-0086-2 — **원문 확인 못 함**(페이월). 6 guidance function(Localization/Orientation/Crossing/Progression/Intersection/**Route ending**) 구조는 2차 소스 일치하나 예문 인용은 하지 말 것.

---

## 5. 방향 표현 + 센서 함정

### 5.1 Apple 공식 계약 [실측]

- `CLLocation.course` https://developer.apple.com/documentation/corelocation/cllocation/course: "**A negative value indicates that the course information is invalid.**"
- `courseAccuracy`: "the value in the course property is **plus or minus the specified number degrees**... **When this property contains a negative number, the value in the course property is invalid.**"
- `speed`: "**A negative value indicates an invalid speed.** ... **use this property for informational purposes only.**"
- `CLHeading.trueHeading`: "**Important:** This property contains a valid value **only if location updates are also enabled**"
- `headingAccuracy`: "**A negative value means that the reported heading is invalid, which can occur when the device is uncalibrated or there is strong interference from local magnetic fields.**"

⭐ **Apple이 직접 "보행 속도에서는 course 말고 heading"** https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/GettingHeadings/GettingHeadings.html:
> "The heading of a device reflects the actual **orientation of the device**... The course of the device represents the **direction of travel** and doesn't take into account the device orientation."
> "**At walking speeds, heading information would be more useful** for orienting the user to the current environment, whereas in a car, course information provides the general direction."

⚠ **그러나 heading은 기기 방향이라 몸 방향이 아니다** — WeWALK 제품 문서가 같은 함정을 경고: "If the phone is not facing the direction your face is facing... the directions will be shaped towards the direction the phone is facing." arXiv 2410.06400 실험은 "**swung by body side while walking (about 60-degree swing angle)**"을 조건으로 두고, "**GPS bearing is inadequate** for this task due to its inaccuracy and inherent delays"(약 2초 지연), 제자리 회전(SWR)에서 성능이 크게 떨어진다고 보고한다.

⚠ **속도 임계는 Apple 문서에 없다.** 공식 계약은 세 음수 가드뿐이다. Soundscape의 `speed >= 0.4`는 구현체 선택이지 API 계약이 아니다.

⚠ **8자 캘리브레이션 알럿은 시각 애니메이션 지시**다(`locationManagerShouldDisplayHeadingCalibration`). "prompts the user to **move the device in a particular pattern**" — 스크린 리더 사용자는 흔들 수는 있어도 **언제 끝났는지 알 수 없고**, 한 손이 흰지팡이에 묶이면 물리적으로도 성립하지 않는다[추론]. 또 "Core Location is able to filter out only those magnetic fields that **move with the device**".

### 5.2 한국어 관례 [실측 — 복지기관 공개 자료 4건]

- 시계 방향이 표준 안내법으로 등장: cncane.or.kr "길을 안내할 때는 '저기', '여기'라는 표현 대신 **시계방향(1시, 3시 방향 등)**을 사용해서" / 인천시각장애인복지연합회 "국은 감자국이구요, **10시 방향**에 김치가 있습니다."
- **그러나 서식지가 갈린다**[추론]: 수집한 자료 전수에서 **시계 방향은 식사 안내에 일관되게 나오고, 실제 보행 안내 기법 절에는 나오지 않는다.** 부산 자료의 안내보행 절은 전부 신체 기준("반보 뒤에서 반보 측면", "좌측이든 우측이든"), 문·계단도 "손잡이가 문의 **오른쪽에 있는지 왼쪽에 있는지**", "**바로 앞에** 올라가는 계단이 있습니다".
- 물리적으로 합리적이다: 식탁은 몸이 고정돼 12시가 안정적이지만 보행 중엔 12시가 매 걸음 바뀐다[추론].
- ⚠ 나무위키의 "동서남북 방위를 이용해 지도 위를 움직이듯"은 1차 출처가 아니고 Wayfindr 실측과 상충 방향이라 **근거로 쓰지 않는다**.
- **시계방향 vs 좌우 직접 비교 사용자 연구는 ASSETS/CHI/TACCESS/JVIB에서 찾지 못했다.** 현 최강 근거는 Wayfindr 트라이얼 보고이고 이는 동료심사 논문이 아니라 표준 문서다.

### 5.3 상용 제품의 수렴 [실측]

| 제품 | 방향 규약 |
|---|---|
| Sendero | Clock+R/L(기본) / Clock / R/L 선택 |
| GoodMaps(Indigo) | Clock(기본) / Slight L-R 선택 |
| Lazarillo | Relative / Cardinal / Clock 선택 |
| BlindSquare | 시계 / 도 / 방위 선택 |
| Nearby Explorer | Cardinal / Clock / Degrees 선택 |
| WeWALK | Clock / Geographical(“**advanced guideline**”) 선택 |
| **Soundscape** | **8버킷 상대 방향 고정 — 유일하게 선택지를 두지 않음** |
| Waymap | 시계 전용 |
| G-EYE(한국) | 진동 정렬 + (저시력판) 시계 |

**6/9가 사용자 설정으로 둔다.** Wayfindr의 "One size does not fit all"에 대한 업계 공통 대응으로 보인다[추론].

---

## 6. 국내 정적 데이터 — 건물 출입구·형상

### 6.1 결론: 출입구 좌표는 얻을 수 있다 [실측]

**행안부 좌표제공 API** `https://business.juso.go.kr/addrlink/addrCoordApi.do` (data.go.kr 미러 **15056663**)

- 응답에 `entX`/`entY` = **건물 출입구 좌표**. + 건물관리번호·건물명
- **좌표계 EPSG:5179**(UTM-K/GRS80)
- 파라미터 `admCd`·`rnMgtSn`·`udrtYn`·`buldMnnm`·`buldSlno` — **전부 우리가 이미 쓰는 `addrLinkApi.do` 검색 응답에 있다.** 실응답 확인: `admCd=1174010800, rnMgtSn=117403124006, udrtYn=0, buldMnnm=12, buldSlno=0`
- 무료, **신청 즉시 자동승인**, 1시스템 1승인키

⚠ **실측 함정 둘**:
1. 보유한 `JUSO_CONFM_KEY`(검색용)로 호출하면 `E0001 "승인되지 않은 KEY 입니다"`. **별도 승인키가 필요하다.**
2. 파라미터가 빠진 상태에서는 `E0002`(파라미터 누락)가 먼저 떠서 **키가 유효한 줄 착각하기 쉽다.** 키 검증은 파라미터를 다 채운 요청으로 한다.

⚠ **15057559는 팝업API**로 브라우저 UI형이라 서버 호출용이 아니다(이름이 비슷해 혼동 주의).

### 6.2 파일 배포형 (심사 필요)

| | data.go.kr | 담는 좌표 | 라이선스 |
|---|---|---|---|
| 위치정보요약DB | 15050410 | 도로명주소 + **주출입구** X,Y | 공공누리 1유형 |
| 내비게이션용DB | 15050419 | **건물중심점 + 주출입구 + 보조출입구** | 제한 없음 |
| 도로명주소 전자지도 | 15050413 | 11종 레이어 중 **출입구**·건물·**실폭도로**·기초구역 | 공공누리 1유형 |

- 보조출입구는 **건물 6개 이상 집합건물**(아파트 단지)일 때 제공. 시도별 분할 + **변동분 자료**로 증분 갱신
- 좌표계 전부 EPSG:5179. 전자지도 레이어 파일명 규약: 건물 `TL_SPBD_BULD.shp`, 실폭도로 `TL_SPRD_*`
- ⚠ 도로명주소법 시행령 제46조·시행규칙 제53조에 따라 **신청서 + 이용목적 심사**. 즉시 발급 아님
- ⚠ **공공누리 제1유형 = 출처표시, 상업적 이용 가능 + 변형 가능.** data.go.kr 페이지 자동요약이 "non-commercial"로 잘못 나와 KOGL 원문(https://www.kogl.or.kr/info/license.do)으로 교차 확인했다. 상업 금지는 2·4유형이다

### 6.3 건물 폴리곤

**국토교통부_도로명주소 건물 API** (data.go.kr **15059078**) — "새주소 건물의 **도형**, 속성 조회", OGC/WFS 계열, 무료, 공공누리 1유형. **우리가 이미 가진 `DATA_GO_KR_API_KEY` 계정에서 활용신청만 추가**하면 되고 라이선스가 명확해 VWorld보다 낫다. 좌표계·응답 필드 상세는 **확인 못 함**.

### 6.4 명확히 안 되는 것 [실측]

| 소스 | 판정 |
|---|---|
| **건축물대장 API**(건축HUB 15134735) | **좌표 전혀 없음.** 오퍼레이션 10종(기본개요/총괄표제부/표제부/층별개요/부속지번/전유공용면적/오수정화시설/주택가격/전유부/지역지구구역) 어디에도 위경도·X/Y 없음. 면적·층수·구조·용도·허가일·에너지등급뿐 |
| **카카오 로컬 API** | 응답 필드 전체가 `id, place_name, category_name, category_group_code, category_group_name, phone, address_name, road_address_name, x, y, place_url, distance`. **형상·출입구·층/호수 없음**(공식 문서 + repo `KakaoLocalDocument` 양쪽 일치) |
| **OSM `entrance`** | 커버리지 실패 — §6.5 |

### 6.5 OSM 전국 실측 (Overpass 직접 호출) [실측]

bbox 33.0,124.5–38.7,131.0:

| 항목 | 개수 |
|---|---|
| `building` (way) | **2,847,503** |
| `entrance=*` (node) | **21,739** |
| `entrance=main` | 1,480 |
| `entrance` + `wheelchair` | **609** |
| `railway=subway_entrance` | **4,669** |

국토부 2024 전국 건축물 **7,421,603동** → OSM 건물 커버리지 약 **38%**, **출입구/실제건물 = 0.29%**.

반경 300m 지역별 (building / entrance / main):

| 지점 | building | entrance | main |
|---|---|---|---|
| **서울 강동구 길동** | 78 | **0** | 0 |
| 강남역 | 253 | **0** | 0 |
| 판교역 | 49 | **0** | 0 |
| 부산 서면 | 394 | **0** | 0 |
| 홍대입구 | 635 | 2 | 0 |
| 여의도 IFC | 41 | 3 | 0 |
| 서울시청 | 198 | 8 | 2 |

국내 최고 밀도인 서울시청조차 반경 150m 건물에 붙은 출입구는 2개:
```
node/3460606096 (37.5664702,126.9785258) {entrance: main}
node/3806615943 (37.566675,126.9778217)  {entrance: yes, name:en: West Entrance}
```

**건물 태그 품질**(길동 60동 표본): `addr:district` 50/60 · `addr:city` 47/60 · `building:levels`·`height` 각 17/60 · **`addr:housenumber` 5/60(8%)** · `name` 6/60 → **도로명주소로 OSM 폴리곤을 매칭하는 방식도 대부분 실패**한다.

동작 확인된 쿼리:
```overpassql
[out:json][timeout:90];
way[building](around:150,37.5665,126.9780)->.b;
(.b;>;)->.all;
node.all[entrance];
out body;
```
`User-Agent` 필수(누락 시 406), 연속 호출은 429로 HTML 에러 페이지(백오프 필요).

**→ OSM은 건물 출입구용 폐기. `subway_entrance` 4,669개는 커버리지가 양호해 지하철 출구용으로만 유효.**

### 6.6 목록 밖 발견 — Google Geocoding API v4 `SearchDestinations`

정확히 이 문제를 위해 설계된 API다: `entrances[]`(`location`, `entrance_tags[]` PREFERRED, `streetViewThumbnail`) · `navigationPoints[]`(`travelModes` DRIVE/WALK, `usages` DROPOFF/PICKUP/PARKING) · `displayPolygon`(GeoJSON) · `landmarks` · `structureType` · `arrivalSummary`. 좌표 WGS84. https://developers.google.com/maps/documentation/geocoding/search-for-destinations

⚠ **한국 커버리지 확인 못 함.** 문서에 "Functionality varies by region"만 있고 국가 목록이 없다. 이 repo 교훈([[google-routes-no-korea-walk-drive]]: 한국은 200+빈 배열로 조용히 부재)을 보면 회의적이나 **실호출 1회로 판정 가능**하다.

### 6.7 좌표계 함정 (재확인)

juso 계열은 전부 **EPSG:5179**(UTM-K/GRS80)이고, 이 repo가 이미 쓰는 **EPSG:2097**(에어코리아)·**5181**(카카오)·**5186**(음향신호기 OA-15543)과 **모두 다르다.** false E/N이 비슷해 혼동하기 쉬우니 provider 내부에서 명시 분리한다.

---

## 7. 안티패턴 9종

| # | 안티패턴 | 근거 |
|---|---|---|
| 1 | **도착 존에서 침묵** — 존 진입을 한 번 알리고 입을 닫으면 가장 어려운 구간이 무안내가 된다 | 위원장 피드백 + 우리 코드 실측. Sendero가 정확히 이 구간에 Getting Warmer를 켠다 |
| 2 | **도착 판정이 풀리지 않아 소리가 안 끊김** | AFB 리뷰[2차]: "I had to stop walking soon after the beacon was announced or else the beacon would not automatically end." |
| 3 | **도로 한복판에서 "도착했습니다"** | O&M 전문가 현장 테스트[2차]: Google Maps가 사용자가 차도 위에 있는데 도착 선언 |
| 4 | **길 어느 편인지 안 알려줌** → 목적지 건너편 도착 | 같은 출처. Nearby Explorer의 홀짝 번지 안내가 대응책 |
| 5 | **거짓 정밀도** — 오차 10m 구간에서 "3미터 남았습니다" | Soundscape가 15m 미만 수치를 빼는 설계로 회피, RouteNav "turn in 1 meter" 금지 |
| 6 | **정지 상태에서 상대 방향 발화 = 방향 반전 위험** | Apple 문서(음수=무효) + Soundscape 3중 게이트 |
| 7 | **과잉 발화가 환경음을 덮는다** | Loomis 2005, Wayfindr 설계 원칙 |
| 8 | **걸음 수로 안내** | Wayfindr 명시 반대(보폭 변동 + 세는 부담) |
| 9 | **직선거리만 주고 경로 방향이 없음** | 서인환 칼럼의 핵심 불만 — 우리 비콘의 현 상태와 같은 형태 |

---

## 8. 확인하지 못한 것 (후속 조사 대상)

- **7개 앱 전부의 도착 순간 실제 발화문.** 앱 직접 설치 실측 또는 데모 영상 전사 필요(NaviLens https://www.youtube.com/watch?v=AwWlv8aBzXY , GoodMaps https://www.youtube.com/watch?v=38V-L7ShOAE)
- **Google Maps 최종 접근 동작 전체**(미착수)
- **Apple Maps "destination is on your left/right" 존재 여부** — AppleVis 403. **있다고 가정 금지**
- **Gaunet & Briffault 규칙 세트 원문**(Springer/RG/Cairn 전부 차단)
- NavCog3(TACCESS 2019, ACM 403) / Commute Booster(IEEE 유료) / CaBot / **ANSI/CTA-2076** / ISO 21542 §5.1 본문
- **VWorld 상업적 이용 가능 여부** — 약관 페이지 WAF 차단. 상용 앱 적용 전 공간정보산업진흥원(1661-0115) 직접 확인 필요
- 도로명주소 전자지도 출입구 레이어의 컬럼·파일명·파일 크기 / 위치정보요약DB 컬럼(심사 통과 후 확인 가능)
- 네이버 Maps·Tmap 출입구 필드 — 문서에서 못 찾았으나 "없음"을 확증하지도 못함
- 서울 열린데이터 지하철역 **출구별** 좌표(전국도시철도역사정보 15013205는 역 대표점만) / AI-Hub 보행 데이터 / BF 인증 시설 데이터
- 한국 O&M 훈련의 방향 지시 관례 — **위원장 본인의 경험이 어떤 문헌보다 신뢰도 높은 1차 자료**다
- 도심 나침반 오차 대표값 — 신뢰할 1차 수치 미확보. 설계는 상수가 아니라 런타임 `headingAccuracy` 실측값에 걸어야 한다

---

## 9. spec에 반영된 것 / 반영하지 않은 것

**반영**(`2026-08-08-final-approach-guidance-design.md`): Sendero 15초·2분·인계 조건 / Soundscape 15m·30m 히스테리시스·거리 사다리·course 3중 게이트·"방향 미상은 볼륨으로" / Wayfindr route ending 정의 / Padmanaban & Krukar 검증 가능성 기준 / Ahmetovic 오차 예산 → 4분할 / RouteNav `horizontalAccuracy` 불신 / 마스킹 방어 → "시점을 앞당긴다"

**반영하지 않음(근거와 함께)**:
- **시계 방향** — §4.3 오차 예산 + Wayfindr 격하 + 한국 관례가 식탁 맥락. 도입하려면 설정 선택지여야 하고 기본값이 될 수 없다
- **걸음 수 단위**(Waymap) — Wayfindr 명시 반대
- **인간 원격 지원 핸드오프**(GoodMaps→Be My Eyes) — 스코프 밖이나, "자동화가 닿지 않는 곳을 숨기지 않는다"는 정신은 3-state와 같다
- **물리 태그**(NaviLens·RightHear 비콘) — 인프라 설치가 전제라 앱 단독으로 불가
- **Soundscape "Around Me" 4분면 알고리즘** — 최종 접근에는 1개만 쓰기로 해서 분면 분할이 불필요. 다만 "내 주변" 도메인 확장 시 재검토 가치가 있다
- **Wayfindr countable delimiters("문을 세라")** — 우리에게 문 개수 데이터가 없다. 출입구 API가 붙고 집합건물 보조출입구까지 확보되면 재검토

---

## 10. 2차 조사 보강 (2026-08-08 오후, 병렬 6팀)

§5·§6·§8의 여러 "확인 불가"를 닫은 후속 조사다. **§6 국내 정적 데이터 절의 결론이 바뀌었으므로 그 절보다 이 절이 우선한다.**

### 10.1 4분할 채택의 정량 근거 확보 (§5 보강 — 출하 코드를 방어한다)

Ahmetovic et al., ASSETS'18 [`10.1145/3234695.3236363`](https://doi.org/10.1145/3234695.3236363), 전문 <https://mascetti.di.unimi.it/Sergio_Mascetti_-_home_page/Publications_files/2018_ASSETS_TurnRight.pdf> — 시각장애인 11명, 회전 286회 로그.

| 측정 | 값 |
|---|---|
| 전체 평균 회전 실행 오차 | **14.9° (SD 9.9)** |
| 완만한 회전(22.5~60°) | 17.4° (SD 4.0) |
| 큰 회전(60~120°) | 13.4° (SD 3.7) |
| 전맹 vs 잔존시력 | 14.96° vs 14.46° — **유의차 없음** |
| 조기실명 vs 후기실명 | 14.21° vs 15.01° — **유의차 없음** |
| 90° 교차로 성공률 | 88.3% (SD 12.0) |
| 45° 교차로 성공률 | 73.0% (SD 16.7) |

⚠ 논문 내부 불일치: 초록·결론은 "17°", 본문 측정표는 "14.9°". **본문 값을 정본으로 인용**하고 17°는 "과회전 경향" 서술로만 쓴다.

**오차 예산 사다리** — 인간의 순수 신체 실행 오차 14.9°에 대비한 버킷 여유:

| 표현 | 버킷 폭 | 허용 오차 | 14.9° 대비 |
|---|---|---|---|
| 시계 12방위 | 30° | ±15° | **동급 — 노이즈에 잠긴다** |
| 8방위 | 45° | ±22.5° | 1.5배 |
| **앞·뒤·좌·우 4분할** | **90°** | **±45°** | **3배** |
| "45도 우회전" | ~15° | ±7.5° | 실행 불가 |

§3.1이 채택한 4분할과 §2.7의 시계 12분할 기각이 이 표로 정량 확증됐다. 종전 §2.7의 유보("회전 오차 연구가 4분할을 직접 검증한 것은 아니다")는 여전히 참이지만, **버킷 폭이 인간 오차를 얼마나 덮는가**라는 축에서는 직접 근거다.

**교차 확인**: Wayfindr Open Standard가 시계 방향을 "general direction으로만" 쓰라고 격하하고("difficult to distinguish between 1 and 2 o'clock"), 젊은/선천 실명 사용자에게 아날로그 시계 은유가 혼란스럽다고 기술한다. WeWALK 스마트 지팡이는 3종(시계·방위·상대)을 **사용자 설정**으로 제공하며 방위는 "상급자용"이라고 명시한다. 표준의 최종 결론은 **"One size does not fit all"**이다 → 시계 방향을 도입한다면 **설정 선택지여야 하고 기본값이 되어선 안 된다**.

### 10.2 course vs heading — Apple 계약 원문 (§5 보강)

- `CLLocation.course`: "The direction in which the device is traveling... **A negative value indicates that the course information is invalid.**"
- `courseAccuracy`: "the value in the course property is **plus or minus the specified number degrees**... a negative number → invalid"
- `speed`: "**A negative value indicates an invalid speed**... use this property for informational purposes only."
- `CLHeading.headingAccuracy`: "A negative value means that the reported heading is invalid, which can occur when the device is **uncalibrated or there is strong interference**."

⚠ **Apple 1차 문서에 "속도 X m/s 미만이면 course 무효"라는 임계값은 없다.** 공식 계약은 세 음수 가드뿐이다. `courseStep`의 `COURSE_MIN_SPEED_MPS = 0.4`·`COURSE_STALE_S = 3`은 Soundscape 구현값(§2.3)이지 Apple 계약이 아니며, 그 출처 구분을 흐리지 않는다.

Apple 아카이브 가이드는 **"At walking speeds, heading information would be more useful for orienting the user to the current environment, whereas in a car, course information provides the general direction of the car's movement."**라고 한다. ⚠ **이것이 `course` 대신 `heading`을 쓰라는 근거는 아니다** — 두 값이 답하는 질문이 다르다. `heading`은 **기기가 향한 방향**이고 `course`는 **이동 방향**인데, 최종 접근의 "목적지가 왼쪽"은 *몸이 가는 방향* 기준이라 `course`가 맞는 축이다. 근거 셋:
1. WeWALK 제품 문서 경고: "**If the phone is not facing the direction your face is facing... the directions will be shaped towards the direction the phone is facing.**"
2. arXiv 2410.06400 실험: 팔을 흔들며 걸을 때 **약 60° 요동**(시계 버킷 2칸 폭). "the performance of the IG method drops significantly when the smartphone is not held in hands"
3. 흰지팡이 사용자는 한 손이 지팡이에 묶여 있어 기기 자세가 몸 방향의 대리 지표가 되지 못한다(MIT Tech Review의 NaviLens 인터랙션 설계가 같은 전제를 명시한다).

같은 논문이 GPS bearing의 한계도 준다: **약 2초 응답 지연**, 제자리 회전 시 미정의("GPS performance... deteriorates significantly during SWR"). `courseStep`의 이동·속도·워치독 3중 게이트가 정확히 이 구간을 막는다.

⚠ **8자 캘리브레이션은 접근성 해법이 아니다**: Core Location의 캘리브레이션 알럿은 **시각적 애니메이션 지시**라 스크린 리더 사용자는 언제 끝났는지 알 수 없고, 양손이 이미 차 있다. "캘리브레이션을 요구하면 해결"이라는 폴백은 이 사용자층에서 성립하지 않는다.

⚠ 도시 나침반 오차의 **대표값은 확보 실패**(후보 2건 모두 원문 403 미검증, 인용 금지). 설계는 상수가 아니라 **런타임 정확도 실측값**에 걸어야 한다.

### 10.3 상용 앱의 최종 접근 처리 (§2 보강)

| 앱 | 방향 규약 | 거리 단위 | 도착·근접 임계 | 도착 발화 원문 |
|---|---|---|---|---|
| Wayfindr(표준) | 6종 병렬, 방위는 비선호 | 미터 회의적, **랜드마크 권장** | 규정 없음, "물리 배치 설명" 요구 | 있음 |
| Waymap | 시계 전용 | **걸음 수** | 1m 정확도 주장 | 없음 |
| GoodMaps/Indigo | 시계 **기본**, 좌우·둘다 선택 | m 또는 ft | **50~100ft 사용자 설정** | 없음 |
| Lazarillo | 상대·방위·시계 3종 선택 | m/ft | 교차로 50m 예고(**"too far" 불만**) | 없음 |
| NaviLens | 음성 아님, **비프 가속** | 미터 | 태그 탐지 12~18m | 없음 |
| RightHear | 미명시(폰 지향) | **N미터 주기 사용자 설정** | **오차 자체를 노출** | 부분 |
| Apple Maps | 미문서화 | 미문서화 | 도착 시 긴 진동(Watch) | 없음 |
| G-EYE(한국) | 시계 + 미터 | 미터 | **15m 간격 반복** | 없음 |

**조사 대상 7개 앱 중 도착 발화문을 공개한 곳은 0개다.** 이것을 우연으로 보지 않는다 — 도착 순간은 GPS 오차가 안내 정밀도를 초과하는 구간이라 벤더가 문서화할 만큼 확신 있는 문장을 못 만든 것으로 읽힌다. **GoodMaps가 마지막 몇 미터를 Aira·Be My Eyes 원격 인간 지원으로 명시 핸드오프하는 것이 그 자백이다.**

"마지막 몇 미터"의 해법은 셋뿐이고 **순수 GPS + 지도 API로 푼 앱은 조사 범위에 없다**: ⓐ정확도로 밀어붙이기(Waymap IMU 추측항법, GoodMaps 카메라 측위) ⓑ물리 인프라 심기(NaviLens 태그, RightHear 비콘) ⓒ인간에게 넘기기. 셋 중 어느 것도 못 하는 구조에 남는 정직한 선택지가 **"목적지 주변의 물리적 배치를 텍스트로 서술"**(Wayfindr route ending 정의)이고, 그것이 §3.3이 하는 일이다.

**임계값 실측 범위**: G-EYE 15m 간격 · Lazarillo 50m 예고에 "too far" 불만 · GoodMaps 도착 50~100ft(15~30m). → `ARRIVE_M = 15`가 그 범위 하단이고 **폐기한 50m 인계가 "이미 너무 멀다"는 실사용 반례를 얻었다**.

⚠ **Apple Maps의 "destination is on your left/right" 문구는 존재를 확인하지 못했다**(AppleVis 전면 403). 있다고 가정하지 않는다.

### 10.4 랜드마크의 목적 — "목록"이 아니라 "정위" (§3.7 보강)

에이블뉴스 서인환 칼럼(G-EYE 1주일 실사용, <https://www.ablenews.co.kr/news/articleView.html?idxno=99521>) 원문:

> "시각장애인들은 주변에 어떤 시설물이 있는지보다 **주변 시설물을 통하여 현 위치를 파악하는 데** 더 주변 정보를 활용한다."

> "그런데 평소 사용하지 않는 **주소로 알려주는 것은 정보 활용도가 낮다.** 주소를 듣고 현재 위치를 상상할 수 있는 것은 아니기 때문이다."

> "'주변 시설'은 한 줄에 하나씩 현 위치에서의 거리를 보여준다. 이 정보는 직선거리로 얼마나 떨어져 있는지는 알 수 있지만 **경로를 알려주지는 않는다.**"

같은 칼럼의 반면교사: 원거리 경로 요약("꺾는 곳 140번, 횡단보도 75번")은 "재미로 볼 수는 있겠으나 이런 정보가 보행에 도움이 되지는 않는다". 정확도 실측은 혹독하다 — "방향을 잘못 알려주는 경우가 많다. **20번을 시도했더니 한번이 정확했다**", "10분이면 갈 수 있는 거리를 4시간 동안 헤매고도 도착하지 못했다". 음향신호기/음성유도기 스마트폰 연동 보급률 **3.35%**(2022-08 기준).

→ §3.7이 랜드마크를 **최대 1개**로 제한하고 **방향+거리를 함께** 요구한 것이 이 관찰과 정합한다. 목록을 늘리는 방향은 이 근거가 지지하지 않는다.

### 10.5 국내 출입구·랜드마크 데이터 — §6의 결론 교체

**§6은 "건축물대장에 좌표가 있는지"를 미확인으로 남겼는데, 없다는 것이 확정됐다.**

| 소스 | 출입구 좌표 | 좌표계 | 취득 난이도 | 치명적 제약 |
|---|---|---|---|---|
| 건축물대장(건축HUB 15134735) | **없음** | — | 자동승인 | 필드 명세 2,208줄 전수 스캔 결과 좌표·형상·출입구 **매치 0건**. 위치는 문자열 주소 3종뿐 |
| 카카오 로컬 | **없음** | — | 보유 | 카카오 공식 답변: "영역 정보를 제공하고 있지 않기 때문에" |
| 네이버(Geocoding·지역검색·Directions) | **없음** | — | 보유 | `goal`은 좌표만, 출입구 파라미터 없음 |
| **Tmap POI** | **있음** `frontLat`/`frontLon` | WGS84 | **보유** | ⚠ 약관 **"저장 후 24시간 이상 사용 금지"** → 정적 축적 불가. `endPoiId`는 경로를 바꾸지 않는다(실측 동일 1,271m) — front 좌표를 목적지로 직접 넘겨야 한다 |
| **서울시 보행자 출입구 정보**(OA-21699 / 15112106) | **있음** | **WGS84** | **즉시 다운로드**(심사 없음) | 부모 시설 **3,212건·용도 10종 한정**(일반 상가·카페 없음), 파일 실수정일 2023년 |
| juso 내비게이션용DB | **있음** + **보행자용 구분** | EPSG:5179 | **이용목적 심사**(기간 미확인) | 좌표 계열은 "제공하는 주소"라 심사 대상 |
| juso 좌표제공 API | 있음(entX/entY) | EPSG:5179 | 키 즉시 자동승인 | ⚠ **주소 문자열을 안 받는다** — admCd·rnMgtSn 선행 조회 필요한 2단계 + **5초 10건** 제한 |
| (도로명주소)출입구 SHP(vworld) | 있음 | EPSG:5179 | 로그인 | 속성 컬럼·라이선스 **미확인**("지정되어 있지 않습니다") |
| VWorld 오픈API | — | — | 키 발급 | ⚠ 약관 제19조 6항 **"데이터를 무단으로 저장하지 못합니다"** → 정적 seed 경로로 불가 |
| BF 인증 시설(15014781) | **없음**(주소도 없음) | — | 즉시 | 시군구+시설명뿐이라 지오코딩 불가 → **배제** |

**juso 좌표 API 키의 성격이 확정됐다**: 검색용 `JUSO_CONFM_KEY`로 좌표 API를 부르면 `E0001`이고, 공식 오류표가 그 코드에 "**(검색API 승인키 사용불가)**"를 괄호로 명시한다. 좌표제공용 키를 **따로** 신청해야 하며 발급 자체는 즉시 자동승인이다. 단 위 표의 2단계·레이트리밋 때문에 **실시간 경로로는 부적합**하다.

**실측 보정량**: 세종 한누리대로 1811 기준 건물중심점 ↔ 출입구 **8.77m**(EPSG:5179 역변환 직접 검증). ⚠ 에어코리아 EPSG:2097·음향신호기 EPSG:5186과 **모두 다른 좌표계**다 — 기존 변환 유틸 재사용 금지.

**내비게이션용DB의 결정적 필드** — 보조출입구 테이블 `출입구유형`: `01` 공용 / `02` 차량용 / **`03` 보행자용**. 차량용 출입구로 시각장애 보행자를 보내면 위험한데, **이 구분은 상용 지도 API 어디에도 없다.** 별도로 도로명주소 건물 도형 SHP의 **연결선** 레이어가 출입구→도로구간의 **방향(L/R)과 거리**를 준다("도로에서 12m 안쪽" 안내의 재료).

⚠ 위치정보요약DB 주석: **"비공개·공개제한 건물은 위치값 미제공"** → "출입구 없음"과 "출입구 미제공"을 3-state로 갈라야 한다.

### 10.6 전국횡단보도표준데이터 — 예상 밖의 대어 (§3.7·기존 음향신호기 seed 관련)

[15028201](https://www.data.go.kr/data/15028201/standard.do). 위경도와 함께 **음향신호기설치여부·점자블록유무·보도턱낮춤여부**를 **한 행에** 담는다. 그 외 차로수·횡단보도폭·연장·보행자신호등·녹색/적색신호시간·교통섬유무.

→ 앱이 쓰는 **서울 한정 OA-15543(EPSG:5186)을 전국으로 확장할 대체재**이고, **좌표를 가진 음향신호기**를 준다. ⚠ 55개 지자체가 각자 올리는 구조라 채움률 편차 검증이 필요하고, EPSG 명시값·총 건수는 미확인(표준데이터 관례상 WGS84로 보이나 확정 아님). 반기 갱신.

### 10.7 지하철 출입구는 OSM이 공공데이터보다 낫다

전국도시철도역사정보표준데이터(15013205)는 **역 단위 좌표만** 주고 출구 개념이 없다. t-data `tnSubwayEntrc.csv`는 컬럼명이 "지하철역X좌표"인데 미리보기 100행 분석 결과 **좌표가 정류장ID를 따라가고 출입구를 따라가지 않는다**(정류장 65개 중 좌표 갈리는 것 2개 vs 출입구 59개 중 12개). 좌표계도 확정 불가(TM 중부원점 계열로 보이나 2097·5181·5174 어느 쪽으로 역산해도 2km 어긋남). 서울교통공사 OA-15993(출구번호별 주변시설)은 **2024-12-02 서비스 종료**.

→ 출입구 **좌표는 OSM 유지**, 공공데이터는 **속성 보강**으로만(리프트 위치, 출구별 주변건물, 출구↔정류장 도보거리). t-data의 `주변건물`은 OSM에 없는 정보다("2번 출구로 나가면 KFC가 있습니다").

### 10.8 이 절이 닫은 §8 항목과 새로 연 것

닫음: 건축물대장 좌표 유무 · 카카오/네이버 출입구 필드 유무 · juso 좌표 API 키 성격 · 4분할의 정량 근거 · 상용 앱 임계값 범위.

새로 연 것: 전국횡단보도표준데이터의 EPSG·채움률 · 한국사회보장정보원 장애인편의시설 API(15092317)의 위경도 필드 유무(자동승인·개발 100회/일이라 **실호출이 가장 빠른 확인 수단**) · (도로명주소)출입구 SHP의 속성 컬럼·라이선스 · juso "제공하는 주소" 심사 소요 기간.
