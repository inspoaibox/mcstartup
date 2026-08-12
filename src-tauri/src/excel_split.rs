use crate::excel_utils::{cell_to_string, write_cell};
use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::{Format, Workbook};
use std::collections::HashMap;
use std::path::Path;

#[tauri::command]
pub async fn get_excel_headers(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut workbook =
            open_workbook_auto(&path).map_err(|e| format!("无法打开文件 {}: {}", path, e))?;

        let sheet_names = workbook.sheet_names().to_owned();
        if sheet_names.is_empty() {
            return Err("空工作簿".to_string());
        }

        let sheet_name = &sheet_names[0]; // 默认取第一个 sheet
        if let Ok(range) = workbook.worksheet_range(sheet_name) {
            let range: calamine::Range<Data> = range;
            if let Some(header_row) = range.rows().next() {
                let mut headers = Vec::new();
                for (i, cell) in header_row.iter().enumerate() {
                    let mut name = cell_to_string(cell).trim().to_string();
                    if name.is_empty() {
                        name = format!("列_{}", i + 1);
                    }
                    headers.push(name);
                }
                return Ok(headers);
            }
        }
        Err("无法读取表头或工作表为空".to_string())
    })
    .await
    .map_err(|e| format!("读取表头任务失败: {}", e))?
}

#[tauri::command]
pub async fn split_excel_file(
    input_path: String,
    column_index: usize,
    output_dir: String,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut workbook = open_workbook_auto(&input_path)
            .map_err(|e| format!("无法打开文件 {}: {}", input_path, e))?;

        let sheet_names = workbook.sheet_names().to_owned();
        if sheet_names.is_empty() {
            return Err("空工作簿".to_string());
        }

        let sheet_name = &sheet_names[0];
        let range = workbook
            .worksheet_range(sheet_name)
            .map_err(|_| "无法读取工作表内容".to_string())?;

        let range: calamine::Range<Data> = range;
        let mut rows_iter = range.rows();

        let header_row = match rows_iter.next() {
            Some(r) => r.to_vec(),
            None => return Err("工作表为空".to_string()),
        };

        if column_index >= header_row.len() {
            return Err("选择的列超出范围".to_string());
        }

        // 分组保存数据行
        // key: 分组依据的值, value: 对应的行列表
        let mut grouped_rows: HashMap<String, Vec<Vec<Data>>> = HashMap::new();

        for row in rows_iter {
            if row.is_empty() {
                continue;
            }

            // 获取用来分组的单元格值
            let key_cell = if column_index < row.len() {
                &row[column_index]
            } else {
                &Data::Empty
            };

            let mut group_key = cell_to_string(key_cell).trim().to_string();
            // 处理特殊字符作为文件名
            group_key = group_key.replace(&['/', '\\', ':', '*', '?', '"', '<', '>', '|'][..], "_");

            if group_key.is_empty() {
                group_key = "空值".to_string();
            }

            grouped_rows
                .entry(group_key)
                .or_insert_with(Vec::new)
                .push(row.to_vec());
        }

        let base_name = Path::new(&input_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("拆分文件");
        let out_dir_path = Path::new(&output_dir);

        let header_format = Format::new().set_bold();
        let mut generated_count = 0;

        for (group_key, rows) in grouped_rows {
            let out_file_name = format!("{}_{}.xlsx", base_name, group_key);
            let out_file_path = out_dir_path.join(out_file_name);

            let mut out_wb = Workbook::new();
            let sheet = out_wb.add_worksheet();

            // 写入表头
            for (i, cell) in header_row.iter().enumerate() {
                let text = cell_to_string(cell);
                sheet
                    .write_string_with_format(0, i as u16, &text, &header_format)
                    .map_err(|e| format!("写入表头失败: {}", e))?;
            }

            // 写入数据
            for (row_idx, row_data) in rows.iter().enumerate() {
                let sheet_row = (row_idx + 1) as u32;
                for (col_idx, cell) in row_data.iter().enumerate() {
                    write_cell(sheet, sheet_row, col_idx as u16, cell)
                        .map_err(|e| format!("写入数据失败: {}", e))?;
                }
            }

            out_wb
                .save(&out_file_path)
                .map_err(|e| format!("保存文件失败 {}: {}", out_file_path.display(), e))?;

            generated_count += 1;
        }

        Ok(generated_count)
    })
    .await
    .map_err(|e| format!("拆分任务执行失败: {}", e))?
}
