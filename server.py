import json
import os
import sqlite3
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, parse, request


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "app.db"
TMDB_BASE = "https://api.themoviedb.org/3"


def connect_db():
    DATA_DIR.mkdir(exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with connect_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                media_type TEXT NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            """
        )


def load_entries():
    with connect_db() as connection:
        rows = connection.execute(
            "SELECT payload FROM entries ORDER BY created_at DESC"
        ).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def get_entry(entry_id):
    with connect_db() as connection:
        row = connection.execute(
            "SELECT payload FROM entries WHERE id = ?", (entry_id,)
        ).fetchone()
    return json.loads(row["payload"]) if row else None


def save_entry(entry):
    entry["status"] = compute_status(entry)
    with connect_db() as connection:
        connection.execute(
            """
            INSERT INTO entries (id, media_type, title, status, created_at, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                media_type = excluded.media_type,
                title = excluded.title,
                status = excluded.status,
                payload = excluded.payload
            """,
            (
                entry["id"],
                entry["mediaType"],
                entry["title"],
                entry["status"],
                entry["createdAt"],
                json.dumps(entry, ensure_ascii=False),
            ),
        )
        connection.commit()
    return entry


def delete_entry(entry_id):
    with connect_db() as connection:
        connection.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
        connection.commit()


def get_tmdb_token():
    return os.environ.get("TMDB_TOKEN", "").strip()


def replace_entries(entries):
    with connect_db() as connection:
        connection.execute("DELETE FROM entries")
        for entry in entries:
            entry["status"] = compute_status(entry)
            connection.execute(
                """
                INSERT INTO entries (id, media_type, title, status, created_at, payload)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    entry["id"],
                    entry["mediaType"],
                    entry["title"],
                    entry["status"],
                    entry["createdAt"],
                    json.dumps(entry, ensure_ascii=False),
                ),
            )
        connection.commit()


def export_snapshot():
    return {
        "schemaVersion": 1,
        "entries": load_entries(),
    }


def import_snapshot(payload):
    if not isinstance(payload, dict):
        raise ValueError("导入文件格式无效。")

    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise ValueError("导入文件缺少必要字段。")

    normalized_entries = [normalize_entry(entry) for entry in entries]
    replace_entries(normalized_entries)


def normalize_entry(entry):
    if not isinstance(entry, dict):
        raise ValueError("片单条目格式无效。")

    media_type = entry.get("mediaType")
    if media_type not in {"movie", "tv"}:
        raise ValueError("片单条目 mediaType 无效。")

    normalized = {
        "id": str(entry.get("id") or uuid.uuid4()),
        "tmdbId": entry.get("tmdbId"),
        "mediaType": media_type,
        "title": str(entry.get("title") or "").strip(),
        "overview": str(entry.get("overview") or "暂无简介"),
        "posterPath": str(entry.get("posterPath") or ""),
        "country": str(entry.get("country") or "未知"),
        "countryCodes": [str(code) for code in entry.get("countryCodes", []) if code],
        "releaseYear": str(entry.get("releaseYear") or "未知"),
        "runtimeMinutes": int(entry.get("runtimeMinutes") or 0),
        "genres": [str(item) for item in entry.get("genres", []) if item],
        "metadataLanguage": str(entry.get("metadataLanguage") or "default"),
        "createdAt": str(entry.get("createdAt") or iso_now()),
    }

    if not normalized["title"]:
        raise ValueError("片单条目缺少标题。")

    if media_type == "movie":
        progress = entry.get("progress", {})
        normalized["progress"] = {
            "status": progress.get("status", "planned"),
            "percent": int(progress.get("percent", 0)),
        }
    else:
        normalized["progress"] = {"status": "planned"}
        normalized["seasons"] = normalize_seasons(entry.get("seasons", []))

    normalized["status"] = compute_status(normalized)
    return normalized


def normalize_seasons(seasons):
    if not isinstance(seasons, list):
        raise ValueError("剧集 seasons 格式无效。")

    normalized = []
    for season in seasons:
        if not isinstance(season, dict):
            raise ValueError("season 格式无效。")
        episodes = season.get("episodes", [])
        if not isinstance(episodes, list):
            raise ValueError("episode 列表格式无效。")
        normalized_episodes = []
        for episode in episodes:
            if not isinstance(episode, dict):
                raise ValueError("episode 格式无效。")
            normalized_episodes.append(
                {
                    "episodeNumber": int(episode.get("episodeNumber") or 0),
                    "name": str(episode.get("name") or ""),
                    "runtime": int(episode.get("runtime") or 0),
                    "airDate": str(episode.get("airDate") or ""),
                    "watched": bool(episode.get("watched")),
                }
            )
        normalized.append(
            {
                "seasonNumber": int(season.get("seasonNumber") or 0),
                "name": str(season.get("name") or ""),
                "episodeCount": int(season.get("episodeCount") or len(normalized_episodes)),
                "episodes": normalized_episodes,
            }
        )
    return normalized


def tmdb_request(path, params=None, language="zh-CN"):
    token = get_tmdb_token()
    if not token:
        raise ValueError("请先设置 TMDB_TOKEN 环境变量。")

    query = params or {}
    if language:
        query["language"] = language
    url = f"{TMDB_BASE}{path}?{parse.urlencode(query)}"
    req = request.Request(
        url,
        headers={
            "accept": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )

    try:
        with request.urlopen(req, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        if exc.code == 401:
            raise ValueError("TMDB Token 无效或已过期。") from exc
        raise ValueError("TMDB 请求失败。") from exc
    except error.URLError as exc:
        raise ValueError("无法连接 TMDB，请检查网络。") from exc


def enrich_search_results_with_original_language(results, fallback_media_type=""):
    enriched = []
    for item in results:
        media_type = item.get("media_type") or fallback_media_type
        if media_type not in {"movie", "tv"}:
          continue

        original_language = normalize_tmdb_language(item.get("original_language"))
        if not original_language:
            enriched.append(item)
            continue

        try:
            detail = tmdb_request(f"/{media_type}/{item['id']}", language=original_language)
        except ValueError:
            enriched.append(item)
            continue

        enriched_item = dict(item)
        if media_type == "movie":
            enriched_item["title"] = detail.get("title") or item.get("title") or item.get("original_title")
            enriched_item["overview"] = detail.get("overview") or item.get("overview") or ""
        else:
            enriched_item["name"] = detail.get("name") or item.get("name") or item.get("original_name")
            enriched_item["overview"] = detail.get("overview") or item.get("overview") or ""
        enriched.append(enriched_item)

    return enriched


def normalize_tmdb_language(language):
    value = str(language or "").strip().lower()
    return {
        "zh": "zh-CN",
        "en": "en-US",
        "ja": "ja-JP",
        "ko": "ko-KR",
        "fr": "fr-FR",
        "de": "de-DE",
        "es": "es-ES",
        "pt": "pt-PT",
        "it": "it-IT",
    }.get(value, value)


def find_exact_match(title):
    payload = tmdb_request("/search/multi", {"query": title}, language=None)
    for item in payload.get("results", []):
        media_type = item.get("media_type")
        if media_type not in {"movie", "tv"}:
            continue

        candidates = {
            str(item.get("title") or ""),
            str(item.get("original_title") or ""),
            str(item.get("name") or ""),
            str(item.get("original_name") or ""),
        }
        if title in candidates:
            return item
    return None


def find_fuzzy_match(title):
    payload = tmdb_request("/search/multi", {"query": title}, language=None)
    for item in payload.get("results", []):
        if item.get("media_type") in {"movie", "tv"}:
            return item
    return None


def build_movie_entry(tmdb_id, language):
    detail = tmdb_request(f"/movie/{tmdb_id}", language=language)
    return {
        "id": str(uuid.uuid4()),
        "tmdbId": detail["id"],
        "mediaType": "movie",
        "title": detail.get("title", ""),
        "overview": detail.get("overview") or "暂无简介",
        "posterPath": detail.get("poster_path") or "",
        "country": format_movie_countries(detail.get("production_countries", [])),
        "countryCodes": [
            item.get("iso_3166_1")
            for item in detail.get("production_countries", [])
            if item.get("iso_3166_1")
        ],
        "releaseYear": extract_year(detail.get("release_date")),
        "runtimeMinutes": detail.get("runtime") or 0,
        "genres": [genre["name"] for genre in detail.get("genres", [])],
        "metadataLanguage": language or "default",
        "progress": {
            "status": "planned",
            "percent": 0,
        },
        "status": "planned",
        "createdAt": iso_now(),
    }


def build_tv_entry(tmdb_id, language):
    detail = tmdb_request(f"/tv/{tmdb_id}", language=language)
    seasons = []
    episode_runtime = (detail.get("episode_run_time") or [0])[0] or 0

    for season_meta in detail.get("seasons", []):
        season_number = season_meta.get("season_number", 0)
        if season_number <= 0:
            continue
        season_detail = tmdb_request(
            f"/tv/{tmdb_id}/season/{season_number}", language=language
        )
        episodes = []
        for episode in season_detail.get("episodes", []):
            episodes.append(
                {
                    "episodeNumber": episode.get("episode_number", 0),
                    "name": episode.get("name") or f"第 {episode.get('episode_number', 0)} 集",
                    "runtime": episode.get("runtime") or episode_runtime,
                    "airDate": episode.get("air_date") or "",
                    "watched": False,
                }
            )
        seasons.append(
            {
                "seasonNumber": season_number,
                "name": season_detail.get("name") or f"第 {season_number} 季",
                "episodeCount": len(episodes),
                "episodes": episodes,
            }
        )

    return {
        "id": str(uuid.uuid4()),
        "tmdbId": detail["id"],
        "mediaType": "tv",
        "title": detail.get("name", ""),
        "overview": detail.get("overview") or "暂无简介",
        "posterPath": detail.get("poster_path") or "",
        "country": format_region_codes(detail.get("origin_country", [])),
        "countryCodes": [code for code in detail.get("origin_country", []) if code],
        "releaseYear": extract_year(detail.get("first_air_date")),
        "runtimeMinutes": episode_runtime,
        "genres": [genre["name"] for genre in detail.get("genres", [])],
        "metadataLanguage": language or "default",
        "progress": {"status": "planned"},
        "status": "planned",
        "seasons": seasons,
        "createdAt": iso_now(),
    }


def extract_year(value):
    return value[:4] if value else "未知"


def iso_now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def format_movie_countries(countries):
    names = [item.get("name") for item in countries if item.get("name")]
    return " / ".join(names) if names else "未知"


def format_region_codes(codes):
    mapping = {
        "CN": "中国",
        "US": "美国",
        "KR": "韩国",
        "JP": "日本",
        "GB": "英国",
        "FR": "法国",
        "DE": "德国",
        "HK": "中国香港",
        "TW": "中国台湾",
    }
    names = [mapping.get(code, code) for code in codes if code]
    return " / ".join(names) if names else "未知"


def compute_status(entry):
    if entry["mediaType"] == "movie":
        return entry.get("progress", {}).get("status", "planned")

    seasons = entry.get("seasons", [])
    total = sum(season.get("episodeCount", 0) for season in seasons)
    watched = sum(
        1
        for season in seasons
        for episode in season.get("episodes", [])
        if episode.get("watched")
    )
    if watched == 0:
        return "planned"
    if total and watched == total:
        return "completed"
    return "in_progress"


def update_entry(entry, patch):
    kind = patch.get("kind")

    if kind == "movie_progress":
        entry["progress"] = {
            "status": patch.get("status", "planned"),
            "percent": int(patch.get("percent", 0)),
        }
    elif kind == "toggle_episode":
        season_number = int(patch["seasonNumber"])
        episode_number = int(patch["episodeNumber"])
        watched = bool(patch["watched"])
        for season in entry.get("seasons", []):
            if season["seasonNumber"] != season_number:
                continue
            for episode in season.get("episodes", []):
                if episode["episodeNumber"] == episode_number:
                    episode["watched"] = watched
                    break
    elif kind == "toggle_season":
        season_number = int(patch["seasonNumber"])
        watched = bool(patch["watched"])
        for season in entry.get("seasons", []):
            if season["seasonNumber"] == season_number:
                for episode in season.get("episodes", []):
                    episode["watched"] = watched
                break
    elif kind == "toggle_all":
        watched = bool(patch["watched"])
        for season in entry.get("seasons", []):
            for episode in season.get("episodes", []):
                episode["watched"] = watched
    else:
        raise ValueError("不支持的更新类型。")

    entry["status"] = compute_status(entry)
    return entry


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.handle_api_get()
            return
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self.handle_api_post()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PATCH(self):
        if self.path.startswith("/api/"):
            self.handle_api_patch()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            self.handle_api_delete()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_api_get(self):
        parsed = parse.urlparse(self.path)

        if parsed.path == "/api/settings":
            return self.send_json(
                {
                    "hasToken": bool(get_tmdb_token()),
                    "tokenSource": "environment" if get_tmdb_token() else "missing",
                }
            )

        if parsed.path == "/api/entries":
            return self.send_json(load_entries())

        if parsed.path == "/api/export":
            return self.send_json(export_snapshot())

        if parsed.path == "/api/search":
            params = parse.parse_qs(parsed.query)
            media_type = (params.get("mediaType") or ["all"])[0]
            query = (params.get("query") or [""])[0].strip()
            language = (params.get("language") or [""])[0].strip()
            if media_type not in {"all", "movie", "tv"} or not query:
                return self.send_json({"error": "搜索参数无效。"}, status=HTTPStatus.BAD_REQUEST)
            search_path = "/search/multi" if media_type == "all" else f"/search/{media_type}"
            payload = tmdb_request(search_path, {"query": query}, language=language or None)
            results = payload.get("results", [])
            if media_type == "all":
                results = [item for item in results if item.get("media_type") in {"movie", "tv"}]
            if not language:
                results = enrich_search_results_with_original_language(results, media_type)
            return self.send_json(results)

        return self.send_json({"error": "未找到接口。"}, status=HTTPStatus.NOT_FOUND)

    def handle_api_post(self):
        if self.path == "/api/bulk-import-item":
            payload = self.read_json()
            title = str(payload.get("title") or "").strip()
            mode = str(payload.get("mode") or "exact").strip()
            if not title:
                return self.send_json({"error": "标题不能为空。"}, status=HTTPStatus.BAD_REQUEST)
            if mode not in {"exact", "fuzzy"}:
                return self.send_json({"error": "匹配模式无效。"}, status=HTTPStatus.BAD_REQUEST)

            item = find_exact_match(title) if mode == "exact" else find_fuzzy_match(title)
            if not item:
                return self.send_json({"status": "not_found", "title": title})

            media_type = item.get("media_type")
            tmdb_id = item.get("id")
            existing = next(
                (
                    entry
                    for entry in load_entries()
                    if entry["mediaType"] == media_type and entry["tmdbId"] == tmdb_id
                ),
                None,
            )
            if existing:
                return self.send_json(
                    {
                        "status": "already_exists",
                        "title": title,
                        "mediaType": media_type,
                        "matchedTitle": existing["title"],
                    }
                )

            language = normalize_tmdb_language(item.get("original_language"))
            entry = (
                build_movie_entry(tmdb_id, language)
                if media_type == "movie"
                else build_tv_entry(tmdb_id, language)
            )
            save_entry(entry)
            return self.send_json(
                {
                    "status": "imported",
                    "title": title,
                    "mediaType": media_type,
                    "matchedTitle": entry["title"],
                },
                status=HTTPStatus.CREATED,
            )

        if self.path == "/api/import":
            try:
                import_snapshot(self.read_json())
            except ValueError as exc:
                return self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return self.send_json({"ok": True})

        if self.path != "/api/entries":
            return self.send_json({"error": "未找到接口。"}, status=HTTPStatus.NOT_FOUND)

        payload = self.read_json()
        media_type = payload.get("mediaType")
        tmdb_id = payload.get("tmdbId")
        language = str(payload.get("language") or "").strip() or None
        if media_type not in {"movie", "tv"} or not tmdb_id:
            return self.send_json({"error": "新增参数无效。"}, status=HTTPStatus.BAD_REQUEST)

        existing = next(
            (
                entry
                for entry in load_entries()
                if entry["mediaType"] == media_type and entry["tmdbId"] == tmdb_id
            ),
            None,
        )
        if existing:
            return self.send_json({"error": "这个条目已经在片单里。"}, status=HTTPStatus.CONFLICT)

        entry = (
            build_movie_entry(tmdb_id, language)
            if media_type == "movie"
            else build_tv_entry(tmdb_id, language)
        )
        return self.send_json(save_entry(entry), status=HTTPStatus.CREATED)

    def handle_api_patch(self):
        entry_id = self.path.removeprefix("/api/entries/")
        if not entry_id:
            return self.send_json({"error": "未找到条目。"}, status=HTTPStatus.NOT_FOUND)

        entry = get_entry(entry_id)
        if not entry:
            return self.send_json({"error": "未找到条目。"}, status=HTTPStatus.NOT_FOUND)

        try:
            updated = update_entry(entry, self.read_json())
        except ValueError as exc:
            return self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
        return self.send_json(save_entry(updated))

    def handle_api_delete(self):
        entry_id = self.path.removeprefix("/api/entries/")
        if not entry_id:
            return self.send_json({"error": "未找到条目。"}, status=HTTPStatus.NOT_FOUND)

        delete_entry(entry_id)
        return self.send_json({"ok": True})

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def send_json(self, payload, status=HTTPStatus.OK):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format, *args):
        return


def main():
    init_db()
    port = int(os.environ.get("PORT", "8010"))
    server = ThreadingHTTPServer(("127.0.0.1", port), AppHandler)
    print(f"Serving on http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
