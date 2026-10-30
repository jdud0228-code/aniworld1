/* ANIWorld account, personal library and cross-device watch progress. */
(() => {
  const state = { client: null, user: null, mode: 'login', currentTitle: null, lastSave: new Map() };
  const $ = (id) => document.getElementById(id);
  const status = (message, tone = 'info') => {
    const node = $('productAuthStatus');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.tone = tone;
  };
  const slugify = (value) => {
    const original = String(value || '').trim().toLowerCase();
    const slug = original.normalize('NFKD').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180);
    if (slug) return slug;
    const hex = Array.from(original).map((char) => char.codePointAt(0).toString(16)).join('-').slice(0, 160);
    return 'title-' + (hex || 'unknown');
  };
  const providerCode = (meta = state.currentTitle) => slugify(meta?.providerCode || meta?.title || 'unknown-title');

  function setMode(mode) {
    const validModes = ['login', 'signup', 'reset', 'newPassword'];
    state.mode = validModes.includes(mode) ? mode : 'login';
    const signup = state.mode === 'signup';
    const reset = state.mode === 'reset';
    const newPassword = state.mode === 'newPassword';

    if ($('productAuthTitle')) $('productAuthTitle').textContent =
      signup ? 'Создать аккаунт' :
      reset ? 'Восстановление пароля' :
      newPassword ? 'Новый пароль' : 'Вход в ANIWorld';
    if ($('productAuthSubmit')) $('productAuthSubmit').textContent =
      signup ? 'Зарегистрироваться' :
      reset ? 'Отправить ссылку' :
      newPassword ? 'Сохранить новый пароль' : 'Войти';
    if ($('productModeToggle')) $('productModeToggle').textContent =
      signup ? 'Уже есть аккаунт? Войти' : 'Назад ко входу';
    if ($('productSignupFields')) $('productSignupFields').hidden = !signup;
    if ($('productPasswordField')) $('productPasswordField').hidden = reset;
    if ($('productPassword')) {
      $('productPassword').required = !reset;
      $('productPassword').autocomplete = signup || newPassword ? 'new-password' : 'current-password';
      $('productPassword').placeholder = newPassword ? 'Введи новый пароль' : 'Не менее 8 символов';
    }
    if ($('productPasswordLabel')) $('productPasswordLabel').textContent = newPassword ? 'НОВЫЙ ПАРОЛЬ' : 'ПАРОЛЬ';
    if ($('productDisplayName')) $('productDisplayName').required = signup;
    if ($('productForgotPassword')) $('productForgotPassword').hidden = state.mode !== 'login' || !state.client;
    status(
      signup ? 'После регистрации может понадобиться подтвердить email.' :
      reset ? 'Укажи email, и мы отправим ссылку для сброса пароля.' :
      newPassword ? 'Задай новый пароль для своего аккаунта.' :
      'Войди, чтобы синхронизировать библиотеку и просмотр.'
    );
  }

  function updateAuthUi() {
    const recovery = state.mode === 'newPassword';
    const loggedIn = Boolean(state.user) && !recovery;
    const headerButton = document.querySelector('button.login');
    if (headerButton) headerButton.textContent = loggedIn ? 'Мой аккаунт' : 'Войти';
    if ($('productAuthForm')) $('productAuthForm').hidden = loggedIn;
    if ($('productModeToggle')) $('productModeToggle').hidden = loggedIn || !state.client || recovery;
    if ($('productForgotPassword')) $('productForgotPassword').hidden = loggedIn || !state.client || state.mode !== 'login';
    if ($('productSignOut')) $('productSignOut').hidden = !loggedIn;
    if ($('productAccountPanel')) $('productAccountPanel').hidden = !loggedIn;
    if ($('productAuthTitle') && loggedIn) $('productAuthTitle').textContent = 'Моя библиотека';
    if ($('productAuthTitle') && recovery) $('productAuthTitle').textContent = 'Новый пароль';
    if ($('productAccountIdentity')) $('productAccountIdentity').textContent =
      loggedIn ? (state.user.email || 'Вход выполнен') :
      recovery ? 'Установи новый пароль для продолжения' : 'Войди, чтобы синхронизировать библиотеку';
    const watchButton = $('productWatchlistBtn');
    if (watchButton) watchButton.disabled = !state.client;
  }

  async function refreshProfileAndLibrary() {
    if (!state.client || !state.user) return;
    const client = state.client;
    const profileResult = await client.from('profiles').select('display_name, username').eq('id', state.user.id).maybeSingle();
    if (!profileResult.error && profileResult.data && $('productAccountIdentity')) {
      $('productAccountIdentity').textContent = (profileResult.data.display_name || state.user.email || 'Профиль') +
        (profileResult.data.username ? ' · @' + profileResult.data.username : '');
    }
    await Promise.all([loadWatchlist(), hydrateProgress()]);
  }

  function addWatchlistRow(container, item) {
    const row = document.createElement('div');
    row.className = 'product-watchlist-row';
    const copy = document.createElement('div');
    copy.className = 'product-watchlist-copy';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const meta = document.createElement('small');
    meta.textContent = (item.release_year ? String(item.release_year) + ' · ' : '') + (item.kind === 'manga' ? 'Манга' : 'Аниме');
    copy.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'product-watchlist-actions';
    const select = document.createElement('select');
    select.className = 'product-status-select';
    select.setAttribute('aria-label', 'Статус для ' + item.title);
    [['planned', 'В планах'], ['watching', 'Смотрю'], ['completed', 'Просмотрено'], ['on_hold', 'Отложено'], ['dropped', 'Брошено']]
      .forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = item.status === value;
        select.appendChild(option);
      });
    select.addEventListener('change', async () => {
      const { error } = await state.client.from('watchlist').update({ status: select.value })
        .eq('user_id', state.user.id).eq('provider', item.provider).eq('provider_code', item.provider_code);
      if (error) { status('Не удалось обновить статус: ' + error.message, 'error'); select.value = item.status; return; }
      item.status = select.value;
      status('Статус сохранён.', 'success');
    });
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'product-remove';
    remove.textContent = 'Убрать';
    remove.addEventListener('click', async () => {
      const { error } = await state.client.from('watchlist').delete()
        .eq('user_id', state.user.id).eq('provider', item.provider).eq('provider_code', item.provider_code);
      if (error) { status('Не удалось удалить запись: ' + error.message, 'error'); return; }
      await loadWatchlist();
      await refreshCurrentTitleButton();
      status('Тайтл удалён из списка.', 'success');
    });
    actions.append(select, remove);
    row.append(copy, actions);
    container.appendChild(row);
  }

  async function loadWatchlist() {
    if (!state.client || !state.user) return;
    const list = $('productWatchlist');
    const empty = $('productWatchlistEmpty');
    if (!list) return;
    list.replaceChildren();
    const { data, error } = await state.client.from('watchlist')
      .select('provider, provider_code, title, kind, release_year, status')
      .order('updated_at', { ascending: false }).limit(100);
    if (error) {
      if (empty) { empty.hidden = false; empty.textContent = 'Библиотека недоступна: ' + error.message; }
      return;
    }
    (data || []).forEach(item => addWatchlistRow(list, item));
    if (empty) {
      empty.hidden = Boolean(data && data.length);
      empty.textContent = 'Пока пусто. Открой тайтл в каталоге и нажми «В мой список».';
    }
  }

  async function hydrateProgress() {
    if (!state.client || !state.user) return;
    const { data, error } = await state.client.from('watch_progress')
      .select('title, episode_number, voice, position_seconds, duration_seconds, is_finished, updated_at')
      .order('updated_at', { ascending: false }).limit(150);
    if (error || !Array.isArray(data)) return;
    for (const row of data) {
      try {
        const key = 'aniworld_watch_position_v1:' + JSON.stringify([
          String(row.title), Number(row.episode_number) || 1, String(row.voice || '')
        ]);
        if (row.is_finished) {
          localStorage.removeItem(key);
          continue;
        }
        const remoteTime = Number(row.position_seconds);
        if (!Number.isFinite(remoteTime) || remoteTime <= 10) continue;
        const remoteUpdated = Date.parse(row.updated_at) || 0;
        const local = JSON.parse(localStorage.getItem(key) || 'null');
        if (!local || (Number(local.updatedAt) || 0) < remoteUpdated) {
          localStorage.setItem(key, JSON.stringify({ time: remoteTime, updatedAt: remoteUpdated || Date.now() }));
        }
      } catch (_) {}
    }
  }

  async function refreshCurrentTitleButton() {
    const button = $('productWatchlistBtn');
    if (!button || !state.client || !state.user || !state.currentTitle) {
      if (button) button.textContent = '＋ В мой список';
      return;
    }
    const code = providerCode();
    const { data, error } = await state.client.from('watchlist').select('provider_code')
      .eq('user_id', state.user.id).eq('provider', 'aniliberty').eq('provider_code', code).maybeSingle();
    button.textContent = !error && data ? '✓ В списке' : '＋ В мой список';
  }

  async function toggleWatchlistFromDetail() {
    if (!state.client) {
      document.getElementById('account')?.classList.add('show');
      status('База данных ещё не подключена. После настройки Supabase вход и библиотека заработают.', 'error');
      return;
    }
    if (!state.user) {
      document.getElementById('account')?.classList.add('show');
      status('Войди или создай аккаунт, чтобы сохранить тайтл.', 'info');
      return;
    }
    const item = state.currentTitle;
    if (!item?.title) { status('Сначала открой тайтл в каталоге.', 'error'); return; }
    const code = providerCode(item);
    const { data: existing, error: readError } = await state.client.from('watchlist')
      .select('provider_code').eq('user_id', state.user.id).eq('provider', 'aniliberty')
      .eq('provider_code', code).maybeSingle();
    if (readError) { status('Не удалось проверить библиотеку: ' + readError.message, 'error'); return; }
    if (existing) {
      const { error } = await state.client.from('watchlist').delete()
        .eq('user_id', state.user.id).eq('provider', 'aniliberty').eq('provider_code', code);
      if (error) { status('Не удалось удалить тайтл: ' + error.message, 'error'); return; }
      status('Удалено из твоего списка.', 'success');
    } else {
      const payload = {
        user_id: state.user.id, provider: 'aniliberty', provider_code: code,
        title: item.title, kind: item.kind || 'anime', synopsis: item.synopsis || null,
        poster_url: item.posterUrl || null, release_year: item.year || null,
        score: item.score || null, genres: item.genres || [], status: 'planned'
      };
      const { error } = await state.client.from('watchlist').upsert(payload, { onConflict: 'user_id,provider,provider_code' });
      if (error) { status('Не удалось сохранить тайтл: ' + error.message, 'error'); return; }
      status('Добавлено в твою библиотеку.', 'success');
    }
    await Promise.all([loadWatchlist(), refreshCurrentTitleButton()]);
  }

  async function saveProgress(progress) {
    if (!state.client || !state.user || !progress || !progress.title) return;
    const episode = Math.max(1, Math.floor(Number(progress.episode) || 1));
    const time = Math.max(0, Number(progress.positionSeconds) || 0);
    const duration = Math.max(0, Number(progress.durationSeconds) || 0);
    const voice = String(progress.voice || '');
    const code = providerCode({ ...state.currentTitle, providerCode: progress.providerCode, title: progress.title });
    const key = [state.user.id, code, episode, voice].join('|');
    const now = Date.now();
    if (!progress.isFinished && now - (state.lastSave.get(key) || 0) < 4500) return;
    state.lastSave.set(key, now);
    const payload = {
      user_id: state.user.id, provider: 'aniliberty', provider_code: code, title: String(progress.title).slice(0, 240),
      episode_number: episode, voice, position_seconds: progress.isFinished ? duration || time : time,
      duration_seconds: duration, is_finished: Boolean(progress.isFinished)
    };
    const { error } = await state.client.from('watch_progress')
      .upsert(payload, { onConflict: 'user_id,provider,provider_code,episode_number,voice' });
    if (error) console.warn('ANIWorld progress sync failed:', error.message);
  }

  async function authSubmit(event) {
    event.preventDefault();
    if (!state.client) { status('База данных ещё не подключена. Настрой Supabase и переменные окружения Vercel.', 'error'); return; }
    const email = String($('productEmail')?.value || '').trim();
    const password = String($('productPassword')?.value || '');
    const displayName = String($('productDisplayName')?.value || '').trim();
    const submit = $('productAuthSubmit');
    if (submit) { submit.disabled = true; submit.textContent = 'Подожди…'; }
    try {
      if (state.mode === 'reset') {
        const { error } = await state.client.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin
        });
        if (error) throw error;
        status('Если аккаунт с таким email существует, ссылка для смены пароля уже отправлена. Проверь почту.', 'success');
        return;
      }
      if (state.mode === 'newPassword') {
        const { error } = await state.client.auth.updateUser({ password });
        if (error) throw error;
        if ($('productPassword')) $('productPassword').value = '';
        setMode('login');
        updateAuthUi();
        status('Пароль обновлён. Ты вошёл в ANIWorld.', 'success');
        return;
      }
      if (state.mode === 'signup') {
        const { data, error } = await state.client.auth.signUp({
          email, password, options: { emailRedirectTo: window.location.origin, data: { display_name: displayName || email.split('@')[0] } }
        });
        if (error) throw error;
        if (data.session) status('Аккаунт создан. Добро пожаловать!', 'success');
        else status('Регистрация отправлена. Проверь почту и подтверди email, затем войди.', 'success');
      } else {
        const { error } = await state.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        status('Ты вошёл в ANIWorld.', 'success');
      }
    } catch (error) {
      status(error?.message || 'Не удалось выполнить запрос.', 'error');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent =
          state.mode === 'signup' ? 'Зарегистрироваться' :
          state.mode === 'reset' ? 'Отправить ссылку' :
          state.mode === 'newPassword' ? 'Сохранить новый пароль' : 'Войти';
      }
    }
  }

  async function signOut() {
    if (!state.client) return;
    const { error } = await state.client.auth.signOut();
    if (error) status('Не удалось выйти: ' + error.message, 'error');
    else status('Ты вышел из аккаунта.', 'success');
  }

  async function init() {
    $('productAuthForm')?.addEventListener('submit', authSubmit);
    $('productModeToggle')?.addEventListener('click', () => setMode(state.mode === 'login' ? 'signup' : 'login'));
    $('productForgotPassword')?.addEventListener('click', () => setMode('reset'));
    $('productSignOut')?.addEventListener('click', signOut);
    $('productWatchlistBtn')?.addEventListener('click', toggleWatchlistFromDetail);
    setMode('login');
    updateAuthUi();
    try {
      const configResponse = await fetch('/api/config', { cache: 'no-store' });
      const config = await configResponse.json();
      if (!configResponse.ok || !config.configured) {
        status(config.message || 'База данных не подключена к этой версии сайта.', 'error');
        if ($('productModeToggle')) $('productModeToggle').hidden = true;
        return;
      }
      if (!window.supabase?.createClient) throw new Error('Не загрузилась библиотека клиента Supabase. Обнови страницу и попробуй ещё раз.');
      state.client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
      });
      state.client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          if ($('productPassword')) $('productPassword').value = '';
          setMode('newPassword');
        }
        state.user = session?.user || null;
        updateAuthUi();
        if (state.user && state.mode !== 'newPassword') {
          window.setTimeout(() => refreshProfileAndLibrary().catch(() => {}), 0);
        } else if (!state.user) {
          $('productWatchlist')?.replaceChildren();
          if ($('productWatchlistEmpty')) {
            $('productWatchlistEmpty').hidden = false;
            $('productWatchlistEmpty').textContent = 'Войди, чтобы открыть личную библиотеку.';
          }
        }
      });
      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      state.user = data.session?.user || null;
      updateAuthUi();
      if (state.user && state.mode !== 'newPassword') await refreshProfileAndLibrary();
      await refreshCurrentTitleButton();
    } catch (error) {
      status(error?.message || 'Не удалось подключить сервис аккаунтов.', 'error');
    }
  }

  window.ANIProduct = {
    setCurrentTitle(meta) {
      if (!meta || !meta.title) return;
      state.currentTitle = { ...meta };
      refreshCurrentTitleButton().catch(() => {});
    },
    toggleWatchlistFromDetail,
    saveProgress,
    openAccount() { document.getElementById('account')?.classList.add('show'); },
    refreshLibrary: loadWatchlist
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
