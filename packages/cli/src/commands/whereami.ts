import { defineCommand } from "citty";
import { resolveLocation, LocationError } from "../lib/resolve-location.js";
import { fail } from "../lib/output.js";
import { runEndpoint, sharedArgs } from "./shared.js";

export const whereamiCommand = defineCommand({
  meta: { name: "whereami", description: "현재 위치 정위(주소·행정동·가까운 역·기준점)" },
  args: sharedArgs,
  async run({ args }) {
    try {
      const loc = await resolveLocation(args, { required: true });
      await runEndpoint("where-am-i", { lat: String(loc!.lat), lng: String(loc!.lng) }, args.output);
    } catch (err) {
      if (err instanceof LocationError) fail(err.message, err.exitCode);
      throw err;
    }
  },
});
