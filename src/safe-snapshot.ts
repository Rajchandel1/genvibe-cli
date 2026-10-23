import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface SnapshotEntry {
  path: string;
  existed: boolean;
  directory: boolean;
}

interface SnapshotManifest {
  version: 1;
  label: string;
  createdAt: string;
  entries: SnapshotEntry[];
}

const rootDir = (): string =>
  path.join(process.cwd(), '.gv', 'safe-backups');

function safeRel(rel: string): string {
  const normalized = path.posix.normalize(
    rel.replaceAll('\\', '/')
  );

  if (
    !normalized ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.isAbsolute(rel)
  ) {
    throw new Error(`Unsafe snapshot path: ${rel}`);
  }

  return normalized;
}

export async function takeTargetedSnapshot(
  root: string,
  label: string,
  paths: string[]
): Promise<string> {
  const id = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const dir = path.join(rootDir(), id);
  const dataDir = path.join(dir, 'data');

  await mkdir(dataDir, { recursive: true });

  const entries: SnapshotEntry[] = [];

  for (const raw of [...new Set(paths)]) {
    const rel = safeRel(raw);
    const src = path.resolve(root, rel);

    try {
      const info = await stat(src);

      entries.push({
        path: rel,
        existed: true,
        directory: info.isDirectory(),
      });

      const dst = path.join(dataDir, rel);

      await mkdir(path.dirname(dst), {
        recursive: true,
      });

      await cp(src, dst, {
        recursive: true,
        force: true,
      });
    } catch {
      entries.push({
        path: rel,
        existed: false,
        directory: false,
      });
    }
  }

  const manifest: SnapshotManifest = {
    version: 1,
    label,
    createdAt: new Date().toISOString(),
    entries,
  };

  await writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  return id;
}

async function latestSnapshotDir(): Promise<string | null> {
  try {
    const names = (
      await readdir(rootDir(), { withFileTypes: true })
    )
      .filter((x) => x.isDirectory())
      .map((x) => x.name)
      .sort()
      .reverse();

    return names.length
      ? path.join(rootDir(), names[0]!)
      : null;
  } catch {
    return null;
  }
}

export async function restoreLatestSafeSnapshot(
  root: string
): Promise<string | null> {
  const dir = await latestSnapshotDir();
  if (!dir) return null;

  try {
    const manifest = JSON.parse(
      await readFile(
        path.join(dir, 'manifest.json'),
        'utf8'
      )
    ) as SnapshotManifest;

    if (
      manifest.version !== 1 ||
      !Array.isArray(manifest.entries)
    ) {
      return null;
    }

    for (const entry of manifest.entries) {
      const rel = safeRel(entry.path);
      const target = path.resolve(root, rel);

      if (!entry.existed) {
        await rm(target, {
          recursive: true,
          force: true,
        });
        continue;
      }

      const src = path.join(dir, 'data', rel);

      await rm(target, {
        recursive: true,
        force: true,
      });

      await mkdir(path.dirname(target), {
        recursive: true,
      });

      await cp(src, target, {
        recursive: true,
        force: true,
      });
    }

    return manifest.label || path.basename(dir);
  } catch {
    return null;
  }
}
