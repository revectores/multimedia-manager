const STORAGE_KEYS = {
  metadataLanguage: "metadata_language_preference",
  libraryViewMode: "library_view_mode",
};

const state = {
  mediaType: "all",
  entries: [],
  hasToken: false,
  tokenSource: "missing",
  metadataLanguage: localStorage.getItem(STORAGE_KEYS.metadataLanguage) || "zh-CN",
  viewMode: localStorage.getItem(STORAGE_KEYS.libraryViewMode) || "detailed",
  expandedEntries: new Set(),
  filters: {
    title: "",
    type: "all",
    country: "all",
    status: "all",
  },
};

const els = {
  tokenStatus: document.querySelector("#tokenStatus"),
  languagePreference: document.querySelector("#languagePreference"),
  languageHelp: document.querySelector("#languageHelp"),
  exportJsonBtn: document.querySelector("#exportJsonBtn"),
  importJsonBtn: document.querySelector("#importJsonBtn"),
  importJsonInput: document.querySelector("#importJsonInput"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  searchResults: document.querySelector("#searchResults"),
  searchMessage: document.querySelector("#searchMessage"),
  libraryList: document.querySelector("#libraryList"),
  libraryStats: document.querySelector("#libraryStats"),
  titleFilter: document.querySelector("#titleFilter"),
  typeFilter: document.querySelector("#typeFilter"),
  countryFilter: document.querySelector("#countryFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  viewMode: document.querySelector("#viewMode"),
  resultCardTemplate: document.querySelector("#resultCardTemplate"),
  libraryCardTemplate: document.querySelector("#libraryCardTemplate"),
  segmentButtons: Array.from(document.querySelectorAll(".segment")),
};

const IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

bootstrap();

async function bootstrap() {
  bindEvents();
  els.languagePreference.value = state.metadataLanguage;
  els.viewMode.value = state.viewMode;
  updateLanguageHelp();

  try {
    applySettings(await apiGet("/api/settings"));
  } catch (error) {
    setSearchMessage(error.message || "初始化失败。");
  }

  await refreshLibrary();
}

function bindEvents() {
  els.languagePreference.addEventListener("change", (event) => {
    state.metadataLanguage = event.target.value;
    localStorage.setItem(STORAGE_KEYS.metadataLanguage, state.metadataLanguage);
    updateLanguageHelp();
  });
  els.exportJsonBtn.addEventListener("click", exportJson);
  els.importJsonBtn.addEventListener("click", () => els.importJsonInput.click());
  els.importJsonInput.addEventListener("change", importJson);
  els.searchForm.addEventListener("submit", handleSearch);
  els.titleFilter.addEventListener("input", (event) => {
    state.filters.title = event.target.value.trim().toLowerCase();
    renderLibrary();
  });
  els.typeFilter.addEventListener("change", (event) => {
    state.filters.type = event.target.value;
    renderLibrary();
  });
  els.countryFilter.addEventListener("change", (event) => {
    state.filters.country = event.target.value;
    renderLibrary();
  });
  els.statusFilter.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderLibrary();
  });
  els.viewMode.addEventListener("change", (event) => {
    state.viewMode = event.target.value;
    localStorage.setItem(STORAGE_KEYS.libraryViewMode, state.viewMode);
    renderLibrary();
  });

  els.segmentButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.mediaType = button.dataset.mediaType;
      els.segmentButtons.forEach((item) => item.classList.toggle("active", item === button));
      els.searchInput.placeholder =
        state.mediaType === "movie"
          ? "输入电影名搜索"
          : state.mediaType === "tv"
            ? "输入剧名搜索"
            : "输入片名或剧名搜索";
      els.searchResults.innerHTML = "";
      setSearchMessage("");
    });
  });
}

async function refreshLibrary() {
  try {
    state.entries = await apiGet("/api/entries");
    updateCountryFilterOptions();
    renderLibrary();
  } catch (error) {
    els.libraryList.innerHTML = `<div class="empty-state">${error.message || "加载片单失败。"}</div>`;
  }
}

async function exportJson() {
  try {
    const payload = await apiGet("/api/export");
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `watch-data-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSearchMessage("已导出 JSON。");
  } catch (error) {
    setSearchMessage(error.message || "导出失败。");
  }
}

async function importJson(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    await apiRequest("/api/import", {
      method: "POST",
      body: text,
    });
    applySettings(await apiGet("/api/settings"));
    await refreshLibrary();
    setSearchMessage("JSON 导入完成，已覆盖当前数据。");
  } catch (error) {
    setSearchMessage(error.message || "导入失败。");
  } finally {
    event.target.value = "";
  }
}

async function handleSearch(event) {
  event.preventDefault();

  if (!state.hasToken) {
    setSearchMessage("请先通过环境变量 TMDB_TOKEN 启动后端服务。");
    return;
  }

  const query = els.searchInput.value.trim();
  if (!query) {
    return;
  }

  setSearchMessage("搜索中...");
  els.searchResults.innerHTML = "";

  try {
    const results = await apiGet(
      `/api/search?mediaType=${encodeURIComponent(state.mediaType)}&query=${encodeURIComponent(query)}${buildLanguageQuery(
        resolveSearchLanguage()
      )}`
    );
    renderSearchResults(results);
    setSearchMessage(results.length ? "" : "没有找到匹配结果。");
  } catch (error) {
    setSearchMessage(error.message || "搜索失败。");
  }
}

function renderSearchResults(results) {
  const fragment = document.createDocumentFragment();

  results.slice(0, 8).forEach((item) => {
    const mediaType = resolveSearchItemType(item);
    if (!mediaType) {
      return;
    }

    const node = els.resultCardTemplate.content.firstElementChild.cloneNode(true);
    const title = getSearchDisplayTitle(item);
    const releaseDate = item.release_date || item.first_air_date || "";

    node.querySelector("img").src = getPosterUrl(item.poster_path);
    node.querySelector("img").alt = title;
    node.querySelector("h3").textContent = title;
    node.querySelector(".overview").remove();
    node.querySelector(".result-meta").append(
      createTag(mediaType === "movie" ? "电影" : "电视剧", true),
      createTag(extractYear(releaseDate) || "年份未知")
    );
    const addButton = node.querySelector(".add-result-btn");
    if (hasEntryInLibrary(item.id, mediaType)) {
      const successPill = document.createElement("div");
      successPill.className = "success-pill";
      successPill.textContent = "已在片单里";
      addButton.replaceWith(successPill);
    } else {
      addButton.addEventListener("click", () => addEntry(item.id, mediaType, item));
    }
    fragment.append(node);
  });

  els.searchResults.replaceChildren(fragment);
}

async function addEntry(tmdbId, mediaType, item) {
  setSearchMessage("正在拉取详细信息...");

  try {
    await apiRequest("/api/entries", {
      method: "POST",
      body: JSON.stringify({
        mediaType,
        tmdbId,
        language: resolveEntryLanguage(item),
      }),
    });
    await refreshLibrary();
    setSearchMessage("条目已加入片单。");
  } catch (error) {
    setSearchMessage(error.message || "添加失败。");
  }
}

function renderLibrary() {
  const filtered = state.entries.filter(matchesFilters);
  renderStats(filtered);

  if (!filtered.length) {
    els.libraryList.innerHTML =
      '<div class="empty-state">片单为空，先去左侧搜索并添加一部电影或电视剧。</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((entry) => {
    const node =
      state.viewMode === "compact" && !state.expandedEntries.has(entry.id)
        ? renderCompactLibraryCard(entry)
        : renderDetailedLibraryCard(entry);
    fragment.append(node);
  });

  els.libraryList.replaceChildren(fragment);
}

function renderStats(entries) {
  const movieCount = entries.filter((entry) => entry.mediaType === "movie").length;
  const tvCount = entries.filter((entry) => entry.mediaType === "tv").length;
  const completedCount = entries.filter((entry) => entry.status === "completed").length;

  els.libraryStats.replaceChildren(
    createStatPill(`共 ${entries.length} 项`, true),
    createStatPill(`电影 ${movieCount}`),
    createStatPill(`电视剧 ${tvCount}`),
    createStatPill(`已完成 ${completedCount}`)
  );
}

function renderProgressBlock(entry) {
  return entry.mediaType === "movie" ? renderMovieProgress(entry) : renderTvProgress(entry);
}

function renderDetailedLibraryCard(entry) {
  const node = els.libraryCardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("img").src = getPosterUrl(entry.posterPath);
  node.querySelector("img").alt = entry.title;
  node.querySelector("h3").textContent = entry.title;
  node.querySelector(".meta-line").textContent = formatMeta(entry);
  node.querySelector(".overview").textContent = entry.overview;
  node.querySelector(".tag-row").append(
    createTag(entry.mediaType === "movie" ? "电影" : "电视剧", true),
    createTag(resolveStatusLabel(entry.status)),
    ...entry.genres.slice(0, 3).map((genre) => createTag(genre))
  );
  node.querySelector(".remove-btn").addEventListener("click", () => removeEntry(entry.id));
  node.querySelector(".progress-block").append(renderProgressBlock(entry));
  if (state.viewMode === "compact") {
    const summary = node.querySelector(".library-summary");
    const collapseBtn = document.createElement("button");
    collapseBtn.className = "ghost-btn";
    collapseBtn.textContent = "收起";
    collapseBtn.addEventListener("click", () => {
      state.expandedEntries.delete(entry.id);
      renderLibrary();
    });
    summary.append(collapseBtn);
  }
  return node;
}

function renderCompactLibraryCard(entry) {
  const node = document.createElement("article");
  node.className = "library-card compact-card";

  const row = document.createElement("div");
  row.className = "compact-row";

  const title = document.createElement("h3");
  title.className = "compact-title";
  title.textContent = entry.title;

  const progress = document.createElement("p");
  progress.className = "meta-line compact-progress";
  progress.textContent = getCompactProgressText(entry);

  const actionGroup = document.createElement("div");
  actionGroup.className = "compact-actions";

  const toggleBtn = document.createElement("button");
  toggleBtn.className = `secondary-btn${isCompactCompleted(entry) ? " active" : ""}`;
  toggleBtn.textContent = isCompactCompleted(entry) ? "标记未完成" : "标记完成";
  toggleBtn.addEventListener("click", async () => {
    await toggleCompactCompletion(entry);
  });

  const removeBtn = document.createElement("button");
  removeBtn.className = "ghost-btn";
  removeBtn.textContent = "删除";
  removeBtn.addEventListener("click", () => removeEntry(entry.id));

  const expandBtn = document.createElement("button");
  expandBtn.className = "ghost-btn";
  expandBtn.textContent = "展开";
  expandBtn.addEventListener("click", () => {
    state.expandedEntries.add(entry.id);
    renderLibrary();
  });

  actionGroup.append(toggleBtn, expandBtn, removeBtn);
  row.append(title, progress, actionGroup);
  node.append(row);
  return node;
}

function renderMovieProgress(entry) {
  const wrapper = document.createElement("div");
  const percent = Number(entry.progress?.percent || 0);

  const statusRow = document.createElement("div");
  statusRow.className = "movie-actions";
  ["planned", "in_progress", "completed"].forEach((value) => {
    const button = document.createElement("button");
    button.className = `status-chip ${entry.status === value ? "active" : ""}`;
    button.textContent = resolveStatusLabel(value);
    button.addEventListener("click", async () => {
      const nextPercent = value === "planned" ? 0 : value === "completed" ? 100 : Math.max(percent, 1);
      await updateEntry(entry.id, {
        kind: "movie_progress",
        status: value,
        percent: nextPercent,
      });
    });
    statusRow.append(button);
  });

  const progressText = document.createElement("p");
  progressText.className = "meta-line";
  const watchedMinutes = Math.round((entry.runtimeMinutes || 0) * (percent / 100));
  progressText.textContent = `已观看 ${percent}%${entry.runtimeMinutes ? `，约 ${watchedMinutes} / ${entry.runtimeMinutes} 分钟` : ""}`;

  const slider = document.createElement("input");
  slider.className = "range-input";
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = String(percent);
  slider.addEventListener("change", async (event) => {
    const nextPercent = Number(event.target.value);
    const nextStatus = nextPercent === 0 ? "planned" : nextPercent === 100 ? "completed" : "in_progress";
    await updateEntry(entry.id, {
      kind: "movie_progress",
      status: nextStatus,
      percent: nextPercent,
    });
  });

  wrapper.append(statusRow, progressText, slider);
  return wrapper;
}

function renderTvProgress(entry) {
  const wrapper = document.createElement("div");
  const totals = getTvTotals(entry);

  const header = document.createElement("div");
  header.className = "progress-inline";

  const summary = document.createElement("p");
  summary.className = "meta-line";
  summary.textContent = `已完成 ${totals.watchedEpisodes} / ${totals.totalEpisodes} 集，进度 ${totals.percent}%`;

  const markAllButton = document.createElement("button");
  markAllButton.className = "secondary-btn";
  markAllButton.textContent = totals.percent === 100 ? "全部取消" : "全部看完";
  markAllButton.addEventListener("click", async () => {
    await updateEntry(entry.id, { kind: "toggle_all", watched: totals.percent !== 100 });
  });
  header.append(summary, markAllButton);

  const grid = document.createElement("div");
  grid.className = "episode-grid";

  entry.seasons.forEach((season) => {
    const seasonCard = document.createElement("section");
    seasonCard.className = "season-card";

    const seasonHead = document.createElement("div");
    seasonHead.className = "season-head";

    const title = document.createElement("h3");
    title.textContent = season.name || `第 ${season.seasonNumber} 季`;

    const stat = document.createElement("span");
    const watchedCount = season.episodes.filter((episode) => episode.watched).length;
    stat.className = "tag";
    stat.textContent = `${watchedCount} / ${season.episodeCount} 集`;

    const toggleSeasonBtn = document.createElement("button");
    toggleSeasonBtn.className = "ghost-btn";
    toggleSeasonBtn.textContent = watchedCount === season.episodeCount ? "本季取消" : "本季看完";
    toggleSeasonBtn.addEventListener("click", async () => {
      await updateEntry(entry.id, {
        kind: "toggle_season",
        seasonNumber: season.seasonNumber,
        watched: watchedCount !== season.episodeCount,
      });
    });

    seasonHead.append(title, stat, toggleSeasonBtn);

    const episodeList = document.createElement("div");
    episodeList.className = "episode-list";
    season.episodes.forEach((episode) => {
      const label = document.createElement("label");
      label.className = "episode-toggle";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = episode.watched;
      checkbox.addEventListener("change", async () => {
        await updateEntry(entry.id, {
          kind: "toggle_episode",
          seasonNumber: season.seasonNumber,
          episodeNumber: episode.episodeNumber,
          watched: checkbox.checked,
        });
      });

      const text = document.createElement("span");
      text.textContent = `E${episode.episodeNumber} ${episode.name}`;
      text.title = `${episode.name}${episode.runtime ? ` · ${episode.runtime} 分钟` : ""}`;

      label.append(checkbox, text);
      episodeList.append(label);
    });

    seasonCard.append(seasonHead, episodeList);
    grid.append(seasonCard);
  });

  wrapper.append(header, grid);
  return wrapper;
}

async function updateEntry(entryId, payload) {
  try {
    const updated = await apiRequest(`/api/entries/${entryId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    state.entries = state.entries.map((entry) => (entry.id === updated.id ? updated : entry));
    renderLibrary();
  } catch (error) {
    setSearchMessage(error.message || "更新失败。");
  }
}

async function removeEntry(entryId) {
  try {
    await apiRequest(`/api/entries/${entryId}`, { method: "DELETE" });
    state.entries = state.entries.filter((entry) => entry.id !== entryId);
    state.expandedEntries.delete(entryId);
    renderLibrary();
  } catch (error) {
    setSearchMessage(error.message || "删除失败。");
  }
}

async function toggleCompactCompletion(entry) {
  if (entry.mediaType === "movie") {
    const completed = entry.status === "completed";
    await updateEntry(entry.id, {
      kind: "movie_progress",
      status: completed ? "planned" : "completed",
      percent: completed ? 0 : 100,
    });
    return;
  }

  const totals = getTvTotals(entry);
  await updateEntry(entry.id, {
    kind: "toggle_all",
    watched: totals.percent !== 100,
  });
}

function matchesFilters(entry) {
  const titleMatch =
    !state.filters.title || entry.title.toLowerCase().includes(state.filters.title);
  const typeMatch = state.filters.type === "all" || entry.mediaType === state.filters.type;
  const countries = getEntryCountryOptions(entry);
  const countryMatch =
    state.filters.country === "all" || countries.includes(state.filters.country);
  const statusMatch = state.filters.status === "all" || entry.status === state.filters.status;
  return titleMatch && typeMatch && countryMatch && statusMatch;
}

function getTvTotals(entry) {
  const totalEpisodes = entry.seasons.reduce((sum, season) => sum + season.episodeCount, 0);
  const watchedEpisodes = entry.seasons.reduce(
    (sum, season) => sum + season.episodes.filter((episode) => episode.watched).length,
    0
  );

  return {
    totalEpisodes,
    watchedEpisodes,
    percent: totalEpisodes ? Math.round((watchedEpisodes / totalEpisodes) * 100) : 0,
  };
}

function formatMeta(entry) {
  const runtimeLabel =
    entry.mediaType === "movie"
      ? `${entry.runtimeMinutes || "未知"} 分钟`
      : `${entry.seasons.length} 季 / ${getTvTotals(entry).totalEpisodes} 集`;

  return `${formatCountries(entry)} · ${entry.releaseYear} · ${runtimeLabel}`;
}

function resolveStatusLabel(status) {
  return (
    {
      planned: "想看",
      in_progress: "进行中",
      completed: "已完成",
    }[status] || "想看"
  );
}

function getCompactProgressText(entry) {
  if (entry.mediaType === "movie") {
    const percent = Number(entry.progress?.percent || 0);
    return `进度 ${percent}%`;
  }
  const totals = getTvTotals(entry);
  return `进度 ${totals.percent}% · ${totals.watchedEpisodes}/${totals.totalEpisodes} 集`;
}

function isCompactCompleted(entry) {
  return entry.status === "completed";
}

function updateCountryFilterOptions() {
  const countries = Array.from(
    new Set(
      state.entries.flatMap((entry) => getEntryCountryOptions(entry)).filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, "zh-CN"));

  if (state.filters.country !== "all" && !countries.includes(state.filters.country)) {
    state.filters.country = "all";
  }

  const fragment = document.createDocumentFragment();
  fragment.append(new Option("全部国家", "all"));
  countries.forEach((country) => {
    fragment.append(new Option(country, country));
  });
  els.countryFilter.replaceChildren(fragment);
  els.countryFilter.value = state.filters.country;
}

function getEntryCountryOptions(entry) {
  return String(formatCountries(entry) || "")
    .split(" / ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createTag(text, strong = false) {
  const tag = document.createElement("span");
  tag.className = `tag${strong ? " strong" : ""}`;
  tag.textContent = text;
  return tag;
}

function createStatPill(text, strong = false) {
  const tag = document.createElement("span");
  tag.className = `stat-pill${strong ? " strong" : ""}`;
  tag.textContent = text;
  return tag;
}

function extractYear(dateString) {
  return dateString ? String(dateString).slice(0, 4) : "";
}

function getPosterUrl(path) {
  return path
    ? `${IMAGE_BASE}${path}`
    : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 480'%3E%3Crect width='320' height='480' fill='%23e9d5bf'/%3E%3Ctext x='50%25' y='50%25' font-size='24' text-anchor='middle' fill='%23765948' font-family='sans-serif'%3ENo Poster%3C/text%3E%3C/svg%3E";
}

function setSearchMessage(text) {
  els.searchMessage.textContent = text;
}

function applySettings(settings) {
  state.hasToken = Boolean(settings.hasToken);
  state.tokenSource = settings.tokenSource || "missing";
  els.tokenStatus.textContent = resolveTokenStatusText();
}

function resolveTokenStatusText() {
  if (state.tokenSource === "environment") {
    return "当前使用服务端环境变量 TMDB_TOKEN。";
  }
  return "当前未配置 Token。请在启动服务时设置 TMDB_TOKEN。";
}

function resolveSearchItemType(item) {
  if (item.media_type === "movie" || item.media_type === "tv") {
    return item.media_type;
  }
  if (item.title) {
    return "movie";
  }
  if (item.name) {
    return "tv";
  }
  return "";
}

function hasEntryInLibrary(tmdbId, mediaType) {
  return state.entries.some((entry) => entry.tmdbId === tmdbId && entry.mediaType === mediaType);
}

function getSearchDisplayTitle(item) {
  if (state.metadataLanguage === "dynamic") {
    return item.original_title || item.original_name || item.title || item.name || "未命名";
  }
  return item.title || item.name || item.original_title || item.original_name || "未命名";
}

function resolveSearchLanguage() {
  return state.metadataLanguage === "dynamic" ? "" : state.metadataLanguage;
}

function resolveEntryLanguage(item) {
  if (state.metadataLanguage !== "dynamic") {
    return state.metadataLanguage;
  }
  return normalizeLanguageTag(item.original_language || "");
}

function buildLanguageQuery(language) {
  return language ? `&language=${encodeURIComponent(language)}` : "";
}

function normalizeLanguageTag(language) {
  const value = String(language || "").trim().toLowerCase();
  return (
    {
      zh: "zh-CN",
      en: "en-US",
      ja: "ja-JP",
      ko: "ko-KR",
      fr: "fr-FR",
      de: "de-DE",
      es: "es-ES",
      pt: "pt-PT",
      it: "it-IT",
    }[value] || value
  );
}

function formatCountries(entry) {
  if (!Array.isArray(entry.countryCodes) || !entry.countryCodes.length) {
    return entry.country || "未知";
  }

  try {
    const display = new Intl.DisplayNames([entry.metadataLanguage || "zh-CN"], { type: "region" });
    const names = entry.countryCodes.map((code) => display.of(code)).filter(Boolean);
    return names.length ? names.join(" / ") : entry.country || "未知";
  } catch {
    return entry.country || "未知";
  }
}

function updateLanguageHelp() {
  els.languageHelp.textContent =
    state.metadataLanguage === "dynamic"
      ? "动态模式会在加入片单时按每个条目的原生语言拉取元数据。"
      : `新加入的条目会使用 ${resolveLanguageLabel(state.metadataLanguage)} 拉取元数据。`;
}

function resolveLanguageLabel(language) {
  return (
    {
      "zh-CN": "中文",
      "en-US": "English",
      "ja-JP": "日本語",
      "ko-KR": "한국어",
      "fr-FR": "Français",
      "de-DE": "Deutsch",
      "es-ES": "Español",
      dynamic: "动态（原生语言）",
    }[language] || language
  );
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
