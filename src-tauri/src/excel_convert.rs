use crate::excel_utils::cell_to_string;
use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::Workbook;
use std::path::Path;

#[tauri::command]
pub async fn convert_spreadsheet(
    input_paths: Vec<String>,
    output_dir: String,
    target_format: String,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out_dir_path = Path::new(&output_dir);
        let mut success_count = 0;

        for path in input_paths {
            let p = Path::new(&path);
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let base_name = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("converted");

            let data = if ext == "csv" {
                read_csv(&path)?
            } else {
                read_excel(&path)?
            };

            let out_ext = if target_format == "csv" {
                "csv"
            } else {
                "xlsx"
            };
            let out_file_name = format!("{}.{}", base_name, out_ext);
            let out_file_path = out_dir_path.join(out_file_name);

            if target_format == "csv" {
                write_csv(&data, &out_file_path.to_string_lossy())?;
            } else {
                write_excel(&data, &out_file_path.to_string_lossy())?;
            }

            success_count += 1;
        }

        Ok(success_count)
    })
    .await
    .map_err(|e| format!("转换任务执行失败: {}", e))?
}

fn read_csv(path: &str) -> Result<Vec<Vec<String>>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;

    let is_utf8 = std::str::from_utf8(&bytes).is_ok();

    let text = if is_utf8 {
        String::from_utf8(bytes).unwrap()
    } else {
        let (cow, _, _) = encoding_rs::GBK.decode(&bytes);
        cow.into_owned()
    };

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .from_reader(text.as_bytes());

    let mut rows = Vec::new();
    for result in reader.records() {
        let record = result.map_err(|e| format!("解析 CSV 失败: {}", e))?;
        rows.push(record.iter().map(|s| s.to_string()).collect());
    }

    Ok(rows)
}

fn read_excel(path: &str) -> Result<Vec<Vec<String>>, String> {
    let mut workbook =
        open_workbook_auto(path).map_err(|e| format!("无法打开文件 {}: {}", path, e))?;

    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() {
        return Err(format!("{} 是空工作簿", path));
    }

    // 默认读取第一个 sheet
    let sheet_name = &sheet_names[0];
    let range = workbook
        .worksheet_range(sheet_name)
        .map_err(|_| format!("{} 无法读取工作表内容", path))?;

    let range: calamine::Range<Data> = range;
    let mut rows = Vec::new();

    for row in range.rows() {
        let mut row_data = Vec::new();
        let mut is_empty = true;
        for cell in row.iter() {
            let text = cell_to_string(cell);
            if !text.trim().is_empty() {
                is_empty = false;
            }
            row_data.push(text);
        }
        if !is_empty {
            rows.push(row_data);
        }
    }

    Ok(rows)
}

fn write_csv(data: &[Vec<String>], path: &str) -> Result<(), String> {
    let mut wtr = csv::WriterBuilder::new().from_writer(vec![]);
    for row in data {
        wtr.write_record(row)
            .map_err(|e| format!("写入 CSV 记录失败: {}", e))?;
    }
    let inner = wtr
        .into_inner()
        .map_err(|e| format!("完成 CSV 写入失败: {}", e))?;

    // 添加 UTF-8 BOM
    let mut out_bytes = vec![0xEF, 0xBB, 0xBF];
    out_bytes.extend_from_slice(&inner);

    std::fs::write(path, out_bytes).map_err(|e| format!("保存 CSV 文件失败: {}", e))?;
    Ok(())
}

fn write_excel(data: &[Vec<String>], path: &str) -> Result<(), String> {
    let mut wb = Workbook::new();
    let sheet = wb.add_worksheet();

    for (r, row) in data.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            sheet
                .write_string(r as u32, c as u16, cell)
                .map_err(|e| format!("写入单元格失败: {}", e))?;
        }
    }

    wb.save(Path::new(path))
        .map_err(|e| format!("保存 Excel 文件失败: {}", e))?;
    Ok(())
}
