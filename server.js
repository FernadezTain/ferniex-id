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
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, error: "Все поля обязательны" });
  try {
    const response = await fetch(`${SB_URL}/rest/v1/users?username=eq.${username}`, { headers: sbHeaders });
    const data = await response.json();
    if (!data.length) return res.json({ success: false, error: "Пользователь не найден" });
    const user = data[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.json({ success: false, error: "Неверный пароль" });
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
    if (!users.length || !users[0].telegram_id)
      return res.json({ success: false, seeds: 0, error: "Telegram не привязан" });
    const { telegram_id } = users[0];
    const botRes = await fetch(`${BOT_URL}/api/seeds?telegram_id=${telegram_id}`);
    const botData = await botRes.json();
    res.json({ success: true, seeds: botData.seeds ?? 0 });
  } catch (e) {
    console.error(e);
    res.json({ success: false, seeds: 0, error: "Ошибка сервера" });
  }
});

// ══════════════════════════════════════════
//  Купить кейс (списать семена через бота)
// ══════════════════════════════════════════
app.post("/api/cases/buy", async (req, res) => {
  const { userId, caseSlug, quantity } = req.body;
  if (!userId || !caseSlug || !quantity)
    return res.json({ success: false, error: "Недостаточно данных" });
  const PRICES = { ferniex_silver: 2500, fernie_gold: 4000 };
  const price = PRICES[caseSlug];
  if (!price) return res.json({ success: false, error: "Кейс не найден" });
  const total = price * quantity;
  try {
    // Получаем telegram_id
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`, { headers: sbHeaders });
    const users = await userRes.json();
    if (!users.length || !users[0].telegram_id)
      return res.json({ success: false, error: "Telegram не привязан" });
    const { telegram_id } = users[0];
    // Списываем семена через бота
    const spendRes = await fetch(`${BOT_URL}/api/seeds/spend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id, amount: total })
    });
    const spendData = await spendRes.json();
    if (!spendData.success) return res.json({ success: false, error: spendData.error || "Недостаточно семян" });
    // Добавляем кейс в инвентарь Supabase
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
    res.json({ success: true, spent: total });
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
