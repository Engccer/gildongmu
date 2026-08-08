# CHANGELOG

`gildongmu-mcp` 서버의 버전별 변경 이력. 날짜는 npm 발행일(KST) 기준이다.

도구는 REST 카탈로그에서 자동 생성되므로 `gildongmu` CLI와 버전·기능이 동조한다. 아래는 **도구 관점**으로 정리한 것이고, 명령 관점 이력은 [CLI CHANGELOG](https://github.com/Engccer/gildongmu/blob/main/packages/cli/CHANGELOG.md)를 본다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르고 버전은 [유의적 버전](https://semver.org/lang/ko/)을 따른다.

---

## [0.8.0] - 2026-08-02

### 변경
- `nearby-bus`가 0건일 때 **미제공 지역과 반경 밖을 구분**해 응답한다. 조회 반경이 약 700m 고정이라 0건 대부분은 미제공이 아니라 정상적인 반경 밖이었다.
- `nearby-subway`가 0건이면 **최근접 역과 거리**를 함께 반환한다.
- `nearby-bike`·`nearby-events`에 지역별 미제공 표기를 더했다.

### 수정
- 심야에 `nearby-subway`가 근처 역을 통째로 누락하던 문제. 이제 역은 항상 반환하고 운행 상태를 4가지(운행 중·운행 종료·조회 실패·정보 없음)로 구분한다.
- 좌표 인자를 빠뜨렸을 때 "서비스 지역 밖"으로 잘못 응답하던 문제. 빈 값이 좌표 0으로 해석되고 있었다.

## [0.7.0] - 2026-08-01

### 추가
- `nearby-congestion`: 서울 실시간 인구 혼잡도.
- `nearby-events`: 오늘 진행 중인 근처 문화행사(서울).
- `route-walk`에 계단 회피 인자를 더했다. 무계단 경로가 없으면 기본 경로와 함께 그 사실을 응답에 싣는다.
- `route-transit` 구간에 운행 시간 밖 표기를 더했다.

## [0.6.1] - 2026-07-30

### 수정
- `serverInfo.version`이 실제 설치 버전이 아니라 `0.5.0`을 보고하던 문제.
- `route-car` 안내에서 거리 `0`이 중복 표기되던 문제.

## [0.6.0] - 2026-07-29

### 추가
- 대한민국 밖 좌표에 서비스 지역 밖 마커를 실어 응답한다(오류 아님). 좌표가 필요 없는 도구는 전 세계에서 그대로 동작한다.

## [0.5.0] - 2026-07-28

### 추가
- `nearby-walk-infra`: 보행 인프라(음향신호기·횡단보도·점자블록). 도구 24종이 됐다.

### 변경
- **기본 API 주소가 `https://gildongmu.dodoplanet.space`로 바뀌었다.**

## [0.4.0] - 2026-07-22

### 추가
- `station-timetable`: 도시철도역 첫차·막차.
- `station-metro-facilities`에 음성유도기·엘리베이터 보강 그룹, `station`에 배차간격을 더했다.

## [0.3.0] - 2026-07-21

### 추가
- `route-walk`: 도보 경로 브리핑.

## [0.2.0] - 2026-07-20

### 제거
- **`attractions-search` 도구를 제거했다**(호환성 깨짐). 장소 검색이 정확도순으로 바뀌면서 중복이 됐다. `places-search`를 대신 쓴다.

## [0.1.0] - 2026-07-16

첫 공개 발행.

- stdio MCP 서버. REST 카탈로그에서 도구를 자동 생성하므로 CLI와 항목이 1:1로 대응한다.
- 장소·주소 검색, 내 주변 7종, 역 정보·실시간 도착, 버스 노선, 경로 브리핑, 날씨·공기질, 현재 위치 정위, 무장애 관광지.
- 계정·토큰 없이 공개 REST API를 호출한다.

[0.8.0]: https://www.npmjs.com/package/gildongmu-mcp/v/0.8.0
[0.7.0]: https://www.npmjs.com/package/gildongmu-mcp/v/0.7.0
[0.6.1]: https://www.npmjs.com/package/gildongmu-mcp/v/0.6.1
[0.6.0]: https://www.npmjs.com/package/gildongmu-mcp/v/0.6.0
[0.5.0]: https://www.npmjs.com/package/gildongmu-mcp/v/0.5.0
[0.4.0]: https://www.npmjs.com/package/gildongmu-mcp/v/0.4.0
[0.3.0]: https://www.npmjs.com/package/gildongmu-mcp/v/0.3.0
[0.2.0]: https://www.npmjs.com/package/gildongmu-mcp/v/0.2.0
[0.1.0]: https://www.npmjs.com/package/gildongmu-mcp/v/0.1.0
