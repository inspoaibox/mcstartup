use crate::ai_chat_db::{AiChatDb, ChatMessage, ChatThread, ThreadSummary, UserMemory};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

pub struct AiChatState {
    pub db: Mutex<AiChatDb>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateThreadRequest {
    pub title: String,
    pub provider_id: String,
    pub model: String,
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
    #[serde(default)]
    pub system_prompt: Option<String>,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct AddMessageRequest {
    pub thread_id: String,
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateThreadTitleRequest {
    pub thread_id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddMemoryRequest {
    pub user_id: String,
    pub memory: String,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchMemoriesRequest {
    pub user_id: String,
    pub query: String,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateMemoryRequest {
    pub memory_id: String,
    pub memory: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractMemoriesRequest {
    pub user_id: String,
    pub messages: Vec<String>,
}

// ==================== 线程管理命令 ====================

#[tauri::command]
pub fn ai_chat_list_threads(state: State<AiChatState>) -> Result<Vec<ChatThread>, String> {
    let db = state.db.lock().unwrap();
    db.list_threads().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_get_thread(
    state: State<AiChatState>,
    thread_id: String,
) -> Result<Option<ChatThread>, String> {
    let db = state.db.lock().unwrap();
    let result = db.get_thread(&thread_id).map_err(|e| e.to_string())?;
    println!("[ai_chat_get_thread] Thread ID: {}", thread_id);
    println!("[ai_chat_get_thread] Result: {:?}", result);
    Ok(result)
}

#[tauri::command]
pub fn ai_chat_create_thread(
    state: State<AiChatState>,
    request: CreateThreadRequest,
) -> Result<ChatThread, String> {
    println!("[ai_chat_create_thread] Request: {:?}", request);
    println!("[ai_chat_create_thread] Model: {}", request.model);

    let db = state.db.lock().unwrap();
    let now = chrono::Utc::now().timestamp();

    let thread = ChatThread {
        id: uuid::Uuid::new_v4().to_string(),
        title: request.title,
        provider_id: request.provider_id,
        model: request.model,
        status: "regular".to_string(),
        created_at: now,
        updated_at: now,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        top_p: request.top_p,
        frequency_penalty: request.frequency_penalty,
        presence_penalty: request.presence_penalty,
        system_prompt: request.system_prompt.unwrap_or_default(),
    };

    println!(
        "[ai_chat_create_thread] Created thread struct: {:?}",
        thread
    );

    db.create_thread(&thread).map_err(|e| e.to_string())?;

    println!("[ai_chat_create_thread] Thread saved to database");

    Ok(thread)
}

#[tauri::command]
pub fn ai_chat_update_thread_title(
    state: State<AiChatState>,
    request: UpdateThreadTitleRequest,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.update_thread_title(&request.thread_id, &request.title)
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct UpdateThreadModelRequest {
    pub thread_id: String,
    pub provider_id: String,
    pub model: String,
}

#[tauri::command]
pub fn ai_chat_update_thread_model(
    state: State<AiChatState>,
    request: UpdateThreadModelRequest,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.update_thread_model(&request.thread_id, &request.provider_id, &request.model)
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct UpdateThreadSystemPromptRequest {
    pub thread_id: String,
    pub system_prompt: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateThreadParamsRequest {
    pub thread_id: String,
    pub temperature: f32,
    pub max_tokens: i32,
    pub top_p: f32,
    pub frequency_penalty: f32,
    pub presence_penalty: f32,
}

#[tauri::command]
pub fn ai_chat_update_thread_params(
    state: State<AiChatState>,
    request: UpdateThreadParamsRequest,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.update_thread_params(
        &request.thread_id,
        request.temperature,
        request.max_tokens,
        request.top_p,
        request.frequency_penalty,
        request.presence_penalty,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_update_thread_system_prompt(
    state: State<AiChatState>,
    request: UpdateThreadSystemPromptRequest,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.update_thread_system_prompt(&request.thread_id, &request.system_prompt)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_archive_thread(state: State<AiChatState>, thread_id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.archive_thread(&thread_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_unarchive_thread(
    state: State<AiChatState>,
    thread_id: String,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.unarchive_thread(&thread_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_delete_thread(state: State<AiChatState>, thread_id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.delete_thread(&thread_id).map_err(|e| e.to_string())
}

// ==================== 消息管理命令 ====================

#[tauri::command]
pub fn ai_chat_list_messages(
    state: State<AiChatState>,
    thread_id: String,
) -> Result<Vec<ChatMessage>, String> {
    let db = state.db.lock().unwrap();
    db.list_messages(&thread_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_add_message(
    state: State<AiChatState>,
    request: AddMessageRequest,
) -> Result<ChatMessage, String> {
    let db = state.db.lock().unwrap();
    let now = chrono::Utc::now().timestamp();

    let message = ChatMessage {
        id: uuid::Uuid::new_v4().to_string(),
        thread_id: request.thread_id,
        role: request.role,
        content: request.content,
        created_at: now,
    };

    db.add_message(&message).map_err(|e| e.to_string())?;
    Ok(message)
}

#[tauri::command]
pub fn ai_chat_delete_message(state: State<AiChatState>, message_id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.delete_message(&message_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_clear_thread_messages(
    state: State<AiChatState>,
    thread_id: String,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.clear_thread_messages(&thread_id)
        .map_err(|e| e.to_string())
}

// ==================== 统计命令 ====================

#[tauri::command]
pub fn ai_chat_get_thread_message_count(
    state: State<AiChatState>,
    thread_id: String,
) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    db.get_thread_message_count(&thread_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_get_total_threads(state: State<AiChatState>) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    db.get_total_threads().map_err(|e| e.to_string())
}

// ==================== 记忆管理命令 ====================

#[tauri::command]
pub fn ai_chat_add_memory(
    state: State<AiChatState>,
    request: AddMemoryRequest,
) -> Result<UserMemory, String> {
    let db = state.db.lock().unwrap();
    let now = chrono::Utc::now().timestamp();

    let memory = UserMemory {
        id: uuid::Uuid::new_v4().to_string(),
        user_id: request.user_id,
        memory: request.memory,
        category: request.category,
        created_at: now,
        updated_at: now,
        relevance_score: 1.0,
    };

    db.add_memory(&memory).map_err(|e| e.to_string())?;
    Ok(memory)
}

#[tauri::command]
pub fn ai_chat_list_memories(
    state: State<AiChatState>,
    user_id: String,
) -> Result<Vec<UserMemory>, String> {
    let db = state.db.lock().unwrap();
    db.list_memories(&user_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_search_memories(
    state: State<AiChatState>,
    request: SearchMemoriesRequest,
) -> Result<Vec<UserMemory>, String> {
    let db = state.db.lock().unwrap();
    let limit = request.limit.unwrap_or(10);
    db.search_memories(&request.user_id, &request.query, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_update_memory(
    state: State<AiChatState>,
    request: UpdateMemoryRequest,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.update_memory(&request.memory_id, &request.memory)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_delete_memory(state: State<AiChatState>, memory_id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.delete_memory(&memory_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_get_memories_by_category(
    state: State<AiChatState>,
    user_id: String,
    category: String,
) -> Result<Vec<UserMemory>, String> {
    let db = state.db.lock().unwrap();
    db.get_memories_by_category(&user_id, &category)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_extract_memories(
    _state: State<AiChatState>,
    request: ExtractMemoriesRequest,
) -> Result<Vec<String>, String> {
    // 简单的关键词提取逻辑
    // 在实际应用中，这里可以调用 AI API 来提取记忆
    let mut extracted = Vec::new();

    for message in &request.messages {
        let lower = message.to_lowercase();

        // 检测偏好
        if lower.contains("我喜欢") || lower.contains("我偏好") || lower.contains("我更喜欢")
        {
            extracted.push(message.clone());
        }

        // 检测事实
        if lower.contains("我是") || lower.contains("我在") || lower.contains("我的") {
            extracted.push(message.clone());
        }

        // 检测上下文
        if lower.contains("我正在") || lower.contains("我需要") {
            extracted.push(message.clone());
        }
    }

    Ok(extracted)
}

// ==================== 对话摘要命令 ====================

#[tauri::command]
pub fn ai_chat_get_thread_summary(
    state: State<AiChatState>,
    thread_id: String,
) -> Result<Option<ThreadSummary>, String> {
    let db = state.db.lock().unwrap();
    db.get_thread_summary(&thread_id).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpsertThreadSummaryRequest {
    pub thread_id: String,
    pub summary: String,
    pub key_points: String, // JSON 字符串
    pub message_count: i64,
    pub last_compressed_at: i64,
}

#[tauri::command]
pub fn ai_chat_upsert_thread_summary(
    state: State<AiChatState>,
    request: UpsertThreadSummaryRequest,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = chrono::Utc::now().timestamp();
    let summary = ThreadSummary {
        thread_id: request.thread_id,
        summary: request.summary,
        key_points: request.key_points,
        message_count: request.message_count,
        last_compressed_at: request.last_compressed_at,
        updated_at: now,
    };
    db.upsert_thread_summary(&summary)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_chat_delete_thread_summary(
    state: State<AiChatState>,
    thread_id: String,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.delete_thread_summary(&thread_id)
        .map_err(|e| e.to_string())
}
