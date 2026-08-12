use crate::excel_utils::{cell_to_string, write_cell};
use calamine::{open_workbook_auto, Data, Reader};
use indexmap::IndexMap;
use rust_xlsxwriter::{Format, Workbook};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Clone, Copy, PartialEq, Eq)]
enum MergeMode {
    SingleSheet,
    MultiSheet,
}

struct SourceSheetData {
    headers: Vec<String>,
    rows: Vec<Vec<Data>>,
}

#[tauri::command]
pub async fn merge_excel_files(
    input_paths: Vec<String>,
    output_path: String,
    merge_mode: Option<String>,
) -> Result<String, String> {
    let merge_mode = parse_merge_mode(merge_mode.as_deref());
    tauri::async_runtime::spawn_blocking(move || {
        merge_excel_files_impl(&input_paths, &output_path, merge_mode)
    })
    .await
    .map_err(|e| format!("合并任务执行失败: {}", e))?
}

fn merge_excel_files_impl(
    input_paths: &[String],
    output_path: &str,
    merge_mode: MergeMode,
) -> Result<String, String> {
    match merge_mode {
        MergeMode::SingleSheet => merge_into_single_sheet(input_paths, output_path),
        MergeMode::MultiSheet => merge_into_multiple_sheets(input_paths, output_path),
    }
}

fn merge_into_single_sheet(input_paths: &[String], output_path: &str) -> Result<String, String> {
    let mut unified_headers: IndexMap<String, usize> = IndexMap::new();
    let mut normalized_headers: HashMap<String, usize> = HashMap::new();
    let mut all_rows: Vec<Vec<(usize, Data)>> = Vec::new();

    for path in input_paths {
        let mut workbook =
            open_workbook_auto(path).map_err(|e| format!("无法打开文件 {}: {}", path, e))?;

        let sheet_names = workbook.sheet_names().to_owned();
        if sheet_names.is_empty() {
            continue; // 空工作簿
        }

        // 遍历所有 sheet
        for sheet_name in &sheet_names {
            if let Ok(range) = workbook.worksheet_range(sheet_name) {
                let range: calamine::Range<calamine::Data> = range;
                let mut rows_iter = range.rows();

                // 读取表头
                let header_row = match rows_iter.next() {
                    Some(r) => r,
                    None => continue, // 该 sheet 为空
                };

                let mut col_mapping: Vec<Option<usize>> = Vec::new();
                let mut local_seen_headers: HashSet<String> = HashSet::new();

                for (i, cell) in header_row.iter().enumerate() {
                    let mut header_name = cell_to_string(cell);
                    header_name = header_name.trim().to_string();

                    // 处理空表头，避免丢失该列数据
                    if header_name.is_empty() {
                        header_name = format!("未命名列_{}", i + 1);
                    }

                    // 处理同一 sheet 内重复的表头（例如两列都叫 "姓名"）
                    let mut final_header_name = header_name.clone();
                    let mut normalized_lookup_key = normalize_header_name(&final_header_name);
                    let mut counter = 1;
                    while local_seen_headers.contains(&normalized_lookup_key) {
                        final_header_name = format!("{}_{}", header_name, counter);
                        normalized_lookup_key = normalize_header_name(&final_header_name);
                        counter += 1;
                    }
                    local_seen_headers.insert(normalized_lookup_key.clone());

                    let col_idx = if let Some(&idx) = normalized_headers.get(&normalized_lookup_key)
                    {
                        idx
                    } else {
                        let idx = unified_headers.len();
                        unified_headers.insert(final_header_name, idx);
                        normalized_headers.insert(normalized_lookup_key, idx);
                        idx
                    };

                    col_mapping.push(Some(col_idx));
                }

                // 读取数据行
                for row in rows_iter {
                    let mut row_data = Vec::new();
                    let mut is_empty_row = true;
                    for (i, cell) in row.iter().enumerate() {
                        if i < col_mapping.len() {
                            if let Some(unified_idx) = col_mapping[i] {
                                if !matches!(cell, Data::Empty)
                                    && !cell_to_string(cell).trim().is_empty()
                                {
                                    row_data.push((unified_idx, cell.clone()));
                                    is_empty_row = false;
                                }
                            }
                        }
                    }
                    // 仅当整行不全为空时才保存，避免插入过多无意义的空行
                    if !is_empty_row {
                        all_rows.push(row_data);
                    }
                }
            }
        }
    }

    // 使用 rust_xlsxwriter 写入合并后的结果
    let mut out_wb = Workbook::new();
    let sheet = out_wb.add_worksheet();

    // 写入表头
    let header_format = Format::new().set_bold();
    for (header_name, &col_idx) in unified_headers.iter() {
        sheet
            .write_string_with_format(0, col_idx as u16, header_name, &header_format)
            .map_err(|e| format!("写入表头失败: {}", e))?;
    }

    // 写入数据行
    for (row_idx, row_data) in all_rows.iter().enumerate() {
        let sheet_row = (row_idx + 1) as u32;
        for (col_idx, cell) in row_data {
            write_cell(sheet, sheet_row, *col_idx as u16, cell)
                .map_err(|e| format!("写入数据失败: {}", e))?;
        }
    }

    out_wb
        .save(Path::new(output_path))
        .map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(output_path.to_string())
}

fn merge_into_multiple_sheets(input_paths: &[String], output_path: &str) -> Result<String, String> {
    let mut out_wb = Workbook::new();
    let mut used_sheet_names = HashSet::new();
    let mut written_sheet_count = 0usize;

    for path in input_paths {
        let mut workbook =
            open_workbook_auto(path).map_err(|e| format!("无法打开文件 {}: {}", path, e))?;

        let sheet_names = workbook.sheet_names().to_owned();
        if sheet_names.is_empty() {
            continue;
        }

        let file_stem = Path::new(path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .filter(|stem| !stem.trim().is_empty())
            .unwrap_or("Sheet");

        let multi_source_sheet = sheet_names.len() > 1;

        for sheet_name in &sheet_names {
            let range = match workbook.worksheet_range(sheet_name) {
                Ok(range) => range,
                Err(_) => continue,
            };

            let source_sheet = collect_source_sheet_data(range);
            if source_sheet.headers.is_empty() && source_sheet.rows.is_empty() {
                continue;
            }

            let preferred_name = if multi_source_sheet {
                format!("{}-{}", file_stem, sheet_name)
            } else {
                file_stem.to_string()
            };
            let safe_sheet_name = build_unique_sheet_name(&preferred_name, &mut used_sheet_names);

            let sheet = out_wb
                .add_worksheet()
                .set_name(&safe_sheet_name)
                .map_err(|e| format!("设置工作表名称失败: {}", e))?;

            write_source_sheet(sheet, &source_sheet)
                .map_err(|e| format!("写入工作表 {} 失败: {}", safe_sheet_name, e))?;
            written_sheet_count += 1;
        }
    }

    if written_sheet_count == 0 {
        out_wb.add_worksheet();
    }

    out_wb
        .save(Path::new(output_path))
        .map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(output_path.to_string())
}

fn collect_source_sheet_data(range: calamine::Range<Data>) -> SourceSheetData {
    let mut rows_iter = range.rows();
    let header_row = match rows_iter.next() {
        Some(r) => r,
        None => {
            return SourceSheetData {
                headers: Vec::new(),
                rows: Vec::new(),
            };
        }
    };

    let headers = header_row
        .iter()
        .enumerate()
        .map(|(i, cell)| {
            let text = cell_to_string(cell).trim().to_string();
            if text.is_empty() {
                format!("未命名列_{}", i + 1)
            } else {
                text
            }
        })
        .collect::<Vec<_>>();

    let rows = rows_iter
        .filter_map(|row| {
            let values = row.to_vec();
            let has_non_empty = values.iter().any(|cell| {
                !matches!(cell, Data::Empty) && !cell_to_string(cell).trim().is_empty()
            });
            if has_non_empty {
                Some(values)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    SourceSheetData { headers, rows }
}

fn write_source_sheet(
    sheet: &mut rust_xlsxwriter::Worksheet,
    source_sheet: &SourceSheetData,
) -> Result<(), rust_xlsxwriter::XlsxError> {
    let header_format = Format::new().set_bold();

    for (col_idx, header_name) in source_sheet.headers.iter().enumerate() {
        sheet.write_string_with_format(0, col_idx as u16, header_name, &header_format)?;
    }

    for (row_idx, row) in source_sheet.rows.iter().enumerate() {
        let sheet_row = (row_idx + 1) as u32;
        for (col_idx, cell) in row.iter().enumerate() {
            write_cell(sheet, sheet_row, col_idx as u16, cell)?;
        }
    }

    Ok(())
}

fn parse_merge_mode(merge_mode: Option<&str>) -> MergeMode {
    match merge_mode.unwrap_or("single_sheet") {
        "multi_sheet" => MergeMode::MultiSheet,
        _ => MergeMode::SingleSheet,
    }
}

fn normalize_header_name(header: &str) -> String {
    header
        .trim()
        .replace('\u{3000}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn build_unique_sheet_name(base_name: &str, used_sheet_names: &mut HashSet<String>) -> String {
    let sanitized = sanitize_sheet_name(base_name);
    if used_sheet_names.insert(sanitized.clone()) {
        return sanitized;
    }

    let mut counter = 2usize;
    loop {
        let suffix = format!("_{}", counter);
        let trimmed_base = truncate_sheet_name(&sanitized, 31 - suffix.chars().count());
        let candidate = format!("{}{}", trimmed_base, suffix);
        if used_sheet_names.insert(candidate.clone()) {
            return candidate;
        }
        counter += 1;
    }
}

fn sanitize_sheet_name(name: &str) -> String {
    let invalid_chars = ['\\', '/', '?', '*', '[', ']', ':'];
    let cleaned = name
        .chars()
        .map(|ch| if invalid_chars.contains(&ch) { '_' } else { ch })
        .collect::<String>();
    let trimmed = cleaned.trim().trim_matches('\'').trim();
    let normalized = if trimmed.is_empty() { "Sheet" } else { trimmed };
    truncate_sheet_name(normalized, 31)
}

fn truncate_sheet_name(name: &str, max_len: usize) -> String {
    name.chars().take(max_len.max(1)).collect()
}

#[cfg(test)]
mod tests {
    use super::{build_unique_sheet_name, normalize_header_name, sanitize_sheet_name};
    use std::collections::HashSet;

    #[test]
    fn normalize_header_trims_case_and_spacing() {
        assert_eq!(normalize_header_name(" SKU "), "sku");
        assert_eq!(normalize_header_name("Item　   Title"), "item title");
    }

    #[test]
    fn sanitize_sheet_name_removes_invalid_chars_and_truncates() {
        assert_eq!(sanitize_sheet_name("A/B:C*D?E[F]G"), "A_B_C_D_E_F_G");
        assert_eq!(
            sanitize_sheet_name("12345678901234567890123456789012345"),
            "1234567890123456789012345678901"
        );
    }

    #[test]
    fn build_unique_sheet_name_appends_suffix() {
        let mut used = HashSet::new();
        assert_eq!(build_unique_sheet_name("Report", &mut used), "Report");
        assert_eq!(build_unique_sheet_name("Report", &mut used), "Report_2");
    }
}
