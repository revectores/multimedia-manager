# 观影进展面板

一个带 Python 后端和 SQLite 存储的 Web App，用于记录电影和电视剧的观影进展。

## 功能

- 搜索并添加电影、电视剧
- 通过 TMDB 自动获取国家、上映年份、时长、季/集等元信息
- 电影支持想看 / 进行中 / 已完成，以及百分比进度
- 电视剧支持按季、按集勾选观看进度
- 数据保存在后端 SQLite 数据库
- 前端通过本地 API 读写片单和进度
- 支持将片单导出为 JSON，并从 JSON 恢复
- 前端可配置元数据默认语言，或选择按条目原生语言动态拉取
- 支持在独立页面按“每行一个标题”批量导入，并展示匹配进度与失败数量

## 使用

1. 在仓库目录运行后端服务。
2. 打开浏览器访问 `http://127.0.0.1:8010`。
3. 通过环境变量 `TMDB_TOKEN` 提供 TMDB `Read Access Token (v4 auth)`。
4. 可在右上角选择元数据默认语言，或切换到“动态（原生语言）”。
5. 搜索电影或电视剧并加入片单。
6. 可以在右上角使用“导出 JSON / 导入 JSON”做备份和恢复。
7. 可从主页面进入批量导入页面，按标题逐行严格匹配后批量加入片单。

## 本地启动

```bash
TMDB_TOKEN=your_token_here python3 server.py
```

数据库文件会自动创建在 `data/app.db`。
默认监听 `127.0.0.1:8010`，如果需要其他端口可以用 `PORT=9000 python3 server.py`。

## TMDB Token

在 [TMDB API 设置页面](https://www.themoviedb.org/settings/api) 申请并复制 `Read Access Token`。
