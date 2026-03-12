import express from "express";
import fetch from "node-fetch";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import cors from "cors";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// ====== SQLite (FernieUI.db — реальная БД бота) ======
const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, "FernieUI.db");
let db;
try {
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 10000");
  console.log(`✅ SQLite подключён: ${DB_PATH}`);
} catch (e) {
  console.error("❌ Не удалось подключиться к SQLite:", e.message);
  // db остаётся undefined — награды в SQLite будут пропущены с логом ошибки
}

// ====== Supabase (auth + лидерборд) ======
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json"
};

// Статусы (индекс = числовое значение status в таблице users)
const STATUS_LIST = [
  "Пользователь",           // 0
  "Media (Партнёр)",        // 1
  "Тестировщик",            // 2
  "Мл. Модератор",          // 3
  "Модератор",              // 4
  "Ст. Модератор",          // 5
  "Мл. Администратор",      // 6
  "Администратор",          // 7
  "Ст. Администратор",      // 8
  "Технический Специалист", // 9
  "Куратор",                // 10
  "Владелец",               // 11
  "Специальный Администратор", // 12
  "Разработчик"             // 13
];

const MODERATOR_THRESHOLD = 3; // Мл. Модератор и выше

// ====== Хелпер: отправка сообщения в Telegram ======
async function sendTgMessage(chatId, text) {
  try {
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
  } catch (e) {
    console.error("TG sendMessage exception:", e.message);
    return false;
  }
}

// ====== Хелпер: выдать реальные награды в SQLite ======
// Возвращает объект с начисленными значениями или null при ошибке
function giveRewardsInSQLite(telegramId, score, gameSlug) {
  if (!db) {
    console.error("SQLite недоступен — награды не выданы");
    return null;
  }

  try {
    // Ищем пользователя по telegram_id (поле user_id в SQLite = Telegram ID)
    const user = db.prepare(
      "SELECT user_id, status, balance, dc_balance, seeds FROM users WHERE user_id = ?"
    ).get(String(telegramId));

    if (!user) {
      console.warn(`SQLite: пользователь с telegram_id=${telegramId} не найден`);
      return null;
    }

    // ── Базовые награды ──────────────────────────────────────────────
    const coins   = score * 100;   // balance (монеты)
    const dc      = score * 50;    // dc_balance
    const seeds   = score * 1000;  // seeds

    // ── Бонус AC для модераторов+ в Pixel Snake ──────────────────────
    // AC хранится в dc_balance (Admin Coins / внутренняя валюта)
    // +10 AC за каждые 5 очков → score/5 * 10
    let acBonus = 0;
    const isPixelSnake = gameSlug === "pixel-snake" || gameSlug === "pixelsnake";
    const userStatus   = user.status ?? 0;

    if (isPixelSnake && userStatus >= MODERATOR_THRESHOLD) {
      acBonus = score * 10; // +10 AC за каждое очко (было /5 * 10)
    }

    const totalDc = dc + acBonus;

    // ── Обновляем в БД (одна транзакция) ─────────────────────────────
    const update = db.prepare(`
      UPDATE users
      SET balance    = balance    + ?,
          dc_balance = dc_balance + ?,
          seeds      = seeds      + ?
      WHERE user_id = ?
    `);

    const txn = db.transaction(() => {
      update.run(coins, totalDc, seeds, String(telegramId));
    });
    txn();

    console.log(
      `✅ Награды выданы (telegram_id=${telegramId}): ` +
      `+${coins} монет, +${totalDc} DC (в т.ч. ${acBonus} AC бонус), +${seeds} семян`
    );

    return { coins, dc, seeds, acBonus, totalDc, statusLevel: userStatus };

  } catch (e) {
    console.error("SQLite giveRewards error:", e.message);
    return null;
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

// ====== Сохранение статистики игры + реальная выдача наград ======
app.post("/api/stats", async (req, res) => {
  const { userId, game, score } = req.body;
  if (!userId || !game || score === undefined)
    return res.json({ success: false, error: "Недостаточно данных" });

  try {
    // ── 1. Получаем game_id из Supabase ──────────────────────────────
    const gameRes = await fetch(`${SB_URL}/rest/v1/games?slug=eq.${game}&select=id,title`, { headers: sbHeaders });
    const gameData = await gameRes.json();
    if (!gameData.length) return res.json({ success: false, error: "Игра не найдена" });

    // ── 2. Записываем сессию в Supabase ──────────────────────────────
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

    // ── 3. Обновляем лидерборд (некритично) ──────────────────────────
    fetch(`${SB_URL}/rest/v1/rpc/refresh_leaderboard`, {
      method: "POST",
      headers: sbHeaders,
      body: JSON.stringify({})
    }).catch(() => {});

    // ── 4. Получаем telegram_id из Supabase ──────────────────────────
    const userRes = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username,balance`,
      { headers: sbHeaders }
    );
    const users = await userRes.json();
    if (!users.length) return res.json({ success: false, error: "Пользователь не найден" });

    const { telegram_id, username } = users[0];
    const gameTitle = gameData[0].title || game;

    // ── 5. Выдаём РЕАЛЬНЫЕ награды в SQLite ──────────────────────────
    let rewards = null;
    if (telegram_id) {
      rewards = giveRewardsInSQLite(telegram_id, score, game);
    } else {
      console.warn(`userId=${userId} не имеет привязанного telegram_id — награды не выданы`);
    }

    const coins    = rewards?.coins    ?? 0;
    const dc       = rewards?.totalDc  ?? 0;
    const seeds    = rewards?.seeds    ?? 0;
    const acBonus  = rewards?.acBonus  ?? 0;
    const statusLv = rewards?.statusLevel ?? 0;
    const statusName = STATUS_LIST[statusLv] ?? "Пользователь";

    // ── 6. Уведомление в Telegram ─────────────────────────────────────
    if (telegram_id && rewards) {
      let rewardLine =
        `🪙 Монеты: <b>+${coins}</b>\n` +
        `💠 DC: <b>+${dc - acBonus}</b>\n` +
        `🌱 Семена: <b>+${seeds}</b>`;

      if (acBonus > 0) {
        rewardLine += `\n⚡ AC бонус [${statusName}]: <b>+${acBonus}</b>`;
      }

      await sendTgMessage(telegram_id,
        `🎮 <b>Результат игры</b>\n\n` +
        `👤 Игрок: <b>${username}</b>\n` +
        `🕹 Игра: <b>${gameTitle}</b>\n` +
        `⭐ Счёт: <b>${score}</b>\n\n` +
        `<b>Награды:</b>\n${rewardLine}\n\n` +
        `<i>Награды зачислены в FernieX!</i>`
      );
    }

    return res.json({
      success: true,
      coins,
      dc,
      seeds,
      acBonus,
      telegramSent: !!(telegram_id && rewards)
    });

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
        `<blockquote>🔓 Ваш Telegram аккаунт был <b>успешно отвязан</b> от FernieID.\nID: <b>${telegram_id}</b></blockquote>\n` +
        `<b>Что это значит? 🤔</b>\n` +
        `<blockquote>1️⃣ <b>Вы больше не будете получать награды</b> за участие в Мини-Играх, пока не привяжете этот Telegram аккаунт к FernieID. 🎮💎</blockquote>\n` +
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

// ====== Legacy /api/reward (для совместимости) ======
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

    const rewards = giveRewardsInSQLite(telegram_id, score, game);
    if (!rewards) return res.json({ success: false, error: "Ошибка начисления наград" });

    const { coins, totalDc, seeds, acBonus, statusLevel } = rewards;
    const statusName = STATUS_LIST[statusLevel] ?? "Пользователь";

    let rewardLine =
      `🪙 Монеты: <b>+${coins}</b>\n` +
      `💠 DC: <b>+${totalDc - acBonus}</b>\n` +
      `🌱 Семена: <b>+${seeds}</b>`;
    if (acBonus > 0) {
      rewardLine += `\n⚡ AC бонус [${statusName}]: <b>+${acBonus}</b>`;
    }

    const ok = await sendTgMessage(telegram_id,
      `🎮 <b>Результат игры</b>\n\n` +
      `👤 Игрок: <b>${username}</b>\n` +
      `🕹 Игра: <b>${game}</b>\n` +
      `⭐ Счёт: <b>${score}</b>\n\n` +
      `<b>Награды:</b>\n${rewardLine}\n\n` +
      `<i>Награды зачислены в FernieX!</i>`
    );

    if (!ok) return res.json({ success: false, error: "Ошибка отправки в Telegram" });
    res.json({ success: true, coins, dc: totalDc, seeds });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
