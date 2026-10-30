// TG 机器人后端（练习 4 · 升级版）：零依赖 Node，webhook 模式，大脑接 OpenRouter 免费模型
// 功能：/start 欢迎语、/model 按钮菜单切换模型（按会话记忆，服务重启后恢复默认）、其余文字转模型问答
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const OR_KEY = process.env.OPENROUTER_API_KEY || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const PORT = process.env.PORT || 3000;
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// 可切换的模型菜单（都是免费版；id 必须与 OpenRouter 目录一致）
const MODELS = [
  { key: 'nemotron', id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra · 大块头全能（默认）' },
  { key: 'gemma31', id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B · 谷歌均衡款' },
  { key: 'gemma26', id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B · 谷歌轻快款' },
  { key: 'northcode', id: 'cohere/north-mini-code:free', label: 'North Mini Code · 写代码专长' },
];
const DEFAULT_MODEL_ID = process.env.MODEL || MODELS[0].id;

// 每个会话当前选的模型（只存内存：服务睡眠重启后回到默认，练习阶段够用）
const chatModel = new Map();
function modelOf(chatId) {
  return chatModel.get(chatId) || DEFAULT_MODEL_ID;
}
function labelOf(id) {
  const m = MODELS.find((x) => x.id === id);
  return m ? m.label : id;
}

async function tg(method, body) {
  const r = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json().catch(() => ({}));
}

async function askAI(modelId, text) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: '你是一个友好的中文助手，回答简洁、有帮助，不啰嗦。' },
        { role: 'user', content: text },
      ],
    }),
  });
  const j = await r.json().catch(() => ({}));
  const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  return out || '（这个模型这次没回话，可能正忙。发 /model 换一个试试）';
}

async function sendModelMenu(chatId) {
  const keyboard = MODELS.map((m) => [
    { text: (modelOf(chatId) === m.id ? '✅ ' : '') + m.label, callback_data: `setmodel:${m.key}` },
  ]);
  await tg('sendMessage', {
    chat_id: chatId,
    text: `当前模型：${labelOf(modelOf(chatId))}\n点下面按钮换模型，换完直接发消息就是新模型在答：`,
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleMessage(msg) {
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text === '/start') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '你好，我是小满的测试机器人。直接发消息我会用模型回你；发 /model 可以换模型。',
    });
    return;
  }
  if (text === '/model' || text.startsWith('/model@')) {
    await sendModelMenu(chatId);
    return;
  }

  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  const reply = await askAI(modelOf(chatId), text);
  await tg('sendMessage', { chat_id: chatId, text: String(reply).slice(0, 4000) });
}

async function handleCallback(cb) {
  if (!cb || !cb.data || !cb.message) return;
  const chatId = cb.message.chat.id;
  if (cb.data.startsWith('setmodel:')) {
    const key = cb.data.slice('setmodel:'.length);
    const m = MODELS.find((x) => x.key === key);
    if (m) {
      chatModel.set(chatId, m.id);
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: `已切换到 ${m.label}` });
      await tg('sendMessage', { chat_id: chatId, text: `好，已换成：${m.label}\n直接发消息试试它。` });
      return;
    }
  }
  await tg('answerCallbackQuery', { callback_query_id: cb.id });
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
        if (upd.message) await handleMessage(upd.message);
        else if (upd.callback_query) await handleCallback(upd.callback_query);
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
