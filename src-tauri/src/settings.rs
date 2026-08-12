use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchEngine {
    pub name: String,
    pub prefix: String,
    pub url: String, // 包含 {query} 占位符，如 "https://www.google.com/search?q={query}"
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIProvider {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: String, // "openai" | "anthropic" | "google" | "azure" | "custom" | "sub2api"
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_url: Option<String>,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_models: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateOpenaiCompatibleProvider {
    pub id: String,
    pub name: String,
    pub api_key: String,
    pub model: String,
    pub base_url: String,
}

fn default_search_engines() -> Vec<SearchEngine> {
    vec![
        SearchEngine {
            name: "Google".to_string(),
            prefix: "g".to_string(),
            url: "https://www.google.com/search?q={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "百度".to_string(),
            prefix: "b".to_string(),
            url: "https://www.baidu.com/s?wd={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "Bing".to_string(),
            prefix: "bi".to_string(),
            url: "https://www.bing.com/search?q={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "GitHub".to_string(),
            prefix: "gh".to_string(),
            url: "https://github.com/search?q={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "YouTube".to_string(),
            prefix: "yt".to_string(),
            url: "https://www.youtube.com/results?search_query={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "哔哩哔哩".to_string(),
            prefix: "bl".to_string(),
            url: "https://search.bilibili.com/all?keyword={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "知乎".to_string(),
            prefix: "zh".to_string(),
            url: "https://www.zhihu.com/search?q={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "淘宝".to_string(),
            prefix: "tb".to_string(),
            url: "https://s.taobao.com/search?q={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "京东".to_string(),
            prefix: "jd".to_string(),
            url: "https://search.jd.com/Search?keyword={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "npm".to_string(),
            prefix: "npm".to_string(),
            url: "https://www.npmjs.com/search?q={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "MDN".to_string(),
            prefix: "mdn".to_string(),
            url: "https://developer.mozilla.org/zh-CN/search?q={query}".to_string(),
            enabled: true,
        },
        SearchEngine {
            name: "Stack Overflow".to_string(),
            prefix: "so".to_string(),
            url: "https://stackoverflow.com/search?q={query}".to_string(),
            enabled: true,
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub start_minimized: bool,
    pub show_in_tray: bool,
    pub close_to_tray: bool,
    pub auto_start: bool,
    pub context_menu_enabled: bool,
    pub auto_backup: bool,
    pub backup_path: Option<String>,
    pub language: String,
    pub view_mode: String,
    #[serde(default = "default_quick_launch_shortcut")]
    pub quick_launch_shortcut: String,
    #[serde(default = "default_icon_size")]
    pub icon_size: String,
    #[serde(default = "default_search_engines")]
    pub search_engines: Vec<SearchEngine>,
    #[serde(default)]
    pub qweather_api_key: String,
    #[serde(default)]
    pub qweather_api_host: String,
    #[serde(default = "default_clipboard_shortcut")]
    pub clipboard_shortcut: Option<String>,
    #[serde(default)]
    pub clipboard_max_count: i64,
    #[serde(default)]
    pub clipboard_duration_days: i64,
    #[serde(default = "default_true")]
    pub clipboard_enabled: bool,
    #[serde(default = "default_clipboard_auto_paste")]
    pub clipboard_auto_paste: String,
    #[serde(default)]
    pub clipboard_paste_plain: bool,
    #[serde(default = "default_true")]
    pub clipboard_auto_sort: bool,
    #[serde(default = "default_clipboard_search_position")]
    pub clipboard_search_position: String,
    #[serde(default)]
    pub clipboard_search_auto_clear: bool,
    #[serde(default = "default_toolbox_shortcut")]
    pub toolbox_shortcut: Option<String>,
    // OCR 设置
    #[serde(default = "default_ocr_shortcut")]
    pub ocr_shortcut: Option<String>,
    #[serde(default = "default_ocr_provider")]
    pub ocr_provider: String,
    #[serde(default)]
    pub ocr_baidu_api_key: String,
    #[serde(default)]
    pub ocr_baidu_secret_key: String,
    #[serde(default = "default_true")]
    pub ocr_baidu_high_accuracy: bool,
    #[serde(default)]
    pub ocr_google_api_key: String,
    #[serde(default)]
    pub ocr_tencent_secret_id: String,
    #[serde(default)]
    pub ocr_tencent_secret_key: String,
    #[serde(default = "default_ocr_tencent_region")]
    pub ocr_tencent_region: String,
    #[serde(default)]
    pub ocr_aliyun_access_key_id: String,
    #[serde(default)]
    pub ocr_aliyun_access_key_secret: String,
    #[serde(default)]
    pub ocr_auto_recognize: bool,
    #[serde(default = "default_true")]
    pub ocr_copy_after_recognize: bool,
    // 翻译设置
    #[serde(default = "default_translate_shortcut")]
    pub translate_shortcut: Option<String>,
    #[serde(default = "default_quick_translate_shortcut")]
    pub quick_translate_shortcut: Option<String>,
    #[serde(default = "default_word_selection_translate_shortcut")]
    pub word_selection_translate_shortcut: Option<String>,
    #[serde(default = "default_translate_provider")]
    pub translate_provider: String,
    #[serde(default = "default_translate_mode")]
    pub translate_mode: String,
    #[serde(default)]
    pub translate_from_lang: String,
    #[serde(default = "default_translate_to_lang")]
    pub translate_to_lang: String,
    #[serde(default)]
    pub translate_baidu_app_id: String,
    #[serde(default)]
    pub translate_baidu_secret_key: String,
    #[serde(default)]
    pub translate_google_api_key: String,
    #[serde(default)]
    pub translate_bing_api_key: String,
    #[serde(default)]
    pub translate_tencent_secret_id: String,
    #[serde(default)]
    pub translate_tencent_secret_key: String,
    #[serde(default = "default_translate_tencent_region")]
    pub translate_tencent_region: String,
    #[serde(default)]
    pub translate_openai_api_key: String,
    #[serde(default = "default_translate_openai_model")]
    pub translate_openai_model: String,
    #[serde(default)]
    pub translate_openai_base_url: String,
    #[serde(default)]
    pub translate_openai_compatible_providers: Vec<TranslateOpenaiCompatibleProvider>,
    #[serde(default)]
    pub translate_openai_compatible_provider_id: String,
    #[serde(default)]
    pub translate_deepseek_api_key: String,
    #[serde(default = "default_translate_deepseek_model")]
    pub translate_deepseek_model: String,
    #[serde(default = "default_translate_deepseek_base_url")]
    pub translate_deepseek_base_url: String,
    #[serde(default)]
    pub translate_gemini_api_key: String,
    #[serde(default = "default_translate_gemini_model")]
    pub translate_gemini_model: String,
    #[serde(default = "default_true")]
    pub translate_auto_detect_language: bool,
    #[serde(default = "default_true")]
    pub translate_show_original_text: bool,
    #[serde(default)]
    pub translate_auto_copy: bool,
    #[serde(default = "default_translate_overlay_opacity")]
    pub translate_overlay_opacity: f32,
    #[serde(default = "default_translate_overlay_font_size")]
    pub translate_overlay_font_size: u32,
    // 截图工具设置
    #[serde(default = "default_screenshot_fullscreen_shortcut")]
    pub screenshot_fullscreen_shortcut: Option<String>,
    #[serde(default = "default_screenshot_region_shortcut")]
    pub screenshot_region_shortcut: Option<String>,
    // AI 聊天设置
    #[serde(default = "default_ai_chat_shortcut")]
    pub ai_chat_shortcut: Option<String>,
    #[serde(default)]
    pub ai_providers: Vec<AIProvider>,
    #[serde(default)]
    pub active_ai_provider_id: String,
    #[serde(default)]
    pub default_ai_model: String,
    #[serde(default)]
    pub mcp_servers: Vec<crate::mcp_manager::McpServerConfig>,
}

fn default_screenshot_fullscreen_shortcut() -> Option<String> {
    Some("Alt+A".to_string())
}

fn default_screenshot_region_shortcut() -> Option<String> {
    Some("Alt+Shift+A".to_string())
}

fn default_ai_chat_shortcut() -> Option<String> {
    Some("Alt+G".to_string())
}

fn default_translate_shortcut() -> Option<String> {
    Some("Alt+Shift+T".to_string())
}

fn default_quick_translate_shortcut() -> Option<String> {
    Some("Alt+Q".to_string())
}

fn default_word_selection_translate_shortcut() -> Option<String> {
    Some("Alt+W".to_string())
}

fn default_translate_provider() -> String {
    "baidu".to_string()
}

fn default_translate_mode() -> String {
    "window".to_string()
}

fn default_translate_to_lang() -> String {
    "zh".to_string()
}

fn default_translate_tencent_region() -> String {
    "ap-guangzhou".to_string()
}

fn default_translate_openai_model() -> String {
    "gpt-4o".to_string()
}

fn default_translate_deepseek_model() -> String {
    "deepseek-v4-flash".to_string()
}

fn default_translate_deepseek_base_url() -> String {
    "https://api.deepseek.com".to_string()
}

fn default_translate_gemini_model() -> String {
    "gemini-pro".to_string()
}

fn default_translate_overlay_opacity() -> f32 {
    0.9
}

fn default_translate_overlay_font_size() -> u32 {
    16
}

fn default_quick_launch_shortcut() -> String {
    "Alt+Space".to_string()
}

fn default_icon_size() -> String {
    "medium".to_string()
}

fn default_clipboard_shortcut() -> Option<String> {
    Some("Alt+C".to_string())
}

fn default_true() -> bool {
    true
}

fn default_clipboard_auto_paste() -> String {
    "double".to_string()
}

fn default_clipboard_search_position() -> String {
    "top".to_string()
}

fn default_toolbox_shortcut() -> Option<String> {
    Some("Alt+T".to_string())
}

fn default_ocr_shortcut() -> Option<String> {
    Some("Ctrl+Shift+A".to_string())
}

fn default_ocr_provider() -> String {
    "baidu".to_string()
}

fn default_ocr_tencent_region() -> String {
    "ap-guangzhou".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            start_minimized: false,
            show_in_tray: true,
            close_to_tray: true,
            auto_start: false,
            context_menu_enabled: false,
            auto_backup: true,
            backup_path: None,
            language: "zh-CN".to_string(),
            view_mode: "grid".to_string(),
            quick_launch_shortcut: default_quick_launch_shortcut(),
            icon_size: default_icon_size(),
            search_engines: default_search_engines(),
            qweather_api_key: String::new(),
            qweather_api_host: String::new(),
            clipboard_shortcut: default_clipboard_shortcut(),
            clipboard_max_count: 0,
            clipboard_duration_days: 0,
            clipboard_enabled: true,
            clipboard_auto_paste: default_clipboard_auto_paste(),
            clipboard_paste_plain: false,
            clipboard_auto_sort: true,
            clipboard_search_position: default_clipboard_search_position(),
            clipboard_search_auto_clear: false,
            toolbox_shortcut: default_toolbox_shortcut(),
            // OCR 默认设置
            ocr_shortcut: default_ocr_shortcut(),
            ocr_provider: default_ocr_provider(),
            ocr_baidu_api_key: String::new(),
            ocr_baidu_secret_key: String::new(),
            ocr_baidu_high_accuracy: true,
            ocr_google_api_key: String::new(),
            ocr_tencent_secret_id: String::new(),
            ocr_tencent_secret_key: String::new(),
            ocr_tencent_region: default_ocr_tencent_region(),
            ocr_aliyun_access_key_id: String::new(),
            ocr_aliyun_access_key_secret: String::new(),
            ocr_auto_recognize: false,
            ocr_copy_after_recognize: true,
            // 翻译默认设置
            translate_shortcut: default_translate_shortcut(),
            quick_translate_shortcut: default_quick_translate_shortcut(),
            word_selection_translate_shortcut: default_word_selection_translate_shortcut(),
            translate_provider: default_translate_provider(),
            translate_mode: default_translate_mode(),
            translate_from_lang: String::from("auto"),
            translate_to_lang: default_translate_to_lang(),
            translate_baidu_app_id: String::new(),
            translate_baidu_secret_key: String::new(),
            translate_google_api_key: String::new(),
            translate_bing_api_key: String::new(),
            translate_tencent_secret_id: String::new(),
            translate_tencent_secret_key: String::new(),
            translate_tencent_region: default_translate_tencent_region(),
            translate_openai_api_key: String::new(),
            translate_openai_model: default_translate_openai_model(),
            translate_openai_base_url: String::new(),
            translate_openai_compatible_providers: Vec::new(),
            translate_openai_compatible_provider_id: String::new(),
            translate_deepseek_api_key: String::new(),
            translate_deepseek_model: default_translate_deepseek_model(),
            translate_deepseek_base_url: default_translate_deepseek_base_url(),
            translate_gemini_api_key: String::new(),
            translate_gemini_model: default_translate_gemini_model(),
            translate_auto_detect_language: true,
            translate_show_original_text: true,
            translate_auto_copy: false,
            translate_overlay_opacity: default_translate_overlay_opacity(),
            translate_overlay_font_size: default_translate_overlay_font_size(),
            // 截图工具默认设置
            screenshot_fullscreen_shortcut: default_screenshot_fullscreen_shortcut(),
            screenshot_region_shortcut: default_screenshot_region_shortcut(),
            // AI 聊天默认设置
            ai_chat_shortcut: default_ai_chat_shortcut(),
            ai_providers: Vec::new(),
            active_ai_provider_id: String::new(),
            default_ai_model: String::new(),
            mcp_servers: Vec::new(),
        }
    }
}

pub struct SettingsManager {
    settings_path: PathBuf,
    cache: Mutex<AppSettings>,
}

impl SettingsManager {
    pub fn new() -> Result<Self> {
        let app_data = std::env::var("APPDATA").context("Failed to get APPDATA")?;
        let settings_dir = PathBuf::from(app_data).join("McStartUP");
        fs::create_dir_all(&settings_dir)?;

        let settings_path = settings_dir.join("settings.json");
        let initial = if settings_path.exists() {
            let content = fs::read_to_string(&settings_path)?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            AppSettings::default()
        };

        Ok(Self {
            settings_path,
            cache: Mutex::new(initial),
        })
    }

    pub fn load(&self) -> Result<AppSettings> {
        Ok(self.cache.lock().unwrap().clone())
    }

    pub fn save(&self, settings: &AppSettings) -> Result<()> {
        let content = serde_json::to_string_pretty(settings)?;
        fs::write(&self.settings_path, content)?;
        *self.cache.lock().unwrap() = settings.clone();
        Ok(())
    }
}
