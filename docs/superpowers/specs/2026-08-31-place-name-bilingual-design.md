# 장소명 영문 병기 설계 (E28) — 로마자 서버 투영 + 한 줄 괄호 + 접근명 단일화

- 날짜: 2026-08-31
- 상태: 설계 확정(구현 착수). 위원장 판정 4건은 `docs/superpowers/plans/2026-08-31-en-locale-korean-cleanup-parallel-plan.md` §1이 정본이며 이 문서는 그 판정을 코드 계약으로 옮긴다.
- 병렬 세션: place-names(이 문서). 같은 웨이브의 transit-en(E27)이 `bilingualName` 계약을 참조하므로 §4 헬퍼는 **가장 먼저 별도 커밋으로 push**한다.
- **설계 리뷰 게이트 판정: 실시.** 새 판정 계층 둘(로마자 변환 규칙·병기 조립 규칙)이 웹 13면·iOS 12면에 복제되고, 접근 가능한 이름의 구성이 곧 시각장애 사용자의 정보 정확성(글로벌 규칙 ①·④)이라 codex adversarial-review 대상이다. 리뷰 결과는 §10에 기록한다.

## 1. 문제

비-ko 로케일(en·es·fr·it·ja)에서 카카오·네이버 장소명, 병원명, TAGO/TOPIS 정류소명, 문화행사 제목·장소, 따릉이 대여소명, 혼잡도 영역명, 공기질 측정소명이 한글 원문 그대로 보이고 들린다. A26(en-fix)이 `lang="ko"` 속성으로 발화 엔진만 맞췄고, 한국어를 모르는 사용자는 그 이름을 읽을 수도 말할 수도 없다. 영문 원천이 있는 이름(지하철역 `nameEn`·juso `engAddr`·TourAPI en·ODsay 영문)은 이미 있거나 E27이 맡는다. **영문 원천이 없는 이름**이 이 문서의 대상이다.

## 2. 위원장 판정(불변) → 계약

| 판정 | 계약 |
|---|---|
| ① 영문 원천 없는 이름은 한글 + 로마자 | 서버가 `nameRoman`(additive)을 싣고, 클라이언트가 비-ko 로케일에서 병기한다. 원천 영문이 있으면 로마자를 만들지 않는다 |
| ② 모양은 한 줄 괄호 `Roman (한글)` / `English (한글)` | 시각 표시 문자열은 `${primary} (${ko})` 한 줄 |
| ③ 접근 가능한 이름은 괄호 앞만 | 웹: 괄호부 `<span lang="ko" aria-hidden="true">`, iOS: `.accessibilityLabel`에 primary만. 인터랙티브 요소는 그대로 별도 객체 |
| ④ 서울시 외국어 표기 사전(OA-2475) 기각 | 사전 조회 없음. 로마자는 규칙 변환만 |

## 3. 로마자 변환 `src/lib/romanize.ts` (서버 한 곳)

### 3.1 `@romanize/korean` 평가 → 채택하지 않음

- 메타: npm 0.1.3, MIT, 단일 저자(kntng), 마지막 발행 2025-05-24, 마지막 커밋 2025-06-03, 스타 4, 42KB(minified, 소스 미포함). 어절 단위 연결·첫 글자 소문자.
- 실측(2026-08-31, 국어원 표기법 기대값 94어): **64 정답 / 30 오류**. 코디네이터 표 5어 중 4어 정답(신라 silla·독립문 dongnimmun·선릉 seolleung·왕십리 wangsimni), 종로 → `jongro`(오답, 정답 jongno).
- 오류가 규칙 누락 계열이라 부분 보정이 불가하다:
  - ㄹ+ㄹ → `lr`(플라자 peulraja·올림픽 olrimpik·울릉도 ulreungdo·엘리베이터 elribeiteo·월롱 wolrong) — 정답은 `ll`.
  - ㅇ·ㅁ 받침 뒤 ㄹ 비음화 미적용(종로 jongro·심리 simri·강릉 gangreung) — 정답 jongno·simni·gangneung.
  - ㄹ+ㄴ 유음화 미적용(설날 seolnal·별내 byeolnae·물난리 mulnalli).
  - 겹받침 대표음 오류(닭 dal·흙 heul·삶 sal·읽다 ilda) — 정답 dak·heuk·sam·ikda.
  - 체언의 ㄱ·ㄷ·ㅂ + ㅎ 격음 표기 미적용(묵호 muko·집현전 jipyeonjeon) — 정답 Mukho·Jiphyeonjeon(표기법 3장 1항 붙임).
  - ㅂ 받침 + ㅁ 비음화 미적용(앞마당 apmadang) — 정답 ammadang.
- 판정: 핵심 음운 변화 규칙이 빠진 라이브러리를 의존성으로 들이고 패치하는 것보다 규칙표를 직접 갖는 편이 검증·유지 모두 싸다(약 200줄, 결정론, 테스트 표로 고정). 위 실측 표는 `src/lib/__tests__/romanize.test.ts`의 기대값이 된다.

### 3.2 규칙(국어원 로마자 표기법 2000, 음운 변화 반영)

1. **음절 분해** U+AC00~U+D7A3 → 초성 19·중성 21·종성 28. 비한글 문자(숫자·라틴·문장부호·공백)는 그대로 통과한다.
2. **모음 표**: ㅏa ㅐae ㅑya ㅒyae ㅓeo ㅔe ㅕyeo ㅖye ㅗo ㅘwa ㅙwae ㅚoe ㅛyo ㅜu ㅝwo ㅞwe ㅟwi ㅠyu ㅡeu ㅢui ㅣi. `ㅢ`는 위치 무관 `ui`(광희문 Gwanghuimun).
3. **초성 표**: ㄱg ㄲkk ㄴn ㄷd ㄸtt ㄹr ㅁm ㅂb ㅃpp ㅅs ㅆss ㅇ(무음) ㅈj ㅉjj ㅊch ㅋk ㅌt ㅍp ㅎh.
4. **종성 대표음**(음절 끝소리): ㄱㄲㅋㄳㄺ→k · ㄴㄵㄶ→n · ㄷㅅㅆㅈㅊㅌㅎ→t · ㄹㄼㄽㄾㅀ→l · ㅁㄻ→m · ㅂㅍㅄㄿ→p · ㅇ→ng. (겹받침 ㄼ은 명사에서 l — 지명·상호가 대상이라 `밟-`류 용언 예외는 두지 않는다.)
5. **연음**: 다음 음절 초성이 ㅇ이면 종성이 초성으로 옮겨 초성 표기(ㄱg·ㄷd·ㅂb·ㄹr·ㅅs·ㅈj·ㅊch·ㅋk·ㅌt·ㅍp·ㄲkk·ㅆss, ㅎ은 탈락). 겹받침은 앞 자음이 종성 대표음, 뒤 자음이 연음(ㄳ k+s·ㄵ n+j·ㄶ n·ㄺ l+g·ㄻ l+m·ㄼ l+b·ㄽ l+s·ㄾ l+t·ㄿ l+p·ㅀ l·ㅄ p+s). 단 다음 모음이 `ㅣ`·`ㅑㅕㅛㅠㅖㅒ`인 합성어의 ㄴ 첨가(꽃잎 kkonnip)는 형태소 경계 정보가 없어 **적용하지 않는다**(§3.4).
6. **비음화**: 대표음 k·t·p 뒤에 ㄴ·ㅁ → ng·n·m(국민 gungmin·입문 immun·앞마당 ammadang·백마 Baengma). ㅇ·ㅁ 뒤 ㄹ → n(종로 Jongno·심리 simni). k·p 뒤 ㄹ → 받침 비음화 + ㄹ→n(독립 dongnip·협력 hyeomnyeok·백리 Baengni).
7. **유음화**: ㄴ+ㄹ·ㄹ+ㄴ·ㄹ+ㄹ → `ll`(신라 Silla·선릉 Seolleung·설날 seollal·울릉 Ulleung·플라자 peullaja).
8. **격음화**: ㅎ 받침 + ㄱㄷㅈ → k·t·ch(좋고 joko·놓다 nota). ㄱㄷㅂ 받침 + ㅎ 초성은 **체언 규칙**으로 `kh`·`th`·`ph`를 밝혀 적는다(묵호 Mukho·집현전 Jiphyeonjeon) — 대상이 지명·상호(체언)라 이쪽을 기본값으로 한다.
9. **된소리되기·구개음화는 표기하지 않는다**(표기법 원칙 — 압구정 Apgujeong, 낙동강 Nakdonggang; 구개음화 `같이 gachi`는 형태소 경계 의존이라 미적용 → `gati`, §3.4).
10. **어절**: 공백으로 나눈 어절 단위로 변환하고 어절 경계에서는 음운 변화를 적용하지 않는다. 어절의 첫 라틴 글자를 대문자로(고유명사). 이미 라틴 문자로 시작하는 어절은 손대지 않는다(`GS25 천호점` → `GS25 Cheonhojeom`).
11. **주소 옵션** `{ address: true }`: 행정구역·도로 단위 접미(시·도·군·구·읍·면·리·동·로·길·대로)가 어절 끝에 오면 붙임표로 뗀다(강동구 Gangdong-gu·길동 Gil-dong·성내로 Seongnae-ro·올림픽대로 Ollimpik-daero, 표기법 3장 5항). 장소명에는 쓰지 않는다(상호 "명동교자"가 `Myeong-dongGyoja`로 갈리는 것을 막는다) — 호출부가 주소임을 아는 자리(역지오코딩 폴백·한눈에 보기 `place`)만 켠다.
12. 입력이 한글을 하나도 담지 않으면 **입력을 그대로 반환**한다(멱등). 호출부(`romanNameOf`·`romanAddressOf`)는 NFC 정규화 뒤 음절이 있을 때만 `nameRoman`을 만든다.
13. **적용 순서(음절 i의 종성 × 다음 초성 c, 한 번만 판정 — 재평가 없음)**: ① 어말·비한글 앞 → 대표음 ② c=ㅇ → 연음(5) ③ 종성이 ㅎ을 품고 c∈{ㄱ,ㄷ,ㅈ} → 격음화(8, 겹받침의 앞 자음은 대표음으로 남는다: 싫다 Silta·않고 Anko) ④ c∈{ㄴ,ㅁ} → 비음화·ㄹ+ㄴ 유음화(6·7) ⑤ c=ㄹ → 받침 부류별 비음화·유음화(6·7) ⑥ 그 외(ㅎ 초성 포함) → 대표음 + 초성 그대로(체언 규칙). 어절 경계·붙임표 경계에서는 어느 단계도 적용하지 않는다(주소 옵션은 줄기와 단위를 **먼저 나눈 뒤** 각각 변환). 라틴으로 시작하는 어절도 안의 한글 구간은 변환한다(`e편한세상` → `ePyeonhansesang`) — 규칙 10의 "손대지 않는다"는 첫 글자 대문자화만 가리킨다.
14. 주소 옵션의 `도`는 광역 도 허용 목록(경기·강원·충청남북·전라남북·경상남북·제주)만 붙임표를 떼고(여의도·거제도는 지명), 광역시 약칭(서울·부산·대구·인천·광주·대전·울산·세종)은 단위로 보지 않는다(대구 → Daegu). 숫자 길(`성내로3길`·`3번길`)은 `Seongnae-ro 3-gil`·`3beon-gil`.

### 3.3 기대값 테스트(고정)

코디네이터 표 5어(신라·독립문·선릉·왕십리·종로) + 서울아산병원 + §3.1 실측 94어 표 전량 + 어절·대문자·숫자 통과·주소 옵션 케이스. 서울아산병원은 어절 분리 원천이 없어 `Seourasanbyeongwon`이 규칙상 정답이고(§3.4 ①), 코디네이터가 기대한 `Seoul Asan Byeongwon` 수준은 **사전 없이는 불가**함을 테스트 주석으로 남긴다.

### 3.4 알려진 한계(문서화, 수정 대상 아님)

1. **어절 내부 단어 경계를 모른다**: 서울아산병원 → Seourasanbyeongwon(연음 r). 카카오·병원 명부의 이름은 붙여 쓰는 경우가 많아 로마자가 길어진다. 사전(OA-2475)은 실측 매칭 0건이라 기각됐고, 형태소 분석기는 서버 의존성·정확도 모두 이 용도에 과하다.
2. **ㄴ 첨가·구개음화·`밟-`류 겹받침 예외**는 형태소 경계 의존이라 미적용(한여름 Hanyeoreum, 같이 gati). 지명·상호에서 빈도가 낮다.
3. **관용 표기·고유 영문명**(Lotte·Hyundai·Samsung·Seoul Asan)은 규칙 밖이다 — 영문 원천이 있으면 그것을 쓰고, 없으면 규칙 로마자다.
4. **지하철역 이름이 카카오 장소로 올 때**("강남역 2호선" → Gangnamyeok 2hoseon)는 seed `nameEn`과 조인하지 않는다(검색 결과 카드는 역 판정 계층이 없다). E27 노선명 표가 들어와도 카카오 장소명 안의 노선 토큰은 문자열이라 그대로다.
5. 로마자 변환은 결정론이지만 **정확한 발음의 근사**다. 낭독 채널(VoiceOver 영어 엔진)이 로마자를 영어 철자 규칙으로 읽으므로 원음과 차이가 난다 — 그 차이는 이 설계가 줄이려는 "읽을 수 없음"보다 작다.

## 4. 병기 조립 `src/lib/bilingual-name.ts` ↔ Kit `BilingualName.swift` (공유 fixture)

```ts
export interface BilingualName {
  /** 시각·낭독 모두의 1순위 이름. 병기하지 않으면 ko 원문. */
  primary: string;
  /** 병기할 한글 원문. null이면 병기 없음. */
  secondary: string | null;
}
/** en 원천 → 로마자 → 없음 순. */
export function bilingualName(locale: string, ko: string, source: { en?: string | null; roman?: string | null }): BilingualName;
/** 시각 문자열 `${primary} (${secondary})`(secondary 없으면 primary). iOS `Text`·웹 비-React 소비자용. */
export function bilingualDisplay(b: BilingualName): string;
```

규칙(공유 fixture `src/lib/__tests__/fixtures/bilingual-name-cases.json`이 못 박는다):

1. `!prefersEnglish(locale)`(ko) → `{primary: ko, secondary: null}`. ko 화면의 텍스트·구조는 불변(`lang` 속성만 `langFor(접근 텍스트)`로 통일돼 ko 페이지의 한글 줄에 `lang="ko"`가 붙을 수 있다 — 페이지 언어와 같은 값이라 낭독·구조 모두 무해, 코드 리뷰 확인). `locale`은 앱이 쓰는 고정 집합(ko·en·es·fr·it·ja)이고 ko 외는 전부 영문 데이터 로케일이다(`dataLocale` 동형).
1'. 원문이 **이미 `Latin (한글)` 병기 형태**(`EMBEDDED_BILINGUAL`: 한글 없는 라틴 선두 + 괄호 안 한글, 끝)면 그대로 `{primary: 선두, secondary: 괄호 안}` — TourAPI en `title`이 이 모양이다(a11y 감사 실호출 2026-08-31: en 검색 결과 201건 중 78건). 서버 `romanNameOf`도 같은 정규식으로 로마자를 만들지 않는다(§7의 "TourAPI en 이름은 한글이 없어 자동 제외" 전제가 데이터 현실과 달랐다 — 그 이름은 한글을 품는다).
2. `candidate = latin(en) ?? latin(roman) ?? null` — `latin()`은 trim 후 비어 있지 않고 **한글(음절·자모)이 없을 때만** 값이다. 한글이 섞인 후보(`"강남 Station"`·로마자 변환이 남긴 자모 `ㄱKape`)는 후보가 아니다 — 접근 가능한 이름에 한글이 새는 유일한 경로를 규칙으로 막는다(설계 리뷰 검출). 후보가 없으면 `{primary: ko, secondary: null}`(한글 그대로, `lang="ko"`는 종전대로).
3. `!hasHangul(ko)` → `{primary: candidate, secondary: null}` — 표지판 대조가 필요한 한글이 없으면 괄호는 잉여다(`CU` · `GS25`).
4. `candidate.NFC === trim(ko).NFC` → 병기 없음(両동일. 표시는 `ko` 원문 그대로).
5. 그 외 `{primary: candidate, secondary: ko}`.
6. 접근 가능한 이름은 언제나 `primary`다(웹은 렌더 규칙 §5, iOS는 `.accessibilityLabel`). 후보 규칙 2가 있어 `primary`에는 한글이 없거나(병기) `primary === ko`(폴백)의 둘뿐이다.

Kit 미러: `public struct BilingualName { primary; secondary }`, `public func bilingualName(lang:ko:en:roman:) -> BilingualName`, `public var display: String`, `hasHangul(_:)`. 테스트는 같은 fixture를 `#filePath` 상대경로로 읽는다(`GuideToneLayerTests` 관례). 이 헬퍼가 **E27이 rebase해 쓰는 첫 커밋**이다.

## 5. 웹 렌더 규칙 — 실측 근거

Chrome 접근성 트리 실측(2026-08-31, `chrome-devtools take_snapshot`, verbose):

| 마크업 | AX 트리 | 판정 |
|---|---|---|
| `<p>Name <span aria-hidden>(한글)</span>, hospital, 500m</p>` | StaticText **2개**(`"Name "`·`", hospital, 500m"`) | **분절** — 금지 |
| `<p>Name, hospital, 500m <span aria-hidden>(한글)</span></p>` | StaticText 1개 | 한 객체 |
| `<h4>Name <span aria-hidden>(한글)</span></h4>` | heading "Name", StaticText 1개 | 한 객체 |
| `<button>Name <span aria-hidden>(한글)</span>, hospital, 500m</button>` | button "Name , hospital, 500m" | 한 객체(이름 계산). 공백 이중화 주의 |
| `<p>Name <span lang="ko">(한글)</span>, …</p>` (aria-hidden 없음) | StaticText 3개 + 한글 낭독 | 이중 낭독 + 분절 — 금지 |

규칙:

- **R1. 괄호부는 그 접근성 객체의 마지막 DOM 노드에 둔다.** 이름 단독 요소(`PlaceCard` 이름 블록·`PlaceDetail` h2)는 이름 바로 뒤가 곧 끝이라 `Roman (한글)`이 그대로 성립한다. 이름이 다른 조각과 한 텍스트로 합쳐진 줄(`joinText(name, kind, distance)` h4·`<p>`)은 **줄 끝**에 둔다: `Name, hospital, 500m (한글)`. 위원장 판정 ②의 "한 줄 괄호"는 유지되고 자리만 줄 끝이다. 시각적 근접보다 SR 분절 0이 우선이다(헌장 §4).
- **R2. 이름이 계산되는 요소(`<button>`)** 안에서는 이름 바로 뒤에 둘 수 있다(`AroundNearby` 항목·`SurroundingsScene` 항목·`LocationBar`·`AddressResultList`). 공백 이중화를 막기 위해 앞 공백은 괄호 span 안에 넣는다(`<span> (한글)</span>`).
- **R3. 렌더 헬퍼 하나**: `src/components/BilingualName.tsx`의 `<KoTail secondary={b.secondary} />` = `secondary ? <span lang="ko" aria-hidden="true"> ({secondary})</span> : null`. 손으로 span을 쓰지 않는다.
- **R4. 줄의 `lang`은 접근 텍스트 기준이다**: `lang={hasHangul(accessibleText) ? "ko" : undefined}`. 병기 뒤 접근 텍스트가 라틴뿐이면 `lang="ko"`를 뗀다(영어 엔진이 로마자를 읽는다). 한국어 분류·진료 종류가 남아 있는 합성 줄은 A26 판정대로 줄 전체 `lang="ko"` 유지(BACKLOG A26 종결 기록의 혼합 줄 축).
- **R5. 프로즈 템플릿 안 삽입**(한눈에 보기 불릿·`SurroundingsScene` 문장·`LocationBar` `gpsNear {address}`·`LocalConditions` `summary {area}`·`AirQuality` `station {name}`): 템플릿 인자에 `primary`를 넣고 한글은 R1대로 줄 끝 tail로. 불릿 하나에 이름이 여럿이면 tail은 순서대로 쉼표 나열 `(A한글, B한글)` — 병기하는 이름만 넣는다.

## 6. iOS 렌더 규칙

- **단일 `Text`가 한 객체**라 웹 R1의 자리 제약이 없다: 시각 문자열은 이름 바로 뒤 `Roman (한글)`이고, `.accessibilityLabel(Text(accessible))`이 낭독을 덮는다. 합성 줄은 `bilingualLine(visible:accessible:)` 헬퍼(앱 `Nearby/NearbyLoadState.swift`, `distanceText` 옆) = `Text(visible).accessibilityLabel(Text(spokenUnits(accessible)))`.
- `PlaceRow`(`SearchView.swift`)의 이름 `Text`는 `Text(b.display).accessibilityLabel(Text(b.primary))`. 행의 `.accessibilityElement(children: .combine)`이 자식 라벨을 잇는다.
- `PlaceDetailView`: `navigationTitle(b.primary)`(내비 타이틀은 라벨 분리 수단이 없다), 한글 원문은 제목 아래 보조 `Text` 한 줄 + `.accessibilityHidden(true)`. **의도된 예외**: 이 화면만 판정 ②(한 줄 괄호)가 ③(낭독은 로마자만)과 충돌하고 ③을 앞세웠다 — `navigationTitle("Roman (한글)")`은 VoiceOver가 한글까지 읽고, principal toolbar 제목은 large 타이틀 모드와 공존하지 않는다. 위원장 실기기 판정 항목(BACKLOG E28 종결 기록).
- 합성 줄 헬퍼는 시각·낭독 문자열을 따로 받는다(`bilingualLine(visible:accessible:)`). 두 인자가 어긋나는 것을 타입이 막지 못하므로 호출부는 **같은 조각 목록에 이름만 `display`/`primary`로 바꿔** 두 번 조립한다(`joinText(name.display, rest)` / `joinText(name.primary, rest)`) — `rest`를 한 변수로 두는 것이 계약이다.
- **한국어 구간 언어 태깅 헬퍼(후보 ①)** `KoreanText(verbatim:)` = `Text(verbatim:).environment(\.locale, Locale(identifier: "ko"))`. 비-ko UI에서 한글이 그대로 남는 자리(병기 불가 폴백·한국어 분류)에 쓴다. 시작 자리는 `PlaceDetailView` 분류 줄 하나다 — `PlaceRow` 보조 줄은 `.combine` 행이라 자식 `.environment(\.locale)`이 합쳐진 라벨에 닿지 않아(a11y 감사 지적) 후보 ②(`AttributedString` 런 단위)만 가능하다. **VoiceOver가 실제로 한국어 엔진으로 전환하는지는 실기기 판정 항목**(BACKLOG §2 등재; 후보 ② `AttributedString.languageIdentifier`를 예비로 적는다). 시뮬 AX 스냅샷으로는 라벨 회귀만 본다.
- Kit 모델에 `nameRoman: String?` 등 additive 필드를 디코딩하고 `PlaceProjection.swift` 9종이 `Place.nameRoman`으로 넘긴다(iOS 소비자는 `Place` 하나만 알면 된다).

## 7. 서버 투영 표 (전부 additive · 기존 필드 불변 · CLI/MCP 비파괴)

`nameRoman`은 **무조건** 싣는다(요청 로케일 무관). nearby 라우트 대부분이 `lang`을 받지 않고(조사: `/api/nearby/overview`·`/api/congestion/nearby`·`/api/where-am-i` 등 좌표만), 라우트마다 축을 뚫으면 iOS 호출부가 인자를 빠뜨린 경로가 조용히 한글로 남는다([[no-default-for-safety-parameters]]). 항목당 수십 바이트이고 표시 판정은 클라이언트 로케일이 한다. 채팅 도구 `data`에도 실리는데 산문은 범위 밖이고, 로마자를 모델이 보는 것은 날조 축에 무관하다(도구가 준 필드).

| 도메인 | 타입(`types.ts` 장소·nearby 절) | 필드 | 투영 지점 |
|---|---|---|---|
| 장소 검색 | `Place` | `nameRoman?` | `searchPlaces` 진입점(`places.ts`) — `annotateDistances` 옆 `annotateRoman`. TourAPI en 이름은 한글이 없어 자동 제외 |
| 아이 놀 곳 | `KidsPlace` | `nameRoman?` | `normalizeKidsDoc` |
| 둘러보기 | `SurroundingPlace` · scene `SceneItem` | `nameRoman?` | `normalizeSurroundingDoc` · `surroundings-scene.ts toItem` |
| 소아 진료 | `NightClinic` | `nameRoman?` | `night-clinic.ts` provider 투영 |
| 따릉이 | `BikeStation` | `nameRoman?` | `parseBikeStations` |
| 문화행사 | `CultureEvent` | `titleRoman?` · `placeRoman?` | `toCultureEvent` |
| 무장애 | `BarrierFreePlace` · `BarrierFreeDetail` | `nameRoman?` | `normalizePlace` · `getBarrierFreeDetail` |
| 혼잡도 | `CongestionArea` | `nameRoman?` | `findCongestionNear`(`area.name` 옆) |
| 공기질 | `AirQuality` | `stationNameRoman?` | `parseAirMeasure` |
| 버스 정류소 | `BusStop` | `nameRoman?` | `bus.ts` `mergeBusStops` 뒤 한 곳(TAGO·TOPIS 공통 — E27의 ODsay 조인부와 다른 함수) |
| 한눈에 보기 | `OverviewPlace` · `OverviewStation` | `nameRoman?` · `nameEn?`(역은 seed 원천) · `placeRoman?`(주소 옵션) | `composeOverview` |
| 현재 위치 주소 | `/api/geocode/reverse` 응답 | `addressEn?`(juso `engAddr`, `lang=en`일 때만 조회) · `addressRoman?`(주소 옵션 폴백) | 라우트 |
| 주소 결과 | `JusoAddress` | 변경 없음(`engAddr` 원천 사용) | — |

`Place` 투영(`nearby-place.ts` 5종 ↔ Kit `PlaceProjection.swift` 9종)은 `nameRoman`을 그대로 넘긴다. `where-am-i`는 CLI·채팅 계약이라 손대지 않는다. 카카오 카테고리는 **로마자를 만들지 않는다** — 로마자 분류("Eumsikjeom")는 외국인에게 정보가 0이고, 의미 전달은 버킷 i18n 라벨(`category.ts` 칩 라벨 재사용)이 맞다. 이 문서 범위 밖이라 BACKLOG 후보로 남긴다.

## 8. 적용 면 (웹 ↔ iOS 대칭)

| 면 | 웹 | iOS | 비고 |
|---|---|---|---|
| 장소 카드 | `PlaceCard` 이름 블록(R1) | `PlaceRow` 이름 Text | 채팅 장소 카드 両플랫폼 자동 |
| 장소 상세 | `PlaceDetail` h2(R1) | `PlaceDetailView` 타이틀 + 보조 한글(§6) | |
| 둘러보기 목록 | `AroundNearby` h5 버튼(R2) | `AroundNearbyView` PlaceRow | |
| 둘러보기 장면 | `SurroundingsScene` 항목 버튼(R2)·`scene.place`(주소 옵션) | `SurroundingsSceneSection` itemLine | |
| 한눈에 보기 불릿 | `buildOverviewLines` → `{text, secondary}`(R5) | Kit `LocationNarrative` 미러 | 반환형 변경, CLI `formatNearbyOverview`는 ko 전용이라 불변 |
| 패널 헤딩 `here {place}` | `AroundNearby` h3(R1, `placeRoman`) | `AroundNearbyView.hereLine` | |
| 소아 진료 | `NightClinicsNearby` h4(R1 줄 끝) | `ClinicNearbyView` PlaceRow | |
| 따릉이 | `BikeStations` h4 | `BikeNearbyView` 줄 | |
| 문화행사 | `CultureEventsNearby` h4(title)·장소 줄(place) | `EventsNearbyView` PlaceRow(title) | |
| 무장애 | `BarrierFreeNearby` h4 | `BarrierFreeNearbyView` PlaceRow | 상세 `BarrierFreeInfoSection`은 이름을 렌더하지 않아 불변 |
| 버스 정류소 | `BusArrivals` h4 | `BusNearbyView` 헤더 줄 | E27과 같은 함수를 고치지 않는다 |
| 혼잡도 | `LocalConditions` `summary {area}`(R5) | `ConditionsView` `congestion.summary` | |
| 측정소 | `AirQuality` `station {name}`(R5) | `ConditionsView` `airStationLine` | |
| 현재 위치 주소 | `LocationBar` 버튼(R2) | `LocationBarView` 버튼 | Kit `SearchService.reverseGeocode`에 `lang` 필수 인자 |
| 주소 결과 | `AddressResultList` — 영문 메인 + 보조 한글 블록을 한 줄 괄호 tail로 | `SearchView`·`ChatConversationView` 주소 행 `engAddr (roadAddr), zipNo` | 종전 웹 보조 블록은 버튼 이름에 한글이 들어가 판정 ③ 위반 상태였다 |
| 아이 놀 곳 | `KidsPlacesNearby` h4 | `KidsNearbyView` PlaceRow | 착수 목록 밖이나 같은 골격 — 소유권 밖 자진 신고 |
| 앵커 화면 제목 | — | `nearbyTitle(base, anchor)` | anchor primary |

범위 밖(불변): 채팅 산문, CLI/MCP 텍스트 포맷, `DirectionsView`·`DirectionsEndpointSearchView`(길찾기 세션 소유), 지하철·대중교통 전면(E27), where-am-i.

## 9. 테스트·게이트

- `romanize.test.ts`: §3.3 표. `bilingual-name.test.ts` + Kit `BilingualNameTests`: 공유 fixture. 변이 주입 1회(규칙 3 제거 → fixture 실패 확인)를 plan에 남긴다.
- 컴포넌트 테스트(jsdom): 병기 줄의 접근 텍스트에 한글이 없고(`toHaveAccessibleName`/`textContent` 대조), 괄호 span이 `aria-hidden`·`lang="ko"`이며 그 span이 컨테이너의 **마지막 자식**인지(R1) — `NightClinicsNearby`·`PlaceCard`·`AddressResultList` 3곳 표본.
- 라우트 테스트: `nameRoman`이 한글 이름에만 붙고 라틴 이름엔 없음(places en 병합 fixture).
- 게이트: `npm run test:run`·`npx tsc --noEmit`·`npm run lint`·Kit `swift test`·iOS 시뮬 빌드·a11y-auditor(접근명 단일·이중 낭독 0·분절 0).
- 실호출: 로마자는 순수 함수라 실호출 게이트가 없다. 역지오코딩 `lang=en` juso 조인은 `scripts/verify-reverse-geocode-en.mjs` 1회 실호출로 `addressEn` 획득을 확인한다.

## 10. 설계 리뷰 기록

codex adversarial-review(raw `codex exec` diff 주입, gpt-5.6-sol high, 2026-08-31) 2회. 1회차는 codex가 자기 TTS 훅에 붙들려 요약만 남겼고(`reference/codex-ops.md` 네 번째 fail 원인), 파일 금지 지시를 머리에 올린 2회차가 본문 34건(치명 6·높음 20·중간 7·낮음 1, 판정 "승인 불가")을 냈다. 리뷰는 신호이지 처방이 아니므로 항목마다 계층을 대조해 판정했다:

**수정(설계·코드에 반영)**
- #1 규칙 적용 순서 미정 → §3.2-13 신설. 리뷰의 예 `싫다`를 테스트에 넣자 실제로 `Sita`가 나왔다(격음화 분기가 연음용 겹받침 표를 읽어 받침을 통째로 버림) — 설계 리뷰가 잡은 **실결함 1건**, `romanize.ts`·`romanize.test.ts`(싫다 Silta·않고 Anko) 수정.
- #2·#15 접근명에 한글이 새는 후보 → §4 규칙 2 `latin()`(한글 섞인 후보 배제) + fixture 2건 + Swift 미러.
- #9·#10·#14 주소 접미 오탐(여의도 → Yeoui-do)·경계 시점·NFC → §3.2-13·14, `PROVINCES` 허용 목록·광역시 약칭·숫자 길·`romanNameOf` NFC 정규화, 테스트 추가.
- #30 `ko` 공백 → 규칙 4 비교에 trim(fixture `identical-after-ko-trim`).
- #24 iOS 문화행사 `placeRoman` 소비 누락 → `CultureEventSection` venue 병기.
- #17·#26 jsdom은 AX 분절을 못 잰다 → Chrome AX **실페이지** 실측을 게이트에 추가(§9 갱신): en 검색 결과(`PlaceCard`·`AddressResultList`)에서 이름 StaticText 1개·hidden span `ignored`·버튼 이름에 한글 이름 0 확인. 그 실측이 `AddressResultList` 지번 줄의 기존 분절(라벨·공백·span 셋)을 드러내 한 텍스트로 합쳤다.
- #33 실호출 1회 → `scripts/verify-reverse-geocode-en.mjs` 4케이스(공식 영문 2·수면 좌표·ko 불변), dev 서버 실호출 4/4 PASS.
- #21 CLI/MCP 스키마 → 두 패키지에 zod `.strict()` 0건 확인(additive 안전). #22 캐시 → 문화행사 `unstable_cache` 슬림 투영은 6h 뒤 자연 갱신(그 사이 필드 부재는 ko 폴백 = 정상 상태), 역지오코딩은 서버 캐시 없음·클라 스토어는 `lang`을 키에 포함.

**a11y 감사(별도 컨텍스트, 정적 + iOS 시뮬 런타임 + dev 서버 실호출)**: 구조 축(괄호 자리 15면·이중 낭독·`lang`·iOS 라벨·과잉 ARIA) 전부 PASS. CRITICAL 1건 — TourAPI en 이름이 이미 `Latin (한글)`이라 로마자화가 접근명을 원문보다 나쁘게 만들었다(위 규칙 1'로 수정, 서버 게이트 동일 정규식, fixture 3건). WARNING 1건 — iOS 채팅 산문 블록 로터 액션 "○○ 상세 보기"의 한글 원명 → primary. INFO — 셸 h3 `lang`(반영), `LocationBar` 괄호를 상태 문장 바로 뒤로(반영, R2), `KoreanText` 적용 자리 문장 정정(§6), 실기기 판정 5건(RD-1~5)은 BACKLOG E28 표에 합쳤다.

**코드 리뷰(별도 컨텍스트, spec-compliance + 정확성 + 소유권)**: 판정 "머지 가능". 반영 — `AddressResultList`가 유일하게 `bilingualName` 가드를 우회(`Boolean(engAddr)`)해 juso 영문에 한글 조각이 섞이면 접근명에 샐 수 있던 자리를 같은 가드로 통일, `AroundNearby` 죽은 import 제거. 기각 — `KidsPlacesNearby` ko 로케일 `lang="ko"` 신규 부여(규칙 1 문언 정정으로 흡수). **변이 주입 기록**(§9 요구): 규칙 3(`!hasHangul(ko)` 조기 반환) 제거 → fixture `latin-ko-with-different-en`·`identical-after-ko-trim` 실패로 검출(2/19)(리뷰어 재확인 + 이 세션 실행). 프로세스 메모 — 리뷰 중 문서 파일이 갱신됐다(구현 세션이 분배 단계였다); 다음엔 SHA 고정 후 디스패치([[freeze-artifact-before-review-dispatch]]).

**의도된 결정으로 기각(근거 기록)**
- #3 R1 줄 끝 괄호가 `primary (ko)` 원자 형태를 깬다 → 실측표대로 웹 합성 줄은 가운데 hidden span이 분절이라 대안이 없다(줄을 이름/부가로 나누면 SR 객체가 둘로 늘어 더 나쁘다). 시각 근접보다 분절 0을 택했다 — **위원장 실기기 판정 항목**으로 등재.
- #4 iOS 상세 제목 → §6 예외 기록(③ > ②), 판정 항목.
- #6 `nameRoman` 부재의 3-state → 로마자는 순수 함수라 "실패"가 없고, 부재의 두 뜻(한글 없음·구버전 응답)은 둘 다 "한글 그대로"가 정답이라 거짓 표시가 생기지 않는다.
- #7·#8 ㄴ+ㄹ→ㄴㄴ·ㄴ 첨가(학여울)·구개음화 → 형태소 경계 의존이라 §3.4 한계 유지(신문로 Sinmullo를 한계 테스트로 고정). 강남역은 공식 표기도 Gangnamyeok.
- #11 `hasHangul` 게이트가 영문 원천을 안 본다 → 투영 지점 중 영문 원천이 있는 것은 역(`nameEn`)뿐이고 역은 로마자를 만들지 않는다. 클라이언트 규칙이 `en`을 먼저 고르므로 서버가 로마자를 실어도 정확성은 깨지지 않는다(경제 규칙).
- #12 `lang=en`이 ja·es 등을 배제 → `lang`은 UI 로케일이 아니라 데이터 로케일(ko|en, `prefersEnglish`/`AppLanguage.dataLocale`)이다.
- #13 혼합 줄 `lang="ko"` → A26 판정 축 그대로(분류 i18n은 BACKLOG 후보).
- #16 대소문자 → §3.1 표는 라이브러리 출력, 우리 규칙은 어절 첫 글자 대문자(테스트 기대값이 그 정책).
- #18·#19 iOS combine 순서·`KoreanText` → 실기기 판정 항목(코디네이터 배포 잠금).
- #23·#25 E27 겹침·`DirectionsEndpointSearchView` → `BusStop` 정류소명은 E28, ODsay 조인은 E27로 함수가 다르고, 길찾기 검색 화면 병기는 BACKLOG에 이관 등재.
- #27·#28·#29·#31·#32·#34 → 표본 확대(투영 테스트 `romanize-projection.test.ts`·컴포넌트 2종·라우트 1종), 로케일 집합은 앱 고정, 공백은 `KoTail`이 소유, 페이로드는 항목당 이름 길이 수준, fixture 경로는 Kit 전 테스트의 기존 관례.
