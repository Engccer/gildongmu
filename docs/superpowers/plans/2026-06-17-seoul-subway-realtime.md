# A2 — 서울 지하철 실시간 도착정보 (OA-12764)

작성: 2026-06-17 · 상태: 구현 중 · 정합: 직계 선례 `seoul-metro-facilities`(동형 온디맨드 패턴)

## 목표 (측정 가능한 성과)

역 장소 상세에서 **"다음 열차 N분 후 / 현재 위치 / 종착"을 텍스트로 낭독**한다. TAGO가 미커버하는 도시철도(서울 1~9호선 + 연계노선)의 실시간 정보를 지도 없이 완결. 시각장애인에게 "언제 타야 하는지", 외국인에게 방면·종착을 한국어 완성문(`arvlMsg2`)으로 제공.

## 외부 계약 (2026-06-17 실호출 확정)

- 엔드포인트: `http://swopenapi.seoul.go.kr/api/subway/{KEY}/json/realtimeStationArrival/{start}/{end}/{역명}` (http — https 미제공)
- 키: `SEOUL_SUBWAY_REALTIME_KEY` — **일반키(`SEOUL_OPEN_DATA_KEY`)와 별도 계열**. data.seoul.go.kr "실시간 데이터 인증키"(데이터셋 OA-12764 → "인증키 신청 (지하철)"). 일반키로는 `ERROR-338`. 일 1,000회/키(갤러리 등록 시 무제한).
- **응답 envelope가 정상/에러에서 다름**:
  - 정상: `{ errorMessage: { code: "INFO-000", total: N }, realtimeArrivalList: [ {...} ] }`
  - 데이터 없음(비서울역·없는역): `{ status: 500, code: "INFO-200", message: "해당하는 데이터가 없습니다.", total: 0 }` — 최상위 `code`, `errorMessage`/`realtimeArrivalList` **없음**
- 행 필드: `subwayId`(호선코드 1002=2호선·1077=신분당선) · `updnLine`(상행/하행/내선/외선) · `trainLineNm`("성수행 - 역삼방면") · `bstatnNm`(종착) · `barvlDt`(도착 초, "0"=진입) · `arvlMsg2`(**낭독 정본** "강남 도착") · `arvlMsg3`(현재위치) · `btrainSttus`(일반/급행) · `arvlCd`(1=도착) · `statnNm`(역명).

## 정본 정확성 규칙 (seoul-metro-facilities 정책 계승)

- `INFO-000` → 파싱. `INFO-200`(데이터 없음) → **null**(미커버 역, graceful "정보 없음"). 그 외 코드(인증·쿼터·서버) → **throw → 502**(일시 장애 ≠ 정보 없음, 시각장애인에겐 다른 의미).
- 실시간이라 **캐시 안 함**(`no-store`), 자동 폴링 없음 — 사용자 수동 새로고침 + 조회시각(`asOf`)으로 신선도 보장(스크린리더 반복 통지 회피, BusArrivals 결정 계승).
- 호선코드 미매핑은 graceful(코드 숨김) — 매핑표는 표준 코드 기반, 누락돼도 도착정보 자체는 보존.

## 파일

1. `src/lib/types.ts` — `SubwayArrival`, `SubwayStationArrivals` 추가.
2. `src/lib/providers/seoul-subway-arrival.ts` — `SUBWAY_LINES` 코드매핑 + 순수 파서 `parseSubwayArrivals` + `fetchSubwayArrivals`.
3. `src/lib/env.ts` — `SEOUL_SUBWAY_REALTIME_KEY` + `hasSeoulSubwayRealtimeKey()`.
4. `src/app/api/station/subway-arrival/route.ts` — z 검증, null 200 / 장애 502.
5. `src/components/SeoulSubwayArrival.tsx` — 온디맨드 버튼 → fetch → aria-live → 상/하행 그룹 텍스트 + 조회시각 + 새로고침.
6. `src/components/PlaceDetail.tsx` — `isStation` 블록에 추가.
7. `messages/ko.json`·`messages/en.json` — `subwayArrival` 네임스페이스.
8. `src/lib/__tests__/seoul-subway-arrival.test.ts` + `fixtures/seoul-subway-arrival.json`(강남 실응답 박제).

## 테스트 (결정적 게이트)

- `parseSubwayArrivals`: 강남 fixture → 7건, subwayId→노선명 매핑, arvlMsg2 보존, 상/하행 분리.
- `INFO-200`(최상위 code) → null. 인증실패류 코드 → throw.
- `fetchSubwayArrivals`: 키 없음 → null, HTTP 실패 → throw.

## 리뷰 포커스

- envelope 두 형태(정상 `errorMessage.code` vs 에러 최상위 `code`) 분기 정확성.
- 미커버(null) vs 장애(throw) 구분이 라우트까지 일관되게 전파되는지.
- a11y: 상/하행 그룹 헤딩, 조회시각 표기, aria-live polite 단일 채널(BusArrivals/SeoulMetroFacilities 동형).
