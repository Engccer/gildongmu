# App Store 릴리스 노트 (What's New)

버전별 What's New의 **정본**. ASC에 입력하는 문구 그대로 둔다.

- 제출 절차·ASC 입력값(설명·키워드·영양 라벨·심사 노트)·함정은 [`1.0-submission-draft.md`](1.0-submission-draft.md)가 정본이다.
- 앱·웹·CLI를 아우르는 날짜별 개발 이력은 [`CHANGELOG.md`](../../CHANGELOG.md).

**작성 규칙**:
- **iOS 사용자에게 보이는 변경만** 담는다. 웹 전용 변경은 push 즉시 배포되므로 "이 업데이트의 새 기능"이 아니다. 리팩토링·테스트·문서도 제외.
- 서버 변경도 원칙적으로 제외하되, **서버 판정과 앱 UI가 짝인 기능**은 그 앱 버전에서 처음 보이므로 포함한다(1.2의 운행 밖 표기가 그 사례).
- 새 버전 초안은 **프로모션 텍스트를 승계하지 않는다**. 설명·키워드·URL은 승계되므로 프로모션 텍스트만 따로 확인한다(비운 채 제출하면 스토어에서 그 줄이 사라진다).

---

## 1.14 (빌드 22)

기준은 1.13 아카이브 커밋 `df229f0`(빌드 21)이며 그 이후 `ios/` 커밋 37건을 판정했다. Release 바이너리에 도달하면서 iOS 사용자에게 보이는 것만 담는다.

포함 판정:

| 기능 | 커밋 | 노트 |
|---|---|---|
| **장소 상세 영업시간 한 줄이 정식판 승격**(E24 — `experimentalPlaceHoursEnabled` 검사 삭제, 문구를 `messages/placeHours.*`로 이관해 웹과 공유) | `ed7b5e1`·`8fce075` | ko·en(로케일 게이트 없음). 실험판에만 있던 기능이라 정식판 사용자에겐 이 버전이 처음이다 |
| 이탈 시 자동 재조회를 확인 없이 즉시 채택 + 고지(E10ⓑ 개정 — 수락제 폐기, `guide.autoReroute` `.high`) | `bf54653`·`555124a` | ko·en. ⚠ `PROGRESS.md`가 이 계층을 "iOS Experimental"이라 적고 있었으나 `BeaconModel`·`BeaconTrackingSheet`에 `EXPERIMENTAL` 게이트가 0건이다(spec은 2026-08-12 작성분이고 1.7 도보 졸업이 이 계층을 정식판으로 데려갔다). 5단계에서 PROGRESS를 고친다 |
| 간략 세션 도착 창(A31 축 ①) — 상세 경로 없이 도는 세션도 `nearby` 래치 ∧ 정확도 ≤30m면 도착 추정으로 종료 | `59b7a8d`·`cc1d955`·`6195a60` | ko·en. 종전엔 국면 게이트를 못 지나 20분 무이동 안전망만이 출구였다(2026-09-01 등굣길 실보행) |
| 30분 지난 종료 화면 소거 + 종료 상태 문장 잔존 판별선을 실패 상태로(A31 축 ②·③) | `a288473`·`fbe31c3` | ko·en |
| 조각 구분자 가운뎃점 → 쉼표(A30, 따릉이 `availability`·공기질 `station`) + `walkInfra.osmSummary` 슬래시 → 접속사(A29 후속) | `dc0bf32`·`d87786f` | 가운뎃점은 ko 포함 6로케일, 슬래시는 en 계열. 둘 다 SR이 기호를 낱말로 낭독하던 자리 |
| **비한국어 로케일의 한국어 잔존 제거 묶음** — 대중교통 경로·역 정보 영문(E27 브리핑·역 메타·첫차/막차·도착 문장), 장소·역 이름 로마자 병기(E28), 카카오 분류 영문(A28), 서버 합성 한국어의 앱 조립(A26 역 시설·시간표·무장애 편의시설·오류 낭독), 수량 문구 복수형(A29) | `795efa5`·`1d51184`·`5813fa2`·`cf19c5f`·`e86d5d1`·`db8f60d`·`d4d113d`·`9adec3b`·`0044be3`·`f19a3f1`·`763ae1d` | **en(비-ko)만.** ko 출력은 불변이다. Release 도달면은 `RouteBriefing`(대중교통 브리핑)·`StationSections`(역 정보)·`SearchView`/`PlaceDetailView`/`Nearby*`(장소·분류·병기)·`BarrierFreeInfoSection` |

제외 근거:

- **승차 전 도보 핸드오프**(A25 `56a550f`·`204290a`·`a2d4e6b`·`f2db848`): 대중교통 세션 안이라 `AppConfig.experimentalGuidanceEnabled` 봉인 안.
- **자동차 세션 종료 보강**(K2-a `4a1c2bf`·`3db1ad8`): 같은 봉인 안.
- **대중교통 실시간 안내의 en 게이트 해제**(E27 잔여 ① `77fbb50`·`0a1c0ba`·`9fd465f`·`dbee107`·`c0096f9`·`65fb72f`·`5c2a71b`·`df4b458`·`a9e965d`): 게이트가 열린 것은 로케일 축이고 세션 자체는 여전히 실험판 봉인이다. 정식판 사용자에게는 대중교통 실시간 안내가 존재하지 않는다. 같은 커밋의 **브리핑·역 정보 영문 투영은 Release 도달**이라 위 묶음에 담았다.
- **웹 전용**: `dbee107`(웹 훅·패널 재배선), `8fce075`의 웹 `PlaceHoursLine`, A26·A28·E28의 서버·웹 분. 서버 변경은 직전 버전 사용자에게 이미 닿았다.
- 문서·테스트·생성물·리뷰 반영 커밋 중 동작 변경 0인 것 전량.

심사 노트는 이번 버전에서 **승계한다**(`--review-notes` 없음). 영업시간 조회로 Google Places가 정식 빌드에 처음 들어가지만 **새 권한·새 데이터 유형이 아니다**(보내는 것은 장소 이름·좌표·도로명 주소이고 사용자 현재 위치는 보내지 않는다 — 웹 privacy `placeHours` 문안이 정본, `PrivacyInfo.xcprivacy`·ASC 영양 라벨 무변화). §9 문장 중 이번 변경으로 거짓이 된 것도 없다.

### ko

```
새로운 기능
- 장소 상세에 오늘 영업시간이 한 줄로 나옵니다. 출처는 Google Maps이며, 확인할 수 없는 장소에서는 그 줄이 나타나지 않습니다.

개선
- 도보 안내 중 경로를 벗어나 새 경로를 찾으면 확인 절차 없이 바로 그 경로로 안내를 이어 가고, 바뀌었다는 사실과 첫 안내를 알려 드립니다.
- 상세 경로 없이 목적지 방향과 거리로만 안내하는 중에도 목적지 부근에서 걸음이 멈추면 도착으로 안내를 마칩니다. 그동안은 안내가 계속 켜져 있었습니다.
- 끝난 지 30분이 지난 안내의 종료 화면은 앱으로 돌아왔을 때 더 이상 뜨지 않습니다. 길찾기 화면 맨 위에 종료 사유 문장이 계속 남던 것도 함께 고쳤습니다.
- 따릉이 대여 정보와 공기질 측정소 줄의 구분 기호를 가운뎃점에서 쉼표로 바꿨습니다. 화면 낭독에서 기호가 낱말로 읽히지 않습니다.
```

### en

```
New
- Place details now show today's opening hours on one line, sourced from Google Maps. The line does not appear for places whose hours cannot be confirmed.
- Public transit and station information now reads in English. Subway and bus line names, station names, arrival messages, station facilities, first and last train times, accessible-facility details, and place categories are shown in English wherever an English source exists.
- Place and station names with no English source are now written in the Latin alphabet, with the Korean name in parentheses. Screen readers announce only the Latin form.

Improved
- Sentences the app used to receive already written in Korean, including spoken error messages, are now composed in your app language.
- Counted phrases now use the correct singular and plural forms.
- When walking guidance goes off route and finds a new one, it now switches to that route immediately, with no confirmation step, and tells you it changed along with the first instruction.
- Guidance that has fallen back to direction and distance only now ends as an arrival when you stop near the destination. Until now it stayed on.
- An end-of-guidance screen from a session that finished more than 30 minutes ago no longer appears when you return to the app, and its closing message no longer stays at the top of the Directions screen.
- Separators in the bike-share and air-quality lines are now commas rather than middle dots, so screen readers no longer read the symbol as a word.
```

---

## 1.13 (빌드 21)

기준은 1.12 아카이브 커밋 `37b99db`(빌드 20)이며 그 이후 `ios/` 커밋 4건을 판정했다. Release 바이너리에 도달하면서 iOS 사용자에게 보이는 것만 담는다.

포함 판정:

| 기능 | 커밋 | 노트 |
|---|---|---|
| 도보 안내 결정 지점 임박 신호 3단계 — 20m 뒤 15m·10m에서 같은 소리·진동을 두 번 더(문장은 첫 번만) | `9148249` | ko·en(도보 안내는 전 언어) |
| 잊힌 도보 세션 안전망(A23) — 위치 신호 10분 두절 또는 20분 무이동이면 안내를 스스로 종료하고 이유를 알린다(`guide.endedIdle`) | `9148249`·`55fc560` | ko·en |
| 지하철 환승역 빠른하차 — 환승 구간은 환승 통로에 가까운 문을 안내(A20, `quickExit.transfer` 디코딩 + `route.transit.quickExitTransfer` 문장) | `91856a2` | ko·en("서버 판정과 앱 UI가 짝인 기능" — 새 필드를 이 버전부터 읽는다) |

제외 근거:

- **옴니박스 버튼 라벨 단축키 병기**(`83cdb67`): iOS 변경은 xcstrings 재생성뿐이고 바뀐 두 키(`search.askAi`·`search.button`)는 Swift 미참조다. 웹 전용.
- `55fc560`은 A23 안전망의 관측 보정이라 별도 항목이 아니다.
- 문서·테스트·생성물 커밋 전량.

심사 노트는 이번 버전에서 **승계한다**(`--review-notes` 없음). 새 권한·새 데이터 유형이 없고 §9 문장 중 거짓이 된 것이 없다.

### ko

```
개선
- 도보 안내에서 횡단보도나 회전 지점이 가까워지면 알림 소리와 진동을 20m, 15m, 10m 지점에서 세 번 냅니다. 안내 문장은 처음 한 번만 나옵니다.
- 도보 안내를 켠 채 잊어버려도 안내가 계속 켜져 있지 않습니다. 위치 신호가 10분 동안 끊기거나 20분 동안 이동이 없으면 안내를 종료하고 그 이유를 알려 드립니다.
- 지하철 환승역의 빠른하차 안내가 환승 통로에 가까운 칸과 문을 알려 드립니다. 계단·엘리베이터 기준 안내는 마지막에 내리는 역에서만 나옵니다.
```

### en

```
Improved
- In walking guidance, the sound and vibration for an upcoming crossing or turn now play three times, at 20 m, 15 m, and 10 m. The spoken instruction is given only the first time.
- Walking guidance no longer stays on if you forget about it. When there is no location signal for 10 minutes or no movement for 20 minutes, guidance ends and tells you why.
- Subway quick-exit guidance at transfer stations now points to the car and door closest to the transfer passage. Stair and elevator based guidance is given only at the station where you finally get off.
```

---

## 1.12 (빌드 20)

기준은 1.11 아카이브 커밋 `f312a39`(빌드 18)이며 그 이후 `ios/` 커밋 39건을 판정했다(빌드 19 초안 시점 22건 + 빌드 19가 1.11 심사 중 409로 제출되지 못한 사이 들어온 17건). 빌드 19는 제출되지 않은 채 폐기하고 빌드 20으로 다시 올린다. Release 바이너리에 도달하면서 iOS 사용자에게 보이는 것만 담는다.

포함 판정:

| 기능 | 커밋 | 노트 |
|---|---|---|
| **도보 상세 경로·실시간 도보 안내가 비한국어 로케일에 개방**(E16 축3 — `includeWalk`·`walkGuideStartable`·도보 안내 공지의 `dataLocale == "ko"` 가드 삭제, 서버가 Tmap 구조화 필드에서 en 문장 생성) | `823e9df`·`9b2e0f4`·`0f2b283` | **en만**(ko는 무변화). 1.11 en 노트가 "driving route"로 한정했던 경유지도 도보에 적용된다 |
| 띠바를 탭 바 위로 + 안내 시트 접기 버튼 + 안내 종료 최하단 고정(K1) | `a44b834`·`43c0a72`·`e3a556d`·`13b6b31` | ko·**en**(도보 안내가 en에 열려 이 화면도 en 사용자가 처음 본다 — 1.11까지의 "ko만" 근거가 E16으로 사라졌다) |
| 받아쓰기 중 안내 음성 억제(K1 ④) | `a44b834`·`43c0a72` | ko·en(같은 근거) |
| 도보 안내 강등 사유 3-state — 위치 확인 불가·제공 지역 밖·경로 조회 실패를 가려 통지(E16 축2) | `559e08a`·`dd83501` | ko·en |
| 역 첫차·막차 노선별 coverage 문구 — 편성 없음·확인 불가·조회 실패 분리, 0행 노선 탈락 없음(A19) | `ced5a98` | ko·en |
| 계단 회피 토글 라벨 "계단 없는 경로" → "계단 회피 경로" + 원좌표 조회 | `eb16b35`·`606d5c7` | **ko만**(비-ko는 토글 자체를 노출하지 않는다 — `DirectionsTabView.swift:793`) |
| AI 채팅 follow-up 질문 칩(K4) | `99461f8` | ko·en |
| 한눈에 보기 식당·카페 분리 6불릿 + 불릿 문장형 | `9acfe16` | ko·en |
| AI 채팅 도구 확장 — 역 첫차·막차, 무장애 편의시설 상세, 현재 위치 정위, 한눈에 보기, 지명 기준 주변 조회, 경유지 길찾기(K3) | `38cbab4`·`47b249f`·`c9adb75`·`5e31a64` | ko·en("서버 판정과 앱 UI가 짝인 기능" 규칙) |

제외 근거:

- **자동차 실시간 안내 완성**(K2 `48f2586`·`fc9fb94` 등): `AppConfig.experimentalGuidanceEnabled` 봉인 안. B1 실주행 판정 뒤 졸업.
- **대중교통 진행 상황 조망·다른 경로·주변 확인·급행 노선 매핑**(E15-1 `6d58e1e`·`b737a70`, E15-2 `95ec44c`, A16 `caaa1f3`): 대중교통 세션 자체가 봉인 안. 도보 조망 이관(`6b47d07`)은 동작 변경 0.
- **탭 순서·기본 탭 변경**(K1): `AppConfig.experimentalTabOrderEnabled`로 실험판만. 정식판은 종전 순서·채팅 첫 탭.
- **Kit `isInKorea` 국경 폴리곤 승격**(E19 `1f13f75`·`2b0a80b`·`ab79205`): 한국 밖 국경 인접 좌표(후쿠오카·대마도)에서 거짓 "0건"이 정직한 "제공 지역 밖"이 되는 교정이다. 그 좌표에 있는 사용자에게만 보이고 기능이 늘지 않아 노트에는 적지 않는다.
- **한눈에 보기 장소 카드 복원·계단식 캡**(K4 `99461f8`의 서버 분): 서버 변경이라 1.11 사용자에게 이미 반영됐다. iOS 쪽은 칩뿐.
- **웹 둘러보기 이식**(B9 `487e02a`): iOS 쪽 변경은 죽은 키 삭제뿐.
- 문서·테스트·생성물·린터 커밋 전량.

⚠ **계단 회피 라벨은 ko 노트에만 적는다.** 비-ko에는 Tmap 단독이라 회피 축이 없어 토글을 노출하지 않는다.

⚠ **en 노트는 도보 안내를 "새로운 기능"으로 적는다.** en 사용자에게는 1.11까지 도보 경로 조회 자체가 없었으므로(`includeWalk = AppLanguage.current == "ko"`), 1.7~1.11 ko 노트에 나눠 실린 안내 기능(백그라운드·임박 큐·띠바·접기·경유지 도착)을 하나의 새 기능으로 묶는다. 단 en 도보 낭독의 실사용 판정은 미완이다(`docs/BACKLOG.md` E16 축3 항목) — 노트는 동작 서술에 그친다.

심사 노트는 이번 버전에서 **갱신한다**(`--review-notes`). 백그라운드 절의 "Walking guidance is available in Korean only"가 E16 축3으로 거짓이 됐다(`1.0-submission-draft.md` §9).

### ko

```
새로운 기능
- AI 채팅 답변 아래에 이어서 물어볼 만한 질문을 제안합니다. 누르면 그 질문이 바로 전송됩니다.

개선
- 안내 화면을 내렸을 때 남는 줄이 탭 바를 가리던 문제를 고쳤습니다. 이제 줄은 탭 바 바로 위에 놓이고, 목적지 제목 오른쪽의 "안내 시트 접기" 버튼으로도 안내 화면을 내릴 수 있습니다.
- 안내 화면의 "안내 종료" 버튼을 화면 맨 아래로 옮겼습니다. VoiceOver에서는 네 손가락으로 화면 아래쪽을 한 번 탭하면 바로 닿습니다.
- 안내 중에 받아쓰기를 켜면 받아쓰는 동안 안내 음성이 나오지 않습니다.
- 도보 안내가 상세 경로 없이 목적지 방향과 거리만으로 안내할 때 그 이유를 알려 드립니다. 현재 위치를 확인하지 못했는지, 제공 지역 밖인지, 경로를 불러오지 못했는지를 구분합니다.
- 도보 길찾기의 "계단 없는 경로" 옵션 이름을 "계단 회피 경로"로 바꿨습니다. 계단을 피하는 경로를 우선 찾되 계단이 전혀 없다고 보장할 수는 없기 때문입니다. 이 옵션을 켠 조회는 더 정밀한 좌표로 보내, 출입구가 가까이 붙은 지하철역에서 계단 유무가 뒤바뀌지 않게 했습니다.
- 역 정보의 첫차·막차에서 노선마다 상황을 구분해 알려 드립니다. "오늘 탑승할 수 있는 편성이 없습니다", "오늘 시간표를 확인할 수 없습니다", "시간표를 불러오지 못했습니다"가 서로 다른 문장으로 나오고, 노선이 목록에서 빠지지 않습니다.
- "내 주변" 둘러보기의 한눈에 보기에서 식당과 카페를 따로 읽고, 각 항목을 문장으로 알려 드립니다.
- AI 채팅이 더 많은 것을 답합니다. 역 첫차·막차 시각, 무장애 관광지의 편의시설 상세, 지금 있는 곳 설명과 한눈에 보기를 물어볼 수 있고, "강남역 주변 소아과"처럼 지명을 기준으로 주변을 묻거나 경유지를 넣은 길찾기를 부탁할 수 있습니다.
```

### en

```
New
- Walking directions and real-time walking guidance are now available in English; until now they were Korean only. Look up a route in the Directions tab to read the step-by-step briefing, then start guidance from the walking section. Upcoming turns and crossings are spoken and signaled with distinct sounds, the session keeps running with the screen locked, and if you added a waypoint you are told when you reach it. Lower the guidance screen to keep using other tabs: a strip above the tab bar shows the remaining distance, and its "Expand guidance sheet" button brings the screen back. Dictation pauses guidance speech while you speak.
- AI chat suggests follow-up questions under each answer. Tap one to send it.

Improved
- When walking guidance has to fall back to direction and distance only, it tells you why: your location could not be determined, you are outside the service area, or the route could not be loaded.
- Station first and last train times now distinguish each line's situation: "no boardable trains today", "today's timetable couldn't be confirmed", and "timetable couldn't be loaded" are separate messages, and no line is dropped from the list.
- In "Look around", the at-a-glance summary now lists restaurants and cafes separately and reads each item as a sentence.
- AI chat answers more: first and last train times at a station, accessibility facility details for barrier-free attractions, a description of where you are with an at-a-glance summary, nearby searches around a named place, and directions with a waypoint.
```

---

## 1.11 (빌드 18)

기준은 1.10 아카이브 커밋 `0013c52`(빌드 17)이며 그 이후 커밋 57건을 전수 판정했다. `ios/` 아래를 건드린 것은 24건이고, 그중 Release 바이너리에 도달하면서 iOS 사용자에게 보이는 것만 아래에 담는다.

포함 판정:

| 기능 | 커밋 | 노트 |
|---|---|---|
| 안내 세션 앱 승격 + 탭 바 위 띠바 + 안내 중 장소 상세 목적지 변경(N1) | `857bd33`·`5e2c845` | ko만 |
| 경유지 1개 — 길찾기 폼 추가·삭제, 안내 세션 경유지, 최근 경로 경유 문장(N4) | `3768d84`·`43b23b8`·`b4615ab`·`5bfc0df`·`045ea7a`·`3417786`·`39e2931` | ko·en |
| 도보 안내 임박 큐 톤 5종 세분화(N2) | `f2cedfa` | ko만 |
| "내 주변" 둘러보기 통합 화면 + 한눈에 보기, "현재 위치 확인" 화면 삭제(M4) | `ec993df`·`3c42e09`·`d2d96d7`·`5d2c01f`·`1788adc`·`9d168d1` | ko·en |

제외 근거:

- **대중교통 boarding 국면 계열**(`648e648`·`c873583`·`8b27e83`·`19eb69c` N3): `transitGuideStartable`이 `AppConfig.experimentalGuidanceEnabled` 가드 안이라(`DirectionsTabView.swift:1078`) **정식판에 진입점이 없다**. 1.8에서 같은 이유로 제외한 대중교통 승차 추적 계열과 같은 자리다. 커밋 메시지가 "탑승했습니다·다른 차량 선택" 같은 사용자 문구를 들고 있어 게이트를 코드에서 확인해야 걸러진다.
- **음향신호기 BLE 진단**(`c51e031`·`6c32bc8`): `#if DEBUG || EXPERIMENTAL`.
- **ITMS-90683 해소**(`57d21f8`): BLE 전송 층을 앱 타깃 실험 구성으로 옮겨 정식 바이너리의 CoreBluetooth 링크를 없앤 변경이다. 업로드 경고가 사라지는 것이지 화면이 바뀌지 않는다.
- **좌우 안내음 방식 피커**(`f2cedfa`의 `SettingsView` 분): `#if DEBUG || EXPERIMENTAL`이라 정식판 설정에 없다. 정식판은 기본값 `LeftRightToneScheme.pitch`로 고정이고, **소리가 행동별로 갈리는 것 자체는 정식판에 도달**하므로 톤 5종은 포함이다.
- **서버·웹·CLI 전용**(경유지 provider·라우트·웹 폼·CLI `--via`, `/api/nearby/overview`, 웹 boarding 패널): push가 곧 배포라 1.10 사용자에게 이미 반영됐다.
- 문서·테스트·생성물 재생성 커밋 전량.

⚠ **N1·N2는 ko 노트에만 적는다.** 띠바와 목적지 변경 버튼은 안내 세션이 살아 있을 때만 존재하는데, 정식판에서 시작할 수 있는 안내는 도보뿐이고 `walkGuideStartable`이 `AppLanguage.dataLocale == "ko"` 가드 안이다. 톤 세분화도 같은 세션 안의 소리다. 1.7·1.9·1.10과 같은 근거다.

⚠ **경유지는 ko·en 둘 다에 적는다.** 폼의 "경유지 추가"는 언어 게이트가 없고(`DirectionsTabView.swift:611` 부근, 조건은 `viaLabel` 유무뿐), `lang=en + via` 요청도 ko 서비스로 돌아가 경로가 나온다(`65a790d`). 다만 **iOS 도보 조회는 `includeWalk = AppLanguage.current == "ko"`**(같은 파일 388줄)라 비한국어 사용자에게 경유지가 실제로 붙는 것은 자동차 경로다 — en 노트에 "walking"을 적으면 없는 기능이 된다.

⚠ **둘러보기 통합은 화면이 하나 사라지는 변경이라 en에도 적는다.** "현재 위치 확인"(`WhereAmIView`)을 지우고 "둘러보기"가 그 문장을 흡수했으므로, 그 화면을 쓰던 사용자는 노트가 없으면 기능이 없어진 것으로 읽는다.

심사 노트는 이번 버전에서 갱신하지 않는다. 권한·데이터 수집 항목이 늘지 않았고(경유지·둘러보기는 기존 위치·네트워크 범위), 1.10에서 ASC 실값 기준으로 동기화한 뒤 거짓이 된 문장이 없다.

### ko

```
새로운 기능
- 안내를 켠 채로 검색, 내 주변, AI 채팅 같은 다른 화면을 쓸 수 있습니다. 안내 화면을 내리면 탭 바 위에 남은 거리를 알려 주는 줄이 남고, 그 줄의 "안내로 돌아가기"를 누르면 안내 화면으로 돌아옵니다.
- 길찾기에 경유지 한 곳을 넣을 수 있습니다. 도착지 아래 "경유지 추가"로 거쳐 갈 곳을 정하면 그곳을 지나는 도보, 자동차 경로를 알려 드리고, 안내 중에는 경유지에 도착할 때 알려 드립니다. 대중교통은 아직 경유지를 지원하지 않습니다.
- 도보 안내 중에 장소 상세를 열면 그 장소로 목적지를 바꾸거나 경유지로 넣는 버튼이 있습니다.

개선
- 도보 안내에서 방향을 바꿀 지점이 가까워질 때 나는 소리를 할 일에 따라 나눴습니다. 횡단보도, 왼쪽, 오른쪽, 뒤로 돌기, 그 밖이 서로 다른 소리로 납니다.
- "내 주변"의 "현재 위치 확인"을 맨 위 "둘러보기" 한 화면으로 합쳤습니다. 지금 있는 곳, 한눈에 보기(대중교통, 식당과 카페, 아이 놀 곳, 문화 행사, 무장애 관광지), 길 좌우 상황, 주변 가게를 이어서 읽을 수 있습니다.
```

### en

```
New
- Directions can now include one waypoint. Tap "Add a waypoint" below the destination to pick a place to pass through, and the driving route is calculated through it. Transit routes do not support waypoints yet.

Improved
- "Where am I" has been folded into "Look around" at the top of the Nearby tab. One screen now reads where you are, an at-a-glance summary of transit, restaurants and cafes, places for kids, cultural events and barrier-free attractions, then what is on each side of the street and the shops nearby.
```

---

## 1.10 (빌드 17)

기준은 1.9 아카이브 커밋 `01447d4`(빌드 16)이며 그 이후 커밋 5건을 전수 판정했다. iOS 바이너리에 닿는 것은 3건이고 문서 2건(`16b1ab3`·`34d33a2`)과 웹 전용 변경(`NearbyHub.tsx`·`declarations.ts`)은 제외한다.

포함 판정:

| 기능 | 커밋 | 노트 |
|---|---|---|
| 최소 지원 iOS 26 → 18 하향(26 미만은 `SFSpeechRecognizer` 온디바이스 받아쓰기) | `aac1c5c` | ko·en |
| 도보 안내 걸음·칼로리 요약을 모든 정상 종료로 확장(중지·목적지 변경·권한 상실) | `e449fd9` | ko만 |
| 추정 도착 자동 종료의 도착 종을 전경 한정으로 | `63e0be7` | ko만 |

최소 버전 하향은 **설치 가능 기기가 늘어나는 변경**이라 두 로케일 모두에 적는다(1.9까지의 "도보 안내는 ko 게이트라 ko만"과 다른 축이다). 도보 안내 2건은 ko 게이트 안이라 ko만이고, en은 관용 문구(1.7·1.9 선례).

심사 노트는 이번 버전에서 **갱신한다**(`--review-notes` 사용). 두 곳이 이번 변경으로 거짓이 된다: ①`Microphone` 절의 "iOS SpeechAnalyzer"가 iOS 18~25 기기에서는 사실이 아니다(그 구간은 `SFSpeechRecognizer` 온디바이스) ②`Motion & Fitness`의 `(new in this version)`은 1.8에서 붙은 꼬리라 1.10에서는 거짓이다(1.7 백그라운드 절이 1.8에서 같은 꼬리를 뗀 선례).

⚠ ASC 실값(2,134자)이 `1.0-submission-draft.md` §9보다 최신이었다. §9에 `Motion & Fitness` 절이 없어, 문서를 그대로 `--review-notes`로 넘겼다면 그 절이 지워질 뻔했다. 이번에 §9를 ASC 실값 기준으로 동기화했다.

### ko

```
새로운 기능
- iOS 18부터 설치할 수 있습니다. 이전에는 iOS 26 이상이 필요했습니다. iOS 26보다 낮은 기기에서는 받아쓰기가 다른 엔진으로 동작하며, 음성이 기기 밖으로 나가지 않는 것은 같습니다.

개선
- 도보 안내를 중지하거나 목적지를 바꿔서 끝냈을 때에도 걸음 수와 소모 칼로리를 알려 드립니다. 50미터 넘게 걸었을 때 나옵니다.
- 도착한 것으로 보고 안내가 저절로 끝날 때 울리던 도착 종은 이제 앱을 보고 있을 때에만 울립니다. 화면을 끈 채 둔 휴대전화가 한참 뒤에 소리를 내지 않습니다.
```

### en

```
New
- The app now installs on iOS 18 and later; it previously required iOS 26. On devices below iOS 26, dictation runs on a different engine, and audio still never leaves the device.

Improved
- Various fixes and refinements.
```

---

## 1.9 (빌드 16)

제출 2026-08-18 19:55 KST (`WAITING_FOR_REVIEW`). 아카이브 커밋 `01447d4`(`git worktree` 격리 빌드), 산출물 `Info.plist`로 번들 ID·1.9.0(16)·`UIBackgroundModes`·번들 `release-notes.json` 최신 1.9 확인. 프로모션 텍스트 자동 승계(ko 86자·en 142자), 심사 노트 무변경.

기준은 1.8 아카이브 커밋 `1cad836`(빌드 15)이며 그 이후 커밋 4건 중 iOS 바이너리에 닿는 것은 `9cead1d`(도보 안내 실사용 피드백 3건) 하나다. 두 항목 모두 도보 안내(ko 게이트) 안의 변경이라 ko 노트에만 적고, en은 관용 문구(1.7 선례). 위원장 지시 2026-08-18 "현재 상태를 심사 요청".

포함 판정:

| 기능 | 커밋 | 노트 |
|---|---|---|
| 도착 화면 걸음·칼로리 문장형 + 음식 비유 + 체중 미입력자 안내·버튼 | `9cead1d` | ko만 |
| 출입구 승격 고지 문장 삭제 | `9cead1d` | ko만(문장 정리라 한 줄) |

제외: 최소 iOS 버전 하향(`docs/BACKLOG.md` E23, 미착수)·문서 커밋 3건.

### ko

```
개선
- 도보 안내로 도착했을 때 걸음 수와 소모 칼로리를 문장으로 읽어 드리고, 태운 칼로리를 한국 음식에 빗대어 알려 드립니다. 설정에서 체중을 넣지 않은 분에게는 그 자리에서 바로 체중을 입력할 수 있는 버튼이 보입니다.
- 길찾기 결과에서 목적지가 정문 등 출입구로 잡혔을 때 나오던 안내 문장을 없앴습니다.
```

### en

```
Improved
- Various fixes and refinements.
```

---

## 1.8 (빌드 15)

제출 2026-08-17 20:10 KST, 2026-08-18 `READY_FOR_SALE`. 기준은 1.7 아카이브 커밋 `45f1412`(빌드 13)이며 그 이후 107커밋을 전수 판정했다. 아카이브 커밋 `1cad836`(`git worktree`로 격리해 빌드). 산출물 `Info.plist`로 번들 ID `space.dodoplanet.gildongmu`(`.dev` 아님)·1.8.0(15)·`UIBackgroundModes`(location·audio)·실험 전용 BLE 키 부재를 확인했다. 프로모션 텍스트 자동 승계 네 번째 동작(ko 86자·en 142자), 심사 노트는 `Motion & Fitness` 절이 더해져 2,134자(1.7의 1,729자에서 증가).

⚠ **빌드 14를 버리고 15로 다시 올렸다.** 14 업로드 뒤 포함 판정을 검증하다 `bef6a43`의 D8이 Kit 이관이라 낭독 문장이 바뀌지 않음을 확인해 노트에서 뺐는데, `release-notes.json`이 **앱 번들 리소스**(설정 > 업데이트 이력)라 ASC의 What's New와 달리 **바이너리에 굳는다**. 업로드된 14의 `.app` 안 JSON을 열어 옛 문장이 실린 것을 확인하고 재빌드했다. 노트 정정이 바이너리와 무관하다는 직관이 이 파일에서만 거짓이다.

⚠ **산출물 검사가 `asc-submit --submit` 경유로 처음 정상 동작했다.** 1.7에서 이 게이트가 제출을 두 번 막았고 둘 다 게이트 자신의 결함이었으므로(그 수정 이후 첫 실행), 이번 통과가 그 수정의 실증이다.

포함 판정 — Release 바이너리에 도달하면서 iOS 사용자에게 보이는 것만:

| 기능 | 커밋 | 노트 |
|---|---|---|
| 채팅 답변의 장소 → 상세 진입 | `8dd612c`·`0cf7b57`·`77c59c3`·`df077cf` | ko·en |
| 말풍선 구획 헤딩(카드 묶음·출처) | `77c59c3` | ko·en |
| 검색 리뷰순 정렬 | `3fff847`·`a0d8a2f`·`1a447e1` | ko만 |
| 걸음·칼로리 요약 + 설정 체중 | `24c5938`·`17732b4`·`dd06f5c`·`2a6cf84`·`b108837`·`6a89b90`·`70d54c1` | ko만 |
| 안내 출발 좌표 정확도 판정 | `036ae50` | ko만 |
| "내 주변" 전락 통지가 잠식되지 않게(D24) | `bef6a43` | ko·en |

제외 근거:

- **대중교통 승차 추적 계열**(`612e380` A16 탑승 역 재선택·`be9ab25` 잔여 정거장 중복·`2741fc2`·`17e303c` 2호선 방향·`98fdb82`): `transitGuideStartable`이 `AppConfig.experimentalGuidanceEnabled` 가드 안이라(`DirectionsTabView.swift:1081`) **정식판에 진입점이 없다**. 커밋 메시지만 보면 사용자 가시 개선으로 읽히는 묶음이라 게이트를 코드에서 확인해야 걸러진다.
- **음향신호기 BLE 진단**(`75abeab`): `#if DEBUG || EXPERIMENTAL`.
- **서버·웹 전용**(`541045a` 국경 폴리곤·`8cc8cb4` OSM seed·`99baa63` finalApproach 등): push가 곧 배포라 1.7 사용자에게 이미 반영됐다.
- 안내 모드 이름 삭제(`1e9df26`)·수동 위치 고지 이동(`0fcbdc2`·`7310c4f`)·도착 화면 상태 줄(`9aac05a`): 도보 안내 안의 문구 정리라 개별 항목으로 펴지 않는다.
- **대중교통 브리핑 도보 구간 문장(`bef6a43` D8)**: Kit 이관(`TransitWalkLegText`)이라 낭독 문장이 바뀌지 않는다. 같은 커밋 안에서 D24만 가시다 — 묶음 커밋은 항목별로 갈라 판정해야 한다(초안에서 이 항목을 "문장을 다듬었다"로 적었다가 이관임을 확인하고 뺐다).
- **꼬리 문장·통지 우선순위 정리(`0de05b4` D7·D13)**: `ios.common.retryLater` 삭제로 오류 낭독이 짧아지고 최근 목록 삭제 통지의 우선순위가 규칙에 맞춰졌다. 둘 다 낭독에서 체감되지만 **사용자가 찾아 쓸 대상이 아니라** 항목으로 펴지 않는다(같은 커밋의 D21은 `useNearbyFetch` 웹 전용). 위 D24를 한 줄로 남긴 것과 갈리는 선은 "그 통지가 안 들리면 화면이 왜 바뀌었는지 알 수 없는가"다.

⚠ **걸음·칼로리 요약과 리뷰순 정렬은 ko 노트에만 적는다.** 도착 종료 화면은 도보 안내(ko 게이트) 끝에만 나오고, 리뷰순 토글은 `AppLanguage.dataLocale == "ko" && naverBackedSeen`이라(`SearchModel.swift:32`) 비한국어 사용자에게는 둘 다 존재하지 않는다. 설정의 체중 항목은 모든 언어에 보이지만 그 값이 쓰이는 화면이 ko 전용이라 en 노트에 따로 적지 않는다.

⚠ **채팅 장소 상세 진입은 언어 게이트가 없다**(`ChatModel`은 `AppLanguage.current`를 요청 로케일로 넘길 뿐 기능을 막지 않는다). 1.7의 en 노트가 관용 문구였던 것과 달리 이번엔 en 사용자에게 실제로 보이는 변경이 있다.

⚠ **동작 및 피트니스 권한이 새로 들어간 첫 버전이다.** 걸음 수는 `CMPedometer` 구간 질의로 읽고 체중은 `@AppStorage`라 **둘 다 기기를 떠나지 않는다** — 영양 라벨·`PrivacyInfo.xcprivacy`는 수집 항목이 늘지 않아 그대로이고(오디오 미신고와 같은 논리), 개인정보 처리방침에는 그 사실을 밝히는 문단(`privacy.activity`)을 6로케일에 더했다. 심사 노트에는 `Motion & Fitness` 절을 새로 넣고 1.7에서 `new in this version`이던 백그라운드 오디오 절의 그 표현을 뗐다.

### ko

```
새로운 기능
- AI 채팅 답변에 나온 장소를 눌러 장소 상세를 바로 열 수 있습니다. 소아 진료, 아이 놀 곳, 둘러보기, 무장애 정보를 물었을 때 나오는 답변에서도 됩니다.
- 검색 결과를 네이버 리뷰순으로 볼 수 있습니다.
- 도보 안내로 목적지에 도착하면 이번 구간에서 걸은 걸음 수와 소모 칼로리(추정)를 도착 화면에서 알려 드립니다. 설정에서 체중을 넣으면 칼로리 추정이 더 정확해집니다.

개선
- 채팅 답변에서 장소 묶음과 출처 앞에 제목이 붙어 스크린 리더로 건너뛰기 쉬워졌습니다.
- 도보 안내를 시작할 때 출발 지점을 더 정확한 위치로 잡습니다.
- "내 주변" 목록을 위치 권한이나 정밀도 때문에 불러오지 못할 때, 그 이유를 놓치지 않고 읽어 드립니다.
```

### en

```
New
- Tap a place mentioned in a chat answer to open its details, including answers about pediatric clinics, places for kids, what's around you, and barrier-free information.

Improved
- Chat answers now place headings before place cards and sources, so you can skip between them with a screen reader.
- When a nearby list cannot load because of location permission or accuracy, the reason is now announced without being cut off.
```

---

## 1.7 (빌드 13)

제출 2026-08-15 09:08 KST · **심사 통과 확인 2026-08-16 (`READY_FOR_SALE`)**. 아카이브 커밋 `cb3402a`(`git worktree`로 격리해 빌드). 산출물 `Info.plist`로 번들 ID `space.dodoplanet.gildongmu`(`.dev` 아님)·표시 이름 무접미사·1.7.0(13)·`UIBackgroundModes`(location·audio)·ko 권한 문구 거리 안내 절을 확인했다. 프로모션 텍스트 자동 승계 세 번째 동작(ko 86자·en 142자), 심사 노트는 `--review-notes`로 백그라운드 오디오 절을 더해 1,729자.

⚠ **산출물 검사가 제출을 두 번 막았고 둘 다 검사 자신의 결함이었다**(같은 날 수정·테스트). ①ASC `versionString`(`1.7`)과 산출물 `CFBundleShortVersionString`(`1.7.0`)을 문자열 완전 일치로 비교 ②`asc-submit`이 경로 없이 넘기는 `--expect-version 1.7`의 값 `1.7`을 산출물 경로로 오인. **이 게이트가 `asc-submit` 경유로 한 번도 실행된 적이 없었다는 뜻**이라, 게이트를 새로 도입하면 그 게이트가 실제로 호출되는 경로로 한 번 밟아 봐야 한다.

**도보 실시간 안내 정식 출시.** 1.0부터 여섯 버전 동안 봉인돼 있던 실시간 안내가 도보 축에서 처음 사용자에게 도달한다. 1.6은 제출 시점(2026-08-12)에 심사 중이었으므로 이 노트는 그 다음 버전이다.

⚠ **포함 판정이 다른 릴리스와 다르다.** 평소 규칙은 "직전 릴리스 이후 커밋 중 Release 바이너리에 도달하는 것"인데, 이번엔 **게이트가 열리면서 이미 있던 코드가 한꺼번에 도달**한다. 지난 여섯 버전의 노트가 매번 "실시간 안내는 계속 봉인이라 이 버전에도 담기지 않는다"로 제외했던 것 전부 — 경로 추종·결정 지점 안내·임박 큐·최종 접근·이탈 판정·계단 회피 통지·안내 시트·백그라운드 사운드, 그리고 봉인 기간에 쌓인 개선(톤 뒤 발화·대안 경로 프리뷰·도착 추정 자동 종료·목적지 메뉴) — 이 이번 바이너리에 들어간다. **사용자에게는 그 전부가 "도보 안내"라는 기능 하나**이므로 노트에서 항목별로 펴지 않는다. 여전히 봉인인 것은 자동차 안내·대중교통 안내·간략 안내 단독 진입이다(`AppConfig.experimentalGuidanceEnabled`).

⚠ **도보 안내는 ko 노트에만 적는다.** `walkGuideStartable`이 `AppLanguage.dataLocale == "ko"` 게이트 안이라 비한국어 사용자에게는 시작 버튼 자체가 없다 — en 노트에 적으면 찾다가 못 찾는 기능이 된다(1.6의 도보 경로 대안과 같은 근거). 공지 모달도 같은 이유로 ko 전용이라 en 노트에 없다.

⚠ **en 노트가 사실상 비어 있는 것은 판정이다.** 이 빌드에서 영어 사용자에게 보이는 변화가 실제로 없다 — 도보 안내·공지 모달은 ko 게이트 안이고, 위치 권한 문구는 en을 바꾸지 않았으며, 안내 시트 변경은 그 화면에 도달할 수 없는 사용자에게 무의미하다. 파이프라인이 ko·en 한쪽만 있는 것을 거부하므로(`build-release-notes.mjs`) 관용 문구를 둔다. **없는 기능을 en 노트에 적어 채우지 말 것** — 그것이 이 자리에서 할 수 있는 유일한 실수다.

⚠ **심사 노트에 백그라운드 오디오 용도를 반드시 적는다**(`1.0-submission-draft.md` §심사 노트): 시각장애 사용자를 위한 보행 내비게이션 오디오 신호로, 방향·거리·이탈을 소리로 전달하며 화면을 보지 않고 걷는 것이 이 기능의 전제다. 백그라운드 오디오는 심사가 실제로 들여다보는 항목이다.

⚠ **제출 전 `node ios/scripts/check-release-artifact.mjs`가 통과해야 한다**(spec §7.2). `asc-submit.mjs --submit`이 제출할 버전·빌드를 넘겨 자동으로 돌린다. 손으로 돌릴 때도 `--expect-version`·`--expect-build`를 함께 준다 — 인자 없이 돌리면 "가장 최근 아카이브"를 고르는데 그것이 올린 빌드라는 보장이 없어, 낡은 산출물을 보고 통과가 나올 수 있다. 백그라운드 모드 누락은 빌드가 성공하고 전경에서도 정상이라 이 검사 말고는 드러나지 않으므로, **무엇을 검사했는지가 통과 자체만큼 중요하다.**

### ko

```
새로운 기능
- 도보 길찾기에 실시간 안내가 생겼습니다. 경로를 조회한 뒤 도보 섹션에서 "도보 안내 시작"을 누르면, 걷는 동안 남은 거리와 다음에 할 일을 소리와 음성으로 알려 드립니다. 방향을 바꿀 지점이 가까워지면 미리 알리고, 경로에서 벗어나면 알려 드립니다. 화면을 잠가도 안내가 이어집니다.
- 길찾기 탭에 처음 들어가면 이 기능을 안내하는 창이 한 번 뜹니다. 안내의 한계와 횡단보도에서 유의할 점을 함께 담았습니다.
```

### en

```
Improved
- Various fixes and refinements.
```

---

## 1.6 (빌드 12)

제출 2026-08-12 20:47 KST · **`READY_FOR_SALE` 확인 2026-08-16**. 최근 목록 고정 · 도보 경로 대안(추천·최단) · 길찾기 결과 섹션 동적 순서. 실시간 길 안내는 계속 봉인(`#if EXPERIMENTAL`)이라 이 버전에도 담기지 않는다.

프로모션 텍스트 자동 승계가 두 번째로 동작했다(ko 86자·en 142자). 제출 3호출(생성·항목 추가·제출)은 1.5에서 겪은 ASC 500 이후 재사용화한 그대로 한 번에 통과했다. 아카이브는 `git worktree`로 커밋(`532eb89`)을 격리해 빌드했고, 산출물 `Info.plist`로 번들 ID `space.dodoplanet.gildongmu`(`.dev` 아님)·표시 이름 무접미사·1.6.0(12)를 확인했다.

포함 판정: 1.5(빌드 11, 아카이브 커밋 `aa4b823`) 이후 63개 커밋 중 Release 바이너리에 **도달하면서** iOS 사용자에게 보이는 것만. 제외 근거 — 실시간 안내 계열 20여 개(목적지 메뉴 M5·안내 중 경로 전환·이탈 시 제안 E10ⓑ·투영 지연 10m·closer 6m)는 `AppConfig.realtimeGuidanceEnabled` 게이트 안이라 Release에 진입점이 없고, 서버 전용(A9 근접역 동명이역 혼입·횡단 안내 꼬리 거리 이름 부여·`/api/route/walk` variant 계약)은 웹 배포로 이미 1.5 사용자에게 반영됐으며, A8(조회 요약 수치)은 `src/components/DirectionsView.tsx` 웹 전용이다.

⚠ **도보 경로 대안은 ko 노트에만 적었다.** iOS 도보 섹션은 `AppLanguage.current == "ko"` 전용이라 조회 자체를 생략한다(`DirectionsTabView.swift:316`) — 비한국어 사용자는 그 화면을 볼 수 없으므로 en 노트에 적으면 찾다가 못 찾는 기능이 된다.

⚠ **M3 실보행 판정 전에 출시한다**(BACKLOG §H M3). Release에 도달하는 면은 "추천·최단 두 경로를 읽을 수 있다"는 정보 제공 축이고, 판정이 남은 면(최단 경로 실안내 품질·전환 발화·제안 계열)은 전부 실험 구성 안이다. 1.5의 M1과 같은 근거다.

### ko

```
새로운 기능
- 최근 목록에 고정이 생겼습니다. 검색어, 출발지, 도착지, 최근 경로 네 목록에서 항목을 쓸어 넘겨 고정하면 목록 맨 위에 남고, 20개 제한과 "모두 지우기"에서 제외됩니다.
- 도보 길찾기가 추천 경로와 최단 경로를 함께 보여 줍니다. 각 경로를 펼치면 구간별 안내를 읽을 수 있습니다. 계단 회피를 켠 상태에서 최단 경로가 계단을 피하지 못하면 요약에 함께 알려 드립니다.

개선
- 길찾기 결과에서 갈 수 있는 수단이 먼저 나오고, 경로가 없거나 조회에 실패한 수단은 뒤로 갑니다. 도보로 30분 안에 갈 수 있으면 도보가 맨 위에 옵니다.
```

### en

```
New
- Recent lists can now be pinned. Swipe an item in any of the four recent lists — searches, origins, destinations, and routes — to pin it. Pinned items stay at the top and are exempt from the 20-item limit and from Clear all.

Improved
- Directions results are ordered by what you can actually take: modes with a route come first, and modes with no route or a failed lookup move to the bottom.
```

## 1.5 (빌드 11)

제출 2026-08-11 05:15 KST · **`READY_FOR_SALE` 확인 2026-08-16**. 도착지 부근 상황 재구성(주변 확인) · 길찾기 최근 경로 · 설정 업데이트 이력. 실시간 길 안내는 계속 봉인(`#if EXPERIMENTAL`)이라 이 버전에도 담기지 않는다.

**프로모션 텍스트가 처음으로 자동 승계됐다**(ko 86자·en 142자, BACKLOG D9 종결). 1.1~1.4는 네 번 연속 사람이 손으로 복사했다. `asc-submit.mjs`는 이제 새 초안의 값이 **비어 있을 때만** 직전 버전 값을 PATCH한다(값이 있으면 손대지 않으므로 종전의 빈 값 덮어쓰기 방지 설계와 충돌하지 않는다). 재실행에서 승계 로그가 사라지는 것으로 반영을 확인했다.

⚠ **심사 제출 PATCH가 ASC 500으로 한 번 실패했다**(`reviewSubmission` 생성·항목 추가는 성공, 마지막 `submitted:true`만 실패 → 버전이 `READY_FOR_REVIEW`에서 멈춤). 그 상태에서 스크립트를 다시 돌리면 미제출 submission이 하나 더 생기므로, 세 호출이 각각 **이미 있는 것을 재사용**하도록 고친 뒤 재시도해 통과했다. 같은 500을 다시 만나면 `--apply --submit`을 그대로 다시 실행하면 된다.

아카이브는 **`git worktree`로 커밋(`aa4b823`)을 격리해** 빌드했다. 병렬 세션이 같은 작업 디렉터리에서 iOS 파일을 수정 중이었고, 아카이브는 수 분간 소스를 읽으므로 절반만 반영된 바이너리가 나올 수 있다.

포함 판정: 1.4(빌드 10, 제출 2026-08-09 16:56) 이후 iOS 정식 빌드에 **도달하는** 변경만. 이 창의 iOS 커밋 29개 중 실시간 안내 계열 20여 개는 `AppConfig.realtimeGuidanceEnabled` 게이트 안이라 Release에서 도달 불가고, 서버 전용 변경(자동차 안내문 재작성·도보 anchor 유실 수정·4호선 이촌역 seed 좌표 보정)은 웹 배포로 이미 1.4 사용자에게도 반영되어 "이 업데이트의 새 기능"이 아니다.

⚠ **주변 확인(M1)은 제출 시점에 실보행·실기기 VO 판정 전이었다**(BACKLOG §H M1 ①②). 이 기능에는 실험 게이트가 없어 Release 빌드에 이미 들어가 있으므로, 적지 않으면 숨은 기능이 된다. 정보 제공 축이고 안내·안전 축이 아니라는 점이 판정 전 출시를 받아들인 근거였고, **제출 당일 위원장 실사용 판정이 통과해 그 판단이 확인됐다**(2026-08-11, "큰 문제 없었다").

### ko

```
새로운 기능
- 내 주변에서 현재 위치를 확인한 뒤 "주변 확인"을 누르면, 그 자리 주변의 가게와 시설을 왼쪽, 오른쪽, 맞은편, 건물 너머로 나눠 알려 드립니다. 도로명주소로 방향을 세울 수 없는 자리에서는 동서남북으로 알려 드립니다.
- 길찾기에 최근 경로가 생겼습니다. 전에 조회한 출발지와 목적지 쌍을 누르면 그대로 다시 조회합니다. 쓸어 넘겨 하나씩 지우거나 모두 지울 수 있습니다.
- 설정에 업데이트 이력이 생겼습니다. 버전마다 무엇이 바뀌었는지 앱 안에서 읽을 수 있습니다.
```

### en

```
New
- In Nearby, confirm your current location and tap "Check surroundings" to hear the shops and facilities around that spot, grouped as left, right, across the street, and beyond the building. Where the street address cannot establish a facing direction, the app falls back to compass directions.
- Directions now keeps your recent routes. Tap a saved origin and destination pair to look it up again. Swipe to delete one, or clear them all.
- Settings now has release notes. Read what changed in each version inside the app.
```

## 1.4 (빌드 10)

제출 2026-08-09 16:57 KST · **`READY_FOR_SALE` 확인 2026-08-16**. 현위치 수동 지정. 실시간 길 안내는 계속 봉인(`#if EXPERIMENTAL`)이라 이 버전에도 담기지 않는다.

⚠ **프로모션 텍스트는 이번에도 승계되지 않았다**(ko·en 둘 다 빈 값). `asc-submit.mjs`가 경고는 내지만 채우지는 않아 1.3 값을 ASC API로 직접 복사했다(BACKLOG D9).

포함 판정: 1.3(빌드 9, 제출 2026-08-04) 이후 iOS 사용자에게 보이는 변경만. 이 창의 실시간 안내
커밋 20여 개는 전부 실험 구성 봉인이라 제외했고, 웹 전용(주소→좌표 공용화·웹 표시줄·웹 길찾기
라벨)은 push 즉시 배포되므로 "이 업데이트의 새 기능"이 아니다. `6f28a08`(문 번호 표기)은
2026-08-08 커밋이라 1.3에 없었고 여기 포함된다.

### ko

```
새로운 기능
- 채팅·검색·내 주변 화면 첫 줄에서 지금 위치가 어디로 잡혔는지 주소로 확인할 수 있습니다.
- 그 위치가 틀렸으면 직접 지정할 수 있습니다. 첫 줄의 위치를 누르고 장소를 검색해 고르면 그 자리를 현재 위치로 씁니다. 실내에서 잘 안 잡힐 때 쓰세요.
- 지정한 위치는 내 주변 정보, 검색 결과 거리, 채팅 답변, 길찾기 출발지에 모두 반영됩니다.
- 자리를 옮기면 지정한 위치를 자동으로 해제하고 알려 드립니다. 같은 자리에서 앱을 여닫는 동안에는 그대로 유지됩니다.
- 지정할 때 실제 위치를 확인할 수 없었다면 "위치 확인 불가"를 함께 알려 드립니다.

개선
- 영어·스페인어·프랑스어·이탈리아어에서 지하철 빠른 하차 안내의 문 번호가 자연스럽게 읽히도록 고쳤습니다.
```

### en

```
New
- See where you are right now, by address, on the first line of the Chat, Search, and Nearby screens.
- If that is wrong, set it by hand. Tap the location on the first line and pick a place, and the app uses that spot as your current location. Useful indoors.
- Your set location applies to nearby information, search result distances, chat answers, and directions origin.
- Move somewhere else and the app clears it automatically and tells you. It stays put while you open and close the app in the same spot.
- If your real location could not be confirmed when you set it, the app says so.

Improved
- Fixed the wording of door numbers in subway quick-exit guidance for English, Spanish, French, and Italian.
```

---

## 1.3 (빌드 9)

제출 2026-08-04 13:15 KST · `READY_FOR_SALE` 확인 2026-08-06. 실시간 길 안내 봉인본.

### ko

```
개선
- 심야에 지하철역이 가까이 있는데도 "주변에 지하철역이 없습니다"로 안내되던 문제를 고쳤습니다. 첫차를 기다리는 중인지, 운행이 끝났는지, 정보가 없는지를 구분해 알려 줍니다.
- 주변에 지하철역이 잡히지 않을 때 가장 가까운 역과 거리를 함께 알려 줍니다.
- 시내버스 정보가 제공되지 않는 지역과, 가까운 정류장이 없는 경우를 구분해 안내합니다.
- 장소를 열면 그 장소 주변의 지하철역도 볼 수 있습니다.
- 목록을 불러온 뒤 화면 읽기 커서가 첫 항목에 바로 닿습니다(길찾기 검색, 내 주변).
- 안내 문장에서 반복되던 군더더기를 걷어냈습니다.
- 1km가 넘는 거리를 "1.1km"처럼 한 번에 읽습니다.
- 현재 위치를 더 정확하게 잡고, 정확한 위치가 꺼져 있으면 그 자리에서 바로 켤 수 있습니다.
```

### en

```
Improved
- Fixed "no subway stations nearby" being announced late at night when a station was in fact close by. It now tells you whether the first train is still coming, service has ended, or the information is unavailable.
- When no station is found nearby, the closest one is reported with its distance.
- Areas without bus coverage are now distinguished from areas that simply have no stop close by.
- Open a place to also see the subway stations around it.
- After a list loads, the screen reader cursor lands on the first item (directions search, nearby).
- Removed repetitive filler from spoken messages.
- Distances over 1 km now read as a single value, such as "1.1 km".
- More accurate current location, and precise location can be turned on right where you are asked.
```

---

## 1.2 (빌드 8)

제출 2026-08-01 16:06 KST · 승인 2026-08-02.

### ko

```
새로운 기능
- 실시간 혼잡도: 서울 주요 지역이 지금 얼마나 붐비는지 등급과 안내 문장으로 확인할 수 있습니다. 채팅으로 물어보면 언제 한산해지는지도 알려 줍니다.
- 내 주변 문화행사: 오늘 열리는 전시, 공연, 축제를 가까운 순서로 볼 수 있습니다.
- 운행이 끝난 노선 안내: 대중교통 경로에서 첫차와 막차 시간을 벗어난 구간을 알려 줍니다.
- 장소에서 바로 주변 보기: 장소를 열면 그 장소 주변의 버스 도착, 따릉이, 날씨를 바로 확인할 수 있습니다.

개선
- 받아쓰기에서 아무 말도 하지 않았을 때 마침표만 입력되던 문제를 고쳤습니다.
- 받아쓰기를 시작할 때 "space"가 낭독되고 그 소리가 받아쓴 내용에 섞이던 문제를 고쳤습니다.
```

### en

```
New
- Live crowd levels: see how busy major areas of Seoul are right now, with a plain-language description. Ask in chat and it will also tell you when it gets quieter.
- Cultural events nearby: exhibitions, performances, and festivals running today, sorted by distance.
- Out-of-service notices: transit routes now tell you when a leg falls outside first and last departure times.
- Nearby from a place: open a place to check bus arrivals, bike stations, and weather around it.

Improved
- Fixed dictation inserting only a period when nothing was said.
- Fixed "space" being spoken at the start of dictation and leaking into the transcript.
```

---

## 1.1 (빌드 7)

제출 2026-07-31 07:06 KST. 1.0 승인 후 쌓인 110커밋(iOS 37건)을 담은 첫 업데이트. **en 스토어 로컬라이제이션이 이 제출과 함께 공개됐다.**

### ko

```
새로운 기능
- 계단 없는 경로: 도보 길찾기에서 계단을 피하는 경로를 따로 요청할 수 있습니다. 무계단 경로가 없으면 그 사실을 알려 줍니다.
- 보행 인프라: 내 주변의 음향신호기, 횡단보도, 점자블록 위치를 확인할 수 있습니다.
- 대중교통 대안 노선: 여러 경로를 요약으로 비교하고, 원하는 경로를 펼쳐 구간별 안내를 볼 수 있습니다.
- 장소에 관해 물어보기에 추천 질문을 추가했습니다.

개선
- 자동차 경로 안내가 도로명을 포함한 완성된 문장으로 바뀌었습니다.
- 채팅 답변의 출처와 진행 상황이 각 언어로 정확히 표시됩니다.
- 영어로 사용할 때 지하철역 이름이 영문으로 표시됩니다.
- 버스 경유 정류소 안내와 화면 전환 시 포커스 이동을 다듬었습니다.
- 오류 상황을 더 정확히 구분해 알려 줍니다.
- 대한민국 밖에서 사용할 때의 안정성을 개선했습니다.
```

### en

```
New
- Step-free routes: request a walking route that avoids stairs. If no step-free route exists, the app tells you.
- Walking infrastructure: find audio signals, crosswalks, and tactile paving near you.
- Transit alternatives: compare routes at a glance, then expand one for step-by-step guidance.
- Suggested questions when asking about a place.

Improved
- Driving directions now read as complete sentences that include street names.
- Chat sources and progress updates appear in your language.
- Subway station names are shown in English when using the app in English.
- Refined bus stop announcements and focus movement between screens.
- Error states are told apart more precisely.
- Better stability when using the app outside South Korea.
```

---

## 1.0 (빌드 6)

제출 2026-07-28 · 2.1(a) 반려 1회 대응 후 **승인·출시 2026-07-30**.

첫 출시라 What's New가 없다. 스토어 설명이 그 역할을 하며 정본은 [`1.0-submission-draft.md`](1.0-submission-draft.md) §2(ko)·§3(en)이다.

반려 사유와 대응은 `CHANGELOG.md` 2026-07-29 "서비스 지역 커버리지 계약 + 받아쓰기 재설계" 항목을 본다.
