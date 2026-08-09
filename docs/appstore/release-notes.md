# App Store 릴리스 노트 (What's New)

버전별 What's New의 **정본**. ASC에 입력하는 문구 그대로 둔다.

- 제출 절차·ASC 입력값(설명·키워드·영양 라벨·심사 노트)·함정은 [`1.0-submission-draft.md`](1.0-submission-draft.md)가 정본이다.
- 앱·웹·CLI를 아우르는 날짜별 개발 이력은 [`CHANGELOG.md`](../../CHANGELOG.md).

**작성 규칙**:
- **iOS 사용자에게 보이는 변경만** 담는다. 웹 전용 변경은 push 즉시 배포되므로 "이 업데이트의 새 기능"이 아니다. 리팩토링·테스트·문서도 제외.
- 서버 변경도 원칙적으로 제외하되, **서버 판정과 앱 UI가 짝인 기능**은 그 앱 버전에서 처음 보이므로 포함한다(1.2의 운행 밖 표기가 그 사례).
- 새 버전 초안은 **프로모션 텍스트를 승계하지 않는다**. 설명·키워드·URL은 승계되므로 프로모션 텍스트만 따로 확인한다(비운 채 제출하면 스토어에서 그 줄이 사라진다).

---

## 1.4 (빌드 10)

현위치 수동 지정. 실시간 길 안내는 계속 봉인(`#if EXPERIMENTAL`)이라 이 버전에도 담기지 않는다.

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
