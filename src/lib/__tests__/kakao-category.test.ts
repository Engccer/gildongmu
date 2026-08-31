import { describe, expect, it } from "vitest";
import dictionary from "@/lib/data/kakao-category-en.json";
import {
  categoryEnField,
  kakaoCategoryEn,
  pickCategory,
  splitKakaoCategory,
} from "@/lib/kakao-category";
import { hasHangul } from "@/lib/format";
import pickCases from "./fixtures/kakao-category-pick-cases.json";

// 실호출 코퍼스에서 뽑은 경로 표본(장소명·좌표 없음) — 사전 회귀 가드: 전부 영문이어야 한다.
const REAL_PATHS: Array<[string, string]> = [
  ["교육,학문 > 학교 > 중학교", "Education & Academia > School > Middle School"],
  ["음식점 > 한식 > 육류,고기 > 갈비", "Restaurants > Korean > Meat > Galbi"],
  ["음식점 > 카페 > 커피전문점 > 스타벅스", "Restaurants > Cafe > Coffee Shop > Starbucks"],
  ["교통,수송 > 지하철,전철 > 수도권5호선", "Transportation > Subway > Line 5"],
  ["의료,건강 > 병원 > 치과", "Health & Medical > Hospital > Dental Clinic"],
  ["가정,생활 > 편의점 > CU", "Home & Living > Convenience Store > CU"],
  ["문화,예술 > 문화시설 > 도서관", "Culture & Arts > Cultural Facility > Library"],
  ["여행 > 공원 > 도시근린공원", "Travel > Park > Neighborhood Park"],
  ["교통,수송 > 입출구", "Transportation > Entrance / Exit"],
  ["가정,생활 > 슈퍼마켓 > 대형슈퍼 > 하나로마트", "Home & Living > Supermarket > Large Supermarket > Hanaro Mart"],
  ["가정,생활 > 반려동물 > 동물병원", "Home & Living > Pets > Veterinary Clinic"],
  ["가정,생활 > 유아 > 놀이시설 > 키즈카페", "Home & Living > Kids > Play Facility > Kids Cafe"],
  ["교육,학문 > 유아교육 > 어린이집", "Education & Academia > Early Childhood Education > Daycare Center"],
  ["교육,학문 > 학원 > 어학원 > 영어학원", "Education & Academia > Academy > Language Academy > English Academy"],
  ["교통,수송 > 교통시설 > 주차장 > 공영주차장", "Transportation > Transit Facility > Parking Lot > Public Parking Lot"],
  ["교통,수송 > 자동차 > 주유,가스 > 주유소 > SK주유소", "Transportation > Automotive > Fuel & Gas > Gas Station > SK Gas Station"],
  ["교통,수송 > 지하철,전철 > 공항철도", "Transportation > Subway > AREX"],
  ["금융,보험 > 금융서비스 > 은행 > 새마을금고", "Finance & Insurance > Financial Services > Bank > MG Saemaul Geumgo"],
  ["문화,예술 > 종교 > 불교 > 절,사찰", "Culture & Arts > Religion > Buddhism > Buddhist Temple"],
  ["문화,예술 > 영화,영상 > 영화관 > CGV", "Culture & Arts > Film & Video > Movie Theater > CGV"],
  ["부동산 > 부동산서비스 > 부동산중개업", "Real Estate > Real Estate Services > Real Estate Agency"],
  ["사회,공공기관 > 지방행정기관 > 행정복지센터 > 동행정복지센터", "Public Institutions > Local Government > Community Service Center > Dong Community Service Center"],
  ["사회,공공기관 > 행정기관 > 소방서 > 119안전센터", "Public Institutions > Government Agency > Fire Station > 119 Safety Center"],
  ["서비스,산업 > 전문대행 > 공간대여 > 공유오피스", "Services & Industry > Professional Services > Space Rental > Coworking Space"],
  ["스포츠,레저 > 골프 > 골프연습장 > 스크린골프연습장 > 골프존파크", "Sports & Leisure > Golf > Driving Range > Screen Golf > Golfzon Park"],
  ["스포츠,레저 > 요가,필라테스 > 필라테스", "Sports & Leisure > Yoga & Pilates > Pilates"],
  ["여행 > 숙박 > 여관,모텔", "Travel > Lodging > Motel"],
  ["여행 > 관광,명소 > 해수욕장,해변", "Travel > Tourism & Attractions > Beach"],
  ["음식점 > 한식 > 해물,생선 > 회", "Restaurants > Korean > Seafood > Sashimi (Hoe)"],
  ["음식점 > 술집 > 호프,요리주점", "Restaurants > Bar > Pub"],
  ["음식점 > 패스트푸드 > 맥도날드", "Restaurants > Fast Food > McDonald's"],
  ["의료,건강 > 약국", "Health & Medical > Pharmacy"],
  ["의료,건강 > 병원 > 산부인과", "Health & Medical > Hospital > Obstetrics & Gynecology"],
  ["의료,건강 > 보건소 > 보건지소", "Health & Medical > Public Health Center > Public Health Sub-center"],
];

describe("kakaoCategoryEn — 전부-아니면-원문", () => {
  it("세그먼트 전부 등재면 ' > '로 결합한 영문 경로", () => {
    for (const [ko, en] of REAL_PATHS) expect(kakaoCategoryEn(ko), ko).toBe(en);
  });

  it("세그먼트 하나라도 미등재면 null(부분 번역 혼합 금지)", () => {
    expect(kakaoCategoryEn("교육,학문 > 학교 > 존재하지않는세그먼트")).toBeNull();
    expect(kakaoCategoryEn("없는최상위 > 학교")).toBeNull();
  });

  it("빈 경로·공백·구분자만은 null", () => {
    expect(kakaoCategoryEn("")).toBeNull();
    expect(kakaoCategoryEn("   ")).toBeNull();
    expect(kakaoCategoryEn(" > ")).toBeNull();
  });

  it("빈 세그먼트·선행/후행 구분자·제어 문자는 조각을 버리지 않고 통째로 null(fail-closed, 리뷰 #13)", () => {
    expect(kakaoCategoryEn("교육,학문 >  > 중학교")).toBeNull();
    expect(kakaoCategoryEn("> 교육,학문 > 학교")).toBeNull();
    expect(kakaoCategoryEn("교육,학문 > 학교 >")).toBeNull();
    expect(kakaoCategoryEn("교육,학문 > 학교\u0000")).toBeNull();
    expect(splitKakaoCategory("a >  > b")).toEqual([]);
  });

  it("'>' 주변 공백 변형·NFD 입력은 같은 경로", () => {
    expect(kakaoCategoryEn("교육,학문>학교>중학교")).toBe("Education & Academia > School > Middle School");
    expect(kakaoCategoryEn("교육,학문 > 학교 > 중학교".normalize("NFD"))).toBe(
      "Education & Academia > School > Middle School",
    );
    expect(splitKakaoCategory("a >  b>c ")).toEqual(["a", "b", "c"]);
  });

  it("쉼표 병렬 세그먼트는 키 그대로(쉼표로 쪼개지 않는다)", () => {
    expect(splitKakaoCategory("교육,학문 > 학교")).toEqual(["교육,학문", "학교"]);
  });

  it("categoryEnField는 있을 때만 키를 싣는다(undefined 키 금지)", () => {
    expect(categoryEnField("교육,학문 > 학교 > 중학교")).toEqual({
      categoryEn: "Education & Academia > School > Middle School",
    });
    expect(categoryEnField("없는최상위")).toEqual({});
    expect("categoryEn" in categoryEnField("없는최상위")).toBe(false);
  });
});

describe("사전 무결성", () => {
  const entries = Object.entries(dictionary as Record<string, string>);

  it("비어 있지 않고 코퍼스 실측 최상위 13종이 전부 등재", () => {
    expect(entries.length).toBeGreaterThan(500);
    for (const top of [
      "가정,생활", "교육,학문", "교통,수송", "금융,보험", "문화,예술", "부동산", "사회,공공기관",
      "서비스,산업", "스포츠,레저", "언론,미디어", "여행", "음식점", "의료,건강",
    ]) {
      expect(dictionary, top).toHaveProperty(top);
    }
  });

  it("값에 한글 0·빈 값 0, 키에 '>' 0·양끝 공백 0", () => {
    for (const [ko, en] of entries) {
      expect(hasHangul(en), `${ko} → ${en}`).toBe(false);
      expect(en.trim().length, ko).toBeGreaterThan(0);
      expect(en, ko).toBe(en.trim());
      expect(ko.includes(">"), ko).toBe(false);
      expect(ko, ko).toBe(ko.trim());
      expect(ko, ko).toBe(ko.normalize("NFC"));
    }
  });

  it("키가 코드포인트 순으로 정렬돼 있다(diff 안정성 — 생성 스크립트와 같은 순서)", () => {
    const keys = entries.map(([k]) => k);
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});

describe("pickCategory — 공유 fixture", () => {
  for (const c of pickCases.cases) {
    it(c.id, () => {
      expect(pickCategory(c.locale, { category: c.category, categoryEn: c.categoryEn })).toBe(c.expected);
    });
  }
});
