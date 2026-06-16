# 따릉이(서울 공공자전거) 실시간 대여소 연동 — 설계

작성일: 2026-06-16
대상: `gildongmu` (접근성 우선 길찾기)
관련: `docs/RESEARCH-2026-06-seoul-open-data.md`(Top 3 #3), 버스 연동(`tago-bus.ts`/`BusArrivals`) 패턴 복제, 서울 버스(`2026-06-15-seoul-bus-api-design.md`)는 키 전파 대기로 병행 보류

## 배경 — 왜 따릉이가 먼저인가

서울 시내버스(ws.bus.go.kr)는 활용신청 [승인]·활용기간 정상에도 data.go.kr→ws.bus.go.kr 키 동기화 배치(익일 추정) 전까지 동작 불가가 실증으로 확정됐다(포털 자체 미리보기도 headerCd 7). 외부 타이밍만 남아 코드로 풀 게 없으므로, **같은 좌표 근접 패턴을 쓰면서 일반 인증키로 즉시 동작 확인된**(따릉이 `INFO-000`) 따릉이를 먼저 구현한다. 서울 버스는 키 전파되면 별도 재개.

## 측정 가능한 성과

장소 상세·홈(현위치) 화면에서 **"근처 따릉이 대여소 N곳 · 대여 가능 X대 · 도보 Ym"**를 스크린 리더만으로 완결 낭독한다. 지도 없이 텍스트로 대여/반납 판단이 가능해야 한다(접근성 정본).

## 데이터 소스

- **`bikeList`** (서울 열린데이터광장 OA-15493)
- 엔드포인트: `http://openapi.seoul.go.kr:8088/{KEY}/json/bikeList/{start}/{end}/`
- 인증: `SEOUL_OPEN_DATA_KEY` (`.env.local` 발급 완료, 2026-06-16 실호출 `INFO-000` 검증)
- envelope: `rentBikeStatus.RESULT.CODE`(`INFO-000`=정상) + `rentBikeStatus.list_total_count` + `rentBikeStatus.row[]`
- **⚠ 실측(2026-06-16)**: `list_total_count`는 "전체 대여소 수"가 아니라 **현재 페이지가 반환한 row 수**다(마지막 페이지 호출에서 720, 그 전 페이지들은 1000). 전체는 ~2,720곳. 버스 `totalCount` 교훈과 동형 — envelope 필드명이 직관과 다르니 실호출로만 확정. **종료 조건은 `list_total_count` 신뢰가 아니라 "받은 row 수 < 요청 크기면 마지막 페이지"로 한다.**
- row 필드(모두 문자열):
  - `stationId`(예 `ST-4`), `stationName`(예 `"102. 망원역 1번출구 앞"` — 번호 접두 포함)
  - `stationLatitude`/`stationLongitude`(WGS84 십진)
  - `rackTotCnt`(거치대 수), `parkingBikeTotCnt`(현재 거치된 자전거 = 대여 가능 수), `shared`(거치율 %)

## 핵심 제약 & 결정

1. **좌표 필터 부재 → 전체 fetch + 서버 Haversine 정렬.**
   bikeList엔 좌표/반경 파라미터가 없다. 전체 ~2,720 대여소를 받아 서버에서 거리 정렬해야 한다. 1회 1000건 상한이므로 페이지 루프: `1/1000`, `1001/2000`, ... **받은 row 수가 1000(요청 크기) 미만이면 마지막 페이지로 종료**(`list_total_count`는 페이지 row 수일 뿐이라 신뢰하지 않음, 안전상한 5페이지=5,000건). 받은 전체를 Haversine 정렬 후 상위 5 cap — "한 페이지만 받아 슬라이스" 금지(버스 A-2 페이징 교훈과 동일, 부분집합이 최근접을 누락).

2. **캐시 60초 `revalidate`.**
   버스는 `no-store`(정류소별 도착이 초 단위). 따릉이는 (a) 매 요청 3+페이지 호출이 비싸고 (b) 일일 트래픽 제한이 있으며 (c) 대여 가능 수는 분 단위 변동이라 60초 stale이 허용된다. `fetch(..., { next: { revalidate: 60 } })`로 동시 사용자 부하를 upstream 1회로 흡수한다. 전체 목록 호출이라 좌표가 달라도 같은 upstream 응답을 공유한다(좌표별 캐시 분기 없음 — URL에 좌표가 안 들어가므로 자연히 단일 캐시).

3. **도보권 1km cap.**
   자전거 대여소는 도보 접근이 전제라 1km 초과는 무의미. 정렬 후 `distanceMeters <= 1000`만 남기고 상위 5. 전부 1km 밖이면 빈 배열("근처 대여소 없음"). 버스엔 거리 cap이 없지만 자전거엔 의미가 있다(도메인 차이).

4. **graceful degrade.**
   - `RESULT.CODE`가 `INFO-000`이 아니면 throw → 라우트가 502(조회 실패와 "정보 없음"을 구분).
   - 키 없으면 `fetchNearbyBikeStations`는 빈 배열(라우트 키 게이트로 사실상 미도달, 방어적).
   - 실데이터 실패 시 mock 폴백 없음(가짜 실데이터 금지 — 프로젝트 원칙).
   - 좌표 비유한(NaN) row는 거리 Infinity로 밀어 정렬을 깨지 않게 하고 cap에서 자연 탈락.

5. **정본 수치 정확성.** `parkingBikeTotCnt`/`rackTotCnt`는 `nonNegInt`로 파싱(음수·비유한 방어). "0대"와 "정보 없음"을 뭉개지 않으나, 따릉이는 항상 수치를 주므로 0은 그대로 "대여 가능 0대"로 낭독한다.

## 구현 단위 (각 단위는 독립 테스트·이해 가능)

| # | 파일 | 책임 | 의존 |
|---|------|------|------|
| 1 | `src/lib/types.ts` | `BikeStation` 인터페이스 추가 | 없음 |
| 2 | `src/lib/env.ts` | `SEOUL_OPEN_DATA_KEY` 스키마 + `hasSeoulOpenDataKey()` | zod |
| 3 | `src/lib/providers/seoul-bike.ts` | `parseBikeStations(raw, oLat, oLng)`(순수, 정렬·거리) + `fetchNearbyBikeStations(lat,lng)`(페이지 루프·cap·revalidate) | geo, env, types |
| 4 | `src/app/api/bike/nearby/route.ts` | GET `?lat&lng`, zod 좌표 가드, 키 게이트, 502 변환 | provider, env |
| 5 | `src/components/BikeStations.tsx` | `BusArrivals` 패턴 복제(current/place 모드, aria-live polite, 수동 새로고침, 조회시각, 결과 헤딩 포커스 이동) | next-intl, format |
| 6 | `PlaceDetail.tsx` + `PlaceSearch.tsx` | `<BikeStations mode="place"\|"current">` 삽입(버스 옆) | BikeStations |
| 7 | `messages/ko.json` + `en.json` | `bike.*` 메시지(로케일별 단일 언어) | 없음 |
| 8 | `src/lib/__tests__/seoul-bike.test.ts` | `parseBikeStations` 게이트 테스트(정렬·거리·빈결과·필드·NaN) | fixture(실호출 캡처) |

### `BikeStation` 인터페이스(안)

```ts
export interface BikeStation {
  stationId: string;
  name: string;          // "102. 망원역 1번출구 앞" 원문 그대로(번호 접두 포함)
  lat: number;
  lng: number;
  distanceMeters: number;
  racksTotal: number;        // rackTotCnt
  bikesAvailable: number;    // parkingBikeTotCnt
}
```

## 테스트 / 검증 (2-레인)

- **게이트 테스트**(매 커밋, 결정적·무료): `parseBikeStations` — 거리 정렬, distanceMeters 산출, 빈 `row`, 필드 매핑, 좌표 NaN row 후미 배치. fixture는 실호출 `row[]`를 캡처해 사용.
- **실호출 게이트**(머지 전): 강동구 길동(lat 37.5385, lng 127.1378)으로 `/api/bike/nearby` 로컬 호출 → `INFO-000` 실데이터 확인(따릉이는 이미 검증). 프로덕션은 `SEOUL_OPEN_DATA_KEY` env 등록 + 재배포 후 실호출.

## 비목표 (YAGNI)

- 대여소 딥링크/상세(따릉이 앱 연동은 추후)
- 자전거 경로 안내(`RouteMode "bike"`는 별도 마일스톤)
- 실시간 자동 폴링(수동 새로고침 — 스크린 리더 반복 통지 방지)
- 거치율(`shared`) 노출(대여 가능 수가 더 직관적 — YAGNI)

## 환경변수

- `SEOUL_OPEN_DATA_KEY` — 로컬 `.env.local` 완료. 프로덕션 Vercel env 등록 + 재배포 필요(머지 게이트).
