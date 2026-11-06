const DEMO_STORAGE_KEY = "tainan-vote-demo-state-v1";
const SESSION_STORAGE_KEY = "tainan-vote-admin-session-v1";
const REQUEST_TIMEOUT_MS = 9000;
const MAX_VOTES = 999999;
const MAX_DELTA = 1000;

const candidatesSeed = [
  {
    id: "demo-01",
    ballot_no: 1,
    name: "郭如芳",
    photo_path: "/assets/candidates/01.webp",
    theme_color: "#e2e5e8",
    votes: 5280,
  },
  {
    id: "demo-02",
    ballot_no: 2,
    name: "吳禹寰",
    photo_path: "/assets/candidates/02.webp",
    theme_color: "#9a514b",
    votes: 4970,
  },
  {
    id: "demo-03",
    ballot_no: 3,
    name: "翁語含",
    photo_path: "/assets/candidates/03.webp",
    theme_color: "#2f78c4",
    votes: 4630,
  },
  {
    id: "demo-04",
    ballot_no: 4,
    name: "杜素吟",
    photo_path: "/assets/candidates/04.webp",
    theme_color: "#9a514b",
    votes: 4380,
  },
  {
    id: "demo-05",
    ballot_no: 5,
    name: "劉正昌",
    photo_path: "/assets/candidates/05.webp",
    theme_color: "#e0b83b",
    votes: 4060,
  },
  {
    id: "demo-06",
    ballot_no: 6,
    name: "許又仁",
    photo_path: "/assets/candidates/06.webp",
    theme_color: "#9a514b",
    votes: 3710,
  },
  {
    id: "demo-07",
    ballot_no: 7,
    name: "陳皇宇",
    photo_path: "/assets/candidates/07.webp",
    theme_color: "#3f9b70",
    votes: 3420,
  },
  {
    id: "demo-08",
    ballot_no: 8,
    name: "郭鴻儀",
    photo_path: "/assets/candidates/08-v4.webp",
    theme_color: "#3f9b70",
    votes: 3180,
  },
  {
    id: "demo-09",
    ballot_no: 9,
    name: "鄭佳欣",
    photo_path: "/assets/candidates/09-v2.webp",
    theme_color: "#3f9b70",
    votes: 2890,
  },
];

let memoryDemoState = null;
let demoChannel = null;

if (typeof BroadcastChannel !== "undefined") {
  demoChannel = new BroadcastChannel("tainan-vote-demo-v1");
}

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class AuthError extends ApiError {
  constructor(message = "登入已失效，請重新登入。") {
    super(message, 401);
    this.name = "AuthError";
  }
}

export function createUuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function sortCandidates(candidates) {
  return [...candidates].sort(
    (first, second) =>
      Number(second.votes) - Number(first.votes) ||
      Number(first.ballot_no) - Number(second.ballot_no),
  );
}

export function formatVoteCount(value) {
  return new Intl.NumberFormat("zh-TW").format(Number(value) || 0);
}

function readSessionStorage() {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSessionStorage(value) {
  try {
    if (value) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value));
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // A blocked storage API should not prevent the current tab from working.
  }
}

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function createDemoState() {
  const now = new Date().toISOString();
  return {
    version: 1,
    candidates: candidatesSeed.map((candidate) => ({
      ...candidate,
      is_elected: false,
      updated_at: now,
    })),
    logs: [],
    request_ids: [],
  };
}

function parseDemoState(raw) {
  if (!raw) {
    return createDemoState();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.candidates) || parsed.candidates.length !== 9) {
      return createDemoState();
    }
    const seedByBallot = new Map(
      candidatesSeed.map((candidate) => [candidate.ballot_no, candidate]),
    );
    return {
      version: 1,
      candidates: parsed.candidates.map((candidate) => {
        const seed = seedByBallot.get(Number(candidate.ballot_no));
        return {
          ...candidate,
          name: seed?.name || candidate.name,
          photo_path: seed?.photo_path || candidate.photo_path,
          theme_color: seed?.theme_color || candidate.theme_color,
          is_elected: Boolean(candidate.is_elected),
        };
      }),
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      request_ids: Array.isArray(parsed.request_ids) ? parsed.request_ids : [],
    };
  } catch {
    return createDemoState();
  }
}

function getDemoState() {
  if (memoryDemoState) {
    return structuredClone(memoryDemoState);
  }

  memoryDemoState = parseDemoState(readLocalStorage(DEMO_STORAGE_KEY));
  return structuredClone(memoryDemoState);
}

function saveDemoState(state) {
  memoryDemoState = structuredClone(state);
  const serialized = JSON.stringify(memoryDemoState);
  const persisted = writeLocalStorage(DEMO_STORAGE_KEY, serialized);

  if (!persisted) {
    // Keep the in-memory copy available when storage is disabled.
    return;
  }

  demoChannel?.postMessage({ type: "changed" });
  window.dispatchEvent(new CustomEvent("tainan:demo-updated"));
}

function normalizeErrorBody(body, fallback) {
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }
  if (!body || typeof body !== "object") {
    return fallback;
  }
  return (
    body.message ||
    body.error_description ||
    body.hint ||
    body.error ||
    body.details ||
    fallback
  );
}

function localizeAuthError(message) {
  const normalized = String(message || "").toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "電子郵件或密碼錯誤，請重新確認。";
  }
  if (normalized.includes("email not confirmed")) {
    return "此帳號尚未完成電子郵件驗證。";
  }
  if (normalized.includes("rate limit")) {
    return "登入嘗試次數過多，請稍後再試。";
  }
  return message || "登入失敗，請稍後再試。";
}

export class VoteApi {
  constructor(config) {
    this.config = config || {};
    this.supabaseUrl = String(this.config.supabaseUrl || "")
      .trim()
      .replace(/\/+$/, "");
    this.anonKey = String(this.config.supabaseAnonKey || "").trim();
    this.session = null;
    this.isDemo =
      new URLSearchParams(window.location.search).get("demo") === "1" ||
      !this.supabaseUrl ||
      !this.anonKey;
  }

  get modeLabel() {
    return this.isDemo ? "本機預覽" : "Supabase 即時連線";
  }

  get eventName() {
    return this.config.eventName || "即時計票";
  }

  async getCandidates() {
    if (this.isDemo) {
      return sortCandidates(getDemoState().candidates);
    }

    const query = new URLSearchParams({
      select:
        "id,ballot_no,name,photo_path,theme_color,votes,is_elected,updated_at",
      order: "votes.desc,ballot_no.asc",
    });

    const data = await this.request(`/rest/v1/public_candidates?${query}`);
    return Array.isArray(data) ? data : [];
  }

  async getRecentActions(limit = 6) {
    if (this.isDemo) {
      return getDemoState().logs.slice(0, limit);
    }

    const query = new URLSearchParams({
      select:
        "id,candidate_id,old_votes,new_votes,delta,action,created_at",
      order: "created_at.desc",
      limit: String(limit),
    });
    const data = await this.authorizedRequest(`/rest/v1/vote_logs?${query}`);
    return Array.isArray(data) ? data : [];
  }

  async login(email, password) {
    if (this.isDemo) {
      throw new ApiError("請使用本機預覽入口。");
    }

    const body = await this.request("/auth/v1/token?grant_type=password", {
      method: "POST",
      auth: false,
      body: { email, password },
    }).catch((error) => {
      throw new AuthError(localizeAuthError(error.message));
    });

    const session = this.createSession(body);
    this.storeSession(session);
    return session;
  }

  loginDemo() {
    const session = {
      demo: true,
      email: "本機預覽",
      expires_at: Date.now() + 24 * 60 * 60 * 1000,
    };
    this.storeSession(session);
    return session;
  }

  async restoreSession() {
    const raw = readSessionStorage();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed.demo && this.isDemo) {
        this.session = parsed;
        return parsed;
      }
      if (!this.isDemo && parsed.access_token) {
        this.session = parsed;
        return this.ensureSession();
      }
    } catch {
      // Invalid session payloads are discarded below.
    }

    this.clearSession();
    return null;
  }

  async ensureSession() {
    if (this.session?.demo && this.isDemo) {
      return this.session;
    }
    if (!this.session) {
      throw new AuthError();
    }
    if (this.session.expires_at && this.session.expires_at <= Date.now() + 60000) {
      return this.refreshSession();
    }
    return this.session;
  }

  async refreshSession() {
    if (this.isDemo) {
      return this.session;
    }
    if (!this.session?.refresh_token) {
      this.clearSession();
      throw new AuthError();
    }

    try {
      const body = await this.request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        auth: false,
        body: { refresh_token: this.session.refresh_token },
      });
      const session = this.createSession(body);
      this.storeSession(session);
      return session;
    } catch {
      this.clearSession();
      throw new AuthError();
    }
  }

  async logout() {
    const current = this.session;
    this.clearSession();

    if (this.isDemo || !current?.access_token) {
      return;
    }

    try {
      await this.request("/auth/v1/logout", {
        method: "POST",
        token: current.access_token,
      });
    } catch {
      // Local logout must succeed even if the server is temporarily unavailable.
    }
  }

  async adjustVotes(candidateId, delta) {
    const numericDelta = Number(delta);
    if (!Number.isInteger(numericDelta) || numericDelta === 0) {
      throw new ApiError("每次票數調整必須是整數。");
    }
    if (Math.abs(numericDelta) > MAX_DELTA) {
      throw new ApiError(`單次調整不可超過 ${MAX_DELTA} 票。`);
    }

    return this.updateVotes(candidateId, numericDelta, "adjust");
  }

  async setVotes(candidateId, votes) {
    const numericVotes = Number(votes);
    if (!Number.isInteger(numericVotes) || numericVotes < 0 || numericVotes > MAX_VOTES) {
      throw new ApiError(`票數必須是 0 至 ${MAX_VOTES} 的整數。`);
    }

    return this.updateVotes(candidateId, numericVotes, "set");
  }

  async setElected(candidateId, isElected) {
    if (typeof isElected !== "boolean") {
      throw new ApiError("當選狀態格式不正確。");
    }

    const requestId = createUuid();
    if (this.isDemo) {
      return this.updateDemoElection(candidateId, isElected, requestId);
    }

    await this.ensureSession();
    const data = await this.authorizedRequest(
      "/rest/v1/rpc/set_candidate_elected",
      {
        method: "POST",
        body: {
          p_candidate_id: candidateId,
          p_is_elected: isElected,
          p_request_id: requestId,
        },
      },
    );

    const candidate = Array.isArray(data) ? data[0] : data;
    if (!candidate) {
      throw new ApiError("當選狀態已送出，但沒有收到更新結果，請重新整理確認。");
    }
    return candidate;
  }

  async updateVotes(candidateId, value, operation) {
    const requestId = createUuid();

    if (this.isDemo) {
      return this.updateDemoVotes(candidateId, value, operation, requestId);
    }

    await this.ensureSession();
    const rpcName =
      operation === "adjust" ? "adjust_candidate_votes" : "set_candidate_votes";
    const payload =
      operation === "adjust"
        ? {
            p_candidate_id: candidateId,
            p_delta: value,
            p_request_id: requestId,
          }
        : {
            p_candidate_id: candidateId,
            p_new_votes: value,
            p_request_id: requestId,
          };

    const data = await this.authorizedRequest(`/rest/v1/rpc/${rpcName}`, {
      method: "POST",
      body: payload,
    });

    const candidate = Array.isArray(data) ? data[0] : data;
    if (!candidate) {
      throw new ApiError("票數已送出，但沒有收到更新結果，請重新整理確認。");
    }
    return candidate;
  }

  subscribeToDemoChanges(callback) {
    if (!this.isDemo) {
      return () => {};
    }

    const onStorage = (event) => {
      if (event.key === DEMO_STORAGE_KEY) {
        memoryDemoState = null;
        callback();
      }
    };
    const onLocalChange = () => callback();
    const onChannel = () => {
      memoryDemoState = null;
      callback();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("tainan:demo-updated", onLocalChange);
    demoChannel?.addEventListener("message", onChannel);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("tainan:demo-updated", onLocalChange);
      demoChannel?.removeEventListener("message", onChannel);
    };
  }

  createSession(body) {
    if (!body?.access_token || !body?.refresh_token) {
      throw new AuthError("登入回應格式不完整，請稍後再試。");
    }

    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Date.now() + Number(body.expires_in || 3600) * 1000,
      email: body.user?.email || "管理員",
    };
  }

  storeSession(session) {
    this.session = session;
    writeSessionStorage(session);
  }

  clearSession() {
    this.session = null;
    writeSessionStorage(null);
  }

  async authorizedRequest(path, options = {}) {
    let session = await this.ensureSession();

    try {
      return await this.request(path, {
        ...options,
        token: session.access_token,
      });
    } catch (error) {
      if (error.status !== 401) {
        throw error;
      }

      session = await this.refreshSession();
      return this.request(path, {
        ...options,
        token: session.access_token,
      });
    }
  }

  async request(
    path,
    { method = "GET", body, auth = true, token, headers = {} } = {},
  ) {
    if (this.isDemo && path.startsWith("/rest")) {
      throw new ApiError("本機預覽模式不使用遠端 API。");
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const bearer = token || (auth ? this.anonKey : this.anonKey);

    try {
      const response = await fetch(`${this.supabaseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!response.ok) {
        const message = normalizeErrorBody(data, `請求失敗（HTTP ${response.status}）`);
        if (response.status === 401) {
          throw new AuthError(message);
        }
        throw new ApiError(message, response.status);
      }

      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error.name === "AbortError") {
        throw new ApiError("連線逾時，系統正在自動重試。");
      }
      throw new ApiError("目前無法連線至計票服務，系統正在自動重試。");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  updateDemoVotes(candidateId, value, operation, requestId) {
    const state = getDemoState();
    const candidate = state.candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      throw new ApiError("找不到這位候選人。", 404);
    }

    if (state.request_ids.includes(requestId)) {
      return candidate;
    }

    const oldVotes = Number(candidate.votes);
    const nextVotes =
      operation === "adjust"
        ? Math.min(MAX_VOTES, Math.max(0, oldVotes + Number(value)))
        : Number(value);
    const delta = nextVotes - oldVotes;
    const now = new Date().toISOString();

    candidate.votes = nextVotes;
    candidate.updated_at = now;
    state.logs.unshift({
      id: `${Date.now()}-${requestId}`,
      candidate_id: candidate.id,
      candidate_name: candidate.name,
      old_votes: oldVotes,
      new_votes: nextVotes,
      delta,
      action: operation,
      created_at: now,
    });
    state.logs = state.logs.slice(0, 30);
    state.request_ids = [...state.request_ids, requestId].slice(-100);

    saveDemoState(state);
    return { ...candidate };
  }

  updateDemoElection(candidateId, isElected, requestId) {
    const state = getDemoState();
    const candidate = state.candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      throw new ApiError("找不到這位候選人。", 404);
    }

    if (state.request_ids.includes(requestId)) {
      return candidate;
    }

    const electedTotal = state.candidates.filter((item) => item.is_elected).length;
    if (isElected && !candidate.is_elected && electedTotal >= 6) {
      throw new ApiError("最多只能標記六位候選人當選。");
    }

    const now = new Date().toISOString();
    candidate.is_elected = isElected;
    candidate.updated_at = now;
    state.logs.unshift({
      id: `${Date.now()}-${requestId}`,
      candidate_id: candidate.id,
      candidate_name: candidate.name,
      old_votes: candidate.votes,
      new_votes: candidate.votes,
      delta: 0,
      action: isElected ? "elect" : "unelect",
      created_at: now,
    });
    state.logs = state.logs.slice(0, 30);
    state.request_ids = [...state.request_ids, requestId].slice(-100);

    saveDemoState(state);
    return { ...candidate };
  }
}
