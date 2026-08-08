# 국내 서비스 API 확장 심층 조사 (우편번호·버스·지하철·맛집·예약·기타)

**기준 시점**: 2026-06-14
**조사 방법**: 2라운드 — ① deep-research 워크플로(102 에이전트, 5개 앵글, 20개 1차 소스 → 79개 claim 추출 → 25개 3-vote 검증, 23 confirmed/2 killed) ② 워크플로가 발굴한 소스 리드를 직접 WebFetch/WebSearch로 보강 검증(맛집·예약·우편번호·기타)
**범위**: 길동무에 추가 가능한 **살아있는 공개/개발자용 API**. 이미 보유·검증된 카카오 생태계·NCP Maps·TourAPI 관광·서울 실시간 지하철·ePost 우편번호는 제외하고 **공백만** 조사.

> **검증 경계**: 모든 data.go.kr 후보는 활용신청 기반이라 키 발급/전파 지연(승인 후 수 시간, 직후 ~10분 401)이 있고, **개발계정 일한도(1,000 vs 10,000)는 데이터셋마다 다르므로 통합 직전 각 페이지에서 재확인**해야 한다. 엔드포인트가 검색·2차 출처로만 확인된 항목은 카드에 "미확인(재확인 필요)"으로 표기.

---

## 0. TL;DR — 통합 우선순위 권고

| 순위 | API | 도메인 | 왜 | 통합 방식 |
|------|-----|--------|----|-----------|
| ★1 | **TAGO 버스 패밀리** (도착·정류소근접·노선) | 시내버스 | 최대 공백. 실시간이라 딥링크로 대체 불가. WGS84 좌표+한글 텍스트로 낭독·좌표통일 정합 | API 직접 |
| ★2 | **전국도시철도역사정보표준데이터** | 지하철 | 한/영/한자 역명 + 좌표를 동시 제공하는 **유일한 외국인 정합 데이터셋**. 서울 실시간 도착(보유)을 전국 정적 메타로 확장 | API 직접 |
| ★3 | **행안부 도로명주소 API** (검색·영문·좌표) | 우편번호/주소 | ePost 비공식 웹폼(현 스킬)을 **공식 API**로 대체. **영문주소를 공식으로 직접** 제공 → NCP 2-call 체인 불필요 | API 직접 |
| ★4 | **KRIC 교통약자 이동경로** (transferMovement·stationMovement) | 접근성 | 길동무 정체성 직격. **엔드포인트 1차 확정(2026-06-14)**·무료·무제한. 무장애 환승/역내 동선. 시각장애인 특화 필드는 별도 정적 데이터(§I) | API 직접(실호출 게이트 후) |
| ★5 | **ODsay LAB 대중교통 길찾기** | 버스+지하철 경로 | TAGO엔 없는 **환승 경로계산**을 메움. 단 무료는 6개월·한국어 전용 | API 직접(ko 한정) |
| 보강 | 무장애여행·공중화장실·따릉이·전기차충전소·심평원 병원약국·기상청 | 기타 | 여행/접근성 정합. 대부분 무료 data.go.kr | 선택적 |
| 유지 | 예약(캐치테이블 등 상업) | 예약 | 공개 API 여전히 없음 → **딥링크 링크아웃** | 딥링크 |
| 신규 | 공공시설 예약(서울/인천 오픈데이터) | 예약 | 체육·문화·진료·공간대관 예약은 **오픈데이터로 열림**(링크아웃형) | API+딥링크 |

**전략 하이라이트**: TAGO 패밀리는 **단일 ServiceKey로 버스+철도 다영역을 일괄 커버**(provider 추상화에 이상적). 외국인 정합과 접근성 정합을 동시에 충족하는 데이터는 **전국도시철도역사정보표준데이터(영문 역명)**가 유일하며, 접근성 차별화는 **KRIC 교통약자 카테고리**가 핵심 미개척 자원.

---

## A. 시내버스 (최우선 공백 — 검증 완료)

> 1라운드 정찰이 "버스 공개 API 전무"라 했으나 **오판**(기존 스킬 범위만 본 착시). 국토부 TAGO가 명백히 공개 운영 중임을 3-0 만장일치로 확정.

### A-1. TAGO 버스도착정보 ★ (data.go.kr 15098530)
- **제공**: 국토교통부(TAGO 국가대중교통정보센터)
- **엔드포인트**: `http://apis.data.go.kr/1613000/ArvlInfoInqireService`
  - 주요 오퍼레이션: `getSttnAcctoArvlPrearngeInfoList`(정류소별 도착예정), `getArrInfoByRouteList`(노선별 도착)
- **인증**: ServiceKey (data.go.kr 활용신청, 자동승인)
- **무료한도**: 무료, 개발계정 일 10,000건 / 운영계정 활용사례 등록 시 상향
- **영문**: 한글 위주(외국인 정합 한계)
- **접근성**: 정류소 단위 버스 도착 예정정보를 텍스트로 낭독 가능 — 정합 우수
- **권고**: **API 직접 통합** (실시간 데이터는 딥링크로 대체 불가)
- 출처: https://www.data.go.kr/data/15098530/openapi.do

### A-2. TAGO 버스정류소정보 ★ (data.go.kr 15098534)
- **엔드포인트**: `http://apis.data.go.kr/1613000/BusSttnInfoInqireService`
  - `getCrdntPrxmtSttnList`(좌표기반 근접 정류소), 정류소번호조회, 정류소경유노선, 도시코드
- **인증/무료**: ServiceKey, 무료, 개발 일 10,000건
- **응답**: WGS84 위경도(`gpslati`/`gpslong`, 실수형) + 한글 정류소명(`nodenm`)
- **접근성**: 현재 위치 기반 "가까운 정류장 찾기" 직결. 좌표가 WGS84 십진 → 좌표통일 원칙에 직합
- **권고**: **API 직접 통합**
- 출처: https://www.data.go.kr/data/15098534/openapi.do

### A-3. TAGO 버스노선정보 (data.go.kr 15098529)
- **엔드포인트**: `http://apis.data.go.kr/1613000/BusRouteInfoInqireService`
  - `getRouteNoList`, `getRouteInfoIem`, `getRouteAcctoThrghSttnList`(경유정류소목록), `getCtyCodeList`
- **인증**: ServiceKey (확정)
- **무료한도**: ⚠ **미확정** — "무료·일 10,000건" 세부가 3-vote에서 1-2로 기각됨. 엔드포인트·인증은 확정이나 정확한 한도는 페이지 재확인 필수(다른 TAGO API 패턴상 10,000 가능성 높음)
- **권고**: **API 직접 통합** (노선 경유정류소가 텍스트 경로 안내의 핵심)
- 출처: https://www.data.go.kr/data/15098529/openapi.do

### A-4. ODsay LAB 대중교통 길찾기 ★ (경로계산 보완재)
- **제공**: ODsay LAB
- **엔드포인트**: `https://api.odsay.com/v1/api/`
  - `searchPubTransPathT`(통합 환승 경로), `subwayPath`(지하철 경로), `searchBusLane`(버스노선), `searchStation`(정류장검색)
- **인증**: `apiKey` 쿼리파라미터(특수문자 URL인코딩 필수), 신청등록 시 발급
- **무료한도**: Basic(무료) 개인·학생·5인이하 스타트업 **일 1,000건, 단 앱 등록 후 6개월만 무료**
- **영문**: ⚠ **무료 티어는 한국어 전용**. 다국어(영/일/중/베)는 Standard/Premium 유료 전용
- **위치/접근성**: SX/SY/EX/EY 좌표 + SearchType(0 시내/1 시외)로 지하철+시내버스 통합 환승 라우팅. **TAGO엔 없는 "출발→도착 환승 경로계산"을 메우는 유일 보완재**
- **권고**: **ko 경로검색엔 API 직접 통합**, en 로케일은 보류(유료 평가 또는 TAGO raw 데이터로 자체 텍스트 경로 구성)
- 출처: https://lab.odsay.com/guide/guide , https://lab.odsay.com/doc/totalPolicy

> **운영주체 메모**: TAGO(국가대중교통정보센터)는 TS한국교통안전공단이 국가통합교통체계효율화법 §90 근거로 운영하는 **국내 유일 대중교통정보센터**. 버스·고속/시외버스·열차·지하철·국내항공·국내해운·카셰어링 등 **13종을 data.go.kr로 개방**(12종은 신 엔드포인트 15098xxx로 이관, 지하철 실시간 1종만 대체없이 종료). Naver/Kakao/TMAP에도 동일 데이터를 무료 공급. → **단일 ServiceKey로 다영역 일괄 커버 가능**. (출처: https://main.kotsa.or.kr/portal/contents.do?menuCode=01080800 )

---

## B. 철도·전국 지하철 (검증 완료)

### B-1. 전국도시철도역사정보표준데이터 ★★ (data.go.kr 15013205) — 외국인 정합 최강
- **제공**: 국가철도공단
- **내용**: 전국 도시철도 역사 **1,073개**의 역번호·역사명·노선·환승역여부·환승노선·**WGS84 위경도**·도로명주소·전화번호 + **영문역사명** + **한자역사명**
- **인증/무료**: ServiceKey, 무료
- **영문**: ✅ **한/영/한자 역명 동시 제공** — 좌표+영문을 동시 충족하는 유일 데이터셋
- **접근성/외국인**: 둘 다 충족. 서울 실시간 도착(보유)을 **전국 정적 역 메타로 확장**, 영문 역명이 외국인 UI에 직결
- **권고**: **API 직접 통합** (★2 우선순위)
- 출처: https://www.data.go.kr/data/15013205/standard.do

### B-2. KRIC 레일포털 "교통약자정보" ★★ (data.kric.go.kr) — 접근성 차별화 축
- **제공**: 국가철도공단(철도산업정보센터). 4개 카테고리(교통약자정보·열차이용정보·편의정보·안전정보)
- **인증/무료**: 회원가입 → **단일 ServiceKey 하나로 다수 API**. **무료·일일 무제한**(정책 선언, 과도 트래픽 시 throttling 가능). XML/JSON
- **접근성**: 길동무 시각장애인 정체성 직격 — **차별화 축**
- **3라운드(2026-06-14) 집중 조사로 엔드포인트 확정 → 상세는 아래 §I 참조**
- 출처: https://data.kric.go.kr/rips/serviceInfo/openapi/introduce.do , https://data.kric.go.kr/rips/M_01_02/intro.do

### B-3. KORAIL 열차운행정보 (data.go.kr 15125762)
- **제공**: 한국철도공사
- **엔드포인트**: `apis.data.go.kr/B551457/run/v2`
- **내용**: 여객열차 운행계획(운행일자/열차번호/출발·도착역코드·역명/예정시각) + 운행정보(노선코드·정차구분·상하행·실제시각)
- **인증/무료**: ServiceKey, 무료, 개발 일 10,000건, 실시간 갱신, 2026 활성(최종수정 2025-12-01)
- **권고**: **API 직접 통합** — KTX/SRT 딥링크 예매(보유)와 별개로 "열차 운행현황 텍스트 안내" 제공
- 출처: https://www.data.go.kr/data/15125762/openapi.do

### B-4. TAGO 열차정보 (data.go.kr 15098552) — B-3과 택1
- **제공**: 국토교통부(TAGO)
- **내용**: KTX 포함 열차 출발/도착예정시각 등 운행현황 + 차량종류/지방열차/도시코드. REST·JSON+XML
- **인증/무료**: ServiceKey, 무료, 개발 일 10,000건
- **권고**: B-3(KORAIL)과 기능 중복 → **택1**. TAGO 패밀리 일관성 우선 시 이쪽(15098552), 1차 소스 정밀도 우선 시 KORAIL(15125762)
- 출처: https://www.data.go.kr/data/15098552/openapi.do

### B-5. 부산교통공사 도시철도 역명정보 (data.go.kr 3077187 등) — 보강용
- **내용**: 호선/역번호/역명/**영문역명**/주소/전화번호. CSV(로그인 불필요) + OpenAPI(별 데이터셋ID 3057643 등, 개발 1,000건/일) 양형태
- **한계**: WGS84 좌표 **미포함** → 위치기능 부적합, 역명 다국어 보강용
- **권고**: 전국표준데이터(15013205)로 충분하면 **우선순위 낮음**. 표준데이터 미커버 부산 세부 보강시에만
- 출처: https://www.data.go.kr/data/3077187/fileData.do

---

## C. 맛집·식당·카페 (비카카오 소스 — 결론: 카카오 코어 유지)

> **정직한 결론**: 카카오 로컬(FD6/CE7, 일 10만건, 보유)을 능가하는 신규 "맛집 검색" 소스는 없다. 공백은 두 갈래로만 메워진다.

### C-1. TourAPI 음식점 콘텐츠 (영문) — 이미 보유, 활용 확장
- **사실 확인**: 워크플로가 "신규 맛집 소스"로 발굴한 data.go.kr 15101753은 **한국관광공사 영문 관광정보서비스(이미 보유한 TourAPI English)**였음
- **함의**: "외국인용 영문 음식 정보" 공백은 **TourAPI 음식점 콘텐츠(영문 contenttypeid 82)로 이미 커버**. 신규 키 불필요 — 기존 TourAPI provider에 음식점 분류 호출만 추가하면 됨
- **권고**: 신규 통합 아님. en 로케일 음식 카드를 TourAPI contenttype 82로 보강(Phase 0b 후보)
- 출처: https://www.data.go.kr/data/15101753/openapi.do

### C-2. 행안부 LOCALDATA 음식점 인허가 — 검증용 보조(낮은 우선순위)
- **제공**: 행정안전부 지방행정인허가데이터(localdata.go.kr)
- **내용**: 일반음식점/휴게음식점 **인허가 전수** 데이터(상호·주소·업종·영업상태·좌표). 인증키
- **한계**: "맛집"이 아니라 인허가 전수 — **큐레이션 없음**. 길동무 맛집 검색엔 카카오가 우월
- **가치**: "이 식당이 영업 중인 정식 인허가 업소인가" **검증용**으로만. 직접 검증은 페이지 타임아웃으로 엔드포인트 **미확인(재확인 필요)**
- **권고**: **보류** — 맛집 검색 코어는 카카오 유지
- 출처: https://www.localdata.go.kr/devcenter/apiGuide.do?menuNo=20002

---

## D. 식당·편의시설 예약 (도메인 분기 — 중요 갱신)

> 예약은 **상업 예약**과 **공공시설 예약**으로 갈린다. 기존 SPEC의 "예약 공개 API 전무"는 **상업 예약에 한해 유효**하며, 공공시설 예약은 오픈데이터로 열려 있다.

### D-1. 상업 예약(캐치테이블·테이블링·네이버예약·야놀자) — 딥링크 유지
- **재검증 결과(2026-06)**: 제3자 개발자용 공개 REST API **여전히 없음**(입점/사업자용만). 이번 라운드에 새 증거 없음 → 기존 결론 유지
- **권고**: **딥링크 링크아웃**. 캐치테이블 앱(`app.catchtable.co.kr`), 네이버 예약 URL 패턴으로 연결
- 출처: https://app.catchtable.co.kr/index.html

### D-2. 서울시 공공서비스예약 ★ (서울 열린데이터광장 OA-2271) — 신규 가능
- **제공**: 서울특별시(디지털도시국)
- **내용**: **체육시설·시설대관·교육·문화행사·진료** 등 상세 예약정보. `rsv_svc_id`(SVCID)로 `https://yeyak.seoul.go.kr/` 해당 예약 페이지로 연결. 좌표 제공
- **타입**: LINK형(예약 목록·정보 오픈데이터 + 공식 예약포털 딥링크)
- **인증/무료**: 무료, 공공누리 1유형. 한도는 기관 정책별
- **권고**: **API(목록 조회) + 딥링크(실제 예약)** 하이브리드. 길동무 "편의시설 예약" 요청의 현실적 답
- 출처: https://data.seoul.go.kr/dataList/OA-2271/A/1/datasetView.do

### D-3. 인천광역시 통합예약안내 (data.go.kr 15085804) — 지역 확장 예시
- **내용**: 체육시설·교육강좌·문화행사·공간대관 예약. 무료
- **권고**: 서울(D-2)과 동일 패턴. 다지역 확장 시 시 단위로 추가
- 출처: https://www.data.go.kr/data/15085804/openapi.do

---

## E. 우편번호·도로명주소 공식 API (현 ePost 비공식 웹폼 대체)

### E-1. 행안부 도로명주소 API ★ (business.juso.go.kr) — 공식 대체
- **제공**: 행정안전부(주소기반산업지원서비스)
- **API 3종**:
  - 도로명주소 검색 API — 키워드→주소 목록(영문도로명주소·구우편번호 검색 옵션)
  - 영문주소 API — **공식 영문주소 변환**
  - 좌표제공 API — 주소→좌표(격자 중심점 좌표)
- **인증**: 승인키(등록 후 발급). 검색 API와 좌표/영문 API의 승인 절차가 다를 수 있음
- **무료한도**: ⚠ 페이지에 명시 없음 — 검색 API는 사실상 무료·넉넉, **좌표제공/영문은 별도 승인** 가능성. **재확인 필요**
- **영문**: ✅ **공식 영문주소 직접 제공**
- **함의(중요)**: 현 `zipcode-search` 스킬은 ePost **비공식 웹폼**. 이 공식 API로 대체하면 (a) 안정성↑ (b) **영문주소를 공식으로 직접** → 현 NCP 역지오→정지오 2-call 체인 불필요
- **권고**: **API 직접 통합** (★3). 우편번호+주소 입력·현위치 주소 낭독의 공식 정본
- 출처: https://business.juso.go.kr/jst/jstRoadNmAddrApiSearch , https://business.juso.go.kr/addrlink/openApi/popupApi.do

---

## F. 기타 접근성·여행 정합 API (모두 무료 data.go.kr/열린데이터, ServiceKey)

### F-1. 한국관광공사 무장애 여행 정보 ★ (data.go.kr 15134352)
- **내용**: 무장애 관광 콘텐츠 13종(지역기반·위치기반·키워드·소개·이미지 등 + 무장애 정보). 약 6만 건
- **엔드포인트**: `api.visitkorea.or.kr` (TourAPI 계열, 별도 활용신청)
- **무료한도**: 무료, 개발 일 1,000건
- **영문**: ⚠ 국문 제공(영문 무장애는 추가 확인 필요)
- **접근성**: **길동무 정체성 직격** — 무장애 관광지·시설 정보
- **권고**: **API 직접 통합** (보유 TourAPI 키 계열과 정합성 확인)
- 출처: https://www.data.go.kr/data/15134352/openapi.do

### F-2. 전국공중화장실표준데이터 ★ (data.go.kr 15012892)
- **제공**: 행정안전부
- **내용**: 전국 공중화장실 명칭·주소·운영시간·**WGS84 위경도** + **장애인화장실 유무** 등 시설 상세
- **무료**: 무료, 표준데이터(파일+API)
- **접근성**: WGS84 좌표 + 장애인화장실 필드 → 무장애 이동 도우미에 정합
- **권고**: 선택적 API 직접 통합(여행/접근성 보강)
- 출처: https://www.data.go.kr/data/15012892/standard.do

### F-3. 서울 공공자전거 따릉이 실시간 대여정보 (서울 열린데이터 OA-15493)
- **엔드포인트**: `http://openapi.seoul.go.kr:8088/(인증키)/json/bikeList/1/5/`
- **내용**: 대여소별 실시간 거치/대여가능 건수·거치율·대여소 위치(좌표). 1회 호출 최대 1,000건
- **권고**: 선택적(서울 한정). 라스트마일 이동 보강
- 출처: https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do

### F-4. 전기차충전소 (한국환경공단)
- **엔드포인트**: `http://apis.data.go.kr/B552584/EvCharger/getChargerStatus`(상태), 전국전기차충전소표준데이터(15013115)
- **내용**: 충전소 주소·**위경도**·충전기타입·충전용량·상태. 개발 1,000건/일
- **권고**: 선택적(여행 도메인, dodo 정합)
- 출처: https://www.data.go.kr/data/15076352/openapi.do , https://www.data.go.kr/data/15013115/standard.do

### F-5. 심평원 병원·약국 정보서비스
- **엔드포인트**: 병원 `http://apis.data.go.kr/B551182/hospInfoServicev2`(또는 hospAsmInfoService), 약국 `http://apis.data.go.kr/B551182/pharmacyInfoService/getParmacyBasisList`
- **내용**: 병의원/약국 위치(좌표)·진료과목·교통정보·시설정보. 개발 10,000건/일
- **접근성/여행**: "근처 영업 약국/병원 찾기" 텍스트 안내 정합
- **권고**: 선택적 API 직접 통합
- 출처: https://www.data.go.kr/data/15001698/openapi.do , https://www.data.go.kr/data/15001673/openapi.do

### F-6. 기상청 단기예보 (data.go.kr 15084084)
- **엔드포인트**: `http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst`(초단기실황)/`getVilageFcst`(단기예보)
- **내용**: 5km 격자 읍면동 단위 날씨. ⚠ 격자좌표(nx/ny) 변환 필요(WGS84 직접 아님). 개발 자동승인, 운영 10만/일
- **권고**: 선택적(여행 도메인). 좌표 변환 부담 있음
- 출처: https://www.data.go.kr/data/15084084/openapi.do

---

## G. 통합 로드맵 제안 (Phase 단위)

길동무 접근성·외국인 정체성 + 무료 우선 + provider 추상화 원칙에 맞춘 우선순위.

- **Phase 1 (코어 교통 — 최대 가치 공백)**: TAGO 버스 패밀리(A-1·A-2·A-3) provider + 전국도시철도역사정보표준데이터(B-1). 단일 ServiceKey 1개 발급으로 버스 도착·근접 정류장·노선·전국 역 메타를 일괄 확보. "가까운 정류장 → 버스 도착 → 텍스트 안내"가 지도 없이 완결.
- **Phase 2 (경로계산 + 공식 주소)**: ODsay 환승 경로검색(A-4, ko 한정) + 행안부 도로명주소 API(E-1)로 현 ePost 스킬 대체·영문주소 공식화.
- **Phase 3 (접근성 차별화 — 핵심)**: **무장애 안내 3층 스택**(§I-10) — (정적 seed) 서울 키오스크 점자·음성(I-5) + 코레일 시설(I-6) → (조회 API) KRIC 이동경로 2종(I-1·I-2) + 서울 빠른하차(I-7) → (실시간, 후속) 승강기안전공단(I-8). **착수 전 §I-10 게이트 2건 실호출 선검증 필수**(낭독 산문 여부 + 역코드 조인). 보강: 무장애여행(F-1)·공중화장실(F-2). 길동무를 "시각장애인 무장애 이동 도우미"로 차별화하는 **최대 차별화 축**.
- **Phase 4 (예약·생활 보강)**: 공공시설 예약(D-2/D-3) 링크아웃 + 선택적 따릉이/전기차충전소/심평원/기상청.
- **상업 예약·맛집 코어**: 변경 없음 — 카카오 로컬(맛집) 유지, 상업 예약은 딥링크.

---

## H. 미확인·후속 조사 항목

1. ~~KRIC 교통약자 개별 엔드포인트~~ → **3라운드(§I)로 해결** — transferMovement·stationMovement 2종 1차 확정. 잔여: **(a) 응답필드가 낭독 산문인지 실호출 검증 (b) 역번호↔stinCd 실조인 (c) 서울 빠른하차 15143840 operation명 (d) 서울 1~9호선 실시간 승강기 공식 API** (§I-10·I-8 — 4라운드 후보).
2. **TAGO 버스노선정보(15098529) 정확한 일한도** — 3-vote에서 "무료·10,000건"이 1-2로 기각. 엔드포인트/인증은 확정, 한도만 페이지 재확인.
3. **TAGO 3종(15098529/15098530/15098534) ServiceKey 공유 여부** — 동일 키로 동작하는지 각각 활용신청인지(provider 키 관리 영향).
4. **행안부 도로명주소 API 정확한 무료한도** — 검색/영문/좌표 API별 승인 절차·트래픽 페이지 재확인.
5. **무장애여행(15134352) 영문 제공 여부** — 국문 확인됨, 영문 무장애 콘텐츠 유무.
6. **en 로케일 대중교통 경로** — ODsay 유료 다국어 비용 vs TAGO raw로 자체 영문 텍스트 경로 구성 중 비용·정합 우위.

---

## I. KRIC 교통약자 무장애 안내 스택 — 3라운드 집중 조사 상세 (2026-06-14)

**조사**: deep-research 워크플로(101 에이전트, KRIC 집중 5개 앵글, 81 claim → 25 검증, 22 confirmed/3 killed) + 직접 시드.
**핵심 구조 발견**: 무장애 안내는 단일 API가 아니라 **3층 스택**으로 설계해야 한다 — ① KRIC 운영 API(이동경로) ② 정적 시설 데이터(시각장애인 특화 필드) ③ 서울 보완(하차 동선·실시간). 그리고 **1차 출처로 verbatim 확정된 KRIC 엔드포인트는 단 2종**이며, 그럴듯한 추정 엔드포인트 2종은 **검증에서 반증**됐다(§I-9 — 코드 금지).

### I-1. KRIC 교통약자 환승 이동경로 ★ (확정)
- **엔드포인트**: `https://openapi.kric.go.kr/openapi/vulnerableUserInfo/transferMovement` (operation `transferMovement`)
- **파라미터**: `serviceKey`(필수) · `format`(xml/json) · `railOprIsttCd`(운영기관) · `lnCd`(노선) · `stinCd`(역) · `prevStinCd` · `chthTgtLn`(환승대상노선) · `chtnNextStinCd`
- **샘플**: `?serviceKey=[키]&format=xml&railOprIsttCd=S1&lnCd=3&stinCd=321&prevStinCd=422&chthTgtLn=4&chtnNextStinCd=424`
- **목적**: 교통약자를 위한 환승역 이동경로 동선 제공
- **검증**: 3-0/2-1 병합, 2회 독립 WebFetch verbatim. ⚠ **응답필드 미시험**(ServiceKey 게이트) — 안내문이 낭독 가능 산문인지 좌표 시퀀스인지는 발급 후 실호출 필요. 데이터 최종갱신 2020.05.13(커버리지·신선도 불확실)
- **권고**: **API 직접 통합** (단 실호출 게이트 §I-10 통과 후)
- 출처: https://data.kric.go.kr/rips/M_01_02/intro.do

### I-2. KRIC 출입구-승강장 이동경로(표준) ★ (확정)
- **엔드포인트**: `https://openapi.kric.go.kr/openapi/handicapped/stationMovement` (operation `stationMovement`)
- **파라미터**: `serviceKey` · `format` · `railOprIsttCd` · `lnCd` · `stinCd` · `nextStinCd`
- **샘플**: `?serviceKey=[키]&format=xml&railOprIsttCd=S1&lnCd=3&stinCd=322&nextStinCd=323`
- **목적**: 역 출입구↔승강장 내부 동선. 시각장애인 역내 이동 안내의 핵심
- **검증**: 2-1, detail.do에서도 operation 확인. 동일 응답필드 미시험 주의
- **권고**: **API 직접 통합** (실호출 게이트 후)
- 출처: https://data.kric.go.kr/rips/M_01_02/intro.do

### I-2b. 라이브 페이지 verbatim 확인 — KRIC 추가 엔드포인트 (2026-06-14 브라우저 직접 확인)
ServiceKey 발급 진행 중 `data.kric.go.kr/rips/M_01_02/intro.do` 목록·상세를 직접 열람해 아래 엔드포인트를 **실값으로 확정**(3라운드의 추정/반증 항목을 실제 경로로 교체). 모두 `https://openapi.kric.go.kr/openapi/` 베이스, 파라미터 `serviceKey·format·railOprIsttCd·lnCd·stinCd` 공통:
- **교통약자정보 · 역사별 승강장 정보**: `vulnerableUserInfo` 분류, 경로 `convenientInfo/stPlf` (샘플 railOprIsttCd=S1&lnCd=1&stinCd=152)
- **편의정보 · 역사/차량 편의정보**: `convenientInfo/stationCnvFacl` (샘플 불광역 S1/3/322) — ⭐ **3라운드에서 반증된 추정 `convenientInfo/stationElevator`의 실제 대체**. 역사 편의시설 정본
- **편의정보 · 편의정보(표준)**: `handicapped/stationCnvFacl` (표준 버전)
- **편의정보 · 역사별 혼잡도(서울교통공사)**: `convenientInfo/stationCongestion` (평일 혼잡도 %)
- **편의정보 · 역사별 공기질 측정**: `convenientInfo/stationAirQuality`
- **열차이용정보 · 열차별 운행시각표**: `trainUseInfo/subwayTimetable` (dayCd 7토/8평일/9휴일) / 급행 `trainUseInfo/subwayTimetableExp`
- **열차이용정보 · 도시철도 환경정보**: `trainUseInfo/subwayEnvironmental` (PM2.5 등)
- 상세페이지가 **End Point·데이터포맷(JSON/XML)·API유형(REST)을 명시** — §I-1/I-2와 함께 4개 핵심 교통약자/편의 API 모두 실경로 확정. 전체 60건은 6페이지(2~6p 미수집).

### I-3. 역 식별 합성키 — railOprIsttCd + lnCd + stinCd
- KRIC는 **운영기관코드(S1·KR 등) + 노선코드 + 역코드 3개 합성**으로 역을 식별하며, 이 3코드가 timetable·congestion·facilities·환승경로 등 **여러 KRIC API에 공통**(3-0 확정).
- ⚠ **핵심 정합 미검증**: 2라운드 확정한 전국도시철도역사정보표준데이터(15013205)의 **'역번호'가 KRIC 운영 API의 `stinCd`와 직접 조인 가능한지는 verbatim 미확정**. 단 표준데이터의 다운로드 URL이 `data.kric.go.kr/.../detail.do?id=32`를 직접 가리켜 **둘이 같은 출처(국가철도공단 레일포털)**임은 입증됨 → 조인 가능성 높으나 실데이터 샘플 대조 필요(§I-10).

### I-4. 인증·한도 (무료·무제한·단일키) + 진행 상태
- 회원가입 후 **단일 인증키로 다수 Open API** 접근. **무료, 일일 무제한**(`introduce.do` verbatim: "일일 사용한도는 무제한"). data.go.kr의 일 1,000~10,000 한도와 별개 — **버스/철도 data.go.kr API보다 한도 유리**.
- 신청 절차: https://data.kric.go.kr/rips/serviceInfo/openapi/process.do (로그인 진입은 `data.kric.go.kr/rips/login.do`, 회원가입 `join.do` — 헤더에 로그인 버튼 없고 활용신청 클릭 시 트리거되는 구조)
- **⚠ 실증된 차이 — KRIC는 수동 승인(2026-06-14)**: data.go.kr이 활용신청 즉시 자동승인(편의시설 15125774 당일 발급)인 것과 달리, **KRIC는 회원가입/승인에 수일이 걸린다**. 2026-06-14 회원가입 제출 → **"승인 대기 중"** 확인. → 통합 로드맵에서 **data.go.kr 계층 선(先)·KRIC 동선 후(後) 부착** 순서가 옳았음을 사후 검증.
- **진행 상태 (2026-06-14)**: 회원가입 완료·승인 대기. 승인 완료(수일 후) → 로그인 → 2종(transferMovement·stationMovement) 활용신청 → 인증키 수령 → §I-10 게이트 실호출 검증. **다음 세션 재개 지점**.

### I-5. 시각장애인 특화 필드 — 서울교통공사 교통약자네비게이션키오스크 (KRIC id=985) ★
- **형태**: ⚠ **Open API 아님 — XLSX 파일 다운로드 전용**. `static seed`로 사전 적재해야 함
- **컬럼(15종)**: 철도운영기관명·운영노선명·역명·관리번호·지상지하구분·역층·(근접)출입구번호·상세위치·**음성 서비스 여부**·**점자 서비스 여부**·**시각 서비스 여부**·운영기관·전화번호·데이터기준일자·참고사항
- **가치**: 시각장애인 특화 필드(음성/점자/시각)를 가진 **유일 확인 소스**. 단 서울교통공사 한정·정적
- **권고**: **파일 사전 적재(static seed)로만 통합**. 실시간/조회 API로는 보류
- 출처: https://data.kric.go.kr/rips/M_01_01/detail.do?id=985

### I-6. 코레일 역 편의시설정보 (data.go.kr 15125774) — 정적 시설 인벤토리
- **엔드포인트**: `http://apis.data.go.kr/B551457/convenience/stationFacilities` (3개 서브: 역사내/교통약자/역사주차장)
- **교통약자 필드**: 역명·휠체어리프트수·장애인경사로유무·**장애인화장실유무**. 엘리베이터수·에스컬레이터수(정적 개수)
- **한계**: ⚠ **점자블록·음성유도기 필드 없음**, **실시간 가동상태 없음**('실시간' 표기는 데이터 수정주기 의미)
- **조인**: `stn_cd`(역코드)로 조인. 코드정보 API 선조회 패턴(형제 데이터셋 15138467 역코드 약 1,255역). 무료·개발 10,000건
- **권고**: 시설 개수·장애인화장실 유무엔 **통합 가능**, 실시간·시각장애인 특화엔 보류
- 출처: https://www.data.go.kr/data/15125774/openapi.do

### I-7. 서울교통공사 빠른하차정보 (data.go.kr 15143840) ★ — 시각장애인 하차 동선
- **목적**: 하차역 기준 **계단·엘리베이터 등 이동설비와 가장 가까운 열차 칸 출입문 위치** 조회. 하차칸(문)번호 + 연결 이동설비 위치
- **검색조건**: 호선 · 역코드 · 역명. 무료·서울교통공사
- **가치**: "어느 칸에서 내려야 엘리베이터에 가까운가"를 텍스트로 — **시각장애인 하차 동선 강력 후보**. KRIC 실시간 공백 일부 보완
- ⚠ **정확한 base URL·operation명·무료 일한도 미확정**(신형 GW Swagger 위임 패턴) — 명세 확정 필요
- **권고**: **직접 API 통합 유력**(명세 확정 선행)
- 출처: https://www.data.go.kr/data/15143840/openapi.do

### I-8. 실시간 승강기 가동상태 — 미해결 공백 + 보완 후보
- **확정된 한계**: KRIC 승강기 데이터(부산교통공사 id=516 등)는 **정적 XLSX**(업데이트주기 '없음'), 코레일도 정적 개수만 → **"지금 작동 중인 엘리베이터" 실시간 안내는 KRIC/코레일로 불가**
- **보완 후보(후속 확정 필요)**:
  - **한국승강기안전공단 건물별 승강기 운행정보** (data.go.kr 15070652) — 실시간 운행상태, 개발 일 10,000건 무료. ⚠ **건물 단위라 지하철역 매핑 추가작업 필요**
  - 서울 보완: data.go.kr 15144070 · 15044261, 서울 열린데이터 OA-22724 — 서울 지하철 실시간 승강기/교통약자 후보(카드화 전, 엔드포인트 후속 확인)
- **권고**: 실시간 승강기는 **별도 4라운드 후보**. 우선은 정적 시설 안내로 출발

### I-9. 환각 경계 — 코드에 절대 넣지 말 것 (검증에서 반증된 엔드포인트)
- ❌ `https://openapi.kric.go.kr/openapi/vulnerableUserInfo/stationDisabledToilet` — 1-2 반증(존재 미확인)
- ❌ `https://openapi.kric.go.kr/openapi/convenientInfo/stationElevator` — 1-2 반증(존재 미확인)
- **확정된 KRIC 엔드포인트는 §I-1·I-2의 2종뿐.** 장애인화장실은 코레일 15125774(§I-6)로, 점자/음성은 서울 키오스크 XLSX(§I-5)로 가야 한다.

### I-10. 통합 GO/NO-GO 게이트 (ServiceKey 발급 후 실호출로 선검증)
무장애 안내 스택 착수 전 **반드시 실호출로 확인할 두 가지** — 둘 다 설계 성패를 가른다:
1. **응답필드가 낭독 가능 한국어 산문인가?** transferMovement/stationMovement가 "3번 출구에서 엘리베이터를 타고…" 식 안내문을 주는지, 아니면 노드/좌표 시퀀스만 주어 별도 문장 생성이 필요한지.
2. **역번호(15013205) ↔ stinCd(KRIC API) 실조인** — railOprIsttCd/lnCd 매핑 포함 양쪽 코드 샘플 대조. 조인되면 "역 검색 → 그 역 무장애 정보 부착"이 한 provider로 완결, 안 되면 이름 매칭 폴백 설계 필요.

**스택 설계 권고**: (정적 seed) 서울 키오스크 점자·음성 + 코레일 시설 인벤토리 → (조회 API) KRIC 이동경로 + 서울 빠른하차 → (실시간, 후속) 한국승강기안전공단. 역 검색(15013205)을 허브로 두고 역코드 조인으로 각 층을 부착.

## 출처 (1차 검증 소스)

**시내버스**: data.go.kr [15098530](https://www.data.go.kr/data/15098530/openapi.do) · [15098534](https://www.data.go.kr/data/15098534/openapi.do) · [15098529](https://www.data.go.kr/data/15098529/openapi.do) · ODsay [guide](https://lab.odsay.com/guide/guide)·[policy](https://lab.odsay.com/doc/totalPolicy) · [TS포털](https://main.kotsa.or.kr/portal/contents.do?menuCode=01080800)
**철도/지하철**: data.go.kr [15125762](https://www.data.go.kr/data/15125762/openapi.do) · [15098552](https://www.data.go.kr/data/15098552/openapi.do) · [15013205](https://www.data.go.kr/data/15013205/standard.do) · [3077187](https://www.data.go.kr/data/3077187/fileData.do) · [KRIC](https://data.kric.go.kr/rips/serviceInfo/openapi/introduce.do)
**맛집**: [15101753](https://www.data.go.kr/data/15101753/openapi.do) · [localdata](https://www.localdata.go.kr/devcenter/apiGuide.do?menuNo=20002)
**예약**: [서울 OA-2271](https://data.seoul.go.kr/dataList/OA-2271/A/1/datasetView.do) · [15085804](https://www.data.go.kr/data/15085804/openapi.do) · [catchtable](https://app.catchtable.co.kr/index.html)
**우편번호/주소**: [juso 검색](https://business.juso.go.kr/jst/jstRoadNmAddrApiSearch) · [juso 팝업API](https://business.juso.go.kr/addrlink/openApi/popupApi.do)
**기타**: [무장애여행 15134352](https://www.data.go.kr/data/15134352/openapi.do) · [공중화장실 15012892](https://www.data.go.kr/data/15012892/standard.do) · [따릉이 OA-15493](https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do) · [전기차충전소 15076352](https://www.data.go.kr/data/15076352/openapi.do) · [심평원 병원 15001698](https://www.data.go.kr/data/15001698/openapi.do)·[약국 15001673](https://www.data.go.kr/data/15001673/openapi.do) · [기상청 15084084](https://www.data.go.kr/data/15084084/openapi.do)
**KRIC 교통약자(3라운드)**: [KRIC API 상세](https://data.kric.go.kr/rips/M_01_02/intro.do) · [신청절차](https://data.kric.go.kr/rips/serviceInfo/openapi/process.do) · [키오스크 id=985](https://data.kric.go.kr/rips/M_01_01/detail.do?id=985) · [코레일 편의시설 15125774](https://www.data.go.kr/data/15125774/openapi.do) · [서울 빠른하차 15143840](https://www.data.go.kr/data/15143840/openapi.do) · [승강기안전공단 15070652](https://www.data.go.kr/data/15070652/openapi.do) · [표준데이터=KRIC id=32](https://data.kric.go.kr/rips/M_01_01/detail.do?id=32)
