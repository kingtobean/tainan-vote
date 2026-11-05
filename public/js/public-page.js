import { VoteApi, formatVoteCount } from "./api.js";

const api = new VoteApi(window.APP_CONFIG);
const elements = {
  eventName: document.querySelector("#event-name"),
  lastUpdated: document.querySelector("#last-updated"),
  totalVotes: document.querySelector("#total-votes"),
  candidateList: document.querySelector("#candidate-list"),
  connectionStatus: document.querySelector("#connection-status"),
  connectionLabel: document.querySelector("#connection-label"),
  broadcastMode: document.querySelector("#broadcast-mode"),
  dataMode: document.querySelector("#data-mode"),
  toast: document.querySelector("#toast"),
};

const state = {
  candidates: [],
  hasLoaded: false,
  loading: false,
  timer: null,
  lastErrorMessage: "",
  lastSnapshot: "",
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const timeFormatter = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function mixHexColor(color, fallback = "#0f766e") {
  if (!/^#[0-9a-f]{6}$/i.test(color || "")) {
    return fallback;
  }

  const source = color.slice(1);
  const dark = "07111f";
  const ratio = 0.45;
  const mixed = [0, 2, 4]
    .map((offset) => {
      const sourcePart = Number.parseInt(source.slice(offset, offset + 2), 16);
      const darkPart = Number.parseInt(dark.slice(offset, offset + 2), 16);
      return Math.round(sourcePart * (1 - ratio) + darkPart * ratio)
        .toString(16)
        .padStart(2, "0");
    })
    .join("");

  return `#${mixed}`;
}

function isLightColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || "")) {
    return false;
  }

  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 >= 150;
}

function createCandidateRow(candidate, index, previousVotes) {
  const isLeader =
    index === 0 &&
    Number(candidate.votes) > 0 &&
    Number(candidate.votes) > Number(state.candidates[1]?.votes ?? -1);

  const row = document.createElement("article");
  row.className = [
    "candidate-row",
    isLeader ? "rank-first" : "",
    candidate.is_elected ? "is-elected" : "",
    isLightColor(candidate.theme_color) ? "is-light" : "",
  ]
    .filter(Boolean)
    .join(" ");
  row.dataset.id = candidate.id;
  row.style.setProperty("--theme", candidate.theme_color || "#0f766e");
  row.style.setProperty(
    "--theme-deep",
    mixHexColor(candidate.theme_color || "#0f766e"),
  );
  row.setAttribute(
    "aria-label",
    `${candidate.is_elected ? "當選，" : ""}第 ${index + 1} 名，${candidate.ballot_no} 號 ${candidate.name}，${formatVoteCount(candidate.votes)} 票`,
  );

  const rankCell = document.createElement("div");
  rankCell.className = "rank-cell";
  const rankLabel = document.createElement("span");
  rankLabel.textContent = "排序";
  const rankNumber = document.createElement("strong");
  rankNumber.textContent = String(index + 1);
  rankCell.append(rankLabel, rankNumber);

  const ballotCell = document.createElement("div");
  ballotCell.className = "ballot-cell";
  const ballotLabel = document.createElement("span");
  ballotLabel.textContent = "號次";
  const ballotNumber = document.createElement("strong");
  ballotNumber.textContent = String(candidate.ballot_no);
  ballotCell.append(ballotLabel, ballotNumber);

  const photoFrame = document.createElement("div");
  photoFrame.className = "candidate-photo";
  const photo = document.createElement("img");
  photo.src = candidate.photo_path;
  photo.alt = `${candidate.name}候選人照片`;
  photo.width = 480;
  photo.height = 600;
  photo.decoding = "async";
  photo.loading = index < 3 ? "eager" : "lazy";
  photoFrame.append(photo);

  const copy = document.createElement("div");
  copy.className = "candidate-copy";
  const name = document.createElement("h3");
  name.textContent = candidate.name;
  copy.append(name);
  if (candidate.is_elected) {
    const electedStamp = document.createElement("span");
    electedStamp.className = "elected-stamp";
    electedStamp.textContent = "當選";
    electedStamp.setAttribute("aria-hidden", "true");
    copy.append(electedStamp);
  }

  const voteCell = document.createElement("div");
  voteCell.className = "vote-cell";
  const voteLabel = document.createElement("span");
  voteLabel.textContent = "目前票數";
  const voteNumber = document.createElement("strong");
  voteNumber.textContent = formatVoteCount(candidate.votes);
  const voteUnit = document.createElement("span");
  voteUnit.className = "vote-unit";
  voteUnit.textContent = "票";
  voteCell.append(voteLabel, voteNumber, voteUnit);

  row.append(rankCell, ballotCell, photoFrame, copy, voteCell);

  if (
    previousVotes.has(candidate.id) &&
    previousVotes.get(candidate.id) !== Number(candidate.votes)
  ) {
    row.classList.add("vote-changed");
    window.setTimeout(() => row.classList.remove("vote-changed"), 700);
  }

  return row;
}

function capturePositions() {
  return new Map(
    [...elements.candidateList.querySelectorAll(".candidate-row")].map((row) => [
      row.dataset.id,
      row.getBoundingClientRect(),
    ]),
  );
}

function animateReorder(previousPositions) {
  if (reduceMotion.matches || previousPositions.size === 0) {
    return;
  }

  requestAnimationFrame(() => {
    elements.candidateList.querySelectorAll(".candidate-row").forEach((row) => {
      const previous = previousPositions.get(row.dataset.id);
      if (!previous) {
        row.animate(
          [
            { opacity: 0, transform: "translateY(10px) scale(0.99)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          {
            duration: 420,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "both",
          },
        );
        return;
      }

      const current = row.getBoundingClientRect();
      const offset = previous.top - current.top;
      if (Math.abs(offset) < 1) {
        return;
      }

      row.animate(
        [
          { transform: `translateY(${offset}px)`, opacity: 0.82 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        {
          duration: 560,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
    });
  });
}

function renderCandidates(candidates) {
  const previousPositions = capturePositions();
  const previousVotes = new Map(
    state.candidates.map((candidate) => [candidate.id, Number(candidate.votes)]),
  );

  state.candidates = candidates;
  elements.candidateList.replaceChildren();
  elements.candidateList.style.setProperty(
    "--candidate-count",
    String(candidates.length || 9),
  );

  if (candidates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "loading-panel";
    empty.textContent = "目前尚無候選人資料";
    elements.candidateList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  candidates.forEach((candidate, index) => {
    fragment.append(createCandidateRow(candidate, index, previousVotes));
  });
  elements.candidateList.append(fragment);
  elements.candidateList.setAttribute("aria-busy", "false");

  if (state.hasLoaded) {
    animateReorder(previousPositions);
  } else if (!reduceMotion.matches) {
    [...elements.candidateList.children].forEach((row, index) => {
      row.animate(
        [
          { opacity: 0, transform: "translateY(16px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        {
          duration: 470,
          delay: Math.min(index * 45, 300),
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "backwards",
        },
      );
    });
  }

  state.hasLoaded = true;
}

function updateSummary(candidates) {
  const totalVotes = candidates.reduce(
    (total, candidate) => total + Number(candidate.votes || 0),
    0,
  );
  elements.totalVotes.textContent = formatVoteCount(totalVotes);

  const latestTimestamp = candidates.reduce((latest, candidate) => {
    const timestamp = Date.parse(candidate.updated_at || "");
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
  }, 0);

  elements.lastUpdated.textContent = latestTimestamp
    ? timeFormatter.format(new Date(latestTimestamp))
    : "--:--:--";
  elements.lastUpdated.dateTime = latestTimestamp
    ? new Date(latestTimestamp).toISOString()
    : "";
}

function setConnectionStatus(mode, label) {
  elements.connectionStatus.dataset.state = mode;
  elements.connectionLabel.textContent = label;
}

function setModeLabel() {
  elements.eventName.textContent = api.eventName;
  elements.broadcastMode.textContent = api.isDemo
    ? "DEMO 預覽模式"
    : "LIVE 即時開票";
  elements.dataMode.textContent = api.isDemo
    ? "本機預覽資料 · 未連線至正式資料庫"
    : "Supabase 即時資料";
  document.title = `${api.eventName}｜即時計票`;
  document.documentElement.dataset.dataMode = api.isDemo ? "demo" : "production";
  document.body.classList.toggle("is-demo", api.isDemo);
  setConnectionStatus(
    api.isDemo ? "demo" : "connecting",
    api.isDemo ? "預覽模式 · 非正式票數" : "連線中",
  );
}

function createSnapshot(candidates) {
  return candidates
    .map(
      (candidate) =>
        `${candidate.id}:${candidate.name}:${candidate.ballot_no}:${candidate.photo_path}:${candidate.theme_color}:${candidate.votes}:${candidate.is_elected}:${candidate.updated_at}`,
    )
    .join("|");
}

function showToast(message, tone = "default") {
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 3200);
}

async function refreshCandidates({ initial = false } = {}) {
  if (state.loading) {
    return;
  }

  state.loading = true;
  if (initial && !api.isDemo) {
    setConnectionStatus("connecting", "連線中");
  }

  try {
    const candidates = await api.getCandidates();
    const snapshot = createSnapshot(candidates);
    if (snapshot !== state.lastSnapshot) {
      renderCandidates(candidates);
      updateSummary(candidates);
      state.lastSnapshot = snapshot;
    }
    state.lastErrorMessage = "";
    setConnectionStatus(
      api.isDemo ? "demo" : "online",
      api.isDemo ? "預覽模式 · 非正式票數" : "即時連線",
    );
  } catch (error) {
    setConnectionStatus(
      api.isDemo ? "demo" : "offline",
      api.isDemo ? "預覽模式 · 非正式票數" : "重新連線中",
    );
    if (!state.hasLoaded) {
      elements.candidateList.setAttribute("aria-busy", "false");
      elements.candidateList.replaceChildren();
      const errorPanel = document.createElement("div");
      errorPanel.className = "loading-panel";
      errorPanel.textContent = "目前無法載入計票資料，系統會自動重試。";
      elements.candidateList.append(errorPanel);
    }
    if (state.lastErrorMessage !== error.message) {
      state.lastErrorMessage = error.message;
      showToast(error.message, "error");
      console.error("Unable to refresh public results:", error);
    }
  } finally {
    state.loading = false;
  }
}

function startPolling() {
  stopPolling();
  if (document.hidden) {
    return;
  }

  const interval = Math.max(1000, Number(window.APP_CONFIG?.publicRefreshIntervalMs) || 2000);
  state.timer = window.setInterval(() => {
    refreshCandidates();
  }, interval);
}

function stopPolling() {
  if (state.timer) {
    window.clearInterval(state.timer);
    state.timer = null;
  }
}

function initialize() {
  setModeLabel();

  const unsubscribe = api.subscribeToDemoChanges(() => {
    refreshCandidates();
  });

  window.addEventListener("beforeunload", unsubscribe, { once: true });
  window.addEventListener("online", () => refreshCandidates());
  window.addEventListener("offline", () => {
    if (!api.isDemo) {
      setConnectionStatus("offline", "網路已中斷");
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
      return;
    }

    refreshCandidates();
    startPolling();
  });

  refreshCandidates({ initial: true });
  startPolling();
}

initialize();
