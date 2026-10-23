import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const stateDir = () => path.join(process.cwd(), '.gv');
const stateFile = () => path.join(stateDir(), 'state.json');
export async function loadState() {
    try {
        return JSON.parse(await readFile(stateFile(), 'utf8'));
    }
    catch {
        return {};
    }
}
export async function saveState(state) {
    await mkdir(stateDir(), { recursive: true });
    await writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf8');
}
export async function saveLastPatch(patch) {
    const state = await loadState();
    await saveState({ ...state, lastPatch: patch, updatedAt: new Date().toISOString() });
}
