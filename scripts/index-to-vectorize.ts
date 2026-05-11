import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';

config({ path: '.env.local' });

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID ?? '';
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? '';
const BUCKET_NAME = process.env.R2_BUCKET_NAME ?? 'kenpal-chatbot';
const INDEX_NAME = 'kenpal-chatbot';
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const BATCH_SIZE = 10;

interface Chunk {
  id: string;
  text: string;
  metadata: Record<string, string>;
}

function getS3Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

function r2KeyToUrl(r2Key: string): string {
  const path = r2Key.replace('kenpalinc/', '').replace('.txt', '').replace(/_/g, '/');
  return path === 'index' ? 'https://www.kenpalinc.com/' : `https://www.kenpalinc.com/${path}`;
}

function safeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 64);
}

function parseChunks(text: string, r2Key: string): Chunk[] {
  const lines = text.split('\n');
  let url = r2KeyToUrl(r2Key);
  let title = '';
  let bodyStart = 0;

  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].startsWith('URL: ')) { url = lines[i].slice(5).trim(); bodyStart = i + 1; }
    else if (lines[i].startsWith('Title: ')) { title = lines[i].slice(7).trim(); bodyStart = i + 1; }
  }

  const body = lines.slice(bodyStart).join('\n').trim();
  const chunks: Chunk[] = [];
  let idx = 0;

  // ### セクション単位で分割（fix-careers-entry.ts で生成した構造）
  const parts = body.split(/(?=^### )/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('### ')) {
      const nl = trimmed.indexOf('\n');
      const heading = nl > -1 ? trimmed.slice(4, nl).trim() : trimmed.slice(4).trim();
      const content = nl > -1 ? trimmed.slice(nl + 1).trim() : '';
      chunks.push({
        id: safeId(`${r2Key}-${idx}-${heading}`),
        text: `${heading}\n${content}`.slice(0, 1500),
        metadata: { url, title, heading, content: content.slice(0, 800) },
      });
    } else {
      // ### の前のテキスト: ## セクションで再分割を試みる
      const h2Parts = trimmed.split(/(?=^## )/m);
      for (const h2 of h2Parts) {
        const h2Trimmed = h2.trim();
        if (!h2Trimmed) continue;
        if (h2Trimmed.startsWith('## ')) {
          const nl = h2Trimmed.indexOf('\n');
          const heading = nl > -1 ? h2Trimmed.slice(3, nl).trim() : h2Trimmed.slice(3).trim();
          const content = nl > -1 ? h2Trimmed.slice(nl + 1).trim() : '';
          chunks.push({
            id: safeId(`${r2Key}-${idx}-${heading}`),
            text: `${heading}\n${content}`.slice(0, 1500),
            metadata: { url, title, heading, content: content.slice(0, 800) },
          });
        } else {
          chunks.push({
            id: safeId(`${r2Key}-${idx}-intro`),
            text: h2Trimmed.slice(0, 1500),
            metadata: { url, title, heading: title || 'ページ概要', content: h2Trimmed.slice(0, 800) },
          });
        }
        idx++;
      }
      continue;
    }
    idx++;
  }

  // セクションが1つも取れなかった場合はページ全体を1チャンクとして登録
  if (chunks.length === 0) {
    chunks.push({
      id: safeId(r2Key),
      text: body.slice(0, 1500),
      metadata: { url, title, heading: title || 'ページ概要', content: body.slice(0, 800) },
    });
  }

  return chunks;
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts }),
    }
  );
  if (!res.ok) throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
  const json = await res.json() as { result: { data: number[][] } };
  return json.result.data;
}

async function upsertVectors(chunks: Chunk[], embeddings: number[][]): Promise<void> {
  const ndjson = chunks
    .map((c, i) => JSON.stringify({ id: c.id, values: embeddings[i], metadata: c.metadata }))
    .join('\n');

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${INDEX_NAME}/upsert`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/x-ndjson' },
      body: ndjson,
    }
  );
  if (!res.ok) throw new Error(`Vectorize upsert ${res.status}: ${await res.text()}`);
  const json = await res.json() as { result: { mutationId: string } };
  console.log(`    upserted ${chunks.length} vectors (${json.result.mutationId})`);
}

async function main(): Promise<void> {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    throw new Error('CF_ACCOUNT_ID と CLOUDFLARE_API_TOKEN を .env.local に設定してください');
  }

  const s3 = getS3Client();

  console.log('R2 ファイル一覧を取得...');
  const listResult = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: 'kenpalinc/' }));
  const keys = (listResult.Contents ?? []).map(o => o.Key!).filter(k => k.endsWith('.txt'));
  console.log(`${keys.length} ファイルを処理します\n`);

  let totalChunks = 0;

  for (const key of keys) {
    console.log(`処理中: ${key}`);
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    const text = await obj.Body!.transformToString('utf-8');
    const chunks = parseChunks(text, key);
    console.log(`  ${chunks.length} チャンク`);

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const embeddings = await generateEmbeddings(batch.map(c => c.text));
      await upsertVectors(batch, embeddings);
      totalChunks += batch.length;
    }
  }

  console.log(`\n完了: ${keys.length} ファイル / ${totalChunks} チャンクをインデックス登録`);
}

main().catch(err => { console.error(err); process.exit(1); });
