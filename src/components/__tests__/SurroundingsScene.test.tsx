// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { cleanup, render, screen } from "@testing-library/react";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import { SurroundingsSceneView } from "../SurroundingsScene";
import type { Scene } from "@/lib/surroundings-scene";

const scene: Scene = {
  place: "서울특별시 강동구 성내1동, 성내로 25",
  frame: "entrance",
  groups: [
    {
      bucket: "left",
      items: [
        { name: "봉래면옥", id: "kakao-x", lat: 37.54, lng: 127.15, categoryRaw: "", roadAddress: null, distanceMeters: 62, road: "명일로", category: "restaurant" },
      ],
    },
    {
      bucket: "beyond",
      items: [
        { name: "카페만월경", id: "kakao-x", lat: 37.54, lng: 127.15, categoryRaw: "", roadAddress: null, distanceMeters: 58, road: null, category: "cafe" },
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
            id: `kakao-${i}`, lat: 37.54, lng: 127.15, categoryRaw: "", roadAddress: null,
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

describe("SurroundingsSceneView — 비-ko 도로명 로마자(E28 후속)", () => {
  const withRoman: Scene = {
    ...scene,
    groups: [
      {
        bucket: "left",
        items: [{ ...scene.groups[0].items[0], nameRoman: "Bongnaemyeonok", roadRoman: "Myeongil-ro" }],
      },
    ],
    total: 1,
  };

  it("en은 도로명 자리에 로마자를 쓰고 한글 도로명은 접근 텍스트에 남지 않는다", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SurroundingsSceneView scene={withRoman} />
      </NextIntlClientProvider>,
    );
    const button = screen.getByRole("button", { name: "62m Bongnaemyeonok, on Myeongil-ro" });
    // 이름의 한글 괄호는 마지막 노드(R1) — 도로명엔 괄호를 두지 않는다.
    expect(button.lastElementChild?.textContent).toBe(" (봉래면옥)");
    expect(button.textContent?.includes("명일로")).toBe(false);
  });

  it("ko는 종전 그대로다(roadRoman이 있어도 원문)", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={ko}>
        <SurroundingsSceneView scene={withRoman} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("62m 봉래면옥, 명일로 쪽")).toBeTruthy();
  });
});
