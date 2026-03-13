const bulkState = {
  running: false,
  total: 0,
  processed: 0,
  matched: 0,
  failed: 0,
};

const bulkEls = {
  tokenStatus: document.querySelector("#bulkTokenStatus"),
  stats: document.querySelector("#bulkStats"),
  input: document.querySelector("#bulkInput"),
  mode: document.querySelector("#bulkMode"),
  modeHelp: document.querySelector("#bulkModeHelp"),
  startBtn: document.querySelector("#bulkStartBtn"),
  clearBtn: document.querySelector("#bulkClearBtn"),
  message: document.querySelector("#bulkMessage"),
  progressBar: document.querySelector("#bulkProgressBar"),
  summary: document.querySelector("#bulkSummary"),
  successList: document.querySelector("#bulkSuccessList"),
  failureList: document.querySelector("#bulkFailureList"),
};

bootstrapBulk();

async function bootstrapBulk() {
  bulkEls.mode.addEventListener("change", updateModeHelp);
  bulkEls.startBtn.addEventListener("click", handleBulkImport);
  bulkEls.clearBtn.addEventListener("click", () => {
    bulkEls.input.value = "";
    resetBulkResult();
    setBulkMessage("");
  });

  try {
    const settings = await apiGet("/api/settings");
    bulkEls.tokenStatus.textContent = settings.hasToken
      ? "TMDB_TOKEN 已配置，可以开始导入。"
      : "当前未配置 TMDB_TOKEN，无法执行批量导入。";
  } catch (error) {
    bulkEls.tokenStatus.textContent = error.message || "无法读取服务状态。";
  }

  resetBulkResult();
  updateModeHelp();
}

async function handleBulkImport() {
  if (bulkState.running) {
    return;
  }

  const titles = bulkEls.input.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!titles.length) {
    setBulkMessage("请至少输入一个标题。");
    return;
  }

  bulkState.running = true;
  bulkState.total = titles.length;
  bulkState.processed = 0;
  bulkState.matched = 0;
  bulkState.failed = 0;
  bulkEls.startBtn.disabled = true;
  bulkEls.successList.innerHTML = "";
  bulkEls.failureList.innerHTML = "";
  setBulkMessage("开始匹配...");
  renderBulkProgress();

  for (const title of titles) {
    try {
      const result = await apiRequest("/api/bulk-import-item", {
        method: "POST",
        body: JSON.stringify({ title, mode: bulkEls.mode.value }),
      });

      if (result.status === "imported" || result.status === "already_exists") {
        bulkState.matched += 1;
        appendBulkResult(
          bulkEls.successList,
          `${title} -> ${result.mediaType === "movie" ? "电影" : "电视剧"} / ${result.matchedTitle}${
            result.status === "already_exists" ? "（已存在）" : ""
          }`
        );
      } else {
        bulkState.failed += 1;
        appendBulkResult(bulkEls.failureList, title);
      }
    } catch {
      bulkState.failed += 1;
      appendBulkResult(bulkEls.failureList, title);
    }

    bulkState.processed += 1;
    renderBulkProgress();
    setBulkMessage(`匹配中 ${bulkState.processed} / ${bulkState.total}`);
  }

  bulkState.running = false;
  bulkEls.startBtn.disabled = false;
  setBulkMessage(
    `完成：成功 ${bulkState.matched}，失败 ${bulkState.failed}，总计 ${bulkState.total}`
  );
}

function renderBulkProgress() {
  const percent = bulkState.total ? Math.round((bulkState.processed / bulkState.total) * 100) : 0;
  bulkEls.progressBar.style.width = `${percent}%`;
  bulkEls.summary.replaceChildren(
    createStatPill(`总数 ${bulkState.total}`, true),
    createStatPill(`已处理 ${bulkState.processed}`),
    createStatPill(`成功 ${bulkState.matched}`),
    createStatPill(`失败 ${bulkState.failed}`)
  );
}

function resetBulkResult() {
  bulkState.total = 0;
  bulkState.processed = 0;
  bulkState.matched = 0;
  bulkState.failed = 0;
  bulkEls.progressBar.style.width = "0%";
  bulkEls.summary.replaceChildren(
    createStatPill("总数 0", true),
    createStatPill("已处理 0"),
    createStatPill("成功 0"),
    createStatPill("失败 0")
  );
  bulkEls.successList.innerHTML = '<div class="empty-state">尚未开始导入。</div>';
  bulkEls.failureList.innerHTML = '<div class="empty-state">尚无失败项。</div>';
}

function appendBulkResult(container, text) {
  if (container.querySelector(".empty-state")) {
    container.innerHTML = "";
  }
  const item = document.createElement("div");
  item.className = "bulk-result-item";
  item.textContent = text;
  container.append(item);
}

function setBulkMessage(text) {
  bulkEls.message.textContent = text;
}

function updateModeHelp() {
  bulkEls.modeHelp.textContent =
    bulkEls.mode.value === "exact"
      ? "严格匹配：标题必须与搜索结果标题或原始标题完全一致。"
      : "模糊匹配：不要求完全一致，直接取第一个电影或电视剧搜索结果。";
}

function createStatPill(text, strong = false) {
  const tag = document.createElement("span");
  tag.className = `stat-pill${strong ? " strong" : ""}`;
  tag.textContent = text;
  return tag;
}

async function apiGet(url) {
  return apiRequest(url, { method: "GET" });
}

async function apiRequest(url, options) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "请求失败。");
  }

  return data;
}
