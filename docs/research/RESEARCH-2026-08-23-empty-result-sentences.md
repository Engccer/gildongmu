# 커버리지 통과 뒤 0건 문장 갈림 실측 (2026-08-23)

> 시점 고정 조사 기록이다. 출처는 BACKLOG E19(커버리지 폴리곤 승격, 종결) 본문이고, 열린 판정은 BACKLOG §2 관찰 항목 "0건 문장 갈림"이 들고 있다.

폴리곤 승격은 끝났다(CHANGELOG 2026-08-23, spec `docs/superpowers/specs/2026-08-23-coverage-boundary-polygon-design.md`). 판정 축은 **"한국 안인가"**로 확정됐고 — upstream이 답하는 범위는 `unavailableHere`와 0건 축이 따로 든다 — `isInKorea`가 국경 폴리곤으로 판정한다.

**남은 것: 커버리지를 통과한 뒤 0건일 때 라우트마다 문장이 갈리는 축.** E19 범위 밖으로 두고 조사만 했다. 아래가 그 실측표다(2026-08-23, `isInKorea` 호출 라우트 18종 전수). 갈래 A=빈 목록 문장, B=`unavailableHere` 문장, C=그 밖.

| 라우트 | 0건 응답 | 웹 문장 | iOS 문장 | 갈래 |
|---|---|---|---|---|
| `air-quality/nearby` | `{air:null}` | 섹션 미렌더(문장 없음) | 동일 | A(침묵) |
| `weather/nearby` | `{weather:null}` | 섹션 미렌더 | 동일 | A(침묵) |
| `congestion/nearby` | `{area:null}`(서울의 91%가 여기) | 줄 미생성 | 동일 | A(침묵) |
| `bike/nearby` | 서울 밖 `unavailableHere:seoulOnly` / 안 0건 `[]` | "서울 지역에서만 제공됩니다." / "근처 1km 안에 따릉이 대여소가 없습니다." | 후자에 "1km" 없음 | B / A |
| `bus/nearby` | 미가입 `unavailableHere:noBusData` / 0건 `[]` | "이 지역은 정류소 정보가 제공되지 않습니다." / "주변에 버스 정류소가 없습니다." | 동일 | B / A |
| `events/nearby` | 서울 밖 `unavailableHere:seoulOnly` / 0건 `[]` | seoulOnly / "근처에 오늘 진행 중인 문화행사가 없습니다." | 동일 | B / A |
| `clinic/nearby` | `{clinics:[]}` | "근처에 **소아 야간·휴일** 진료 기관이 없습니다." | "주변에 진료 기관이 없습니다"(한정어 탈락) | A |
| `places/kids` | `{kids:[]}` | "근처에 아이 놀 곳(**키즈카페·놀이터·어린이공원**)이 없습니다." | 괄호 예시 없음 | A |
| `places/barrier-free` | `{places:[]}` | "주변에 **등록된** 무장애 관광지가 없습니다." | "등록된" 없음 | A |
| `places/around` | `{places:[]}` | "주변에 표시할 장소가 없습니다" | 동일 | A |
| `surroundings/scene` | `total:0` | "150m 안에 등록된 가게나 시설이 없습니다." | 동일 | A |
| `route/walk`·`route/transit` | `{result:null}` | "…경로를 찾지 못했습니다." | 동일 | A |
| `nearby/overview` | 불릿별 `none`/`unavailable`/`uncovered`/`failed` | "{label} {distance} 안에 없습니다."·"{label} 서울에서만 안내합니다." | 동일 | C |
| `station/subway-arrival/nearby` | `{stations:[], nearest}` | "…없습니다. 가장 가까운 역은 {역}, {거리} 거리입니다." | 동일 | C(유일하게 부가 정보) |
| `places/entrance` | `{entrance:null}` | 마커·실패·0건이 **전부 같은 침묵**으로 흡수 | 동일 | C |
| `route/car` | 502 `{error}` | 채팅카드는 서버 리터럴("경로를 찾지 못했습니다…")을, 비교화면은 고정 "경로 브리핑에 실패했습니다."를 낭독 | 항상 고정 문구 | C |
| `where-am-i` | 4조각 전멸 시 502 | UI 소비자 없음(웹 둘러보기는 `nearby/overview`) | UI 소비자 없음 | C |

**판정이 필요한 자리 넷** — ▶ 2026-09-02 코디네이터 판정: ①·④ 현행 유지(문맥이 다르다), ② 열어 둠(문장 판정 미결), ③ iOS 한정어 복원 착수(세션 ios-quality):
1. **같은 사실, 두 문장** — "서울 전용"을 패널은 "서울 지역에서만 제공됩니다", 한눈에 보기 불릿은 "{label} 서울에서만 안내합니다"로 말한다(버스 미가입도 같은 쌍). 통일할지, 문맥이 다르니 그대로 둘지.
2. **`route/car`가 웹 안에서도 소비자마다 다르다** — 채팅카드만 "경로를 찾지 못했다"가 살아남고 나머지는 "브리핑 실패"로 접힌다. 원인과 실패가 한 문장으로 뭉개진 자리.
3. ~~**iOS가 웹보다 한정어를 잃는다**~~ — ✅ 2026-09-02 종결(세션 ios-quality): `ios-extra` 6로케일의 `ios.nearby.{clinicEmpty,kidsEmpty,barrierFreeEmpty}`에 웹 한정어를 넣었다(iOS 문구 틀 "주변에 … 없습니다"·마침표 없음은 형제 키 관례대로 유지). 두 파일이 자동 동기 대상이 아닌 구조는 그대로다 — 웹 0건 문장을 고칠 때 iOS extra를 함께 본다.
4. **0건에 거리를 싣는 예외가 지하철 하나** — 연속량 도메인이라는 근거는 지하철에만 기록돼 있고, 같은 논리가 따릉이·버스·문화행사에 적용되는지는 미판정.
