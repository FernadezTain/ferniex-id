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

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json"
};

// ====== Хелпер: отправка сообщения в Telegram ======
async function sendTgMessage(chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", text })
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("TG sendMessage error:", err);
    return false;
  }
  return true;
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
    res.json({
      success: true,
      userId: user.id,
      telegramLinked: !!user.telegram_id
    });
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

// ====== Сохранение статистики игры + автонаграда ======
app.post("/api/stats", async (req, res) => {
  const { userId, game, score } = req.body;
  if (!userId || !game || score === undefined)
    return res.json({ success: false, error: "Недостаточно данных" });
  try {
    // Получаем game_id
    const gameRes = await fetch(`${SB_URL}/rest/v1/games?slug=eq.${game}&select=id,title`, { headers: sbHeaders });
    const gameData = await gameRes.json();
    if (!gameData.length) return res.json({ success: false, error: "Игра не найдена" });

    // Записываем сессию
    const sessionRes = await fetch(`${SB_URL}/rest/v1/game_sessions`, {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        game_id: gameData[0].id,
        score: score,
        ended_at: new Date().toISOString()
      })
    });

    if (!sessionRes.ok) {
      const err = await sessionRes.text();
      console.error("Session insert error:", err);
      return res.json({ success: false, error: "Ошибка записи сессии" });
    }

    // Обновляем лидерборд
    await fetch(`${SB_URL}/rest/v1/rpc/refresh_leaderboard`, {
      method: "POST",
      headers: sbHeaders,
      body: JSON.stringify({})
    }).catch(() => {}); // не критично если упадёт

    // Начисляем монеты и шлём уведомление в Telegram
    const coins = Math.floor(score / 5);
    if (coins > 0) {
      // Получаем данные пользователя
      const userRes = await fetch(
        `${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username,balance`,
        { headers: sbHeaders }
      );
      const users = await userRes.json();

      if (users.length) {
        const { telegram_id, username, balance } = users[0];
        const gameTitle = gameData[0].title || game;

        // Начисляем монеты в базу
        await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
          method: "PATCH",
          headers: sbHeaders,
          body: JSON.stringify({ balance: (balance || 0) + coins })
        }).catch(() => {});

        // Шлём в Telegram если привязан
        if (telegram_id) {
          await sendTgMessage(telegram_id,
            `🎮 <b>Результат игры</b>\n\n` +
            `👤 Игрок: <b>${username}</b>\n` +
            `🕹 Игра: <b>${gameTitle}</b>\n` +
            `⭐ Счёт: <b>${score}</b>\n` +
            `🪙 Награда: <b>+${coins} монет</b>\n\n` +
            `<i>Монеты зачислены в FernieX!</i>`
          );
        }

        return res.json({ success: true, coins, telegramSent: !!telegram_id });
      }
    }

    res.json({ success: true, coins: 0 });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ====== Лидерборд по игре ======
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
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ link_token: token })
    });
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
    // Получаем telegram_id ДО отвязки
    const userRes = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`,
      { headers: sbHeaders }
    );
    const users = await userRes.json();
    if (!users.length) return res.json({ success: false, error: "Пользователь не найден" });

    const { telegram_id, username } = users[0];

    // Отвязываем в базе
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ telegram_id: null })
    });

    // Шлём уведомление если был привязан
    if (telegram_id) {
      await sendTgMessage(telegram_id,
        `🛡 <b>Система Безопасности</b>\n\n` +
        `<blockquote>Пользователь: <b>${username}</b> | ID: <b>${userId}</b>\nВаш Telegram аккаунт был <b>успешно отвязан</b> от FernieID. 🔓</blockquote>\n\n` +
        `Что это значит? 🤔\n` +
        `<blockquote>1️⃣ <b>Вы больше не будете получать награды</b> за участие в Мини-Играх, пока не привяжете этот Telegram аккаунт к FernieID. 🎮💎</blockquote>\n\n` +
        `Если отвязку сделали вы, просто <b>проигнорируйте</b> это сообщение. ✅\n` +
        `Если отвязали <b>не вы</b> — <b>свяжитесь со службой поддержки</b> через /ask 🆘.`
      );
    }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ====== Отправка награды вручную (legacy, оставляем для совместимости) ======
app.post("/api/reward", async (req, res) => {
  const { userId, game, score } = req.body;
  if (!userId || !game || score === undefined)
    return res.json({ success: false, error: "Нет данных" });
  try {
    const userRes = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`,
      { headers: sbHeaders }
    );
    const users = await userRes.json();
    if (!users.length || !users[0].telegram_id)
      return res.json({ success: false, error: "Telegram не привязан" });

    const { telegram_id, username } = users[0];
    const coins = Math.floor(score / 5);
    if (coins <= 0) return res.json({ success: false, error: "Мало очков для награды" });

    const ok = await sendTgMessage(telegram_id,
      `🎮 <b>Результат игры</b>\n\n` +
      `👤 Игрок: <b>${username}</b>\n` +
      `🕹 Игра: <b>${game}</b>\n` +
      `⭐ Счёт: <b>${score}</b>\n` +
      `🪙 Награда: <b>+${coins} монет</b>\n\n` +
      `<i>Монеты зачислены в FernieX!</i>`
    );

    if (!ok) return res.json({ success: false, error: "Ошибка отправки в Telegram" });
    res.json({ success: true, coins });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
