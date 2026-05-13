import type { ExportedHandler } from '@cloudflare/workers-types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionsResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
}

interface AiSearchInstance {
  chatCompletions(options: {
    messages: ChatMessage[];
    stream?: boolean;
  }): Promise<ChatCompletionsResponse>;
}

export interface Env {
  AI_SEARCH: AiSearchInstance;
}

const SYSTEM_PROMPT = `あなたはKenpal株式会社のウェブサイトアシスタントです。
以下のルールを厳守してください：
- 提供されたウェブサイトの情報のみをもとに日本語で回答する
- ウェブサイトに記載されている情報は、内容が限られていても必ず回答する
- 情報がまったく存在しない場合のみ「その情報は持ち合わせておりません」とだけ答える
- 推測・補足説明は一切行わない
- ユーザーが特定の項目・見出し一つについて詳細を尋ねているときは、その項目の内容だけを答え、他の見出しや別の項目は列挙しない
- 会話の流れから「どの項目について聞いているか」が明らかな場合は、その項目に絞って回答する
- 具体的内容は、提供されたテキストに実際に書かれている語句・文のみを使う。サイトに無い一般論・言い換え・追加の箇条書きは書かない`;

const ALLOWED_ORIGINS = [
  'https://www.kenpalinc.com',
  'https://kenpalinc.com',
  'https://kenpal-chatbot-frontend.pages.dev',
  'https://kenpal-chatbot.pages.dev',
];

/** Pages の本番 URL + プレビュー（df18b518.xxx や branch--xxx など）を許可 */
function isOriginAllowed(origin: string | null): boolean {
  if (origin === null) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname;
    return (
      host === 'kenpal-chatbot-frontend.pages.dev' ||
      host.endsWith('.kenpal-chatbot-frontend.pages.dev')
    );
  } catch {
    return false;
  }
}

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = isOriginAllowed(origin);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  // 不許可時に別オリジンを返すとプリフライトが誤って失敗するため、許可時のみ ACAO を付ける
  if (allowed && origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  let body: { message?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const message = body.message;
  if (typeof message !== 'string' || message.trim() === '') {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const trimmedMessage = message.trim();

  const history: HistoryEntry[] = Array.isArray(body.history)
    ? (body.history as HistoryEntry[]).filter(
        (h) =>
          h &&
          typeof h.content === 'string' &&
          (h.role === 'user' || h.role === 'assistant')
      )
    : [];

  try {
    const result = await env.AI_SEARCH.chatCompletions({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: trimmedMessage },
      ],
      stream: false,
    });

    const reply = result.choices?.[0]?.message?.content ?? 'その情報は持ち合わせておりません。';

    return new Response(
      JSON.stringify({ reply }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Chat failed:', err);
    return new Response(
      JSON.stringify({ error: 'AI service unavailable' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      const response = await handleChat(request, env);
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers: newHeaders });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
} satisfies ExportedHandler<Env>;
