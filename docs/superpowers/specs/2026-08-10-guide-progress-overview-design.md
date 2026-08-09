# 실시간 안내 진행 상황 조망·하단 표시 재구조 설계

- 날짜: 2026-08-10
- 발단: 위원장 실보행 피드백(2026-08-09 보행분). ①진행 상황 버튼의 정보 가치가 낮다(주기 통지와 사실상 동일) ②화면 하단에서 현재 구간 안내와 다음 안내가 라벨 없이 혼재 ③"다음 안내 N개" 개수는 잉여.
- 위원장 판정(2026-08-10 문답 4건): ⓐ진행 상황 낭독은 짧게(서수+잔여+현재+다음 1개) ⓑ전 구간 조망은 **버튼으로 펼치는 목록**(경로 브리핑처럼 여러 행, 현재 구간 표식, 스와이프로 훑기) ⓒ하단은 역할 고정 2행 분리 ⓓ묶음 통독은 개수 제거·서두 "다음 안내." 유지.

## 1. 문제 확정 (코드 근거)

- `GuideText.progress`(iOS)·`progressFollowingLine`(웹)의 following 응답 "남은 거리 {total}. {distance} 앞 {step}"은 뒷부분이 주기 통지 `guide.next`와 문자 그대로 동일하고, 앞부분은 시트 상시 행(`remainingText`)과 중복. bundle 응답은 개수만 있고 내용이 없다(`guide.progressBundle`).
- `statusText`는 단일 슬롯이라 실행 안내(현재 유닛 전문)·주기 예고(다음 스텝)·임박 명령·상태 문구가 같은 행을 라벨 없이 덮는다 → 행의 의미가 시점마다 바뀐다.
- `guide.bundle` = "다음 안내 {count}개. {steps}"는 15초 재통독(`bundleReread`)까지 겹쳐 개수가 반복 청취된다.

## 2. 진행 상황 낭독 재설계

국면별 응답(웹·iOS 미러, 거짓 정밀 금지 원칙 유지):

- `following`: `[서수] [잔여] 현재 안내, {현재 유닛} (다음 안내, {다음 스텝} | {dest}까지 {segment})`
  - 서수: `guide.progressOrdinal` = "안내 {count}개 중 {n}번째 구간" (n = stepIndex+1, count = steps.count)
  - 잔여: 기존 `guide.remainingDistance`(+가능 시 `guide.remainingTime`) 재사용 — ETA 근거 없으면 시간 생략(3-state).
  - 현재: `guide.progressCurrent` = "현재 안내, {step}" (구분자는 쉼표 — `progressUncertain`의 "마지막 안내, {last}" 관례)
  - 다음: `guide.progressNext` = "다음 안내, {step}". 마지막 스텝이면 기존 `guide.nextDestination`("{dest}까지 {distance}", distance = 구간 잔여).
- `bundle`: `[서수] [잔여] {묶음 통독}` — 통독 자체가 "다음 안내. A. B" 서두를 가지므로 별도 다음 파트 없음. `guide.progressBundle` 키 폐기.
- `uncertain`·`reacquiring`·`offRoute`·`finalApproach`: **현행 유지**(수치 단정 금지·직선거리 정본). 서수를 붙이지 않는다 — 위치 확신이 낮을 때 "5번째 구간"은 거짓 정밀이다.
- car도 같은 `progress` 경로(도로명 접두·ETA 오래됨 병기 유지).

## 3. 전 구간 조망 모달 (iOS)

> **개정 2026-08-10 당일**: 초판(같은 시트 안 인라인 펼침)은 위원장 1차 확인에서 "같은 화면의 탐색 개체가 너무 많아진다"로 판정되어 **별도 시트(모달)로 전환**했다. "전체 경로만 딱 확인하고 닫는다"가 요구다.

- 진행 상황 버튼 누름(경로 보유 상세 세션) = 조망 모달 표시. **이 경로에서는 Announcement를 내지 않는다** — 시트 표시의 착지 낭독이 통지를 잠식하므로(헌장 §6 계열), 조망 문장은 **모달 섹션 헤더**가 전달한다(시스템이 섹션 헤딩에 착지하는 실기기 선례 재사용). `progressText()`(조립)와 `announceProgress()`(발화)를 분리해 헤더와 비모달 경로가 같은 문장을 쓴다.
- 행 구성: `{n}. {step.description}` 단일 텍스트(한 줄 = 한 객체). 현재 구간 행만 `{n}. 지금 이 구간, {description}`(`ios.guide.routeListCurrent`). 지난 구간에 별도 표식은 두지 않는다(서수와 현재 표식으로 위치가 정해진다 — 잉여 금지).
- 표식·헤더는 fix 갱신에 따라 조용히 최신화되고 **통지는 없다**(live region 아님 — 조회형 정보).
- 닫기: 스와이프·VO escape·"경로 목록 닫기" 버튼 **상하 2개**(위원장 판정 2026-08-10 — 행 수가 많으면 말미까지 스크롤 압박). 상단 닫기는 나브바 toolbar가 아니라 헤더 다음 첫 행이다 — 나브바 요소는 섹션 헤더보다 먼저 착지 후보가 되어 "모달 착지 = 조망 낭독" 계약을 깬다. 닫으면 시스템 표준 dismiss가 트리거 버튼(진행 상황)으로 포커스를 복원한다(실기기 확인은 BACKLOG 판정 ⑤).
- 경로 미보유·간략 세션은 모달 없음 — 버튼 동작은 현행(직선거리 낭독, `announceProgress()`)뿐. 죽은 모달 금지.
- 모달이 열린 채 자동 인계 등으로 상세가 풀리면 목록만 비고 헤더가 그 시점의 정직한 진행 상황을 계속 전달한다(3-state).
- **웹 비적용(의도적 비대칭)**: 웹은 추적 UI가 길찾기 화면을 덮지 않아 전체 스텝 목록이 이미 화면에 있다. 중복 금지.

## 4. 하단 역할 고정 2행 (iOS 시트 + 웹 패널)

- 신설 `currentGuidanceText`(iOS)·`currentText`(웹): **지금 따르는 유닛 전문**. 갱신 시점은 실행 안내가 나가는 순간뿐 — 시작·재조회 원자 발화의 유닛부, `announceSteps`, `bundleReread`. 화면 행은 `guide.progressCurrent` 틀 재사용("현재 안내, {step}").
- 기존 `statusText`(iOS)·`liveText`(웹)는 상태·예고 행으로 유지: 주기 예고·임박 명령·원거리 예고·상태 전이·최종 접근. **실행 안내는 더 이상 이 행을 덮지 않는다.**
- **iOS 강화(확정 2026-08-10, 예시 검토 중 위원장 승인)**: 구간을 넘는 순간(실행 안내 시점) 상태 행을 **비운다** — 직전 예고를 남기면 이미 돈 회전을 남은 것처럼 읽는다. 상태 행의 의미는 "지금 유효한 신호가 있을 때만 존재". 두 행이 같은 문장이 되는 경우는 시작·재조회 원자 발화(규모 정보 포함이라 유지) 한 순간뿐이다. ⚠ 전경 복귀 재생(`missedAnnouncement`)의 "현재 상태"는 `statusText`가 비어 있으면 `currentGuidanceText`로 폴백한다 — 비우기만 하고 폴백을 빠뜨리면 백그라운드 크로싱 직후 복귀에서 갚을 문장이 사라진다.
- **웹 비대칭(수용)**: 웹은 `liveText`가 발화 채널(aria-live)을 겸하므로 실행 안내가 상태 표시에 일시 잔류한다(비우면 발화 자체가 사라진다). 다음 통지가 자연 대체한다.
- 음성 낭독 채널·어순은 불변(2026-08-07 판정 계약 유지). 화면 행의 의미 고정만 바꾼다.
- 간략 모드·이탈 중에는 현재 안내 행을 숨긴다(경로 기반 값이 아니거나 거짓이 된다 — `remainingText` 노출 조건과 동형).

## 5. 묶음 통독 서두

- `guide.bundle` = "다음 안내. {steps}" (count 파라미터 제거, 서두 유지 — 여러 문장이 이어진다는 신호).
- 소비처: `GuideText.unit`·웹 `unitText`. 재통독(`bundleReread`)·시작·재조회 원자 발화 모두 이 틀을 지난다.

## 6. 구현 범위 (미러 동조)

| 층 | 파일 | 변경 |
|---|---|---|
| i18n | `messages/{ko,en,es,fr,it,ja}.json` | `guide.bundle` 개정, `guide.progressOrdinal`·`progressCurrent`·`progressNext` 신설, `guide.progressBundle`·`progressFollowing`·`progressFollowingDestination` 폐기 |
| iOS extra | `ios/i18n/ios-extra/{locale}.json` | `ios.guide.routeListRow`·`routeListCurrent`·`routeListClose` 신설 |
| xcstrings | `node ios/scripts/messages-to-xcstrings.mjs all` | 재생성 |
| Kit/앱 | `GuideText.swift` | `unit` 서두, `progress` 재설계(서수·ETA 인자), following/bundle 분기 |
| 앱 | `BeaconModel.swift` | `currentGuidanceText` 신설·배선, `currentStepOrdinal`(목록 표식·서수 공용) 노출, `announceProgress` 인자 |
| 앱 | `BeaconTrackingSheet.swift` | 현재 안내 행, 전 구간 목록(펼침·닫기·포커스 계약) |
| 웹 | `useRouteGuide.ts` | `unitText` 서두, `progressOverviewLine` 신설(구 `progressFollowingLine` 대체), `currentText` 노출 |
| 웹 | `DistanceBeacon.tsx` | 현재 안내 행(상세·비이탈) |
| 테스트 | `guide-line.test.ts` 등 | 새 어순 계약, `bundle` 서두, currentText 갱신 시점 |

## 7. 검증

- 게이트: `npm run test:run`(어순·i18n 키 일관성), iOS 빌드.
- 정본 판정: 위원장 실보행(진행 상황 조망 체감·2행 가독·통독 서두). 낭독 길이가 부담이면 서수 파트만 남기는 축소가 1차 후보.
