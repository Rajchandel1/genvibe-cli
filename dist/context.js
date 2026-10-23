import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const IGNORED = new Set(['node_modules', 'dist', 'build', '.git', '.gv', '.next', 'package-lock.json']);
const MAX_FILE_BYTES = 120_000;
const MAX_TOTAL_CHARS = 400_000;
async function walk(dir, base, out) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (IGNORED.has(entry.name))
            continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(base, full).replaceAll('\\', '/');
        if (entry.isDirectory()) {
            await walk(full, base, out);
            continue;
        }
        const info = await stat(full);
        if (info.size > MAX_FILE_BYTES) {
            out.push(`--- FILE: ${rel} (skipped, too large) ---`);
            continue;
        }
        try {
            const content = await readFile(full, 'utf8');
            if (content.includes('\u0000'))
                continue; // binary skip
            out.push(`--- FILE: ${rel} ---\n${content}\n`);
        }
        catch { /* unreadable skip */ }
    }
}
export async function buildProjectContext(root) {
    const parts = ['PROJECT CONTEXT (current source of truth):'];
    const files = [];
    await walk(root, root, files);
    let total = 0;
    for (const f of files) {
        if (total + f.length > MAX_TOTAL_CHARS) {
            parts.push('... (context truncated)');
            break;
        }
        parts.push(f);
        total += f.length;
    }
    return parts.join('\n');
}
