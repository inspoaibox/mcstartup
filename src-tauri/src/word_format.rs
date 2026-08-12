use ndarray::{Array2, ArrayViewD};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::TensorRef;
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};
use zip::write::FileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

const WORD_AI_MODEL_FILE: &str = "document-structure.onnx";
const WORD_AI_TOKENIZER_FILE: &str = "tokenizer.json";
const WORD_AI_MAX_LEN: usize = 128;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordFormatOptions {
    #[serde(default = "default_analysis_mode")]
    pub analysis_mode: String,
    #[serde(default = "default_font")]
    pub font_family: String,
    #[serde(default = "default_body_font_size")]
    pub body_font_size: u32,
    #[serde(default = "default_line_spacing")]
    pub line_spacing: f32,
    #[serde(default = "default_paragraph_spacing")]
    pub paragraph_spacing: u32,
    #[serde(default = "default_page_margin_cm")]
    pub page_margin_cm: f32,
    #[serde(default = "default_true")]
    pub clean_empty_paragraphs: bool,
    #[serde(default = "default_true")]
    pub normalize_spaces: bool,
    #[serde(default = "default_true")]
    pub detect_headings: bool,
    #[serde(default = "default_true")]
    pub standard_formatting: bool,
    #[serde(default = "default_true")]
    pub smart_heading_detection: bool,
    #[serde(default = "default_true")]
    pub optimize_structure: bool,
    #[serde(default = "default_false")]
    pub generate_toc: bool,
    #[serde(default = "default_true")]
    pub extract_keywords: bool,
    #[serde(default = "default_false")]
    pub generate_summary: bool,
    #[serde(default = "default_false")]
    pub include_keywords_in_document: bool,
}

impl Default for WordFormatOptions {
    fn default() -> Self {
        Self {
            analysis_mode: default_analysis_mode(),
            font_family: default_font(),
            body_font_size: default_body_font_size(),
            line_spacing: default_line_spacing(),
            paragraph_spacing: default_paragraph_spacing(),
            page_margin_cm: default_page_margin_cm(),
            clean_empty_paragraphs: true,
            normalize_spaces: true,
            detect_headings: true,
            standard_formatting: true,
            smart_heading_detection: true,
            optimize_structure: true,
            generate_toc: false,
            extract_keywords: true,
            generate_summary: false,
            include_keywords_in_document: false,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordFormatResult {
    pub output_path: String,
    pub paragraph_count: usize,
    pub heading_count: usize,
    pub removed_empty_paragraphs: usize,
    pub normalized_spacing_count: usize,
    pub keyword_count: usize,
    pub keywords: Vec<String>,
    pub summary: Vec<String>,
    pub outline: Vec<WordOutlineItem>,
    pub structure_counts: WordStructureCounts,
    pub ai_status: WordAiStatus,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordOutlineItem {
    pub level: u8,
    pub text: String,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordStructureCounts {
    pub heading: usize,
    pub body: usize,
    pub list: usize,
    pub note: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordAiStatus {
    pub model_ready: bool,
    pub mode: String,
    pub model_dir: String,
    pub message: String,
    pub required_files: Vec<String>,
    pub missing_files: Vec<String>,
    pub validation_error: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordSimilarityOptions {
    #[serde(default = "default_similarity_threshold")]
    pub threshold: f32,
    #[serde(default = "default_max_results")]
    pub max_results: usize,
}

impl Default for WordSimilarityOptions {
    fn default() -> Self {
        Self {
            threshold: default_similarity_threshold(),
            max_results: default_max_results(),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordParagraphRecord {
    pub id: usize,
    pub document_index: usize,
    pub document_name: String,
    pub paragraph_index: usize,
    pub text: String,
    pub char_count: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordSimilarityMatch {
    pub score: f32,
    pub left: WordParagraphRecord,
    pub right: WordParagraphRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordDuplicateResult {
    pub ai_status: WordAiStatus,
    pub document_count: usize,
    pub paragraph_count: usize,
    pub matches: Vec<WordSimilarityMatch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordCompareResult {
    pub ai_status: WordAiStatus,
    pub left_paragraph_count: usize,
    pub right_paragraph_count: usize,
    pub average_best_score: f32,
    pub coverage: f32,
    pub matches: Vec<WordSimilarityMatch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordSemanticSearchHit {
    pub score: f32,
    pub paragraph: WordParagraphRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordSemanticSearchResult {
    pub ai_status: WordAiStatus,
    pub document_count: usize,
    pub paragraph_count: usize,
    pub hits: Vec<WordSemanticSearchHit>,
}

#[derive(Default)]
struct FormatStats {
    paragraph_count: usize,
    heading_count: usize,
    removed_empty_paragraphs: usize,
    normalized_spacing_count: usize,
    structure_counts: WordStructureCounts,
}

#[derive(Default)]
struct DocumentAnalysis {
    outline: Vec<WordOutlineItem>,
    paragraphs: Vec<String>,
    body_paragraphs: Vec<String>,
}

#[derive(Clone)]
struct SemanticParagraph {
    record: WordParagraphRecord,
    embedding: Vec<f32>,
}

#[derive(Clone, Debug)]
enum ParagraphKind {
    Heading(u8),
    List,
    Note,
    Body,
    Empty,
}

struct XmlPatterns {
    body_open: Regex,
    paragraph: Regex,
    text: Regex,
    run: Regex,
    ppr_any: Regex,
    rpr_any: Regex,
    pg_mar: Regex,
    sect_pr: Regex,
    num_pr: Regex,
    tabs: Regex,
    jc: Regex,
    page_break_before: Regex,
    keep_lines: Regex,
    widow_control: Regex,
    heading_prefix: Regex,
    heading_decimal: Regex,
    heading_chinese: Regex,
    heading_parenthesized: Regex,
    list_marker: Regex,
    note_prefix: Regex,
}

struct WordAiClassifier {
    model_path: PathBuf,
    tokenizer_path: PathBuf,
    model_signature: FileSignature,
    tokenizer_signature: FileSignature,
    session: Session,
    tokenizer: Tokenizer,
    prototypes: Vec<(ParagraphKind, Vec<f32>)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileSignature {
    len: u64,
    modified_secs: u64,
    modified_nanos: u32,
}

static WORD_AI_CLASSIFIER: OnceLock<Mutex<Option<WordAiClassifier>>> = OnceLock::new();

impl XmlPatterns {
    fn new() -> Result<Self, String> {
        Ok(Self {
            body_open: Regex::new(r#"(?s)<w:body\b[^>]*>"#)
                .map_err(|e| format!("创建正文定位规则失败: {}", e))?,
            paragraph: Regex::new(r#"(?s)<w:p\b[^>]*>.*?</w:p>"#)
                .map_err(|e| format!("创建段落识别规则失败: {}", e))?,
            text: Regex::new(r#"(?s)<w:t\b[^>]*>(.*?)</w:t>"#)
                .map_err(|e| format!("创建文本识别规则失败: {}", e))?,
            run: Regex::new(r#"(?s)<w:r\b[^>]*>.*?</w:r>"#)
                .map_err(|e| format!("创建文本片段识别规则失败: {}", e))?,
            ppr_any: Regex::new(r#"(?s)<w:pPr\b[^>]*>.*?</w:pPr>"#)
                .map_err(|e| format!("创建段落属性规则失败: {}", e))?,
            rpr_any: Regex::new(r#"(?s)<w:rPr\b[^>]*>.*?</w:rPr>"#)
                .map_err(|e| format!("创建文字属性规则失败: {}", e))?,
            pg_mar: Regex::new(r#"(?s)<w:pgMar\b[^>]*/>"#)
                .map_err(|e| format!("创建页边距规则失败: {}", e))?,
            sect_pr: Regex::new(r#"(?s)<w:sectPr\b[^>]*>.*?</w:sectPr>"#)
                .map_err(|e| format!("创建分节规则失败: {}", e))?,
            num_pr: Regex::new(r#"(?s)<w:numPr\b[^>]*>.*?</w:numPr>"#)
                .map_err(|e| format!("创建编号保留规则失败: {}", e))?,
            tabs: Regex::new(r#"(?s)<w:tabs\b[^>]*>.*?</w:tabs>"#)
                .map_err(|e| format!("创建制表位保留规则失败: {}", e))?,
            jc: Regex::new(r#"(?s)<w:jc\b[^>]*/>"#)
                .map_err(|e| format!("创建对齐方式保留规则失败: {}", e))?,
            page_break_before: Regex::new(r#"(?s)<w:pageBreakBefore\b[^>]*/>"#)
                .map_err(|e| format!("创建分页保留规则失败: {}", e))?,
            keep_lines: Regex::new(r#"(?s)<w:keepLines\b[^>]*/>"#)
                .map_err(|e| format!("创建段内换页保留规则失败: {}", e))?,
            widow_control: Regex::new(r#"(?s)<w:widowControl\b[^>]*/>"#)
                .map_err(|e| format!("创建孤行控制保留规则失败: {}", e))?,
            heading_prefix: Regex::new(
                r"^((第[一二三四五六七八九十百千万0-9]+[章节篇])|([一二三四五六七八九十]+[、.．])|(\d+([.．]\d+){0,2}[、.．\s]))",
            )
            .map_err(|e| format!("创建标题识别规则失败: {}", e))?,
            heading_decimal: Regex::new(r"^\d+[.．]\d+")
                .map_err(|e| format!("创建数字标题规则失败: {}", e))?,
            heading_chinese: Regex::new(r"^[一二三四五六七八九十]+[、.．]")
                .map_err(|e| format!("创建中文标题规则失败: {}", e))?,
            heading_parenthesized: Regex::new(r"^[（(][一二三四五六七八九十0-9]+[）)]")
                .map_err(|e| format!("创建括号标题规则失败: {}", e))?,
            list_marker: Regex::new(r"^\s*([•·*]|[-–—]\s+|\d+[)）、]\s*|[（(]?\d+[）)]\s*|[a-zA-Z][)）.、]\s*)")
                .map_err(|e| format!("创建列表识别规则失败: {}", e))?,
            note_prefix: Regex::new(r"^\s*(说明|备注|注|提示|注意)[:：]")
                .map_err(|e| format!("创建说明段识别规则失败: {}", e))?,
        })
    }
}

#[tauri::command]
pub fn check_word_ai_runtime() -> Result<WordAiStatus, String> {
    Ok(word_ai_status())
}

#[tauri::command]
pub async fn word_format_document(
    input_path: String,
    output_path: String,
    options: Option<WordFormatOptions>,
) -> Result<WordFormatResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        format_docx_impl(&input_path, &output_path, options.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("Word 智能整理任务执行失败: {}", e))?
}

#[tauri::command]
pub async fn word_ai_duplicate_check(
    input_paths: Vec<String>,
    options: Option<WordSimilarityOptions>,
) -> Result<WordDuplicateResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        duplicate_check_impl(&input_paths, options.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("AI 文档查重任务执行失败: {}", e))?
}

#[tauri::command]
pub async fn word_ai_compare_documents(
    left_path: String,
    right_path: String,
    options: Option<WordSimilarityOptions>,
) -> Result<WordCompareResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        compare_documents_impl(&left_path, &right_path, options.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("AI 双文档语义对比任务执行失败: {}", e))?
}

#[tauri::command]
pub async fn word_ai_semantic_search(
    input_paths: Vec<String>,
    query: String,
    options: Option<WordSimilarityOptions>,
) -> Result<WordSemanticSearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        semantic_search_impl(&input_paths, &query, options.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("AI 本地文档语义搜索任务执行失败: {}", e))?
}

fn format_docx_impl(
    input_path: &str,
    output_path: &str,
    options: WordFormatOptions,
) -> Result<WordFormatResult, String> {
    let input = Path::new(input_path);
    if input
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| !ext.eq_ignore_ascii_case("docx"))
        .unwrap_or(true)
    {
        return Err("当前仅支持 .docx 文件，请先将 .doc 转换为 .docx".to_string());
    }
    ensure_output_not_input(input_path, output_path)?;

    let source =
        std::fs::File::open(input_path).map_err(|e| format!("打开 Word 文件失败: {}", e))?;
    let mut archive = ZipArchive::new(source).map_err(|e| format!("读取 docx 结构失败: {}", e))?;
    let mut entries = Vec::with_capacity(archive.len());
    let mut stats = FormatStats::default();
    let mut analysis = DocumentAnalysis::default();
    let patterns = XmlPatterns::new()?;
    let analysis_mode = normalize_analysis_mode(&options.analysis_mode);
    let ai_status = word_ai_status();
    if analysis_mode == "ai" && !ai_status.model_ready {
        let detail = ai_status
            .validation_error
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
            .unwrap_or_else(|| {
                if ai_status.missing_files.is_empty() {
                    "模型文件已找到，但未通过运行校验".to_string()
                } else {
                    format!(
                        "缺少 {}，模型目录：{}",
                        ai_status.missing_files.join(" / "),
                        ai_status.model_dir
                    )
                }
            });
        return Err(format!("AI 判断整理需要先准备可用的本地模型。{}", detail));
    }
    let mut has_document_xml = false;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("读取 docx 条目失败: {}", e))?;
        let name = file.name().to_string();
        let is_dir = file.is_dir();
        let compression = file.compression();
        let last_modified = file.last_modified();
        let unix_permissions = file.unix_mode();
        let mut data = Vec::new();
        if !is_dir {
            file.read_to_end(&mut data)
                .map_err(|e| format!("读取 docx 条目内容失败: {}", e))?;
        }

        if name == "word/document.xml" {
            has_document_xml = true;
            data = format_document_xml(
                &data,
                &options,
                &analysis_mode,
                &mut stats,
                &mut analysis,
                &patterns,
            )?;
        }

        entries.push(ZipEntry {
            name,
            data,
            is_dir,
            compression,
            last_modified,
            unix_permissions,
        });
    }

    if !has_document_xml {
        return Err("未找到 word/document.xml，文件可能不是有效 docx".to_string());
    }

    let output =
        std::fs::File::create(output_path).map_err(|e| format!("创建输出 Word 文件失败: {}", e))?;
    let mut writer = ZipWriter::new(output);
    for entry in entries {
        let mut file_options = FileOptions::default()
            .compression_method(entry.compression)
            .last_modified_time(entry.last_modified);
        if let Some(mode) = entry.unix_permissions {
            file_options = file_options.unix_permissions(mode);
        }

        if entry.is_dir {
            writer
                .add_directory(entry.name, file_options)
                .map_err(|e| format!("写入 docx 目录失败: {}", e))?;
        } else {
            writer
                .start_file(entry.name, file_options)
                .map_err(|e| format!("写入 docx 条目失败: {}", e))?;
            writer
                .write_all(&entry.data)
                .map_err(|e| format!("写入 docx 内容失败: {}", e))?;
        }
    }
    writer
        .finish()
        .map_err(|e| format!("保存 Word 文件失败: {}", e))?;

    let keywords = if options.extract_keywords {
        extract_keywords(&analysis.paragraphs, 12)
    } else {
        Vec::new()
    };
    let summary = if options.generate_summary {
        generate_summary(&analysis.body_paragraphs, 3)
    } else {
        Vec::new()
    };

    Ok(WordFormatResult {
        output_path: output_path.to_string(),
        paragraph_count: stats.paragraph_count,
        heading_count: stats.heading_count,
        removed_empty_paragraphs: stats.removed_empty_paragraphs,
        normalized_spacing_count: stats.normalized_spacing_count,
        keyword_count: keywords.len(),
        keywords,
        summary,
        outline: analysis.outline,
        structure_counts: stats.structure_counts,
        ai_status,
    })
}

fn duplicate_check_impl(
    input_paths: &[String],
    options: WordSimilarityOptions,
) -> Result<WordDuplicateResult, String> {
    ensure_word_ai_ready()?;
    if input_paths.len() < 1 {
        return Err("请至少选择一个 Word 文档".to_string());
    }
    let mut classifier_guard = load_word_ai_classifier()?;
    let classifier = classifier_guard
        .as_mut()
        .ok_or_else(|| "Word AI 模型会话未初始化".to_string())?;
    let paragraphs = embed_documents(input_paths, classifier)?;
    let mut matches = Vec::new();
    let threshold = options.threshold.clamp(0.1, 0.99);
    for left_index in 0..paragraphs.len() {
        for right_index in (left_index + 1)..paragraphs.len() {
            let left = &paragraphs[left_index];
            let right = &paragraphs[right_index];
            if left.record.document_index == right.record.document_index
                && left.record.paragraph_index == right.record.paragraph_index
            {
                continue;
            }
            let score = cosine_similarity(&left.embedding, &right.embedding);
            if score >= threshold {
                matches.push(WordSimilarityMatch {
                    score,
                    left: left.record.clone(),
                    right: right.record.clone(),
                });
            }
        }
    }
    sort_similarity_matches(&mut matches);
    matches.truncate(options.max_results.clamp(1, 500));

    Ok(WordDuplicateResult {
        ai_status: word_ai_status(),
        document_count: input_paths.len(),
        paragraph_count: paragraphs.len(),
        matches,
    })
}

fn compare_documents_impl(
    left_path: &str,
    right_path: &str,
    options: WordSimilarityOptions,
) -> Result<WordCompareResult, String> {
    ensure_word_ai_ready()?;
    let paths = vec![left_path.to_string(), right_path.to_string()];
    let mut classifier_guard = load_word_ai_classifier()?;
    let classifier = classifier_guard
        .as_mut()
        .ok_or_else(|| "Word AI 模型会话未初始化".to_string())?;
    let paragraphs = embed_documents(&paths, classifier)?;
    let left = paragraphs
        .iter()
        .filter(|item| item.record.document_index == 0)
        .collect::<Vec<_>>();
    let right = paragraphs
        .iter()
        .filter(|item| item.record.document_index == 1)
        .collect::<Vec<_>>();
    if left.is_empty() || right.is_empty() {
        return Err("两个文档都需要至少包含一个可分析段落".to_string());
    }

    let mut matches = Vec::new();
    let mut total_best = 0.0_f32;
    let mut covered = 0_usize;
    let threshold = options.threshold.clamp(0.1, 0.99);
    for left_item in &left {
        let mut best: Option<WordSimilarityMatch> = None;
        for right_item in &right {
            let score = cosine_similarity(&left_item.embedding, &right_item.embedding);
            if best
                .as_ref()
                .map(|entry| score > entry.score)
                .unwrap_or(true)
            {
                best = Some(WordSimilarityMatch {
                    score,
                    left: left_item.record.clone(),
                    right: right_item.record.clone(),
                });
            }
        }
        if let Some(best_match) = best {
            total_best += best_match.score;
            if best_match.score >= threshold {
                covered += 1;
                matches.push(best_match);
            }
        }
    }
    sort_similarity_matches(&mut matches);
    matches.truncate(options.max_results.clamp(1, 500));

    Ok(WordCompareResult {
        ai_status: word_ai_status(),
        left_paragraph_count: left.len(),
        right_paragraph_count: right.len(),
        average_best_score: round_score(total_best / left.len() as f32),
        coverage: round_score(covered as f32 / left.len() as f32),
        matches,
    })
}

fn semantic_search_impl(
    input_paths: &[String],
    query: &str,
    options: WordSimilarityOptions,
) -> Result<WordSemanticSearchResult, String> {
    ensure_word_ai_ready()?;
    let trimmed_query = query.trim();
    if trimmed_query.chars().count() < 2 {
        return Err("请输入至少 2 个字符的搜索内容".to_string());
    }
    if input_paths.is_empty() {
        return Err("请至少选择一个 Word 文档".to_string());
    }

    let mut classifier_guard = load_word_ai_classifier()?;
    let classifier = classifier_guard
        .as_mut()
        .ok_or_else(|| "Word AI 模型会话未初始化".to_string())?;
    let query_embedding = classifier.embed(trimmed_query)?;
    let paragraphs = embed_documents(input_paths, classifier)?;
    let mut hits = paragraphs
        .iter()
        .filter_map(|item| {
            let score = cosine_similarity(&query_embedding, &item.embedding);
            if score >= options.threshold.clamp(0.0, 0.99) {
                Some(WordSemanticSearchHit {
                    score,
                    paragraph: item.record.clone(),
                })
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.paragraph.document_name.cmp(&b.paragraph.document_name))
            .then_with(|| {
                a.paragraph
                    .paragraph_index
                    .cmp(&b.paragraph.paragraph_index)
            })
    });
    hits.truncate(options.max_results.clamp(1, 500));

    Ok(WordSemanticSearchResult {
        ai_status: word_ai_status(),
        document_count: input_paths.len(),
        paragraph_count: paragraphs.len(),
        hits,
    })
}

struct ZipEntry {
    name: String,
    data: Vec<u8>,
    is_dir: bool,
    compression: CompressionMethod,
    last_modified: DateTime,
    unix_permissions: Option<u32>,
}

fn format_document_xml(
    data: &[u8],
    options: &WordFormatOptions,
    analysis_mode: &str,
    stats: &mut FormatStats,
    analysis: &mut DocumentAnalysis,
    patterns: &XmlPatterns,
) -> Result<Vec<u8>, String> {
    let xml = String::from_utf8(data.to_vec())
        .map_err(|_| "Word 正文 XML 不是 UTF-8 编码，暂无法安全整理".to_string())?;
    let xml = update_page_margins(&xml, options, patterns);
    let mut classifier_guard = if analysis_mode == "ai" {
        Some(load_word_ai_classifier()?)
    } else {
        None
    };
    let classifier = classifier_guard
        .as_deref_mut()
        .and_then(|entry| entry.as_mut());
    let xml = process_paragraphs(
        &xml,
        options,
        analysis_mode,
        classifier,
        stats,
        analysis,
        patterns,
    )?;
    let keywords = if options.extract_keywords && options.include_keywords_in_document {
        extract_keywords(&analysis.paragraphs, 8)
    } else {
        Vec::new()
    };
    let xml = insert_generated_sections(&xml, options, &analysis.outline, &keywords, patterns);
    Ok(xml.into_bytes())
}

fn embed_documents(
    input_paths: &[String],
    classifier: &mut WordAiClassifier,
) -> Result<Vec<SemanticParagraph>, String> {
    let patterns = XmlPatterns::new()?;
    let mut out = Vec::new();
    let mut next_id = 0_usize;
    for (document_index, path) in input_paths.iter().enumerate() {
        let document_name = file_name_for_display(path);
        let paragraphs = extract_docx_paragraph_texts(path, &patterns)?;
        for (paragraph_index, text) in paragraphs.into_iter().enumerate() {
            let normalized = normalize_text(&text).trim().to_string();
            let char_count = normalized.chars().count();
            if !(8..=600).contains(&char_count) {
                continue;
            }
            let embedding = classifier.embed(&normalized).map_err(|e| {
                format!(
                    "分析 {} 第 {} 段失败: {}",
                    document_name,
                    paragraph_index + 1,
                    e
                )
            })?;
            out.push(SemanticParagraph {
                record: WordParagraphRecord {
                    id: next_id,
                    document_index,
                    document_name: document_name.clone(),
                    paragraph_index: paragraph_index + 1,
                    text: normalized,
                    char_count,
                },
                embedding,
            });
            next_id += 1;
        }
    }
    if out.is_empty() {
        return Err("未找到可分析的正文段落，请确认文档内容不是纯图片或空文档".to_string());
    }
    Ok(out)
}

fn extract_docx_paragraph_texts(path: &str, patterns: &XmlPatterns) -> Result<Vec<String>, String> {
    let input = Path::new(path);
    if input
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| !ext.eq_ignore_ascii_case("docx"))
        .unwrap_or(true)
    {
        return Err(format!("{} 不是 .docx 文件", file_name_for_display(path)));
    }
    let source = std::fs::File::open(input)
        .map_err(|e| format!("打开 {} 失败: {}", file_name_for_display(path), e))?;
    let mut archive = ZipArchive::new(source).map_err(|e| {
        format!(
            "读取 {} 的 docx 结构失败: {}",
            file_name_for_display(path),
            e
        )
    })?;
    let mut document_xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|e| {
            format!(
                "{} 未找到 word/document.xml: {}",
                file_name_for_display(path),
                e
            )
        })?
        .read_to_string(&mut document_xml)
        .map_err(|e| format!("读取 {} 正文 XML 失败: {}", file_name_for_display(path), e))?;

    let mut paragraphs = Vec::new();
    for paragraph in patterns.paragraph.find_iter(&document_xml) {
        let text = normalize_text(&collect_visible_text(paragraph.as_str(), patterns))
            .trim()
            .to_string();
        if !text.is_empty() {
            paragraphs.push(text);
        }
    }
    Ok(paragraphs)
}

fn ensure_word_ai_ready() -> Result<(), String> {
    let status = word_ai_status();
    if status.model_ready {
        return Ok(());
    }
    let detail = status
        .validation_error
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if status.missing_files.is_empty() {
                "模型文件已找到，但未通过运行校验".to_string()
            } else {
                format!(
                    "缺少 {}，模型目录：{}",
                    status.missing_files.join(" / "),
                    status.model_dir
                )
            }
        });
    Err(format!("请先准备可用的 AI 文档语义模型。{}", detail))
}

fn sort_similarity_matches(matches: &mut [WordSimilarityMatch]) {
    matches.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.left.document_name.cmp(&b.left.document_name))
            .then_with(|| a.left.paragraph_index.cmp(&b.left.paragraph_index))
            .then_with(|| a.right.document_name.cmp(&b.right.document_name))
            .then_with(|| a.right.paragraph_index.cmp(&b.right.paragraph_index))
    });
    for item in matches {
        item.score = round_score(item.score);
    }
}

fn round_score(value: f32) -> f32 {
    (value * 10000.0).round() / 10000.0
}

fn file_name_for_display(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn process_paragraphs(
    xml: &str,
    options: &WordFormatOptions,
    analysis_mode: &str,
    mut classifier: Option<&mut WordAiClassifier>,
    stats: &mut FormatStats,
    analysis: &mut DocumentAnalysis,
    patterns: &XmlPatterns,
) -> Result<String, String> {
    let mut out = String::with_capacity(xml.len() + 2048);
    let mut last = 0;

    for mat in patterns.paragraph.find_iter(xml) {
        out.push_str(&xml[last..mat.start()]);
        let paragraph = mat.as_str();
        let text = collect_visible_text(paragraph, patterns);
        let trimmed = text.trim().to_string();
        let inside_table = is_inside_tag(xml, mat.start(), "w:tbl");
        let mut kind = if analysis_mode == "ai" {
            let model = classifier
                .as_deref_mut()
                .ok_or_else(|| "AI 段落判断模型会话未初始化".to_string())?;
            classify_paragraph_with_ai(model, &trimmed, inside_table, options, patterns).map_err(
                |err| {
                    format!(
                        "AI 段落判断失败（{}）：{}",
                        preview_text_for_error(&trimmed),
                        err
                    )
                },
            )?
        } else {
            classify_paragraph(&trimmed, inside_table, options, patterns)
        };

        if options.clean_empty_paragraphs
            && matches!(kind, ParagraphKind::Empty)
            && !inside_table
            && paragraph_is_safe_to_remove(paragraph)
        {
            stats.removed_empty_paragraphs += 1;
            last = mat.end();
            continue;
        }

        stats.paragraph_count += 1;
        let mut next = paragraph.to_string();
        if options.normalize_spaces {
            let (normalized, changed) = normalize_paragraph_text(&next, patterns);
            if changed {
                stats.normalized_spacing_count += 1;
                next = normalized;
            }
        }

        if !trimmed.is_empty() {
            analysis.paragraphs.push(trimmed.clone());
        }

        match &kind {
            ParagraphKind::Heading(level) => {
                stats.heading_count += 1;
                stats.structure_counts.heading += 1;
                analysis.outline.push(WordOutlineItem {
                    level: *level,
                    text: trimmed.clone(),
                });
            }
            ParagraphKind::List => {
                stats.structure_counts.list += 1;
                analysis.body_paragraphs.push(trimmed.clone());
            }
            ParagraphKind::Note => {
                stats.structure_counts.note += 1;
                analysis.body_paragraphs.push(trimmed.clone());
            }
            ParagraphKind::Body => {
                stats.structure_counts.body += 1;
                analysis.body_paragraphs.push(trimmed.clone());
            }
            ParagraphKind::Empty => {}
        }

        if !options.standard_formatting && !options.optimize_structure {
            kind = ParagraphKind::Body;
        }
        if options.standard_formatting || options.optimize_structure {
            next = apply_paragraph_format(&next, options, &kind, patterns);
        }

        out.push_str(&next);
        last = mat.end();
    }

    out.push_str(&xml[last..]);
    Ok(out)
}

fn classify_paragraph(
    text: &str,
    inside_table: bool,
    options: &WordFormatOptions,
    patterns: &XmlPatterns,
) -> ParagraphKind {
    if text.is_empty() {
        return ParagraphKind::Empty;
    }
    if inside_table {
        return ParagraphKind::Body;
    }
    if options.optimize_structure && patterns.note_prefix.is_match(text) {
        return ParagraphKind::Note;
    }
    if heading_enabled(options) && is_heading_candidate(text, patterns) {
        return ParagraphKind::Heading(detect_heading_level(text, patterns));
    }
    if options.optimize_structure && patterns.list_marker.is_match(text) {
        return ParagraphKind::List;
    }
    ParagraphKind::Body
}

fn classify_paragraph_with_ai(
    classifier: &mut WordAiClassifier,
    text: &str,
    inside_table: bool,
    options: &WordFormatOptions,
    patterns: &XmlPatterns,
) -> Result<ParagraphKind, String> {
    if text.is_empty() {
        return Ok(ParagraphKind::Empty);
    }
    if inside_table {
        return Ok(ParagraphKind::Body);
    }

    let embedding = classifier.embed(text)?;
    let mut best: Option<(ParagraphKind, f32)> = None;
    for (kind, prototype) in &classifier.prototypes {
        let score = cosine_similarity(&embedding, prototype);
        if best
            .as_ref()
            .map(|(_, best_score)| score > *best_score)
            .unwrap_or(true)
        {
            best = Some((kind.clone(), score));
        }
    }

    let (kind, score) = best.unwrap_or((ParagraphKind::Body, 0.0));
    if score < 0.42 {
        return Ok(classify_paragraph(text, inside_table, options, patterns));
    }

    Ok(match kind {
        ParagraphKind::Heading(_) if heading_enabled(options) => {
            ParagraphKind::Heading(detect_heading_level(text, patterns))
        }
        ParagraphKind::List if options.optimize_structure => ParagraphKind::List,
        ParagraphKind::Note if options.optimize_structure => ParagraphKind::Note,
        ParagraphKind::Body => ParagraphKind::Body,
        _ => classify_paragraph(text, inside_table, options, patterns),
    })
}

fn heading_enabled(options: &WordFormatOptions) -> bool {
    options.detect_headings || options.smart_heading_detection
}

fn is_heading_candidate(text: &str, patterns: &XmlPatterns) -> bool {
    let char_count = text.chars().count();
    if char_count > 90 {
        return false;
    }

    let mut score = 0.0_f32;
    if patterns.heading_prefix.is_match(text) || patterns.heading_parenthesized.is_match(text) {
        score += 0.48;
    }
    if char_count <= 32 {
        score += 0.18;
    } else if char_count <= 48 {
        score += 0.08;
    } else {
        score -= 0.12;
    }
    if !ends_with_sentence_punctuation(text) {
        score += 0.16;
    }
    if !contains_sentence_punctuation(text) {
        score += 0.12;
    }
    if has_heading_keyword(text) {
        score += 0.12;
    }
    if text.contains("。") || text.contains("；") || text.contains(';') {
        score -= 0.18;
    }
    if char_count < 3 {
        score -= 0.2;
    }
    score >= 0.52
}

fn detect_heading_level(text: &str, patterns: &XmlPatterns) -> u8 {
    if text.starts_with('第') && (text.contains('章') || text.contains('篇')) {
        return 1;
    }
    if text.starts_with('第') && text.contains('节') {
        return 2;
    }
    if patterns.heading_decimal.is_match(text) {
        let number_part = text
            .chars()
            .take_while(|ch| ch.is_ascii_digit() || *ch == '.' || *ch == '．')
            .collect::<String>();
        return number_part
            .matches(['.', '．'])
            .count()
            .saturating_add(1)
            .min(3) as u8;
    }
    if patterns.heading_parenthesized.is_match(text) {
        return 3;
    }
    if patterns.heading_chinese.is_match(text) {
        return 2;
    }
    2
}

fn collect_visible_text(paragraph: &str, patterns: &XmlPatterns) -> String {
    let mut out = String::new();
    for captures in patterns.text.captures_iter(paragraph) {
        let raw = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
        out.push_str(&xml_unescape_text(raw));
    }
    out
}

fn paragraph_is_safe_to_remove(paragraph: &str) -> bool {
    ![
        "<w:sectPr",
        "<w:bookmark",
        "<w:proofErr",
        "<w:fldChar",
        "<w:instrText",
        "<w:drawing",
        "<w:pict",
        "<w:object",
        "<w:tbl",
        "<w:sdt",
        "<w:hyperlink",
    ]
    .iter()
    .any(|token| paragraph.contains(token))
}

fn normalize_paragraph_text(paragraph: &str, patterns: &XmlPatterns) -> (String, bool) {
    let mut changed = false;
    let normalized = patterns.text.replace_all(paragraph, |captures: &Captures| {
        let Some(full_match) = captures.get(0) else {
            return String::new();
        };
        let full = full_match.as_str();
        let Some(content) = captures.get(1) else {
            return full.to_string();
        };
        let next = normalize_text(content.as_str());
        if next == content.as_str() {
            full.to_string()
        } else {
            changed = true;
            let content_start = content.start() - full_match.start();
            let content_end = content.end() - full_match.start();
            let mut replacement = String::with_capacity(full.len());
            replacement.push_str(&full[..content_start]);
            replacement.push_str(&next);
            replacement.push_str(&full[content_end..]);
            replacement
        }
    });
    (normalized.into_owned(), changed)
}

fn normalize_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut last_space = false;
    for ch in value.chars() {
        let mapped = match ch {
            '\u{00a0}' | '\u{3000}' | '\t' => ' ',
            _ => ch,
        };
        if mapped == ' ' {
            if !last_space {
                out.push(' ');
                last_space = true;
            }
        } else {
            out.push(mapped);
            last_space = false;
        }
    }
    out
}

fn apply_paragraph_format(
    paragraph: &str,
    options: &WordFormatOptions,
    kind: &ParagraphKind,
    patterns: &XmlPatterns,
) -> String {
    let mut next = upsert_paragraph_properties(paragraph, options, kind, patterns);
    let font_size = match kind {
        ParagraphKind::Heading(1) => 32,
        ParagraphKind::Heading(2) => 28,
        ParagraphKind::Heading(_) => 24,
        _ => options.body_font_size.saturating_mul(2).clamp(2, 96),
    };
    let font = escape_xml_attr(&options.font_family);
    let bold = matches!(kind, ParagraphKind::Heading(_));

    next = patterns
        .run
        .replace_all(&next, |captures: &Captures| {
            let run = captures.get(0).map(|m| m.as_str()).unwrap_or_default();
            upsert_run_properties(run, &font, font_size, bold, patterns)
        })
        .into_owned();
    next
}

fn upsert_paragraph_properties(
    paragraph: &str,
    options: &WordFormatOptions,
    kind: &ParagraphKind,
    patterns: &XmlPatterns,
) -> String {
    let Some(open_end) = paragraph.find('>').map(|i| i + 1) else {
        return paragraph.to_string();
    };
    let rest = &paragraph[open_end..];
    let preserved = patterns
        .ppr_any
        .find(rest)
        .map(|m| preserve_paragraph_properties(m.as_str(), patterns))
        .unwrap_or_default();
    let rest_without_ppr = patterns.ppr_any.replacen(rest, 1, "");
    let new_ppr_inner = paragraph_properties_xml(options, kind);

    let mut out = String::with_capacity(paragraph.len() + new_ppr_inner.len() + preserved.len());
    out.push_str(&paragraph[..open_end]);
    out.push_str("<w:pPr>");
    out.push_str(&new_ppr_inner);
    out.push_str(&preserved);
    out.push_str("</w:pPr>");
    out.push_str(&rest_without_ppr);
    out
}

fn paragraph_properties_xml(options: &WordFormatOptions, kind: &ParagraphKind) -> String {
    let after = options.paragraph_spacing.saturating_mul(20).min(1440);
    let line = (options.line_spacing.clamp(1.0, 2.5) * 240.0)
        .round()
        .max(240.0) as u32;

    match kind {
        ParagraphKind::Heading(level) => {
            let outline = level.saturating_sub(1).min(8);
            format!(
                r#"<w:pStyle w:val="Heading{}"/><w:keepNext/><w:outlineLvl w:val="{}"/><w:spacing w:after="160" w:before="160" w:line="360" w:lineRule="auto"/>"#,
                level, outline
            )
        }
        ParagraphKind::List => format!(
            r#"<w:spacing w:after="{}" w:before="0" w:line="{}" w:lineRule="auto"/><w:ind w:left="420" w:hanging="240"/>"#,
            after / 2,
            line
        ),
        ParagraphKind::Note => format!(
            r#"<w:spacing w:after="{}" w:before="0" w:line="{}" w:lineRule="auto"/><w:ind w:left="420"/>"#,
            after / 2,
            line
        ),
        ParagraphKind::Body | ParagraphKind::Empty => format!(
            r#"<w:spacing w:after="{}" w:before="0" w:line="{}" w:lineRule="auto"/><w:ind w:firstLine="420"/>"#,
            after, line
        ),
    }
}

fn preserve_paragraph_properties(existing_ppr: &str, patterns: &XmlPatterns) -> String {
    let Some(inner_start) = existing_ppr.find('>').map(|i| i + 1) else {
        return String::new();
    };
    let Some(inner_end) = existing_ppr.rfind("</w:pPr>") else {
        return String::new();
    };
    let inner = &existing_ppr[inner_start..inner_end];
    let mut preserved = String::new();
    push_first_match(&mut preserved, &patterns.page_break_before, inner);
    push_first_match(&mut preserved, &patterns.keep_lines, inner);
    push_first_match(&mut preserved, &patterns.widow_control, inner);
    push_first_match(&mut preserved, &patterns.num_pr, inner);
    push_first_match(&mut preserved, &patterns.tabs, inner);
    push_first_match(&mut preserved, &patterns.jc, inner);
    push_first_match(&mut preserved, &patterns.sect_pr, inner);
    preserved
}

fn push_first_match(out: &mut String, pattern: &Regex, value: &str) {
    if let Some(found) = pattern.find(value) {
        out.push_str(found.as_str());
    }
}

fn upsert_run_properties(
    run: &str,
    font: &str,
    font_size_half_points: u32,
    bold: bool,
    patterns: &XmlPatterns,
) -> String {
    let Some(open_end) = run.find('>').map(|i| i + 1) else {
        return run.to_string();
    };
    let rest = &run[open_end..];
    let rest_without_rpr = patterns.rpr_any.replacen(rest, 1, "");
    let new_rpr_inner = run_properties_xml(font, font_size_half_points, bold);

    let mut out = String::with_capacity(run.len() + new_rpr_inner.len() + 16);
    out.push_str(&run[..open_end]);
    out.push_str("<w:rPr>");
    out.push_str(&new_rpr_inner);
    out.push_str("</w:rPr>");
    out.push_str(&rest_without_rpr);
    out
}

fn run_properties_xml(font: &str, font_size_half_points: u32, bold: bool) -> String {
    let mut out = format!(
        r#"<w:rFonts w:ascii="{}" w:hAnsi="{}" w:eastAsia="{}" w:cs="{}"/>"#,
        font, font, font, font
    );
    if bold {
        out.push_str("<w:b/><w:bCs/>");
    }
    out.push_str(&format!(
        r#"<w:sz w:val="{}"/><w:szCs w:val="{}"/>"#,
        font_size_half_points, font_size_half_points
    ));
    out
}

fn update_page_margins(xml: &str, options: &WordFormatOptions, patterns: &XmlPatterns) -> String {
    if !options.standard_formatting {
        return xml.to_string();
    }

    let margin = cm_to_twips(options.page_margin_cm);
    if patterns.pg_mar.is_match(xml) {
        return patterns
            .pg_mar
            .replace(xml, |captures: &Captures| {
                let tag = captures.get(0).map(|m| m.as_str()).unwrap_or_default();
                set_margin_attrs(tag, margin)
            })
            .into_owned();
    }

    patterns
        .sect_pr
        .replace(xml, |captures: &Captures| {
            let sect = captures.get(0).map(|m| m.as_str()).unwrap_or_default();
            if let Some(end) = sect.rfind("</w:sectPr>") {
                let mut out = String::with_capacity(sect.len() + 96);
                out.push_str(&sect[..end]);
                out.push_str(&format!(
                    r#"<w:pgMar w:top="{0}" w:right="{0}" w:bottom="{0}" w:left="{0}"/>"#,
                    margin
                ));
                out.push_str(&sect[end..]);
                out
            } else {
                sect.to_string()
            }
        })
        .into_owned()
}

fn insert_generated_sections(
    xml: &str,
    options: &WordFormatOptions,
    outline: &[WordOutlineItem],
    keywords: &[String],
    patterns: &XmlPatterns,
) -> String {
    if (!options.generate_toc || outline.is_empty()) && keywords.is_empty() {
        return xml.to_string();
    }

    let mut section_xml = String::new();
    if options.generate_toc && !outline.is_empty() {
        section_xml.push_str(&generated_paragraph(
            "静态目录",
            "TOCHeading",
            28,
            true,
            0,
            &options.font_family,
        ));
        for item in outline.iter().take(60) {
            let indent = u32::from(item.level.saturating_sub(1)) * 420;
            let prefix = "  ".repeat(item.level.saturating_sub(1) as usize);
            section_xml.push_str(&generated_paragraph(
                &format!("{}{}", prefix, item.text),
                "",
                22,
                false,
                indent,
                &options.font_family,
            ));
        }
        section_xml.push_str(&generated_paragraph(
            "",
            "",
            22,
            false,
            0,
            &options.font_family,
        ));
    }

    if !keywords.is_empty() {
        section_xml.push_str(&generated_paragraph(
            &format!("关键词：{}", keywords.join("、")),
            "",
            options.body_font_size.saturating_mul(2).clamp(2, 96),
            false,
            0,
            &options.font_family,
        ));
    }

    if let Some(body) = patterns.body_open.find(xml) {
        let mut out = String::with_capacity(xml.len() + section_xml.len());
        out.push_str(&xml[..body.end()]);
        out.push_str(&section_xml);
        out.push_str(&xml[body.end()..]);
        out
    } else {
        xml.to_string()
    }
}

fn generated_paragraph(
    text: &str,
    style: &str,
    size: u32,
    bold: bool,
    left_indent: u32,
    font_family: &str,
) -> String {
    let escaped = escape_xml_text(text);
    let font = escape_xml_attr(font_family);
    let style_xml = if style.is_empty() {
        String::new()
    } else {
        format!(r#"<w:pStyle w:val="{}"/>"#, escape_xml_attr(style))
    };
    let indent_xml = if left_indent > 0 {
        format!(r#"<w:ind w:left="{}"/>"#, left_indent)
    } else {
        String::new()
    };
    let bold_xml = if bold { "<w:b/><w:bCs/>" } else { "" };
    format!(
        r#"<w:p><w:pPr>{}<w:spacing w:after="120" w:before="0" w:line="300" w:lineRule="auto"/>{}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="{}" w:hAnsi="{}" w:eastAsia="{}" w:cs="{}"/>{}<w:sz w:val="{}"/><w:szCs w:val="{}"/></w:rPr><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
        style_xml, indent_xml, font, font, font, font, bold_xml, size, size, escaped
    )
}

fn extract_keywords(paragraphs: &[String], limit: usize) -> Vec<String> {
    let mut scores: HashMap<String, f32> = HashMap::new();
    for text in paragraphs {
        for candidate in keyword_candidates(text) {
            if is_stopword(&candidate) {
                continue;
            }
            let len_score = candidate.chars().count().min(8) as f32;
            *scores.entry(candidate).or_insert(0.0) += len_score.max(2.0);
        }
    }

    let mut items = scores.into_iter().collect::<Vec<_>>();
    items.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(&b.0))
    });
    items
        .into_iter()
        .filter_map(|(word, _)| {
            if word.chars().count() >= 2 {
                Some(word)
            } else {
                None
            }
        })
        .take(limit)
        .collect()
}

fn keyword_candidates(text: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let mut current = String::new();
    let mut current_is_ascii = false;

    for ch in text.chars() {
        let is_word = ch.is_ascii_alphanumeric() || is_cjk(ch);
        if !is_word {
            push_keyword_candidate(&mut candidates, &mut current);
            current_is_ascii = false;
            continue;
        }
        let is_ascii = ch.is_ascii_alphanumeric();
        if !current.is_empty() && current_is_ascii != is_ascii {
            push_keyword_candidate(&mut candidates, &mut current);
        }
        current_is_ascii = is_ascii;
        current.push(ch);
    }
    push_keyword_candidate(&mut candidates, &mut current);
    candidates
}

fn push_keyword_candidate(candidates: &mut Vec<String>, current: &mut String) {
    let value = current
        .trim_matches(|ch: char| ch.is_ascii_punctuation() || ch.is_whitespace())
        .to_string();
    current.clear();
    let len = value.chars().count();
    if (2..=12).contains(&len) && !is_stopword(&value) {
        candidates.push(value);
    } else if len > 12 && value.chars().any(is_cjk) {
        let chars = value.chars().collect::<Vec<_>>();
        for window in chars.windows(4).take(12) {
            let phrase = window.iter().collect::<String>();
            if !is_stopword(&phrase) {
                candidates.push(phrase);
            }
        }
    }
}

fn generate_summary(paragraphs: &[String], limit: usize) -> Vec<String> {
    let mut selected = Vec::new();
    for text in paragraphs {
        let len = text.chars().count();
        if !(24..=180).contains(&len) {
            continue;
        }
        if selected.iter().any(|item: &String| item == text) {
            continue;
        }
        selected.push(text.clone());
        if selected.len() >= limit {
            break;
        }
    }
    selected
}

fn word_ai_status() -> WordAiStatus {
    let model_dir = word_ai_model_dir();
    let _ = std::fs::create_dir_all(&model_dir);
    let required_files = vec![
        WORD_AI_MODEL_FILE.to_string(),
        WORD_AI_TOKENIZER_FILE.to_string(),
    ];
    let missing_files = required_files
        .iter()
        .filter(|file| !model_dir.join(file).is_file())
        .cloned()
        .collect::<Vec<_>>();
    let files_ready = missing_files.is_empty();
    let validation_error = if files_ready {
        validate_word_ai_classifier().err()
    } else {
        None
    };
    let model_ready = files_ready && validation_error.is_none();
    WordAiStatus {
        model_ready,
        mode: if model_ready {
            "onnx".to_string()
        } else if files_ready {
            "invalid".to_string()
        } else {
            "missing".to_string()
        },
        model_dir: model_dir.to_string_lossy().to_string(),
        message: if model_ready {
            "本地轻量模型已通过加载和推理校验。AI 只负责段落类型识别，Word 写入仍由安全规则层执行。"
                .to_string()
        } else if validation_error.is_some() {
            "已检测到模型文件，但加载或推理校验失败。请确认模型与 tokenizer 匹配，或重新下载。"
                .to_string()
        } else {
            "未检测到 MiniLM/TinyBERT ONNX 模型。规则模式可直接使用，AI 判断整理需要先准备模型。"
                .to_string()
        },
        required_files,
        missing_files,
        validation_error,
    }
}

fn validate_word_ai_classifier() -> Result<(), String> {
    let guard = load_word_ai_classifier()?;
    let classifier = guard
        .as_ref()
        .ok_or_else(|| "Word AI 模型会话初始化失败".to_string())?;
    if classifier.prototypes.is_empty() {
        return Err("Word AI 段落原型向量为空".to_string());
    }
    Ok(())
}

fn file_signature(path: &Path) -> std::io::Result<FileSignature> {
    let metadata = std::fs::metadata(path)?;
    let modified = metadata
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    Ok(FileSignature {
        len: metadata.len(),
        modified_secs: modified.as_secs(),
        modified_nanos: modified.subsec_nanos(),
    })
}

fn load_word_ai_classifier(
) -> Result<std::sync::MutexGuard<'static, Option<WordAiClassifier>>, String> {
    let model_dir = word_ai_model_dir();
    let model_path = model_dir.join(WORD_AI_MODEL_FILE);
    let tokenizer_path = model_dir.join(WORD_AI_TOKENIZER_FILE);
    if !model_path.is_file() || !tokenizer_path.is_file() {
        return Err(format!(
            "AI 判断模型未准备完整，请确认 {} 和 {} 都在 {}",
            WORD_AI_MODEL_FILE,
            WORD_AI_TOKENIZER_FILE,
            model_dir.display()
        ));
    }
    let model_signature =
        file_signature(&model_path).map_err(|e| format!("读取 Word AI 模型文件信息失败: {}", e))?;
    let tokenizer_signature = file_signature(&tokenizer_path)
        .map_err(|e| format!("读取 Word AI tokenizer 文件信息失败: {}", e))?;

    let cache = WORD_AI_CLASSIFIER.get_or_init(|| Mutex::new(None));
    let mut guard = cache
        .lock()
        .map_err(|_| "Word AI 模型会话锁定失败".to_string())?;
    let needs_reload = guard
        .as_ref()
        .map(|entry| {
            entry.model_path != model_path
                || entry.tokenizer_path != tokenizer_path
                || entry.model_signature != model_signature
                || entry.tokenizer_signature != tokenizer_signature
        })
        .unwrap_or(true);

    if needs_reload {
        let thread_count = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .min(8);
        let session = Session::builder()
            .map_err(|e| format!("创建 Word AI ONNX 会话失败: {}", e))?
            .with_optimization_level(GraphOptimizationLevel::Level1)
            .map_err(|e| format!("设置 Word AI ONNX 优化级别失败: {}", e))?
            .with_intra_threads(thread_count)
            .map_err(|e| format!("设置 Word AI ONNX 线程数失败: {}", e))?
            .commit_from_file(&model_path)
            .map_err(|e| format!("加载 Word AI 模型失败: {}", e))?;
        let mut tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("加载 Word AI tokenizer 失败: {}", e))?;
        let _ = tokenizer.with_padding(Some(PaddingParams {
            strategy: tokenizers::PaddingStrategy::Fixed(WORD_AI_MAX_LEN),
            ..Default::default()
        }));
        let _ = tokenizer.with_truncation(Some(TruncationParams {
            max_length: WORD_AI_MAX_LEN,
            ..Default::default()
        }));

        let mut classifier = WordAiClassifier {
            model_path: model_path.clone(),
            tokenizer_path: tokenizer_path.clone(),
            model_signature,
            tokenizer_signature,
            session,
            tokenizer,
            prototypes: Vec::new(),
        };
        classifier.prototypes = classifier.build_prototypes()?;
        *guard = Some(classifier);
    }

    Ok(guard)
}

impl WordAiClassifier {
    fn build_prototypes(&mut self) -> Result<Vec<(ParagraphKind, Vec<f32>)>, String> {
        let samples = [
            (
                ParagraphKind::Heading(1),
                [
                    "第一章 用户管理系统设计",
                    "项目背景与建设目标",
                    "系统总体方案",
                    "风险控制措施",
                ],
            ),
            (
                ParagraphKind::List,
                [
                    "1. 完成用户权限配置",
                    "（1）整理基础数据",
                    "- 检查系统运行状态",
                    "a) 输出处理结果",
                ],
            ),
            (
                ParagraphKind::Note,
                [
                    "说明：以下数据仅用于内部评估",
                    "备注：请在上线前完成复核",
                    "提示：保存前请检查目录结构",
                    "注意：该步骤需要管理员权限",
                ],
            ),
            (
                ParagraphKind::Body,
                [
                    "系统用于处理订单数据并生成管理报表。",
                    "用户可以在后台完成数据查询、编辑和导出操作。",
                    "该方案通过本地规则完成格式整理，并保留原始文档结构。",
                    "处理完成后会输出新的 Word 文件，原文件不会被覆盖。",
                ],
            ),
        ];

        let mut prototypes = Vec::new();
        for (kind, texts) in samples {
            let mut vectors = Vec::new();
            for text in texts {
                vectors.push(self.embed(text)?);
            }
            prototypes.push((kind, average_vectors(&vectors)));
        }
        Ok(prototypes)
    }

    fn embed(&mut self, text: &str) -> Result<Vec<f32>, String> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| format!("Word AI 文本编码失败: {}", e))?;
        let mut input_ids = encoding
            .get_ids()
            .iter()
            .map(|value| i64::from(*value))
            .collect::<Vec<_>>();
        let mut attention_mask = encoding
            .get_attention_mask()
            .iter()
            .map(|value| i64::from(*value))
            .collect::<Vec<_>>();
        input_ids.resize(WORD_AI_MAX_LEN, 0);
        attention_mask.resize(WORD_AI_MAX_LEN, 0);
        input_ids.truncate(WORD_AI_MAX_LEN);
        attention_mask.truncate(WORD_AI_MAX_LEN);

        let token_type_ids = vec![0_i64; WORD_AI_MAX_LEN];
        let input_ids = Array2::from_shape_vec((1, WORD_AI_MAX_LEN), input_ids)
            .map_err(|e| format!("构建 input_ids 失败: {}", e))?;
        let attention_mask = Array2::from_shape_vec((1, WORD_AI_MAX_LEN), attention_mask)
            .map_err(|e| format!("构建 attention_mask 失败: {}", e))?;
        let token_type_ids = Array2::from_shape_vec((1, WORD_AI_MAX_LEN), token_type_ids)
            .map_err(|e| format!("构建 token_type_ids 失败: {}", e))?;

        let outputs = self
            .session
            .run(ort::inputs! {
                "input_ids" => TensorRef::from_array_view(input_ids.view())
                    .map_err(|e| format!("创建 input_ids 张量失败: {}", e))?,
                "attention_mask" => TensorRef::from_array_view(attention_mask.view())
                    .map_err(|e| format!("创建 attention_mask 张量失败: {}", e))?,
                "token_type_ids" => TensorRef::from_array_view(token_type_ids.view())
                    .map_err(|e| format!("创建 token_type_ids 张量失败: {}", e))?
            })
            .map_err(|e| format!("Word AI 模型推理失败: {}", e))?;

        if outputs.len() == 0 {
            return Err("Word AI 模型没有返回输出".to_string());
        }
        let output = outputs[0]
            .try_extract_array::<f32>()
            .map_err(|e| format!("读取 Word AI 模型输出失败: {}", e))?;
        mean_pool(output, attention_mask.view())
    }
}

fn mean_pool(
    output: ArrayViewD<'_, f32>,
    attention_mask: ndarray::ArrayView2<'_, i64>,
) -> Result<Vec<f32>, String> {
    let dims = output.shape();
    if dims.len() != 3 {
        return Err(format!("Word AI 输出维度异常: {:?}", dims));
    }
    let seq_len = dims[1].min(WORD_AI_MAX_LEN);
    let hidden = dims[2];
    let mut vector = vec![0.0_f32; hidden];
    let mut count = 0.0_f32;
    for token in 0..seq_len {
        if attention_mask[[0, token]] == 0 {
            continue;
        }
        count += 1.0;
        for dim in 0..hidden {
            vector[dim] += output[[0, token, dim]];
        }
    }
    if count <= 0.0 {
        return Ok(vector);
    }
    for value in &mut vector {
        *value /= count;
    }
    Ok(normalize_vector(vector))
}

fn average_vectors(vectors: &[Vec<f32>]) -> Vec<f32> {
    if vectors.is_empty() {
        return Vec::new();
    }
    let len = vectors[0].len();
    let mut out = vec![0.0_f32; len];
    for vector in vectors {
        for (index, value) in vector.iter().take(len).enumerate() {
            out[index] += *value;
        }
    }
    for value in &mut out {
        *value /= vectors.len() as f32;
    }
    normalize_vector(out)
}

fn normalize_vector(mut vector: Vec<f32>) -> Vec<f32> {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in &mut vector {
            *value /= norm;
        }
    }
    vector
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    a.iter().zip(b).map(|(left, right)| left * right).sum()
}

fn normalize_analysis_mode(value: &str) -> &str {
    if value.eq_ignore_ascii_case("ai") {
        "ai"
    } else {
        "rules"
    }
}

fn preview_text_for_error(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "空段落".to_string();
    }
    let mut preview = trimmed.chars().take(24).collect::<String>();
    if trimmed.chars().count() > 24 {
        preview.push_str("...");
    }
    preview
}

fn word_ai_model_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("McStartUP")
        .join("models")
        .join("word-organizer")
}

fn is_inside_tag(xml: &str, position: usize, tag: &str) -> bool {
    let before = &xml[..position.min(xml.len())];
    let open = before.rfind(&format!("<{}", tag));
    let close = before.rfind(&format!("</{}>", tag));
    matches!((open, close), (Some(open_pos), Some(close_pos)) if open_pos > close_pos)
        || matches!((open, close), (Some(_), None))
}

fn has_heading_keyword(text: &str) -> bool {
    [
        "概述", "背景", "目标", "方案", "设计", "流程", "职责", "计划", "总结", "结论", "目录",
        "范围", "需求", "问题", "风险", "管理", "系统",
    ]
    .iter()
    .any(|word| text.contains(word))
}

fn contains_sentence_punctuation(text: &str) -> bool {
    text.contains('。')
        || text.contains('，')
        || text.contains('；')
        || text.contains(',')
        || text.contains(';')
}

fn ends_with_sentence_punctuation(text: &str) -> bool {
    text.ends_with('。')
        || text.ends_with('；')
        || text.ends_with(';')
        || text.ends_with('！')
        || text.ends_with('？')
        || text.ends_with('!')
        || text.ends_with('?')
}

fn is_cjk(ch: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&ch)
}

fn is_stopword(value: &str) -> bool {
    matches!(
        value,
        "以及"
            | "或者"
            | "如果"
            | "因为"
            | "所以"
            | "进行"
            | "通过"
            | "当前"
            | "相关"
            | "可以"
            | "需要"
            | "主要"
            | "包括"
            | "一个"
            | "我们"
            | "你们"
            | "他们"
            | "the"
            | "and"
            | "for"
            | "with"
            | "this"
            | "that"
    )
}

fn set_margin_attrs(tag: &str, margin: u32) -> String {
    let mut next = tag.to_string();
    for attr in ["w:top", "w:right", "w:bottom", "w:left"] {
        next = set_or_insert_attr(&next, attr, &margin.to_string());
    }
    next
}

fn set_or_insert_attr(tag: &str, attr: &str, value: &str) -> String {
    let escaped_value = escape_xml_attr(value);
    let attr_re = match Regex::new(&format!(r#"\s{}="[^"]*""#, regex::escape(attr))) {
        Ok(re) => re,
        Err(_) => return tag.to_string(),
    };
    if attr_re.is_match(tag) {
        attr_re
            .replace(tag, format!(r#" {}="{}""#, attr, escaped_value))
            .into_owned()
    } else if let Some(pos) = tag.rfind("/>") {
        let mut out = String::with_capacity(tag.len() + attr.len() + escaped_value.len() + 5);
        out.push_str(&tag[..pos]);
        out.push_str(&format!(r#" {}="{}""#, attr, escaped_value));
        out.push_str(&tag[pos..]);
        out
    } else {
        tag.to_string()
    }
}

fn xml_unescape_text(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_xml_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn cm_to_twips(cm: f32) -> u32 {
    (cm.clamp(0.5, 6.0) * 567.0).round() as u32
}

fn ensure_output_not_input(input_path: &str, output_path: &str) -> Result<(), String> {
    let input_abs = PathBuf::from(input_path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(input_path));
    let output_abs = if Path::new(output_path).exists() {
        PathBuf::from(output_path)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(output_path))
    } else {
        PathBuf::from(output_path)
    };
    if input_abs == output_abs {
        return Err("输出文件不能覆盖原 Word 文档，请选择不同路径".to_string());
    }
    Ok(())
}

fn default_font() -> String {
    "Microsoft YaHei".to_string()
}

fn default_analysis_mode() -> String {
    "rules".to_string()
}

fn default_similarity_threshold() -> f32 {
    0.78
}

fn default_max_results() -> usize {
    80
}

fn default_body_font_size() -> u32 {
    11
}

fn default_line_spacing() -> f32 {
    1.5
}

fn default_paragraph_spacing() -> u32 {
    6
}

fn default_page_margin_cm() -> f32 {
    2.54
}

fn default_true() -> bool {
    true
}

fn default_false() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn organizes_document_xml_without_touching_root() {
        let patterns = XmlPatterns::new().unwrap();
        let mut stats = FormatStats::default();
        let mut analysis = DocumentAnalysis::default();
        let options = WordFormatOptions {
            generate_toc: true,
            include_keywords_in_document: true,
            analysis_mode: "rules".to_string(),
            ..WordFormatOptions::default()
        };
        let input = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一章  用户管理系统</w:t></w:r></w:p><w:p><w:r><w:t>系统用于处理订单数据并生成管理报表。</w:t></w:r></w:p><w:p><w:r><w:t></w:t></w:r></w:p><w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#;
        let output = format_document_xml(
            input.as_bytes(),
            &options,
            "rules",
            &mut stats,
            &mut analysis,
            &patterns,
        )
        .unwrap();
        let text = String::from_utf8(output).unwrap();
        assert!(text.starts_with("<?xml version"));
        assert!(text.contains(r#"<w:pStyle w:val="Heading1"/>"#));
        assert!(text.contains("静态目录"));
        assert!(text.contains("关键词"));
        assert_eq!(stats.heading_count, 1);
        assert_eq!(stats.removed_empty_paragraphs, 1);
    }
}
