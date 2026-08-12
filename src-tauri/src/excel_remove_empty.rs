use crate::excel_utils::{cell_to_string, write_cell};
use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::{Format, Workbook};
use std::path::Path;

#[tauri::command]
pub async fn remove_empty_rows(
    input_paths: Vec<String>,
    output_dir: String,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out_dir_path = Path::new(&output_dir);
        let mut success_count = 0;

        for path in input_paths {
            let p = Path::new(&path);
            let base_name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("cleaned");
            let out_file_name = format!("{}_去除空行.xlsx", base_name);
            let out_file_path = out_dir_path.join(out_file_name);

            match process_single_file(&path, &out_file_path) {
                Ok(_) => success_count += 1,
                Err(e) => return Err(format!("处理文件 {} 失败: {}", path, e)),
            }
        }

        Ok(success_count)
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))?
}

fn process_single_file(input_path: &str, output_path: &Path) -> Result<(), String> {
    let mut workbook =
        open_workbook_auto(input_path).map_err(|e| format!("无法打开文件: {}", e))?;

    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() {
        return Err("空工作簿".to_string());
    }

    let mut out_wb = Workbook::new();
    let header_format = Format::new().set_bold();

    for sheet_name in &sheet_names {
        if let Ok(range) = workbook.worksheet_range(sheet_name) {
            let sheet = out_wb
                .add_worksheet()
                .set_name(sheet_name)
                .map_err(|e| e.to_string())?;
            let range: calamine::Range<Data> = range;

            let mut out_row_idx = 0;

            for (i, row) in range.rows().enumerate() {
                // 检查该行是否全为空
                let mut is_empty = true;
                for cell in row.iter() {
                    let text = cell_to_string(cell);
                    if !text.trim().is_empty() {
                        is_empty = false;
                        break;
                    }
                }

                // 如果不全为空，则写入新表格
                if !is_empty {
                    for (col_idx, cell) in row.iter().enumerate() {
                        // 如果是第一行且有数据，默认加粗（简单认为第一行非空的是表头）
                        if i == 0 {
                            let text = cell_to_string(cell);
                            sheet
                                .write_string_with_format(
                                    out_row_idx,
                                    col_idx as u16,
                                    &text,
                                    &header_format,
                                )
                                .map_err(|e| e.to_string())?;
                        } else {
                            write_cell(sheet, out_row_idx, col_idx as u16, cell)
                                .map_err(|e| e.to_string())?;
                        }
                    }
                    out_row_idx += 1;
                }
            }
        }
    }

    out_wb
        .save(output_path)
        .map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(())
}
