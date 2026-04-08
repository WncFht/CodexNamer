import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

function hasGitMetadata() {
  if (!existsSync(".git")) {
    return false;
  }

  try {
    const stat = statSync(".git");
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

if (!hasGitMetadata()) {
  console.log("[lefthook] Skipping hook install because no .git metadata was found in this workspace.");
  process.exit(0);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, ["lefthook", "install"], {
  stdio: "inherit"
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
