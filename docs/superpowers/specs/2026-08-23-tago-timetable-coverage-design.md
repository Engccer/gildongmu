# TAGO 시간표 (역·노선) 커버리지 공백 3-state (A19)

> 상태: 설계 확정 · 2026-08-23 · 기준 커밋 `17cd113` · 백로그 `docs/BACKLOG.md` A19
> 계약 정본: dodo `docs/superpowers/specs/2026-08-23-tago-timetable-coverage-design.md` §3(적대적 설계 리뷰 통과본). 이 문서는 그 계약을 gildongmu에 **그대로** 이식하며, 관측·근거·판정표는 재서술하지 않고 gildongmu 고유 차이만 적는다.
> 설계 리뷰 판정: **생략.** 새 판정 계층(방향 4분류·노선 결합·allowlist 게이트)은 dodo에서 적대적 리뷰 16건을 거친 계약을 축 하나 바꾸지 않고 쓰고, gildongmu 신규분은 소비자 배선·문구(국소·가역)다.

## 1. 결함

`src/lib/providers/tago-subway.ts`의 `if (!fl) return; // 그 방향 유효 행 0 — 생략`이 인증 정상(`00`)인데 스케줄 0행인 (역·노선)을 `lines[]`에서 통째로 뺀다. `partial`은 rejected일 때만 붙어 빠진 사실이 응답 어디에도 없다. gildongmu 실호출(2026-08-23, 평일 `01`): 홍대입구 2호선 U0/D0, 강남 신분당 U0/D0, 서울역 공항 U0/D0 — 같은 역의 다른 노선은 정상. **(역·노선) 단위**다(공항철도는 홍대입구에서 정상).

파급: `subway-nearby.ts` `judgeStationService`가 같은 `lines`를 훑어 심야 "운행 종료, 첫차 X"를 단정하므로 빠진 노선이 운행 중이어도 단정이 나간다. `subway-service-hours.ts`는 Map miss → `unknown`이라 이미 3-state이고 **손대지 않는다.**

## 2. 계약 (dodo §3 그대로)

```ts
export type TimetableLineCoverage = "ok" | "noTrains" | "unknown" | "unavailable";
interface TimetableLine { lineName: string; coverage: TimetableLineCoverage; directions: TimetableDirection[] }
```

- **방향 4분류**: rejected → `unavailable` / 성공+원시 0행 → `unknown` / 성공+파싱 가능 0행 → `unknown` / 파싱 가능 ≥1 + 편성 0(전부 당역 종착) → `noTrains` / 편성 ≥1 → `ok`.
- **노선 결합(순서가 불변식)**: ok > unavailable > unknown > noTrains. unknown이 참인 0을 이긴다.
- **매칭된 노선은 전부 `lines`에 실린다.** `directions`는 `coverage === "ok"`일 때만 비지 않는다. 따라서 `lines`는 비지 않는다(매칭 0건은 `null`).
- `partial`은 호출 실패가 하나라도 있으면 true(현행 정의, 독립 축).
- **`judgeStationService` allowlist**: `ok`·`noTrains`만 판정 참여, 그 외 값(미지 값 포함)이 하나라도 있으면 `closed:false`(fail-closed). 대가: 0행 노선이 있는 역(홍대입구·강남·서울역…)은 심야 "운행 종료" 안내가 나가지 않는다 — 거짓 확정보다 침묵이 덜 해롭다(교환이지 회귀가 아니다).
- 요일 한정성 재조회·평일 참고값·`ok` 노선 첫차 첨부는 **하지 않는다**(dodo §3-4·§3-7 기각 근거 그대로).

### gildongmu 고유 차이

- **`deriveFirstLast` 시그니처 불변.** `subway-service-hours.ts`(소유 밖)가 `null` 반환에 의존한다. 4분류는 새 함수 `classifyDirection(rows, stationId)`가 하고(파싱 가능 행 수를 따로 센다), `deriveFirstLast`는 그 위의 얇은 래퍼로 남긴다.
- **역 단위 토요일→휴일 폴백은 분류 앞에서 그대로 돈다.** 폴백 뒤에도 0행인 노선이 `unknown`이 된다. 그래서 토요일 수도권 전멸(dodo §2-2)이 gildongmu에선 대부분 휴일 다이어로 흡수되고, `unknown`은 (역·노선) 고유 공백에 집중된다.
- **소비자가 UI 4곳이다**(dodo는 채팅 산문뿐). 문구 계약은 §3.

## 3. 소비자 문구 (6로케일 `timetable.coverage.*`, `{line}` 1개)

| coverage | ko | 구분 근거 |
|---|---|---|
| `unknown` | `{line} 오늘 시간표를 확인할 수 없습니다` | "운행 없음"·"제공 안 함"으로 말하지 않는다(관측은 0행뿐) |
| `unavailable` | `{line} 시간표를 불러오지 못했습니다` | 조회 실패(`timetable.error` 전체 실패와 같은 어휘, 노선 단위) |
| `noTrains` | `{line} 오늘 탑승할 수 있는 편성이 없습니다` | 참인 0(당역 종착뿐) |

- 웹 `StationTimetable.tsx`·iOS `StationSections.swift`: `ok`면 종전 방향 행, 아니면 위 한 줄(한 줄=한 객체). CLI `formatters.ts`: ko 사본 미러.
- **`timetable.empty`는 삭제한다.** 매칭 ≥1 → `lines` ≥1이라 도달 불가 분기다(웹·CLI·iOS 셋 다 제거, 6로케일 키 제거).
- 채팅 `declarations.ts` `get_station_timetable` 설명에 coverage 4값 뜻과 "노선 생략 금지·unknown을 운행 없음으로 답하지 말 것"을 싣는다(`router.ts`는 주석만).
- **iOS `TimetableLine.coverage: String?`** — 웹 배포가 앱보다 먼저라 옵셔널. 구서버 응답은 `directions`가 빈 노선을 내지 않으므로 `nil + 빈 directions`는 도달하지 않지만, 그 조합은 `unknown` 문구로 떨어뜨린다(덜 단정적인 쪽).

## 4. 실호출 게이트 `scripts/verify-korea-subway-timetable.mjs` (신설, dodo 동명)

dodo판을 경로만 바꿔 가져온다(`src/lib/providers/tago-subway`·`src/lib/station-match`, esbuild 번들로 provider 실판정을 태운다 — 판정·정규화 복제 금지). 요일 무관 불변식 3종만 단언: ①매칭 노선 수 == `lines.length` ②모든 line에 `coverage` ③`directions.length > 0 ⇔ coverage === "ok"`. 홍대입구·강남·서울역 노선별 coverage는 관측 로그. 머지 게이트로 1회 실행한 결과를 §6에 남긴다.

## 5. 테스트

- `tago-subway.test.ts`: 시나리오 D 분할(전부 당역 종착 → `noTrains` / 원시 0행 → `unknown` / 파싱 불가 행만 → `unknown`), 2노선 fixture(하나 0행·하나 정상 → 둘 다 `lines`, partial 없음), 방향 비대칭(상 `unknown`·하 `noTrains` → `unknown`; 상 실패·하 0행 → `unavailable`+partial), `combineLineCoverage` 순서.
- `subway-nearby.test.ts`: `unknown` 노선 섞이면 판정 불가, `noTrains`만인 노선은 판정에 참여(다른 노선 outside면 closed), **존재하지 않는 coverage 값 → 판정 불가**(fail-closed).
- `StationTimetable.test.tsx`(jsdom 신설): coverage별 문구 1줄, `ok`는 방향 행.
- CLI `formatters.test.ts`: coverage 3줄·`empty` 케이스 제거.
- 채팅 `station-timetable-tool.test.ts`: fixture에 coverage.
- Kit: `TimetableLine` 디코딩에 `coverage` 부재·존재 둘 다.

## 6. 검증 기록

- **실호출 게이트 2026-08-23(일요일 다이어 `03`)**: `node scripts/verify-korea-subway-timetable.mjs` **15/15 PASS**. 관측 — 강남: 신분당선 `unknown`·2호선 ok / 홍대입구: 공항선 ok·경의중앙선 ok·2호선 `unknown` / 서울역: 공항선 `unknown`·GTX-A ok(하행만)·경의중앙 ok(상행만)·1호선 ok·4호선 ok. 탈락 0, `directions` 비지 않음 ⇔ `ok` 성립. 로컬 dev 서버 경유 `/api/station/timetable` 응답도 동일.
- **시뮬레이터 라벨 확인**: Debug 앱이 http 로컬 서버에 ATS로 못 붙어(plist 예외 없음, 소유 밖) 통합 push 뒤 prod(Vercel 자동 배포)를 대상으로 확인한다 — 웹이 앱보다 먼저라는 배포 순서와 같다.
