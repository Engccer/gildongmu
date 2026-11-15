import type { Scene, SceneItem } from "@/lib/surroundings-scene";
import type { SurroundingBucket } from "@/lib/geo/road-axis";
import { normalizeName } from "@/lib/providers/tour-barrier-free";

/**
 * 채팅 도구 `get_entrance_sides`가 모델에 주는 재료(E88 spec ⓒ). 장소 상세 「주변 확인」과 같은 조립(`assembleScene`)을
 * 산문 재료로 줄인다. 좌표·전화번호·링크·id는 싣지 않는다(산문이 정본이고 카드가 없다).
 *
 * 세 상태를 다른 모양으로 가른다: 축이 섬(`frame: "entrance"` + 묶음), 축이 안 섬(`sidesUnavailable` — 좌우를 말하지 않는다),
 * 0건(`total: 0`). 조회 실패는 호출부에서 throw다.
 *
 * 그 장소 자신은 뺀다(`selfNames`와 이름이 같은 곳): 조립은 반경 안의 등록 장소를 다 담아 기준 장소도 0m로 들어온다.
 * 화면 「주변 확인」은 빼지 않지만, 산문에서 「경복궁 입구 오른쪽에 경복궁」은 정보가 아니라 혼란이다(실호출 2026-11-14).
 */

/** 묶음마다 싣는 가까운 곳 수. 묶음의 전체 수는 `count`로 함께 준다. */
export const SIDE_ITEMS_CAP = 8;

const SIDE_LABEL: Record<SurroundingBucket, string> = {
  left: "왼쪽",
  right: "오른쪽",
  across: "맞은편",
  beyond: "건물 너머",
};

const BASIS =
  "입구를 마주 보고 섰을 때 기준입니다. 왼쪽·오른쪽은 입구를 바라보는 사람의 왼손·오른손 쪽, 맞은편은 길 건너, 건물 너머는 건물 뒤쪽(돌아가야 하는 곳)입니다.";

const SIDES_UNAVAILABLE =
  "이 장소는 입구가 어느 도로를 향하는지 정하지 못해 왼쪽·오른쪽을 말할 수 없습니다. 방위(북쪽·동쪽 등)로 주변을 알려면 get_surroundings를 쓰세요.";

const EMPTY = "150m 안에 등록된 가게나 시설이 없습니다.";

function sideItem(i: SceneItem) {
  return {
    name: i.name,
    ...(i.nameRoman ? { nameRoman: i.nameRoman } : {}),
    category: i.category,
    distanceMeters: i.distanceMeters,
    // 입구와 다른 도로에 붙은 곳만 도로명이 온다(같은 도로면 잉여).
    ...(i.road ? { road: i.road } : {}),
  };
}

export function entranceSidesData(
  scene: Scene,
  searchedPlace: string,
  selfNames: readonly string[],
): Record<string, unknown> {
  const self = new Set(selfNames.map(normalizeName));
  const groups = scene.groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !self.has(normalizeName(i.name))) }))
    .filter((g) => g.items.length > 0);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const head = { searchedPlace, ...(scene.place ? { address: scene.place } : {}) };
  if (total === 0) return { ...head, total: 0, notice: EMPTY };
  if (scene.frame !== "entrance") {
    return { ...head, frame: "compass", sidesUnavailable: true, total, notice: SIDES_UNAVAILABLE };
  }
  return {
    ...head,
    frame: "entrance",
    basis: BASIS,
    total,
    sides: groups.map((g) => ({
      side: SIDE_LABEL[g.bucket as SurroundingBucket],
      count: g.items.length,
      places: g.items.slice(0, SIDE_ITEMS_CAP).map(sideItem),
    })),
  };
}
