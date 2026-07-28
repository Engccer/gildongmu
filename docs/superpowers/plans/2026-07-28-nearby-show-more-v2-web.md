# 내 주변 "더 보기" 단계 공개 V2 웹 단계 — 라우트 옵트인 limit 계약

**Goal:** V2 3종(둘러보기·아이 놀 곳·무장애 관광지)의 서버 계약을 "라우트 기본 상한은 종전 유지 + 옵트인 `limit`(최대 50) + `total` 노출"로 확정하고, 웹 3컴포넌트만 `limit=50`을 명시 요청한다.

## 선행 상태 (이 플랜이 딛고 서는 커밋)

- `b00121d` — 웹 3컴포넌트(`SurroundingsNearby`·`KidsPlacesNearby`·`BarrierFreeNearby`)에 "더 보기" 메커니즘(초기 10·회당 +10·`useLayoutEffect` 페인트 전 첫 새 항목 재포커스·`actions.showMore` 재사용)이 V1 정본(`NightClinicsNearby.tsx`) 미러로 이미 구현됨.
- `ea18f6b` — 3개 provider의 반환 상한을 일괄 50(`SERVER_CAP`)으로 확대함. **이 커밋이 라우트 기본 응답까지 50으로 부풀렸다**: CLI/MCP·iOS(더 보기 미구현)가 같은 라우트를 쓰므로 그 소비자들의 출력이 12/8/8에서 50으로 팽창하는 회귀.

## 설계 결정

1. **라우트 기본 상한은 종전 값 복원**: `/api/places/around`=12, `/api/places/kids`=8, `/api/places/barrier-free`=8 (ea18f6b 이전 값). limit 미지정 소비자(CLI/MCP·현행 iOS)는 종전과 동일한 출력을 받는다.
2. **옵트인 `limit` 쿼리 파라미터**: 정수 1~50, 범위 밖·비정수는 400(zod, lat/lng와 동일 계약). 웹 클라이언트만 `limit=50`을 명시 요청해 "더 보기" 재료를 확보한다.
3. **`total` 필드 추가**: 절단 전 서버가 아는 후보 수(provider 캡 50 이내)를 함께 반환한다(침묵 절단 금지 계약, V1 `total` 동형). 키 없음 게이트 응답도 `total: 0`으로 shape 일관.
4. **절단 위치는 라우트 계층**: provider(`SERVER_CAP=50`)는 불변. 채팅 도구(`router.ts` 자체 slice 12/8/8)와 `where-am-i`(자체 `LANDMARK_CAP`)는 provider 직접 호출이라 이 변경의 영향이 0이다(확인 완료). `matchBarrierFreePlace`의 명시 `limit:10`도 불변.
5. **둘러보기 그룹 특례 판정**: `SurroundingsNearby.tsx`는 카테고리 그룹 구조가 아니라 거리순 플랫 리스트(카테고리는 항목 텍스트에 흡수)다. b00121d가 이미 플랫 미러로 구현했고 그대로 유지한다.
6. **iOS phase 잔여**: iOS 3뷰(`AroundNearbyView`·`KidsNearbyView`·`BarrierFreeNearbyView`)의 "더 보기"+`limit=50` 요청은 별도 phase(구 플랜 `2026-07-27-nearby-show-more-v2-three-domains.md` Task 3). 그때까지 iOS는 기본 상한(12/8/8)을 받아 종전과 동일하게 동작한다.

> 구 플랜(`2026-07-27-…-v2-three-domains.md`) Task 1의 "서버 캡 50을 기본 응답으로" 접근은 이 플랜으로 대체(supersede)된다. Task 2(웹)는 b00121d로 완료, Task 3(iOS)는 잔여.

## 변경 파일

- `src/app/api/places/around/route.ts` — limit 파싱(기본 12)+slice+`total`
- `src/app/api/places/kids/route.ts` — limit 파싱(기본 8)+slice+`total`
- `src/app/api/places/barrier-free/route.ts` — limit 파싱(기본 8)+slice+`total`
- `src/components/SurroundingsNearby.tsx`·`KidsPlacesNearby.tsx`·`BarrierFreeNearby.tsx` — fetch에 `limit=50`
- 신규 테스트: `src/app/api/places/{around,kids,barrier-free}/__tests__/route.test.ts` (walk/nearby 라우트 테스트 관례 미러)
- `CLAUDE.md` — "내 주변 장소 목록 4종" 절의 서버 계약 서술 갱신

## 검증 계획

1. 라우트 테스트: ①limit 미지정 → 기본 상한·`total`=절단 전 수 ②`limit=50` → 50 ③`limit=0`/`51`/비정수 → 400 ④키 없음 → 빈 배열+`total:0` ⑤provider throw → 502.
2. 게이트: `npm run test:run`·`npm run lint`·`npm run build` 전부 통과, 기존 테스트 회귀 0.
3. push(자동 배포) 후 prod 실호출(길동 37.5385,127.1455): 3라우트 ①limit 미지정 기본 상한 ②`limit=50` 확장 ③`total` 존재.
