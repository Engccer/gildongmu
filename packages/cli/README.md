# gildongmu

접근성 우선 대한민국 길찾기·로컬 정보 CLI. 장소·주소 검색, 대중교통 실시간 도착, 경로 브리핑, 날씨·공기질, 무장애 관광지 정보 등을 터미널에서 바로 조회한다. 스크린 리더 사용자를 1급 시민으로 삼는 [길동무](https://gildongmu.vercel.app) 프로젝트의 씬 클라이언트로, 모든 명령은 프로덕션 REST API를 그대로 호출한다.

## 설치

```bash
npm install -g gildongmu
```

`gildongmu`·`gil` 두 명령이 모두 등록된다(아래 예시는 짧은 `gil` 사용).

## 인증

없음. 전 명령이 공개 REST API(기본 `https://gildongmu.vercel.app`)를 호출하며 계정·토큰이 필요 없다.

## 위치 지정 3가지 방법

우선순위: `--lat`/`--lng` > `--near`(지오코딩) > `gil config set location`(기본값 저장).

```bash
gil nearby subway --lat 37.5326 --lng 127.1265   # 정확한 좌표
gil nearby subway --near "강동역"                # 장소명·주소를 지오코딩
gil config set location "강동역"                 # 기본 위치를 한 번 저장하면
gil nearby subway                                # 이후 매번 지정 없이 사용
```

## 자주 쓰는 명령

```bash
gil search "맥도날드"                       # 장소·주소 통합 검색(0건이면 웹 검색 폴백)
gil nearby subway --near "강동역"           # 주변 지하철역 실시간 도착
gil nearby bus --near "강동역"              # 주변 버스 정류소 실시간 도착
gil station info "강동역"                   # 역 정보 + 교통약자 시설(코레일·서울지하철)
gil station arrivals "강동역"               # 역 실시간 도착(지하철)
gil route car "길동역" "강남역"             # 자동차 경로 턴바이턴 브리핑
gil route transit "길동역" "강남역"         # 대중교통 경로(추천+대안)
gil route walk "길동역" "강남역"            # 도보 경로 텍스트 브리핑
gil weather --near "강동역"                 # 이 지역 날씨(기상청)
gil air --near "강동역"                     # 이 지역 공기질(에어코리아)
gil whereami --lat 37.5326 --lng 127.1265   # 현재 위치 정위(주소·행정동·가까운 역)
gil chat "강동역 근처 카페 알려줘"          # 장소·이동 질문 채팅(단발)
gil chat                                    # 채팅 REPL(대화형 터미널에서만 진입)
```

## 출력 모드

```bash
gil search "맥도날드" --output json   # 스크립트용 JSON 강제
gil search "맥도날드"                 # TTY면 산문, 파이프면 JSON 자동 판정
gil config set output json            # 영구 기본값으로 저장
NO_COLOR=1 gil search "맥도날드"      # 색상 비활성화
```

## 자동완성

```bash
gil completion bash >> ~/.bash_completion
gil completion zsh > ~/.config/gildongmu/_gil   # fpath에 추가하거나
echo 'eval "$(gil completion zsh)"' >> ~/.zshrc
gil completion fish > ~/.config/fish/completions/gil.fish
```

## 명령 트리 (13개)

| 명령 | 하위 명령 | 설명 |
|---|---|---|
| `search <query>` | | 장소·주소 통합 검색(0건이면 웹 검색 폴백) |
| `web <query>` | | 웹 검색(Perplexity) |
| `nearby` | `subway`/`bus`/`bike`/`clinic`/`kids`/`around`/`barrier-free` | 내 주변 정보 7종(위치 필수) |
| `station` | `info <역명>`, `arrivals <역명>` | 역 정보·시설·실시간 도착 |
| `bus` | `route --source <tago\|seoul> --route-id <id> [--city-code <code>]` | 버스 노선 경유 정류소 |
| `place` | `barrier-free <contentId>` | 무장애 관광지 편의시설 상세 |
| `route` | `car <출발> <도착>`, `transit <출발> <도착>`, `walk <출발> <도착>` | 경로 브리핑(자동차 턴바이턴/대중교통/도보) |
| `weather` | | 이 지역 날씨(위치 필수) |
| `air` | | 이 지역 공기질(위치 필수) |
| `whereami` | | 현재 위치 정위(위치 필수) |
| `chat [question]` | | 장소·이동 질문 채팅(단발/REPL) |
| `config` | `get [key]`, `set <key> <value>`, `path` | CLI 설정 조회·저장(apiUrl·output·location) |
| `completion <shell>` | | 셸 자동완성 스크립트 출력(bash/zsh/fish) |

`nearby`·`weather`·`air`·`whereami`·`chat`·`route`·`search`는 위치 3방법(`--near`/`--lat`+`--lng`/기본값)을 공유한다. `gil <명령> --help`로 각 명령의 전체 인자를 확인한다.

## Exit code

| 코드 | 의미 |
|---|---|
| 0 | 정상 |
| 1 | 일반·upstream 오류(4xx/5xx) |
| 2 | 잘못된 인자 |
| 7 | 네트워크 연결 실패 |

인증 코드는 없다(공개 API).

## 환경변수

- `GILDONGMU_API_URL`: API 엔드포인트(기본 `https://gildongmu.vercel.app`)
- `GILDONGMU_CONFIG_DIR`: 설정 디렉토리(기본 `~/.config/gildongmu`)
- `NO_COLOR`: 색상 비활성화
