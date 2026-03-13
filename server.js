import express from "express";
import fetch from "node-fetch";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use(cors({
  origin: [
    'https://ferniex-minigame.vercel.app',
    'https://ferniex-id.vercel.app',
  ],
  credentials: true
}));

const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_URL   = process.env.BOT_URL || 'https://a36865-997d.m.d-f.pw';

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json"
};

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
        const match = userAgent.match(/\(([^)]+)\)/);
        if (match) {
          const parts = match[1].split(';').map(s => s.trim());
          if (/Android/.test(userAgent)) {
            const model = parts[2] || parts[1] || 'Android';
            const version = parts[1] || '';
            device = `📱 ${model} (${version})`;
          } else if (/iPhone/.test(userAgent)) {
            device = `🍎 iPhone (iOS ${userAgent.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g,'.') || ''})`;
          } else if (/iPad/.test(userAgent)) {
            device = `🍎 iPad`;
          } else if (/Windows/.test(userAgent)) {
            device = `🖥 Windows`;
          } else if (/Mac/.test(userAgent)) {
            device = `🖥 MacOS`;
          } else if (/Linux/.test(userAgent)) {
            device = `🖥 Linux`;
          }
        }
      }

      await sendTgMessage(user.telegram_id,
        `🔐 <b>Выполнен вход в Личный Кабинет FernieID</b>\n\n` +
        `<blockquote>` +
        `👤 Аккаунт: <b>${username}</b>\n` +
        `🕒 Время: <b>${now} МСК</b>` +
        `</blockquote>\n\n` +
        `<blockquote>` +
        `🌐 IP: <code>${clientIp || req.ip || 'неизвестен'}</code>\n` +
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
    if (!users.length) return res.json({ success: false, error: "Пользователь не найден" });

    const { telegram_id, username } = users[0];

    // 5. Уведомление в Telegram (без реального начисления монет)
    if (telegram_id) {
      await sendTgMessage(telegram_id,
        `🎮 <b>Результат игры</b>\n\n` +
        `👤 Игрок: <b>${username}</b>\n` +
        `🕹 Игра: <b>${gameTitle}</b>\n` +
        `⭐ Счёт: <b>${score}</b>\n\n` +
        `<i>Результат сохранён в FernieID!</i>`
      );
    }

    res.json({ success: true, telegramSent: !!telegram_id });

  } catch (e) {
    console.error(e);
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
app.post("/api/cases/buy", async (req, res) => {
  const { userId, caseSlug, quantity } = req.body;
  if (!userId || !caseSlug || !quantity)
    return res.json({ success: false, error: "Недостаточно данных" });
  const PRICES = { ferniex_silver: 2500, fernie_gold: 4000 };
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
    const caseNames = { ferniex_silver: 'FernieX Silver', fernie_gold: 'Fernie Gold' };
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
    name: 'FernieX Silver',
    items: [
      {name:'🌱 Семена x500',  emoji:'🌱', rarity:'common',    chance:35, reward:{type:'seeds', amount:500}},
      {name:'🌱 Семена x1000', emoji:'🌱', rarity:'common',    chance:25, reward:{type:'seeds', amount:1000}},
      {name:'💎 DC x50',       emoji:'💎', rarity:'rare',      chance:20, reward:{type:'dc',    amount:50}},
      {name:'💎 DC x150',      emoji:'💎', rarity:'rare',      chance:12, reward:{type:'dc',    amount:150}},
      {name:'⭐ DC x500',      emoji:'⭐', rarity:'legendary', chance:8,  reward:{type:'dc',    amount:500}},
    ]
  },
  fernie_gold: {
    name: 'Fernie Gold',
    items: [
      {name:'🌱 Семена x1000', emoji:'🌱', rarity:'common',    chance:25, reward:{type:'seeds', amount:1000}},
      {name:'🌱 Семена x2500', emoji:'🌱', rarity:'common',    chance:18, reward:{type:'seeds', amount:2500}},
      {name:'💎 DC x200',      emoji:'💎', rarity:'rare',      chance:22, reward:{type:'dc',    amount:200}},
      {name:'💎 DC x500',      emoji:'💎', rarity:'rare',      chance:16, reward:{type:'dc',    amount:500}},
      {name:'🌟 DC x2000',     emoji:'🌟', rarity:'legendary', chance:19, reward:{type:'dc',    amount:2000}},
    ]
  }
};

function weightedRandom(items) {
  const total = items.reduce((s, i) => s + i.chance, 0);
  let r = Math.random() * total;
  for (const item of items) { r -= item.chance; if (r <= 0) return item; }
  return items[items.length - 1];
}

app.post("/api/cases/open", async (req, res) => {
  const { userId, caseSlug } = req.body;
  if (!userId || !caseSlug) return res.json({ success: false, error: "Недостаточно данных" });

  const caseDef = CASE_DEFINITIONS[caseSlug];
  if (!caseDef) return res.json({ success: false, error: "Кейс не найден" });

  try {
    // Проверяем инвентарь
    const invRes = await fetch(`${SB_URL}/rest/v1/inventory?user_id=eq.${userId}&case_slug=eq.${caseSlug}&select=*`, { headers: sbHeaders });
    const invData = await invRes.json();
    if (!invData.length || invData[0].quantity < 1)
      return res.json({ success: false, error: "Кейса нет в инвентаре" });

    // Списываем 1 кейс
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

    // Честный серверный дроп
    const wonItem = weightedRandom(caseDef.items);

    // Получаем telegram_id и шлём уведомление
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`, { headers: sbHeaders });
    const users = await userRes.json();
    const { telegram_id, username } = users[0] || {};

    if (telegram_id && BOT_URL) {
      fetch(`${BOT_URL}/api/fernieid/notify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegram_id,
          type: "case_reward",
          username: username || "—",
          case_name: caseDef.name,
          item_name: wonItem.name,
          item_emoji: wonItem.emoji,
          item_rarity: wonItem.rarity,
          reward: wonItem.reward
        })
      }).catch(e => console.error("case_reward notify:", e));
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
