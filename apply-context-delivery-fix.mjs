
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RUNNER = path.join(ROOT, "src", "runner.ts");

const FIX_MARKER = "GENVIBE_WINDOWS_SPAWN_FIX_V1";

function log(message) {
  console.log("[GenVibe Rollback] " + message);
}

function main() {
  if (!fs.existsSync(RUNNER)) {
    console.error("ERROR: src/runner.ts not found.");
    process.exitCode = 1;
    return;
  }

  const current = fs.readFileSync(RUNNER, "utf8");

  if (!current.includes(FIX_MARKER)) {
    log("My spawn fix is not installed.");
    log("Nothing changed.");
    return;
  }

  const dir = path.dirname(RUNNER);
  const name = path.basename(RUNNER);

  // Find backups created by my previous patch.
  const backups = fs.readdirSync(dir)
    .filter(file =>
      file.startsWith(name + ".backup-")
    )
    .sort()
    .reverse();

  // Prefer the exact original backup.
  if (backups.length > 0) {
    const backupPath = path.join(dir, backups[0]);
    const original = fs.readFileSync(
      backupPath,
      "utf8"
    );

    if (!original.includes(FIX_MARKER)) {
      fs.copyFileSync(backupPath, RUNNER);
      log("Original runner.ts restored from backup.");
      log("Backup: " + backupPath);
      return;
    }
  }

  // Fallback: restore only the original run() function.
  const startMarker = "// " + FIX_MARKER;
  const endMarker = "/** Path escape check";

  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker, start);

  if (start === -1 || end === -1 || end <= start) {
    console.error(
      "ERROR: Cannot safely locate patched code."
    );
    process.exitCode = 1;
    return;
  }

  const originalRun = `export const run = (
  cmd: string,
  args: string[],
  cwd: string
): Promise<{
  ok: boolean;
  output: string;
}> =>
  new Promise((resolve) => {
    const executable =
      process.platform === 'win32' &&
      (
        cmd === 'npm' ||
        cmd === 'npx'
      )
        ? cmd + '.cmd'
        : cmd;

    const child = spawn(
      executable,
      args,
      {
        cwd,
        shell: false,
        env: process.env,
        windowsHide: true,
      }
    );

    let out = '';

    child.stdout?.on('data', (d) => {
      out += d;
    });

    child.stderr?.on('data', (d) => {
      out += d;
    });

    child.once('error', (e) =>
      resolve({
        ok: false,
        output: String(e),
      })
    );

    child.once('exit', (code) =>
      resolve({
        ok: code === 0,
        output: out,
      })
    );
  });

`;

  const restored =
    current.slice(0, start) +
    originalRun +
    current.slice(end);

  fs.writeFileSync(RUNNER, restored, "utf8");

  log("Original spawn implementation restored.");
  log("Rollback completed successfully.");
}

main();
