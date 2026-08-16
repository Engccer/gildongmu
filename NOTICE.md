# NOTICE: 라이선스와 출처

## 코드

이 저장소의 소스 코드(웹·iOS·CLI·MCP·스크립트)는 [MIT 라이선스](LICENSE)로 배포한다. 연구·상업 이용·수정·재배포 모두 자유이며, 저작권 고지와 라이선스 문구만 유지하면 된다.

## 저장소에 번들된 데이터

아래 파일은 코드가 아니라 **외부 기관이 제공한 데이터의 가공본**이며 MIT가 아니라 **각 원출처의 이용 조건**을 따른다. 재배포·재가공 시 출처 표시를 유지한다. 각 파일은 `scripts/` 아래 빌드 스크립트로 원본에서 재생성할 수 있다.

| 파일 | 내용 | 원출처 | 이용 조건 | 재생성 |
|---|---|---|---|---|
| `src/lib/data/osm-walk-nodes.json` | 전국 횡단보도·점자블록 노드 | © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자 | **ODbL 1.0**. 이 파일은 OSM에서 파생한 데이터베이스(Derivative Database)이며 같은 ODbL 1.0으로 제공한다 | `scripts/build-osm-walk-nodes.mjs` |
| `src/lib/data/audio-signals.json` | 서울 시각장애인용 음향신호기 위치 | 서울특별시, 서울 열린데이터광장 OA-15543 | 공공누리 제1유형(출처표시) | `scripts/build-audio-signals.mjs` |
| `src/lib/data/voice-guides.json` | 서울 지하철역 음성유도기 위치 | 서울교통공사, 서울 열린데이터광장 OA-22526 | 공공누리 제1유형(출처표시) | `scripts/build-voice-guides.py` |
| `src/lib/providers/data/congestion-areas.json` | 서울 실시간 도시데이터 영역의 구성 지점 좌표 | 서울특별시, 서울 열린데이터광장 실시간 도시데이터(OA-21285) | 공공누리 제1유형(출처표시) | `scripts/build-congestion-areas.mjs` |
| `src/lib/data/subway-stations.json` | 전국 도시철도역 좌표·노선 | 국가철도공단 레일포털 "전체 도시철도역사정보"(동일 데이터가 공공데이터포털 전국도시철도역사정보표준데이터 [15013205](https://www.data.go.kr/data/15013205/standard.do)로 제공) | 이용허락범위 제한 없음(공공데이터포털 표기) | `scripts/build-subway-stations.py` |
| `src/lib/data/subway-quick-exit.json` | 서울 지하철 1~8호선 빠른하차 칸·문 | 서울교통공사, 공공데이터포털 [15143840](https://www.data.go.kr/data/15143840/openapi.do) | 이용허락범위 제한 없음 | `scripts/build-subway-quick-exit.mjs` |
| `src/lib/providers/data/tago-cities.json` | TAGO 버스 도시코드 목록 | 국토교통부, 공공데이터포털 [15098534](https://www.data.go.kr/data/15098534/openapi.do) | 이용허락범위 제한 없음 | `scripts/build-tago-cities.mjs` |

⚠ **OSM 파생 파일을 공공데이터 파일과 한 파일로 병합하지 말 것.** 병합본은 ODbL상 파생 데이터베이스가 되어 공공데이터 쪽 조건과 충돌한다. 두 계열은 런타임에서만 합친다.

⚠ 저장소에 **넣지 않은** 데이터도 있다. 행정안전부 도로명주소 내비게이션용 DB는 인수 조건에 국외 반출 금지 조항이 있어 GitHub·Vercel 어디에도 올리지 않았다(`docs/BACKLOG.md` 참조). 유사 프로젝트를 시작할 때 공공기관 자료를 파일로 내려받아 저장소에 넣으려면 승인 화면·보안각서의 반출·재배포 조항을 먼저 읽는다.

## 런타임에 호출하는 외부 서비스

카카오·네이버·SK open API(Tmap)·ODsay·공공데이터포털·서울 열린데이터광장·Deepgram·Gemini·Perplexity 등은 각 서비스의 이용약관 아래 **사용자가 직접 발급한 키**로 호출한다. 이 저장소는 그 데이터를 저장하거나 재배포하지 않는다. 각 키의 발급처와 조건은 [`.env.example`](.env.example)과 [`CLAUDE.md`](CLAUDE.md) "API 키 현황"에 있다.

## 이름과 아이콘

"길동무"라는 이름, 앱 아이콘, App Store 등록, `gildongmu`·`gildongmu-mcp` npm 패키지명, `gildongmu.dodoplanet.space` 도메인은 이 프로젝트를 식별하는 것이라 MIT 라이선스의 대상이 아니다. 코드를 가져다 새 서비스를 만들 때는 다른 이름·아이콘·번들 ID·패키지명을 쓴다. 바꿔야 할 자리는 [`docs/FORKING.md`](docs/FORKING.md)에 있다.

## 서드파티 라이브러리

npm 의존성은 `package.json`·`package-lock.json`에, iOS 의존성은 `ios/Gildongmu.xcodeproj`에 선언돼 있고 각자의 라이선스(MIT·Apache-2.0·BSD·ISC 등)를 따른다.
