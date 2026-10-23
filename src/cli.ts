#!/usr/bin/env node

import path from 'node:path';

import fs from 'node:fs';

import chalk from 'chalk';

import { select, input } from '@inquirer/prompts';

import { connect } from './browser.js';

import { sendAndWait } from './qwen.js';

import { createPrompt, fixPrompt } from './prompts.js';

import { runPatch, verify } from './runner.js';

import { ui } from './ui.js';

import { saveLastPatch, loadState } from './state.js';

import { buildProjectContext } from './context.js';

import { updatePrompt } from './prompts.js';



const MAX_FIX_ATTEMPTS = 5;







// GENVIBE_ARROW_LAUNCHER_V2

type LauncherAction =
  | 'create'
  | 'update'
  | 'ask'
  | 'undo'
  | 'help'
  | 'exit';

function printHelp(): void {
  ui.banner();

  console.log(chalk.greenBright.bold('  ◆ GENVIBE COMMANDS'));
  console.log(chalk.greenBright('  ─────────────────────────────────────────────────────────'));
  console.log('');

  const command = (
    name: string,
    description: string,
    example?: string
  ): void => {
    console.log('  ' + chalk.cyanBright.bold(name));
    console.log('      ' + chalk.white(description));

    if (example) {
      console.log('      ' + chalk.gray('Example: ') + chalk.cyan(example));
    }

    console.log('');
  };

  command(
    'genvibe',
    'Open the interactive command center.'
  );

  command(
    'genvibe "<prompt>"',
    'Create a new project inside an empty folder.',
    'genvibe "create a modern billing dashboard"'
  );

  command(
    'genvibe update "<request>"',
    'Safely modify the current project.',
    'genvibe update "add a dark mode toggle"'
  );

  command(
    'genvibe ask "<question>"',
    'Ask project-aware questions without changing files.',
    'genvibe ask "which database fits this app?"'
  );

  command(
    'genvibe undo',
    'Restore the latest available safe snapshot.'
  );

  command(
    'genvibe dry-run "<request>"',
    'Preview a safe update without writing project files.',
    'genvibe dry-run "move actions into the navbar"'
  );

  command(
    'genvibe chat',
    'Open GenVibe interactive chat mode.'
  );

  command(
    'genvibe new-chat',
    'Start a fresh Qwen conversation.'
  );

  command(
    'genvibe help',
    'Show this command guide.'
  );

  console.log(chalk.greenBright('  ─────────────────────────────────────────────────────────'));
  console.log(chalk.gray('  Tip: run only "genvibe" whenever you are unsure what to do.'));
  console.log('');
}

async function openLauncher(): Promise<
  | {
      args: string[];
      command: string;
    }
  | null
> {
  ui.banner();

  console.log(chalk.greenBright.bold('  ◆ GENVIBE // COMMAND CENTER'));
  console.log(chalk.gray('  Use ↑ ↓ to move and Enter to select.'));
  console.log('');

  let action: LauncherAction;

  try {
    action = await select<LauncherAction>({
      message: 'What do you want to do?',
      pageSize: 6,
      choices: [
        {
          name: 'Create Project',
          value: 'create',
          description: 'Build something new inside an empty folder',
        },
        {
          name: 'Update Project',
          value: 'update',
          description: 'Safely modify the current project',
        },
        {
          name: 'Ask GenVibe',
          value: 'ask',
          description: 'Ask questions without changing project files',
        },
        {
          name: 'Undo Last Change',
          value: 'undo',
          description: 'Restore the latest safe snapshot',
        },
        {
          name: 'Help & Commands',
          value: 'help',
          description: 'See available commands and examples',
        },
        {
          name: 'Exit',
          value: 'exit',
          description: 'Close GenVibe',
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'ExitPromptError') {
      console.log('');
      return null;
    }

    throw error;
  }

  if (action === 'exit') {
    console.log('');
    console.log(chalk.gray('  GenVibe closed.'));
    console.log('');
    return null;
  }

  if (action === 'help') {
    return {
      command: 'help',
      args: ['help'],
    };
  }

  if (action === 'undo') {
    return {
      command: 'undo',
      args: ['undo'],
    };
  }

  if (action === 'create') {
    const request = (
      await input({
        message: 'What do you want to build?',
        required: true,
      })
    ).trim();

    if (!request) {
      return null;
    }

    return {
      command: request,
      args: [request],
    };
  }

  if (action === 'update') {
    const request = (
      await input({
        message: 'What should GenVibe change?',
        required: true,
      })
    ).trim();

    if (!request) {
      return null;
    }

    return {
      command: 'update',
      args: ['update', request],
    };
  }

  const question = (
    await input({
      message: 'Ask GenVibe',
      required: true,
    })
  ).trim();

  if (!question) {
    return null;
  }

  return {
    command: 'ask',
    args: ['ask', question],
  };
}

async function main(): Promise<void> {

  let args = process.argv.slice(2);

  let command = args[0] ?? '';



  if (!command) {

    const selection =

      await openLauncher();



    if (!selection) {

      process.exit(0);

    }



    args = selection.args;

    command = selection.command;

  }



  if (

    command === 'help' ||

    command === '--help' ||

    command === '-h'

  ) {

    printHelp();

    process.exit(0);

  }



  if (command === 'chat') {

    const { chatCommand } = await import('./chat.js');

    await chatCommand();

    process.exit(0);

  }





  // GENVIBE_ASK_MODE_V1

  if (command === 'ask') {

    const question =

      args.slice(1).join(' ').trim();



    if (!question) {

      ui.fail(

        'Usage: gv ask <your question>'

      );

      process.exit(1);

    }



    ui.banner();



    const { browser, page } =

      await connect();



    try {

      const { askQuestion } =

        await import('./ask.js');



      await askQuestion(

        question,

        page

      );

    } finally {

      await browser

        .close()

        .catch(() => undefined);

    }



    process.exit(0);

  }





  if (command === 'new-chat') {

    const { page, browser } = await connect();

    const { startNewChat } = await import('./browser.js');

    await startNewChat(page);

    await browser.close();

    ui.success('Fresh chat ready.');

    process.exit(0);

  }



  if (command === 'undo') {

    const {

      restoreLatestSafeSnapshot

    } = await import('./safe-snapshot.js');



    let label =

      await restoreLatestSafeSnapshot(

        process.cwd()

      );



    if (!label) {

      const { restoreLatest } =

        await import('./backup.js');



      label =

        await restoreLatest(

          process.cwd()

        );

    }



    if (label) {

      ui.success(`Revert: ${label}`);

    } else {

      ui.fail('No snapshot was found to restore.');

    }



    process.exit(label ? 0 : 1);

  }





  if (

    command === 'update' ||

    command === 'dry-run'

  ) {

    const updateRequest =

      args.slice(1).join(' ');



    if (!updateRequest) {

      ui.fail(

        `Usage: gv ${command} <describe the change>`

      );

      process.exit(1);

    }



    const root = process.cwd();



    if (

      !fs.existsSync(

        path.join(root, 'package.json')

      ) &&

      !fs.existsSync(

        path.join(root, 'index.html')

      )

    ) {

      ui.fail(

        'Run this command inside an existing project folder. For a new project, use: gv <prompt>'

      );

      process.exit(1);

    }



    ui.banner();



    ui.panel(

      command === 'dry-run'

        ? 'DRY RUN'

        : 'SAFE UPDATE',

      updateRequest

    );



    const { browser, page } =

      await connect();



    try {

      const { runSafeUpdate } =

        await import('./update-engine.js');



      const ok =

        await runSafeUpdate(

          updateRequest,

          page,

          {

            dryRun:

              command === 'dry-run'

          }

        );



      if (!ok) {

        process.exitCode = 2;

      }

    } finally {

      await browser

        .close()

        .catch(() => undefined);

    }



    process.exit(

      process.exitCode ?? 0

    );

  }





  const request = args.join(' ');

  if (!request) {

    ui.banner();

    console.log('  ' + chalk.bold('Usage:'));

    console.log('  ' + chalk.cyan('gv <prompt>') + chalk.gray('        naya project banao (empty folder me)'));

    console.log('  ' + chalk.cyan('gv update <request>') + chalk.gray('  existing project me changes'));

    console.log('  ' + chalk.cyan('gv ask <question>') + chalk.gray('  read-only project advice'));

    console.log('  ' + chalk.cyan('gv dry-run <request>') + chalk.gray(' preview safe patch, no writes'));

    console.log('  ' + chalk.cyan('gv new-chat') + chalk.gray('      Qwen me fresh chat'));

    console.log('');

    process.exit(1);

  }



  ui.banner();

  ui.panel('REQUEST', request);

  const root = process.cwd();



  // Empty folder check

  const existing = fs.readdirSync(root).filter((f) => f !== '.gv');

  if (existing.length) {

    ui.fail('Folder empty nahi hai — fresh folder me chalao (create mode hai ye).');

    process.exit(1);

  }



  const { browser, page } = await connect();

  const s1 = ui.spinner('Qwen se baat ho rahi hai');

  let patch: string;

  try {

    patch = await sendAndWait(page, createPrompt(request));

  } finally {

    s1.succeed('Patch file mil gayi');

  }

  await saveLastPatch(patch);



  let attempt = 0;

  while (true) {

    attempt++;



    // PATCH RUN

    const s2 = ui.spinner(`Patch run ho raha hai (attempt ${attempt}/${MAX_FIX_ATTEMPTS})`);

    try {

      await runPatch(root, patch);

      s2.succeed('Files likh di gayi');

    } catch (patchError) {

      const msg = String(patchError instanceof Error ? patchError.message : patchError);

      s2.fail('Patch execution fail');

      ui.info(msg.split('\n').slice(-5).join('\n'));

      if (attempt >= MAX_FIX_ATTEMPTS) { ui.fail('Max attempts — manual dekh le bhai.'); process.exitCode = 2; break; }

      const s3 = ui.spinner('Qwen se fix karwaya ja raha hai');

      patch = await sendAndWait(page, fixPrompt(patch, msg));

      await saveLastPatch(patch);

      s3.succeed('Naya patch mil gaya');

      continue;

    }



    // INSTALL + BUILD + TEST

    const s4 = ui.spinner('Install, build aur test ho rahe hain');

    const errors = await verify(root);



    if (!errors) {

      s4.succeed('Build & tests pass! 🎉');

      console.log('');

      console.log(chalk.green.bold('  🎉 Project ready bhai! Chal dekh le:'));

      console.log(chalk.gray('  → files: ') + chalk.white(root));

      const pkgPath = path.join(root, 'package.json');

      if (fs.existsSync(pkgPath)) {

        try {

          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

          if (pkg.scripts?.dev) console.log(chalk.gray('  → run with: ') + chalk.cyan('npm run dev'));

          else if (pkg.scripts?.start) console.log(chalk.gray('  → run with: ') + chalk.cyan('npm start'));

        } catch { /* ignore */ }

      }

      console.log('');

      break;

    }



    s4.fail('Build or test verification failed');

    console.log(chalk.red('  ✖ Errors (last lines):'));

    errors.split('\n').slice(-8).forEach((line) => console.log(chalk.gray('    ' + line)));



    if (attempt >= MAX_FIX_ATTEMPTS) {

      ui.fail(`${MAX_FIX_ATTEMPTS} attempts me nahi hua — thoda manual pyaar de is project ko.`);

      process.exitCode = 2;

      break;

    }



    const s5 = ui.spinner('Sending verification errors to Qwen');

    patch = await sendAndWait(page, fixPrompt(patch, errors));

    await saveLastPatch(patch);

    s5.succeed('Repair patch received');

  }



  await browser.close();

}



main().catch((e: unknown) => {

  ui.fail(e instanceof Error ? e.message : String(e));

  process.exit(1);

});
