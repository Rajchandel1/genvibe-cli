import { writeFile, rm, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

export const run = (cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; output: string }> =>
  new Promise((resolve) => {
    const child = spawn([cmd, ...args].join(' '), { cwd, shell: process.platform === 'win32', env: process.env });
    let out = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    child.once('error', (e) => resolve({ ok: false, output: String(e) }));
    child.once('exit', (code) => resolve({ ok: code === 0, output: out }));
  });

/** Path escape check — patch sirf project ke andar likh sakta hai */
function assertSafePatch(code: string, root: string): void {
  if (/(resolve|join)\s*\([^)]*\.\.[\\/"']/.test(code)) {
    throw new Error('PATCH REJECTED: isme ../ se project ke bahar likhne ki koshish hai. Safety violation.');
  }
}

export async function runPatch(projectRoot: string, patchCode: string): Promise<void> {
  assertSafePatch(patchCode, projectRoot);
  const patchPath = path.join(projectRoot, '.gv-patch.ts');
  await writeFile(patchPath, patchCode, 'utf8');
  const res = await run('npx', ['tsx', '.gv-patch.ts'], projectRoot);
  await rm(patchPath, { force: true });
  if (!res.ok) throw new Error(`Patch execution failed:\n${res.output.slice(-4000)}`);
}

async function pathExists(
  p: string
): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function verify(
  projectRoot: string
): Promise<string | null> {
  const pkgPath =
    path.join(
      projectRoot,
      'package.json'
    );

  if (
    !(await pathExists(pkgPath))
  ) {
    return null;
  }

  if (
    !(await pathExists(
      path.join(
        projectRoot,
        'node_modules'
      )
    ))
  ) {
    const install =
      await run(
        'npm',
        [
          'install',
          '--ignore-scripts',
          '--package-lock=false'
        ],
        projectRoot
      );

    if (!install.ok) {
      return install.output;
    }
  }

  const build =
    await run(
      'npm',
      [
        'run',
        'build',
        '--if-present'
      ],
      projectRoot
    );

  if (!build.ok) {
    return build.output;
  }

  const test =
    await run(
      'npm',
      [
        'test',
        '--if-present'
      ],
      projectRoot
    );

  if (!test.ok) {
    return test.output;
  }

  return null;
}
