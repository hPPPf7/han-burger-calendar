(function () {
  const DRIVE_FILE_NAME = "han-burger-calendar-events.json";
  const TOKEN_STORAGE_KEY = "han-burger-calendar-mobile-auth-v1";
  const SYNC_STATE_KEY = "han-burger-calendar-mobile-sync-state-v1";
  const DRIVE_LIST_URL = "https://www.googleapis.com/drive/v3/files";
  const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
  const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
  const DEFAULT_CONFIG = {
    google: {
      androidClientId: "",
      iosClientId: "",
      redirectScheme: "com.hanburger.calendar",
      scopes: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive.appdata"
      ]
    }
  };

  const config = {
    ...DEFAULT_CONFIG,
    ...(window.HAN_BURGER_CALENDAR_MOBILE_CONFIG || {}),
    google: {
      ...DEFAULT_CONFIG.google,
      ...((window.HAN_BURGER_CALENDAR_MOBILE_CONFIG || {}).google || {})
    }
  };

  const pendingAuth = new Map();

  function getCapacitor() {
    return window.Capacitor || null;
  }

  function isNative() {
    return Boolean(getCapacitor()?.isNativePlatform?.());
  }

  function getPlatform() {
    return getCapacitor()?.getPlatform?.() || "web";
  }

  function getPlugins() {
    return getCapacitor()?.Plugins || {};
  }

  function getClientId() {
    return getPlatform() === "ios"
      ? config.google.iosClientId
      : config.google.androidClientId;
  }

  function getRedirectUri() {
    return `${config.google.redirectScheme}:/oauth2redirect`;
  }

  function assertConfigured() {
    if (!isNative()) {
      throw new Error("手機同步只在 Android/iOS app 內啟用。");
    }

    if (!getClientId()) {
      throw new Error("尚未設定手機版 Google OAuth Client ID。");
    }
  }

  function readJson(key, fallbackValue) {
    try {
      return JSON.parse(localStorage.getItem(key) || "") || fallbackValue;
    } catch {
      return fallbackValue;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function normalizeData(data) {
    return {
      version: 1,
      events: Array.isArray(data?.events) ? data.events : []
    };
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hashBuffer)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function getContentHash(data) {
    const normalized = normalizeData(data);
    const events = normalized.events
      .filter((event) => !event.deletedAt)
      .map((event) => ({
        id: event.id,
        title: event.title,
        date: event.date,
        time: event.time || "",
        color: event.color || "",
        reminderMinutes: Number(event.reminderMinutes || 0),
        reminderRepeat: event.reminderRepeat || "once",
        note: event.note || "",
        done: Boolean(event.done),
        deletedAt: event.deletedAt || null,
        updatedAt: event.updatedAt || "",
        createdAt: event.createdAt || ""
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    return sha256Hex(JSON.stringify({ version: 1, events }));
  }

  function mergeData(leftData, rightData) {
    const merged = new Map();
    for (const event of [...normalizeData(leftData).events, ...normalizeData(rightData).events]) {
      if (!event?.id) continue;
      const current = merged.get(event.id);
      if (!current || String(event.updatedAt || "") >= String(current.updatedAt || "")) {
        merged.set(event.id, event);
      }
    }

    return {
      version: 1,
      events: [...merged.values()].sort((a, b) => {
        const byDate = String(a.date || "").localeCompare(String(b.date || ""));
        if (byDate) return byDate;
        return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      })
    };
  }

  function randomString(length = 64) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const values = crypto.getRandomValues(new Uint8Array(length));
    return [...values].map((value) => chars[value % chars.length]).join("");
  }

  function base64UrlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let value = "";
    for (const byte of bytes) value += String.fromCharCode(byte);
    return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function createCodeChallenge(verifier) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64UrlEncode(buffer);
  }

  async function exchangeCodeForToken(code, verifier) {
    const body = new URLSearchParams({
      client_id: getClientId(),
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri()
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error_description || payload.error || "Google 登入失敗。");
    }

    const nextAuth = {
      ...payload,
      expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
    };
    writeJson(TOKEN_STORAGE_KEY, nextAuth);
    return nextAuth;
  }

  async function signIn() {
    assertConfigured();
    const { App, Browser } = getPlugins();
    if (!App || !Browser) {
      throw new Error("手機登入插件尚未安裝。");
    }

    const verifier = randomString();
    const state = randomString(32);
    const challenge = await createCodeChallenge(verifier);
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", getClientId());
    url.searchParams.set("redirect_uri", getRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.google.scopes.join(" "));
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");

    const authPromise = new Promise((resolve, reject) => {
      pendingAuth.set(state, { resolve, reject, verifier });
      setTimeout(() => {
        if (!pendingAuth.has(state)) return;
        pendingAuth.delete(state);
        reject(new Error("Google 登入逾時。"));
      }, 120000);
    });

    await Browser.open({ url: url.toString() });
    return authPromise;
  }

  async function handleAppUrlOpen(event) {
    const openedUrl = new URL(event.url);
    if (!openedUrl.href.startsWith(getRedirectUri())) return;

    const state = openedUrl.searchParams.get("state");
    const code = openedUrl.searchParams.get("code");
    const error = openedUrl.searchParams.get("error");
    const request = pendingAuth.get(state);
    if (!request) return;

    pendingAuth.delete(state);
    try {
      await getPlugins().Browser?.close?.();
      if (error) {
        throw new Error(error);
      }
      if (!code) {
        throw new Error("Google 沒有回傳授權碼。");
      }
      request.resolve(await exchangeCodeForToken(code, request.verifier));
    } catch (err) {
      request.reject(err);
    }
  }

  async function refreshAccessToken(auth) {
    if (!auth?.refresh_token) {
      return signIn();
    }

    const body = new URLSearchParams({
      client_id: getClientId(),
      refresh_token: auth.refresh_token,
      grant_type: "refresh_token"
    });
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    const payload = await response.json();
    if (!response.ok) {
      return signIn();
    }
    const nextAuth = {
      ...auth,
      ...payload,
      expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
    };
    writeJson(TOKEN_STORAGE_KEY, nextAuth);
    return nextAuth;
  }

  async function getAccessToken() {
    assertConfigured();
    let auth = readJson(TOKEN_STORAGE_KEY, null);
    if (!auth?.access_token) {
      auth = await signIn();
    }
    if (Date.now() > Number(auth.expiresAt || 0) - 60000) {
      auth = await refreshAccessToken(auth);
    }
    return auth.access_token;
  }

  async function driveRequest(url, options = {}) {
    const accessToken = await getAccessToken();
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (response.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      throw new Error("Google 登入已失效，請重新登入。");
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Google Drive request failed: ${response.status}`);
    }
    return response;
  }

  async function findDriveFile() {
    const url = new URL(DRIVE_LIST_URL);
    url.searchParams.set("spaces", "appDataFolder");
    url.searchParams.set("q", `name='${DRIVE_FILE_NAME}' and 'appDataFolder' in parents and trashed=false`);
    url.searchParams.set("fields", "files(id,name,modifiedTime)");
    const response = await driveRequest(url.toString());
    const payload = await response.json();
    return Array.isArray(payload.files) ? payload.files[0] : null;
  }

  async function readDriveData() {
    const file = await findDriveFile();
    if (!file?.id) return null;
    const response = await driveRequest(`${DRIVE_LIST_URL}/${encodeURIComponent(file.id)}?alt=media`);
    return normalizeData(await response.json());
  }

  async function writeDriveData(data) {
    const file = await findDriveFile();
    const body = JSON.stringify(normalizeData(data));
    if (file?.id) {
      await driveRequest(`${DRIVE_UPLOAD_URL}/${encodeURIComponent(file.id)}?uploadType=media`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body
      });
      return;
    }

    const boundary = `han_burger_${Date.now()}`;
    const metadata = JSON.stringify({
      name: DRIVE_FILE_NAME,
      parents: ["appDataFolder"]
    });
    await driveRequest(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body: [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        metadata,
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        body,
        `--${boundary}--`
      ].join("\r\n")
    });
  }

  async function getEvents() {
    const localData = normalizeData({ events: readJson("han-burger-calendar-events-v1", []) });
    const syncState = readJson(SYNC_STATE_KEY, { lastSyncedHash: "" });
    const localHash = await getContentHash(localData);
    const remoteData = await readDriveData();

    if (!remoteData) {
      if (localData.events.length) {
        await writeDriveData(localData);
      }
      writeJson(SYNC_STATE_KEY, {
        lastSyncedHash: await getContentHash(localData),
        lastSyncedAt: new Date().toISOString()
      });
      return {
        events: localData.events,
        sync: { provider: "google-drive", ok: true, message: "手機端已建立 Google Drive 同步資料。" }
      };
    }

    const remoteHash = await getContentHash(remoteData);
    const data = localHash === syncState.lastSyncedHash ? remoteData : mergeData(localData, remoteData);
    if (await getContentHash(data) !== remoteHash) {
      await writeDriveData(data);
    }
    writeJson(SYNC_STATE_KEY, {
      lastSyncedHash: await getContentHash(data),
      lastSyncedAt: new Date().toISOString()
    });
    return {
      events: data.events,
      sync: { provider: "google-drive", ok: true, message: "手機端已同步 Google Drive。" }
    };
  }

  async function saveEvents(events) {
    const data = normalizeData({ events });
    const remoteData = await readDriveData();
    const merged = remoteData ? mergeData(remoteData, data) : data;
    localStorage.setItem("han-burger-calendar-events-v1", JSON.stringify(merged.events));
    return {
      events: merged.events,
      sync: { provider: "local", ok: true, message: "手機端已先儲存本機。" }
    };
  }

  async function uploadEvents(events) {
    const data = normalizeData({ events });
    const remoteData = await readDriveData();
    const merged = remoteData ? mergeData(remoteData, data) : data;
    await writeDriveData(merged);
    writeJson(SYNC_STATE_KEY, {
      lastSyncedHash: await getContentHash(merged),
      lastSyncedAt: new Date().toISOString()
    });
    return {
      events: merged.events,
      sync: { provider: "google-drive", ok: true, message: "手機端已上傳 Google Drive。" }
    };
  }

  function getEventTime(event) {
    return new Date(`${event.date}T${event.time || "00:00"}:00`).getTime();
  }

  function getReminderStart(event) {
    return getEventTime(event) - Number(event.reminderMinutes || 0) * 60 * 1000;
  }

  function getNotificationBody(event) {
    const time = event.time || "整天";
    return `${event.date} ${time}${event.note ? " · " + event.note : ""}`;
  }

  async function scheduleNotifications(events) {
    if (!isNative()) return { scheduled: false };
    const { LocalNotifications } = getPlugins();
    if (!LocalNotifications) return { scheduled: false };

    const permission = await LocalNotifications.requestPermissions();
    if (permission.display !== "granted") {
      return { scheduled: false };
    }

    const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] }));
    if (pending.notifications?.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications }).catch(() => undefined);
    }
    const now = Date.now();
    const notifications = [];
    let id = 1000;

    for (const event of events || []) {
      if (event.done || event.deletedAt) continue;
      const firstAt = getReminderStart(event);
      const interval = event.reminderRepeat === "hourly"
        ? 60 * 60 * 1000
        : event.reminderRepeat === "daily"
          ? 24 * 60 * 60 * 1000
          : 0;

      const times = [];
      if (!interval) {
        times.push(Math.max(firstAt, now + 1000));
      } else {
        for (let nextAt = Math.max(firstAt, now + 1000); nextAt < now + 30 * 24 * 60 * 60 * 1000; nextAt += interval) {
          times.push(nextAt);
          if (times.length >= 30) break;
        }
      }

      for (const at of times) {
        notifications.push({
          id: id++,
          title: event.title,
          body: getNotificationBody(event),
          schedule: { at: new Date(at) },
          smallIcon: "ic_stat_calendar"
        });
        if (notifications.length >= 64) break;
      }
      if (notifications.length >= 64) break;
    }

    if (notifications.length) {
      await LocalNotifications.schedule({ notifications });
    }
    return { scheduled: true, count: notifications.length };
  }

  async function requestNotifications() {
    if (!isNative()) return null;
    const { LocalNotifications } = getPlugins();
    if (!LocalNotifications) return null;
    return LocalNotifications.requestPermissions();
  }

  if (isNative()) {
    getPlugins().App?.addListener?.("appUrlOpen", handleAppUrlOpen);
  }

  window.hanBurgerMobile = {
    isNative,
    getEvents,
    saveEvents,
    downloadEvents: getEvents,
    uploadEvents,
    requestNotifications,
    scheduleNotifications
  };
})();
