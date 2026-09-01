import { describe, it, expect } from "vitest";
import { clinicKindKey } from "../clinic-kind";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";

describe("clinicKindKey — 진료 종별 i18n 키", () => {
  it("의원·병원만 키를 내고(양끝 공백 허용) 그 밖은 null", () => {
    expect(clinicKindKey("의원")).toBe("clinic");
    expect(clinicKindKey(" 병원 ")).toBe("hospital");
    expect(clinicKindKey("종합병원")).toBeNull();
    expect(clinicKindKey("보건소")).toBeNull();
    expect(clinicKindKey("")).toBeNull();
  });

  it("ko 문구는 원문과 같은 낱말이라 ko 화면이 byte-identical이고, en은 영문이다", () => {
    expect(ko.clinicNearby.kind).toEqual({ clinic: "의원", hospital: "병원" });
    expect(en.clinicNearby.kind).toEqual({ clinic: "Clinic", hospital: "Hospital" });
  });
});
