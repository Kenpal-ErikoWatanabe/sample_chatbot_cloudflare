import { chromium } from 'playwright';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';

config({ path: '.env.local' });

const TARGET_URL = process.argv[2] ?? 'https://www.kenpalinc.com/careers/entry';

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log(`Inspecting: ${TARGET_URL}`);

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60_000 });

    const result = await page.evaluate(() => {
      // Method 1: innerText
      const innerText = document.body.innerText;

      // Method 2: textContent (includes hidden elements, excludes pseudo-elements)
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
      const textContent = (clone.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();

      // Method 3: snapshot of pseudo-element content around 人物像 section
      const pseudoSamples: Array<{ tag: string; cls: string; before: string; after: string; text: string }> = [];
      const allEls = document.querySelectorAll('*');
      for (const el of Array.from(allEls)) {
        const before = window.getComputedStyle(el, '::before').content;
        const after = window.getComputedStyle(el, '::after').content;
        const hasText = (el as HTMLElement).innerText?.trim();
        if (
          (before && before !== 'none' && before !== '""' && before !== "''") ||
          (after && after !== 'none' && after !== '""' && after !== "''")
        ) {
          pseudoSamples.push({
            tag: el.tagName,
            cls: el.className,
            before: before ?? '',
            after: after ?? '',
            text: (hasText ?? '').slice(0, 80),
          });
        }
      }

      // Method 4: find the 人物像 section specifically
      let humanProfileSection = '';
      const allText = Array.from(document.querySelectorAll('*'))
        .map((el) => ({ el, text: (el as HTMLElement).innerText?.trim() ?? '' }))
        .filter(({ text }) => text.includes('人物像') || text.includes('即戦力'))
        .map(({ el, text }) => `[${el.tagName}.${el.className.split(' ').join('.')}] "${text.slice(0, 200)}"`);
      humanProfileSection = allText.join('\n');

      return { innerText, textContent, pseudoSamples, humanProfileSection };
    });

    // Write output files for inspection
    writeFileSync('/tmp/debug-innerText.txt', result.innerText);
    writeFileSync('/tmp/debug-textContent.txt', result.textContent);
    writeFileSync('/tmp/debug-pseudo.json', JSON.stringify(result.pseudoSamples, null, 2));
    writeFileSync('/tmp/debug-humanProfile.txt', result.humanProfileSection);

    console.log(`\n--- innerText length: ${result.innerText.length}`);
    console.log(`--- textContent length: ${result.textContent.length}`);
    console.log(`--- pseudo-element elements found: ${result.pseudoSamples.length}`);
    console.log(`\n--- 人物像/即戦力 element matches:\n${result.humanProfileSection}`);
    console.log(`\n--- innerText around 人物像 ---`);
    const idx = result.innerText.indexOf('人物像');
    if (idx >= 0) console.log(result.innerText.slice(Math.max(0, idx - 100), idx + 500));
    console.log(`\n--- textContent around 人物像 ---`);
    const idx2 = result.textContent.indexOf('人物像');
    if (idx2 >= 0) console.log(result.textContent.slice(Math.max(0, idx2 - 100), idx2 + 500));

    console.log('\nFiles written to /tmp/debug-*.txt');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Debug failed:', err);
  process.exit(1);
});
