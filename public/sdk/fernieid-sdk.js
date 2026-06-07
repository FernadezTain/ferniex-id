(function () {
  const API = 'https://ferniex-id.vercel.app';
  let KEY = null, uid = null, _resolve = null;

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');

    #fid-overlay {
      position: fixed; inset: 0; z-index: 99999;
      display: flex; align-items: center; justify-content: center;
      font-family: 'Outfit', monospace;
      animation: fid-fadein .3s ease;
    }
    #fid-overlay::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(ellipse at 20% 50%, rgba(120,60,200,.25) 0%, transparent 60%),
                  radial-gradient(ellipse at 80% 20%, rgba(80,40,180,.2) 0%, transparent 50%),
                  rgba(0,0,0,.75);
      backdrop-filter: blur(8px);
    }
    #fid-card {
      position: relative; width: 360px;
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 20px;
      padding: 36px 32px 28px;
      box-shadow: 0 0 60px rgba(120,60,220,.15), 0 24px 48px rgba(0,0,0,.5);
      animation: fid-slidein .35s cubic-bezier(.16,1,.3,1);
    }
    #fid-card::before {
      content: ''; position: absolute; inset: 0; border-radius: 20px;
      background: linear-gradient(135deg, rgba(255,255,255,.06) 0%, transparent 60%);
      pointer-events: none;
    }
    #fid-logo {
      text-align: center; margin-bottom: 28px;
      font-size: 1.4rem; font-weight: 700; letter-spacing: -.5px;
      color: #fff;
    }
    #fid-logo span { color: #a78bfa; }
    #fid-logo::before {
      content: '•'; color: #a78bfa; margin-right: 6px;
      animation: fid-pulse 2s infinite;
    }
    .fid-label {
      font-size: .65rem; font-weight: 600; letter-spacing: 1.5px;
      color: rgba(255,255,255,.35); text-transform: uppercase; margin-bottom: 6px;
    }
    .fid-input-wrap { position: relative; margin-bottom: 14px; }
    .fid-input-wrap input {
      width: 100%; padding: 13px 16px;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 12px;
      color: #fff; font-family: 'Outfit', monospace; font-size: .9rem;
      outline: none; box-sizing: border-box;
      transition: border-color .2s, background .2s, box-shadow .2s;
    }
    .fid-input-wrap input::placeholder { color: rgba(255,255,255,.2); }
    .fid-input-wrap input:focus {
      border-color: rgba(167,139,250,.6);
      background: rgba(167,139,250,.08);
      box-shadow: 0 0 0 3px rgba(167,139,250,.1);
    }
    #fid-btn, #fid-verify-btn, #fid-reg-btn {
      width: 100%; padding: 14px;
      background: linear-gradient(135deg, #7c3aed, #a78bfa);
      border: none; border-radius: 12px;
      color: #fff; font-family: 'Outfit', monospace;
      font-size: .95rem; font-weight: 600; cursor: pointer;
      margin-top: 6px; position: relative; overflow: hidden;
      transition: transform .15s, box-shadow .15s;
      box-shadow: 0 4px 20px rgba(124,58,237,.4);
    }
    #fid-btn:hover, #fid-verify-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 28px rgba(124,58,237,.5); }
    #fid-btn:active, #fid-verify-btn:active { transform: translateY(0); }
    #fid-btn::after, #fid-verify-btn::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.15), transparent);
      transform: translateX(-100%);
      animation: fid-shimmer 2.5s infinite;
    }
    .fid-err {
      color: #f87171; font-size: .78rem; margin-top: 10px;
      min-height: 18px; text-align: center;
    }
    .fid-err.shake { animation: fid-shake .3s ease; }
    .fid-close {
      position: absolute; top: 16px; right: 18px;
      cursor: pointer; color: rgba(255,255,255,.25);
      font-size: .85rem;
      width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
      border-radius: 50%; background: rgba(255,255,255,.05);
      transition: color .2s, background .2s;
    }
    .fid-close:hover { color: #fff; background: rgba(255,255,255,.1); }
    .fid-footer {
      text-align: center; margin-top: 20px;
      font-size: .68rem; color: rgba(255,255,255,.2); letter-spacing: .5px;
    }
    .fid-footer span { color: #a78bfa; }
    #fid-s2-hint {
      color: rgba(255,255,255,.4); font-size: .82rem;
      text-align: center; margin-bottom: 16px; line-height: 1.5;
    }
    #fid-c {
      text-align: center !important; letter-spacing: 8px !important;
      font-size: 1.4rem !important; font-weight: 600 !important;
    }

    #fid-tabs {
      display: flex; gap: 6px; margin-bottom: 22px;
      background: rgba(255,255,255,.05); border-radius: 10px; padding: 4px;
    }
    .fid-tab {
      flex: 1; padding: 8px; border: none; border-radius: 8px;
      background: transparent; color: rgba(255,255,255,.4);
      font-family: 'Outfit', monospace; font-size: .85rem; font-weight: 500;
      cursor: pointer; transition: all .2s;
    }
    .fid-tab.active {
      background: rgba(167,139,250,.2); color: #a78bfa;
    }
    .fid-tab:hover:not(.active) { color: rgba(255,255,255,.7); }

    @keyframes fid-fadein { from { opacity:0 } to { opacity:1 } }
    @keyframes fid-fadeout { from { opacity:1 } to { opacity:0 } }
    @keyframes fid-slidein { from { opacity:0; transform:translateY(24px) scale(.97) } to { opacity:1; transform:none } }
    @keyframes fid-shimmer { 0%{transform:translateX(-100%)} 60%,100%{transform:translateX(100%)} }
    @keyframes fid-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    @keyframes fid-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
  `;

  function buildModal() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'fid-overlay';
    el.innerHTML = `
      <div id="fid-card">
        <div class="fid-close" id="fid-close">✕</div>
        <div id="fid-logo">Fernie<span>ID</span></div>

        <div id="fid-tabs">
          <button class="fid-tab active" id="fid-tab-login" onclick="fidSwitchTab('login')">Войти</button>
          <button class="fid-tab" id="fid-tab-reg" onclick="fidSwitchTab('reg')">Регистрация</button>
        </div>

        <div id="fid-s1">
          <div class="fid-label">Логин</div>
          <div class="fid-input-wrap"><input id="fid-u" placeholder="username" autocomplete="username"></div>
          <div class="fid-label">Пароль</div>
          <div class="fid-input-wrap"><input id="fid-p" type="password" placeholder="••••••••" autocomplete="current-password"></div>
          <button id="fid-btn">Войти →</button>
          <div style="text-align:center;margin-top:12px">
            <a href="password.html" style="font-size:.75rem;color:rgba(167,139,250,.6);text-decoration:none;letter-spacing:.3px;transition:color .2s" onmouseover="this.style.color='#a78bfa'" onmouseout="this.style.color='rgba(167,139,250,.6)'">Забыли пароль?</a>
          </div>
        </div>

        <div id="fid-s-reg" style="display:none">
          <div class="fid-label">Логин</div>
          <div class="fid-input-wrap"><input id="fid-ru" placeholder="username" autocomplete="username"></div>
          <div class="fid-label">Пароль</div>
          <div class="fid-input-wrap"><input id="fid-rp" type="password" placeholder="••••••••"></div>
          <div class="fid-label">Повтори пароль</div>
          <div class="fid-input-wrap"><input id="fid-rp2" type="password" placeholder="••••••••"></div>
          <button id="fid-reg-btn">Зарегистрироваться →</button>
        </div>

        <div id="fid-s2" style="display:none">
          <div id="fid-s2-hint">Код отправлен в Telegram.<br>Введи его ниже.</div>
          <div class="fid-input-wrap"><input id="fid-c" placeholder="000000" maxlength="6"></div>
          <button id="fid-verify-btn">Подтвердить →</button>
        </div>

        <div class="fid-err" id="fid-err"></div>
        <div class="fid-footer">Вход через <span>FernieID</span></div>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById('fid-btn').onclick = doLogin;
    document.getElementById('fid-verify-btn').onclick = doVerify;
    document.getElementById('fid-reg-btn').onclick = doRegister;
    document.getElementById('fid-close').onclick = close;
    document.getElementById('fid-p').addEventListener('keydown', e => e.key === 'Enter' && doLogin());
    document.getElementById('fid-c').addEventListener('keydown', e => e.key === 'Enter' && doVerify());
    document.getElementById('fid-rp2').addEventListener('keydown', e => e.key === 'Enter' && doRegister());

    window.fidSwitchTab = function(tab) {
      document.getElementById('fid-s1').style.display = tab === 'login' ? 'block' : 'none';
      document.getElementById('fid-s-reg').style.display = tab === 'reg' ? 'block' : 'none';
      document.getElementById('fid-s2').style.display = 'none';
      document.getElementById('fid-tab-login').classList.toggle('active', tab === 'login');
      document.getElementById('fid-tab-reg').classList.toggle('active', tab === 'reg');
      document.getElementById('fid-err').textContent = '';
    };
  }

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
    if (!u || !p) return setErr('Заполни все поля');
    setInfo('Загрузка...');

    const d = await post('/api/auth/login', { apiKey: KEY, username: u, password: p });
    if (!d.success) return setErr(d.error);

    if (d.require2fa) {
      uid = d.userId;
      document.getElementById('fid-s1').style.display = 'none';
      document.getElementById('fid-s2').style.display = 'block';
      document.getElementById('fid-err').textContent = '';
      setTimeout(() => document.getElementById('fid-c')?.focus(), 100);
    } else {
      done(d);
    }
  }

  async function doVerify() {
    const code = document.getElementById('fid-c').value.trim();
    if (!code) return setErr('Введи код');
    setInfo('Проверка...');

    const d = await post('/api/auth/verify-2fa', { apiKey: KEY, userId: uid, code });
    if (!d.success) return setErr(d.error);
    done(d);
  }

  function setErr(msg) {
    const el = document.getElementById('fid-err');
    el.style.color = '#f87171';
    el.textContent = msg;
    el.classList.remove('shake');
    setTimeout(() => el.classList.add('shake'), 10);
  }

  async function doRegister() {
    const u = document.getElementById('fid-ru').value.trim();
    const p = document.getElementById('fid-rp').value;
    const p2 = document.getElementById('fid-rp2').value;
    if (!u || !p || !p2) return setErr('Заполни все поля');
    if (p !== p2) return setErr('Пароли не совпадают');
    if (p.length < 6) return setErr('Пароль минимум 6 символов');
    setInfo('Регистрация...');

    const d = await post('/api/register', { username: u, password: p });
    if (!d.success) return setErr(d.error);

    setInfo('Входим...');
    const d2 = await post('/api/auth/login', { apiKey: KEY, username: u, password: p });
    if (!d2.success) return setErr(d2.error);
    if (d2.require2fa) {
      uid = d2.userId;
      document.getElementById('fid-s-reg').style.display = 'none';
      document.getElementById('fid-s2').style.display = 'block';
      document.getElementById('fid-err').textContent = '';
    } else {
      done(d2);
    }
  }

  function setInfo(msg) {
    const el = document.getElementById('fid-err');
    el.style.color = 'rgba(255,255,255,.35)';
    el.textContent = msg;
  }

  function done(d) {
    try { localStorage.setItem('fernieid_user', JSON.stringify(d)); } catch {}
    close();
    if (_resolve) _resolve(d);
  }

  function close() {
    const el = document.getElementById('fid-overlay');
    if (el) {
      el.style.animation = 'fid-fadeout .2s ease forwards';
      setTimeout(() => el.remove(), 200);
    }
  }

  // ══════════════════════════════════════════════
  //  AI CHAT — внутренние хелперы
  // ══════════════════════════════════════════════

  /**
   * Собирает тело запроса для /api/chat
   * @param {object[]} messages  - массив { role, content }
   * @param {object}   options   - model, max_tokens, stream, system
   */
  function buildChatBody(messages, options = {}) {
    const user = window.FernieID.getUser();
    const body = {
        model:      options.model      || 'mistral-small-latest',
        messages:   messages,
        max_tokens: options.max_tokens || 1024,
        stream:     options.stream     || false,
        userId:     user ? user.userId : null,
        apiKey:     KEY,
      };
    // Системный промпт — добавляем как первое сообщение если передан
    if (options.system) {
      body.messages = [{ role: 'system', content: options.system }, ...messages];
    }
    return body;
  }

  // ══════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════

  window.FernieID = {
    init(apiKey) { KEY = apiKey; },

    login() {
      return new Promise(resolve => {
        _resolve = resolve;
        buildModal();

        if (!KEY) {
          document.getElementById('fid-err').textContent = '❌ API Key не указан';
          return;
        }

        fetch(API + '/api/apikeys/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: KEY })
        }).then(r => r.json()).then(d => {
          if (!d.success) { setErr('❌ Некорректный API Key'); return; }
          setTimeout(() => document.getElementById('fid-u')?.focus(), 100);
        }).catch(() => {
          setErr('❌ Ошибка соединения с FernieID');
        });
      });
    },

    getUser() {
      try { return JSON.parse(localStorage.getItem('fernieid_user')); } catch { return null; }
    },

    logout() {
      try { localStorage.removeItem('fernieid_user'); } catch {}
    },

    async getBalance(fields = ['dc', 'seeds', 'balance']) {
      const user = this.getUser();
      if (!user) return { success: false, error: 'not_logged_in' };
      const d = await post('/api/balance/get', { apiKey: KEY, username: user.username, fields });
      if (d.error === 'no_telegram' && d.action) window.open(d.action.url, '_blank');
      return d;
    },

    async editBalance(currency, amount, action) {
      const user = this.getUser();
      if (!user) return { success: false, error: 'not_logged_in' };
      return post('/api/edit/balance', { apiKey: KEY, username: user.username, currency, amount, action });
    },

    // ── AI: разовый запрос (не-стриминг) ─────────────────────────────
    /**
     * Отправляет сообщения в ИИ и возвращает полный ответ.
     *
     * @param {object[]} messages  - массив сообщений [{ role: 'user', content: '...' }, ...]
     * @param {object}   options   - опции: model, max_tokens, system
     * @returns {Promise<{ success: boolean, content: string, usage: object, error?: string }>}
     *
     * @example
     * const res = await FernieID.chat([{ role: 'user', content: 'Привет!' }]);
     * console.log(res.content); // ответ модели
     */
    async chat(messages, options = {}) {
      try {
        const body = buildChatBody(messages, { ...options, stream: false });
        const res = await fetch(API + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { success: false, error: err?.error?.message || `HTTP ${res.status}` };
        }

        const data = await res.json();

        // Ошибка лимита токенов
        if (data.error) {
          return { success: false, error: data.error.message || 'Ошибка API' };
        }

        const content = data.choices?.[0]?.message?.content ?? '';
        return {
          success: true,
          content,
          role:  data.choices?.[0]?.message?.role ?? 'assistant',
          model: data.model ?? body.model,
          usage: data.usage ?? {}
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    // ── AI: стриминг ─────────────────────────────────────────────────
    /**
     * Отправляет сообщения в ИИ и возвращает ответ потоком (SSE).
     *
     * @param {object[]} messages   - массив сообщений
     * @param {object}   callbacks  - { onToken(chunk), onDone(fullText), onError(msg) }
     * @param {object}   options    - model, max_tokens, system
     * @returns {Promise<void>}
     *
     * @example
     * await FernieID.streamChat(
     *   [{ role: 'user', content: 'Расскажи анекдот' }],
     *   {
     *     onToken: (chunk) => process.stdout.write(chunk),
     *     onDone:  (full)  => console.log('\n[done]', full),
     *     onError: (msg)   => console.error(msg)
     *   }
     * );
     */
    async streamChat(messages, callbacks = {}, options = {}) {
      const { onToken, onDone, onError } = callbacks;

      try {
        const body = buildChatBody(messages, { ...options, stream: true });
        const res = await fetch(API + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const msg = err?.error?.message || `HTTP ${res.status}`;
          if (onError) onError(msg);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullText = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Обрабатываем SSE построчно
          const lines = buffer.split('\n');
          buffer = lines.pop(); // последняя неполная строка остаётся в буфере

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;

            try {
              const parsed = JSON.parse(raw);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                if (onToken) onToken(delta);
              }
            } catch {
              // невалидный JSON-чанк — пропускаем
            }
          }
        }

        if (onDone) onDone(fullText);

      } catch (e) {
        if (onError) onError(e.message);
      }
    },

    // ── AI: получить лимиты токенов текущего пользователя ────────────
    /**
     * Возвращает информацию о расходе токенов за сегодня.
     *
     * @returns {Promise<{ success: boolean, used: number, limit: number, remaining: number, has_plus: boolean }>}
     *
     * @example
     * const usage = await FernieID.getChatUsage();
     * console.log(`Осталось токенов: ${usage.remaining}`);
     */
    async search(query){
      try{
        const res=await fetch(API+'/api/search?q='+encodeURIComponent(query));
        const data=await res.json();
        if(!data.success)return{success:false,results:[]};
        return{success:true,results:data.results||[],raw:data};
      }catch(e){return{success:false,error:e.message,results:[]};}
    },

    async getChatUsage() {
      const user = this.getUser();
      if (!user) return { success: false, error: 'not_logged_in' };
      try {
        const res = await fetch(`${API}/api/chat/usage/${user.userId}`);
        return await res.json();
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    /**
     * Проверяет наличие Fernie+ Pro подписки у текущего пользователя.
     * @returns {Promise<{ success: boolean, active: boolean, plan: string|null }>}
     */
    async getProPlusStatus() {
      const user = this.getUser();
      if (!user) return { success: false, active: false, error: 'not_logged_in' };
      try {
        const res = await fetch(`${API}/api/fernieplus/pro/${user.userId}`);
        return await res.json();
      } catch (e) {
        return { success: false, active: false, error: e.message };
      }
    },

    async activateFerniePlus({ telegram_id, plan_key, method, amount, username }) {
      try {
        const res = await fetch(`${API}/api/fernieplus/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegram_id, plan_key, method, amount, username })
        });
        return await res.json();
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    async checkProPayment({ pay_id, telegram_id }) {
      try {
        const res = await fetch(`${API}/api/fernieplus/pro/check-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pay_id, telegram_id })
        });
        return await res.json();
      } catch (e) {
        return { success: false, paid: false, error: e.message };
      }
    },
  };
})();
