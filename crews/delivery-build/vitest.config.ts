import { mergeConfig } from "vitest/config";
import { baseConfig } from "@repo/vitest-config/base";

export default mergeConfig(baseConfig, {
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
