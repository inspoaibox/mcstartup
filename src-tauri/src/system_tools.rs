use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::ToSocketAddrs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};

static DISK_SCAN_GENERATION: AtomicU64 = AtomicU64::new(0);
static CLEANUP_GENERATION: AtomicU64 = AtomicU64::new(0);
const ONEDRIVE_LOG_MIN_AGE_MS: u64 = 6 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostsFile {
    pub path: String,
    pub content: String,
    pub writable: bool,
    pub requires_admin: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostsResolveResult {
    pub domain: String,
    pub hosts_ip: String,
    pub dns_ips: Vec<String>,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownStatus {
    pub active: bool,
    pub raw: String,
    pub task_name: String,
    pub next_run_time: String,
    pub action: String,
    pub schedule: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownTaskRequest {
    pub action: String,
    pub schedule_kind: String,
    pub delay_minutes: Option<u64>,
    pub time: Option<String>,
    pub weekdays: Option<Vec<String>>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupEntry {
    pub id: String,
    pub kind: String,
    pub kind_label: String,
    pub name: String,
    pub command: String,
    pub location: String,
    pub source_label: String,
    pub enabled: bool,
    pub scope: String,
    pub can_toggle: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupToggleRequest {
    pub id: String,
    pub name: String,
    pub location: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLockProcess {
    pub pid: u32,
    pub name: String,
    pub app_name: String,
    pub service_short_name: String,
    pub status: String,
    pub restartable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForceDeleteResult {
    pub path: String,
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFileItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageFolder {
    pub path: String,
    pub name: String,
    pub parent_path: String,
    pub size: u64,
    pub file_count: u64,
    pub folder_count: u64,
    pub depth: u32,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileExtensionStat {
    pub extension: String,
    pub label: String,
    pub size: u64,
    pub count: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateFileGroup {
    pub signature: String,
    pub size: u64,
    pub count: u64,
    pub total_waste: u64,
    pub files: Vec<LargeFileItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAgeStat {
    pub bucket: String,
    pub label: String,
    pub size: u64,
    pub count: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageScanResult {
    pub root: String,
    pub scanned_size: u64,
    pub file_count: u64,
    pub folder_count: u64,
    pub duration_ms: u64,
    pub folders: Vec<DiskUsageFolder>,
    pub files: Vec<LargeFileItem>,
    pub extensions: Vec<FileExtensionStat>,
    pub duplicates: Vec<DuplicateFileGroup>,
    pub age_stats: Vec<FileAgeStat>,
    pub excluded_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskVolume {
    pub root: String,
    pub name: String,
    pub drive_type: u32,
    pub drive_type_label: String,
    pub file_system: String,
    pub total: u64,
    pub free: u64,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub category: String,
    pub category_label: String,
    pub risk: String,
    pub risk_label: String,
    pub size: u64,
    pub count: u64,
    pub selected_by_default: bool,
    pub safe: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub deleted_size: u64,
    pub deleted_count: u64,
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreviewItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreviewRequest {
    pub id: String,
    pub limit: Option<usize>,
    pub min_age_days: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupDeleteRequest {
    pub ids: Vec<String>,
    pub exclude_paths: Option<Vec<String>>,
    pub min_age_days: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupScanRequest {
    pub min_age_days: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsAdapter {
    pub interface_index: u32,
    pub name: String,
    pub description: String,
    pub status: String,
    pub mac_address: String,
    pub dns_servers: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsSetRequest {
    pub interface_index: u32,
    pub servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRepairAdapter {
    pub interface_index: u32,
    pub name: String,
    pub description: String,
    pub status: String,
    pub mac_address: String,
    pub link_speed: String,
    pub ip_addresses: Vec<String>,
    pub gateways: Vec<String>,
    pub dns_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRepairCheck {
    pub id: String,
    pub label: String,
    pub target: String,
    pub status: String,
    pub detail: String,
    pub latency_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRepairProxyInfo {
    pub winhttp: String,
    pub user_proxy_enabled: bool,
    pub user_proxy_server: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRepairHostsInfo {
    pub path: String,
    pub writable: bool,
    pub custom_entries: usize,
    pub suspicious_entries: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRepairSnapshot {
    pub generated_at: String,
    pub is_admin: bool,
    pub adapters: Vec<NetworkRepairAdapter>,
    pub checks: Vec<NetworkRepairCheck>,
    pub proxy: NetworkRepairProxyInfo,
    pub hosts: NetworkRepairHostsInfo,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRepairActionRequest {
    pub action: String,
    pub interface_index: Option<u32>,
    pub dns_preset: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRepairActionResult {
    pub success: bool,
    pub needs_reboot: bool,
    pub message: String,
    pub output: String,
    pub snapshot: NetworkRepairSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVarEntry {
    pub scope: String,
    pub name: String,
    pub value: String,
    pub is_path: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVarUpdateRequest {
    pub scope: String,
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVarDeleteRequest {
    pub scope: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvPathUpdateRequest {
    pub scope: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvPathValidateRequest {
    pub paths: Vec<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvPathValidationItem {
    pub path: String,
    pub expanded_path: String,
    pub exists: bool,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuEntry {
    pub id: String,
    pub root: String,
    pub source_label: String,
    pub scope: String,
    pub scope_label: String,
    pub menu_type: String,
    pub menu_type_label: String,
    pub key: String,
    pub label: String,
    pub command: String,
    pub icon: String,
    pub shift_only: bool,
    pub disabled: bool,
    pub can_delete: bool,
    pub can_edit: bool,
    pub registry_path: String,
    pub registry_item_path: String,
    pub command_registry_path: String,
    pub extension_id: String,
    pub extension_name: String,
    pub extension_server: String,
    pub applies_to: String,
    pub position: String,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuUpdateRequest {
    pub scope: String,
    pub key: Option<String>,
    pub label: String,
    pub command: String,
    pub icon: Option<String>,
    pub shift_only: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuDeleteRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuDisabledRequest {
    pub id: String,
    pub disabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuExportRequest {
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceEntry {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub state: String,
    pub start_mode: String,
    pub path_name: String,
    pub start_name: String,
    pub can_stop: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceActionRequest {
    pub name: String,
    pub action: String,
    pub startup_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskEntry {
    pub task_name: String,
    pub task_path: String,
    pub state: String,
    pub author: String,
    pub description: String,
    pub triggers: String,
    pub actions: String,
    pub last_run_time: String,
    pub next_run_time: String,
    pub last_task_result: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskActionRequest {
    pub task_name: String,
    pub task_path: String,
    pub action: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskDetailRequest {
    pub task_name: String,
    pub task_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAppEntry {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub install_date: String,
    pub install_location: String,
    pub estimated_size: u64,
    pub uninstall_string: String,
    pub quiet_uninstall_string: String,
    pub registry_path: String,
    pub scope: String,
    pub app_kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAppActionRequest {
    pub name: String,
    pub uninstall_string: String,
    pub quiet_uninstall_string: Option<String>,
    pub quiet: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAppLeftoverRequest {
    pub name: String,
    #[serde(default)]
    pub app_kind: String,
    pub publisher: String,
    pub install_location: String,
    pub registry_path: String,
    #[serde(default)]
    pub uninstalled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAppLeftoverItem {
    pub id: String,
    pub kind: String,
    pub kind_label: String,
    pub path: String,
    pub display_path: String,
    pub size: u64,
    pub count: u64,
    pub confidence: String,
    pub reason: String,
    pub selected_by_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAppLeftoverDeleteRequest {
    #[serde(default)]
    pub app: Option<InstalledAppLeftoverRequest>,
    pub items: Vec<InstalledAppLeftoverItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAppLeftoverDeleteResult {
    pub deleted_size: u64,
    pub deleted_count: u64,
    pub failed: Vec<String>,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoItem {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoSection {
    pub title: String,
    pub items: Vec<SystemInfoItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsUpdateService {
    pub name: String,
    pub display_name: String,
    pub status: String,
    pub start_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsHotfixEntry {
    pub hotfix_id: String,
    pub description: String,
    pub installed_on: String,
    pub installed_by: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsPendingUpdate {
    pub title: String,
    pub downloaded: bool,
    pub reboot_required: bool,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsUpdateStatus {
    pub services: Vec<WindowsUpdateService>,
    pub hotfixes: Vec<WindowsHotfixEntry>,
    pub pending_updates: Vec<WindowsPendingUpdate>,
    pub cache_size: u64,
    pub paused: bool,
    pub pause_until: String,
    pub update_disabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterEntry {
    pub name: String,
    pub driver_name: String,
    pub port_name: String,
    pub shared: bool,
    pub share_name: String,
    pub published: bool,
    pub device_type: String,
    pub printer_status: String,
    pub printer_status_label: String,
    pub work_offline: bool,
    pub default: bool,
    pub network: bool,
    pub local: bool,
    pub location: String,
    pub comment: String,
    pub color_supported: bool,
    pub duplexing_mode: String,
    pub paper_size: String,
    pub print_quality: String,
    pub jobs_count: u64,
    pub paused: bool,
    pub keep_printed_jobs: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterJobEntry {
    pub printer_name: String,
    pub id: u64,
    pub document_name: String,
    pub user_name: String,
    pub job_status: String,
    pub submitted_time: String,
    pub size: u64,
    pub total_pages: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerEntry {
    pub name: String,
    pub device_id: String,
    pub manufacturer: String,
    pub service: String,
    pub status: String,
    pub pnp_class: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterManagerSnapshot {
    pub printers: Vec<PrinterEntry>,
    pub jobs: Vec<PrinterJobEntry>,
    pub scanners: Vec<ScannerEntry>,
    pub default_printer: String,
    pub printer_count: usize,
    pub scanner_count: usize,
    pub job_count: usize,
    pub generated_at: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterDiagnosticCheck {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterDiagnosticResult {
    pub printer_name: String,
    pub overall_status: String,
    pub overall_label: String,
    pub checks: Vec<PrinterDiagnosticCheck>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterActionRequest {
    pub action: String,
    pub printer_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJobActionRequest {
    pub action: String,
    pub printer_name: String,
    pub job_id: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistribution {
    pub name: String,
    pub state: String,
    pub version: String,
    pub default: bool,
    pub running: bool,
    pub base_path: String,
    pub vhd_path: String,
    pub size: u64,
    pub last_write_time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslStatus {
    pub installed: bool,
    pub default_distribution: String,
    pub kernel_version: String,
    pub distributions: Vec<WslDistribution>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverStorePackage {
    pub published_name: String,
    pub original_name: String,
    pub provider_name: String,
    pub class_name: String,
    pub category: String,
    pub category_label: String,
    pub class_guid: String,
    pub extension_id: String,
    pub driver_version: String,
    pub driver_date: String,
    pub signer_name: String,
    pub catalog_file: String,
    pub driver_files: Vec<String>,
    pub size: u64,
    pub installed: bool,
    pub device_names: Vec<String>,
    pub older_duplicate: bool,
    pub selected_by_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverUpdateInfo {
    pub title: String,
    pub description: String,
    pub categories: Vec<String>,
    pub severity: String,
    pub reboot_required: bool,
    pub driver_class: String,
    pub driver_manufacturer: String,
    pub driver_model: String,
    pub driver_provider: String,
    pub driver_version: String,
    pub matched_categories: Vec<String>,
    pub matched_packages: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverStoreStatus {
    pub packages: Vec<DriverStorePackage>,
    pub total_size: u64,
    pub third_party_count: usize,
    pub duplicate_count: usize,
    pub installed_count: usize,
    pub update_checked: bool,
    pub update_check_time: String,
    pub update_count: usize,
    pub updates: Vec<DriverUpdateInfo>,
    pub update_message: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverStoreActionRequest {
    pub published_names: Vec<String>,
    pub action: String,
    pub output_dir: Option<String>,
    pub update_titles: Option<Vec<String>>,
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverStoreActionResult {
    pub status: DriverStoreStatus,
    pub message: String,
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorOverview {
    pub timestamp: String,
    pub computer_name: String,
    pub os_name: String,
    pub uptime_seconds: u64,
    pub cpu_usage_percent: f64,
    pub total_memory: u64,
    pub free_memory: u64,
    pub used_memory: u64,
    pub memory_usage_percent: f64,
    pub process_count: u64,
    pub thread_count: u64,
    pub handle_count: u64,
    pub network_connection_count: u64,
    pub disk_read_bytes_per_sec: u64,
    pub disk_write_bytes_per_sec: u64,
    pub network_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorProcess {
    pub pid: u32,
    pub parent_pid: u32,
    pub name: String,
    pub executable_path: String,
    pub command_line: String,
    pub window_title: String,
    pub session_id: u32,
    pub category: String,
    pub category_label: String,
    pub creation_time: String,
    pub cpu_percent: f64,
    pub private_bytes: u64,
    pub working_set: u64,
    pub thread_count: u64,
    pub handle_count: u64,
    pub io_read_bytes_per_sec: u64,
    pub io_write_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorService {
    pub name: String,
    pub display_name: String,
    pub state: String,
    pub start_mode: String,
    pub process_id: u32,
    pub start_name: String,
    pub path_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorConnection {
    pub protocol: String,
    pub local_address: String,
    pub local_port: u32,
    pub remote_address: String,
    pub remote_port: u32,
    pub state: String,
    pub owning_process: u32,
    pub process_name: String,
    pub creation_time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorDisk {
    pub name: String,
    pub read_bytes_per_sec: u64,
    pub write_bytes_per_sec: u64,
    pub disk_time_percent: f64,
    pub queue_length: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorNetworkInterface {
    pub name: String,
    pub bytes_received_per_sec: u64,
    pub bytes_sent_per_sec: u64,
    pub bytes_total_per_sec: u64,
    pub current_bandwidth: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorSnapshot {
    pub overview: SystemMonitorOverview,
    pub processes: Vec<SystemMonitorProcess>,
    pub services: Vec<SystemMonitorService>,
    pub connections: Vec<SystemMonitorConnection>,
    pub disks: Vec<SystemMonitorDisk>,
    pub network_interfaces: Vec<SystemMonitorNetworkInterface>,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslActionRequest {
    pub name: String,
    pub action: String,
    pub output_path: Option<String>,
}

#[derive(Debug, Clone)]
struct CleanupTarget {
    id: String,
    name: String,
    description: String,
    path: PathBuf,
    category: String,
    category_label: String,
    risk: String,
    risk_label: String,
    selected_by_default: bool,
    safe: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CleanupFilePolicy {
    All,
    OneDriveBusinessLogs,
}

#[derive(Debug, Clone)]
struct FolderScanStat {
    path: String,
    name: String,
    parent_path: String,
    size: u64,
    file_count: u64,
    folder_count: u64,
    depth: u32,
}

#[derive(Debug, Clone)]
struct ExtensionScanStat {
    size: u64,
    count: u64,
}

#[derive(Debug, Clone, Default)]
struct AgeScanStat {
    size: u64,
    count: u64,
}

async fn run_system_blocking<T, F>(label: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| format!("{}任务执行失败: {}", label, e))?
}

#[tauri::command]
pub fn system_hosts_read() -> Result<HostsFile, String> {
    let path = hosts_path();
    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取 Hosts 失败: {}", e))?;
    Ok(HostsFile {
        path: path.to_string_lossy().to_string(),
        content,
        writable: can_write_hosts_directly(),
        requires_admin: !can_write_hosts_directly(),
    })
}

#[tauri::command]
pub fn system_hosts_save(content: String) -> Result<HostsFile, String> {
    let normalized = normalize_hosts_content(&content);
    let path = hosts_path();
    std::fs::write(&path, normalized).map_err(|e| {
        format!(
            "保存 Hosts 失败: {}。请使用管理员保存，或以管理员身份运行 McStartUP。",
            e
        )
    })?;
    system_hosts_read()
}

#[tauri::command]
pub fn system_hosts_save_admin(content: String) -> Result<HostsFile, String> {
    let normalized = normalize_hosts_content(&content);
    let temp_path = std::env::temp_dir().join(format!(
        "mcstartup-hosts-{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&temp_path, normalized).map_err(|e| format!("写入临时 Hosts 失败: {}", e))?;

    let status = copy_hosts_with_elevation(&temp_path, &hosts_path())?;
    let _ = std::fs::remove_file(temp_path);
    if !status && !hosts_content_matches(&content) {
        return Err("管理员保存未完成：UAC 可能被取消，或 PowerShell 被系统策略拦截。".to_string());
    }
    system_hosts_read()
}

#[tauri::command]
pub fn system_hosts_open_dir() -> Result<(), String> {
    let path = hosts_path();
    let parent = path
        .parent()
        .ok_or_else(|| "无法定位 Hosts 所在目录".to_string())?;
    open_path(parent)
}

#[tauri::command]
pub fn system_hosts_resolve(domain: String) -> Result<HostsResolveResult, String> {
    let domain = domain.trim().trim_end_matches('.').to_lowercase();
    if domain.is_empty() {
        return Err("请输入要测试解析的域名".to_string());
    }
    if !is_valid_hosts_domain(&domain) {
        return Err("域名格式不正确".to_string());
    }
    let content = std::fs::read_to_string(hosts_path()).unwrap_or_default();
    let hosts_ip = hosts_ip_for_domain(&content, &domain).unwrap_or_default();
    let mut dns_ips = Vec::new();
    if let Ok(addresses) = (domain.as_str(), 80).to_socket_addrs() {
        let mut seen = HashSet::new();
        for address in addresses {
            let ip = address.ip().to_string();
            if seen.insert(ip.clone()) {
                dns_ips.push(ip);
            }
        }
    }
    let raw = if hosts_ip.is_empty() {
        format!("Hosts 未命中；系统 DNS 返回：{}", dns_ips.join(", "))
    } else {
        format!(
            "Hosts 命中 {}；系统 DNS 返回：{}",
            hosts_ip,
            dns_ips.join(", ")
        )
    };
    Ok(HostsResolveResult {
        domain,
        hosts_ip,
        dns_ips,
        raw,
    })
}

#[tauri::command]
pub fn system_shutdown_schedule(
    seconds: u64,
    message: Option<String>,
) -> Result<ShutdownStatus, String> {
    if seconds < 60 {
        return Err("定时关机至少需要 60 秒后执行".to_string());
    }
    system_shutdown_task_save(ShutdownTaskRequest {
        action: "shutdown".to_string(),
        schedule_kind: "once".to_string(),
        delay_minutes: Some((seconds / 60).max(1)),
        time: None,
        weekdays: None,
        message,
    })
}

#[tauri::command]
pub fn system_shutdown_restart(
    seconds: u64,
    message: Option<String>,
) -> Result<ShutdownStatus, String> {
    if seconds < 60 {
        return Err("定时重启至少需要 60 秒后执行".to_string());
    }
    system_shutdown_task_save(ShutdownTaskRequest {
        action: "restart".to_string(),
        schedule_kind: "once".to_string(),
        delay_minutes: Some((seconds / 60).max(1)),
        time: None,
        weekdays: None,
        message,
    })
}

#[tauri::command]
pub fn system_shutdown_cancel() -> Result<ShutdownStatus, String> {
    let mut command = Command::new("shutdown");
    command.arg("/a");
    let _ = run_hidden(&mut command);
    let _ = system_shutdown_task_delete();
    system_shutdown_status()
}

#[tauri::command]
pub fn system_shutdown_task_save(request: ShutdownTaskRequest) -> Result<ShutdownStatus, String> {
    let action = match request.action.as_str() {
        "shutdown" => "/s",
        "restart" => "/r",
        _ => return Err("任务动作无效".to_string()),
    };
    let schedule_kind = request.schedule_kind.as_str();
    let message = request
        .message
        .unwrap_or_else(|| "McStartUP 定时任务".to_string())
        .trim()
        .replace('"', "'")
        .to_string();
    let shutdown_args = format!("{} /t 0 /c \"{}\"", action, message);
    let trigger = match schedule_kind {
        "once" => {
            let minutes = request.delay_minutes.unwrap_or(60).clamp(1, 525_600);
            format!(
                "New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes({})",
                minutes
            )
        }
        "daily" => {
            let time = validate_time_text(request.time.as_deref().unwrap_or("23:30"))?;
            format!("New-ScheduledTaskTrigger -Daily -At '{}'", time)
        }
        "weekly" => {
            let time = validate_time_text(request.time.as_deref().unwrap_or("23:30"))?;
            let weekdays = request
                .weekdays
                .unwrap_or_default()
                .into_iter()
                .filter(|day| valid_weekday(day))
                .collect::<Vec<_>>();
            if weekdays.is_empty() {
                return Err("重复计划至少选择一个星期".to_string());
            }
            format!(
                "New-ScheduledTaskTrigger -Weekly -DaysOfWeek {} -At '{}'",
                weekdays.join(","),
                time
            )
        }
        _ => return Err("计划类型无效".to_string()),
    };
    let description = format!("McStartUP {} {}", request.action, request.schedule_kind);
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
$taskName = 'McStartUP_ShutdownScheduler'
$taskPath = '\McStartUP\'
$action = New-ScheduledTaskAction -Execute 'shutdown.exe' -Argument '{}'
$trigger = {}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger -Settings $settings -Description '{}' -Force | Out-Null
"#,
        escape_powershell_single_quote(&shutdown_args),
        trigger,
        escape_powershell_single_quote(&description)
    );
    if let Err(err) = run_powershell_script_hidden(&script) {
        if is_elevation_required_error(&err) {
            run_powershell_script_with_elevation(&script)
                .map_err(|e| format!("创建定时任务需要管理员权限：{}。{}", err, e))?;
        } else {
            return Err(err);
        }
    }
    system_shutdown_status()
}

#[tauri::command]
pub fn system_shutdown_task_delete() -> Result<ShutdownStatus, String> {
    let mut cancel_native = Command::new("shutdown");
    cancel_native.arg("/a");
    let _ = run_hidden(&mut cancel_native);
    let script = r#"$ErrorActionPreference = 'SilentlyContinue'
Unregister-ScheduledTask -TaskPath '\McStartUP\' -TaskName 'McStartUP_ShutdownScheduler' -Confirm:$false
"#;
    if let Err(err) = run_powershell_script_hidden(script) {
        if is_elevation_required_error(&err) {
            run_powershell_script_with_elevation(script)
                .map_err(|e| format!("删除定时任务需要管理员权限：{}。{}", err, e))?;
        } else {
            return Err(err);
        }
    }
    system_shutdown_status()
}

#[tauri::command]
pub fn system_shutdown_status() -> Result<ShutdownStatus, String> {
    let script = r#"$ErrorActionPreference = 'SilentlyContinue'
$task = Get-ScheduledTask -TaskPath '\McStartUP\' -TaskName 'McStartUP_ShutdownScheduler'
if ($null -eq $task) { return }
$info = Get-ScheduledTaskInfo -TaskPath $task.TaskPath -TaskName $task.TaskName
$actions = ($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
$triggers = ($task.Triggers | ForEach-Object { "$($_.CimClass.CimClassName) $($_.StartBoundary) Days=$($_.DaysOfWeek)" }) -join '; '
[pscustomobject]@{
  TaskName = "$($task.TaskPath)$($task.TaskName)"
  State = "$($task.State)"
  NextRunTime = "$($info.NextRunTime)"
  Actions = $actions
  Triggers = $triggers
  Description = $task.Description
} | ConvertTo-Json -Compress
"#;
    let rows = powershell_json_rows(script)?;
    let Some(value) = rows.first() else {
        return Ok(ShutdownStatus {
            active: false,
            raw: "未找到 McStartUP 自建定时关机计划。".to_string(),
            task_name: String::new(),
            next_run_time: String::new(),
            action: String::new(),
            schedule: String::new(),
        });
    };
    let actions = json_string(value, "Actions");
    let action = if actions.contains("/r") {
        "restart"
    } else {
        "shutdown"
    }
    .to_string();
    let schedule = json_string(value, "Triggers");
    Ok(ShutdownStatus {
        active: !json_string(value, "State").eq_ignore_ascii_case("Disabled"),
        raw: format!(
            "任务：{}\n状态：{}\n下次运行：{}\n动作：{}\n触发器：{}",
            json_string(value, "TaskName"),
            json_string(value, "State"),
            json_string(value, "NextRunTime"),
            actions,
            schedule
        ),
        task_name: json_string(value, "TaskName"),
        next_run_time: json_string(value, "NextRunTime"),
        action,
        schedule,
    })
}

#[tauri::command]
pub async fn system_startup_list() -> Result<Vec<StartupEntry>, String> {
    run_system_blocking("读取开机启动项", system_startup_list_blocking).await
}

fn system_startup_list_blocking() -> Result<Vec<StartupEntry>, String> {
    system_startup_list_by_kind_blocking("all")
}

#[tauri::command]
pub async fn system_startup_list_by_kind(kind: String) -> Result<Vec<StartupEntry>, String> {
    run_system_blocking("读取开机启动项", move || {
        system_startup_list_by_kind_blocking(&kind)
    })
    .await
}

fn system_startup_list_by_kind_blocking(kind: &str) -> Result<Vec<StartupEntry>, String> {
    let mut entries = Vec::new();
    if matches!(kind, "all" | "registry") {
        collect_run_key_entries(
            &mut entries,
            "HKCU",
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            "注册表：当前用户",
            "user",
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        )?;
        collect_run_key_entries(
            &mut entries,
            "HKLM",
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            "注册表：所有用户",
            "machine",
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        )?;
    }
    if matches!(kind, "all" | "folder") {
        collect_startup_folder_entries(&mut entries)?;
    }
    if matches!(kind, "all" | "task") {
        collect_scheduled_task_entries(&mut entries)?;
    }
    if matches!(kind, "all" | "service") {
        collect_service_entries(&mut entries)?;
    }
    entries.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub async fn system_startup_set_enabled(
    entry: StartupToggleRequest,
) -> Result<Vec<StartupEntry>, String> {
    run_system_blocking("更新开机启动项", move || {
        system_startup_set_enabled_blocking(entry)
    })
    .await
}

fn system_startup_set_enabled_blocking(
    entry: StartupToggleRequest,
) -> Result<Vec<StartupEntry>, String> {
    let parts = entry.id.split('|').collect::<Vec<_>>();
    if parts.is_empty() {
        return Err("启动项标识无效".to_string());
    }

    match parts[0] {
        "run" => {
            if parts.len() < 4 {
                return Err("注册表启动项标识无效".to_string());
            }
            set_startup_approved(parts[1], &entry.name, entry.enabled)?;
        }
        "startup-folder" => {
            if parts.len() < 2 {
                return Err("启动文件夹项标识无效".to_string());
            }
            let path = PathBuf::from(&entry.location);
            if entry.enabled {
                let disabled = disabled_shortcut_path(&path);
                if disabled.exists() {
                    std::fs::rename(&disabled, &path)
                        .map_err(|e| format!("启用启动项失败: {}", e))?;
                }
            } else if path.exists() {
                let disabled = disabled_shortcut_path(&path);
                std::fs::rename(&path, &disabled).map_err(|e| format!("禁用启动项失败: {}", e))?;
            }
        }
        "task" => {
            if parts.len() < 3 {
                return Err("计划任务标识无效".to_string());
            }
            set_scheduled_task_enabled(parts[1], parts[2], entry.enabled)?;
        }
        "service" => {
            if parts.len() < 2 {
                return Err("服务标识无效".to_string());
            }
            set_service_startup_enabled(parts[1], entry.enabled)?;
        }
        _ => return Err("暂不支持该启动项类型".to_string()),
    }

    system_startup_list_blocking()
}

#[tauri::command]
pub fn system_locks_query(path: String) -> Result<Vec<FileLockProcess>, String> {
    let target = PathBuf::from(path.trim());
    if target.as_os_str().is_empty() {
        return Err("请选择要检查的文件或文件夹".to_string());
    }
    if !target.exists() {
        return Err("路径不存在".to_string());
    }
    query_file_locks(&target)
}

#[tauri::command]
pub fn system_locks_kill(pid: u32) -> Result<(), String> {
    if pid <= 4 || pid == std::process::id() {
        return Err("该进程不允许从工具内结束".to_string());
    }
    let mut command = Command::new("taskkill");
    command.args(["/PID", &pid.to_string(), "/F"]);
    run_hidden(&mut command)
}

#[tauri::command]
pub fn system_force_delete(path: String) -> Result<ForceDeleteResult, String> {
    let target = PathBuf::from(path.trim());
    if target.as_os_str().is_empty() {
        return Err("请选择要删除的文件或文件夹".to_string());
    }
    if !target.exists() {
        return Err("路径不存在".to_string());
    }
    validate_force_delete_target(&target)?;

    match delete_path_direct(&target) {
        Ok(()) => Ok(ForceDeleteResult {
            path: target.to_string_lossy().to_string(),
            success: true,
            message: "已强制删除".to_string(),
        }),
        Err(direct_error) => {
            delete_path_with_elevation(&target, &direct_error)?;
            Ok(ForceDeleteResult {
                path: target.to_string_lossy().to_string(),
                success: true,
                message: "已通过管理员权限强制删除".to_string(),
            })
        }
    }
}

#[tauri::command]
pub fn system_large_files_scan(
    root: String,
    min_size_mb: u64,
    limit: usize,
) -> Result<Vec<LargeFileItem>, String> {
    let root = PathBuf::from(root.trim());
    if root.as_os_str().is_empty() {
        return Err("请选择要扫描的文件夹".to_string());
    }
    if !root.is_dir() {
        return Err("扫描路径必须是文件夹".to_string());
    }

    let min_size = min_size_mb.saturating_mul(1024).saturating_mul(1024);
    let limit = limit.clamp(10, 5000);
    let mut files = Vec::new();
    let mut stack = vec![root];

    while let Some(dir) = stack.pop() {
        let Ok(rows) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in rows.filter_map(Result::ok) {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                stack.push(path);
                continue;
            }
            if !metadata.is_file() || metadata.len() < min_size {
                continue;
            }
            files.push(LargeFileItem {
                name: path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string(),
                path: path.to_string_lossy().to_string(),
                size: metadata.len(),
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis() as u64),
            });
        }
    }

    files.sort_by(|a, b| b.size.cmp(&a.size));
    files.truncate(limit);
    Ok(files)
}

#[tauri::command]
pub async fn system_disk_usage_scan(
    root: String,
    min_size_mb: u64,
    limit: usize,
    exclude_paths: Option<Vec<String>>,
) -> Result<DiskUsageScanResult, String> {
    let generation = DISK_SCAN_GENERATION
        .fetch_add(1, Ordering::SeqCst)
        .saturating_add(1);
    tauri::async_runtime::spawn_blocking(move || {
        system_disk_usage_scan_blocking(
            root,
            min_size_mb,
            limit,
            exclude_paths.unwrap_or_default(),
            generation,
        )
    })
    .await
    .map_err(|e| format!("扫描任务执行失败: {}", e))?
}

#[tauri::command]
pub fn system_disk_usage_cancel_scan() -> Result<(), String> {
    DISK_SCAN_GENERATION.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

fn system_disk_usage_scan_blocking(
    root: String,
    min_size_mb: u64,
    limit: usize,
    exclude_paths: Vec<String>,
    generation: u64,
) -> Result<DiskUsageScanResult, String> {
    let started = std::time::Instant::now();
    let root_path = PathBuf::from(root.trim());
    if root_path.as_os_str().is_empty() {
        return Err("请选择要扫描的磁盘分区或文件夹".to_string());
    }
    if !root_path.is_dir() {
        return Err("扫描路径必须是磁盘分区或文件夹".to_string());
    }

    let root_key = normalize_scan_path(&root_path);
    let excluded_paths = normalize_exclude_scan_paths(exclude_paths);
    let mut folders = HashMap::<String, FolderScanStat>::new();
    folders.insert(
        root_key.clone(),
        FolderScanStat {
            path: root_key.clone(),
            name: folder_display_name(&root_path),
            parent_path: String::new(),
            size: 0,
            file_count: 0,
            folder_count: 0,
            depth: 0,
        },
    );

    let mut stack = vec![root_path];
    let mut large_files = Vec::<LargeFileItem>::new();
    let mut extension_stats = HashMap::<String, ExtensionScanStat>::new();
    let mut age_stats = HashMap::<String, AgeScanStat>::new();
    let min_size = min_size_mb.max(1).saturating_mul(1024).saturating_mul(1024);
    let file_limit = limit.clamp(20, 10_000);

    while let Some(dir) = stack.pop() {
        if DISK_SCAN_GENERATION.load(Ordering::SeqCst) != generation {
            return Err("扫描已取消".to_string());
        }
        if is_excluded_scan_path(&dir, &excluded_paths) {
            continue;
        }
        let dir_key = normalize_scan_path(&dir);
        let Ok(rows) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in rows.filter_map(Result::ok) {
            let path = entry.path();
            if is_excluded_scan_path(&path, &excluded_paths) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                let child_key = normalize_scan_path(&path);
                let depth = folders
                    .get(&dir_key)
                    .map(|folder| folder.depth.saturating_add(1))
                    .unwrap_or(0);
                folders
                    .entry(child_key.clone())
                    .or_insert_with(|| FolderScanStat {
                        path: child_key,
                        name: folder_display_name(&path),
                        parent_path: dir_key.clone(),
                        size: 0,
                        file_count: 0,
                        folder_count: 0,
                        depth,
                    });
                stack.push(path);
                continue;
            }
            if !metadata.is_file() {
                continue;
            }

            let size = metadata.len();
            if let Some(folder) = folders.get_mut(&dir_key) {
                folder.size = folder.size.saturating_add(size);
                folder.file_count = folder.file_count.saturating_add(1);
            }

            let extension = file_extension_key(&path);
            let extension_stat = extension_stats
                .entry(extension)
                .or_insert(ExtensionScanStat { size: 0, count: 0 });
            extension_stat.size = extension_stat.size.saturating_add(size);
            extension_stat.count = extension_stat.count.saturating_add(1);

            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64);
            let age_bucket = file_age_bucket(modified);
            let age_stat = age_stats.entry(age_bucket.to_string()).or_default();
            age_stat.size = age_stat.size.saturating_add(size);
            age_stat.count = age_stat.count.saturating_add(1);

            if size >= min_size {
                large_files.push(LargeFileItem {
                    name: path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                        .to_string(),
                    path: path.to_string_lossy().to_string(),
                    size,
                    modified,
                });
                if large_files.len() > file_limit.saturating_mul(4) {
                    large_files.sort_by(|a, b| b.size.cmp(&a.size));
                    large_files.truncate(file_limit);
                }
            }
        }
    }

    aggregate_folder_stats(&mut folders);
    let scanned_size = folders
        .get(&root_key)
        .map(|folder| folder.size)
        .unwrap_or(0);
    let file_count = folders
        .get(&root_key)
        .map(|folder| folder.file_count)
        .unwrap_or(0);
    let folder_count = folders
        .get(&root_key)
        .map(|folder| folder.folder_count)
        .unwrap_or(0);

    large_files.sort_by(|a, b| b.size.cmp(&a.size));
    large_files.truncate(file_limit);
    let duplicates = build_duplicate_file_groups(&large_files);

    let folders = select_folder_rows(&folders, &root_key, scanned_size, 8_000);
    let mut extensions = extension_stats
        .into_iter()
        .map(|(extension, stat)| FileExtensionStat {
            label: extension_label(&extension),
            extension,
            size: stat.size,
            count: stat.count,
            percent: percent_of(stat.size, scanned_size),
        })
        .collect::<Vec<_>>();
    extensions.sort_by(|a, b| b.size.cmp(&a.size));
    extensions.truncate(300);
    let age_stats = build_age_stats(age_stats, scanned_size);

    Ok(DiskUsageScanResult {
        root: root_key,
        scanned_size,
        file_count,
        folder_count,
        duration_ms: started.elapsed().as_millis() as u64,
        folders,
        files: large_files,
        extensions,
        duplicates,
        age_stats,
        excluded_paths,
    })
}

#[tauri::command]
pub async fn system_disk_volumes() -> Result<Vec<DiskVolume>, String> {
    run_system_blocking("读取磁盘分区", system_disk_volumes_blocking).await
}

fn system_disk_volumes_blocking() -> Result<Vec<DiskVolume>, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3,4,5 } | ForEach-Object {
  [pscustomobject]@{
    DeviceID = $_.DeviceID
    VolumeName = $_.VolumeName
    DriveType = $_.DriveType
    FileSystem = $_.FileSystem
    Size = $_.Size
    FreeSpace = $_.FreeSpace
  }
} | ConvertTo-Json -Compress
"#;

    let mut volumes = Vec::new();
    for value in powershell_json_rows(script)? {
        let device_id = json_string(&value, "DeviceID");
        if device_id.is_empty() {
            continue;
        }
        let drive_type = json_u64(&value, "DriveType").unwrap_or(0) as u32;
        let total = json_u64(&value, "Size").unwrap_or(0);
        let free = json_u64(&value, "FreeSpace").unwrap_or(0);
        let volume_name = json_string(&value, "VolumeName");
        let root = if device_id.ends_with('\\') {
            device_id.clone()
        } else {
            format!("{}\\", device_id)
        };
        volumes.push(DiskVolume {
            root,
            name: if volume_name.is_empty() {
                device_id.clone()
            } else {
                volume_name
            },
            drive_type,
            drive_type_label: drive_type_label(drive_type).to_string(),
            file_system: json_string(&value, "FileSystem"),
            total,
            free,
            available: total > 0 || matches!(drive_type, 2 | 3 | 4),
        });
    }

    volumes.sort_by(|a, b| {
        drive_type_rank(a.drive_type)
            .cmp(&drive_type_rank(b.drive_type))
            .then_with(|| a.root.cmp(&b.root))
    });
    Ok(volumes)
}

#[tauri::command]
pub async fn system_cleanup_scan() -> Result<Vec<CleanupItem>, String> {
    let generation = CLEANUP_GENERATION
        .fetch_add(1, Ordering::SeqCst)
        .saturating_add(1);
    run_system_blocking("扫描垃圾文件", move || {
        system_cleanup_scan_blocking(None, generation)
    })
    .await
}

#[tauri::command]
pub async fn system_cleanup_scan_with_options(
    request: CleanupScanRequest,
) -> Result<Vec<CleanupItem>, String> {
    let generation = CLEANUP_GENERATION
        .fetch_add(1, Ordering::SeqCst)
        .saturating_add(1);
    run_system_blocking("扫描垃圾文件", move || {
        system_cleanup_scan_blocking(request.min_age_days, generation)
    })
    .await
}

#[tauri::command]
pub fn system_cleanup_cancel() -> Result<(), String> {
    CLEANUP_GENERATION.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

fn system_cleanup_scan_blocking(
    min_age_days: Option<u64>,
    generation: u64,
) -> Result<Vec<CleanupItem>, String> {
    let mut rows = Vec::new();
    for target in cleanup_targets() {
        ensure_cleanup_active(generation)?;
        if !target.path.exists() {
            continue;
        }
        let policy = cleanup_target_file_policy(&target);
        let (size, count) =
            cleanup_path_size_and_count(&target.path, min_age_days, &[], Some(generation), policy);
        rows.push(CleanupItem {
            id: target.id,
            name: target.name,
            description: target.description,
            path: target.path.to_string_lossy().to_string(),
            category: target.category,
            category_label: target.category_label,
            risk: target.risk,
            risk_label: target.risk_label,
            size,
            count,
            selected_by_default: target.selected_by_default,
            safe: target.safe,
        });
    }
    rows.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(rows)
}

#[tauri::command]
pub async fn system_cleanup_delete(ids: Vec<String>) -> Result<CleanupResult, String> {
    let generation = CLEANUP_GENERATION
        .fetch_add(1, Ordering::SeqCst)
        .saturating_add(1);
    run_system_blocking("清理垃圾文件", move || {
        system_cleanup_delete_blocking(
            CleanupDeleteRequest {
                ids,
                exclude_paths: None,
                min_age_days: None,
            },
            generation,
        )
    })
    .await
}

#[tauri::command]
pub async fn system_cleanup_delete_with_options(
    request: CleanupDeleteRequest,
) -> Result<CleanupResult, String> {
    let generation = CLEANUP_GENERATION
        .fetch_add(1, Ordering::SeqCst)
        .saturating_add(1);
    run_system_blocking("清理垃圾文件", move || {
        system_cleanup_delete_blocking(request, generation)
    })
    .await
}

#[tauri::command]
pub async fn system_cleanup_preview(
    request: CleanupPreviewRequest,
) -> Result<Vec<CleanupPreviewItem>, String> {
    run_system_blocking("预览垃圾文件", move || {
        system_cleanup_preview_blocking(request)
    })
    .await
}

fn system_cleanup_preview_blocking(
    request: CleanupPreviewRequest,
) -> Result<Vec<CleanupPreviewItem>, String> {
    let targets = cleanup_targets()
        .into_iter()
        .map(|target| (target.id.clone(), target))
        .collect::<HashMap<_, _>>();
    let Some(target) = targets.get(&request.id) else {
        return Err("未知清理项".to_string());
    };
    if !target.path.exists() {
        return Ok(Vec::new());
    }
    Ok(cleanup_preview_files(
        &target.path,
        request.limit.unwrap_or(200).clamp(20, 1000),
        request.min_age_days,
        cleanup_target_file_policy(target),
    ))
}

fn system_cleanup_delete_blocking(
    request: CleanupDeleteRequest,
    generation: u64,
) -> Result<CleanupResult, String> {
    let ids = request.ids;
    if ids.is_empty() {
        return Err("请选择要清理的项目".to_string());
    }
    let excluded_paths = normalize_exclude_scan_paths(request.exclude_paths.unwrap_or_default());
    let min_age_days = request.min_age_days;

    let targets = cleanup_targets()
        .into_iter()
        .map(|target| (target.id.clone(), target))
        .collect::<HashMap<_, _>>();
    let mut deleted_size = 0u64;
    let mut deleted_count = 0u64;
    let mut failed = Vec::new();

    for id in ids {
        ensure_cleanup_active(generation)?;
        let Some(target) = targets.get(&id) else {
            failed.push(format!("未知清理项: {}", id));
            continue;
        };
        if !target.path.exists() {
            continue;
        }
        let policy = cleanup_target_file_policy(target);
        let (before_size, before_count) = cleanup_path_size_and_count(
            &target.path,
            min_age_days,
            &excluded_paths,
            Some(generation),
            policy,
        );
        match clean_directory_contents(
            &target.path,
            &excluded_paths,
            min_age_days,
            generation,
            policy,
        ) {
            Ok(()) => {
                deleted_size = deleted_size.saturating_add(before_size);
                deleted_count = deleted_count.saturating_add(before_count);
            }
            Err(err) => failed.push(format!("{}: {}", target.name, err)),
        }
    }

    Ok(CleanupResult {
        deleted_size,
        deleted_count,
        failed,
    })
}

#[tauri::command]
pub fn system_dns_adapters() -> Result<Vec<DnsAdapter>, String> {
    let mut rows = collect_dns_adapters_with_netsh()?;
    rows.sort_by(|a, b| {
        adapter_status_rank(&a.status)
            .cmp(&adapter_status_rank(&b.status))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(rows)
}

#[tauri::command]
pub async fn system_dns_set(request: DnsSetRequest) -> Result<Vec<DnsAdapter>, String> {
    run_system_blocking("应用 DNS 设置", move || {
        system_dns_set_blocking(request)
    })
    .await
}

fn system_dns_set_blocking(request: DnsSetRequest) -> Result<Vec<DnsAdapter>, String> {
    if request.interface_index == 0 {
        return Err("请选择网卡".to_string());
    }
    let servers = request
        .servers
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    for server in &servers {
        if server.parse::<std::net::Ipv4Addr>().is_err() {
            return Err(format!("DNS 地址无效: {}", server));
        }
    }
    let adapter = collect_dns_adapters_with_netsh()?
        .into_iter()
        .find(|item| item.interface_index == request.interface_index)
        .ok_or_else(|| "未找到选中的网卡".to_string())?;
    set_dns_with_netsh(&adapter.name, &servers)?;
    system_dns_adapters()
}

#[tauri::command]
pub fn system_dns_flush() -> Result<(), String> {
    let mut command = Command::new("ipconfig");
    command.arg("/flushdns");
    run_hidden(&mut command)
}

#[tauri::command]
pub async fn system_network_repair_snapshot() -> Result<NetworkRepairSnapshot, String> {
    run_system_blocking("网络急救诊断", system_network_repair_snapshot_blocking).await
}

#[tauri::command]
pub async fn system_network_repair_action(
    request: NetworkRepairActionRequest,
) -> Result<NetworkRepairActionResult, String> {
    run_system_blocking("网络急救修复", move || {
        system_network_repair_action_blocking(request)
    })
    .await
}

#[tauri::command]
pub async fn system_env_list() -> Result<Vec<EnvVarEntry>, String> {
    run_system_blocking("读取环境变量", system_env_list_blocking).await
}

fn system_env_list_blocking() -> Result<Vec<EnvVarEntry>, String> {
    let mut rows = Vec::new();
    for (scope, target) in [("user", "User"), ("machine", "Machine")] {
        for (name, value) in env_vars_for_scope(target)? {
            rows.push(EnvVarEntry {
                is_path: name.eq_ignore_ascii_case("Path"),
                scope: scope.to_string(),
                name,
                value,
            });
        }
    }
    rows.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(rows)
}

#[tauri::command]
pub async fn system_env_update(request: EnvVarUpdateRequest) -> Result<Vec<EnvVarEntry>, String> {
    run_system_blocking("保存环境变量", move || {
        system_env_update_blocking(request)
    })
    .await
}

fn system_env_update_blocking(request: EnvVarUpdateRequest) -> Result<Vec<EnvVarEntry>, String> {
    let target = env_scope_target(&request.scope)?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err("变量名不能为空".to_string());
    }
    let script = build_env_set_script(name, Some(&request.value), target);
    run_env_write_script(&script, target, "保存环境变量")?;
    system_env_list_blocking()
}

#[tauri::command]
pub async fn system_env_delete(request: EnvVarDeleteRequest) -> Result<Vec<EnvVarEntry>, String> {
    run_system_blocking("删除环境变量", move || {
        system_env_delete_blocking(request)
    })
    .await
}

fn system_env_delete_blocking(request: EnvVarDeleteRequest) -> Result<Vec<EnvVarEntry>, String> {
    let target = env_scope_target(&request.scope)?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err("变量名不能为空".to_string());
    }
    if name.eq_ignore_ascii_case("Path") {
        return Err("PATH 请在 PATH 面板中分条编辑，不允许直接删除。".to_string());
    }
    let script = build_env_set_script(name, None, target);
    run_env_write_script(&script, target, "删除环境变量")?;
    sync_process_variable_after_delete(name);
    system_env_list_blocking()
}

#[tauri::command]
pub async fn system_env_update_path(
    request: EnvPathUpdateRequest,
) -> Result<Vec<EnvVarEntry>, String> {
    run_system_blocking("保存 PATH", move || {
        system_env_update_path_blocking(request)
    })
    .await
}

fn system_env_update_path_blocking(
    request: EnvPathUpdateRequest,
) -> Result<Vec<EnvVarEntry>, String> {
    let target = env_scope_target(&request.scope)?;
    let value = dedupe_paths(request.paths).join(";");
    let script = build_env_set_script("Path", Some(&value), target);
    run_env_write_script(&script, target, "保存 PATH")?;
    system_env_list_blocking()
}

#[tauri::command]
pub fn system_env_validate_paths(
    request: EnvPathValidateRequest,
) -> Result<Vec<EnvPathValidationItem>, String> {
    let mut seen = HashSet::new();
    let env_map = environment_expansion_map(request.scope.as_deref());
    Ok(request
        .paths
        .into_iter()
        .map(|path| {
            let trimmed = path.trim().to_string();
            let expanded = expand_environment_path(&trimmed, &env_map);
            let expanded = normalize_path_for_filesystem(&expanded);
            let key = normalize_path_identity(&expanded);
            let duplicate = !key.is_empty() && !seen.insert(key);
            EnvPathValidationItem {
                exists: !expanded.is_empty() && PathBuf::from(&expanded).exists(),
                expanded_path: expanded,
                path: trimmed,
                duplicate,
            }
        })
        .collect())
}

#[tauri::command]
pub fn system_env_open_editor() -> Result<(), String> {
    let mut command = Command::new("rundll32.exe");
    command.args(["sysdm.cpl,EditEnvironmentVariables"]);
    run_hidden(&mut command)
}

#[tauri::command]
pub fn system_context_menu_list() -> Result<Vec<ContextMenuEntry>, String> {
    use winreg::RegKey;

    let scopes = context_menu_scopes();
    let mut rows = Vec::new();
    for scope in scopes {
        let root = RegKey::predef(scope.hive);
        collect_context_menu_shell_entries(&mut rows, &root, scope);
        collect_context_menu_shellex_entries(&mut rows, &root, scope);
    }
    collect_browser_context_menu_entries(&mut rows);
    rows.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then_with(|| a.root.cmp(&b.root))
            .then_with(|| a.menu_type.cmp(&b.menu_type))
            .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
    });
    Ok(rows)
}

#[tauri::command]
pub fn system_context_menu_save(
    request: ContextMenuUpdateRequest,
) -> Result<Vec<ContextMenuEntry>, String> {
    use winreg::RegKey;

    let scope = context_menu_scopes()
        .into_iter()
        .find(|item| item.scope == request.scope)
        .ok_or_else(|| "右键菜单类型无效".to_string())?;
    let label = request.label.trim();
    let command = request.command.trim();
    if label.is_empty() || command.is_empty() {
        return Err("菜单名称和命令不能为空".to_string());
    }
    let key_name = request
        .key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitize_registry_key_name)
        .unwrap_or_else(|| sanitize_registry_key_name(label));
    let root = RegKey::predef(scope.hive);
    let shell_key = root
        .create_subkey(scope.path)
        .map_err(|e| format!("打开右键菜单注册表失败: {}", e))?
        .0;
    let item_key = shell_key
        .create_subkey(&key_name)
        .map_err(|e| format!("创建右键菜单失败: {}", e))?
        .0;
    item_key
        .set_value("MUIVerb", &label)
        .map_err(|e| format!("写入菜单名称失败: {}", e))?;
    if let Some(icon) = request
        .icon
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        item_key
            .set_value("Icon", &icon)
            .map_err(|e| format!("写入菜单图标失败: {}", e))?;
    } else {
        let _ = item_key.delete_value("Icon");
    }
    if request.shift_only {
        item_key
            .set_value("Extended", &"")
            .map_err(|e| format!("写入 Shift 显示状态失败: {}", e))?;
    } else {
        let _ = item_key.delete_value("Extended");
    }
    let command_key = item_key
        .create_subkey("command")
        .map_err(|e| format!("创建 command 键失败: {}", e))?
        .0;
    command_key
        .set_value("", &command)
        .map_err(|e| format!("写入命令失败: {}", e))?;
    system_context_menu_list()
}

#[tauri::command]
pub fn system_context_menu_delete(
    request: ContextMenuDeleteRequest,
) -> Result<Vec<ContextMenuEntry>, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let parts = request.id.splitn(3, '|').collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err("右键菜单标识无效".to_string());
    }
    let hive = match parts[0] {
        "HKCU" => HKEY_CURRENT_USER,
        "HKCR" => HKEY_CLASSES_ROOT,
        "HKLM" => HKEY_LOCAL_MACHINE,
        _ => return Err("右键菜单注册表根无效".to_string()),
    };
    let root = RegKey::predef(hive);
    let shell_key = root
        .open_subkey_with_flags(parts[1], KEY_WRITE)
        .map_err(|e| format!("打开右键菜单注册表失败: {}", e))?;
    shell_key
        .delete_subkey_all(parts[2])
        .map_err(|e| format!("删除右键菜单失败: {}", e))?;
    system_context_menu_list()
}

#[tauri::command]
pub fn system_context_menu_set_disabled(
    request: ContextMenuDisabledRequest,
) -> Result<Vec<ContextMenuEntry>, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let parts = request.id.splitn(3, '|').collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err("右键菜单标识无效".to_string());
    }
    let hive = match parts[0] {
        "HKCU" => HKEY_CURRENT_USER,
        "HKCR" => HKEY_CLASSES_ROOT,
        "HKLM" => HKEY_LOCAL_MACHINE,
        _ => return Err("右键菜单注册表根无效".to_string()),
    };
    let root = RegKey::predef(hive);
    let item_key = root
        .open_subkey_with_flags(format!(r"{}\{}", parts[1], parts[2]), KEY_WRITE)
        .map_err(|e| format!("打开右键菜单项失败: {}", e))?;
    if request.disabled {
        item_key
            .set_value("LegacyDisable", &"")
            .map_err(|e| format!("禁用右键菜单失败: {}", e))?;
    } else {
        let _ = item_key.delete_value("LegacyDisable");
        let _ = item_key.delete_value("ProgrammaticAccessOnly");
    }
    system_context_menu_list()
}

#[tauri::command]
pub fn system_context_menu_export(request: ContextMenuExportRequest) -> Result<String, String> {
    let parts = request.id.splitn(3, '|').collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err("右键菜单标识无效".to_string());
    }
    let root = match parts[0] {
        "HKCU" => "HKCU",
        "HKCR" => "HKCR",
        "HKLM" => "HKLM",
        _ => return Err("右键菜单注册表根无效".to_string()),
    };
    let registry_path = format!(r"{}\{}\{}", root, parts[1], parts[2]);
    let path = export_reg_backup(&registry_path, "context-menu")?
        .ok_or_else(|| "导出备份失败".to_string())?;
    Ok(path)
}

#[tauri::command]
pub fn system_explorer_refresh() -> Result<(), String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Stop-Process -Name explorer -Force
Start-Process explorer.exe
"#;
    run_powershell_script_hidden(script)
}

#[tauri::command]
pub async fn system_services_list() -> Result<Vec<ServiceEntry>, String> {
    run_system_blocking("读取系统服务", system_services_list_blocking).await
}

fn system_services_list_blocking() -> Result<Vec<ServiceEntry>, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Service | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    DisplayName = $_.DisplayName
    Description = $_.Description
    State = $_.State
    StartMode = $_.StartMode
    PathName = $_.PathName
    StartName = $_.StartName
    CanStop = $_.AcceptStop
  }
} | ConvertTo-Json -Compress
"#;
    let mut rows = powershell_json_rows(script)?
        .into_iter()
        .map(|value| ServiceEntry {
            name: json_string(&value, "Name"),
            display_name: json_string(&value, "DisplayName"),
            description: json_string(&value, "Description"),
            state: json_string(&value, "State"),
            start_mode: json_string(&value, "StartMode"),
            path_name: json_string(&value, "PathName"),
            start_name: json_string(&value, "StartName"),
            can_stop: json_bool(&value, "CanStop"),
        })
        .filter(|item| !item.name.is_empty())
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        service_state_rank(&a.state)
            .cmp(&service_state_rank(&b.state))
            .then_with(|| {
                a.display_name
                    .to_lowercase()
                    .cmp(&b.display_name.to_lowercase())
            })
    });
    Ok(rows)
}

#[tauri::command]
pub async fn system_service_action(
    request: ServiceActionRequest,
) -> Result<Vec<ServiceEntry>, String> {
    run_system_blocking("执行服务操作", move || {
        system_service_action_blocking(request)
    })
    .await
}

fn system_service_action_blocking(
    request: ServiceActionRequest,
) -> Result<Vec<ServiceEntry>, String> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err("服务名不能为空".to_string());
    }
    let script = match request.action.as_str() {
        "start" => format!(
            "Start-Service -Name '{}'",
            escape_powershell_single_quote(name)
        ),
        "stop" => format!(
            "Stop-Service -Name '{}' -Force",
            escape_powershell_single_quote(name)
        ),
        "restart" => format!(
            "Restart-Service -Name '{}' -Force",
            escape_powershell_single_quote(name)
        ),
        "startup" => {
            let startup_type = request.startup_type.unwrap_or_else(|| "Manual".to_string());
            if !matches!(startup_type.as_str(), "Automatic" | "Manual" | "Disabled") {
                return Err("启动类型无效".to_string());
            }
            format!(
                "Set-Service -Name '{}' -StartupType {}",
                escape_powershell_single_quote(name),
                startup_type
            )
        }
        _ => return Err("服务操作无效".to_string()),
    };
    run_powershell_script_hidden(&script)?;
    system_services_list_blocking()
}

#[tauri::command]
pub async fn system_tasks_list() -> Result<Vec<ScheduledTaskEntry>, String> {
    run_system_blocking("读取计划任务", system_tasks_list_blocking).await
}

fn system_tasks_list_blocking() -> Result<Vec<ScheduledTaskEntry>, String> {
    system_tasks_list_blocking_with_details(true)
}

#[tauri::command]
pub async fn system_tasks_summary_list() -> Result<Vec<ScheduledTaskEntry>, String> {
    run_system_blocking("读取计划任务摘要", || {
        system_tasks_list_blocking_with_details(false)
    })
    .await
}

fn system_tasks_list_blocking_with_details(
    include_details: bool,
) -> Result<Vec<ScheduledTaskEntry>, String> {
    if !include_details {
        return system_tasks_summary_list_blocking();
    }
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-ScheduledTask | ForEach-Object {
  $info = Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue
  [pscustomobject]@{
    TaskName = $_.TaskName
    TaskPath = $_.TaskPath
    State = "$($_.State)"
    Author = $_.Author
    Description = $_.Description
    Triggers = ($_.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace '^MSFT_Task', '' }) -join ', '
    Actions = ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
    LastRunTime = if ($info) { "$($info.LastRunTime)" } else { '' }
    NextRunTime = if ($info) { "$($info.NextRunTime)" } else { '' }
    LastTaskResult = if ($info) { "$($info.LastTaskResult)" } else { '' }
  }
} | ConvertTo-Json -Compress
"#;
    let mut rows = powershell_json_rows(script)?
        .into_iter()
        .map(|value| ScheduledTaskEntry {
            task_name: json_string(&value, "TaskName"),
            task_path: json_string(&value, "TaskPath"),
            state: json_string(&value, "State"),
            author: json_string(&value, "Author"),
            description: json_string(&value, "Description"),
            triggers: json_string(&value, "Triggers"),
            actions: json_string(&value, "Actions"),
            last_run_time: json_string(&value, "LastRunTime"),
            next_run_time: json_string(&value, "NextRunTime"),
            last_task_result: json_string(&value, "LastTaskResult"),
        })
        .filter(|item| !item.task_name.is_empty())
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        task_state_rank(&a.state)
            .cmp(&task_state_rank(&b.state))
            .then_with(|| a.task_path.cmp(&b.task_path))
            .then_with(|| a.task_name.to_lowercase().cmp(&b.task_name.to_lowercase()))
    });
    Ok(rows)
}

fn system_tasks_summary_list_blocking() -> Result<Vec<ScheduledTaskEntry>, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-ScheduledTask | ForEach-Object {
  [pscustomobject]@{
    TaskName = $_.TaskName
    TaskPath = $_.TaskPath
    State = "$($_.State)"
    Author = $_.Author
    Description = $_.Description
    Triggers = ($_.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace '^MSFT_Task', '' }) -join ', '
    Actions = ''
    LastRunTime = ''
    NextRunTime = ''
    LastTaskResult = ''
  }
} | ConvertTo-Json -Compress
"#;
    let mut rows = powershell_json_rows(script)?
        .into_iter()
        .map(|value| ScheduledTaskEntry {
            task_name: json_string(&value, "TaskName"),
            task_path: json_string(&value, "TaskPath"),
            state: json_string(&value, "State"),
            author: json_string(&value, "Author"),
            description: json_string(&value, "Description"),
            triggers: json_string(&value, "Triggers"),
            actions: json_string(&value, "Actions"),
            last_run_time: json_string(&value, "LastRunTime"),
            next_run_time: json_string(&value, "NextRunTime"),
            last_task_result: json_string(&value, "LastTaskResult"),
        })
        .filter(|item| !item.task_name.is_empty())
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        task_state_rank(&a.state)
            .cmp(&task_state_rank(&b.state))
            .then_with(|| a.task_path.cmp(&b.task_path))
            .then_with(|| a.task_name.to_lowercase().cmp(&b.task_name.to_lowercase()))
    });
    Ok(rows)
}

#[tauri::command]
pub async fn system_task_detail(
    request: ScheduledTaskDetailRequest,
) -> Result<ScheduledTaskEntry, String> {
    run_system_blocking("读取计划任务详情", move || {
        system_task_detail_blocking(request)
    })
    .await
}

fn system_task_detail_blocking(
    request: ScheduledTaskDetailRequest,
) -> Result<ScheduledTaskEntry, String> {
    let task_name = request.task_name.trim();
    let task_path = request.task_path.trim();
    if task_name.is_empty() {
        return Err("任务名不能为空".to_string());
    }
    let script = format!(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
$task = Get-ScheduledTask -TaskPath '{}' -TaskName '{}' -ErrorAction Stop
$info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue
[pscustomobject]@{{
  TaskName = $task.TaskName
  TaskPath = $task.TaskPath
  State = "$($task.State)"
  Author = $task.Author
  Description = $task.Description
  Triggers = ($task.Triggers | ForEach-Object {{ $_.CimClass.CimClassName -replace '^MSFT_Task', '' }}) -join ', '
  Actions = ($task.Actions | ForEach-Object {{ "$($_.Execute) $($_.Arguments)" }}) -join ' '
  LastRunTime = if ($info) {{ "$($info.LastRunTime)" }} else {{ '' }}
  NextRunTime = if ($info) {{ "$($info.NextRunTime)" }} else {{ '' }}
  LastTaskResult = if ($info) {{ "$($info.LastTaskResult)" }} else {{ '' }}
}} | ConvertTo-Json -Compress
"#,
        escape_powershell_single_quote(task_path),
        escape_powershell_single_quote(task_name)
    );
    let rows = powershell_json_rows(&script)?;
    let Some(value) = rows.into_iter().next() else {
        return Err("未读取到计划任务详情".to_string());
    };
    Ok(ScheduledTaskEntry {
        task_name: json_string(&value, "TaskName"),
        task_path: json_string(&value, "TaskPath"),
        state: json_string(&value, "State"),
        author: json_string(&value, "Author"),
        description: json_string(&value, "Description"),
        triggers: json_string(&value, "Triggers"),
        actions: json_string(&value, "Actions"),
        last_run_time: json_string(&value, "LastRunTime"),
        next_run_time: json_string(&value, "NextRunTime"),
        last_task_result: json_string(&value, "LastTaskResult"),
    })
}

#[tauri::command]
pub async fn system_task_action(
    request: ScheduledTaskActionRequest,
) -> Result<Vec<ScheduledTaskEntry>, String> {
    run_system_blocking("执行计划任务操作", move || {
        system_task_action_blocking(request)
    })
    .await
}

fn system_task_action_blocking(
    request: ScheduledTaskActionRequest,
) -> Result<Vec<ScheduledTaskEntry>, String> {
    let task_name = request.task_name.trim();
    if task_name.is_empty() {
        return Err("任务名不能为空".to_string());
    }
    let task_path = request.task_path.trim();
    let cmdlet = match request.action.as_str() {
        "enable" => "Enable-ScheduledTask",
        "disable" => "Disable-ScheduledTask",
        "run" => "Start-ScheduledTask",
        "stop" => "Stop-ScheduledTask",
        _ => return Err("计划任务操作无效".to_string()),
    };
    let script = format!(
        "{} -TaskPath '{}' -TaskName '{}' | Out-Null",
        cmdlet,
        escape_powershell_single_quote(task_path),
        escape_powershell_single_quote(task_name)
    );
    run_powershell_script_hidden(&script)?;
    system_tasks_list_blocking()
}

#[tauri::command]
pub async fn system_installed_apps_list() -> Result<Vec<InstalledAppEntry>, String> {
    run_system_blocking("读取已安装软件", system_installed_apps_list_blocking).await
}

fn system_installed_apps_list_blocking() -> Result<Vec<InstalledAppEntry>, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let registry_paths = [
        (
            HKEY_LOCAL_MACHINE,
            "HKLM",
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "所有用户 64 位",
        ),
        (
            HKEY_LOCAL_MACHINE,
            "HKLM",
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            "所有用户 32 位",
        ),
        (
            HKEY_CURRENT_USER,
            "HKCU",
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "当前用户",
        ),
    ];
    let mut rows = Vec::new();
    let mut seen = HashSet::new();
    for (hive, root_label, path, scope_label) in registry_paths {
        let root = RegKey::predef(hive);
        let Ok(key) = root.open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for sub_name in key.enum_keys().filter_map(Result::ok) {
            let Ok(sub_key) = key.open_subkey_with_flags(&sub_name, KEY_READ) else {
                continue;
            };
            let system_component: u32 = sub_key.get_value("SystemComponent").unwrap_or(0);
            if system_component == 1 {
                continue;
            }
            let name = sub_key
                .get_value::<String, _>("DisplayName")
                .unwrap_or_default();
            if name.trim().is_empty() {
                continue;
            }
            let lower_name = name.to_lowercase();
            if lower_name.contains("security update")
                || lower_name.contains("update for")
                || lower_name.contains("hotfix")
                || lower_name.starts_with("kb")
            {
                continue;
            }
            let uninstall_string = sub_key
                .get_value::<String, _>("UninstallString")
                .unwrap_or_default();
            if uninstall_string.trim().is_empty() {
                continue;
            }
            let version = sub_key
                .get_value::<String, _>("DisplayVersion")
                .unwrap_or_default();
            let publisher = sub_key
                .get_value::<String, _>("Publisher")
                .unwrap_or_default();
            let install_location = sub_key
                .get_value::<String, _>("InstallLocation")
                .unwrap_or_default();
            let install_date = sub_key
                .get_value::<String, _>("InstallDate")
                .unwrap_or_default();
            let quiet_uninstall_string = sub_key
                .get_value::<String, _>("QuietUninstallString")
                .unwrap_or_default();
            let estimated_size =
                sub_key.get_value::<u32, _>("EstimatedSize").unwrap_or(0) as u64 * 1024;
            let dedupe_key = format!(
                "{}|{}|{}",
                lower_name,
                version.to_lowercase(),
                publisher.to_lowercase()
            );
            if !seen.insert(dedupe_key) {
                continue;
            }
            rows.push(InstalledAppEntry {
                id: format!("{}|{}|{}", root_label, path, sub_name),
                name: name.trim().to_string(),
                publisher,
                version,
                install_date,
                install_location,
                estimated_size,
                uninstall_string,
                quiet_uninstall_string,
                registry_path: format!(r"{}\{}\{}", root_label, path, sub_name),
                scope: scope_label.to_string(),
                app_kind: "desktop".to_string(),
            });
        }
    }
    rows.extend(collect_store_app_entries()?);
    rows.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(rows)
}

#[tauri::command]
pub async fn system_installed_app_uninstall(
    request: InstalledAppActionRequest,
) -> Result<(), String> {
    run_system_blocking("启动卸载程序", move || {
        system_installed_app_uninstall_blocking(request)
    })
    .await
}

fn system_installed_app_uninstall_blocking(
    request: InstalledAppActionRequest,
) -> Result<(), String> {
    let command_line = if request.quiet {
        request
            .quiet_uninstall_string
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(request.uninstall_string.trim())
    } else {
        request.uninstall_string.trim()
    };
    if command_line.is_empty() {
        return Err("卸载命令为空".to_string());
    }
    if command_line.to_lowercase().contains("remove-appxpackage") {
        return run_powershell_script_hidden(command_line).map_err(|e| {
            format!(
                "启动 Store 应用卸载失败: {}。请在 Windows 设置中手动卸载 {}",
                e, request.name
            )
        });
    }
    let script = format!(
        "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c {}' -Verb RunAs",
        escape_powershell_single_quote(command_line)
    );
    run_powershell_script_hidden(&script).map_err(|e| {
        format!(
            "启动卸载程序失败: {}。请在控制面板中手动卸载 {}",
            e, request.name
        )
    })
}

#[tauri::command]
pub async fn system_installed_app_leftovers_scan(
    request: InstalledAppLeftoverRequest,
) -> Result<Vec<InstalledAppLeftoverItem>, String> {
    run_system_blocking("扫描软件残留", move || {
        system_installed_app_leftovers_scan_blocking(request)
    })
    .await
}

fn system_installed_app_leftovers_scan_blocking(
    request: InstalledAppLeftoverRequest,
) -> Result<Vec<InstalledAppLeftoverItem>, String> {
    let mut items = Vec::new();
    if !request.uninstalled {
        return Ok(items);
    }
    let validation = build_leftover_validation(&request);
    let running_processes = related_running_processes_for_app(&validation)?;
    if !running_processes.is_empty() {
        return Err(format_related_process_block(&running_processes));
    }
    let is_store_app = request.app_kind.eq_ignore_ascii_case("store")
        || request.registry_path.to_lowercase().contains("appx");
    let tokens = app_leftover_tokens(&request.name, &request.publisher, is_store_app);
    let install_location = request.install_location.trim();
    if !install_location.is_empty() {
        let path = PathBuf::from(install_location);
        if path.exists() && is_safe_leftover_path(&path) {
            push_leftover_item(
                &mut items,
                "install-dir",
                "安装目录",
                &path,
                "high",
                "来自软件登记的 InstallLocation",
                true,
            );
        }
    }

    if !is_store_app {
        for base in app_leftover_search_roots() {
            if !base.exists() || !base.is_dir() {
                continue;
            }
            scan_leftover_children(&mut items, &base, &tokens);
        }
    }

    if !request.registry_path.trim().is_empty() {
        items.push(InstalledAppLeftoverItem {
            id: format!("registry|{}", request.registry_path),
            kind: "registry".to_string(),
            kind_label: "注册表卸载项".to_string(),
            path: request.registry_path.clone(),
            display_path: request.registry_path,
            size: 0,
            count: 1,
            confidence: "high".to_string(),
            reason: "软件卸载登记项，卸载后仍存在时可清理".to_string(),
            selected_by_default: true,
        });
    }

    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(format!("{}|{}", item.kind, item.path.to_lowercase())));
    items.sort_by(|a, b| {
        confidence_rank(&a.confidence)
            .cmp(&confidence_rank(&b.confidence))
            .then_with(|| b.size.cmp(&a.size))
            .then_with(|| {
                a.display_path
                    .to_lowercase()
                    .cmp(&b.display_path.to_lowercase())
            })
    });
    Ok(items)
}

#[tauri::command]
pub async fn system_installed_app_leftovers_delete(
    request: InstalledAppLeftoverDeleteRequest,
) -> Result<InstalledAppLeftoverDeleteResult, String> {
    run_system_blocking("清理软件残留", move || {
        system_installed_app_leftovers_delete_blocking(request)
    })
    .await
}

fn system_installed_app_leftovers_delete_blocking(
    request: InstalledAppLeftoverDeleteRequest,
) -> Result<InstalledAppLeftoverDeleteResult, String> {
    if request.items.is_empty() {
        return Err("请选择要清理的残留项".to_string());
    }
    let mut deleted_size = 0u64;
    let mut deleted_count = 0u64;
    let mut failed = Vec::new();
    let mut backup_paths = Vec::new();
    let validation = request
        .app
        .as_ref()
        .map(|app| build_leftover_validation(app));

    if let Some(validation) = validation.as_ref() {
        let running_processes = related_running_processes_for_app(validation)?;
        if !running_processes.is_empty() {
            return Err(format_related_process_block(&running_processes));
        }
    }

    for item in request.items {
        if let Some(validation) = validation.as_ref() {
            if let Err(err) = validate_leftover_item_for_app(&item, validation) {
                failed.push(format!("{}: {}", item.display_path, err));
                continue;
            }
        } else {
            failed.push(format!(
                "{}: 缺少软件上下文，已拒绝清理以避免误删",
                item.display_path
            ));
            continue;
        }
        match item.kind.as_str() {
            "registry" => {
                match export_reg_backup(&item.path, "uninstall-leftover") {
                    Ok(Some(path)) => backup_paths.push(path),
                    Ok(None) => {}
                    Err(err) => failed.push(format!("{}: {}", item.display_path, err)),
                }
                match delete_uninstall_registry_key(&item.path) {
                    Ok(()) => deleted_count = deleted_count.saturating_add(1),
                    Err(err) => failed.push(format!("{}: {}", item.display_path, err)),
                }
            }
            _ => {
                let path = PathBuf::from(&item.path);
                if !is_safe_leftover_path(&path) {
                    failed.push(format!("{}: 路径不在允许清理范围内", item.display_path));
                    continue;
                }
                let (size, count) = path_size_and_count(&path);
                match delete_path_direct(&path) {
                    Ok(()) => {
                        deleted_size = deleted_size.saturating_add(size);
                        deleted_count = deleted_count.saturating_add(count.max(1));
                    }
                    Err(err) => failed.push(format!("{}: {}", item.display_path, err)),
                }
            }
        }
    }

    Ok(InstalledAppLeftoverDeleteResult {
        deleted_size,
        deleted_count,
        failed,
        backup_path: backup_paths.first().cloned(),
    })
}

#[tauri::command]
pub async fn system_info_overview() -> Result<Vec<SystemInfoSection>, String> {
    run_system_blocking("读取系统信息", system_info_overview_blocking).await
}

fn system_info_overview_blocking() -> Result<Vec<SystemInfoSection>, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$bios = Get-CimInstance Win32_BIOS | Select-Object -First 1
$gpu = Get-CimInstance Win32_VideoController | Select-Object -First 3
$disk = Get-CimInstance Win32_DiskDrive | Select-Object -First 8
$nic = Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.PhysicalAdapter } | Select-Object -First 8
$drivers = Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -and $_.DriverProviderName } | Sort-Object DriverDate -Descending | Select-Object -First 20
$battery = Get-CimInstance Win32_Battery | Select-Object -First 3
$activation = Get-CimInstance SoftwareLicensingProduct | Where-Object { $_.PartialProductKey -and $_.Name -like '*Windows*' } | Select-Object -First 1
[pscustomobject]@{
  OS = [pscustomobject]@{
    Caption = $os.Caption
    Version = $os.Version
    BuildNumber = $os.BuildNumber
    Architecture = $os.OSArchitecture
    InstallDate = "$($os.InstallDate)"
    LastBootUpTime = "$($os.LastBootUpTime)"
  }
  Computer = [pscustomobject]@{
    Name = $env:COMPUTERNAME
    Manufacturer = $cs.Manufacturer
    Model = $cs.Model
    UserName = $cs.UserName
    Domain = $cs.Domain
    TotalPhysicalMemory = "$($cs.TotalPhysicalMemory)"
    BIOS = $bios.SMBIOSBIOSVersion
    SerialNumber = $bios.SerialNumber
  }
  CPU = [pscustomobject]@{
    Name = $cpu.Name
    Cores = "$($cpu.NumberOfCores)"
    LogicalProcessors = "$($cpu.NumberOfLogicalProcessors)"
    MaxClockSpeed = "$($cpu.MaxClockSpeed)"
  }
  GPU = @($gpu | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Memory = "$($_.AdapterRAM)"; DriverVersion = $_.DriverVersion } })
  Disk = @($disk | ForEach-Object { [pscustomobject]@{ Model = $_.Model; Size = "$($_.Size)"; InterfaceType = $_.InterfaceType; MediaType = $_.MediaType } })
  Network = @($nic | ForEach-Object { [pscustomobject]@{ Name = $_.Name; MACAddress = $_.MACAddress; Speed = "$($_.Speed)" } })
  Drivers = @($drivers | ForEach-Object { [pscustomobject]@{ DeviceName = $_.DeviceName; Provider = $_.DriverProviderName; Version = $_.DriverVersion; Date = "$($_.DriverDate)" } })
  Battery = @($battery | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Status = "$($_.BatteryStatus)"; EstimatedChargeRemaining = "$($_.EstimatedChargeRemaining)"; EstimatedRunTime = "$($_.EstimatedRunTime)" } })
  Activation = [pscustomobject]@{
    Name = $activation.Name
    LicenseStatus = "$($activation.LicenseStatus)"
    PartialProductKey = $activation.PartialProductKey
  }
} | ConvertTo-Json -Depth 6 -Compress
"#;
    let mut command = Command::new("powershell");
    let script = with_utf8_powershell_output(script);
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    let output = command_output_hidden(&mut command)?;
    let value = serde_json::from_str::<serde_json::Value>(&output)
        .map_err(|e| format!("解析系统信息失败: {}", e))?;
    Ok(system_info_sections(&value))
}

#[tauri::command]
pub async fn system_windows_update_status() -> Result<WindowsUpdateStatus, String> {
    run_system_blocking(
        "读取 Windows 更新状态",
        system_windows_update_status_blocking,
    )
    .await
}

fn system_windows_update_status_blocking() -> Result<WindowsUpdateStatus, String> {
    let services_script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-Service -Name wuauserv,bits,cryptsvc,msiserver | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    DisplayName = $_.DisplayName
    Status = "$($_.Status)"
    StartType = "$($_.StartType)"
  }
} | ConvertTo-Json -Compress
"#;
    let services = powershell_json_rows(services_script)?
        .into_iter()
        .map(|value| WindowsUpdateService {
            name: json_string(&value, "Name"),
            display_name: json_string(&value, "DisplayName"),
            status: json_string(&value, "Status"),
            start_type: json_string(&value, "StartType"),
        })
        .collect::<Vec<_>>();

    let hotfix_script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 40 HotFixID,Description,InstalledOn,InstalledBy | ForEach-Object {
  [pscustomobject]@{
    HotFixID = $_.HotFixID
    Description = $_.Description
    InstalledOn = "$($_.InstalledOn)"
    InstalledBy = $_.InstalledBy
  }
} | ConvertTo-Json -Compress
"#;
    let hotfixes = powershell_json_rows(hotfix_script)?
        .into_iter()
        .map(|value| WindowsHotfixEntry {
            hotfix_id: json_string(&value, "HotFixID"),
            description: json_string(&value, "Description"),
            installed_on: json_string(&value, "InstalledOn"),
            installed_by: json_string(&value, "InstalledBy"),
        })
        .collect::<Vec<_>>();

    let pending_script = r#"
$ErrorActionPreference = 'SilentlyContinue'
try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $result = $searcher.Search("IsInstalled=0 and Type='Software'")
  @($result.Updates | Select-Object -First 30 | ForEach-Object {
    [pscustomobject]@{
      Title = $_.Title
      Downloaded = [bool]$_.IsDownloaded
      RebootRequired = [bool]$_.RebootRequired
      Severity = "$($_.MsrcSeverity)"
    }
  }) | ConvertTo-Json -Compress
} catch { @() | ConvertTo-Json -Compress }
"#;
    let pending_updates = powershell_json_rows(pending_script)?
        .into_iter()
        .map(|value| WindowsPendingUpdate {
            title: json_string(&value, "Title"),
            downloaded: json_bool(&value, "Downloaded"),
            reboot_required: json_bool(&value, "RebootRequired"),
            severity: json_string(&value, "Severity"),
        })
        .filter(|item| !item.title.is_empty())
        .collect::<Vec<_>>();

    let settings_script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$ux = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
$au = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
[pscustomobject]@{
  PauseUntil = "$($ux.PauseUpdatesExpiryTime)"
  NoAutoUpdate = "$($au.NoAutoUpdate)"
} | ConvertTo-Json -Compress
"#;
    let settings = powershell_json_rows(settings_script)?.into_iter().next();
    let pause_until = settings
        .as_ref()
        .map(|value| json_string(value, "PauseUntil"))
        .unwrap_or_default();
    let no_auto_update = settings
        .as_ref()
        .map(|value| json_string(value, "NoAutoUpdate"))
        .unwrap_or_default();
    let update_disabled = no_auto_update.trim() == "1"
        || services.iter().any(|service| {
            service.name.eq_ignore_ascii_case("wuauserv")
                && service.start_type.eq_ignore_ascii_case("Disabled")
        });
    let paused = !pause_until.trim().is_empty();
    Ok(WindowsUpdateStatus {
        services,
        hotfixes,
        pending_updates,
        cache_size: windows_update_cache_size(),
        paused,
        pause_until,
        update_disabled,
    })
}

#[tauri::command]
pub async fn system_windows_update_action(action: String) -> Result<WindowsUpdateStatus, String> {
    run_system_blocking("执行 Windows 更新操作", move || {
        system_windows_update_action_blocking(action)
    })
    .await
}

#[tauri::command]
pub async fn system_printer_manager_snapshot() -> Result<PrinterManagerSnapshot, String> {
    run_system_blocking("读取打印机状态", system_printer_manager_snapshot_blocking).await
}

#[tauri::command]
pub async fn system_printer_action(
    request: PrinterActionRequest,
) -> Result<PrinterManagerSnapshot, String> {
    run_system_blocking("执行打印机操作", move || {
        system_printer_action_blocking(request)
    })
    .await
}

#[tauri::command]
pub async fn system_print_job_action(
    request: PrintJobActionRequest,
) -> Result<PrinterManagerSnapshot, String> {
    run_system_blocking("执行打印任务操作", move || {
        system_print_job_action_blocking(request)
    })
    .await
}

#[tauri::command]
pub async fn system_printer_diagnose(
    printer_name: String,
) -> Result<PrinterDiagnosticResult, String> {
    run_system_blocking("检测打印机状态", move || {
        system_printer_diagnose_blocking(printer_name)
    })
    .await
}

#[tauri::command]
pub async fn system_wsl_status() -> Result<WslStatus, String> {
    run_system_blocking("读取 WSL 状态", system_wsl_status_blocking).await
}

#[tauri::command]
pub async fn system_wsl_action(request: WslActionRequest) -> Result<WslStatus, String> {
    run_system_blocking("执行 WSL 操作", move || {
        system_wsl_action_blocking(request)
    })
    .await
}

#[tauri::command]
pub async fn system_drivers_list() -> Result<DriverStoreStatus, String> {
    run_system_blocking("读取驱动仓库", system_drivers_list_blocking).await
}

#[tauri::command]
pub async fn system_drivers_action(
    request: DriverStoreActionRequest,
) -> Result<DriverStoreActionResult, String> {
    run_system_blocking("执行驱动管理操作", move || {
        system_drivers_action_blocking(request)
    })
    .await
}

#[tauri::command]
pub async fn system_monitor_snapshot() -> Result<SystemMonitorSnapshot, String> {
    run_system_blocking("读取系统监控快照", system_monitor_snapshot_blocking).await
}

fn system_drivers_list_blocking() -> Result<DriverStoreStatus, String> {
    let mut command = Command::new("pnputil");
    command.args(["/enum-drivers", "/files"]);
    let output = command_output_hidden(&mut command)
        .map_err(|e| format!("读取驱动仓库失败：{}。请确认当前系统支持 pnputil。", e))?;
    let mut packages = parse_driver_store_packages(&output);
    if packages.is_empty() {
        let mut fallback = Command::new("pnputil");
        fallback.arg("/enum-drivers");
        let fallback_output = command_output_hidden(&mut fallback)
            .map_err(|e| format!("读取驱动仓库失败：{}。请确认当前系统支持 pnputil。", e))?;
        packages = parse_driver_store_packages(&fallback_output);
    }
    let device_map = installed_driver_device_map().unwrap_or_default();
    enrich_driver_packages(&mut packages, &device_map);
    Ok(build_driver_store_status(packages))
}

fn system_drivers_action_blocking(
    request: DriverStoreActionRequest,
) -> Result<DriverStoreActionResult, String> {
    match request.action.as_str() {
        "export" => {
            let names = normalize_driver_published_names(request.published_names)?;
            let output_dir = request
                .output_dir
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "请选择驱动导出目录".to_string())?;
            let output_path = PathBuf::from(output_dir);
            if !output_path.is_dir() {
                return Err("驱动导出目录不存在".to_string());
            }
            for name in &names {
                let mut command = Command::new("pnputil");
                command.args(["/export-driver", name, output_dir]);
                run_hidden(&mut command).map_err(|e| format!("导出 {} 失败：{}", name, e))?;
            }
            let status = system_drivers_list_blocking()?;
            Ok(DriverStoreActionResult {
                status,
                message: format!("已导出 {} 个驱动包到 {}", names.len(), output_dir),
                failed: Vec::new(),
            })
        }
        "delete" => {
            let names = normalize_driver_published_names(request.published_names)?;
            let force = request.force.unwrap_or(false);
            delete_driver_packages(&names, force)?;
            let status = system_drivers_list_blocking()?;
            Ok(DriverStoreActionResult {
                status,
                message: format!("已提交删除 {} 个驱动包", names.len()),
                failed: Vec::new(),
            })
        }
        "scan-devices" => {
            let mut command = Command::new("pnputil");
            command.arg("/scan-devices");
            run_hidden(&mut command).map_err(|e| format!("扫描硬件变化失败：{}", e))?;
            let status = system_drivers_list_blocking()?;
            Ok(DriverStoreActionResult {
                status,
                message: "已扫描硬件变化并刷新驱动列表".to_string(),
                failed: Vec::new(),
            })
        }
        "check-updates" => {
            let scan = scan_driver_updates()?;
            let mut status = system_drivers_list_blocking()?;
            attach_driver_updates(&mut status, scan.updates, scan.checked_at, scan.message);
            Ok(DriverStoreActionResult {
                status,
                message: "已完成驱动更新检测".to_string(),
                failed: Vec::new(),
            })
        }
        "install-updates" => {
            let titles = normalize_driver_update_titles(request.update_titles.unwrap_or_default());
            let install = install_driver_updates(&titles)?;
            let scan = scan_driver_updates()?;
            let mut status = system_drivers_list_blocking()?;
            attach_driver_updates(&mut status, scan.updates, scan.checked_at, scan.message);
            let failed = install.failed.clone();
            let message = if install.selected_count == 0 {
                "没有找到可下载的驱动更新项，请先重新检测".to_string()
            } else if failed.is_empty() {
                format!(
                    "已下载并安装 {} 个驱动更新{}",
                    install.installed_count,
                    if install.reboot_required {
                        "，需要重启后完全生效"
                    } else {
                        ""
                    }
                )
            } else {
                format!(
                    "已处理 {} 个驱动更新，其中 {} 个未成功",
                    install.selected_count,
                    failed.len()
                )
            };
            Ok(DriverStoreActionResult {
                status,
                message,
                failed,
            })
        }
        "open-updates" => {
            let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
try { Start-Process -FilePath 'UsoClient.exe' -ArgumentList 'StartScan' -WindowStyle Hidden } catch {}
try { Start-Process 'ms-settings:windowsupdate-optionalupdates' } catch { Start-Process 'ms-settings:windowsupdate' }
"#;
            run_powershell_script_hidden(script)
                .map_err(|e| format!("打开 Windows 驱动更新入口失败：{}", e))?;
            let status = system_drivers_list_blocking()?;
            Ok(DriverStoreActionResult {
                status,
                message: "已打开 Windows 可选驱动更新页面并触发系统扫描".to_string(),
                failed: Vec::new(),
            })
        }
        _ => Err("未知驱动管理操作".to_string()),
    }
}

fn parse_driver_store_packages(output: &str) -> Vec<DriverStorePackage> {
    let mut packages = Vec::new();
    let mut current: Option<DriverStorePackage> = None;
    let mut collecting_files = false;

    for raw_line in output.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() {
            collecting_files = false;
            continue;
        }
        if trimmed.eq_ignore_ascii_case("Microsoft PnP Utility") {
            continue;
        }

        if let Some(value) = driver_field_value(trimmed, &["Published Name", "发布名称"]) {
            if let Some(item) = current.take() {
                if !item.published_name.is_empty() {
                    packages.push(item);
                }
            }
            current = Some(DriverStorePackage {
                published_name: value,
                original_name: String::new(),
                provider_name: String::new(),
                class_name: String::new(),
                category: String::new(),
                category_label: String::new(),
                class_guid: String::new(),
                extension_id: String::new(),
                driver_version: String::new(),
                driver_date: String::new(),
                signer_name: String::new(),
                catalog_file: String::new(),
                driver_files: Vec::new(),
                size: 0,
                installed: false,
                device_names: Vec::new(),
                older_duplicate: false,
                selected_by_default: false,
            });
            collecting_files = false;
            continue;
        }

        let Some(item) = current.as_mut() else {
            continue;
        };

        if let Some(value) = driver_field_value(trimmed, &["Original Name", "原始名称"]) {
            item.original_name = value;
            collecting_files = false;
        } else if let Some(value) =
            driver_field_value(trimmed, &["Provider Name", "提供程序名称", "Provider"])
        {
            item.provider_name = value;
            collecting_files = false;
        } else if let Some(value) = driver_field_value(trimmed, &["Class Name", "类名"]) {
            item.class_name = value;
            collecting_files = false;
        } else if let Some(value) =
            driver_field_value(trimmed, &["Class GUID", "类 GUID", "类 Guid"])
        {
            item.class_guid = value;
            collecting_files = false;
        } else if let Some(value) = driver_field_value(trimmed, &["Extension ID", "扩展 ID"]) {
            item.extension_id = value;
            collecting_files = false;
        } else if let Some(value) = driver_field_value(trimmed, &["Driver Version", "驱动程序版本"])
        {
            let (date, version) = split_driver_version(&value);
            item.driver_date = date;
            item.driver_version = version;
            collecting_files = false;
        } else if let Some(value) = driver_field_value(trimmed, &["Signer Name", "签名者名称"])
        {
            item.signer_name = value;
            collecting_files = false;
        } else if let Some(value) = driver_field_value(trimmed, &["Catalog File", "目录文件"]) {
            item.catalog_file = value;
            collecting_files = false;
        } else if driver_field_value(trimmed, &["Driver Files", "驱动程序文件"]).is_some()
            || trimmed.eq_ignore_ascii_case("Driver Files:")
        {
            collecting_files = true;
        } else if collecting_files {
            item.driver_files.push(trimmed.to_string());
        }
    }

    if let Some(item) = current.take() {
        if !item.published_name.is_empty() {
            packages.push(item);
        }
    }
    packages
}

fn driver_field_value(line: &str, labels: &[&str]) -> Option<String> {
    let (label, value) = line.split_once(':')?;
    let label = label.trim().to_ascii_lowercase();
    if labels
        .iter()
        .any(|candidate| label == candidate.to_ascii_lowercase())
    {
        Some(value.trim().to_string())
    } else {
        None
    }
}

fn split_driver_version(value: &str) -> (String, String) {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    if parts.len() >= 2 && looks_like_driver_date(parts[0]) {
        (parts[0].to_string(), parts[1..].join(" "))
    } else {
        (String::new(), value.trim().to_string())
    }
}

fn looks_like_driver_date(value: &str) -> bool {
    let separators =
        value.matches('/').count() + value.matches('-').count() + value.matches('.').count();
    separators >= 2 && value.chars().any(|ch| ch.is_ascii_digit())
}

fn installed_driver_device_map() -> Result<HashMap<String, Vec<String>>, String> {
    let mut command = Command::new("pnputil");
    command.args(["/enum-devices", "/connected", "/drivers"]);
    let output = command_output_hidden(&mut command)?;
    Ok(parse_installed_driver_devices(&output))
}

fn parse_installed_driver_devices(output: &str) -> HashMap<String, Vec<String>> {
    let mut map = HashMap::<String, Vec<String>>::new();
    let mut device_name = String::new();
    let mut pending_driver = String::new();
    for raw_line in output.lines() {
        let trimmed = raw_line.trim();
        if let Some(value) = driver_field_value(trimmed, &["Device Description", "设备描述"]) {
            device_name = value;
            pending_driver.clear();
        } else if let Some(value) = driver_field_value(trimmed, &["Driver Name", "驱动程序名称"])
        {
            let lower = value.to_ascii_lowercase();
            if !lower.starts_with("oem") {
                pending_driver.clear();
                continue;
            }
            if raw_line.starts_with(' ') || raw_line.starts_with('\t') {
                pending_driver = lower;
            } else {
                add_driver_device(&mut map, &lower, &device_name);
                pending_driver.clear();
            }
        } else if let Some(value) = driver_field_value(trimmed, &["Driver Status", "驱动程序状态"])
        {
            if !pending_driver.is_empty() && driver_status_is_installed(&value) {
                add_driver_device(&mut map, &pending_driver, &device_name);
            }
            pending_driver.clear();
        } else if trimmed.is_empty() {
            pending_driver.clear();
            device_name.clear();
        }
    }
    map
}

fn add_driver_device(map: &mut HashMap<String, Vec<String>>, driver_name: &str, device_name: &str) {
    if driver_name.is_empty() || device_name.is_empty() {
        return;
    }
    let entry = map.entry(driver_name.to_string()).or_default();
    if !entry.iter().any(|item| item == device_name) {
        entry.push(device_name.to_string());
    }
}

fn driver_status_is_installed(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower.contains("installed") || lower.contains("已安装")
}

fn enrich_driver_packages(
    packages: &mut Vec<DriverStorePackage>,
    device_map: &HashMap<String, Vec<String>>,
) {
    for item in packages.iter_mut() {
        if let Some(devices) = device_map.get(&item.published_name.to_ascii_lowercase()) {
            item.installed = true;
            item.device_names = devices.iter().take(8).cloned().collect();
        }
        item.size = estimate_driver_package_size(item);
        let (category, label) = classify_driver_package(item);
        item.category = category;
        item.category_label = label;
    }
    mark_driver_duplicates(packages);
    packages.sort_by(|a, b| {
        b.older_duplicate
            .cmp(&a.older_duplicate)
            .then_with(|| {
                a.provider_name
                    .to_lowercase()
                    .cmp(&b.provider_name.to_lowercase())
            })
            .then_with(|| {
                a.class_name
                    .to_lowercase()
                    .cmp(&b.class_name.to_lowercase())
            })
            .then_with(|| {
                natural_oem_number(&a.published_name).cmp(&natural_oem_number(&b.published_name))
            })
    });
}

fn classify_driver_package(item: &DriverStorePackage) -> (String, String) {
    let text = format!(
        "{} {} {} {} {} {}",
        item.class_name,
        item.original_name,
        item.provider_name,
        item.signer_name,
        item.device_names.join(" "),
        item.driver_files.join(" ")
    )
    .to_lowercase();
    let class_name = item.class_name.to_lowercase();
    let (key, label) = if class_name.contains("display")
        || text.contains("display")
        || text.contains("graphics")
        || text.contains("nvidia")
        || text.contains("amd")
        || text.contains("intel(r) graphics")
    {
        ("display", "显卡")
    } else if class_name.contains("net")
        || text.contains("network")
        || text.contains("ethernet")
        || text.contains("wi-fi")
        || text.contains("wifi")
        || text.contains("wireless")
        || text.contains("realtek pcie")
        || text.contains("intel(r) wi")
    {
        ("network", "网卡")
    } else if class_name.contains("media")
        || text.contains("audio")
        || text.contains("sound")
        || text.contains("realtek high definition")
        || text.contains("microphone")
        || text.contains("speaker")
    {
        ("audio", "音频")
    } else if text.contains("bluetooth") || class_name.contains("bluetooth") {
        ("bluetooth", "蓝牙")
    } else if class_name.contains("hdc")
        || class_name.contains("scsi")
        || text.contains("storage")
        || text.contains("nvme")
        || text.contains("sata")
        || text.contains("raid")
    {
        ("storage", "存储")
    } else if class_name.contains("usb") || text.contains("usb") {
        ("usb", "USB")
    } else if class_name.contains("printer") || text.contains("printer") || text.contains("print") {
        ("printer", "打印")
    } else if class_name.contains("system")
        || text.contains("chipset")
        || text.contains("serial io")
        || text.contains("management engine")
        || text.contains("firmware")
    {
        ("chipset", "芯片组/系统")
    } else if class_name.contains("extension") || !item.extension_id.is_empty() {
        ("extension", "扩展组件")
    } else {
        ("other", "其他")
    };
    (key.to_string(), label.to_string())
}

#[derive(Debug, Clone)]
struct DriverUpdateScan {
    checked_at: String,
    message: String,
    updates: Vec<DriverUpdateInfo>,
}

#[derive(Debug, Clone)]
struct DriverUpdateInstallSummary {
    selected_count: usize,
    installed_count: usize,
    reboot_required: bool,
    failed: Vec<String>,
}

fn scan_driver_updates() -> Result<DriverUpdateScan, String> {
    let script = r#"
$ErrorActionPreference = 'Stop'
function ReadText($obj, $name) {
  try {
    $value = $obj.$name
    if ($null -eq $value) { return '' }
    return "$value"
  } catch {
    return ''
  }
}
function ReadBool($obj, $name) {
  try {
    return [bool]($obj.$name)
  } catch {
    return $false
  }
}
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$result = $searcher.Search("IsInstalled=0 and Type='Driver'")
$updates = @()
for ($i = 0; $i -lt $result.Updates.Count; $i++) {
  $update = $result.Updates.Item($i)
  $categories = @()
  try {
    $categories = @($update.Categories | ForEach-Object { "$($_.Name)" })
  } catch {
    $categories = @()
  }
  $updates += [pscustomobject]@{
    Title = ReadText $update 'Title'
    Description = ReadText $update 'Description'
    Categories = @($categories)
    Severity = ReadText $update 'MsrcSeverity'
    RebootRequired = ReadBool $update 'RebootRequired'
    DriverClass = ReadText $update 'DriverClass'
    DriverManufacturer = ReadText $update 'DriverManufacturer'
    DriverModel = ReadText $update 'DriverModel'
    DriverProvider = ReadText $update 'DriverProvider'
    DriverVersion = ReadText $update 'DriverVerDate'
  }
}
[pscustomobject]@{
  CheckedAt = (Get-Date).ToString('s')
  Message = if ($updates.Count -gt 0) { "检测到 $($updates.Count) 个可用驱动更新" } else { '未检测到可用驱动更新' }
  Updates = @($updates)
} | ConvertTo-Json -Depth 6 -Compress
"#;
    let rows = powershell_json_rows(script)?;
    let value = rows.into_iter().next().unwrap_or(serde_json::Value::Null);
    let updates = json_array(&value, "Updates")
        .into_iter()
        .map(parse_driver_update)
        .collect::<Vec<_>>();
    Ok(DriverUpdateScan {
        checked_at: json_string(&value, "CheckedAt"),
        message: json_string(&value, "Message"),
        updates,
    })
}

fn parse_driver_update(value: &serde_json::Value) -> DriverUpdateInfo {
    DriverUpdateInfo {
        title: json_string(value, "Title"),
        description: json_string(value, "Description"),
        categories: json_array(value, "Categories")
            .into_iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
        severity: json_string(value, "Severity"),
        reboot_required: json_bool(value, "RebootRequired"),
        driver_class: json_string(value, "DriverClass"),
        driver_manufacturer: json_string(value, "DriverManufacturer"),
        driver_model: json_string(value, "DriverModel"),
        driver_provider: json_string(value, "DriverProvider"),
        driver_version: json_string(value, "DriverVersion"),
        matched_categories: Vec::new(),
        matched_packages: Vec::new(),
    }
}

fn normalize_driver_update_titles(titles: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    let mut rows = Vec::new();
    for title in titles {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_lowercase();
        if seen.insert(key) {
            rows.push(trimmed.to_string());
        }
    }
    rows
}

fn powershell_string_array(values: &[String]) -> String {
    if values.is_empty() {
        "@()".to_string()
    } else {
        format!(
            "@({})",
            values
                .iter()
                .map(|value| format!("'{}'", escape_powershell_single_quote(value)))
                .collect::<Vec<_>>()
                .join(",")
        )
    }
}

fn driver_update_result_label(code: u64) -> &'static str {
    match code {
        2 => "成功",
        3 => "部分成功",
        4 => "失败",
        5 => "已中止",
        1 => "进行中",
        _ => "未开始",
    }
}

fn install_driver_updates(titles: &[String]) -> Result<DriverUpdateInstallSummary, String> {
    let requested_titles = powershell_string_array(titles);
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$requestedTitles = {requested_titles}
function Test-RequestedTitle($title) {{
  if ($requestedTitles.Count -eq 0) {{ return $true }}
  foreach ($candidate in $requestedTitles) {{
    if ("$title" -eq "$candidate") {{ return $true }}
  }}
  return $false
}}
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$result = $searcher.Search("IsInstalled=0 and Type='Driver'")
$selected = New-Object -ComObject Microsoft.Update.UpdateColl
$selectedTitles = @()
for ($i = 0; $i -lt $result.Updates.Count; $i++) {{
  $update = $result.Updates.Item($i)
  if (Test-RequestedTitle $update.Title) {{
    try {{
      if (-not $update.EulaAccepted) {{ $update.AcceptEula() }}
    }} catch {{}}
    [void]$selected.Add($update)
    $selectedTitles += "$($update.Title)"
  }}
}}
$downloadResultCode = 0
$installResultCode = 0
$rebootRequired = $false
$perUpdate = @()
$downloadError = ''
$installError = ''
if ($selected.Count -gt 0) {{
  try {{
    $downloader = $session.CreateUpdateDownloader()
    $downloader.Updates = $selected
    $downloadResult = $downloader.Download()
    $downloadResultCode = [int]$downloadResult.ResultCode
  }} catch {{
    $downloadError = "$($_.Exception.Message)"
  }}
  $installable = New-Object -ComObject Microsoft.Update.UpdateColl
  for ($i = 0; $i -lt $selected.Count; $i++) {{
    $update = $selected.Item($i)
    if ($update.IsDownloaded) {{
      [void]$installable.Add($update)
    }} else {{
      $perUpdate += [pscustomobject]@{{
        Title = "$($update.Title)"
        ResultCode = 4
        HResult = ''
        Message = if ($downloadError) {{ $downloadError }} else {{ '更新未完成下载' }}
      }}
    }}
  }}
  if ($installable.Count -gt 0) {{
    try {{
      $installer = $session.CreateUpdateInstaller()
      $installer.Updates = $installable
      $installResult = $installer.Install()
      $installResultCode = [int]$installResult.ResultCode
      $rebootRequired = [bool]$installResult.RebootRequired
      for ($i = 0; $i -lt $installable.Count; $i++) {{
        $itemResult = $installResult.GetUpdateResult($i)
        $perUpdate += [pscustomobject]@{{
          Title = "$($installable.Item($i).Title)"
          ResultCode = [int]$itemResult.ResultCode
          HResult = "$($itemResult.HResult)"
          Message = ''
        }}
      }}
    }} catch {{
      $installError = "$($_.Exception.Message)"
      for ($i = 0; $i -lt $installable.Count; $i++) {{
        $perUpdate += [pscustomobject]@{{
          Title = "$($installable.Item($i).Title)"
          ResultCode = 4
          HResult = ''
          Message = $installError
        }}
      }}
    }}
  }}
}}
[pscustomobject]@{{
  SelectedCount = $selected.Count
  DownloadResultCode = $downloadResultCode
  InstallResultCode = $installResultCode
  RebootRequired = $rebootRequired
  SelectedTitles = @($selectedTitles)
  PerUpdate = @($perUpdate)
}} | ConvertTo-Json -Depth 6 -Compress
"#
    );
    let value = powershell_json_rows(&script)?
        .into_iter()
        .next()
        .unwrap_or(serde_json::Value::Null);
    let selected_count = json_u64(&value, "SelectedCount").unwrap_or(0) as usize;
    let reboot_required = json_bool(&value, "RebootRequired");
    let mut installed_count = 0usize;
    let mut failed = Vec::new();
    for item in json_array(&value, "PerUpdate") {
        let title = json_string(item, "Title");
        let code = json_u64(item, "ResultCode").unwrap_or(0);
        let message = json_string(item, "Message");
        if code == 2 {
            installed_count += 1;
        } else {
            let detail = if message.is_empty() {
                driver_update_result_label(code).to_string()
            } else {
                format!("{}：{}", driver_update_result_label(code), message)
            };
            failed.push(format!("{} - {}", title, detail));
        }
    }
    let download_code = json_u64(&value, "DownloadResultCode").unwrap_or(0);
    let install_code = json_u64(&value, "InstallResultCode").unwrap_or(0);
    if selected_count > 0
        && failed.is_empty()
        && installed_count == 0
        && (download_code >= 4 || install_code >= 4)
    {
        failed.push(format!(
            "Windows Update Agent 返回失败：下载 {}，安装 {}",
            driver_update_result_label(download_code),
            driver_update_result_label(install_code)
        ));
    }
    Ok(DriverUpdateInstallSummary {
        selected_count,
        installed_count,
        reboot_required,
        failed,
    })
}

fn attach_driver_updates(
    status: &mut DriverStoreStatus,
    mut updates: Vec<DriverUpdateInfo>,
    checked_at: String,
    message: String,
) {
    for update in updates.iter_mut() {
        let categories = classify_driver_update(update);
        update.matched_categories = categories.clone();
        update.matched_packages =
            match_driver_update_packages(update, &categories, &status.packages);
    }
    status.update_checked = true;
    status.update_check_time = checked_at;
    status.update_count = updates.len();
    status.update_message = if message.trim().is_empty() {
        if updates.is_empty() {
            "未检测到可用驱动更新".to_string()
        } else {
            format!("检测到 {} 个可用驱动更新", updates.len())
        }
    } else {
        message
    };
    status.updates = updates;
}

fn classify_driver_update(update: &DriverUpdateInfo) -> Vec<String> {
    let text = format!(
        "{} {} {} {} {} {} {}",
        update.title,
        update.description,
        update.categories.join(" "),
        update.driver_class,
        update.driver_manufacturer,
        update.driver_model,
        update.driver_provider
    )
    .to_lowercase();
    let mut categories = Vec::new();
    let checks = [
        (
            "display",
            [
                "display",
                "graphics",
                "nvidia",
                "amd",
                "intel corporation - display",
            ]
            .as_slice(),
        ),
        (
            "network",
            [
                "network",
                "ethernet",
                "wireless",
                "wi-fi",
                "wifi",
                "realtek pcie",
            ]
            .as_slice(),
        ),
        (
            "audio",
            ["audio", "sound", "realtek semiconductor"].as_slice(),
        ),
        ("bluetooth", ["bluetooth"].as_slice()),
        ("storage", ["storage", "nvme", "sata", "raid"].as_slice()),
        ("usb", ["usb"].as_slice()),
        ("printer", ["printer", "print"].as_slice()),
        (
            "chipset",
            [
                "chipset",
                "firmware",
                "serial io",
                "management engine",
                "system",
            ]
            .as_slice(),
        ),
    ];
    for (key, needles) in checks {
        if needles.iter().any(|needle| text.contains(needle)) {
            categories.push(key.to_string());
        }
    }
    if categories.is_empty() {
        categories.push("other".to_string());
    }
    categories.sort();
    categories.dedup();
    categories
}

fn match_driver_update_packages(
    update: &DriverUpdateInfo,
    categories: &[String],
    packages: &[DriverStorePackage],
) -> Vec<String> {
    let update_text = format!(
        "{} {} {} {} {} {}",
        update.title,
        update.description,
        update.driver_manufacturer,
        update.driver_provider,
        update.driver_model,
        update.categories.join(" ")
    )
    .to_lowercase();
    let mut matches = Vec::new();
    for package in packages {
        let category_match = categories
            .iter()
            .any(|category| category == &package.category);
        let provider = package.provider_name.trim().to_lowercase();
        let original = package.original_name.trim().to_lowercase();
        let device_match = package
            .device_names
            .iter()
            .any(|name| contains_meaningful_token(&update_text, &name.to_lowercase()));
        let provider_match = provider.len() >= 4 && update_text.contains(&provider);
        let original_match = original.len() >= 6 && update_text.contains(&original);
        if (category_match && (provider_match || device_match)) || original_match {
            matches.push(package.published_name.clone());
        }
        if matches.len() >= 12 {
            break;
        }
    }
    matches
}

fn contains_meaningful_token(haystack: &str, text: &str) -> bool {
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| part.len() >= 5)
        .any(|part| haystack.contains(part))
}

fn mark_driver_duplicates(packages: &mut [DriverStorePackage]) {
    let mut groups = HashMap::<String, Vec<usize>>::new();
    for (index, item) in packages.iter().enumerate() {
        let key = driver_duplicate_key(item);
        if !key.is_empty() {
            groups.entry(key).or_default().push(index);
        }
    }
    for indexes in groups.into_values() {
        if indexes.len() < 2 {
            continue;
        }
        let newest = indexes
            .iter()
            .copied()
            .max_by(|left, right| {
                driver_sort_key(&packages[*left]).cmp(&driver_sort_key(&packages[*right]))
            })
            .unwrap_or(indexes[0]);
        for index in indexes {
            if index == newest {
                continue;
            }
            let item = &mut packages[index];
            item.older_duplicate = true;
            item.selected_by_default = !item.installed;
        }
    }
}

fn driver_duplicate_key(item: &DriverStorePackage) -> String {
    let original = item.original_name.trim().to_ascii_lowercase();
    let provider = item.provider_name.trim().to_ascii_lowercase();
    if original.is_empty() || provider.is_empty() {
        return String::new();
    }
    format!(
        "{}|{}|{}",
        provider,
        item.class_guid.trim().to_ascii_lowercase(),
        original
    )
}

fn driver_sort_key(item: &DriverStorePackage) -> (u32, u32, u32, Vec<u64>, u32) {
    let (year, month, day) = parse_driver_date(&item.driver_date).unwrap_or((0, 0, 0));
    (
        year,
        month,
        day,
        parse_version_numbers(&item.driver_version),
        natural_oem_number(&item.published_name),
    )
}

fn parse_driver_date(value: &str) -> Option<(u32, u32, u32)> {
    let parts = value
        .split(|ch| ch == '/' || ch == '-' || ch == '.')
        .filter_map(|part| part.trim().parse::<u32>().ok())
        .collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }
    if parts[0] > 1900 {
        Some((parts[0], parts[1], parts[2]))
    } else {
        Some((parts[2], parts[0], parts[1]))
    }
}

fn parse_version_numbers(value: &str) -> Vec<u64> {
    value
        .split(|ch: char| !ch.is_ascii_digit())
        .filter_map(|part| part.parse::<u64>().ok())
        .collect::<Vec<_>>()
}

fn natural_oem_number(value: &str) -> u32 {
    value
        .trim()
        .trim_start_matches(|ch: char| ch.eq_ignore_ascii_case(&'o'))
        .trim_start_matches(|ch: char| ch.eq_ignore_ascii_case(&'e'))
        .trim_start_matches(|ch: char| ch.eq_ignore_ascii_case(&'m'))
        .trim_end_matches(".inf")
        .parse::<u32>()
        .unwrap_or(u32::MAX)
}

fn estimate_driver_package_size(item: &DriverStorePackage) -> u64 {
    let root = driver_store_file_repository();
    if !root.is_dir() {
        return 0;
    }
    let stem = item.original_name.trim().to_ascii_lowercase();
    if stem.is_empty() {
        return 0;
    }
    let mut total = 0u64;
    let Ok(rows) = std::fs::read_dir(root) else {
        return 0;
    };
    for entry in rows.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let lower_name = name.to_ascii_lowercase();
        if lower_name == stem || lower_name.starts_with(&format!("{}_", stem)) {
            total = total.saturating_add(path_size_quick(&path));
        }
    }
    total
}

fn driver_store_file_repository() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("DriverStore")
        .join("FileRepository")
}

fn build_driver_store_status(packages: Vec<DriverStorePackage>) -> DriverStoreStatus {
    let total_size = packages.iter().map(|item| item.size).sum::<u64>();
    let duplicate_count = packages.iter().filter(|item| item.older_duplicate).count();
    let installed_count = packages.iter().filter(|item| item.installed).count();
    DriverStoreStatus {
        third_party_count: packages.len(),
        message: if packages.is_empty() {
            "未读取到第三方驱动包".to_string()
        } else {
            format!(
                "已读取 {} 个第三方驱动包，{} 个疑似旧版重复包，{} 个正在被已连接设备使用",
                packages.len(),
                duplicate_count,
                installed_count
            )
        },
        packages,
        total_size,
        duplicate_count,
        installed_count,
        update_checked: false,
        update_check_time: String::new(),
        update_count: 0,
        updates: Vec::new(),
        update_message: "尚未检测驱动更新".to_string(),
    }
}

fn normalize_driver_published_names(names: Vec<String>) -> Result<Vec<String>, String> {
    let mut rows = names
        .into_iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    rows.sort();
    rows.dedup();
    if rows.is_empty() {
        return Err("请选择驱动包".to_string());
    }
    if rows.iter().any(|name| !is_valid_oem_inf_name(name)) {
        return Err("驱动包名称无效，只允许 oem#.inf".to_string());
    }
    Ok(rows)
}

fn is_valid_oem_inf_name(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let Some(number) = lower
        .strip_prefix("oem")
        .and_then(|text| text.strip_suffix(".inf"))
    else {
        return false;
    };
    !number.is_empty() && number.chars().all(|ch| ch.is_ascii_digit())
}

fn delete_driver_packages(names: &[String], force: bool) -> Result<(), String> {
    let script = build_delete_driver_script(names, force);
    if let Err(err) = run_powershell_script_hidden(&script) {
        if is_elevation_required_error(&err) || err.to_lowercase().contains("administrator") {
            run_powershell_script_with_elevation(&script)
                .map_err(|e| format!("删除驱动需要管理员权限：{}。{}", err, e))?;
        } else {
            return Err(err);
        }
    }
    Ok(())
}

fn build_delete_driver_script(names: &[String], force: bool) -> String {
    let quoted_names = names
        .iter()
        .map(|name| format!("'{}'", escape_powershell_single_quote(name)))
        .collect::<Vec<_>>()
        .join(",");
    let force_arg = if force {
        r#"$argsList += "/force""#
    } else {
        ""
    };
    format!(
        r#"
$ErrorActionPreference = 'Stop'
$failed = @()
$drivers = @({quoted_names})
foreach ($driver in $drivers) {{
  $argsList = @('/delete-driver', $driver, '/uninstall')
  {force_arg}
  $output = & pnputil @argsList 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {{
    $failed += "$driver`: $output"
  }}
}}
if ($failed.Count -gt 0) {{
  throw ($failed -join "`n")
}}
"#
    )
}

fn system_monitor_snapshot_blocking() -> Result<SystemMonitorSnapshot, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
$system = Get-CimInstance Win32_PerfFormattedData_PerfOS_System
$memory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
$logicalDisk = @(Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk | Where-Object { $_.Name -ne '_Total' })
$network = @(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface)
$processPerf = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' })
$processCim = @(Get-CimInstance Win32_Process)
$procByPid = @{}
foreach ($p in $processCim) { $procByPid["$($p.ProcessId)"] = $p }
$processRuntime = @(Get-Process -ErrorAction SilentlyContinue)
$runtimeByPid = @{}
foreach ($p in $processRuntime) { $runtimeByPid["$($p.Id)"] = $p }
function ResolveProcessCategory($name, $path, $windowTitle) {
  $lowerName = "$name".ToLowerInvariant()
  $lowerPath = "$path".ToLowerInvariant()
  $systemNames = @(
    'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'services.exe',
    'lsass.exe', 'lsaiso.exe', 'svchost.exe', 'fontdrvhost.exe', 'dwm.exe',
    'memory compression', 'secure system', 'system idle process'
  )
  if (-not [string]::IsNullOrWhiteSpace($windowTitle)) {
    return [pscustomobject]@{ Key = 'apps'; Label = '应用' }
  }
  if ($systemNames -contains $lowerName -or $lowerPath.Contains('\windows\')) {
    return [pscustomobject]@{ Key = 'windows'; Label = 'Windows/系统进程' }
  }
  return [pscustomobject]@{ Key = 'background'; Label = '后台进程' }
}
$services = @(Get-CimInstance Win32_Service)
$connections = @()
try {
  $connections = @(Get-NetTCPConnection | Select-Object -First 400)
} catch {
  $connections = @()
}
$procNameByPid = @{}
foreach ($p in $processCim) { $procNameByPid["$($p.ProcessId)"] = $p.Name }
$totalMemory = [int64]$os.TotalVisibleMemorySize * 1024
$freeMemory = [int64]$os.FreePhysicalMemory * 1024
$usedMemory = [Math]::Max(0, $totalMemory - $freeMemory)
$uptime = [int64](([DateTime]::Now) - $os.LastBootUpTime).TotalSeconds
$diskRead = [int64](($logicalDisk | Measure-Object -Property DiskReadBytesPersec -Sum).Sum)
$diskWrite = [int64](($logicalDisk | Measure-Object -Property DiskWriteBytesPersec -Sum).Sum)
$networkBytes = [int64](($network | Measure-Object -Property BytesTotalPersec -Sum).Sum)
[pscustomobject]@{
  Overview = [pscustomobject]@{
    Timestamp = (Get-Date).ToString('s')
    ComputerName = "$($computer.Name)"
    OsName = "$($os.Caption)"
    UptimeSeconds = "$uptime"
    CpuUsagePercent = [double]([Math]::Round([double]$cpu.PercentProcessorTime, 2))
    TotalMemory = "$totalMemory"
    FreeMemory = "$freeMemory"
    UsedMemory = "$usedMemory"
    MemoryUsagePercent = if ($totalMemory -gt 0) { [double]([Math]::Round(($usedMemory / $totalMemory) * 100, 2)) } else { 0 }
    ProcessCount = "$($system.Processes)"
    ThreadCount = "$($system.Threads)"
    HandleCount = "$($system.SystemCallsPersec)"
    NetworkConnectionCount = "$($connections.Count)"
    DiskReadBytesPerSec = "$diskRead"
    DiskWriteBytesPerSec = "$diskWrite"
    NetworkBytesPerSec = "$networkBytes"
  }
  Processes = @($processPerf | Sort-Object PercentProcessorTime -Descending | Select-Object -First 600 | ForEach-Object {
    $processIdValue = [int]$_.IDProcess
    $cim = $procByPid["$processIdValue"]
    $runtime = $runtimeByPid["$processIdValue"]
    $processName = if ($cim -and $cim.Name) { "$($cim.Name)" } else { "$($_.Name)" }
    $processPath = if ($cim) { "$($cim.ExecutablePath)" } else { "" }
    $windowTitle = if ($runtime) { try { "$($runtime.MainWindowTitle)" } catch { "" } } else { "" }
    $sessionId = if ($runtime) { try { "$($runtime.SessionId)" } catch { "0" } } else { "0" }
    $category = ResolveProcessCategory $processName $processPath $windowTitle
    [pscustomobject]@{
      Pid = "$processIdValue"
      ParentPid = if ($cim) { "$($cim.ParentProcessId)" } else { "$($_.CreatingProcessID)" }
      Name = "$processName"
      ExecutablePath = "$processPath"
      CommandLine = if ($cim) { "$($cim.CommandLine)" } else { "" }
      WindowTitle = "$windowTitle"
      SessionId = "$sessionId"
      Category = "$($category.Key)"
      CategoryLabel = "$($category.Label)"
      CreationTime = if ($cim -and $cim.CreationDate) { "$($cim.CreationDate)" } else { "" }
      CpuPercent = [double]([Math]::Round([double]$_.PercentProcessorTime, 2))
      PrivateBytes = "$($_.PrivateBytes)"
      WorkingSet = "$($_.WorkingSet)"
      ThreadCount = "$($_.ThreadCount)"
      HandleCount = "$($_.HandleCount)"
      IoReadBytesPerSec = "$($_.IOReadBytesPersec)"
      IoWriteBytesPerSec = "$($_.IOWriteBytesPersec)"
    }
  })
  Services = @($services | Sort-Object State,DisplayName | Select-Object -First 260 | ForEach-Object {
    [pscustomobject]@{
      Name = "$($_.Name)"
      DisplayName = "$($_.DisplayName)"
      State = "$($_.State)"
      StartMode = "$($_.StartMode)"
      ProcessId = "$($_.ProcessId)"
      StartName = "$($_.StartName)"
      PathName = "$($_.PathName)"
    }
  })
  Connections = @($connections | ForEach-Object {
    $ownerProcessId = [int]$_.OwningProcess
    [pscustomobject]@{
      Protocol = "TCP"
      LocalAddress = "$($_.LocalAddress)"
      LocalPort = "$($_.LocalPort)"
      RemoteAddress = "$($_.RemoteAddress)"
      RemotePort = "$($_.RemotePort)"
      State = "$($_.State)"
      OwningProcess = "$ownerProcessId"
      ProcessName = "$($procNameByPid["$ownerProcessId"])"
      CreationTime = "$($_.CreationTime)"
    }
  })
  Disks = @($logicalDisk | ForEach-Object {
    [pscustomobject]@{
      Name = "$($_.Name)"
      ReadBytesPerSec = "$($_.DiskReadBytesPersec)"
      WriteBytesPerSec = "$($_.DiskWriteBytesPersec)"
      DiskTimePercent = [double]([Math]::Round([double]$_.PercentDiskTime, 2))
      QueueLength = "$($_.CurrentDiskQueueLength)"
    }
  })
  NetworkInterfaces = @($network | ForEach-Object {
    [pscustomobject]@{
      Name = "$($_.Name)"
      BytesReceivedPerSec = "$($_.BytesReceivedPersec)"
      BytesSentPerSec = "$($_.BytesSentPersec)"
      BytesTotalPerSec = "$($_.BytesTotalPersec)"
      CurrentBandwidth = "$($_.CurrentBandwidth)"
    }
  })
} | ConvertTo-Json -Depth 6 -Compress
"#;
    let mut command = Command::new("powershell");
    let script = with_utf8_powershell_output(script);
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    let output = command_output_hidden(&mut command)?;
    let value = serde_json::from_str::<serde_json::Value>(&output)
        .map_err(|e| format!("解析系统监控快照失败: {}", e))?;
    Ok(parse_system_monitor_snapshot(&value))
}

fn parse_system_monitor_snapshot(value: &serde_json::Value) -> SystemMonitorSnapshot {
    let overview_value = value.get("Overview").unwrap_or(&serde_json::Value::Null);
    let overview = SystemMonitorOverview {
        timestamp: json_string(overview_value, "Timestamp"),
        computer_name: json_string(overview_value, "ComputerName"),
        os_name: json_string(overview_value, "OsName"),
        uptime_seconds: json_u64(overview_value, "UptimeSeconds").unwrap_or(0),
        cpu_usage_percent: json_f64(overview_value, "CpuUsagePercent"),
        total_memory: json_u64(overview_value, "TotalMemory").unwrap_or(0),
        free_memory: json_u64(overview_value, "FreeMemory").unwrap_or(0),
        used_memory: json_u64(overview_value, "UsedMemory").unwrap_or(0),
        memory_usage_percent: json_f64(overview_value, "MemoryUsagePercent"),
        process_count: json_u64(overview_value, "ProcessCount").unwrap_or(0),
        thread_count: json_u64(overview_value, "ThreadCount").unwrap_or(0),
        handle_count: json_u64(overview_value, "HandleCount").unwrap_or(0),
        network_connection_count: json_u64(overview_value, "NetworkConnectionCount").unwrap_or(0),
        disk_read_bytes_per_sec: json_u64(overview_value, "DiskReadBytesPerSec").unwrap_or(0),
        disk_write_bytes_per_sec: json_u64(overview_value, "DiskWriteBytesPerSec").unwrap_or(0),
        network_bytes_per_sec: json_u64(overview_value, "NetworkBytesPerSec").unwrap_or(0),
    };
    let processes = json_array(value, "Processes")
        .into_iter()
        .map(|row| SystemMonitorProcess {
            pid: json_u64(row, "Pid").unwrap_or(0) as u32,
            parent_pid: json_u64(row, "ParentPid").unwrap_or(0) as u32,
            name: json_string(row, "Name"),
            executable_path: json_string(row, "ExecutablePath"),
            command_line: json_string(row, "CommandLine"),
            window_title: json_string(row, "WindowTitle"),
            session_id: json_u64(row, "SessionId").unwrap_or(0) as u32,
            category: json_string(row, "Category"),
            category_label: json_string(row, "CategoryLabel"),
            creation_time: json_string(row, "CreationTime"),
            cpu_percent: json_f64(row, "CpuPercent"),
            private_bytes: json_u64(row, "PrivateBytes").unwrap_or(0),
            working_set: json_u64(row, "WorkingSet").unwrap_or(0),
            thread_count: json_u64(row, "ThreadCount").unwrap_or(0),
            handle_count: json_u64(row, "HandleCount").unwrap_or(0),
            io_read_bytes_per_sec: json_u64(row, "IoReadBytesPerSec").unwrap_or(0),
            io_write_bytes_per_sec: json_u64(row, "IoWriteBytesPerSec").unwrap_or(0),
        })
        .collect::<Vec<_>>();
    let services = json_array(value, "Services")
        .into_iter()
        .map(|row| SystemMonitorService {
            name: json_string(row, "Name"),
            display_name: json_string(row, "DisplayName"),
            state: json_string(row, "State"),
            start_mode: json_string(row, "StartMode"),
            process_id: json_u64(row, "ProcessId").unwrap_or(0) as u32,
            start_name: json_string(row, "StartName"),
            path_name: json_string(row, "PathName"),
        })
        .collect::<Vec<_>>();
    let connections = json_array(value, "Connections")
        .into_iter()
        .map(|row| SystemMonitorConnection {
            protocol: json_string(row, "Protocol"),
            local_address: json_string(row, "LocalAddress"),
            local_port: json_u64(row, "LocalPort").unwrap_or(0) as u32,
            remote_address: json_string(row, "RemoteAddress"),
            remote_port: json_u64(row, "RemotePort").unwrap_or(0) as u32,
            state: normalize_tcp_state(&json_string(row, "State")),
            owning_process: json_u64(row, "OwningProcess").unwrap_or(0) as u32,
            process_name: json_string(row, "ProcessName"),
            creation_time: json_string(row, "CreationTime"),
        })
        .collect::<Vec<_>>();
    let disks = json_array(value, "Disks")
        .into_iter()
        .map(|row| SystemMonitorDisk {
            name: json_string(row, "Name"),
            read_bytes_per_sec: json_u64(row, "ReadBytesPerSec").unwrap_or(0),
            write_bytes_per_sec: json_u64(row, "WriteBytesPerSec").unwrap_or(0),
            disk_time_percent: json_f64(row, "DiskTimePercent"),
            queue_length: json_u64(row, "QueueLength").unwrap_or(0),
        })
        .collect::<Vec<_>>();
    let network_interfaces = json_array(value, "NetworkInterfaces")
        .into_iter()
        .map(|row| SystemMonitorNetworkInterface {
            name: json_string(row, "Name"),
            bytes_received_per_sec: json_u64(row, "BytesReceivedPerSec").unwrap_or(0),
            bytes_sent_per_sec: json_u64(row, "BytesSentPerSec").unwrap_or(0),
            bytes_total_per_sec: json_u64(row, "BytesTotalPerSec").unwrap_or(0),
            current_bandwidth: json_u64(row, "CurrentBandwidth").unwrap_or(0),
        })
        .collect::<Vec<_>>();
    let message = format!(
        "已读取 {} 个进程、{} 个服务、{} 条 TCP 连接",
        processes.len(),
        services.len(),
        connections.len()
    );
    SystemMonitorSnapshot {
        overview,
        processes,
        services,
        connections,
        disks,
        network_interfaces,
        message,
    }
}

fn normalize_tcp_state(value: &str) -> String {
    match value.trim() {
        "1" => "Closed".to_string(),
        "2" => "Listen".to_string(),
        "3" => "SynSent".to_string(),
        "4" => "SynReceived".to_string(),
        "5" => "Established".to_string(),
        "6" => "FinWait1".to_string(),
        "7" => "FinWait2".to_string(),
        "8" => "CloseWait".to_string(),
        "9" => "Closing".to_string(),
        "10" => "LastAck".to_string(),
        "11" => "TimeWait".to_string(),
        "12" => "DeleteTCB".to_string(),
        other => other.to_string(),
    }
}

fn system_wsl_status_blocking() -> Result<WslStatus, String> {
    let list_output = wsl_command_output(&["--list", "--verbose"])?;
    let mut distributions = parse_wsl_list(&list_output);
    let default_distribution = distributions
        .iter()
        .find(|item| item.default)
        .map(|item| item.name.clone())
        .unwrap_or_default();
    let kernel_version = wsl_kernel_version().unwrap_or_default();
    enrich_wsl_distributions(&mut distributions);
    let installed = !distributions.is_empty();
    let message = if installed {
        format!("已读取 {} 个 WSL 发行版", distributions.len())
    } else {
        "未检测到 WSL 发行版。可先安装 WSL 或导入发行版。".to_string()
    };
    Ok(WslStatus {
        installed,
        default_distribution,
        kernel_version,
        distributions,
        message,
    })
}

fn system_wsl_action_blocking(request: WslActionRequest) -> Result<WslStatus, String> {
    let name = request.name.trim().to_string();
    match request.action.as_str() {
        "open" => {
            let mut command = Command::new("cmd");
            if name.is_empty() {
                command.args(["/C", "start", "wsl.exe"]);
            } else {
                command.args(["/C", "start", "", "wsl.exe", "-d", &name]);
            }
            run_hidden(&mut command)?;
        }
        "open-files" => {
            if name.is_empty() {
                return Err("请选择 WSL 发行版".to_string());
            }
            let mut command = Command::new("explorer");
            command.arg(format!(r"\\wsl$\{}", name));
            run_hidden(&mut command)?;
        }
        "set-default" => {
            validate_wsl_distribution_name(&name)?;
            wsl_command_status(&["--set-default", &name])?;
        }
        "terminate" => {
            validate_wsl_distribution_name(&name)?;
            wsl_command_status(&["--terminate", &name])?;
        }
        "pause" => {
            validate_wsl_distribution_name(&name)?;
            wsl_command_status(&["--terminate", &name])?;
        }
        "restart" => {
            validate_wsl_distribution_name(&name)?;
            let _ = wsl_command_status(&["--terminate", &name]);
            let mut command = Command::new("cmd");
            command.args(["/C", "start", "", "wsl.exe", "-d", &name]);
            run_hidden(&mut command)?;
        }
        "shutdown" => {
            wsl_command_status(&["--shutdown"])?;
        }
        "unregister" => {
            validate_wsl_distribution_name(&name)?;
            let _ = wsl_command_status(&["--terminate", &name]);
            wsl_command_status(&["--unregister", &name])?;
        }
        "set-version-1" => {
            validate_wsl_distribution_name(&name)?;
            wsl_command_status(&["--set-version", &name, "1"])?;
        }
        "set-version-2" => {
            validate_wsl_distribution_name(&name)?;
            wsl_command_status(&["--set-version", &name, "2"])?;
        }
        "export" => {
            validate_wsl_distribution_name(&name)?;
            let output_path = request
                .output_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "请选择导出文件路径".to_string())?;
            wsl_command_status(&["--export", &name, output_path])?;
        }
        _ => return Err("未知 WSL 操作".to_string()),
    }
    system_wsl_status_blocking()
}

fn validate_wsl_distribution_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("请选择 WSL 发行版".to_string());
    }
    if name.contains('\0') || name.contains('\n') || name.contains('\r') {
        return Err("WSL 发行版名称无效".to_string());
    }
    Ok(())
}

fn wsl_command_output(args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("wsl.exe");
    command.args(args);
    let output = command_output_bytes_hidden(&mut command)?;
    if !output.status.success() {
        let text = decode_command_output(&output.stderr);
        let fallback = decode_command_output(&output.stdout);
        return Err(if text.trim().is_empty() {
            fallback.trim().to_string()
        } else {
            text.trim().to_string()
        });
    }
    Ok(decode_command_output(&output.stdout))
}

fn wsl_command_status(args: &[&str]) -> Result<(), String> {
    let mut command = Command::new("wsl.exe");
    command.args(args);
    run_hidden(&mut command)
}

fn parse_wsl_list(output: &str) -> Vec<WslDistribution> {
    output
        .lines()
        .filter_map(|line| parse_wsl_list_line(line))
        .collect::<Vec<_>>()
}

fn parse_wsl_list_line(line: &str) -> Option<WslDistribution> {
    let mut text = line.replace('\0', "").trim().to_string();
    if text.is_empty() || text.to_ascii_uppercase().starts_with("NAME") {
        return None;
    }
    let default = text.starts_with('*');
    if default {
        text = text.trim_start_matches('*').trim().to_string();
    }
    let parts = text.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }
    let version = parts.last()?.to_string();
    let state = parts.get(parts.len().saturating_sub(2))?.to_string();
    let name = parts[..parts.len().saturating_sub(2)].join(" ");
    if name.is_empty() {
        return None;
    }
    Some(WslDistribution {
        name,
        running: state.eq_ignore_ascii_case("Running"),
        state,
        version,
        default,
        base_path: String::new(),
        vhd_path: String::new(),
        size: 0,
        last_write_time: String::new(),
    })
}

fn wsl_kernel_version() -> Option<String> {
    wsl_command_output(&["--version"]).ok().and_then(|text| {
        text.lines()
            .map(|line| line.replace('\0', "").trim().to_string())
            .find(|line| !line.is_empty())
    })
}

fn enrich_wsl_distributions(distributions: &mut [WslDistribution]) {
    let registry = wsl_registry_entries();
    for distribution in distributions {
        if let Some((base_path, vhd_path)) = registry.get(&distribution.name.to_ascii_lowercase()) {
            distribution.base_path = base_path.clone();
            distribution.vhd_path = vhd_path.clone();
            let target = if vhd_path.is_empty() {
                base_path
            } else {
                vhd_path
            };
            let path = PathBuf::from(target);
            distribution.size = path_size_quick(&path);
            distribution.last_write_time = path_modified_text(&path);
        }
    }
}

fn wsl_registry_entries() -> HashMap<String, (String, String)> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss\*' | ForEach-Object {
  $base = "$($_.BasePath)"
  $clean = $base -replace '^\\\\\?\\', ''
  $vhd = ''
  if ($clean) {
    $candidates = @(
      (Join-Path $clean 'ext4.vhdx'),
      (Join-Path $clean 'rootfs.vhdx'),
      (Join-Path $clean 'docker_data.vhdx')
    )
    foreach ($candidate in $candidates) {
      if (Test-Path -LiteralPath $candidate) { $vhd = $candidate; break }
    }
  }
  [pscustomobject]@{
    DistributionName = "$($_.DistributionName)"
    BasePath = $clean
    VhdPath = $vhd
  }
} | ConvertTo-Json -Compress
"#;
    powershell_json_rows(script)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| {
            let name = json_string(&value, "DistributionName");
            if name.is_empty() {
                return None;
            }
            Some((
                name.to_ascii_lowercase(),
                (
                    json_string(&value, "BasePath"),
                    json_string(&value, "VhdPath"),
                ),
            ))
        })
        .collect()
}

fn path_size_quick(path: &std::path::Path) -> u64 {
    if let Ok(metadata) = std::fs::metadata(path) {
        if metadata.is_file() {
            return metadata.len();
        }
    }
    folder_size_limited(path, 20_000)
}

fn folder_size_limited(path: &std::path::Path, limit: usize) -> u64 {
    if !path.is_dir() {
        return 0;
    }
    let mut total = 0u64;
    let mut visited = 0usize;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rows) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in rows.filter_map(Result::ok) {
            visited = visited.saturating_add(1);
            if visited > limit {
                return total;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            } else if metadata.is_dir() {
                stack.push(entry.path());
            }
        }
    }
    total
}

fn path_modified_text(path: &std::path::Path) -> String {
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_default()
}

fn system_printer_manager_snapshot_blocking() -> Result<PrinterManagerSnapshot, String> {
    let generated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let printers = collect_printers()?;
    let jobs = collect_print_jobs()?;
    let scanners = collect_scanners()?;
    let default_printer = printers
        .iter()
        .find(|item| item.default)
        .map(|item| item.name.clone())
        .unwrap_or_default();
    let printer_count = printers.len();
    let scanner_count = scanners.len();
    let job_count = jobs.len();
    let message = format!(
        "已读取 {} 台打印机、{} 个打印任务、{} 台扫描设备",
        printer_count, job_count, scanner_count
    );
    Ok(PrinterManagerSnapshot {
        printers,
        jobs,
        scanners,
        default_printer,
        printer_count,
        scanner_count,
        job_count,
        generated_at,
        message,
    })
}

fn system_printer_action_blocking(
    request: PrinterActionRequest,
) -> Result<PrinterManagerSnapshot, String> {
    let action = request.action.trim();
    match action {
        "open-settings" | "add-printer" => open_ms_settings("printers")?,
        "open-scan" => open_scan_app()?,
        "open-troubleshooter" => open_ms_settings("troubleshoot")?,
        "restart-spooler" => {
            let script = "Restart-Service -Name Spooler -Force";
            run_powershell_script_hidden(script).or_else(|err| {
                if is_elevation_required_error(&err) {
                    run_powershell_script_with_elevation(script)
                        .map_err(|e| format!("重启打印后台服务需要管理员权限：{}。{}", err, e))
                } else {
                    Err(err)
                }
            })?;
        }
        "set-default" | "test-page" | "open-queue" | "open-properties" | "open-preferences"
        | "remove-printer" | "pause-printer" | "resume-printer" | "disable-offline" => {
            let name = request
                .printer_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "请选择打印机".to_string())?;
            validate_printer_name(name)?;
            match action {
                "set-default" => {
                    run_printui(name, "/y")?;
                }
                "test-page" => run_printui(name, "/k")?,
                "open-queue" => run_printui(name, "/o")?,
                "open-properties" => run_printui(name, "/p")?,
                "open-preferences" => run_printui(name, "/e")?,
                "remove-printer" => run_printer_management_script(
                    &format!(
                        "Remove-Printer -Name '{}' -Confirm:$false",
                        escape_powershell_single_quote(name)
                    ),
                    "删除打印机",
                )?,
                "pause-printer" => set_printer_wmi_bool(name, "Paused", true, "暂停打印机")?,
                "resume-printer" => set_printer_wmi_bool(name, "Paused", false, "恢复打印机")?,
                "disable-offline" => {
                    set_printer_wmi_bool(name, "WorkOffline", false, "取消脱机使用打印机")?
                }
                _ => {}
            }
        }
        _ => return Err("未知打印机操作".to_string()),
    }
    system_printer_manager_snapshot_blocking()
}

fn system_print_job_action_blocking(
    request: PrintJobActionRequest,
) -> Result<PrinterManagerSnapshot, String> {
    let printer_name = request.printer_name.trim();
    validate_printer_name(printer_name)?;
    if request.job_id == 0 && matches!(request.action.as_str(), "remove" | "restart") {
        return Err("打印任务 ID 无效".to_string());
    }
    let script = match request.action.as_str() {
        "remove" => format!(
            "Remove-PrintJob -PrinterName '{}' -ID {}",
            escape_powershell_single_quote(printer_name),
            request.job_id
        ),
        "restart" => format!(
            "Restart-PrintJob -PrinterName '{}' -ID {}",
            escape_powershell_single_quote(printer_name),
            request.job_id
        ),
        "clear-printer" => format!(
            "Get-PrintJob -PrinterName '{}' | Remove-PrintJob",
            escape_powershell_single_quote(printer_name)
        ),
        _ => return Err("未知打印任务操作".to_string()),
    };
    run_powershell_script_hidden(&script)?;
    system_printer_manager_snapshot_blocking()
}

fn system_printer_diagnose_blocking(
    printer_name: String,
) -> Result<PrinterDiagnosticResult, String> {
    let printer_name = printer_name.trim().to_string();
    validate_printer_name(&printer_name)?;
    let printers = collect_printers()?;
    let jobs = collect_print_jobs().unwrap_or_default();
    let printer = printers
        .iter()
        .find(|item| item.name.eq_ignore_ascii_case(&printer_name))
        .ok_or_else(|| format!("未找到打印机：{}", printer_name))?;
    let printer_jobs = jobs
        .iter()
        .filter(|job| job.printer_name.eq_ignore_ascii_case(&printer_name))
        .collect::<Vec<_>>();

    let mut checks = Vec::new();
    checks.push(printer_check(
        "spooler",
        "打印后台服务",
        spooler_running(),
        "Print Spooler 正在运行",
        "Print Spooler 未运行，打印任务不会被处理",
    ));
    checks.push(printer_check(
        "windows-status",
        "Windows 设备状态",
        printer_ready_rank(printer) == 0,
        &format!("状态：{}", printer.printer_status_label),
        &format!("状态异常：{}", printer.printer_status_label),
    ));
    checks.push(printer_check(
        "offline",
        "脱机模式",
        !printer.work_offline,
        "未启用脱机使用打印机",
        "当前处于脱机使用打印机模式",
    ));
    checks.push(if printer_jobs.is_empty() {
        PrinterDiagnosticCheck {
            id: "queue".to_string(),
            label: "打印队列".to_string(),
            status: "ok".to_string(),
            detail: "当前队列为空".to_string(),
        }
    } else {
        PrinterDiagnosticCheck {
            id: "queue".to_string(),
            label: "打印队列".to_string(),
            status: "warn".to_string(),
            detail: format!("当前有 {} 个待处理任务", printer_jobs.len()),
        }
    });

    let bad_jobs = printer_jobs
        .iter()
        .filter(|job| {
            let status = job.job_status.to_lowercase();
            status.contains("error")
                || status.contains("blocked")
                || status.contains("paper")
                || status.contains("offline")
                || status.contains("paused")
                || status.contains("错误")
                || status.contains("暂停")
        })
        .count();
    checks.push(printer_check(
        "queue-errors",
        "队列异常任务",
        bad_jobs == 0,
        "未发现明确异常任务",
        &format!("发现 {} 个可能异常的打印任务", bad_jobs),
    ));

    if printer.network || printer.port_name.to_ascii_uppercase().starts_with("IP_") {
        let target = resolve_printer_port_target(&printer.port_name);
        match target {
            Some(target) => {
                let ping_ok = ping_host_quick(&target);
                checks.push(printer_check(
                    "network-ping",
                    "网络连通",
                    ping_ok,
                    &format!("{} 可 ping 通", target),
                    &format!("{} ping 不通，可能离线或禁 ping", target),
                ));
                let port_ok = tcp_port_open(&target, 9100, 900)
                    || tcp_port_open(&target, 515, 900)
                    || tcp_port_open(&target, 631, 900);
                checks.push(printer_check(
                    "network-print-port",
                    "打印端口",
                    port_ok,
                    "常用打印端口可连接",
                    "未连通常用打印端口 9100/515/631，可能被防火墙阻止或使用 WSD 专用通道",
                ));
            }
            None => checks.push(PrinterDiagnosticCheck {
                id: "network-target".to_string(),
                label: "网络目标".to_string(),
                status: "warn".to_string(),
                detail: format!("端口 {} 未解析出可检测的 IP/主机名", printer.port_name),
            }),
        }
    } else {
        checks.push(PrinterDiagnosticCheck {
            id: "network".to_string(),
            label: "连接类型".to_string(),
            status: "ok".to_string(),
            detail: "本地/虚拟打印机，不做网络端口检测".to_string(),
        });
    }

    let failed = checks.iter().filter(|item| item.status == "fail").count();
    let warned = checks.iter().filter(|item| item.status == "warn").count();
    let (overall_status, overall_label) = if failed > 0 {
        ("fail", "存在异常")
    } else if warned > 0 {
        ("warn", "需要关注")
    } else {
        ("ok", "可用")
    };

    Ok(PrinterDiagnosticResult {
        printer_name,
        overall_status: overall_status.to_string(),
        overall_label: overall_label.to_string(),
        checks,
    })
}

fn printer_check(
    id: &str,
    label: &str,
    ok: bool,
    ok_detail: &str,
    fail_detail: &str,
) -> PrinterDiagnosticCheck {
    PrinterDiagnosticCheck {
        id: id.to_string(),
        label: label.to_string(),
        status: if ok { "ok" } else { "fail" }.to_string(),
        detail: if ok { ok_detail } else { fail_detail }.to_string(),
    }
}

fn spooler_running() -> bool {
    let script = "$ErrorActionPreference='SilentlyContinue'; (Get-Service -Name Spooler).Status";
    let mut command = Command::new("powershell");
    let script = with_utf8_powershell_output(script);
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    command_output_hidden(&mut command)
        .map(|value| value.trim().eq_ignore_ascii_case("Running"))
        .unwrap_or(false)
}

fn resolve_printer_port_target(port_name: &str) -> Option<String> {
    let trimmed = port_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(value) = trimmed.strip_prefix("IP_") {
        return Some(value.trim().trim_end_matches(':').to_string())
            .filter(|value| !value.is_empty());
    }
    if trimmed.parse::<std::net::IpAddr>().is_ok() {
        return Some(trimmed.to_string());
    }
    if trimmed.to_ascii_uppercase().starts_with("WSD-") {
        return None;
    }
    if trimmed.contains('.') && !trimmed.contains(' ') && !trimmed.ends_with(':') {
        return Some(trimmed.to_string());
    }
    None
}

fn ping_host_quick(target: &str) -> bool {
    let mut command = Command::new("ping");
    command.args(["-n", "1", "-w", "900", target]);
    run_hidden(&mut command).is_ok()
}

fn tcp_port_open(target: &str, port: u16, timeout_ms: u64) -> bool {
    let address = format!("{}:{}", target, port);
    let Ok(mut addrs) = address.to_socket_addrs() else {
        return false;
    };
    let Some(addr) = addrs.next() else {
        return false;
    };
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms)).is_ok()
}
fn collect_printers() -> Result<Vec<PrinterEntry>, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
$defaultPrinters = @{}
$wmiByName = @{}
@(Get-CimInstance Win32_Printer) | ForEach-Object {
  if ($_.Name) {
    $defaultPrinters[$_.Name] = [bool]$_.Default
    $wmiByName[$_.Name] = $_
  }
}
$configs = @{}
try {
  @(Get-PrintConfiguration) | ForEach-Object {
    if ($_.PrinterName) { $configs[$_.PrinterName] = $_ }
  }
} catch {}
$jobCounts = @{}
try {
  @(Get-Printer) | ForEach-Object {
    $count = 0
    try { $count = @($_ | Get-PrintJob).Count } catch {}
    $jobCounts[$_.Name] = $count
    $config = $configs[$_.Name]
    $wmi = $wmiByName[$_.Name]
    $rows += [pscustomobject]@{
      Name = $_.Name
      DriverName = $_.DriverName
      PortName = $_.PortName
      Shared = [bool]$_.Shared
      ShareName = $_.ShareName
      Published = [bool]$_.Published
      DeviceType = "$($_.DeviceType)"
      PrinterStatus = if ($_.PrinterStatus -ne $null) { "$($_.PrinterStatus)" } elseif ($wmi) { "$($wmi.PrinterStatus)" } else { "" }
      WorkOffline = if ($_.WorkOffline -ne $null) { [bool]$_.WorkOffline } elseif ($wmi) { [bool]$wmi.WorkOffline } else { $false }
      Default = if ($_.Default -ne $null) { [bool]$_.Default } elseif ($defaultPrinters.ContainsKey($_.Name)) { [bool]$defaultPrinters[$_.Name] } else { $false }
      Network = [bool]$_.Network
      Local = [bool]$_.Local
      Location = if ($_.Location) { $_.Location } elseif ($wmi) { $wmi.Location } else { "" }
      Comment = if ($_.Comment) { $_.Comment } elseif ($wmi) { $wmi.Comment } else { "" }
      ColorSupported = if ($config) { [bool]$config.Color } else { $false }
      DuplexingMode = if ($config) { "$($config.DuplexingMode)" } else { "" }
      PaperSize = if ($config) { "$($config.PaperSize)" } else { "" }
      PrintQuality = if ($config) { "$($config.PrintQuality)" } else { "" }
      JobsCount = if ($jobCounts.ContainsKey($_.Name)) { [int]$jobCounts[$_.Name] } else { 0 }
      Paused = if ($wmi) { [bool]$wmi.Paused } else { $false }
      KeepPrintedJobs = if ($wmi) { [bool]$wmi.KeepPrintedJobs } else { $false }
    }
  }
} catch {}
if ($rows.Count -eq 0) {
  $wmiByName.GetEnumerator() | ForEach-Object {
    $printer = $_.Value
    $rows += [pscustomobject]@{
      Name = $printer.Name
      DriverName = $printer.DriverName
      PortName = $printer.PortName
      Shared = [bool]$printer.Shared
      ShareName = $printer.ShareName
      Published = $false
      DeviceType = if ($printer.Network) { "Network" } else { "Local" }
      PrinterStatus = "$($printer.PrinterStatus)"
      WorkOffline = [bool]$printer.WorkOffline
      Default = [bool]$printer.Default
      Network = [bool]$printer.Network
      Local = -not [bool]$printer.Network
      Location = $printer.Location
      Comment = $printer.Comment
      ColorSupported = [bool]$printer.Capabilities.Contains(2)
      DuplexingMode = ""
      PaperSize = ""
      PrintQuality = ""
      JobsCount = 0
      Paused = [bool]$printer.Paused
      KeepPrintedJobs = [bool]$printer.KeepPrintedJobs
    }
  }
}
$rows | Sort-Object Name -Unique | ConvertTo-Json -Compress
"#;
    let mut rows = powershell_json_rows(script)?
        .into_iter()
        .map(|value| {
            let status = json_string(&value, "PrinterStatus");
            PrinterEntry {
                name: json_string(&value, "Name"),
                driver_name: json_string(&value, "DriverName"),
                port_name: json_string(&value, "PortName"),
                shared: json_bool(&value, "Shared"),
                share_name: json_string(&value, "ShareName"),
                published: json_bool(&value, "Published"),
                device_type: json_string(&value, "DeviceType"),
                printer_status_label: printer_status_label(&status).to_string(),
                printer_status: status,
                work_offline: json_bool(&value, "WorkOffline"),
                default: json_bool(&value, "Default"),
                network: json_bool(&value, "Network"),
                local: json_bool(&value, "Local"),
                location: json_string(&value, "Location"),
                comment: json_string(&value, "Comment"),
                color_supported: json_bool(&value, "ColorSupported"),
                duplexing_mode: json_string(&value, "DuplexingMode"),
                paper_size: json_string(&value, "PaperSize"),
                print_quality: json_string(&value, "PrintQuality"),
                jobs_count: json_u64(&value, "JobsCount").unwrap_or(0),
                paused: json_bool(&value, "Paused"),
                keep_printed_jobs: json_bool(&value, "KeepPrintedJobs"),
            }
        })
        .filter(|item| !item.name.is_empty())
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        b.default
            .cmp(&a.default)
            .then_with(|| printer_ready_rank(a).cmp(&printer_ready_rank(b)))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(rows)
}
fn collect_print_jobs() -> Result<Vec<PrinterJobEntry>, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-Printer | ForEach-Object {
  $printerName = $_.Name
  $_ | Get-PrintJob | ForEach-Object {
    [pscustomobject]@{
      PrinterName = $printerName
      ID = $_.ID
      DocumentName = $_.DocumentName
      UserName = $_.UserName
      JobStatus = "$($_.JobStatus)"
      SubmittedTime = "$($_.SubmittedTime)"
      Size = $_.Size
      TotalPages = $_.TotalPages
    }
  }
} | ConvertTo-Json -Compress
"#;
    let mut rows = powershell_json_rows(script)?
        .into_iter()
        .map(|value| PrinterJobEntry {
            printer_name: json_string(&value, "PrinterName"),
            id: json_u64(&value, "ID").unwrap_or(0),
            document_name: json_string(&value, "DocumentName"),
            user_name: json_string(&value, "UserName"),
            job_status: json_string(&value, "JobStatus"),
            submitted_time: json_string(&value, "SubmittedTime"),
            size: json_u64(&value, "Size").unwrap_or(0),
            total_pages: json_u64(&value, "TotalPages").unwrap_or(0),
        })
        .filter(|item| !item.printer_name.is_empty() && item.id > 0)
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        a.printer_name
            .to_lowercase()
            .cmp(&b.printer_name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(rows)
}

fn collect_scanners() -> Result<Vec<ScannerEntry>, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
$rows += @(Get-CimInstance Win32_PnPEntity | Where-Object {
  $_.Name -and (
    $_.PNPClass -in @('Image','Camera') -or
    $_.Name -match 'scan|scanner|wia|twain|扫描|掃描'
  )
} | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    DeviceId = $_.DeviceID
    Manufacturer = $_.Manufacturer
    Service = $_.Service
    Status = $_.Status
    PnpClass = $_.PNPClass
  }
})
$rows | Sort-Object Name -Unique | ConvertTo-Json -Compress
"#;
    let rows = powershell_json_rows(script)?
        .into_iter()
        .map(|value| ScannerEntry {
            name: json_string(&value, "Name"),
            device_id: json_string(&value, "DeviceId"),
            manufacturer: json_string(&value, "Manufacturer"),
            service: json_string(&value, "Service"),
            status: json_string(&value, "Status"),
            pnp_class: json_string(&value, "PnpClass"),
        })
        .filter(|item| !item.name.is_empty())
        .collect::<Vec<_>>();
    Ok(rows)
}

fn printer_status_label(value: &str) -> &'static str {
    match value.to_lowercase().as_str() {
        "0" | "3" | "normal" | "idle" => "正常",
        "7" | "offline" => "离线",
        "6" | "error" | "stopped printing" => "错误",
        "4" | "printing" => "打印中",
        "5" | "warmingup" | "warming up" => "预热中",
        "paused" => "已暂停",
        "pendingdeletion" | "pending deletion" => "等待删除",
        "paperjam" | "paper jam" => "卡纸",
        "paperout" | "paper out" => "缺纸",
        "manualfeed" | "manual feed" => "手动进纸",
        "tonerlow" | "toner low" => "墨粉不足",
        "notavailable" | "not available" => "不可用",
        "busy" => "忙碌",
        _ => "未知",
    }
}

fn printer_ready_rank(item: &PrinterEntry) -> u8 {
    let status = item.printer_status.to_lowercase();
    if item.work_offline || matches!(status.as_str(), "7" | "offline") {
        2
    } else if matches!(status.as_str(), "0" | "3" | "normal" | "idle") {
        0
    } else {
        1
    }
}

fn validate_printer_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("请选择打印机".to_string());
    }
    if name.contains(['\r', '\n']) {
        return Err("打印机名称无效".to_string());
    }
    Ok(())
}

fn open_ms_settings(page: &str) -> Result<(), String> {
    let mut command = Command::new("cmd");
    command.args(["/C", "start", "", &format!("ms-settings:{}", page)]);
    run_hidden(&mut command)
}

fn open_scan_app() -> Result<(), String> {
    let mut command = Command::new("cmd");
    command.args(["/C", "start", "", "wiaacmgr"]);
    match run_hidden(&mut command) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            let mut fallback = Command::new("cmd");
            fallback.args(["/C", "start", "", "ms-settings:printers"]);
            run_hidden(&mut fallback).map_err(|second_error| {
                format!(
                    "打开 Windows 扫描入口失败：{}；打开系统打印机设置也失败：{}",
                    first_error, second_error
                )
            })
        }
    }
}

fn run_printui(printer_name: &str, action: &str) -> Result<(), String> {
    let mut command = Command::new("rundll32.exe");
    command.args(["printui.dll,PrintUIEntry", action, "/n", printer_name]);
    run_hidden(&mut command)
}

fn run_printer_management_script(script: &str, label: &str) -> Result<(), String> {
    run_powershell_script_hidden(script).or_else(|err| {
        if is_elevation_required_error(&err) {
            run_powershell_script_with_elevation(script)
                .map_err(|e| format!("{}需要管理员权限：{}。{}", label, err, e))
        } else {
            Err(err)
        }
    })
}

fn set_printer_wmi_bool(
    printer_name: &str,
    property: &str,
    value: bool,
    label: &str,
) -> Result<(), String> {
    let script = format!(
        "$printer = Get-CimInstance Win32_Printer -Filter \"Name='{}'\"; if (-not $printer) {{ throw '未找到打印机' }}; Set-CimInstance -InputObject $printer -Property @{{ {} = ${} }} | Out-Null",
        escape_wmi_filter_single_quote(printer_name),
        property,
        if value { "true" } else { "false" }
    );
    run_printer_management_script(&script, label)
}

fn system_windows_update_action_blocking(action: String) -> Result<WindowsUpdateStatus, String> {
    let script = match action.as_str() {
        "open" => {
            let mut command = Command::new("cmd");
            command.args(["/C", "start", "ms-settings:windowsupdate"]);
            run_hidden(&mut command)?;
            return system_windows_update_status_blocking();
        }
        "restart-services" => {
            "Restart-Service -Name wuauserv,bits,cryptsvc,msiserver -Force -ErrorAction SilentlyContinue"
        }
        "stop-services" => {
            "Stop-Service -Name wuauserv,bits,cryptsvc,msiserver -Force -ErrorAction SilentlyContinue"
        }
        "start-services" => {
            "Start-Service -Name wuauserv,bits,cryptsvc,msiserver -ErrorAction SilentlyContinue"
        }
        "clean-cache" => {
            r#"
Stop-Service -Name wuauserv,bits -Force -ErrorAction SilentlyContinue
$download = Join-Path $env:windir 'SoftwareDistribution\Download'
Get-ChildItem -LiteralPath $download -Force -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
}
Start-Service -Name bits -ErrorAction SilentlyContinue
Start-Service -Name wuauserv -ErrorAction SilentlyContinue
"#
        }
        "pause-7" => {
            r#"
$deadline = (Get-Date).AddDays(7).ToString('yyyy-MM-ddTHH:mm:ssZ')
New-Item -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -Name PauseUpdatesStartTime -Value (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssZ')
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -Name PauseUpdatesExpiryTime -Value $deadline
"#
        }
        "resume" => {
            r#"
Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -Name PauseUpdatesStartTime -ErrorAction SilentlyContinue
Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -Name PauseUpdatesExpiryTime -ErrorAction SilentlyContinue
Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' -Name NoAutoUpdate -ErrorAction SilentlyContinue
Set-Service -Name wuauserv -StartupType Manual -ErrorAction SilentlyContinue
Start-Service -Name wuauserv -ErrorAction SilentlyContinue
"#
        }
        "disable-updates" => {
            r#"
New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' -Name NoAutoUpdate -Type DWord -Value 1
Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue
Set-Service -Name wuauserv -StartupType Disabled -ErrorAction SilentlyContinue
"#
        }
        "reset-components" => {
            r#"
Stop-Service -Name wuauserv,bits,cryptsvc,msiserver -Force -ErrorAction SilentlyContinue
$sd = Join-Path $env:windir 'SoftwareDistribution'
$cat = Join-Path $env:windir 'System32\catroot2'
if (Test-Path $sd) { Rename-Item -LiteralPath $sd -NewName ('SoftwareDistribution.bak.' + (Get-Date -Format yyyyMMddHHmmss)) -ErrorAction SilentlyContinue }
if (Test-Path $cat) { Rename-Item -LiteralPath $cat -NewName ('catroot2.bak.' + (Get-Date -Format yyyyMMddHHmmss)) -ErrorAction SilentlyContinue }
Start-Service -Name cryptsvc,bits,wuauserv -ErrorAction SilentlyContinue
"#
        }
        _ => return Err("Windows 更新操作无效".to_string()),
    };
    if let Err(err) = run_powershell_script_hidden(script) {
        if is_elevation_required_error(&err) {
            run_powershell_script_with_elevation(script)
                .map_err(|e| format!("Windows 更新操作需要管理员权限：{}。{}", err, e))?;
        } else {
            return Err(err);
        }
    }
    system_windows_update_status_blocking()
}

fn hosts_path() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("drivers")
        .join("etc")
        .join("hosts")
}

fn windows_update_cache_size() -> u64 {
    let root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("SoftwareDistribution")
        .join("Download");
    path_size_and_count(&root).0
}

fn validate_time_text(value: &str) -> Result<String, String> {
    let parts = value.trim().split(':').collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err("时间格式应为 HH:mm".to_string());
    }
    let hour = parts[0]
        .parse::<u32>()
        .map_err(|_| "小时无效".to_string())?;
    let minute = parts[1]
        .parse::<u32>()
        .map_err(|_| "分钟无效".to_string())?;
    if hour > 23 || minute > 59 {
        return Err("时间范围应为 00:00 到 23:59".to_string());
    }
    Ok(format!("{:02}:{:02}", hour, minute))
}

fn valid_weekday(value: &str) -> bool {
    matches!(
        value,
        "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday"
    )
}

fn is_valid_hosts_domain(value: &str) -> bool {
    let value = value.trim().trim_end_matches('.');
    if value.is_empty() || value.len() > 253 || value.contains(' ') {
        return false;
    }
    value.split('.').all(|part| {
        !part.is_empty()
            && part.len() <= 63
            && part
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    })
}

fn hosts_ip_for_domain(content: &str, domain: &str) -> Option<String> {
    let target = domain.trim().trim_end_matches('.').to_lowercase();
    for line in content.lines() {
        let body = line.split('#').next().unwrap_or_default().trim();
        if body.is_empty() {
            continue;
        }
        let parts = body.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 2 {
            continue;
        }
        if parts[1..]
            .iter()
            .any(|item| item.trim_end_matches('.').eq_ignore_ascii_case(&target))
        {
            return Some(parts[0].to_string());
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn query_file_locks(path: &std::path::Path) -> Result<Vec<FileLockProcess>, String> {
    use std::mem;
    use std::ptr;
    use winapi::shared::minwindef::{DWORD, UINT};
    use winapi::shared::winerror::{ERROR_MORE_DATA, ERROR_SUCCESS};
    use winapi::um::restartmanager::{
        RmEndSession, RmGetList, RmRegisterResources, RmStartSession, CCH_RM_SESSION_KEY,
        RM_PROCESS_INFO,
    };

    let mut session: DWORD = 0;
    let mut session_key = vec![0u16; CCH_RM_SESSION_KEY + 1];
    let start_code = unsafe { RmStartSession(&mut session, 0, session_key.as_mut_ptr()) };
    if start_code != ERROR_SUCCESS {
        return Err(format!("启动 Restart Manager 失败: {}", start_code));
    }

    let query_result = (|| {
        let mut wide_path = os_str_to_wide(path.as_os_str());
        let mut file_names = vec![wide_path.as_mut_ptr() as *const u16];
        let register_code = unsafe {
            RmRegisterResources(
                session,
                1,
                file_names.as_mut_ptr(),
                0,
                ptr::null_mut(),
                0,
                ptr::null_mut(),
            )
        };
        if register_code != ERROR_SUCCESS {
            return Err(format!("注册检查资源失败: {}", register_code));
        }

        let mut needed: UINT = 0;
        let mut count: UINT = 0;
        let mut reboot_reasons: DWORD = 0;
        let first_code = unsafe {
            RmGetList(
                session,
                &mut needed,
                &mut count,
                ptr::null_mut(),
                &mut reboot_reasons,
            )
        };
        if first_code == ERROR_SUCCESS {
            return Ok(Vec::new());
        }
        if first_code != ERROR_MORE_DATA {
            return Err(format!("查询占用进程失败: {}", first_code));
        }

        count = needed;
        let mut process_info = vec![unsafe { mem::zeroed::<RM_PROCESS_INFO>() }; count as usize];
        let second_code = unsafe {
            RmGetList(
                session,
                &mut needed,
                &mut count,
                process_info.as_mut_ptr(),
                &mut reboot_reasons,
            )
        };
        if second_code != ERROR_SUCCESS {
            return Err(format!("读取占用进程失败: {}", second_code));
        }

        process_info.truncate(count as usize);
        Ok(process_info
            .into_iter()
            .map(|item| {
                let app_name = wide_slice_to_string(&item.strAppName);
                let service_short_name = wide_slice_to_string(&item.strServiceShortName);
                FileLockProcess {
                    pid: item.Process.dwProcessId,
                    name: if app_name.is_empty() {
                        format!("PID {}", item.Process.dwProcessId)
                    } else {
                        app_name.clone()
                    },
                    app_name,
                    service_short_name,
                    status: restart_manager_status(item.AppStatus),
                    restartable: item.bRestartable != 0,
                }
            })
            .collect::<Vec<_>>())
    })();

    unsafe {
        RmEndSession(session);
    }
    query_result
}

#[cfg(not(target_os = "windows"))]
fn query_file_locks(_path: &std::path::Path) -> Result<Vec<FileLockProcess>, String> {
    Err("解除占用目前仅支持 Windows".to_string())
}

#[cfg(target_os = "windows")]
fn os_str_to_wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().chain(std::iter::once(0)).collect()
}

fn wide_slice_to_string(value: &[u16]) -> String {
    let end = value
        .iter()
        .position(|item| *item == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end]).trim().to_string()
}

fn restart_manager_status(status: u32) -> String {
    let mut labels = Vec::new();
    if status & 0x1 != 0 {
        labels.push("运行中");
    }
    if status & 0x2 != 0 {
        labels.push("已停止");
    }
    if status & 0x10 != 0 {
        labels.push("停止失败");
    }
    if status & 0x20 != 0 {
        labels.push("重启失败");
    }
    if labels.is_empty() {
        "未知".to_string()
    } else {
        labels.join(" / ")
    }
}

fn clear_readonly_recursive(path: &std::path::Path) {
    if let Ok(metadata) = std::fs::metadata(path) {
        let mut permissions = metadata.permissions();
        if permissions.readonly() {
            permissions.set_readonly(false);
            let _ = std::fs::set_permissions(path, permissions);
        }
        if metadata.is_dir() {
            if let Ok(rows) = std::fs::read_dir(path) {
                for entry in rows.filter_map(Result::ok) {
                    clear_readonly_recursive(&entry.path());
                }
            }
        }
    }
}

fn cleanup_targets() -> Vec<CleanupTarget> {
    let mut targets = Vec::new();
    if let Some(temp) = std::env::var_os("TEMP").or_else(|| std::env::var_os("TMP")) {
        targets.push(CleanupTarget {
            id: "user-temp".to_string(),
            name: "用户临时文件".to_string(),
            description: "当前用户 Temp 目录中的临时文件".to_string(),
            path: PathBuf::from(temp),
            category: "temp".to_string(),
            category_label: "临时文件".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: true,
            safe: true,
        });
    }
    if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
        let local_appdata = PathBuf::from(local_appdata);
        targets.push(CleanupTarget {
            id: "local-temp".to_string(),
            name: "LocalAppData 临时文件".to_string(),
            description: "应用写入 LocalAppData\\Temp 的临时缓存".to_string(),
            path: local_appdata.join("Temp"),
            category: "temp".to_string(),
            category_label: "临时文件".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: true,
            safe: true,
        });
        targets.push(CleanupTarget {
            id: "inet-cache".to_string(),
            name: "浏览器与系统网页缓存".to_string(),
            description: "Windows INetCache 缓存目录".to_string(),
            path: local_appdata
                .join("Microsoft")
                .join("Windows")
                .join("INetCache"),
            category: "browser".to_string(),
            category_label: "浏览器缓存".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: true,
            safe: true,
        });
        targets.push(CleanupTarget {
            id: "chrome-cache".to_string(),
            name: "Chrome 浏览器缓存".to_string(),
            description: "Google Chrome 默认用户的 Cache / Code Cache 缓存".to_string(),
            path: local_appdata
                .join("Google")
                .join("Chrome")
                .join("User Data")
                .join("Default")
                .join("Cache"),
            category: "browser".to_string(),
            category_label: "浏览器缓存".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: false,
            safe: true,
        });
        targets.push(CleanupTarget {
            id: "chrome-code-cache".to_string(),
            name: "Chrome 脚本缓存".to_string(),
            description: "Google Chrome 默认用户 Code Cache 缓存".to_string(),
            path: local_appdata
                .join("Google")
                .join("Chrome")
                .join("User Data")
                .join("Default")
                .join("Code Cache"),
            category: "browser".to_string(),
            category_label: "浏览器缓存".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: false,
            safe: true,
        });
        targets.push(CleanupTarget {
            id: "edge-cache".to_string(),
            name: "Edge 浏览器缓存".to_string(),
            description: "Microsoft Edge 默认用户的 Cache / Code Cache 缓存".to_string(),
            path: local_appdata
                .join("Microsoft")
                .join("Edge")
                .join("User Data")
                .join("Default")
                .join("Cache"),
            category: "browser".to_string(),
            category_label: "浏览器缓存".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: false,
            safe: true,
        });
        targets.push(CleanupTarget {
            id: "edge-code-cache".to_string(),
            name: "Edge 脚本缓存".to_string(),
            description: "Microsoft Edge 默认用户 Code Cache 缓存".to_string(),
            path: local_appdata
                .join("Microsoft")
                .join("Edge")
                .join("User Data")
                .join("Default")
                .join("Code Cache"),
            category: "browser".to_string(),
            category_label: "浏览器缓存".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: false,
            safe: true,
        });
        targets.push(CleanupTarget {
            id: "firefox-cache".to_string(),
            name: "Firefox 浏览器缓存".to_string(),
            description: "Firefox 用户配置目录下的本地缓存".to_string(),
            path: local_appdata
                .join("Mozilla")
                .join("Firefox")
                .join("Profiles"),
            category: "browser".to_string(),
            category_label: "浏览器缓存".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: false,
            safe: true,
        });
        targets.push(CleanupTarget {
            id: "crash-dumps".to_string(),
            name: "崩溃转储文件".to_string(),
            description: "应用崩溃后留下的 .dmp 文件".to_string(),
            path: local_appdata.join("CrashDumps"),
            category: "logs".to_string(),
            category_label: "日志和转储".to_string(),
            risk: "caution".to_string(),
            risk_label: "谨慎".to_string(),
            selected_by_default: false,
            safe: true,
        });
        let one_drive_logs = local_appdata
            .join("Microsoft")
            .join("OneDrive")
            .join("logs");
        for account_dir in ["Business1", "Business2", "Business3", "Personal"] {
            targets.push(CleanupTarget {
                id: format!("onedrive-{}-logs", account_dir.to_ascii_lowercase()),
                name: match account_dir {
                    "Personal" => "OneDrive 个人账号同步日志".to_string(),
                    _ => format!("OneDrive {} 企业账号同步日志", account_dir),
                },
                description:
                    "OneDrive 同步引擎日志，仅清理旧 ODL/压缩日志，保留 telemetry 缓存数据库"
                        .to_string(),
                path: one_drive_logs.join(account_dir),
                category: "logs".to_string(),
                category_label: "日志和转储".to_string(),
                risk: "safe".to_string(),
                risk_label: "安全".to_string(),
                selected_by_default: false,
                safe: true,
            });
        }
        targets.push(CleanupTarget {
            id: "thumbnail-cache".to_string(),
            name: "缩略图缓存".to_string(),
            description: "Explorer 图片/视频缩略图数据库缓存".to_string(),
            path: local_appdata
                .join("Microsoft")
                .join("Windows")
                .join("Explorer"),
            category: "system-cache".to_string(),
            category_label: "系统缓存".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: false,
            safe: true,
        });
        targets.push(CleanupTarget {
            id: "directx-shader-cache".to_string(),
            name: "DirectX Shader Cache".to_string(),
            description: "显卡/游戏生成的着色器缓存，会自动重建".to_string(),
            path: local_appdata.join("D3DSCache"),
            category: "system-cache".to_string(),
            category_label: "系统缓存".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: false,
            safe: true,
        });
    }
    if let Some(system_root) = std::env::var_os("SystemRoot") {
        let system_root = PathBuf::from(system_root);
        targets.push(CleanupTarget {
            id: "windows-temp".to_string(),
            name: "Windows 临时文件".to_string(),
            description: "系统 Temp 目录，部分文件可能需要管理员权限".to_string(),
            path: system_root.join("Temp"),
            category: "temp".to_string(),
            category_label: "临时文件".to_string(),
            risk: "caution".to_string(),
            risk_label: "谨慎".to_string(),
            selected_by_default: false,
            safe: true,
        });
        targets.push(CleanupTarget {
            id: "windows-update-download".to_string(),
            name: "Windows 更新下载缓存".to_string(),
            description: "SoftwareDistribution\\Download 中的更新下载缓存".to_string(),
            path: system_root.join("SoftwareDistribution").join("Download"),
            category: "system-cache".to_string(),
            category_label: "系统缓存".to_string(),
            risk: "caution".to_string(),
            risk_label: "谨慎".to_string(),
            selected_by_default: false,
            safe: true,
        });
    }
    if let Some(program_data) = std::env::var_os("ProgramData") {
        targets.push(CleanupTarget {
            id: "windows-error-reporting".to_string(),
            name: "Windows 错误报告".to_string(),
            description: "系统错误报告队列和归档文件".to_string(),
            path: PathBuf::from(program_data)
                .join("Microsoft")
                .join("Windows")
                .join("WER"),
            category: "logs".to_string(),
            category_label: "日志和转储".to_string(),
            risk: "safe".to_string(),
            risk_label: "安全".to_string(),
            selected_by_default: false,
            safe: true,
        });
    }
    dedupe_cleanup_targets(targets)
}

fn dedupe_cleanup_targets(targets: Vec<CleanupTarget>) -> Vec<CleanupTarget> {
    let mut seen = HashSet::new();
    let mut rows = Vec::new();

    for target in targets {
        let key = cleanup_target_path_key(&target.path);
        if seen.insert(key) {
            rows.push(target);
        } else {
            eprintln!(
                "[cleanup] Skipped duplicate cleanup target: {} ({})",
                target.id,
                target.path.display()
            );
        }
    }

    rows
}

fn cleanup_target_path_key(path: &std::path::Path) -> String {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    normalize_scan_path(&resolved).to_lowercase()
}

fn cleanup_target_file_policy(target: &CleanupTarget) -> CleanupFilePolicy {
    if target.id.starts_with("onedrive-") && target.id.ends_with("-logs") {
        CleanupFilePolicy::OneDriveBusinessLogs
    } else {
        CleanupFilePolicy::All
    }
}

fn path_size_and_count(path: &std::path::Path) -> (u64, u64) {
    if path.is_file() {
        return std::fs::metadata(path)
            .map(|metadata| (metadata.len(), 1))
            .unwrap_or((0, 0));
    }

    let mut size = 0u64;
    let mut count = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rows) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in rows.filter_map(Result::ok) {
            let entry_path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                stack.push(entry_path);
            } else if metadata.is_file() {
                size = size.saturating_add(metadata.len());
                count = count.saturating_add(1);
            }
        }
    }
    (size, count)
}

fn cleanup_path_size_and_count(
    path: &std::path::Path,
    min_age_days: Option<u64>,
    excludes: &[String],
    generation: Option<u64>,
    policy: CleanupFilePolicy,
) -> (u64, u64) {
    if is_excluded_scan_path(path, excludes) {
        return (0, 0);
    }
    if path.is_file() {
        return std::fs::metadata(path)
            .ok()
            .filter(|metadata| cleanup_file_is_candidate(policy, path, metadata, min_age_days))
            .map(|metadata| (metadata.len(), 1))
            .unwrap_or((0, 0));
    }

    let mut size = 0u64;
    let mut count = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if let Some(generation) = generation {
            if ensure_cleanup_active(generation).is_err() {
                break;
            }
        }
        if is_excluded_scan_path(&dir, excludes) {
            continue;
        }
        let Ok(rows) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in rows.filter_map(Result::ok) {
            let entry_path = entry.path();
            if is_excluded_scan_path(&entry_path, excludes) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                stack.push(entry_path);
            } else if metadata.is_file()
                && cleanup_file_is_candidate(policy, &entry_path, &metadata, min_age_days)
            {
                size = size.saturating_add(metadata.len());
                count = count.saturating_add(1);
            }
        }
    }
    (size, count)
}

fn cleanup_preview_files(
    path: &std::path::Path,
    limit: usize,
    min_age_days: Option<u64>,
    policy: CleanupFilePolicy,
) -> Vec<CleanupPreviewItem> {
    let mut files = Vec::new();
    if path.is_file() {
        if let Ok(metadata) = std::fs::metadata(path) {
            if !cleanup_file_is_candidate(policy, path, &metadata, min_age_days) {
                return files;
            }
            files.push(CleanupPreviewItem {
                path: path.to_string_lossy().to_string(),
                name: path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string(),
                size: metadata.len(),
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis() as u64),
            });
        }
        return files;
    }

    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if files.len() >= limit {
            break;
        }
        let Ok(rows) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in rows.filter_map(Result::ok) {
            if files.len() >= limit {
                break;
            }
            let entry_path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                stack.push(entry_path);
            } else if metadata.is_file()
                && cleanup_file_is_candidate(policy, &entry_path, &metadata, min_age_days)
            {
                files.push(CleanupPreviewItem {
                    path: entry_path.to_string_lossy().to_string(),
                    name: entry_path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                        .to_string(),
                    size: metadata.len(),
                    modified: metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                        .map(|duration| duration.as_millis() as u64),
                });
            }
        }
    }
    files.sort_by(|a, b| b.size.cmp(&a.size));
    files
}

fn cleanup_file_matches_age(metadata: &std::fs::Metadata, min_age_days: Option<u64>) -> bool {
    let Some(days) = min_age_days.filter(|days| *days > 0) else {
        return true;
    };
    let Some(modified) = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
    else {
        return false;
    };
    let now_ms = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    now_ms.saturating_sub(modified) >= days.saturating_mul(86_400_000)
}

fn cleanup_file_is_candidate(
    policy: CleanupFilePolicy,
    path: &std::path::Path,
    metadata: &std::fs::Metadata,
    min_age_days: Option<u64>,
) -> bool {
    if !cleanup_file_matches_age(metadata, min_age_days) {
        return false;
    }
    match policy {
        CleanupFilePolicy::All => true,
        CleanupFilePolicy::OneDriveBusinessLogs => {
            one_drive_log_file_allowed(path)
                && cleanup_file_older_than(metadata, ONEDRIVE_LOG_MIN_AGE_MS)
        }
    }
}

fn one_drive_log_file_allowed(path: &std::path::Path) -> bool {
    let Some(extension) = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
    else {
        return false;
    };

    matches!(
        extension.as_str(),
        "odl" | "aodl" | "loggz" | "odlgz" | "etlgz"
    )
}

fn cleanup_file_older_than(metadata: &std::fs::Metadata, min_age_ms: u64) -> bool {
    let Some(modified) = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
    else {
        return false;
    };
    let now_ms = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    now_ms.saturating_sub(modified) >= min_age_ms
}

fn ensure_cleanup_active(generation: u64) -> Result<(), String> {
    if CLEANUP_GENERATION.load(Ordering::SeqCst) == generation {
        Ok(())
    } else {
        Err("清理任务已取消".to_string())
    }
}

fn clean_directory_contents(
    path: &std::path::Path,
    excludes: &[String],
    min_age_days: Option<u64>,
    generation: u64,
    policy: CleanupFilePolicy,
) -> Result<(), String> {
    ensure_cleanup_active(generation)?;
    if !path.exists() {
        return Ok(());
    }
    if is_excluded_scan_path(path, excludes) {
        return Ok(());
    }
    if path.is_file() {
        let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
        if !cleanup_file_is_candidate(policy, path, &metadata, min_age_days) {
            return Ok(());
        }
        clear_readonly_recursive(path);
        return std::fs::remove_file(path).map_err(|e| e.to_string());
    }

    let rows = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut failures = Vec::new();
    for entry in rows.filter_map(Result::ok) {
        ensure_cleanup_active(generation)?;
        let child = entry.path();
        if is_excluded_scan_path(&child, excludes) {
            continue;
        }
        let result = if child.is_dir() && !child.is_symlink() {
            if policy == CleanupFilePolicy::All {
                clear_readonly_recursive(&child);
            }
            clean_directory_contents(&child, excludes, min_age_days, generation, policy).and_then(
                |_| {
                    if policy != CleanupFilePolicy::All {
                        return Ok(());
                    }
                    std::fs::remove_dir(&child)
                        .or_else(|err| {
                            if err.kind() == std::io::ErrorKind::DirectoryNotEmpty {
                                Ok(())
                            } else {
                                Err(err)
                            }
                        })
                        .map_err(|e| e.to_string())
                },
            )
        } else {
            match std::fs::metadata(&child) {
                Ok(metadata)
                    if metadata.is_file()
                        && cleanup_file_is_candidate(policy, &child, &metadata, min_age_days) =>
                {
                    clear_readonly_recursive(&child);
                    std::fs::remove_file(&child).map_err(|e| e.to_string())
                }
                _ => Ok(()),
            }
        };
        if let Err(err) = result {
            failures.push(format!("{} ({})", child.to_string_lossy(), err));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn validate_force_delete_target(path: &std::path::Path) -> Result<(), String> {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let normalized = canonical.to_string_lossy().replace('/', "\\");
    let trimmed = normalized.trim_end_matches('\\');

    if trimmed.len() == 2 && trimmed.as_bytes().get(1) == Some(&b':') {
        return Err("为了避免误删整个磁盘，禁止直接强制删除磁盘根目录".to_string());
    }

    if let Some(system_root) = std::env::var_os("SystemRoot") {
        let system_root = PathBuf::from(system_root);
        if paths_equal(&canonical, &system_root) {
            return Err("为了避免破坏系统，禁止强制删除 Windows 系统目录".to_string());
        }
    }

    if let Some(user_profile) = std::env::var_os("USERPROFILE") {
        let user_profile = PathBuf::from(user_profile);
        if paths_equal(&canonical, &user_profile) {
            return Err("为了避免误删个人主目录，禁止直接强制删除用户根目录".to_string());
        }
    }

    Ok(())
}

fn paths_equal(left: &std::path::Path, right: &std::path::Path) -> bool {
    let left = std::fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = std::fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

fn delete_path_direct(path: &std::path::Path) -> Result<(), String> {
    clear_readonly_recursive(path);
    let result = if path.is_dir() && !path.is_symlink() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    result.map_err(|e| e.to_string())
}

#[derive(Debug)]
struct LeftoverValidation {
    app_name: String,
    app_kind: String,
    publisher: String,
    registry_path: String,
    install_location: Option<PathBuf>,
    uninstalled: bool,
}

fn build_leftover_validation(request: &InstalledAppLeftoverRequest) -> LeftoverValidation {
    let install_location = if request.install_location.trim().is_empty() {
        None
    } else {
        Some(PathBuf::from(request.install_location.trim()))
    };
    LeftoverValidation {
        app_name: request.name.trim().to_string(),
        app_kind: request.app_kind.trim().to_string(),
        publisher: request.publisher.trim().to_string(),
        registry_path: request.registry_path.trim().to_string(),
        install_location,
        uninstalled: request.uninstalled,
    }
}

fn validate_leftover_item_for_app(
    item: &InstalledAppLeftoverItem,
    validation: &LeftoverValidation,
) -> Result<(), String> {
    if !validation.uninstalled {
        return Err("当前软件尚未标记为已卸载，拒绝清理残留".to_string());
    }
    match item.kind.as_str() {
        "registry" => {
            if item.confidence != "high" {
                return Err("注册表项只允许清理高置信度匹配项".to_string());
            }
            if validation.registry_path.trim().is_empty()
                || !item.path.eq_ignore_ascii_case(&validation.registry_path)
            {
                return Err("注册表项与当前软件登记不匹配".to_string());
            }
        }
        "install-dir" => {
            if item.confidence != "high" {
                return Err("安装目录只允许清理高置信度匹配项".to_string());
            }
            let Some(install_location) = validation.install_location.as_ref() else {
                return Err("当前软件没有登记安装目录，拒绝清理安装目录".to_string());
            };
            let path = PathBuf::from(&item.path);
            if !paths_equal(&path, install_location) {
                return Err("安装目录与当前软件登记不匹配".to_string());
            }
        }
        "folder" | "file" => {
            let path = PathBuf::from(&item.path);
            if !matches!(item.confidence.as_str(), "medium" | "low") {
                return Err("疑似残留文件只允许手动清理中低置信度项".to_string());
            }
            if !is_safe_leftover_path(&path) {
                return Err("路径不在允许清理范围内".to_string());
            }
            if item.kind == "folder" && !path.is_dir() {
                return Err("扫描项类型与当前路径不匹配".to_string());
            }
            if item.kind == "file" && !path.is_file() {
                return Err("扫描项类型与当前路径不匹配".to_string());
            }
            if !leftover_path_matches_app_tokens(&path, validation) {
                return Err("路径名称与当前软件关键词不匹配".to_string());
            }
        }
        _ => {
            return Err("不支持清理该类型的残留项".to_string());
        }
    }
    if validation.app_name.trim().is_empty() || validation.app_kind.trim().is_empty() {
        return Err("软件上下文不完整，拒绝清理".to_string());
    }
    Ok(())
}

#[derive(Debug)]
struct RelatedRunningProcess {
    pid: u64,
    name: String,
    executable_path: String,
}

fn related_running_processes_for_app(
    validation: &LeftoverValidation,
) -> Result<Vec<RelatedRunningProcess>, String> {
    let Some(install_location) = validation.install_location.as_ref() else {
        return Ok(Vec::new());
    };
    if install_location.as_os_str().is_empty() || !install_location.exists() {
        return Ok(Vec::new());
    }

    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
@(
  Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath } |
    Select-Object ProcessId, Name, ExecutablePath
) | ConvertTo-Json -Compress -Depth 3
"#;

    let mut rows = Vec::new();
    for value in powershell_json_rows(script)? {
        let executable_path = json_string(&value, "ExecutablePath");
        if executable_path.trim().is_empty() {
            continue;
        }
        let process_path = PathBuf::from(&executable_path);
        if !path_is_inside_or_equal(&process_path, install_location) {
            continue;
        }
        let pid = json_u64(&value, "ProcessId").unwrap_or(0);
        if pid == u64::from(std::process::id()) {
            continue;
        }
        rows.push(RelatedRunningProcess {
            pid,
            name: json_string(&value, "Name"),
            executable_path,
        });
    }

    rows.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.pid.cmp(&b.pid))
    });
    rows.dedup_by(|a, b| {
        a.pid == b.pid && a.executable_path.eq_ignore_ascii_case(&b.executable_path)
    });
    Ok(rows)
}

fn format_related_process_block(processes: &[RelatedRunningProcess]) -> String {
    let details = processes
        .iter()
        .take(5)
        .map(|process| {
            format!(
                "{} (PID {}) - {}",
                if process.name.trim().is_empty() {
                    "未知进程"
                } else {
                    process.name.trim()
                },
                process.pid,
                process.executable_path
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    let more = processes.len().saturating_sub(5);
    if more > 0 {
        format!(
            "检测到该软件安装目录下仍有进程运行，已拒绝扫描/清理。请先关闭相关进程后重试：{}；另有 {} 个进程",
            details, more
        )
    } else {
        format!(
            "检测到该软件安装目录下仍有进程运行，已拒绝扫描/清理。请先关闭相关进程后重试：{}",
            details
        )
    }
}

fn path_is_inside_or_equal(child: &std::path::Path, parent: &std::path::Path) -> bool {
    let child = std::fs::canonicalize(child).unwrap_or_else(|_| child.to_path_buf());
    let parent = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    let child = normalize_path_for_compare(&child);
    let parent = normalize_path_for_compare(&parent);
    if child.is_empty() || parent.is_empty() {
        return false;
    }
    child == parent || child.starts_with(&format!("{}\\", parent))
}

fn normalize_path_for_compare(path: &std::path::Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn app_leftover_tokens(name: &str, publisher: &str, is_store_app: bool) -> Vec<String> {
    let mut tokens = Vec::new();
    for (index, raw) in [name, publisher].into_iter().enumerate() {
        if is_store_app && index == 1 {
            continue;
        }
        let cleaned = raw
            .replace(['®', '™', '©'], " ")
            .replace(['(', ')', '[', ']', '{', '}', ',', '.', '_', '-'], " ");
        for part in cleaned.split_whitespace() {
            let token = part.trim().to_lowercase();
            if token.len() >= 5
                && !matches!(
                    token.as_str(),
                    "the"
                        | "and"
                        | "for"
                        | "with"
                        | "app"
                        | "pro"
                        | "x64"
                        | "x86"
                        | "64bit"
                        | "32bit"
                        | "version"
                        | "microsoft"
                        | "windows"
                        | "corporation"
                        | "store"
                        | "system"
                        | "neutral"
                )
            {
                tokens.push(token);
            }
        }
    }
    tokens.sort();
    tokens.dedup();
    tokens
}

fn leftover_path_matches_app_tokens(path: &Path, validation: &LeftoverValidation) -> bool {
    let is_store_app = validation.app_kind.eq_ignore_ascii_case("store")
        || validation.registry_path.to_lowercase().contains("appx");
    let tokens = app_leftover_tokens(&validation.app_name, &validation.publisher, is_store_app);
    if tokens.is_empty() {
        return false;
    }
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let name_lower = name.to_lowercase();
    tokens.iter().any(|token| name_lower.contains(token))
}

fn app_leftover_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for key in [
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
        "LOCALAPPDATA",
        "APPDATA",
    ] {
        if let Some(value) = std::env::var_os(key) {
            roots.push(PathBuf::from(value));
        }
    }
    roots
}

fn scan_leftover_children(
    items: &mut Vec<InstalledAppLeftoverItem>,
    base: &std::path::Path,
    tokens: &[String],
) {
    if tokens.is_empty() {
        return;
    }
    let Ok(rows) = std::fs::read_dir(base) else {
        return;
    };
    for entry in rows.filter_map(Result::ok) {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let name_lower = name.to_lowercase();
        if !tokens.iter().any(|token| name_lower.contains(token)) {
            continue;
        }
        let match_count = tokens
            .iter()
            .filter(|token| name_lower.contains(*token))
            .count();
        let confidence = if match_count >= 2 { "medium" } else { "low" };
        push_leftover_item(
            items,
            if path.is_dir() { "folder" } else { "file" },
            if path.is_dir() {
                "残留文件夹"
            } else {
                "残留文件"
            },
            &path,
            confidence,
            "名称与软件名称匹配",
            false,
        );
    }
}

fn push_leftover_item(
    items: &mut Vec<InstalledAppLeftoverItem>,
    kind: &str,
    kind_label: &str,
    path: &std::path::Path,
    confidence: &str,
    reason: &str,
    selected_by_default: bool,
) {
    let (size, count) = path_size_and_count(path);
    items.push(InstalledAppLeftoverItem {
        id: format!("{}|{}", kind, path.to_string_lossy()),
        kind: kind.to_string(),
        kind_label: kind_label.to_string(),
        path: path.to_string_lossy().to_string(),
        display_path: path.to_string_lossy().to_string(),
        size,
        count,
        confidence: confidence.to_string(),
        reason: reason.to_string(),
        selected_by_default,
    });
}

fn confidence_rank(value: &str) -> u8 {
    match value {
        "high" => 0,
        "medium" => 1,
        "low" => 2,
        _ => 9,
    }
}

fn is_safe_leftover_path(path: &std::path::Path) -> bool {
    if !path.exists() {
        return false;
    }
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if validate_force_delete_target(&canonical).is_err() {
        return false;
    }
    app_leftover_search_roots()
        .into_iter()
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .any(|root| canonical.starts_with(&root) && canonical != root)
}

fn delete_uninstall_registry_key(registry_path: &str) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let parts = registry_path.splitn(2, '\\').collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err("注册表路径无效".to_string());
    }
    let hive = match parts[0] {
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
        _ => return Err("只支持清理 HKLM/HKCU 卸载项".to_string()),
    };
    let subkey = parts[1];
    if !subkey
        .to_lowercase()
        .contains(r"software\microsoft\windows\currentversion\uninstall")
    {
        return Err("只允许删除软件卸载登记项".to_string());
    }
    hive.delete_subkey_all(subkey)
        .map_err(|e| format!("删除注册表残留失败: {}", e))
}

fn collect_store_app_entries() -> Result<Vec<InstalledAppEntry>, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-AppxPackage | Where-Object { -not $_.IsFramework } | Select-Object -First 600 | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    Publisher = $_.Publisher
    Version = $_.Version.ToString()
    InstallLocation = $_.InstallLocation
    PackageFullName = $_.PackageFullName
  }
} | ConvertTo-Json -Compress
"#;
    let mut rows = Vec::new();
    for value in powershell_json_rows(script)? {
        let name = json_string(&value, "Name");
        let package_full_name = json_string(&value, "PackageFullName");
        if name.trim().is_empty() || package_full_name.trim().is_empty() {
            continue;
        }
        let install_location = json_string(&value, "InstallLocation");
        let estimated_size = if install_location.trim().is_empty() {
            0
        } else {
            path_size_and_count(&PathBuf::from(&install_location)).0
        };
        rows.push(InstalledAppEntry {
            id: format!("appx|{}", package_full_name),
            name,
            publisher: json_string(&value, "Publisher"),
            version: json_string(&value, "Version"),
            install_date: String::new(),
            install_location,
            estimated_size,
            uninstall_string: format!(
                "Remove-AppxPackage -Package '{}'",
                package_full_name.replace('\'', "''")
            ),
            quiet_uninstall_string: String::new(),
            registry_path: package_full_name,
            scope: "Microsoft Store".to_string(),
            app_kind: "store".to_string(),
        });
    }
    Ok(rows)
}

fn export_reg_backup(registry_path: &str, prefix: &str) -> Result<Option<String>, String> {
    if registry_path.trim().is_empty() || !registry_path.contains('\\') {
        return Ok(None);
    }
    let backup_path = std::env::temp_dir().join(format!(
        "mcstartup-{}-{}.reg",
        prefix,
        uuid::Uuid::new_v4().simple()
    ));
    let mut command = Command::new("reg");
    command.args([
        "export",
        registry_path,
        &backup_path.to_string_lossy(),
        "/y",
    ]);
    match run_hidden(&mut command) {
        Ok(()) => Ok(Some(backup_path.to_string_lossy().to_string())),
        Err(err) => Err(format!("导出注册表备份失败: {}", err)),
    }
}

fn delete_path_with_elevation(path: &std::path::Path, direct_error: &str) -> Result<(), String> {
    let marker = std::env::temp_dir().join(format!(
        "mcstartup-force-delete-{}.ok",
        uuid::Uuid::new_v4().simple()
    ));
    let log_path = std::env::temp_dir().join(format!(
        "mcstartup-force-delete-{}.log",
        uuid::Uuid::new_v4().simple()
    ));
    let script_path = std::env::temp_dir().join(format!(
        "mcstartup-force-delete-{}.ps1",
        uuid::Uuid::new_v4().simple()
    ));

    let script = format!(
        r#"$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$target = '{}'
$marker = '{}'
$logPath = '{}'
$directError = '{}'
function Write-DeleteLog([string]$message) {{
  Add-Content -LiteralPath $logPath -Value $message -Encoding UTF8
}}
try {{
  if (!(Test-Path -LiteralPath $target -Force)) {{
    Set-Content -LiteralPath $marker -Value 'ok' -Encoding ASCII
    exit 0
  }}
  $isDir = Test-Path -LiteralPath $target -PathType Container
  Write-DeleteLog ("普通删除失败：" + $directError)
  Write-DeleteLog "开始管理员强制删除：$target"

  if ($isDir) {{
    & cmd.exe /d /c ('attrib -R -S -H "{0}" /S /D' -f ($target -replace '"', '""')) | Out-Null
    & takeown.exe /F $target /R /D Y | Out-Null
    $adminGrant = '*S-1-5-32-544:(OI)(CI)F'
    $userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $userGrant = ('*{0}:(OI)(CI)F' -f $userSid)
    & icacls.exe $target /grant $adminGrant $userGrant /T /C /Q | Out-Null
  }} else {{
    & cmd.exe /d /c ('attrib -R -S -H "{0}"' -f ($target -replace '"', '""')) | Out-Null
    & takeown.exe /F $target | Out-Null
    $adminGrant = '*S-1-5-32-544:F'
    $userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $userGrant = ('*{0}:F' -f $userSid)
    & icacls.exe $target /grant $adminGrant $userGrant /C /Q | Out-Null
  }}

  try {{
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
  }} catch {{
    Write-DeleteLog ("Remove-Item 失败：" + $_.Exception.Message)
    $escaped = $target -replace '"', '""'
    if ($isDir) {{
      & cmd.exe /d /c ('rd /s /q "{0}"' -f $escaped) | Out-Null
    }} else {{
      & cmd.exe /d /c ('del /f /q "{0}"' -f $escaped) | Out-Null
    }}
  }}

  if (Test-Path -LiteralPath $target -Force) {{
    throw '路径仍然存在，可能被进程占用、被系统保护，或 UAC 权限未授予。'
  }}
  Set-Content -LiteralPath $marker -Value 'ok' -Encoding ASCII
  exit 0
}} catch {{
  Write-DeleteLog $_.Exception.Message
  exit 1
}}
"#,
        escape_powershell_single_quote(&path.to_string_lossy()),
        escape_powershell_single_quote(&marker.to_string_lossy()),
        escape_powershell_single_quote(&log_path.to_string_lossy()),
        escape_powershell_single_quote(direct_error)
    );
    std::fs::write(&script_path, script).map_err(|e| format!("写入强制删除脚本失败: {}", e))?;

    let argument_list = format!(
        "-NoProfile -ExecutionPolicy Bypass -File \"{}\"",
        script_path.to_string_lossy().replace('"', "`\"")
    );
    let launch_script = format!(
        "$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '{}'; exit $p.ExitCode",
        escape_powershell_single_quote(&argument_list)
    );

    let mut command = Command::new("powershell");
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &launch_script,
    ]);
    let output = command
        .output()
        .map_err(|e| format!("启动管理员强制删除失败: {}", e))?;
    let marker_exists = marker.exists();
    let log_text = std::fs::read_to_string(&log_path).unwrap_or_default();
    let _ = std::fs::remove_file(&marker);
    let _ = std::fs::remove_file(&log_path);
    let _ = std::fs::remove_file(&script_path);

    if marker_exists && !path.exists() {
        return Ok(());
    }
    if !path.exists() {
        return Ok(());
    }

    let stderr = decode_command_output(&output.stderr).trim().to_string();
    let detail = [log_text.trim(), stderr.as_str()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("；");
    Err(if detail.is_empty() {
        "管理员强制删除未完成：UAC 可能被取消，或文件正在被进程/系统内核占用。".to_string()
    } else {
        format!("管理员强制删除未完成：{}", detail)
    })
}

fn normalize_scan_path(path: &std::path::Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    let trimmed = value.trim_end_matches('\\').to_string();
    if trimmed.len() == 2 && trimmed.as_bytes().get(1) == Some(&b':') {
        format!("{}\\", trimmed)
    } else {
        trimmed
    }
}

fn normalize_exclude_scan_paths(paths: Vec<String>) -> Vec<String> {
    let mut rows = paths
        .into_iter()
        .map(|value| value.trim().trim_matches('"').to_string())
        .filter(|value| !value.is_empty())
        .map(|value| normalize_scan_path(&PathBuf::from(value)))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    rows.sort_by_key(|value| value.to_lowercase());
    rows.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    rows
}

fn is_excluded_scan_path(path: &std::path::Path, excludes: &[String]) -> bool {
    if excludes.is_empty() {
        return false;
    }
    let current = normalize_scan_path(path).to_lowercase();
    excludes.iter().any(|exclude| {
        let normalized = exclude.to_lowercase();
        let base = normalized.trim_end_matches('\\');
        current == normalized
            || current == base
            || current.starts_with(&format!("{}\\", base))
            || current
                .split('\\')
                .any(|part| part.eq_ignore_ascii_case(base))
    })
}

fn folder_display_name(path: &std::path::Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn file_extension_key(path: &std::path::Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "__no_extension__".to_string())
}

fn extension_label(extension: &str) -> String {
    if extension == "__no_extension__" {
        "无扩展名".to_string()
    } else {
        format!(".{}", extension)
    }
}

fn file_age_bucket(modified: Option<u64>) -> &'static str {
    let Some(modified) = modified else {
        return "unknown";
    };
    let now_ms = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    if now_ms <= modified {
        return "last7";
    }
    let age_days = (now_ms - modified) / 86_400_000;
    if age_days <= 7 {
        "last7"
    } else if age_days <= 30 {
        "last30"
    } else if age_days <= 180 {
        "last180"
    } else {
        "older"
    }
}

fn file_age_label(bucket: &str) -> &'static str {
    match bucket {
        "last7" => "7 天内",
        "last30" => "8-30 天",
        "last180" => "31-180 天",
        "older" => "180 天以上",
        _ => "未知时间",
    }
}

fn build_age_stats(stats: HashMap<String, AgeScanStat>, total_size: u64) -> Vec<FileAgeStat> {
    ["last7", "last30", "last180", "older", "unknown"]
        .into_iter()
        .filter_map(|bucket| {
            let stat = stats.get(bucket)?;
            if stat.count == 0 {
                return None;
            }
            Some(FileAgeStat {
                bucket: bucket.to_string(),
                label: file_age_label(bucket).to_string(),
                size: stat.size,
                count: stat.count,
                percent: percent_of(stat.size, total_size),
            })
        })
        .collect()
}

fn build_duplicate_file_groups(files: &[LargeFileItem]) -> Vec<DuplicateFileGroup> {
    let mut grouped = HashMap::<String, Vec<LargeFileItem>>::new();
    for file in files {
        if file.size == 0 {
            continue;
        }
        let signature = format!("{}|{}", file.size, file.name.to_lowercase());
        grouped.entry(signature).or_default().push(file.clone());
    }
    let mut rows = grouped
        .into_iter()
        .filter_map(|(signature, mut files)| {
            if files.len() < 2 {
                return None;
            }
            files.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
            let size = files.first().map(|file| file.size).unwrap_or(0);
            Some(DuplicateFileGroup {
                signature,
                size,
                count: files.len() as u64,
                total_waste: size.saturating_mul(files.len().saturating_sub(1) as u64),
                files,
            })
        })
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        b.total_waste
            .cmp(&a.total_waste)
            .then_with(|| b.size.cmp(&a.size))
    });
    rows.truncate(200);
    rows
}

fn percent_of(size: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        ((size as f64 / total as f64) * 10000.0).round() / 100.0
    }
}

fn aggregate_folder_stats(folders: &mut HashMap<String, FolderScanStat>) {
    let mut keys = folders.keys().cloned().collect::<Vec<_>>();
    keys.sort_by(|a, b| {
        let depth_a = folders.get(a).map(|folder| folder.depth).unwrap_or(0);
        let depth_b = folders.get(b).map(|folder| folder.depth).unwrap_or(0);
        depth_b.cmp(&depth_a)
    });

    for key in keys {
        let Some(folder) = folders.get(&key).cloned() else {
            continue;
        };
        if folder.parent_path.is_empty() {
            continue;
        }
        if let Some(parent) = folders.get_mut(&folder.parent_path) {
            parent.size = parent.size.saturating_add(folder.size);
            parent.file_count = parent.file_count.saturating_add(folder.file_count);
            parent.folder_count = parent
                .folder_count
                .saturating_add(folder.folder_count.saturating_add(1));
        }
    }
}

fn select_folder_rows(
    folders: &HashMap<String, FolderScanStat>,
    root_key: &str,
    total_size: u64,
    limit: usize,
) -> Vec<DiskUsageFolder> {
    let mut selected = HashSet::<String>::new();
    selected.insert(root_key.to_string());

    let mut ranked = folders.values().collect::<Vec<_>>();
    ranked.sort_by(|a, b| b.size.cmp(&a.size));
    for folder in ranked.into_iter().take(limit) {
        let mut current = folder.path.clone();
        loop {
            if !selected.insert(current.clone()) {
                break;
            }
            let Some(parent_path) = folders
                .get(&current)
                .map(|item| item.parent_path.clone())
                .filter(|value| !value.is_empty())
            else {
                break;
            };
            current = parent_path;
        }
    }

    let mut rows = selected
        .into_iter()
        .filter_map(|key| folders.get(&key))
        .map(|folder| DiskUsageFolder {
            path: folder.path.clone(),
            name: folder.name.clone(),
            parent_path: folder.parent_path.clone(),
            size: folder.size,
            file_count: folder.file_count,
            folder_count: folder.folder_count,
            depth: folder.depth,
            percent: percent_of(folder.size, total_size),
        })
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        a.parent_path
            .cmp(&b.parent_path)
            .then_with(|| b.size.cmp(&a.size))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    rows
}

fn can_write_hosts_directly() -> bool {
    let path = hosts_path();
    std::fs::OpenOptions::new().append(true).open(path).is_ok()
}

fn normalize_hosts_content(content: &str) -> String {
    let mut out = content.replace("\r\n", "\n").replace('\r', "\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.replace('\n', "\r\n")
}

fn escape_powershell_single_quote(value: &str) -> String {
    value.replace('\'', "''")
}

fn escape_wmi_filter_single_quote(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn copy_hosts_with_elevation(
    source: &std::path::Path,
    target: &std::path::Path,
) -> Result<bool, String> {
    let marker = std::env::temp_dir().join(format!(
        "mcstartup-hosts-result-{}.ok",
        uuid::Uuid::new_v4().simple()
    ));
    let script_path = std::env::temp_dir().join(format!(
        "mcstartup-hosts-save-{}.ps1",
        uuid::Uuid::new_v4().simple()
    ));
    let script = format!(
        "$ErrorActionPreference = 'Stop'\r\nCopy-Item -LiteralPath '{}' -Destination '{}' -Force\r\nSet-Content -LiteralPath '{}' -Value 'ok' -Encoding ASCII\r\n",
        escape_powershell_single_quote(&source.to_string_lossy()),
        escape_powershell_single_quote(&target.to_string_lossy()),
        escape_powershell_single_quote(&marker.to_string_lossy())
    );
    std::fs::write(&script_path, script).map_err(|e| format!("写入管理员脚本失败: {}", e))?;

    let argument_list = format!(
        "-NoProfile -ExecutionPolicy Bypass -File \"{}\"",
        script_path.to_string_lossy().replace('"', "`\"")
    );
    let launch_script = format!(
        "$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '{}'; exit $p.ExitCode",
        escape_powershell_single_quote(&argument_list)
    );

    let mut command = Command::new("powershell");
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &launch_script,
    ]);
    let output = command_output_bytes_hidden(&mut command)
        .map_err(|e| format!("启动管理员 PowerShell 失败: {}", e))?;
    let marker_exists = marker.exists();
    let _ = std::fs::remove_file(&marker);
    let _ = std::fs::remove_file(&script_path);

    if marker_exists {
        return Ok(true);
    }

    let stderr = decode_command_output(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return Err(format!("管理员保存失败: {}", stderr));
    }
    Ok(output.status.success())
}

fn hosts_content_matches(expected: &str) -> bool {
    let Ok(actual) = std::fs::read_to_string(hosts_path()) else {
        return false;
    };
    normalize_hosts_for_compare(&actual) == normalize_hosts_for_compare(expected)
}

fn normalize_hosts_for_compare(value: &str) -> String {
    value.replace("\r\n", "\n").replace('\r', "\n")
}

fn run_hidden(command: &mut Command) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command
        .output()
        .map_err(|e| format!("命令执行失败: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = decode_command_output(&output.stderr).trim().to_string();
        let stdout = decode_command_output(&output.stdout).trim().to_string();
        Err(if !stderr.is_empty() { stderr } else { stdout })
    }
}

fn command_output_hidden(command: &mut Command) -> Result<String, String> {
    let output = command_output_bytes_hidden(command)?;
    Ok(decode_command_output(&output.stdout).trim().to_string())
}

fn command_output_bytes_hidden(command: &mut Command) -> Result<std::process::Output, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.output().map_err(|e| format!("命令执行失败: {}", e))
}

fn open_path(path: &std::path::Path) -> Result<(), String> {
    let mut command = Command::new("explorer");
    command.arg(path);
    run_hidden(&mut command)
}

fn collect_run_key_entries(
    entries: &mut Vec<StartupEntry>,
    root: &str,
    subkey: &str,
    location_label: &str,
    scope: &str,
    approved_subkey: &str,
) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hive = match root {
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        _ => RegKey::predef(HKEY_CURRENT_USER),
    };
    let Ok(key) = hive.open_subkey(subkey) else {
        return Ok(());
    };
    for item in key.enum_values().filter_map(Result::ok) {
        let name = item.0;
        let command = key
            .get_value::<String, _>(&name)
            .unwrap_or_else(|_| String::new());
        if command.trim().is_empty() {
            continue;
        }
        let enabled = startup_approved_enabled(root, approved_subkey, &name).unwrap_or(true);
        entries.push(StartupEntry {
            id: format!("run|{}|{}|{}", root, subkey, name),
            kind: "registry".to_string(),
            kind_label: "注册表 Run".to_string(),
            name,
            command,
            location: location_label.to_string(),
            source_label: location_label.to_string(),
            enabled,
            scope: scope.to_string(),
            can_toggle: true,
            note: Some("通过 StartupApproved 控制启停，不删除原始 Run 项".to_string()),
        });
    }
    Ok(())
}

fn startup_approved_enabled(root: &str, subkey: &str, name: &str) -> Result<bool, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hive = match root {
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        _ => RegKey::predef(HKEY_CURRENT_USER),
    };
    let key = hive
        .open_subkey(subkey)
        .map_err(|e| format!("读取启动状态失败: {}", e))?;
    let raw = key
        .get_raw_value(name)
        .map_err(|e| format!("读取启动状态失败: {}", e))?;
    Ok(!matches!(raw.bytes.first(), Some(3)))
}

fn set_startup_approved(root: &str, name: &str, enabled: bool) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::{RegKey, RegValue};

    let hive = match root {
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        _ => RegKey::predef(HKEY_CURRENT_USER),
    };
    let subkey = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    let (key, _) = hive
        .create_subkey(subkey)
        .map_err(|e| format!("打开注册表失败: {}", e))?;
    let bytes = if enabled {
        vec![2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    } else {
        vec![3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    };
    key.set_raw_value(
        name,
        &RegValue {
            vtype: REG_BINARY,
            bytes,
        },
    )
    .map_err(|e| format!("写入启动状态失败: {}", e))
}

fn collect_startup_folder_entries(entries: &mut Vec<StartupEntry>) -> Result<(), String> {
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let dir = PathBuf::from(appdata)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("Startup");
        collect_startup_dir(entries, &dir, "启动文件夹：当前用户", "user-folder")?;
    }
    if let Some(program_data) = std::env::var_os("ProgramData") {
        let dir = PathBuf::from(program_data)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("StartUp");
        collect_startup_dir(entries, &dir, "启动文件夹：所有用户", "machine-folder")?;
    }
    Ok(())
}

fn collect_startup_dir(
    entries: &mut Vec<StartupEntry>,
    dir: &std::path::Path,
    _location_label: &str,
    scope: &str,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let rows = std::fs::read_dir(dir).map_err(|e| format!("读取启动文件夹失败: {}", e))?;
    for entry in rows.filter_map(Result::ok) {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let disabled = name.ends_with(".disabled");
        let visible_name = name.trim_end_matches(".disabled").to_string();
        entries.push(StartupEntry {
            id: format!("startup-folder|{}", path.to_string_lossy()),
            kind: "folder".to_string(),
            kind_label: "启动文件夹".to_string(),
            name: visible_name,
            command: path.to_string_lossy().to_string(),
            location: path.to_string_lossy().to_string(),
            source_label: _location_label.to_string(),
            enabled: !disabled,
            scope: scope.to_string(),
            can_toggle: true,
            note: Some("禁用时会把启动文件重命名为 .disabled".to_string()),
        });
    }
    Ok(())
}

fn collect_scheduled_task_entries(entries: &mut Vec<StartupEntry>) -> Result<(), String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$rows = Get-ScheduledTask | Where-Object {
  $_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'LogonTrigger|BootTrigger' }
} | ForEach-Object {
  $actions = ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
  $triggers = ($_.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace '^MSFT_Task', '' }) -join ', '
  [pscustomobject]@{
    TaskName = $_.TaskName
    TaskPath = $_.TaskPath
    State = "$($_.State)"
    Actions = $actions
    Triggers = $triggers
  }
}
$rows | ConvertTo-Json -Compress
"#;

    for value in powershell_json_rows(script)? {
        let task_name = json_string(&value, "TaskName");
        if task_name.is_empty() {
            continue;
        }
        let task_path = json_string(&value, "TaskPath");
        let state = json_string(&value, "State");
        let actions = json_string(&value, "Actions");
        let triggers = json_string(&value, "Triggers");
        entries.push(StartupEntry {
            id: format!("task|{}|{}", task_path, task_name),
            kind: "task".to_string(),
            kind_label: "计划任务".to_string(),
            name: format!("{}{}", task_path, task_name),
            command: actions,
            location: task_path.clone(),
            source_label: if triggers.is_empty() {
                "登录/启动触发".to_string()
            } else {
                triggers
            },
            enabled: !state.eq_ignore_ascii_case("disabled"),
            scope: "task".to_string(),
            can_toggle: true,
            note: Some("仅列出登录或系统启动触发的计划任务".to_string()),
        });
    }
    Ok(())
}

fn collect_service_entries(entries: &mut Vec<StartupEntry>) -> Result<(), String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Service | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    DisplayName = $_.DisplayName
    PathName = $_.PathName
    State = $_.State
    StartMode = $_.StartMode
  }
} | ConvertTo-Json -Compress
"#;

    for value in powershell_json_rows(script)? {
        let service_name = json_string(&value, "Name");
        if service_name.is_empty() {
            continue;
        }
        let display_name = json_string(&value, "DisplayName");
        let start_mode = json_string(&value, "StartMode");
        let state = json_string(&value, "State");
        entries.push(StartupEntry {
            id: format!("service|{}", service_name),
            kind: "service".to_string(),
            kind_label: "系统服务".to_string(),
            name: if display_name.is_empty() {
                service_name.clone()
            } else {
                display_name
            },
            command: json_string(&value, "PathName"),
            location: service_name,
            source_label: format!("{} / {}", start_mode, state),
            enabled: start_mode.eq_ignore_ascii_case("auto"),
            scope: "service".to_string(),
            can_toggle: true,
            note: Some("关闭服务开机启动会改为手动启动，不会停止当前正在运行的服务".to_string()),
        });
    }
    Ok(())
}

fn set_scheduled_task_enabled(
    task_path: &str,
    task_name: &str,
    enabled: bool,
) -> Result<(), String> {
    let cmdlet = if enabled {
        "Enable-ScheduledTask"
    } else {
        "Disable-ScheduledTask"
    };
    let script = format!(
        "{} -TaskPath '{}' -TaskName '{}' | Out-Null",
        cmdlet,
        escape_powershell_single_quote(task_path),
        escape_powershell_single_quote(task_name)
    );
    run_powershell_script_hidden(&script)
}

fn set_service_startup_enabled(service_name: &str, enabled: bool) -> Result<(), String> {
    let startup_type = if enabled { "Automatic" } else { "Manual" };
    let script = format!(
        "Set-Service -Name '{}' -StartupType {}",
        escape_powershell_single_quote(service_name),
        startup_type
    );
    run_powershell_script_hidden(&script)
}

fn run_powershell_script_hidden(script: &str) -> Result<(), String> {
    let mut command = Command::new("powershell");
    let script = with_utf8_powershell_output(script);
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    run_hidden(&mut command)
}

fn run_powershell_script_with_elevation(script: &str) -> Result<(), String> {
    let temp_script = std::env::temp_dir().join(format!(
        "mcstartup-elevated-script-{}.ps1",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&temp_script, with_utf8_powershell_output(script))
        .map_err(|e| format!("写入临时脚本失败: {}", e))?;
    let argument_list = format!(
        "-NoProfile -ExecutionPolicy Bypass -File \"{}\"",
        temp_script.to_string_lossy().replace('"', "`\"")
    );
    let launch_script = format!(
        "$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '{}'; exit $p.ExitCode",
        escape_powershell_single_quote(&argument_list)
    );
    let mut command = Command::new("powershell");
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &launch_script,
    ]);
    let result = run_hidden(&mut command);
    let _ = std::fs::remove_file(temp_script);
    result
}

fn powershell_json_rows(script: &str) -> Result<Vec<serde_json::Value>, String> {
    let mut command = Command::new("powershell");
    let script = with_utf8_powershell_output(script);
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    let output = command_output_hidden(&mut command)?;
    if output.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value = serde_json::from_str::<serde_json::Value>(&output)
        .map_err(|e| format!("解析 PowerShell 输出失败: {}", e))?;
    Ok(match value {
        serde_json::Value::Array(rows) => rows,
        serde_json::Value::Object(_) => vec![value],
        _ => Vec::new(),
    })
}

fn with_utf8_powershell_output(script: &str) -> String {
    format!(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; {}",
        script
    )
}

fn decode_command_output(bytes: &[u8]) -> String {
    match String::from_utf8(bytes.to_vec()) {
        Ok(value) => value,
        Err(_) => {
            let (cow, _, _) = encoding_rs::GBK.decode(bytes);
            cow.into_owned()
        }
    }
}

fn json_string(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn json_u64(value: &serde_json::Value, key: &str) -> Option<u64> {
    value.get(key).and_then(|item| {
        item.as_u64().or_else(|| {
            item.as_str()
                .and_then(|text| text.trim().parse::<u64>().ok())
        })
    })
}

fn json_f64(value: &serde_json::Value, key: &str) -> f64 {
    value
        .get(key)
        .and_then(|item| {
            item.as_f64().or_else(|| {
                item.as_str()
                    .and_then(|text| text.trim().parse::<f64>().ok())
            })
        })
        .unwrap_or(0.0)
}

fn json_array<'a>(value: &'a serde_json::Value, key: &str) -> Vec<&'a serde_json::Value> {
    match value.get(key) {
        Some(serde_json::Value::Array(rows)) => rows.iter().collect(),
        Some(serde_json::Value::Object(_)) => value.get(key).into_iter().collect(),
        _ => Vec::new(),
    }
}

fn json_bool(value: &serde_json::Value, key: &str) -> bool {
    value
        .get(key)
        .and_then(|item| item.as_bool())
        .unwrap_or(false)
}

fn adapter_status_rank(value: &str) -> u8 {
    match value.to_lowercase().as_str() {
        "up" => 0,
        "connected" => 0,
        "已连接" => 0,
        "disconnected" => 1,
        "已断开" => 1,
        _ => 2,
    }
}

fn collect_dns_adapters_with_netsh() -> Result<Vec<DnsAdapter>, String> {
    let mut command = Command::new("netsh");
    command.args(["interface", "ipv4", "show", "interfaces"]);
    let output = command_output_hidden(&mut command)?;
    let dns_map = dns_servers_for_all_interfaces().unwrap_or_default();
    let mut rows = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with("Idx")
            || line.starts_with("---")
            || line.contains("Met")
            || line.contains("跃点")
        {
            continue;
        }
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 5 {
            continue;
        }
        let Some(interface_index) = parts[0].parse::<u32>().ok() else {
            continue;
        };
        let status = parts.get(3).copied().unwrap_or_default().to_string();
        let name = parts[4..].join(" ");
        if name.is_empty() {
            continue;
        }
        let dns_servers = dns_map.get(&name).cloned().unwrap_or_default();
        rows.push(DnsAdapter {
            interface_index,
            name,
            description: String::new(),
            status,
            mac_address: String::new(),
            dns_servers,
        });
    }
    if rows.is_empty() {
        return Err("未读取到 IPv4 网络接口".to_string());
    }
    Ok(rows)
}

fn dns_servers_for_all_interfaces() -> Result<HashMap<String, Vec<String>>, String> {
    let mut command = Command::new("netsh");
    command.args(["interface", "ipv4", "show", "dnsservers"]);
    let output = command_output_hidden(&mut command)?;
    let mut result = HashMap::new();
    let mut current_name = String::new();
    let mut current_block = String::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(name) = dns_config_interface_name(trimmed) {
            if !current_name.is_empty() {
                result.insert(current_name.clone(), extract_ipv4_addresses(&current_block));
            }
            current_name = name;
            current_block.clear();
        } else if !current_name.is_empty() {
            current_block.push_str(trimmed);
            current_block.push('\n');
        }
    }
    if !current_name.is_empty() {
        result.insert(current_name, extract_ipv4_addresses(&current_block));
    }
    Ok(result)
}

fn dns_config_interface_name(line: &str) -> Option<String> {
    let start = line.find('"')?;
    let rest = &line[start + 1..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn extract_ipv4_addresses(value: &str) -> Vec<String> {
    let Ok(pattern) = regex::Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b") else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    pattern
        .find_iter(value)
        .map(|item| item.as_str().to_string())
        .filter(|item| item.parse::<std::net::Ipv4Addr>().is_ok())
        .filter(|item| seen.insert(item.clone()))
        .collect()
}

fn set_dns_with_netsh(interface_name: &str, servers: &[String]) -> Result<(), String> {
    match set_dns_with_netsh_direct(interface_name, servers) {
        Ok(()) => Ok(()),
        Err(err) if is_elevation_required_error(&err) => {
            set_dns_with_netsh_elevated(interface_name, servers)
        }
        Err(err) => Err(err),
    }
}

fn set_dns_with_netsh_direct(interface_name: &str, servers: &[String]) -> Result<(), String> {
    if servers.is_empty() {
        let mut command = Command::new("netsh");
        command.args([
            "interface",
            "ipv4",
            "set",
            "dnsservers",
            &format!("name={}", interface_name),
            "source=dhcp",
        ]);
        return run_hidden(&mut command);
    }

    let mut first = Command::new("netsh");
    first.args([
        "interface",
        "ipv4",
        "set",
        "dnsservers",
        &format!("name={}", interface_name),
        "static",
        &servers[0],
        "primary",
        "validate=no",
    ]);
    run_hidden(&mut first)?;

    for (index, server) in servers.iter().enumerate().skip(1) {
        let mut command = Command::new("netsh");
        command.args([
            "interface",
            "ipv4",
            "add",
            "dnsservers",
            &format!("name={}", interface_name),
            server,
            &format!("index={}", index + 1),
            "validate=no",
        ]);
        run_hidden(&mut command)?;
    }
    Ok(())
}

fn set_dns_with_netsh_elevated(interface_name: &str, servers: &[String]) -> Result<(), String> {
    let marker = std::env::temp_dir().join(format!(
        "mcstartup-dns-result-{}.ok",
        uuid::Uuid::new_v4().simple()
    ));
    let script_path = std::env::temp_dir().join(format!(
        "mcstartup-dns-set-{}.ps1",
        uuid::Uuid::new_v4().simple()
    ));
    let script = dns_admin_script(interface_name, servers, &marker);
    std::fs::write(&script_path, script).map_err(|e| format!("写入 DNS 管理员脚本失败: {}", e))?;

    let argument_list = format!(
        "-NoProfile -ExecutionPolicy Bypass -File \"{}\"",
        script_path.to_string_lossy().replace('"', "`\"")
    );
    let launch_script = format!(
        "$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '{}'; exit $p.ExitCode",
        escape_powershell_single_quote(&argument_list)
    );

    let mut command = Command::new("powershell");
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &launch_script,
    ]);
    let output = command
        .output()
        .map_err(|e| format!("启动管理员 PowerShell 失败: {}", e))?;
    let marker_exists = marker.exists();
    let _ = std::fs::remove_file(&marker);
    let _ = std::fs::remove_file(&script_path);

    if marker_exists {
        return Ok(());
    }

    let stderr = decode_command_output(&output.stderr).trim().to_string();
    let stdout = decode_command_output(&output.stdout).trim().to_string();
    if !stderr.is_empty() {
        return Err(format!("管理员 DNS 设置失败: {}", stderr));
    }
    if !stdout.is_empty() {
        return Err(format!("管理员 DNS 设置失败: {}", stdout));
    }
    if !output.status.success() {
        return Err("管理员 DNS 设置未完成，可能取消了 UAC 授权。".to_string());
    }
    Err("管理员 DNS 设置未确认完成。".to_string())
}

fn dns_admin_script(interface_name: &str, servers: &[String], marker: &std::path::Path) -> String {
    let escaped_name = escape_powershell_single_quote(interface_name);
    let marker = escape_powershell_single_quote(&marker.to_string_lossy());
    let mut script = String::from("$ErrorActionPreference = 'Stop'\r\n");
    if servers.is_empty() {
        script.push_str(&format!(
            "& netsh interface ipv4 set dnsservers name='{}' source=dhcp\r\n",
            escaped_name
        ));
    } else {
        script.push_str(&format!(
            "& netsh interface ipv4 set dnsservers name='{}' static {} primary validate=no\r\n",
            escaped_name, servers[0]
        ));
        for (index, server) in servers.iter().enumerate().skip(1) {
            script.push_str(&format!(
                "& netsh interface ipv4 add dnsservers name='{}' {} index={} validate=no\r\n",
                escaped_name,
                server,
                index + 1
            ));
        }
    }
    script.push_str(&format!(
        "Set-Content -LiteralPath '{}' -Value 'ok' -Encoding ASCII\r\n",
        marker
    ));
    script
}

fn is_elevation_required_error(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower.contains("requires elevation")
        || lower.contains("requested operation requires elevation")
        || lower.contains("请求的操作需要提升")
        || lower.contains("拒绝访问")
        || lower.contains("access is denied")
        || lower.contains("access denied")
}

fn system_network_repair_snapshot_blocking() -> Result<NetworkRepairSnapshot, String> {
    let generated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let is_admin = network_repair_is_admin();
    let mut checks = Vec::new();
    let adapters = match collect_network_repair_adapters() {
        Ok(rows) => rows,
        Err(err) => {
            checks.push(NetworkRepairCheck {
                id: "adapter-read".to_string(),
                label: "网卡读取".to_string(),
                target: "Get-NetAdapter / netsh".to_string(),
                status: "fail".to_string(),
                detail: err,
                latency_ms: None,
            });
            Vec::new()
        }
    };

    checks.extend(build_network_repair_checks(&adapters));
    let proxy = collect_network_repair_proxy();
    let hosts = collect_network_repair_hosts();
    let suggestions = network_repair_suggestions(&adapters, &checks, &proxy, &hosts, is_admin);

    Ok(NetworkRepairSnapshot {
        generated_at,
        is_admin,
        adapters,
        checks,
        proxy,
        hosts,
        suggestions,
    })
}

fn system_network_repair_action_blocking(
    request: NetworkRepairActionRequest,
) -> Result<NetworkRepairActionResult, String> {
    let action = request.action.trim().to_string();
    let (needs_reboot, message, output) = match action.as_str() {
        "flush-dns" => (
            false,
            "DNS 缓存已刷新".to_string(),
            run_program_output("ipconfig", &["/flushdns"])?,
        ),
        "reset-proxy" => (
            false,
            "系统代理已重置".to_string(),
            run_network_repair_powershell_action(
                r#"
$ErrorActionPreference = 'Stop'
& netsh winhttp reset proxy | Out-Null
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $path -Name ProxyEnable -Value 0
Remove-ItemProperty -Path $path -Name ProxyServer -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $path -Name AutoConfigURL -ErrorAction SilentlyContinue
"#,
                "系统代理重置完成",
            )?,
        ),
        "release-renew" => {
            let release = run_program_output("ipconfig", &["/release"])
                .unwrap_or_else(|err| format!("释放 IP 时返回：{}", err));
            let renew = run_program_output("ipconfig", &["/renew"])?;
            (
                false,
                "已执行 IP 释放和续租".to_string(),
                format!("{}\n\n{}", release, renew),
            )
        }
        "winsock-reset" => (
            true,
            "Winsock 已重置，建议重启电脑后生效".to_string(),
            run_netsh_or_elevated(&["winsock", "reset"], "& netsh winsock reset")?,
        ),
        "tcpip-reset" => (
            true,
            "TCP/IP 协议栈已重置，建议重启电脑后生效".to_string(),
            run_netsh_or_elevated(&["int", "ip", "reset"], "& netsh int ip reset")?,
        ),
        "dns-auto" => {
            let targets = network_repair_target_adapters(request.interface_index)?;
            let output = set_network_repair_dns(&targets, &[])?;
            (
                false,
                format!("已将 {} 个网卡恢复为自动 DNS", targets.len()),
                output,
            )
        }
        "dns-preset" => {
            let preset = request
                .dns_preset
                .as_deref()
                .ok_or_else(|| "请选择 DNS 方案".to_string())?;
            let (label, servers) =
                network_repair_dns_preset(preset).ok_or_else(|| "DNS 方案无效".to_string())?;
            let targets = network_repair_target_adapters(request.interface_index)?;
            let output = set_network_repair_dns(&targets, &servers)?;
            (
                false,
                format!("已为 {} 个网卡设置 {}", targets.len(), label),
                output,
            )
        }
        "hosts-reset" => (
            false,
            "Hosts 已恢复为 Windows 默认内容".to_string(),
            reset_network_repair_hosts()?,
        ),
        "restart-adapter" => {
            let targets = network_repair_target_adapters(request.interface_index)?;
            let output = restart_network_repair_adapters(&targets)?;
            (false, format!("已重启 {} 个网卡", targets.len()), output)
        }
        _ => return Err("网络急救操作无效".to_string()),
    };

    let snapshot = system_network_repair_snapshot_blocking()?;
    Ok(NetworkRepairActionResult {
        success: true,
        needs_reboot,
        message,
        output,
        snapshot,
    })
}

fn collect_network_repair_adapters() -> Result<Vec<NetworkRepairAdapter>, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$adapters = @(Get-NetAdapter | Sort-Object Status, Name)
$configs = @(Get-NetIPConfiguration)
$dnsRows = @(Get-DnsClientServerAddress -AddressFamily IPv4)
$rows = foreach ($adapter in $adapters) {
  $cfg = @($configs | Where-Object { $_.InterfaceIndex -eq $adapter.ifIndex } | Select-Object -First 1)
  $dns = @($dnsRows | Where-Object { $_.InterfaceIndex -eq $adapter.ifIndex } | Select-Object -First 1)
  [pscustomobject]@{
    InterfaceIndex = "$($adapter.ifIndex)"
    Name = "$($adapter.Name)"
    Description = "$($adapter.InterfaceDescription)"
    Status = "$($adapter.Status)"
    MacAddress = "$($adapter.MacAddress)"
    LinkSpeed = "$($adapter.LinkSpeed)"
    IpAddresses = @($cfg.IPv4Address | ForEach-Object { "$($_.IPAddress)" })
    Gateways = @($cfg.IPv4DefaultGateway | ForEach-Object { "$($_.NextHop)" })
    DnsServers = @($dns.ServerAddresses | ForEach-Object { "$_" })
  }
}
$rows | ConvertTo-Json -Depth 5 -Compress
"#;
    let rows = powershell_json_rows(script)
        .ok()
        .and_then(|values| {
            let parsed = values
                .into_iter()
                .filter_map(|value| network_repair_adapter_from_json(&value))
                .collect::<Vec<_>>();
            if parsed.is_empty() {
                None
            } else {
                Some(parsed)
            }
        })
        .or_else(|| {
            collect_dns_adapters_with_netsh().ok().map(|rows| {
                rows.into_iter()
                    .map(|item| NetworkRepairAdapter {
                        interface_index: item.interface_index,
                        name: item.name,
                        description: item.description,
                        status: item.status,
                        mac_address: item.mac_address,
                        link_speed: String::new(),
                        ip_addresses: Vec::new(),
                        gateways: Vec::new(),
                        dns_servers: item.dns_servers,
                    })
                    .collect::<Vec<_>>()
            })
        })
        .ok_or_else(|| "未读取到网络适配器".to_string())?;
    Ok(rows)
}

fn network_repair_adapter_from_json(value: &serde_json::Value) -> Option<NetworkRepairAdapter> {
    let interface_index = json_u32(value, "InterfaceIndex")?;
    let name = json_string(value, "Name");
    if name.is_empty() {
        return None;
    }
    Some(NetworkRepairAdapter {
        interface_index,
        name,
        description: json_string(value, "Description"),
        status: json_string(value, "Status"),
        mac_address: json_string(value, "MacAddress"),
        link_speed: json_string(value, "LinkSpeed"),
        ip_addresses: json_string_vec(value, "IpAddresses"),
        gateways: json_string_vec(value, "Gateways"),
        dns_servers: json_string_vec(value, "DnsServers"),
    })
}

fn build_network_repair_checks(adapters: &[NetworkRepairAdapter]) -> Vec<NetworkRepairCheck> {
    let mut checks = Vec::new();
    let active_adapters = adapters
        .iter()
        .filter(|item| network_repair_adapter_is_up(&item.status))
        .collect::<Vec<_>>();

    checks.push(NetworkRepairCheck {
        id: "adapter".to_string(),
        label: "网卡状态".to_string(),
        target: "本机网络适配器".to_string(),
        status: if active_adapters.is_empty() {
            "fail".to_string()
        } else {
            "ok".to_string()
        },
        detail: if active_adapters.is_empty() {
            "未检测到已连接网卡".to_string()
        } else {
            format!(
                "已连接 {} 个网卡：{}",
                active_adapters.len(),
                active_adapters
                    .iter()
                    .map(|item| item.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        },
        latency_ms: None,
    });

    let gateway = active_adapters
        .iter()
        .flat_map(|item| item.gateways.iter())
        .find(|item| !item.trim().is_empty())
        .cloned();
    if let Some(gateway) = gateway {
        checks.push(ping_network_repair_target("gateway", "默认网关", &gateway));
    } else {
        checks.push(NetworkRepairCheck {
            id: "gateway".to_string(),
            label: "默认网关".to_string(),
            target: "本机路由".to_string(),
            status: "warn".to_string(),
            detail: "未读取到 IPv4 默认网关".to_string(),
            latency_ms: None,
        });
    }

    checks.push(ping_network_repair_target(
        "public-ip",
        "公网连通",
        "223.5.5.5",
    ));
    checks.push(tcp_network_repair_check(
        "https-baidu",
        "HTTPS 访问",
        "www.baidu.com",
        443,
    ));
    checks.push(dns_network_repair_check(
        "dns-baidu",
        "DNS 解析",
        "www.baidu.com",
    ));
    checks.push(dns_network_repair_check(
        "dns-microsoft",
        "备用解析",
        "www.microsoft.com",
    ));
    checks
}

fn ping_network_repair_target(id: &str, label: &str, target: &str) -> NetworkRepairCheck {
    let start = Instant::now();
    let mut command = Command::new("ping");
    command.args(["-n", "1", "-w", "1200", target]);
    match command_output_bytes_hidden(&mut command) {
        Ok(output) => {
            let combined = format!(
                "{}\n{}",
                decode_command_output(&output.stdout),
                decode_command_output(&output.stderr)
            );
            NetworkRepairCheck {
                id: id.to_string(),
                label: label.to_string(),
                target: target.to_string(),
                status: if output.status.success() {
                    "ok".to_string()
                } else {
                    "fail".to_string()
                },
                detail: network_repair_first_meaningful_line(&combined).unwrap_or_else(|| {
                    if output.status.success() {
                        "Ping 成功"
                    } else {
                        "Ping 失败"
                    }
                    .to_string()
                }),
                latency_ms: Some(start.elapsed().as_millis()),
            }
        }
        Err(err) => NetworkRepairCheck {
            id: id.to_string(),
            label: label.to_string(),
            target: target.to_string(),
            status: "fail".to_string(),
            detail: err,
            latency_ms: Some(start.elapsed().as_millis()),
        },
    }
}

fn dns_network_repair_check(id: &str, label: &str, host: &str) -> NetworkRepairCheck {
    let start = Instant::now();
    match (host, 443).to_socket_addrs() {
        Ok(addresses) => {
            let ips = addresses
                .map(|address| address.ip().to_string())
                .collect::<HashSet<_>>()
                .into_iter()
                .take(6)
                .collect::<Vec<_>>();
            NetworkRepairCheck {
                id: id.to_string(),
                label: label.to_string(),
                target: host.to_string(),
                status: if ips.is_empty() {
                    "fail".to_string()
                } else {
                    "ok".to_string()
                },
                detail: if ips.is_empty() {
                    "没有返回解析地址".to_string()
                } else {
                    format!("解析到 {}", ips.join(", "))
                },
                latency_ms: Some(start.elapsed().as_millis()),
            }
        }
        Err(err) => NetworkRepairCheck {
            id: id.to_string(),
            label: label.to_string(),
            target: host.to_string(),
            status: "fail".to_string(),
            detail: format!("解析失败: {}", err),
            latency_ms: Some(start.elapsed().as_millis()),
        },
    }
}

fn tcp_network_repair_check(id: &str, label: &str, host: &str, port: u16) -> NetworkRepairCheck {
    let start = Instant::now();
    let target = format!("{}:{}", host, port);
    let addresses = match (host, port).to_socket_addrs() {
        Ok(rows) => rows.collect::<Vec<_>>(),
        Err(err) => {
            return NetworkRepairCheck {
                id: id.to_string(),
                label: label.to_string(),
                target,
                status: "fail".to_string(),
                detail: format!("解析失败: {}", err),
                latency_ms: Some(start.elapsed().as_millis()),
            };
        }
    };
    for address in addresses.iter().take(6) {
        if std::net::TcpStream::connect_timeout(address, Duration::from_millis(1600)).is_ok() {
            return NetworkRepairCheck {
                id: id.to_string(),
                label: label.to_string(),
                target,
                status: "ok".to_string(),
                detail: format!("已连接 {}", address),
                latency_ms: Some(start.elapsed().as_millis()),
            };
        }
    }
    NetworkRepairCheck {
        id: id.to_string(),
        label: label.to_string(),
        target,
        status: "fail".to_string(),
        detail: "TCP 连接失败".to_string(),
        latency_ms: Some(start.elapsed().as_millis()),
    }
}

fn collect_network_repair_proxy() -> NetworkRepairProxyInfo {
    let winhttp = {
        let mut command = Command::new("netsh");
        command.args(["winhttp", "show", "proxy"]);
        command_output_hidden(&mut command).unwrap_or_else(|err| err)
    };

    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$item = Get-ItemProperty -Path $path
[pscustomobject]@{
  ProxyEnable = "$($item.ProxyEnable)"
  ProxyServer = "$($item.ProxyServer)"
} | ConvertTo-Json -Compress
"#;
    let value = powershell_json_rows(script)
        .ok()
        .and_then(|mut rows| rows.pop());
    let user_proxy_enabled = value
        .as_ref()
        .and_then(|item| item.get("ProxyEnable"))
        .and_then(|item| item.as_str())
        .map(|item| item.trim() == "1")
        .unwrap_or(false);
    let user_proxy_server = value
        .as_ref()
        .map(|item| json_string(item, "ProxyServer"))
        .unwrap_or_default();

    NetworkRepairProxyInfo {
        winhttp,
        user_proxy_enabled,
        user_proxy_server,
    }
}

fn collect_network_repair_hosts() -> NetworkRepairHostsInfo {
    let path = hosts_path();
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let mut custom_entries = 0usize;
    let mut suspicious_entries = Vec::new();
    let watched_domains = [
        "microsoft",
        "windowsupdate",
        "download.windowsupdate",
        "github",
        "baidu",
        "qq.com",
        "weixin",
        "google",
        "cloudflare",
        "dns",
    ];
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let lower = trimmed.to_lowercase();
        let is_localhost = lower.contains("localhost")
            && (lower.starts_with("127.0.0.1") || lower.starts_with("::1"));
        if !is_localhost {
            custom_entries += 1;
        }
        if watched_domains.iter().any(|domain| lower.contains(domain)) {
            suspicious_entries.push(trimmed.to_string());
        }
    }
    suspicious_entries.truncate(12);
    NetworkRepairHostsInfo {
        path: path.to_string_lossy().to_string(),
        writable: can_write_hosts_directly(),
        custom_entries,
        suspicious_entries,
    }
}

fn network_repair_suggestions(
    adapters: &[NetworkRepairAdapter],
    checks: &[NetworkRepairCheck],
    proxy: &NetworkRepairProxyInfo,
    hosts: &NetworkRepairHostsInfo,
    is_admin: bool,
) -> Vec<String> {
    let mut suggestions = Vec::new();
    if adapters
        .iter()
        .all(|item| !network_repair_adapter_is_up(&item.status))
    {
        suggestions
            .push("没有已连接网卡，先检查网线、Wi-Fi、飞行模式或网卡是否被禁用。".to_string());
    }
    if checks
        .iter()
        .any(|item| item.id == "gateway" && item.status == "fail")
    {
        suggestions.push("默认网关不可达，优先重启路由器或重新获取 IP。".to_string());
    }
    if checks
        .iter()
        .any(|item| item.id == "public-ip" && item.status == "fail")
    {
        suggestions
            .push("公网 IP 不通，可尝试释放/续租 IP、重置 TCP/IP 或联系网络运营商。".to_string());
    }
    if checks
        .iter()
        .any(|item| item.id.starts_with("dns-") && item.status == "fail")
    {
        suggestions
            .push("DNS 解析异常，可先刷新 DNS 缓存，再切换到阿里 DNS 或 DNSPod。".to_string());
    }
    if proxy.user_proxy_enabled || proxy.winhttp.to_lowercase().contains("proxy server") {
        suggestions
            .push("检测到系统代理配置；如果当前没有使用代理/VPN，可尝试重置代理。".to_string());
    }
    if !hosts.suspicious_entries.is_empty() {
        suggestions.push(
            "Hosts 中存在常见域名映射，若不是你主动配置，建议查看或恢复默认 Hosts。".to_string(),
        );
    }
    if !is_admin {
        suggestions.push("部分修复项需要管理员权限，点击时会请求 UAC 授权。".to_string());
    }
    if suggestions.is_empty() {
        suggestions
            .push("基础网络检查通过，若单个网站打不开，可继续做 DNS 查询或路由追踪。".to_string());
    }
    suggestions
}

fn network_repair_is_admin() -> bool {
    let script = r#"
$current = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]$current
$principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
"#;
    let mut command = Command::new("powershell");
    let script = with_utf8_powershell_output(script);
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    command_output_hidden(&mut command)
        .map(|value| value.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn network_repair_target_adapters(
    interface_index: Option<u32>,
) -> Result<Vec<NetworkRepairAdapter>, String> {
    let adapters = collect_network_repair_adapters()?;
    if let Some(index) = interface_index.filter(|value| *value > 0) {
        return adapters
            .into_iter()
            .find(|item| item.interface_index == index)
            .map(|item| vec![item])
            .ok_or_else(|| "未找到选中的网卡".to_string());
    }
    let rows = adapters
        .into_iter()
        .filter(|item| network_repair_adapter_is_up(&item.status))
        .collect::<Vec<_>>();
    if rows.is_empty() {
        Err("未找到已连接网卡".to_string())
    } else {
        Ok(rows)
    }
}

fn set_network_repair_dns(
    targets: &[NetworkRepairAdapter],
    servers: &[String],
) -> Result<String, String> {
    let mut output = Vec::new();
    for adapter in targets {
        set_dns_with_netsh(&adapter.name, servers)
            .map_err(|err| format!("{} DNS 设置失败: {}", adapter.name, err))?;
        output.push(format!(
            "{} => {}",
            adapter.name,
            if servers.is_empty() {
                "自动获取".to_string()
            } else {
                servers.join(", ")
            }
        ));
    }
    Ok(output.join("\n"))
}

fn restart_network_repair_adapters(targets: &[NetworkRepairAdapter]) -> Result<String, String> {
    let names = targets
        .iter()
        .map(|item| format!("'{}'", escape_powershell_single_quote(&item.name)))
        .collect::<Vec<_>>()
        .join(",");
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$names = @({names})
foreach ($name in $names) {{
  Restart-NetAdapter -Name $name -Confirm:$false
}}
"#
    );
    run_network_repair_powershell_action(&script, "网卡重启命令已执行")
}

fn reset_network_repair_hosts() -> Result<String, String> {
    let path = hosts_path();
    let backup_path = std::env::temp_dir().join(format!(
        "mcstartup-hosts-backup-{}.txt",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    std::fs::write(&backup_path, current).map_err(|e| format!("备份 Hosts 失败: {}", e))?;
    let default_hosts = default_windows_hosts_content();
    if can_write_hosts_directly() {
        std::fs::write(&path, normalize_hosts_content(default_hosts))
            .map_err(|e| format!("重置 Hosts 失败: {}", e))?;
    } else {
        let temp_path = std::env::temp_dir().join(format!(
            "mcstartup-hosts-reset-{}.tmp",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::write(&temp_path, normalize_hosts_content(default_hosts))
            .map_err(|e| format!("写入临时 Hosts 失败: {}", e))?;
        let status = copy_hosts_with_elevation(&temp_path, &path)?;
        let _ = std::fs::remove_file(temp_path);
        if !status && !hosts_content_matches(default_hosts) {
            return Err("管理员重置 Hosts 未完成，可能取消了 UAC 授权。".to_string());
        }
    }
    Ok(format!(
        "已备份原 Hosts 到 {}\n已恢复默认 Hosts",
        backup_path.to_string_lossy()
    ))
}

fn default_windows_hosts_content() -> &'static str {
    "# Copyright (c) Microsoft Corp.\r\n#\r\n# This is a sample HOSTS file used by Microsoft TCP/IP for Windows.\r\n#\r\n127.0.0.1 localhost\r\n::1 localhost\r\n"
}

fn run_netsh_or_elevated(args: &[&str], elevated_script: &str) -> Result<String, String> {
    match run_program_output("netsh", args) {
        Ok(output) => Ok(output),
        Err(err) if is_elevation_required_error(&err) => {
            run_powershell_script_with_elevation(elevated_script)
                .map_err(|e| format!("需要管理员权限：{}。{}", err, e))?;
            Ok("已通过管理员权限执行".to_string())
        }
        Err(err) => Err(err),
    }
}

fn run_network_repair_powershell_action(
    script: &str,
    success_text: &str,
) -> Result<String, String> {
    match run_powershell_script_hidden(script) {
        Ok(()) => Ok(success_text.to_string()),
        Err(err)
            if is_elevation_required_error(&err)
                || err.to_lowercase().contains("administrator") =>
        {
            run_powershell_script_with_elevation(script)
                .map_err(|e| format!("需要管理员权限：{}。{}", err, e))?;
            Ok("已通过管理员权限执行".to_string())
        }
        Err(err) => Err(err),
    }
}

fn run_program_output(program: &str, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(program);
    command.args(args);
    let output = command_output_bytes_hidden(&mut command)?;
    let stdout = decode_command_output(&output.stdout).trim().to_string();
    let stderr = decode_command_output(&output.stderr).trim().to_string();
    if output.status.success() {
        if stdout.is_empty() {
            Ok("执行完成".to_string())
        } else {
            Ok(stdout)
        }
    } else if !stderr.is_empty() {
        Err(stderr)
    } else if !stdout.is_empty() {
        Err(stdout)
    } else {
        Err(format!("{} 执行失败", program))
    }
}

fn network_repair_dns_preset(id: &str) -> Option<(String, Vec<String>)> {
    let (label, servers) = match id {
        "alidns" => ("阿里 DNS", ["223.5.5.5", "223.6.6.6"]),
        "dnspod" => ("DNSPod", ["119.29.29.29", "182.254.116.116"]),
        "114dns" => ("114 DNS", ["114.114.114.114", "114.114.115.115"]),
        "cloudflare" => ("Cloudflare", ["1.1.1.1", "1.0.0.1"]),
        "google" => ("Google DNS", ["8.8.8.8", "8.8.4.4"]),
        _ => return None,
    };
    Some((
        label.to_string(),
        servers.iter().map(|item| item.to_string()).collect(),
    ))
}

fn network_repair_adapter_is_up(status: &str) -> bool {
    let lower = status.to_lowercase();
    matches!(lower.as_str(), "up" | "connected" | "已连接")
}

fn json_u32(value: &serde_json::Value, key: &str) -> Option<u32> {
    value.get(key).and_then(|item| {
        item.as_u64()
            .and_then(|value| u32::try_from(value).ok())
            .or_else(|| item.as_str()?.trim().parse::<u32>().ok())
    })
}

fn json_string_vec(value: &serde_json::Value, key: &str) -> Vec<String> {
    match value.get(key) {
        Some(serde_json::Value::Array(rows)) => rows
            .iter()
            .filter_map(|item| {
                item.as_str()
                    .map(|value| value.trim().to_string())
                    .or_else(|| item.as_i64().map(|value| value.to_string()))
            })
            .filter(|item| !item.is_empty())
            .collect(),
        Some(serde_json::Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Vec::new()
            } else {
                vec![trimmed.to_string()]
            }
        }
        Some(serde_json::Value::Number(number)) => vec![number.to_string()],
        _ => Vec::new(),
    }
}

fn network_repair_first_meaningful_line(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find(|line| {
            !line.is_empty()
                && !line.starts_with("Pinging ")
                && !line.starts_with("正在 Ping ")
                && !line.starts_with("Ping statistics")
                && !line.starts_with("Ping 统计信息")
        })
        .map(|line| line.chars().take(180).collect())
}

fn service_state_rank(value: &str) -> u8 {
    match value.to_lowercase().as_str() {
        "running" => 0,
        "start pending" => 1,
        "stop pending" => 2,
        "stopped" => 3,
        _ => 9,
    }
}

fn task_state_rank(value: &str) -> u8 {
    match value.to_lowercase().as_str() {
        "running" => 0,
        "ready" => 1,
        "queued" => 2,
        "disabled" => 3,
        _ => 9,
    }
}

fn env_scope_target(scope: &str) -> Result<&'static str, String> {
    match scope {
        "user" => Ok("User"),
        "machine" => Ok("Machine"),
        _ => Err("环境变量范围无效".to_string()),
    }
}

fn env_vars_for_scope(target: &str) -> Result<Vec<(String, String)>, String> {
    let script = format!(
        "[Environment]::GetEnvironmentVariables('{}').GetEnumerator() | ForEach-Object {{ [pscustomobject]@{{ Name = $_.Key; Value = $_.Value }} }} | ConvertTo-Json -Compress",
        target
    );
    let mut rows = powershell_json_rows(&script)?
        .into_iter()
        .map(|value| (json_string(&value, "Name"), json_string(&value, "Value")))
        .filter(|(name, _)| !name.is_empty())
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    Ok(rows)
}

fn build_env_set_script(name: &str, value: Option<&str>, target: &str) -> String {
    let value = value
        .map(|text| format!("'{}'", escape_powershell_single_quote(text)))
        .unwrap_or_else(|| "$null".to_string());
    format!(
        "[Environment]::SetEnvironmentVariable('{}', {}, '{}')",
        escape_powershell_single_quote(name),
        value,
        target
    )
}

fn run_env_write_script(script: &str, target: &str, label: &str) -> Result<(), String> {
    match run_powershell_script_hidden(script) {
        Ok(()) => {
            sync_process_environment();
            broadcast_environment_change();
            Ok(())
        }
        Err(err) if target.eq_ignore_ascii_case("Machine") && is_elevation_required_error(&err) => {
            run_powershell_script_with_elevation(script)
                .map_err(|e| format!("{}需要管理员权限：{}。{}", label, err, e))?;
            sync_process_environment();
            broadcast_environment_change();
            Ok(())
        }
        Err(err) => Err(err),
    }
}

fn broadcast_environment_change() {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        const HWND_BROADCAST: isize = 0xffff;
        const WM_SETTINGCHANGE: u32 = 0x001A;
        const SMTO_ABORTIFHUNG: u32 = 0x0002;

        #[link(name = "user32")]
        extern "system" {
            fn SendMessageTimeoutW(
                hWnd: isize,
                Msg: u32,
                wParam: usize,
                lParam: *const u16,
                fuFlags: u32,
                uTimeout: u32,
                lpdwResult: *mut usize,
            ) -> isize;
        }

        let area: Vec<u16> = OsStr::new("Environment")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            let mut result: usize = 0;
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                area.as_ptr(),
                SMTO_ABORTIFHUNG,
                1000,
                &mut result,
            );
        }
    }
}

fn environment_expansion_map(scope: Option<&str>) -> HashMap<String, String> {
    let mut values = std::env::vars()
        .map(|(key, value)| (key.to_uppercase(), value))
        .collect::<HashMap<_, _>>();

    for target in ["Machine", "User"] {
        if let Ok(rows) = env_vars_for_scope(target) {
            for (key, value) in rows {
                values.insert(key.to_uppercase(), value);
            }
        }
        if matches!(scope, Some("machine")) && target == "Machine" {
            break;
        }
    }

    values
}

fn sync_process_environment() {
    let machine = env_vars_for_scope("Machine").unwrap_or_default();
    let user = env_vars_for_scope("User").unwrap_or_default();
    let mut merged = HashMap::<String, (String, String)>::new();

    for (name, value) in machine.iter().chain(user.iter()) {
        if !name.eq_ignore_ascii_case("Path") {
            merged.insert(name.to_uppercase(), (name.clone(), value.clone()));
        }
    }

    for (_, (name, value)) in merged {
        std::env::set_var(name, value);
    }

    let machine_path = machine
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("Path"))
        .map(|(_, value)| value.as_str())
        .unwrap_or_default();
    let user_path = user
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("Path"))
        .map(|(_, value)| value.as_str())
        .unwrap_or_default();
    let merged_path = [machine_path, user_path]
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(";");
    if !merged_path.is_empty() {
        std::env::set_var("Path", merged_path);
    }
}

fn sync_process_variable_after_delete(name: &str) {
    let user_value = env_vars_for_scope("User")
        .unwrap_or_default()
        .into_iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value);
    let machine_value = env_vars_for_scope("Machine")
        .unwrap_or_default()
        .into_iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value);

    match user_value.or(machine_value) {
        Some(value) => std::env::set_var(name, value),
        None => std::env::remove_var(name),
    }
}

fn expand_environment_path(value: &str, env_map: &HashMap<String, String>) -> String {
    let mut expanded = String::with_capacity(value.len());
    let chars = value.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '%' {
            if let Some(end) = chars[index + 1..].iter().position(|ch| *ch == '%') {
                let end_index = index + 1 + end;
                let name = chars[index + 1..end_index].iter().collect::<String>();
                if !name.is_empty() {
                    if let Some(replacement) = env_map.get(&name.to_uppercase()) {
                        expanded.push_str(replacement);
                        index = end_index + 1;
                        continue;
                    }
                }
            }
        }
        expanded.push(chars[index]);
        index += 1;
    }
    expanded
}

fn normalize_path_for_filesystem(path: &str) -> String {
    let mut value = path.trim().trim_end_matches(';').trim().to_string();
    if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
        value = value[1..value.len() - 1].trim().to_string();
    }
    value
}

fn normalize_path_identity(path: &str) -> String {
    let normalized = normalize_path_for_filesystem(path).replace('/', "\\");
    let trimmed = normalized.trim_end_matches('\\').to_lowercase();
    if trimmed.len() == 2 && trimmed.ends_with(':') {
        format!("{}\\", trimmed)
    } else {
        trimmed
    }
}

fn dedupe_paths(paths: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for path in paths {
        let value = normalize_path_for_filesystem(&path);
        if value.is_empty() {
            continue;
        }
        let key = normalize_path_identity(&value);
        if seen.insert(key) {
            result.push(value);
        }
    }
    result
}

#[derive(Clone, Copy)]
struct ContextMenuScope {
    hive: winreg::HKEY,
    root: &'static str,
    registry_label: &'static str,
    scope: &'static str,
    label: &'static str,
    path: &'static str,
}

fn context_menu_scopes() -> Vec<ContextMenuScope> {
    use winreg::enums::*;
    vec![
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "desktop",
            label: "桌面背景",
            path: r"Software\Classes\Directory\Background\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "desktop-background",
            label: "桌面背景类",
            path: r"Software\Classes\DesktopBackground\Shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "folder",
            label: "文件夹",
            path: r"Software\Classes\Directory\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "folder-root",
            label: "Folder 类",
            path: r"Software\Classes\Folder\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "file",
            label: "所有文件",
            path: r"Software\Classes\*\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "all-filesystem",
            label: "全部文件系统对象",
            path: r"Software\Classes\AllFilesystemObjects\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "drive",
            label: "磁盘驱动器",
            path: r"Software\Classes\Drive\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "library",
            label: "库",
            path: r"Software\Classes\LibraryFolder\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "shortcut",
            label: "快捷方式",
            path: r"Software\Classes\lnkfile\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "executable",
            label: "可执行文件",
            path: r"Software\Classes\exefile\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "image",
            label: "图片文件",
            path: r"Software\Classes\SystemFileAssociations\image\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "audio",
            label: "音频文件",
            path: r"Software\Classes\SystemFileAssociations\audio\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "video",
            label: "视频文件",
            path: r"Software\Classes\SystemFileAssociations\video\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "this-pc",
            label: "此电脑",
            path: r"Software\Classes\CLSID\{20D04FE0-3AEA-1069-A2D8-08002B30309D}\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "recycle-bin",
            label: "回收站",
            path: r"Software\Classes\CLSID\{645FF040-5081-101B-9F08-00AA002F954E}\shell",
        },
        ContextMenuScope {
            hive: HKEY_CURRENT_USER,
            root: "HKCU",
            registry_label: "HKCU",
            scope: "network",
            label: "网络",
            path: r"Software\Classes\CLSID\{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "desktop",
            label: "桌面背景（系统）",
            path: r"Directory\Background\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "desktop-background",
            label: "桌面背景类（系统）",
            path: r"DesktopBackground\Shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "folder",
            label: "文件夹（系统）",
            path: r"Directory\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "folder-root",
            label: "Folder 类（系统）",
            path: r"Folder\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "file",
            label: "所有文件（系统）",
            path: r"*\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "all-filesystem",
            label: "全部文件系统对象（系统）",
            path: r"AllFilesystemObjects\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "drive",
            label: "磁盘驱动器（系统）",
            path: r"Drive\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "library",
            label: "库（系统）",
            path: r"LibraryFolder\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "shortcut",
            label: "快捷方式（系统）",
            path: r"lnkfile\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "executable",
            label: "可执行文件（系统）",
            path: r"exefile\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "image",
            label: "图片文件（系统）",
            path: r"SystemFileAssociations\image\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "audio",
            label: "音频文件（系统）",
            path: r"SystemFileAssociations\audio\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "video",
            label: "视频文件（系统）",
            path: r"SystemFileAssociations\video\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "this-pc",
            label: "此电脑（系统）",
            path: r"CLSID\{20D04FE0-3AEA-1069-A2D8-08002B30309D}\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "recycle-bin",
            label: "回收站（系统）",
            path: r"CLSID\{645FF040-5081-101B-9F08-00AA002F954E}\shell",
        },
        ContextMenuScope {
            hive: HKEY_CLASSES_ROOT,
            root: "HKCR",
            registry_label: "HKCR",
            scope: "network",
            label: "网络（系统）",
            path: r"CLSID\{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}\shell",
        },
    ]
}

fn collect_context_menu_shell_entries(
    rows: &mut Vec<ContextMenuEntry>,
    root: &winreg::RegKey,
    scope: ContextMenuScope,
) {
    use winreg::enums::*;

    let Ok(shell_key) = root.open_subkey_with_flags(scope.path, KEY_READ) else {
        return;
    };
    for key_name in shell_key.enum_keys().filter_map(Result::ok) {
        let Ok(item_key) = shell_key.open_subkey_with_flags(&key_name, KEY_READ) else {
            continue;
        };
        let label = item_key
            .get_value::<String, _>("MUIVerb")
            .ok()
            .or_else(|| item_key.get_value::<String, _>("").ok())
            .unwrap_or_else(|| key_name.clone());
        let icon = item_key.get_value::<String, _>("Icon").unwrap_or_default();
        let shift_only = item_key.get_raw_value("Extended").is_ok();
        let disabled = item_key.get_raw_value("LegacyDisable").is_ok()
            || item_key.get_raw_value("ProgrammaticAccessOnly").is_ok();
        let position = item_key
            .get_value::<String, _>("Position")
            .unwrap_or_default();
        let command_path = format!(
            r"{}\command",
            context_menu_item_registry_path(scope, &key_name)
        );
        let command = item_key
            .open_subkey_with_flags("command", KEY_READ)
            .ok()
            .and_then(|command_key| command_key.get_value::<String, _>("").ok())
            .unwrap_or_default();
        if label.trim().is_empty() && command.trim().is_empty() {
            continue;
        }
        rows.push(ContextMenuEntry {
            id: format!("{}|{}|{}", scope.root, scope.path, key_name),
            root: scope.root.to_string(),
            source_label: context_menu_source_label(scope).to_string(),
            scope: scope.scope.to_string(),
            scope_label: scope.label.to_string(),
            menu_type: "shell".to_string(),
            menu_type_label: "命令菜单".to_string(),
            key: key_name.clone(),
            label,
            command,
            icon,
            shift_only,
            disabled,
            can_delete: true,
            can_edit: scope.root == "HKCU",
            registry_path: format!(r"{}\{}", scope.registry_label, scope.path),
            registry_item_path: context_menu_item_registry_path(scope, &key_name),
            command_registry_path: command_path,
            extension_id: String::new(),
            extension_name: String::new(),
            extension_server: String::new(),
            applies_to: context_menu_applies_to(scope.scope).to_string(),
            position,
            note: if disabled {
                "该项在注册表中被禁用或仅允许程序调用".to_string()
            } else {
                String::new()
            },
        });
    }
}

fn collect_context_menu_shellex_entries(
    rows: &mut Vec<ContextMenuEntry>,
    root: &winreg::RegKey,
    scope: ContextMenuScope,
) {
    use winreg::enums::*;

    for handler_name in ["ContextMenuHandlers", "DragDropHandlers"] {
        let base_path = context_menu_shellex_path(scope.path, handler_name);
        let Ok(base_key) = root.open_subkey_with_flags(&base_path, KEY_READ) else {
            continue;
        };
        for key_name in base_key.enum_keys().filter_map(Result::ok) {
            let Ok(item_key) = base_key.open_subkey_with_flags(&key_name, KEY_READ) else {
                continue;
            };
            let extension_id = item_key.get_value::<String, _>("").unwrap_or_default();
            if key_name.trim().is_empty() && extension_id.trim().is_empty() {
                continue;
            }
            let (extension_name, extension_server) = resolve_clsid_info(&extension_id);
            let menu_type_label = if handler_name == "DragDropHandlers" {
                "拖放扩展"
            } else {
                "扩展菜单"
            };
            rows.push(ContextMenuEntry {
                id: format!("{}|{}|{}", scope.root, base_path, key_name),
                root: scope.root.to_string(),
                source_label: context_menu_source_label(scope).to_string(),
                scope: scope.scope.to_string(),
                scope_label: scope.label.to_string(),
                menu_type: handler_name.to_string(),
                menu_type_label: menu_type_label.to_string(),
                key: key_name.clone(),
                label: key_name.clone(),
                command: String::new(),
                icon: String::new(),
                shift_only: false,
                disabled: false,
                can_delete: true,
                can_edit: false,
                registry_path: format!(r"{}\{}", scope.registry_label, base_path),
                registry_item_path: context_menu_item_registry_path_for_base(
                    scope, &base_path, &key_name,
                ),
                command_registry_path: String::new(),
                extension_id,
                extension_name,
                extension_server,
                applies_to: context_menu_applies_to(scope.scope).to_string(),
                position: String::new(),
                note:
                    "该项是 Explorer COM 扩展，通常由软件安装器写入；工具仅展示和删除，不编辑命令。"
                        .to_string(),
            });
        }
    }
}

fn collect_browser_context_menu_entries(rows: &mut Vec<ContextMenuEntry>) {
    for root in browser_context_roots() {
        collect_chromium_context_menu_entries(rows, root.browser, &root.user_data_dir);
    }
    collect_firefox_context_menu_entries(rows);
}

struct BrowserContextRoot {
    browser: &'static str,
    user_data_dir: PathBuf,
}

fn browser_context_roots() -> Vec<BrowserContextRoot> {
    let mut roots = Vec::new();
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let local = PathBuf::from(local_app_data);
        roots.push(BrowserContextRoot {
            browser: "Chrome",
            user_data_dir: local.join(r"Google\Chrome\User Data"),
        });
        roots.push(BrowserContextRoot {
            browser: "Edge",
            user_data_dir: local.join(r"Microsoft\Edge\User Data"),
        });
        roots.push(BrowserContextRoot {
            browser: "Brave",
            user_data_dir: local.join(r"BraveSoftware\Brave-Browser\User Data"),
        });
    }
    roots
}

fn collect_chromium_context_menu_entries(
    rows: &mut Vec<ContextMenuEntry>,
    browser: &str,
    user_data_dir: &Path,
) {
    let Ok(profile_dirs) = std::fs::read_dir(user_data_dir) else {
        return;
    };
    for profile_dir in profile_dirs.filter_map(Result::ok) {
        let profile_path = profile_dir.path();
        if !profile_path.is_dir() {
            continue;
        }
        let profile_name = profile_dir.file_name().to_string_lossy().to_string();
        if !is_chromium_profile_dir(&profile_name) {
            continue;
        }
        let extensions_dir = profile_path.join("Extensions");
        let Ok(extension_dirs) = std::fs::read_dir(&extensions_dir) else {
            continue;
        };
        for extension_dir in extension_dirs.filter_map(Result::ok) {
            let extension_path = extension_dir.path();
            if !extension_path.is_dir() {
                continue;
            }
            let extension_id = extension_dir.file_name().to_string_lossy().to_string();
            let Some(manifest_path) = latest_manifest_path(&extension_path) else {
                continue;
            };
            let Some(manifest) = read_json_file(&manifest_path) else {
                continue;
            };
            if !manifest_has_context_menu_permission(&manifest, "contextMenus")
                && !manifest_has_context_menu_permission(&manifest, "contextMenusInternal")
            {
                continue;
            }
            let extension_name = manifest_name(&manifest);
            let version = json_string(&manifest, "version");
            let note = if version.is_empty() {
                format!(
                    "{} 扩展声明了 contextMenus 权限。浏览器右键菜单由扩展运行时动态创建，工具只展示来源，禁用/删除请到浏览器扩展管理页处理。",
                    browser
                )
            } else {
                format!(
                    "{} 扩展声明了 contextMenus 权限，版本 {}。浏览器右键菜单由扩展运行时动态创建，工具只展示来源，禁用/删除请到浏览器扩展管理页处理。",
                    browser, version
                )
            };
            rows.push(browser_context_entry(
                browser,
                &profile_name,
                &extension_id,
                &extension_name,
                &manifest_path,
                &note,
            ));
        }
    }
}

fn collect_firefox_context_menu_entries(rows: &mut Vec<ContextMenuEntry>) {
    let Ok(app_data) = std::env::var("APPDATA") else {
        return;
    };
    let profiles_dir = PathBuf::from(app_data).join(r"Mozilla\Firefox\Profiles");
    let Ok(profile_dirs) = std::fs::read_dir(&profiles_dir) else {
        return;
    };
    for profile_dir in profile_dirs.filter_map(Result::ok) {
        let profile_path = profile_dir.path();
        if !profile_path.is_dir() {
            continue;
        }
        let profile_name = profile_dir.file_name().to_string_lossy().to_string();
        let extensions_dir = profile_path.join("extensions");
        let Ok(extension_paths) = std::fs::read_dir(&extensions_dir) else {
            continue;
        };
        for extension_path in extension_paths.filter_map(Result::ok) {
            let path = extension_path.path();
            if path.is_dir() {
                let manifest_path = path.join("manifest.json");
                collect_firefox_manifest_entry(rows, &profile_name, &manifest_path);
            } else if path.extension().and_then(|value| value.to_str()) == Some("xpi") {
                let extension_id = path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string();
                rows.push(browser_context_entry(
                    "Firefox",
                    &profile_name,
                    &extension_id,
                    &extension_id,
                    &path,
                    "Firefox 扩展包可能包含 menus/contextMenus 权限；XPI 未解包，工具只展示候选来源。",
                ));
            }
        }
    }
}

fn collect_firefox_manifest_entry(
    rows: &mut Vec<ContextMenuEntry>,
    profile_name: &str,
    manifest_path: &Path,
) {
    let Some(manifest) = read_json_file(manifest_path) else {
        return;
    };
    if !manifest_has_context_menu_permission(&manifest, "menus")
        && !manifest_has_context_menu_permission(&manifest, "contextMenus")
    {
        return;
    }
    let extension_id = manifest
        .get("browser_specific_settings")
        .and_then(|value| value.get("gecko"))
        .and_then(|value| value.get("id"))
        .and_then(|value| value.as_str())
        .or_else(|| {
            manifest
                .get("applications")
                .and_then(|value| value.get("gecko"))
                .and_then(|value| value.get("id"))
                .and_then(|value| value.as_str())
        })
        .unwrap_or_else(|| {
            manifest_path
                .parent()
                .and_then(|path| path.file_name())
                .and_then(|value| value.to_str())
                .unwrap_or("firefox-extension")
        })
        .to_string();
    let extension_name = manifest_name(&manifest);
    rows.push(browser_context_entry(
        "Firefox",
        profile_name,
        &extension_id,
        &extension_name,
        manifest_path,
        "Firefox 扩展声明了 menus/contextMenus 权限。浏览器右键菜单由扩展运行时动态创建，工具只展示来源，禁用/删除请到 Firefox 扩展管理页处理。",
    ));
}

fn is_chromium_profile_dir(name: &str) -> bool {
    name == "Default"
        || name.starts_with("Profile ")
        || name.starts_with("Guest Profile")
        || name.starts_with("System Profile")
}

fn latest_manifest_path(extension_path: &Path) -> Option<PathBuf> {
    let mut versions = std::fs::read_dir(extension_path)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.join("manifest.json").is_file())
        .collect::<Vec<_>>();
    versions.sort_by(|a, b| {
        path_modified_millis(b)
            .cmp(&path_modified_millis(a))
            .then_with(|| b.file_name().cmp(&a.file_name()))
    });
    versions
        .into_iter()
        .next()
        .map(|path| path.join("manifest.json"))
}

fn path_modified_millis(path: &Path) -> u128 {
    path.metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<serde_json::Value>(&text).ok()
}

fn manifest_name(manifest: &serde_json::Value) -> String {
    let raw_name = json_string(manifest, "name");
    if raw_name.starts_with("__MSG_") {
        raw_name
    } else if raw_name.is_empty() {
        "未命名扩展".to_string()
    } else {
        raw_name
    }
}

fn manifest_has_context_menu_permission(manifest: &serde_json::Value, permission: &str) -> bool {
    let direct = manifest
        .get("permissions")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .any(|item| item.eq_ignore_ascii_case(permission))
        })
        .unwrap_or(false);
    let optional = manifest
        .get("optional_permissions")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .any(|item| item.eq_ignore_ascii_case(permission))
        })
        .unwrap_or(false);
    direct || optional
}

fn browser_context_entry(
    browser: &str,
    profile_name: &str,
    extension_id: &str,
    extension_name: &str,
    manifest_path: &Path,
    note: &str,
) -> ContextMenuEntry {
    let key = format!("{}:{}", profile_name, extension_id);
    ContextMenuEntry {
        id: format!("BROWSER|{}|{}|{}", browser, profile_name, extension_id),
        root: "BROWSER".to_string(),
        source_label: browser.to_string(),
        scope: "browser".to_string(),
        scope_label: format!("{} 浏览器扩展", browser),
        menu_type: "browser-extension".to_string(),
        menu_type_label: "浏览器扩展菜单".to_string(),
        key,
        label: extension_name.to_string(),
        command: String::new(),
        icon: String::new(),
        shift_only: false,
        disabled: false,
        can_delete: false,
        can_edit: false,
        registry_path: manifest_path
            .parent()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        registry_item_path: manifest_path.to_string_lossy().to_string(),
        command_registry_path: String::new(),
        extension_id: extension_id.to_string(),
        extension_name: extension_name.to_string(),
        extension_server: manifest_path.to_string_lossy().to_string(),
        applies_to: "浏览器网页/链接/图片等右键，由扩展代码动态决定".to_string(),
        position: profile_name.to_string(),
        note: note.to_string(),
    }
}

fn context_menu_shellex_path(shell_path: &str, handler_name: &str) -> String {
    match shell_path.strip_suffix(r"\shell") {
        Some(base) => format!(r"{}\shellex\{}", base, handler_name),
        None => format!(r"{}\shellex\{}", shell_path, handler_name),
    }
}

fn resolve_clsid_info(clsid: &str) -> (String, String) {
    use winreg::enums::*;
    use winreg::RegKey;

    let clsid = clsid.trim();
    if clsid.is_empty() {
        return (String::new(), String::new());
    }
    let root = RegKey::predef(HKEY_CLASSES_ROOT);
    let path = format!(r"CLSID\{}", clsid);
    let Ok(key) = root.open_subkey_with_flags(&path, KEY_READ) else {
        return (String::new(), String::new());
    };
    let name = key.get_value::<String, _>("").unwrap_or_default();
    let server = key
        .open_subkey_with_flags("InprocServer32", KEY_READ)
        .ok()
        .and_then(|server_key| server_key.get_value::<String, _>("").ok())
        .unwrap_or_default();
    (name, server)
}

fn context_menu_item_registry_path(scope: ContextMenuScope, key_name: &str) -> String {
    let base = scope.path.to_string();
    context_menu_item_registry_path_for_base(scope, &base, key_name)
}

fn context_menu_item_registry_path_for_base(
    scope: ContextMenuScope,
    base_path: &str,
    key_name: &str,
) -> String {
    format!(r"{}\{}\{}", scope.registry_label, base_path, key_name)
}

fn context_menu_source_label(scope: ContextMenuScope) -> &'static str {
    match scope.root {
        "HKCU" => "当前用户",
        "HKCR" => "系统合并视图",
        _ => scope.root,
    }
}

fn context_menu_applies_to(scope: &str) -> &'static str {
    match scope {
        "desktop" => "在桌面空白处右键时显示",
        "folder" => "对文件夹右键时显示",
        "file" => "对任意文件右键时显示",
        _ => "右键菜单",
    }
}

fn sanitize_registry_key_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else if ch.is_whitespace() {
                '-'
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches(['-', '_', '.'])
        .to_string();
    if sanitized.is_empty() {
        format!("mcstartup-menu-{}", uuid::Uuid::new_v4().simple())
    } else {
        sanitized
    }
}

fn system_info_sections(value: &serde_json::Value) -> Vec<SystemInfoSection> {
    let mut sections = Vec::new();
    if let Some(os) = value.get("OS") {
        sections.push(SystemInfoSection {
            title: "操作系统".to_string(),
            items: vec![
                info_item("名称", json_string(os, "Caption")),
                info_item("版本", json_string(os, "Version")),
                info_item("构建号", json_string(os, "BuildNumber")),
                info_item("架构", json_string(os, "Architecture")),
                info_item("安装时间", json_string(os, "InstallDate")),
                info_item("上次启动", json_string(os, "LastBootUpTime")),
            ],
        });
    }
    if let Some(computer) = value.get("Computer") {
        sections.push(SystemInfoSection {
            title: "电脑".to_string(),
            items: vec![
                info_item("名称", json_string(computer, "Name")),
                info_item("厂商", json_string(computer, "Manufacturer")),
                info_item("型号", json_string(computer, "Model")),
                info_item("当前用户", json_string(computer, "UserName")),
                info_item("域/工作组", json_string(computer, "Domain")),
                info_item(
                    "物理内存",
                    format_bytes_for_display(json_string(computer, "TotalPhysicalMemory")),
                ),
                info_item("BIOS", json_string(computer, "BIOS")),
                info_item("序列号", json_string(computer, "SerialNumber")),
            ],
        });
    }
    if let Some(cpu) = value.get("CPU") {
        sections.push(SystemInfoSection {
            title: "处理器".to_string(),
            items: vec![
                info_item("型号", json_string(cpu, "Name")),
                info_item("核心数", json_string(cpu, "Cores")),
                info_item("逻辑处理器", json_string(cpu, "LogicalProcessors")),
                info_item(
                    "最大频率",
                    format!("{} MHz", json_string(cpu, "MaxClockSpeed")),
                ),
            ],
        });
    }
    sections.push(array_section(value, "GPU", "显卡", |item| {
        format!(
            "{} / 显存 {} / 驱动 {}",
            json_string(item, "Name"),
            format_bytes_for_display(json_string(item, "Memory")),
            json_string(item, "DriverVersion")
        )
    }));
    sections.push(array_section(value, "Disk", "磁盘", |item| {
        format!(
            "{} / {} / {} / {}",
            json_string(item, "Model"),
            format_bytes_for_display(json_string(item, "Size")),
            json_string(item, "InterfaceType"),
            json_string(item, "MediaType")
        )
    }));
    sections.push(array_section(value, "Network", "网络适配器", |item| {
        format!(
            "{} / {} / {}",
            json_string(item, "Name"),
            json_string(item, "MACAddress"),
            format_bytes_for_display(json_string(item, "Speed"))
        )
    }));
    sections.push(array_section(value, "Drivers", "驱动", |item| {
        format!(
            "{} / {} / {} / {}",
            json_string(item, "DeviceName"),
            json_string(item, "Provider"),
            json_string(item, "Version"),
            json_string(item, "Date")
        )
    }));
    sections.push(array_section(value, "Battery", "电池", |item| {
        format!(
            "{} / 状态 {} / 电量 {}% / 预计 {} 分钟",
            json_string(item, "Name"),
            json_string(item, "Status"),
            json_string(item, "EstimatedChargeRemaining"),
            json_string(item, "EstimatedRunTime")
        )
    }));
    if let Some(activation) = value.get("Activation") {
        sections.push(SystemInfoSection {
            title: "激活状态".to_string(),
            items: vec![
                info_item("产品", json_string(activation, "Name")),
                info_item(
                    "状态",
                    activation_status_label(&json_string(activation, "LicenseStatus")),
                ),
                info_item("部分密钥", json_string(activation, "PartialProductKey")),
            ],
        });
    }
    sections
        .into_iter()
        .filter(|section| !section.items.is_empty())
        .collect()
}

fn array_section<F>(
    value: &serde_json::Value,
    key: &str,
    title: &str,
    formatter: F,
) -> SystemInfoSection
where
    F: Fn(&serde_json::Value) -> String,
{
    let items = value
        .get(key)
        .and_then(|item| item.as_array())
        .map(|rows| {
            rows.iter()
                .enumerate()
                .map(|(index, item)| info_item(format!("{} {}", title, index + 1), formatter(item)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    SystemInfoSection {
        title: title.to_string(),
        items,
    }
}

fn info_item(label: impl Into<String>, value: impl Into<String>) -> SystemInfoItem {
    SystemInfoItem {
        label: label.into(),
        value: value.into(),
    }
}

fn activation_status_label(value: &str) -> String {
    match value.trim() {
        "0" => "未授权".to_string(),
        "1" => "已激活".to_string(),
        "2" => "宽限期".to_string(),
        "3" => "超出宽限期".to_string(),
        "4" => "非正版宽限期".to_string(),
        "5" => "通知状态".to_string(),
        "6" => "延长宽限期".to_string(),
        _ => value.to_string(),
    }
}

fn format_bytes_for_display(value: String) -> String {
    let Ok(mut size) = value.trim().parse::<f64>() else {
        return value;
    };
    if size <= 0.0 {
        return value;
    }
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut unit = 0usize;
    while size >= 1024.0 && unit < units.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    format!("{:.2} {}", size, units[unit])
}

fn drive_type_label(value: u32) -> &'static str {
    match value {
        2 => "可移动磁盘",
        3 => "本地磁盘",
        4 => "网络磁盘",
        5 => "光驱",
        _ => "磁盘",
    }
}

fn drive_type_rank(value: u32) -> u8 {
    match value {
        3 => 0,
        2 => 1,
        4 => 2,
        5 => 3,
        _ => 9,
    }
}

fn disabled_shortcut_path(path: &std::path::Path) -> PathBuf {
    let mut value = path.to_path_buf();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("startup-item");
    value.set_file_name(format!("{}.disabled", file_name));
    value
}
