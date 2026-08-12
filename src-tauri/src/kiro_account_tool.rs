use base64::Engine;
use chrono::{Datelike, Utc};
use rand::Rng;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;
use uuid::Uuid;

const ACCOUNTS_INDEX_FILE: &str = "kiro_accounts.json";
const ACCOUNTS_DIR: &str = "kiro_accounts";
const LOCAL_AUTH_TOKEN_FILE_NAME: &str = "kiro-auth-token.json";
const LOCAL_USAGE_DB_KEY: &str = "kiro.kiroAgent";
const KIRO_AUTH_PORTAL_URL: &str = "https://app.kiro.dev/signin";
const KIRO_TOKEN_ENDPOINT: &str = "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token";
const KIRO_REFRESH_ENDPOINT: &str = "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken";
const KIRO_AWS_OIDC_TOKEN_ENDPOINT_FMT: &str = "https://oidc.{region}.amazonaws.com/token";
const KIRO_RUNTIME_DEFAULT_ENDPOINT: &str = "https://q.us-east-1.amazonaws.com";
const KIRO_STATUS_NORMAL: &str = "normal";
const KIRO_STATUS_BANNED: &str = "banned";
const KIRO_STATUS_ERROR: &str = "error";
const OAUTH_TIMEOUT_SECONDS: i64 = 600;
const OAUTH_STATE_FILE: &str = "kiro_oauth_pending.json";
const BACKGROUND_REFRESH_FILE: &str = "kiro_background_refresh.json";
const BACKGROUND_REFRESH_STATUS_FILE: &str = "kiro_background_refresh_status.json";
const KIRO_TOOL_SETTINGS_FILE: &str = "kiro_tool_settings.json";
const KIRO_INSTANCE_DIR: &str = "kiro_instances";
const KIRO_LOCAL_BACKUP_DIR: &str = "kiro_local_backups";
const KIRO_INSTANCE_META_FILE: &str = "instance.json";
const KIRO_INSTANCE_IDENTITY_FILE: &str = "device_identity.json";
const ACCOUNT_FILE_PROTECTED_BY: &str = "windows-dpapi";
const KIRO_SERVICE_MACHINE_ID_DB_KEY: &str = "storage.serviceMachineId";
const MAX_BACKGROUND_HISTORY: usize = 20;
const BACKGROUND_POLL_SECONDS: u64 = 60;
const CALLBACK_PORT_CANDIDATES: [u16; 10] = [
    3128, 4649, 6588, 8008, 9091, 49153, 50153, 51153, 52153, 53153,
];

static PENDING_OAUTH_STATE: OnceLock<Mutex<Option<PendingOAuthState>>> = OnceLock::new();
static BACKGROUND_REFRESH_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroAccount {
    pub id: String,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idc_region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scopes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credits_total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credits_used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bonus_total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bonus_used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_reset_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_query_last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_query_last_error_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_updated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_raw: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_raw: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_raw: Option<Value>,
    pub created_at: i64,
    pub last_used: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroAccountSummary {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_name: Option<String>,
    pub created_at: i64,
    pub last_used: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroAccountIndex {
    pub version: String,
    pub accounts: Vec<KiroAccountSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_account_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroAccountToolState {
    pub accounts: Vec<KiroAccount>,
    pub current_account_id: Option<String>,
    pub index_path: String,
    pub accounts_dir: String,
    pub local_auth_path: String,
    pub local_profile_path: String,
    pub local_state_db_path: String,
    pub kiro_exe_path: Option<String>,
    pub pending_oauth: Option<KiroOAuthStartResponse>,
    pub background_refresh: KiroBackgroundRefreshSettings,
    pub background_status: KiroBackgroundRefreshStatus,
    pub tool_settings: KiroToolSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroAccountFastState {
    pub accounts: Vec<KiroAccountSummary>,
    pub current_account_id: Option<String>,
    pub index_path: String,
    pub accounts_dir: String,
    pub pending_oauth: Option<KiroOAuthStartResponse>,
    pub background_refresh: KiroBackgroundRefreshSettings,
    pub background_status: KiroBackgroundRefreshStatus,
    pub tool_settings: KiroToolSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroLocalStatus {
    pub auth_path: String,
    pub profile_path: String,
    pub state_db_path: String,
    pub auth_exists: bool,
    pub profile_exists: bool,
    pub state_db_exists: bool,
    pub kiro_exe_path: Option<String>,
    pub kiro_exe_source: Option<String>,
    pub manual_kiro_exe_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroOAuthStartResponse {
    pub login_id: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub callback_url: Option<String>,
    pub expires_in: i64,
    pub interval_seconds: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroRefreshAllResult {
    pub success_count: usize,
    pub failed_count: usize,
    pub errors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroBackgroundRefreshSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_background_interval_minutes")]
    pub interval_minutes: i64,
    #[serde(default = "default_true")]
    pub notify_on_change: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroToolSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manual_kiro_exe_path: Option<String>,
    #[serde(default = "default_true")]
    pub encrypt_accounts: bool,
    #[serde(default)]
    pub export_include_sensitive_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroBackgroundRefreshHistoryItem {
    pub started_at: i64,
    pub finished_at: i64,
    pub success_count: usize,
    pub failed_count: usize,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroBackgroundRefreshStatus {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_finished_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<i64>,
    #[serde(default)]
    pub last_success_count: usize,
    #[serde(default)]
    pub last_failed_count: usize,
    #[serde(default)]
    pub last_errors: Vec<String>,
    #[serde(default)]
    pub history: Vec<KiroBackgroundRefreshHistoryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KiroAccountProtectedFile {
    version: String,
    protected_by: String,
    data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroInstanceInfo {
    pub account_id: String,
    pub account_email: String,
    pub instance_dir: String,
    pub home_dir: String,
    pub user_data_dir: String,
    pub identity_path: String,
    pub identity_ready: bool,
    pub machine_id: Option<String>,
    pub service_machine_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_started_at: Option<i64>,
    pub running: bool,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroLocalBackupInfo {
    pub id: String,
    pub backup_dir: String,
    pub created_at: i64,
    pub auth_exists: bool,
    pub profile_exists: bool,
    pub state_db_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KiroInstanceMeta {
    account_id: String,
    account_email: String,
    created_at: i64,
    updated_at: i64,
    last_started_at: Option<i64>,
    pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KiroInstanceIdentity {
    version: String,
    machine_id: String,
    mac_machine_id: String,
    dev_device_id: String,
    sqm_id: String,
    service_machine_id: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroExportOptions {
    #[serde(default)]
    pub include_sensitive: bool,
    #[serde(default)]
    pub account_ids: Vec<String>,
}

#[derive(Debug)]
struct LocalKiroBackup {
    auth_path: PathBuf,
    profile_path: PathBuf,
    state_db_path: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct OAuthCallbackData {
    login_option: String,
    code: Option<String>,
    issuer_url: Option<String>,
    idc_region: Option<String>,
    path: String,
    client_id: Option<String>,
    scopes: Option<String>,
    login_hint: Option<String>,
    audience: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PendingOAuthState {
    login_id: String,
    expires_at: i64,
    verification_uri: String,
    verification_uri_complete: String,
    callback_url: String,
    callback_port: u16,
    state_token: String,
    code_verifier: String,
    callback_result: Option<Result<OAuthCallbackData, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroAccountInput {
    pub email: Option<String>,
    pub user_id: Option<String>,
    pub login_provider: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: Option<String>,
    pub expires_at: Option<i64>,
}

#[tauri::command]
pub fn kiro_account_tool_get_state() -> Result<KiroAccountToolState, String> {
    let accounts = list_accounts()?;
    let index = load_index()?;
    Ok(KiroAccountToolState {
        accounts,
        current_account_id: index.current_account_id,
        index_path: index_path()?.to_string_lossy().to_string(),
        accounts_dir: accounts_dir()?.to_string_lossy().to_string(),
        local_auth_path: local_auth_token_path()?.to_string_lossy().to_string(),
        local_profile_path: local_profile_path()?.to_string_lossy().to_string(),
        local_state_db_path: local_state_db_path()?.to_string_lossy().to_string(),
        kiro_exe_path: detect_kiro_exe_path().map(|path| path.to_string_lossy().to_string()),
        pending_oauth: pending_oauth_response(),
        background_refresh: load_background_refresh_settings(),
        background_status: load_background_refresh_status(),
        tool_settings: load_tool_settings(),
    })
}

#[tauri::command]
pub fn kiro_account_tool_get_fast_state() -> Result<KiroAccountFastState, String> {
    let index = load_index()?;
    Ok(KiroAccountFastState {
        accounts: index.accounts,
        current_account_id: index.current_account_id,
        index_path: index_path()?.to_string_lossy().to_string(),
        accounts_dir: accounts_dir()?.to_string_lossy().to_string(),
        pending_oauth: pending_oauth_response(),
        background_refresh: load_background_refresh_settings(),
        background_status: load_background_refresh_status(),
        tool_settings: load_tool_settings(),
    })
}

#[tauri::command]
pub fn kiro_account_tool_list_accounts() -> Result<Vec<KiroAccount>, String> {
    list_accounts()
}

#[tauri::command]
pub fn kiro_account_tool_local_status() -> Result<KiroLocalStatus, String> {
    let auth_path = local_auth_token_path()?;
    let profile_path = local_profile_path()?;
    let state_db_path = local_state_db_path()?;
    let detected_exe = detect_kiro_exe_with_source();
    Ok(KiroLocalStatus {
        auth_exists: auth_path.exists(),
        profile_exists: profile_path.exists(),
        state_db_exists: state_db_path.exists(),
        kiro_exe_path: detected_exe
            .as_ref()
            .map(|(path, _)| path.to_string_lossy().to_string()),
        kiro_exe_source: detected_exe.map(|(_, source)| source),
        manual_kiro_exe_path: load_tool_settings().manual_kiro_exe_path,
        auth_path: auth_path.to_string_lossy().to_string(),
        profile_path: profile_path.to_string_lossy().to_string(),
        state_db_path: state_db_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn kiro_account_tool_oauth_start() -> Result<KiroOAuthStartResponse, String> {
    start_oauth_login()
}

#[tauri::command]
pub async fn kiro_account_tool_oauth_complete(login_id: String) -> Result<KiroAccount, String> {
    let account = complete_oauth_login(&login_id).await?;
    upsert_account(account)
}

#[tauri::command]
pub fn kiro_account_tool_oauth_cancel(login_id: Option<String>) -> Result<(), String> {
    cancel_oauth_login(login_id.as_deref())
}

#[tauri::command]
pub fn kiro_account_tool_oauth_submit_callback_url(
    login_id: String,
    callback_url: String,
) -> Result<(), String> {
    submit_oauth_callback_url(&login_id, &callback_url)
}

#[tauri::command]
pub fn kiro_account_tool_import_local() -> Result<Vec<KiroAccount>, String> {
    let auth_raw = read_json_optional(&local_auth_token_path()?)?.ok_or_else(|| {
        "未找到 Kiro 本机登录信息：~/.aws/sso/cache/kiro-auth-token.json".to_string()
    })?;
    let profile_raw = read_json_optional(&local_profile_path()?)?;
    let usage_raw = read_usage_snapshot_optional()?;
    let account = account_from_raw(auth_raw, profile_raw, usage_raw, Vec::new())?;
    Ok(vec![upsert_account(account)?])
}

#[tauri::command]
pub fn kiro_account_tool_add_token(input: KiroAccountInput) -> Result<KiroAccount, String> {
    let access_token = input.access_token.trim();
    if access_token.is_empty() {
        return Err("Access Token 不能为空".to_string());
    }
    let now = now_ts();
    let email = input
        .email
        .as_deref()
        .and_then(non_empty_string)
        .unwrap_or_else(|| "kiro-account".to_string());
    let auth_raw = serde_json::json!({
        "accessToken": access_token,
        "refreshToken": input.refresh_token,
        "tokenType": input.token_type,
        "expiresAt": input.expires_at,
        "email": email,
        "userId": input.user_id,
        "provider": input.login_provider,
    });
    let account = KiroAccount {
        id: stable_account_id(
            input.user_id.as_deref(),
            Some(email.as_str()),
            input.refresh_token.as_deref().or(Some(access_token)),
        ),
        email,
        user_id: input.user_id.and_then(|value| non_empty_string(&value)),
        login_provider: input
            .login_provider
            .and_then(|value| non_empty_string(&value)),
        idc_region: None,
        issuer_url: None,
        client_id: None,
        scopes: None,
        login_hint: None,
        tags: normalize_tags(input.tags),
        access_token: access_token.to_string(),
        refresh_token: input
            .refresh_token
            .and_then(|value| non_empty_string(&value)),
        token_type: input.token_type.and_then(|value| non_empty_string(&value)),
        expires_at: input.expires_at,
        plan_name: None,
        plan_tier: None,
        credits_total: None,
        credits_used: None,
        bonus_total: None,
        bonus_used: None,
        usage_reset_at: None,
        status: None,
        status_reason: None,
        quota_query_last_error: None,
        quota_query_last_error_at: None,
        usage_updated_at: None,
        auth_raw: Some(auth_raw),
        profile_raw: None,
        usage_raw: None,
        created_at: now,
        last_used: now,
    };
    upsert_account(account)
}

#[tauri::command]
pub fn kiro_account_tool_import_json(json_content: String) -> Result<Vec<KiroAccount>, String> {
    let value: Value = serde_json::from_str(&json_content)
        .map_err(|error| format!("解析 JSON 失败: {}", error))?;
    let values = match value {
        Value::Array(items) => items,
        Value::Object(mut object) => object
            .remove("accounts")
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_else(|| vec![Value::Object(object)]),
        _ => return Err("Kiro 账号 JSON 必须是对象、数组，或包含 accounts 数组".to_string()),
    };
    if values.is_empty() {
        return Err("导入内容为空".to_string());
    }
    let mut imported = Vec::with_capacity(values.len());
    for (index, value) in values.into_iter().enumerate() {
        let account = parse_import_account(value)
            .map_err(|error| format!("第 {} 条账号解析失败: {}", index + 1, error))?;
        imported.push(upsert_account(account)?);
    }
    Ok(imported)
}

#[tauri::command]
pub async fn kiro_account_tool_refresh_account(account_id: String) -> Result<KiroAccount, String> {
    let account = load_account_required(&account_id)?;
    let refreshed = refresh_account_remote(account).await?;
    save_refreshed_account(refreshed)
}

#[tauri::command]
pub async fn kiro_account_tool_refresh_all() -> Result<KiroRefreshAllResult, String> {
    let accounts = list_accounts()?;
    if accounts.is_empty() {
        return Ok(KiroRefreshAllResult {
            success_count: 0,
            failed_count: 0,
            errors: Vec::new(),
            started_at: Some(now_ts()),
            finished_at: Some(now_ts()),
        });
    }

    let started_at = now_ts();
    let mut result = KiroRefreshAllResult {
        success_count: 0,
        failed_count: 0,
        errors: Vec::new(),
        started_at: Some(started_at),
        finished_at: None,
    };
    for account in accounts {
        let label = display_email(&account);
        match refresh_account_remote(account)
            .await
            .and_then(save_refreshed_account)
        {
            Ok(_) => result.success_count += 1,
            Err(error) => {
                result.failed_count += 1;
                result.errors.push(format!("{}：{}", label, error));
            }
        }
    }
    result.finished_at = Some(now_ts());
    Ok(result)
}

#[tauri::command]
pub async fn kiro_account_tool_refresh_stale(
    max_age_seconds: Option<i64>,
) -> Result<KiroRefreshAllResult, String> {
    let max_age_seconds = max_age_seconds.unwrap_or(6 * 60 * 60).max(60);
    refresh_stale_accounts(max_age_seconds).await
}

async fn refresh_stale_accounts(max_age_seconds: i64) -> Result<KiroRefreshAllResult, String> {
    let now = now_ts();
    let started_at = now;
    let accounts = list_accounts()?
        .into_iter()
        .filter(|account| {
            let token_expiring = account
                .expires_at
                .map(|expires_at| expires_at <= now + 15 * 60)
                .unwrap_or(false);
            let usage_stale = account
                .usage_updated_at
                .map(|updated_at| now.saturating_sub(updated_at) >= max_age_seconds)
                .unwrap_or(true);
            token_expiring || usage_stale || account.status.as_deref() == Some(KIRO_STATUS_ERROR)
        })
        .collect::<Vec<_>>();

    let mut result = KiroRefreshAllResult {
        success_count: 0,
        failed_count: 0,
        errors: Vec::new(),
        started_at: Some(started_at),
        finished_at: None,
    };
    for account in accounts {
        let label = display_email(&account);
        match refresh_account_remote(account)
            .await
            .and_then(save_refreshed_account)
        {
            Ok(_) => result.success_count += 1,
            Err(error) => {
                result.failed_count += 1;
                result.errors.push(format!("{}：{}", label, error));
            }
        }
    }
    result.finished_at = Some(now_ts());
    Ok(result)
}

#[tauri::command]
pub fn kiro_account_tool_export(account_ids: Vec<String>) -> Result<String, String> {
    export_accounts(KiroExportOptions {
        include_sensitive: true,
        account_ids,
    })
}

#[tauri::command]
pub fn kiro_account_tool_export_safe(options: KiroExportOptions) -> Result<String, String> {
    export_accounts(options)
}

#[tauri::command]
pub fn kiro_account_tool_set_tool_settings(
    settings: KiroToolSettings,
) -> Result<KiroToolSettings, String> {
    let settings = normalize_tool_settings(settings);
    save_tool_settings(&settings)?;
    if settings.encrypt_accounts {
        encrypt_existing_account_files()?;
    }
    Ok(settings)
}

#[tauri::command]
pub fn kiro_account_tool_list_instances() -> Result<Vec<KiroInstanceInfo>, String> {
    list_instances()
}

#[tauri::command]
pub fn kiro_account_tool_stop_instance(account_id: String) -> Result<(), String> {
    stop_instance(&account_id)
}

#[tauri::command]
pub fn kiro_account_tool_clean_instance(
    account_id: String,
    stop_first: bool,
) -> Result<(), String> {
    clean_instance(&account_id, stop_first)
}

#[tauri::command]
pub fn kiro_account_tool_list_local_backups() -> Result<Vec<KiroLocalBackupInfo>, String> {
    list_local_backups()
}

#[tauri::command]
pub fn kiro_account_tool_restore_local_backup(backup_id: String) -> Result<String, String> {
    restore_local_backup_by_id(&backup_id)?;
    Ok("已恢复所选 Kiro 本机状态备份".to_string())
}

#[tauri::command]
pub fn kiro_account_tool_get_background_status() -> Result<KiroBackgroundRefreshStatus, String> {
    Ok(load_background_refresh_status())
}

#[tauri::command]
pub fn kiro_account_tool_update_tags(
    account_id: String,
    tags: Vec<String>,
) -> Result<KiroAccount, String> {
    let mut account = load_account_required(&account_id)?;
    account.tags = normalize_tags(tags);
    save_account(&account)?;
    rebuild_index(Some(account.id.clone()))?;
    Ok(account)
}

#[tauri::command]
pub fn kiro_account_tool_delete(account_id: String) -> Result<(), String> {
    let id = normalize_account_id(&account_id)?;
    let path = account_file_path(&id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("删除账号文件失败: {}", error))?;
    }
    rebuild_index(None)?;
    Ok(())
}

#[tauri::command]
pub fn kiro_account_tool_switch(account_id: String, launch: bool) -> Result<String, String> {
    let mut account = load_account_required(&account_id)?;
    let backup = backup_local_kiro_state()?;
    if let Err(error) = write_account_to_local(&account) {
        let restore_result = restore_local_kiro_state(&backup);
        return Err(match restore_result {
            Ok(()) => format!("切换账号失败，已恢复原本机状态：{}", error),
            Err(restore_error) => format!(
                "切换账号失败，且恢复原本机状态失败：{}；恢复错误：{}",
                error, restore_error
            ),
        });
    }
    account.last_used = now_ts();
    save_account(&account)?;
    let mut index = rebuild_index(Some(account.id.clone()))?;
    index.current_account_id = Some(account.id.clone());
    save_index(&index)?;

    if launch {
        match start_kiro() {
            Ok(()) => Ok(format!("已切换并启动 Kiro：{}", display_email(&account))),
            Err(error) => Ok(format!("已切换账号，但启动 Kiro 失败：{}", error)),
        }
    } else {
        Ok(format!("已切换账号：{}", display_email(&account)))
    }
}

#[tauri::command]
pub fn kiro_account_tool_launch() -> Result<(), String> {
    start_kiro()
}

#[tauri::command]
pub fn kiro_account_tool_reveal_data_dir() -> Result<String, String> {
    let path = data_dir()?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn kiro_account_tool_launch_isolated(account_id: String) -> Result<String, String> {
    let account = load_account_required(&account_id)?;
    start_kiro_isolated(&account)?;
    Ok(format!("已启动隔离 Kiro 实例：{}", display_email(&account)))
}

#[tauri::command]
pub fn kiro_account_tool_set_background_refresh(
    settings: KiroBackgroundRefreshSettings,
    app_handle: tauri::AppHandle,
) -> Result<KiroBackgroundRefreshSettings, String> {
    let settings = normalize_background_refresh_settings(settings);
    save_background_refresh_settings(&settings)?;
    ensure_kiro_background_tray(&app_handle)?;
    if settings.enabled {
        start_kiro_background_refresh(app_handle);
    }
    Ok(settings)
}

#[tauri::command]
pub fn kiro_account_tool_get_background_refresh() -> Result<KiroBackgroundRefreshSettings, String> {
    Ok(load_background_refresh_settings())
}

fn now_ts() -> i64 {
    Utc::now().timestamp()
}

fn data_dir() -> Result<PathBuf, String> {
    let app_data = std::env::var("APPDATA").map_err(|_| "无法获取 APPDATA".to_string())?;
    let dir = PathBuf::from(app_data).join("McStartUP").join("kiro");
    fs::create_dir_all(&dir).map_err(|error| format!("创建 Kiro 数据目录失败: {}", error))?;
    Ok(dir)
}

fn oauth_state_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(OAUTH_STATE_FILE))
}

fn background_refresh_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(BACKGROUND_REFRESH_FILE))
}

fn background_refresh_status_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(BACKGROUND_REFRESH_STATUS_FILE))
}

fn tool_settings_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(KIRO_TOOL_SETTINGS_FILE))
}

fn local_backup_root_dir() -> Result<PathBuf, String> {
    let dir = data_dir()?.join(KIRO_LOCAL_BACKUP_DIR);
    fs::create_dir_all(&dir).map_err(|error| format!("创建 Kiro 本机备份目录失败: {}", error))?;
    Ok(dir)
}

fn instances_root_dir() -> Result<PathBuf, String> {
    let dir = data_dir()?.join(KIRO_INSTANCE_DIR);
    fs::create_dir_all(&dir).map_err(|error| format!("创建 Kiro 隔离实例目录失败: {}", error))?;
    Ok(dir)
}

fn isolated_home_dir(account_id: &str) -> Result<PathBuf, String> {
    let dir = isolated_instance_dir(account_id)?.join("home");
    fs::create_dir_all(&dir).map_err(|error| format!("创建隔离 HOME 目录失败: {}", error))?;
    Ok(dir)
}

fn isolated_user_data_dir(account_id: &str) -> Result<PathBuf, String> {
    let dir = isolated_instance_dir(account_id)?.join("user-data");
    fs::create_dir_all(&dir).map_err(|error| format!("创建隔离 Kiro 数据目录失败: {}", error))?;
    Ok(dir)
}

fn isolated_machine_id_path(user_data_dir: &Path) -> PathBuf {
    user_data_dir.join("machineid")
}

fn isolated_storage_json_path(user_data_dir: &Path) -> PathBuf {
    user_data_dir
        .join("User")
        .join("globalStorage")
        .join("storage.json")
}

fn isolated_instance_dir(account_id: &str) -> Result<PathBuf, String> {
    Ok(instances_root_dir()?.join(normalize_account_id(account_id)?))
}

fn default_background_interval_minutes() -> i64 {
    30
}

fn default_true() -> bool {
    true
}

fn normalize_background_refresh_settings(
    mut settings: KiroBackgroundRefreshSettings,
) -> KiroBackgroundRefreshSettings {
    settings.interval_minutes = settings.interval_minutes.clamp(5, 24 * 60);
    settings
}

fn load_background_refresh_settings() -> KiroBackgroundRefreshSettings {
    let path = match background_refresh_path() {
        Ok(path) => path,
        Err(_) => {
            return KiroBackgroundRefreshSettings {
                enabled: false,
                interval_minutes: default_background_interval_minutes(),
                notify_on_change: true,
            }
        }
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<KiroBackgroundRefreshSettings>(&content).ok())
        .map(normalize_background_refresh_settings)
        .unwrap_or(KiroBackgroundRefreshSettings {
            enabled: false,
            interval_minutes: default_background_interval_minutes(),
            notify_on_change: true,
        })
}

fn normalize_tool_settings(mut settings: KiroToolSettings) -> KiroToolSettings {
    settings.manual_kiro_exe_path = settings
        .manual_kiro_exe_path
        .and_then(|path| non_empty_string(path.trim_matches('"')));
    settings
}

fn load_tool_settings() -> KiroToolSettings {
    let path = match tool_settings_path() {
        Ok(path) => path,
        Err(_) => {
            return KiroToolSettings {
                manual_kiro_exe_path: None,
                encrypt_accounts: true,
                export_include_sensitive_default: false,
            }
        }
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<KiroToolSettings>(&content).ok())
        .map(normalize_tool_settings)
        .unwrap_or(KiroToolSettings {
            manual_kiro_exe_path: None,
            encrypt_accounts: true,
            export_include_sensitive_default: false,
        })
}

fn save_tool_settings(settings: &KiroToolSettings) -> Result<(), String> {
    let path = tool_settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建 Kiro 设置目录失败: {}", error))?;
    }
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("序列化 Kiro 设置失败: {}", error))?;
    fs::write(path, content).map_err(|error| format!("保存 Kiro 设置失败: {}", error))
}

fn load_background_refresh_status() -> KiroBackgroundRefreshStatus {
    let path = match background_refresh_status_path() {
        Ok(path) => path,
        Err(_) => return default_background_refresh_status(),
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<KiroBackgroundRefreshStatus>(&content).ok())
        .map(normalize_background_refresh_status)
        .unwrap_or_else(default_background_refresh_status)
}

fn save_background_refresh_status(status: &KiroBackgroundRefreshStatus) -> Result<(), String> {
    let path = background_refresh_status_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建后台刷新状态目录失败: {}", error))?;
    }
    let content =
        serde_json::to_string_pretty(&normalize_background_refresh_status(status.clone()))
            .map_err(|error| format!("序列化后台刷新状态失败: {}", error))?;
    fs::write(path, content).map_err(|error| format!("保存后台刷新状态失败: {}", error))
}

fn default_background_refresh_status() -> KiroBackgroundRefreshStatus {
    KiroBackgroundRefreshStatus {
        last_started_at: None,
        last_finished_at: None,
        next_run_at: None,
        last_success_count: 0,
        last_failed_count: 0,
        last_errors: Vec::new(),
        history: Vec::new(),
    }
}

fn normalize_background_refresh_status(
    mut status: KiroBackgroundRefreshStatus,
) -> KiroBackgroundRefreshStatus {
    if status.history.len() > MAX_BACKGROUND_HISTORY {
        status.history.truncate(MAX_BACKGROUND_HISTORY);
    }
    status
}

fn record_background_refresh_result(
    settings: &KiroBackgroundRefreshSettings,
    result: &KiroRefreshAllResult,
) {
    let started_at = result.started_at.unwrap_or_else(now_ts);
    let finished_at = result.finished_at.unwrap_or_else(now_ts);
    let mut status = load_background_refresh_status();
    status.last_started_at = Some(started_at);
    status.last_finished_at = Some(finished_at);
    status.next_run_at = Some(finished_at + settings.interval_minutes.saturating_mul(60).max(60));
    status.last_success_count = result.success_count;
    status.last_failed_count = result.failed_count;
    status.last_errors = result.errors.clone();
    status.history.insert(
        0,
        KiroBackgroundRefreshHistoryItem {
            started_at,
            finished_at,
            success_count: result.success_count,
            failed_count: result.failed_count,
            errors: result.errors.clone(),
        },
    );
    let _ = save_background_refresh_status(&status);
}

fn save_background_refresh_settings(
    settings: &KiroBackgroundRefreshSettings,
) -> Result<(), String> {
    let path = background_refresh_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建后台刷新设置目录失败: {}", error))?;
    }
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("序列化后台刷新设置失败: {}", error))?;
    fs::write(path, content).map_err(|error| format!("保存后台刷新设置失败: {}", error))
}

fn load_pending_oauth_from_disk() -> Option<PendingOAuthState> {
    let path = oauth_state_path().ok()?;
    let content = fs::read_to_string(&path).ok()?;
    let state = serde_json::from_str::<PendingOAuthState>(&content).ok()?;
    if state.expires_at <= now_ts() {
        let _ = fs::remove_file(path);
        None
    } else {
        Some(state)
    }
}

fn persist_pending_oauth(state: Option<&PendingOAuthState>) {
    let Ok(path) = oauth_state_path() else {
        return;
    };
    match state {
        Some(value) => {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(content) = serde_json::to_string_pretty(value) {
                let _ = fs::write(path, content);
            }
        }
        None => {
            let _ = fs::remove_file(path);
        }
    }
}

fn accounts_dir() -> Result<PathBuf, String> {
    let dir = data_dir()?.join(ACCOUNTS_DIR);
    fs::create_dir_all(&dir).map_err(|error| format!("创建 Kiro 账号目录失败: {}", error))?;
    Ok(dir)
}

fn index_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join(ACCOUNTS_INDEX_FILE))
}

fn account_file_path(account_id: &str) -> Result<PathBuf, String> {
    let id = normalize_account_id(account_id)?;
    Ok(accounts_dir()?.join(format!("{}.json", id)))
}

fn normalize_account_id(value: &str) -> Result<String, String> {
    let id = value.trim();
    if id.is_empty() {
        return Err("账号 ID 不能为空".to_string());
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("账号 ID 非法".to_string());
    }
    if !id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.')
    {
        return Err("账号 ID 只能包含字母、数字、._-".to_string());
    }
    Ok(id.to_string())
}

fn stable_account_id(
    user_id: Option<&str>,
    email: Option<&str>,
    token_seed: Option<&str>,
) -> String {
    let seed = user_id
        .and_then(non_empty_string)
        .or_else(|| email.and_then(non_empty_string))
        .or_else(|| token_seed.and_then(non_empty_string))
        .unwrap_or_else(|| format!("anonymous_{}", now_ts()));
    format!("kiro_{:x}", md5::compute(seed.as_bytes()))
}

fn load_index() -> Result<KiroAccountIndex, String> {
    let path = index_path()?;
    if !path.exists() {
        return Ok(KiroAccountIndex {
            version: "1.0".to_string(),
            accounts: Vec::new(),
            current_account_id: None,
        });
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("读取索引失败: {}", error))?;
    serde_json::from_str::<KiroAccountIndex>(&content)
        .map_err(|error| format!("解析索引失败: {}", error))
}

fn save_index(index: &KiroAccountIndex) -> Result<(), String> {
    let path = index_path()?;
    let content = serde_json::to_string_pretty(index)
        .map_err(|error| format!("序列化索引失败: {}", error))?;
    fs::write(&path, content).map_err(|error| format!("保存索引失败: {}", error))
}

fn rebuild_index(preferred_current: Option<String>) -> Result<KiroAccountIndex, String> {
    let previous = load_index().unwrap_or(KiroAccountIndex {
        version: "1.0".to_string(),
        accounts: Vec::new(),
        current_account_id: None,
    });
    let accounts = list_accounts()?;
    let summaries = accounts
        .iter()
        .map(KiroAccount::summary)
        .collect::<Vec<_>>();
    let current = preferred_current
        .or(previous.current_account_id)
        .filter(|id| summaries.iter().any(|account| account.id == *id));
    let index = KiroAccountIndex {
        version: "1.0".to_string(),
        accounts: summaries,
        current_account_id: current,
    };
    save_index(&index)?;
    Ok(index)
}

fn load_account(account_id: &str) -> Result<Option<KiroAccount>, String> {
    let path = account_file_path(account_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("读取账号失败: {}", error))?;
    parse_account_file_content(&content)
        .map(Some)
        .map_err(|error| format!("解析账号失败: {}", error))
}

fn load_account_required(account_id: &str) -> Result<KiroAccount, String> {
    load_account(account_id)?.ok_or_else(|| format!("账号不存在: {}", account_id))
}

fn save_account(account: &KiroAccount) -> Result<(), String> {
    let path = account_file_path(&account.id)?;
    let content = serialize_account_file(account)?;
    fs::write(&path, content).map_err(|error| format!("保存账号失败: {}", error))
}

fn parse_account_file_content(content: &str) -> Result<KiroAccount, String> {
    if let Ok(protected) = serde_json::from_str::<KiroAccountProtectedFile>(content) {
        if protected.protected_by == ACCOUNT_FILE_PROTECTED_BY {
            let encrypted = base64::engine::general_purpose::STANDARD
                .decode(protected.data.as_bytes())
                .map_err(|error| format!("解析账号密文失败: {}", error))?;
            let decrypted = dpapi_unprotect(&encrypted)?;
            return serde_json::from_slice::<KiroAccount>(&decrypted)
                .map_err(|error| format!("解析解密后的账号失败: {}", error));
        }
    }
    serde_json::from_str::<KiroAccount>(content)
        .map_err(|error| format!("解析账号 JSON 失败: {}", error))
}

fn serialize_account_file(account: &KiroAccount) -> Result<String, String> {
    let plain =
        serde_json::to_vec(account).map_err(|error| format!("序列化账号失败: {}", error))?;
    if load_tool_settings().encrypt_accounts {
        let protected = KiroAccountProtectedFile {
            version: "1.0".to_string(),
            protected_by: ACCOUNT_FILE_PROTECTED_BY.to_string(),
            data: base64::engine::general_purpose::STANDARD.encode(dpapi_protect(&plain)?),
        };
        serde_json::to_string_pretty(&protected)
            .map_err(|error| format!("序列化加密账号失败: {}", error))
    } else {
        serde_json::to_string_pretty(account).map_err(|error| format!("序列化账号失败: {}", error))
    }
}

fn encrypt_existing_account_files() -> Result<(), String> {
    let accounts = list_accounts()?;
    for account in accounts {
        save_account(&account)?;
    }
    Ok(())
}

fn list_accounts() -> Result<Vec<KiroAccount>, String> {
    let dir = accounts_dir()?;
    let mut accounts = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| format!("读取账号目录失败: {}", error))?
    {
        let entry = entry.map_err(|error| format!("读取账号目录项失败: {}", error))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let content =
            fs::read_to_string(&path).map_err(|error| format!("读取账号文件失败: {}", error))?;
        let mut account = parse_account_file_content(&content)
            .map_err(|error| format!("解析账号文件失败({}): {}", path.display(), error))?;
        account.tags = normalize_tags(account.tags);
        if account.access_token.trim().is_empty() {
            continue;
        }
        accounts.push(account);
    }
    accounts.sort_by(|left, right| right.last_used.cmp(&left.last_used));
    Ok(accounts)
}

fn upsert_account(mut account: KiroAccount) -> Result<KiroAccount, String> {
    if let Some(existing) = load_account(&account.id)? {
        account.created_at = existing.created_at;
        if account.tags.is_empty() {
            account.tags = existing.tags;
        }
        if account.idc_region.is_none() {
            account.idc_region = existing.idc_region;
        }
        if account.issuer_url.is_none() {
            account.issuer_url = existing.issuer_url;
        }
        if account.client_id.is_none() {
            account.client_id = existing.client_id;
        }
        if account.scopes.is_none() {
            account.scopes = existing.scopes;
        }
        if account.login_hint.is_none() {
            account.login_hint = existing.login_hint;
        }
        if account.status.is_none() {
            account.status = existing.status;
            account.status_reason = existing.status_reason;
            account.quota_query_last_error = existing.quota_query_last_error;
            account.quota_query_last_error_at = existing.quota_query_last_error_at;
        }
    }
    if account.created_at <= 0 {
        account.created_at = now_ts();
    }
    account.last_used = now_ts();
    save_account(&account)?;
    rebuild_index(Some(account.id.clone()))?;
    Ok(account)
}

fn save_refreshed_account(mut account: KiroAccount) -> Result<KiroAccount, String> {
    let previous_index = load_index().unwrap_or(KiroAccountIndex {
        version: "1.0".to_string(),
        accounts: Vec::new(),
        current_account_id: None,
    });
    if let Some(existing) = load_account(&account.id)? {
        account.created_at = existing.created_at;
        account.tags = if account.tags.is_empty() {
            existing.tags
        } else {
            normalize_tags(account.tags)
        };
        account.last_used = existing.last_used;
    }
    if account.created_at <= 0 {
        account.created_at = now_ts();
    }
    save_account(&account)?;
    rebuild_index(previous_index.current_account_id)?;
    Ok(account)
}

fn export_accounts(options: KiroExportOptions) -> Result<String, String> {
    let ids = options
        .account_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    let mut accounts = if ids.is_empty() {
        list_accounts()?
    } else {
        ids.into_iter()
            .filter_map(|id| load_account(id).ok().flatten())
            .collect::<Vec<_>>()
    };
    if !options.include_sensitive {
        accounts
            .iter_mut()
            .for_each(redact_account_sensitive_fields);
    }
    serde_json::to_string_pretty(&accounts).map_err(|error| format!("导出 JSON 失败: {}", error))
}

fn redact_account_sensitive_fields(account: &mut KiroAccount) {
    account.access_token = String::new();
    account.refresh_token = None;
    account.token_type = None;
    account.auth_raw = account.auth_raw.take().map(redact_sensitive_json);
}

fn redact_sensitive_json(value: Value) -> Value {
    match value {
        Value::Object(mut object) => {
            for key in object.keys().cloned().collect::<Vec<_>>() {
                let lower = key.to_ascii_lowercase();
                if lower.contains("token")
                    || lower.contains("secret")
                    || lower == "code"
                    || lower == "authorization"
                {
                    object.insert(key, Value::String("[redacted]".to_string()));
                } else if let Some(child) = object.remove(&key) {
                    object.insert(key, redact_sensitive_json(child));
                }
            }
            Value::Object(object)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(redact_sensitive_json).collect()),
        other => other,
    }
}

impl KiroAccount {
    fn summary(&self) -> KiroAccountSummary {
        KiroAccountSummary {
            id: self.id.clone(),
            email: self.email.clone(),
            tags: self.tags.clone(),
            plan_name: self.plan_name.clone(),
            created_at: self.created_at,
            last_used: self.last_used,
        }
    }
}

fn oauth_state() -> &'static Mutex<Option<PendingOAuthState>> {
    PENDING_OAUTH_STATE.get_or_init(|| Mutex::new(None))
}

fn hydrate_pending_oauth_if_missing() {
    let Ok(mut guard) = oauth_state().lock() else {
        return;
    };
    let current_valid = guard
        .as_ref()
        .map(|state| state.expires_at > now_ts())
        .unwrap_or(false);
    if current_valid {
        return;
    }
    *guard = load_pending_oauth_from_disk();
    if let Some(state) = guard.as_ref() {
        ensure_callback_server(state);
    }
}

fn pending_oauth_response() -> Option<KiroOAuthStartResponse> {
    hydrate_pending_oauth_if_missing();
    let state = oauth_state().lock().ok()?.clone()?;
    if state.expires_at <= now_ts() {
        let _ = cancel_oauth_login(Some(state.login_id.as_str()));
        return None;
    }
    ensure_callback_server(&state);
    Some(KiroOAuthStartResponse {
        login_id: state.login_id,
        verification_uri: state.verification_uri,
        verification_uri_complete: Some(state.verification_uri_complete),
        callback_url: Some(state.callback_url),
        expires_in: (state.expires_at - now_ts()).max(0),
        interval_seconds: 1,
    })
}

fn generate_oauth_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes = (0..24).map(|_| rng.gen::<u8>()).collect::<Vec<_>>();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn generate_code_challenge(code_verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let digest = hasher.finalize();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

fn build_portal_auth_url(state_token: &str, code_challenge: &str, redirect_uri: &str) -> String {
    format!(
        "{}?state={}&code_challenge={}&code_challenge_method=S256&redirect_uri={}&redirect_from=KiroIDE",
        KIRO_AUTH_PORTAL_URL,
        urlencoding::encode(state_token),
        urlencoding::encode(code_challenge),
        urlencoding::encode(redirect_uri),
    )
}

fn find_available_callback_port() -> Result<u16, String> {
    for port in CALLBACK_PORT_CANDIDATES {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            drop(listener);
            return Ok(port);
        }
    }
    Err("本地 OAuth 回调端口均被占用，请关闭占用进程后重试".to_string())
}

fn start_oauth_login() -> Result<KiroOAuthStartResponse, String> {
    hydrate_pending_oauth_if_missing();
    if let Some(existing) = oauth_state()
        .lock()
        .map_err(|_| "OAuth 状态锁不可用".to_string())?
        .clone()
    {
        if existing.expires_at > now_ts() && existing.callback_result.is_none() {
            ensure_callback_server(&existing);
            return Ok(KiroOAuthStartResponse {
                login_id: existing.login_id,
                verification_uri: existing.verification_uri,
                verification_uri_complete: Some(existing.verification_uri_complete),
                callback_url: Some(existing.callback_url),
                expires_in: (existing.expires_at - now_ts()).max(0),
                interval_seconds: 1,
            });
        }
    }

    let callback_port = find_available_callback_port()?;
    let callback_url = format!("http://localhost:{}", callback_port);
    let state_token = generate_oauth_token();
    let code_verifier = generate_oauth_token();
    let code_challenge = generate_code_challenge(&code_verifier);
    let verification_uri_complete =
        build_portal_auth_url(&state_token, &code_challenge, &callback_url);
    let pending = PendingOAuthState {
        login_id: generate_oauth_token(),
        expires_at: now_ts() + OAUTH_TIMEOUT_SECONDS,
        verification_uri: KIRO_AUTH_PORTAL_URL.to_string(),
        verification_uri_complete,
        callback_url: callback_url.clone(),
        callback_port,
        state_token,
        code_verifier,
        callback_result: None,
    };

    {
        let mut guard = oauth_state()
            .lock()
            .map_err(|_| "OAuth 状态锁不可用".to_string())?;
        *guard = Some(pending.clone());
    }
    persist_pending_oauth(Some(&pending));
    ensure_callback_server(&pending);

    Ok(KiroOAuthStartResponse {
        login_id: pending.login_id,
        verification_uri: pending.verification_uri,
        verification_uri_complete: Some(pending.verification_uri_complete),
        callback_url: Some(callback_url),
        expires_in: OAUTH_TIMEOUT_SECONDS,
        interval_seconds: 1,
    })
}

fn ensure_callback_server(state: &PendingOAuthState) {
    let expected_login_id = state.login_id.clone();
    let expected_state = state.state_token.clone();
    let callback_port = state.callback_port;
    std::thread::spawn(move || {
        if let Err(error) = run_callback_server(
            callback_port,
            expected_login_id.clone(),
            expected_state.clone(),
        ) {
            set_oauth_callback_result(&expected_login_id, &expected_state, Err(error));
        }
    });
}

fn run_callback_server(
    callback_port: u16,
    expected_login_id: String,
    expected_state: String,
) -> Result<(), String> {
    let listener = match TcpListener::bind(("127.0.0.1", callback_port)) {
        Ok(listener) => listener,
        Err(error) if error.kind() == ErrorKind::AddrInUse => return Ok(()),
        Err(error) => return Err(format!("启动 Kiro OAuth 回调服务失败: {}", error)),
    };
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("设置 OAuth 回调监听失败: {}", error))?;
    let started = Instant::now();

    loop {
        if started.elapsed().as_secs() > OAUTH_TIMEOUT_SECONDS as u64 {
            set_oauth_callback_result(
                &expected_login_id,
                &expected_state,
                Err("等待 Kiro 登录超时，请重新发起授权".to_string()),
            );
            break;
        }

        let should_stop = oauth_state()
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
            .map(|state| state.login_id != expected_login_id || state.state_token != expected_state)
            .unwrap_or(true);
        if should_stop {
            break;
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                if handle_callback_stream(&mut stream, &expected_login_id, &expected_state)? {
                    break;
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(error) => return Err(format!("读取 OAuth 回调失败: {}", error)),
        }
    }
    Ok(())
}

fn handle_callback_stream(
    stream: &mut TcpStream,
    expected_login_id: &str,
    expected_state: &str,
) -> Result<bool, String> {
    let mut buffer = [0_u8; 8192];
    let size = stream
        .read(&mut buffer)
        .map_err(|error| format!("读取 OAuth 回调请求失败: {}", error))?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    let request_line = request.lines().next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let _method = parts.next().unwrap_or_default();
    let raw_url = parts.next().unwrap_or("/");
    let (path, query) = raw_url.split_once('?').unwrap_or((raw_url, ""));

    if path == "/cancel" {
        set_oauth_callback_result(
            expected_login_id,
            expected_state,
            Err("登录已取消".to_string()),
        );
        let _ = write_http_response(stream, 200, None, "cancelled");
        return Ok(true);
    }

    if path != "/oauth/callback" && path != "/signin/callback" {
        let _ = write_http_response(stream, 404, None, "Not Found");
        return Ok(false);
    }

    let params = parse_query_params(query);
    if let Some(error_code) = params.get("error") {
        let description = params
            .get("error_description")
            .and_then(|value| non_empty_string(value))
            .unwrap_or_default();
        let message = if description.is_empty() {
            format!("授权失败: {}", error_code)
        } else {
            format!("授权失败: {} ({})", error_code, description)
        };
        set_oauth_callback_result(expected_login_id, expected_state, Err(message.clone()));
        let _ = write_http_response(stream, 302, Some(auth_error_redirect_url(&message)), "");
        return Ok(true);
    }

    let callback_state = params.get("state").cloned().unwrap_or_default();
    if callback_state.is_empty() || callback_state != expected_state {
        let message = "授权状态校验失败，请重新发起登录".to_string();
        set_oauth_callback_result(expected_login_id, expected_state, Err(message.clone()));
        let _ = write_http_response(stream, 302, Some(auth_error_redirect_url(&message)), "");
        return Ok(true);
    }

    let callback = callback_from_params(path, &params);
    set_oauth_callback_result(expected_login_id, expected_state, Ok(callback));
    let _ = write_http_response(stream, 302, Some(auth_success_redirect_url()), "");
    Ok(true)
}

fn write_http_response(
    stream: &mut TcpStream,
    status: u16,
    location: Option<String>,
    body: &str,
) -> Result<(), String> {
    let status_text = match status {
        200 => "OK",
        302 => "Found",
        404 => "Not Found",
        _ => "OK",
    };
    let mut headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        status,
        status_text,
        body.as_bytes().len()
    );
    if let Some(location) = location {
        headers.push_str(format!("Location: {}\r\n", location).as_str());
    }
    headers.push_str("\r\n");
    stream
        .write_all(headers.as_bytes())
        .and_then(|_| stream.write_all(body.as_bytes()))
        .map_err(|error| format!("写入 OAuth 回调响应失败: {}", error))
}

fn set_oauth_callback_result(
    expected_login_id: &str,
    expected_state: &str,
    result: Result<OAuthCallbackData, String>,
) {
    if let Ok(mut guard) = oauth_state().lock() {
        if let Some(state) = guard.as_mut() {
            if state.login_id == expected_login_id && state.state_token == expected_state {
                state.callback_result = Some(result);
                persist_pending_oauth(Some(state));
            }
        }
    }
}

fn cancel_oauth_login(login_id: Option<&str>) -> Result<(), String> {
    let mut guard = oauth_state()
        .lock()
        .map_err(|_| "OAuth 状态锁不可用".to_string())?;
    if let (Some(current), Some(input)) = (guard.as_ref(), login_id) {
        if current.login_id != input {
            return Err("登录会话不匹配，取消失败".to_string());
        }
    }
    *guard = None;
    persist_pending_oauth(None);
    Ok(())
}

fn submit_oauth_callback_url(login_id: &str, callback_url: &str) -> Result<(), String> {
    hydrate_pending_oauth_if_missing();
    let pending = oauth_state()
        .lock()
        .map_err(|_| "OAuth 状态锁不可用".to_string())?
        .clone()
        .ok_or_else(|| "登录流程已取消，请重新发起授权".to_string())?;
    if pending.login_id != login_id {
        return Err("登录会话已变更，请刷新后重试".to_string());
    }
    if pending.expires_at <= now_ts() {
        return Err("等待 Kiro 登录超时，请重新发起授权".to_string());
    }

    let (path, query) = parse_callback_path_and_query(callback_url, pending.callback_port)?;
    if path != "/oauth/callback" && path != "/signin/callback" {
        return Err("回调链接路径无效，必须为 /oauth/callback 或 /signin/callback".to_string());
    }
    let params = parse_query_params(&query);
    if let Some(error_code) = params.get("error") {
        let description = params
            .get("error_description")
            .and_then(|value| non_empty_string(value))
            .unwrap_or_default();
        let message = if description.is_empty() {
            format!("授权失败: {}", error_code)
        } else {
            format!("授权失败: {} ({})", error_code, description)
        };
        set_oauth_callback_result(login_id, &pending.state_token, Err(message.clone()));
        return Err(message);
    }
    let callback_state = params.get("state").cloned().unwrap_or_default();
    if callback_state.is_empty() || callback_state != pending.state_token {
        return Err("授权状态校验失败，请确认粘贴的是当前登录会话链接".to_string());
    }
    set_oauth_callback_result(
        login_id,
        &pending.state_token,
        Ok(callback_from_params(&path, &params)),
    );
    Ok(())
}

async fn complete_oauth_login(login_id: &str) -> Result<KiroAccount, String> {
    hydrate_pending_oauth_if_missing();
    loop {
        let pending = oauth_state()
            .lock()
            .map_err(|_| "OAuth 状态锁不可用".to_string())?
            .clone()
            .ok_or_else(|| "登录流程已取消，请重新发起授权".to_string())?;
        if pending.login_id != login_id {
            return Err("登录会话已变更，请刷新后重试".to_string());
        }
        if pending.expires_at <= now_ts() {
            let _ = cancel_oauth_login(Some(login_id));
            return Err("等待 Kiro 登录超时，请重新发起授权".to_string());
        }
        if let Some(result) = pending.callback_result.clone() {
            let _ = cancel_oauth_login(Some(login_id));
            let callback = result?;
            if callback
                .code
                .as_deref()
                .and_then(non_empty_string)
                .is_none()
            {
                let login_option = callback.login_option.trim().to_ascii_lowercase();
                let reason = match login_option.as_str() {
                    "builderid" | "awsidc" | "internal" => {
                        "当前登录方式需要 Kiro 客户端后续认证流程，暂不支持直接导入，请改用 Google/GitHub 登录。"
                    }
                    "external_idp" => "当前登录方式为 External IdP，未返回授权 code，暂不支持自动导入。",
                    _ => "回调缺少授权 code，无法完成登录。",
                };
                return Err(reason.to_string());
            }
            let redirect_uri = build_token_exchange_redirect_uri(&pending.callback_url, &callback);
            let auth_raw =
                exchange_code_for_token(&callback, &pending.code_verifier, &redirect_uri).await?;
            let account = account_from_raw(auth_raw, None, None, Vec::new())?;
            return Ok(enrich_account_with_runtime_usage(account).await);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn build_token_exchange_redirect_uri(
    base_callback_url: &str,
    callback: &OAuthCallbackData,
) -> String {
    let callback_path = if callback.path.starts_with('/') {
        callback.path.clone()
    } else {
        format!("/{}", callback.path)
    };
    format!(
        "{}{}?login_option={}",
        base_callback_url.trim_end_matches('/'),
        callback_path,
        urlencoding::encode(callback.login_option.as_str()),
    )
}

async fn exchange_code_for_token(
    callback: &OAuthCallbackData,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<Value, String> {
    let code = callback
        .code
        .as_deref()
        .and_then(non_empty_string)
        .ok_or_else(|| "Kiro 回调缺少 code，无法完成登录".to_string())?;
    let response = reqwest::Client::new()
        .post(KIRO_TOKEN_ENDPOINT)
        .header("Content-Type", "application/json")
        .json(&json!({
            "code": code,
            "code_verifier": code_verifier,
            "redirect_uri": redirect_uri
        }))
        .send()
        .await
        .map_err(|error| format!("请求 Kiro oauth/token 接口失败: {}", error))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "<no-body>".to_string());
    if !status.is_success() {
        return Err(format!(
            "Kiro oauth/token 接口返回异常: status={}, body_len={}",
            status,
            body.len()
        ));
    }
    let mut token = unwrap_token_response(
        serde_json::from_str::<Value>(&body)
            .map_err(|error| format!("解析 Kiro oauth/token 响应失败: {}", error))?,
    );
    inject_callback_context_into_token(&mut token, callback);
    Ok(token)
}

async fn refresh_account_remote(mut account: KiroAccount) -> Result<KiroAccount, String> {
    let Some(refresh_token) = account.refresh_token.as_deref().and_then(non_empty_string) else {
        return Err("账号缺少 refresh_token，无法刷新 Kiro 登录态".to_string());
    };

    let mut account_auth = account.auth_raw.clone().unwrap_or_else(|| json!({}));
    merge_account_context_into_auth(&mut account_auth, &account);
    let mut refresh_errors = Vec::new();
    let refreshed_auth = if should_prefer_idc_refresh(&account_auth, &account) {
        match refresh_token_via_idc_oidc(&refresh_token, &account_auth, &account).await {
            Ok(token) => Some(token),
            Err(error) => {
                refresh_errors.push(format!("AWS IAM Identity Center OIDC 刷新失败: {}", error));
                None
            }
        }
    } else {
        None
    };

    let refreshed_auth = match refreshed_auth {
        Some(token) => Ok(token),
        None => refresh_token_via_remote(&refresh_token)
            .await
            .map_err(|error| {
                refresh_errors.push(format!("Kiro refreshToken 接口失败: {}", error));
                refresh_errors.join("；")
            }),
    };

    match refreshed_auth {
        Ok(mut auth_raw) => {
            merge_account_context_into_auth(&mut auth_raw, &account);
            let tags = account.tags.clone();
            let mut refreshed = account_from_raw(
                auth_raw,
                account.profile_raw.clone(),
                account.usage_raw.clone(),
                tags,
            )?;
            refreshed.created_at = account.created_at;
            refreshed.last_used = account.last_used;
            account = refreshed;
        }
        Err(error) => {
            account.status = Some(KIRO_STATUS_ERROR.to_string());
            account.status_reason = Some(error.clone());
            account.quota_query_last_error = Some(error.clone());
            account.quota_query_last_error_at = Some(now_ts());
            save_account(&account)?;
            return Err(error);
        }
    }

    Ok(enrich_account_with_runtime_usage(account).await)
}

async fn refresh_token_via_remote(refresh_token: &str) -> Result<Value, String> {
    let response = reqwest::Client::new()
        .post(KIRO_REFRESH_ENDPOINT)
        .header("Content-Type", "application/json")
        .json(&json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|error| format!("请求 Kiro refreshToken 接口失败: {}", error))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "<no-body>".to_string());
    if !status.is_success() {
        return Err(format!(
            "Kiro refreshToken 接口返回异常: status={}, body_len={}",
            status,
            body.len()
        ));
    }
    let mut token = unwrap_token_response(
        serde_json::from_str::<Value>(&body)
            .map_err(|error| format!("解析 Kiro refreshToken 响应失败: {}", error))?,
    );
    ensure_expires_at_from_expires_in(&mut token);
    Ok(token)
}

async fn refresh_token_via_idc_oidc(
    refresh_token: &str,
    auth_raw: &Value,
    account: &KiroAccount,
) -> Result<Value, String> {
    let region = resolve_idc_region(auth_raw, account)
        .ok_or_else(|| "缺少 idc_region，无法执行 AWS IAM Identity Center 刷新".to_string())?;
    let client_id = resolve_idc_client_id(auth_raw, account)
        .ok_or_else(|| "缺少 client_id，无法执行 AWS IAM Identity Center 刷新".to_string())?;
    let client_secret = resolve_idc_client_secret(auth_raw)
        .ok_or_else(|| "缺少 client_secret，无法执行 AWS IAM Identity Center 刷新".to_string())?;
    let endpoint = KIRO_AWS_OIDC_TOKEN_ENDPOINT_FMT.replace("{region}", region.as_str());

    let response = reqwest::Client::new()
        .post(endpoint)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("请求 AWS IAM Identity Center OIDC 刷新接口失败: {}", error))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "<no-body>".to_string());
    if !status.is_success() {
        return Err(format!(
            "AWS IAM Identity Center OIDC 刷新接口返回异常: status={}, body_len={}",
            status,
            body.len()
        ));
    }

    let mut token =
        unwrap_token_response(serde_json::from_str::<Value>(&body).map_err(|error| {
            format!("解析 AWS IAM Identity Center OIDC 刷新响应失败: {}", error)
        })?);
    if !token.is_object() {
        token = json!({});
    }
    if let Some(object) = token.as_object_mut() {
        object
            .entry("refreshToken".to_string())
            .or_insert_with(|| Value::String(refresh_token.to_string()));
        object
            .entry("idc_region".to_string())
            .or_insert_with(|| Value::String(region.clone()));
        object
            .entry("idcRegion".to_string())
            .or_insert_with(|| Value::String(region.clone()));
        object
            .entry("region".to_string())
            .or_insert_with(|| Value::String(region));
        object
            .entry("client_id".to_string())
            .or_insert_with(|| Value::String(client_id.clone()));
        object
            .entry("clientId".to_string())
            .or_insert_with(|| Value::String(client_id));
        object
            .entry("client_secret".to_string())
            .or_insert_with(|| Value::String(client_secret.clone()));
        object
            .entry("clientSecret".to_string())
            .or_insert_with(|| Value::String(client_secret));
        object
            .entry("authMethod".to_string())
            .or_insert_with(|| Value::String("IdC".to_string()));
        insert_optional_string_if_missing(object, "provider", account.login_provider.as_deref());
        insert_optional_string_if_missing(
            object,
            "loginProvider",
            account.login_provider.as_deref(),
        );
        insert_optional_string_if_missing(object, "issuer_url", account.issuer_url.as_deref());
        insert_optional_string_if_missing(object, "issuerUrl", account.issuer_url.as_deref());
    }
    ensure_expires_at_from_expires_in(&mut token);
    Ok(token)
}

async fn enrich_account_with_runtime_usage(mut account: KiroAccount) -> KiroAccount {
    let Some(profile_arn) = extract_profile_arn(&account) else {
        account.status = Some(KIRO_STATUS_ERROR.to_string());
        account.status_reason = Some("账号缺少 profileArn，无法远程查询配额".to_string());
        account.quota_query_last_error = account.status_reason.clone();
        account.quota_query_last_error_at = Some(now_ts());
        return account;
    };

    match fetch_usage_limits_via_runtime(account.access_token.as_str(), profile_arn.as_str(), true)
        .await
    {
        Ok(usage_raw) => {
            apply_usage_to_account(&mut account, usage_raw);
            account.status = Some(KIRO_STATUS_NORMAL.to_string());
            account.status_reason = None;
            account.quota_query_last_error = None;
            account.quota_query_last_error_at = None;
            account.usage_updated_at = Some(now_ts());
        }
        Err(error) => {
            if let Some(reason) = error.strip_prefix("BANNED:").and_then(non_empty_string) {
                account.status = Some(KIRO_STATUS_BANNED.to_string());
                account.status_reason = Some(reason.clone());
                account.quota_query_last_error = Some(reason);
            } else {
                account.status = Some(KIRO_STATUS_ERROR.to_string());
                account.status_reason = Some(error.clone());
                account.quota_query_last_error = Some(error);
            }
            account.quota_query_last_error_at = Some(now_ts());
        }
    }
    account
}

async fn fetch_usage_limits_via_runtime(
    access_token: &str,
    profile_arn: &str,
    is_email_required: bool,
) -> Result<Value, String> {
    let endpoint = runtime_endpoint_for_region(parse_profile_arn_region(profile_arn).as_deref());
    let mut url = format!(
        "{}/getUsageLimits?origin=AI_EDITOR&profileArn={}&resourceType=AGENTIC_REQUEST",
        endpoint.trim_end_matches('/'),
        urlencoding::encode(profile_arn),
    );
    if is_email_required {
        url.push_str("&isEmailRequired=true");
    }

    let response = reqwest::Client::new()
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token.trim()))
        .send()
        .await
        .map_err(|error| format!("请求 Kiro runtime usage 接口失败: {}", error))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "<no-body>".to_string());
    if !status.is_success() {
        let reason = parse_runtime_error_reason(&body)
            .or_else(|| (status == reqwest::StatusCode::FORBIDDEN).then(|| body.clone()));
        if let Some(reason) = reason {
            return Err(format!("BANNED:{}", reason));
        }
        return Err(format!(
            "Kiro runtime usage 接口返回异常: status={}, body_len={}",
            status,
            body.len()
        ));
    }
    serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("解析 Kiro runtime usage 响应失败: {}", error))
}

fn apply_usage_to_account(account: &mut KiroAccount, usage_raw: Value) {
    account.plan_name = resolve_plan_name(Some(&usage_raw));
    account.credits_total = first_number_in_roots(
        &[Some(&usage_raw)],
        &[
            &["estimatedUsage", "total"],
            &["estimatedUsage", "creditsTotal"],
            &["usageBreakdownList", "0", "usageLimitWithPrecision"],
            &["usageBreakdownList", "0", "usageLimit"],
            &["usageBreakdowns", "plan", "totalCredits"],
            &["usageBreakdowns", "covered", "total"],
            &["credits", "total"],
            &["totalCredits"],
        ],
    );
    account.credits_used = first_number_in_roots(
        &[Some(&usage_raw)],
        &[
            &["estimatedUsage", "used"],
            &["estimatedUsage", "creditsUsed"],
            &["usageBreakdownList", "0", "currentUsageWithPrecision"],
            &["usageBreakdownList", "0", "currentUsage"],
            &["usageBreakdowns", "plan", "usedCredits"],
            &["usageBreakdowns", "covered", "used"],
            &["credits", "used"],
            &["usedCredits"],
        ],
    );
    account.bonus_total = first_number_in_roots(
        &[Some(&usage_raw)],
        &[
            &["bonusCredits", "total"],
            &["bonus", "total"],
            &["usageBreakdowns", "bonus", "total"],
            &[
                "usageBreakdownList",
                "0",
                "freeTrialInfo",
                "usageLimitWithPrecision",
            ],
            &["usageBreakdownList", "0", "freeTrialInfo", "usageLimit"],
        ],
    );
    account.bonus_used = first_number_in_roots(
        &[Some(&usage_raw)],
        &[
            &["bonusCredits", "used"],
            &["bonus", "used"],
            &["usageBreakdowns", "bonus", "used"],
            &[
                "usageBreakdownList",
                "0",
                "freeTrialInfo",
                "currentUsageWithPrecision",
            ],
            &["usageBreakdownList", "0", "freeTrialInfo", "currentUsage"],
        ],
    );
    account.usage_reset_at = first_timestamp_in_roots(
        &[Some(&usage_raw)],
        &[
            &["billingCycle", "resetDate"],
            &["billingCycle", "endsAt"],
            &["billingCycle", "endDate"],
            &["billingCycle", "nextResetAt"],
            &["nextDateReset"],
            &["resetAt"],
            &["resetTime"],
            &["resetOn"],
            &["usageBreakdownList", "0", "resetDate"],
            &["usageBreakdownList", "0", "resetAt"],
            &["usageBreakdowns", "resetAt"],
            &["usageBreakdowns", "0", "resetDate"],
            &["usageBreakdowns", "0", "resetAt"],
        ],
    );
    if account.usage_reset_at.is_none() && has_meaningful_usage(account) {
        account.usage_reset_at = Some(default_month_cycle_end_timestamp());
    }
    account.usage_raw = Some(usage_raw);
}

fn merge_account_context_into_auth(auth_raw: &mut Value, account: &KiroAccount) {
    if !auth_raw.is_object() {
        *auth_raw = json!({});
    }
    let current_access_token = first_string(
        auth_raw,
        &[
            &["accessToken"],
            &["access_token"],
            &["token"],
            &["idToken"],
            &["id_token"],
        ],
    )
    .unwrap_or_else(|| account.access_token.clone());
    let Some(target) = auth_raw.as_object_mut() else {
        return;
    };
    if let Some(source) = account.auth_raw.as_ref().and_then(Value::as_object) {
        for (key, value) in source {
            target.entry(key.clone()).or_insert_with(|| value.clone());
        }
    }
    target.insert(
        "accessToken".to_string(),
        Value::String(current_access_token),
    );
    insert_optional_string_if_missing(target, "refreshToken", account.refresh_token.as_deref());
    insert_optional_string_if_missing(target, "email", Some(account.email.as_str()));
    insert_optional_string_if_missing(target, "userId", account.user_id.as_deref());
    insert_optional_string_if_missing(target, "provider", account.login_provider.as_deref());
    insert_optional_string_if_missing(target, "loginProvider", account.login_provider.as_deref());
    insert_optional_string_if_missing(target, "idc_region", account.idc_region.as_deref());
    insert_optional_string_if_missing(target, "idcRegion", account.idc_region.as_deref());
    insert_optional_string_if_missing(target, "issuer_url", account.issuer_url.as_deref());
    insert_optional_string_if_missing(target, "issuerUrl", account.issuer_url.as_deref());
    insert_optional_string_if_missing(target, "client_id", account.client_id.as_deref());
    insert_optional_string_if_missing(target, "clientId", account.client_id.as_deref());
    insert_optional_string_if_missing(target, "scopes", account.scopes.as_deref());
    insert_optional_string_if_missing(target, "scope", account.scopes.as_deref());
    insert_optional_string_if_missing(target, "login_hint", account.login_hint.as_deref());
    insert_optional_string_if_missing(target, "loginHint", account.login_hint.as_deref());
    if let Some(profile_arn) = extract_profile_arn(account) {
        insert_optional_string_if_missing(target, "profileArn", Some(profile_arn.as_str()));
    }
    ensure_expires_at_from_expires_in(auth_raw);
}

fn extract_profile_arn(account: &KiroAccount) -> Option<String> {
    first_string_many(
        &[
            account.auth_raw.as_ref(),
            account.profile_raw.as_ref(),
            account.usage_raw.as_ref(),
        ],
        &[
            &["profileArn"],
            &["profile_arn"],
            &["arn"],
            &["profile", "arn"],
            &["userInfo", "profileArn"],
        ],
    )
}

fn resolve_idc_region(auth_raw: &Value, account: &KiroAccount) -> Option<String> {
    first_string_many(
        &[Some(auth_raw)],
        &[&["idc_region"], &["idcRegion"], &["region"]],
    )
    .or_else(|| account.idc_region.as_deref().and_then(non_empty_string))
    .or_else(|| extract_profile_arn(account).and_then(|arn| parse_profile_arn_region(arn.as_str())))
}

fn resolve_idc_client_id(auth_raw: &Value, account: &KiroAccount) -> Option<String> {
    first_string_many(
        &[Some(auth_raw)],
        &[
            &["client_id"],
            &["clientId"],
            &["clientRegistration", "clientId"],
            &["registration", "clientId"],
            &["oidcClient", "clientId"],
        ],
    )
    .or_else(|| account.client_id.as_deref().and_then(non_empty_string))
}

fn resolve_idc_client_secret(auth_raw: &Value) -> Option<String> {
    first_string_many(
        &[Some(auth_raw)],
        &[
            &["client_secret"],
            &["clientSecret"],
            &["clientRegistration", "clientSecret"],
            &["clientRegistration", "client_secret"],
            &["registration", "clientSecret"],
            &["oidcClient", "clientSecret"],
        ],
    )
}

fn should_prefer_idc_refresh(auth_raw: &Value, account: &KiroAccount) -> bool {
    let auth_method_is_idc =
        first_string_many(&[Some(auth_raw)], &[&["authMethod"], &["auth_method"]])
            .map(|value| value.eq_ignore_ascii_case("idc"))
            .unwrap_or(false);
    let provider_is_idc = first_string_many(
        &[Some(auth_raw)],
        &[&["provider"], &["loginProvider"], &["login_option"]],
    )
    .map(|value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "enterprise"
                | "builderid"
                | "internal"
                | "awsidc"
                | "external_idp"
                | "aws iam identity center"
        )
    })
    .unwrap_or(false);
    let login_provider_is_idc = account
        .login_provider
        .as_deref()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "enterprise" | "builderid" | "internal" | "awsidc" | "aws iam identity center"
            )
        })
        .unwrap_or(false);
    let has_idc_material = resolve_idc_region(auth_raw, account).is_some()
        && resolve_idc_client_id(auth_raw, account).is_some()
        && resolve_idc_client_secret(auth_raw).is_some();
    auth_method_is_idc || provider_is_idc || login_provider_is_idc || has_idc_material
}

fn parse_profile_arn_region(profile_arn: &str) -> Option<String> {
    let mut segments = profile_arn.split(':');
    let prefix = segments.next()?.trim();
    if !prefix.eq_ignore_ascii_case("arn") {
        return None;
    }
    let _partition = segments.next()?;
    let _service = segments.next()?;
    let region = segments.next()?.trim();
    non_empty_string(region)
}

fn runtime_endpoint_for_region(region: Option<&str>) -> String {
    let region = region.unwrap_or("us-east-1").trim().to_ascii_lowercase();
    match region.as_str() {
        "us-east-1" => "https://q.us-east-1.amazonaws.com".to_string(),
        "eu-central-1" => "https://q.eu-central-1.amazonaws.com".to_string(),
        "us-gov-east-1" => "https://q-fips.us-gov-east-1.amazonaws.com".to_string(),
        "us-gov-west-1" => "https://q-fips.us-gov-west-1.amazonaws.com".to_string(),
        "us-iso-east-1" => "https://q.us-iso-east-1.c2s.ic.gov".to_string(),
        "us-isob-east-1" => "https://q.us-isob-east-1.sc2s.sgov.gov".to_string(),
        "us-isof-south-1" => "https://q.us-isof-south-1.csp.hci.ic.gov".to_string(),
        "us-isof-east-1" => "https://q.us-isof-east-1.csp.hci.ic.gov".to_string(),
        _ => KIRO_RUNTIME_DEFAULT_ENDPOINT.to_string(),
    }
}

fn has_meaningful_usage(account: &KiroAccount) -> bool {
    account.plan_name.is_some()
        || account.plan_tier.is_some()
        || account.credits_total.is_some()
        || account.credits_used.is_some()
        || account.bonus_total.is_some()
        || account.bonus_used.is_some()
}

fn default_month_cycle_end_timestamp() -> i64 {
    let now = Utc::now();
    let naive_now = now.naive_utc();
    let (year, month) = if naive_now.month() == 12 {
        (naive_now.year() + 1, 1)
    } else {
        (naive_now.year(), naive_now.month() + 1)
    };
    chrono::NaiveDate::from_ymd_opt(year, month, 1)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|start_next_month| start_next_month.and_utc().timestamp() - 1)
        .unwrap_or_else(|| now.timestamp())
}

fn parse_runtime_error_reason(body: &str) -> Option<String> {
    let parsed = serde_json::from_str::<Value>(body).ok()?;
    first_string_many(
        &[Some(&parsed)],
        &[
            &["reason"],
            &["message"],
            &["errorMessage"],
            &["error", "message"],
            &["error", "reason"],
            &["detail"],
            &["details"],
            &["error"],
            &["code"],
            &["errorCode"],
        ],
    )
}

fn unwrap_token_response(mut response: Value) -> Value {
    if let Some(data) = response
        .as_object_mut()
        .and_then(|object| object.remove("data"))
        .filter(Value::is_object)
    {
        data
    } else {
        response
    }
}

fn ensure_expires_at_from_expires_in(token: &mut Value) {
    if !token.is_object() {
        return;
    }
    let has_expires_at =
        first_timestamp(token, &[&["expiresAt"], &["expires_at"], &["expiry"]]).is_some();
    if has_expires_at {
        return;
    }
    let expires_in = first_number(token, &[&["expiresIn"], &["expires_in"]])
        .map(|value| value.round() as i64)
        .filter(|value| *value > 0);
    if let Some(expires_in) = expires_in {
        if let Some(object) = token.as_object_mut() {
            object.insert(
                "expiresAt".to_string(),
                Value::String(timestamp_to_iso(now_ts() + expires_in)),
            );
        }
    }
}

fn inject_callback_context_into_token(token: &mut Value, callback: &OAuthCallbackData) {
    if !token.is_object() {
        *token = json!({});
    }
    let Some(object) = token.as_object_mut() else {
        return;
    };
    insert_optional_string(object, "login_option", Some(callback.login_option.as_str()));
    if let Some(provider) = provider_from_login_option(&callback.login_option) {
        insert_optional_string(object, "provider", Some(provider.as_str()));
        insert_optional_string(object, "loginProvider", Some(provider.as_str()));
        insert_optional_string(object, "authMethod", Some("social"));
    }
    insert_optional_string(object, "issuer_url", callback.issuer_url.as_deref());
    insert_optional_string(object, "idc_region", callback.idc_region.as_deref());
    insert_optional_string(object, "client_id", callback.client_id.as_deref());
    insert_optional_string(object, "scopes", callback.scopes.as_deref());
    insert_optional_string(object, "login_hint", callback.login_hint.as_deref());
    insert_optional_string(object, "audience", callback.audience.as_deref());
    ensure_expires_at_from_expires_in(token);
}

fn provider_from_login_option(login_option: &str) -> Option<String> {
    match login_option.trim().to_ascii_lowercase().as_str() {
        "google" | "googlesocial" | "google_social" => Some("Google".to_string()),
        "github" | "githubsocial" | "github_social" => Some("GitHub".to_string()),
        "builderid" => Some("Builder ID".to_string()),
        "awsidc" | "idc" => Some("AWS IAM Identity Center".to_string()),
        "internal" => Some("Amazon Internal".to_string()),
        _ => non_empty_string(login_option),
    }
}

fn parse_callback_path_and_query(
    input: &str,
    callback_port: u16,
) -> Result<(String, String), String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("回调链接不能为空".to_string());
    }
    let without_origin = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let scheme_end = trimmed
            .find("://")
            .map(|index| index + 3)
            .ok_or_else(|| "回调链接格式无效".to_string())?;
        let after_scheme = &trimmed[scheme_end..];
        match after_scheme.find('/') {
            Some(index) => &after_scheme[index..],
            None => "/",
        }
    } else if trimmed.starts_with('/') {
        trimmed
    } else {
        return Ok((
            "/oauth/callback".to_string(),
            trimmed.trim_start_matches('?').to_string(),
        ));
    };
    let (path, query) = without_origin
        .split_once('?')
        .unwrap_or((without_origin, ""));
    let _ = callback_port;
    Ok((path.to_string(), query.to_string()))
}

fn callback_from_params(path: &str, params: &HashMap<String, String>) -> OAuthCallbackData {
    OAuthCallbackData {
        login_option: params
            .get("login_option")
            .or_else(|| params.get("loginOption"))
            .and_then(|value| non_empty_string(value))
            .unwrap_or_default()
            .to_ascii_lowercase(),
        code: params.get("code").and_then(|value| non_empty_string(value)),
        issuer_url: params
            .get("issuer_url")
            .or_else(|| params.get("issuerUrl"))
            .and_then(|value| non_empty_string(value)),
        idc_region: params
            .get("idc_region")
            .or_else(|| params.get("idcRegion"))
            .and_then(|value| non_empty_string(value)),
        path: path.to_string(),
        client_id: params
            .get("client_id")
            .or_else(|| params.get("clientId"))
            .and_then(|value| non_empty_string(value)),
        scopes: params
            .get("scopes")
            .or_else(|| params.get("scope"))
            .and_then(|value| non_empty_string(value)),
        login_hint: params
            .get("login_hint")
            .or_else(|| params.get("loginHint"))
            .and_then(|value| non_empty_string(value)),
        audience: params
            .get("audience")
            .and_then(|value| non_empty_string(value)),
    }
}

fn auth_success_redirect_url() -> String {
    format!(
        "{}?auth_status=success&redirect_from=KiroIDE",
        KIRO_AUTH_PORTAL_URL
    )
}

fn auth_error_redirect_url(message: &str) -> String {
    format!(
        "{}?auth_status=error&redirect_from=KiroIDE&error_message={}",
        KIRO_AUTH_PORTAL_URL,
        urlencoding::encode(message)
    )
}

fn decode_query_component(value: &str) -> String {
    urlencoding::decode(value)
        .map(|value| value.into_owned())
        .unwrap_or_else(|_| value.to_string())
}

fn parse_query_params(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
            let key = key.trim();
            if key.is_empty() {
                None
            } else {
                Some((key.to_string(), decode_query_component(raw_value)))
            }
        })
        .collect()
}

fn local_kiro_data_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|_| "无法获取 APPDATA".to_string())?;
        return Ok(PathBuf::from(appdata).join("Kiro"));
    }
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
        return Ok(home.join("Library/Application Support/Kiro"));
    }
    #[cfg(target_os = "linux")]
    {
        let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
        return Ok(home.join(".config/Kiro"));
    }
    #[allow(unreachable_code)]
    Err("不支持的系统".to_string())
}

fn local_auth_token_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    Ok(home
        .join(".aws")
        .join("sso")
        .join("cache")
        .join(LOCAL_AUTH_TOKEN_FILE_NAME))
}

fn local_profile_path() -> Result<PathBuf, String> {
    Ok(local_kiro_data_dir()?
        .join("User")
        .join("globalStorage")
        .join("kiro.kiroagent")
        .join("profile.json"))
}

fn local_state_db_path() -> Result<PathBuf, String> {
    Ok(local_kiro_data_dir()?
        .join("User")
        .join("globalStorage")
        .join("state.vscdb"))
}

fn read_json_optional(path: &Path) -> Result<Option<Value>, String> {
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str::<Value>(&content)
            .map(Some)
            .map_err(|error| format!("解析 JSON 失败({}): {}", path.display(), error)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取文件失败({}): {}", path.display(), error)),
    }
}

fn read_usage_snapshot_optional() -> Result<Option<Value>, String> {
    let path = local_state_db_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let conn = Connection::open(&path)
        .map_err(|error| format!("打开 Kiro state.vscdb 失败: {}", error))?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            [LOCAL_USAGE_DB_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("读取 Kiro usage 快照失败: {}", error))?;
    raw.map(|value| {
        serde_json::from_str::<Value>(&value)
            .map_err(|error| format!("解析 usage 快照失败: {}", error))
    })
    .transpose()
}

fn write_account_to_local(account: &KiroAccount) -> Result<(), String> {
    let auth_path = local_auth_token_path()?;
    if let Some(parent) = auth_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建授权目录失败: {}", error))?;
    }
    let auth = build_auth_snapshot(account);
    fs::write(
        &auth_path,
        serde_json::to_string_pretty(&auth)
            .map_err(|error| format!("序列化 Kiro 授权失败: {}", error))?,
    )
    .map_err(|error| format!("写入 Kiro 授权失败({}): {}", auth_path.display(), error))?;

    let profile_path = local_profile_path()?;
    if let Some(parent) = profile_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建 profile 目录失败: {}", error))?;
    }
    let profile = build_profile_snapshot(account);
    fs::write(
        &profile_path,
        serde_json::to_string_pretty(&profile)
            .map_err(|error| format!("序列化 Kiro profile 失败: {}", error))?,
    )
    .map_err(|error| {
        format!(
            "写入 Kiro profile 失败({}): {}",
            profile_path.display(),
            error
        )
    })?;

    if let Some(usage) = account.usage_raw.as_ref() {
        let _ = write_usage_snapshot(usage);
    }
    Ok(())
}

fn write_account_to_isolated_paths(
    account: &KiroAccount,
    home_dir: &Path,
    user_data_dir: &Path,
    identity: &KiroInstanceIdentity,
) -> Result<(), String> {
    let auth_path = home_dir
        .join(".aws")
        .join("sso")
        .join("cache")
        .join(LOCAL_AUTH_TOKEN_FILE_NAME);
    if let Some(parent) = auth_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建隔离授权目录失败: {}", error))?;
    }
    fs::write(
        &auth_path,
        serde_json::to_string_pretty(&build_auth_snapshot(account))
            .map_err(|error| format!("序列化隔离 Kiro 授权失败: {}", error))?,
    )
    .map_err(|error| format!("写入隔离 Kiro 授权失败({}): {}", auth_path.display(), error))?;

    let profile_path = user_data_dir
        .join("User")
        .join("globalStorage")
        .join("kiro.kiroagent")
        .join("profile.json");
    if let Some(parent) = profile_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建隔离 profile 目录失败: {}", error))?;
    }
    fs::write(
        &profile_path,
        serde_json::to_string_pretty(&build_profile_snapshot(account))
            .map_err(|error| format!("序列化隔离 Kiro profile 失败: {}", error))?,
    )
    .map_err(|error| {
        format!(
            "写入隔离 Kiro profile 失败({}): {}",
            profile_path.display(),
            error
        )
    })?;

    if let Some(usage) = account.usage_raw.as_ref() {
        let _ = write_usage_snapshot_to_dir(user_data_dir, usage);
    }
    ensure_instance_identity_files(user_data_dir, identity)?;
    Ok(())
}

fn write_usage_snapshot(usage: &Value) -> Result<(), String> {
    let path = local_state_db_path()?;
    write_usage_snapshot_to_db_path(&path, usage)
}

fn write_usage_snapshot_to_dir(user_data_dir: &Path, usage: &Value) -> Result<(), String> {
    let path = user_data_dir
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");
    write_usage_snapshot_to_db_path(&path, usage)
}

fn write_usage_snapshot_to_db_path(path: &Path, usage: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 Kiro 数据库目录失败: {}", error))?;
    }
    let conn = Connection::open(&path)
        .map_err(|error| format!("打开 Kiro state.vscdb 失败: {}", error))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)",
        [],
    )
    .map_err(|error| format!("初始化 Kiro state.vscdb 失败: {}", error))?;
    let value =
        serde_json::to_string(usage).map_err(|error| format!("序列化 usage 失败: {}", error))?;
    conn.execute(
        "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (LOCAL_USAGE_DB_KEY, value),
    )
    .map_err(|error| format!("写入 Kiro usage 失败: {}", error))?;
    Ok(())
}

fn identity_meta_path(instance_dir: &Path) -> PathBuf {
    instance_dir.join(KIRO_INSTANCE_IDENTITY_FILE)
}

fn load_instance_identity(instance_dir: &Path) -> Result<Option<KiroInstanceIdentity>, String> {
    let path = identity_meta_path(instance_dir);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("读取隔离实例身份失败({}): {}", path.display(), error))?;
    serde_json::from_str::<KiroInstanceIdentity>(&content)
        .map(Some)
        .map_err(|error| format!("解析隔离实例身份失败({}): {}", path.display(), error))
}

fn save_instance_identity(
    instance_dir: &Path,
    identity: &KiroInstanceIdentity,
) -> Result<(), String> {
    fs::create_dir_all(instance_dir).map_err(|error| {
        format!(
            "创建隔离实例目录失败({}): {}",
            instance_dir.display(),
            error
        )
    })?;
    let path = identity_meta_path(instance_dir);
    fs::write(
        &path,
        serde_json::to_string_pretty(identity)
            .map_err(|error| format!("序列化隔离实例身份失败: {}", error))?,
    )
    .map_err(|error| format!("保存隔离实例身份失败({}): {}", path.display(), error))
}

fn stable_instance_identity(instance_dir: &Path) -> Result<KiroInstanceIdentity, String> {
    if let Some(mut identity) = load_instance_identity(instance_dir)? {
        identity = normalize_instance_identity(identity);
        save_instance_identity(instance_dir, &identity)?;
        return Ok(identity);
    }
    let identity = generate_instance_identity();
    save_instance_identity(instance_dir, &identity)?;
    Ok(identity)
}

fn normalize_instance_identity(mut identity: KiroInstanceIdentity) -> KiroInstanceIdentity {
    let now = now_ts();
    if identity.version.trim().is_empty() {
        identity.version = "1.0".to_string();
    }
    if identity.machine_id.trim().is_empty() {
        identity.machine_id = generate_machine_id();
    }
    if identity.mac_machine_id.trim().is_empty() {
        identity.mac_machine_id = Uuid::new_v4().to_string();
    }
    if identity.dev_device_id.trim().is_empty() {
        identity.dev_device_id = Uuid::new_v4().to_string();
    }
    if identity.sqm_id.trim().is_empty() {
        identity.sqm_id = format!("{{{}}}", Uuid::new_v4().to_string().to_uppercase());
    }
    if identity.service_machine_id.trim().is_empty() {
        identity.service_machine_id = Uuid::new_v4().to_string();
    }
    if identity.created_at <= 0 {
        identity.created_at = now;
    }
    identity.updated_at = now;
    identity
}

fn generate_instance_identity() -> KiroInstanceIdentity {
    let now = now_ts();
    KiroInstanceIdentity {
        version: "1.0".to_string(),
        machine_id: generate_machine_id(),
        mac_machine_id: Uuid::new_v4().to_string(),
        dev_device_id: Uuid::new_v4().to_string(),
        sqm_id: format!("{{{}}}", Uuid::new_v4().to_string().to_uppercase()),
        service_machine_id: Uuid::new_v4().to_string(),
        created_at: now,
        updated_at: now,
    }
}

fn generate_machine_id() -> String {
    let mut rng = rand::thread_rng();
    let mut text = String::with_capacity(32);
    for _ in 0..32 {
        text.push_str(&format!("{:x}", rng.gen_range(0..16)));
    }
    format!("auth0|user_{}", text)
}

fn ensure_instance_identity_files(
    user_data_dir: &Path,
    identity: &KiroInstanceIdentity,
) -> Result<(), String> {
    write_instance_machine_id(user_data_dir, identity)?;
    write_instance_storage_json(user_data_dir, identity)?;
    write_instance_service_machine_id(user_data_dir, identity)?;
    Ok(())
}

fn write_instance_machine_id(
    user_data_dir: &Path,
    identity: &KiroInstanceIdentity,
) -> Result<(), String> {
    let path = isolated_machine_id_path(user_data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建隔离 machineid 目录失败: {}", error))?;
    }
    fs::write(&path, identity.service_machine_id.as_bytes())
        .map_err(|error| format!("写入隔离 machineid 失败({}): {}", path.display(), error))
}

fn write_instance_storage_json(
    user_data_dir: &Path,
    identity: &KiroInstanceIdentity,
) -> Result<(), String> {
    let path = isolated_storage_json_path(user_data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建隔离 storage.json 目录失败: {}", error))?;
    }
    let mut root = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<Value>(&content).ok())
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}))
    } else {
        json!({})
    };

    if !root.get("telemetry").map(Value::is_object).unwrap_or(false) {
        if let Some(object) = root.as_object_mut() {
            object.insert("telemetry".to_string(), json!({}));
        }
    }
    if let Some(telemetry) = root.get_mut("telemetry").and_then(Value::as_object_mut) {
        telemetry.insert(
            "machineId".to_string(),
            Value::String(identity.machine_id.clone()),
        );
        telemetry.insert(
            "macMachineId".to_string(),
            Value::String(identity.mac_machine_id.clone()),
        );
        telemetry.insert(
            "devDeviceId".to_string(),
            Value::String(identity.dev_device_id.clone()),
        );
        telemetry.insert("sqmId".to_string(), Value::String(identity.sqm_id.clone()));
    }
    if let Some(object) = root.as_object_mut() {
        object.insert(
            "telemetry.machineId".to_string(),
            Value::String(identity.machine_id.clone()),
        );
        object.insert(
            "telemetry.macMachineId".to_string(),
            Value::String(identity.mac_machine_id.clone()),
        );
        object.insert(
            "telemetry.devDeviceId".to_string(),
            Value::String(identity.dev_device_id.clone()),
        );
        object.insert(
            "telemetry.sqmId".to_string(),
            Value::String(identity.sqm_id.clone()),
        );
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(&root)
            .map_err(|error| format!("序列化隔离 storage.json 失败: {}", error))?,
    )
    .map_err(|error| format!("写入隔离 storage.json 失败({}): {}", path.display(), error))
}

fn write_instance_service_machine_id(
    user_data_dir: &Path,
    identity: &KiroInstanceIdentity,
) -> Result<(), String> {
    let path = user_data_dir
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建隔离 state.vscdb 目录失败: {}", error))?;
    }
    let conn = Connection::open(&path)
        .map_err(|error| format!("打开隔离 Kiro state.vscdb 失败: {}", error))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)",
        [],
    )
    .map_err(|error| format!("初始化隔离 Kiro state.vscdb 失败: {}", error))?;
    conn.execute(
        "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (
            KIRO_SERVICE_MACHINE_ID_DB_KEY,
            identity.service_machine_id.as_str(),
        ),
    )
    .map_err(|error| format!("写入隔离 serviceMachineId 失败: {}", error))?;
    Ok(())
}

fn instance_meta_path(instance_dir: &Path) -> PathBuf {
    instance_dir.join(KIRO_INSTANCE_META_FILE)
}

fn save_instance_meta(
    instance_dir: &Path,
    account: &KiroAccount,
    pid: Option<u32>,
) -> Result<(), String> {
    let path = instance_meta_path(instance_dir);
    let now = now_ts();
    let created_at = fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<KiroInstanceMeta>(&content).ok())
        .map(|meta| meta.created_at)
        .unwrap_or(now);
    let meta = KiroInstanceMeta {
        account_id: account.id.clone(),
        account_email: display_email(account),
        created_at,
        updated_at: now,
        last_started_at: Some(now),
        pid,
    };
    fs::write(
        path,
        serde_json::to_string_pretty(&meta)
            .map_err(|error| format!("序列化隔离实例元数据失败: {}", error))?,
    )
    .map_err(|error| format!("保存隔离实例元数据失败: {}", error))
}

fn list_instances() -> Result<Vec<KiroInstanceInfo>, String> {
    let root = instances_root_dir()?;
    let mut instances = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| format!("读取隔离实例目录失败: {}", error))?
    {
        let entry = entry.map_err(|error| format!("读取隔离实例目录项失败: {}", error))?;
        let instance_dir = entry.path();
        if !instance_dir.is_dir() {
            continue;
        }
        let meta_path = instance_meta_path(&instance_dir);
        let Some(meta) = fs::read_to_string(&meta_path)
            .ok()
            .and_then(|content| serde_json::from_str::<KiroInstanceMeta>(&content).ok())
        else {
            continue;
        };
        let running = meta.pid.map(is_process_running).unwrap_or(false);
        let identity = load_instance_identity(&instance_dir).ok().flatten();
        instances.push(KiroInstanceInfo {
            account_id: meta.account_id,
            account_email: meta.account_email,
            home_dir: instance_dir.join("home").to_string_lossy().to_string(),
            user_data_dir: instance_dir.join("user-data").to_string_lossy().to_string(),
            instance_dir: instance_dir.to_string_lossy().to_string(),
            identity_path: identity_meta_path(&instance_dir)
                .to_string_lossy()
                .to_string(),
            identity_ready: identity.is_some(),
            machine_id: identity.as_ref().map(|value| value.machine_id.clone()),
            service_machine_id: identity
                .as_ref()
                .map(|value| value.service_machine_id.clone()),
            created_at: meta.created_at,
            updated_at: meta.updated_at,
            last_started_at: meta.last_started_at,
            running,
            pid: running.then_some(meta.pid).flatten(),
        });
    }
    instances.sort_by(|left, right| right.last_started_at.cmp(&left.last_started_at));
    Ok(instances)
}

fn stop_instance(account_id: &str) -> Result<(), String> {
    let instance_dir = isolated_instance_dir(account_id)?;
    let meta_path = instance_meta_path(&instance_dir);
    let mut meta = fs::read_to_string(&meta_path)
        .ok()
        .and_then(|content| serde_json::from_str::<KiroInstanceMeta>(&content).ok())
        .ok_or_else(|| "隔离实例不存在或尚未启动".to_string())?;
    if let Some(pid) = meta.pid {
        if is_process_running(pid) {
            terminate_process(pid)?;
        }
    }
    meta.pid = None;
    meta.updated_at = now_ts();
    fs::write(
        meta_path,
        serde_json::to_string_pretty(&meta)
            .map_err(|error| format!("序列化隔离实例元数据失败: {}", error))?,
    )
    .map_err(|error| format!("保存隔离实例元数据失败: {}", error))
}

fn clean_instance(account_id: &str, stop_first: bool) -> Result<(), String> {
    if stop_first {
        let _ = stop_instance(account_id);
    }
    let instance_dir = isolated_instance_dir(account_id)?;
    if instance_dir.exists() {
        fs::remove_dir_all(&instance_dir)
            .map_err(|error| format!("清理隔离实例失败({}): {}", instance_dir.display(), error))?;
    }
    Ok(())
}

fn is_process_running(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("tasklist")
            .args(["/FI", format!("PID eq {}", pid).as_str(), "/NH"])
            .creation_flags(0x08000000)
            .output()
            .ok()
            .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from(format!("/proc/{}", pid)).exists()
    }
}

fn terminate_process(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let status = std::process::Command::new("taskkill")
            .args(["/PID", pid.to_string().as_str(), "/T", "/F"])
            .creation_flags(0x08000000)
            .status()
            .map_err(|error| format!("停止隔离 Kiro 实例失败: {}", error))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("停止隔离 Kiro 实例失败: taskkill exit={}", status))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = std::process::Command::new("kill")
            .args(["-TERM", pid.to_string().as_str()])
            .status()
            .map_err(|error| format!("停止隔离 Kiro 实例失败: {}", error))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("停止隔离 Kiro 实例失败: kill exit={}", status))
        }
    }
}

fn backup_local_kiro_state() -> Result<LocalKiroBackup, String> {
    let timestamp = now_ts();
    let backup_dir = local_backup_root_dir()?.join(timestamp.to_string());
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("创建本机状态备份目录失败: {}", error))?;

    let backup = LocalKiroBackup {
        auth_path: backup_dir.join("kiro-auth-token.json"),
        profile_path: backup_dir.join("profile.json"),
        state_db_path: backup_dir.join("state.vscdb"),
    };

    copy_if_exists(&local_auth_token_path()?, &backup.auth_path)?;
    copy_if_exists(&local_profile_path()?, &backup.profile_path)?;
    copy_if_exists(&local_state_db_path()?, &backup.state_db_path)?;
    Ok(backup)
}

fn restore_local_kiro_state(backup: &LocalKiroBackup) -> Result<(), String> {
    restore_backup_file(&backup.auth_path, &local_auth_token_path()?)?;
    restore_backup_file(&backup.profile_path, &local_profile_path()?)?;
    restore_backup_file(&backup.state_db_path, &local_state_db_path()?)?;
    Ok(())
}

fn list_local_backups() -> Result<Vec<KiroLocalBackupInfo>, String> {
    let root = local_backup_root_dir()?;
    let mut backups = Vec::new();
    for entry in fs::read_dir(&root).map_err(|error| format!("读取本机备份目录失败: {}", error))?
    {
        let entry = entry.map_err(|error| format!("读取本机备份目录项失败: {}", error))?;
        let backup_dir = entry.path();
        if !backup_dir.is_dir() {
            continue;
        }
        let Some(id) = backup_dir
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(non_empty_string)
        else {
            continue;
        };
        if normalize_backup_id(&id).is_err() {
            continue;
        }
        let auth_path = backup_dir.join("kiro-auth-token.json");
        let profile_path = backup_dir.join("profile.json");
        let state_db_path = backup_dir.join("state.vscdb");
        let created_at = id
            .parse::<i64>()
            .ok()
            .or_else(|| {
                fs::metadata(&backup_dir)
                    .ok()
                    .and_then(|meta| meta.created().ok())
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs() as i64)
            })
            .unwrap_or(0);
        backups.push(KiroLocalBackupInfo {
            id,
            backup_dir: backup_dir.to_string_lossy().to_string(),
            created_at,
            auth_exists: auth_path.exists(),
            profile_exists: profile_path.exists(),
            state_db_exists: state_db_path.exists(),
        });
    }
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

fn restore_local_backup_by_id(backup_id: &str) -> Result<(), String> {
    let id = normalize_backup_id(backup_id)?;
    let backup_dir = local_backup_root_dir()?.join(&id);
    if !backup_dir.exists() || !backup_dir.is_dir() {
        return Err(format!("备份不存在: {}", id));
    }
    let safety_backup = backup_local_kiro_state()
        .map_err(|error| format!("恢复前创建安全备份失败，已停止恢复: {}", error))?;
    let target = LocalKiroBackup {
        auth_path: backup_dir.join("kiro-auth-token.json"),
        profile_path: backup_dir.join("profile.json"),
        state_db_path: backup_dir.join("state.vscdb"),
    };
    if let Err(error) = restore_local_kiro_state(&target) {
        let rollback = restore_local_kiro_state(&safety_backup);
        return Err(match rollback {
            Ok(()) => format!("恢复备份失败，已回滚恢复前状态：{}", error),
            Err(rollback_error) => format!(
                "恢复备份失败，且回滚恢复前状态失败：{}；回滚错误：{}",
                error, rollback_error
            ),
        });
    }
    Ok(())
}

fn normalize_backup_id(value: &str) -> Result<String, String> {
    let id = value.trim();
    if id.is_empty() {
        return Err("备份 ID 不能为空".to_string());
    }
    if !id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("备份 ID 非法".to_string());
    }
    Ok(id.to_string())
}

fn copy_if_exists(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建备份目录失败: {}", error))?;
    }
    fs::copy(source, target)
        .map(|_| ())
        .map_err(|error| format!("备份文件失败({}): {}", source.display(), error))
}

fn restore_backup_file(backup: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建恢复目录失败: {}", error))?;
    }
    if backup.exists() {
        fs::copy(backup, target)
            .map(|_| ())
            .map_err(|error| format!("恢复文件失败({}): {}", target.display(), error))
    } else if target.exists() {
        fs::remove_file(target)
            .map_err(|error| format!("清理切换残留文件失败({}): {}", target.display(), error))
    } else {
        Ok(())
    }
}

pub fn start_kiro_background_refresh(app_handle: tauri::AppHandle) {
    if BACKGROUND_REFRESH_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(10));
        loop {
            let settings = load_background_refresh_settings();
            if settings.enabled {
                let app_handle_for_tick = app_handle.clone();
                tauri::async_runtime::block_on(async move {
                    if let Err(error) =
                        run_background_refresh_tick(&app_handle_for_tick, settings).await
                    {
                        eprintln!("[Kiro Account] Background refresh failed: {}", error);
                    }
                });
            }
            std::thread::sleep(Duration::from_secs(BACKGROUND_POLL_SECONDS));
        }
    });
}

async fn run_background_refresh_tick(
    app_handle: &tauri::AppHandle,
    settings: KiroBackgroundRefreshSettings,
) -> Result<(), String> {
    let max_age_seconds = settings.interval_minutes.saturating_mul(60).max(60);
    let result = refresh_stale_accounts(max_age_seconds).await?;
    record_background_refresh_result(&settings, &result);
    if result.success_count > 0 || result.failed_count > 0 {
        let _ = app_handle.emit_all("kiro-account-refresh-updated", &result);
        if settings.notify_on_change {
            let message = format!(
                "Kiro 账号刷新：成功 {}，失败 {}",
                result.success_count, result.failed_count
            );
            update_kiro_background_tray_tooltip(app_handle, message.as_str());
            show_kiro_background_notification(app_handle, message.as_str());
        }
    }
    let _ = app_handle.emit_all(
        "kiro-account-refresh-status-updated",
        load_background_refresh_status(),
    );
    Ok(())
}

fn update_kiro_background_tray_tooltip(app_handle: &tauri::AppHandle, tooltip: &str) {
    if let Some(tray) = app_handle.tray_handle_by_id("kiro-account-tray") {
        let _ = tray.set_tooltip(tooltip);
    }
}

fn show_kiro_background_notification(app_handle: &tauri::AppHandle, body: &str) {
    let _ = app_handle.emit_all("kiro-account-refresh-notification", body);
    let identifier = app_handle.config().tauri.bundle.identifier.clone();
    let _ = tauri::api::notification::Notification::new(identifier)
        .title("Kiro 账号后台刷新")
        .body(body)
        .show();
}

fn ensure_kiro_background_tray(app_handle: &tauri::AppHandle) -> Result<(), String> {
    if let Some(tray) = app_handle.tray_handle_by_id("kiro-account-tray") {
        let _ = tray.set_tooltip("Kiro 账号后台刷新");
        return Ok(());
    }
    let icon = crate::commands::app_window_icon()?;
    let app_handle_for_tray = app_handle.clone();
    tauri::SystemTray::new()
        .with_id("kiro-account-tray")
        .with_icon(icon)
        .with_tooltip("Kiro 账号后台刷新")
        .with_menu(
            tauri::SystemTrayMenu::new().add_item(tauri::CustomMenuItem::new(
                "kiro_account_show",
                "显示 Kiro 账号管理",
            )),
        )
        .on_event(move |event| match event {
            tauri::SystemTrayEvent::LeftClick { .. } => {
                let handle = app_handle_for_tray.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::commands::show_tool_window(
                        "tool-kiro-account-manager".to_string(),
                        handle,
                    );
                });
            }
            tauri::SystemTrayEvent::MenuItemClick { id, .. } => {
                if id.as_str() == "kiro_account_show" {
                    let handle = app_handle_for_tray.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::commands::show_tool_window(
                            "tool-kiro-account-manager".to_string(),
                            handle,
                        );
                    });
                }
            }
            _ => {}
        })
        .build(app_handle)
        .map_err(|error| format!("创建 Kiro 后台刷新托盘失败: {}", error))?;
    Ok(())
}

fn build_auth_snapshot(account: &KiroAccount) -> Value {
    let mut raw = account
        .auth_raw
        .clone()
        .unwrap_or_else(|| serde_json::json!({}));
    if !raw.is_object() {
        raw = serde_json::json!({});
    }
    let object = raw.as_object_mut().expect("object ensured");
    object.insert(
        "accessToken".to_string(),
        Value::String(account.access_token.clone()),
    );
    insert_optional_string(object, "refreshToken", account.refresh_token.as_deref());
    insert_optional_string(object, "tokenType", account.token_type.as_deref());
    insert_optional_string(object, "email", Some(account.email.as_str()));
    insert_optional_string(object, "userId", account.user_id.as_deref());
    insert_optional_string(object, "provider", account.login_provider.as_deref());
    insert_optional_string(object, "loginProvider", account.login_provider.as_deref());
    if let Some(expires_at) = account.expires_at {
        object.insert(
            "expiresAt".to_string(),
            Value::String(timestamp_to_iso(expires_at)),
        );
    }
    raw
}

fn build_profile_snapshot(account: &KiroAccount) -> Value {
    let mut raw = account
        .profile_raw
        .clone()
        .unwrap_or_else(|| serde_json::json!({}));
    if !raw.is_object() {
        raw = serde_json::json!({});
    }
    let object = raw.as_object_mut().expect("object ensured");
    insert_optional_string(object, "email", Some(account.email.as_str()));
    insert_optional_string(object, "userId", account.user_id.as_deref());
    insert_optional_string(object, "loginProvider", account.login_provider.as_deref());
    if !object.contains_key("name") {
        insert_optional_string(
            object,
            "name",
            account
                .login_provider
                .as_deref()
                .or(Some(account.email.as_str())),
        );
    }
    if !object.contains_key("arn") {
        insert_optional_string(
            object,
            "arn",
            account.user_id.as_deref().or(Some(account.email.as_str())),
        );
    }
    raw
}

fn timestamp_to_iso(mut timestamp: i64) -> String {
    if timestamp > 10_000_000_000 {
        timestamp /= 1000;
    }
    chrono::DateTime::from_timestamp(timestamp, 0)
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn insert_optional_string(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<&str>,
) {
    if let Some(value) = value.and_then(non_empty_string) {
        object.insert(key.to_string(), Value::String(value));
    }
}

fn insert_optional_string_if_missing(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<&str>,
) {
    if object
        .get(key)
        .and_then(Value::as_str)
        .and_then(non_empty_string)
        .is_some()
    {
        return;
    }
    insert_optional_string(object, key, value);
}

fn account_from_raw(
    auth_raw: Value,
    profile_raw: Option<Value>,
    usage_raw: Option<Value>,
    tags: Vec<String>,
) -> Result<KiroAccount, String> {
    let access_token = first_string(
        &auth_raw,
        &[
            &["accessToken"],
            &["access_token"],
            &["token"],
            &["idToken"],
            &["id_token"],
        ],
    )
    .ok_or_else(|| "缺少 accessToken".to_string())?;
    let email = first_string_many(
        &[Some(&auth_raw), profile_raw.as_ref(), usage_raw.as_ref()],
        &[
            &["email"],
            &["userEmail"],
            &["login_hint"],
            &["loginHint"],
            &["userInfo", "email"],
            &["user", "email"],
        ],
    )
    .unwrap_or_else(|| "kiro-account".to_string());
    let user_id = first_string_many(
        &[Some(&auth_raw), profile_raw.as_ref(), usage_raw.as_ref()],
        &[
            &["userId"],
            &["user_id"],
            &["sub"],
            &["accountId"],
            &["arn"],
            &["profileArn"],
            &["userInfo", "userId"],
        ],
    );
    let login_provider = first_string_many(
        &[Some(&auth_raw), profile_raw.as_ref()],
        &[
            &["provider"],
            &["loginProvider"],
            &["login_option"],
            &["authMethod"],
            &["name"],
        ],
    );
    let idc_region = first_string_many(
        &[Some(&auth_raw), profile_raw.as_ref()],
        &[&["idc_region"], &["idcRegion"], &["region"]],
    );
    let issuer_url = first_string_many(
        &[Some(&auth_raw), profile_raw.as_ref()],
        &[&["issuer_url"], &["issuerUrl"], &["issuer"]],
    );
    let client_id = first_string_many(
        &[Some(&auth_raw), profile_raw.as_ref()],
        &[
            &["client_id"],
            &["clientId"],
            &["clientRegistration", "clientId"],
            &["registration", "clientId"],
            &["oidcClient", "clientId"],
        ],
    );
    let scopes = first_string_many(
        &[Some(&auth_raw), profile_raw.as_ref()],
        &[&["scopes"], &["scope"]],
    );
    let login_hint = first_string_many(
        &[Some(&auth_raw), profile_raw.as_ref(), usage_raw.as_ref()],
        &[&["login_hint"], &["loginHint"], &["email"], &["userEmail"]],
    );
    let refresh_token = first_string(&auth_raw, &[&["refreshToken"], &["refresh_token"]]);
    let token_type = first_string(&auth_raw, &[&["tokenType"], &["token_type"]]);
    let expires_at = first_timestamp(&auth_raw, &[&["expiresAt"], &["expires_at"], &["expiry"]]);
    let plan_name = resolve_plan_name(usage_raw.as_ref());
    let plan_tier = first_string_many(
        &[usage_raw.as_ref()],
        &[
            &["planTier"],
            &["tier"],
            &["subscriptionInfo", "type"],
            &["usageBreakdowns", "tier"],
            &["plan", "tier"],
        ],
    );
    let credits_total = first_number_in_roots(
        &[usage_raw.as_ref()],
        &[
            &["usageBreakdownList", "0", "usageLimitWithPrecision"],
            &["usageBreakdownList", "0", "usageLimit"],
            &["usageState", "usageBreakdowns", "0", "usageLimit"],
            &["credits", "total"],
            &["totalCredits"],
        ],
    );
    let credits_used = first_number_in_roots(
        &[usage_raw.as_ref()],
        &[
            &["usageBreakdownList", "0", "currentUsageWithPrecision"],
            &["usageBreakdownList", "0", "currentUsage"],
            &["usageState", "usageBreakdowns", "0", "currentUsage"],
            &["credits", "used"],
            &["usedCredits"],
        ],
    );
    let bonus_total = first_number_in_roots(
        &[usage_raw.as_ref()],
        &[
            &[
                "usageBreakdownList",
                "0",
                "freeTrialInfo",
                "usageLimitWithPrecision",
            ],
            &["usageBreakdownList", "0", "freeTrialInfo", "usageLimit"],
            &["bonusCredits", "total"],
            &["bonus", "total"],
        ],
    );
    let bonus_used = first_number_in_roots(
        &[usage_raw.as_ref()],
        &[
            &[
                "usageBreakdownList",
                "0",
                "freeTrialInfo",
                "currentUsageWithPrecision",
            ],
            &["usageBreakdownList", "0", "freeTrialInfo", "currentUsage"],
            &["bonusCredits", "used"],
            &["bonus", "used"],
        ],
    );
    let usage_reset_at = first_timestamp_in_roots(
        &[usage_raw.as_ref()],
        &[
            &["billingCycle", "resetDate"],
            &["billingCycle", "endsAt"],
            &["billingCycle", "endDate"],
            &["billingCycle", "nextResetAt"],
            &["nextDateReset"],
            &["resetAt"],
            &["resetTime"],
            &["resetOn"],
            &["usageBreakdownList", "0", "resetDate"],
            &["usageBreakdownList", "0", "resetAt"],
            &["usageBreakdowns", "resetAt"],
            &["usageBreakdowns", "0", "resetDate"],
            &["usageBreakdowns", "0", "resetAt"],
        ],
    );
    let now = now_ts();
    let usage_reset_at = usage_reset_at.or_else(|| {
        let has_usage = plan_name.is_some()
            || credits_total.is_some()
            || credits_used.is_some()
            || bonus_total.is_some()
            || bonus_used.is_some();
        has_usage.then(default_month_cycle_end_timestamp)
    });
    Ok(KiroAccount {
        id: stable_account_id(
            user_id.as_deref(),
            Some(email.as_str()),
            refresh_token.as_deref().or(Some(access_token.as_str())),
        ),
        email,
        user_id,
        login_provider,
        idc_region,
        issuer_url,
        client_id,
        scopes,
        login_hint,
        tags: normalize_tags(tags),
        access_token,
        refresh_token,
        token_type,
        expires_at,
        plan_name,
        plan_tier,
        credits_total,
        credits_used,
        bonus_total,
        bonus_used,
        usage_reset_at,
        status: None,
        status_reason: None,
        quota_query_last_error: None,
        quota_query_last_error_at: None,
        usage_updated_at: usage_raw.as_ref().map(|_| now),
        auth_raw: Some(auth_raw),
        profile_raw,
        usage_raw,
        created_at: now,
        last_used: now,
    })
}

fn parse_import_account(value: Value) -> Result<KiroAccount, String> {
    if let Ok(mut account) = serde_json::from_value::<KiroAccount>(value.clone()) {
        account.tags = normalize_tags(account.tags);
        if account.id.trim().is_empty() {
            account.id = stable_account_id(
                account.user_id.as_deref(),
                Some(account.email.as_str()),
                account
                    .refresh_token
                    .as_deref()
                    .or(Some(account.access_token.as_str())),
            );
        }
        return Ok(account);
    }
    let object = value
        .as_object()
        .ok_or_else(|| "导入项必须是对象".to_string())?;
    let auth_raw = object
        .get("authRaw")
        .or_else(|| object.get("auth_raw"))
        .or_else(|| object.get("kiro_auth_token_raw"))
        .or_else(|| object.get("authToken"))
        .or_else(|| object.get("token"))
        .cloned()
        .unwrap_or_else(|| value.clone());
    let profile_raw = object
        .get("profileRaw")
        .or_else(|| object.get("profile_raw"))
        .or_else(|| object.get("kiro_profile_raw"))
        .or_else(|| object.get("profile"))
        .cloned();
    let usage_raw = object
        .get("usageRaw")
        .or_else(|| object.get("usage_raw"))
        .or_else(|| object.get("kiro_usage_raw"))
        .or_else(|| object.get("usage"))
        .cloned();
    let tags = object
        .get("tags")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(ToString::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    account_from_raw(auth_raw, profile_raw, usage_raw, tags)
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashMap::new();
    let mut result = Vec::new();
    for tag in tags {
        let Some(tag) = non_empty_string(&tag) else {
            continue;
        };
        let key = tag.to_ascii_lowercase();
        if seen.insert(key, ()).is_none() {
            result.push(tag);
        }
    }
    result
}

fn display_email(account: &KiroAccount) -> String {
    non_empty_string(&account.email).unwrap_or_else(|| account.id.clone())
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn value_by_path<'a>(root: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = root;
    for key in path {
        if let Some(array) = current.as_array() {
            let index = key.parse::<usize>().ok()?;
            current = array.get(index)?;
        } else {
            current = current.as_object()?.get(*key)?;
        }
    }
    Some(current)
}

fn first_string(root: &Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        if let Some(value) = value_by_path(root, path)
            .and_then(Value::as_str)
            .and_then(non_empty_string)
        {
            return Some(value);
        }
    }
    None
}

fn first_string_many(roots: &[Option<&Value>], paths: &[&[&str]]) -> Option<String> {
    for root in roots.iter().flatten() {
        if let Some(value) = first_string(root, paths) {
            return Some(value);
        }
    }
    None
}

fn first_number(root: &Value, paths: &[&[&str]]) -> Option<f64> {
    for path in paths {
        let Some(value) = value_by_path(root, path) else {
            continue;
        };
        if let Some(number) = value.as_f64().filter(|number| number.is_finite()) {
            return Some(number);
        }
        if let Some(text) = value.as_str() {
            if let Ok(number) = text.trim().parse::<f64>() {
                if number.is_finite() {
                    return Some(number);
                }
            }
        }
    }
    None
}

fn first_number_in_roots(roots: &[Option<&Value>], paths: &[&[&str]]) -> Option<f64> {
    for root in roots.iter().flatten() {
        if let Some(value) = first_number(root, paths) {
            return Some(value);
        }
        if let Some(usage_state) = value_by_path(root, &["kiro.resourceNotifications.usageState"]) {
            if let Some(value) = first_number(usage_state, paths) {
                return Some(value);
            }
        }
    }
    None
}

fn first_timestamp(root: &Value, paths: &[&[&str]]) -> Option<i64> {
    for path in paths {
        let Some(value) = value_by_path(root, path) else {
            continue;
        };
        if let Some(timestamp) = normalize_timestamp(value) {
            return Some(timestamp);
        }
    }
    None
}

fn first_timestamp_in_roots(roots: &[Option<&Value>], paths: &[&[&str]]) -> Option<i64> {
    for root in roots.iter().flatten() {
        if let Some(value) = first_timestamp(root, paths) {
            return Some(value);
        }
        if let Some(usage_state) = value_by_path(root, &["kiro.resourceNotifications.usageState"]) {
            if let Some(value) = first_timestamp(usage_state, paths) {
                return Some(value);
            }
        }
    }
    None
}

fn normalize_timestamp(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_i64() {
        return Some(if number > 1_000_000_000_000 {
            number / 1000
        } else {
            number
        });
    }
    if let Some(number) = value.as_f64().filter(|number| *number > 0.0) {
        let number = number as i64;
        return Some(if number > 1_000_000_000_000 {
            number / 1000
        } else {
            number
        });
    }
    if let Some(text) = value.as_str().and_then(non_empty_string) {
        if let Ok(number) = text.parse::<i64>() {
            return Some(if number > 1_000_000_000_000 {
                number / 1000
            } else {
                number
            });
        }
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&text) {
            return Some(parsed.timestamp());
        }
    }
    None
}

fn resolve_plan_name(usage: Option<&Value>) -> Option<String> {
    let root = usage?;
    first_string(
        root,
        &[
            &["subscriptionInfo", "subscriptionName"],
            &["subscriptionInfo", "subscriptionTitle"],
            &["subscriptionInfo", "subscriptionType"],
            &["planName"],
            &["currentPlanName"],
            &["plan", "name"],
            &["usageBreakdownList", "0", "displayName"],
            &["usageBreakdownList", "0", "resourceType"],
        ],
    )
    .or_else(|| {
        value_by_path(root, &["kiro.resourceNotifications.usageState"])
            .and_then(|nested| first_string(nested, &[&["usageBreakdowns", "0", "displayName"]]))
    })
}

fn detect_kiro_exe_path() -> Option<PathBuf> {
    detect_kiro_exe_with_source().map(|(path, _)| path)
}

fn detect_kiro_exe_with_source() -> Option<(PathBuf, String)> {
    #[cfg(target_os = "windows")]
    {
        detect_kiro_exe_path_windows()
    }
    #[cfg(target_os = "macos")]
    {
        [
            "/Applications/Kiro.app/Contents/MacOS/Kiro",
            "/Applications/Kiro.app/Contents/MacOS/Electron",
        ]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.exists())
        .map(|path| (path, "应用目录".to_string()))
    }
    #[cfg(target_os = "linux")]
    {
        ["/usr/bin/kiro", "/opt/kiro/kiro"]
            .iter()
            .map(PathBuf::from)
            .find(|path| path.exists())
            .map(|path| (path, "系统路径".to_string()))
    }
}

#[cfg(target_os = "windows")]
fn detect_kiro_exe_path_windows() -> Option<(PathBuf, String)> {
    let settings = load_tool_settings();
    if let Some(manual_path) = settings.manual_kiro_exe_path.as_deref() {
        let path = PathBuf::from(manual_path);
        if is_existing_kiro_executable(&path) {
            return Some((path, "手动配置".to_string()));
        }
    }

    let mut candidates: Vec<(PathBuf, String)> = Vec::new();

    push_kiro_common_install_candidates(&mut candidates);
    push_kiro_path_candidates(&mut candidates);
    push_kiro_start_menu_candidates(&mut candidates);
    push_kiro_registry_candidates(&mut candidates);

    dedupe_path_sources(candidates)
        .into_iter()
        .find(|(path, _)| is_existing_kiro_executable(path))
}

#[cfg(target_os = "windows")]
fn push_kiro_common_install_candidates(candidates: &mut Vec<(PathBuf, String)>) {
    for env_name in ["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"] {
        let Ok(root) = std::env::var(env_name) else {
            continue;
        };
        let root = PathBuf::from(root);
        for relative in [
            ["Programs", "Kiro", "Kiro.exe"].as_slice(),
            ["Programs", "Kiro", "Electron.exe"].as_slice(),
            ["Kiro", "Kiro.exe"].as_slice(),
            ["Kiro", "Electron.exe"].as_slice(),
        ] {
            candidates.push((
                join_path_segments(&root, relative),
                format!("常见目录({})", env_name),
            ));
        }
    }
}

#[cfg(target_os = "windows")]
fn push_kiro_path_candidates(candidates: &mut Vec<(PathBuf, String)>) {
    let Some(path_env) = std::env::var_os("PATH") else {
        return;
    };
    for dir in std::env::split_paths(&path_env) {
        candidates.push((dir.join("Kiro.exe"), "PATH".to_string()));
        candidates.push((dir.join("kiro.exe"), "PATH".to_string()));
        candidates.push((dir.join("Electron.exe"), "PATH".to_string()));
    }
}

#[cfg(target_os = "windows")]
fn push_kiro_start_menu_candidates(candidates: &mut Vec<(PathBuf, String)>) {
    let mut menu_roots = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        menu_roots.push(
            PathBuf::from(appdata)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    if let Ok(program_data) = std::env::var("PROGRAMDATA") {
        menu_roots.push(
            PathBuf::from(program_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }

    for root in menu_roots {
        collect_kiro_shortcut_targets(&root, candidates, 0);
    }
}

#[cfg(target_os = "windows")]
fn collect_kiro_shortcut_targets(
    dir: &Path,
    candidates: &mut Vec<(PathBuf, String)>,
    depth: usize,
) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_kiro_shortcut_targets(&path, candidates, depth + 1);
            continue;
        }
        if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("lnk"))
            != Some(true)
        {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !filename.contains("kiro") {
            continue;
        }
        candidates.extend(
            resolve_kiro_shortcut_targets(&path)
                .into_iter()
                .map(|target| (target, "开始菜单快捷方式".to_string())),
        );
    }
}

#[cfg(target_os = "windows")]
fn resolve_kiro_shortcut_targets(path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let Ok(link) = lnk::ShellLink::open(path) else {
        candidates.push(path.to_path_buf());
        return candidates;
    };

    let mut target_paths = Vec::new();
    if let Some(link_info) = link.link_info() {
        if let Some(local_path) = link_info.local_base_path_unicode().as_deref() {
            target_paths.push(PathBuf::from(local_path));
        }
        if let Some(local_path) = link_info.local_base_path().as_deref() {
            target_paths.push(PathBuf::from(local_path));
        }
    }
    if let Some(relative_path) = link.relative_path().as_deref() {
        let relative = PathBuf::from(relative_path);
        if relative.is_absolute() {
            target_paths.push(relative);
        } else if let Some(parent) = path.parent() {
            target_paths.push(parent.join(relative));
        }
    }

    for target in target_paths {
        candidates.push(target.clone());
        if is_update_executable(&target) {
            if let Some(process_start) = link
                .arguments()
                .as_deref()
                .and_then(extract_squirrel_process_start_arg)
            {
                if let Some(parent) = target.parent() {
                    candidates.push(parent.join(process_start));
                }
            }
        }
    }

    candidates
}

#[cfg(target_os = "windows")]
fn push_kiro_registry_candidates(candidates: &mut Vec<(PathBuf, String)>) {
    use winreg::enums::*;
    use winreg::RegKey;

    let hives = [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE];
    let uninstall_paths = [
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    for hive in hives {
        let root = RegKey::predef(hive);
        if let Ok(app_paths) =
            root.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\App Paths\Kiro.exe")
        {
            if let Some(path) = registry_string_value(&app_paths, "") {
                candidates.push((PathBuf::from(path), "App Paths 注册表".to_string()));
            }
            if let Some(path) = registry_string_value(&app_paths, "Path") {
                let dir = PathBuf::from(path);
                candidates.push((dir.join("Kiro.exe"), "App Paths 注册表".to_string()));
                candidates.push((dir.join("Electron.exe"), "App Paths 注册表".to_string()));
            }
        }

        for uninstall_path in uninstall_paths {
            let Ok(uninstall) = root.open_subkey(uninstall_path) else {
                continue;
            };
            for subkey_name in uninstall.enum_keys().flatten() {
                let Ok(subkey) = uninstall.open_subkey(subkey_name) else {
                    continue;
                };
                let display_name =
                    registry_string_value(&subkey, "DisplayName").unwrap_or_default();
                let publisher = registry_string_value(&subkey, "Publisher").unwrap_or_default();
                if !display_name.to_ascii_lowercase().contains("kiro")
                    && !publisher.to_ascii_lowercase().contains("kiro")
                {
                    continue;
                }
                if let Some(location) = registry_string_value(&subkey, "InstallLocation") {
                    let dir = PathBuf::from(location.trim_matches('"'));
                    candidates.push((dir.join("Kiro.exe"), "卸载注册表".to_string()));
                    candidates.push((dir.join("Electron.exe"), "卸载注册表".to_string()));
                    candidates.push((dir.join("app").join("Kiro.exe"), "卸载注册表".to_string()));
                }
                for value_name in ["DisplayIcon", "UninstallString"] {
                    if let Some(raw) = registry_string_value(&subkey, value_name) {
                        candidates.extend(
                            extract_exe_paths_from_command(&raw)
                                .into_iter()
                                .map(|path| (path, "卸载注册表".to_string())),
                        );
                    }
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn registry_string_value(key: &winreg::RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name)
        .ok()
        .and_then(|value| non_empty_string(&value))
}

#[cfg(target_os = "windows")]
fn extract_squirrel_process_start_arg(arguments: &str) -> Option<String> {
    let tokens = command_line_tokens(arguments);
    tokens.windows(2).find_map(|pair| {
        if pair[0].eq_ignore_ascii_case("--processStart") {
            Some(pair[1].trim_matches('"').to_string())
        } else {
            None
        }
    })
}

#[cfg(target_os = "windows")]
fn extract_exe_paths_from_command(command: &str) -> Vec<PathBuf> {
    command_line_tokens(command)
        .into_iter()
        .filter(|token| token.to_ascii_lowercase().ends_with(".exe"))
        .map(|token| PathBuf::from(token.trim_matches('"').trim_end_matches(',')))
        .collect()
}

#[cfg(target_os = "windows")]
fn command_line_tokens(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in value.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

#[cfg(target_os = "windows")]
fn is_update_executable(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("Update.exe"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_existing_kiro_executable(path: &Path) -> bool {
    if !path.exists() || !path.is_file() {
        return false;
    }
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    filename == "kiro.exe"
        || (filename == "electron.exe"
            && path
                .parent()
                .map(|parent| {
                    parent
                        .to_string_lossy()
                        .to_ascii_lowercase()
                        .contains("kiro")
                })
                .unwrap_or(false))
}

#[cfg(target_os = "windows")]
fn dedupe_path_sources(paths: Vec<(PathBuf, String)>) -> Vec<(PathBuf, String)> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for (path, source) in paths {
        let key = path.to_string_lossy().to_ascii_lowercase();
        if seen.insert(key) {
            result.push((path, source));
        }
    }
    result
}

#[cfg(target_os = "windows")]
fn join_path_segments(root: &Path, segments: &[&str]) -> PathBuf {
    segments
        .iter()
        .fold(root.to_path_buf(), |path, segment| path.join(segment))
}

#[cfg(target_os = "windows")]
fn dpapi_protect(input: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use winapi::um::dpapi::CryptProtectData;
    use winapi::um::winbase::LocalFree;
    use winapi::um::wincrypt::DATA_BLOB;

    let mut input_blob = DATA_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output_blob = DATA_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let success = unsafe {
        CryptProtectData(
            &mut input_blob,
            ptr::null(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            0,
            &mut output_blob,
        )
    };
    if success == 0 {
        return Err("系统 DPAPI 加密 Kiro 账号失败".to_string());
    }
    let result = unsafe {
        std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
    };
    unsafe {
        LocalFree(output_blob.pbData as *mut _);
    }
    Ok(result)
}

#[cfg(not(target_os = "windows"))]
fn dpapi_protect(input: &[u8]) -> Result<Vec<u8>, String> {
    Ok(input.to_vec())
}

#[cfg(target_os = "windows")]
fn dpapi_unprotect(input: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use winapi::um::dpapi::CryptUnprotectData;
    use winapi::um::winbase::LocalFree;
    use winapi::um::wincrypt::DATA_BLOB;

    let mut input_blob = DATA_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output_blob = DATA_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let success = unsafe {
        CryptUnprotectData(
            &mut input_blob,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            0,
            &mut output_blob,
        )
    };
    if success == 0 {
        return Err("系统 DPAPI 解密 Kiro 账号失败".to_string());
    }
    let result = unsafe {
        std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
    };
    unsafe {
        LocalFree(output_blob.pbData as *mut _);
    }
    Ok(result)
}

#[cfg(not(target_os = "windows"))]
fn dpapi_unprotect(input: &[u8]) -> Result<Vec<u8>, String> {
    Ok(input.to_vec())
}

fn start_kiro() -> Result<(), String> {
    let exe = detect_kiro_exe_path().ok_or_else(|| "未找到 Kiro 启动程序".to_string())?;
    let user_data_dir = local_kiro_data_dir()?;
    spawn_kiro_with_dirs(&exe, &user_data_dir, None, false).map(|_| ())
}

fn start_kiro_isolated(account: &KiroAccount) -> Result<(), String> {
    let exe = detect_kiro_exe_path().ok_or_else(|| "未找到 Kiro 启动程序".to_string())?;
    let instance_dir = isolated_instance_dir(&account.id)?;
    let home_dir = isolated_home_dir(&account.id)?;
    let user_data_dir = isolated_user_data_dir(&account.id)?;
    let identity = stable_instance_identity(&instance_dir)?;
    write_account_to_isolated_paths(account, &home_dir, &user_data_dir, &identity)?;
    let pid = spawn_kiro_with_dirs(&exe, &user_data_dir, Some(&home_dir), true)?;
    save_instance_meta(&instance_dir, account, Some(pid))?;
    Ok(())
}

fn spawn_kiro_with_dirs(
    exe: &Path,
    user_data_dir: &Path,
    home_dir: Option<&Path>,
    new_window: bool,
) -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new(exe);
        command.creation_flags(0x08000000);
        command.arg("--user-data-dir").arg(user_data_dir);
        command.arg(if new_window {
            "--new-window"
        } else {
            "--reuse-window"
        });
        if let Some(home_dir) = home_dir {
            command.env("HOME", home_dir);
            command.env("USERPROFILE", home_dir);
            command.env(
                "AWS_SHARED_CREDENTIALS_FILE",
                home_dir.join(".aws").join("credentials"),
            );
            command.env("AWS_CONFIG_FILE", home_dir.join(".aws").join("config"));
        }
        let child = command
            .spawn()
            .map_err(|error| format!("启动 Kiro 失败: {}", error))?;
        Ok(child.id())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut command = std::process::Command::new(exe);
        command.arg("--user-data-dir").arg(user_data_dir);
        command.arg(if new_window {
            "--new-window"
        } else {
            "--reuse-window"
        });
        if let Some(home_dir) = home_dir {
            command.env("HOME", home_dir);
            command.env(
                "AWS_SHARED_CREDENTIALS_FILE",
                home_dir.join(".aws").join("credentials"),
            );
            command.env("AWS_CONFIG_FILE", home_dir.join(".aws").join("config"));
        }
        let child = command
            .spawn()
            .map_err(|error| format!("启动 Kiro 失败: {}", error))?;
        Ok(child.id())
    }
}
