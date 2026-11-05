import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(projectRoot, "output");
const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(check, timeoutMs = 10000, intervalMs = 100) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await check();
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }
  throw new Error("Timed out while waiting for browser state.");
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) {
          return;
        }
        this.pending.delete(message.id);
        if (message.error) {
          request.reject(new Error(message.error.message));
        } else {
          request.resolve(message.result);
        }
        return;
      }

      const handlers = this.listeners.get(message.method) || [];
      handlers.forEach((handler) => handler(message.params));
    });
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) || [];
    this.listeners.set(method, [...handlers, handler]);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(expression, awaitPromise = false) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text ||
          "Browser evaluation failed.",
      );
    }
    return response.result.value;
  }
}

async function findEdge() {
  const { access } = await import("node:fs/promises");
  for (const candidate of edgeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue searching the known installation paths.
    }
  }
  throw new Error("Microsoft Edge or Google Chrome was not found.");
}

async function getDebugTarget(port) {
  return waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      return targets.find((target) => target.type === "page");
    } catch {
      return null;
    }
  }, 12000);
}

async function waitForDocument(client) {
  await waitFor(async () => {
    try {
      return await client.evaluate(
        "document.readyState === 'complete' && Boolean(document.body)",
      );
    } catch {
      return false;
    }
  });
}

async function setViewport(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(350);
}

async function capture(client, fileName) {
  await mkdir(outputDirectory, { recursive: true });
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  await writeFile(path.join(outputDirectory, fileName), Buffer.from(result.data, "base64"));
}

async function readPublicMetrics(client) {
  return client.evaluate(`(() => {
    const rows = [...document.querySelectorAll(".candidate-row")];
    const footer = document.querySelector(".site-footer");
    const mark = document.querySelector(".brand-mark");
    const eventName = document.querySelector("#event-name");
    const sectionTitle = document.querySelector(".results-heading h2");
    const lastRow = rows.at(-1);
    const footerStyle = footer ? getComputedStyle(footer) : null;
    const voteOverflow = rows.some((row) => {
      const rowRect = row.getBoundingClientRect();
      const unitRect = row.querySelector(".vote-unit")?.getBoundingClientRect();
      return unitRect ? unitRect.right > rowRect.right + 0.5 : true;
    });
    return {
      viewport: [innerWidth, innerHeight],
      candidateCount: rows.length,
      allImagesLoaded: [...document.images].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
      documentHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      voteUnitOverflow: voteOverflow,
      leftEdges: {
        mark: mark?.getBoundingClientRect().left ?? null,
        eventName: eventName?.getBoundingClientRect().left ?? null,
        sectionTitle: sectionTitle?.getBoundingClientRect().left ?? null,
      },
      footer: footer
        ? {
            top: footer.getBoundingClientRect().top,
            bottom: footer.getBoundingClientRect().bottom,
            marginTop: footerStyle.marginTop,
            gapAfterLastRow: footer.getBoundingClientRect().top -
              (lastRow?.getBoundingClientRect().bottom ?? 0),
          }
        : null,
      geometry: {
        headerHeight: document.querySelector(".site-header")?.getBoundingClientRect().height,
        resultsHeight: document.querySelector(".results")?.getBoundingClientRect().height,
        listHeight: document.querySelector(".candidate-list")?.getBoundingClientRect().height,
        firstRowHeight: rows[0]?.getBoundingClientRect().height ?? null,
        resultsHeadingHeight:
          document.querySelector(".results-heading")?.getBoundingClientRect().height,
        ballotFontSize: Number.parseFloat(
          getComputedStyle(rows[0]?.querySelector(".ballot-cell strong")).fontSize,
        ),
        photoHeight:
          rows[0]?.querySelector(".candidate-photo")?.getBoundingClientRect().height ??
          null,
      },
    };
  })()`);
}

async function run() {
  const edgePath = await findEdge();
  await mkdir(outputDirectory, { recursive: true });
  const profileDirectory = await mkdtemp(path.join(outputDirectory, "edge-smoke-"));
  const debugPort = 9333;
  const browser = spawn(
    edgePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      `--remote-debugging-port=${debugPort}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${profileDirectory}`,
      "--window-size=1920,1080",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  let client;
  const browserErrors = [];
  try {
    const target = await getDebugTarget(debugPort);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    client.on("Runtime.exceptionThrown", (event) => {
      browserErrors.push(event.exceptionDetails?.exception?.description || "Runtime error");
    });
    client.on("Runtime.consoleAPICalled", (event) => {
      if (event.type === "error") {
        browserErrors.push(
          event.args.map((argument) => argument.value || argument.description).join(" "),
        );
      }
    });

    await setViewport(client, 1920, 1080);
    await client.send("Page.navigate", { url: "http://localhost:4173/" });
    await waitForDocument(client);
    await waitFor(async () => {
      const count = await client.evaluate(
        'document.querySelectorAll(".candidate-row").length',
      );
      return count === 9;
    });
    await sleep(1200);

    const desktopWidths = [
      [1920, 1080],
      [1440, 1080],
      [1100, 1080],
    ];
    const publicMetrics = [];
    for (const [width, height] of desktopWidths) {
      await setViewport(client, width, height);
      publicMetrics.push(await readPublicMetrics(client));
    }

    await setViewport(client, 390, 844);
    await sleep(300);
    const mobileMetrics = await readPublicMetrics(client);
    await capture(client, "smoke-public-mobile.png");

    await setViewport(client, 1440, 1000);
    await client.send("Page.navigate", { url: "http://localhost:4173/admin.html" });
    await waitForDocument(client);
    await waitFor(async () =>
      client.evaluate(
        '!document.querySelector("#demo-login").hidden && Boolean(document.querySelector("#demo-login-button"))',
      ),
    );
    await client.evaluate('document.querySelector("#demo-login-button").click()');
    await waitFor(async () => {
      const count = await client.evaluate(
        'document.querySelectorAll(".admin-candidate").length',
      );
      return count === 9;
    });

    await client.evaluate(`(() => {
      const row = document.querySelector('[data-candidate-id="demo-09"]');
      const input = row.querySelector(".vote-total-input");
      input.value = "9999";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      row.querySelector(".save-votes").click();
    })()`);

    await waitFor(async () => {
      const storedVotes = await client.evaluate(`(() => {
        const state = JSON.parse(localStorage.getItem("tainan-vote-demo-state-v1"));
        return state?.candidates?.find((candidate) => candidate.id === "demo-09")?.votes;
      })()`);
      return storedVotes === 9999;
    });

    async function setElection(candidateId, expected, totalAfter) {
      await client.evaluate(`(() => {
        const row = document.querySelector('[data-candidate-id="${candidateId}"]');
        const input = row.querySelector(".elected-toggle input");
        if (input.checked !== ${expected}) {
          input.checked = ${expected};
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      })()`);
      await waitFor(async () => {
        const result = await client.evaluate(`(() => {
          const state = JSON.parse(localStorage.getItem("tainan-vote-demo-state-v1"));
          return {
            checked: Boolean(
              state?.candidates?.find((candidate) => candidate.id === "${candidateId}")?.is_elected,
            ),
            total: state?.candidates?.filter((candidate) => candidate.is_elected).length ?? 0,
          };
        })()`);
        return result.checked === expected && result.total === totalAfter;
      });
    }

    const rankedCandidateIds = await client.evaluate(`(() => {
      const state = JSON.parse(localStorage.getItem("tainan-vote-demo-state-v1"));
      return [...state.candidates]
        .sort(
          (first, second) =>
            Number(second.votes) - Number(first.votes) ||
            Number(first.ballot_no) - Number(second.ballot_no),
        )
        .map((candidate) => candidate.id);
    })()`);
    const topSixCandidateIds = rankedCandidateIds.slice(0, 6);
    const seventhCandidateId = rankedCandidateIds[6];

    for (let index = 0; index < topSixCandidateIds.length; index += 1) {
      await setElection(topSixCandidateIds[index], true, index + 1);
    }

    await client.evaluate(`(() => {
      const row = document.querySelector(
        '[data-candidate-id="${seventhCandidateId}"]',
      );
      const input = row.querySelector(".elected-toggle input");
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await sleep(350);
    const sixthLimit = await client.evaluate(`(() => {
      const state = JSON.parse(localStorage.getItem("tainan-vote-demo-state-v1"));
      return {
        seventhElected: Boolean(
          state?.candidates?.find(
            (candidate) => candidate.id === "${seventhCandidateId}",
          )?.is_elected,
        ),
        total: state?.candidates?.filter((candidate) => candidate.is_elected).length ?? 0,
        toast: document.querySelector("#toast").textContent,
      };
    })()`);

    await setElection(topSixCandidateIds[5], false, 5);
    await setElection(topSixCandidateIds[5], true, 6);
    await sleep(600);
    await capture(client, "smoke-admin-dashboard.png");

    const adminDesktopMetrics = await client.evaluate(`(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      electedCount: document.querySelector("#admin-elected-count").textContent,
      electedToggleCount: document.querySelectorAll(".elected-toggle input").length,
      hasLeadingZero: [
        ...document.querySelectorAll(".admin-rank strong"),
        ...document.querySelectorAll(".admin-identity > span"),
      ].some((element) => /^0\\d/.test(element.textContent.replace("號次 ", ""))),
    }))()`);

    await setViewport(client, 390, 844);
    await sleep(350);
    const adminMobileMetrics = await client.evaluate(`(() => {
      const controls = [...document.querySelectorAll(".vote-adjust, .save-votes")];
      return {
        candidateCount: document.querySelectorAll(".admin-candidate").length,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        minimumControlWidth: Math.min(
          ...controls.map((control) => control.getBoundingClientRect().width),
        ),
        minimumControlHeight: Math.min(
          ...controls.map((control) => control.getBoundingClientRect().height),
        ),
        leaderOverflow:
          document.querySelector("#admin-leader").scrollWidth >
          document.querySelector("#admin-leader").clientWidth,
      };
    })()`);
    await capture(client, "smoke-admin-mobile.png");

    await setViewport(client, 1920, 1080);
    await client.send("Page.navigate", { url: "http://localhost:4173/" });
    await waitForDocument(client);
    const reordered = await waitFor(async () => {
      const result = await client.evaluate(`(() => {
        const first = document.querySelector(".candidate-row");
        const row = document.querySelector('[data-id="demo-09"]');
        const intersects = (firstRect, secondRect) =>
          firstRect.left < secondRect.right &&
          firstRect.right > secondRect.left &&
          firstRect.top < secondRect.bottom &&
          firstRect.bottom > secondRect.top;
        const stampProblems = [...document.querySelectorAll(".candidate-row")]
          .filter((candidateRow) => candidateRow.querySelector(".elected-stamp"))
          .filter((candidateRow) => {
            const rowRect = candidateRow.getBoundingClientRect();
            const stampRect = candidateRow
              .querySelector(".elected-stamp")
              .getBoundingClientRect();
            const nameRange = document.createRange();
            nameRange.selectNodeContents(
              candidateRow.querySelector(".candidate-copy h3"),
            );
            const nameRect = nameRange.getBoundingClientRect();
            const protectedElements = [
              candidateRow.querySelector(".ballot-cell"),
              candidateRow.querySelector(".candidate-photo"),
              candidateRow.querySelector(".vote-cell"),
            ];
            const outsideRow =
              stampRect.left < rowRect.left ||
              stampRect.right > rowRect.right ||
              stampRect.top < rowRect.top ||
              stampRect.bottom > rowRect.bottom;
            return (
              outsideRow ||
              intersects(stampRect, nameRect) ||
              protectedElements.some((element) =>
                intersects(stampRect, element.getBoundingClientRect()),
              )
            );
          }).length;
        return {
          firstId: first?.dataset.id,
          rowVotes: row?.querySelector(".vote-cell strong")?.textContent,
          count: document.querySelectorAll(".candidate-row").length,
          electedCount: document.querySelectorAll(".elected-stamp").length,
          seatChip: document.querySelector(".seat-chip")?.textContent.trim(),
          stampProblems,
          firstRank: first?.querySelector(".rank-cell > strong")?.textContent,
          firstBallot: first?.querySelector(".ballot-cell strong")?.textContent,
        };
      })()`);
      return result.firstId === "demo-09" &&
        result.rowVotes === "9,999" &&
        result.electedCount === 6 &&
        result.stampProblems === 0
        ? result
        : null;
    });
    await sleep(500);
    await capture(client, "smoke-public-updated.png");

    const failures = [];
    publicMetrics.forEach((metrics) => {
      if (metrics.candidateCount !== 9) {
        failures.push(`${metrics.viewport.join("×")}: candidate count is not 9`);
      }
      if (!metrics.allImagesLoaded) {
        failures.push(`${metrics.viewport.join("×")}: one or more images failed`);
      }
      if (
        !metrics.geometry.ballotFontSize ||
        !metrics.geometry.photoHeight ||
        metrics.geometry.ballotFontSize / metrics.geometry.photoHeight < 0.65
      ) {
        failures.push(`${metrics.viewport.join("×")}: ballot number is too small`);
      }
      if (metrics.horizontalOverflow) {
        failures.push(`${metrics.viewport.join("×")}: horizontal overflow detected`);
      }
      if (metrics.voteUnitOverflow) {
        failures.push(`${metrics.viewport.join("×")}: vote unit exceeds row bounds`);
      }
      if (metrics.footer?.marginTop !== "0px") {
        failures.push(`${metrics.viewport.join("×")}: footer margin-top is not 0px`);
      }
      const leftEdges = Object.values(metrics.leftEdges);
      if (Math.max(...leftEdges) - Math.min(...leftEdges) > 1) {
        failures.push(`${metrics.viewport.join("×")}: primary left edges differ`);
      }
      if (
        metrics.footer &&
        (metrics.footer.bottom > metrics.viewport[1] + 1 ||
          metrics.footer.top < 0)
      ) {
        failures.push(`${metrics.viewport.join("×")}: footer is outside the viewport`);
      }
    });

    if (mobileMetrics.candidateCount !== 9 || !mobileMetrics.allImagesLoaded) {
      failures.push("390×844: mobile candidates or images failed");
    }
    if (mobileMetrics.horizontalOverflow) {
      failures.push("390×844: horizontal overflow detected");
    }
    if (adminMobileMetrics.candidateCount !== 9) {
      failures.push("390×844 admin: candidate count is not 9");
    }
    if (
      adminDesktopMetrics.horizontalOverflow ||
      adminDesktopMetrics.electedCount.trim() !== "6 / 6" ||
      adminDesktopMetrics.electedToggleCount !== 9 ||
      adminDesktopMetrics.hasLeadingZero
    ) {
      failures.push("1440 admin: election controls or summary failed");
    }
    if (
      sixthLimit.seventhElected ||
      sixthLimit.total !== 6 ||
      !sixthLimit.toast.includes("最多只能標記六位")
    ) {
      failures.push("Election limit did not stop the seventh candidate");
    }
    if (adminMobileMetrics.horizontalOverflow) {
      failures.push("390×844 admin: horizontal overflow detected");
    }
    if (
      adminMobileMetrics.minimumControlWidth < 40 ||
      adminMobileMetrics.minimumControlHeight < 40
    ) {
      failures.push("390×844 admin: one or more controls are smaller than 40px");
    }
    if (adminMobileMetrics.leaderOverflow) {
      failures.push("390×844 admin: leader summary is truncated");
    }
    if (browserErrors.length) {
      failures.push(`Browser errors: ${browserErrors.join(" | ")}`);
    }
    if (reordered.stampProblems !== 0) {
      failures.push("Elected stamps overlap protected candidate content.");
    }
    if (reordered.firstRank !== "1" || reordered.firstBallot !== "9") {
      failures.push("Public ranking or ballot number still has a leading zero.");
    }

    console.log(
      JSON.stringify(
        {
          publicMetrics,
          mobileMetrics,
          adminDesktopMetrics,
          adminMobileMetrics,
          sixthLimit,
          reordered,
          browserErrors,
          screenshots: [
            "output/smoke-public-mobile.png",
            "output/smoke-admin-dashboard.png",
            "output/smoke-admin-mobile.png",
            "output/smoke-public-updated.png",
          ],
          failures,
        },
        null,
        2,
      ),
    );

    if (failures.length) {
      throw new Error(`Smoke test failed:\n${failures.join("\n")}`);
    }
  } finally {
    try {
      await client?.send("Browser.close");
    } catch {
      // The browser may already be closing after a failed assertion.
    }
    await sleep(400);
    if (!browser.killed) {
      browser.kill();
    }
    await sleep(300);
    const expectedPrefix = path.join(outputDirectory, "edge-smoke-");
    if (profileDirectory.startsWith(expectedPrefix)) {
      await rm(profileDirectory, { recursive: true, force: true });
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
