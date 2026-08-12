use crate::models::AppConfig;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AliasCache {
    /// 别名 -> (target_path, arguments, item_type) 的映射
    pub aliases: HashMap<String, (String, String, String)>,
    /// 最后更新时间戳
    pub last_updated: u64,
}

pub struct Storage {
    config_path: PathBuf,
    alias_cache_path: PathBuf,
    config: Mutex<AppConfig>,
}

impl Storage {
    pub fn new() -> Result<Self> {
        let config_dir = Self::get_config_dir()?;
        fs::create_dir_all(&config_dir)?;

        let config_path = config_dir.join("config.json");
        let alias_cache_path = config_dir.join("alias_cache.json");

        let config = if config_path.exists() {
            let content = fs::read_to_string(&config_path)?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            AppConfig::default()
        };

        Ok(Self {
            config_path,
            alias_cache_path,
            config: Mutex::new(config),
        })
    }

    pub fn get_config_dir() -> Result<PathBuf> {
        let app_data =
            std::env::var("APPDATA").context("Failed to get APPDATA environment variable")?;
        Ok(PathBuf::from(app_data).join("McStartUP"))
    }

    /// 查找最新的备份文件
    fn find_latest_backup(config_dir: &std::path::Path) -> Result<PathBuf> {
        let backup_dir = config_dir.join("backups");
        if !backup_dir.exists() {
            return Err(anyhow::anyhow!("备份目录不存在"));
        }

        let mut backups: Vec<PathBuf> = fs::read_dir(&backup_dir)?
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with("config_"))
            .map(|e| e.path())
            .collect();

        if backups.is_empty() {
            return Err(anyhow::anyhow!("没有找到备份文件"));
        }

        // 按文件名排序（时间戳格式，字典序即时间序）
        backups.sort();
        Ok(backups.into_iter().last().unwrap())
    }

    pub fn load(&self) -> Result<AppConfig> {
        let config = self.config.lock().unwrap();
        Ok(config.clone())
    }

    pub fn save(&self, config: &AppConfig) -> Result<()> {
        let json = serde_json::to_string_pretty(config)?;
        fs::write(&self.config_path, &json)?;

        let mut stored_config = self.config.lock().unwrap();
        *stored_config = config.clone();

        let backup_dir = self.config_path.parent().unwrap().join("backups");
        let _ = fs::create_dir_all(&backup_dir);

        // 始终覆盖最新备份，方便快速恢复
        let latest_path = backup_dir.join("config_latest.json");
        let _ = fs::write(&latest_path, &json);

        // 每天保留一份自动备份，最多保留最近 7 份
        let daily_name = chrono::Local::now()
            .format("config_%Y%m%d.json")
            .to_string();
        let daily_path = backup_dir.join(daily_name);
        let _ = fs::write(&daily_path, &json);
        let _ = Self::cleanup_old_backups(&backup_dir);

        Ok(())
    }

    /// 清理旧备份，只保留最近 7 个自动日期备份（config_latest.json 和手动导出的始终保留）
    fn cleanup_old_backups(backup_dir: &std::path::Path) -> Result<()> {
        let mut backups: Vec<PathBuf> = fs::read_dir(backup_dir)?
            .flatten()
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                // 只匹配自动日期备份：config_YYYYMMDD.json（8位数字）
                // 排除 config_latest.json 和手动导出的 config_YYYYMMDD_HHMMSS.json
                name.starts_with("config_")
                    && name.ends_with(".json")
                    && name != "config_latest.json"
                    && {
                        let stem = name.trim_start_matches("config_").trim_end_matches(".json");
                        // 自动日期备份：恰好 8 位数字
                        stem.len() == 8 && stem.chars().all(|c| c.is_ascii_digit())
                    }
            })
            .map(|e| e.path())
            .collect();

        backups.sort();

        // 超过 7 个时删除最旧的
        while backups.len() > 7 {
            let oldest = backups.remove(0);
            let _ = fs::remove_file(oldest);
        }

        Ok(())
    }

    /// 加载别名缓存
    pub fn load_alias_cache(&self) -> Result<AliasCache> {
        if self.alias_cache_path.exists() {
            let content = fs::read_to_string(&self.alias_cache_path)?;
            Ok(serde_json::from_str(&content).unwrap_or_default())
        } else {
            Ok(AliasCache::default())
        }
    }

    /// 保存别名缓存
    pub fn save_alias_cache(&self, cache: &AliasCache) -> Result<()> {
        let json = serde_json::to_string_pretty(cache)?;
        fs::write(&self.alias_cache_path, &json)?;
        Ok(())
    }

    /// 构建当前配置的别名快照
    pub fn build_alias_snapshot(
        &self,
        config: &AppConfig,
    ) -> HashMap<String, (String, String, String)> {
        config
            .items
            .iter()
            .map(|item| {
                let item_type = item.item_type.as_deref().unwrap_or("app").to_string();
                let arguments = item.arguments.as_deref().unwrap_or("").to_string();
                (
                    item.alias.clone(),
                    (item.target_path.clone(), arguments, item_type),
                )
            })
            .collect()
    }
    pub fn restore_config(&self, config: &AppConfig) -> Result<()> {
        self.save(config)
    }

    /// 检查是否存在可恢复的备份（config.json 不存在但有备份时）
    pub fn has_recoverable_backup() -> bool {
        let Ok(config_dir) = Self::get_config_dir() else {
            return false;
        };
        let config_path = config_dir.join("config.json");
        if config_path.exists() {
            return false; // config 存在，不需要恢复
        }
        Self::find_latest_backup(&config_dir).is_ok()
    }

    /// 列出所有可用备份
    pub fn list_backups() -> Result<Vec<(String, String)>> {
        let config_dir = Self::get_config_dir()?;
        let backup_dir = config_dir.join("backups");
        if !backup_dir.exists() {
            return Ok(vec![]);
        }

        let mut result = vec![];
        let mut entries: Vec<_> = fs::read_dir(&backup_dir)?
            .flatten()
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.starts_with("config_") || name.starts_with("mcstartup_full_backup_")
            })
            .collect();

        entries.sort_by_key(|e| e.file_name());
        entries.reverse(); // 最新的在前

        for entry in entries {
            let path = entry.path().to_string_lossy().to_string();
            let name = entry.file_name().to_string_lossy().to_string();
            result.push((name, path));
        }

        Ok(result)
    }
}
