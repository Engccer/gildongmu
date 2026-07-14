import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: { name: "gildongmu", version: "0.1.0", description: "길동무 — 접근성 우선 대한민국 길찾기 CLI" },
  subCommands: {}, // 이후 태스크에서 채운다
});

runMain(main);
