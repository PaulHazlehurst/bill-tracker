import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests for the logic that decides what people see: bill stages, text
// comparisons, the week's schedule, client reports, calendar files. They run
// on every pull request (see .github/workflows/checks.yml) and never touch
// the network or a real database.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
