import { chromium } from 'playwright';
import { config } from 'dotenv';
import { extractText } from './extract';
import { uploadToR2 } from './upload-to-r2';

// Load environment variables from .env.local
config({ path: '.env.local' });

const BASE_URL = 'https://www.kenpalinc.com';
const DELAY_MS = 500;

/** File extensions to skip */
const EXCLUDED_EXTENSIONS = /\.(pdf|png|jpg|jpeg|gif|svg|webp)(\?.*)?$/i;

/** Derive a short filename from a URL path, e.g. /about -> about.txt */
function pathToFilename(urlString: string): string {
  const url = new URL(urlString);
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (pathname === '/') return 'index.txt';
  // Strip leading slash and replace remaining slashes with underscores
  return pathname.replace(/^\//, '').replace(/\//g, '_') + '.txt';
}

/** Determine whether a URL is an internal link we should crawl */
function isInternalCrawlable(href: string, base: string): boolean {
  try {
    const resolved = new URL(href, base);
    if (resolved.origin !== new URL(base).origin) return false;
    if (EXCLUDED_EXTENSIONS.test(resolved.pathname)) return false;
    if (resolved.hash && resolved.pathname === new URL(base).pathname) return false;
    return true;
  } catch {
    return false;
  }
}

/** Normalise a URL by removing hash fragments and trailing slashes */
function normalise(urlString: string): string {
  const url = new URL(urlString);
  url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.href;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const visited = new Set<string>();
  const queue: string[] = [normalise(BASE_URL)];

  console.log(`Starting crawl of ${BASE_URL}`);

  try {
    while (queue.length > 0) {
      const url = queue.shift()!;

      if (visited.has(url)) continue;
      visited.add(url);

      console.log(`Crawling: ${url}`);

      const page = await browser.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

        // Extract page title
        const title = await page.title();

        // 見出し構造を保ったまま抽出（h1-h6 は # プレフィックス付きで出力）
        const text = await page.evaluate(() => {
          const clone = document.body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('script, style, noscript').forEach((el) => el.remove());

          const lines: string[] = [];

          function walk(node: Node): void {
            if (node.nodeType === Node.TEXT_NODE) {
              const t = (node.textContent ?? '').trim();
              if (t) lines.push(t);
              return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const el = node as Element;
            const tag = el.tagName.toLowerCase();

            // 見出しは Markdown 形式で1行にまとめる（再帰しない）
            const headingMatch = tag.match(/^h([1-6])$/);
            if (headingMatch) {
              const t = (el.textContent ?? '').trim();
              if (t) lines.push('\n' + '#'.repeat(Number(headingMatch[1])) + ' ' + t);
              return;
            }

            // ブロック要素は textContent をそのまま1行で
            if (['p', 'li', 'dt', 'dd', 'blockquote', 'td', 'th'].includes(tag)) {
              const t = (el.textContent ?? '').trim();
              if (t) lines.push(t);
              return;
            }

            // それ以外（div, section, span など）は再帰
            for (const child of Array.from(el.childNodes)) {
              walk(child);
            }
          }

          walk(clone);
          return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        });

        // Build file content
        const fileContent = `URL: ${url}\nTitle: ${title}\n\n${text}`;

        // Derive R2 key
        const filename = pathToFilename(url);
        const r2Key = `kenpalinc/${filename}`;

        // Upload to R2
        await uploadToR2(r2Key, fileContent);
        console.log(`  Uploaded -> ${r2Key}`);

        // Collect internal links
        const hrefs: string[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map(
            (a) => (a as HTMLAnchorElement).href
          )
        );

        for (const href of hrefs) {
          if (!isInternalCrawlable(href, url)) continue;
          const normalised = normalise(href);
          if (!visited.has(normalised) && !queue.includes(normalised)) {
            queue.push(normalised);
          }
        }
      } catch (err) {
        console.error(`  Error crawling ${url}:`, err);
      } finally {
        await page.close();
      }

      // Polite delay between pages
      if (queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`Crawl complete. ${visited.size} pages processed.`);
}

main().catch((err) => {
  console.error('Crawl failed:', err);
  process.exit(1);
});
