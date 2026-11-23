import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { chromium } from 'playwright';

const root = join(import.meta.dirname, '../..');

await test('create, invoice, report, and delete a session', { timeout: 30_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'fitools-e2e-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(join(root, 'examples'), dir, { recursive: true });
  // Pass the HTML through so assertions can read the document without installing WeasyPrint.
  await writeFile(join(dir, 'weasyprint'), '#!/bin/sh\nexec cat\n', { mode: 0o755 });

  const server = spawn(join(root, 'fitools'), ['serve', '--port', '0', '--no-open'], {
    cwd: dir,
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => server.kill());
  let url = '';
  for await (const line of createInterface({ input: server.stdout })) {
    url = /http:\S+/.exec(line)?.[0] ?? '';
    if (url) break;
  }
  assert.ok(url, 'server did not start');

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const field = (name: string) => page.getByLabel(name, { exact: true });

  await page.goto(url);
  await page.getByRole('button', { name: 'Add session', exact: true }).click();
  await field('Session date').fill('2026-05-29');
  await field('Student').fill('Smoke Test');
  await field('Duty start').fill('0900');
  await field('Duty end').fill('1200');
  // Flight times are UTC; duty is 09:00–12:00 in Berlin, so 07:00–10:00 UTC.
  await field('Flight 1 block off').fill('0730');
  await field('Flight 1 block on').fill('0830');
  await field('Flight 1 departure').fill('EDFE');
  await field('Flight 1 arrival').fill('EDFE');
  await field('Flight 1 registration').fill('D-EFTI');
  await page.getByRole('button', { name: 'Save session' }).click();

  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Smoke Test', exact: true }) });
  await row.waitFor();
  await page.reload();
  await row.waitFor();

  async function download(form: string) {
    const pdf = page.waitForEvent('download');
    await page
      .getByRole('form', { name: form })
      .getByRole('button', { name: 'Download PDF' })
      .click();
    return readFile(await (await pdf).path(), 'utf8');
  }

  await row.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Generate invoice…' }).click();
  await field('Invoice number').fill('2026-99');
  assert.match(await download('Generate invoice'), /Smoke Test/);

  await page.getByRole('button', { name: 'Generate duty report…' }).click();
  await field('Month').fill('2026-05');
  await field('Flight-duty total before this month').fill('12345');
  const report = await download('Generate duty report');
  assert.match(report, /<td>29<\/td><td>09:00<\/td><td>12:00<\/td>/);
  assert.match(report, /123:45/);

  await row.hover();
  await row.getByRole('button', { name: /^Delete session/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete session' }).click();
  await row.waitFor({ state: 'detached' });
  await page.reload();
  await page.getByRole('button', { name: 'Add session', exact: true }).waitFor();
  assert.equal(await row.count(), 0);
});
