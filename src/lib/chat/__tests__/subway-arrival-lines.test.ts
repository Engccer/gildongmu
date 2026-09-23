// A42 — 채팅 LLM이 받는 지하철 도착 줄은 카드와 같은 우리 문장(E37)이고 원문·원재료 필드는 싣지 않는다.
import { describe, it, expect } from "vitest";
import { chatArrivalLines } from "../subway-arrival-lines";
import type { SubwayArrival } from "@/lib/types";

const BASE: SubwayArrival = {
  line: "1호선",
  direction: "상행",
  trainLineNm: "청량리행 - 신도림방면",
  destination: "청량리",
  message: "[8]번째 전역 (구로)",
  currentLocation: "구로",
  arrivalSeconds: 1200,
  express: false,
  trainNo: "0123",
  arrivalCode: "99",
};

describe("chatArrivalLines (A42)", () => {
  it("ko: 알아본 문장은 우리 문장이고 원문 표기는 없다", () => {
    const [row] = chatArrivalLines([BASE], "ko");
    expect(row.message).toBe("8정거장 전 구로.");
    expect(row.message).not.toContain("번째 전역");
    expect(row.line).toBe("1호선 상행, 청량리행 - 신도림방면");
  });

  it("원재료 필드(원문·초·코드·현재역·열차 번호)는 싣지 않는다 — 두 줄뿐", () => {
    const [row] = chatArrivalLines([BASE], "ko");
    expect(Object.keys(row).sort()).toEqual(["line", "message"]);
  });

  it("못 알아본 문장은 E37 규칙대로 원문(+A32 현재역 꼬리)", () => {
    const [row] = chatArrivalLines([{ ...BASE, message: "운행 지연 중", currentLocation: "구로" }], "ko");
    expect(row.message).toBe("운행 지연 중, 현재 구로");
  });

  it("en: 영문 역명이 있으면 영문 문장", () => {
    const [row] = chatArrivalLines([{ ...BASE, currentLocationEn: "Guro" }], "en");
    expect(row.message).toBe("8 stops away, at Guro.");
  });

  it("en: 영문 역명이 없으면 문장형을 포기하고 원문 줄(한국어)로 — 한 줄 안에서 언어를 섞지 않는다", () => {
    const [row] = chatArrivalLines([BASE], "en");
    expect(row.message).toContain("[8]번째 전역 (구로)");
  });
});
