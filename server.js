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
const BOT_URL   = process.env.BOT_URL;

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json"
};

// ══════════════════════════════════════════
//  Определение устройства из User-Agent
// ══════════════════════════════════════════
function parseDevice(ua = "") {
  if (!ua) return "Неизвестное устройство";

  // iOS devices
  const iosMatch = ua.match(/iPhone(?:\s*OS\s*([\d_]+))?/i);
  if (iosMatch) {
    const ver = iosMatch[1] ? " iOS " + iosMatch[1].replace(/_/g, ".") : "";
    return `📱 iPhone${ver}`;
  }
  const ipadMatch = ua.match(/iPad(?:.*CPU.*OS\s*([\d_]+))?/i);
  if (ipadMatch) {
    const ver = ipadMatch[1] ? " iPadOS " + ipadMatch[1].replace(/_/g, ".") : "";
    return `📱 iPad${ver}`;
  }

  // Android device models
  const androidModel = ua.match(/Android[\s/][\d.]+;\s*([^;)]+)/i);
  if (androidModel) {
    const model = androidModel[1].trim();
    return `📱 ${model} (Android)`;
  }

  // Windows
  if (/Windows NT 10/i.test(ua)) return "🖥️ Windows 10/11";
  if (/Windows NT 6\.3/i.test(ua)) return "🖥️ Windows 8.1";
  if (/Windows NT 6\.1/i.test(ua)) return "🖥️ Windows 7";
  if (/Windows/i.test(ua)) return "🖥️ Windows";

  // macOS
  const macMatch = ua.match(/Mac OS X ([\d_]+)/i);
  if (macMatch) {
    const ver = macMatch[1].replace(/_/g, ".");
    return `💻 macOS ${ver}`;
  }

  // Linux
  if (/Linux/i.test(ua)) return "🐧 Linux";

  // Browsers as fallback
  if (/Chrome/i.test(ua)) return "🌐 Chrome Browser";
  if (/Firefox/i.test(ua)) return "🌐 Firefox Browser";
  if (/Safari/i.test(ua)) return "🌐 Safari Browser";

  return "🖥️ Неизвестное устройство";
}

// ══════════════════════════════════════════
//  Регистрация
// ══════════════════════════════════════════
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

// ══════════════════════════════════════════
//  Вход + уведомление Telegram
// ══════════════════════════════════════════
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

    // Определяем IP: приоритет — тот что прислал клиент, fallback — из заголовков
    const ip = clientIp
      || req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
      || req.headers["x-real-ip"]
      || req.socket?.remoteAddress
      || "неизвестен";

    const device = parseDevice(userAgent || req.headers["user-agent"] || "");

    // Отправляем уведомление в Telegram если привязан
    if (user.telegram_id && BOT_URL) {
      const now = new Date().toLocaleString("ru-RU", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
        timeZone: "Europe/Moscow"
      });

      fetch(`${BOT_URL}/api/fernieid/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegram_id: user.telegram_id,
          type: "login",
          username: user.username,
          ip,
          device,
          time: now
        })
      }).catch(e => console.error("Login notify error:", e));
    }

    res.json({ success: true, userId: user.id, telegramLinked: !!user.telegram_id });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ══════════════════════════════════════════
//  Баланс
// ══════════════════════════════════════════
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

// ══════════════════════════════════════════
//  Сохранение статистики + уведомление TG
// ══════════════════════════════════════════
app.post("/api/stats", async (req, res) => {
  const { userId, game, score } = req.body;
  const gameSlug = (game || '').replace(/-/g, '_');
  if (!userId || !gameSlug || score === undefined)
    return res.json({ success: false, error: "Недостаточно данных" });
  try {
    const gameRes = await fetch(`${SB_URL}/rest/v1/games?slug=eq.${gameSlug}&select=id,title`, { headers: sbHeaders });
    const gameData = await gameRes.json();
    const gameTitle = gameData[0]?.title || game;
    const gameId    = gameData[0]?.id;

    if (gameId) {
      const sessionRes = await fetch(`${SB_URL}/rest/v1/game_sessions`, {
        method: "POST",
        headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: userId, game_id: gameId, score, ended_at: new Date().toISOString() })
      });
      if (!sessionRes.ok) console.error("Session insert error:", await sessionRes.text());
    }

    fetch(`${SB_URL}/rest/v1/rpc/refresh_leaderboard`, {
      method: "POST", headers: sbHeaders, body: JSON.stringify({})
    }).catch(() => {});

    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id,username`, { headers: sbHeaders });
    const users = await userRes.json();
    if (!users.length) return res.json({ success: false, error: "Пользователь не найден" });
    const { telegram_id, username } = users[0];

    if (telegram_id && BOT_URL) {
      await fetch(`${BOT_URL}/api/fernieid/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id, username, game: gameTitle, score })
      }).catch(e => console.error("Bot notify error:", e));
    }

    res.json({ success: true, telegramSent: !!telegram_id });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ══════════════════════════════════════════
//  Лидерборд
// ══════════════════════════════════════════
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
//  Генерация токена привязки Telegram
// ══════════════════════════════════════════
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

// ══════════════════════════════════════════
//  Привязка telegram_id по токену
// ══════════════════════════════════════════
app.post("/api/telegram/link", async (req, res) => {
  const { token, telegram_id } = req.body;
  if (!token || !telegram_id) return res.json({ success: false, error: "Нет данных" });
  try {
    const findRes = await fetch(`${SB_URL}/rest/v1/users?link_token=eq.${token}&select=id,username`, { headers: sbHeaders });
    const users = await findRes.json();
    if (!users.length) return res.json({ success: false, error: "Токен не найден или устарел" });
    const user = users[0];
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${user.id}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ telegram_id, link_token: null })
    });
    res.json({ success: true, username: user.username });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

// ══════════════════════════════════════════
//  Отвязка Telegram
// ══════════════════════════════════════════
app.post("/api/telegram/unlink", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.json({ success: false, error: "Нет userId" });
  try {
    const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=telegram_id`, { headers: sbHeaders });
    const users = await userRes.json();
    if (!users.length) return res.json({ success: false, error: "Пользователь не найден" });
    const { telegram_id } = users[0];

    await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ telegram_id: null })
    });

    if (telegram_id && BOT_URL) {
      await fetch(`${BOT_URL}/api/fernieid/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id, username: null, game: null, score: null, type: "unlink" })
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.json({ success: false, error: "Ошибка сервера" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
