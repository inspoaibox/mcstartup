use crate::excel_utils::{cell_to_string, write_cell};
use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::{Color, Format, Workbook, Worksheet};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[tauri::command]
pub async fn diff_excel_files(
    path_a: String,
    path_b: String,
    key_column_name: String,
    output_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        diff_excel_files_impl(&path_a, &path_b, &key_column_name, &output_path)
    })
    .await
    .map_err(|e| format!("对比任务执行失败: {}", e))?
}

fn extract_data(
    path: &str,
    key_col_name: &str,
) -> Result<
    (
        Vec<String>,
        Vec<String>,
        HashMap<String, HashMap<String, Data>>,
    ),
    String,
> {
    let mut workbook =
        open_workbook_auto(path).map_err(|e| format!("无法打开文件 {}: {}", path, e))?;

    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() {
        return Err(format!("{} 是空工作簿", path));
    }

    let sheet_name = &sheet_names[0];
    let range = workbook
        .worksheet_range(sheet_name)
        .map_err(|_| format!("{} 无法读取工作表内容", path))?;

    let range: calamine::Range<Data> = range;
    let mut rows_iter = range.rows();

    let header_row = match rows_iter.next() {
        Some(r) => r.to_vec(),
        None => return Err(format!("{} 工作表为空", path)),
    };

    let mut headers = Vec::new();
    let mut key_index = None;

    for (i, cell) in header_row.iter().enumerate() {
        let mut name = cell_to_string(cell).trim().to_string();
        if name.is_empty() {
            name = format!("未命名列_{}", i + 1);
        }

        // 处理重复表头
        let mut final_name = name.clone();
        let mut counter = 1;
        while headers.contains(&final_name) {
            final_name = format!("{}_{}", name, counter);
            counter += 1;
        }

        if final_name == key_col_name {
            key_index = Some(i);
        }

        headers.push(final_name);
    }

    if key_index.is_none() {
        return Err(format!(
            "在 {} 中未找到作为对比依据的列：{}",
            path, key_col_name
        ));
    }
    let key_index = key_index.unwrap();

    let mut map = HashMap::new();
    let mut key_order = Vec::new();

    for row in rows_iter {
        let key_cell = if key_index < row.len() {
            &row[key_index]
        } else {
            &Data::Empty
        };

        let key_str = cell_to_string(key_cell).trim().to_string();
        if key_str.is_empty() {
            continue; // 忽略没有主键的行
        }

        let mut row_map = HashMap::new();
        for (i, cell) in row.iter().enumerate() {
            if i < headers.len() {
                row_map.insert(headers[i].clone(), cell.clone());
            }
        }

        if !map.contains_key(&key_str) {
            key_order.push(key_str.clone());
        }
        map.insert(key_str, row_map);
    }

    Ok((headers, key_order, map))
}

fn diff_excel_files_impl(
    path_a: &str,
    path_b: &str,
    key_col_name: &str,
    output_path: &str,
) -> Result<String, String> {
    let (headers_a, order_a, map_a) = extract_data(path_a, key_col_name)?;
    let (headers_b, order_b, map_b) = extract_data(path_b, key_col_name)?;

    // 合并表头，A的在前，B的在后（去重）
    let mut all_headers = headers_a.clone();
    for h in &headers_b {
        if !all_headers.contains(h) {
            all_headers.push(h.clone());
        }
    }

    // 合并主键，A的在前，B的在后
    let mut all_keys = order_a.clone();
    let mut seen_keys: HashSet<String> = order_a.into_iter().collect();
    for k in order_b {
        if !seen_keys.contains(&k) {
            all_keys.push(k.clone());
            seen_keys.insert(k);
        }
    }

    let mut out_wb = Workbook::new();
    let sheet = out_wb.add_worksheet();

    let format_header = Format::new().set_bold();
    let format_added = Format::new()
        .set_background_color(Color::RGB(0xC6EFCE))
        .set_font_color(Color::RGB(0x006100));
    let format_removed = Format::new()
        .set_background_color(Color::RGB(0xFFC7CE))
        .set_font_color(Color::RGB(0x9C0006));
    let format_modified_cell = Format::new()
        .set_background_color(Color::RGB(0xFFEB9C))
        .set_font_color(Color::RGB(0x9C6500));

    // 写入表头，增加“对比状态”列在第一列
    sheet
        .write_string_with_format(0, 0, "对比状态", &format_header)
        .map_err(|e| e.to_string())?;
    for (i, h) in all_headers.iter().enumerate() {
        sheet
            .write_string_with_format(0, (i + 1) as u16, h, &format_header)
            .map_err(|e| e.to_string())?;
    }

    let mut sheet_row = 1;

    for key in all_keys {
        let in_a = map_a.get(&key);
        let in_b = map_b.get(&key);

        match (in_a, in_b) {
            (Some(row_a), None) => {
                // 已删除
                sheet
                    .write_string_with_format(sheet_row, 0, "已删除", &format_removed)
                    .map_err(|e| e.to_string())?;
                for (i, h) in all_headers.iter().enumerate() {
                    let col = (i + 1) as u16;
                    if let Some(cell) = row_a.get(h) {
                        let _ =
                            write_cell_with_format(sheet, sheet_row, col, cell, &format_removed);
                    } else {
                        let _ = sheet.write_blank(sheet_row, col, &format_removed);
                    }
                }
            }
            (None, Some(row_b)) => {
                // 已新增
                sheet
                    .write_string_with_format(sheet_row, 0, "已新增", &format_added)
                    .map_err(|e| e.to_string())?;
                for (i, h) in all_headers.iter().enumerate() {
                    let col = (i + 1) as u16;
                    if let Some(cell) = row_b.get(h) {
                        let _ = write_cell_with_format(sheet, sheet_row, col, cell, &format_added);
                    } else {
                        let _ = sheet.write_blank(sheet_row, col, &format_added);
                    }
                }
            }
            (Some(row_a), Some(row_b)) => {
                // 判断是否修改
                let mut is_modified = false;
                let mut modifications = Vec::new(); // true means modified cell

                for h in &all_headers {
                    let val_a = row_a.get(h).unwrap_or(&Data::Empty);
                    let val_b = row_b.get(h).unwrap_or(&Data::Empty);
                    let str_a = cell_to_string(val_a).trim().to_string();
                    let str_b = cell_to_string(val_b).trim().to_string();

                    if str_a != str_b {
                        is_modified = true;
                        modifications.push(true);
                    } else {
                        modifications.push(false);
                    }
                }

                if is_modified {
                    sheet
                        .write_string_with_format(sheet_row, 0, "已修改", &format_modified_cell)
                        .map_err(|e| e.to_string())?;
                } else {
                    sheet
                        .write_string(sheet_row, 0, "无变化")
                        .map_err(|e| e.to_string())?;
                }

                for (i, h) in all_headers.iter().enumerate() {
                    let col = (i + 1) as u16;
                    // 使用 B 的数据展示
                    let cell = row_b.get(h).unwrap_or(&Data::Empty);
                    if is_modified && modifications[i] {
                        let _ = write_cell_with_format(
                            sheet,
                            sheet_row,
                            col,
                            cell,
                            &format_modified_cell,
                        );
                    } else {
                        let _ = write_cell(sheet, sheet_row, col, cell);
                    }
                }
            }
            _ => unreachable!(),
        }

        sheet_row += 1;
    }

    out_wb
        .save(Path::new(output_path))
        .map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(output_path.to_string())
}

// 带格式的单元格写入辅助
fn write_cell_with_format(
    sheet: &mut Worksheet,
    row: u32,
    col: u16,
    cell: &Data,
    format: &Format,
) -> Result<(), rust_xlsxwriter::XlsxError> {
    match cell {
        Data::String(s) => {
            sheet.write_string_with_format(row, col, s, format)?;
        }
        Data::Float(f) => {
            sheet.write_number_with_format(row, col, *f, format)?;
        }
        Data::Int(i) => {
            sheet.write_number_with_format(row, col, *i as f64, format)?;
        }
        Data::Bool(b) => {
            sheet.write_boolean_with_format(row, col, *b, format)?;
        }
        Data::DateTime(d) => {
            sheet.write_string_with_format(row, col, &d.to_string(), format)?;
        }
        Data::DateTimeIso(d) => {
            sheet.write_string_with_format(row, col, d, format)?;
        }
        Data::DurationIso(d) => {
            sheet.write_string_with_format(row, col, d, format)?;
        }
        Data::Empty | Data::Error(_) => {
            sheet.write_blank(row, col, format)?;
        }
    }
    Ok(())
}
