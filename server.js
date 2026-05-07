import express from "express";
import fetch from "node-fetch";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static("public"));
app.use(cors({
  origin: [
    'https://ferniex-minigame.vercel.app',
    'https://ferniex-id.vercel.app',
    'https://fernie-x-ai-chat.vercel.app',
  ],
  credentials: true
}));

const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_KEY;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || SB_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_URL   = process.env.BOT_URL || 'https://a37690-25aa.j.d-f.pw';

const sbHeaders = {
  apikey: SB_SERVICE_KEY,
  Authorization: `Bearer ${SB_SERVICE_KEY}`,
  "Content-Type": "application/json"
};

// ====== Хелпер: notifyBot с retry ======
async function notifyBot(url, body, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);
      return await res.json();
    } catch (e) {
      if (i === retries) {
        console.error(`notifyBot failed (${url}):`, e.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ====== Хелпер: Telegram ======
async function sendTgMessage(chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", text })
    });
    if (!res.ok) { console.error("TG error:", await res.text()); return false; }
    return true;
  } catch (e) {
    console.error("TG exception:", e.message);
    return false;
  }
}

async function resolveTelegramId(userId) {
  const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`, { headers: sbHeaders });
  const users = await userRes.json();
  return users[0]?.telegram_id || null;
}

// ====== Регистрация ======
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, error: "Все поля обязательны" });
  try {
    const check = await fetch(`${SB_URL}/rest/v1/users?username=eq.${username}`, { headers: sbHeaders });
    const checkData = await check.json();
    if (checkData.length) return res.json({ success: false, error: "Пользователь уже существует" });
    const hash = await bcrypt.hash(password, 10);
    const create = await fetch(`${SB_URL}/rest/v1/users`, {
      method: "POST",
      headers: sbHeaders,
      body: JSON.stringify({ username, password_hash: hash, balance: 1000, role: "user" })
    });
    if (create.ok) res.json({ success: true, message: "Регистрация успешна" });
    else res.json({ success: false, error: "Ошибка при создании" });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});


// ====== Вход ======
app.post("/api/login", async (req, res) => {
  const { username, password, clientIp, userAgent } = req.body;
  if (!username || !password) return res.json({ success: false, error: "Все поля обязательны" });
  try {
    const response = await fetch(`${SB_URL}/rest/v1/users?username=eq.${username}`, { headers: sbHeaders });
    const data = await response.json();
    if (!data.length) return res.json({ success: false, error: "Пользователь не найден" });
    const user = data[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.json({ success: false, error: "Неверный пароль" });

    if (user.telegram_id) {
      const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
      let device = 'неизвестно';
      if (userAgent) {
        if (/Android/.test(userAgent)) {
          const model = userAgent.match(/;\s*([^;)]+)\s*Build/)?.[1] || 'Android';
          const ver = userAgent.match(/Android\s*([\d.]+)/)?.[1] || '';
          device = `📱 ${model} (Android ${ver})`;
        } else if (/iPhone/.test(userAgent)) {
          const ver = userAgent.match(/OS\s*([\d_]+)/)?.[1]?.replace(/_/g,'.') || '';
          device = `🍎 iPhone (iOS ${ver})`;
        } else if (/iPad/.test(userAgent)) {
          device = `🍎 iPad`;
        } else if (/Windows/.test(userAgent)) {
          device = `🖥 Windows`;
        } else if (/Macintosh|Mac OS/.test(userAgent)) {
          device = `🖥 MacOS`;
        } else if (/Linux/.test(userAgent)) {
          device = `🖥 Linux`;
        }
      }

      await sendTgMessage(user.telegram_id,
        `🔐 <b>Выполнен вход в Личный Кабинет FernieID</b>\n\n` +
        `<blockquote>` +
        `👤 Аккаунт: <b>${username}</b>\n` +
        `🕒 Время: <b>${now} МСК</b>` +
        `</blockquote>\n\n` +
        `<blockquote>` +
        `🌐 IP: <code>${clientIp || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'неизвестен'}</code>\n` +
        `📱 Устройство: <b>${device}</b>` +
        `</blockquote>\n\n` +
        `⚠️ <i>Если это не ты — немедленно смени пароль!</i>`
      );
    }

    res.json({ success: true, userId: user.id, telegramLinked: !!user.telegram_id });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ====== Верификация FernieID токена (для внешних сервисов) ======
app.post("/api/verify-token", async (req, res) => {
  const { userId, username } = req.body;
  if (!userId || !username) return res.json({ success: false, error: "Нет данных" });
  try {
    const response = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&username=eq.${username}&select=id,username,role,telegram_id`, { headers: sbHeaders });
    const data = await response.json();
    if (!data.length) return res.json({ success: false, error: "Пользователь не найден" });
    const user = data[0];
    res.json({ success: true, userId: user.id, username: user.username, role: user.role, telegramLinked: !!user.telegram_id });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ====== Баланс ======
app.get("/api/balance/:userId", async (req, res) => {
  const userId = req.params.userId;
  try {
    const response = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, { headers: sbHeaders });
    const data = await response.json();
    if (!data.length) return res.status(404).json({ error: "Пользователь не найден" });
    res.json({ balance: data[0].balance });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ====== Сохранение статистики + уведомление в TG ======
app.post("/api/stats", async (req, res) => {
  const { userId, game, score } = req.body;
  const gameSlug = (game || '').replace(/-/g, '_');
  if (!userId || !gameSlug || score === undefined)
    return res.json({ success: false, error: "Недостаточно данных" });

  try {
    // 1. game_id из Supabase
    const gameRes = await fetch(`${SB_URL}/rest/v1/games?slug=eq.${gameSlug}&select=id,title`, { headers: sbHeaders });
    const gameData = await gameRes.json();
    const gameTitle = gameData[0]?.title || game;
    const gameId    = gameData[0]?.id;
    console.log(">>> stats hit:", { userId, game, gameSlug, gameTitle, gameId, score });

    // 2. Записываем сессию
    if (gameId) {
      const sessionRes = await fetch(`${SB_URL}/rest/v1/game_sessions`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({
          user_id: userId,
          game_id: gameId,
          score: score,
          ended_at: new Date().toISOString()
        })
      });
      if (!sessionRes.ok) {
        console.error("Session insert error:", await sessionRes.text());
      }
    }

    // 3. Обновляем лидерборд (некритично)
    fetch(`${SB_URL}/rest/v1/rpc/refresh_leaderboard`, {
      method: "POST", headers: sbHeaders, body: JSON.stringify({})
    }).catch(() => {});

    // 4. Получаем telegram_id юзера
    const userRes = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`,
      { headers: sbHeaders }
    );
    const users = await userRes.json();
    console.log(">>> users from DB:", JSON.stringify(users));

    if (!users.length) return res.json({ success: false, error: "Пользователь не найден" });

    const { telegram_id, username } = users[0];
    console.log(">>> telegram_id:", telegram_id, "username:", username);

    // 5. Уведомление — через бота (чтобы он начислил реальные награды)
    if (telegram_id) {
      const notifyResult = await notifyBot(`${BOT_URL}/api/fernieid/notify`, {
        telegram_id,
        type: "game",
        username,
        game: gameTitle,
        score
      });
      console.log(">>> notifyBot result:", JSON.stringify(notifyResult));
    } else {
      console.log(">>> telegram_id пустой, уведомление не отправлено");
    }

    res.json({ success: true, telegramSent: !!telegram_id });

  } catch (e) {
    console.error(">>> stats error:", e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ====== Лидерборд ======
app.get("/api/leaderboard/:gameSlug", async (req, res) => {
  const { gameSlug } = req.params;
  const limit = req.query.limit || 10;
  try {
    const response = await fetch(
      `${SB_URL}/rest/v1/leaderboard?game_slug=eq.${gameSlug}&order=best_score.desc&limit=${limit}`,
      { headers: sbHeaders }
    );
    const data = await response.json();
    res.json({ success: true, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ══════════════════════════════════════════
//  Отправка TG сообщения (для заявок)
// ══════════════════════════════════════════
app.post("/api/telegram/send-message", async (req, res) => {
  const { telegram_id, text } = req.body;
  if (!telegram_id || !text) return res.json({ success: false });
  try {
    const sent = await sendTgMessage(telegram_id, text);
    res.json({ success: sent });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/test-bot", async (req, res) => {
  try {
    const result = await notifyBot(`${BOT_URL}/api/fernieid/notify`, {
      telegram_id: "7406372338",
      type: "test",
      username: "test"
    });
    res.json({ success: true, result });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ====== Генерация токена привязки Telegram ======
app.post("/api/telegram/generate-token", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.json({ success: false, error: "Нет userId" });
  try {
    const token = Math.random().toString(36).slice(2, 10).toUpperCase();
    const patchRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ link_token: token })
    });
    if (!patchRes.ok) {
      console.error("generate-token PATCH error:", await patchRes.text());
      return res.json({ success: false, error: "Ошибка сохранения токена" });
    }
    res.json({ success: true, token });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ====== Привязка telegram_id по токену (вызывается из бота) ======
app.post("/api/telegram/link", async (req, res) => {
  const { token, telegram_id } = req.body;
  if (!token || !telegram_id) return res.json({ success: false, error: "Нет данных" });
  try {
    const findRes = await fetch(
      `${SB_URL}/rest/v1/users?link_token=eq.${token}&select=id,username`,
      { headers: sbHeaders }
    );
    const users = await findRes.json();
    if (!users.length) return res.json({ success: false, error: "Токен не найден или устарел" });
    const user = users[0];
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${user.id}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ telegram_id: telegram_id, link_token: null })
    });
    res.json({ success: true, username: user.username });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ====== Отвязка Telegram ======
app.post("/api/telegram/unlink", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.json({ success: false, error: "Нет userId" });
  try {
    const userRes = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`,
      { headers: sbHeaders }
    );
    const users = await userRes.json();
    if (!users.length) return res.json({ success: false, error: "Пользователь не найден" });
    const { telegram_id } = users[0];

    await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ telegram_id: null })
    });

    if (telegram_id) {
      await sendTgMessage(telegram_id,
        `🛡 <b>Система Безопасности</b>\n` +
        `<blockquote>🔓 Ваш Telegram аккаунт был <b>успешно отвязан</b> от FernieID.\n` +
        `ID: <b>${telegram_id}</b></blockquote>\n` +
        `Если отвязку сделали вы — просто проигнорируйте это сообщение. ✅\n` +
        `Если отвязали <b>не вы</b> — свяжитесь с поддержкой через /ask 🆘`
      );
    }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ══════════════════════════════════════════
//  Перенос аккаунта — шаг 1: отправить код
// ══════════════════════════════════════════
app.post("/api/transfer/send-code", async (req, res) => {
  const { userId, oldTgId, newTgId } = req.body;
  if (!userId || !oldTgId || !newTgId)
    return res.json({ success: false, error: "Нет данных" });
  if (String(oldTgId) === String(newTgId))
    return res.json({ success: false, error: "ID совпадают" });

  try {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Удаляем старые коды этого юзера
    await fetch(`${SB_URL}/rest/v1/transfer_codes?user_id=eq.${userId}`, {
      method: "DELETE",
      headers: sbHeaders
    });

    // Сохраняем новый код в Supabase
    const insertRes = await fetch(`${SB_URL}/rest/v1/transfer_codes`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: String(userId),
        code,
        old_tg_id: String(oldTgId),
        new_tg_id: String(newTgId),
        expires_at: expires
      })
    });

    if (!insertRes.ok) {
      console.error("insert transfer_code error:", await insertRes.text());
      return res.json({ success: false, error: "Ошибка сохранения кода" });
    }

    const sent = await sendTgMessage(oldTgId,
      `🔄 <b>Запрос на перенос аккаунта FernieID</b>\n\n` +
      `<blockquote>` +
      `📤 Откуда: <code>${oldTgId}</code>\n` +
      `📥 Куда: <code>${newTgId}</code>` +
      `</blockquote>\n\n` +
      `🔑 Код подтверждения:\n` +
      `<blockquote><b>${code}</b></blockquote>\n\n` +
      `⏳ <i>Код действителен 10 минут.</i>\n` +
      `⚠️ <i>Если это не ты — проигнорируй это сообщение.</i>`
    );

    if (!sent) return res.json({ success: false, error: "Не удалось отправить сообщение в Telegram. Убедись, что ты писал боту." });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ══════════════════════════════════════════
//  Перенос аккаунта — шаг 2: подтвердить
// ══════════════════════════════════════════
app.post("/api/transfer/confirm", async (req, res) => {
  const { code, userId } = req.body;
  if (!code || !userId) return res.json({ success: false, error: "Нет данных" });

  const codeStr = String(code).trim();

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/transfer_codes?code=eq.${codeStr}&user_id=eq.${userId}`,
      { headers: sbHeaders }
    );
    const rows = await r.json();
    console.log(">>> transfer confirm rows:", JSON.stringify(rows));

    if (!rows.length) return res.json({ success: false, error: "Неверный код" });

    const entry = rows[0];
    if (new Date() > new Date(entry.expires_at)) {
      await fetch(`${SB_URL}/rest/v1/transfer_codes?code=eq.${codeStr}`, {
        method: "DELETE", headers: sbHeaders
      });
      return res.json({ success: false, error: "Код истёк" });
    }

    // Удаляем код сразу (одноразовый)
    await fetch(`${SB_URL}/rest/v1/transfer_codes?code=eq.${codeStr}`, {
      method: "DELETE", headers: sbHeaders
    });

    // Вызываем бота для переноса данных
    const result = await notifyBot(`${BOT_URL}/api/fernieid/transfer`, {
      old_telegram_id: entry.old_tg_id,
      new_telegram_id: entry.new_tg_id,
    });

    console.log(">>> transfer bot result:", JSON.stringify(result));

    if (!result?.success) {
      return res.json({ success: false, error: result?.error || "Ошибка переноса в боте" });
    }

    // Обновляем telegram_id в Supabase
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ telegram_id: parseInt(entry.new_tg_id) })
    });

    // Уведомляем новый аккаунт
    await sendTgMessage(entry.new_tg_id,
      `✅ <b>Данные успешно перенесены!</b>\n\n` +
      `<blockquote>Все ваши данные из Telegram <code>${entry.old_tg_id}</code> перенесены на этот аккаунт.</blockquote>\n\n` +
      `🎉 <i>Добро пожаловать!</i>`
    );

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ══════════════════════════════════════════
//  Баланс семян из Telegram бота
// ══════════════════════════════════════════
app.get("/api/seeds/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`, { headers: sbHeaders });
    const users = await userRes.json();
    console.log('seeds users:', JSON.stringify(users));
    if (!users.length || !users[0].telegram_id)
      return res.json({ success: false, seeds: 0, error: "Telegram не привязан" });
    const telegram_id = users[0].telegram_id;
    console.log('fetching seeds for telegram_id:', telegram_id);
    const botRes = await fetch(`${BOT_URL}/api/seeds?telegram_id=${telegram_id}`);
    const botData = await botRes.json();
    console.log('botData:', JSON.stringify(botData));
    res.json({ success: true, seeds: Number(botData.seeds) || 0 });
  } catch (e) {
    console.error('seeds error:', e);
    res.json({ success: false, seeds: 0, error: e.message });
  }
});

// ══════════════════════════════════════════
//  Покупка кейса
// ══════════════════════════════════════════
app.post("/api/cases/buy", async (req, res) => {
  const { userId, caseSlug, quantity } = req.body;
  if (!userId || !caseSlug || !quantity)
    return res.json({ success: false, error: "Недостаточно данных" });
  const PRICES = { ferniex_silver: 3000, fernie_gold: 6000, fernie_starter: 1000, fernie_crystal: 8000, fernie_royal: 15000 };
  const price = PRICES[caseSlug];
  if (!price) return res.json({ success: false, error: "Кейс не найден" });
  const total = price * quantity;
  try {
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`, { headers: sbHeaders });
    const users = await userRes.json();
    if (!users.length || !users[0].telegram_id)
      return res.json({ success: false, error: "Telegram не привязан" });
    const { telegram_id, username } = users[0];
    const spendRes = await fetch(`${BOT_URL}/api/seeds/spend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id, amount: total })
    });
    const spendData = await spendRes.json();
    if (!spendData.success) return res.json({ success: false, error: spendData.error || "Недостаточно семян" });
    const invRes = await fetch(`${SB_URL}/rest/v1/inventory?user_id=eq.${userId}&case_slug=eq.${caseSlug}`, { headers: sbHeaders });
    const invData = await invRes.json();
    if (invData.length) {
      await fetch(`${SB_URL}/rest/v1/inventory?user_id=eq.${userId}&case_slug=eq.${caseSlug}`, {
        method: "PATCH",
        headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ quantity: invData[0].quantity + quantity })
      });
    } else {
      await fetch(`${SB_URL}/rest/v1/inventory`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: userId, case_slug: caseSlug, quantity })
      });
    }
    const caseNames = { ferniex_silver: 'Silver', fernie_gold: 'Gold', fernie_starter: 'Shadow', fernie_crystal: 'Crystal', fernie_royal: 'Royal' };
    await sendTgMessage(telegram_id,
      `🛒 <b>Покупка на сайте</b>\n\n` +
      `👤 Игрок: <b>${username}</b>\n` +
      `📦 Товар: <b>Кейс</b>\n` +
      `🏷 Название: <b>${caseNames[caseSlug] || caseSlug}</b>\n` +
      `🔢 Кол-во: <b>${quantity} шт.</b>\n` +
      `💰 Сумма: <b>${total.toLocaleString('ru-RU')} 🌱</b>`
    );
    res.json({ success: true, spent: total });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ══════════════════════════════════════════
//  Открыть кейс — честный серверный дроп
// ══════════════════════════════════════════
const CASE_DEFINITIONS = {
  ferniex_silver: {
    name: 'Silver',
    items: [
      {name:'🌱 Семена x500',  emoji:'🌱', rarity:'common',    chance:40, reward:{type:'seeds',  amount:500}},
      {name:'🌱 Семена x1000', emoji:'🌱', rarity:'common',    chance:30, reward:{type:'seeds',  amount:1000}},
      {name:'💎 DC x50',       emoji:'💎', rarity:'rare',      chance:18, reward:{type:'dc',     amount:50}},
      {name:'💎 DC x150',      emoji:'💎', rarity:'rare',      chance:11, reward:{type:'dc',     amount:150}},
      {name:'⭐ DC x500',      emoji:'⭐', rarity:'legendary', chance:1,  reward:{type:'dc',     amount:500}},
    ]
  },
  fernie_gold: {
    name: 'Gold',
    items: [
      {name:'🌱 Семена x1000', emoji:'🌱', rarity:'common',    chance:40, reward:{type:'seeds',  amount:1000}},
      {name:'🌱 Семена x2500', emoji:'🌱', rarity:'common',    chance:30, reward:{type:'seeds',  amount:2500}},
      {name:'💎 DC x200',      emoji:'💎', rarity:'rare',      chance:18, reward:{type:'dc',     amount:200}},
      {name:'💎 DC x500',      emoji:'💎', rarity:'rare',      chance:11, reward:{type:'dc',     amount:500}},
      {name:'🌟 DC x2000',     emoji:'🌟', rarity:'legendary', chance:1,  reward:{type:'dc',     amount:2000}},
    ]
  },
  fernie_starter: {
    name: 'Shadow',
    items: [
      {name:'🌱 Семена x300',  emoji:'🌱', rarity:'common',    chance:45, reward:{type:'seeds',  amount:300}},
      {name:'💵 Игровая Валюта x5000', emoji:'💵', rarity:'common',    chance:30, reward:{type:'rubles', amount:5000}},
      {name:'💵 Игровая Валюта x15000',emoji:'💵', rarity:'rare',      chance:15, reward:{type:'rubles', amount:15000}},
      {name:'💎 DC x30',       emoji:'💎', rarity:'rare',      chance:9,  reward:{type:'dc',     amount:30}},
      {name:'⭐ DC x300',      emoji:'⭐', rarity:'legendary', chance:1,  reward:{type:'dc',     amount:300}},
    ]
  },
  fernie_crystal: {
    name: 'Crystal',
    items: [
      {name:'🌱 Семена x1000', emoji:'🌱', rarity:'common',    chance:40, reward:{type:'seeds',  amount:1000}},
      {name:'💵 Игровая Валюта x20000',emoji:'💵', rarity:'common',    chance:28, reward:{type:'rubles', amount:20000}},
      {name:'💎 DC x200',      emoji:'💎', rarity:'rare',      chance:18, reward:{type:'dc',     amount:200}},
      {name:'💵 Игровая Валюта x50000',emoji:'💵', rarity:'rare',      chance:10, reward:{type:'rubles', amount:50000}},
      {name:'🌟 DC x2000',     emoji:'🌟', rarity:'legendary', chance:3,  reward:{type:'dc',     amount:2000}},
      {name:'👑 DC x5000',     emoji:'👑', rarity:'legendary', chance:1,  reward:{type:'dc',     amount:5000}},
    ]
  },
  fernie_royal: {
    name: 'Royal',
    items: [
      {name:'🌱 Семена x3000',  emoji:'🌱', rarity:'common',    chance:35, reward:{type:'seeds',  amount:3000}},
      {name:'💵 Игровая Валюта x50000', emoji:'💵', rarity:'common',    chance:28, reward:{type:'rubles', amount:50000}},
      {name:'💎 DC x500',       emoji:'💎', rarity:'rare',      chance:20, reward:{type:'dc',     amount:500}},
      {name:'💵 Игровая Валюта x150000',emoji:'💵', rarity:'rare',      chance:11, reward:{type:'rubles', amount:150000}},
      {name:'🌟 DC x3000',      emoji:'🌟', rarity:'epic',      chance:5,  reward:{type:'dc',     amount:3000}},
      {name:'👑 DC x10000',     emoji:'👑', rarity:'legendary', chance:1,  reward:{type:'dc',     amount:10000}},
    ]
  },
};

function weightedRandom(items) {
  const total = items.reduce((s, i) => s + i.chance, 0);
  let r = Math.random() * total;
  for (const item of items) { r -= item.chance; if (r <= 0) return item; }
  return items[items.length - 1];
}

app.post("/api/cases/open", async (req, res) => {
  const { userId, caseSlug, skipNotify } = req.body;  // добавь skipNotify
  if (!userId || !caseSlug) return res.json({ success: false, error: "Недостаточно данных" });

  const caseDef = CASE_DEFINITIONS[caseSlug];
  if (!caseDef) return res.json({ success: false, error: "Кейс не найден" });

  try {
    const invRes = await fetch(`${SB_URL}/rest/v1/inventory?user_id=eq.${userId}&case_slug=eq.${caseSlug}&select=*`, { headers: sbHeaders });
    const invData = await invRes.json();
    if (!invData.length || invData[0].quantity < 1)
      return res.json({ success: false, error: "Кейса нет в инвентаре" });

    const newQty = invData[0].quantity - 1;
    if (newQty > 0) {
      await fetch(`${SB_URL}/rest/v1/inventory?user_id=eq.${userId}&case_slug=eq.${caseSlug}`, {
        method: "PATCH", headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ quantity: newQty })
      });
    } else {
      await fetch(`${SB_URL}/rest/v1/inventory?user_id=eq.${userId}&case_slug=eq.${caseSlug}`, {
        method: "DELETE", headers: sbHeaders
      });
    }

    const wonItem = weightedRandom(caseDef.items);

    // Уведомление только если skipNotify не передан
    if (!skipNotify) {
      const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`, { headers: sbHeaders });
      const users = await userRes.json();
      const { telegram_id, username } = users[0] || {};

      if (telegram_id && BOT_URL) {
        notifyBot(`${BOT_URL}/api/fernieid/notify`, {
          telegram_id,
          type: "case_reward",
          username: username || "—",
          case_name: caseDef.name,
          item_name: wonItem.name,
          item_emoji: wonItem.emoji,
          item_rarity: wonItem.rarity,
          reward: wonItem.reward
        });
      }
    }

    res.json({
      success: true,
      item: { name: wonItem.name, emoji: wonItem.emoji, rarity: wonItem.rarity, reward: wonItem.reward },
      inventory_left: newQty
    });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

app.post("/api/cases/notify-batch", async (req, res) => {
  const { userId, caseSlug, results } = req.body;
  if (!userId || !results?.length) return res.json({ success: false });
  try {
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`, { headers: sbHeaders });
    const users = await userRes.json();
    const { telegram_id, username } = users[0] || {};
    if (!telegram_id) return res.json({ success: false });
    const caseDef = CASE_DEFINITIONS[caseSlug];

    // Начисляем все награды одним батч-запросом — бот начислит без сообщений
    await notifyBot(`${BOT_URL}/api/fernieid/notify`, {
      telegram_id,
      type: "case_reward_batch",
      username: username || "—",
      case_name: caseDef?.name || caseSlug,
      results: results.map(item => ({
        reward: item.reward
      }))
    });

    // Одно итоговое сообщение
    const rarityLabels = {common:'🔘 Обычный', rare:'🔵 Редкий', epic:'🟣 Эпический', legendary:'🟡 Легендарный'};
    const itemsList = results.map((item, i) =>
      `${i+1}. ${item.emoji} <b>${item.name}</b> — ${rarityLabels[item.rarity] || item.rarity}`
    ).join('\n');
    await sendTgMessage(telegram_id,
      `🎰 <b>Итог: открытие ${results.length} кейсов</b>\n\n` +
      `👤 Игрок: <b>${username}</b>\n` +
      `📦 Кейс: <b>${caseDef?.name || caseSlug}</b>\n\n` +
      `<blockquote>${itemsList}</blockquote>`
    );

    res.json({ success: true });
  } catch(e) {
    console.error(e);
    res.json({ success: false });
  }
});

// ══════════════════════════════════════════
//  Инвентарь пользователя
// ══════════════════════════════════════════
app.get("/api/inventory/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const invRes = await fetch(`${SB_URL}/rest/v1/inventory?user_id=eq.${userId}&select=*`, { headers: sbHeaders });
    const data = await invRes.json();
    res.json({ success: true, items: data });
  } catch (e) {
    res.json({ success: false, items: [] });
  }
});

// ══════════════════════════════════════════
//  MC Launcher login — регистрирует лаунчер
// ══════════════════════════════════════════
app.post("/api/mc/launcher-login", async (req, res) => {
  const { userId, profiles, username } = req.body;
  if (!userId) return res.json({ success: false });
  try {
    for (const profile of (profiles || [])) {
      const check = await fetch(
        `${SB_URL}/rest/v1/mc_profiles?user_id=eq.${userId}&profile_name=eq.${encodeURIComponent(profile)}`,
        { headers: sbHeaders }
      );
      const existing = await check.json();
      if (!existing.length) {
        await fetch(`${SB_URL}/rest/v1/mc_profiles`, {
          method: "POST", headers: { ...sbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ user_id: userId, profile_name: profile })
        });
      }
    }
    res.json({ success: true });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

// ══════════════════════════════════════════
//  MC Session — start / end
// ══════════════════════════════════════════
app.post("/api/mc/session", async (req, res) => {
  const { userId, event, profile, version } = req.body;
  if (!userId || !event) return res.json({ success: false });
  try {
    const now = new Date().toISOString();
    if (event === "start") {
      await fetch(`${SB_URL}/rest/v1/mc_sessions`, {
        method: "POST", headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: userId, profile_name: profile || "Player",
          version: version || "unknown", started_at: now, ended_at: null })
      });
    } else if (event === "end") {
      const open = await fetch(
        `${SB_URL}/rest/v1/mc_sessions?user_id=eq.${userId}&profile_name=eq.${encodeURIComponent(profile||"Player")}&ended_at=is.null&order=started_at.desc&limit=1`,
        { headers: sbHeaders }
      );
      const sessions = await open.json();
      if (sessions.length) {
        const dur = Math.floor((Date.now() - new Date(sessions[0].started_at).getTime()) / 1000);
        await fetch(`${SB_URL}/rest/v1/mc_sessions?id=eq.${sessions[0].id}`, {
          method: "PATCH", headers: { ...sbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ ended_at: now, duration_seconds: dur })
        });
      }
    }
    res.json({ success: true });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

// ══════════════════════════════════════════
//  MC Stats для лаунчера
// ══════════════════════════════════════════
app.get("/api/mc/stats/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/mc_sessions?user_id=eq.${userId}&ended_at=not.is.null&select=*&order=started_at.desc`,
      { headers: sbHeaders }
    );
    const sessions = await r.json();

    const now = new Date();
    const todayStr  = now.toISOString().slice(0,10);
    const weekAgo   = new Date(now - 7*864e5).toISOString();
    const monthAgo  = new Date(now - 30*864e5).toISOString();

    const totalSec  = sessions.reduce((s,x) => s+(x.duration_seconds||0), 0);
    const todaySec  = sessions.filter(x => x.started_at >= todayStr+'T00:00:00').reduce((s,x)=>s+(x.duration_seconds||0),0);
    const weekSec   = sessions.filter(x => x.started_at >= weekAgo).reduce((s,x)=>s+(x.duration_seconds||0),0);
    const monthSec  = sessions.filter(x => x.started_at >= monthAgo).reduce((s,x)=>s+(x.duration_seconds||0),0);

    const profileMap = {};
    sessions.forEach(s => {
      const p = s.profile_name || "Player";
      if (!profileMap[p]) profileMap[p] = { profile:p, total_seconds:0, today:0, week:0, month:0 };
      profileMap[p].total_seconds += s.duration_seconds||0;
      if (s.started_at >= todayStr+'T00:00:00') profileMap[p].today += s.duration_seconds||0;
      if (s.started_at >= weekAgo)  profileMap[p].week  += s.duration_seconds||0;
      if (s.started_at >= monthAgo) profileMap[p].month += s.duration_seconds||0;
    });

    const dailyMap = {};
    sessions.forEach(s => {
      const date = s.started_at.slice(0,10);
      const key  = date + '|' + (s.profile_name||"Player");
      if (!dailyMap[key]) dailyMap[key] = { date, profile: s.profile_name||"Player", seconds: 0 };
      dailyMap[key].seconds += s.duration_seconds||0;
    });

    res.json({
      total_seconds: totalSec,
      today_seconds: todaySec,
      week_seconds:  weekSec,
      month_seconds: monthSec,
      profiles: Object.values(profileMap).sort((a,b) => b.total_seconds - a.total_seconds),
      daily:    Object.values(dailyMap)
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════
//  Сторонние игры пользователя
// ══════════════════════════════════════════
app.get("/api/third-party-games/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/mc_profiles?user_id=eq.${userId}&select=profile_name`,
      { headers: sbHeaders }
    );
    const profiles = await r.json();
    const games = [];
    if (profiles.length) {
      games.push({
        id: 'minecraft',
        name: 'Minecraft',
        icon: '⛏️',
        color: 'mint',
        profiles: profiles.map(p => p.profile_name)
      });
    }
    res.json({ success: true, games });
  } catch (e) {
    res.json({ success: false, games: [] });
  }
});

// ══════════════════════════════════════════
//  ADMIN API
// ══════════════════════════════════════════

async function checkAdmin(adminId) {
  const r = await fetch(`${SB_URL}/rest/v1/users?id=eq.${adminId}&select=role`, { headers: sbHeaders });
  const d = await r.json();
  return d[0]?.role === 'admin';
}

// Список всех пользователей
app.get('/api/admin/users', async (req, res) => {
  const { adminId } = req.query;
  if (!adminId) return res.json({ success: false, error: 'Нет adminId' });
  try {
    if (!await checkAdmin(adminId)) return res.json({ success: false, error: 'Нет доступа' });
    const r = await fetch(
      `${SB_URL}/rest/v1/users?select=id,username,role,balance,created_at,telegram_id&order=created_at.desc`,
      { headers: sbHeaders }
    );
    const data = await r.json();
    res.json({ success: true, users: data });
  } catch(e) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

// Статистика для админ панели
app.get('/api/admin/stats', async (req, res) => {
  const { adminId } = req.query;
  if (!adminId) return res.json({ success: false, error: 'Нет adminId' });
  try {
    if (!await checkAdmin(adminId)) return res.json({ success: false, error: 'Нет доступа' });
    const usersR = await fetch(`${SB_URL}/rest/v1/users?select=id,role,telegram_id,created_at`, { headers: sbHeaders });
    const users = await usersR.json();
    const sessionsR = await fetch(`${SB_URL}/rest/v1/game_sessions?select=id,score,started_at`, { headers: sbHeaders });
    const sessions = await sessionsR.json();
    const today = new Date().toISOString().slice(0,10);
    res.json({
      success: true,
      total_users: users.length,
      admin_count: users.filter(u => u.role === 'admin').length,
      tg_linked: users.filter(u => u.telegram_id).length,
      new_today: users.filter(u => u.created_at?.startsWith(today)).length,
      total_sessions: sessions.length,
      sessions_today: sessions.filter(s => s.started_at?.startsWith(today)).length,
    });
  } catch(e) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

// Игровая статистика пользователя (для админа)
app.get('/api/admin/user-sessions/:userId', async (req, res) => {
  const { adminId } = req.query;
  if (!adminId) return res.json({ success: false, error: 'Нет adminId' });
  try {
    if (!await checkAdmin(adminId)) return res.json({ success: false, error: 'Нет доступа' });
    const r = await fetch(
      `${SB_URL}/rest/v1/game_sessions?user_id=eq.${req.params.userId}&select=id,score,started_at,games(title,slug)&order=started_at.desc&limit=50`,
      { headers: sbHeaders }
    );
    const data = await r.json();
    res.json({ success: true, sessions: data });
  } catch(e) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

// Обновить пользователя (пароль, telegram, role)
app.post('/api/admin/update-user', async (req, res) => {
  const { adminId, userId, newPassword, telegramId, role } = req.body;
  if (!adminId || !userId) return res.json({ success: false, error: 'Нет данных' });
  try {
    if (!await checkAdmin(adminId)) return res.json({ success: false, error: 'Нет доступа' });
    const patch = {};
    if (role !== undefined) patch.role = role;
    if (telegramId !== undefined) patch.telegram_id = telegramId === '' ? null : parseInt(telegramId) || null;
    if (newPassword && newPassword.length >= 4) {
      const hash = await bcrypt.hash(newPassword, 10);
      patch.password_hash = hash;
    }
    if (!Object.keys(patch).length) return res.json({ success: false, error: 'Нечего обновлять' });
    const r = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(patch)
    });
    if (r.ok) res.json({ success: true });
    else res.json({ success: false, error: 'Ошибка обновления' });
  } catch(e) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

// Удалить пользователя
app.post('/api/admin/delete-user', async (req, res) => {
  const { adminId, userId } = req.body;
  if (!adminId || !userId) return res.json({ success: false, error: 'Нет данных' });
  try {
    if (!await checkAdmin(adminId)) return res.json({ success: false, error: 'Нет доступа' });
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, { method: 'DELETE', headers: sbHeaders });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

// ══════════════════════════════════════════
//  Fernie+ — подписка
// ══════════════════════════════════════════
app.get('/api/fernieplus/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`, { headers: sbHeaders });
    const users = await userRes.json();
    if (!users.length || !users[0].telegram_id)
      return res.json({ success: false, error: 'Telegram не привязан' });
    const botRes = await fetch(`${BOT_URL}/api/fernieplus/status?telegram_id=${users[0].telegram_id}`);
    const data = await botRes.json();
    res.json({ success: true, ...data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ══════════════════════════════════════════
//  Фоны — список
// ══════════════════════════════════════════
app.get('/api/backgrounds', async (req, res) => {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/backgrounds?select=*&order=created_at.desc`, { headers: sbHeaders });
    const data = await r.json();
    res.json({ success: true, backgrounds: data });
  } catch (e) { res.json({ success: false, backgrounds: [] }); }
});

// Фоны конкретного пользователя
app.get('/api/backgrounds/user/:userId', async (req, res) => {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/backgrounds?uploader_id=eq.${req.params.userId}&select=*&order=created_at.desc`, { headers: sbHeaders });
    const data = await r.json();
    res.json({ success: true, backgrounds: data });
  } catch (e) { res.json({ success: false, backgrounds: [] }); }
});

// Понравившиеся
app.get('/api/backgrounds/liked/:userId', async (req, res) => {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/background_likes?user_id=eq.${req.params.userId}&select=background_id,backgrounds(*)`, { headers: sbHeaders });
    const data = await r.json();
    res.json({ success: true, liked: data.map(x => x.backgrounds).filter(Boolean) });
  } catch (e) { res.json({ success: false, liked: [] }); }
});

// Лайк / анлайк
app.post('/api/backgrounds/like', async (req, res) => {
  const { userId, backgroundId, action } = req.body;
  try {
    if (action === 'like') {
      await fetch(`${SB_URL}/rest/v1/background_likes`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: userId, background_id: backgroundId })
      });
    } else {
      await fetch(`${SB_URL}/rest/v1/background_likes?user_id=eq.${userId}&background_id=eq.${backgroundId}`, {
        method: 'DELETE', headers: sbHeaders
      });
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});

// Установить фон
app.post('/api/backgrounds/set', async (req, res) => {
  const { userId, backgroundId } = req.body;
  try {
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`, { headers: sbHeaders });
    const users = await userRes.json();
    if (!users.length || !users[0].telegram_id)
      return res.json({ success: false, error: 'Telegram не привязан' });
    const bgRes = await fetch(`${SB_URL}/rest/v1/backgrounds?id=eq.${backgroundId}&select=*`, { headers: sbHeaders });
    const bgs = await bgRes.json();
    if (!bgs.length) return res.json({ success: false, error: 'Фон не найден' });
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ active_background_id: backgroundId })
    });
    await notifyBot(`${BOT_URL}/api/fernieplus/background`, {
      telegram_id: users[0].telegram_id,
      media_url: bgs[0].image_url,
      media_type: 'photo'
    });
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Добавить фон (пользователь)
app.post('/api/backgrounds/create', async (req, res) => {
  const { userId, name, description, imageUrl } = req.body;
  if (!userId || !name || !imageUrl) return res.json({ success: false, error: 'Нет данных' });
  const BAD_WORDS = ['хуй','пизд','блят','блядь','ебан','еблан','сука','пидор','мудак','залупа','ёбан','шлюх'];
  if (BAD_WORDS.some(w => name.toLowerCase().includes(w)))
    return res.json({ success: false, error: 'Название содержит недопустимые слова' });
  try {
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=username`, { headers: sbHeaders });
    const users = await userRes.json();
    const username = users[0]?.username || 'Аноним';

    // Загружаем картинку в Supabase Storage
    let finalUrl = imageUrl;
    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:(.+);base64,(.+)$/);
      if (!matches) return res.json({ success: false, error: 'Неверный формат изображения' });
      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');
      const ext = mimeType.includes('png') ? 'png' : 'jpg';
      const fileName = `bg_${userId}_${Date.now()}.${ext}`;

      const uploadRes = await fetch(`${SB_URL}/storage/v1/object/backgrounds/${fileName}`, {
        method: 'POST',
        headers: {
          apikey: SB_SERVICE_KEY,
          Authorization: `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type': mimeType,
          'x-upsert': 'true'
        },
        body: buffer
      });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.error('Storage upload error:', errText);
        return res.json({ success: false, error: 'Ошибка загрузки изображения: ' + errText });
      }
      finalUrl = `${SB_URL}/storage/v1/object/public/backgrounds/${fileName}`;
    }

    const r = await fetch(`${SB_URL}/rest/v1/backgrounds`, {
      method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ name, description: description || null, image_url: finalUrl, uploader_id: parseInt(userId), author: username, type: 'custom' })
    });
    const data = await r.json();
    if (!r.ok) return res.json({ success: false, error: JSON.stringify(data) });
    res.json({ success: true, background: data[0] });
  } catch (e) {
    console.error('create bg error:', e);
    res.json({ success: false, error: e.message });
  }
});
// Удалить фон пользователя
app.delete('/api/backgrounds/:id', async (req, res) => {
  const { userId } = req.body;
  const { id } = req.params;
  try {
    const check = await fetch(`${SB_URL}/rest/v1/backgrounds?id=eq.${id}&uploader_id=eq.${userId}&select=id`, { headers: sbHeaders });
    const rows = await check.json();
    if (!rows.length) return res.json({ success: false, error: 'Нет доступа' });
    await fetch(`${SB_URL}/rest/v1/backgrounds?id=eq.${id}`, { method: 'DELETE', headers: sbHeaders });
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Получить активный фон пользователя
app.get('/api/backgrounds/active/:userId', async (req, res) => {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/users?id=eq.${req.params.userId}&select=active_background_id`, { headers: sbHeaders });
    const users = await r.json();
    res.json({ success: true, active_background_id: users[0]?.active_background_id || null });
  } catch (e) { res.json({ success: false }); }
});

// Отправить фото в Telegram (для уведомления об удалении фона)
app.post('/api/telegram/send-photo-message', async (req, res) => {
  const { telegram_id, photo_url, caption } = req.body;
  if (!telegram_id || !photo_url) return res.json({ success: false });
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegram_id, photo: photo_url, caption, parse_mode: 'HTML' })
    });
    if (!r.ok) {
      // Fallback: отправить без фото если фото недоступно
      await sendTgMessage(telegram_id, caption);
    }
    res.json({ success: true });
  } catch(e) {
    console.error('send-photo-message error:', e);
    res.json({ success: false });
  }
});

// ══════════════════════════════════════════════════════════════════
//  FEDERAL BANK ROBBERY — API ENDPOINTS
// ══════════════════════════════════════════════════════════════════

// ── Проверка привязки TG + информация для страницы ──────────────
app.get('/api/bank-info', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json({ success: false, error: 'Нет userId' });
  try {
    const r = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`, { headers: sbHeaders });
    const users = await r.json();
    if (!users.length) return res.json({ success: false, error: 'Пользователь не найден' });
    const user = users[0];
    res.json({
      success: true,
      telegram_linked: !!user.telegram_id,
      telegram_id: user.telegram_id,
      username: user.username
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── Баланс административной казны (через бота) ──────────────────
app.get('/api/treasury-balance', async (req, res) => {
  try {
    const r = await fetch(`${BOT_URL}/api/treasury/balance`);
    if (!r.ok) throw new Error('Bot unreachable');
    const d = await r.json();
    res.json({ success: true, balance: d.balance ?? 0 });
  } catch (e) {
    // Fallback: вернуть 0 если бот недоступен
    console.error('treasury-balance error:', e.message);
    res.json({ success: true, balance: 0, error: e.message });
  }
});

// ── Кулдаун ограбления ──────────────────────────────────────────
app.get('/api/robbery-cooldown', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json({ success: false });
  const uid = parseInt(userId);
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/robbery_cooldowns?user_id=eq.${uid}&select=last_robbery_at`,
      { headers: sbHeaders }
    );
    const rows = await r.json();
    if (!rows.length) return res.json({ success: true, on_cooldown: false });

    const lastAt = new Date(rows[0].last_robbery_at);
    const cooldownMs = 6 * 60 * 60 * 1000; // 6 часов
    const diff = Date.now() - lastAt.getTime();
    if (diff >= cooldownMs) return res.json({ success: true, on_cooldown: false });

    const remaining = Math.ceil((cooldownMs - diff) / 1000);
    res.json({ success: true, on_cooldown: true, remaining_seconds: remaining });
  } catch (e) {
    res.json({ success: true, on_cooldown: false });
  }
});

app.post('/api/rob-fail', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.json({ success: false });
  const uid = parseInt(userId);
  try {
    const fakeTime = new Date(Date.now() - (4 * 60 * 60 * 1000)).toISOString();
    const existRes = await fetch(
      `${SB_URL}/rest/v1/robbery_cooldowns?user_id=eq.${uid}&select=user_id`,
      { headers: sbHeaders }
    );
    const existRows = await existRes.json();
    console.log('rob-fail existRows:', existRows, 'uid:', uid);
    if (existRows.length) {
      const updateRes = await fetch(`${SB_URL}/rest/v1/robbery_cooldowns?user_id=eq.${uid}`, {
        method: 'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ last_robbery_at: fakeTime })
      });
      if (!updateRes.ok) {
        throw new Error(`rob-fail PATCH failed: ${updateRes.status} ${await updateRes.text()}`);
      }
    } else {
      const insertRes = await fetch(`${SB_URL}/rest/v1/robbery_cooldowns`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: uid, last_robbery_at: fakeTime })
      });
      if (!insertRes.ok) {
        throw new Error(`rob-fail POST failed: ${insertRes.status} ${await insertRes.text()}`);
      }
    }
    // Проверяем что реально записалось
    const checkRes = await fetch(
      `${SB_URL}/rest/v1/robbery_cooldowns?user_id=eq.${uid}&select=last_robbery_at`,
      { headers: sbHeaders }
    );
    const checkRows = await checkRes.json();
    console.log('rob-fail after write:', checkRows);
    res.json({ success: true });
  } catch(e) {
    console.error('rob-fail error:', e);
    res.json({ success: false, error: e.message });
  }
});
// ── Выполнить ограбление ─────────────────────────────────────────
app.post('/api/rob-bank', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.json({ success: false, error: 'Нет userId' });

  try {
    // 1. Получаем telegram_id юзера
    const userRes = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`,
      { headers: sbHeaders }
    );
    const users = await userRes.json();
    if (!users.length || !users[0].telegram_id)
      return res.json({ success: false, error: 'Telegram не привязан' });
    const { telegram_id, username } = users[0];

    // 2. Проверяем кулдаун
    const cdRes = await fetch(
      `${SB_URL}/rest/v1/robbery_cooldowns?user_id=eq.${userId}&select=last_robbery_at`,
      { headers: sbHeaders }
    );
    const cdRows = await cdRes.json();
    if (cdRows.length) {
      const lastAt = new Date(cdRows[0].last_robbery_at);
      const diff = Date.now() - lastAt.getTime();
      if (diff < 6 * 60 * 60 * 1000)
        return res.json({ success: false, error: 'Ещё на перезарядке' });
    }

    // 3. Получаем баланс казны через бота
    let treasuryBalance = 0;
    try {
      const tbRes = await fetch(`${BOT_URL}/api/treasury/balance`);
      const tbData = await tbRes.json();
      treasuryBalance = Number(tbData.balance) || 0;
    } catch (e) {
      console.error('treasury fetch error:', e.message);
    }

    if (treasuryBalance <= 0)
      return res.json({ success: false, error: 'Казна пуста, грабить нечего!' });

    // 4. Рандомная сумма: 2-3% от баланса казны (минимум 100)
    const maxSteal = Math.floor(treasuryBalance * 0.03);
    const minSteal = Math.max(100, Math.floor(treasuryBalance * 0.02));
    const amount = Math.floor(minSteal + Math.random() * (maxSteal - minSteal));

    // 5. Списываем с казны и начисляем игроку через бота
    const robRes = await notifyBot(`${BOT_URL}/api/treasury/rob`, {
      telegram_id,
      amount,
      username
    });

    if (!robRes || !robRes.success)
      return res.json({ success: false, error: robRes?.error || 'Ошибка транзакции' });

    // 6. Записываем кулдаун
    const now = new Date().toISOString();
    const existCD = await fetch(
      `${SB_URL}/rest/v1/robbery_cooldowns?user_id=eq.${userId}&select=user_id`,
      { headers: sbHeaders }
    );
    const existCDRows = await existCD.json();

    if (existCDRows.length) {
      await fetch(`${SB_URL}/rest/v1/robbery_cooldowns?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ last_robbery_at: now })
      });
    } else {
      await fetch(`${SB_URL}/rest/v1/robbery_cooldowns`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: userId, last_robbery_at: now })
      });
    }

    // 7. Уведомление в TG
    await sendTgMessage(telegram_id,
      `🏦 <b>Ограбление Федерального Банка</b>\n\n` +
      `<blockquote>` +
      `💰 Ты успешно ограбил Федеральный Банк!\n` +
      `💵 Сумма: <b>${Number(amount).toLocaleString('ru-RU')} ₽</b>\n` +
      `</blockquote>\n\n` +
      `⏳ <i>Следующее ограбление доступно через 6 часов.</i>`
    );

    res.json({ success: true, amount });

  } catch (e) {
    console.error('rob-bank error:', e);
    res.json({ success: false, error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════
//  COLLECTION CARDS
// ══════════════════════════════════════════════════════════════════

// ── Каталог карточек из Supabase ─────────────────────────────────
app.get('/api/cards-catalog', async (req, res) => {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/cards_catalog?select=*&order=rarity.asc,name.asc`, { headers: sbHeaders });
    const data = await r.json();
    res.json({ success: true, catalog: data });
  } catch (e) {
    console.error('cards-catalog error:', e);
    res.json({ success: false, catalog: [] });
  }
});

// ── Карточки пользователя (через бота) ──────────────────────────
app.get('/api/user-cards', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json({ success: false, error: 'Нет userId' });
  try {
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`, { headers: sbHeaders });
    const users = await userRes.json();
    if (!users.length || !users[0].telegram_id)
      return res.json({ success: false, cards: [], error: 'Telegram не привязан' });

    const telegram_id = users[0].telegram_id;
    const botRes = await fetch(`${BOT_URL}/api/cards?telegram_id=${telegram_id}&user_id=${userId}`);
    const botData = await botRes.json();
    res.json({ success: true, cards: botData.cards || [] });
  } catch (e) {
    console.error('user-cards error:', e);
    res.json({ success: false, cards: [], error: e.message });
  }
});

// ── DC баланс пользователя (через бота) ─────────────────────────
app.get('/api/dc/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`, { headers: sbHeaders });
    const users = await userRes.json();
    if (!users.length || !users[0].telegram_id)
      return res.json({ success: false, dc: 0, error: 'Telegram не привязан' });

    const botRes = await fetch(`${BOT_URL}/api/dc?telegram_id=${users[0].telegram_id}`);
    const botData = await botRes.json();
    res.json({ success: true, dc: Number(botData.dc ?? botData.balance ?? 0) });
  } catch (e) {
    console.error('dc error:', e);
    res.json({ success: false, dc: 0, error: e.message });
  }
});

app.get('/api/card-market/state/:userId', async (req, res) => {
  try {
    const telegramId = await resolveTelegramId(req.params.userId);
    if (!telegramId) return res.json({ success: false, error: 'Telegram не привязан' });
    const r = await fetch(`${BOT_URL}/api/market/state?telegram_id=${telegramId}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('card-market state error:', e);
    res.json({ success: false, error: e.message, listings: [], my_listings: [], my_orders: [], history: [] });
  }
});

app.post('/api/card-market/sell', async (req, res) => {
  try {
    const { userId, cardId, price } = req.body;
    const telegramId = await resolveTelegramId(userId);
    if (!telegramId) return res.json({ success: false, error: 'Telegram не привязан' });
    const r = await fetch(`${BOT_URL}/api/market/sell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, fernie_user_id: userId, card_id: cardId, price })
    });
    res.json(await r.json());
  } catch (e) {
    console.error('card-market sell error:', e);
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/card-market/buy', async (req, res) => {
  try {
    const { userId, listingId } = req.body;
    const telegramId = await resolveTelegramId(userId);
    if (!telegramId) return res.json({ success: false, error: 'Telegram не привязан' });
    const r = await fetch(`${BOT_URL}/api/market/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, listing_id: listingId })
    });
    res.json(await r.json());
  } catch (e) {
    console.error('card-market buy error:', e);
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/card-market/order', async (req, res) => {
  try {
    const { userId, catalogCardId, maxPrice } = req.body;
    const telegramId = await resolveTelegramId(userId);
    if (!telegramId) return res.json({ success: false, error: 'Telegram не привязан' });
    const r = await fetch(`${BOT_URL}/api/market/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, catalog_card_id: catalogCardId, max_price: maxPrice })
    });
    res.json(await r.json());
  } catch (e) {
    console.error('card-market order error:', e);
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/card-market/cancel-listing', async (req, res) => {
  try {
    const { userId, listingId } = req.body;
    const telegramId = await resolveTelegramId(userId);
    if (!telegramId) return res.json({ success: false, error: 'Telegram не привязан' });
    const r = await fetch(`${BOT_URL}/api/market/cancel-listing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, listing_id: listingId })
    });
    res.json(await r.json());
  } catch (e) {
    console.error('card-market cancel listing error:', e);
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/card-market/cancel-order', async (req, res) => {
  try {
    const { userId, orderId } = req.body;
    const telegramId = await resolveTelegramId(userId);
    if (!telegramId) return res.json({ success: false, error: 'Telegram не привязан' });
    const r = await fetch(`${BOT_URL}/api/market/cancel-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, order_id: orderId })
    });
    res.json(await r.json());
  } catch (e) {
    console.error('card-market cancel order error:', e);
    res.json({ success: false, error: e.message });
  }
});

// ══════════════════════════════════════════
//  PACKS API
// ══════════════════════════════════════════

// Каталог паков
app.get('/api/packs-catalog', async (req, res) => {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/packs_catalog?select=*`, { headers: sbHeaders });
    const packs = await r.json();
    res.json({ success: true, packs });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Паки пользователя
app.get('/api/user-packs', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json({ success: false, error: 'Нет userId' });
  try {
    const r = await fetch(`${SB_URL}/rest/v1/user_packs?user_id=eq.${userId}&select=*`, { headers: sbHeaders });
    let userPacks = await r.json();
    const catR = await fetch(`${SB_URL}/rest/v1/packs_catalog?select=*`, { headers: sbHeaders });
    const catalog = await catR.json();
    const packs = userPacks.map(p => {
      const cat = catalog.find(c => c.id === p.pack_id) || {};
      return { ...cat, amount: p.amount };
    });
    res.json({ success: true, packs });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Купить пак
app.post('/api/packs/buy', async (req, res) => {
  const { userId, packId, quantity } = req.body;
  if (!userId || !packId || !quantity) return res.json({ success: false, error: 'Нет данных' });
  try {
    const catR = await fetch(`${SB_URL}/rest/v1/packs_catalog?id=eq.${packId}&select=*`, { headers: sbHeaders });
    const pack = (await catR.json())[0];
    if (!pack) return res.json({ success: false, error: 'Пак не найден' });

    const upR = await fetch(`${SB_URL}/rest/v1/user_packs?user_id=eq.${userId}&pack_id=eq.${packId}&select=*`, { headers: sbHeaders });
    const userPacks = await upR.json();
    const have = userPacks[0]?.amount || 0;
    if (have + quantity > 20) return res.json({ success: false, error: `Превышен лимит (у тебя ${have}, макс. 20)` });

    const total = pack.price * quantity;
    // Получаем telegram_id пользователя
    const userR = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`, { headers: sbHeaders });
    const user = (await userR.json())[0];
    if (!user || !user.telegram_id) return res.json({ success: false, error: 'Telegram не привязан' });

    // Списываем DC через бота
    const spendRes = await fetch(`${BOT_URL}/api/dc/spend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: user.telegram_id, amount: total })
    }).then(r => r.json());
    if (!spendRes.success) return res.json({ success: false, error: spendRes.error || 'Недостаточно DC' });

    if (userPacks.length) {
      await fetch(`${SB_URL}/rest/v1/user_packs?id=eq.${userPacks[0].id}`, {
        method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ amount: have + quantity })
      });
    } else {
      const insertRes = await fetch(`${SB_URL}/rest/v1/user_packs`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ user_id: String(userId), pack_id: packId, amount: quantity })
      });
      const insertData = await insertRes.json();
      if (insertRes.status >= 300) return res.json({ success: false, error: JSON.stringify(insertData) });
    }
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Открыть пак
app.post('/api/packs/open', async (req, res) => {
  const { userId, packId } = req.body;
  if (!userId || !packId) return res.json({ success: false, error: 'Нет данных' });
  try {
    const upR = await fetch(`${SB_URL}/rest/v1/user_packs?user_id=eq.${userId}&pack_id=eq.${packId}&select=*`, { headers: sbHeaders });
    const userPacks = await upR.json();
    if (!userPacks.length || userPacks[0].amount < 1) return res.json({ success: false, error: 'Пак не найден в инвентаре' });

    const catR = await fetch(`${SB_URL}/rest/v1/packs_catalog?id=eq.${packId}&select=*`, { headers: sbHeaders });
    const pack = (await catR.json())[0];
    if (!pack) return res.json({ success: false, error: 'Пак не найден' });

    // Парсим шансы: "1=50;2=25;3=25"
    const drops = (pack.cards_drop || '').split(';').map(x => {
      const [id, chance] = x.split('=');
      return { id: Number(id), chance: Number(chance) };
    }).filter(x => x.id && x.chance);
    if (!drops.length) return res.json({ success: false, error: 'Нет карточек в паке' });

    const totalChance = drops.reduce((s, x) => s + x.chance, 0);
    let rnd = Math.random() * totalChance;
    let cardId = null;
    for (const d of drops) {
      if (rnd < d.chance) { cardId = d.id; break; }
      rnd -= d.chance;
    }
    if (!cardId) cardId = drops[0].id;

    const cardR = await fetch(`${SB_URL}/rest/v1/cards_catalog?id=eq.${cardId}&select=*`, { headers: sbHeaders });
    const card = (await cardR.json())[0];
    if (!card) return res.json({ success: false, error: 'Карточка не найдена' });

    // Получаем telegram_id для записи в бота
    const tgR = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`, { headers: sbHeaders });
    const tgUser = (await tgR.json())[0];
    if (!tgUser?.telegram_id) return res.json({ success: false, error: 'Telegram не привязан' });

    // Добавляем карточку через бота
    const cardInsert = await fetch(`${BOT_URL}/api/cards/give`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: tgUser.telegram_id,
        catalog_card_id: card.id,
        card_id: cardId,
        name: card.name,
        rarity: card.rarity,
        image_url: card.image_url
      })
    }).then(r => r.json());
    if (!cardInsert.success) return res.json({ success: false, error: cardInsert.error || 'Ошибка выдачи карточки' });

    // Уменьшаем количество паков
    const newAmount = userPacks[0].amount - 1;
    if (newAmount > 0) {
      await fetch(`${SB_URL}/rest/v1/user_packs?id=eq.${userPacks[0].id}`, {
        method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ amount: newAmount })
      });
    } else {
      await fetch(`${SB_URL}/rest/v1/user_packs?id=eq.${userPacks[0].id}`, {
        method: 'DELETE', headers: sbHeaders
      });
    }

    res.json({ success: true, card });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ══════════════════════════════════════════
//  CRAFT — крафт карточек
// ══════════════════════════════════════════

// Таблица редкостей: что во что крафтится
const CRAFT_RARITY_MAP = {
  'Rare':  'Epic',
  'rare':  'Epic',
  'Epic':  'Legend',
  'epic':  'Legend',
};
const CRAFT_NEEDED = 10;

app.post('/api/cards/craft', async (req, res) => {
  const { userId, cardIds, rarity } = req.body;

  if (!userId || !cardIds || !Array.isArray(cardIds) || cardIds.length !== CRAFT_NEEDED) {
    return res.json({ success: false, error: `Нужно ровно ${CRAFT_NEEDED} карточек` });
  }

  // Определяем целевую редкость
  const rarityKey = (rarity || '').charAt(0).toUpperCase() + (rarity || '').slice(1).toLowerCase();
  const normalizedInput = rarity?.charAt(0).toUpperCase() + rarity?.slice(1).toLowerCase();
  const targetRarity = CRAFT_RARITY_MAP[normalizedInput] || CRAFT_RARITY_MAP[rarity];
  if (!targetRarity) {
    return res.json({ success: false, error: 'Эту редкость нельзя крафтить (только Rare и Epic)' });
  }

  try {
    // 1. Получаем telegram_id
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`, { headers: sbHeaders });
    const users = await userRes.json();
    if (!users.length || !users[0].telegram_id) {
      return res.json({ success: false, error: 'Telegram не привязан' });
    }
    const { telegram_id, username } = users[0];

    // 2. Отправляем крафт-запрос в бота
    //    Бот должен: проверить что карточки принадлежат юзеру,
    //    удалить 10 карточек, выдать 1 случайную карточку targetRarity
    const craftRes = await fetch(`${BOT_URL}/api/cards/craft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id,
        card_ids: cardIds,       // массив ID карточек для уничтожения
        source_rarity: normalizedInput,
        target_rarity: targetRarity,
        fernie_user_id: userId
      })
    });

    const craftData = await craftRes.json();

    if (!craftData.success) {
      return res.json({ success: false, error: craftData.error || 'Ошибка крафта в боте' });
    }

    // 3. Уведомляем пользователя в TG
    const card = craftData.card;
    await sendTgMessage(telegram_id,
      `⚗️ <b>Крафт завершён!</b>\n\n` +
      `<blockquote>` +
      `🃏 Скрафчено: <b>${card?.name || '—'}</b>\n` +
      `✨ Редкость: <b>${targetRarity}</b>\n` +
      `🔥 Использовано: <b>${CRAFT_NEEDED} карточек ${normalizedInput}</b>` +
      `</blockquote>`
    );

    res.json({ success: true, card: craftData.card });

  } catch (e) {
    console.error('craft error:', e);
    res.json({ success: false, error: e.message });
  }
});

// ── Роут для CollectionCard без .html ────────────────────────────
app.get('/CollectionCard', (req, res) => {
  res.sendFile('CollectionCard.html', { root: 'public' });
});

// ══════════════════════════════════════════════════════════════
//  SUPPORT TICKETS — система обращений
// ══════════════════════════════════════════════════════════════

async function generateTicketNum() {
  const res = await fetch(
    `${SB_URL}/rest/v1/support_tickets?select=ticket_num&order=id.desc&limit=1`,
    { headers: sbHeaders }
  );
  const rows = await res.json();
  if (!rows.length) return 'TK-00001';
  const last = parseInt(rows[0].ticket_num.replace('TK-', ''), 10) || 0;
  return `TK-${String(last + 1).padStart(5, '0')}`;
}

function nowFormatted() {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// POST /api/tickets/create
app.post('/api/tickets/create', async (req, res) => {
  const { nick, telegram_id, type, description } = req.body;
  if (!nick || !type || !telegram_id) return res.json({ success: false, error: 'Нет данных' });
  if (!/^\d+$/.test(String(telegram_id))) return res.json({ success: false, error: 'Неверный Telegram ID' });

  const typeLabels = {
    bug: 'Баг / Ошибка', suggest: 'Предложение',
    question: 'Вопрос', complaint: 'Жалоба', other: 'Другое'
  };
  if (!typeLabels[type]) return res.json({ success: false, error: 'Неверный тип' });

  try {
    const ticketNum = await generateTicketNum();
    const history = JSON.stringify([{ status: 'Обращение создано', date: nowFormatted() }]);

    const insertRes = await fetch(`${SB_URL}/rest/v1/support_tickets`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        ticket_num: ticketNum, user_nick: nick, telegram_id: String(telegram_id),
        type: typeLabels[type], status: 'open', admin_nick: 'Не назначен',
        description: description || '', history
      })
    });
    const insertData = await insertRes.json();
    if (insertRes.status >= 300) {
      console.error('ticket insert error:', insertData);
      return res.json({ success: false, error: 'Ошибка создания обращения' });
    }

    // Уведомление пользователю
    await sendTgMessage(String(telegram_id),
      `📩 <b>Обращение создано!</b>\n\n<blockquote>` +
      `🔖 Номер: <b>${ticketNum}</b>\n` +
      `📋 Тип: <b>${typeLabels[type]}</b>\n` +
      `🕒 Создано: <b>${nowFormatted()} МСК</b></blockquote>\n\n` +
      `<i>Сохрани номер — по нему можно проверить статус.</i>`
    );

    // Уведомление администраторам
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (BOT_TOKEN && adminChatId) {
      await sendTgMessage(adminChatId,
        `📩 <b>Новое обращение ${ticketNum}</b>\n\n<blockquote>` +
        `👤 Ник: <b>${nick}</b>\n📋 Тип: <b>${typeLabels[type]}</b>\n` +
        `✈️ TG: <code>${telegram_id}</code>\n` +
        `🕒 Создано: <b>${nowFormatted()} МСК</b></blockquote>`
      );
    }

    res.json({ success: true, ticketNum });
  } catch (e) {
    console.error('create ticket error:', e);
    res.json({ success: false, error: 'Ошибка сервера' });
  }
});

// GET /api/tickets/:ticketNum
app.get('/api/tickets/:ticketNum', async (req, res) => {
  const { ticketNum } = req.params;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/support_tickets?ticket_num=eq.${encodeURIComponent(ticketNum)}&select=*`,
      { headers: sbHeaders }
    );
    const data = await r.json();
    if (!data.length) return res.json({ success: false, error: 'Обращение не найдено' });

    const t = data[0];
    const statusMap = { open: 'Открыто', in_progress: 'В работе', closed: 'Закрыто' };
    res.json({
      success: true,
      ticket: {
        num: t.ticket_num, user: t.user_nick, admin: t.admin_nick,
        type: t.type, status: statusMap[t.status] || t.status,
        description: t.description,
        created: new Date(t.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
        history: typeof t.history === 'string' ? JSON.parse(t.history) : t.history
      }
    });
  } catch (e) {
    console.error('get ticket error:', e);
    res.json({ success: false, error: 'Ошибка сервера' });
  }
});

// ── GET /api/admin/tickets?status=open|in_progress|closed&adminId=
app.get('/api/admin/tickets', async (req, res) => {
  const { status, adminId } = req.query;
  if (!adminId) return res.json({ success: false, error: 'Нет adminId' });
  try {
    const adminCheck = await fetch(`${SB_URL}/rest/v1/users?id=eq.${adminId}&select=role`, { headers: sbHeaders });
    const admins = await adminCheck.json();
    if (!admins.length || admins[0].role !== 'admin') return res.json({ success: false, error: 'Нет доступа' });

    const filter = status ? `&status=eq.${status}` : '';
    const r = await fetch(
      `${SB_URL}/rest/v1/support_tickets?select=*&order=created_at.desc${filter}`,
      { headers: sbHeaders }
    );
    const tickets = await r.json();
    res.json({ success: true, tickets });
  } catch (e) {
    console.error('admin tickets error:', e);
    res.json({ success: false, error: 'Ошибка сервера' });
  }
});

// ── PATCH /api/admin/tickets/:ticketNum/system-status — изменить системный статус
app.patch('/api/admin/tickets/:ticketNum/system-status', async (req, res) => {
  const { ticketNum } = req.params;
  const { status, adminId, adminNick } = req.body;
  const allowed = ['open', 'in_progress', 'closed'];
  if (!allowed.includes(status)) return res.json({ success: false, error: 'Неверный статус' });

  try {
    const adminCheck = await fetch(`${SB_URL}/rest/v1/users?id=eq.${adminId}&select=role`, { headers: sbHeaders });
    const admins = await adminCheck.json();
    if (!admins.length || admins[0].role !== 'admin') return res.json({ success: false, error: 'Нет доступа' });

    const r = await fetch(`${SB_URL}/rest/v1/support_tickets?ticket_num=eq.${encodeURIComponent(ticketNum)}&select=*`, { headers: sbHeaders });
    const tickets = await r.json();
    if (!tickets.length) return res.json({ success: false, error: 'Обращение не найдено' });
    const t = tickets[0];

    const statusLabel = { open: 'Открыто', in_progress: 'В работе', closed: 'Закрыто' }[status];
    const history = (typeof t.history === 'string' ? JSON.parse(t.history) : t.history) || [];
    history.push({ status: `Статус изменён: ${statusLabel}`, date: nowFormatted() });

    await fetch(`${SB_URL}/rest/v1/support_tickets?ticket_num=eq.${encodeURIComponent(ticketNum)}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ status, admin_nick: adminNick || 'Администратор', history: JSON.stringify(history), updated_at: new Date().toISOString() })
    });

    if (t.telegram_id) {
      const msgs = { open: '🔓 Открыто', in_progress: '🔄 Взято в работу', closed: '✅ Закрыто' };
      await sendTgMessage(t.telegram_id,
        `📋 <b>Статус обращения ${ticketNum} изменён</b>\n\n<blockquote>` +
        `📌 Новый статус: <b>${msgs[status]}</b>\n` +
        `👮 Администратор: <b>${adminNick || 'Администратор'}</b>\n` +
        `🕒 ${nowFormatted()} МСК</blockquote>`
      );
    }

    res.json({ success: true });
  } catch (e) {
    console.error('system-status error:', e);
    res.json({ success: false, error: 'Ошибка сервера' });
  }
});

// ── POST /api/admin/tickets/:ticketNum/add-status — добавить запись в таймлайн
app.post('/api/admin/tickets/:ticketNum/add-status', async (req, res) => {
  const { ticketNum } = req.params;
  const { text, adminId, adminNick } = req.body;
  if (!text?.trim()) return res.json({ success: false, error: 'Нет текста' });

  try {
    const adminCheck = await fetch(`${SB_URL}/rest/v1/users?id=eq.${adminId}&select=role`, { headers: sbHeaders });
    const admins = await adminCheck.json();
    if (!admins.length || admins[0].role !== 'admin') return res.json({ success: false, error: 'Нет доступа' });

    const r = await fetch(`${SB_URL}/rest/v1/support_tickets?ticket_num=eq.${encodeURIComponent(ticketNum)}&select=history,telegram_id`, { headers: sbHeaders });
    const tickets = await r.json();
    if (!tickets.length) return res.json({ success: false, error: 'Не найдено' });
    const t = tickets[0];

    const history = (typeof t.history === 'string' ? JSON.parse(t.history) : t.history) || [];
    history.push({ status: text.trim(), date: nowFormatted() });

    await fetch(`${SB_URL}/rest/v1/support_tickets?ticket_num=eq.${encodeURIComponent(ticketNum)}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ history: JSON.stringify(history), updated_at: new Date().toISOString() })
    });

    if (t.telegram_id) {
      await sendTgMessage(t.telegram_id,
        `📋 <b>Обновление по обращению ${ticketNum}</b>\n\n<blockquote>` +
        `💬 ${text.trim()}\n` +
        `👮 ${adminNick || 'Администратор'}\n` +
        `🕒 ${nowFormatted()} МСК</blockquote>`
      );
    }

    res.json({ success: true, history });
  } catch (e) {
    console.error('add-status error:', e);
    res.json({ success: false, error: 'Ошибка сервера' });
  }
});

// ── DELETE /api/admin/tickets/:ticketNum/history/:index — удалить запись таймлайна
app.delete('/api/admin/tickets/:ticketNum/history/:index', async (req, res) => {
  const { ticketNum, index } = req.params;
  const { adminId } = req.body;

  try {
    const adminCheck = await fetch(`${SB_URL}/rest/v1/users?id=eq.${adminId}&select=role`, { headers: sbHeaders });
    const admins = await adminCheck.json();
    if (!admins.length || admins[0].role !== 'admin') return res.json({ success: false, error: 'Нет доступа' });

    const r = await fetch(`${SB_URL}/rest/v1/support_tickets?ticket_num=eq.${encodeURIComponent(ticketNum)}&select=history`, { headers: sbHeaders });
    const tickets = await r.json();
    if (!tickets.length) return res.json({ success: false, error: 'Не найдено' });

    const history = (typeof tickets[0].history === 'string' ? JSON.parse(tickets[0].history) : tickets[0].history) || [];
    const idx = parseInt(index);
    if (idx < 0 || idx >= history.length) return res.json({ success: false, error: 'Неверный индекс' });
    history.splice(idx, 1);

    await fetch(`${SB_URL}/rest/v1/support_tickets?ticket_num=eq.${encodeURIComponent(ticketNum)}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ history: JSON.stringify(history), updated_at: new Date().toISOString() })
    });

    res.json({ success: true, history });
  } catch (e) {
    console.error('delete history error:', e);
    res.json({ success: false, error: 'Ошибка сервера' });
  }
});

// ══════════════════════════════════════════
//  FernieX-AI — синхронизация чатов
// ══════════════════════════════════════════

app.get('/api/ai-chats/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/ai_chats?user_id=eq.${userId}&select=chats,chat_order`, { headers: sbHeaders });
    const data = await r.json();
    if (!data.length) return res.json({ success: true, chats: {}, chat_order: [] });
    res.json({ success: true, chats: data[0].chats, chat_order: data[0].chat_order });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/ai-chats/save', async (req, res) => {
  const { userId, chats, chat_order } = req.body;
  if (!userId) return res.json({ success: false, error: 'Нет userId' });
  try {
    const check = await fetch(`${SB_URL}/rest/v1/ai_chats?user_id=eq.${userId}&select=id`, { headers: sbHeaders });
    const rows = await check.json();
    if (rows.length) {
      await fetch(`${SB_URL}/rest/v1/ai_chats?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ chats, chat_order, updated_at: new Date().toISOString() })
      });
    } else {
      await fetch(`${SB_URL}/rest/v1/ai_chats`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: userId, chats, chat_order })
      });
    }
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
