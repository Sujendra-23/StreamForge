import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
mkdirSync("bin", { recursive: true });
const build = spawnSync(
  "go",
  ["build", "-o", "bin/streamforge", "./cmd/streamforge"],
  { stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const children = [
  spawn("./bin/streamforge", [], { stdio: "inherit" }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit" }),
];
let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
for (const child of children) {
  child.on("error", (error) => {
    console.error(error);
    shutdown(1);
  });
  child.on("exit", (code) => shutdown(code ?? 0));
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
