import { describe, it, expect } from "vitest";
import { romanize } from "../romanize";

/**
 * 국어원 로마자 표기법 기대값 표(spec §3.3). 앞의 6어는 코디네이터 실측 표(`@romanize/korean`이
 * 종로를 jongro로 틀렸고 서울아산병원은 어절 분리 원천이 없어 `Seoul Asan Byeongwon`이 아니라
 * 규칙상 `Seourasanbyeongwon`이 정답이다 — §3.4 ①). 나머지는 규칙별 대표어.
 */
const CASES: [string, string][] = [
  ["신라", "Silla"],
  ["독립문", "Dongnimmun"],
  ["선릉", "Seolleung"],
  ["왕십리", "Wangsimni"],
  ["종로", "Jongno"],
  ["서울아산병원", "Seourasanbyeongwon"],
  // 유음화 ㄹ+ㄹ·ㄴ+ㄹ·ㄹ+ㄴ
  ["울릉도", "Ulleungdo"],
  ["플라자", "Peullaja"],
  ["올림픽", "Ollimpik"],
  ["엘리베이터", "Ellibeiteo"],
  ["월롱", "Wollong"],
  ["실로암", "Silloam"],
  ["한라산", "Hallasan"],
  ["설날", "Seollal"],
  ["별내", "Byeollae"],
  ["물난리", "Mullalli"],
  ["대관령", "Daegwallyeong"],
  ["전라", "Jeolla"],
  ["난로", "Nallo"],
  // 비음화
  ["심리", "Simni"],
  ["강릉", "Gangneung"],
  ["종로3가", "Jongno3ga"],
  ["백마", "Baengma"],
  ["국민", "Gungmin"],
  ["입문", "Immun"],
  ["앞마당", "Ammadang"],
  ["막내", "Mangnae"],
  ["협력", "Hyeomnyeok"],
  ["독립", "Dongnip"],
  ["십리", "Simni"],
  ["대학로", "Daehangno"],
  ["식물원", "Singmurwon"],
  ["국립중앙박물관", "Gungnipjungangbangmulgwan"],
  // 겹받침 대표음·연음
  ["닭", "Dak"],
  ["흙", "Heuk"],
  ["삶", "Sam"],
  ["값", "Gap"],
  ["삯", "Sak"],
  ["넋", "Neok"],
  ["여덟", "Yeodeol"],
  ["읽다", "Ikda"],
  ["맑다", "Makda"],
  ["넓다", "Neolda"],
  ["없다", "Eopda"],
  // 음절 끝소리·연음
  ["꽃", "Kkot"],
  ["옷", "Ot"],
  ["낮", "Nat"],
  ["밖", "Bak"],
  ["부엌", "Bueok"],
  ["앞", "Ap"],
  ["해운대", "Haeundae"],
  ["강아지", "Gangaji"],
  ["놓아", "Noa"],
  ["않아", "Ana"],
  // 격음화(ㅎ 받침)·체언 ㅎ 초성
  ["좋고", "Joko"],
  ["놓다", "Nota"],
  ["싫다", "Silta"],
  ["않고", "Anko"],
  ["낳지", "Nachi"],
  ["묵호", "Mukho"],
  ["집현전", "Jiphyeonjeon"],
  ["전화", "Jeonhwa"],
  // 된소리·구개음화는 표기하지 않는다
  ["압구정", "Apgujeong"],
  ["낙동강", "Nakdonggang"],
  ["같이", "Gati"],
  ["팔당", "Paldang"],
  ["벚꽃", "Beotkkot"],
  ["떡볶이", "Tteokbokki"],
  // ㅢ·기타 모음
  ["광희문", "Gwanghuimun"],
  ["희망", "Huimang"],
  ["의정부", "Uijeongbu"],
  ["여의도", "Yeouido"],
  ["광화문", "Gwanghwamun"],
  ["경복궁", "Gyeongbokgung"],
  ["석촌호수", "Seokchonhosu"],
  ["잠실", "Jamsil"],
  ["합정", "Hapjeong"],
  ["홍대입구", "Hongdaeipgu"],
  ["을지로입구", "Euljiroipgu"],
  ["김밥천국", "Gimbapcheonguk"],
  ["롯데월드타워", "Rotdewoldeutawo"],
  ["맥도날드", "Maekdonaldeu"],
  ["길동", "Gildong"],
  ["천호", "Cheonho"],
  ["고덕", "Godeok"],
];

describe("romanize — 규칙 표", () => {
  for (const [input, expected] of CASES) {
    it(`${input} → ${expected}`, () => {
      expect(romanize(input)).toBe(expected);
    });
  }
});

describe("romanize — 어절·통과·주소 옵션", () => {
  it("어절은 공백을 유지하고 어절마다 첫 글자를 대문자로 한다", () => {
    expect(romanize("스타벅스 천호역점")).toBe("Seutabeokseu Cheonhoyeokjeom");
    expect(romanize("백년찌개집 1971")).toBe("Baengnyeonjjigaejip 1971");
  });

  it("어절 경계에서는 음운 변화를 적용하지 않는다", () => {
    // 한 어절이면 비음화(Baengni)지만 두 어절이면 각자.
    expect(romanize("백 리")).toBe("Baek Ri");
  });

  it("라틴으로 시작한 어절과 숫자·문장부호는 그대로 통과한다", () => {
    expect(romanize("GS25 천호점")).toBe("GS25 Cheonhojeom");
    expect(romanize("이마트24")).toBe("Imateu24");
    expect(romanize("102. 망원역 1번출구 앞")).toBe("102. Mangwonyeok 1beonchulgu Ap");
    expect(romanize("CU")).toBe("CU");
  });

  it("한글이 없으면 입력 그대로다(멱등)", () => {
    expect(romanize("Seoul Station 12-3")).toBe("Seoul Station 12-3");
    expect(romanize("")).toBe("");
  });

  it("주소 옵션은 행정구역·도로 단위를 붙임표로 떼고 광역 단위 접미는 뗀다", () => {
    expect(romanize("서울특별시 강동구 성내로 12", { address: true })).toBe(
      "Seoul Gangdong-gu Seongnae-ro 12",
    );
    expect(romanize("강동구 길동, 성내로", { address: true })).toBe("Gangdong-gu Gil-dong, Seongnae-ro");
    expect(romanize("올림픽대로", { address: true })).toBe("Ollimpik-daero");
    expect(romanize("종로", { address: true })).toBe("Jong-ro");
    expect(romanize("제주특별자치도 제주시", { address: true })).toBe("Jeju Jeju-si");
    expect(romanize("충청북도 삼죽면", { address: true })).toBe("Chungcheongbuk-do 삼죽면".replace("삼죽면", "Samjuk-myeon"));
  });

  it("알려진 한계(spec §3.4)는 규칙대로 낸다 — 형태소 경계 의존 변화는 적용하지 않는다", () => {
    // 신문로 [신문노]는 3음절 한자어의 ㄴ+ㄹ→ㄴㄴ 예외(의견란·생산량류)라 표기만으로 판정 불가.
    // 일반 규칙(유음화)이 적용된다 — 바뀌면 의도된 한계가 무너진 것이니 여기서 잡는다.
    expect(romanize("신문로")).toBe("Sinmullo");
    // ㄴ 첨가·구개음화 미적용.
    expect(romanize("한여름")).toBe("Hanyeoreum");
    expect(romanize("굳이")).toBe("Gudi");
  });

  it("주소 옵션은 단위 한 글자뿐인 어절과 장소명 호출에는 붙임표를 만들지 않는다", () => {
    expect(romanize("구", { address: true })).toBe("Gu");
    expect(romanize("명동교자")).toBe("Myeongdonggyoja");
  });

  it("주소 옵션: 광역시 약칭은 붙임표 없이, 숫자 길은 도로명 뒤 '-gil'로", () => {
    expect(romanize("대구 중구 동성로 1", { address: true })).toBe("Daegu Jung-gu Dongseong-ro 1");
    expect(romanize("광주 동구", { address: true })).toBe("Gwangju Dong-gu");
    expect(romanize("성내로3길 12", { address: true })).toBe("Seongnae-ro 3-gil 12");
    expect(romanize("성내로3번길", { address: true })).toBe("Seongnae-ro 3beon-gil");
    expect(romanize("강동구 성내1동, 성내로 25", { address: true })).toBe("Gangdong-gu Seongnae 1-dong, Seongnae-ro 25");
    expect(romanize("을지로3가", { address: true })).toBe("Euljiro 3-ga");
  });

  it("주소 옵션: `도`는 광역 도 허용 목록만 붙임표, 섬·지명은 그대로(여의도 → Yeouido)", () => {
    expect(romanize("서울 영등포구 여의도동", { address: true })).toBe("Seoul Yeongdeungpo-gu Yeouido-dong");
    expect(romanize("여의도", { address: true })).toBe("Yeouido");
    expect(romanize("거제도", { address: true })).toBe("Geojedo");
    expect(romanize("경기도 성남시 분당구", { address: true })).toBe("Gyeonggi-do Seongnam-si Bundang-gu");
    expect(romanize("경리단길", { address: true })).toBe("Gyeongnidan-gil");
  });
});
