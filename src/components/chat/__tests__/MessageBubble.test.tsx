// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => "ko",
}));

import { MessageBubble } from "../MessageBubble";
import type { Place } from "@/lib/types";

/** 최소 Place fixture */
const placeFixture: Place = {
  id: "p1",
  name: "길동 카페",
  category: "카페",
  address: "강동구 길동",
  roadAddress: "강동구 길동로 1",
  lat: 37.5,
  lng: 127.1,
};

describe("MessageBubble", () => {
  it("사용자 메시지 텍스트 표시", () => {
    render(<MessageBubble message={{ id: "1", role: "user", text: "안녕" }} />);
    expect(screen.getByText("안녕")).toBeTruthy();
  });

  it("assistant 산문 표시", () => {
    render(
      <MessageBubble message={{ id: "2", role: "assistant", text: "찾았어요" }} />
    );
    expect(screen.getByText("찾았어요")).toBeTruthy();
  });

  it("places render면 장소명 노출", () => {
    render(
      <MessageBubble
        message={{
          id: "3",
          role: "assistant",
          text: "결과",
          render: { type: "places", places: [placeFixture] },
        }}
      />
    );
    expect(screen.getByText(/길동 카페/)).toBeTruthy();
  });
});
