import { mkdir, readFile, rename, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const updateFile = path.resolve(root, 'src', 'update-engine.ts');
const qwenFile = path.resolve(root, 'src', 'qwen.ts');
const legacyFile = path.resolve(root, 'src', 'legacy-context.ts');
const staleFile = path.resolve(root, 'src', 'context-pipeline.ts');

const MARKER = '// GENVIBE_OLD_CONTEXT_NEW_PATCH_V4';

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function read(file) {
  return (await readFile(file, 'utf8'))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function replaceOnce(
  source,
  oldText,
  newText,
  label
) {
  const first = source.indexOf(oldText);
  const last = source.lastIndexOf(oldText);

  if (
    first < 0 ||
    first !== last
  ) {
    throw new Error(
      `${label}: expected exactly one match.`
    );
  }

  return (
    source.slice(0, first) +
    newText +
    source.slice(
      first + oldText.length
    )
  );
}

function replaceOptionalOnce(
  source,
  oldText,
  newText,
  label
) {
  const first = source.indexOf(oldText);

  if (first < 0) {
    return source;
  }

  if (
    source.lastIndexOf(oldText) !==
    first
  ) {
    throw new Error(
      `${label}: ambiguous match.`
    );
  }

  return (
    source.slice(0, first) +
    newText +
    source.slice(
      first + oldText.length
    )
  );
}

function replaceSection(
  source,
  startMarker,
  endMarker,
  replacement,
  label
) {
  const start =
    source.indexOf(startMarker);

  if (start < 0) {
    throw new Error(
      `${label}: start marker not found.`
    );
  }

  if (
    source.indexOf(
      startMarker,
      start + startMarker.length
    ) >= 0
  ) {
    throw new Error(
      `${label}: start marker ambiguous.`
    );
  }

  const end =
    source.indexOf(
      endMarker,
      start + startMarker.length
    );

  if (end < 0) {
    throw new Error(
      `${label}: end marker not found.`
    );
  }

  return (
    source.slice(0, start) +
    replacement +
    source.slice(end)
  );
}

async function atomicWrite(
  target,
  content
) {
  const temp =
    `${target}.gv-old-context-${process.pid}.tmp`;

  try {
    await writeFile(
      temp,
      content,
      'utf8'
    );

    await rm(
      target,
      {
        force: true,
      }
    );

    await rename(
      temp,
      target
    );
  } finally {
    await rm(
      temp,
      {
        force: true,
      }
    ).catch(
      () => undefined
    );
  }
}

function build() {
  if (
    process.platform === 'win32'
  ) {
    return spawnSync(
      process.env.ComSpec ||
        'cmd.exe',
      [
        '/d',
        '/s',
        '/c',
        'npm run build',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      }
    );
  }

  return spawnSync(
    'npm',
    [
      'run',
      'build',
    ],
    {
      cwd: root,
      encoding: 'utf8',
    }
  );
}

const legacySource = String.raw`${MARKER}
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Page } from 'playwright-core';
import { sendAndWait } from './qwen.js';

const SMALL_PROJECT_MAX_FILES = 25;
const SMALL_PROJECT_MAX_BYTES = 100_000;
const MAX_SELECTED_FILES = 12;
const MAX_FILE_BYTES = 700_000;
const MAX_CONTEXT_BYTES = 2_500_000;

const ignoredDirs = new Set([
  '.git',
  '.gv',
  '.angular',
  '.next',
  '.cache',
  '.turbo',
  '.vite',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.venv',
  '__pycache__',
  '.vscode',
]);

const binaryExts = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
]);

const lockFiles = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

type ProjectFile = {
  rel: string;
  abs: string;
  bytes: number;
};

export type LegacyContextSelection = {
  files: string[];
  totalFiles: number;
  totalBytes: number;
  smallProject: boolean;
};

export type LegacyContextAttachment = {
  path: string;
  bytes: number;
  cleanup(): Promise<void>;
};

function normalizeRel(
  value: string
): string {
  return value
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .trim();
}

function sensitive(
  rel: string
): boolean {
  const base =
    (
      rel
        .toLowerCase()
        .split('/')
        .pop() ?? ''
    ).trim();

  return (
    base === '.env' ||
    base.startsWith('.env.') ||
    base === 'id_rsa' ||
    base === 'id_ed25519' ||
    base.includes('credential') ||
    base.includes('secret') ||
    base.endsWith('.pem') ||
    base.endsWith('.key') ||
    base.endsWith('.p12') ||
    base.endsWith('.pfx')
  );
}

function ignoredFile(
  rel: string
): boolean {
  const base =
    rel
      .split('/')
      .pop() ?? rel;

  return (
    lockFiles.has(base) ||
    binaryExts.has(
      path
        .extname(base)
        .toLowerCase()
    )
  );
}

async function walk(
  dir: string,
  root: string,
  out: ProjectFile[]
): Promise<void> {
  for (
    const entry
    of await readdir(
      dir,
      {
        withFileTypes: true,
      }
    )
  ) {
    if (
      entry.isSymbolicLink()
    ) {
      continue;
    }

    if (
      entry.isDirectory() &&
      ignoredDirs.has(
        entry.name
      )
    ) {
      continue;
    }

    const abs =
      path.join(
        dir,
        entry.name
      );

    const rel =
      normalizeRel(
        path.relative(
          root,
          abs
        )
      );

    if (
      entry.isDirectory()
    ) {
      await walk(
        abs,
        root,
        out
      );

      continue;
    }

    if (
      !entry.isFile() ||
      sensitive(rel) ||
      ignoredFile(rel)
    ) {
      continue;
    }

    const info =
      await stat(abs);

    if (
      info.size >
      MAX_FILE_BYTES
    ) {
      continue;
    }

    const data =
      await readFile(abs);

    if (
      data.includes(0)
    ) {
      continue;
    }

    out.push({
      rel,
      abs,
      bytes: info.size,
    });
  }
}

async function safeFiles(
  root: string
): Promise<ProjectFile[]> {
  const out: ProjectFile[] = [];

  await walk(
    root,
    root,
    out
  );

  return out.sort(
    (a, b) =>
      a.rel.localeCompare(
        b.rel
      )
  );
}

async function signals(
  file: ProjectFile
): Promise<string[]> {
  const text =
    await readFile(
      file.abs,
      'utf8'
    ).catch(
      () => ''
    );

  if (!text) {
    return [];
  }

  const found =
    new Set<string>();

  for (
    const match
    of text.matchAll(
      /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g
    )
  ) {
    if (match[1]) {
      found.add(
        'imports:' +
        match[1]
      );
    }

    if (
      found.size >= 6
    ) {
      break;
    }
  }

  for (
    const match
    of text.matchAll(
      /\b(?:export\s+)?(?:default\s+)?(?:function|class|interface|type|const)\s+([A-Za-z_$][\w$]*)/g
    )
  ) {
    if (match[1]) {
      found.add(
        'symbol:' +
        match[1]
      );
    }

    if (
      found.size >= 12
    ) {
      break;
    }
  }

  return [
    ...found,
  ].slice(
    0,
    12
  );
}

async function renderMap(
  files: ProjectFile[]
): Promise<string> {
  const lines = [
    'GENVIBE_PROJECT_MAP_V1',
    '',
  ];

  for (
    const file
    of files
  ) {
    const sig =
      await signals(file);

    lines.push(
      file.rel +
      ' | ' +
      file.bytes +
      ' bytes' +
      (
        sig.length
          ? ' | ' +
            sig.join(', ')
          : ''
      )
    );
  }

  return lines.join('\n');
}

function selectionPrompt(
  request: string,
  map: string
): string {
  return [
    'GENVIBE_CONTEXT_SELECT_V1',
    '',
    'TASK:',
    request,
    '',
    'Choose the smallest sufficient set of EXISTING project files needed to implement this task.',
    'Use only exact paths from PROJECT MAP.',
    'Include directly relevant templates/styles/dependencies when needed.',
    'Select at most 12 files.',
    'Do not solve the coding task yet.',
    'Return exactly one fenced text block containing:',
    'GENVIBE_NEED_FILES_V1',
    'relative/path/one',
    'relative/path/two',
    '',
    'PROJECT MAP:',
    map,
  ].join('\n');
}

function parseSelection(
  raw: string,
  available: Set<string>
): string[] {
  const marker =
    'GENVIBE_NEED_FILES_V1';

  const at =
    raw.indexOf(
      marker
    );

  if (at < 0) {
    throw new Error(
      'Qwen did not return GENVIBE_NEED_FILES_V1.'
    );
  }

  const selected:
    string[] = [];

  for (
    const row
    of raw
      .slice(
        at +
        marker.length
      )
      .split(/\r?\n/)
  ) {
    const cleaned =
      row
        .trim()
        .replace(
          /^[-*]\s*/,
          ''
        )
        .replaceAll(
          String.fromCharCode(
            96
          ),
          ''
        );

    const rel =
      normalizeRel(
        cleaned
      );

    if (
      available.has(rel) &&
      !selected.includes(rel)
    ) {
      selected.push(rel);
    }

    if (
      selected.length >=
      MAX_SELECTED_FILES
    ) {
      break;
    }
  }

  if (
    !selected.length
  ) {
    throw new Error(
      'Qwen selected no valid existing project files.'
    );
  }

  return selected;
}

function addVisualCompanions(
  request: string,
  selected: string[],
  all: string[]
): string[] {
  const q =
    request.toLowerCase();

  const visual =
    [
      'css',
      'style',
      'layout',
      'responsive',
      'theme',
      'ui',
      'design',
      'mobile',
      'desktop',
      'color',
      'colour',
      'background',
      'font',
      'border',
      'spacing',
      'header',
      'footer',
      'card',
      'hero',
      'sidebar',
    ].some(
      (x) =>
        q.includes(x)
    );

  if (!visual) {
    return selected;
  }

  const out =
    [...selected];

  const styleExts =
    new Set([
      '.css',
      '.scss',
      '.sass',
      '.less',
      '.styl',
    ]);

  const markupExts =
    new Set([
      '.html',
      '.htm',
      '.jsx',
      '.tsx',
      '.vue',
      '.svelte',
    ]);

  const hasStyle =
    out.some(
      (f) =>
        styleExts.has(
          path
            .extname(f)
            .toLowerCase()
        )
    );

  const hasMarkup =
    out.some(
      (f) =>
        markupExts.has(
          path
            .extname(f)
            .toLowerCase()
        )
    );

  if (!hasStyle) {
    const f =
      all.find(
        (x) =>
          !out.includes(x) &&
          styleExts.has(
            path
              .extname(x)
              .toLowerCase()
          )
      );

    if (f) {
      out.push(f);
    }
  }

  if (!hasMarkup) {
    const f =
      all.find(
        (x) =>
          !out.includes(x) &&
          markupExts.has(
            path
              .extname(x)
              .toLowerCase()
          )
      );

    if (f) {
      out.push(f);
    }
  }

  return [
    ...new Set(out),
  ].slice(
    0,
    MAX_SELECTED_FILES
  );
}

export async function selectLegacyContextFiles(
  root: string,
  request: string,
  page: Page
): Promise<LegacyContextSelection> {
  const files =
    await safeFiles(root);

  if (!files.length) {
    throw new Error(
      'No safe source files found.'
    );
  }

  const totalBytes =
    files.reduce(
      (
        sum,
        file
      ) =>
        sum +
        file.bytes,
      0
    );

  if (
    files.length <=
      SMALL_PROJECT_MAX_FILES &&
    totalBytes <=
      SMALL_PROJECT_MAX_BYTES
  ) {
    return {
      files:
        files.map(
          (f) =>
            f.rel
        ),
      totalFiles:
        files.length,
      totalBytes,
      smallProject:
        true,
    };
  }

  const map =
    await renderMap(
      files
    );

  const raw =
    await sendAndWait(
      page,
      selectionPrompt(
        request,
        map
      )
    );

  const all =
    files.map(
      (f) =>
        f.rel
    );

  const chosen =
    parseSelection(
      raw,
      new Set(all)
    );

  return {
    files:
      addVisualCompanions(
        request,
        chosen,
        all
      ),

    totalFiles:
      files.length,

    totalBytes,

    smallProject:
      false,
  };
}

export async function createLegacyContextAttachment(
  root: string,
  files: string[]
): Promise<LegacyContextAttachment> {
  const blocks = [
    'GENVIBE_CONTEXT_V1',
    '',
    'AUTHORITATIVE COMPLETE PROJECT CONTEXT',
    'Every FILE below is complete current source read from disk.',
    'Use each SHA256 as baseHash for modify/delete operations.',
    '',
  ];

  let total = 0;

  for (
    const rawRel
    of files
  ) {
    const rel =
      normalizeRel(
        rawRel
      );

    const abs =
      path.resolve(
        root,
        rel
      );

    const relation =
      path.relative(
        path.resolve(root),
        abs
      );

    if (
      relation === '..' ||
      relation.startsWith(
        '..' +
        path.sep
      ) ||
      path.isAbsolute(
        relation
      )
    ) {
      throw new Error(
        'Context path escaped project root: ' +
        rel
      );
    }

    if (
      sensitive(rel) ||
      ignoredFile(rel)
    ) {
      throw new Error(
        'Unsafe context file: ' +
        rel
      );
    }

    const info =
      await stat(abs);

    if (
      !info.isFile()
    ) {
      throw new Error(
        'Expected context file: ' +
        rel
      );
    }

    const data =
      await readFile(abs);

    if (
      data.includes(0)
    ) {
      throw new Error(
        'Binary context file: ' +
        rel
      );
    }

    total +=
      data.byteLength;

    if (
      total >
      MAX_CONTEXT_BYTES
    ) {
      throw new Error(
        'Selected complete context exceeds ' +
        MAX_CONTEXT_BYTES +
        ' bytes at ' +
        rel
      );
    }

    const content =
      data.toString(
        'utf8'
      );

    const hash =
      createHash(
        'sha256'
      )
        .update(content)
        .digest('hex');

    blocks.push(
      'FILE: ' +
        rel,

      'SHA256: ' +
        hash,

      'STATUS: COMPLETE CURRENT SOURCE',

      content,

      'END FILE: ' +
        rel,

      '',

      '---',

      ''
    );
  }

  const body =
    blocks.join('\n');

  const base =
    path.join(
      os.tmpdir(),
      'genvibe'
    );

  await mkdir(
    base,
    {
      recursive: true,
    }
  );

  const dir =
    await mkdtemp(
      path.join(
        base,
        'context-'
      )
    );

  const attachmentPath =
    path.join(
      dir,
      'genvibe-context.txt'
    );

  await writeFile(
    attachmentPath,
    body,
    'utf8'
  );

  return {
    path:
      attachmentPath,

    bytes:
      Buffer.byteLength(
        body
      ),

    cleanup:
      () =>
        rm(
          dir,
          {
            recursive: true,
            force: true,
          }
        ),
  };
}

export function legacyContextNotice(
  files: string[]
): string {
  return [
    'GENVIBE_OLD_CONTEXT_CURRENT_PATCH_V1',
    '',
    'The complete selected project context is attached as genvibe-context.txt.',
    'That attachment is the sole current source of truth for this turn.',
    'Every attached FILE is complete current source, not a snippet.',
    'Ignore stale source from earlier conversation turns.',
    '',
    'Existing files allowed to change:',
    ...files.map(
      (file) =>
        '- ' + file
    ),
    '',
    'Do not request more context.',
    'Return kind=patch using the CURRENT structured PatchPlan protocol.',
    'For modify/delete copy baseHash exactly from attachment SHA256.',
    'For replace/insert copy anchors literally from the attached source.',
    'New files are allowed when the user request requires them.',
  ].join('\n');
}
`;

async function main() {
  for (
    const file
    of [
      updateFile,
      qwenFile,
    ]
  ) {
    if (
      !(await exists(file))
    ) {
      throw new Error(
        'Run this patch from the GenVibe repository root. Missing: ' +
        path.relative(
          root,
          file
        )
      );
    }
  }

  const updateOriginal =
    await read(
      updateFile
    );

  const qwenOriginal =
    await read(
      qwenFile
    );

  if (
    !updateOriginal.includes(
      'preflightPatchPlan'
    ) ||
    !updateOriginal.includes(
      'applyPatchPlan'
    )
  ) {
    throw new Error(
      'Current NEW structured patch engine was not detected. No files changed.'
    );
  }

  if (
    updateOriginal.includes(
      MARKER
    ) ||
    updateOriginal.includes(
      "from './legacy-context.js';"
    )
  ) {
    console.log(
      '✓ Old-context/new-patch migration is already installed.'
    );

    return;
  }

  const stamp =
    new Date()
      .toISOString()
      .replace(
        /[:.]/g,
        '-'
      );

  const backupDir =
    path.resolve(
      root,
      '.gv',
      'manual-patches',
      `pre-old-context-v4-${stamp}`,
      'src'
    );

  await mkdir(
    backupDir,
    {
      recursive: true,
    }
  );

  await copyFile(
    updateFile,
    path.join(
      backupDir,
      'update-engine.ts'
    )
  );

  await copyFile(
    qwenFile,
    path.join(
      backupDir,
      'qwen.ts'
    )
  );

  if (
    await exists(
      legacyFile
    )
  ) {
    await copyFile(
      legacyFile,
      path.join(
        backupDir,
        'legacy-context.ts'
      )
    );
  }

  if (
    await exists(
      staleFile
    )
  ) {
    await copyFile(
      staleFile,
      path.join(
        backupDir,
        'context-pipeline.ts'
      )
    );
  }

  let update =
    updateOriginal;

  let qwen =
    qwenOriginal;

  const smartImport =
`import {
  buildSmartProjectContext,
  searchUsages,
} from './smart-context.js';`;

  const legacyImport =
`import {
  searchUsages,
} from './smart-context.js';
import {
  selectLegacyContextFiles,
  createLegacyContextAttachment,
  legacyContextNotice,
} from './legacy-context.js';`;

  update =
    replaceOnce(
      update,
      smartImport,
      legacyImport,
      'smart-context import'
    );

  update =
    replaceOptionalOnce(
      update,
      '  type ContextRequest,\n',
      '',
      'ContextRequest import'
    );

  update =
    replaceOptionalOnce(
      update,
      'const MAX_PLAN_ROUNDS = 5;\n',
      '',
      'MAX_PLAN_ROUNDS'
    );

  const newGetPlan = String.raw`async function getPlan(
  page: Page,
  root: string,
  request: string,
  selectedFiles: string[],
  repairProblem?: string
): Promise<PatchPlan> {
  const attachment =
    await createLegacyContextAttachment(
      root,
      selectedFiles
    );

  try {
    ui.info(
      '📎 Complete context attachment: ' +
      selectedFiles.length +
      ' file(s), ' +
      Math.ceil(
        attachment.bytes / 1024
      ) +
      ' KB'
    );

    const context =
      legacyContextNotice(
        selectedFiles
      );

    const prompt =
      repairProblem
        ? repairUpdatePrompt(
            request,
            repairProblem,
            context
          )
        : updatePlanPrompt(
            request,
            context
          );

    const raw =
      await sendAndWait(
        page,
        prompt,
        600_000,
        [attachment.path]
      );

    await saveLastPatch(raw);

    const parsed =
      parseAgentJson(raw) as
        | PatchPlan
        | {
            kind?: string;
          };

    if (
      parsed?.kind ===
      'patch'
    ) {
      return parsed as PatchPlan;
    }

    if (
      parsed?.kind ===
      'context_request'
    ) {
      throw new PatchConflictError(
        'Qwen requested more context after complete old-style context was already attached. Context ping-pong is disabled.'
      );
    }

    throw new PatchConflictError(
      'The AI response did not contain a valid structured patch.'
    );
  } finally {
    await attachment.cleanup();
  }
}

`;

  update =
    replaceSection(
      update,
      'async function getPlan(',
      'async function reviewIfNeeded(',
      newGetPlan,
      'getPlan'
    );

  update =
    replaceOnce(
      update,

`  const root = process.cwd();
  const extraQueries: string[] = [];
  let repairProblem: string | undefined;`,

`  const root = process.cwd();
  let repairProblem: string | undefined;
  let selectedContextFiles: string[] = [];`,

      'runSafeUpdate context state'
    );

  const repairLoop =
`  for (
    let attempt = 1;
    attempt <= MAX_REPAIR_ROUNDS;
    attempt++
  ) {`;

  const runAt =
    update.indexOf(
      'export async function runSafeUpdate('
    );

  const loopAt =
    update.indexOf(
      repairLoop,
      runAt
    );

  if (
    runAt < 0 ||
    loopAt < 0
  ) {
    throw new Error(
      'Main repair loop not found.'
    );
  }

  const selectionBlock = String.raw`  try {
    const selected =
      await selectLegacyContextFiles(
        root,
        request,
        page
      );

    selectedContextFiles =
      selected.files;

    if (
      selected.smallProject
    ) {
      ui.info(
        '📚 Small project: using all ' +
        selectedContextFiles.length +
        ' safe source file(s) as complete context.'
      );
    } else {
      ui.info(
        '🧠 Old context selection: ' +
        selectedContextFiles.length +
        ' complete file(s) selected from ' +
        selected.totalFiles +
        '.'
      );
    }

    selectedContextFiles.forEach(
      (file) =>
        ui.info(
          '   • ' +
          file
        )
    );
  } catch (error) {
    ui.fail(
      error instanceof Error
        ? error.message
        : String(error)
    );

    return false;
  }

`;

  update =
    update.slice(
      0,
      loopAt
    ) +
    selectionBlock +
    update.slice(
      loopAt
    );

  update =
    replaceOnce(
      update,

`      plan = await getPlan(
        page,
        root,
        request,
        extraQueries,
        repairProblem
      );`,

`      plan = await getPlan(
        page,
        root,
        request,
        selectedContextFiles,
        repairProblem
      );`,

      'getPlan call'
    );

  update =
    replaceOptionalOnce(
      update,

`      if (Array.isArray(review.queries)) {
        extraQueries.push(
          ...review.queries.slice(0, 6)
        );
      }

`,

`      if (
        Array.isArray(review.queries) &&
        review.queries.length
      ) {
        ui.info(
          'Safety reviewer suggested more context; old-style context selection stays fixed for this update.'
        );
      }

`,

      'safety review context expansion'
    );

  update =
    update.replaceAll(
      'return kind=context_request instead of guessing',
      'do not modify a file outside the selected complete context'
    );

  update =
    update.replaceAll(
      'return a context_request.',
      'do not modify a file outside the selected complete context.'
    );

  update =
    update.replaceAll(
      'request only the specific missing context.',
      'do not modify unavailable files.'
    );

  update =
    update.replaceAll(
      'request more context instead of guessing.',
      'do not modify unavailable files.'
    );

  update =
    update.replaceAll(
      'rebuilding current project context from disk.',
      'rebuilding selected complete context from current disk source.'
    );

  update =
    update.replaceAll(
      'Analyzing project + planning safe update',
      'Selecting complete context + planning safe update'
    );

  update =
    `${MARKER}\n${update}`;

  if (
    !qwen.includes(
      'attachmentPaths: string[] = []'
    )
  ) {
    qwen =
      replaceOnce(
        qwen,

        'export async function sendAndWait(page: Page, prompt: string, timeoutMs = 600_000): Promise<string> {',

`export async function sendAndWait(
  page: Page,
  prompt: string,
  timeoutMs = 600_000,
  attachmentPaths: string[] = []
): Promise<string> {`,

        'sendAndWait signature'
      );

    qwen =
      replaceOnce(
        qwen,

`  let promptForTextarea =
    prompt;

  if (`,

`  let promptForTextarea =
    prompt;

  for (
    const attachmentPath
    of attachmentPaths
  ) {
    await uploadPromptAttachment(
      page,
      attachmentPath
    );
  }

  if (`,

        'explicit attachment insertion'
      );
  }

  if (
    update.includes(
      'buildSmartProjectContext'
    )
  ) {
    throw new Error(
      'buildSmartProjectContext still remains in update-engine.ts.'
    );
  }

  if (
    update.includes(
      'extraQueries'
    )
  ) {
    throw new Error(
      'extraQueries still remains in update-engine.ts.'
    );
  }

  for (
    const required
    of [
      'preflightPatchPlan',
      'applyPatchPlan',
      'searchUsages',
      'takeTargetedSnapshot',
      'restoreLatestSafeSnapshot',
      'verify(root)',
    ]
  ) {
    if (
      !update.includes(
        required
      )
    ) {
      throw new Error(
        'New patch flow was damaged: missing ' +
        required
      );
    }
  }

  try {
    await atomicWrite(
      legacyFile,
      legacySource
    );

    await atomicWrite(
      qwenFile,
      qwen
    );

    await atomicWrite(
      updateFile,
      update
    );

    if (
      await exists(
        staleFile
      )
    ) {
      const stale =
        await read(
          staleFile
        );

      if (
        stale.includes(
          'GENVIBE_OLD_CONTEXT_PIPELINE_'
        )
      ) {
        await rm(
          staleFile,
          {
            force: true,
          }
        );

        console.log(
          '✓ Removed stale broken src/context-pipeline.ts'
        );
      }
    }

    console.log(
      '✓ Old context flow installed.'
    );

    console.log(
      '✓ New structured patch engine preserved.'
    );

    console.log(
      '✓ Old SEARCH/REPLACE patch mechanism was not copied.'
    );

    console.log(
      '✓ Context-request planning loop removed.'
    );

    const result =
      build();

    const output =
      [
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n')
        .trim();

    if (output) {
      console.log(
        '\n' +
        output
      );
    }

    if (
      result.error ||
      result.status !== 0
    ) {
      throw new Error(
        'npm run build failed.'
      );
    }

    console.log(
      '\n✓ npm run build passed.'
    );

    console.log(
      '✓ Migration complete: OLD CONTEXT + CURRENT NEW PATCH ENGINE.'
    );

    console.log(
      '✓ Backup: ' +
      path.relative(
        root,
        path.dirname(
          backupDir
        )
      )
    );
  } catch (error) {
    console.error(
      '\n✕ Patch failed safely. Restoring backup...'
    );

    await copyFile(
      path.join(
        backupDir,
        'update-engine.ts'
      ),
      updateFile
    );

    await copyFile(
      path.join(
        backupDir,
        'qwen.ts'
      ),
      qwenFile
    );

    const legacyBackup =
      path.join(
        backupDir,
        'legacy-context.ts'
      );

    if (
      await exists(
        legacyBackup
      )
    ) {
      await copyFile(
        legacyBackup,
        legacyFile
      );
    } else {
      await rm(
        legacyFile,
        {
          force: true,
        }
      );
    }

    console.error(
      error instanceof Error
        ? error.message
        : String(error)
    );

    console.error(
      '✓ Original active source restored.'
    );

    process.exitCode = 1;
  }
}

main().catch(
  (error) => {
    console.error(
      '\n✕ Patch failed safely.'
    );

    console.error(
      error instanceof Error
        ? error.message
        : String(error)
    );

    process.exitCode = 1;
  }
);