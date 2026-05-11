import { launch, type BrowserWorker } from '@cloudflare/playwright';

interface Env {
  BROWSER: BrowserWorker;
  R2: R2Bucket;
  BASE_URL: string;
  R2_PREFIX: string;
}

const DELAY_MS = 500;

function pathToFilename(urlString: string): string {
  const url = new URL(urlString);
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (pathname === '/') return 'index.txt';
  return pathname.replace(/^\//, '').replace(/\//g, '_') + '.txt';
}

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1].trim());
}

async function fetchSitemapUrls(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/sitemap.xml`);
  if (!res.ok) {
    throw new Error(`Failed to fetch sitemap.xml: ${res.status}`);
  }
  const xml = await res.text();
  const locs = extractLocs(xml);

  if (xml.includes('<sitemapindex')) {
    const all: string[] = [];
    for (const childUrl of locs) {
      const childRes = await fetch(childUrl);
      if (!childRes.ok) {
        console.warn(`  Skipping child sitemap ${childUrl}: ${childRes.status}`);
        continue;
      }
      const childXml = await childRes.text();
      all.push(...extractLocs(childXml));
    }
    return all;
  }

  return locs;
}

async function crawl(env: Env): Promise<number> {
  console.log(`Fetching sitemap from ${env.BASE_URL}`);
  const urls = await fetchSitemapUrls(env.BASE_URL);
  console.log(`Found ${urls.length} URLs in sitemap`);

  const browser = await launch(env.BROWSER);
  let saved = 0;

  try {
    for (const url of urls) {
      console.log(`Crawling: ${url}`);
      const page = await browser.newPage();
      try {
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
        const status = response?.status() ?? 0;
        if (status >= 400) {
          console.warn(`  Skipping (status ${status})`);
          continue;
        }

        const title = await page.title();

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

            const headingMatch = tag.match(/^h([1-6])$/);
            if (headingMatch) {
              const t = (el.textContent ?? '').trim();
              if (t) lines.push('\n' + '#'.repeat(Number(headingMatch[1])) + ' ' + t);
              return;
            }

            if (['p', 'li', 'dt', 'dd', 'blockquote', 'td', 'th'].includes(tag)) {
              const t = (el.textContent ?? '').trim();
              if (t) lines.push(t);
              return;
            }

            for (const child of Array.from(el.childNodes)) {
              walk(child);
            }
          }

          walk(clone);
          return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        });

        const fileContent = `URL: ${url}\nTitle: ${title}\n\n${text}`;
        const r2Key = `${env.R2_PREFIX}/${pathToFilename(url)}`;
        await env.R2.put(r2Key, fileContent);
        console.log(`  Uploaded -> ${r2Key}`);
        saved++;
      } catch (err) {
        console.error(`  Error crawling ${url}:`, err);
      } finally {
        await page.close();
      }

      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  } finally {
    await browser.close();
  }

  console.log(`Crawl complete. ${saved}/${urls.length} pages saved.`);
  return saved;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await crawl(env);
  },
};