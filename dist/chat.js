import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import fs from 'node:fs';
import chalk from 'chalk';
import { connect } from './browser.js';
import { sendAndWait } from './qwen.js';
import { createPrompt, fixPrompt } from './prompts.js';
import { runPatch, verify } from './runner.js';
import { ui } from './ui.js';
import { saveLastPatch } from './state.js';
import { buildProjectContext } from './context.js';
import { takeSnapshot } from './backup.js';
const MAX_FIX_ATTEMPTS = 5;
async function doCreate(rl, request, page, browser) {
    const root = process.cwd();
    const existing = fs.readdirSync(root).filter((f) => f !== '.gv');
    if (existing.length) {
        ui.fail('Create mode requires an empty folder. Use update mode for an existing project.');
        return;
    }
    const s1 = ui.spinner('Asking Qwen to design the project');
    let patch;
    try {
        patch = await sendAndWait(page, createPrompt(request));
    }
    catch (e) {
        s1.fail(String(e instanceof Error ? e.message : e));
        return;
    }
    s1.succeed('Project patch received');
    await saveLastPatch(patch);
    let attempt = 0;
    while (true) {
        attempt++;
        const s2 = ui.spinner(`Applying project patch (attempt ${attempt}/${MAX_FIX_ATTEMPTS})`);
        try {
            await runPatch(root, patch);
            s2.succeed('Project files written');
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            s2.fail('Patch execution fail');
            if (attempt >= MAX_FIX_ATTEMPTS) {
                ui.fail('Max attempts.');
                return;
            }
            const s3 = ui.spinner('Qwen is preparing a repair');
            patch = await sendAndWait(page, fixPrompt(patch, msg));
            s3.succeed('Repair patch received');
            continue;
        }
        const s4 = ui.spinner('Install, build & test');
        const errors = await verify(root);
        if (!errors) {
            s4.succeed('Build & tests pass!');
            console.log(chalk.green.bold('  🎉 Project ready!'));
            return;
        }
        s4.fail('Build/test fail');
        if (attempt >= MAX_FIX_ATTEMPTS) {
            ui.fail('Max attempts — errors:');
            errors.split('\n').slice(-8).forEach((l) => ui.info(l));
            return;
        }
        const s5 = ui.spinner('Errors Qwen ko bheje ja rahe hain');
        patch = await sendAndWait(page, fixPrompt(patch, errors));
        await saveLastPatch(patch);
        s5.succeed('Fix patch mil gaya');
    }
}
async function doFix(errorText, page) {
    const root = process.cwd();
    await takeSnapshot(root, 'fix: ' + errorText.slice(0, 40));
    const s = ui.spinner('Error Qwen ko bheja ja raha hai');
    let patch;
    const context = await buildProjectContext(root);
    try {
        patch = await sendAndWait(page, fixPrompt(errorText + '\n\nCURRENT PROJECT CONTEXT:\n' + context, errorText));
    }
    catch (e) {
        s.fail(String(e instanceof Error ? e.message : e));
        return;
    }
    s.succeed('Fix patch mil gaya');
    await saveLastPatch(patch);
    let attempt = 0;
    while (true) {
        attempt++;
        const s2 = ui.spinner(`Patch run ho raha hai (attempt ${attempt})`);
        try {
            await runPatch(root, patch);
            s2.succeed('Files update ho gayi');
        }
        catch (e) {
            const msg = String(e instanceof Error ? e.message : e);
            s2.fail('Patch fail');
            if (attempt >= MAX_FIX_ATTEMPTS) {
                ui.fail('Max attempts.');
                return;
            }
            patch = await sendAndWait(page, fixPrompt(patch, msg));
            continue;
        }
        const s3 = ui.spinner('Build & test verify');
        const errors = await verify(root);
        if (!errors) {
            s3.succeed('Verify pass! ✨');
            return;
        }
        s3.fail('Verify fail');
        if (attempt >= MAX_FIX_ATTEMPTS) {
            ui.fail('Max attempts.');
            return;
        }
        patch = await sendAndWait(page, fixPrompt(patch, errors));
    }
}
async function doUpdate(_rl, request, page, _browser) {
    const { runSafeUpdate } = await import('./update-engine.js');
    await runSafeUpdate(request, page);
}
export async function chatCommand() {
    if (!stdin.isTTY) {
        ui.fail('Chat mode ke liye interactive terminal chahiye.');
        process.exit(1);
    }
    const rl = readline.createInterface({ input: stdin, output: stdout, historySize: 100 });
    ui.banner();
    console.log(chalk.gray('  Chat mode — type karo, genvibe kaam karega.'));
    console.log('  ' + chalk.cyan('/update <req>') + chalk.gray('   existing project me change'));
    console.log('  ' + chalk.cyan('/ask <question>') + chalk.gray('   read-only project advice'));
    console.log('  ' + chalk.cyan('/dry-run <req>') + chalk.gray('   (real preview — files modify nahi honge)'));
    console.log('  ' + chalk.cyan('/fix <error>') + chalk.gray('     error paste karo, fix karwayo'));
    console.log('  ' + chalk.cyan('/undo') + chalk.gray('           last snapshot pe revert'));
    console.log('  ' + chalk.cyan('/new-chat') + chalk.gray('       Qwen fresh chat'));
    console.log('  ' + chalk.cyan('/exit') + chalk.gray('           bahar niklo'));
    console.log('');
    const { browser, page } = await connect();
    ui.success('Qwen connected. Agent console ready.');
    const handleSigint = () => { rl.close(); };
    process.once('SIGINT', handleSigint);
    try {
        while (true) {
            let answer;
            try {
                answer = await rl.question(chalk.magentaBright('genvibe> '));
            }
            catch {
                break;
            }
            const input = answer.trim();
            if (!input)
                continue;
            if (/^\/(exit|quit)$/i.test(input))
                break;
            try {
                if (/^\/undo$/i.test(input)) {
                    const { restoreLatestSafeSnapshot } = await import('./safe-snapshot.js');
                    let label = await restoreLatestSafeSnapshot(process.cwd());
                    if (!label) {
                        const { restoreLatest } = await import('./backup.js');
                        label =
                            await restoreLatest(process.cwd());
                    }
                    if (label) {
                        ui.success(`Revert: ${label}`);
                    }
                    else {
                        ui.fail('No snapshot was found to restore.');
                    }
                }
                else if (/^\/new-chat$/i.test(input)) {
                    const { startNewChat } = await import('./browser.js');
                    await startNewChat(page);
                    ui.success('Fresh chat ready.');
                }
                else if (/^\/fix\s+/i.test(input)) {
                    await doFix(input.replace(/^\/fix\s+/i, ''), page);
                }
                else if (!input.startsWith('/') && input.length > 40 && /error|exception|TypeError|Cannot|failed/i.test(input)) {
                    ui.info('Detected an error report — switching to repair mode.');
                    await doFix(input, page);
                }
                else if (/^\/(dry-run|preview)\s+/i.test(input)) {
                    const { runSafeUpdate } = await import('./update-engine.js');
                    await runSafeUpdate(input.replace(/^\/(?:dry-run|preview)\s+/i, ''), page, { dryRun: true });
                }
                // GENVIBE_ASK_MODE_V1
                else if (/^\/ask\s+/i.test(input)) {
                    const question = input
                        .replace(/^\/ask\s+/i, '')
                        .trim();
                    if (!question) {
                        ui.fail('Usage: /ask <your question>');
                    }
                    else {
                        const { askQuestion } = await import('./ask.js');
                        await askQuestion(question, page);
                    }
                }
                else if (/^\/update\s+/i.test(input)) {
                    await doUpdate(rl, input.replace(/^\/update\s+/i, ''), page, browser);
                }
                else {
                    await doCreate(rl, input, page, browser);
                }
            }
            catch (e) {
                ui.fail(e instanceof Error ? e.message : String(e));
            }
        }
    }
    finally {
        process.off('SIGINT', handleSigint);
        rl.close();
        await browser.close();
    }
}
