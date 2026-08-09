// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { cleanup, render, screen } from "@testing-library/react";
import ko from "../../../messages/ko.json";
import { SurroundingsSceneView } from "../SurroundingsScene";
import type { Scene } from "@/lib/surroundings-scene";

const scene: Scene = {
  place: "서울특별시 강동구 성내1동, 성내로 25",
  frame: "entrance",
  groups: [
    {
      bucket: "left",
      items: [
        { name: "봉래면옥", distanceMeters: 62, road: "명일로", category: "restaurant" },
      ],
    },
    {
      bucket: "beyond",
      items: [
        { name: "카페만월경", distanceMeters: 58, road: null, category: "cafe" },
      ],
    },
  ],
  total: 2,
};

function renderScene(s: Scene = scene) {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <SurroundingsSceneView scene={s} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("SurroundingsSceneView", () => {
  it("묶음 제목을 heading으로 낸다 — 제목 단위 점프가 발견 경로다", () => {
    renderScene();
    expect(screen.getByRole("heading", { name: "왼쪽" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /건물 너머/ })).toBeTruthy();
  });

  it("한 항목은 한 줄로 합친다 — 거리·이름·길 이름이 조각나지 않는다", () => {
    renderScene();
    expect(screen.getByText("62m 봉래면옥, 명일로 쪽")).toBeTruthy();
  });

  it("같은 도로면 길 이름을 붙이지 않는다", () => {
    renderScene();
    expect(screen.getByText("58m 카페만월경")).toBeTruthy();
  });

  it("위치 확인 문장이 먼저 온다", () => {
    const { container } = renderScene();
    expect(container.textContent?.indexOf("성내로 25")).toBeLessThan(
      container.textContent!.indexOf("봉래면옥"),
    );
  });

  it("묶음이 4곳을 넘으면 제목에 곳수를 병기한다", () => {
    const many: Scene = {
      ...scene,
      groups: [
        {
          bucket: "right",
          items: Array.from({ length: 5 }, (_, i) => ({
            name: `가게${i}`,
            distanceMeters: 10 + i,
            road: null,
            category: "convenience",
          })),
        },
      ],
      total: 5,
    };
    renderScene(many);
    expect(screen.getByRole("heading", { name: "오른쪽 5곳" })).toBeTruthy();
  });
});
