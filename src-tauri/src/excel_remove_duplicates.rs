use calamine::{open_workbook_auto, Data, Reader};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::excel_utils::{cell_to_string, write_cell};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DuplicateMode {
    KeepFirst,
    KeepLast,
    RemoveAll,
}

#[derive(Debug, Serialize)]
pub struct ExcelRemoveDuplicatesResult {
    output_path: String,
    removed_rows: usize,
    kept_rows: usize,
    target_sheet_name: String,
}

#[tauri::command]
pub async fn remove_excel_duplicates(
    input_path: String,
    column_index: usize,
    mode: String,
    output_path: String,
) -> Result<ExcelRemoveDuplicatesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        remove_excel_duplicates_impl(&input_path, column_index, &mode, &output_path)
    })
    .await
    .map_err(|e| format!("去重任务执行失败: {}", e))?
}

fn remove_excel_duplicates_impl(
    input_path: &str,
    column_index: usize,
    mode: &str,
    output_path: &str,
) -> Result<ExcelRemoveDuplicatesResult, String> {
    let duplicate_mode = parse_duplicate_mode(mode)?;
    let mut workbook = open_workbook_auto(input_path)
        .map_err(|e| format!("无法打开文件 {}: {}", input_path, e))?;

    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() {
        return Err("空工作簿，无法处理".to_string());
    }

    let target_sheet_name = sheet_names[0].clone();
    let target_range = workbook
        .worksheet_range(&target_sheet_name)
        .map_err(|_| "无法读取目标工作表内容".to_string())?;

    let target_range: calamine::Range<Data> = target_range;
    let mut rows_iter = target_range.rows();
    let header_row = rows_iter
        .next()
        .ok_or_else(|| "目标工作表为空，无法读取表头".to_string())?
        .to_vec();

    if column_index >= header_row.len() {
        return Err("选择的列超出表头范围".to_string());
    }

    let data_rows = rows_iter.map(|row| row.to_vec()).collect::<Vec<_>>();
    let keep_flags = build_keep_flags(&data_rows, column_index, duplicate_mode);
    let kept_rows = keep_flags.iter().filter(|keep| **keep).count();
    let removed_rows = keep_flags.len().saturating_sub(kept_rows);

    let mut out_wb = rust_xlsxwriter::Workbook::new();

    for (sheet_idx, sheet_name) in sheet_names.iter().enumerate() {
        let range = match workbook.worksheet_range(sheet_name) {
            Ok(range) => range,
            Err(_) => continue,
        };

        let range: calamine::Range<Data> = range;
        let start = range.start().unwrap_or((0, 0));
        let out_sheet = out_wb
            .add_worksheet()
            .set_name(sheet_name)
            .map_err(|e| format!("设置工作表名称失败: {}", e))?;

        if sheet_idx == 0 {
            write_filtered_sheet(out_sheet, start, &header_row, &data_rows, &keep_flags)
                .map_err(|e| format!("写入去重结果失败: {}", e))?;
        } else {
            write_full_sheet(out_sheet, start, &range)
                .map_err(|e| format!("写入工作表 {} 失败: {}", sheet_name, e))?;
        }
    }

    out_wb
        .save(Path::new(output_path))
        .map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(ExcelRemoveDuplicatesResult {
        output_path: output_path.to_string(),
        removed_rows,
        kept_rows,
        target_sheet_name,
    })
}

fn parse_duplicate_mode(mode: &str) -> Result<DuplicateMode, String> {
    match mode {
        "keep_first" => Ok(DuplicateMode::KeepFirst),
        "keep_last" => Ok(DuplicateMode::KeepLast),
        "remove_all" => Ok(DuplicateMode::RemoveAll),
        _ => Err(format!("不支持的去重模式: {}", mode)),
    }
}

fn build_keep_flags(rows: &[Vec<Data>], column_index: usize, mode: DuplicateMode) -> Vec<bool> {
    let keys = rows
        .iter()
        .map(|row| {
            row.get(column_index)
                .map(cell_to_string)
                .unwrap_or_default()
                .trim()
                .to_string()
        })
        .collect::<Vec<_>>();

    match mode {
        DuplicateMode::KeepFirst => {
            let mut seen = HashSet::new();
            keys.iter()
                .map(|key| seen.insert(key.clone()))
                .collect::<Vec<_>>()
        }
        DuplicateMode::KeepLast => {
            let mut last_indices = HashMap::new();
            for (idx, key) in keys.iter().enumerate() {
                last_indices.insert(key.clone(), idx);
            }
            keys.iter()
                .enumerate()
                .map(|(idx, key)| last_indices.get(key) == Some(&idx))
                .collect::<Vec<_>>()
        }
        DuplicateMode::RemoveAll => {
            let mut counts = HashMap::new();
            for key in &keys {
                *counts.entry(key.clone()).or_insert(0usize) += 1;
            }
            keys.iter()
                .map(|key| counts.get(key).copied().unwrap_or(0) == 1)
                .collect::<Vec<_>>()
        }
    }
}

fn write_filtered_sheet(
    sheet: &mut rust_xlsxwriter::Worksheet,
    start: (u32, u32),
    header_row: &[Data],
    data_rows: &[Vec<Data>],
    keep_flags: &[bool],
) -> Result<(), rust_xlsxwriter::XlsxError> {
    for (col_idx, cell) in header_row.iter().enumerate() {
        write_cell(sheet, start.0, start.1 as u16 + col_idx as u16, cell)?;
    }

    let mut output_row = start.0 + 1;
    for (row, keep) in data_rows.iter().zip(keep_flags.iter()) {
        if !keep {
            continue;
        }
        for (col_idx, cell) in row.iter().enumerate() {
            write_cell(sheet, output_row, start.1 as u16 + col_idx as u16, cell)?;
        }
        output_row += 1;
    }

    Ok(())
}

fn write_full_sheet(
    sheet: &mut rust_xlsxwriter::Worksheet,
    start: (u32, u32),
    range: &calamine::Range<Data>,
) -> Result<(), rust_xlsxwriter::XlsxError> {
    for (row_offset, row) in range.rows().enumerate() {
        let absolute_row = start.0 + row_offset as u32;
        for (col_offset, cell) in row.iter().enumerate() {
            if matches!(cell, Data::Empty) {
                continue;
            }
            write_cell(
                sheet,
                absolute_row,
                start.1 as u16 + col_offset as u16,
                cell,
            )?;
        }
    }
    Ok(())
}
