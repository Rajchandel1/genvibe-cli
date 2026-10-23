// GENVIBE_ASK_MODE_V1
import chalk from 'chalk';
import type { Page } from 'playwright-core';

import {
  buildSmartProjectContext,
} from './smart-context.js';

import {
  sendAndWait,
} from './qwen.js';

import {
  parseAgentJson,
} from './patch-engine.js';

import {
  ui,
} from './ui.js';

interface AskResponse {
  kind: 'answer';
  answer: string;
}

function buildAskPrompt(
  question: string,
  context: string
): string {
  return `GENVIBE ASK MODE — READ ONLY

You are acting as a senior software engineering advisor.

The user is asking a question, NOT requesting a code change.

USER QUESTION:
${question}

CURRENT PROJECT CONTEXT:
${context}

RULES:
1. Answer the user's question directly and practically.
2. Use the supplied repository context when it is relevant.
3. Clearly distinguish project-specific facts from general advice.
4. If the repository context is insufficient, say what is unknown instead of inventing details.
5. You may explain architecture, databases, APIs, deployment, authentication, environment variables, debugging, setup steps, tradeoffs, best practices, and code concepts.
6. You may include example commands or code snippets inside the answer when useful.
7. DO NOT propose a GenVibe patch.
8. DO NOT modify files.
9. DO NOT return patch operations, baseHash values, context_request, or file manifests.
10. Do not claim that any command has been executed.
11. Keep the answer useful and concise unless the question requires detail.

OUTPUT CONTRACT:
Return exactly one JSON object and nothing else:

{
  "kind": "answer",
  "answer": "your complete user-facing answer here"
}

The answer field may contain Markdown.
Escape the JSON correctly.
`;
}

function normalizeAnswer(
  raw: string
): AskResponse {
  const parsed =
    parseAgentJson(raw) as
      | AskResponse
      | undefined;

  if (
    parsed &&
    parsed.kind === 'answer' &&
    typeof parsed.answer === 'string' &&
    parsed.answer.trim()
  ) {
    return {
      kind: 'answer',
      answer:
        parsed.answer.trim(),
    };
  }

  throw new Error(
    'Ask Mode received an invalid response from Qwen.'
  );
}


// GENVIBE_ASK_UI_V2

const askTerminalWidth = (): number => {
  const columns =
    process.stdout.columns ?? 80;

  return Math.max(
    56,
    Math.min(
      92,
      columns - 4
    )
  );
};

const cleanAskMarkdown = (
  value: string
): string => {
  return value
    .replace(
      /\*\*(.*?)\*\*/g,
      '$1'
    )
    .replace(
      /__(.*?)__/g,
      '$1'
    )
    .trim();
};

const renderInlineAskText = (
  value: string
): string => {
  const clean =
    cleanAskMarkdown(value);

  const parts =
    clean.split(
      /(`[^`]+`)/g
    );

  return parts
    .map((part) => {
      if (
        part.startsWith('`') &&
        part.endsWith('`')
      ) {
        return chalk.cyanBright(
          part.slice(1, -1)
        );
      }

      return chalk.white(
        part
      );
    })
    .join('');
};

const wrapAskText = (
  value: string,
  width: number
): string[] => {
  const words =
    cleanAskMarkdown(value)
      .split(/\s+/)
      .filter(Boolean);

  if (!words.length) {
    return [''];
  }

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next =
      current
        ? current + ' ' + word
        : word;

    if (
      next.length > width &&
      current
    ) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
};

const printAskRule = (
  character = '─'
): void => {
  const width =
    askTerminalWidth();

  console.log(
    chalk.greenBright(
      '  ' +
      character.repeat(
        Math.max(
          20,
          width - 2
        )
      )
    )
  );
};

const printAskWrapped = (
  text: string,
  prefix = '  │ ',
  continuation = '  │ '
): void => {
  const width =
    askTerminalWidth();

  const available =
    Math.max(
      24,
      width -
        Math.max(
          prefix.length,
          continuation.length
        ) -
        2
    );

  const lines =
    wrapAskText(
      text,
      available
    );

  lines.forEach(
    (line, index) => {
      console.log(
        chalk.greenBright(
          index === 0
            ? prefix
            : continuation
        ) +
          renderInlineAskText(
            line
          )
      );
    }
  );
};

function renderAskAnswer(
  answer: string
): void {
  console.log('');

  console.log(
    chalk.greenBright.bold(
      '  ◆ ASK RESULT'
    )
  );

  printAskRule();

  const lines =
    answer
      .replace(/\r\n/g, '\n')
      .split('\n');

  let sectionNumber = 0;

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const raw =
      lines[i] ?? '';

    const line =
      raw.trim();

    if (!line) {
      console.log('');
      continue;
    }

    const heading3 =
      line.match(
        /^###\s+(.+)$/
      );

    const heading2 =
      line.match(
        /^##\s+(.+)$/
      );

    const heading1 =
      line.match(
        /^#\s+(.+)$/
      );

    const numbered =
      line.match(
        /^(\d+)[.)]\s+(.+)$/
      );

    const bullet =
      line.match(
        /^[-*]\s+(.+)$/
      );

    if (
      heading1 ||
      heading2 ||
      heading3
    ) {
      const text =
        cleanAskMarkdown(
          (
            heading1?.[1] ??
            heading2?.[1] ??
            heading3?.[1] ??
            ''
          )
        );

      console.log('');

      console.log(
        chalk.cyanBright.bold(
          '  ◆ ' +
          text.toUpperCase()
        )
      );

      continue;
    }

    if (numbered) {
      sectionNumber++;

      const number =
        String(
          sectionNumber
        ).padStart(
          2,
          '0'
        );

      console.log('');

      console.log(
        chalk.greenBright.bold(
          '  ' +
          number +
          '  '
        ) +
          chalk.white.bold(
            cleanAskMarkdown(
              numbered[2] ?? ''
            ).toUpperCase()
          )
      );

      continue;
    }

    if (bullet) {
      const bulletText =
        cleanAskMarkdown(
          bullet[1] ?? ''
        );

      printAskWrapped(
        bulletText,
        '      › ',
        '        '
      );

      continue;
    }

    if (
      /^[-─]{3,}$/.test(
        line
      )
    ) {
      printAskRule();
      continue;
    }

    printAskWrapped(
      line,
      '      ',
      '      '
    );
  }

  console.log('');
  printAskRule();

  console.log(
    chalk.gray(
      '  READ ONLY'
    ) +
      chalk.greenBright(
        '  ●  '
      ) +
      chalk.gray(
        'No project files changed'
      )
  );

  console.log('');
}

export async function askQuestion(
  question: string,
  page: Page
): Promise<void> {
  const clean =
    question.trim();

  if (!clean) {
    ui.fail(
      'Ask Mode requires a question.'
    );

    return;
  }

  const root =
    process.cwd();

  ui.panel(
    'ASK',
    clean
  );

  const spinner =
    ui.spinner(
      'Understanding your question'
    );

  try {
    let context: string;

    try {
      const result =
        await buildSmartProjectContext(
          root,
          clean,
          []
        );

      context =
        result.context;
    } catch {
      context =
        'No repository context is available. Answer as a general software engineering question.';
    }

    spinner.text =
      'Thinking with project context';

    const raw =
      await sendAndWait(
        page,
        buildAskPrompt(
          clean,
          context
        )
      );

    const response =
      normalizeAnswer(raw);

    spinner.succeed(
      'Answer ready'
    );

    renderAskAnswer(
      response.answer
    );
  } catch (error) {
    spinner.fail(
      'Ask Mode failed'
    );

    throw error;
  }
}
