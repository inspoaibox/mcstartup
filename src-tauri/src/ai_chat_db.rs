use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatThread {
    pub id: String,
    pub title: String,
    pub provider_id: String, // 关联到 AI 提供商配置
    pub model: String,       // 每个对话使用的具体模型
    pub status: String,      // "regular" | "archived"
    pub created_at: i64,
    pub updated_at: i64,
    // AI 参数配置
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: i32,
    #[serde(default = "default_top_p")]
    pub top_p: f32,
    #[serde(default)]
    pub frequency_penalty: f32,
    #[serde(default)]
    pub presence_penalty: f32,
    // 角色设定
    #[serde(default)]
    pub system_prompt: String, // 系统提示词/角色设定
}

fn default_temperature() -> f32 {
    0.7
}

fn default_max_tokens() -> i32 {
    4096
}

fn default_top_p() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub thread_id: String,
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadSummary {
    pub thread_id: String,
    pub summary: String,    // 压缩后的历史摘要文本
    pub key_points: String, // JSON 字符串，结构化关键点
    pub message_count: i64, // 上次压缩时的消息总数
    pub last_compressed_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMemory {
    pub id: String,
    pub user_id: String,
    pub memory: String,
    pub category: String, // "preference" | "fact" | "context" | "history"
    pub created_at: i64,
    pub updated_at: i64,
    pub relevance_score: f32, // 用于排序相关性
}

pub struct AiChatDb {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiChatBackup {
    #[serde(default)]
    pub threads: Vec<ChatThread>,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub memories: Vec<UserMemory>,
    #[serde(default)]
    pub summaries: Vec<ThreadSummary>,
}

impl AiChatDb {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        let db = Self { conn };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        // 创建线程表
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS chat_threads (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                model TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'regular',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        // 迁移：为已存在的表添加 model 列（如果不存在）
        let _ = self.conn.execute(
            "ALTER TABLE chat_threads ADD COLUMN model TEXT NOT NULL DEFAULT 'gpt-4o'",
            [],
        );

        // 迁移：添加 AI 参数配置列
        let _ = self.conn.execute(
            "ALTER TABLE chat_threads ADD COLUMN temperature REAL NOT NULL DEFAULT 0.7",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE chat_threads ADD COLUMN max_tokens INTEGER NOT NULL DEFAULT 4096",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE chat_threads ADD COLUMN top_p REAL NOT NULL DEFAULT 1.0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE chat_threads ADD COLUMN frequency_penalty REAL NOT NULL DEFAULT 0.0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE chat_threads ADD COLUMN presence_penalty REAL NOT NULL DEFAULT 0.0",
            [],
        );

        // 迁移：添加角色设定字段
        let _ = self.conn.execute(
            "ALTER TABLE chat_threads ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''",
            [],
        );

        // 创建消息表
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // 创建对话摘要表（替代全局 user_memories）
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS thread_summaries (
                thread_id TEXT PRIMARY KEY,
                summary TEXT NOT NULL DEFAULT '',
                key_points TEXT NOT NULL DEFAULT '[]',
                message_count INTEGER NOT NULL DEFAULT 0,
                last_compressed_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // 创建用户记忆表（保留但不再主动使用）
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS user_memories (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                memory TEXT NOT NULL,
                category TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                relevance_score REAL NOT NULL DEFAULT 1.0
            )",
            [],
        )?;

        // 创建索引
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON chat_messages(thread_id)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON chat_threads(updated_at DESC)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_memories_user_id ON user_memories(user_id)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_memories_category ON user_memories(category)",
            [],
        )?;

        Ok(())
    }

    // ==================== 线程管理 ====================

    pub fn list_threads(&self) -> Result<Vec<ChatThread>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, provider_id, model, status, created_at, updated_at,
                    temperature, max_tokens, top_p, frequency_penalty, presence_penalty, system_prompt
             FROM chat_threads 
             ORDER BY updated_at DESC",
        )?;

        let threads = stmt
            .query_map([], |row| {
                Ok(ChatThread {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    provider_id: row.get(2)?,
                    model: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    temperature: row.get(7)?,
                    max_tokens: row.get(8)?,
                    top_p: row.get(9)?,
                    frequency_penalty: row.get(10)?,
                    presence_penalty: row.get(11)?,
                    system_prompt: row.get(12)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(threads)
    }

    pub fn get_thread(&self, thread_id: &str) -> Result<Option<ChatThread>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, provider_id, model, status, created_at, updated_at,
                    temperature, max_tokens, top_p, frequency_penalty, presence_penalty, system_prompt
             FROM chat_threads 
             WHERE id = ?",
        )?;

        let mut rows = stmt.query(params![thread_id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(ChatThread {
                id: row.get(0)?,
                title: row.get(1)?,
                provider_id: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                temperature: row.get(7)?,
                max_tokens: row.get(8)?,
                top_p: row.get(9)?,
                frequency_penalty: row.get(10)?,
                presence_penalty: row.get(11)?,
                system_prompt: row.get(12)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn create_thread(&self, thread: &ChatThread) -> Result<()> {
        self.conn.execute(
            "INSERT INTO chat_threads (id, title, provider_id, model, status, created_at, updated_at,
                                       temperature, max_tokens, top_p, frequency_penalty, presence_penalty, system_prompt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                thread.id,
                thread.title,
                thread.provider_id,
                thread.model,
                thread.status,
                thread.created_at,
                thread.updated_at,
                thread.temperature,
                thread.max_tokens,
                thread.top_p,
                thread.frequency_penalty,
                thread.presence_penalty,
                thread.system_prompt,
            ],
        )?;
        Ok(())
    }

    pub fn update_thread_title(&self, thread_id: &str, title: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?",
            params![title, now, thread_id],
        )?;
        Ok(())
    }

    pub fn update_thread_model(
        &self,
        thread_id: &str,
        provider_id: &str,
        model: &str,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "UPDATE chat_threads SET provider_id = ?, model = ?, updated_at = ? WHERE id = ?",
            params![provider_id, model, now, thread_id],
        )?;
        Ok(())
    }

    pub fn update_thread_params(
        &self,
        thread_id: &str,
        temperature: f32,
        max_tokens: i32,
        top_p: f32,
        frequency_penalty: f32,
        presence_penalty: f32,
    ) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "UPDATE chat_threads SET temperature = ?, max_tokens = ?, top_p = ?,
             frequency_penalty = ?, presence_penalty = ?, updated_at = ? WHERE id = ?",
            params![
                temperature,
                max_tokens,
                top_p,
                frequency_penalty,
                presence_penalty,
                now,
                thread_id,
            ],
        )?;
        Ok(())
    }

    pub fn update_thread_system_prompt(&self, thread_id: &str, system_prompt: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "UPDATE chat_threads SET system_prompt = ?, updated_at = ? WHERE id = ?",
            params![system_prompt, now, thread_id],
        )?;
        Ok(())
    }

    pub fn update_thread_status(&self, thread_id: &str, status: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "UPDATE chat_threads SET status = ?, updated_at = ? WHERE id = ?",
            params![status, now, thread_id],
        )?;
        Ok(())
    }

    pub fn archive_thread(&self, thread_id: &str) -> Result<()> {
        self.update_thread_status(thread_id, "archived")
    }

    pub fn unarchive_thread(&self, thread_id: &str) -> Result<()> {
        self.update_thread_status(thread_id, "regular")
    }

    pub fn delete_thread(&self, thread_id: &str) -> Result<()> {
        // 先删除消息（由于外键约束，这会自动发生，但我们显式删除以确保）
        self.conn.execute(
            "DELETE FROM chat_messages WHERE thread_id = ?",
            params![thread_id],
        )?;

        // 删除线程
        self.conn
            .execute("DELETE FROM chat_threads WHERE id = ?", params![thread_id])?;

        Ok(())
    }

    pub fn touch_thread(&self, thread_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "UPDATE chat_threads SET updated_at = ? WHERE id = ?",
            params![now, thread_id],
        )?;
        Ok(())
    }

    // ==================== 消息管理 ====================

    pub fn list_messages(&self, thread_id: &str) -> Result<Vec<ChatMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, thread_id, role, content, created_at 
             FROM chat_messages 
             WHERE thread_id = ? 
             ORDER BY created_at ASC",
        )?;

        let messages = stmt
            .query_map(params![thread_id], |row| {
                Ok(ChatMessage {
                    id: row.get(0)?,
                    thread_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(messages)
    }

    pub fn add_message(&self, message: &ChatMessage) -> Result<()> {
        self.conn.execute(
            "INSERT INTO chat_messages (id, thread_id, role, content, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![
                message.id,
                message.thread_id,
                message.role,
                message.content,
                message.created_at,
            ],
        )?;

        // 更新线程的 updated_at
        self.touch_thread(&message.thread_id)?;

        Ok(())
    }

    pub fn delete_message(&self, message_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM chat_messages WHERE id = ?",
            params![message_id],
        )?;
        Ok(())
    }

    pub fn clear_thread_messages(&self, thread_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM chat_messages WHERE thread_id = ?",
            params![thread_id],
        )?;
        Ok(())
    }

    // ==================== 统计 ====================

    pub fn get_thread_message_count(&self, thread_id: &str) -> Result<i64> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM chat_messages WHERE thread_id = ?",
            params![thread_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    pub fn get_total_threads(&self) -> Result<i64> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM chat_threads", [], |row| row.get(0))?;
        Ok(count)
    }

    // ==================== 记忆管理 ====================

    pub fn add_memory(&self, memory: &UserMemory) -> Result<()> {
        self.conn.execute(
            "INSERT INTO user_memories (id, user_id, memory, category, created_at, updated_at, relevance_score)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                memory.id,
                memory.user_id,
                memory.memory,
                memory.category,
                memory.created_at,
                memory.updated_at,
                memory.relevance_score,
            ],
        )?;
        Ok(())
    }

    pub fn list_memories(&self, user_id: &str) -> Result<Vec<UserMemory>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, memory, category, created_at, updated_at, relevance_score
             FROM user_memories 
             WHERE user_id = ?
             ORDER BY updated_at DESC",
        )?;

        let memories = stmt
            .query_map(params![user_id], |row| {
                Ok(UserMemory {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    memory: row.get(2)?,
                    category: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    relevance_score: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(memories)
    }

    pub fn search_memories(
        &self,
        user_id: &str,
        query: &str,
        limit: i64,
    ) -> Result<Vec<UserMemory>> {
        // 简单的关键词搜索，使用 LIKE 进行模糊匹配
        let search_pattern = format!("%{}%", query);

        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, memory, category, created_at, updated_at, relevance_score
             FROM user_memories 
             WHERE user_id = ? AND memory LIKE ?
             ORDER BY relevance_score DESC, updated_at DESC
             LIMIT ?",
        )?;

        let memories = stmt
            .query_map(params![user_id, search_pattern, limit], |row| {
                Ok(UserMemory {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    memory: row.get(2)?,
                    category: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    relevance_score: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(memories)
    }

    pub fn update_memory(&self, memory_id: &str, new_memory: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.conn.execute(
            "UPDATE user_memories SET memory = ?, updated_at = ? WHERE id = ?",
            params![new_memory, now, memory_id],
        )?;
        Ok(())
    }

    pub fn delete_memory(&self, memory_id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM user_memories WHERE id = ?", params![memory_id])?;
        Ok(())
    }

    pub fn get_memories_by_category(
        &self,
        user_id: &str,
        category: &str,
    ) -> Result<Vec<UserMemory>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, memory, category, created_at, updated_at, relevance_score
             FROM user_memories 
             WHERE user_id = ? AND category = ?
             ORDER BY updated_at DESC",
        )?;

        let memories = stmt
            .query_map(params![user_id, category], |row| {
                Ok(UserMemory {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    memory: row.get(2)?,
                    category: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    relevance_score: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(memories)
    }

    // ==================== 对话摘要管理 ====================

    pub fn get_thread_summary(&self, thread_id: &str) -> Result<Option<ThreadSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT thread_id, summary, key_points, message_count, last_compressed_at, updated_at
             FROM thread_summaries WHERE thread_id = ?",
        )?;
        let mut rows = stmt.query_map(params![thread_id], |row| {
            Ok(ThreadSummary {
                thread_id: row.get(0)?,
                summary: row.get(1)?,
                key_points: row.get(2)?,
                message_count: row.get(3)?,
                last_compressed_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn upsert_thread_summary(&self, summary: &ThreadSummary) -> Result<()> {
        self.conn.execute(
            "INSERT INTO thread_summaries (thread_id, summary, key_points, message_count, last_compressed_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(thread_id) DO UPDATE SET
               summary = excluded.summary,
               key_points = excluded.key_points,
               message_count = excluded.message_count,
               last_compressed_at = excluded.last_compressed_at,
               updated_at = excluded.updated_at",
            params![
                summary.thread_id,
                summary.summary,
                summary.key_points,
                summary.message_count,
                summary.last_compressed_at,
                summary.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_thread_summary(&self, thread_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM thread_summaries WHERE thread_id = ?",
            params![thread_id],
        )?;
        Ok(())
    }

    pub fn export_backup(&self) -> Result<AiChatBackup> {
        let threads = self.list_threads()?;

        let mut message_stmt = self.conn.prepare(
            "SELECT id, thread_id, role, content, created_at
             FROM chat_messages
             ORDER BY created_at ASC",
        )?;
        let messages = message_stmt
            .query_map([], |row| {
                Ok(ChatMessage {
                    id: row.get(0)?,
                    thread_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut memory_stmt = self.conn.prepare(
            "SELECT id, user_id, memory, category, created_at, updated_at, relevance_score
             FROM user_memories
             ORDER BY updated_at DESC",
        )?;
        let memories = memory_stmt
            .query_map([], |row| {
                Ok(UserMemory {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    memory: row.get(2)?,
                    category: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    relevance_score: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut summary_stmt = self.conn.prepare(
            "SELECT thread_id, summary, key_points, message_count, last_compressed_at, updated_at
             FROM thread_summaries
             ORDER BY updated_at DESC",
        )?;
        let summaries = summary_stmt
            .query_map([], |row| {
                Ok(ThreadSummary {
                    thread_id: row.get(0)?,
                    summary: row.get(1)?,
                    key_points: row.get(2)?,
                    message_count: row.get(3)?,
                    last_compressed_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(AiChatBackup {
            threads,
            messages,
            memories,
            summaries,
        })
    }

    pub fn import_backup(&mut self, backup: &AiChatBackup) -> Result<()> {
        let tx = self.conn.transaction()?;

        tx.execute("DELETE FROM chat_messages", [])?;
        tx.execute("DELETE FROM thread_summaries", [])?;
        tx.execute("DELETE FROM user_memories", [])?;
        tx.execute("DELETE FROM chat_threads", [])?;

        for thread in &backup.threads {
            tx.execute(
                "INSERT INTO chat_threads (id, title, provider_id, model, status, created_at, updated_at,
                                           temperature, max_tokens, top_p, frequency_penalty, presence_penalty, system_prompt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    thread.id,
                    thread.title,
                    thread.provider_id,
                    thread.model,
                    thread.status,
                    thread.created_at,
                    thread.updated_at,
                    thread.temperature,
                    thread.max_tokens,
                    thread.top_p,
                    thread.frequency_penalty,
                    thread.presence_penalty,
                    thread.system_prompt,
                ],
            )?;
        }

        for message in &backup.messages {
            tx.execute(
                "INSERT INTO chat_messages (id, thread_id, role, content, created_at)
                 VALUES (?, ?, ?, ?, ?)",
                params![
                    message.id,
                    message.thread_id,
                    message.role,
                    message.content,
                    message.created_at,
                ],
            )?;
        }

        for memory in &backup.memories {
            tx.execute(
                "INSERT INTO user_memories (id, user_id, memory, category, created_at, updated_at, relevance_score)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                params![
                    memory.id,
                    memory.user_id,
                    memory.memory,
                    memory.category,
                    memory.created_at,
                    memory.updated_at,
                    memory.relevance_score,
                ],
            )?;
        }

        for summary in &backup.summaries {
            tx.execute(
                "INSERT INTO thread_summaries (thread_id, summary, key_points, message_count, last_compressed_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
                params![
                    summary.thread_id,
                    summary.summary,
                    summary.key_points,
                    summary.message_count,
                    summary.last_compressed_at,
                    summary.updated_at,
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }
}
