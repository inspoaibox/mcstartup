use chrono::{Duration, Utc};
use reqwest::header::{HeaderMap, ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const GITHUB_API: &str = "https://api.github.com";
const USER_AGENT_VALUE: &str = "McStartUP GitHub Store";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStoreSearchParams {
    pub query: Option<String>,
    pub language: Option<String>,
    pub topic: Option<String>,
    pub sort: Option<String>,
    pub order: Option<String>,
    pub page: Option<u32>,
    pub per_page: Option<u32>,
    pub token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStoreDailyParams {
    pub language: Option<String>,
    pub topic: Option<String>,
    pub min_stars: Option<u64>,
    pub days: Option<u32>,
    pub mode: Option<String>,
    pub force_refresh: Option<bool>,
    pub token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStoreRepoParams {
    pub full_name: String,
    pub token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubRateLimit {
    pub limit: Option<u64>,
    pub remaining: Option<u64>,
    pub reset: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubStoreOwner {
    pub login: String,
    pub avatar_url: Option<String>,
    pub html_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubStoreRepo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub owner: GithubStoreOwner,
    pub html_url: String,
    pub description: Option<String>,
    pub stars: u64,
    pub forks: u64,
    pub watchers: u64,
    pub open_issues: u64,
    pub language: Option<String>,
    pub topics: Vec<String>,
    pub license: Option<String>,
    pub pushed_at: Option<String>,
    pub updated_at: Option<String>,
    pub created_at: Option<String>,
    pub archived: bool,
    pub fork: bool,
    pub default_branch: Option<String>,
    pub homepage: Option<String>,
    pub size: u64,
    pub score: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubStoreSearchResult {
    pub query: String,
    pub total_count: u64,
    pub incomplete_results: bool,
    pub items: Vec<GithubStoreRepo>,
    pub page: u32,
    pub per_page: u32,
    pub rate_limit: GithubRateLimit,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubStoreDailyResult {
    pub source_date: String,
    pub since: String,
    pub mode: String,
    pub language: Option<String>,
    pub topic: Option<String>,
    pub min_stars: u64,
    pub generated_at: String,
    pub cache_hit: bool,
    pub query: String,
    pub items: Vec<GithubStoreRepo>,
    pub rate_limit: GithubRateLimit,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubStoreReleaseAsset {
    pub id: u64,
    pub name: String,
    pub label: Option<String>,
    pub browser_download_url: String,
    pub content_type: Option<String>,
    pub size: u64,
    pub download_count: u64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubStoreRelease {
    pub id: u64,
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub html_url: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub draft: bool,
    pub assets: Vec<GithubStoreReleaseAsset>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubStoreRepoDetail {
    pub repo: GithubStoreRepo,
    pub latest_release: Option<GithubStoreRelease>,
    pub releases: Vec<GithubStoreRelease>,
    pub rate_limit: GithubRateLimit,
}

#[derive(Debug, Deserialize)]
struct GithubSearchApi {
    total_count: u64,
    incomplete_results: bool,
    items: Vec<GithubRepoApi>,
}

#[derive(Debug, Deserialize)]
struct GithubOwnerApi {
    login: String,
    avatar_url: Option<String>,
    html_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubLicenseApi {
    name: Option<String>,
    spdx_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRepoApi {
    id: u64,
    name: String,
    full_name: String,
    owner: GithubOwnerApi,
    html_url: String,
    description: Option<String>,
    stargazers_count: u64,
    forks_count: u64,
    watchers_count: u64,
    open_issues_count: u64,
    language: Option<String>,
    topics: Option<Vec<String>>,
    license: Option<GithubLicenseApi>,
    pushed_at: Option<String>,
    updated_at: Option<String>,
    created_at: Option<String>,
    archived: bool,
    fork: bool,
    default_branch: Option<String>,
    homepage: Option<String>,
    size: u64,
    score: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseApi {
    id: u64,
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    prerelease: bool,
    draft: bool,
    assets: Vec<GithubReleaseAssetApi>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAssetApi {
    id: u64,
    name: String,
    label: Option<String>,
    browser_download_url: String,
    content_type: Option<String>,
    size: u64,
    download_count: u64,
    created_at: Option<String>,
    updated_at: Option<String>,
}

pub async fn github_store_search_repositories(
    params: GithubStoreSearchParams,
) -> Result<GithubStoreSearchResult, String> {
    let page = params.page.unwrap_or(1).clamp(1, 10);
    let per_page = params.per_page.unwrap_or(30).clamp(10, 60);
    let query = build_search_query(
        params.query.as_deref().unwrap_or("stars:>100"),
        params.language.as_deref(),
        params.topic.as_deref(),
    );
    let sort = params.sort.unwrap_or_else(|| "stars".to_string());
    let order = params.order.unwrap_or_else(|| "desc".to_string());
    let client = github_client()?;
    let request = client
        .get(format!("{}/search/repositories", GITHUB_API))
        .query(&[
            ("q", query.as_str()),
            ("sort", sort.as_str()),
            ("order", order.as_str()),
            ("page", &page.to_string()),
            ("per_page", &per_page.to_string()),
        ]);
    let (value, rate_limit) =
        github_json::<GithubSearchApi>(request, params.token.as_deref()).await?;
    Ok(GithubStoreSearchResult {
        query,
        total_count: value.total_count,
        incomplete_results: value.incomplete_results,
        items: value.items.into_iter().map(map_repo).collect(),
        page,
        per_page,
        rate_limit,
    })
}

pub async fn github_store_daily(
    params: GithubStoreDailyParams,
) -> Result<GithubStoreDailyResult, String> {
    let now = Utc::now();
    let source_date = now.format("%Y-%m-%d").to_string();
    let days = params.days.unwrap_or(1).clamp(1, 30);
    let since = (now - Duration::days(days as i64))
        .format("%Y-%m-%d")
        .to_string();
    let mode = match params.mode.as_deref() {
        Some("new") => "new".to_string(),
        _ => "updated".to_string(),
    };
    let min_stars = params.min_stars.unwrap_or(50);
    let language = params
        .language
        .as_ref()
        .and_then(|value| clean_optional(value));
    let topic = params
        .topic
        .as_ref()
        .and_then(|value| clean_optional(value));
    let cache_path = daily_cache_path(
        &source_date,
        &mode,
        language.as_deref(),
        topic.as_deref(),
        min_stars,
        days,
    )?;

    if params.force_refresh != Some(true) && cache_path.exists() {
        if let Ok(text) = std::fs::read_to_string(&cache_path) {
            if let Ok(mut cached) = serde_json::from_str::<GithubStoreDailyResult>(&text) {
                cached.cache_hit = true;
                return Ok(cached);
            }
        }
    }

    let date_qualifier = if mode == "new" {
        format!("created:>={}", since)
    } else {
        format!("pushed:>={}", since)
    };
    let mut parts = vec![
        date_qualifier,
        format!("stars:>={}", min_stars),
        "archived:false".to_string(),
        "fork:false".to_string(),
    ];
    if let Some(value) = language.as_deref() {
        parts.push(format!("language:{}", quote_query_value(value)));
    }
    if let Some(value) = topic.as_deref() {
        parts.push(format!("topic:{}", quote_query_value(value)));
    }
    let query = parts.join(" ");

    let client = github_client()?;
    let request = client
        .get(format!("{}/search/repositories", GITHUB_API))
        .query(&[
            ("q", query.as_str()),
            ("sort", "stars"),
            ("order", "desc"),
            ("page", "1"),
            ("per_page", "50"),
        ]);
    let (value, rate_limit) =
        github_json::<GithubSearchApi>(request, params.token.as_deref()).await?;
    let result = GithubStoreDailyResult {
        source_date,
        since,
        mode,
        language,
        topic,
        min_stars,
        generated_at: now.to_rfc3339(),
        cache_hit: false,
        query,
        items: value.items.into_iter().map(map_repo).collect(),
        rate_limit,
    };
    write_json_cache(&cache_path, &result);
    Ok(result)
}

pub async fn github_store_repository(
    params: GithubStoreRepoParams,
) -> Result<GithubStoreRepoDetail, String> {
    let full_name = normalize_full_name(&params.full_name)?;
    let client = github_client()?;
    let repo_request = client.get(format!("{}/repos/{}", GITHUB_API, full_name));
    let (repo, repo_rate) =
        github_json::<GithubRepoApi>(repo_request, params.token.as_deref()).await?;

    let latest_release = match github_json::<GithubReleaseApi>(
        client.get(format!(
            "{}/repos/{}/releases/latest",
            GITHUB_API, full_name
        )),
        params.token.as_deref(),
    )
    .await
    {
        Ok((release, _)) => Some(map_release(release)),
        Err(error) if error.contains("404") => None,
        Err(error) => return Err(error),
    };

    let releases = match github_json::<Vec<GithubReleaseApi>>(
        client
            .get(format!("{}/repos/{}/releases", GITHUB_API, full_name))
            .query(&[("per_page", "8")]),
        params.token.as_deref(),
    )
    .await
    {
        Ok((releases, _)) => releases.into_iter().map(map_release).collect(),
        Err(error) if error.contains("404") => Vec::new(),
        Err(error) => return Err(error),
    };

    Ok(GithubStoreRepoDetail {
        repo: map_repo(repo),
        latest_release,
        releases,
        rate_limit: repo_rate,
    })
}

fn github_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(USER_AGENT_VALUE)
        .build()
        .map_err(|e| format!("初始化 GitHub 客户端失败: {}", e))
}

async fn github_json<T: for<'de> Deserialize<'de>>(
    request: reqwest::RequestBuilder,
    token: Option<&str>,
) -> Result<(T, GithubRateLimit), String> {
    let mut request = request
        .header(USER_AGENT, USER_AGENT_VALUE)
        .header(ACCEPT, "application/vnd.github+json");
    if let Some(token) = token.and_then(clean_optional) {
        request = request.header(AUTHORIZATION, format!("Bearer {}", token));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("请求 GitHub 失败: {}", e))?;
    let status = response.status();
    let headers = response.headers().clone();
    let rate_limit = parse_rate_limit(&headers);
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 GitHub 响应失败: {}", e))?;
    if !status.is_success() {
        return Err(format!(
            "GitHub API 响应失败({}): {}",
            status.as_u16(),
            github_error_message(&body)
        ));
    }
    serde_json::from_str::<T>(&body)
        .map(|value| (value, rate_limit))
        .map_err(|e| format!("解析 GitHub 响应失败: {}", e))
}

fn parse_rate_limit(headers: &HeaderMap) -> GithubRateLimit {
    GithubRateLimit {
        limit: header_u64(headers, "x-ratelimit-limit"),
        remaining: header_u64(headers, "x-ratelimit-remaining"),
        reset: header_u64(headers, "x-ratelimit-reset").and_then(|value| {
            chrono::DateTime::<Utc>::from_timestamp(value as i64, 0).map(|time| time.to_rfc3339())
        }),
    }
}

fn header_u64(headers: &HeaderMap, name: &str) -> Option<u64> {
    headers.get(name)?.to_str().ok()?.parse::<u64>().ok()
}

fn github_error_message(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(|message| message.as_str())
                .map(str::to_string)
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| body.chars().take(240).collect())
}

fn build_search_query(query: &str, language: Option<&str>, topic: Option<&str>) -> String {
    let mut parts = vec![query.trim().to_string()];
    if let Some(value) = language.and_then(clean_optional) {
        parts.push(format!("language:{}", quote_query_value(&value)));
    }
    if let Some(value) = topic.and_then(clean_optional) {
        parts.push(format!("topic:{}", quote_query_value(&value)));
    }
    let query = parts
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if query.is_empty() {
        "stars:>100".to_string()
    } else {
        query
    }
}

fn clean_optional(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn quote_query_value(value: &str) -> String {
    if value.chars().any(char::is_whitespace) {
        format!("\"{}\"", value.replace('"', ""))
    } else {
        value.to_string()
    }
}

fn normalize_full_name(value: &str) -> Result<String, String> {
    let value = value.trim().trim_start_matches("https://github.com/");
    let parts = value
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .take(2)
        .collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err("请输入 owner/repo 或 GitHub 仓库链接".to_string());
    }
    Ok(format!("{}/{}", parts[0], parts[1]))
}

fn daily_cache_path(
    date: &str,
    mode: &str,
    language: Option<&str>,
    topic: Option<&str>,
    min_stars: u64,
    days: u32,
) -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .or_else(dirs::config_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("McStartUP")
        .join("github-store");
    std::fs::create_dir_all(&base).map_err(|e| format!("创建 GitHub Store 缓存目录失败: {}", e))?;
    let language = sanitize_cache_key(language.unwrap_or("all"));
    let topic = sanitize_cache_key(topic.unwrap_or("all"));
    Ok(base.join(format!(
        "daily-{}-{}-{}-{}-{}-{}.json",
        date, mode, language, topic, min_stars, days
    )))
}

fn sanitize_cache_key(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_lowercase()
}

fn write_json_cache<T: Serialize>(path: &PathBuf, value: &T) {
    if let Ok(text) = serde_json::to_string_pretty(value) {
        let _ = std::fs::write(path, text);
    }
}

fn map_repo(repo: GithubRepoApi) -> GithubStoreRepo {
    GithubStoreRepo {
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        owner: GithubStoreOwner {
            login: repo.owner.login,
            avatar_url: repo.owner.avatar_url,
            html_url: repo.owner.html_url,
        },
        html_url: repo.html_url,
        description: repo.description,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        watchers: repo.watchers_count,
        open_issues: repo.open_issues_count,
        language: repo.language,
        topics: repo.topics.unwrap_or_default(),
        license: repo
            .license
            .and_then(|license| license.spdx_id.or(license.name)),
        pushed_at: repo.pushed_at,
        updated_at: repo.updated_at,
        created_at: repo.created_at,
        archived: repo.archived,
        fork: repo.fork,
        default_branch: repo.default_branch,
        homepage: repo.homepage.and_then(|value| clean_optional(&value)),
        size: repo.size,
        score: repo.score,
    }
}

fn map_release(release: GithubReleaseApi) -> GithubStoreRelease {
    GithubStoreRelease {
        id: release.id,
        tag_name: release.tag_name,
        name: release.name,
        body: release.body,
        html_url: release.html_url,
        published_at: release.published_at,
        prerelease: release.prerelease,
        draft: release.draft,
        assets: release.assets.into_iter().map(map_release_asset).collect(),
    }
}

fn map_release_asset(asset: GithubReleaseAssetApi) -> GithubStoreReleaseAsset {
    GithubStoreReleaseAsset {
        id: asset.id,
        name: asset.name,
        label: asset.label,
        browser_download_url: asset.browser_download_url,
        content_type: asset.content_type,
        size: asset.size,
        download_count: asset.download_count,
        created_at: asset.created_at,
        updated_at: asset.updated_at,
    }
}

#[allow(dead_code)]
fn is_not_found(error: &str) -> bool {
    error.contains(&StatusCode::NOT_FOUND.as_u16().to_string())
}
