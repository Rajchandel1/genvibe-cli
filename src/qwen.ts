import type { Page } from 'playwright-core';
import { selectors, sleep } from './browser.js';
import {
  createRequestAttachment,
  LARGE_PROMPT_THRESHOLD_BYTES,
  LARGE_PROMPT_POINTER,
} from './request-attachment.js';

// GENVIBE_LARGE_PROMPT_ATTACHMENT_V1

async function uploadPromptAttachment(
  page: Page,
  attachmentPath: string
): Promise<void> {
  const fileName =
    attachmentPath
      .replaceAll('\\', '/')
      .split('/')
      .pop() ?? 'genvibe-request.txt';

  const staleRemovals =
    page.locator(
      `${selectors.uploadArea} ${selectors.uploadRemove}`
    );

  while (await staleRemovals.count()) {
    await staleRemovals
      .last()
      .click()
      .catch(() => undefined);

    await page.waitForTimeout(100);
  }

  const modeMenu =
    page.locator(selectors.modeMenu).last();

  await modeMenu.waitFor({
    state: 'visible',
    timeout: 15_000,
  });

  await modeMenu.click();

  const uploadItem =
    page
      .getByText('Upload attachment', {
        exact: true,
      })
      .last();

  await uploadItem.waitFor({
    state: 'visible',
    timeout: 15_000,
  });

  const chooserPromise =
    page.waitForEvent(
      'filechooser',
      {
        timeout: 15_000,
      }
    );

  await uploadItem.click();

  const chooser =
    await chooserPromise;

  await chooser.setFiles(
    attachmentPath
  );

  const card =
    page
      .locator(selectors.uploadArea)
      .locator(selectors.uploadItem)
      .filter({
        hasText: fileName,
      })
      .last();

  await card.waitFor({
    state: 'visible',
    timeout: 30_000,
  });

  const uploadDeadline =
    Date.now() + 90_000;

  let retries = 0;

  while (
    Date.now() <
    uploadDeadline
  ) {
    const retry =
      card.locator(
        selectors.uploadRetry
      );

    if (
      await retry.count() &&
      await retry
        .isVisible()
        .catch(() => false)
    ) {
      if (retries >= 2) {
        throw new Error(
          `${fileName} upload failed after ${retries} retries.`
        );
      }

      retries++;

      await retry.click();

      await page.waitForTimeout(
        500
      );

      continue;
    }

    const spinner =
      card.locator(
        selectors.uploadSpinner
      );

    const spinnerVisible =
      await spinner.count() > 0 &&
      await spinner
        .isVisible()
        .catch(() => false);

    if (!spinnerVisible) {
      await page.waitForTimeout(
        350
      );

      const failed =
        await retry.count() > 0 &&
        await retry
          .isVisible()
          .catch(() => false);

      if (!failed) {
        return;
      }
    }

    await page.waitForTimeout(
      250
    );
  }

  throw new Error(
    `${fileName} upload did not finish within 90 seconds.`
  );
}


export async function sendAndWait(page: Page, prompt: string, timeoutMs = 600_000): Promise<string> {
  const input = page.locator(selectors.input).last();
  await input.waitFor({ state: 'visible', timeout: 30_000 });

  const responses = page.locator(selectors.responses);
  const baselineCount = await responses.count();
  // GENVIBE_SAFE_RESPONSE_TEXT_V1
  const baselineText = baselineCount
    ? await responses
        .last()
        .textContent({ timeout: 2500 })
        .catch(() => '')
    : '';

  const baselineLen =
    (baselineText ?? '').length;

  let promptForTextarea =
    prompt;

  if (
    Buffer.byteLength(
      prompt,
      'utf8'
    ) >
    LARGE_PROMPT_THRESHOLD_BYTES
  ) {
    const attachment =
      await createRequestAttachment(
        prompt
      );

    try {
      console.log(
        `📎 Large prompt detected (${Math.ceil(
          Buffer.byteLength(
            prompt,
            'utf8'
          ) / 1024
        )} KB) — sending as attachment instead of textarea.`
      );

      await uploadPromptAttachment(
        page,
        attachment.path
      );

      promptForTextarea =
        LARGE_PROMPT_POINTER;
    } finally {
      await attachment.cleanup();
    }
  }

  await input.fill(
    promptForTextarea
  );

  const sendButton =
    page
      .locator(selectors.send)
      .last();

  await sendButton.waitFor({
    state: 'visible',
    timeout: 30_000,
  });

  const sendReadyDeadline =
    Date.now() + 45_000;

  while (
    !(await sendButton
      .isEnabled()
      .catch(() => false)) &&
    Date.now() <
      sendReadyDeadline
  ) {
    await sleep(250);
  }

  if (
    !(await sendButton
      .isEnabled()
      .catch(() => false))
  ) {
    throw new Error(
      'Qwen send button remained disabled.'
    );
  }

  await sendButton.click();

  const submitDeadline = Date.now() + 15_000;
  while (Date.now() < submitDeadline) {
    const cleared = (await input.inputValue().catch(() => 'x')) === '';
    if (cleared || (await page.locator(selectors.stop).count()) > 0) break;
    await sleep(200);
  }

  const genDeadline = Date.now() + timeoutMs;
  let stable = 0, prev = '', activity = false, bestLen = 0;
  while (Date.now() < genDeadline) {
    const resp = page.locator(selectors.responses);
    const count = await resp.count();
    const responseText = count
      ? await resp
          .last()
          .textContent({ timeout: 2500 })
          .catch(() => '')
      : '';

    const len =
      (responseText ?? '').length;
    if (len > bestLen) bestLen = len;
    const stopVisible = (await page.locator(selectors.stop).count()) > 0;
    const copyCount = await page.locator('button[aria-label="Copy" i], button[title="Copy" i]').count();
    activity ||= count > baselineCount || len !== baselineLen || copyCount > 0 || stopVisible;
    const state = `${count}:${len}:${stopVisible}:${copyCount}`;
    stable = activity && state === prev ? stable + 1 : 0;
    prev = state;

    // Generation done = stop button gayab + 6 sec stable (textContent 0 ho to bhi)
    if (activity && !stopVisible && stable >= 6) {
      
      return extractPatch(page);
    }
    if (Date.now() % 10_000 < 1000) 
    await sleep(1000);
  }
  
  return extractPatch(page);
}

async function getClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
}

async function extractBlock(blockParam: any, page: Page): Promise<string | null> {
  const block: ReturnType<Page['locator']> = blockParam;

  // STRATEGY 1: Code header ka copy icon (PROVEN — tere manual test me 24361 chars nikle the)
  try {
    const header = block.locator('.qwen-markdown-code-header').first();
    if (await header.count()) {
      await block.scrollIntoViewIfNeeded().catch(() => undefined);
      await header.hover().catch(() => undefined);
      await sleep(300);
      const copyIcon = block.locator('.qwen-markdown-code-header-action-item').first();
      if (await copyIcon.count()) {
        await copyIcon.click();
        await sleep(800);
        const copied = await getClipboard(page);
        if (copied.trim()) { return copied; }
        console.log('⚠️ Copy icon click hua but clipboard empty');
      }
    }
  } catch { /* next */ }

  // STRATEGY 2: pre code direct DOM
  const preCode = block.locator('pre code').first();
  if (await preCode.count()) {
    const t = await preCode.textContent();
    if (t?.trim()) {  return t; }
  }

  // STRATEGY 3: view-lines (visible text, partial ho sakta hai)
  const viewLines = block.locator('.view-line');
  if (await viewLines.count()) {
    const joined = (await viewLines.allTextContents()).join('\n');
    if (joined.trim()) {  return joined; }
  }

  return null;
}


// GENVIBE_QWEN_PREFER_RESPONSE_V2

function extractComparisonAgentJson(
  raw: string
): string | null {
  const text =
    raw.trim();

  if (!text) {
    return null;
  }

  for (
    let start = 0;
    start < text.length;
    start++
  ) {
    if (
      text[start] !== '{'
    ) {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (
      let i = start;
      i < text.length;
      i++
    ) {
      const ch =
        text[i];

      if (
        inString
      ) {
        if (
          escaped
        ) {
          escaped = false;
          continue;
        }

        if (
          ch === '\\'
        ) {
          escaped = true;
          continue;
        }

        if (
          ch === '"'
        ) {
          inString = false;
        }

        continue;
      }

      if (
        ch === '"'
      ) {
        inString = true;
        continue;
      }

      if (
        ch === '{'
      ) {
        depth++;
        continue;
      }

      if (
        ch === '}'
      ) {
        depth--;

        if (
          depth === 0
        ) {
          const candidate =
            text
              .slice(
                start,
                i + 1
              )
              .trim();

          try {
            const parsed =
              JSON.parse(
                candidate
              );

            const valid =
              parsed?.kind ===
                'patch' ||
              parsed?.kind ===
                'context_request' ||
              typeof parsed?.approved ===
                'boolean';

            if (
              valid
            ) {
              return candidate;
            }
          } catch {
          }

          break;
        }
      }
    }
  }

  return null;
}

async function resolveQwenComparison(
  page: Page
): Promise<void> {
  const comparison =
    page.locator(
      '.smrm-list--windows'
    );

  const comparisonCount =
    await comparison.count();

  if (
    comparisonCount < 1
  ) {
    return;
  }

  const visible =
    await comparison
      .first()
      .isVisible()
      .catch(
        () => false
      );

  if (
    !visible
  ) {
    return;
  }

  const cards =
    comparison
      .first()
      .locator(
        '.smrm-card'
      );

  const cardCount =
    await cards.count();

  if (
    cardCount < 2
  ) {
    return;
  }

  let chosenIndex = -1;

  for (
    let i = 0;
    i < cardCount;
    i++
  ) {
    const card =
      cards.nth(i);

    const response =
      card.locator(
        '.response-message-content'
      );

    if (
      !(await response.count())
    ) {
      continue;
    }

    const text =
      (
        await response
          .innerText()
          .catch(
            () => ''
          )
      ).trim();

    if (
      !text
    ) {
      continue;
    }

    const validJson =
      extractComparisonAgentJson(
        text
      );

    if (
      validJson
    ) {
      chosenIndex =
        i;
    }
  }

  if (
    chosenIndex < 0
  ) {
    console.log(
      '⚠️ Qwen comparison detected but no valid GenVibe JSON response found'
    );

    return;
  }

  const chosen =
    cards.nth(
      chosenIndex
    );

  const preferButton =
    chosen.locator(
      '.smrm-card__prefer-btn'
    );

  if (
    !(await preferButton.count())
  ) {
    console.log(
      '⚠️ Preferred comparison card found but button is missing'
    );

    return;
  }

  console.log(
    `ℹ️ Qwen comparison detected — selecting Response ${chosenIndex + 1}`
  );

  await chosen
    .scrollIntoViewIfNeeded()
    .catch(
      () => undefined
    );

  await preferButton
    .scrollIntoViewIfNeeded()
    .catch(
      () => undefined
    );

  await chosen
    .hover()
    .catch(
      () => undefined
    );

  await sleep(
    250
  );

  let clicked = false;

  try {
    await preferButton.click({
      timeout: 5000
    });

    clicked = true;
  } catch {
    try {
      await preferButton.click({
        timeout: 5000,
        force: true
      });

      clicked = true;
    } catch {
      clicked = false;
    }
  }

  if (
    !clicked
  ) {
    console.log(
      '⚠️ Could not click Qwen Prefer Response button'
    );

    return;
  }

  const deadline =
    Date.now() +
    12_000;

  while (
    Date.now() <
    deadline
  ) {
    const comparisonStillVisible =
      await page
        .locator(
          '.smrm-list--windows'
        )
        .first()
        .isVisible()
        .catch(
          () => false
        );

    if (
      !comparisonStillVisible
    ) {
      break;
    }

    await sleep(
      250
    );
  }

  await sleep(
    800
  );

  console.log(
    '✓ Qwen preferred response selected'
  );
}

export async function extractPatch(page: Page): Promise<string> {

  await resolveQwenComparison(
    page
  );

  // GENVIBE_JSON_EXTRACTOR_V4

  function isAgentJson(value: any): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }

    if (
      value.kind === 'context_request' &&
      Array.isArray(value.queries)
    ) {
      return true;
    }

    if (
      value.kind === 'patch' &&
      value.version === 1 &&
      Array.isArray(value.files)
    ) {
      return true;
    }

    if (
      typeof value.approved === 'boolean'
    ) {
      return true;
    }

    return false;
  }


  function extractStructuredJson(
    raw: string
  ): string | null {

    if (
      !raw ||
      !raw.trim()
    ) {
      return null;
    }


    const text =
      raw.trim();


    // ==========================================
    // 1. DIRECT JSON
    // ==========================================

    try {

      const parsed =
        JSON.parse(text);


      if (
        isAgentJson(parsed)
      ) {
        return text;
      }

    } catch {
      // continue
    }


    // ==========================================
    // 2. JSON INSIDE MARKDOWN FENCE
    // ==========================================

    const fence =
      String
        .fromCharCode(96)
        .repeat(3);


    const fencedPattern =
      new RegExp(
        fence +
          '(?:json)?\\s*([\\s\\S]*?)' +
          fence,
        'i'
      );


    const fenced =
      text.match(
        fencedPattern
      );


    if (
      fenced &&
      fenced[1]
    ) {

      const candidate =
        fenced[1].trim();


      try {

        const parsed =
          JSON.parse(candidate);


        if (
          isAgentJson(parsed)
        ) {
          return candidate;
        }

      } catch {
        // continue with balanced scanner
      }
    }


    // ==========================================
    // 3. BALANCED JSON SCANNER
    // ==========================================

    for (
      let start = 0;
      start < text.length;
      start++
    ) {

      if (
        text[start] !== '{'
      ) {
        continue;
      }


      let depth = 0;

      let inString =
        false;

      let escaped =
        false;


      for (
        let i = start;
        i < text.length;
        i++
      ) {

        const ch =
          text[i]!;


        if (
          inString
        ) {

          if (
            escaped
          ) {

            escaped =
              false;

            continue;
          }


          if (
            ch === '\\'
          ) {

            escaped =
              true;

            continue;
          }


          if (
            ch === '"'
          ) {

            inString =
              false;
          }


          continue;
        }


        if (
          ch === '"'
        ) {

          inString =
            true;

          continue;
        }


        if (
          ch === '{'
        ) {

          depth++;

          continue;
        }


        if (
          ch === '}'
        ) {

          depth--;


          if (
            depth === 0
          ) {

            const candidate =
              text
                .slice(
                  start,
                  i + 1
                )
                .trim();


            try {

              const parsed =
                JSON.parse(
                  candidate
                );


              if (
                isAgentJson(parsed)
              ) {
                return candidate;
              }

            } catch {
              // try next object
            }


            break;
          }
        }
      }
    }


    return null;
  }


  // ==========================================
  // LATEST QWEN RESPONSE
  // ==========================================

  const containerSelectors = [

    '.response-message-content',

    '[class*="response-message-content"]',

  ];


  let container: any =
    null;


  for (
    const selector of
    containerSelectors
  ) {

    const candidate =
      page
        .locator(selector)
        .last();


    if (
      await candidate.count()
    ) {

      container =
        candidate;

      break;
    }
  }


  if (
    !container
  ) {

    throw new Error(
      'Latest response container nahi mila.'
    );
  }


  // ==========================================
  // STRATEGY A
  // CODE BLOCKS
  // ==========================================

  const codeSelectorList = [

    '.qwen-markdown-code',

    'pre[data-language]',

    'pre code',

  ];


  let blocks: any =
    null;


  for (
    const selector of
    codeSelectorList
  ) {

    const candidate =
      container.locator(
        selector
      );


    if (
      await candidate.count()
    ) {

      blocks =
        candidate;

      break;
    }
  }


  if (
    blocks
  ) {

    await page
      .context()
      .grantPermissions(

        [
          'clipboard-read',
          'clipboard-write',
        ],

        {
          origin:
            'https://chat.qwen.ai',
        }

      )
      .catch(
        () => undefined
      );


    const chunks:
      string[] = [];


    const total =
      await blocks.count();


    for (
      let i = 0;
      i < total;
      i++
    ) {

      const value =
        await extractBlock(
          blocks.nth(i),
          page
        );


      if (
        value &&
        value.trim()
      ) {

        chunks.push(
          value.trim()
        );
      }
    }


    if (
      chunks.length
    ) {

      // ========================================
      // STRUCTURED JSON GETS PRIORITY
      // ========================================

      for (
        const chunk of
        chunks
      ) {

        const structured =
          extractStructuredJson(
            chunk
          );


        if (
          structured
        ) {


          return structured;
        }
      }


      // ========================================
      // LEGACY CREATE/FIX PATCH
      // ========================================

      if (
        chunks.length === 1
      ) {

        return chunks[0]!;
      }


      const valid =
        chunks.filter(

          (chunk) =>

            chunk.includes(
              'writeFile'
            ) &&

            /main\s*\(/.test(
              chunk
            )

        );


      return (

        valid.length
          ? valid
          : chunks

      ).reduce(

        (a, b) =>
          b.length > a.length
            ? b
            : a

      );
    }
  }


  // ==========================================
  // STRATEGY B
  // RAW RESPONSE TEXT
  // ==========================================

  const candidates:
    string[] = [];


  const inner =
    await container
      .innerText()
      .catch(
        () => ''
      );


  if (
    inner.trim()
  ) {

    candidates.push(
      inner
    );
  }


  const textContent =
    await container
      .textContent()
      .catch(
        () => ''
      );


  if (
    textContent &&
    textContent.trim() &&
    textContent.trim() !==
      inner.trim()
  ) {

    candidates.push(
      textContent
    );
  }


  // ==========================================
  // STRATEGY C
  // NESTED MARKDOWN
  // ==========================================

  const nestedSelectors = [

    '.markdown-body',

    '[class*="markdown"]',

    '[class*="message-content"]',

  ];


  for (
    const selector of
    nestedSelectors
  ) {

    const nested =
      container
        .locator(selector)
        .last();


    if (
      !(await nested.count())
    ) {

      continue;
    }


    const nestedInner =
      await nested
        .innerText()
        .catch(
          () => ''
        );


    if (
      nestedInner.trim()
    ) {

      candidates.push(
        nestedInner
      );
    }


    const nestedText =
      await nested
        .textContent()
        .catch(
          () => ''
        );


    if (
      nestedText &&
      nestedText.trim()
    ) {

      candidates.push(
        nestedText
      );
    }
  }


  // ==========================================
  // STRATEGY D
  // EXISTING RESPONSE SELECTOR FALLBACK
  // ==========================================

  const broad =
    page
      .locator(
        selectors.responses
      )
      .last();


  if (
    await broad.count()
  ) {

    const broadInner =
      await broad
        .innerText()
        .catch(
          () => ''
        );


    if (
      broadInner.trim()
    ) {

      candidates.push(
        broadInner
      );
    }


    const broadText =
      await broad
        .textContent()
        .catch(
          () => ''
        );


    if (
      broadText &&
      broadText.trim()
    ) {

      candidates.push(
        broadText
      );
    }
  }


  // ==========================================
  // DEDUPE
  // ==========================================

  const unique = [

    ...new Set(

      candidates

        .map(
          (x) =>
            x.trim()
        )

        .filter(
          Boolean
        )

    ),

  ];


  // ==========================================
  // FIND STRUCTURED JSON
  // ==========================================

  for (
    const raw of
    unique
  ) {

    const structured =
      extractStructuredJson(
        raw
      );


    if (
      structured
    ) {


      return structured;
    }
  }


  // ==========================================
  // DEBUG PREVIEW
  // ==========================================

  const preview =
    unique

      .map(
        (x) =>
          x
            .replace(
              /\s+/g,
              ' '
            )
            .slice(
              0,
              180
            )
      )

      .filter(
        Boolean
      )

      .slice(
        0,
        3
      )

      .join(
        ' || '
      );


  

    // ==========================================
    // STRATEGY E
    // QWEN LATEST RESPONSE COPY FALLBACK
    // GENVIBE_QWEN_RESPONSE_COPY_FALLBACK_V3
    // ==========================================

    try {

      await page
        .context()
        .grantPermissions(
          [
            'clipboard-read',
            'clipboard-write',
          ],
          {
            origin: 'https://chat.qwen.ai',
          }
        )
        .catch(
          () => undefined
        );


      const assistantMessages =
        page.locator(
          '.qwen-chat-message.qwen-chat-message-assistant'
        );


      const assistantCount =
        await assistantMessages.count();


      if (
        assistantCount > 0
      ) {

        const latestAssistant =
          assistantMessages.last();


        await latestAssistant
          .scrollIntoViewIfNeeded()
          .catch(
            () => undefined
          );


        await latestAssistant
          .hover()
          .catch(
            () => undefined
          );


        await sleep(
          200
        );


        const copySelectors = [

          '.response-message-footer button[aria-label="Copy" i]',

          'button.qwen-chat-package-comp-new-action-control-container-copy[aria-label="Copy" i]',

          'button[aria-label="Copy" i]',

        ];


        let copyButton:
          any = null;


        for (
          const selector of copySelectors
        ) {

          const candidate =
            latestAssistant
              .locator(selector)
              .last();


          if (
            await candidate.count()
          ) {

            copyButton =
              candidate;

            break;
          }
        }


        if (
          copyButton
        ) {

          // Clipboard ko clear karne ki koshish.
          // Agar permission allow nahi karti to ignore.

          await page
            .evaluate(
              async () => {

                try {

                  await navigator
                    .clipboard
                    .writeText('');

                } catch {
                  // ignore
                }

              }
            )
            .catch(
              () => undefined
            );


          await sleep(
            100
          );


          let clicked =
            false;


          try {

            await copyButton.click({
              timeout: 5000,
            });


            clicked =
              true;

          } catch {

            try {

              await latestAssistant
                .hover();


              await sleep(
                250
              );


              await copyButton.click({
                timeout: 5000,
                force: true,
              });


              clicked =
                true;

            } catch {
              // normal final extractor error continue karega
            }
          }


          if (
            clicked
          ) {

            let copied =
              '';


            for (
              let attempt = 0;
              attempt < 10;
              attempt++
            ) {

              await sleep(
                attempt === 0
                  ? 300
                  : 200
              );


              copied =
                await getClipboard(
                  page
                )
                .catch(
                  () => ''
                );


              if (
                copied.trim()
              ) {

                break;
              }
            }


            if (
              copied.trim()
            ) {

              const normalized =
                copied.trim();


              // Existing JSON parser first.
              const structured =
                extractStructuredJson(
                  normalized
                );


              if (
                structured
              ) {


                return structured;
              }


              // Legacy TypeScript patch response.
              if (
                normalized.includes(
                  'writeFile'
                ) &&
                /main\s*\(/.test(
                  normalized
                )
              ) {

                console.log(
                  '✅ Qwen footer Copy fallback: executable patch copied'
                );


                return normalized;
              }


              // User-requested final behavior:
              // fenced block nahi mila but Qwen ka
              // own Copy button response de raha hai.

              console.log(
                '⚠️ Qwen footer Copy fallback used'
              );


              return normalized;
            }


            console.log(
              'Qwen Copy action completed, but the clipboard was empty'
            );

          } else {

            console.log(
              '⚠️ Latest response Copy button click nahi hua'
            );
          }

        } else {

          console.log(
            'Latest assistant response did not expose a Copy action'
          );
        }

      } else {

        console.log(
          'Qwen assistant response container was not found'
        );
      }

    } catch (
      error
    ) {

      console.log(
        '⚠️ Qwen footer Copy fallback error:',
        error instanceof Error
          ? error.message
          : String(error)
      );
    }


throw new Error(

    'Latest response me koi valid code block ya agent JSON nahi mila.' +

    (
      preview
        ? ' Response preview: ' +
          preview
        : ' Response text empty tha.'
    )

  );
}
