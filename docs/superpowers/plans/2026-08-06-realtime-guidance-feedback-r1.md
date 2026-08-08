# 실시간 길 안내 실사용 피드백 라운드1 계획 (2026-08-06)

> 출처: 위원장 실승차 실사용(2026-08-05, 강동역→서울월드컵경기장 왕복, PROGRESS B2 "위원장 실승차 판정"에 해당). 카카오톡 캡처 6장 확인 완료(탑승 대기 고정 장면·상태 문구·카카오지하철 경유역 UX 레퍼런스). 조사는 코드 3갈래 + 외부 API 실측 리서치 1갈래(서울 도착 API·열차 위치 API 실호출 대조 2026-08-06 00:25 KST).

## 위원장 결정 (2026-08-06)

1. **수단별 시작 버튼 라벨은 짧은 형**: "도보 안내 시작"·"자동차 안내 시작"·"대중교통 안내 시작". 2026-08-04 공통 라벨 판정(커밋 `5e33f6c`, "헤딩이 수단명이라 반복은 중복")의 번복이다. 번복 근거: VO 로터 버튼 목록·항목 선택기는 헤딩 문맥 없이 버튼 이름만 나열해 동일 라벨 3개가 구분 불가.
2. **대중교통 종료 후 도보 핸드오프는 A안(제안형)**: 완료 시 "남은 도보 안내 시작" 버튼 노출 + 포커스 이동. 자동 연결(B안)은 채택하지 않음(지하 역사 GPS 공백).
3. **"전경 전용" 확정(2026-08-03)을 번복, 백그라운드 승격 진행**: `UIBackgroundModes: location` + When In Use(항상 허용 불필요, 파란 표시줄 감수). ⚠ 도보·자동차만 살아난다. 대중교통 세션의 생명선은 위치가 아니라 네트워크 폴링이라 location 모드로 못 살림(BGTask·푸시는 이번 라운드 비범위).
4. **서울교통공사 빠른하차정보 API(data.go.kr 15143840) 추가**: 하차역 기준 계단·엘리베이터 최근접 출입문 위치. 시각장애 사용자 "몇 번째 칸 탑승" 안내 자산.

## 원인 요약 (13건)

| # | 피드백 | 원인 (근거 위치) | 확정도 | 마일스톤 |
|---|---|---|---|---|
| 1 | 지하철 현황 1~2분 지연 | upstream 데이터가 이미 15~25초 낡음(실측) + 폴 30초 가산. 공식 문서(OA-12764)가 recptnDt 보정을 명시 지시하는데 스펙 §11 기각 ⑨가 "생성 시각 필드 없음"이라는 **틀린 전제**로 기각했었다. `toArrival`이 recptnDt를 읽지 않음(`src/lib/providers/seoul-subway-arrival.ts:97-112`) | 확정 | M1 |
| 2 | 탑승 변경에서 복귀 불가 | 화면 전환이 아니라 국면 전환이라 취소 전이 부재(`TransitTrackingSheet.swift:57-75`, `TransitGuide.swift:428-433`). 스펙 §5.1의 3분 유지 버퍼를 `changeBoarding()`이 스스로 소거(`TransitGuideModel.swift:162`, 웹 `useTransitGuide.ts:444-446` 동일) | 확정 | M2 |
| 3 | 경유역 펼치기 없음 | `viaStops`(좌표 포함)가 이미 수신되나 종착 검사에만 사용(`TransitGuide.swift:50,258-272`). 추가 upstream 호출 0회로 표시 가능 | 확정 | M3 |
| 4 | 갈 때 탑승 대기 고정 | 후보 6경로: ①폴 empty 무통지(최유력, `TransitGuide.swift:504-507`) ②btrainNo 전무로 전 항목 비활성 ③전 항목 terminatesEarly ④unsupported/failed 지속 ⑤방향 필터가 반대편만 잔존(`classifyTransitBoardingCandidates`, 강동은 5호선 분기역이라 위험↑) ⑥폴링 목록 갱신 시 포커스 소실(스펙 §5.1 "heading 선점 복귀" 미구현). 탈출구(새로고침·수동 탑승) 자체가 없음 | 계측 필요 | M2 |
| 5 | 경로 대안 선택 | 후보 3: 서울교통공사 최단경로이동정보(15143842, 3유형, 커버 범위 미확인)·ODsay `subwayPathSchedule`(키 보유, 복수 경로+시간표 기반)·카카오 `v2/routing/publictraffic`(2026-07 신규, 기존 키 커버 추정). 신규 API 없이도 기존 ODsay 대안에서 안내 시작 가능(현재 recommended 전용, `DirectionsTabView.swift:713`) | 후보 확정 | M5 |
| 6 | 대중교통→도보 핸드오프 부재 | 스펙 §4.1 의도된 비범위. 하차 정류소 좌표(`alightStop`)·목적지 좌표(`trackedDestination`) 기보유, `BeaconModel.fetchGuideRoute`가 origin을 현재 GPS로 잡아 `beacon.toggle(kind:.walk)` 호출로 성립. 걸림돌: done 즉시 `stop()`이 상태 소거(`TransitGuideModel.swift:145-156`) → `pendingWalkHandoff` 보존 필요. ODsay 도보 leg 좌표는 없음(재조회 필수) | 확정 | M3 |
| 7 | 계단에서 "속도 빠름" 오인 | 속도가 GPS 도플러가 아니라 경로 투영 진행거리 미분(`RouteGuide.swift:349-357`). 단조 전진 정류(`:341`)가 노이즈 앞쪽 성분만 누적 + 정확도 30~50m fix가 게이트 통과 + 창 중간 점프는 reacquiring에 안 걸림. 임계 3.0m/s 중앙값 10초 창 | 개연성 높음 | M4 |
| 8 | 상세 전환 토글 미표시 | 초기화 레이스 코드 확정: `start()`가 위치 스트림 시작 직후 경로 조회 → `currentCoordinate()`가 추적 중이면 대기 없이 캐시 게이트(30m/60s) 실패 시 즉시 throw(`LocationService.swift:261-266`) → `fallbackToBrief()` 고정, 재시도 없음. 재시작 시엔 첫 세션 fix 캐시로 성공 | 확정 | M0 |
| 9 | 상태 문구 어색 | 마침표 조립기(통지, 공백 연결)와 쉼표 조립기(화면, `joinText`)가 같은 문자열 공유 → "기준., " 이중 구두점(`TransitTrackingSheet.swift:43-55` vs `TransitGuideModel.swift:167-179`). 부수 드리프트: iOS 상태 줄만 `stationCountAbout` 폴백·`lastUpdated`(스펙 §6.1 상시 표시 요구) 누락 | 확정 | M1 |
| 10 | 한 정거장 전 알림에 역명 없음 | `arvlMsg2`가 "전역 도착"류에서만 괄호 역명 생략(실측 확인). `arvlMsg3`(현재 역)는 provider가 `currentLocation`으로 파싱해 두고 `trackSubway`가 버림(`src/lib/transit-track.ts:190-199`). 스펙 §5.2 "arvlMsg3 병용" 미구현 | 확정 | M1 |
| 11 | 장시간 복귀 시 refresh | (가) IdleReset 10분에 안내 중 예외 없음 → TabView 재생성이 세션 소멸(`GildongmuApp.swift:81-95`, `IdleReset.swift:9-16`) (나) `UIBackgroundModes` 미선언이라 suspend/jetsam → 콜드 런치 | 확정 | M0(가)·M4(나) |
| 12 | 버튼 라벨 통일 | 2026-08-04 판정 산물. 위 결정 1로 번복 | 확정 | M0 |
| 13 | 화면 켜기 문구 고정 | `beacon.screenHint` 상시 표시(`BeaconTrackingSheet.swift:72`, 웹 `DistanceBeacon.tsx:111`) | 확정 | M0 |

## 외부 API 실측 결론 (조사 정본)

- **realtimePosition 전환 금지**: 도착 API 대비 더 낡음(lag 중앙값 55초 vs 22초, 최대 116초. 이벤트 간 무갱신 구조). 완성 문장 부재로 낭독 정본 규칙과도 충돌.
- **recptnDt는 보정이 아니라 신선도 게이트로**: 함정 3종 실측. ①운영사별 lag 편차 극단(서울교통공사 16~33초 / 코레일 계열 최대 19분 / 신분당선 **미래값 고장**) ②신분당선은 recptnDt 동결+arvlMsg2 정상 갱신이라 문서식 보정 적용 시 역방향 보정 ③큰 lag는 대부분 종착 상태(arvlCd 1·2·5) 동결 레코드. → ⓐ lag<0 클램프 ⓑ lag>120초 ∧ 종착 상태면 unknown ⓒ 낭독 정본은 arvlMsg2 유지, barvlDt 재환산 금지.
- **arvlCd 코드값**: 0진입 1도착 2출발 3전역출발 4전역진입 5전역도착 99운행중. arvlMsg2 정규식보다 정확한 위치 신호(현재 `"1"`만 사용).
- **경로 대안 쿼터**: 서울교통공사 최단경로 무료(활용신청 필요, `DATA_GO_KR_API_KEY` 재사용) / ODsay 기존 일 1,000건 공유 / 카카오 publictraffic 월 300,000건(dodo 공유 키 첫 활성화 앱 정책 점검 필요).
- 근거 URL은 조사 원문 참조: OA-12764(recptnDt 유의사항)·OA-12601·15143842·15143840·lab.odsay.com·devtalk 150809.

## 마일스톤

### M0. 즉효 소품 (전부 소, 상호 독립, 스펙 불요)
1. **8번**: 경로 조회를 `start()` 직후가 아니라 첫 수용 fix 도착 후 트리거(`awaitingRoute`·`routeFetchToken` 재사용). `guide.detailUnavailable` 문구를 위치 대기/경로 실패로 분리.
2. **11-(가)**: `GuideSessionCoordinator`에 `isActive` 공개, `GildongmuApp.swift:88` 리셋 조건에 `!isActive` 조인. 웹 IdleReset 동일 구멍 확인.
3. **13번**: `screenHint`를 첫 사용 1회 안내 + "다시 보지 않음"(UserDefaults)으로. 웹 `DistanceBeacon.tsx` 동조.
4. **12번**: `beacon.guideStart`를 수단별 3키로 분리(짧은 형). 6로케일 messages 정본 → `node ios/scripts/messages-to-xcstrings.mjs app` → `check-xcstrings-keys.mjs` 게이트 → iOS 3곳(`DirectionsTabView.swift:507,517,529`)·웹 3곳(`DirectionsView.tsx:735,744,751`) 교체 → `DirectionsGuideEntry.test.tsx` 단언 8곳 갱신. 코드 주석의 구 판정 문구 갱신.

### M1. 추적 정보 품질 배선 (1+9+10, 중) — 스펙 증보 선행
같은 배선(TS `TrackItem` → Kit `TransitTrackItem` → 공유 fixture `transit-guide-scenarios.json` → 문구·시트)을 한 번에.
- `recptnDt`·`currentLocation`(arvlMsg3)·`arvlCd` 투영. 신선도 게이트(위 ⓐⓑⓒ). recptnDt 동일 스냅숏이면 통지 생략(낡은 문장 재발화 차단).
- "N초 전 기준"+`lastUpdated` 상시 표시(iOS 누락 보충), `stationCountAbout` 폴백 드리프트 해소.
- 폴 주기: 잔여 4개 이상 30→15초(레이트리밋 60초 20회 내). 실승차 판정 도착으로 상수 변경 금지 해제됨.
- 상태 문구: 조립기 통합(통지·화면 동일 헬퍼) + `transitGuide.context` 카피 개선("{line} 탑승 중, {stop}에서 하차합니다." 방향) + upstream 문장 라벨 프레임("{stop} 도착, {message}"). 완성 문장 원문 불변.
- `.countdown`(한 정거장 전)에 현재 역 병치(10번 본체).
- 스펙 §11 기각 ⑨ 전제 오류 정정 명기.

### M2. 대기 국면 탈출구 + 계측 (4+2, 소~중)
- waiting에 "새로고침" + "이미 탑승했습니다"(식별자 없는 근사 잠금, tagoBus 계약 동형) 추가.
- 0건 사유 3-state 구분(empty/unsupported/필터 전멸)을 화면·통지에.
- 포커스 소실 시 목록 heading 선점 복귀(스펙 §5.1 미구현분).
- 탑승 변경 취소 A안: 직전 `state.lock` 보존 → "탑승 변경 취소" 버튼 → `dispatch(.board(previousLock))`. `retained = [:]` 소거 제거(스펙 원래 의도 복원). 웹 미러 동조.
- 실험판 계측: 대기 국면 폴 결과 status·원시 건수·필터 단계별 잔존·비활성 사유(`ChatFocusDiag` 선례). 다음 실승차에서 4번 원인 확정.
- 보류: C안(탑승 변경을 하차역 조회로 전환)은 A안 실사용 판정 후.

### M3. 경유역 목록 + 도보 핸드오프 (3+6, 중)
- `viaStops` 정적 목록 1단계(항목 무헤딩·도착편 관례, `RevealWindow` 단계 공개 검토). M1의 현재 역과 결합해 탑승 위치 표시.
- 핸드오프 A안: done 전이 시 `pendingWalkHandoff`(하차역명·좌표·도보 분) 보존 → "남은 도보 안내 시작" 버튼+포커스 → `beacon.toggle(dest:tracked.dest, kind:.walk)`. 게이트는 `realtimeGuidanceEnabled ∧ ko`만(실패는 `fallbackToBrief` 흡수). 웹 미러+fixture 동조.
- 보류: 역별 장소 상세 링크 2단계(전화번호 출처가 카카오 검색 왕복뿐, NavigationStack 감싸기+이탈 게이트 필요)는 1단계 실사용 판정 후.

### M4. 속도 가드 + 백그라운드 승격 (7+11나, 소~중)
- 7번: `fix.accuracy > 20` fix를 속도 표본에서 배제(투영은 유지) + 문구 원인 미단정형("위치 신호가 불안정합니다…")으로. 웹 `route-guide.ts`+fixture 동조. 도플러 속도 도입(근본)은 실주행 판정과 묶음.
- 11-(나): `UIBackgroundModes: location` 선언 + `allowsBackgroundLocationUpdates`(도보·자동차 세션 중만). 위치 권한 문구·PrivacyInfo·ASC 라벨 3자 일치 점검(개인정보 불변식). 근거: `docs/research/RESEARCH-2026-08-02-realtime-walk-navigation.md` §6.1. 대중교통은 비범위(네트워크 폴링이 생명선).

### M5. 경로 대안 (5, 조사 선행)
- 실호출 검증 3건: ①카카오 `v2/routing/publictraffic`(기존 키, 복수 경로 여부 판정) ②서울교통공사 최단경로 활용신청 후 커버 범위(1~8호선 한정이면 반쪽) ③ODsay `subwayPathSchedule`(복수 경로+시간표 기반 → [[odsay-ignores-departure-time]] 지하철 구간 해법 후보).
- 신규 API 무관 선행 가능: ODsay 대안 경로에서도 안내 시작(현 recommended 전용 해제).

### M6. 빠른하차정보 (신규, 위 결정 4)
- data.go.kr 15143840 활용신청 → 실호출로 응답 계약 확정(datagokr-envelope 공용 파서, 단건 모양 실측 필수) → 하차역 안내에 최근접 출입문(계단·엘리베이터) 병치 설계. M1 배선과 자연 결합.

## 권장 순서와 게이트

M0(즉시, 다음 실승차 전 배포) → M1·M2(스펙 증보 후, 병행 가능) → M3 → M4 → M5·M6(활용신청 대기 시간이 있어 신청만 먼저 걸어두는 것 권장).
- 외부 API 통합은 실호출이 머지 게이트(fixture green 불충분).
- 상태 머신 변경은 웹 `src/lib/transit-guide.ts` ↔ Kit 미러 + 공유 fixture 동조 강제.
- iOS 수정은 커밋+실기기 배포(Experimental 구성)까지 한 사이클.
- 판정 게이트: 4번 원인 확정(M2 계측), A안 핸드오프·짧은 라벨·경유역 1단계는 다음 실승차 실사용 판정.
