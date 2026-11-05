import {
  AuthError,
  VoteApi,
  formatVoteCount,
  sortCandidates,
} from "./api.js";

const api = new VoteApi(window.APP_CONFIG);
const elements = {
  bootView: document.querySelector("#boot-view"),
  loginView: document.querySelector("#login-view"),
  dashboardView: document.querySelector("#dashboard-view"),
  loginForm: document.querySelector("#login-form"),
  loginEmail: document.querySelector("#login-email"),
  loginPassword: document.querySelector("#login-password"),
  loginError: document.querySelector("#login-error"),
  loginSubmit: document.querySelector("#login-submit"),
  demoLogin: document.querySelector("#demo-login"),
  demoLoginButton: document.querySelector("#demo-login-button"),
  headerActions: document.querySelector("#header-actions"),
  adminMode: document.querySelector("#admin-mode"),
  logoutButton: document.querySelector("#logout-button"),
  candidateList: document.querySelector("#admin-candidate-list"),
  totalVotes: document.querySelector("#admin-total-votes"),
  leader: document.querySelector("#admin-leader"),
  electedCount: document.querySelector("#admin-elected-count"),
  syncStatus: document.querySelector("#admin-sync-status"),
  syncLabel: document.querySelector("#admin-sync-label"),
  activityList: document.querySelector("#activity-list"),
  refreshButton: document.querySelector("#refresh-button"),
  toast: document.querySelector("#toast"),
};

const state = {
  candidates: [],
  loading: false,
  timer: null,
  busyCandidates: new Set(),
  lastSnapshot: "",
  toastTimer: null,
};

const timeFormatter = new Intl.DateTimeFormat("zh-TW", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function showView(viewName) {
  elements.bootView.hidden = viewName !== "boot";
  elements.loginView.hidden = viewName !== "login";
  elements.dashboardView.hidden = viewName !== "dashboard";
  elements.headerActions.hidden = viewName !== "dashboard";
}

function showToast(message, tone = "default") {
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 3200);
}

function setSyncState(mode, label) {
  elements.syncStatus.dataset.state = mode;
  elements.syncLabel.textContent = label;
}

function setLoginError(message) {
  elements.loginError.textContent = message || "";
}

function setLoginBusy(isBusy) {
  elements.loginSubmit.disabled = isBusy;
  elements.loginEmail.disabled = isBusy;
  elements.loginPassword.disabled = isBusy;
  elements.loginSubmit.textContent = isBusy ? "登入中…" : "登入後台";
}

function updateModeChip() {
  elements.adminMode.textContent = api.modeLabel;
  elements.adminMode.dataset.mode = api.isDemo ? "demo" : "production";
  elements.demoLogin.hidden = !api.isDemo;
  elements.loginForm.hidden = api.isDemo;
}

function createButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function setCandidateBusy(candidateId, isBusy) {
  const row = elements.candidateList.querySelector(
    `[data-candidate-id="${CSS.escape(candidateId)}"]`,
  );
  if (!row) {
    return;
  }

  row.querySelectorAll("button, input").forEach((control) => {
    control.disabled = isBusy;
  });
  row.classList.toggle("is-busy", isBusy);
}

function updateSummary(candidates) {
  const sorted = sortCandidates(candidates);
  const totalVotes = candidates.reduce(
    (total, candidate) => total + Number(candidate.votes || 0),
    0,
  );
  elements.totalVotes.textContent = formatVoteCount(totalVotes);
  elements.leader.textContent =
    sorted.length > 0 ? `${sorted[0].name} · ${formatVoteCount(sorted[0].votes)} 票` : "--";
  elements.electedCount.textContent = `${candidates.filter((candidate) => candidate.is_elected).length} / 6`;
}

function createActivityItem(action, candidateNames) {
  const item = document.createElement("div");
  item.className = "activity-item";

  const detail = document.createElement("span");
  const name =
    action.candidate_name ||
    candidateNames.get(action.candidate_id) ||
    "候選人";
  const summary = document.createElement("strong");
  summary.textContent = name;
  if (action.action === "elect" || action.action === "unelect") {
    detail.append(
      summary,
      document.createTextNode(
        action.action === "elect"
          ? `　標記為當選（目前 ${formatVoteCount(action.new_votes)} 票）`
          : `　取消當選標記（目前 ${formatVoteCount(action.new_votes)} 票）`,
      ),
    );
  } else {
    const delta = Number(action.delta || 0);
    const deltaLabel =
      delta > 0 ? `+${formatVoteCount(delta)}` : formatVoteCount(delta);
    detail.append(
      summary,
      document.createTextNode(
        `　${formatVoteCount(action.old_votes)} → ${formatVoteCount(action.new_votes)} 票（${deltaLabel}）`,
      ),
    );
  }

  const timestamp = document.createElement("time");
  const parsed = Date.parse(action.created_at);
  timestamp.textContent = Number.isFinite(parsed)
    ? timeFormatter.format(new Date(parsed))
    : "--";
  if (Number.isFinite(parsed)) {
    timestamp.dateTime = new Date(parsed).toISOString();
  }

  item.append(detail, timestamp);
  return item;
}

function renderActivities(actions) {
  elements.activityList.replaceChildren();
  if (!actions.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "尚無操作記錄";
    elements.activityList.append(empty);
    return;
  }

  const candidateNames = new Map(
    state.candidates.map((candidate) => [candidate.id, candidate.name]),
  );
  actions.forEach((action) => {
    elements.activityList.append(createActivityItem(action, candidateNames));
  });
}

async function performVoteUpdate(candidate, operation, value) {
  if (state.busyCandidates.has(candidate.id)) {
    return;
  }

  state.busyCandidates.add(candidate.id);
  setCandidateBusy(candidate.id, true);

  try {
    const updated =
      operation === "adjust"
        ? await api.adjustVotes(candidate.id, value)
        : await api.setVotes(candidate.id, value);

    state.candidates = state.candidates.map((item) =>
      item.id === updated.id ? { ...item, ...updated } : item,
    );
    state.lastSnapshot = "";
    renderCandidates(state.candidates);
    updateSummary(state.candidates);
    showToast(
      operation === "adjust"
        ? `${candidate.name} 已${value > 0 ? "增加" : "減少"} ${Math.abs(value)} 票`
        : `${candidate.name} 票數已設為 ${formatVoteCount(value)} 票`,
    );
    await loadActivities();
    setSyncState(api.isDemo ? "demo" : "online", `已同步 ${formatNow()}`);
  } catch (error) {
    if (error instanceof AuthError) {
      await handleSessionExpired();
      return;
    }
    showToast(error.message, "error");
    setSyncState("offline", "更新失敗");
  } finally {
    state.busyCandidates.delete(candidate.id);
    setCandidateBusy(candidate.id, false);
  }
}

async function performElectionUpdate(candidate, isElected) {
  if (state.busyCandidates.has(candidate.id)) {
    return;
  }

  state.busyCandidates.add(candidate.id);
  setCandidateBusy(candidate.id, true);

  try {
    const updated = await api.setElected(candidate.id, isElected);
    state.candidates = state.candidates.map((item) =>
      item.id === updated.id ? { ...item, ...updated } : item,
    );
    state.lastSnapshot = "";
    renderCandidates(state.candidates);
    updateSummary(state.candidates);
    showToast(
      isElected
        ? `${candidate.name} 已標記為當選`
        : `${candidate.name} 已取消當選標記`,
    );
    await loadActivities();
    setSyncState(api.isDemo ? "demo" : "online", `已同步 ${formatNow()}`);
  } catch (error) {
    if (error instanceof AuthError) {
      await handleSessionExpired();
      return;
    }
    renderCandidates(state.candidates);
    updateSummary(state.candidates);
    showToast(error.message, "error");
    setSyncState("offline", "更新失敗");
  } finally {
    state.busyCandidates.delete(candidate.id);
    setCandidateBusy(candidate.id, false);
  }
}

function createAdminCandidate(candidate, rank, maxVotes) {
  const row = document.createElement("article");
  row.className = `admin-candidate${candidate.is_elected ? " is-elected" : ""}`;
  row.dataset.candidateId = candidate.id;
  row.style.setProperty("--theme", candidate.theme_color || "#0f766e");
  row.style.setProperty(
    "--progress",
    `${maxVotes > 0 ? Math.max(1.5, (Number(candidate.votes) / maxVotes) * 100) : 0}%`,
  );

  const rankBlock = document.createElement("div");
  rankBlock.className = "admin-rank";
  const rankCaption = document.createElement("span");
  rankCaption.textContent = "目前排名";
  const rankValue = document.createElement("strong");
  rankValue.textContent = String(rank);
  rankBlock.append(rankCaption, rankValue);

  const photoFrame = document.createElement("div");
  photoFrame.className = "admin-photo";
  const photo = document.createElement("img");
  photo.src = candidate.photo_path;
  photo.alt = `${candidate.name}候選人照片`;
  photo.width = 480;
  photo.height = 600;
  photo.decoding = "async";
  photoFrame.append(photo);

  const identity = document.createElement("div");
  identity.className = "admin-identity";
  const ballot = document.createElement("span");
  ballot.textContent = `號次 ${candidate.ballot_no}`;
  const name = document.createElement("h2");
  name.textContent = candidate.name;
  const progress = document.createElement("div");
  progress.className = "vote-progress";
  const progressBar = document.createElement("span");
  progress.append(progressBar);
  identity.append(ballot, name, progress);

  const controls = document.createElement("div");
  controls.className = "admin-controls";

  const electedToggle = document.createElement("label");
  electedToggle.className = "elected-toggle";
  const electedInput = document.createElement("input");
  electedInput.type = "checkbox";
  electedInput.checked = Boolean(candidate.is_elected);
  electedInput.setAttribute(
    "aria-label",
    `將${candidate.name}標記為當選`,
  );
  const electedBox = document.createElement("span");
  electedBox.className = "elected-toggle__box";
  electedBox.textContent = "✓";
  electedBox.setAttribute("aria-hidden", "true");
  const electedLabel = document.createElement("span");
  electedLabel.textContent = "當選";
  electedToggle.append(electedInput, electedBox, electedLabel);
  electedInput.addEventListener("change", () => {
    const electedTotal = state.candidates.filter((item) => item.is_elected).length;
    if (electedInput.checked && electedTotal >= 6) {
      electedInput.checked = false;
      showToast("最多只能標記六位候選人當選。", "error");
      return;
    }
    performElectionUpdate(candidate, electedInput.checked);
  });

  const minusButton = createButton("−1", "vote-adjust vote-adjust--minus", () => {
    performVoteUpdate(candidate, "adjust", -1);
  });
  minusButton.setAttribute("aria-label", `${candidate.name}減少一票`);

  const input = document.createElement("input");
  input.className = "vote-total-input";
  input.type = "number";
  input.inputMode = "numeric";
  input.min = "0";
  input.max = "999999";
  input.step = "1";
  input.value = String(candidate.votes);
  input.setAttribute("aria-label", `${candidate.name}目前總票數`);
  input.addEventListener("input", () => {
    input.setCustomValidity("");
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveButton.click();
    }
  });

  const plusButton = createButton("+1", "vote-adjust", () => {
    performVoteUpdate(candidate, "adjust", 1);
  });
  plusButton.setAttribute("aria-label", `${candidate.name}增加一票`);

  const saveButton = createButton("套用", "save-votes", () => {
    const value = input.value.trim();
    if (!/^\d+$/.test(value)) {
      input.setCustomValidity("請輸入 0 以上的整數。");
      input.reportValidity();
      return;
    }
    performVoteUpdate(candidate, "set", Number(value));
  });
  saveButton.setAttribute("aria-label", `套用${candidate.name}的總票數`);

  controls.append(electedToggle, minusButton, input, plusButton, saveButton);
  row.append(rankBlock, photoFrame, identity, controls);
  return row;
}

function renderCandidates(candidates) {
  const sorted = sortCandidates(candidates);
  const rankMap = new Map(
    sorted.map((candidate, index) => [candidate.id, index + 1]),
  );
  const maxVotes = Math.max(0, ...candidates.map((candidate) => Number(candidate.votes)));
  const ballotOrdered = [...candidates].sort(
    (first, second) => Number(first.ballot_no) - Number(second.ballot_no),
  );

  elements.candidateList.replaceChildren();
  const fragment = document.createDocumentFragment();
  ballotOrdered.forEach((candidate) => {
    fragment.append(
      createAdminCandidate(candidate, rankMap.get(candidate.id), maxVotes),
    );
  });
  elements.candidateList.append(fragment);
}

async function loadActivities() {
  try {
    const actions = await api.getRecentActions(6);
    renderActivities(actions);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    renderActivities([]);
  }
}

function candidateSnapshot(candidates) {
  return candidates
    .map(
      (candidate) =>
        `${candidate.id}:${candidate.votes}:${candidate.is_elected}:${candidate.updated_at}`,
    )
    .sort()
    .join("|");
}

async function loadDashboardData({ force = false } = {}) {
  if (state.loading) {
    return;
  }

  state.loading = true;
  setSyncState(api.isDemo ? "demo" : "online", "同步中");

  try {
    const candidates = await api.getCandidates();
    const nextSnapshot = candidateSnapshot(candidates);
    const inputIsFocused = document.activeElement?.classList.contains("vote-total-input");
    const changed = nextSnapshot !== state.lastSnapshot;
    state.candidates = candidates;

    if (force || (changed && !inputIsFocused)) {
      state.lastSnapshot = nextSnapshot;
      renderCandidates(candidates);
      updateSummary(candidates);
      await loadActivities();
    }

    setSyncState(api.isDemo ? "demo" : "online", `已同步 ${formatNow()}`);
  } catch (error) {
    if (error instanceof AuthError) {
      await handleSessionExpired();
      return;
    }
    setSyncState("offline", "同步失敗，將自動重試");
    showToast(error.message, "error");
  } finally {
    state.loading = false;
  }
}

function formatNow() {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function startPolling() {
  stopPolling();
  if (document.hidden) {
    return;
  }

  const interval = Math.max(
    1500,
    Number(window.APP_CONFIG?.adminRefreshIntervalMs) || 4000,
  );
  state.timer = window.setInterval(() => {
    loadDashboardData();
  }, interval);
}

function stopPolling() {
  if (state.timer) {
    window.clearInterval(state.timer);
    state.timer = null;
  }
}

async function enterDashboard() {
  updateModeChip();
  showView("dashboard");
  await loadDashboardData({ force: true });
  startPolling();
}

async function handleSessionExpired() {
  api.clearSession();
  stopPolling();
  showView("login");
  updateModeChip();
  setLoginError("登入已失效，請重新登入。");
}

async function handleLogin(event) {
  event.preventDefault();
  setLoginError("");
  setLoginBusy(true);

  try {
    await api.login(elements.loginEmail.value.trim(), elements.loginPassword.value);
    elements.loginPassword.value = "";
    await enterDashboard();
  } catch (error) {
    setLoginError(error.message);
  } finally {
    setLoginBusy(false);
  }
}

async function handleLogout() {
  stopPolling();
  await api.logout();
  state.candidates = [];
  state.lastSnapshot = "";
  elements.candidateList.replaceChildren();
  showView("login");
  updateModeChip();
  setLoginError("");
}

async function initialize() {
  updateModeChip();
  try {
    const session = await api.restoreSession();
    if (session) {
      await enterDashboard();
      return;
    }
  } catch {
    setLoginError("登入已失效，請重新登入。");
  }

  showView("login");
  if (!api.isDemo) {
    elements.loginEmail.focus();
  }
}

elements.loginForm.addEventListener("submit", handleLogin);
elements.demoLoginButton.addEventListener("click", async () => {
  api.loginDemo();
  await enterDashboard();
});
elements.logoutButton.addEventListener("click", handleLogout);
elements.refreshButton.addEventListener("click", () => loadDashboardData({ force: true }));

const unsubscribeDemo = api.subscribeToDemoChanges(() => {
  if (!elements.dashboardView.hidden) {
    loadDashboardData();
  }
});
window.addEventListener("beforeunload", unsubscribeDemo, { once: true });

document.addEventListener("visibilitychange", () => {
  if (elements.dashboardView.hidden) {
    return;
  }
  if (document.hidden) {
    stopPolling();
  } else {
    loadDashboardData();
    startPolling();
  }
});

initialize();
