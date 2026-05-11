import { chromium } from 'playwright';
import { config } from 'dotenv';
import { uploadToR2 } from './upload-to-r2';

config({ path: '.env.local' });

const SECTION_MARKERS = [
  { en: 'OPEN POSITIONS', ja: '募集中の求人' },
  { en: 'HIRING PROCESS', ja: '採用フロー' },
  { en: 'IDEAL CANDIDATE', ja: 'Kenpalの求める人物像' },
  { en: 'GROWTH CYCLE', ja: '学習・成長サイクル' },
];

// 内定後の承諾期限に関する文（公開チャットボットには不要）
const LINES_TO_REMOVE = [
  '内定通知後、承諾期限を設定させていただく場合があります。詳細は内定通知時にお知らせいたしますので、ご確認ください。',
];

// フッター開始のマーカー（以降はフッターナビなので除去）
const FOOTER_START = 'お問い合わせ、開発のご相談はこちらから。';

function cleanContent(content: string): string {
  // 不要な行を除去
  for (const line of LINES_TO_REMOVE) {
    content = content.replace(line, '');
  }
  // ゼロ幅文字を除去
  content = content.replace(/[​﻿]/g, '');
  // STUDIOのナビゲーションアイコンテキストを除去
  content = content.replace(/trending_flat/g, '').replace(/\badd\b/g, '');
  // フッター以降を切り捨て
  const footerIdx = content.indexOf(FOOTER_START);
  if (footerIdx >= 0) content = content.slice(0, footerIdx);
  // 連続スペース・改行を整理
  return content.replace(/\s{2,}/g, ' ').trim();
}

function parseIntoSections(
  raw: string,
  idealCandidatePairs: { heading: string; description: string }[] = []
): string {
  // ナビゲーション部分（OPEN POSITIONSの前）を除去
  const firstMarkerIdx = raw.indexOf('OPEN POSITIONS');
  const body = firstMarkerIdx >= 0 ? raw.slice(firstMarkerIdx) : raw;

  // セクション境界の位置を特定
  const boundaries: { index: number; en: string; ja: string }[] = [];
  for (const { en, ja } of SECTION_MARKERS) {
    const idx = body.indexOf(en);
    if (idx >= 0) boundaries.push({ index: idx, en, ja });
  }
  boundaries.sort((a, b) => a.index - b.index);

  // セクションごとにテキストを切り出し
  const sections: string[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].index;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : body.length;
    // セクションヘッダーテキスト自体（英語キー+日本語）を除いた本文を取得
    let content = body.slice(start, end);
    // 先頭の "OPEN POSITIONS募集中の求人" のような重複テキストを除去
    content = content.replace(boundaries[i].en, '').replace(boundaries[i].ja, '');
    // 求める人物像セクションは「見出し」と「説明文」を別行で保存
    if (boundaries[i].en === 'IDEAL CANDIDATE' && idealCandidatePairs.length > 0) {
      const list = idealCandidatePairs
        .map((p, idx) => `### ${idx + 1}. ${p.heading}\n${p.description}`)
        .join('\n\n');
      sections.push(`## ${boundaries[i].ja}\n\n${list}`);
      continue;
    }

    content = cleanContent(content);

    sections.push(`## ${boundaries[i].ja}\n${content}`);
  }

  return sections.join('\n\n');
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const url = 'https://www.kenpalinc.com/careers/entry';
  console.log(`Crawling: ${url}`);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

  const title = await page.title();
  const raw = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
    return (clone.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  });

  // 求める人物像: H3（見出し）とその直後のP（説明文）をペアで取得
  const idealCandidatePairs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('h3')).map((h3) => {
      const heading = h3.textContent?.replace(/[​﻿]/g, '').trim() ?? '';
      let description = '';
      let sibling = h3.nextElementSibling;
      while (sibling) {
        if (sibling.tagName === 'H3') break;
        const text = sibling.textContent?.replace(/[​﻿]/g, '').trim() ?? '';
        if (text) { description = text; break; }
        sibling = sibling.nextElementSibling;
      }
      return { heading, description };
    }).filter((p) => p.heading);
  });

  await browser.close();

  const structured = parseIntoSections(raw, idealCandidatePairs);
  const fileContent = `URL: ${url}\nTitle: ${title}\n\n${structured}`;

  console.log('--- Preview ---');
  console.log(fileContent);
  console.log('--- End Preview ---');

  await uploadToR2('kenpalinc/careers_entry.txt', fileContent);
  console.log('Uploaded -> kenpalinc/careers_entry.txt');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
