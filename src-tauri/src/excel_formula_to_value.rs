use calamine::{open_workbook_auto, Data, Reader};
use serde::Serialize;
use std::path::Path;

use crate::excel_utils::write_cell;

#[derive(Debug, Serialize)]
pub struct ExcelFormulaToValueResult {
    output_path: String,
    sheet_count: usize,
    formula_count: usize,
}

#[tauri::command]
pub async fn convert_excel_formulas_to_values(
    input_path: String,
    output_path: String,
) -> Result<ExcelFormulaToValueResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_excel_formulas_to_values_impl(&input_path, &output_path)
    })
    .await
    .map_err(|e| format!("转换任务执行失败: {}", e))?
}

fn convert_excel_formulas_to_values_impl(
    input_path: &str,
    output_path: &str,
) -> Result<ExcelFormulaToValueResult, String> {
    let mut workbook = open_workbook_auto(input_path)
        .map_err(|e| format!("无法打开文件 {}: {}", input_path, e))?;

    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() {
        return Err("空工作簿，无法转换".to_string());
    }

    let mut out_wb = rust_xlsxwriter::Workbook::new();
    let mut total_formula_count = 0usize;
    let mut written_sheet_count = 0usize;

    for sheet_name in &sheet_names {
        let range = match workbook.worksheet_range(sheet_name) {
            Ok(range) => range,
            Err(_) => continue,
        };

        let formula_count = workbook
            .worksheet_formula(sheet_name)
            .map(|formula_range| {
                formula_range
                    .rows()
                    .flat_map(|row| row.iter())
                    .filter(|formula| !formula.trim().is_empty())
                    .count()
            })
            .unwrap_or(0);
        total_formula_count += formula_count;

        let start = range.start().unwrap_or((0, 0));
        let sheet = out_wb
            .add_worksheet()
            .set_name(sheet_name)
            .map_err(|e| format!("设置工作表名称失败: {}", e))?;

        for (row_offset, row) in range.rows().enumerate() {
            let absolute_row = start.0 + row_offset as u32;
            for (col_offset, cell) in row.iter().enumerate() {
                let absolute_col = start.1 + col_offset as u32;
                if matches!(cell, Data::Empty) {
                    continue;
                }
                write_cell(sheet, absolute_row, absolute_col as u16, cell)
                    .map_err(|e| format!("写入工作表 {} 失败: {}", sheet_name, e))?;
            }
        }

        written_sheet_count += 1;
    }

    if written_sheet_count == 0 {
        return Err("未读取到可转换的工作表内容".to_string());
    }

    out_wb
        .save(Path::new(output_path))
        .map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(ExcelFormulaToValueResult {
        output_path: output_path.to_string(),
        sheet_count: written_sheet_count,
        formula_count: total_formula_count,
    })
}
