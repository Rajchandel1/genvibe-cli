import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const stateDir = (): string => path.join(process.cwd(), '.gv');
const stateFile = (): string => path.join(stateDir(), 'state.json');

export interface ProjectState {
  lastPatch?: string;
  updatedAt?: string;
}

export async function loadState(): Promise<ProjectState> {
  try { return JSON.parse(await readFile(stateFile(), 'utf8')) as ProjectState; } catch { return {}; }
}

export async function saveState(state: ProjectState): Promise<void> {
  await mkdir(stateDir(), { recursive: true });
  await writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf8');
}

export async function saveLastPatch(patch: string): Promise<void> {
  const state = await loadState();
  await saveState({ ...state, lastPatch: patch, updatedAt: new Date().toISOString() });
}
