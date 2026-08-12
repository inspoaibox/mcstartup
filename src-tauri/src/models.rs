use crate::settings::AppSettings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchProfile {
    pub name: String,
    pub alias: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchItem {
    pub id: String,
    pub name: String,
    pub alias: String,
    pub target_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_vars: Option<HashMap<String, String>>,
    pub run_as_admin: bool,
    pub startup_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hotkey: Option<String>,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub launch_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub launch_profiles: Option<Vec<LaunchProfile>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_show_window: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchItemInput {
    pub name: String,
    pub alias: String,
    pub target_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_vars: Option<HashMap<String, String>>,
    pub run_as_admin: bool,
    pub startup_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hotkey: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub launch_profiles: Option<Vec<LaunchProfile>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_show_window: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupInput {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub items: Vec<LaunchItem>,
    #[serde(default)]
    pub groups: Vec<Group>,
    #[serde(default)]
    pub settings: AppSettings,
}
