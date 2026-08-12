use anyhow::{Context, Result};
use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const IMAGE_FILE_SUBTYPE: &str = "image-file";

#[derive(Debug, Clone)]
pub struct ImageFileMetadata {
    pub width: i64,
    pub height: i64,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: String,
    #[serde(rename = "itemType")]
    pub item_type: String,
    pub group: String,
    /// 主要内容（文本内容 / 图片base64 / 文件路径JSON数组）
    pub value: String,
    /// 用于搜索的纯文本
    pub search: String,
    /// 字符数 / 文件大小
    pub count: i64,
    /// 图片宽度
    pub width: Option<i64>,
    /// 图片高度
    pub height: Option<i64>,
    pub favorite: bool,
    pub pinned: bool,
    pub shortcut: Option<String>,
    pub create_time: String,
    pub note: Option<String>,
    pub subtype: Option<String>,
}

pub struct ClipboardDb {
    conn: Arc<Mutex<Connection>>,
}

impl ClipboardDb {
    pub fn new(data_dir: &PathBuf) -> Result<Self> {
        std::fs::create_dir_all(data_dir)?;
        let db_path = data_dir.join("clipboard_history.db");
        let conn = Connection::open(&db_path)
            .with_context(|| format!("Failed to open clipboard DB at {:?}", db_path))?;

        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id          TEXT PRIMARY KEY,
                type        TEXT NOT NULL,
                grp         TEXT NOT NULL DEFAULT 'text',
                value       TEXT NOT NULL,
                search      TEXT NOT NULL DEFAULT '',
                count       INTEGER NOT NULL DEFAULT 0,
                width       INTEGER,
                height      INTEGER,
                favorite    INTEGER NOT NULL DEFAULT 0,
                pinned      INTEGER NOT NULL DEFAULT 0,
                shortcut    TEXT,
                create_time TEXT NOT NULL,
                note        TEXT,
                subtype     TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_history_create_time ON history(create_time DESC);
            CREATE INDEX IF NOT EXISTS idx_history_type ON history(type);
            CREATE INDEX IF NOT EXISTS idx_history_favorite ON history(favorite);",
        )?;
        let _ = conn.execute(
            "ALTER TABLE history ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_pinned ON history(pinned)",
            [],
        );
        let _ = conn.execute("ALTER TABLE history ADD COLUMN shortcut TEXT", []);
        let _ = conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_history_shortcut_unique ON history(shortcut) WHERE shortcut IS NOT NULL AND shortcut <> ''",
            [],
        );
        if let Err(error) = migrate_image_file_records(&conn) {
            eprintln!(
                "[clipboard] Failed to migrate image file records: {}",
                error
            );
        }

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// 插入一条历史记录
    pub fn insert(&self, item: &ClipboardItem) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO history (id, type, grp, value, search, count, width, height, favorite, pinned, shortcut, create_time, note, subtype)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                item.id,
                item.item_type,
                item.group,
                item.value,
                item.search,
                item.count,
                item.width,
                item.height,
                item.favorite as i32,
                item.pinned as i32,
                item.shortcut,
                item.create_time,
                item.note,
                item.subtype,
            ],
        )?;
        Ok(())
    }

    /// 查询历史记录（分页 + 过滤）
    pub fn query(
        &self,
        group: &str,
        search: &str,
        page: i64,
        page_size: i64,
    ) -> Result<Vec<ClipboardItem>> {
        let conn = self.conn.lock().unwrap();
        let offset = (page - 1) * page_size;

        let mut conditions: Vec<String> = vec![];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![];

        match group {
            "all" => {}
            "favorite" => {
                conditions.push("favorite = 1".to_string());
            }
            "image" => {
                conditions.push("(type = ? OR subtype = ?)".to_string());
                params_vec.push(Box::new("image".to_string()));
                params_vec.push(Box::new(IMAGE_FILE_SUBTYPE.to_string()));
            }
            "text" | "files" => {
                conditions.push("type = ?".to_string());
                params_vec.push(Box::new(group.to_string()));
            }
            _ => {}
        }

        if !search.is_empty() {
            conditions.push("(search LIKE ? OR note LIKE ?)".to_string());
            let pattern = format!("%{}%", search);
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        let order_clause = if group == "favorite" {
            "pinned DESC, create_time DESC"
        } else {
            "create_time DESC"
        };

        let sql = format!(
            "SELECT id, type, grp, value, search, count, width, height, favorite, pinned, shortcut, create_time, note, subtype
             FROM history
             {}
             ORDER BY {}
             LIMIT {} OFFSET {}",
            where_clause, order_clause, page_size, offset
        );

        let refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let items = stmt.query_map(refs.as_slice(), |row| {
            Ok(ClipboardItem {
                id: row.get(0)?,
                item_type: row.get(1)?,
                group: row.get(2)?,
                value: row.get(3)?,
                search: row.get(4)?,
                count: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                favorite: row.get::<_, i32>(8)? != 0,
                pinned: row.get::<_, i32>(9)? != 0,
                shortcut: row.get(10)?,
                create_time: row.get(11)?,
                note: row.get(12)?,
                subtype: row.get(13)?,
            })
        })?;

        let mut result = vec![];
        for item in items {
            result.push(item?);
        }
        Ok(result)
    }

    /// 检查是否已存在相同内容（去重）
    pub fn find_by_value(&self, item_type: &str, value: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id FROM history WHERE type = ?1 AND value = ?2 LIMIT 1")?;
        let mut rows = stmt.query(params![item_type, value])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// 更新 create_time（用于自动排序：重复内容移到顶部）
    pub fn update_create_time(&self, id: &str, create_time: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE history SET create_time = ?1 WHERE id = ?2",
            params![create_time, id],
        )?;
        Ok(())
    }

    /// 切换收藏状态
    pub fn toggle_favorite(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let current: i32 = conn.query_row(
            "SELECT favorite FROM history WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        let new_val = if current == 0 { 1 } else { 0 };
        conn.execute(
            "UPDATE history SET favorite = ?1 WHERE id = ?2",
            params![new_val, id],
        )?;
        Ok(new_val == 1)
    }

    /// 更新备注
    pub fn update_note(&self, id: &str, note: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE history SET note = ?1 WHERE id = ?2",
            params![note, id],
        )?;
        Ok(())
    }

    /// 切换置顶状态
    pub fn toggle_pin(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let current: i32 = conn.query_row(
            "SELECT pinned FROM history WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        let new_val = if current == 0 { 1 } else { 0 };
        conn.execute(
            "UPDATE history SET pinned = ?1, favorite = CASE WHEN ?1 = 1 THEN 1 ELSE favorite END WHERE id = ?2",
            params![new_val, id],
        )?;
        Ok(new_val == 1)
    }

    /// 更新文本内容
    pub fn update_text_value(&self, id: &str, value: &str) -> Result<()> {
        let search = value.trim();
        let count = search.chars().count() as i64;
        let subtype = detect_text_subtype(search);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE history SET value = ?1, search = ?1, count = ?2, subtype = ?3 WHERE id = ?4 AND type IN ('text', 'html', 'rtf')",
            params![search, count, subtype, id],
        )?;
        Ok(())
    }

    pub fn update_shortcut(&self, id: &str, shortcut: Option<&str>) -> Result<()> {
        let normalized = shortcut.map(str::trim).filter(|s| !s.is_empty());
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE history SET shortcut = ?1 WHERE id = ?2 AND favorite = 1 AND type IN ('text', 'html', 'rtf')",
            params![normalized, id],
        )?;
        Ok(())
    }

    pub fn shortcut_for_item(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let value = conn.query_row(
            "SELECT shortcut FROM history WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(value)
    }

    pub fn shortcut_bindings(&self) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, shortcut FROM history WHERE favorite = 1 AND shortcut IS NOT NULL AND shortcut <> ''",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut bindings = Vec::new();
        for row in rows {
            bindings.push(row?);
        }
        Ok(bindings)
    }

    /// 查询单条记录的 type 和 value（用于删除时决定是否清理关联文件）
    pub fn get_item_type_and_value(&self, id: &str) -> Result<Option<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT type, value FROM history WHERE id = ?1 LIMIT 1")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some((row.get(0)?, row.get(1)?)))
        } else {
            Ok(None)
        }
    }

    /// 删除一条记录
    pub fn delete(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM history WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// 清空所有历史（保留收藏）
    pub fn clear_all(&self, keep_favorites: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        if keep_favorites {
            conn.execute("DELETE FROM history WHERE favorite = 0", [])?;
        } else {
            conn.execute("DELETE FROM history", [])?;
        }
        Ok(())
    }

    /// 按最大条数清理（保留收藏）
    #[allow(dead_code)]
    pub fn cleanup_by_max_count(&self, max_count: i64) -> Result<()> {
        if max_count <= 0 {
            return Ok(());
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM history WHERE favorite = 0 AND id NOT IN (
                SELECT id FROM history WHERE favorite = 0
                ORDER BY create_time DESC LIMIT ?1
            )",
            params![max_count],
        )?;
        Ok(())
    }

    /// 按时间清理（保留收藏）
    #[allow(dead_code)]
    pub fn cleanup_by_duration(&self, days: i64) -> Result<()> {
        if days <= 0 {
            return Ok(());
        }
        let cutoff = Local::now()
            .checked_sub_signed(chrono::Duration::days(days))
            .unwrap()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM history WHERE favorite = 0 AND create_time < ?1",
            params![cutoff],
        )?;
        Ok(())
    }

    pub fn get_conn(&self) -> Arc<Mutex<Connection>> {
        self.conn.clone()
    }
}

/// 检测文本子类型
pub fn detect_text_subtype(text: &str) -> Option<String> {
    let t = text.trim();

    // URL
    if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("www.") {
        return Some("url".to_string());
    }

    // Email
    if t.contains('@') && t.contains('.') && !t.contains(' ') && t.len() < 200 {
        let parts: Vec<&str> = t.splitn(2, '@').collect();
        if parts.len() == 2 && !parts[0].is_empty() && parts[1].contains('.') {
            return Some("email".to_string());
        }
    }

    // Color (#RGB / #RRGGBB / rgb() / rgba())
    if (t.starts_with('#') && (t.len() == 4 || t.len() == 7))
        || t.starts_with("rgb(")
        || t.starts_with("rgba(")
    {
        return Some("color".to_string());
    }

    // File path
    if (t.len() > 2 && t.chars().nth(1) == Some(':')) || t.starts_with('/') || t.starts_with('\\') {
        return Some("path".to_string());
    }

    None
}

pub fn single_image_file_metadata(paths: &[String]) -> Option<ImageFileMetadata> {
    if paths.len() != 1 {
        return None;
    }
    image_file_metadata(&paths[0])
}

pub fn image_file_metadata(path: &str) -> Option<ImageFileMetadata> {
    let path = Path::new(path);
    if !is_supported_image_extension(path) {
        return None;
    }
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let (width, height) = image::image_dimensions(path).ok()?;
    Some(ImageFileMetadata {
        width: width as i64,
        height: height as i64,
        size: metadata.len() as i64,
    })
}

fn is_supported_image_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some(
            "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "bmp"
                | "dib"
                | "tif"
                | "tiff"
                | "ico"
                | "avif"
        )
    )
}

fn migrate_image_file_records(conn: &Connection) -> Result<()> {
    let rows: Vec<(String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, value FROM history
             WHERE type = 'files' AND (subtype IS NULL OR subtype = '')",
        )?;
        let mapped = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut rows = Vec::new();
        for row in mapped {
            rows.push(row?);
        }
        rows
    };

    for (id, value) in rows {
        let Ok(paths) = serde_json::from_str::<Vec<String>>(&value) else {
            continue;
        };
        let Some(path) = paths.first() else {
            continue;
        };
        let Some(info) = single_image_file_metadata(&paths) else {
            continue;
        };
        let search = file_search_label(path);
        conn.execute(
            "UPDATE history
             SET subtype = ?1, width = ?2, height = ?3, count = ?4, search = ?5
             WHERE id = ?6 AND type = 'files'",
            params![
                IMAGE_FILE_SUBTYPE,
                info.width,
                info.height,
                info.size,
                search,
                id
            ],
        )?;
    }

    Ok(())
}

fn file_search_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}
