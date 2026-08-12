use crate::network_tools;
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Instant;
use trust_dns_resolver::Resolver;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCheckResult {
    pub input: String,
    pub normalized_url: String,
    pub host: String,
    pub scheme: String,
    pub status: Option<u16>,
    pub status_text: String,
    pub final_url: String,
    pub response_time_ms: u128,
    pub body_size: usize,
    pub page_title: Option<String>,
    pub description: Option<String>,
    pub canonical: Option<String>,
    pub server: Option<String>,
    pub powered_by: Option<String>,
    pub ip_addresses: Vec<String>,
    pub dns: Vec<WebCheckDnsGroup>,
    pub redirects: Vec<WebCheckRedirect>,
    pub headers: Vec<WebCheckHeader>,
    pub cookies: Vec<WebCheckCookie>,
    pub security_headers: Vec<WebCheckSecurityHeader>,
    pub open_ports: Vec<WebCheckPort>,
    pub links: WebCheckLinks,
    pub technologies: Vec<WebCheckTechnology>,
    pub robots_txt: WebCheckProbe,
    pub sitemap: WebCheckProbe,
    pub score: u8,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCheckDnsGroup {
    pub record_type: String,
    pub values: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCheckRedirect {
    pub from: String,
    pub to: String,
    pub status: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCheckHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCheckCookie {
    pub name: String,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCheckSecurityHeader {
    pub name: String,
    pub present: bool,
    pub value: Option<String>,
    pub severity: String,
    pub note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCheckPort {
    pub port: u16,
    pub service: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCheckLinks {
    pub total: usize,
    pub internal: usize,
    pub external: usize,
    pub samples: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCheckTechnology {
    pub name: String,
    pub evidence: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCheckProbe {
    pub url: String,
    pub status: Option<u16>,
    pub exists: bool,
    pub size: usize,
}

#[derive(Debug)]
struct FetchOutcome {
    status: Option<u16>,
    status_text: String,
    final_url: String,
    response_time_ms: u128,
    headers: Vec<WebCheckHeader>,
    cookies: Vec<WebCheckCookie>,
    redirects: Vec<WebCheckRedirect>,
    body: String,
    body_size: usize,
}

#[derive(Debug)]
struct NormalizedTarget {
    normalized_url: String,
    host: String,
    scheme: String,
    origin: String,
}

pub async fn web_check_scan(input: String, scan_ports: bool) -> Result<WebCheckResult, String> {
    let target = normalize_target(&input)?;
    let (fetch_result, dns_result, robots_result, sitemap_result, ports_result) = tokio::join!(
        fetch_site(&target),
        resolve_dns(&target.host),
        probe_url(format!("{}/robots.txt", target.origin)),
        probe_url(format!("{}/sitemap.xml", target.origin)),
        scan_common_ports(target.host.clone(), scan_ports),
    );

    let fetch = fetch_result?;
    let dns = dns_result.unwrap_or_default();
    let robots_txt = robots_result.unwrap_or(WebCheckProbe {
        url: format!("{}/robots.txt", target.origin),
        status: None,
        exists: false,
        size: 0,
    });
    let sitemap = sitemap_result.unwrap_or(WebCheckProbe {
        url: format!("{}/sitemap.xml", target.origin),
        status: None,
        exists: false,
        size: 0,
    });
    let open_ports = ports_result.unwrap_or_default();

    let header_map = headers_to_map(&fetch.headers);
    let page_title = extract_title(&fetch.body);
    let description = extract_meta_content(&fetch.body, "description");
    let canonical = extract_canonical(&fetch.body);
    let links = analyze_links(&fetch.body, &target.host);
    let technologies = detect_technologies(&fetch.body, &header_map, &fetch.cookies);
    let security_headers = analyze_security_headers(&header_map);
    let ip_addresses = resolve_ips(&target.host);
    let warnings = build_warnings(&fetch, &security_headers, &robots_txt, &sitemap);
    let score = calculate_score(
        &fetch,
        &security_headers,
        &warnings,
        target.scheme == "https",
    );

    Ok(WebCheckResult {
        input,
        normalized_url: target.normalized_url,
        host: target.host,
        scheme: target.scheme,
        status: fetch.status,
        status_text: fetch.status_text,
        final_url: fetch.final_url,
        response_time_ms: fetch.response_time_ms,
        body_size: fetch.body_size,
        page_title,
        description,
        canonical,
        server: header_map.get("server").cloned(),
        powered_by: header_map.get("x-powered-by").cloned(),
        ip_addresses,
        dns,
        redirects: fetch.redirects,
        headers: fetch.headers,
        cookies: fetch.cookies,
        security_headers,
        open_ports,
        links,
        technologies,
        robots_txt,
        sitemap,
        score,
        warnings,
    })
}

fn normalize_target(input: &str) -> Result<NormalizedTarget, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("请输入需要检测的网站 URL".to_string());
    }
    let normalized_url = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    };
    let url = reqwest::Url::parse(&normalized_url).map_err(|e| format!("URL 格式无效: {}", e))?;
    let host = url
        .host_str()
        .ok_or_else(|| "URL 中没有可检测的主机名".to_string())?
        .to_string();
    let scheme = url.scheme().to_string();
    let origin = format!("{}://{}", scheme, host_with_port(&url));
    Ok(NormalizedTarget {
        normalized_url,
        host,
        scheme,
        origin,
    })
}

fn host_with_port(url: &reqwest::Url) -> String {
    match (url.host_str(), url.port()) {
        (Some(host), Some(port)) => format!("{}:{}", host, port),
        (Some(host), None) => host.to_string(),
        _ => String::new(),
    }
}

async fn fetch_site(target: &NormalizedTarget) -> Result<FetchOutcome, String> {
    let client = reqwest::Client::builder()
        .user_agent("McStartUP-WebCheck/1.0")
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut current = target.normalized_url.clone();
    let mut redirects = Vec::new();
    let start = Instant::now();
    let mut status = None;
    let mut status_text = String::new();
    let mut headers = Vec::new();
    let mut cookies = Vec::new();
    let mut body = String::new();

    for _ in 0..8 {
        let response = client
            .get(&current)
            .send()
            .await
            .map_err(|e| format!("请求网站失败: {}", e))?;
        let code = response.status();
        status = Some(code.as_u16());
        status_text = code.canonical_reason().unwrap_or("").to_string();
        headers = collect_headers(response.headers());
        cookies = collect_cookies(response.headers());

        if code.is_redirection() {
            if let Some(location) = response.headers().get(reqwest::header::LOCATION) {
                let location = location.to_str().unwrap_or_default();
                let base = reqwest::Url::parse(&current).map_err(|e| e.to_string())?;
                let next = base
                    .join(location)
                    .map_err(|e| format!("解析重定向地址失败: {}", e))?
                    .to_string();
                redirects.push(WebCheckRedirect {
                    from: current,
                    to: next.clone(),
                    status: code.as_u16(),
                });
                current = next;
                continue;
            }
        }

        body = response.text().await.unwrap_or_default();
        break;
    }

    let body_size = body.as_bytes().len();
    Ok(FetchOutcome {
        status,
        status_text,
        final_url: current,
        response_time_ms: start.elapsed().as_millis(),
        headers,
        cookies,
        redirects,
        body,
        body_size,
    })
}

fn collect_headers(headers: &reqwest::header::HeaderMap) -> Vec<WebCheckHeader> {
    headers
        .iter()
        .map(|(name, value)| WebCheckHeader {
            name: name.as_str().to_string(),
            value: value.to_str().unwrap_or("<binary>").to_string(),
        })
        .collect()
}

fn collect_cookies(headers: &reqwest::header::HeaderMap) -> Vec<WebCheckCookie> {
    headers
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(parse_cookie)
        .collect()
}

fn parse_cookie(raw: &str) -> Option<WebCheckCookie> {
    let mut parts = raw.split(';').map(str::trim);
    let first = parts.next()?;
    let name = first.split_once('=').map(|(name, _)| name)?.trim();
    if name.is_empty() {
        return None;
    }
    let attrs = parts
        .map(|item| item.to_ascii_lowercase())
        .collect::<Vec<_>>();
    Some(WebCheckCookie {
        name: name.to_string(),
        secure: attrs.iter().any(|item| item == "secure"),
        http_only: attrs.iter().any(|item| item == "httponly"),
        same_site: attrs.iter().find_map(|item| {
            item.strip_prefix("samesite=")
                .map(|value| value.to_string())
        }),
    })
}

async fn resolve_dns(host: &str) -> Result<Vec<WebCheckDnsGroup>, String> {
    let host = host.to_string();
    tokio::task::spawn_blocking(move || {
        let resolver =
            Resolver::from_system_conf().map_err(|e| format!("创建 DNS 解析器失败: {}", e))?;
        let mut groups = Vec::new();
        if let Ok(lookup) = resolver.lookup_ip(host.as_str()) {
            groups.push(WebCheckDnsGroup {
                record_type: "A/AAAA".to_string(),
                values: lookup.iter().map(|ip| ip.to_string()).collect(),
            });
        }
        if let Ok(mx) = resolver.mx_lookup(host.as_str()) {
            groups.push(WebCheckDnsGroup {
                record_type: "MX".to_string(),
                values: mx
                    .iter()
                    .map(|record| format!("{} {}", record.preference(), record.exchange()))
                    .collect(),
            });
        }
        if let Ok(txt) = resolver.txt_lookup(host.as_str()) {
            groups.push(WebCheckDnsGroup {
                record_type: "TXT".to_string(),
                values: txt
                    .iter()
                    .flat_map(|record| record.txt_data().iter())
                    .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
                    .collect(),
            });
        }
        Ok(groups)
    })
    .await
    .map_err(|e| format!("DNS 查询失败: {}", e))?
}

async fn probe_url(url: String) -> Result<WebCheckProbe, String> {
    let client = reqwest::Client::builder()
        .user_agent("McStartUP-WebCheck/1.0")
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    Ok(WebCheckProbe {
        url,
        status: Some(status),
        exists: (200..400).contains(&status),
        size: text.as_bytes().len(),
    })
}

async fn scan_common_ports(host: String, enabled: bool) -> Result<Vec<WebCheckPort>, String> {
    if !enabled {
        return Ok(Vec::new());
    }
    let ports = [
        21u16, 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 5432, 6379, 8080, 8443,
    ];
    let mut rows = Vec::new();
    for port in ports {
        if let Ok(result) = network_tools::scan_port(host.clone(), port, 900).await {
            if result.open {
                rows.push(WebCheckPort {
                    port,
                    service: result.service,
                });
            }
        }
    }
    Ok(rows)
}

fn headers_to_map(headers: &[WebCheckHeader]) -> BTreeMap<String, String> {
    headers
        .iter()
        .map(|header| (header.name.to_ascii_lowercase(), header.value.clone()))
        .collect()
}

fn extract_title(html: &str) -> Option<String> {
    Regex::new(r"(?is)<title[^>]*>(.*?)</title>")
        .ok()?
        .captures(html)
        .and_then(|cap| cap.get(1))
        .map(|item| clean_html_text(item.as_str()))
}

fn extract_meta_content(html: &str, name: &str) -> Option<String> {
    let pattern = format!(
        r#"(?is)<meta[^>]+(?:name|property)=["']{}["'][^>]+content=["']([^"']*)["'][^>]*>"#,
        regex::escape(name)
    );
    Regex::new(&pattern)
        .ok()?
        .captures(html)
        .and_then(|cap| cap.get(1))
        .map(|item| clean_html_text(item.as_str()))
}

fn extract_canonical(html: &str) -> Option<String> {
    Regex::new(
        r#"(?is)<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>"#,
    )
    .ok()?
    .captures(html)
    .and_then(|cap| cap.get(1))
    .map(|item| item.as_str().trim().to_string())
}

fn clean_html_text(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .trim()
        .to_string()
}

fn analyze_links(html: &str, host: &str) -> WebCheckLinks {
    let Ok(re) = Regex::new(r#"(?is)<a[^>]+href=["']([^"']+)["']"#) else {
        return WebCheckLinks::default();
    };
    let mut samples = Vec::new();
    let mut total = 0usize;
    let mut internal = 0usize;
    let mut external = 0usize;
    for cap in re.captures_iter(html).take(500) {
        let Some(href) = cap.get(1).map(|m| m.as_str().trim()) else {
            continue;
        };
        if href.is_empty() || href.starts_with('#') || href.starts_with("javascript:") {
            continue;
        }
        total += 1;
        if href.starts_with('/') || href.contains(host) {
            internal += 1;
        } else if href.starts_with("http://") || href.starts_with("https://") {
            external += 1;
        }
        if samples.len() < 12 {
            samples.push(href.to_string());
        }
    }
    WebCheckLinks {
        total,
        internal,
        external,
        samples,
    }
}

fn detect_technologies(
    html: &str,
    headers: &BTreeMap<String, String>,
    cookies: &[WebCheckCookie],
) -> Vec<WebCheckTechnology> {
    let mut found = BTreeMap::<String, String>::new();
    let lower = html.to_ascii_lowercase();
    let checks = [
        ("Next.js", "__next"),
        ("Nuxt", "__nuxt"),
        ("React", "reactroot"),
        ("Vue", "data-v-"),
        ("Angular", "ng-version"),
        ("WordPress", "wp-content"),
        ("Shopify", "cdn.shopify.com"),
        ("Cloudflare", "cloudflare"),
        ("Google Analytics", "googletagmanager.com"),
        ("Vite", "/@vite/client"),
        ("Svelte", "svelte"),
        ("Tailwind CSS", "tailwind"),
    ];
    for (name, needle) in checks {
        if lower.contains(needle) {
            found.insert(name.to_string(), format!("页面包含 {}", needle));
        }
    }
    if let Some(server) = headers.get("server") {
        found.insert(server.clone(), "Server Header".to_string());
    }
    if let Some(powered_by) = headers.get("x-powered-by") {
        found.insert(powered_by.clone(), "X-Powered-By Header".to_string());
    }
    for cookie in cookies {
        let name = cookie.name.to_ascii_lowercase();
        if name.contains("wordpress") {
            found.insert("WordPress".to_string(), format!("Cookie {}", cookie.name));
        } else if name.contains("shopify") {
            found.insert("Shopify".to_string(), format!("Cookie {}", cookie.name));
        } else if name.contains("laravel") {
            found.insert("Laravel".to_string(), format!("Cookie {}", cookie.name));
        }
    }
    found
        .into_iter()
        .map(|(name, evidence)| WebCheckTechnology { name, evidence })
        .collect()
}

fn analyze_security_headers(headers: &BTreeMap<String, String>) -> Vec<WebCheckSecurityHeader> {
    let expected = [
        (
            "strict-transport-security",
            "high",
            "启用 HSTS，减少降级攻击风险",
        ),
        (
            "content-security-policy",
            "high",
            "限制脚本、样式和资源来源",
        ),
        ("x-frame-options", "medium", "降低点击劫持风险"),
        ("x-content-type-options", "medium", "阻止 MIME 嗅探"),
        ("referrer-policy", "low", "控制 Referer 信息泄露"),
        ("permissions-policy", "low", "限制浏览器高危能力"),
    ];
    expected
        .iter()
        .map(|(name, severity, note)| WebCheckSecurityHeader {
            name: (*name).to_string(),
            present: headers.contains_key(*name),
            value: headers.get(*name).cloned(),
            severity: (*severity).to_string(),
            note: (*note).to_string(),
        })
        .collect()
}

fn resolve_ips(host: &str) -> Vec<String> {
    let mut ips = BTreeSet::new();
    if let Ok(addrs) = format!("{}:80", host).to_socket_addrs() {
        for addr in addrs {
            let ip: IpAddr = addr.ip();
            ips.insert(ip.to_string());
        }
    }
    ips.into_iter().collect()
}

fn build_warnings(
    fetch: &FetchOutcome,
    security_headers: &[WebCheckSecurityHeader],
    robots: &WebCheckProbe,
    sitemap: &WebCheckProbe,
) -> Vec<String> {
    let mut warnings = Vec::new();
    if fetch.status.map(|status| status >= 400).unwrap_or(true) {
        warnings.push("首页请求未成功，部分检测结果可能不完整。".to_string());
    }
    for header in security_headers.iter().filter(|item| !item.present) {
        warnings.push(format!("缺少安全响应头：{}", header.name));
    }
    for cookie in &fetch.cookies {
        if !cookie.secure {
            warnings.push(format!("Cookie {} 未设置 Secure", cookie.name));
        }
        if !cookie.http_only {
            warnings.push(format!("Cookie {} 未设置 HttpOnly", cookie.name));
        }
    }
    if !robots.exists {
        warnings.push("未发现 robots.txt。".to_string());
    }
    if !sitemap.exists {
        warnings.push("未发现 sitemap.xml。".to_string());
    }
    warnings
}

fn calculate_score(
    fetch: &FetchOutcome,
    security_headers: &[WebCheckSecurityHeader],
    warnings: &[String],
    https: bool,
) -> u8 {
    let mut score: i32 = 100;
    if !https {
        score -= 20;
    }
    if fetch.status.map(|status| status >= 400).unwrap_or(true) {
        score -= 25;
    }
    for header in security_headers.iter().filter(|item| !item.present) {
        score -= match header.severity.as_str() {
            "high" => 10,
            "medium" => 6,
            _ => 3,
        };
    }
    score -= (warnings.len() as i32).min(8);
    score.clamp(0, 100) as u8
}
