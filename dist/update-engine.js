import chalk from 'chalk';
import { buildSmartProjectContext, searchUsages, } from './smart-context.js';
import { parseAgentJson, preflightPatchPlan, applyPatchPlan, PatchConflictError, } from './patch-engine.js';
import { updatePlanPrompt, repairUpdatePrompt, reviewPatchPrompt, } from './update-prompts.js';
import { sendAndWait } from './qwen.js';
import { startNewChat } from './browser.js';
// GENVIBE_FRESH_CONFLICT_REPAIR_V1
import { takeTargetedSnapshot, restoreLatestSafeSnapshot, } from './safe-snapshot.js';
import { verify } from './runner.js';
import { saveLastPatch } from './state.js';
import { ui } from './ui.js';
const MAX_PLAN_ROUNDS = 5;
const MAX_REPAIR_ROUNDS = 4;
function compactPlan(plan) {
    return JSON.stringify(plan, null, 2);
}
function impactText(rows) {
    if (!rows.length) {
        return 'No explicit impact tokens supplied.';
    }
    return rows
        .map((r) => `${r.token}: ${r.count} occurrence(s) across ${r.files.length} file(s)\n` +
        r.files
            .slice(0, 20)
            .map((f) => `  - ${f}`)
            .join('\n'))
        .join('\n\n');
}
function needsSafetyReview(plan, impact) {
    const opCount = plan.files.reduce((n, f) => n +
        (f.mode === 'modify'
            ? f.operations.length
            : 1), 0);
    return (plan.risk !== 'low' ||
        plan.files.length > 1 ||
        opCount > 3 ||
        impact.some((x) => x.files.length > 1 || x.count > 3));
}
async function getPlan(page, root, request, extraQueries, repairProblem) {
    for (let round = 1; round <= MAX_PLAN_ROUNDS; round++) {
        const contextQueries = repairProblem
            ? [
                ...extraQueries,
                repairProblem,
            ]
            : extraQueries;
        const ctx = await buildSmartProjectContext(root, request, contextQueries);
        const prompt = repairProblem
            ? repairUpdatePrompt(request, repairProblem, ctx.context)
            : updatePlanPrompt(request, ctx.context);
        const raw = await sendAndWait(page, prompt);
        await saveLastPatch(raw);
        const parsed = parseAgentJson(raw);
        if (parsed?.kind === 'context_request') {
            const queries = Array.isArray(parsed.queries)
                ? parsed.queries.filter((x) => typeof x === 'string' && x.trim())
                : [];
            if (!queries.length) {
                throw new PatchConflictError('The AI returned a context request without any queries.');
            }
            ui.info(`Context requested: ${queries
                .slice(0, 3)
                .join(' | ')}`);
            const normalizedExisting = new Set(extraQueries.map((x) => x
                .trim()
                .toLowerCase()
                .replaceAll('\\\\', '/')));
            const novelQueries = queries
                .map((x) => x.trim())
                .filter(Boolean)
                .filter((x) => !normalizedExisting.has(x
                .toLowerCase()
                .replaceAll('\\\\', '/')));
            if (!novelQueries.length) {
                ui.info('↻ Duplicate context request detected — preventing a repeated planning loop.');
                repairProblem =
                    `REPEATED CONTEXT REQUEST DETECTED.\n\n` +
                        `You requested the same context again:\n` +
                        `${queries.join('\n')}\n\n` +
                        `That context was already supplied in the previous round. ` +
                        `If it was an exact existing file path and the file was within the exact-file limit, it was supplied as COMPLETE VERBATIM CURRENT SOURCE with SHA256.\n\n` +
                        `Do NOT request the same file/context again. ` +
                        `Now either:\n` +
                        `1. return the patch using the supplied source, OR\n` +
                        `2. request a DIFFERENT exact file or a SPECIFIC symbol/function/component that is still missing.\n\n` +
                        `Never invent anchors.`;
                continue;
            }
            extraQueries.push(...novelQueries.slice(0, 6));
            repairProblem = undefined;
            continue;
        }
        if (parsed?.kind === 'patch') {
            return parsed;
        }
        throw new PatchConflictError('The AI response did not contain a valid patch or context request.');
    }
    throw new PatchConflictError('Context planning rounds exhausted.');
}
async function reviewIfNeeded(page, request, plan, impact) {
    if (!needsSafetyReview(plan, impact)) {
        return {
            approved: true,
            reason: 'Low-risk isolated patch.',
        };
    }
    const raw = await sendAndWait(page, reviewPatchPrompt(request, compactPlan(plan), impactText(impact)));
    const parsed = parseAgentJson(raw);
    if (typeof parsed?.approved !== 'boolean') {
        return {
            approved: false,
            reason: 'Safety reviewer returned invalid schema.',
        };
    }
    return parsed;
}
export async function runSafeUpdate(request, page, options = {}) {
    const root = process.cwd();
    const extraQueries = [];
    let repairProblem;
    const rejectedPlans = new Set();
    let freshRepairCount = 0;
    const resetConversationForRepair = async (reason) => {
        freshRepairCount++;
        ui.info(`🧠 Starting fresh Qwen chat for repair #${freshRepairCount}: ${reason}`);
        await startNewChat(page);
        ui.info('♻ Fresh chat ready — rebuilding current project context from disk.');
    };
    for (let attempt = 1; attempt <= MAX_REPAIR_ROUNDS; attempt++) {
        const s0 = ui.spinner('Analyzing project + planning safe update');
        let plan;
        try {
            plan = await getPlan(page, root, request, extraQueries, repairProblem);
            s0.succeed('Surgical patch plan ready');
        }
        catch (e) {
            s0.fail(e instanceof Error ? e.message : String(e));
            return false;
        }
        const planFingerprint = compactPlan(plan);
        if (rejectedPlans.has(planFingerprint)) {
            ui.fail('Duplicate rejected patch detected — same bad plan will not be retried.');
            repairProblem =
                `DUPLICATE REJECTED PATCH DETECTED.

The patch you just returned is effectively identical to a patch that was already rejected.

Do NOT reuse or reconstruct the previous anchors.

Forget the previous proposed patch.

Re-read the FRESH CURRENT CONTEXT from scratch.

For every modify operation:
- copy old/anchor text literally from the supplied current source
- preserve indentation, whitespace, quotes and line breaks exactly
- never recreate an anchor from memory
- if exact current source is not available, return kind=context_request instead of guessing

Generate a materially different corrected patch.`;
            await resetConversationForRepair('duplicate rejected patch');
            continue;
        }
        try {
            await preflightPatchPlan(root, plan);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            ui.fail(`Pre-flight reject: ${msg}`);
            rejectedPlans.add(planFingerprint);
            repairProblem =
                `PRE-FLIGHT REJECTION:
${msg}

The previous patch was rejected BEFORE any files were changed.

IMPORTANT REPAIR RULES:

1. This is a fresh repair attempt.
2. Ignore the previous proposed patch completely.
3. Re-read the fresh current project context from disk.
4. Do not reconstruct old/anchor text from memory.
5. Copy every replace.old or insert anchor character-for-character from CURRENT SOURCE.
6. Preserve indentation, spaces, quotes, JSX formatting and line breaks exactly.
7. If the exact target source is not visible in context, return a context_request.
8. Never repeat the rejected patch.
9. baseHash and anchors must belong to the same fresh source version.

Generate a new patch from the current repository state.`;
            await resetConversationForRepair('pre-flight patch conflict');
            continue;
        }
        const impact = await searchUsages(root, plan.impactTokens ?? []);
        const review = await reviewIfNeeded(page, request, plan, impact);
        if (!review.approved) {
            ui.info('↻ Safety review found a blocking issue — refining implementation...');
            if (Array.isArray(review.queries)) {
                extraQueries.push(...review.queries.slice(0, 6));
            }
            rejectedPlans.add(planFingerprint);
            repairProblem =
                `REGRESSION SAFETY REVIEW REJECTED THE PLAN:

${review.reason}

IMPACT:
${impactText(impact)}

IMPORTANT:
The reviewer identified a CONCRETE BLOCKING DEFECT.

Correct that blocker while still fully satisfying the original user request.

Do not reduce scope merely to avoid the blocker.
Do not abandon the requested behavior.
Do not reuse the rejected implementation.
Do not optimize for architectural perfection.
Choose the simplest framework-compatible implementation that fulfills the request safely.

If exact source is missing, request only the specific missing context.
Otherwise return a materially corrected patch.`;
            // GENVIBE_SAFETY_REVIEW_SAME_CHAT_V1
            // Safety-review repairs stay in the same Qwen conversation.
            // Existing context and reviewer feedback remain available.
            continue;
        }
        if (options.dryRun) {
            const result = await applyPatchPlan(root, plan, true);
            ui.panel('DRY RUN', plan.summary);
            ui.info(`${result.changedFiles.length} file(s), ` +
                `${result.operations} operation(s), ` +
                `+${result.addedLines}/-${result.removedLines} lines`);
            result.changedFiles.forEach((f) => ui.info(`• ${f}`));
            ui.success('No files modified.');
            return true;
        }
        await takeTargetedSnapshot(root, `update: ${request.slice(0, 120)}`, plan.files.map((f) => f.path));
        ui.info('Safety snapshot created');
        let result;
        try {
            result = await applyPatchPlan(root, plan, false);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            ui.fail(`Apply reject: ${msg}`);
            const restored = await restoreLatestSafeSnapshot(root);
            if (restored) {
                ui.info(`Rollback complete: ${restored}`);
            }
            else {
                ui.fail('The patch partially failed and the rollback snapshot could not be restored. Manual inspection is required.');
                return false;
            }
            rejectedPlans.add(planFingerprint);
            repairProblem =
                `PATCH APPLY CONFLICT:
${msg}

The failed patch has been rolled back.

Do not reuse that patch.

Re-read the current source after rollback and generate a completely fresh patch.

All replace.old and insert anchors must be copied literally from the fresh source.

If the required exact source is missing, request more context instead of guessing.`;
            await resetConversationForRepair('patch apply conflict');
            continue;
        }
        const s1 = ui.spinner('Build/test regression verification');
        const errors = await verify(root);
        if (!errors) {
            s1.succeed('Verification pass');
            ui.info(`📝 ${result.changedFiles.length} file(s), ` +
                `${result.operations} operation(s), ` +
                `+${result.addedLines}/-${result.removedLines} lines`);
            result.changedFiles.forEach((f) => ui.info(`   • ${f}`));
            if (impact.length) {
                const shared = impact.filter((x) => x.files.length > 1);
                if (shared.length) {
                    ui.info(`🛡 Shared-impact reviewed: ${shared
                        .map((x) => x.token)
                        .join(', ')}`);
                }
            }
            console.log(chalk.green.bold('  ✓ Update completed safely.'));
            return true;
        }
        s1.fail('Regression verification failed — rollback');
        const restored = await restoreLatestSafeSnapshot(root);
        if (!restored) {
            ui.fail('The rollback snapshot could not be restored. Manual inspection is required.');
            return false;
        }
        ui.info(`Rollback complete: ${restored}`);
        repairProblem =
            `PATCH APPLIED BUT VERIFICATION FAILED, THEN IT WAS ROLLED BACK.\n\n` +
                `ERRORS:\n${errors.slice(-8000)}\n\n` +
                `Fix the root cause with a fresh minimal patch. ` +
                `Do not broaden scope unless dependencies truly require it.`;
    }
    ui.fail('Safe update attempts exhausted. Original project state preserved/rolled back.');
    return false;
}
