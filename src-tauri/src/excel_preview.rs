use calamine::{open_workbook_auto, Data, Reader};
use serde::Serialize;
use std::path::Path;

use crate::excel_utils::cell_to_string;

const DEFAULT_PAGE_SIZE: usize = 100;
const MAX_PAGE_SIZE: usize = 500;

#[derive(Debug, Serialize)]
pub struct ExcelPreviewWorkbook {
    file_name: String,
    sheets: Vec<ExcelPreviewSheetMeta>,
}

#[derive(Debug, Serialize)]
pub struct ExcelPreviewSheetMeta {
    name: String,
    row_count: usize,
    col_count: usize,
    non_empty_cells: usize,
    formula_cells: usize,
}

#[derive(Debug, Serialize)]
pub struct ExcelPreviewSheetPage {
    sheet_name: String,
    page: usize,
    page_size: usize,
    total_rows: usize,
    total_cols: usize,
    total_pages: usize,
    start_row_number: usize,
    rows: Vec<ExcelPreviewRow>,
}

#[derive(Debug, Serialize)]
pub struct ExcelPreviewRow {
    row_number: usize,
    cells: Vec<ExcelPreviewCell>,
}

#[derive(Debug, Serialize)]
pub struct ExcelPreviewCell {
    address: String,
    value: String,
    formula: Option<String>,
    kind: String,
    is_empty: bool,
}

#[tauri::command]
pub async fn excel_preview_get_workbook(file_path: String) -> Result<ExcelPreviewWorkbook, String> {
    tauri::async_runtime::spawn_blocking(move || get_workbook_preview_impl(&file_path))
        .await
        .map_err(|e| format!("预览任务执行失败: {}", e))?
}

#[tauri::command]
pub async fn excel_preview_get_sheet_page(
    file_path: String,
    sheet_name: String,
    page: Option<usize>,
    page_size: Option<usize>,
) -> Result<ExcelPreviewSheetPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_sheet_page_impl(&file_path, &sheet_name, page, page_size)
    })
    .await
    .map_err(|e| format!("读取工作表失败: {}", e))?
}

fn get_workbook_preview_impl(file_path: &str) -> Result<ExcelPreviewWorkbook, String> {
    if is_csv_path(file_path) {
        let rows = read_csv_rows(file_path)?;
        let row_count = rows.len();
        let col_count = rows.iter().map(|row| row.len()).max().unwrap_or(0);
        let non_empty_cells = rows
            .iter()
            .flat_map(|row| row.iter())
            .filter(|cell| !cell.trim().is_empty())
            .count();

        return Ok(ExcelPreviewWorkbook {
            file_name: extract_file_name(file_path),
            sheets: vec![ExcelPreviewSheetMeta {
                name: "Sheet1".to_string(),
                row_count,
                col_count,
                non_empty_cells,
                formula_cells: 0,
            }],
        });
    }

    let mut workbook =
        open_workbook_auto(file_path).map_err(|e| format!("无法打开文件 {}: {}", file_path, e))?;

    let mut sheets = Vec::new();
    for sheet_name in workbook.sheet_names().to_owned() {
        let range = match workbook.worksheet_range(&sheet_name) {
            Ok(range) => range,
            Err(_) => continue,
        };

        let formula_cells = workbook
            .worksheet_formula(&sheet_name)
            .map(|formula_range| {
                formula_range
                    .rows()
                    .flat_map(|row| row.iter())
                    .filter(|formula| !formula.trim().is_empty())
                    .count()
            })
            .unwrap_or(0);

        sheets.push(ExcelPreviewSheetMeta {
            name: sheet_name,
            row_count: range.height(),
            col_count: range.width(),
            non_empty_cells: range.used_cells().count(),
            formula_cells,
        });
    }

    if sheets.is_empty() {
        return Err("未找到可预览的工作表".to_string());
    }

    Ok(ExcelPreviewWorkbook {
        file_name: extract_file_name(file_path),
        sheets,
    })
}

fn get_sheet_page_impl(
    file_path: &str,
    sheet_name: &str,
    page: Option<usize>,
    page_size: Option<usize>,
) -> Result<ExcelPreviewSheetPage, String> {
    let page_size = normalize_page_size(page_size);

    if is_csv_path(file_path) {
        let rows = read_csv_rows(file_path)?;
        return build_csv_sheet_page(sheet_name, rows, page, page_size);
    }

    let mut workbook =
        open_workbook_auto(file_path).map_err(|e| format!("无法打开文件 {}: {}", file_path, e))?;
    let range = workbook
        .worksheet_range(sheet_name)
        .map_err(|_| format!("无法读取工作表 {}", sheet_name))?;
    let formula_range = workbook.worksheet_formula(sheet_name).ok();

    let total_rows = range.height();
    let total_cols = range.width();
    let total_pages = calculate_total_pages(total_rows, page_size);
    let page = clamp_page(page.unwrap_or(1), total_pages);
    let start_index = (page - 1) * page_size;
    let end_index = total_rows.min(start_index + page_size);
    let start = range.start().unwrap_or((0, 0));

    let rows = range
        .rows()
        .skip(start_index)
        .take(end_index.saturating_sub(start_index))
        .enumerate()
        .map(|(row_offset, row)| {
            let absolute_row = start.0 as usize + start_index + row_offset;
            let cells = row
                .iter()
                .enumerate()
                .map(|(col_offset, cell)| {
                    let absolute_col = start.1 as usize + col_offset;
                    let formula = formula_range
                        .as_ref()
                        .and_then(|range| {
                            range.get_value((absolute_row as u32, absolute_col as u32))
                        })
                        .map(|formula| formula.trim().to_string())
                        .filter(|formula| !formula.is_empty());
                    ExcelPreviewCell {
                        address: build_cell_address(absolute_row, absolute_col),
                        value: cell_to_string(cell),
                        formula,
                        kind: detect_cell_kind(cell),
                        is_empty: matches!(cell, Data::Empty)
                            || cell_to_string(cell).trim().is_empty(),
                    }
                })
                .collect();

            ExcelPreviewRow {
                row_number: absolute_row + 1,
                cells,
            }
        })
        .collect();

    Ok(ExcelPreviewSheetPage {
        sheet_name: sheet_name.to_string(),
        page,
        page_size,
        total_rows,
        total_cols,
        total_pages,
        start_row_number: start.0 as usize + start_index + 1,
        rows,
    })
}

fn build_csv_sheet_page(
    sheet_name: &str,
    rows: Vec<Vec<String>>,
    page: Option<usize>,
    page_size: usize,
) -> Result<ExcelPreviewSheetPage, String> {
    let total_rows = rows.len();
    let total_cols = rows.iter().map(|row| row.len()).max().unwrap_or(0);
    let total_pages = calculate_total_pages(total_rows, page_size);
    let page = clamp_page(page.unwrap_or(1), total_pages);
    let start_index = (page - 1) * page_size;
    let end_index = total_rows.min(start_index + page_size);

    let page_rows = rows[start_index..end_index]
        .iter()
        .enumerate()
        .map(|(row_offset, row)| ExcelPreviewRow {
            row_number: start_index + row_offset + 1,
            cells: (0..total_cols)
                .map(|col_index| {
                    let value = row.get(col_index).cloned().unwrap_or_default();
                    ExcelPreviewCell {
                        address: build_cell_address(start_index + row_offset, col_index),
                        formula: None,
                        kind: "string".to_string(),
                        is_empty: value.trim().is_empty(),
                        value,
                    }
                })
                .collect(),
        })
        .collect();

    Ok(ExcelPreviewSheetPage {
        sheet_name: sheet_name.to_string(),
        page,
        page_size,
        total_rows,
        total_cols,
        total_pages,
        start_row_number: start_index + 1,
        rows: page_rows,
    })
}

fn read_csv_rows(path: &str) -> Result<Vec<Vec<String>>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;
    let text = if std::str::from_utf8(&bytes).is_ok() {
        String::from_utf8(bytes).map_err(|e| format!("解析 UTF-8 失败: {}", e))?
    } else {
        let (cow, _, _) = encoding_rs::GBK.decode(&bytes);
        cow.into_owned()
    };

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .from_reader(text.as_bytes());

    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| format!("解析 CSV 失败: {}", e))?;
        rows.push(record.iter().map(|cell| cell.to_string()).collect());
    }
    Ok(rows)
}

fn normalize_page_size(page_size: Option<usize>) -> usize {
    page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE)
}

fn calculate_total_pages(total_rows: usize, page_size: usize) -> usize {
    total_rows.max(1).div_ceil(page_size.max(1))
}

fn clamp_page(page: usize, total_pages: usize) -> usize {
    page.clamp(1, total_pages.max(1))
}

fn detect_cell_kind(cell: &Data) -> String {
    match cell {
        Data::String(_) => "string",
        Data::Float(_) => "number",
        Data::Int(_) => "number",
        Data::Bool(_) => "boolean",
        Data::DateTime(_) => "datetime",
        Data::DateTimeIso(_) => "datetime",
        Data::DurationIso(_) => "duration",
        Data::Error(_) => "error",
        Data::Empty => "empty",
    }
    .to_string()
}

fn build_cell_address(row_index: usize, col_index: usize) -> String {
    format!("{}{}", to_excel_column_name(col_index), row_index + 1)
}

fn to_excel_column_name(mut index: usize) -> String {
    let mut name = String::new();
    loop {
        let remainder = index % 26;
        name.insert(0, (b'A' + remainder as u8) as char);
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    name
}

fn extract_file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

fn is_csv_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("csv"))
        .unwrap_or(false)
}
