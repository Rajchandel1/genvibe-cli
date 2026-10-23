// GENVIBE_FULL_CONTEXT_SHARING_V2
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const IGNORED = new Set([
    'node_modules',
    'dist',
    'build',
    '.git',
    '.gv',
    '.next',
    'coverage',
    '.cache',
]);
const IGNORED_FILE = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[^/]+\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp[34]|mov|avi|exe|dll|so|dylib))$/i;
const SENSITIVE_FILE = /(?:^|\/)(?:\.env(?:\..*)?|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|[^/]*private[^/]*key[^/]*|id_rsa|id_ed25519|[^/]+\.(?:pem|key|p12|pfx))$/i;
const MAX_TEXT_FILE_BYTES = 700_000;
const SMALL_PROJECT_MAX_FILES = 25;
const SMALL_PROJECT_MAX_BYTES = 100_000;
const MAX_SELECTED_FILES = 12;
const MAX_INDEX_PATHS = 1_200;
const DEFAULT_CONTEXT_LIMIT_BYTES = 250_000;
const STOP = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'only', 'just', 'same',
    'code', 'file', 'files', 'make', 'change', 'update', 'fix', 'add', 'remove', 'dont',
    'don', 'should', 'want', 'please', 'mera', 'meri', 'mujhe', 'isko', 'isme', 'karna',
    'karo', 'krna', 'hai', 'hoga', 'wala', 'wali', 'thoda', 'thodi', 'existing',
    'complete', 'content', 'full', 'source', 'current', 'show', 'provide', 'need',
]);
const VISUAL_REQUEST = /\b(css|style|styling|layout|responsive|theme|ui|design|visual|mobile|desktop|colou?r|background|white|black|dark|light|red|blue|green|yellow|orange|purple|pink|gr[ae]y|gradient|font|border|shadow|rounded|radius|spacing|padding|margin|opacity|width|height|align|gap|header|footer|card|hero)\b/i;
const STYLE_FILE = /\.(?:css|scss|sass|less|styl)$/i;
const MARKUP_FILE = /\.(?:html?|jsx|tsx|vue|svelte)$/i;
function contextLimitBytes() {
    const raw = Number(process.env.GENVIBE_CONTEXT_LIMIT ?? '');
    return Number.isFinite(raw) && raw >= 32_000
        ? Math.floor(raw)
        : DEFAULT_CONTEXT_LIMIT_BYTES;
}
function hashText(text) {
    return createHash('sha256').update(text).digest('hex');
}
function normalizeRel(value) {
    return value
        .trim()
        .replace(/^['"\`]+|['"\`]+$/g, '')
        .replace(/^file\s*:\s*/i, '')
        .replaceAll('\\\\', '/')
        .replace(/^\.\//, '')
        .trim();
}
function terms(input) {
    return [
        ...new Set(input
            .toLowerCase()
            .match(/[a-z0-9_$./-]{2,}/g) ?? []),
    ]
        .filter((x) => !STOP.has(x))
        .slice(0, 80);
}
async function walk(dir, root, out) {
    const entries = await readdir(dir, {
        withFileTypes: true,
    });
    for (const entry of entries) {
        if (IGNORED.has(entry.name)) {
            continue;
        }
        const abs = path.join(dir, entry.name);
        const rel = path
            .relative(root, abs)
            .replaceAll('\\\\', '/');
        if (entry.isDirectory()) {
            await walk(abs, root, out);
            continue;
        }
        if (IGNORED_FILE.test(rel) ||
            SENSITIVE_FILE.test(rel)) {
            continue;
        }
        const info = await stat(abs);
        out.push({
            rel,
            abs,
            size: info.size,
            ext: path.extname(entry.name).toLowerCase(),
        });
    }
}
async function readTextFile(file) {
    if (file.size > MAX_TEXT_FILE_BYTES) {
        return null;
    }
    try {
        const buf = await readFile(file.abs);
        if (buf.includes(0)) {
            return null;
        }
        return buf.toString('utf8');
    }
    catch {
        return null;
    }
}
function scoreText(rel, content, queryTerms) {
    const p = rel.toLowerCase();
    const c = content.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
        if (p === term) {
            score += 100;
        }
        else if (p.endsWith('/' + term) ||
            p.includes(term)) {
            score += 30;
        }
        const first = c.indexOf(term);
        if (first >= 0) {
            score += 5;
            let at = first + term.length;
            let repeats = 0;
            while (repeats < 8 &&
                (at = c.indexOf(term, at)) >= 0) {
                score += 1;
                repeats += 1;
                at += term.length;
            }
        }
    }
    return score;
}
function queryContainsRepositoryPath(query, rel) {
    const q = query
        .toLowerCase()
        .replaceAll('\\\\', '/');
    const r = rel
        .toLowerCase()
        .replaceAll('\\\\', '/');
    let from = 0;
    while (from <= q.length) {
        const at = q.indexOf(r, from);
        if (at < 0) {
            return false;
        }
        const before = at === 0
            ? ''
            : q[at - 1] ?? '';
        const end = at + r.length;
        const after = end >= q.length
            ? ''
            : q[end] ?? '';
        const beforeOk = at === 0 ||
            /[\s'"\`([{=:]/.test(before);
        const afterOk = end === q.length ||
            /[\s'"\`\])}:,;.!?]/.test(after);
        if (beforeOk && afterOk) {
            return true;
        }
        from = at + 1;
    }
    return false;
}
function findExactRequestedFiles(queries, all) {
    const found = new Set();
    for (const raw of queries) {
        const normalized = normalizeRel(raw);
        if (!normalized) {
            continue;
        }
        if (all.has(normalized)) {
            found.add(normalized);
            continue;
        }
        for (const rel of all.keys()) {
            if (normalized === rel ||
                normalized.endsWith('/' + rel) ||
                queryContainsRepositoryPath(raw, rel)) {
                found.add(rel);
            }
        }
    }
    return [...found];
}
function importSpecs(content) {
    const out = new Set();
    const re = /(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(re)) {
        if (match[1]) {
            out.add(match[1]);
        }
    }
    return [...out];
}
function resolveRelativeImport(fromFile, spec, byRel) {
    if (!spec.startsWith('.')) {
        return null;
    }
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
    const candidates = [
        base,
        base + '.ts',
        base + '.tsx',
        base + '.js',
        base + '.jsx',
        base + '.mjs',
        base + '.cjs',
        base + '.json',
        path.posix.join(base, 'index.ts'),
        path.posix.join(base, 'index.tsx'),
        path.posix.join(base, 'index.js'),
        path.posix.join(base, 'index.jsx'),
    ];
    for (const candidate of candidates) {
        if (byRel.has(candidate)) {
            return candidate;
        }
    }
    return null;
}
function companionRank(candidate, selected, kind) {
    const normalized = candidate.replaceAll('\\\\', '/');
    const directory = path.posix.dirname(normalized);
    const stem = path.posix
        .basename(normalized)
        .replace(/\.[^.]+$/, '')
        .replace(/\.module$/i, '');
    let score = kind === 'style' &&
        /^(?:styles?|globals?|app|main|index)$/i.test(stem)
        ? 6
        : 0;
    if (kind === 'markup' &&
        /^(?:index|app|page|layout)$/i.test(stem)) {
        score += 4;
    }
    for (const selectedFile of selected) {
        const selectedNormalized = selectedFile.replaceAll('\\\\', '/');
        const selectedDirectory = path.posix.dirname(selectedNormalized);
        const selectedStem = path.posix
            .basename(selectedNormalized)
            .replace(/\.[^.]+$/, '')
            .replace(/\.module$/i, '');
        if (stem.toLowerCase() ===
            selectedStem.toLowerCase()) {
            score += 8;
        }
        if (directory === selectedDirectory) {
            score += 5;
        }
        if (normalized.split('/')[0] ===
            selectedNormalized.split('/')[0]) {
            score += 1;
        }
    }
    return score;
}
function addVisualCompanions(request, selected, allFiles) {
    if (!VISUAL_REQUEST.test(request)) {
        return selected;
    }
    const output = [...selected];
    const hasStyle = output.some((file) => STYLE_FILE.test(file));
    const hasMarkup = output.some((file) => MARKUP_FILE.test(file));
    const ranked = (matcher, kind) => allFiles
        .filter((file) => matcher.test(file) &&
        !output.includes(file))
        .sort((left, right) => companionRank(right, output, kind) -
        companionRank(left, output, kind));
    if (!hasStyle) {
        for (const file of ranked(STYLE_FILE, 'style').slice(0, 2)) {
            if (!output.includes(file)) {
                output.push(file);
            }
        }
    }
    if (!hasMarkup) {
        for (const file of ranked(MARKUP_FILE, 'markup').slice(0, 2)) {
            if (!output.includes(file)) {
                output.push(file);
            }
        }
    }
    return output;
}
function renderIndex(files) {
    const shown = files
        .map((file) => file.rel)
        .sort()
        .slice(0, MAX_INDEX_PATHS);
    return (`FILE INDEX (${shown.length}/${files.length} shown):\n` +
        shown.join('\n'));
}
function fullFileBlock(item) {
    return (`--- EXACT FULL FILE: ${item.file.rel}\n` +
        `SHA256: ${hashText(item.content)}\n` +
        `SIZE: ${item.file.size}\n` +
        `DELIVERY: COMPLETE FILE, VERBATIM CURRENT SOURCE\n` +
        `---\n` +
        item.content +
        `\n--- END EXACT FULL FILE: ${item.file.rel} ---`);
}
function projectMapHeader(allFiles, mode) {
    const topDirs = new Map();
    for (const file of allFiles) {
        const top = file.rel.includes('/')
            ? file.rel.split('/')[0]
            : '(root)';
        topDirs.set(top, (topDirs.get(top) ?? 0) + 1);
    }
    return [
        'SMART PROJECT MAP + COMPLETE SOURCE CONTEXT — current source of truth',
        mode,
        `Repository files: ${allFiles.length}`,
        'Top-level distribution: ' +
            [...topDirs.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([key, count]) => `${key}:${count}`)
                .join(', '),
        renderIndex(allFiles),
    ];
}
async function loadFiles(files, queryTerms) {
    const loaded = [];
    for (const file of files) {
        const content = await readTextFile(file);
        if (content == null) {
            continue;
        }
        loaded.push({
            file,
            content,
            score: scoreText(file.rel, content, queryTerms),
        });
    }
    return loaded;
}
export async function buildSmartProjectContext(root, request, extraQueries = []) {
    const allFiles = [];
    await walk(root, root, allFiles);
    const byRel = new Map(allFiles.map((file) => [file.rel, file]));
    const warnings = [];
    const queryTerms = terms([request, ...extraQueries].join(' '));
    const loaded = await loadFiles(allFiles, queryTerms);
    const totalReadableBytes = loaded.reduce((sum, item) => sum +
        Buffer.byteLength(item.content, 'utf8'), 0);
    const smallProject = loaded.length <=
        SMALL_PROJECT_MAX_FILES &&
        totalReadableBytes <=
            SMALL_PROJECT_MAX_BYTES;
    const exactRequested = findExactRequestedFiles(extraQueries, byRel);
    const expanded = extraQueries.length > 0;
    let selectedPaths = [];
    if (smallProject) {
        selectedPaths =
            loaded.map((item) => item.file.rel);
    }
    else if (exactRequested.length) {
        selectedPaths =
            exactRequested.slice(0, MAX_SELECTED_FILES);
    }
    else if (expanded) {
        selectedPaths =
            loaded
                .filter((item) => item.score > 0)
                .sort((a, b) => b.score - a.score ||
                a.file.rel.localeCompare(b.file.rel))
                .slice(0, MAX_SELECTED_FILES)
                .map((item) => item.file.rel);
    }
    if (!smallProject &&
        !expanded) {
        const sections = projectMapHeader(allFiles, 'MODE: PROJECT MAP DISCOVERY. Source bodies are intentionally not sent yet because this is a larger project. Choose the smallest sufficient set of EXISTING files and return a context_request whose queries contain exact repository file paths. Prefer no more than 12 files. For UI work include both markup/component files and their styling files. Do not guess source code.');
        return {
            context: sections.join('\n\n'),
            relevantFiles: [],
            totalFiles: allFiles.length,
            warnings,
        };
    }
    selectedPaths =
        addVisualCompanions(request, selectedPaths, allFiles.map((file) => file.rel)).slice(0, MAX_SELECTED_FILES);
    const selectedSet = new Set(selectedPaths);
    for (const selected of [...selectedPaths]) {
        if (selectedSet.size >=
            MAX_SELECTED_FILES) {
            break;
        }
        const item = loaded.find((entry) => entry.file.rel === selected);
        if (!item) {
            continue;
        }
        for (const spec of importSpecs(item.content)) {
            const resolved = resolveRelativeImport(selected, spec, byRel);
            if (!resolved ||
                selectedSet.has(resolved)) {
                continue;
            }
            selectedSet.add(resolved);
            if (selectedSet.size >=
                MAX_SELECTED_FILES) {
                break;
            }
        }
    }
    selectedPaths =
        [...selectedSet];
    const loadedByRel = new Map(loaded.map((item) => [item.file.rel, item]));
    const sections = projectMapHeader(allFiles, smallProject
        ? 'MODE: SMALL PROJECT COMPLETE CONTEXT. Every safe readable source file below is COMPLETE VERBATIM CURRENT SOURCE. Do not request these files again.'
        : 'MODE: TARGETED COMPLETE CONTEXT. Every supplied file below is COMPLETE VERBATIM CURRENT SOURCE. Do not request the same delivered file again. If another dependency is genuinely required, return context_request with its exact repository path.');
    const relevantFiles = [];
    let usedBytes = Buffer.byteLength(sections.join('\n\n'), 'utf8');
    const limit = contextLimitBytes();
    for (const rel of selectedPaths) {
        const item = loadedByRel.get(rel);
        if (!item) {
            warnings.push(`Selected file ${rel} could not be read as safe text.`);
            continue;
        }
        const block = fullFileBlock(item);
        const bytes = Buffer.byteLength(block, 'utf8');
        if (usedBytes + bytes >
            limit) {
            warnings.push(`Context limit reached before ${rel}. Request this exact path in a later context_request if it is required, or raise GENVIBE_CONTEXT_LIMIT.`);
            continue;
        }
        sections.push(block);
        relevantFiles.push(rel);
        usedBytes += bytes;
    }
    if (!relevantFiles.length &&
        !smallProject) {
        sections.push('No complete source file could be delivered for the current request. Return context_request with exact existing file paths from the FILE INDEX.');
    }
    if (warnings.length) {
        sections.push('CONTEXT WARNINGS:\n- ' +
            warnings.join('\n- '));
    }
    return {
        context: sections.join('\n\n'),
        relevantFiles,
        totalFiles: allFiles.length,
        warnings,
    };
}
export async function searchUsages(root, tokens) {
    const allFiles = [];
    await walk(root, root, allFiles);
    const unique = [
        ...new Set(tokens
            .map((value) => value.trim())
            .filter((value) => value.length >= 2)),
    ].slice(0, 12);
    const result = unique.map((token) => ({
        token,
        files: [],
        count: 0,
    }));
    for (const file of allFiles) {
        const content = await readTextFile(file);
        if (content == null) {
            continue;
        }
        for (const row of result) {
            let at = content.indexOf(row.token);
            let local = 0;
            while (at >= 0 &&
                local < 200) {
                row.count += 1;
                local += 1;
                at =
                    content.indexOf(row.token, at + row.token.length);
            }
            if (local) {
                row.files.push(file.rel);
            }
        }
    }
    return result;
}
