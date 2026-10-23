// GENVIBE_TERMINAL_UI_V2
import chalk from 'chalk';
import Ora from 'ora';
const WIDTH = 64;
const stripAnsi = (value) => value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
const visibleLength = (value) => stripAnsi(value).length;
const padRight = (value, width) => {
    return (value +
        ' '.repeat(Math.max(0, width - visibleLength(value))));
};
const border = (left, fill, right, color = 'green') => {
    const value = left +
        fill.repeat(WIDTH) +
        right;
    if (color === 'cyan') {
        return chalk.cyan(value);
    }
    if (color === 'yellow') {
        return chalk.yellow(value);
    }
    if (color === 'red') {
        return chalk.red(value);
    }
    return chalk.greenBright(value);
};
const row = (content = '', color = 'green') => {
    const body = '│' +
        padRight(' ' + content, WIDTH) +
        '│';
    if (color === 'cyan') {
        return chalk.cyan(body);
    }
    if (color === 'yellow') {
        return chalk.yellow(body);
    }
    if (color === 'red') {
        return chalk.red(body);
    }
    return chalk.greenBright(body);
};
const WORK_TEXTS = [
    'Scanning project structure',
    'Reading current source of truth',
    'Mapping relevant dependencies',
    'Planning the smallest safe change',
    'Validating exact source anchors',
    'Checking regression boundaries',
    'Preparing a surgical patch',
    'Keeping unrelated code untouched',
    'Reviewing impact across the project',
    'Running safety checks',
    'Synchronizing context with Qwen',
    'Verifying the final change set',
];
const REPAIR_TEXTS = [
    'Inspecting the failure',
    'Tracing the conflicting source',
    'Re-reading current file state',
    'Rejecting stale assumptions',
    'Building a safer repair plan',
    'Checking rollback integrity',
    'Validating corrected anchors',
];
function statusLabel(label, value) {
    return (chalk.gray(label.padEnd(12)) +
        chalk.white(value));
}
export const ui = {
    banner() {
        console.log('');
        console.log(border('┌', '─', '┐', 'green'));
        console.log(row(chalk.greenBright.bold('◆ GENVIBE') +
            chalk.gray('  //  AGENT CONSOLE')));
        console.log(row(chalk.gray('AI-powered repository engineering')));
        console.log(border('├', '─', '┤', 'green'));
        console.log(row(statusLabel('ENGINE', 'Qwen') +
            chalk.gray('   ') +
            statusLabel('STATUS', chalk.greenBright('ONLINE'))));
        console.log(row(statusLabel('MODE', 'Safe Engineering')));
        console.log(border('└', '─', '┘', 'green'));
        console.log('');
    },
    panel(title, body) {
        const cleanTitle = title
            .replaceAll('_', ' ')
            .toUpperCase();
        console.log('');
        console.log(border('┌', '─', '┐', 'cyan'));
        console.log(row(chalk.cyanBright.bold('◆ ' + cleanTitle), 'cyan'));
        console.log(border('├', '─', '┤', 'cyan'));
        const chunks = body.length > 0
            ? body.match(new RegExp('.{1,' +
                (WIDTH - 3) +
                '}(?:\\s+|$)', 'g')) ?? [body]
            : [''];
        for (const chunk of chunks) {
            console.log(row(chalk.white(chunk.trim()), 'cyan'));
        }
        console.log(border('└', '─', '┘', 'cyan'));
        console.log('');
    },
    step(icon, msg) {
        console.log(chalk.greenBright('  ' + icon) +
            ' ' +
            chalk.white(msg));
    },
    success(msg) {
        console.log(chalk.greenBright('  ✓ ') +
            chalk.white(msg));
    },
    fail(msg) {
        console.log(chalk.redBright('  ✕ ') +
            chalk.white(msg));
    },
    info(msg) {
        console.log(chalk.gray('  │ ') +
            chalk.gray(msg));
    },
    warning(msg) {
        console.log(chalk.yellowBright('  ! ') +
            chalk.white(msg));
    },
    phase(title) {
        console.log('');
        console.log(chalk.greenBright('  ┌─ ') +
            chalk.greenBright.bold(title.toUpperCase()));
    },
    detail(label, value) {
        console.log(chalk.greenBright('  │ ') +
            chalk.gray(label.padEnd(14)) +
            chalk.white(value));
    },
    endPhase() {
        console.log(chalk.greenBright('  └────────────────────────────────────────'));
    },
    spinner(text) {
        const repairMode = /fix|repair|error|rollback|conflict/i.test(text);
        const pool = repairMode
            ? REPAIR_TEXTS
            : WORK_TEXTS;
        let index = 0;
        const spinner = Ora({
            text: chalk.white(text) +
                chalk.gray('  ·  ' + pool[0]),
            spinner: 'dots',
            color: repairMode
                ? 'yellow'
                : 'green',
            prefixText: chalk.greenBright('  ◆'),
        }).start();
        const timer = setInterval(() => {
            index =
                (index + 1) %
                    pool.length;
            spinner.text =
                chalk.white(text) +
                    chalk.gray('  ·  ' +
                        pool[index]);
        }, 3200);
        return {
            succeed(msg) {
                clearInterval(timer);
                spinner.succeed(chalk.greenBright(msg ?? 'Completed'));
            },
            fail(msg) {
                clearInterval(timer);
                spinner.fail(chalk.redBright(msg ?? 'Failed'));
            },
            stop() {
                clearInterval(timer);
                spinner.stop();
            },
            set text(value) {
                spinner.text =
                    chalk.white(value);
            },
        };
    },
};
