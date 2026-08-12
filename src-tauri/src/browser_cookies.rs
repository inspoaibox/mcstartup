use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
pub fn auto_chromium_cookie_for_hosts(
    browser: &str,
    hosts: &[String],
    purpose_label: &str,
) -> Result<String, String> {
    let normalized_hosts = normalize_hosts(hosts);
    if normalized_hosts.is_empty() {
        return Err("没有可用于匹配 Cookie 的域名。".to_string());
    }
    let db_paths = chromium_cookie_db_paths(browser);
    if db_paths.is_empty() {
        return Err(format!(
            "没有找到 {} 的 Cookie 数据库。",
            browser_label(browser)
        ));
    }
    let local_state_path = chromium_local_state_path(browser)
        .ok_or_else(|| format!("没有找到 {} 的 Local State 文件。", browser_label(browser)))?;
    let key = chromium_master_key(&local_state_path)?;
    let temp_dir =
        std::env::temp_dir().join(format!("mcstartup-browser-cookie-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建 Cookie 临时目录失败: {}", e))?;

    let mut cookie_strings = Vec::new();
    let mut errors = Vec::new();
    for (index, db_path) in db_paths.iter().enumerate() {
        let temp_db = temp_dir.join(format!("Cookies-{index}"));
        match fs::copy(db_path, &temp_db) {
            Ok(_) => match read_chromium_cookie_for_hosts(&temp_db, &key, &normalized_hosts) {
                Ok(cookie) => cookie_strings.push(cookie),
                Err(error) => errors.push(error),
            },
            Err(error) => errors.push(format!("复制 Cookie 数据库失败: {}", error)),
        }
    }
    let _ = fs::remove_dir_all(&temp_dir);
    let merged = merge_cookie_strings(cookie_strings);
    if merged.is_empty() {
        let detail = errors
            .into_iter()
            .next()
            .unwrap_or_else(|| format!("没有读取到 {} 相关 Cookie。", purpose_label));
        Err(format!(
            "{} 请确认 {} 已登录相关网站；如果浏览器正在占用 Cookie 数据库，请关闭浏览器后重试，或改用手动 Cookie。",
            detail,
            browser_label(browser)
        ))
    } else {
        Ok(merged)
    }
}

#[cfg(not(target_os = "windows"))]
pub fn auto_chromium_cookie_for_hosts(
    _browser: &str,
    _hosts: &[String],
    _purpose_label: &str,
) -> Result<String, String> {
    Err("当前系统暂不支持自动读取浏览器 Cookie，请使用手动 Cookie。".to_string())
}

pub fn browser_label(browser: &str) -> &str {
    match browser {
        "chrome" => "Chrome",
        "edge" => "Edge",
        "brave" => "Brave",
        "vivaldi" => "Vivaldi",
        "opera" => "Opera",
        _ => "浏览器",
    }
}

pub fn merge_cookie_strings(values: Vec<String>) -> String {
    let mut seen = HashSet::new();
    let mut pairs = Vec::new();
    for value in values {
        for pair in value
            .split(';')
            .map(str::trim)
            .filter(|item| !item.is_empty())
        {
            let name = pair
                .split_once('=')
                .map(|(name, _)| name.trim())
                .unwrap_or(pair);
            if !name.is_empty() && seen.insert(name.to_string()) {
                pairs.push(pair.to_string());
            }
        }
    }
    pairs.join("; ")
}

fn normalize_hosts(hosts: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    hosts
        .iter()
        .map(|host| host.trim().trim_start_matches('.').to_ascii_lowercase())
        .filter(|host| !host.is_empty())
        .filter(|host| seen.insert(host.clone()))
        .collect()
}

#[cfg(target_os = "windows")]
fn chromium_cookie_db_paths(browser: &str) -> Vec<PathBuf> {
    let Some(root) = chromium_user_data_dir(browser) else {
        return Vec::new();
    };
    if browser == "opera" {
        let path = root.join(r"Network\Cookies");
        return path.exists().then_some(path).into_iter().collect();
    }
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if name == "Default" || name.starts_with("Profile ") {
                let cookie_path = path.join(r"Network\Cookies");
                if cookie_path.exists() {
                    paths.push(cookie_path);
                }
            }
        }
    }
    paths
}

#[cfg(target_os = "windows")]
fn chromium_local_state_path(browser: &str) -> Option<PathBuf> {
    let path = chromium_user_data_dir(browser)?.join("Local State");
    path.exists().then_some(path)
}

#[cfg(target_os = "windows")]
fn chromium_user_data_dir(browser: &str) -> Option<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
    let path = match browser {
        "chrome" => local.join(r"Google\Chrome\User Data"),
        "edge" => local.join(r"Microsoft\Edge\User Data"),
        "brave" => local.join(r"BraveSoftware\Brave-Browser\User Data"),
        "vivaldi" => local.join(r"Vivaldi\User Data"),
        "opera" => roaming?.join(r"Opera Software\Opera Stable"),
        _ => return None,
    };
    path.exists().then_some(path)
}

#[cfg(target_os = "windows")]
fn chromium_master_key(local_state_path: &Path) -> Result<Vec<u8>, String> {
    let text = fs::read_to_string(local_state_path)
        .map_err(|e| format!("读取浏览器 Local State 失败: {}", e))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("解析浏览器 Local State 失败: {}", e))?;
    let encrypted_key = value
        .pointer("/os_crypt/encrypted_key")
        .and_then(Value::as_str)
        .ok_or_else(|| "浏览器 Local State 中没有 encrypted_key。".to_string())?;
    let mut bytes = base64::engine::general_purpose::STANDARD
        .decode(encrypted_key)
        .map_err(|e| format!("解析浏览器 Cookie 密钥失败: {}", e))?;
    if bytes.starts_with(b"DPAPI") {
        bytes.drain(..5);
    }
    dpapi_unprotect(&bytes)
}

#[cfg(target_os = "windows")]
fn read_chromium_cookie_for_hosts(
    db_path: &Path,
    key: &[u8],
    hosts: &[String],
) -> Result<String, String> {
    let connection = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("打开浏览器 Cookie 数据库失败: {}", e))?;
    let mut statement = connection
        .prepare("SELECT host_key, name, value, encrypted_value FROM cookies")
        .map_err(|e| format!("读取浏览器 Cookie 表失败: {}", e))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2).unwrap_or_default(),
                row.get::<_, Vec<u8>>(3).unwrap_or_default(),
            ))
        })
        .map_err(|e| format!("查询浏览器 Cookie 失败: {}", e))?;

    let mut pairs = Vec::new();
    let mut seen = HashSet::new();
    for row in rows {
        let (host, name, value, encrypted) =
            row.map_err(|e| format!("读取浏览器 Cookie 行失败: {}", e))?;
        if !cookie_host_matches(&host, hosts) {
            continue;
        }
        let cookie_value = if !value.is_empty() {
            value
        } else {
            decrypt_chromium_cookie(&encrypted, key).unwrap_or_default()
        };
        if name.trim().is_empty() || cookie_value.trim().is_empty() {
            continue;
        }
        if seen.insert(name.clone()) {
            pairs.push(format!("{}={}", name, cookie_value));
        }
    }

    if pairs.is_empty() {
        Err("没有读取到匹配域名的 Cookie。".to_string())
    } else {
        Ok(pairs.join("; "))
    }
}

#[cfg(target_os = "windows")]
fn cookie_host_matches(cookie_host: &str, hosts: &[String]) -> bool {
    let cookie_host = cookie_host
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    hosts.iter().any(|host| {
        cookie_host == *host
            || host.ends_with(&format!(".{}", cookie_host))
            || cookie_host.ends_with(&format!(".{}", host))
    })
}

#[cfg(target_os = "windows")]
fn decrypt_chromium_cookie(encrypted: &[u8], key: &[u8]) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }
    let plain = if encrypted.starts_with(b"v10") || encrypted.starts_with(b"v11") {
        if encrypted.len() < 15 {
            return Err("Cookie 密文长度无效。".to_string());
        }
        let nonce = Nonce::from_slice(&encrypted[3..15]);
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("初始化 Cookie 解密器失败: {}", e))?;
        cipher
            .decrypt(nonce, &encrypted[15..])
            .map_err(|e| format!("解密 Cookie 失败: {}", e))?
    } else {
        dpapi_unprotect(encrypted)?
    };
    String::from_utf8(plain).map_err(|e| format!("Cookie 内容不是 UTF-8: {}", e))
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
        return Err("系统 DPAPI 解密浏览器 Cookie 失败。".to_string());
    }
    let result = unsafe {
        std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
    };
    unsafe {
        LocalFree(output_blob.pbData as *mut _);
    }
    Ok(result)
}
