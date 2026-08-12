use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use mysql::prelude::Queryable;
use postgres::types::Type;
use postgres::{Client as PostgresClient, NoTls, Row as PostgresRow};
use rusqlite::types::{Value, ValueRef};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseConnectionRequest {
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObjectRef {
    pub name: String,
    #[serde(default)]
    pub schema: String,
    #[serde(default)]
    pub object_type: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryRequest {
    pub connection: DatabaseConnectionRequest,
    pub query: String,
    #[serde(default = "default_query_limit")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
    #[serde(default)]
    pub target: Option<DatabaseObjectRef>,
    #[serde(default)]
    pub sort: Option<DatabaseSortRequest>,
    #[serde(default)]
    pub filters: Vec<DatabaseFilterRequest>,
    #[serde(default)]
    pub allow_dangerous: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSortRequest {
    pub column: String,
    #[serde(default)]
    pub direction: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseFilterRequest {
    pub column: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub operator: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseUpdateCellRequest {
    pub connection: DatabaseConnectionRequest,
    pub target: DatabaseObjectRef,
    #[serde(default)]
    pub key: Vec<DatabaseCellValue>,
    pub column: String,
    pub value: String,
    #[serde(default)]
    pub is_null: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInsertRowRequest {
    pub connection: DatabaseConnectionRequest,
    pub target: DatabaseObjectRef,
    pub values: Vec<DatabaseCellValue>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDeleteRowRequest {
    pub connection: DatabaseConnectionRequest,
    pub target: DatabaseObjectRef,
    pub key: Vec<DatabaseCellValue>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCellValue {
    pub column: String,
    pub value: String,
    #[serde(default)]
    pub is_null: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseTestResult {
    pub ok: bool,
    pub database_version: String,
    pub latency_ms: u128,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSummaryItem {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: String,
    pub primary_key: bool,
    pub foreign_key: Option<DatabaseForeignKeyInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseForeignKeyInfo {
    pub table: String,
    pub schema: String,
    pub column: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSchemaObject {
    pub id: String,
    pub name: String,
    pub schema: String,
    pub object_type: String,
    pub row_count: Option<u64>,
    pub columns: Vec<DatabaseColumnInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSchemaGroup {
    pub id: String,
    pub name: String,
    pub group_type: String,
    pub objects: Vec<DatabaseSchemaObject>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSchemaResult {
    pub summary: Vec<DatabaseSummaryItem>,
    pub groups: Vec<DatabaseSchemaGroup>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub null_cells: Vec<Vec<bool>>,
    pub affected_rows: u64,
    pub duration_ms: u128,
    pub row_count: usize,
    pub total_rows: Option<u64>,
    pub truncated: bool,
    pub message: String,
}

fn default_query_limit() -> u32 {
    200
}

#[tauri::command]
pub async fn database_test_connection(
    request: DatabaseConnectionRequest,
) -> Result<DatabaseTestResult, String> {
    tauri::async_runtime::spawn_blocking(move || database_test_connection_blocking(request))
        .await
        .map_err(|e| format!("数据库连接任务失败: {}", e))?
}

#[tauri::command]
pub async fn database_load_schema(
    request: DatabaseConnectionRequest,
) -> Result<DatabaseSchemaResult, String> {
    tauri::async_runtime::spawn_blocking(move || database_load_schema_blocking(request))
        .await
        .map_err(|e| format!("数据库结构读取任务失败: {}", e))?
}

#[tauri::command]
pub async fn database_execute_query(
    request: DatabaseQueryRequest,
) -> Result<DatabaseQueryResult, String> {
    tauri::async_runtime::spawn_blocking(move || database_execute_query_blocking(request))
        .await
        .map_err(|e| format!("数据库查询任务失败: {}", e))?
}

#[tauri::command]
pub async fn database_preview_object(
    request: DatabaseQueryRequest,
) -> Result<DatabaseQueryResult, String> {
    tauri::async_runtime::spawn_blocking(move || database_preview_object_blocking(request))
        .await
        .map_err(|e| format!("数据库预览任务失败: {}", e))?
}

#[tauri::command]
pub async fn database_update_cell(
    request: DatabaseUpdateCellRequest,
) -> Result<DatabaseQueryResult, String> {
    tauri::async_runtime::spawn_blocking(move || database_update_cell_blocking(request))
        .await
        .map_err(|e| format!("数据库更新任务失败: {}", e))?
}

#[tauri::command]
pub async fn database_insert_row(
    request: DatabaseInsertRowRequest,
) -> Result<DatabaseQueryResult, String> {
    tauri::async_runtime::spawn_blocking(move || database_insert_row_blocking(request))
        .await
        .map_err(|e| format!("数据库新增任务失败: {}", e))?
}

#[tauri::command]
pub async fn database_delete_row(
    request: DatabaseDeleteRowRequest,
) -> Result<DatabaseQueryResult, String> {
    tauri::async_runtime::spawn_blocking(move || database_delete_row_blocking(request))
        .await
        .map_err(|e| format!("数据库删除任务失败: {}", e))?
}

fn database_test_connection_blocking(
    request: DatabaseConnectionRequest,
) -> Result<DatabaseTestResult, String> {
    let started = Instant::now();
    let display_name = request.name.trim().to_string();
    let version = match normalized_kind(&request).as_str() {
        "sqlite" => sqlite_version(&request)?,
        "postgresql" => {
            let mut client = postgres_connect(&request)?;
            client
                .query_one("select version()", &[])
                .map_err(|e| e.to_string())?
                .try_get::<usize, String>(0)
                .map_err(|e| e.to_string())?
        }
        "mysql" => {
            let mut conn = mysql_connect(&request)?;
            conn.query_first::<String, _>("select version()")
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| "MySQL".to_string())
        }
        "redis" => {
            let mut conn = redis_connect(&request)?;
            let pong: String = redis::cmd("PING")
                .query(&mut conn)
                .map_err(|e| e.to_string())?;
            format!("Redis {}", pong)
        }
        "mongodb" => {
            let client = mongo_connect(&request)?;
            let result = client
                .database("admin")
                .run_command(mongodb::bson::doc! { "ping": 1 })
                .run()
                .map_err(|e| e.to_string())?;
            format!("MongoDB {}", bson_value_to_string(result.get("ok")))
        }
        _ => return Err("不支持的数据库类型".to_string()),
    };

    Ok(DatabaseTestResult {
        ok: true,
        database_version: version,
        latency_ms: started.elapsed().as_millis(),
        message: if display_name.is_empty() {
            "连接成功".to_string()
        } else {
            format!("{} 连接成功", display_name)
        },
    })
}

fn database_load_schema_blocking(
    request: DatabaseConnectionRequest,
) -> Result<DatabaseSchemaResult, String> {
    match normalized_kind(&request).as_str() {
        "sqlite" => sqlite_schema(&request),
        "postgresql" => postgres_schema(&request),
        "mysql" => mysql_schema(&request),
        "redis" => redis_schema(&request),
        "mongodb" => mongo_schema(&request),
        _ => Err("不支持的数据库类型".to_string()),
    }
}

fn database_execute_query_blocking(
    request: DatabaseQueryRequest,
) -> Result<DatabaseQueryResult, String> {
    guard_dangerous_query(
        &normalized_kind(&request.connection),
        &request.query,
        request.allow_dangerous,
    )?;
    match normalized_kind(&request.connection).as_str() {
        "sqlite" => sqlite_execute(&request.connection, &request.query, request.limit),
        "postgresql" => postgres_execute(&request.connection, &request.query, request.limit),
        "mysql" => mysql_execute(&request.connection, &request.query, request.limit),
        "redis" => redis_execute(&request.connection, &request.query, request.limit),
        "mongodb" => mongo_execute(
            &request.connection,
            &request.query,
            request.limit,
            request.target,
        ),
        _ => Err("不支持的数据库类型".to_string()),
    }
}

fn database_preview_object_blocking(
    request: DatabaseQueryRequest,
) -> Result<DatabaseQueryResult, String> {
    let target = request
        .target
        .clone()
        .ok_or_else(|| "请选择要预览的对象".to_string())?;
    let limit = request.limit.clamp(1, 1000);
    match normalized_kind(&request.connection).as_str() {
        "sqlite" => sqlite_preview_table(&request.connection, &target, &request),
        "postgresql" => postgres_preview_table(&request.connection, &target, &request),
        "mysql" => mysql_preview_table(&request.connection, &target, &request),
        "redis" => redis_preview_key(
            &request.connection,
            &target.name,
            &target.object_type,
            limit,
        ),
        "mongodb" => mongo_execute(
            &request.connection,
            "{}",
            limit,
            Some(DatabaseObjectRef {
                name: target.name,
                schema: target.schema,
                object_type: "collection".to_string(),
            }),
        ),
        _ => Err("不支持的数据库类型".to_string()),
    }
}

fn database_update_cell_blocking(
    request: DatabaseUpdateCellRequest,
) -> Result<DatabaseQueryResult, String> {
    let kind = normalized_kind(&request.connection);
    if !matches!(kind.as_str(), "sqlite" | "postgresql" | "mysql") {
        return Err("当前仅支持 SQL 数据库的单元格编辑".to_string());
    }
    if request.target.object_type != "table" {
        return Err("只允许编辑普通表，视图/集合/Key 不支持直接编辑".to_string());
    }
    validate_row_key(&request.key)?;
    validate_identifier(&request.column)?;
    validate_identifier(&request.target.name)?;
    if request.key.iter().any(|cell| cell.column == request.column) {
        return Err("为避免定位失效，暂不允许直接编辑主键列".to_string());
    }

    match kind.as_str() {
        "sqlite" => sqlite_update_cell(&request),
        "postgresql" => postgres_update_cell(&request),
        "mysql" => mysql_update_cell(&request),
        _ => Err("不支持的数据库类型".to_string()),
    }
}

fn database_insert_row_blocking(
    request: DatabaseInsertRowRequest,
) -> Result<DatabaseQueryResult, String> {
    let kind = normalized_kind(&request.connection);
    if !matches!(kind.as_str(), "sqlite" | "postgresql" | "mysql") {
        return Err("当前仅支持 SQL 数据库新增行".to_string());
    }
    validate_table_target(&request.target)?;
    let values = request
        .values
        .iter()
        .filter(|cell| !cell.column.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>();
    if values.is_empty() {
        return Err("至少填写一个字段值".to_string());
    }
    for cell in &values {
        validate_identifier(&cell.column)?;
    }
    match kind.as_str() {
        "sqlite" => sqlite_insert_row(&request.connection, &request.target, &values),
        "postgresql" => postgres_insert_row(&request.connection, &request.target, &values),
        "mysql" => mysql_insert_row(&request.connection, &request.target, &values),
        _ => Err("不支持的数据库类型".to_string()),
    }
}

fn database_delete_row_blocking(
    request: DatabaseDeleteRowRequest,
) -> Result<DatabaseQueryResult, String> {
    let kind = normalized_kind(&request.connection);
    if !matches!(kind.as_str(), "sqlite" | "postgresql" | "mysql") {
        return Err("当前仅支持 SQL 数据库删除行".to_string());
    }
    validate_table_target(&request.target)?;
    validate_row_key(&request.key)?;
    match kind.as_str() {
        "sqlite" => sqlite_delete_row(&request.connection, &request.target, &request.key),
        "postgresql" => postgres_delete_row(&request.connection, &request.target, &request.key),
        "mysql" => mysql_delete_row(&request.connection, &request.target, &request.key),
        _ => Err("不支持的数据库类型".to_string()),
    }
}

fn sqlite_version(request: &DatabaseConnectionRequest) -> Result<String, String> {
    let conn = sqlite_connect(request)?;
    conn.query_row("select sqlite_version()", [], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())
}

fn sqlite_connect(request: &DatabaseConnectionRequest) -> Result<rusqlite::Connection, String> {
    let path = request.file_path.trim();
    if path.is_empty() {
        return Err("请选择 SQLite 数据库文件".to_string());
    }
    rusqlite::Connection::open(PathBuf::from(path)).map_err(|e| format!("打开 SQLite 失败: {}", e))
}

fn sqlite_schema(request: &DatabaseConnectionRequest) -> Result<DatabaseSchemaResult, String> {
    let conn = sqlite_connect(request)?;
    let version = conn
        .query_row("select sqlite_version()", [], |row| row.get::<_, String>(0))
        .unwrap_or_default();
    let mut stmt = conn
        .prepare(
            "select name, type from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by type, name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut tables = Vec::new();
    let mut views = Vec::new();
    for row in rows {
        let (name, object_type) = row.map_err(|e| e.to_string())?;
        let columns = sqlite_columns(&conn, &name)?;
        let row_count = if object_type == "table" {
            sqlite_table_count(&conn, &name)
        } else {
            None
        };
        let object = DatabaseSchemaObject {
            id: format!("sqlite|{}|{}", object_type, name),
            name,
            schema: String::new(),
            object_type: object_type.clone(),
            row_count,
            columns,
        };
        if object_type == "view" {
            views.push(object);
        } else {
            tables.push(object);
        }
    }
    let table_count = tables.len();
    let view_count = views.len();
    Ok(DatabaseSchemaResult {
        summary: vec![
            summary_item("类型", "SQLite"),
            summary_item("版本", version),
            summary_item("表", table_count.to_string()),
            summary_item("视图", view_count.to_string()),
        ],
        groups: vec![
            schema_group("sqlite-tables", "表", "table", tables),
            schema_group("sqlite-views", "视图", "view", views),
        ],
        message: "结构读取完成".to_string(),
    })
}

fn sqlite_foreign_keys(
    conn: &rusqlite::Connection,
    table: &str,
) -> Result<Vec<(String, DatabaseForeignKeyInfo)>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "pragma foreign_key_list({})",
            quote_sqlite_string(table)
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(3)?,
                DatabaseForeignKeyInfo {
                    table: row.get::<_, String>(2)?,
                    schema: String::new(),
                    column: row.get::<_, String>(4)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn sqlite_columns(
    conn: &rusqlite::Connection,
    table: &str,
) -> Result<Vec<DatabaseColumnInfo>, String> {
    let foreign_keys = sqlite_foreign_keys(conn, table)?;
    let mut stmt = conn
        .prepare(&format!(
            "pragma table_info({})",
            quote_sqlite_string(table)
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(DatabaseColumnInfo {
                name: row.get::<_, String>(1)?,
                data_type: row.get::<_, String>(2).unwrap_or_default(),
                nullable: row.get::<_, i64>(3).unwrap_or(0) == 0,
                default_value: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                primary_key: row.get::<_, i64>(5).unwrap_or(0) > 0,
                foreign_key: foreign_keys
                    .iter()
                    .find(|(column, _)| column == &row.get::<_, String>(1).unwrap_or_default())
                    .map(|(_, foreign_key)| foreign_key.clone()),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn sqlite_table_count(conn: &rusqlite::Connection, table: &str) -> Option<u64> {
    conn.query_row(
        &format!("select count(*) from {}", quote_sqlite_table(table)),
        [],
        |row| row.get::<_, u64>(0),
    )
    .ok()
}

fn sqlite_preview_table(
    request: &DatabaseConnectionRequest,
    target: &DatabaseObjectRef,
    query: &DatabaseQueryRequest,
) -> Result<DatabaseQueryResult, String> {
    validate_preview_target(target)?;
    let started = Instant::now();
    let conn = sqlite_connect(request)?;
    let table = quote_sqlite_table(&target.name);
    let (where_sql, params) = sqlite_filter_clause(&query.filters)?;
    let order_sql = sqlite_order_clause(&query.sort)?;
    let limit = query.limit.clamp(1, 1000);
    let offset = query.offset.min(1_000_000);
    let total_rows = conn
        .query_row(
            &format!("select count(*) from {table}{where_sql}"),
            rusqlite::params_from_iter(params.iter()),
            |row| row.get::<_, u64>(0),
        )
        .ok();
    let sql = format!("select * from {table}{where_sql}{order_sql} limit {limit} offset {offset}");
    sqlite_query_with_params(&conn, &sql, &params, started, total_rows)
}

fn sqlite_execute(
    request: &DatabaseConnectionRequest,
    sql: &str,
    limit: u32,
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let conn = sqlite_connect(request)?;
    let sql = trimmed_sql(sql);
    if sql.is_empty() {
        return Err("请输入 SQL".to_string());
    }
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let column_count = stmt.column_count();
    if column_count == 0 {
        let affected = stmt.execute([]).map_err(|e| e.to_string())? as u64;
        return Ok(DatabaseQueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            null_cells: Vec::new(),
            affected_rows: affected,
            duration_ms: started.elapsed().as_millis(),
            row_count: 0,
            total_rows: None,
            truncated: false,
            message: format!("执行完成，影响 {} 行", affected),
        });
    }

    let columns = stmt
        .column_names()
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let max_rows = limit.clamp(1, 1000) as usize;
    let mut rows = Vec::new();
    let mut null_cells = Vec::new();
    let mut query = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = query.next().map_err(|e| e.to_string())? {
        if rows.len() >= max_rows {
            break;
        }
        let mut values = Vec::new();
        let mut nulls = Vec::new();
        for index in 0..column_count {
            let cell = sqlite_value_to_display(row.get_ref(index).map_err(|e| e.to_string())?);
            values.push(cell.value);
            nulls.push(cell.is_null);
        }
        rows.push(values);
        null_cells.push(nulls);
    }
    let truncated = rows.len() >= max_rows;
    Ok(DatabaseQueryResult {
        columns,
        row_count: rows.len(),
        rows,
        null_cells,
        affected_rows: 0,
        duration_ms: started.elapsed().as_millis(),
        total_rows: None,
        truncated,
        message: "查询完成".to_string(),
    })
}

fn sqlite_query_with_params(
    conn: &rusqlite::Connection,
    sql: &str,
    params: &[Value],
    started: Instant,
    total_rows: Option<u64>,
) -> Result<DatabaseQueryResult, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let column_count = stmt.column_count();
    let columns = stmt
        .column_names()
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let mut rows = Vec::new();
    let mut null_cells = Vec::new();
    let mut query = stmt
        .query(rusqlite::params_from_iter(params.iter()))
        .map_err(|e| e.to_string())?;
    while let Some(row) = query.next().map_err(|e| e.to_string())? {
        let mut values = Vec::new();
        let mut nulls = Vec::new();
        for index in 0..column_count {
            let cell = sqlite_value_to_display(row.get_ref(index).map_err(|e| e.to_string())?);
            values.push(cell.value);
            nulls.push(cell.is_null);
        }
        rows.push(values);
        null_cells.push(nulls);
    }
    Ok(DatabaseQueryResult {
        columns,
        row_count: rows.len(),
        rows,
        null_cells,
        affected_rows: 0,
        duration_ms: started.elapsed().as_millis(),
        total_rows,
        truncated: false,
        message: "查询完成".to_string(),
    })
}

fn sqlite_update_cell(request: &DatabaseUpdateCellRequest) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let conn = sqlite_connect(&request.connection)?;
    let table = quote_sqlite_table(&request.target.name);
    let column = quote_sqlite_table(&request.column);
    let (where_sql, mut params) = sqlite_key_where_clause(&request.key, 2);
    params.insert(
        0,
        database_cell_to_sqlite_value(&DatabaseCellValue {
            column: request.column.clone(),
            value: request.value.clone(),
            is_null: request.is_null,
        }),
    );
    let affected = conn
        .execute(
            &format!("update {table} set {column} = ?1 where {where_sql}"),
            rusqlite::params_from_iter(params.iter()),
        )
        .map_err(|e| e.to_string())? as u64;
    if affected > 1 {
        return Err(format!(
            "更新影响 {} 行，已拒绝视为安全单行编辑。请检查主键是否唯一。",
            affected
        ));
    }
    Ok(DatabaseQueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        null_cells: Vec::new(),
        affected_rows: affected,
        duration_ms: started.elapsed().as_millis(),
        row_count: 0,
        total_rows: None,
        truncated: false,
        message: format!("单元格更新完成，影响 {} 行", affected),
    })
}

fn sqlite_insert_row(
    connection: &DatabaseConnectionRequest,
    target: &DatabaseObjectRef,
    values: &[DatabaseCellValue],
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let conn = sqlite_connect(connection)?;
    let table = quote_sqlite_table(&target.name);
    let columns = values
        .iter()
        .map(|cell| quote_sqlite_table(&cell.column))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = (1..=values.len())
        .map(|index| format!("?{}", index))
        .collect::<Vec<_>>()
        .join(", ");
    let params = values
        .iter()
        .map(database_cell_to_sqlite_value)
        .collect::<Vec<_>>();
    let affected = conn
        .execute(
            &format!("insert into {table} ({columns}) values ({placeholders})"),
            rusqlite::params_from_iter(params),
        )
        .map_err(|e| e.to_string())? as u64;
    Ok(mutation_result(started, affected, "新增行完成"))
}

fn sqlite_delete_row(
    connection: &DatabaseConnectionRequest,
    target: &DatabaseObjectRef,
    key: &[DatabaseCellValue],
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let conn = sqlite_connect(connection)?;
    let table = quote_sqlite_table(&target.name);
    let (where_sql, params) = sqlite_key_where_clause(key, 1);
    let affected = conn
        .execute(
            &format!("delete from {table} where {where_sql}"),
            rusqlite::params_from_iter(params.iter()),
        )
        .map_err(|e| e.to_string())? as u64;
    ensure_single_row_affected(affected)?;
    Ok(mutation_result(started, affected, "删除行完成"))
}

fn postgres_connect(request: &DatabaseConnectionRequest) -> Result<PostgresClient, String> {
    if !request.url.trim().is_empty() {
        return PostgresClient::connect(request.url.trim(), NoTls)
            .map_err(|e| format!("连接 PostgreSQL 失败: {}", e));
    }
    let mut config = postgres::Config::new();
    config.host(non_empty(&request.host, "127.0.0.1"));
    config.port(request.port.unwrap_or(5432));
    if !request.username.trim().is_empty() {
        config.user(request.username.trim());
    }
    if !request.password.is_empty() {
        config.password(&request.password);
    }
    if !request.database.trim().is_empty() {
        config.dbname(request.database.trim());
    }
    config
        .connect(NoTls)
        .map_err(|e| format!("连接 PostgreSQL 失败: {}", e))
}

fn postgres_schema(request: &DatabaseConnectionRequest) -> Result<DatabaseSchemaResult, String> {
    let mut client = postgres_connect(request)?;
    let version = client
        .query_one("select version()", &[])
        .ok()
        .and_then(|row| row.try_get::<usize, String>(0).ok())
        .unwrap_or_default();
    let object_rows = client
        .query(
            "select table_schema, table_name, table_type from information_schema.tables where table_schema not in ('pg_catalog','information_schema') order by table_schema, table_name",
            &[],
        )
        .map_err(|e| e.to_string())?;
    let column_rows = client
        .query(
            "select table_schema, table_name, column_name, data_type, is_nullable, coalesce(column_default, '') from information_schema.columns where table_schema not in ('pg_catalog','information_schema') order by table_schema, table_name, ordinal_position",
            &[],
        )
        .map_err(|e| e.to_string())?;
    let pk_rows = client
        .query(
            "select kcu.table_schema, kcu.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema not in ('pg_catalog','information_schema')",
            &[],
        )
        .map_err(|e| e.to_string())?;
    let fk_rows = client
        .query(
            "select kcu.table_schema, kcu.table_name, kcu.column_name, rcu.table_schema, rcu.table_name, rcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_catalog = kcu.constraint_catalog and tc.constraint_schema = kcu.constraint_schema and tc.constraint_name = kcu.constraint_name join information_schema.referential_constraints rc on tc.constraint_catalog = rc.constraint_catalog and tc.constraint_schema = rc.constraint_schema and tc.constraint_name = rc.constraint_name join information_schema.key_column_usage rcu on rcu.constraint_catalog = rc.unique_constraint_catalog and rcu.constraint_schema = rc.unique_constraint_schema and rcu.constraint_name = rc.unique_constraint_name and rcu.ordinal_position = kcu.position_in_unique_constraint where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema not in ('pg_catalog','information_schema')",
            &[],
        )
        .map_err(|e| e.to_string())?;
    let mut objects = Vec::new();
    for row in object_rows {
        let schema: String = row.try_get(0).unwrap_or_default();
        let name: String = row.try_get(1).unwrap_or_default();
        let table_type: String = row.try_get(2).unwrap_or_default();
        let object_type = if table_type.to_lowercase().contains("view") {
            "view"
        } else {
            "table"
        };
        let columns = column_rows
            .iter()
            .filter_map(|column| {
                let column_schema: String = column.try_get(0).ok()?;
                let column_table: String = column.try_get(1).ok()?;
                if column_schema != schema || column_table != name {
                    return None;
                }
                Some(DatabaseColumnInfo {
                    name: column.try_get(2).unwrap_or_default(),
                    data_type: column.try_get(3).unwrap_or_default(),
                    nullable: column
                        .try_get::<usize, String>(4)
                        .unwrap_or_default()
                        .eq_ignore_ascii_case("yes"),
                    default_value: column.try_get(5).unwrap_or_default(),
                    primary_key: pk_rows.iter().any(|pk| {
                        pk.try_get::<usize, String>(0).unwrap_or_default() == schema
                            && pk.try_get::<usize, String>(1).unwrap_or_default() == name
                            && pk.try_get::<usize, String>(2).unwrap_or_default()
                                == column.try_get::<usize, String>(2).unwrap_or_default()
                    }),
                    foreign_key: fk_rows
                        .iter()
                        .find(|fk| {
                            fk.try_get::<usize, String>(0).unwrap_or_default() == schema
                                && fk.try_get::<usize, String>(1).unwrap_or_default() == name
                                && fk.try_get::<usize, String>(2).unwrap_or_default()
                                    == column.try_get::<usize, String>(2).unwrap_or_default()
                        })
                        .map(|fk| DatabaseForeignKeyInfo {
                            schema: fk.try_get(3).unwrap_or_default(),
                            table: fk.try_get(4).unwrap_or_default(),
                            column: fk.try_get(5).unwrap_or_default(),
                        }),
                })
            })
            .collect();
        objects.push(DatabaseSchemaObject {
            id: format!("postgresql|{}|{}|{}", object_type, schema, name),
            name,
            schema,
            object_type: object_type.to_string(),
            row_count: None,
            columns,
        });
    }
    Ok(schema_from_objects(
        vec![
            summary_item("类型", "PostgreSQL"),
            summary_item("版本", version),
        ],
        objects,
    ))
}

fn postgres_execute(
    request: &DatabaseConnectionRequest,
    sql: &str,
    limit: u32,
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let mut client = postgres_connect(request)?;
    let sql = trimmed_sql(sql);
    if sql.is_empty() {
        return Err("请输入 SQL".to_string());
    }
    if !looks_like_reader(sql) {
        let affected = client.execute(sql, &[]).map_err(|e| e.to_string())?;
        return Ok(DatabaseQueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            null_cells: Vec::new(),
            affected_rows: affected,
            duration_ms: started.elapsed().as_millis(),
            row_count: 0,
            total_rows: None,
            truncated: false,
            message: format!("执行完成，影响 {} 行", affected),
        });
    }
    let limited = append_limit_if_missing(sql, limit);
    let rows = client.query(&limited, &[]).map_err(|e| e.to_string())?;
    let columns = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut result_rows = Vec::new();
    let mut null_cells = Vec::new();
    for row in &rows {
        let mut values = Vec::new();
        let mut nulls = Vec::new();
        for (index, column) in row.columns().iter().enumerate() {
            let cell = postgres_cell_to_display(row, index, column.type_());
            values.push(cell.value);
            nulls.push(cell.is_null);
        }
        result_rows.push(values);
        null_cells.push(nulls);
    }
    let truncated = result_rows.len() >= limit.clamp(1, 1000) as usize;
    Ok(DatabaseQueryResult {
        columns,
        row_count: result_rows.len(),
        rows: result_rows,
        null_cells,
        affected_rows: 0,
        duration_ms: started.elapsed().as_millis(),
        total_rows: None,
        truncated,
        message: "查询完成".to_string(),
    })
}

fn postgres_preview_table(
    request: &DatabaseConnectionRequest,
    target: &DatabaseObjectRef,
    query: &DatabaseQueryRequest,
) -> Result<DatabaseQueryResult, String> {
    validate_preview_target(target)?;
    let started = Instant::now();
    let mut client = postgres_connect(request)?;
    let table = quote_postgres_table(&target.schema, &target.name);
    let filters = active_filters(&query.filters)?;
    let mut filter_params = Vec::new();
    let where_sql = postgres_filter_clause(&filters, &mut filter_params);
    let filter_param_refs = filter_params
        .iter()
        .map(|value| value as &(dyn postgres::types::ToSql + Sync))
        .collect::<Vec<_>>();
    let total_rows = client
        .query_opt(
            &format!("select count(*) from {table}{where_sql}"),
            &filter_param_refs,
        )
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<usize, i64>(0).ok())
        .map(|value| value.max(0) as u64);
    let order_sql = postgres_order_clause(&query.sort)?;
    let limit = query.limit.clamp(1, 1000);
    let offset = query.offset.min(1_000_000);
    let sql = format!("select * from {table}{where_sql}{order_sql} limit {limit} offset {offset}");
    let rows = client
        .query(&sql, &filter_param_refs)
        .map_err(|e| e.to_string())?;
    Ok(postgres_rows_to_result(
        rows,
        started,
        total_rows,
        "查询完成",
    ))
}

fn postgres_update_cell(
    request: &DatabaseUpdateCellRequest,
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let mut client = postgres_connect(&request.connection)?;
    let table = quote_postgres_table(&request.target.schema, &request.target.name);
    let column = quote_postgres_ident(&request.column);
    let column_type = postgres_column_type(
        &mut client,
        &request.target.schema,
        &request.target.name,
        &request.column,
    )?;
    let mut params = Vec::new();
    let mut next_param = 1usize;
    let value_sql = if request.is_null {
        format!("NULL::{column_type}")
    } else {
        params.push(&request.value as &(dyn postgres::types::ToSql + Sync));
        next_param += 1;
        format!("cast($1 as {column_type})")
    };
    let where_sql = postgres_key_where_clause(
        &mut client,
        &request.target.schema,
        &request.target.name,
        &request.key,
        next_param,
        &mut params,
    )?;
    let sql = format!("update {table} set {column} = {value_sql} where {where_sql}");
    let affected = client.execute(&sql, &params).map_err(|e| e.to_string())?;
    if affected > 1 {
        return Err(format!(
            "更新影响 {} 行，已拒绝视为安全单行编辑。请检查主键是否唯一。",
            affected
        ));
    }
    Ok(DatabaseQueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        null_cells: Vec::new(),
        affected_rows: affected,
        duration_ms: started.elapsed().as_millis(),
        row_count: 0,
        total_rows: None,
        truncated: false,
        message: format!("单元格更新完成，影响 {} 行", affected),
    })
}

fn postgres_insert_row(
    connection: &DatabaseConnectionRequest,
    target: &DatabaseObjectRef,
    values: &[DatabaseCellValue],
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let mut client = postgres_connect(connection)?;
    let table = quote_postgres_table(&target.schema, &target.name);
    let columns = values
        .iter()
        .map(|cell| quote_postgres_ident(&cell.column))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = (1..=values.len())
        .zip(values.iter())
        .scan(1usize, |param_index, (_, cell)| {
            let column_type =
                postgres_column_type(&mut client, &target.schema, &target.name, &cell.column);
            Some(column_type.map(|column_type| {
                if cell.is_null {
                    format!("NULL::{column_type}")
                } else {
                    let placeholder = format!("cast(${} as {column_type})", *param_index);
                    *param_index += 1;
                    placeholder
                }
            }))
        })
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    let params = values
        .iter()
        .filter(|cell| !cell.is_null)
        .map(|cell| &cell.value as &(dyn postgres::types::ToSql + Sync))
        .collect::<Vec<_>>();
    let affected = client
        .execute(
            &format!("insert into {table} ({columns}) values ({placeholders})"),
            &params,
        )
        .map_err(|e| e.to_string())?;
    Ok(mutation_result(started, affected, "新增行完成"))
}

fn postgres_delete_row(
    connection: &DatabaseConnectionRequest,
    target: &DatabaseObjectRef,
    key: &[DatabaseCellValue],
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let mut client = postgres_connect(connection)?;
    let table = quote_postgres_table(&target.schema, &target.name);
    let mut params = Vec::new();
    let where_sql = postgres_key_where_clause(
        &mut client,
        &target.schema,
        &target.name,
        key,
        1,
        &mut params,
    )?;
    let affected = client
        .execute(&format!("delete from {table} where {where_sql}"), &params)
        .map_err(|e| e.to_string())?;
    ensure_single_row_affected(affected)?;
    Ok(mutation_result(started, affected, "删除行完成"))
}

fn postgres_column_type(
    client: &mut PostgresClient,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<String, String> {
    client
        .query_opt(
            "select pg_catalog.format_type(a.atttypid, a.atttypmod) from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where c.relname = $2 and a.attname = $3 and a.attnum > 0 and not a.attisdropped and ($1 = '' or n.nspname = $1) order by case when n.nspname = current_schema() then 0 else 1 end limit 1",
            &[&schema, &table, &column],
        )
        .map_err(|e| e.to_string())?
        .and_then(|row| row.try_get::<usize, String>(0).ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("未找到 PostgreSQL 列类型: {table}.{column}"))
}

fn mysql_connect(request: &DatabaseConnectionRequest) -> Result<mysql::PooledConn, String> {
    let opts = if !request.url.trim().is_empty() {
        mysql::Opts::from_url(request.url.trim()).map_err(|e| e.to_string())?
    } else {
        let mut builder = mysql::OptsBuilder::new();
        builder = builder.ip_or_hostname(Some(non_empty(&request.host, "127.0.0.1").to_string()));
        builder = builder.tcp_port(request.port.unwrap_or(3306));
        if !request.username.trim().is_empty() {
            builder = builder.user(Some(request.username.trim().to_string()));
        }
        if !request.password.is_empty() {
            builder = builder.pass(Some(request.password.clone()));
        }
        if !request.database.trim().is_empty() {
            builder = builder.db_name(Some(request.database.trim().to_string()));
        }
        mysql::Opts::from(builder)
    };
    let pool = mysql::Pool::new(opts).map_err(|e| format!("连接 MySQL 失败: {}", e))?;
    pool.get_conn()
        .map_err(|e| format!("连接 MySQL 失败: {}", e))
}

fn mysql_schema(request: &DatabaseConnectionRequest) -> Result<DatabaseSchemaResult, String> {
    let mut conn = mysql_connect(request)?;
    let version = conn
        .query_first::<String, _>("select version()")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let database = if request.database.trim().is_empty() {
        conn.query_first::<String, _>("select database()")
            .map_err(|e| e.to_string())?
            .unwrap_or_default()
    } else {
        request.database.trim().to_string()
    };
    if database.is_empty() {
        return Err("请指定 MySQL 数据库名称".to_string());
    }
    let object_rows: Vec<(String, String)> = conn
        .exec(
            "select table_name, table_type from information_schema.tables where table_schema = ? order by table_name",
            (database.clone(),),
        )
        .map_err(|e| e.to_string())?;
    let column_rows: Vec<(String, String, String, String, Option<String>)> = conn
        .exec(
            "select table_name, column_name, column_type, is_nullable, column_default from information_schema.columns where table_schema = ? order by table_name, ordinal_position",
            (database.clone(),),
        )
        .map_err(|e| e.to_string())?;
    let pk_rows: Vec<(String, String)> = conn
        .exec(
            "select table_name, column_name from information_schema.key_column_usage where table_schema = ? and constraint_name = 'PRIMARY'",
            (database.clone(),),
        )
        .map_err(|e| e.to_string())?;
    let fk_rows: Vec<(String, String, String, String, String)> = conn
        .exec(
            "select table_name, column_name, referenced_table_schema, referenced_table_name, referenced_column_name from information_schema.key_column_usage where table_schema = ? and referenced_table_name is not null",
            (database.clone(),),
        )
        .map_err(|e| e.to_string())?;
    let mut objects = Vec::new();
    for (name, table_type) in object_rows {
        let object_type = if table_type.to_lowercase().contains("view") {
            "view"
        } else {
            "table"
        };
        let columns = column_rows
            .iter()
            .filter(|row| row.0 == name)
            .map(|row| DatabaseColumnInfo {
                name: row.1.clone(),
                data_type: row.2.clone(),
                nullable: row.3.eq_ignore_ascii_case("yes"),
                default_value: row.4.clone().unwrap_or_default(),
                primary_key: pk_rows
                    .iter()
                    .any(|(table_name, column_name)| table_name == &name && column_name == &row.1),
                foreign_key: fk_rows
                    .iter()
                    .find(|(table_name, column_name, _, _, _)| {
                        table_name == &name && column_name == &row.1
                    })
                    .map(
                        |(_, _, ref_schema, ref_table, ref_column)| DatabaseForeignKeyInfo {
                            schema: ref_schema.clone(),
                            table: ref_table.clone(),
                            column: ref_column.clone(),
                        },
                    ),
            })
            .collect();
        objects.push(DatabaseSchemaObject {
            id: format!("mysql|{}|{}", object_type, name),
            name,
            schema: database.clone(),
            object_type: object_type.to_string(),
            row_count: None,
            columns,
        });
    }
    Ok(schema_from_objects(
        vec![summary_item("类型", "MySQL"), summary_item("版本", version)],
        objects,
    ))
}

fn mysql_execute(
    request: &DatabaseConnectionRequest,
    sql: &str,
    limit: u32,
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let mut conn = mysql_connect(request)?;
    let sql = trimmed_sql(sql);
    if sql.is_empty() {
        return Err("请输入 SQL".to_string());
    }
    let limited = if looks_like_reader(sql) {
        append_limit_if_missing(sql, limit)
    } else {
        sql.to_string()
    };
    let mut result = conn.query_iter(limited).map_err(|e| e.to_string())?;
    let columns = result
        .columns()
        .as_ref()
        .iter()
        .map(|column| column.name_str().into_owned())
        .collect::<Vec<_>>();
    let max_rows = limit.clamp(1, 1000) as usize;
    let mut rows = Vec::new();
    let mut null_cells = Vec::new();
    for row_result in result.by_ref() {
        if rows.len() >= max_rows {
            break;
        }
        let row = row_result.map_err(|e| e.to_string())?;
        let mut values = Vec::new();
        let mut nulls = Vec::new();
        for value in row.unwrap() {
            let cell = mysql_value_to_display(value);
            values.push(cell.value);
            nulls.push(cell.is_null);
        }
        rows.push(values);
        null_cells.push(nulls);
    }
    drop(result);
    let affected = conn.affected_rows();
    let truncated = rows.len() >= max_rows;
    Ok(DatabaseQueryResult {
        columns,
        row_count: rows.len(),
        rows,
        null_cells,
        affected_rows: affected,
        duration_ms: started.elapsed().as_millis(),
        total_rows: None,
        truncated,
        message: if affected > 0 {
            format!("执行完成，影响 {} 行", affected)
        } else {
            "查询完成".to_string()
        },
    })
}

fn mysql_preview_table(
    request: &DatabaseConnectionRequest,
    target: &DatabaseObjectRef,
    query: &DatabaseQueryRequest,
) -> Result<DatabaseQueryResult, String> {
    validate_preview_target(target)?;
    let started = Instant::now();
    let mut conn = mysql_connect(request)?;
    let table = quote_mysql_ident(&target.name);
    let filters = active_filters(&query.filters)?;
    let (where_sql, params) = mysql_filter_clause(&filters);
    let total_rows = conn
        .exec_first::<u64, _, _>(
            format!("select count(*) from {table}{where_sql}"),
            mysql::Params::Positional(params.clone()),
        )
        .ok()
        .flatten();
    let order_sql = mysql_order_clause(&query.sort)?;
    let limit = query.limit.clamp(1, 1000);
    let offset = query.offset.min(1_000_000);
    let sql = format!("select * from {table}{where_sql}{order_sql} limit {limit} offset {offset}");
    let mut result = conn
        .exec_iter(sql, mysql::Params::Positional(params))
        .map_err(|e| e.to_string())?;
    let columns = result
        .columns()
        .as_ref()
        .iter()
        .map(|column| column.name_str().into_owned())
        .collect::<Vec<_>>();
    let mut rows = Vec::new();
    let mut null_cells = Vec::new();
    for row_result in result.by_ref() {
        let row = row_result.map_err(|e| e.to_string())?;
        let mut values = Vec::new();
        let mut nulls = Vec::new();
        for value in row.unwrap() {
            let cell = mysql_value_to_display(value);
            values.push(cell.value);
            nulls.push(cell.is_null);
        }
        rows.push(values);
        null_cells.push(nulls);
    }
    Ok(DatabaseQueryResult {
        columns,
        row_count: rows.len(),
        rows,
        null_cells,
        affected_rows: 0,
        duration_ms: started.elapsed().as_millis(),
        total_rows,
        truncated: false,
        message: "查询完成".to_string(),
    })
}

fn mysql_update_cell(request: &DatabaseUpdateCellRequest) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let mut conn = mysql_connect(&request.connection)?;
    let table = quote_mysql_ident(&request.target.name);
    let column = quote_mysql_ident(&request.column);
    let (where_sql, mut params) = mysql_key_where_clause(&request.key);
    params.insert(
        0,
        database_cell_to_mysql_value(&DatabaseCellValue {
            column: request.column.clone(),
            value: request.value.clone(),
            is_null: request.is_null,
        }),
    );
    let sql = format!("update {table} set {column} = ? where {where_sql}");
    conn.exec_drop(sql, mysql::Params::Positional(params))
        .map_err(|e| e.to_string())?;
    let affected = conn.affected_rows();
    if affected > 1 {
        return Err(format!(
            "更新影响 {} 行，已拒绝视为安全单行编辑。请检查主键是否唯一。",
            affected
        ));
    }
    Ok(DatabaseQueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        null_cells: Vec::new(),
        affected_rows: affected,
        duration_ms: started.elapsed().as_millis(),
        row_count: 0,
        total_rows: None,
        truncated: false,
        message: format!("单元格更新完成，影响 {} 行", affected),
    })
}

fn mysql_insert_row(
    connection: &DatabaseConnectionRequest,
    target: &DatabaseObjectRef,
    values: &[DatabaseCellValue],
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let mut conn = mysql_connect(connection)?;
    let table = quote_mysql_ident(&target.name);
    let columns = values
        .iter()
        .map(|cell| quote_mysql_ident(&cell.column))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = std::iter::repeat("?")
        .take(values.len())
        .collect::<Vec<_>>()
        .join(", ");
    let params = values
        .iter()
        .map(database_cell_to_mysql_value)
        .collect::<Vec<_>>();
    conn.exec_drop(
        format!("insert into {table} ({columns}) values ({placeholders})"),
        mysql::Params::Positional(params),
    )
    .map_err(|e| e.to_string())?;
    Ok(mutation_result(started, conn.affected_rows(), "新增行完成"))
}

fn mysql_delete_row(
    connection: &DatabaseConnectionRequest,
    target: &DatabaseObjectRef,
    key: &[DatabaseCellValue],
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let mut conn = mysql_connect(connection)?;
    let table = quote_mysql_ident(&target.name);
    let (where_sql, params) = mysql_key_where_clause(key);
    conn.exec_drop(
        format!("delete from {table} where {where_sql}"),
        mysql::Params::Positional(params),
    )
    .map_err(|e| e.to_string())?;
    let affected = conn.affected_rows();
    ensure_single_row_affected(affected)?;
    Ok(mutation_result(started, affected, "删除行完成"))
}

fn redis_connect(request: &DatabaseConnectionRequest) -> Result<redis::Connection, String> {
    let url = if !request.url.trim().is_empty() {
        request.url.trim().to_string()
    } else {
        let host = non_empty(&request.host, "127.0.0.1");
        let port = request.port.unwrap_or(6379);
        let db = request.database.trim().parse::<u32>().unwrap_or(0);
        let auth = if request.password.is_empty() {
            String::new()
        } else if request.username.trim().is_empty() {
            format!(":{}@", urlencoding::encode(&request.password))
        } else {
            format!(
                "{}:{}@",
                urlencoding::encode(request.username.trim()),
                urlencoding::encode(&request.password)
            )
        };
        format!("redis://{}{}:{}/{}", auth, host, port, db)
    };
    let client = redis::Client::open(url).map_err(|e| format!("连接 Redis 失败: {}", e))?;
    client
        .get_connection()
        .map_err(|e| format!("连接 Redis 失败: {}", e))
}

fn redis_schema(request: &DatabaseConnectionRequest) -> Result<DatabaseSchemaResult, String> {
    let mut conn = redis_connect(request)?;
    let db_size: i64 = redis::cmd("DBSIZE")
        .query(&mut conn)
        .map_err(|e| e.to_string())?;
    let keys = redis_scan_keys(&mut conn, 250)?;
    let mut objects = Vec::new();
    for key in keys {
        let key_type: String = redis::cmd("TYPE")
            .arg(&key)
            .query(&mut conn)
            .unwrap_or_else(|_| "unknown".to_string());
        let ttl: i64 = redis::cmd("TTL").arg(&key).query(&mut conn).unwrap_or(-1);
        objects.push(DatabaseSchemaObject {
            id: format!("redis|{}|{}", key_type, key),
            name: key,
            schema: request.database.clone(),
            object_type: key_type,
            row_count: if ttl >= 0 { Some(ttl as u64) } else { None },
            columns: Vec::new(),
        });
    }
    Ok(DatabaseSchemaResult {
        summary: vec![
            summary_item("类型", "Redis"),
            summary_item("数据库", non_empty(&request.database, "0")),
            summary_item("Key 数", db_size.to_string()),
        ],
        groups: vec![schema_group("redis-keys", "Key", "key", objects)],
        message: "结构读取完成".to_string(),
    })
}

fn redis_execute(
    request: &DatabaseConnectionRequest,
    query: &str,
    limit: u32,
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let mut conn = redis_connect(request)?;
    let parts = split_command(query)?;
    if parts.is_empty() {
        return Err("请输入 Redis 命令".to_string());
    }
    let mut command = redis::cmd(&parts[0]);
    for arg in parts.iter().skip(1) {
        command.arg(arg);
    }
    let value: redis::Value = command.query(&mut conn).map_err(|e| e.to_string())?;
    let (columns, rows, null_cells) = redis_value_to_table(value, limit);
    Ok(DatabaseQueryResult {
        row_count: rows.len(),
        columns,
        rows,
        null_cells,
        affected_rows: 0,
        duration_ms: started.elapsed().as_millis(),
        total_rows: None,
        truncated: false,
        message: "命令执行完成".to_string(),
    })
}

fn redis_preview_key(
    request: &DatabaseConnectionRequest,
    key: &str,
    key_type: &str,
    limit: u32,
) -> Result<DatabaseQueryResult, String> {
    let query = match key_type {
        "list" => format!("LRANGE {} 0 {}", key, limit.saturating_sub(1)),
        "set" => format!("SMEMBERS {}", key),
        "zset" => format!("ZRANGE {} 0 {} WITHSCORES", key, limit.saturating_sub(1)),
        "hash" => format!("HGETALL {}", key),
        "stream" => format!("XRANGE {} - + COUNT {}", key, limit.clamp(1, 1000)),
        _ => format!("GET {}", key),
    };
    redis_execute(request, &query, limit)
}

fn mongo_connect(request: &DatabaseConnectionRequest) -> Result<mongodb::sync::Client, String> {
    let uri = if !request.url.trim().is_empty() {
        request.url.trim().to_string()
    } else {
        let host = non_empty(&request.host, "127.0.0.1");
        let port = request.port.unwrap_or(27017);
        let auth = if request.username.trim().is_empty() {
            String::new()
        } else {
            format!(
                "{}:{}@",
                urlencoding::encode(request.username.trim()),
                urlencoding::encode(&request.password)
            )
        };
        format!("mongodb://{}{}:{}", auth, host, port)
    };
    mongodb::sync::Client::with_uri_str(uri).map_err(|e| format!("连接 MongoDB 失败: {}", e))
}

fn mongo_schema(request: &DatabaseConnectionRequest) -> Result<DatabaseSchemaResult, String> {
    let client = mongo_connect(request)?;
    if request.database.trim().is_empty() {
        let names = client
            .list_database_names()
            .run()
            .map_err(|e| e.to_string())?;
        let objects = names
            .into_iter()
            .map(|name| DatabaseSchemaObject {
                id: format!("mongodb|database|{}", name),
                name,
                schema: String::new(),
                object_type: "database".to_string(),
                row_count: None,
                columns: Vec::new(),
            })
            .collect::<Vec<_>>();
        return Ok(DatabaseSchemaResult {
            summary: vec![
                summary_item("类型", "MongoDB"),
                summary_item("数据库", objects.len().to_string()),
            ],
            groups: vec![schema_group(
                "mongo-databases",
                "数据库",
                "database",
                objects,
            )],
            message: "结构读取完成".to_string(),
        });
    }

    let database = client.database(request.database.trim());
    let names = database
        .list_collection_names()
        .run()
        .map_err(|e| e.to_string())?;
    let mut objects = Vec::new();
    for name in names {
        let collection = database.collection::<mongodb::bson::Document>(&name);
        let count = collection.estimated_document_count().run().ok();
        objects.push(DatabaseSchemaObject {
            id: format!("mongodb|collection|{}|{}", request.database, name),
            name,
            schema: request.database.clone(),
            object_type: "collection".to_string(),
            row_count: count,
            columns: Vec::new(),
        });
    }
    Ok(DatabaseSchemaResult {
        summary: vec![
            summary_item("类型", "MongoDB"),
            summary_item("数据库", request.database.clone()),
            summary_item("集合", objects.len().to_string()),
        ],
        groups: vec![schema_group(
            "mongo-collections",
            "集合",
            "collection",
            objects,
        )],
        message: "结构读取完成".to_string(),
    })
}

fn mongo_execute(
    request: &DatabaseConnectionRequest,
    query: &str,
    limit: u32,
    target: Option<DatabaseObjectRef>,
) -> Result<DatabaseQueryResult, String> {
    let started = Instant::now();
    let collection_name = target
        .as_ref()
        .map(|target| target.name.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请选择 MongoDB 集合后再查询".to_string())?;
    let database_name = if !request.database.trim().is_empty() {
        request.database.trim().to_string()
    } else {
        target
            .as_ref()
            .map(|target| target.schema.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "请指定 MongoDB 数据库".to_string())?
    };
    let client = mongo_connect(request)?;
    let database = client.database(&database_name);
    let collection = database.collection::<mongodb::bson::Document>(&collection_name);
    let filter = mongo_filter_from_query(query)?;
    let cursor = collection
        .find(filter)
        .limit(limit.clamp(1, 1000) as i64)
        .run()
        .map_err(|e| e.to_string())?;
    let mut documents = Vec::new();
    for doc in cursor {
        documents.push(doc.map_err(|e| e.to_string())?);
    }
    let (columns, rows, null_cells) = documents_to_table(&documents);
    let row_count = rows.len();
    let truncated = row_count >= limit.clamp(1, 1000) as usize;
    Ok(DatabaseQueryResult {
        row_count,
        columns,
        rows,
        null_cells,
        affected_rows: 0,
        duration_ms: started.elapsed().as_millis(),
        total_rows: None,
        truncated,
        message: "查询完成".to_string(),
    })
}

fn redis_scan_keys(conn: &mut redis::Connection, limit: usize) -> Result<Vec<String>, String> {
    let mut cursor = 0u64;
    let mut keys = Vec::new();
    loop {
        let (next, batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .cursor_arg(cursor)
            .arg("COUNT")
            .arg(100)
            .query(conn)
            .map_err(|e| e.to_string())?;
        keys.extend(batch);
        cursor = next;
        if cursor == 0 || keys.len() >= limit {
            break;
        }
    }
    keys.truncate(limit);
    Ok(keys)
}

fn documents_to_table(
    documents: &[mongodb::bson::Document],
) -> (Vec<String>, Vec<Vec<String>>, Vec<Vec<bool>>) {
    let mut column_set = BTreeSet::new();
    for doc in documents {
        for key in doc.keys() {
            column_set.insert(key.clone());
        }
    }
    let columns = column_set.into_iter().collect::<Vec<_>>();
    let mut rows = Vec::new();
    let mut null_cells = Vec::new();
    for doc in documents {
        let mut values = Vec::new();
        let mut nulls = Vec::new();
        for column in &columns {
            let cell = bson_value_to_display(doc.get(column));
            values.push(cell.value);
            nulls.push(cell.is_null);
        }
        rows.push(values);
        null_cells.push(nulls);
    }
    (columns, rows, null_cells)
}

fn mongo_filter_from_query(query: &str) -> Result<mongodb::bson::Document, String> {
    let text = query.trim();
    if text.is_empty() || text == "{}" {
        return Ok(mongodb::bson::Document::new());
    }
    let json: JsonValue =
        serde_json::from_str(text).map_err(|e| format!("Mongo 查询 JSON 无效: {}", e))?;
    let bson = mongodb::bson::to_bson(&json).map_err(|e| e.to_string())?;
    match bson {
        mongodb::bson::Bson::Document(doc) => Ok(doc),
        _ => Err("Mongo 查询必须是 JSON 对象".to_string()),
    }
}

fn schema_from_objects(
    mut summary: Vec<DatabaseSummaryItem>,
    objects: Vec<DatabaseSchemaObject>,
) -> DatabaseSchemaResult {
    let mut tables = Vec::new();
    let mut views = Vec::new();
    for object in objects {
        if object.object_type == "view" {
            views.push(object);
        } else {
            tables.push(object);
        }
    }
    summary.push(summary_item("表", tables.len().to_string()));
    summary.push(summary_item("视图", views.len().to_string()));
    DatabaseSchemaResult {
        summary,
        groups: vec![
            schema_group("tables", "表", "table", tables),
            schema_group("views", "视图", "view", views),
        ],
        message: "结构读取完成".to_string(),
    }
}

fn schema_group(
    id: &str,
    name: &str,
    group_type: &str,
    objects: Vec<DatabaseSchemaObject>,
) -> DatabaseSchemaGroup {
    DatabaseSchemaGroup {
        id: id.to_string(),
        name: name.to_string(),
        group_type: group_type.to_string(),
        objects,
    }
}

fn validate_preview_target(target: &DatabaseObjectRef) -> Result<(), String> {
    if !matches!(target.object_type.as_str(), "table" | "view") {
        return Err("仅 SQL 表或视图支持分页筛选预览".to_string());
    }
    validate_identifier(&target.name)?;
    if !target.schema.trim().is_empty() {
        validate_identifier(&target.schema)?;
    }
    Ok(())
}

fn validate_table_target(target: &DatabaseObjectRef) -> Result<(), String> {
    if target.object_type != "table" {
        return Err("只允许操作普通表".to_string());
    }
    validate_identifier(&target.name)?;
    if !target.schema.trim().is_empty() {
        validate_identifier(&target.schema)?;
    }
    Ok(())
}

fn validate_row_key(key: &[DatabaseCellValue]) -> Result<(), String> {
    if key.is_empty() {
        return Err("缺少主键定位信息".to_string());
    }
    for cell in key {
        validate_identifier(&cell.column)?;
        if cell.is_null {
            return Err("主键定位值不能是 NULL".to_string());
        }
    }
    Ok(())
}

fn active_filters(filters: &[DatabaseFilterRequest]) -> Result<Vec<DatabaseFilterRequest>, String> {
    let mut active = Vec::new();
    for filter in filters {
        let operator = normalized_filter_operator(&filter.operator);
        if filter.column.trim().is_empty() {
            continue;
        }
        validate_identifier(&filter.column)?;
        if !matches!(operator.as_str(), "is_null" | "not_null") && filter.value.trim().is_empty() {
            continue;
        }
        active.push(DatabaseFilterRequest {
            column: filter.column.trim().to_string(),
            value: filter.value.clone(),
            operator,
        });
    }
    Ok(active)
}

fn normalized_filter_operator(operator: &str) -> String {
    match operator.trim().to_lowercase().as_str() {
        "equals" | "eq" | "=" => "equals".to_string(),
        "starts_with" | "startswith" | "startsWith" => "starts_with".to_string(),
        "ends_with" | "endswith" | "endsWith" => "ends_with".to_string(),
        "is_null" | "isnull" | "isNull" => "is_null".to_string(),
        "not_null" | "notnull" | "notNull" => "not_null".to_string(),
        _ => "contains".to_string(),
    }
}

fn sort_direction(sort: &Option<DatabaseSortRequest>) -> Result<Option<(&str, bool)>, String> {
    let Some(sort) = sort else {
        return Ok(None);
    };
    let column = sort.column.trim();
    if column.is_empty() {
        return Ok(None);
    }
    validate_identifier(column)?;
    let descending = matches!(
        sort.direction.trim().to_lowercase().as_str(),
        "desc" | "descending"
    );
    Ok(Some((column, descending)))
}

fn filter_pattern(operator: &str, value: &str) -> String {
    match operator {
        "equals" => value.to_string(),
        "starts_with" => format!("{}%", value),
        "ends_with" => format!("%{}", value),
        _ => format!("%{}%", value),
    }
}

fn sqlite_filter_clause(filters: &[DatabaseFilterRequest]) -> Result<(String, Vec<Value>), String> {
    let filters = active_filters(filters)?;
    if filters.is_empty() {
        return Ok((String::new(), Vec::new()));
    }
    let mut clauses = Vec::new();
    let mut params = Vec::new();
    for filter in filters {
        let column = quote_sqlite_table(&filter.column);
        match filter.operator.as_str() {
            "is_null" => clauses.push(format!("{column} is null")),
            "not_null" => clauses.push(format!("{column} is not null")),
            "equals" => {
                clauses.push(format!("cast({column} as text) = ?"));
                params.push(Value::Text(filter.value));
            }
            operator => {
                clauses.push(format!("cast({column} as text) like ?"));
                params.push(Value::Text(filter_pattern(operator, &filter.value)));
            }
        }
    }
    Ok((format!(" where {}", clauses.join(" and ")), params))
}

fn sqlite_order_clause(sort: &Option<DatabaseSortRequest>) -> Result<String, String> {
    Ok(sort_direction(sort)?
        .map(|(column, descending)| {
            format!(
                " order by {} {}",
                quote_sqlite_table(column),
                if descending { "desc" } else { "asc" }
            )
        })
        .unwrap_or_default())
}

fn sqlite_key_where_clause(key: &[DatabaseCellValue], start_index: usize) -> (String, Vec<Value>) {
    let mut params = Vec::new();
    let clauses = key
        .iter()
        .enumerate()
        .map(|(index, cell)| {
            params.push(database_cell_to_sqlite_value(cell));
            format!(
                "{} = ?{}",
                quote_sqlite_table(&cell.column),
                start_index + index
            )
        })
        .collect::<Vec<_>>();
    (clauses.join(" and "), params)
}

fn postgres_filter_clause(filters: &[DatabaseFilterRequest], params: &mut Vec<String>) -> String {
    if filters.is_empty() {
        return String::new();
    }
    let mut clauses = Vec::new();
    for filter in filters {
        let column = quote_postgres_ident(&filter.column);
        match filter.operator.as_str() {
            "is_null" => clauses.push(format!("{column} is null")),
            "not_null" => clauses.push(format!("{column} is not null")),
            "equals" => {
                params.push(filter.value.clone());
                clauses.push(format!("{column}::text = ${}", params.len()));
            }
            operator => {
                params.push(filter_pattern(operator, &filter.value));
                clauses.push(format!("{column}::text ilike ${}", params.len()));
            }
        }
    }
    format!(" where {}", clauses.join(" and "))
}

fn postgres_order_clause(sort: &Option<DatabaseSortRequest>) -> Result<String, String> {
    Ok(sort_direction(sort)?
        .map(|(column, descending)| {
            format!(
                " order by {} {}",
                quote_postgres_ident(column),
                if descending { "desc" } else { "asc" }
            )
        })
        .unwrap_or_default())
}

fn postgres_key_where_clause<'a>(
    client: &mut PostgresClient,
    schema: &str,
    table: &str,
    key: &'a [DatabaseCellValue],
    start_index: usize,
    params: &mut Vec<&'a (dyn postgres::types::ToSql + Sync)>,
) -> Result<String, String> {
    let mut clauses = Vec::new();
    for (index, cell) in key.iter().enumerate() {
        let column_type = postgres_column_type(client, schema, table, &cell.column)?;
        params.push(&cell.value as &(dyn postgres::types::ToSql + Sync));
        clauses.push(format!(
            "{} = cast(${} as {})",
            quote_postgres_ident(&cell.column),
            start_index + index,
            column_type
        ));
    }
    Ok(clauses.join(" and "))
}

fn mysql_filter_clause(filters: &[DatabaseFilterRequest]) -> (String, Vec<mysql::Value>) {
    if filters.is_empty() {
        return (String::new(), Vec::new());
    }
    let mut clauses = Vec::new();
    let mut params = Vec::new();
    for filter in filters {
        let column = quote_mysql_ident(&filter.column);
        match filter.operator.as_str() {
            "is_null" => clauses.push(format!("{column} is null")),
            "not_null" => clauses.push(format!("{column} is not null")),
            "equals" => {
                clauses.push(format!("cast({column} as char) = ?"));
                params.push(mysql::Value::from(filter.value.clone()));
            }
            operator => {
                clauses.push(format!("cast({column} as char) like ?"));
                params.push(mysql::Value::from(filter_pattern(operator, &filter.value)));
            }
        }
    }
    (format!(" where {}", clauses.join(" and ")), params)
}

fn mysql_order_clause(sort: &Option<DatabaseSortRequest>) -> Result<String, String> {
    Ok(sort_direction(sort)?
        .map(|(column, descending)| {
            format!(
                " order by {} {}",
                quote_mysql_ident(column),
                if descending { "desc" } else { "asc" }
            )
        })
        .unwrap_or_default())
}

fn mysql_key_where_clause(key: &[DatabaseCellValue]) -> (String, Vec<mysql::Value>) {
    let mut params = Vec::new();
    let clauses = key
        .iter()
        .map(|cell| {
            params.push(database_cell_to_mysql_value(cell));
            format!("cast({} as char) = ?", quote_mysql_ident(&cell.column))
        })
        .collect::<Vec<_>>();
    (clauses.join(" and "), params)
}

fn database_cell_to_sqlite_value(cell: &DatabaseCellValue) -> Value {
    if cell.is_null {
        Value::Null
    } else {
        Value::Text(cell.value.clone())
    }
}

fn database_cell_to_mysql_value(cell: &DatabaseCellValue) -> mysql::Value {
    if cell.is_null {
        mysql::Value::NULL
    } else {
        mysql::Value::from(cell.value.clone())
    }
}

fn ensure_single_row_affected(affected: u64) -> Result<(), String> {
    if affected > 1 {
        Err(format!(
            "操作影响 {} 行，已拒绝视为安全单行操作。请检查主键是否唯一。",
            affected
        ))
    } else {
        Ok(())
    }
}

fn mutation_result(started: Instant, affected: u64, label: &str) -> DatabaseQueryResult {
    DatabaseQueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        null_cells: Vec::new(),
        affected_rows: affected,
        duration_ms: started.elapsed().as_millis(),
        row_count: 0,
        total_rows: None,
        truncated: false,
        message: format!("{}，影响 {} 行", label, affected),
    }
}

fn summary_item(label: impl Into<String>, value: impl Into<String>) -> DatabaseSummaryItem {
    DatabaseSummaryItem {
        label: label.into(),
        value: value.into(),
    }
}

struct DatabaseCellDisplay {
    value: String,
    is_null: bool,
}

fn postgres_rows_to_result(
    rows: Vec<PostgresRow>,
    started: Instant,
    total_rows: Option<u64>,
    message: &str,
) -> DatabaseQueryResult {
    let columns = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut result_rows = Vec::new();
    let mut null_cells = Vec::new();
    for row in &rows {
        let mut values = Vec::new();
        let mut nulls = Vec::new();
        for (index, column) in row.columns().iter().enumerate() {
            let cell = postgres_cell_to_display(row, index, column.type_());
            values.push(cell.value);
            nulls.push(cell.is_null);
        }
        result_rows.push(values);
        null_cells.push(nulls);
    }
    DatabaseQueryResult {
        columns,
        row_count: result_rows.len(),
        rows: result_rows,
        null_cells,
        affected_rows: 0,
        duration_ms: started.elapsed().as_millis(),
        total_rows,
        truncated: false,
        message: message.to_string(),
    }
}

fn postgres_cell_to_display(
    row: &PostgresRow,
    index: usize,
    data_type: &Type,
) -> DatabaseCellDisplay {
    if *data_type == Type::BOOL {
        return optional_display(
            row.try_get::<usize, Option<bool>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        );
    }
    if *data_type == Type::INT2 {
        return optional_display(
            row.try_get::<usize, Option<i16>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        );
    }
    if *data_type == Type::INT4 {
        return optional_display(
            row.try_get::<usize, Option<i32>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        );
    }
    if *data_type == Type::INT8 {
        return optional_display(
            row.try_get::<usize, Option<i64>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        );
    }
    if *data_type == Type::FLOAT4 {
        return optional_display(
            row.try_get::<usize, Option<f32>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        );
    }
    if *data_type == Type::FLOAT8 {
        return optional_display(
            row.try_get::<usize, Option<f64>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        );
    }
    if *data_type == Type::JSON || *data_type == Type::JSONB {
        return optional_display(
            row.try_get::<usize, Option<JsonValue>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        );
    }
    if *data_type == Type::DATE {
        return optional_display(
            row.try_get::<usize, Option<NaiveDate>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        );
    }
    if *data_type == Type::TIMESTAMP {
        return optional_display(
            row.try_get::<usize, Option<NaiveDateTime>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_string()),
        );
    }
    if *data_type == Type::TIMESTAMPTZ {
        return optional_display(
            row.try_get::<usize, Option<DateTime<Utc>>>(index)
                .ok()
                .flatten()
                .map(|value| value.to_rfc3339()),
        );
    }
    match row.try_get::<usize, Option<String>>(index).ok() {
        Some(value) => optional_display(value),
        None => DatabaseCellDisplay {
            value: format!("<{}>", data_type.name()),
            is_null: false,
        },
    }
}

fn optional_display(value: Option<String>) -> DatabaseCellDisplay {
    match value {
        Some(value) => DatabaseCellDisplay {
            value,
            is_null: false,
        },
        None => DatabaseCellDisplay {
            value: String::new(),
            is_null: true,
        },
    }
}

fn sqlite_value_to_display(value: ValueRef<'_>) -> DatabaseCellDisplay {
    match value {
        ValueRef::Null => DatabaseCellDisplay {
            value: String::new(),
            is_null: true,
        },
        ValueRef::Integer(value) => DatabaseCellDisplay {
            value: value.to_string(),
            is_null: false,
        },
        ValueRef::Real(value) => DatabaseCellDisplay {
            value: value.to_string(),
            is_null: false,
        },
        ValueRef::Text(value) => DatabaseCellDisplay {
            value: String::from_utf8_lossy(value).to_string(),
            is_null: false,
        },
        ValueRef::Blob(value) => DatabaseCellDisplay {
            value: format!("<blob {} B>", value.len()),
            is_null: false,
        },
    }
}

fn mysql_value_to_display(value: mysql::Value) -> DatabaseCellDisplay {
    match value {
        mysql::Value::NULL => DatabaseCellDisplay {
            value: String::new(),
            is_null: true,
        },
        mysql::Value::Bytes(value) => DatabaseCellDisplay {
            value: String::from_utf8_lossy(&value).to_string(),
            is_null: false,
        },
        mysql::Value::Int(value) => DatabaseCellDisplay {
            value: value.to_string(),
            is_null: false,
        },
        mysql::Value::UInt(value) => DatabaseCellDisplay {
            value: value.to_string(),
            is_null: false,
        },
        mysql::Value::Float(value) => DatabaseCellDisplay {
            value: value.to_string(),
            is_null: false,
        },
        mysql::Value::Double(value) => DatabaseCellDisplay {
            value: value.to_string(),
            is_null: false,
        },
        mysql::Value::Date(year, month, day, hour, minute, second, micros) => DatabaseCellDisplay {
            value: format!(
                "{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{micros:06}"
            ),
            is_null: false,
        },
        mysql::Value::Time(is_negative, days, hours, minutes, seconds, micros) => {
            let sign = if is_negative { "-" } else { "" };
            DatabaseCellDisplay {
                value: format!("{sign}{days}d {hours:02}:{minutes:02}:{seconds:02}.{micros:06}"),
                is_null: false,
            }
        }
    }
}

fn redis_value_to_table(
    value: redis::Value,
    limit: u32,
) -> (Vec<String>, Vec<Vec<String>>, Vec<Vec<bool>>) {
    match value {
        redis::Value::Array(values) => {
            let max_rows = limit.clamp(1, 1000) as usize;
            let mut rows = Vec::new();
            let mut null_cells = Vec::new();
            for (index, value) in values.into_iter().take(max_rows).enumerate() {
                let cell = redis_value_to_display(value);
                rows.push(vec![index.to_string(), cell.value]);
                null_cells.push(vec![false, cell.is_null]);
            }
            (
                vec!["index".to_string(), "value".to_string()],
                rows,
                null_cells,
            )
        }
        redis::Value::Map(values) => {
            let mut rows = Vec::new();
            let mut null_cells = Vec::new();
            for (key, value) in values {
                let key_cell = redis_value_to_display(key);
                let value_cell = redis_value_to_display(value);
                rows.push(vec![key_cell.value, value_cell.value]);
                null_cells.push(vec![key_cell.is_null, value_cell.is_null]);
            }
            (
                vec!["key".to_string(), "value".to_string()],
                rows,
                null_cells,
            )
        }
        other => {
            let cell = redis_value_to_display(other);
            (
                vec!["value".to_string()],
                vec![vec![cell.value]],
                vec![vec![cell.is_null]],
            )
        }
    }
}

fn redis_value_to_string(value: redis::Value) -> String {
    redis_value_to_display(value).value
}

fn redis_value_to_display(value: redis::Value) -> DatabaseCellDisplay {
    match value {
        redis::Value::Nil => DatabaseCellDisplay {
            value: String::new(),
            is_null: true,
        },
        redis::Value::Int(value) => display_string(value.to_string()),
        redis::Value::BulkString(value) => {
            display_string(String::from_utf8_lossy(&value).to_string())
        }
        redis::Value::Array(values) => display_string(
            values
                .into_iter()
                .map(redis_value_to_string)
                .collect::<Vec<_>>()
                .join(", "),
        ),
        redis::Value::SimpleString(value) => display_string(value),
        redis::Value::Okay => display_string("OK".to_string()),
        redis::Value::Map(values) => display_string(
            values
                .into_iter()
                .map(|(key, value)| {
                    format!(
                        "{}: {}",
                        redis_value_to_string(key),
                        redis_value_to_string(value)
                    )
                })
                .collect::<Vec<_>>()
                .join(", "),
        ),
        redis::Value::Attribute { data, attributes } => display_string(format!(
            "{} ({})",
            redis_value_to_string(*data),
            attributes
                .into_iter()
                .map(|(key, value)| format!(
                    "{}: {}",
                    redis_value_to_string(key),
                    redis_value_to_string(value)
                ))
                .collect::<Vec<_>>()
                .join(", ")
        )),
        redis::Value::Set(values) => display_string(
            values
                .into_iter()
                .map(redis_value_to_string)
                .collect::<Vec<_>>()
                .join(", "),
        ),
        redis::Value::Double(value) => display_string(value.to_string()),
        redis::Value::Boolean(value) => display_string(value.to_string()),
        redis::Value::VerbatimString { format, text } => {
            display_string(format!("{}: {}", format, text))
        }
        redis::Value::BigNumber(value) => display_string(value.to_string()),
        redis::Value::Push { kind, data } => display_string(format!(
            "{:?}: {}",
            kind,
            data.into_iter()
                .map(redis_value_to_string)
                .collect::<Vec<_>>()
                .join(", ")
        )),
        redis::Value::ServerError(error) => display_string(error.to_string()),
        _ => display_string("<unsupported redis value>".to_string()),
    }
}

fn bson_value_to_string(value: Option<&mongodb::bson::Bson>) -> String {
    bson_value_to_display(value).value
}

fn bson_value_to_display(value: Option<&mongodb::bson::Bson>) -> DatabaseCellDisplay {
    match value {
        None | Some(mongodb::bson::Bson::Null) => DatabaseCellDisplay {
            value: String::new(),
            is_null: true,
        },
        Some(mongodb::bson::Bson::String(value)) => display_string(value.clone()),
        Some(mongodb::bson::Bson::Boolean(value)) => display_string(value.to_string()),
        Some(mongodb::bson::Bson::Int32(value)) => display_string(value.to_string()),
        Some(mongodb::bson::Bson::Int64(value)) => display_string(value.to_string()),
        Some(mongodb::bson::Bson::Double(value)) => display_string(value.to_string()),
        Some(mongodb::bson::Bson::ObjectId(value)) => display_string(value.to_hex()),
        Some(mongodb::bson::Bson::DateTime(value)) => display_string(value.to_string()),
        Some(other) => display_string(other.to_string()),
    }
}

fn display_string(value: String) -> DatabaseCellDisplay {
    DatabaseCellDisplay {
        value,
        is_null: false,
    }
}

fn split_command(command: &str) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in command.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            continue;
        }
        if ch.is_whitespace() {
            if !current.is_empty() {
                parts.push(current.clone());
                current.clear();
            }
        } else {
            current.push(ch);
        }
    }
    if quote.is_some() {
        return Err("命令引号未闭合".to_string());
    }
    if !current.is_empty() {
        parts.push(current);
    }
    Ok(parts)
}

fn guard_dangerous_query(kind: &str, query: &str, allow_dangerous: bool) -> Result<(), String> {
    if allow_dangerous {
        return Ok(());
    }
    if !query_is_dangerous(kind, query) {
        return Ok(());
    }
    Err("检测到高风险写入/删除/结构变更语句，已拒绝执行。请在前端风险确认后重试。".to_string())
}

fn query_is_dangerous(kind: &str, query: &str) -> bool {
    let text = query.trim().trim_matches('\u{feff}').to_lowercase();
    if text.is_empty() {
        return false;
    }
    if kind == "redis" {
        return split_command(query)
            .ok()
            .and_then(|parts| parts.first().cloned())
            .map(|command| {
                matches!(
                    command.to_uppercase().as_str(),
                    "DEL"
                        | "UNLINK"
                        | "FLUSHALL"
                        | "FLUSHDB"
                        | "SET"
                        | "MSET"
                        | "HSET"
                        | "HMSET"
                        | "SADD"
                        | "ZADD"
                        | "LPUSH"
                        | "RPUSH"
                        | "LPOP"
                        | "RPOP"
                        | "EXPIRE"
                        | "PERSIST"
                        | "RENAME"
                        | "RENAMENX"
                        | "EVAL"
                        | "EVALSHA"
                        | "CONFIG"
                        | "SHUTDOWN"
                )
            })
            .unwrap_or(false);
    }
    if kind == "mongodb" {
        return false;
    }
    let mut normalized = text.replace('\r', " ").replace('\n', " ");
    while normalized.contains("  ") {
        normalized = normalized.replace("  ", " ");
    }
    let first_word = normalized
        .split(|ch: char| ch.is_whitespace() || ch == ';')
        .find(|part| !part.is_empty())
        .unwrap_or_default();
    matches!(
        first_word,
        "insert"
            | "update"
            | "delete"
            | "replace"
            | "merge"
            | "drop"
            | "truncate"
            | "alter"
            | "create"
            | "rename"
            | "grant"
            | "revoke"
            | "vacuum"
            | "analyze"
            | "reindex"
            | "call"
            | "execute"
            | "exec"
    ) || normalized.contains("; drop ")
        || normalized.contains("; truncate ")
        || normalized.contains("; delete ")
        || normalized.contains("; update ")
        || normalized.contains("; alter ")
}

fn looks_like_reader(sql: &str) -> bool {
    let normalized = sql.trim_start().to_lowercase();
    normalized.starts_with("select")
        || normalized.starts_with("with")
        || normalized.starts_with("show")
        || normalized.starts_with("explain")
        || normalized.starts_with("describe")
        || normalized.starts_with("desc")
}

fn append_limit_if_missing(sql: &str, limit: u32) -> String {
    let trimmed = trim_trailing_semicolon(sql);
    let lower = trimmed.to_lowercase();
    if lower.contains(" limit ") || lower.ends_with(" limit") {
        trimmed.to_string()
    } else {
        format!("{} limit {}", trimmed, limit.clamp(1, 1000))
    }
}

fn trimmed_sql(sql: &str) -> &str {
    sql.trim().trim_matches('\u{feff}').trim()
}

fn trim_trailing_semicolon(sql: &str) -> &str {
    trimmed_sql(sql).trim_end_matches(';').trim()
}

fn normalized_kind(request: &DatabaseConnectionRequest) -> String {
    match request.kind.trim().to_lowercase().as_str() {
        "postgres" | "postgresql" | "pg" => "postgresql".to_string(),
        "mariadb" | "mysql" => "mysql".to_string(),
        "sqlite" | "sqlite3" => "sqlite".to_string(),
        "redis" | "valkey" => "redis".to_string(),
        "mongo" | "mongodb" => "mongodb".to_string(),
        other => other.to_string(),
    }
}

fn validate_identifier(value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("标识符不能为空".to_string());
    }
    if value.len() > 256 {
        return Err("标识符过长".to_string());
    }
    if value
        .chars()
        .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
    {
        return Err("标识符包含非法字符".to_string());
    }
    Ok(())
}

fn non_empty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    let value = value.trim();
    if value.is_empty() {
        fallback
    } else {
        value
    }
}

fn quote_sqlite_table(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn quote_sqlite_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn quote_postgres_table(schema: &str, table: &str) -> String {
    if schema.trim().is_empty() {
        quote_postgres_ident(table)
    } else {
        format!(
            "{}.{}",
            quote_postgres_ident(schema),
            quote_postgres_ident(table)
        )
    }
}

fn quote_postgres_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn quote_mysql_ident(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}
