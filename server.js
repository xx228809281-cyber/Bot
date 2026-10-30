// TG 机器人后端（练习 4）：零依赖 Node，webhook 模式，大脑接 OpenRouter 免费模型
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const OR_KEY = process.env.OPENROUTER_API_KEY || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const MODEL = process.env.MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';
const PORT = process.env.PORT || 3000;
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method, body) {
  const r = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json().catch(() => ({}));
}

async function askAI(text) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: '你是一个友好的中文助手，回答简洁、有帮助，不啰嗦。' },
        { role: 'user', content: text },
      ],
    }),
  });
  const j = await r.json().catch(() => ({}));
  const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  return out || '（模型这次没回话，换个问题再试试）';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('TG bot is running.');
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200);
    return res.end('ok');
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
      res.writeHead(401);
      return res.end();
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      res.writeHead(200);
      res.end('ok');
      try {
        const upd = JSON.parse(raw);
        const msg = upd.message;
        if (!msg || !msg.text) return;
        const chatId = msg.chat.id;
        if (msg.text === '/start') {
          await tg('sendMessage', {
            chat_id: chatId,
            text: '你好，我是小满的测试机器人。直接发消息，我会用免费模型回你。',
          });
          return;
        }
        await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
        const reply = await askAI(msg.text);
        await tg('sendMessage', { chat_id: chatId, text: String(reply).slice(0, 4000) });
      } catch (e) {
        console.error('ERR', e);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, async () => {
  console.log('LISTENING on', PORT);
  const ext = process.env.RENDER_EXTERNAL_URL;
  if (ext && BOT_TOKEN) {
    const r = await tg('setWebhook', {
      url: `${ext}/webhook`,
      secret_token: WEBHOOK_SECRET || undefined,
      drop_pending_updates: true,
    });
    console.log('SETWEBHOOK', JSON.stringify(r));
  } else {
    console.log('NO-WEBHOOK-REGISTER: missing RENDER_EXTERNAL_URL or BOT_TOKEN');
  }
});
