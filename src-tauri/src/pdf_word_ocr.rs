use crate::ocr::{BoundingBox, TextBlock};
use base64::{engine::general_purpose, Engine as _};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipWriter};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOcrWordPage {
    pub page_number: u32,
    pub image_base64: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOcrWordRequest {
    pub pages: Vec<PdfOcrWordPage>,
    pub output_path: String,
    pub title: Option<String>,
    pub include_page_headings: Option<bool>,
    pub detect_tables: Option<bool>,
    pub include_page_images: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOcrWordPageResult {
    pub page_number: u32,
    pub line_count: usize,
    pub table_count: usize,
    pub image_count: usize,
    pub text_preview: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOcrWordResult {
    pub output_path: String,
    pub page_count: usize,
    pub paragraph_count: usize,
    pub table_count: usize,
    pub image_count: usize,
    pub recognized_pages: Vec<PdfOcrWordPageResult>,
}

#[derive(Debug)]
struct DocPage {
    page_number: u32,
    image_base64: String,
    width: f64,
    height: f64,
    items: Vec<DocItem>,
}

#[derive(Debug)]
enum DocItem {
    Paragraph(ParagraphBlock),
    Table(TableBlock),
}

#[derive(Debug, Clone)]
struct ParagraphBlock {
    text: String,
    indent_twips: i32,
    before_twips: i32,
    style: ParagraphStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParagraphStyle {
    Body,
    Heading,
}

#[derive(Debug, Clone)]
struct TableBlock {
    rows: Vec<Vec<String>>,
    column_widths: Vec<i32>,
}

#[derive(Debug, Clone)]
struct LayoutCell {
    text: String,
    location: BoundingBox,
}

#[derive(Debug, Clone)]
struct LayoutRow {
    top: i32,
    height: i32,
    cells: Vec<LayoutCell>,
}

#[tauri::command]
pub fn doc_pdf_ocr_to_word(request: PdfOcrWordRequest) -> Result<PdfOcrWordResult, String> {
    if request.pages.is_empty() {
        return Err("请先选择至少一页 PDF 内容。".to_string());
    }

    let output_path = PathBuf::from(request.output_path.trim());
    validate_docx_output_path(&output_path)?;
    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| format!("创建输出目录失败: {}", error))?;
        }
    }

    let title = normalize_title(request.title.as_deref());
    let include_page_headings = request.include_page_headings.unwrap_or(true);
    let detect_tables = request.detect_tables.unwrap_or(true);
    let include_page_images = request.include_page_images.unwrap_or(false);
    let mut doc_pages = Vec::with_capacity(request.pages.len());
    let mut recognized_pages = Vec::with_capacity(request.pages.len());
    let mut paragraph_count = 0usize;
    let mut table_count = 0usize;

    for page in request.pages {
        let ocr_result = crate::paddle_ocr::recognize(page.image_base64.trim())
            .map_err(|error| format!("第 {} 页 OCR 失败: {}", page.page_number, error))?;
        let (items, line_count, page_table_count, preview) =
            build_doc_items(ocr_result.text, ocr_result.text_blocks, detect_tables);
        paragraph_count += line_count;
        table_count += page_table_count;
        recognized_pages.push(PdfOcrWordPageResult {
            page_number: page.page_number,
            line_count,
            table_count: page_table_count,
            image_count: usize::from(include_page_images && !page.image_base64.trim().is_empty()),
            text_preview: preview,
        });
        doc_pages.push(DocPage {
            page_number: page.page_number,
            image_base64: page.image_base64,
            width: page.width.unwrap_or(0.0),
            height: page.height.unwrap_or(0.0),
            items,
        });
    }

    write_ocr_docx(
        &output_path,
        &title,
        include_page_headings,
        include_page_images,
        &doc_pages,
    )?;

    let image_count = if include_page_images {
        doc_pages
            .iter()
            .filter(|page| !page.image_base64.trim().is_empty())
            .count()
    } else {
        0
    };

    Ok(PdfOcrWordResult {
        output_path: output_path.to_string_lossy().to_string(),
        page_count: doc_pages.len(),
        paragraph_count,
        table_count,
        image_count,
        recognized_pages,
    })
}

fn validate_docx_output_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("请选择 Word 输出路径。".to_string());
    }
    let is_docx = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("docx"))
        .unwrap_or(false);
    if !is_docx {
        return Err("输出文件必须是 .docx 格式。".to_string());
    }
    Ok(())
}

fn normalize_title(title: Option<&str>) -> String {
    let title = title.unwrap_or("PDF OCR 转 Word").trim();
    if title.is_empty() {
        "PDF OCR 转 Word".to_string()
    } else {
        title
            .trim_end_matches(".pdf")
            .trim_end_matches(".PDF")
            .to_string()
    }
}

fn build_doc_items(
    text: String,
    text_blocks: Option<Vec<TextBlock>>,
    detect_tables: bool,
) -> (Vec<DocItem>, usize, usize, String) {
    let mut blocks = text_blocks.unwrap_or_default();
    blocks.retain(|block| !block.text.trim().is_empty());

    if blocks.is_empty() {
        let lines = text.lines().filter_map(clean_ocr_line).collect::<Vec<_>>();
        let preview = preview_text(&lines.join(" "), 120);
        let items = lines
            .into_iter()
            .map(|line| {
                DocItem::Paragraph(ParagraphBlock {
                    text: line,
                    indent_twips: 0,
                    before_twips: 0,
                    style: ParagraphStyle::Body,
                })
            })
            .collect::<Vec<_>>();
        let line_count = items.len();
        return (items, line_count, 0, preview);
    }

    let rows = group_text_blocks_into_rows(blocks);
    let mut items = Vec::new();
    let mut table_count = 0usize;
    let mut line_count = 0usize;
    let mut preview_parts = Vec::new();
    let mut index = 0usize;

    while index < rows.len() {
        if detect_tables && is_table_candidate_row(&rows[index]) {
            let start = index;
            while index < rows.len() && is_table_candidate_row(&rows[index]) {
                index += 1;
            }
            let group = &rows[start..index];
            if is_table_group(group) {
                let table = table_from_rows(group);
                line_count += table.rows.iter().map(Vec::len).sum::<usize>();
                table_count += 1;
                preview_parts.push(
                    table
                        .rows
                        .iter()
                        .flat_map(|row| row.iter())
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" "),
                );
                items.push(DocItem::Table(table));
                continue;
            }

            for row in group {
                if let Some(paragraph) = paragraph_from_row(row, None) {
                    line_count += 1;
                    preview_parts.push(paragraph.text.clone());
                    items.push(DocItem::Paragraph(paragraph));
                }
            }
            continue;
        }

        let previous = if index > 0 { rows.get(index - 1) } else { None };
        if let Some(paragraph) = paragraph_from_row(&rows[index], previous) {
            line_count += 1;
            preview_parts.push(paragraph.text.clone());
            items.push(DocItem::Paragraph(paragraph));
        }
        index += 1;
    }

    let preview = preview_text(&preview_parts.join(" "), 120);
    (items, line_count, table_count, preview)
}

fn group_text_blocks_into_rows(mut blocks: Vec<TextBlock>) -> Vec<LayoutRow> {
    blocks.sort_by(|left, right| {
        left.location
            .top
            .cmp(&right.location.top)
            .then_with(|| left.location.left.cmp(&right.location.left))
    });

    let mut rows: Vec<LayoutRow> = Vec::new();
    for block in blocks {
        let Some(text) = clean_ocr_line(&block.text) else {
            continue;
        };
        let cell = LayoutCell {
            text,
            location: block.location,
        };
        let center_y = cell.location.top + cell.location.height.max(1) / 2;
        if let Some(row) = rows.last_mut() {
            let row_center = row.top + row.height.max(1) / 2;
            let threshold = row_threshold(row.height, cell.location.height);
            if (center_y - row_center).abs() <= threshold {
                row.top = row.top.min(cell.location.top);
                let bottom = (row.top + row.height).max(cell.location.top + cell.location.height);
                row.height = bottom.saturating_sub(row.top);
                row.cells.push(cell);
                continue;
            }
        }
        rows.push(LayoutRow {
            top: cell.location.top,
            height: cell.location.height,
            cells: vec![cell],
        });
    }

    for row in &mut rows {
        row.cells.sort_by(|left, right| {
            left.location
                .left
                .cmp(&right.location.left)
                .then_with(|| right.location.width.cmp(&left.location.width))
        });
    }
    rows
}

fn row_threshold(left_height: i32, right_height: i32) -> i32 {
    let base = left_height.max(right_height).max(12);
    (base as f64 * 0.65).round() as i32
}

fn is_table_candidate_row(row: &LayoutRow) -> bool {
    row.cells.len() >= 2
}

fn is_table_group(rows: &[LayoutRow]) -> bool {
    if rows.is_empty() {
        return false;
    }
    if rows.iter().any(|row| row.cells.len() >= 3) && rows.len() >= 2 {
        return true;
    }
    if rows.len() < 3 {
        return false;
    }

    let column_counts = rows.iter().map(|row| row.cells.len()).collect::<Vec<_>>();
    let most_common = column_counts
        .iter()
        .copied()
        .fold(std::collections::HashMap::new(), |mut counts, value| {
            *counts.entry(value).or_insert(0usize) += 1;
            counts
        })
        .into_values()
        .max()
        .unwrap_or(0);
    most_common >= 2
}

fn table_from_rows(rows: &[LayoutRow]) -> TableBlock {
    let anchors = table_column_anchors(rows);
    let column_count = anchors.len().max(1);
    let mut table_rows = Vec::with_capacity(rows.len());
    for row in rows {
        let mut values = vec![String::new(); column_count];
        for cell in &row.cells {
            let column = nearest_column_index(cell_center_x(cell), &anchors);
            if !values[column].is_empty() {
                values[column].push(' ');
            }
            values[column].push_str(&cell.text);
        }
        table_rows.push(values);
    }

    TableBlock {
        rows: table_rows,
        column_widths: table_column_widths(&anchors),
    }
}

fn table_column_anchors(rows: &[LayoutRow]) -> Vec<i32> {
    let mut centers = rows
        .iter()
        .flat_map(|row| row.cells.iter().map(cell_center_x))
        .collect::<Vec<_>>();
    centers.sort_unstable();

    let mut anchors: Vec<i32> = Vec::new();
    for center in centers {
        if let Some(last) = anchors.last_mut() {
            if (center - *last).abs() <= 28 {
                *last = (*last + center) / 2;
                continue;
            }
        }
        anchors.push(center);
    }
    anchors
}

fn table_column_widths(anchors: &[i32]) -> Vec<i32> {
    if anchors.is_empty() {
        return vec![8640];
    }
    let min_width = 720;
    let available = 8640;
    if anchors.len() == 1 {
        return vec![available];
    }

    let mut spans = Vec::with_capacity(anchors.len());
    for (index, anchor) in anchors.iter().enumerate() {
        let left = if index == 0 {
            *anchor
        } else {
            (*anchor - anchors[index - 1]).max(1)
        };
        let right = if index + 1 == anchors.len() {
            left
        } else {
            (anchors[index + 1] - *anchor).max(1)
        };
        spans.push(((left + right) / 2).max(1));
    }
    let total = spans.iter().sum::<i32>().max(1);
    let mut widths = spans
        .into_iter()
        .map(|span| ((span as f64 / total as f64) * available as f64).round() as i32)
        .map(|width| width.max(min_width))
        .collect::<Vec<_>>();
    let sum = widths.iter().sum::<i32>();
    if sum > available {
        for width in &mut widths {
            *width = ((*width as f64 / sum as f64) * available as f64).round() as i32;
            *width = (*width).max(min_width);
        }
    }
    widths
}

fn nearest_column_index(center: i32, anchors: &[i32]) -> usize {
    anchors
        .iter()
        .enumerate()
        .min_by_key(|(_, anchor)| (center - **anchor).abs())
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn cell_center_x(cell: &LayoutCell) -> i32 {
    cell.location.left + cell.location.width.max(1) / 2
}

fn paragraph_from_row(row: &LayoutRow, previous: Option<&LayoutRow>) -> Option<ParagraphBlock> {
    let text = row_text(row);
    if text.is_empty() {
        return None;
    }

    let left = row
        .cells
        .first()
        .map(|cell| cell.location.left)
        .unwrap_or(0);
    let indent_twips = ((left.max(0) as f64 / 1024.0) * 900.0).round() as i32;
    let before_twips = previous
        .map(|prev| {
            let prev_bottom = prev.top + prev.height;
            let gap = (row.top - prev_bottom).max(0);
            if gap > row.height.max(12) {
                120
            } else {
                0
            }
        })
        .unwrap_or(0);
    let style = if looks_like_heading(row, &text) {
        ParagraphStyle::Heading
    } else {
        ParagraphStyle::Body
    };

    Some(ParagraphBlock {
        text,
        indent_twips,
        before_twips,
        style,
    })
}

fn looks_like_heading(row: &LayoutRow, text: &str) -> bool {
    if text.chars().count() > 42 || row.cells.len() > 2 {
        return false;
    }
    let height = row.height;
    let left = row
        .cells
        .first()
        .map(|cell| cell.location.left)
        .unwrap_or(0);
    let right = row
        .cells
        .last()
        .map(|cell| cell.location.left + cell.location.width)
        .unwrap_or(left);
    let center = (left + right) / 2;
    height >= 26 || (center > 360 && center < 760 && text.chars().count() <= 28)
}

fn row_text(row: &LayoutRow) -> String {
    row.cells
        .iter()
        .map(|cell| cell.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn clean_ocr_line(text: &str) -> Option<String> {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        None
    } else {
        Some(line)
    }
}

fn preview_text(text: &str, max_chars: usize) -> String {
    let mut preview = String::new();
    for ch in text.chars().take(max_chars) {
        preview.push(ch);
    }
    if text.chars().count() > max_chars {
        preview.push_str("...");
    }
    preview
}

fn write_ocr_docx(
    path: &Path,
    title: &str,
    include_page_headings: bool,
    include_page_images: bool,
    pages: &[DocPage],
) -> Result<(), String> {
    let file = File::create(path).map_err(|error| format!("创建 Word 文件失败: {}", error))?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);

    write_zip_file(
        &mut zip,
        "[Content_Types].xml",
        content_types_xml(),
        options,
    )?;
    write_zip_file(&mut zip, "_rels/.rels", package_rels_xml(), options)?;
    write_zip_file(
        &mut zip,
        "word/document.xml",
        document_xml(include_page_headings, include_page_images, pages),
        options,
    )?;
    write_zip_file(&mut zip, "word/styles.xml", styles_xml(), options)?;
    write_zip_file(&mut zip, "word/settings.xml", settings_xml(), options)?;
    write_zip_file(
        &mut zip,
        "word/_rels/document.xml.rels",
        document_rels_xml(include_page_images, pages),
        options,
    )?;
    write_zip_file(
        &mut zip,
        "docProps/core.xml",
        core_props_xml(title),
        options,
    )?;
    write_zip_file(&mut zip, "docProps/app.xml", app_props_xml(), options)?;

    if include_page_images {
        for (index, page) in pages.iter().enumerate() {
            if page.image_base64.trim().is_empty() {
                continue;
            }
            let image_data = general_purpose::STANDARD
                .decode(page.image_base64.trim())
                .map_err(|error| format!("第 {} 页图像解码失败: {}", page.page_number, error))?;
            write_zip_bytes(
                &mut zip,
                &format!("word/media/page_{}.png", index + 1),
                &image_data,
                options,
            )?;
        }
    }

    zip.finish()
        .map_err(|error| format!("保存 Word 文件失败: {}", error))?;
    Ok(())
}

fn write_zip_file(
    zip: &mut ZipWriter<File>,
    name: &str,
    content: String,
    options: FileOptions,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|error| format!("写入 Word 条目失败: {}", error))?;
    zip.write_all(content.as_bytes())
        .map_err(|error| format!("写入 Word 内容失败: {}", error))
}

fn write_zip_bytes(
    zip: &mut ZipWriter<File>,
    name: &str,
    content: &[u8],
    options: FileOptions,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|error| format!("写入 Word 图像条目失败: {}", error))?;
    zip.write_all(content)
        .map_err(|error| format!("写入 Word 图像失败: {}", error))
}

fn content_types_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"#
        .to_string()
}

fn package_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"#
        .to_string()
}

fn document_rels_xml(include_page_images: bool, pages: &[DocPage]) -> String {
    let mut relationships = String::from(
        r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>"#,
    );

    if include_page_images {
        for (index, page) in pages.iter().enumerate() {
            if page.image_base64.trim().is_empty() {
                continue;
            }
            relationships.push_str(&format!(
                r#"
  <Relationship Id="{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page_{}.png"/>"#,
                image_rel_id(index + 1),
                index + 1
            ));
        }
    }

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {}
</Relationships>"#,
        relationships
    )
}

fn settings_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="420"/>
</w:settings>"#
        .to_string()
}

fn app_props_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>McStartUP</Application>
</Properties>"#
        .to_string()
}

fn core_props_xml(title: &str) -> String {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{}</dc:title>
  <dc:creator>McStartUP</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">{}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{}</dcterms:modified>
</cp:coreProperties>"#,
        escape_xml(title),
        now,
        now
    )
}

fn document_xml(
    include_page_headings: bool,
    include_page_images: bool,
    pages: &[DocPage],
) -> String {
    let mut body = String::new();
    for (index, page) in pages.iter().enumerate() {
        if include_page_headings {
            body.push_str(&page_heading_xml(&format!("第 {} 页", page.page_number)));
        }
        if include_page_images && !page.image_base64.trim().is_empty() {
            body.push_str(&image_paragraph_xml(
                &image_rel_id(index + 1),
                page.width,
                page.height,
                &format!("PDF 第 {} 页图像", page.page_number),
            ));
        }
        if page.items.is_empty() {
            body.push_str(&paragraph_xml(&ParagraphBlock {
                text: "（未识别到文字）".to_string(),
                indent_twips: 0,
                before_twips: 0,
                style: ParagraphStyle::Body,
            }));
        } else {
            for item in &page.items {
                match item {
                    DocItem::Paragraph(paragraph) => body.push_str(&paragraph_xml(paragraph)),
                    DocItem::Table(table) => body.push_str(&table_xml(table)),
                }
            }
        }
        if index + 1 < pages.len() {
            body.push_str(r#"<w:p><w:r><w:br w:type="page"/></w:r></w:p>"#);
        }
    }

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    {}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1260" w:bottom="1440" w:left="1260" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"#,
        body
    )
}

fn page_heading_xml(text: &str) -> String {
    paragraph_xml(&ParagraphBlock {
        text: text.to_string(),
        indent_twips: 0,
        before_twips: 0,
        style: ParagraphStyle::Heading,
    })
}

fn paragraph_xml(paragraph: &ParagraphBlock) -> String {
    let style_xml = if paragraph.style == ParagraphStyle::Heading {
        r#"<w:pStyle w:val="Heading1"/>"#
    } else {
        ""
    };
    let indent_xml = if paragraph.indent_twips > 0 {
        format!(r#"<w:ind w:left="{}"/>"#, paragraph.indent_twips.min(2880))
    } else {
        String::new()
    };
    let spacing_xml = if paragraph.before_twips > 0 {
        format!(
            r#"<w:spacing w:before="{}" w:after="120"/>"#,
            paragraph.before_twips
        )
    } else {
        r#"<w:spacing w:after="120"/>"#.to_string()
    };
    format!(
        r#"<w:p><w:pPr>{}{}{}</w:pPr><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
        style_xml,
        indent_xml,
        spacing_xml,
        escape_xml(&paragraph.text)
    )
}

fn table_xml(table: &TableBlock) -> String {
    let column_count = table.rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
    let fallback_width = (8640 / column_count as i32).max(720);
    let mut xml = String::from(
        r#"<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/></w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>"#,
    );
    xml.push_str("<w:tblGrid>");
    for column in 0..column_count {
        let width = table
            .column_widths
            .get(column)
            .copied()
            .unwrap_or(fallback_width);
        xml.push_str(&format!(r#"<w:gridCol w:w="{}"/>"#, width));
    }
    xml.push_str("</w:tblGrid>");

    for row in &table.rows {
        xml.push_str("<w:tr>");
        for column in 0..column_count {
            let text = row.get(column).map(String::as_str).unwrap_or("");
            let width = table
                .column_widths
                .get(column)
                .copied()
                .unwrap_or(fallback_width);
            xml.push_str(&format!(
                r#"<w:tc><w:tcPr><w:tcW w:w="{}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p></w:tc>"#,
                width,
                escape_xml(text)
            ));
        }
        xml.push_str("</w:tr>");
    }
    xml.push_str("</w:tbl>");
    xml
}

fn image_paragraph_xml(rel_id: &str, width: f64, height: f64, description: &str) -> String {
    let (cx, cy) = image_size_emu(width, height);
    format!(
        r#"<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="{name}" descr="{name}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#,
        cx = cx,
        cy = cy,
        name = escape_xml(description),
        rel_id = rel_id
    )
}

fn image_size_emu(width: f64, height: f64) -> (i64, i64) {
    const EMU_PER_INCH: f64 = 914_400.0;
    const PX_PER_INCH: f64 = 96.0;
    const MAX_WIDTH_EMU: f64 = 6.5 * EMU_PER_INCH;

    let width = if width.is_finite() && width > 0.0 {
        width
    } else {
        1000.0
    };
    let height = if height.is_finite() && height > 0.0 {
        height
    } else {
        1400.0
    };
    let mut cx = width / PX_PER_INCH * EMU_PER_INCH;
    let mut cy = height / PX_PER_INCH * EMU_PER_INCH;
    if cx > MAX_WIDTH_EMU {
        let ratio = MAX_WIDTH_EMU / cx;
        cx *= ratio;
        cy *= ratio;
    }
    (cx.round() as i64, cy.round() as i64)
}

fn image_rel_id(index: usize) -> String {
    format!("rIdImage{}", index)
}

fn styles_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:line="360" w:lineRule="auto" w:after="120"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="240" w:after="120"/>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>
      <w:b/>
      <w:color w:val="0F766E"/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
</w:styles>"#
        .to_string()
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
