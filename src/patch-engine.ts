import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type PatchRisk = 'low' | 'medium' | 'high';

export type ModifyOperation =
  | {
      type: 'replace';
      old: string;
      new: string;
      expectedMatches?: number;
    }
  | {
      type: 'insert_before';
      anchor: string;
      content: string;
      expectedMatches?: number;
    }
  | {
      type: 'insert_after';
      anchor: string;
      content: string;
      expectedMatches?: number;
    };

export interface ModifyFilePatch {
  path: string;
  baseHash: string;
  mode: 'modify';
  operations: ModifyOperation[];
}

export interface CreateFilePatch {
  path: string;
  baseHash: null;
  mode: 'create';
  content: string;
}

export interface DeleteFilePatch {
  path: string;
  baseHash: string;
  mode: 'delete';
}

export type FilePatch =
  | ModifyFilePatch
  | CreateFilePatch
  | DeleteFilePatch;

export interface PatchPlan {
  kind: 'patch';
  version: 1;
  summary: string;
  risk: PatchRisk;
  impactTokens?: string[];
  files: FilePatch[];
}

export interface ContextRequest {
  kind: 'context_request';
  queries: string[];
  reason?: string;
}

export interface PatchResult {
  changedFiles: string[];
  operations: number;
  addedLines: number;
  removedLines: number;
  summary: string;
}

export class PatchConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchConflictError';
  }
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

function stripFence(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export function parseAgentJson(
  raw: string
): PatchPlan | ContextRequest | any {
  const text = stripFence(raw);

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new PatchConflictError(
      `AI response valid JSON nahi hai: ${String(
        e instanceof Error ? e.message : e
      )}`
    );
  }
}

function assertRelativeSafe(rel: string): void {
  if (!rel || path.isAbsolute(rel) || rel.includes('\0')) {
    throw new PatchConflictError(`Unsafe path: ${rel}`);
  }

  const normalized = path.posix.normalize(
    rel.replaceAll('\\', '/')
  );

  if (
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new PatchConflictError(
      `Path project ke bahar ja raha hai: ${rel}`
    );
  }
}

function countOccurrences(
  haystack: string,
  needle: string
): number {
  if (!needle) return 0;

  let count = 0;
  let at = 0;

  while ((at = haystack.indexOf(needle, at)) >= 0) {
    count++;
    at += Math.max(1, needle.length);
  }

  return count;
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

// GENVIBE_SAFE_WHITESPACE_MATCH_V3
// Matching order:
// 1) exact text after EOL normalization
// 2) safe whitespace-normalized text
// A fallback is accepted only when expectedMatches still matches exactly.
type GvFlexibleMatch = {
  start: number;
  end: number;
  exact: boolean;
};

function gvNormalizeEol(
  value: string
): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function gvDetectEol(
  value: string
): '\\r\\n' | '\\n' | '\\r' {
  if (value.includes('\r\n')) {
    return '\\r\\n';
  }

  if (value.includes('\r')) {
    return '\\r';
  }

  return '\\n';
}

function gvRestoreEol(
  value: string,
  eol: '\\r\\n' | '\\n' | '\\r'
): string {
  if (eol === '\\r\\n') {
    return value.replace(/\n/g, '\r\n');
  }

  if (eol === '\\r') {
    return value.replace(/\n/g, '\r');
  }

  return value;
}

function gvCanonicalWithMap(
  value: string
): {
  text: string;
  map: number[];
} {
  const normalized = gvNormalizeEol(value);

  let text = '';
  const map: number[] = [];
  let pendingWhitespace = false;
  let pendingWhitespaceIndex = 0;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i] ?? '';

    if (/\s/.test(ch)) {
      if (!pendingWhitespace) {
        pendingWhitespace = true;
        pendingWhitespaceIndex = i;
      }
      continue;
    }

    if (pendingWhitespace && text.length > 0) {
      text += ' ';
      map.push(pendingWhitespaceIndex);
    }

    pendingWhitespace = false;
    text += ch;
    map.push(i);
  }

  return { text, map };
}

function gvCanonicalNeedle(
  value: string
): string {
  return gvNormalizeEol(value)
    .trim()
    .replace(/\s+/g, ' ');
}

function gvFindFlexibleMatches(
  source: string,
  needle: string
): GvFlexibleMatch[] {
  const exactNeedle = gvNormalizeEol(needle);
  const exactMatches: GvFlexibleMatch[] = [];

  let exactAt = 0;

  while (
    exactNeedle &&
    (exactAt = source.indexOf(exactNeedle, exactAt)) >= 0
  ) {
    exactMatches.push({
      start: exactAt,
      end: exactAt + exactNeedle.length,
      exact: true,
    });

    exactAt += Math.max(1, exactNeedle.length);
  }

  if (exactMatches.length) {
    return exactMatches;
  }

  const canonicalNeedle = gvCanonicalNeedle(exactNeedle);

  if (!canonicalNeedle) {
    return [];
  }

  const canonicalSource = gvCanonicalWithMap(source);
  const matches: GvFlexibleMatch[] = [];

  let at = 0;

  while (
    (at = canonicalSource.text.indexOf(canonicalNeedle, at)) >= 0
  ) {
    const canonicalEnd = at + canonicalNeedle.length - 1;
    const start = canonicalSource.map[at];
    const last = canonicalSource.map[canonicalEnd];

    if (start !== undefined && last !== undefined) {
      matches.push({
        start,
        end: last + 1,
        exact: false,
      });
    }

    at += Math.max(1, canonicalNeedle.length);
  }

  return matches;
}

function gvLineIndentBefore(
  source: string,
  at: number
): string {
  const lineStart =
    source.lastIndexOf('\n', Math.max(0, at - 1)) + 1;

  const prefix = source.slice(lineStart, at);

  return /^[\t ]*$/.test(prefix)
    ? prefix
    : '';
}

function gvPrepareReplacement(
  value: string,
  baseIndent: string,
  firstLineIndentAlreadyPresent: boolean
): string {
  const lines = gvNormalizeEol(value).split('\n');

  if (!lines.length || !baseIndent) {
    return lines.join('\n');
  }

  return lines
    .map((line, index) => {
      if (
        index === 0 &&
        firstLineIndentAlreadyPresent
      ) {
        return line;
      }

      if (!line.length) {
        return line;
      }

      return baseIndent + line;
    })
    .join('\n');
}

function gvReplaceMatches(
  source: string,
  matches: GvFlexibleMatch[],
  replacementFactory: (
    match: GvFlexibleMatch
  ) => string
): string {
  let next = source;

  for (const match of [...matches].reverse()) {
    next =
      next.slice(0, match.start) +
      replacementFactory(match) +
      next.slice(match.end);
  }

  return next;
}

function applyModify(
  content: string,
  operations: ModifyOperation[],
  file: string
): {
  content: string;
  added: number;
  removed: number;
  operations: number;
} {
  const originalEol = gvDetectEol(content);
  let next = gvNormalizeEol(content);

  let added = 0;
  let removed = 0;
  let count = 0;

  for (const op of operations) {
    const expected = op.expectedMatches ?? 1;

    if (!Number.isInteger(expected) || expected < 1) {
      throw new PatchConflictError(
        file + ': expectedMatches invalid'
      );
    }

    if (op.type === 'replace') {
      if (!op.old) {
        throw new PatchConflictError(
          file + ': replace.old empty nahi ho sakta'
        );
      }

      const oldText = gvNormalizeEol(op.old);
      const newText = gvNormalizeEol(op.new);
      const matches = gvFindFlexibleMatches(next, oldText);

      if (matches.length !== expected) {
        throw new PatchConflictError(
          file +
            ': replace anchor mismatch. Expected ' +
            expected +
            ', current ' +
            matches.length +
            '. Exact + safe-whitespace matching failed or was ambiguous.'
        );
      }

      next = gvReplaceMatches(
        next,
        matches,
        (match) => {
          const baseIndent = gvLineIndentBefore(
            next,
            match.start
          );

          return gvPrepareReplacement(
            newText,
            baseIndent,
            true
          );
        }
      );

      removed += lineCount(oldText) * matches.length;
      added += lineCount(newText) * matches.length;
      count++;
      continue;
    }

    const rawAnchor = op.anchor;

    if (!rawAnchor) {
      throw new PatchConflictError(
        file + ': insert anchor empty nahi ho sakta'
      );
    }

    const anchor = gvNormalizeEol(rawAnchor);
    const insertContent = gvNormalizeEol(op.content);
    const matches = gvFindFlexibleMatches(next, anchor);

    if (matches.length !== expected) {
      throw new PatchConflictError(
        file +
          ': insert anchor mismatch. Expected ' +
          expected +
          ', current ' +
          matches.length +
          '. Exact + safe-whitespace matching failed or was ambiguous.'
      );
    }

    next = gvReplaceMatches(
      next,
      matches,
      (match) => {
        const matchedText = next.slice(
          match.start,
          match.end
        );

        const baseIndent = gvLineIndentBefore(
          next,
          match.start
        );

        const prepared = gvPrepareReplacement(
          insertContent,
          baseIndent,
          false
        );

        if (op.type === 'insert_before') {
          return prepared + matchedText;
        }

        return matchedText + prepared;
      }
    );

    added += lineCount(insertContent) * matches.length;
    count++;
  }

  return {
    content: gvRestoreEol(next, originalEol),
    added,
    removed,
    operations: count,
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function preflightPatchPlan(
  root: string,
  plan: PatchPlan
): Promise<void> {
  if (
    plan.kind !== 'patch' ||
    plan.version !== 1 ||
    !Array.isArray(plan.files) ||
    !plan.files.length
  ) {
    throw new PatchConflictError(
      'Invalid patch plan schema.'
    );
  }

  const seen = new Set<string>();

  for (const f of plan.files) {
    assertRelativeSafe(f.path);

    if (seen.has(f.path)) {
      throw new PatchConflictError(
        `Same file multiple manifest entries me hai: ${f.path}`
      );
    }

    seen.add(f.path);

    const abs = path.resolve(root, f.path);
    const relCheck = path.relative(root, abs);

    if (
      relCheck.startsWith('..') ||
      path.isAbsolute(relCheck)
    ) {
      throw new PatchConflictError(
        `Unsafe resolved path: ${f.path}`
      );
    }

    if (f.mode === 'create') {
      if (await exists(abs)) {
        throw new PatchConflictError(
          `${f.path}: create requested but file already exists.`
        );
      }

      continue;
    }

    if (!(await exists(abs))) {
      throw new PatchConflictError(
        `${f.path}: target file missing.`
      );
    }

    const current = await readFile(abs);

    if (
      !f.baseHash ||
      sha256(current.toString('utf8')) !== f.baseHash
    ) {
      throw new PatchConflictError(
        `${f.path}: baseHash mismatch. File changed since context was read; patch is stale.`
      );
    }

    if (f.mode === 'modify') {
      applyModify(
        current.toString('utf8'),
        f.operations ?? [],
        f.path
      );
    }
  }
}

export async function applyPatchPlan(
  root: string,
  plan: PatchPlan,
  dryRun = false
): Promise<PatchResult> {
  await preflightPatchPlan(root, plan);

  const prepared: Array<{
    path: string;
    abs: string;
    mode: FilePatch['mode'];
    next?: string;
  }> = [];

  let addedLines = 0;
  let removedLines = 0;
  let operations = 0;

  for (const f of plan.files) {
    const abs = path.resolve(root, f.path);

    if (f.mode === 'modify') {
      const current = await readFile(abs, 'utf8');
      const applied = applyModify(
        current,
        f.operations,
        f.path
      );

      if (applied.content === current) {
        throw new PatchConflictError(
          `${f.path}: patch would be a no-op.`
        );
      }

      prepared.push({
        path: f.path,
        abs,
        mode: f.mode,
        next: applied.content,
      });

      addedLines += applied.added;
      removedLines += applied.removed;
      operations += applied.operations;
    } else if (f.mode === 'create') {
      prepared.push({
        path: f.path,
        abs,
        mode: f.mode,
        next: f.content,
      });

      addedLines += lineCount(f.content);
      operations++;
    } else {
      prepared.push({
        path: f.path,
        abs,
        mode: f.mode,
      });

      const current = await readFile(abs, 'utf8');
      removedLines += lineCount(current);
      operations++;
    }
  }

  if (!dryRun) {
    const tempPaths: string[] = [];

    try {
      for (const item of prepared) {
        if (item.mode === 'delete') continue;

        await mkdir(path.dirname(item.abs), {
          recursive: true,
        });

        const tmp =
          `${item.abs}.gv-next-${process.pid}.tmp`;

        await writeFile(
          tmp,
          item.next ?? '',
          'utf8'
        );

        tempPaths.push(tmp);
      }

      for (const item of prepared) {
        if (item.mode === 'delete') {
          await rm(item.abs, { force: true });
        } else {
          await rename(
            `${item.abs}.gv-next-${process.pid}.tmp`,
            item.abs
          );
        }
      }
    } finally {
      for (const tmp of tempPaths) {
        await rm(tmp, { force: true }).catch(
          () => undefined
        );
      }
    }
  }

  return {
    changedFiles: prepared.map((x) => x.path),
    operations,
    addedLines,
    removedLines,
    summary: plan.summary,
  };
}
