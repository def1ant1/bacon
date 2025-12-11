// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom"],
    jsx: "transform",
  },
  {
    entry: { "cli/create-bacon-app": "src/cli/create-bacon-app.ts" },
    format: ["cjs"],
    dts: false,
    sourcemap: true,
    clean: false,
    banner: { js: "#!/usr/bin/env node" },
    platform: "node",
    target: "node20",
  },
]);
