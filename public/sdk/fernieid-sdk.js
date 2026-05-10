(function () {
  const API = 'https://ferniex-id.vercel.app';
  let KEY = null, uid = null, _resolve = null;

  // ── Стили ──────────────────────────────────────────────
  const css = `
    #fid-overlay { position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:monospace; }
    #fid-card { background:#161616;border:1px solid #2a2a2a;border-radius:12px;padding:28px;width:300px;position:relative; }
    #fid-card h2 { color:#b48dff;font-size:.95rem;margin-bottom:20px; }
    #fid-card input { width:100%;padding:9px 12px;background:#1e1e1e;border:1px solid #333;border-radius:6px;color:#e0e0e0;font-family:monospace;font-size:.85rem;outline:none;margin-bottom:10px;box-sizing:border-box; }
    #fid-card input:focus { border-color:#b48dff; }
    #fid-card button.fid-btn { width:100%;padding:10px;background:#b48dff;color:#000;border:none;border-radius:6px;font-family:monospace;font-weight:700;cursor:pointer;font-size:.85rem; }
    #fid-card button.fid-btn:hover { background:#c9a8ff; }
    #fid-card .fid-err { color:#ff6b6b;font-size:.75rem;margin-top:8px;min-height:16px; }
    #fid-card .fid-close { position:absolute;top:14px;right:16px;cursor:pointer;color:#555;font-size:1.1rem; }
    #fid-card .fid-close:hover { color:#e0e0e0; }
    #fid-card .fid-footer { text-align:center;margin-top:16px;font-size:.65rem;color:#444; }
    #fid-card .fid-footer span { color:#b48dff; }
  `;

  // ── HTML ───────────────────────────────────────────────
  function buildModal() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'fid-overlay';
    el.innerHTML = `
      <div id="fid-card">
        <span class="fid-close" id="fid-close">✕</span>
        <h2>🔐 FernieID</h2>

        <div id="fid-s1">
          <input id="fid-u" placeholder="Логин" autocomplete="username">
          <input id="fid-p" type="password" placeholder="Пароль" autocomplete="current-password">
          <button class="fid-btn" id="fid-login-btn">Войти</button>
        </div>

        <div id="fid-s2" style="display:none">
          <div style="color:#888;font-size:.8rem;margin-bottom:10px;">Введи код из Telegram</div>
          <input id="fid-c" placeholder="123456" maxlength="6" style="text-align:center;letter-spacing:6px;font-size:1.1rem;">
          <button class="fid-btn" id="fid-verify-btn">Подтвердить</button>
        </div>

        <div class="fid-err" id="fid-err"></div>
        <div class="fid-footer">Вход через <span>FernieID</span></div>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById('fid-login-btn').onclick = doLogin;
    document.getElementById('fid-verify-btn').onclick = doVerify;
    document.getElementById('fid-close').onclick = close;
    document.getElementById('fid-p').addEventListener('keydown', e => e.key === 'Enter' && doLogin());
    document.getElementById('fid-c').addEventListener('keydown', e => e.key === 'Enter' && doVerify());
  }

  // ── Логика ─────────────────────────────────────────────
  async function post(url, body) {
    const r = await fetch(API + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.json();
  }

  async function doLogin() {
    const u = document.getElementById('fid-u').value.trim();
    const p = document.getElementById('fid-p').value;
    const err = document.getElementById('fid-err');
    if (!u || !p) return err.textContent = 'Заполни все поля';
    err.textContent = 'Загрузка...';

    const d = await post('/api/auth/login', { apiKey: KEY, username: u, password: p });
    if (!d.success) return err.textContent = d.error;

    if (d.require2fa) {
      uid = d.userId;
      document.getElementById('fid-s1').style.display = 'none';
      document.getElementById('fid-s2').style.display = 'block';
      err.textContent = '';
    } else {
      done(d);
    }
  }

  async function doVerify() {
    const code = document.getElementById('fid-c').value.trim();
    const err = document.getElementById('fid-err');
    if (!code) return err.textContent = 'Введи код';
    err.textContent = 'Проверка...';

    const d = await post('/api/auth/verify-2fa', { apiKey: KEY, userId: uid, code });
    if (!d.success) return err.textContent = d.error;
    done(d);
  }

  function done(d) {
    localStorage.setItem('fernieid_user', JSON.stringify(d));
    close();
    if (_resolve) _resolve(d);
  }

  function close() {
    const el = document.getElementById('fid-overlay');
    if (el) el.remove();
  }

  // ── Публичный API ──────────────────────────────────────
  window.FernieID = {
    init(apiKey) {
      KEY = apiKey;
    },
    login() {
      return new Promise(resolve => {
        _resolve = resolve;
        buildModal();
        setTimeout(() => document.getElementById('fid-u')?.focus(), 100);
      });
    },
    getUser() {
      return JSON.parse(localStorage.getItem('fernieid_user'));
    },
    logout() {
      localStorage.removeItem('fernieid_user');
    }
  };
})();
