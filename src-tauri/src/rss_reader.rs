use chrono::{DateTime, Utc};
use feed_rs::model::{Entry, Feed, Link, Text};
use feed_rs::parser;
use regex::Regex;
use reqwest::blocking::Client;
use reqwest::Url;
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Manager;

const USER_AGENT: &str = "McStartUP RSS Reader/1.0 (+https://mcheng.tools)";
const DEFAULT_RSS_REFRESH_MINUTES: i64 = 15;
const RSS_BACKGROUND_POLL_SECONDS: u64 = 60;
const RSS_BACKGROUND_STARTUP_DELAY_SECONDS: u64 = 20;
const RSS_BACKGROUND_MAX_FEEDS_PER_TICK: usize = 3;

static RSS_BACKGROUND_WORKER_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderFetchRequest {
    url: String,
    #[serde(default)]
    etag: String,
    #[serde(default)]
    last_modified: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderWebCrawlRule {
    list_selector: String,
    title_selector: String,
    link_selector: String,
    #[serde(default = "default_link_attribute")]
    link_attribute: String,
    #[serde(default)]
    summary_selector: String,
    #[serde(default)]
    date_selector: String,
    #[serde(default)]
    author_selector: String,
    #[serde(default)]
    detail_enabled: bool,
    #[serde(default)]
    detail_content_selector: String,
    #[serde(default)]
    exclude_selectors: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderWebFetchRequest {
    url: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    site_url: String,
    rule: RssReaderWebCrawlRule,
    #[serde(default)]
    preview_limit: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderFeedInfo {
    title: String,
    description: String,
    site_url: Option<String>,
    feed_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderItem {
    stable_id: String,
    title: String,
    link: Option<String>,
    author: Option<String>,
    summary: String,
    content: String,
    summary_html: String,
    content_html: String,
    published_at: Option<String>,
    updated_at: Option<String>,
    guid: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderFetchResult {
    feed: RssReaderFeedInfo,
    items: Vec<RssReaderItem>,
    fetched_at: String,
    not_modified: bool,
    etag: Option<String>,
    last_modified: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderStoredArticle {
    #[serde(default)]
    id: String,
    #[serde(default)]
    feed_id: String,
    #[serde(default)]
    stable_id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    link: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    summary_html: String,
    #[serde(default)]
    content_html: String,
    #[serde(default)]
    published_at: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    fetched_at: String,
    #[serde(default)]
    guid: String,
    #[serde(default)]
    translated_title: String,
    #[serde(default)]
    translated_summary: String,
    #[serde(default)]
    translated_html: String,
    #[serde(default)]
    translated_content: String,
    #[serde(default)]
    translated_at: String,
    #[serde(default)]
    translated_provider: String,
    #[serde(default)]
    translation_error: String,
    #[serde(default)]
    read: bool,
    #[serde(default)]
    starred: bool,
    #[serde(default)]
    later: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderArticlePageRequest {
    #[serde(default = "default_article_page_limit")]
    limit: usize,
    #[serde(default)]
    offset: usize,
    #[serde(default)]
    search: String,
    #[serde(default)]
    feed_ids: Vec<String>,
    #[serde(default)]
    view: String,
    #[serde(default)]
    keyword: Option<RssReaderArticleKeywordRequest>,
    #[serde(default)]
    keywords: Vec<RssReaderArticleKeywordRequest>,
    #[serde(default)]
    feed_sources: Vec<RssReaderArticleFeedSource>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderArticleKeywordRequest {
    #[serde(default)]
    id: String,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    scopes: Vec<String>,
    #[serde(default)]
    match_mode: String,
    #[serde(default)]
    _case_sensitive: bool,
    #[serde(default = "default_true")]
    enabled: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderArticleFeedSource {
    feed_id: String,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderArticleCounter {
    total: usize,
    unread: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderArticlePageResponse {
    items: Vec<RssReaderStoredArticle>,
    total: usize,
    unread: usize,
    starred: usize,
    later: usize,
    all_total: usize,
    all_unread: usize,
    by_feed: HashMap<String, RssReaderArticleCounter>,
    by_keyword: HashMap<String, RssReaderArticleCounter>,
}

struct RssArticleSqlFilter {
    where_sql: String,
    params: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderArticleDetailRequest {
    feed_id: String,
    stable_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderUpsertArticlesRequest {
    feed_id: String,
    articles: Vec<RssReaderStoredArticle>,
    #[serde(default)]
    replace_feed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderArticleStatePatch {
    feed_id: String,
    stable_id: String,
    read: bool,
    starred: bool,
    later: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderUpdateArticleStatesRequest {
    states: Vec<RssReaderArticleStatePatch>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderArticleKey {
    feed_id: String,
    stable_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderDeleteArticlesRequest {
    items: Vec<RssReaderArticleKey>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderDeleteFeedArticlesRequest {
    feed_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderArticleContentPatch {
    feed_id: String,
    stable_id: String,
    #[serde(default)]
    translated_title: String,
    #[serde(default)]
    translated_summary: String,
    #[serde(default)]
    translated_html: String,
    #[serde(default)]
    translated_content: String,
    #[serde(default)]
    translated_at: String,
    #[serde(default)]
    translated_provider: String,
    #[serde(default)]
    translation_error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RssReaderResidentSettingsRequest {
    start_with_app: bool,
    minimize_to_tray: bool,
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct RssReaderStoreDocument {
    #[serde(default)]
    feeds: Vec<RssReaderStoreFeed>,
    #[serde(default)]
    categories: serde_json::Value,
    #[serde(default)]
    keyword_subscriptions: serde_json::Value,
    #[serde(default)]
    article_states: serde_json::Value,
    #[serde(default)]
    settings: RssReaderStoreSettings,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RssReaderStoreFeed {
    id: String,
    #[serde(default = "default_feed_source_type")]
    source_type: String,
    #[serde(default)]
    title: String,
    url: String,
    #[serde(default)]
    site_url: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    web_rule: Option<RssReaderWebCrawlRule>,
    #[serde(default)]
    category_id: String,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default = "default_refresh_minutes_i64")]
    refresh_minutes: i64,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    last_fetched_at: String,
    #[serde(default)]
    etag: String,
    #[serde(default)]
    last_modified: String,
    #[serde(default)]
    translate_enabled: bool,
    #[serde(default)]
    translate_enabled_at: String,
    #[serde(default)]
    last_error: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RssReaderStoreSettings {
    #[serde(default)]
    auto_refresh_enabled: bool,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for RssReaderStoreSettings {
    fn default() -> Self {
        Self {
            auto_refresh_enabled: false,
            extra: serde_json::Map::new(),
        }
    }
}

#[tauri::command]
pub fn rss_reader_load_store() -> Result<String, String> {
    let connection = rss_reader_connection()?;
    ensure_store_table(&connection)?;
    let value = connection
        .query_row(
            "SELECT value FROM rss_store WHERE key = 'store' LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("读取 RSS 数据库失败: {}", error))?;
    Ok(value.unwrap_or_else(|| "{}".to_string()))
}

#[tauri::command]
pub fn rss_reader_save_store(data: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&data)
        .map_err(|error| format!("RSS 数据不是合法 JSON: {}", error))?;
    let connection = rss_reader_connection()?;
    ensure_store_table(&connection)?;
    connection
        .execute(
            "INSERT INTO rss_store(key, value, updated_at)
             VALUES('store', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![data, Utc::now().to_rfc3339()],
        )
        .map_err(|error| format!("保存 RSS 数据库失败: {}", error))?;
    Ok(())
}

#[tauri::command]
pub fn rss_reader_apply_resident_settings(
    request: RssReaderResidentSettingsRequest,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    write_rss_reader_launch_flag(request.start_with_app)?;
    write_rss_reader_minimize_flag(request.minimize_to_tray)?;
    if request.start_with_app {
        crate::commands::set_auto_start(true)?;
    }
    if request.minimize_to_tray {
        crate::commands::ensure_rss_reader_tray(&app_handle)?;
    } else {
        crate::commands::destroy_rss_reader_tray(&app_handle);
    }
    if let Some(window) = app_handle.get_window("tool-rss-reader") {
        crate::commands::apply_app_window_icon(&window);
        let _ = window.set_skip_taskbar(false);
    }
    Ok(())
}

#[tauri::command]
pub fn rss_reader_ensure_tray_icon(app_handle: tauri::AppHandle) -> Result<(), String> {
    crate::commands::ensure_rss_reader_tray(&app_handle)
}

pub fn start_rss_reader_background_refresh(app_handle: tauri::AppHandle) {
    if RSS_BACKGROUND_WORKER_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(RSS_BACKGROUND_STARTUP_DELAY_SECONDS));
        loop {
            if let Err(error) = run_rss_reader_background_refresh_tick(&app_handle) {
                eprintln!("[RSS] Background refresh failed: {}", error);
            }
            std::thread::sleep(Duration::from_secs(RSS_BACKGROUND_POLL_SECONDS));
        }
    });
}

#[tauri::command]
pub fn rss_reader_load_article_page(
    request: RssReaderArticlePageRequest,
) -> Result<RssReaderArticlePageResponse, String> {
    let connection = rss_reader_connection()?;
    ensure_articles_table(&connection)?;
    let limit = request.limit.clamp(20, 200);
    let offset = request.offset;
    let enabled_keywords = request
        .keywords
        .iter()
        .filter(|keyword| keyword.enabled && !keyword.keywords.is_empty())
        .cloned()
        .collect::<Vec<_>>();
    let counter_request = RssReaderArticlePageRequest {
        limit: request.limit,
        offset: 0,
        search: String::new(),
        feed_ids: Vec::new(),
        view: String::new(),
        keyword: None,
        keywords: request.keywords.clone(),
        feed_sources: request.feed_sources.clone(),
    };
    let counter_filter = build_article_sql_filter(&counter_request, false, None);
    let page_filter = build_article_sql_filter(&request, true, request.keyword.as_ref());
    let view_filter = build_article_view_filter(&request.view);

    let all_total = query_count(
        &connection,
        &counter_filter.where_sql,
        &counter_filter.params,
    )?;
    let all_unread = query_count(
        &connection,
        &format!("{} AND read = 0", counter_filter.where_sql),
        &counter_filter.params,
    )?;
    let by_feed = query_feed_counters(
        &connection,
        &counter_filter.where_sql,
        &counter_filter.params,
    )?;
    let by_keyword = query_keyword_counters(&connection, &counter_filter, &enabled_keywords)?;

    let unread = query_count(
        &connection,
        &format!("{} AND read = 0", page_filter.where_sql),
        &page_filter.params,
    )?;
    let starred = query_count(
        &connection,
        &format!("{} AND starred = 1", page_filter.where_sql),
        &page_filter.params,
    )?;
    let later = query_count(
        &connection,
        &format!("{} AND later = 1", page_filter.where_sql),
        &page_filter.params,
    )?;
    let total_where = format!("{}{}", page_filter.where_sql, view_filter);
    let total = query_count(&connection, &total_where, &page_filter.params)?;
    let items = query_article_page(
        &connection,
        &total_where,
        &page_filter.params,
        limit,
        offset,
    )?;

    Ok(RssReaderArticlePageResponse {
        items,
        total,
        unread,
        starred,
        later,
        all_total,
        all_unread,
        by_feed,
        by_keyword,
    })
}

#[tauri::command]
pub fn rss_reader_load_article_detail(
    request: RssReaderArticleDetailRequest,
) -> Result<Option<RssReaderStoredArticle>, String> {
    let connection = rss_reader_connection()?;
    ensure_articles_table(&connection)?;
    let mut statement = connection
        .prepare(
            "SELECT id, feed_id, stable_id, title, link, author, summary, content,
                    summary_html, content_html, published_at, updated_at, fetched_at, guid,
                    translated_title, translated_summary, translated_html, translated_content,
                    translated_at, translated_provider, translation_error,
                    read, starred, later
             FROM rss_articles
             WHERE feed_id = ?1 AND stable_id = ?2
             LIMIT 1",
        )
        .map_err(|error| format!("读取 RSS 文章正文失败: {}", error))?;
    let article = statement
        .query_row(params![request.feed_id, request.stable_id], row_to_article)
        .optional()
        .map_err(|error| format!("读取 RSS 文章正文失败: {}", error))?;
    Ok(article)
}

#[tauri::command]
pub fn rss_reader_upsert_articles(
    request: RssReaderUpsertArticlesRequest,
) -> Result<usize, String> {
    let feed_id = request.feed_id.trim().to_string();
    if feed_id.is_empty() {
        return Err("RSS 文章缺少订阅源 ID".to_string());
    }
    let mut connection = rss_reader_connection()?;
    ensure_articles_table(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("写入 RSS 文章缓存失败: {}", error))?;
    let preserved_articles = if request.replace_feed {
        query_preserved_feed_articles(&transaction, &feed_id)?
    } else {
        HashMap::new()
    };
    if request.replace_feed {
        transaction
            .execute(
                "DELETE FROM rss_articles WHERE feed_id = ?1",
                params![feed_id],
            )
            .map_err(|error| format!("清理旧 RSS 文章缓存失败: {}", error))?;
    }

    let fetched_at = Utc::now().to_rfc3339();
    let mut saved = 0usize;
    for mut article in request.articles {
        if article.stable_id.trim().is_empty() {
            continue;
        }
        article.feed_id = feed_id.clone();
        if article.id.trim().is_empty() {
            article.id = format!("article-{}", uuid::Uuid::new_v4());
        }
        if article.fetched_at.trim().is_empty() {
            article.fetched_at = fetched_at.clone();
        }
        if let Some(preserved) = preserved_articles.get(&article.stable_id) {
            preserve_article_user_data(&mut article, preserved);
        }
        transaction
            .execute(
                "INSERT INTO rss_articles(
                    id, feed_id, stable_id, title, link, author, summary, content,
                    summary_html, content_html, published_at, updated_at, fetched_at, guid,
                    translated_title, translated_summary, translated_html, translated_content,
                    translated_at, translated_provider, translation_error, read, starred, later
                )
                VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)
                ON CONFLICT(feed_id, stable_id) DO UPDATE SET
                    id = rss_articles.id,
                    title = excluded.title,
                    link = excluded.link,
                    author = excluded.author,
                    summary = excluded.summary,
                    content = excluded.content,
                    summary_html = excluded.summary_html,
                    content_html = excluded.content_html,
                    published_at = excluded.published_at,
                    updated_at = excluded.updated_at,
                    fetched_at = excluded.fetched_at,
                    guid = excluded.guid,
                    translated_title = CASE
                        WHEN excluded.translated_title != '' THEN excluded.translated_title
                        ELSE rss_articles.translated_title
                    END,
                    translated_summary = CASE
                        WHEN excluded.translated_summary != '' THEN excluded.translated_summary
                        ELSE rss_articles.translated_summary
                    END,
                    translated_html = CASE
                        WHEN excluded.translated_html != '' THEN excluded.translated_html
                        ELSE rss_articles.translated_html
                    END,
                    translated_content = CASE
                        WHEN excluded.translated_content != '' THEN excluded.translated_content
                        ELSE rss_articles.translated_content
                    END,
                    translated_at = CASE
                        WHEN excluded.translated_at != '' THEN excluded.translated_at
                        ELSE rss_articles.translated_at
                    END,
                    translated_provider = CASE
                        WHEN excluded.translated_provider != '' THEN excluded.translated_provider
                        ELSE rss_articles.translated_provider
                    END,
                    translation_error = CASE
                        WHEN excluded.translation_error != '' THEN excluded.translation_error
                        ELSE rss_articles.translation_error
                    END,
                    read = CASE WHEN rss_articles.read = 1 OR excluded.read = 1 THEN 1 ELSE 0 END,
                    starred = CASE WHEN rss_articles.starred = 1 OR excluded.starred = 1 THEN 1 ELSE 0 END,
                    later = CASE WHEN rss_articles.later = 1 OR excluded.later = 1 THEN 1 ELSE 0 END",
                params![
                    article.id,
                    article.feed_id,
                    article.stable_id,
                    article.title,
                    article.link,
                    article.author,
                    article.summary,
                    article.content,
                    article.summary_html,
                    article.content_html,
                    article.published_at,
                    article.updated_at,
                    article.fetched_at,
                    article.guid,
                    article.translated_title,
                    article.translated_summary,
                    article.translated_html,
                    article.translated_content,
                    article.translated_at,
                    article.translated_provider,
                    article.translation_error,
                    bool_to_i64(article.read),
                    bool_to_i64(article.starred),
                    bool_to_i64(article.later),
                ],
            )
            .map_err(|error| format!("写入 RSS 文章缓存失败: {}", error))?;
        saved += 1;
    }

    transaction
        .commit()
        .map_err(|error| format!("提交 RSS 文章缓存失败: {}", error))?;
    Ok(saved)
}

fn query_preserved_feed_articles(
    transaction: &rusqlite::Transaction<'_>,
    feed_id: &str,
) -> Result<HashMap<String, RssReaderStoredArticle>, String> {
    let mut statement = transaction
        .prepare(
            "SELECT id, feed_id, stable_id, title, link, author, summary, content,
                    summary_html, content_html, published_at, updated_at, fetched_at, guid,
                    translated_title, translated_summary, translated_html, translated_content,
                    translated_at, translated_provider, translation_error,
                    read, starred, later
             FROM rss_articles
             WHERE feed_id = ?1",
        )
        .map_err(|error| format!("读取 RSS 已保存译文失败: {}", error))?;
    let rows = statement
        .query_map(params![feed_id], row_to_article)
        .map_err(|error| format!("读取 RSS 已保存译文失败: {}", error))?;
    let mut articles = HashMap::new();
    for row in rows {
        let article = row.map_err(|error| format!("读取 RSS 已保存译文失败: {}", error))?;
        if !article.stable_id.trim().is_empty() {
            articles.insert(article.stable_id.clone(), article);
        }
    }
    Ok(articles)
}

fn preserve_article_user_data(
    article: &mut RssReaderStoredArticle,
    preserved: &RssReaderStoredArticle,
) {
    if !preserved.id.trim().is_empty() {
        article.id = preserved.id.clone();
    }
    if article.translated_title.trim().is_empty() {
        article.translated_title = preserved.translated_title.clone();
    }
    if article.translated_summary.trim().is_empty() {
        article.translated_summary = preserved.translated_summary.clone();
    }
    if article.translated_html.trim().is_empty() {
        article.translated_html = preserved.translated_html.clone();
    }
    if article.translated_content.trim().is_empty() {
        article.translated_content = preserved.translated_content.clone();
    }
    if article.translated_at.trim().is_empty() {
        article.translated_at = preserved.translated_at.clone();
    }
    if article.translated_provider.trim().is_empty() {
        article.translated_provider = preserved.translated_provider.clone();
    }
    if article.translation_error.trim().is_empty() {
        article.translation_error = preserved.translation_error.clone();
    }
    article.read = article.read || preserved.read;
    article.starred = article.starred || preserved.starred;
    article.later = article.later || preserved.later;
}

#[tauri::command]
pub fn rss_reader_update_article_states(
    request: RssReaderUpdateArticleStatesRequest,
) -> Result<(), String> {
    let mut connection = rss_reader_connection()?;
    ensure_articles_table(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("保存 RSS 阅读状态失败: {}", error))?;
    for state in request.states {
        if state.feed_id.trim().is_empty() || state.stable_id.trim().is_empty() {
            continue;
        }
        transaction
            .execute(
                "UPDATE rss_articles
                 SET read = ?1, starred = ?2, later = ?3
                 WHERE feed_id = ?4 AND stable_id = ?5",
                params![
                    bool_to_i64(state.read),
                    bool_to_i64(state.starred),
                    bool_to_i64(state.later),
                    state.feed_id,
                    state.stable_id,
                ],
            )
            .map_err(|error| format!("保存 RSS 阅读状态失败: {}", error))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("提交 RSS 阅读状态失败: {}", error))?;
    Ok(())
}

#[tauri::command]
pub fn rss_reader_update_article_translation(
    request: RssReaderArticleContentPatch,
) -> Result<(), String> {
    if request.feed_id.trim().is_empty() || request.stable_id.trim().is_empty() {
        return Err("RSS 文章缺少订阅源或文章 ID".to_string());
    }
    let connection = rss_reader_connection()?;
    ensure_articles_table(&connection)?;
    let changed = connection
        .execute(
            "UPDATE rss_articles
             SET translated_title = ?1,
                 translated_summary = ?2,
                 translated_html = ?3,
                 translated_content = ?4,
                 translated_at = ?5,
                 translated_provider = ?6,
                 translation_error = ?7
             WHERE feed_id = ?8 AND stable_id = ?9",
            params![
                request.translated_title,
                request.translated_summary,
                request.translated_html,
                request.translated_content,
                request.translated_at,
                request.translated_provider,
                request.translation_error,
                request.feed_id,
                request.stable_id,
            ],
        )
        .map_err(|error| format!("保存 RSS 译文失败: {}", error))?;
    if changed == 0 {
        return Err("保存 RSS 译文失败: 未找到对应文章，请先刷新订阅内容。".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn rss_reader_delete_articles(request: RssReaderDeleteArticlesRequest) -> Result<(), String> {
    let mut connection = rss_reader_connection()?;
    ensure_articles_table(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("删除 RSS 文章缓存失败: {}", error))?;
    for item in request.items {
        if item.feed_id.trim().is_empty() || item.stable_id.trim().is_empty() {
            continue;
        }
        transaction
            .execute(
                "DELETE FROM rss_articles WHERE feed_id = ?1 AND stable_id = ?2",
                params![item.feed_id, item.stable_id],
            )
            .map_err(|error| format!("删除 RSS 文章缓存失败: {}", error))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("提交 RSS 文章缓存删除失败: {}", error))?;
    Ok(())
}

#[tauri::command]
pub fn rss_reader_delete_feed_articles(
    request: RssReaderDeleteFeedArticlesRequest,
) -> Result<(), String> {
    let connection = rss_reader_connection()?;
    ensure_articles_table(&connection)?;
    connection
        .execute(
            "DELETE FROM rss_articles WHERE feed_id = ?1",
            params![request.feed_id],
        )
        .map_err(|error| format!("删除订阅源文章缓存失败: {}", error))?;
    Ok(())
}

#[tauri::command]
pub fn rss_reader_fetch_feed(
    request: RssReaderFetchRequest,
) -> Result<RssReaderFetchResult, String> {
    let feed_url = normalize_url(&request.url)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("初始化 RSS 请求客户端失败: {}", error))?;

    let mut request_builder = client
        .get(&feed_url)
        .header(
            reqwest::header::ACCEPT,
            "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*;q=0.8",
        );
    if !request.etag.trim().is_empty() {
        request_builder = request_builder.header(reqwest::header::IF_NONE_MATCH, request.etag);
    }
    if !request.last_modified.trim().is_empty() {
        request_builder =
            request_builder.header(reqwest::header::IF_MODIFIED_SINCE, request.last_modified);
    }

    let response = request_builder
        .send()
        .map_err(|error| format!("请求订阅源失败: {}", error))?;

    let status = response.status();
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let last_modified = response
        .headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    if status == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(RssReaderFetchResult {
            feed: RssReaderFeedInfo {
                title: String::new(),
                description: String::new(),
                site_url: None,
                feed_url,
            },
            items: Vec::new(),
            fetched_at: Utc::now().to_rfc3339(),
            not_modified: true,
            etag,
            last_modified,
        });
    }
    if !status.is_success() {
        return Err(format!("订阅源返回异常状态: {}", status));
    }

    let bytes = response
        .bytes()
        .map_err(|error| format!("读取订阅源内容失败: {}", error))?;
    let feed =
        parser::parse(bytes.as_ref()).map_err(|error| format!("解析订阅源失败: {}", error))?;

    Ok(RssReaderFetchResult {
        feed: build_feed_info(&feed, &feed_url),
        items: feed.entries.iter().map(build_item).collect(),
        fetched_at: Utc::now().to_rfc3339(),
        not_modified: false,
        etag,
        last_modified,
    })
}

fn run_rss_reader_background_refresh_tick(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let store_text = rss_reader_load_store()?;
    let trimmed = store_text.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return Ok(());
    }
    let mut store: RssReaderStoreDocument =
        serde_json::from_str(trimmed).map_err(|error| format!("解析 RSS 配置失败: {}", error))?;
    if !store.settings.auto_refresh_enabled {
        return Ok(());
    }

    let now = Utc::now();
    let due_indices = store
        .feeds
        .iter()
        .enumerate()
        .filter(|(_, feed)| feed.enabled && is_background_feed_due(feed, now))
        .take(RSS_BACKGROUND_MAX_FEEDS_PER_TICK)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if due_indices.is_empty() {
        return Ok(());
    }

    let mut changed = false;
    let mut updated_feed_ids = Vec::new();
    for index in due_indices {
        let Some(feed) = store.feeds.get(index).cloned() else {
            continue;
        };
        let result = match fetch_store_feed(&feed) {
            Ok(result) => result,
            Err(error) => {
                if let Some(current) = store.feeds.get_mut(index) {
                    current.last_error = error;
                    current.updated_at = now.to_rfc3339();
                }
                changed = true;
                continue;
            }
        };

        let articles = if result.not_modified {
            Vec::new()
        } else {
            result
                .items
                .iter()
                .map(|item| rss_item_to_stored_article(&feed.id, item, &result.fetched_at))
                .collect::<Vec<_>>()
        };
        if !articles.is_empty() {
            rss_reader_upsert_articles(RssReaderUpsertArticlesRequest {
                feed_id: feed.id.clone(),
                articles,
                replace_feed: false,
            })?;
        }

        if let Some(current) = store.feeds.get_mut(index) {
            if !result.not_modified {
                current.title = if result.feed.title.trim().is_empty() {
                    current.title.clone()
                } else {
                    result.feed.title
                };
                current.url = if result.feed.feed_url.trim().is_empty() {
                    current.url.clone()
                } else {
                    result.feed.feed_url
                };
                current.site_url = result
                    .feed
                    .site_url
                    .unwrap_or_else(|| current.site_url.clone());
                current.description = if result.feed.description.trim().is_empty() {
                    current.description.clone()
                } else {
                    result.feed.description
                };
            }
            current.last_fetched_at = result.fetched_at;
            if let Some(etag) = result.etag {
                current.etag = etag;
            }
            if let Some(last_modified) = result.last_modified {
                current.last_modified = last_modified;
            }
            current.last_error.clear();
            current.updated_at = Utc::now().to_rfc3339();
        }
        updated_feed_ids.push(feed.id);
        changed = true;
    }

    if changed {
        save_rss_store_document(&store)?;
        if let Some(window) = app_handle.get_window("tool-rss-reader") {
            let _ = window.emit("rss-reader-background-updated", updated_feed_ids);
        }
    }
    Ok(())
}

fn fetch_store_feed(feed: &RssReaderStoreFeed) -> Result<RssReaderFetchResult, String> {
    if feed.source_type == "web" {
        let rule = feed
            .web_rule
            .clone()
            .ok_or_else(|| "网页订阅缺少抓取规则".to_string())?;
        fetch_web_feed(RssReaderWebFetchRequest {
            url: feed.url.clone(),
            title: feed.title.clone(),
            description: feed.description.clone(),
            site_url: feed.site_url.clone(),
            rule,
            preview_limit: 0,
        })
    } else {
        rss_reader_fetch_feed(RssReaderFetchRequest {
            url: feed.url.clone(),
            etag: feed.etag.clone(),
            last_modified: feed.last_modified.clone(),
        })
    }
}

fn rss_item_to_stored_article(
    feed_id: &str,
    item: &RssReaderItem,
    fetched_at: &str,
) -> RssReaderStoredArticle {
    RssReaderStoredArticle {
        id: format!("article-{}", uuid::Uuid::new_v4()),
        feed_id: feed_id.to_string(),
        stable_id: if item.stable_id.trim().is_empty() {
            sha1_hex(&format!(
                "{}|{}|{}",
                item.guid.as_deref().unwrap_or_default(),
                item.link.as_deref().unwrap_or_default(),
                item.title
            ))
        } else {
            item.stable_id.clone()
        },
        title: item.title.trim().to_string(),
        link: item.link.clone().unwrap_or_default(),
        author: item.author.clone().unwrap_or_default(),
        summary: item.summary.trim().to_string(),
        content: item.content.trim().to_string(),
        summary_html: item.summary_html.trim().to_string(),
        content_html: item.content_html.trim().to_string(),
        published_at: item.published_at.clone().unwrap_or_default(),
        updated_at: item.updated_at.clone().unwrap_or_default(),
        fetched_at: fetched_at.to_string(),
        guid: item.guid.clone().unwrap_or_default(),
        translated_title: String::new(),
        translated_summary: String::new(),
        translated_html: String::new(),
        translated_content: String::new(),
        translated_at: String::new(),
        translated_provider: String::new(),
        translation_error: String::new(),
        read: false,
        starred: false,
        later: false,
    }
}

fn is_background_feed_due(feed: &RssReaderStoreFeed, now: DateTime<Utc>) -> bool {
    let interval_minutes = clamp_refresh_minutes_i64(feed.refresh_minutes);
    let Some(last_fetched) = parse_rfc3339_to_utc(&feed.last_fetched_at) else {
        return true;
    };
    now.signed_duration_since(last_fetched).num_minutes() >= interval_minutes
}

fn parse_rfc3339_to_utc(value: &str) -> Option<DateTime<Utc>> {
    if value.trim().is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(value.trim())
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

fn save_rss_store_document(store: &RssReaderStoreDocument) -> Result<(), String> {
    let data = serde_json::to_string_pretty(store)
        .map_err(|error| format!("序列化 RSS 配置失败: {}", error))?;
    let connection = rss_reader_connection()?;
    ensure_store_table(&connection)?;
    connection
        .execute(
            "INSERT INTO rss_store(key, value, updated_at)
             VALUES('store', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![data, Utc::now().to_rfc3339()],
        )
        .map_err(|error| format!("保存 RSS 后台刷新状态失败: {}", error))?;
    Ok(())
}

#[tauri::command]
pub fn rss_reader_fetch_web_feed(
    request: RssReaderWebFetchRequest,
) -> Result<RssReaderFetchResult, String> {
    fetch_web_feed(request)
}

fn fetch_web_feed(request: RssReaderWebFetchRequest) -> Result<RssReaderFetchResult, String> {
    validate_web_rule(&request.rule)?;
    let list_url = normalize_url(&request.url)?;
    let base_url = Url::parse(&list_url).map_err(|error| format!("网页地址无效: {}", error))?;
    let client = Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("初始化网页抓取客户端失败: {}", error))?;
    let html = fetch_html(&client, &list_url)?;
    let document = Html::parse_document(&html);
    let list_selector = parse_selector(&request.rule.list_selector, "文章项选择器")?;
    let title_selector = parse_selector(&request.rule.title_selector, "标题选择器")?;
    let link_selector = parse_selector(&request.rule.link_selector, "链接选择器")?;
    let summary_selector = parse_optional_selector(&request.rule.summary_selector, "摘要选择器")?;
    let date_selector = parse_optional_selector(&request.rule.date_selector, "时间选择器")?;
    let author_selector = parse_optional_selector(&request.rule.author_selector, "作者选择器")?;
    let detail_selector =
        parse_optional_selector(&request.rule.detail_content_selector, "详情正文选择器")?;
    let exclude_selectors = parse_selector_list(&request.rule.exclude_selectors)?;
    let limit = if request.preview_limit == 0 {
        50usize
    } else {
        request.preview_limit.clamp(1, 50)
    };
    let mut items = Vec::new();
    for item in document.select(&list_selector).take(limit) {
        let title = select_text(&item, &title_selector).unwrap_or_default();
        if title.trim().is_empty() {
            continue;
        }
        let link = select_attr(&item, &link_selector, request.rule.link_attribute.trim())
            .or_else(|| select_attr(&item, &title_selector, "href"));
        let Some(link) = link else {
            continue;
        };
        let absolute_link = absolutize_url(&base_url, &link)?;
        let summary_html = summary_selector
            .as_ref()
            .and_then(|selector| select_html(&item, selector, &exclude_selectors))
            .unwrap_or_default();
        let summary = if summary_html.trim().is_empty() {
            summary_selector
                .as_ref()
                .and_then(|selector| select_text(&item, selector))
                .unwrap_or_default()
        } else {
            strip_html(&summary_html)
        };
        let author = author_selector
            .as_ref()
            .and_then(|selector| select_text(&item, selector))
            .filter(|value| !value.trim().is_empty());
        let published_at = date_selector
            .as_ref()
            .and_then(|selector| select_text(&item, selector))
            .filter(|value| !value.trim().is_empty());
        let (content_html, content) = if request.rule.detail_enabled {
            match &detail_selector {
                Some(selector) => {
                    fetch_detail_content(&client, &absolute_link, selector, &exclude_selectors)
                        .unwrap_or_default()
                }
                None => (String::new(), String::new()),
            }
        } else {
            (String::new(), String::new())
        };
        let content_html = if content_html.trim().is_empty() {
            summary_html.clone()
        } else {
            content_html
        };
        let content = if content.trim().is_empty() {
            summary.clone()
        } else {
            content
        };
        let seed = format!(
            "{}|{}|{}",
            absolute_link,
            title,
            published_at.as_deref().unwrap_or(&summary)
        );
        items.push(RssReaderItem {
            stable_id: sha1_hex(&seed),
            title: title.trim().to_string(),
            link: Some(absolute_link),
            author,
            summary,
            content,
            summary_html,
            content_html,
            published_at,
            updated_at: None,
            guid: None,
        });
    }
    if items.is_empty() {
        return Err("网页规则未抓取到文章，请检查选择器。".to_string());
    }
    let page_title = if request.title.trim().is_empty() {
        document_title(&document).unwrap_or_else(|| list_url.clone())
    } else {
        request.title.trim().to_string()
    };
    Ok(RssReaderFetchResult {
        feed: RssReaderFeedInfo {
            title: page_title,
            description: request.description.trim().to_string(),
            site_url: Some(if request.site_url.trim().is_empty() {
                list_url.clone()
            } else {
                normalize_url(&request.site_url)?
            }),
            feed_url: list_url,
        },
        items,
        fetched_at: Utc::now().to_rfc3339(),
        not_modified: false,
        etag: None,
        last_modified: None,
    })
}

fn fetch_html(client: &Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .send()
        .map_err(|error| format!("请求网页失败: {}", error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("网页返回异常状态: {}", status));
    }
    response
        .text()
        .map_err(|error| format!("读取网页内容失败: {}", error))
}

fn validate_web_rule(rule: &RssReaderWebCrawlRule) -> Result<(), String> {
    if rule.list_selector.trim().is_empty() {
        return Err("请填写文章项选择器。".to_string());
    }
    if rule.title_selector.trim().is_empty() {
        return Err("请填写标题选择器。".to_string());
    }
    if rule.link_selector.trim().is_empty() {
        return Err("请填写链接选择器。".to_string());
    }
    if rule.detail_enabled && rule.detail_content_selector.trim().is_empty() {
        return Err("已启用详情页抓取，请填写详情正文选择器。".to_string());
    }
    Ok(())
}

fn parse_selector(value: &str, label: &str) -> Result<Selector, String> {
    Selector::parse(value.trim()).map_err(|_| format!("{}格式无效。", label))
}

fn parse_optional_selector(value: &str, label: &str) -> Result<Option<Selector>, String> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    parse_selector(value, label).map(Some)
}

fn parse_selector_list(value: &str) -> Result<Vec<Selector>, String> {
    let mut selectors = Vec::new();
    for item in value.split(',') {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        selectors.push(parse_selector(trimmed, "排除元素选择器")?);
    }
    Ok(selectors)
}

fn select_text(root: &ElementRef<'_>, selector: &Selector) -> Option<String> {
    root.select(selector)
        .next()
        .map(|element| element_text(&element))
        .filter(|value| !value.trim().is_empty())
}

fn select_attr(root: &ElementRef<'_>, selector: &Selector, attribute: &str) -> Option<String> {
    let attr = if attribute.trim().is_empty() {
        "href"
    } else {
        attribute.trim()
    };
    root.select(selector)
        .next()
        .and_then(|element| element.value().attr(attr))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn select_html(
    root: &ElementRef<'_>,
    selector: &Selector,
    exclude_selectors: &[Selector],
) -> Option<String> {
    root.select(selector)
        .next()
        .map(|element| remove_excluded_html(element.inner_html(), exclude_selectors))
        .filter(|value| !value.trim().is_empty())
}

fn fetch_detail_content(
    client: &Client,
    url: &str,
    selector: &Selector,
    exclude_selectors: &[Selector],
) -> Result<(String, String), String> {
    let html = fetch_html(client, url)?;
    let document = Html::parse_document(&html);
    let Some(element) = document.select(selector).next() else {
        return Ok((String::new(), String::new()));
    };
    let content_html = remove_excluded_html(element.inner_html(), exclude_selectors);
    let content = strip_html(&content_html);
    Ok((content_html, content))
}

fn remove_excluded_html(html: String, exclude_selectors: &[Selector]) -> String {
    if exclude_selectors.is_empty() || html.trim().is_empty() {
        return html;
    }
    let fragment = Html::parse_fragment(&html);
    let mut output = html;
    for selector in exclude_selectors {
        for element in fragment.select(selector) {
            output = output.replace(&element.html(), "");
        }
    }
    output
}

fn element_text(element: &ElementRef<'_>) -> String {
    element
        .text()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn document_title(document: &Html) -> Option<String> {
    let selector = Selector::parse("title").ok()?;
    document
        .select(&selector)
        .next()
        .map(|element| element_text(&element))
        .filter(|value| !value.trim().is_empty())
}

fn absolutize_url(base_url: &Url, value: &str) -> Result<String, String> {
    base_url
        .join(value.trim())
        .map(|url| url.to_string())
        .map_err(|error| format!("链接地址无效: {}", error))
}

fn default_link_attribute() -> String {
    "href".to_string()
}

fn default_feed_source_type() -> String {
    "rss".to_string()
}

fn default_refresh_minutes_i64() -> i64 {
    DEFAULT_RSS_REFRESH_MINUTES
}

fn clamp_refresh_minutes_i64(value: i64) -> i64 {
    value.clamp(5, 1440)
}

fn normalize_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("请输入订阅源地址".to_string());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(trimmed.to_string());
    }
    Ok(format!("https://{}", trimmed))
}

fn build_feed_info(feed: &Feed, feed_url: &str) -> RssReaderFeedInfo {
    RssReaderFeedInfo {
        title: text_content(feed.title.as_ref()).unwrap_or_else(|| "未命名订阅源".to_string()),
        description: text_content(feed.description.as_ref())
            .map(|value| strip_html(&value))
            .unwrap_or_default(),
        site_url: first_link(&feed.links),
        feed_url: feed_url.to_string(),
    }
}

fn build_item(entry: &Entry) -> RssReaderItem {
    let link = first_link(&entry.links);
    let title = text_content(entry.title.as_ref()).unwrap_or_else(|| "未命名文章".to_string());
    let summary_html = text_content(entry.summary.as_ref()).unwrap_or_default();
    let content_html = entry
        .content
        .as_ref()
        .and_then(|content| content.body.as_deref())
        .unwrap_or("");
    let summary = strip_html(&summary_html);
    let content = strip_html(content_html);
    let author = entry
        .authors
        .first()
        .map(|author| author.name.trim().to_string())
        .filter(|value| !value.is_empty());
    let published_at = entry.published.map(|date| date.to_rfc3339());
    let updated_at = entry.updated.map(|date| date.to_rfc3339());
    let guid = if entry.id.trim().is_empty() {
        None
    } else {
        Some(entry.id.trim().to_string())
    };
    let seed = format!(
        "{}|{}|{}|{}",
        guid.as_deref().unwrap_or_default(),
        link.as_deref().unwrap_or_default(),
        title,
        published_at
            .as_deref()
            .or(updated_at.as_deref())
            .unwrap_or_default()
    );

    RssReaderItem {
        stable_id: sha1_hex(&seed),
        title,
        link,
        author,
        summary,
        content,
        summary_html,
        content_html: content_html.to_string(),
        published_at,
        updated_at,
        guid,
    }
}

fn text_content(text: Option<&Text>) -> Option<String> {
    text.map(|value| value.content.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn first_link(links: &[Link]) -> Option<String> {
    links
        .iter()
        .find(|link| link.rel.as_deref().unwrap_or("alternate") == "alternate")
        .or_else(|| links.first())
        .map(|link| link.href.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn strip_html(value: &str) -> String {
    let tag_re = Regex::new(r"(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>|<[^>]+>").ok();
    let mut text = match tag_re {
        Some(re) => re.replace_all(value, " ").to_string(),
        None => value.to_string(),
    };
    for (from, to) in [
        ("&nbsp;", " "),
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", "\""),
        ("&#39;", "'"),
        ("&apos;", "'"),
    ] {
        text = text.replace(from, to);
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sha1_hex(value: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

fn rss_reader_connection() -> Result<Connection, String> {
    let path = rss_reader_db_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建 RSS 数据目录失败: {}", error))?;
    }
    Connection::open(path).map_err(|error| format!("打开 RSS 数据库失败: {}", error))
}

fn rss_reader_db_path() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "无法定位系统数据目录".to_string())?;
    Ok(base.join("McStartUP").join("rss_reader.db"))
}

pub fn rss_reader_launch_flag_enabled() -> bool {
    read_bool_flag("rss_reader_start_with_app.flag")
}

pub fn rss_reader_minimize_flag_enabled() -> bool {
    read_bool_flag("rss_reader_minimize_to_tray.flag")
}

fn write_rss_reader_launch_flag(enabled: bool) -> Result<(), String> {
    write_bool_flag("rss_reader_start_with_app.flag", enabled)
}

fn write_rss_reader_minimize_flag(enabled: bool) -> Result<(), String> {
    write_bool_flag("rss_reader_minimize_to_tray.flag", enabled)
}

fn read_bool_flag(name: &str) -> bool {
    let Ok(path) = rss_reader_flag_path(name) else {
        return false;
    };
    fs::read_to_string(path)
        .map(|value| value.trim() == "1")
        .unwrap_or(false)
}

fn write_bool_flag(name: &str, enabled: bool) -> Result<(), String> {
    let path = rss_reader_flag_path(name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建 RSS 数据目录失败: {}", error))?;
    }
    fs::write(path, if enabled { "1" } else { "0" })
        .map_err(|error| format!("保存 RSS 驻留设置失败: {}", error))
}

fn rss_reader_flag_path(name: &str) -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "无法定位系统数据目录".to_string())?;
    Ok(base.join("McStartUP").join(name))
}

fn ensure_store_table(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "CREATE TABLE IF NOT EXISTS rss_store(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )
        .map_err(|error| format!("初始化 RSS 数据表失败: {}", error))?;
    Ok(())
}

fn ensure_articles_table(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS rss_articles(
                id TEXT PRIMARY KEY,
                feed_id TEXT NOT NULL,
                stable_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                link TEXT NOT NULL DEFAULT '',
                author TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                summary_html TEXT NOT NULL DEFAULT '',
                content_html TEXT NOT NULL DEFAULT '',
                published_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '',
                fetched_at TEXT NOT NULL DEFAULT '',
                guid TEXT NOT NULL DEFAULT '',
                translated_title TEXT NOT NULL DEFAULT '',
                translated_summary TEXT NOT NULL DEFAULT '',
                translated_html TEXT NOT NULL DEFAULT '',
                translated_content TEXT NOT NULL DEFAULT '',
                translated_at TEXT NOT NULL DEFAULT '',
                translated_provider TEXT NOT NULL DEFAULT '',
                translation_error TEXT NOT NULL DEFAULT '',
                read INTEGER NOT NULL DEFAULT 0,
                starred INTEGER NOT NULL DEFAULT 0,
                later INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_articles_feed_stable
                ON rss_articles(feed_id, stable_id);
            CREATE INDEX IF NOT EXISTS idx_rss_articles_feed_time
                ON rss_articles(feed_id, published_at, updated_at, fetched_at);
            CREATE INDEX IF NOT EXISTS idx_rss_articles_time
                ON rss_articles(published_at, updated_at, fetched_at);
            CREATE INDEX IF NOT EXISTS idx_rss_articles_state
                ON rss_articles(read, starred, later);
            CREATE VIRTUAL TABLE IF NOT EXISTS rss_articles_fts USING fts5(
                title,
                summary,
                content,
                author,
                guid,
                link,
                translated_title,
                translated_summary,
                translated_content,
                content='rss_articles',
                content_rowid='rowid'
            );
            CREATE TRIGGER IF NOT EXISTS rss_articles_ai AFTER INSERT ON rss_articles BEGIN
                INSERT INTO rss_articles_fts(
                    rowid, title, summary, content, author, guid, link,
                    translated_title, translated_summary, translated_content
                )
                VALUES(
                    new.rowid, new.title, new.summary, new.content, new.author, new.guid, new.link,
                    new.translated_title, new.translated_summary, new.translated_content
                );
            END;
            CREATE TRIGGER IF NOT EXISTS rss_articles_ad AFTER DELETE ON rss_articles BEGIN
                INSERT INTO rss_articles_fts(
                    rss_articles_fts, rowid, title, summary, content, author, guid, link,
                    translated_title, translated_summary, translated_content
                )
                VALUES(
                    'delete', old.rowid, old.title, old.summary, old.content, old.author, old.guid, old.link,
                    old.translated_title, old.translated_summary, old.translated_content
                );
            END;
            CREATE TRIGGER IF NOT EXISTS rss_articles_au AFTER UPDATE OF
                title, summary, content, author, guid, link,
                translated_title, translated_summary, translated_content
            ON rss_articles BEGIN
                INSERT INTO rss_articles_fts(
                    rss_articles_fts, rowid, title, summary, content, author, guid, link,
                    translated_title, translated_summary, translated_content
                )
                VALUES(
                    'delete', old.rowid, old.title, old.summary, old.content, old.author, old.guid, old.link,
                    old.translated_title, old.translated_summary, old.translated_content
                );
                INSERT INTO rss_articles_fts(
                    rowid, title, summary, content, author, guid, link,
                    translated_title, translated_summary, translated_content
                )
                VALUES(
                    new.rowid, new.title, new.summary, new.content, new.author, new.guid, new.link,
                    new.translated_title, new.translated_summary, new.translated_content
                );
            END;
            CREATE TABLE IF NOT EXISTS rss_meta(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            );",
        )
        .map_err(|error| format!("初始化 RSS 文章缓存表失败: {}", error))?;
    ensure_article_column(connection, "translated_title", "TEXT NOT NULL DEFAULT ''")?;
    ensure_article_column(connection, "translated_summary", "TEXT NOT NULL DEFAULT ''")?;
    ensure_article_column(connection, "translated_html", "TEXT NOT NULL DEFAULT ''")?;
    ensure_article_column(connection, "translated_content", "TEXT NOT NULL DEFAULT ''")?;
    ensure_article_column(connection, "translated_at", "TEXT NOT NULL DEFAULT ''")?;
    ensure_article_column(
        connection,
        "translated_provider",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_article_column(connection, "translation_error", "TEXT NOT NULL DEFAULT ''")?;
    ensure_article_fts_ready(connection)?;
    Ok(())
}

fn ensure_article_fts_ready(connection: &Connection) -> Result<(), String> {
    let rebuilt = connection
        .query_row(
            "SELECT value FROM rss_meta WHERE key = 'rss_articles_fts_rebuilt_v1' LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("检查 RSS 搜索索引失败: {}", error))?;
    if rebuilt.as_deref() == Some("1") {
        return Ok(());
    }
    connection
        .execute(
            "INSERT INTO rss_articles_fts(rss_articles_fts) VALUES('rebuild')",
            [],
        )
        .map_err(|error| format!("重建 RSS 搜索索引失败: {}", error))?;
    connection
        .execute(
            "INSERT INTO rss_meta(key, value)
             VALUES('rss_articles_fts_rebuilt_v1', '1')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        )
        .map_err(|error| format!("保存 RSS 搜索索引状态失败: {}", error))?;
    Ok(())
}

fn ensure_article_column(
    connection: &Connection,
    column_name: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(rss_articles)")
        .map_err(|error| format!("检查 RSS 文章缓存表失败: {}", error))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("检查 RSS 文章缓存表失败: {}", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("检查 RSS 文章缓存表失败: {}", error))?;
    if columns.iter().any(|column| column == column_name) {
        return Ok(());
    }
    connection
        .execute(
            &format!(
                "ALTER TABLE rss_articles ADD COLUMN {} {}",
                column_name, definition
            ),
            [],
        )
        .map_err(|error| format!("迁移 RSS 文章缓存表失败: {}", error))?;
    Ok(())
}

fn build_article_sql_filter(
    request: &RssReaderArticlePageRequest,
    include_search: bool,
    keyword: Option<&RssReaderArticleKeywordRequest>,
) -> RssArticleSqlFilter {
    let mut clauses = vec!["1 = 1".to_string()];
    let mut params = Vec::new();
    let known_feed_ids = request
        .feed_sources
        .iter()
        .map(|source| source.feed_id.trim().to_string())
        .chain(
            request
                .feed_ids
                .iter()
                .map(|feed_id| feed_id.trim().to_string()),
        )
        .filter(|feed_id| !feed_id.is_empty())
        .collect::<HashSet<_>>();
    if !known_feed_ids.is_empty() {
        let placeholders = push_string_in_clause(&mut params, known_feed_ids.into_iter());
        clauses.push(format!("feed_id IN ({})", placeholders));
    }

    let feed_ids = request
        .feed_ids
        .iter()
        .map(|feed_id| feed_id.trim().to_string())
        .filter(|feed_id| !feed_id.is_empty())
        .collect::<HashSet<_>>();
    if !feed_ids.is_empty() {
        let placeholders = push_string_in_clause(&mut params, feed_ids.into_iter());
        clauses.push(format!("feed_id IN ({})", placeholders));
    }

    if include_search {
        if let Some(query) = build_fts_query_from_text(&request.search) {
            params.push(Value::Text(query));
            clauses.push(
                "rowid IN (SELECT rowid FROM rss_articles_fts WHERE rss_articles_fts MATCH ?)"
                    .to_string(),
            );
        }
        if let Some(keyword) = keyword {
            if let Some(query) = build_fts_query_from_keyword(keyword) {
                params.push(Value::Text(query));
                clauses.push(
                    "rowid IN (SELECT rowid FROM rss_articles_fts WHERE rss_articles_fts MATCH ?)"
                        .to_string(),
                );
            }
        }
    }

    RssArticleSqlFilter {
        where_sql: clauses.join(" AND "),
        params,
    }
}

fn push_string_in_clause<I>(params: &mut Vec<Value>, values: I) -> String
where
    I: IntoIterator<Item = String>,
{
    let mut placeholders = Vec::new();
    for value in values {
        params.push(Value::Text(value));
        placeholders.push("?".to_string());
    }
    placeholders.join(", ")
}

fn build_article_view_filter(view: &str) -> &'static str {
    match view {
        "unread" => " AND read = 0",
        "starred" => " AND starred = 1",
        "later" => " AND later = 1",
        _ => "",
    }
}

fn build_fts_query_from_text(text: &str) -> Option<String> {
    let terms = split_fts_terms(text);
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" AND "))
    }
}

fn build_fts_query_from_keyword(keyword: &RssReaderArticleKeywordRequest) -> Option<String> {
    if !keyword.enabled {
        return None;
    }
    let prefix = keyword_fts_column_prefix(keyword);
    let terms = keyword
        .keywords
        .iter()
        .flat_map(|value| split_fts_terms(value))
        .map(|term| match &prefix {
            Some(prefix) => format!("{}:{}", prefix, term),
            None => term,
        })
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return None;
    }
    if keyword.match_mode == "all" {
        Some(terms.join(" AND "))
    } else {
        Some(terms.join(" OR "))
    }
}

fn keyword_fts_column_prefix(keyword: &RssReaderArticleKeywordRequest) -> Option<String> {
    let mut scopes = keyword
        .scopes
        .iter()
        .map(|scope| scope.as_str())
        .filter_map(|scope| match scope {
            "title" => Some(vec!["title", "translated_title"]),
            "summary" => Some(vec!["summary", "translated_summary"]),
            "content" => Some(vec!["content", "translated_content"]),
            "author" => Some(vec!["author"]),
            _ => None,
        })
        .flatten()
        .collect::<Vec<_>>();
    scopes.sort_unstable();
    scopes.dedup();
    if scopes.is_empty() || scopes.len() >= 8 {
        None
    } else if scopes.len() == 1 {
        Some(scopes[0].to_string())
    } else {
        Some(format!("{{{}}}", scopes.join(" ")))
    }
}

fn split_fts_terms(text: &str) -> Vec<String> {
    text.split(|character: char| character.is_whitespace())
        .map(|term| {
            term.trim_matches(|character: char| {
                character.is_ascii_punctuation() && character != '-' && character != '_'
            })
        })
        .filter(|term| !term.is_empty())
        .take(20)
        .map(quote_fts_term)
        .collect()
}

fn quote_fts_term(term: &str) -> String {
    format!("\"{}\"", term.replace('"', "\"\""))
}

fn query_count(
    connection: &Connection,
    where_sql: &str,
    params: &[Value],
) -> Result<usize, String> {
    let sql = format!("SELECT COUNT(*) FROM rss_articles WHERE {}", where_sql);
    connection
        .query_row(&sql, params_from_iter(params.iter()), |row| {
            row.get::<_, i64>(0)
        })
        .map(|value| value.max(0) as usize)
        .map_err(|error| format!("统计 RSS 文章失败: {}", error))
}

fn query_feed_counters(
    connection: &Connection,
    where_sql: &str,
    params: &[Value],
) -> Result<HashMap<String, RssReaderArticleCounter>, String> {
    let sql = format!(
        "SELECT feed_id, COUNT(*), SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END)
         FROM rss_articles
         WHERE {}
         GROUP BY feed_id",
        where_sql
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("统计 RSS 订阅源文章失败: {}", error))?;
    let rows = statement
        .query_map(params_from_iter(params.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                RssReaderArticleCounter {
                    total: row.get::<_, i64>(1)?.max(0) as usize,
                    unread: row.get::<_, i64>(2)?.max(0) as usize,
                },
            ))
        })
        .map_err(|error| format!("统计 RSS 订阅源文章失败: {}", error))?;
    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(|error| format!("统计 RSS 订阅源文章失败: {}", error))
}

fn query_keyword_counters(
    connection: &Connection,
    base_filter: &RssArticleSqlFilter,
    keywords: &[RssReaderArticleKeywordRequest],
) -> Result<HashMap<String, RssReaderArticleCounter>, String> {
    let mut counters = HashMap::new();
    for keyword in keywords {
        if keyword.id.trim().is_empty() {
            continue;
        }
        let Some(query) = build_fts_query_from_keyword(keyword) else {
            continue;
        };
        let mut params = base_filter.params.clone();
        params.push(Value::Text(query));
        let where_sql = format!(
            "{} AND rowid IN (SELECT rowid FROM rss_articles_fts WHERE rss_articles_fts MATCH ?)",
            base_filter.where_sql
        );
        counters.insert(
            keyword.id.clone(),
            RssReaderArticleCounter {
                total: query_count(connection, &where_sql, &params)?,
                unread: query_count(connection, &format!("{} AND read = 0", where_sql), &params)?,
            },
        );
    }
    Ok(counters)
}

fn query_article_page(
    connection: &Connection,
    where_sql: &str,
    params: &[Value],
    limit: usize,
    offset: usize,
) -> Result<Vec<RssReaderStoredArticle>, String> {
    let sql = format!(
        "SELECT id, feed_id, stable_id, title, link, author, summary, '' AS content,
                '' AS summary_html, '' AS content_html, published_at, updated_at, fetched_at, guid,
                translated_title, translated_summary, translated_html, translated_content,
                translated_at, translated_provider, translation_error,
                read, starred, later
         FROM rss_articles
         WHERE {}
         ORDER BY COALESCE(NULLIF(published_at, ''), NULLIF(updated_at, ''), fetched_at) DESC,
                  rowid DESC
         LIMIT ? OFFSET ?",
        where_sql
    );
    let mut query_params = params.to_vec();
    query_params.push(Value::Integer(limit as i64));
    query_params.push(Value::Integer(offset as i64));
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("读取 RSS 文章列表失败: {}", error))?;
    let rows = statement
        .query_map(params_from_iter(query_params.iter()), row_to_article)
        .map_err(|error| format!("读取 RSS 文章列表失败: {}", error))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map(|items| items.into_iter().map(lightweight_article).collect())
        .map_err(|error| format!("读取 RSS 文章列表失败: {}", error))
}

fn default_article_page_limit() -> usize {
    120
}

fn default_true() -> bool {
    true
}

fn lightweight_article(mut article: RssReaderStoredArticle) -> RssReaderStoredArticle {
    article.content.clear();
    article.summary_html.clear();
    article.content_html.clear();
    article
}

fn row_to_article(row: &Row<'_>) -> rusqlite::Result<RssReaderStoredArticle> {
    Ok(RssReaderStoredArticle {
        id: row.get(0)?,
        feed_id: row.get(1)?,
        stable_id: row.get(2)?,
        title: row.get(3)?,
        link: row.get(4)?,
        author: row.get(5)?,
        summary: row.get(6)?,
        content: row.get(7)?,
        summary_html: row.get(8)?,
        content_html: row.get(9)?,
        published_at: row.get(10)?,
        updated_at: row.get(11)?,
        fetched_at: row.get(12)?,
        guid: row.get(13)?,
        translated_title: row.get(14)?,
        translated_summary: row.get(15)?,
        translated_html: row.get(16)?,
        translated_content: row.get(17)?,
        translated_at: row.get(18)?,
        translated_provider: row.get(19)?,
        translation_error: row.get(20)?,
        read: int_to_bool(row.get(21)?),
        starred: int_to_bool(row.get(22)?),
        later: int_to_bool(row.get(23)?),
    })
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn int_to_bool(value: i64) -> bool {
    value != 0
}
