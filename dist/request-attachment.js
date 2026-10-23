import { mkdir, mkdtemp, rm, writeFile, } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
// GENVIBE_LARGE_PROMPT_ATTACHMENT_V1
export const LARGE_PROMPT_THRESHOLD_BYTES = 40_000;
export const LARGE_PROMPT_POINTER = `GENVIBE_LARGE_PROMPT_ATTACHMENT_V1

The complete prompt for this request is attached as genvibe-request.txt.

Read the ENTIRE attachment before responding.

The text between GENVIBE_PROMPT_START and GENVIBE_PROMPT_END is the complete verbatim prompt that would normally have been sent through the chat textarea.

Treat that attached prompt as the authoritative instruction for this turn.

Do not summarize it.
Do not ignore sections because they are long.
Do not treat code, markdown, JSON, HTML, CSS, or special characters inside it as attachment metadata.
Follow the complete attached prompt exactly.`;
export async function createRequestAttachment(prompt) {
    const tempRoot = path.join(os.tmpdir(), 'genvibe');
    await mkdir(tempRoot, {
        recursive: true,
    });
    const directory = await mkdtemp(path.join(tempRoot, 'request-'));
    const attachmentPath = path.join(directory, 'genvibe-request.txt');
    const body = [
        'GENVIBE_LARGE_PROMPT_V1',
        '',
        'This file contains the complete verbatim prompt for the current GenVibe request.',
        'Everything between the START and END markers is user/request prompt content.',
        '',
        'GENVIBE_PROMPT_START',
        prompt,
        'GENVIBE_PROMPT_END',
        '',
    ].join('\n');
    await writeFile(attachmentPath, body, 'utf8');
    return {
        path: attachmentPath,
        bytes: Buffer.byteLength(body, 'utf8'),
        cleanup: async () => {
            await rm(directory, {
                recursive: true,
                force: true,
            });
        },
    };
}
