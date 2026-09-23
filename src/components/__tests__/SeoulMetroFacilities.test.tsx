// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SeoulMetroFacilities as Metro } from "@/lib/types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "ko",
}));
vi.mock("@/hooks/useAxisBridge", () => ({ useAxisSource: () => {} }));

import { SeoulMetroFacilities } from "../SeoulMetroFacilities";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const facility = (name: string) => ({
  name,
  location: undefined,
  floors: undefined,
  detail: undefined,
  operatingStatus: undefined,
});

async function open(facilities: Metro) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ facilities }) })));
  const view = render(<SeoulMetroFacilities stationName="천호" />);
  fireEvent.click(screen.getByRole("button", { name: "button" }));
  await screen.findAllByRole("listitem");
  return view;
}

describe("서울 지하철 시설 종류별 접기 (E44 판정 ②·spec §4)", () => {
  it("종류마다 details 하나이고 전부 접혀서 시작한다", async () => {
    const { container } = await open({
      stationName: "천호",
      groups: [
        { kind: "elevator", facilities: [facility("엘리베이터 1호기")] },
        { kind: "restroom", facilities: [facility("장애인 화장실")] },
      ],
    } as Metro);
    const details = Array.from(container.querySelectorAll("details"));
    expect(details).toHaveLength(2);
    expect(details.every((d) => !d.open)).toBe(true);
    // 시설 줄은 그 종류의 details 안에만 있다(접힌 동안 가려진다).
    expect(details[0].querySelectorAll("li")).toHaveLength(1);
    expect(details[0].textContent).toContain("엘리베이터 1호기");
  });

  it("보강 실패 줄은 종류 묶음 앞, 음성유도기 기준일 줄은 음성유도기 묶음의 마지막 자식", async () => {
    const { container } = await open({
      stationName: "천호",
      supplementFailed: true,
      groups: [
        { kind: "elevator", facilities: [facility("엘리베이터 1호기")] },
        { kind: "voiceGuide", facilities: [facility("음성유도기")] },
      ],
    } as Metro);
    const failed = screen.getByText("supplementFailed");
    const firstDetails = container.querySelector("details")!;
    expect(failed.compareDocumentPosition(firstDetails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const source = screen.getByText("voiceGuideSource");
    const voiceGuide = source.closest("details")!;
    expect(voiceGuide.querySelector("summary")!.textContent).toContain("kind.voiceGuide");
    expect(voiceGuide.lastElementChild).toBe(source);
  });

  it("음성유도기 묶음이 없으면 기준일 줄도 없다", async () => {
    await open({
      stationName: "천호",
      groups: [{ kind: "elevator", facilities: [facility("엘리베이터 1호기")] }],
    } as Metro);
    expect(screen.queryByText("voiceGuideSource")).toBeNull();
  });
});
