import { DESIGN_INTELLIGENCE } from './design.js';

const FENCE = '```';

const DESIGN_ADDENDUM = DESIGN_INTELLIGENCE;

export function createPrompt(request: string): string {
  return `You are an expert front-end/full-stack engineer. First silently plan the architecture, then implement.

REQUEST: "${request}"

${DESIGN_ADDENDUM}

COMPLEXITY RULE (follow strictly):
- If the request is achievable with plain HTML/CSS/JS, create EXACTLY these files: index.html, style.css, script.js (plus package.json only if a dev server script is genuinely useful — scripts: { "start": "npx serve ." }). NO TypeScript, NO build step, NO bundler, NO dist folder, NO frameworks. The user opens index.html directly and it works.
- If the user explicitly names a framework (React, Next.js, Vue, Svelte, etc.), you MUST use it: create a proper Vite/Next project with package.json listing all dependencies (react, react-dom, next, vite etc.), correct scripts (dev, build, start), and a working entry point. TypeScript is fine here.
- Dependencies in package.json must be REAL and versioned (e.g. "react": "^18.3.1") — npm install must succeed and the build must pass.
- Python or other non-Node requests: write only the relevant source files, no package.json unless needed.

DESIGN RULE (mandatory):
- Modern, polished, professional UI. Use a clean design system: a Google Font (e.g. Inter/Poppins), a cohesive color palette (CSS variables), proper spacing, rounded corners (8-14px), soft shadows, smooth hover/focus transitions, empty states, and responsive layout (works on mobile).
- Dark or light theme — pick one and make it consistent. The result should look like a real product, not a tutorial demo.

${DESIGN_ADDENDUM}

OUTPUT CONTRACT (mandatory):
Return exactly ONE fenced code block containing a complete, self-contained TypeScript file. When executed with "npx tsx patch.ts" in the project root it must:
1. Import { writeFile, mkdir, rm } from 'node:fs/promises' and path helpers; use path.resolve() for every target.
2. Write EVERY project file with its COMPLETE final content, creating folders via mkdir(recursive: true).
3. Ensure consistency: every import/export/type referenced by one file must exist in others. The project must work immediately after this patch runs.
4. Log each written file with console.log.
5. Contain a main() async function invoked as main().catch(console.error).
6. NO user interaction, NO shell commands, NO placeholders, NO lockfiles or build output.

Return the TypeScript file only. No other text.`;
}

export function fixPrompt(previousPatch: string, errors: string): string {
  return `The previous patch ran but the project build/test FAILED. Fix it.

PREVIOUS PATCH:
${FENCE}ts
${previousPatch}
${FENCE}

ERRORS (last part):
${errors.slice(-6000)}

OUTPUT CONTRACT (same as before):
7. ALL file paths must stay INSIDE the project root — NEVER use '..' to write outside.

Return exactly ONE fenced code block containing a COMPLETE replacement TypeScript patch file (not a diff). It must write every file needed so the project works. Fix root causes, not symptoms — if one file changed, update every dependent file too.

Return the TypeScript file only.`;
}

export function updatePrompt(request: string, context: string): string {
  return `You are updating an EXISTING project. Do NOT recreate it — change only what the request needs.

REQUEST: "${request}"

${context}

OUTPUT CONTRACT (mandatory):
Return exactly ONE fenced code block containing a complete, self-contained TypeScript file. When executed with "npx tsx patch.ts" in the project root it must:
1. Import { writeFile, mkdir, rm } from 'node:fs/promises'; use path.resolve() for every target.
2. ONLY write files that need to change (with their COMPLETE final content — never omit unchanged portions) and any genuinely new files. Delete files that must no longer exist via rm.
3. DEPENDENCY CONSISTENCY: if an export/import/type changes, update EVERY dependent file in the same patch. Project must keep working after this patch.
4. Follow the project's existing style and design language. Improve UX/responsiveness where the request implies it.
5. ALL file paths must stay INSIDE the project root. NEVER use '..' or absolute paths. New pages go in folders like pages/ or views/ INSIDE the project.
6. When removing or renaming HTML elements, update every getElementById/querySelector in JS that referenced them — no dangling references.
7. Contain main() invoked as main().catch(console.error). NO shell commands, NO placeholders.

Return the TypeScript file only.`;
}

// === DESIGN ADDENDUM (applies to all prompts) ===
// - WORLD-CLASS UI IS THE #1 PRIORITY. The result must make first-time viewers STOP and say "wow". Think: Linear.app, Vercel, Raycast, Stripe-level polish. NOT a tutorial demo.
// - Design system (mandatory): Google Font (Inter/Space Grotesk/Sora), CSS variables palette with an intentional color story (not default blue), generous whitespace, 10-16px radii, layered soft shadows, micro-interactions (hover lifts, button presses, focus rings), smooth 200-300ms transitions.
// - Extra polish (always include): tasteful gradient accents, glassmorphism where it fits, skeleton/loading states, empty states with personality, hover states on EVERY interactive element, subtle ambient background gradient, fully responsive layout.
// - Dark mode by default with rich contrast. The user should want to screenshot and share this app.
