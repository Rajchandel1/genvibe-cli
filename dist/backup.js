import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
const backupRoot = () => path.join(process.cwd(), '.gv', 'backups');
/** Update se pehle: poori project files ki snapshot lo (node_modules/dist/git chhod ke) */
export async function takeSnapshot(root, label) {
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotDir = path.join(backupRoot(), id);
    await mkdir(snapshotDir, { recursive: true });
    const IGNORED = new Set(['node_modules', 'dist', 'build', '.git', '.gv', '.next']);
    const MAX_FILE = 500_000;
    async function copyDir(dir, dest) {
        await mkdir(dest, { recursive: true });
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            if (IGNORED.has(e.name))
                continue;
            const src = path.join(dir, e.name);
            const dst = path.join(dest, e.name);
            if (e.isDirectory())
                await copyDir(src, dst);
            else {
                const info = await stat(src);
                if (info.size > MAX_FILE)
                    continue;
                const content = await readFile(src).catch(() => null);
                if (content && !content.includes(0))
                    await writeFile(dst, content);
            }
        }
    }
    await copyDir(root, snapshotDir);
    await writeFile(path.join(snapshotDir, '.meta'), label, 'utf8');
    return id;
}
/** Undo: latest snapshot wapas lao */
export async function restoreLatest(root) {
    const base = backupRoot();
    try {
        const snaps = (await readdir(base)).sort().reverse();
        if (!snaps.length)
            return null;
        const latest = snaps[0];
        const snapDir = path.join(base, latest);
        const label = await readFile(path.join(snapDir, '.meta'), 'utf8').catch(() => '');
        // Current project files hatao (except .gv aur backups)
        const entries = await readdir(root, { withFileTypes: true });
        for (const e of entries) {
            if (e.name === '.gv')
                continue;
            await rm(path.join(root, e.name), { recursive: true, force: true });
        }
        // Snapshot wapas copy karo
        const snapEntries = await readdir(snapDir, { withFileTypes: true });
        for (const e of snapEntries) {
            if (e.name === '.meta')
                continue;
            await rm(path.join(root, e.name), { recursive: true, force: true }).catch(() => undefined);
            const { cp } = await import('node:fs/promises');
            await cp(path.join(snapDir, e.name), path.join(root, e.name), { recursive: true });
        }
        return label || latest;
    }
    catch {
        return null;
    }
}
export async function diffSnapshot(root) {
    const base = backupRoot();
    try {
        const snaps = (await readdir(base)).sort().reverse();
        if (!snaps.length)
            return null;
        const snapDir = path.join(base, snaps[0]);
        const IGNORED = new Set(['node_modules', 'dist', 'build', '.git', '.gv', '.next', '.meta']);
        async function collect(dir, out) {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const e of entries) {
                if (IGNORED.has(e.name))
                    continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory())
                    await collect(full, out);
                else
                    out.set(path.relative(snapDir, full).replaceAll('\\', '/'), await readFile(full, 'utf8').catch(() => ''));
            }
        }
        const before = new Map();
        await collect(snapDir, before);
        const after = new Map();
        await collect(root, after);
        const changed = [];
        let addedLines = 0, removedLines = 0;
        const keys = new Set([...before.keys(), ...after.keys()]);
        for (const k of keys) {
            const b = before.get(k), a = after.get(k);
            if (b === a)
                continue;
            if (b === undefined) {
                changed.push(k + ' (new)');
                addedLines += (a ?? '').split('\n').length;
                continue;
            }
            if (a === undefined) {
                changed.push(k + ' (deleted)');
                removedLines += b.split('\n').length;
                continue;
            }
            changed.push(k);
            const bLines = new Set(b.split('\n'));
            for (const l of a.split('\n'))
                if (!bLines.has(l))
                    addedLines++;
            const aLines = new Set(a.split('\n'));
            for (const l of b.split('\n'))
                if (!aLines.has(l))
                    removedLines++;
        }
        return { changed, addedLines, removedLines };
    }
    catch {
        return null;
    }
}
