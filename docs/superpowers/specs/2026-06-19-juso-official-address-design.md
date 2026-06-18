# 행안부 juso 공식 주소 통합 (C2) — 설계안

작성: 2026-06-19 | 상태: 승인됨(2026-06-19, 사용자) | 로드맵: `2026-06-16-implementation-roadmap-design.md` §C2

## 0. 배경·목적

현재 en 로케일에서 카카오 로컬 카드의 영문 주소는 **NCP Maps Geocoding**의 `englishAddress`로 보강한다(`ncp-geocode.ts` → `enrichEnglishAddresses`). NCP는 유료 쿼터를 소비하고, 영문 주소가 "공식 정본"이 아니다.

**행안부 도로명주소 API**(business.juso.go.kr, 주소기반산업지원서비스)는 **공식 영문 도로명주소를 직접 제공**하고 검색 API 무료 한도가 넉넉하다. 이를 통합해:

- **C2-a**: en 카카오 카드 영문 주소 소스를 공식 데이터(juso)로 교체(NCP는 폴백으로 강등) — 정확도↑, NCP 쿼터 절약.
- **C2-b**: juso 검색 API로 **주소·우편번호 검색** 신규 진입점 신설 — 카카오 POI 검색과 보완(POI=상호, juso=도로명/지번 주소).

두 사용자 집단 정합: 시각장애인(공식 도로명주소·우편번호 낭독), 외국인(공식 영문 주소).

## 1. 공통 규칙 (로드맵 §1 머지 게이트 상속)

1. **실호출이 머지 게이트.** fixture green ≠ 실계약. juso 키 도착 후 실호출로 응답 필드명·수록 범위 확정. 키 막히면 "코드 완료"가 아니라 "대기".
2. **provider 격리.** `juso-address.ts`가 juso 응답 필드를 자체 shape로 정규화 → 라우트·컴포넌트는 juso 필드를 모름(이식성).
3. `src/lib/`는 React/Next 비의존(dodo-planet 이식성).
4. 키 유무 게이트 `hasJusoKey()` + graceful 폴백.
5. a11y: 정보 정본은 텍스트, 상태 변화는 단일 polite `aria-live`. 과잉 ARIA 금지.

## 2. 아키텍처

```
[C2-a 영문주소]
enrichEnglishAddresses (places.ts)
  └ 각 카드 한글주소 → 폴백 체인:
      juso 키 有 → geocodeEnglishAddressJuso() → null이면
      NCP 키 有 → geocodeEnglishAddress()      → null이면
      한글 주소 그대로 (graceful)

[C2-b 주소검색]
PlaceSearch (검색 종류 토글: 장소 ⁄ 주소)
  └ 주소 모드 → /api/address/search → juso 검색 API
       → 주소 목록(도로명·지번·영문·우편번호)
       → 항목 선택 → 카카오 searchAddress로 좌표 확보
       → Place로 변환 → 기존 PlaceDetail 흐름(길찾기·교통 정보)
```

신규 provider `src/lib/providers/juso-address.ts` 하나가 두 기능을 받친다.

### 2.1 juso provider (`juso-address.ts`)

- **엔드포인트**: 도로명주소 검색 API `https://business.juso.go.kr/addrlink/addrLinkApi.do`(2026-06-19 실호출 확정), `resultType=json`, `confmKey=JUSO_CONFM_KEY`, `currentPage`·`countPerPage`·`keyword`.
- **공개 함수 2개**:
  - `searchJusoAddresses(keyword, page?, size?)`: 키워드 → 정규화된 주소 목록. juso `results.juso[]`를 `JusoAddress` shape(`roadAddr`·`jibunAddr`·`engAddr`·`zipNo`)로 투영. envelope `results.common.errorCode`로 분기(정상/무결과/에러). **검색 본류라 에러는 throw**(라우트가 분류).
  - `geocodeEnglishAddressJuso(koreanAddress)`: 한글 주소 키워드 → 첫 결과의 영문 도로명주소. **best-effort라 절대 throw 안 함**(NCP `geocodeEnglishAddress`와 동일 계약) — 실패·무결과·HTTP 오류 모두 `null`.
- **순수 정규화 함수**: `normalizeJusoResults(raw)`(응답 → `JusoAddress[]`), `extractEnglishAddressJuso(raw)`(→ `string|null`). React/Next 비의존, fixture 테스트.
- **게이트**: `hasJusoKey()`(`env.JUSO_CONFM_KEY` 유무).

> ✅ **실계약 확정 (2026-06-19 실호출, `JUSO_CONFM_KEY` 발급·검증 완료)**:
> - envelope: `results.common`(`errorCode` "0"=정상 / `errorMessage` "정상" / `totalCount` / `currentPage` / `countPerPage`) + `results.juso[]`.
> - 무결과: `errorCode "0"` + `totalCount "0"` + `juso: []` (정상 응답의 빈 결과). 에러는 `errorCode`가 "0" 외 값.
> - 주소 필드: `roadAddr`(전체 도로명, 참고항목 포함 "서울특별시 중구 세종대로 110 (태평로1가)") · `roadAddrPart1`(참고항목 제외) · `jibunAddr`(지번) · `engAddr`(영문 "110 Sejong-daero, Jung-gu, Seoul") · `zipNo`(우편번호 "04524") · `bdNm`(건물명) · `siNm`/`sggNm`/`emdNm`(시도/시군구/읍면동).
> - ⚠ `engAddr`은 NCP `englishAddress`("110, Sejong-daero, Jung-gu, Seoul, **Republic of Korea**")와 달리 **국가명 미포함 + 콤마 형식 상이**. 둘 다 유효 영문주소지만 C2-a 교체 시 표기 차이를 인지(필요하면 국가명 보정은 선택).
> - 키 종류: 민간기관/인터넷망/**운영**(영구), 검색 API는 트래픽 제한 없음. 발급 즉시 동작 확인(전파 지연 없음).

### 2.2 영문주소 폴백 체인 (C2-a, `places.ts`)

`enrichEnglishAddresses`를 폴백 체인으로 수정:

```
영문주소(addr) =
  (hasJusoKey()  ? await geocodeEnglishAddressJuso(addr) : null)
  ?? (hasNcpMapsKeys() ? await geocodeEnglishAddress(addr) : null)
```

- juso·NCP 둘 다 null이면 카드는 한글 주소만(현행과 동일 graceful).
- 호출 게이트: `hasJusoKey() || hasNcpMapsKeys()`일 때만 enrich 단계 실행(둘 다 없으면 현행처럼 skip).
- **회귀 0**: juso 키 없으면 `geocodeEnglishAddressJuso`가 호출되지 않아 NCP 현행 경로 그대로.

### 2.3 주소 검색 진입점 (C2-b)

- **`PlaceSearch`에 검색 종류 토글**: 라디오 그룹(`name="searchKind"`, 옵션 "장소"/"주소"). 스크린리더에 종류가 명확히 낭독되도록 라디오 사용(탭/칩보다 시맨틱 정확). 기본값 "장소"(현 동작 보존).
- **주소 모드 흐름**:
  1. 검색어 입력 → `/api/address/search?q=` → juso 주소 목록.
  2. 결과는 `ResultList` 재사용 또는 전용 `AddressResultList`로 렌더(도로명 메인, 지번·우편번호 보조, en은 영문 메인).
  3. 항목 선택 → 선택한 **도로명주소를 카카오 `searchAddress`로 지오코딩**해 좌표(x,y) 확보 → `Place` 객체 합성(name=도로명주소, address=도로명, englishAddress=juso engAddr, 좌표=카카오) → 기존 `openDetail`(History API 뷰 전환)로 `PlaceDetail` 진입.
- **좌표 소스 결정**: juso 좌표제공 API(별도 승인·미검증) 대신 **검증된 카카오 `searchAddress` 재사용**. juso=공식 주소/영문/우편번호 정본, 카카오=좌표 정본으로 역할 분리. 카카오 지오코딩 실패 시 해당 항목은 길찾기 불가로 graceful(주소 정보는 표시).
- 결과 수 통지는 기존 `aria-live` polite 채널 패턴 재사용.
- **신규 라우트** `src/app/api/address/search/route.ts`: q 검증 → `searchJusoAddresses` → JSON. 키 없으면(`hasJusoKey()` false) 빈 목록 또는 게이트로 토글 자체 미노출(아래 §3 결정).

## 3. 게이트·노출 규칙

- **C2-a**: juso 키 유무와 무관하게 항상 동작(폴백 체인). 키 없으면 NCP, NCP도 없으면 한글.
- **C2-b 토글 노출**: `canSearchAddress = hasJusoKey()`. juso 키 없으면 "주소" 검색 토글을 **미노출**(장소 검색만) — 다른 게이트 컴포넌트(`canShowBike` 등)와 동형. 키 없는데 토글만 보이는 死기능 방지.

## 4. 테스트

### 게이트 테스트 (결정적·fixture, 매 커밋)
- `normalizeJusoResults`: 정상 응답 → `JusoAddress[]`, 무결과(`errorCode` 정상+빈 juso) → `[]`, 에러코드 → throw.
- `extractEnglishAddressJuso`: 영문 필드 있음 → 문자열, 없음/무결과 → null.
- `enrichEnglishAddresses` 폴백 체인: (juso 성공), (juso null→NCP 성공), (둘 다 null→한글), (juso 키 없음→NCP만), (둘 다 키 없음→skip). NCP/juso 호출은 mock.
- 주소→Place 변환: juso 항목 + 카카오 좌표 → Place shape, 카카오 좌표 실패 → 길찾기 불가 graceful.

### 실호출 검증 (키 도착 후, 머지 게이트)
- C2-a: 강동 길동 주소 → 공식 영문 도로명주소. juso 우선 적용 확인(NCP 미호출).
- C2-b: "천호대로" 등 키워드 → 주소 목록(도로명·영문·우편번호) + 선택 시 카카오 좌표 → PlaceDetail 진입. 무결과·범위밖 케이스.

## 5. 구현 분할 (writing-plans 입력)

- **묶음 1 (C2-a, 회귀 0)**: `juso-address.ts`(`geocodeEnglishAddressJuso`+순수 정규화) + `env`/`hasJusoKey` + `enrichEnglishAddresses` 폴백 체인 + 게이트 테스트. juso 키 없이도 NCP 폴백으로 머지 가능.
- **묶음 2 (C2-b, 신규 UI)**: `searchJusoAddresses` + `/api/address/search` + `PlaceSearch` 토글 + 주소 결과 렌더 + 주소→Place(카카오 좌표) + 테스트. **juso 키 도착·실호출 검증 후 머지**.

## 6. 키 발급 현황

- ✅ **`JUSO_CONFM_KEY` 발급·검증 완료 (2026-06-19)**: business.juso.go.kr 본인인증 로그인 → 도로명주소 검색 API 신청(민간기관/인터넷망/운영) → 즉시 승인 → `.env.local` 등록 + 실호출 검증(§2.1 ✅). 검색 API 하나로 C2-a(`engAddr`)·C2-b(검색) 모두 커버 → 별도 영문/좌표 API 신청 불요.
- ⏳ **Vercel Production env 등록**: C2 배포 시점에 `JUSO_CONFM_KEY`를 Production에 등록 + 재배포(env는 배포 시점 주입). C2-b 프로덕션 노출은 이 등록 후.

## 7. 참고

- 출처: https://business.juso.go.kr/addrlink/openApi/searchApi.do , https://www.juso.go.kr/
- 기존 영문주소 provider: `src/lib/providers/ncp-geocode.ts`, 호출부 `src/lib/providers/places.ts`(`enrichEnglishAddresses`).
- 좌표 재사용: `src/lib/providers/kakao-address.ts`(`searchAddress`).
