// 网络工具模块 - 真实的网络功能实现
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;
use surge_ping::{Client, Config, PingIdentifier, PingSequence};
use trust_dns_resolver::config::*;
use trust_dns_resolver::Resolver;

// ============ Ping 工具 ============

#[derive(Debug, Serialize, Deserialize)]
pub struct PingResult {
    pub success: bool,
    pub latency: Option<f64>, // 毫秒
    pub error: Option<String>,
}

pub async fn ping_host(host: String, timeout_ms: u64) -> Result<PingResult, String> {
    let host = normalize_host(&host)?;
    // 解析主机名到 IP
    let addr = match resolve_host(&host) {
        Ok(ip) => ip,
        Err(e) => {
            return Ok(PingResult {
                success: false,
                latency: None,
                error: Some(format!("无法解析主机: {}", e)),
            });
        }
    };

    // 创建 ICMP 客户端
    let client = match Client::new(&Config::default()) {
        Ok(c) => c,
        Err(e) => return ping_host_by_system_command(&host, timeout_ms, Some(e.to_string())).await,
    };

    let mut pinger = client.pinger(addr, PingIdentifier(rand::random())).await;
    pinger.timeout(Duration::from_millis(timeout_ms));

    // 发送 ping
    match pinger.ping(PingSequence(0), &[]).await {
        Ok((_, duration)) => Ok(PingResult {
            success: true,
            latency: Some(duration.as_secs_f64() * 1000.0),
            error: None,
        }),
        Err(e) => ping_host_by_system_command(&host, timeout_ms, Some(e.to_string())).await,
    }
}

// 解析主机名到 IP 地址
fn resolve_host(host: &str) -> Result<IpAddr, String> {
    // 先尝试直接解析为 IP
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(ip);
    }

    // 解析域名
    let addr = format!("{}:80", host);
    match addr.to_socket_addrs() {
        Ok(mut addrs) => {
            if let Some(socket_addr) = addrs.next() {
                Ok(socket_addr.ip())
            } else {
                Err("无法解析主机名".to_string())
            }
        }
        Err(e) => Err(format!("DNS 解析失败: {}", e)),
    }
}

fn normalize_host(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("主机地址不能为空".to_string());
    }

    let without_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .unwrap_or(trimmed);
    let host_part = without_scheme
        .split('/')
        .next()
        .unwrap_or(without_scheme)
        .split('?')
        .next()
        .unwrap_or(without_scheme)
        .trim();

    if host_part.is_empty() {
        return Err("主机地址不能为空".to_string());
    }

    if let Ok(socket_addr) = host_part.parse::<SocketAddr>() {
        return Ok(socket_addr.ip().to_string());
    }

    if host_part.starts_with('[') {
        if let Some(end) = host_part.find(']') {
            return Ok(host_part[1..end].to_string());
        }
    }

    if host_part.parse::<IpAddr>().is_ok() {
        return Ok(host_part.to_string());
    }

    Ok(host_part
        .rsplit_once(':')
        .and_then(|(host, port)| port.parse::<u16>().ok().map(|_| host.to_string()))
        .unwrap_or_else(|| host_part.to_string()))
}

fn decode_command_output(bytes: &[u8]) -> String {
    if cfg!(target_os = "windows") {
        match encoding_rs::GBK.decode(bytes) {
            (decoded, _, false) => decoded.into_owned(),
            _ => String::from_utf8_lossy(bytes).into_owned(),
        }
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

fn parse_ping_latency(output: &str) -> Option<f64> {
    for token in output.split_whitespace() {
        let lower = token.to_lowercase();
        if lower.contains("ms")
            || lower.contains("毫秒")
            || lower.contains("时间")
            || lower.contains("time")
        {
            let value = lower
                .replace("time=", "")
                .replace("time<", "")
                .replace("时间=", "")
                .replace("时间<", "")
                .replace("ms", "")
                .replace("毫秒", "")
                .replace('<', "")
                .replace('=', "")
                .trim()
                .to_string();
            if let Ok(latency) = value.parse::<f64>() {
                return Some(latency.max(1.0));
            }
        }
    }
    None
}

async fn ping_host_by_system_command(
    host: &str,
    timeout_ms: u64,
    icmp_error: Option<String>,
) -> Result<PingResult, String> {
    let host = host.to_string();
    let output = tokio::task::spawn_blocking(move || {
        if cfg!(target_os = "windows") {
            std::process::Command::new("ping")
                .args(["-n", "1", "-w", &timeout_ms.to_string(), &host])
                .output()
        } else {
            let timeout_secs = ((timeout_ms + 999) / 1000).max(1).to_string();
            std::process::Command::new("ping")
                .args(["-c", "1", "-W", &timeout_secs, &host])
                .output()
        }
    })
    .await
    .map_err(|e| format!("启动系统 ping 失败: {}", e))?;

    match output {
        Ok(output) => {
            let stdout = decode_command_output(&output.stdout);
            let stderr = decode_command_output(&output.stderr);
            if output.status.success() {
                Ok(PingResult {
                    success: true,
                    latency: parse_ping_latency(&stdout),
                    error: None,
                })
            } else {
                let detail = if !stderr.trim().is_empty() {
                    stderr.trim().to_string()
                } else if !stdout.trim().is_empty() {
                    stdout.trim().to_string()
                } else {
                    "请求超时或目标不可达".to_string()
                };
                Ok(PingResult {
                    success: false,
                    latency: None,
                    error: Some(match icmp_error {
                        Some(error) => {
                            format!("ICMP 原生失败，系统 ping 也失败：{}；{}", error, detail)
                        }
                        None => detail,
                    }),
                })
            }
        }
        Err(e) => Err(format!("执行系统 ping 失败: {}", e)),
    }
}

// ============ DNS 查询工具 ============

#[derive(Debug, Serialize, Deserialize)]
pub struct DnsRecord {
    pub record_type: String,
    pub value: String,
    pub ttl: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DnsQueryResult {
    pub success: bool,
    pub records: Vec<DnsRecord>,
    pub error: Option<String>,
}

pub async fn dns_query(
    domain: String,
    record_type: String,
    dns_server: Option<String>,
) -> Result<DnsQueryResult, String> {
    let domain = normalize_host(&domain)?;
    // 创建 DNS 解析器
    let resolver = if let Some(server) = dns_server {
        // 使用指定的 DNS 服务器
        match server.parse::<IpAddr>() {
            Ok(ip) => {
                let mut config = ResolverConfig::new();
                config.add_name_server(NameServerConfig {
                    socket_addr: std::net::SocketAddr::new(ip, 53),
                    protocol: Protocol::Udp,
                    tls_dns_name: None,
                    trust_negative_responses: false,
                    bind_addr: None,
                });
                match Resolver::new(config, ResolverOpts::default()) {
                    Ok(r) => r,
                    Err(e) => return Err(format!("创建 DNS 解析器失败: {}", e)),
                }
            }
            Err(_) => return Err("无效的 DNS 服务器地址".to_string()),
        }
    } else {
        // 使用系统默认 DNS
        match Resolver::from_system_conf() {
            Ok(r) => r,
            Err(e) => return Err(format!("创建 DNS 解析器失败: {}", e)),
        }
    };

    let mut records = Vec::new();

    match record_type.to_uppercase().as_str() {
        "A" => match resolver.lookup_ip(&domain) {
            Ok(response) => {
                for ip in response.iter() {
                    if ip.is_ipv4() {
                        records.push(DnsRecord {
                            record_type: "A".to_string(),
                            value: ip.to_string(),
                            ttl: None,
                        });
                    }
                }
            }
            Err(e) => {
                return Ok(DnsQueryResult {
                    success: false,
                    records: vec![],
                    error: Some(format!("查询失败: {}", e)),
                });
            }
        },
        "AAAA" => match resolver.lookup_ip(&domain) {
            Ok(response) => {
                for ip in response.iter() {
                    if ip.is_ipv6() {
                        records.push(DnsRecord {
                            record_type: "AAAA".to_string(),
                            value: ip.to_string(),
                            ttl: None,
                        });
                    }
                }
            }
            Err(e) => {
                return Ok(DnsQueryResult {
                    success: false,
                    records: vec![],
                    error: Some(format!("查询失败: {}", e)),
                });
            }
        },
        "MX" => match resolver.mx_lookup(&domain) {
            Ok(response) => {
                for mx in response.iter() {
                    records.push(DnsRecord {
                        record_type: "MX".to_string(),
                        value: format!("{} (优先级: {})", mx.exchange(), mx.preference()),
                        ttl: None,
                    });
                }
            }
            Err(e) => {
                return Ok(DnsQueryResult {
                    success: false,
                    records: vec![],
                    error: Some(format!("查询失败: {}", e)),
                });
            }
        },
        "TXT" => match resolver.txt_lookup(&domain) {
            Ok(response) => {
                for txt in response.iter() {
                    let value = txt
                        .iter()
                        .map(|s| String::from_utf8_lossy(s).to_string())
                        .collect::<Vec<_>>()
                        .join("");
                    records.push(DnsRecord {
                        record_type: "TXT".to_string(),
                        value,
                        ttl: None,
                    });
                }
            }
            Err(e) => {
                return Ok(DnsQueryResult {
                    success: false,
                    records: vec![],
                    error: Some(format!("查询失败: {}", e)),
                });
            }
        },
        _ => {
            return Ok(DnsQueryResult {
                success: false,
                records: vec![],
                error: Some("不支持的记录类型".to_string()),
            });
        }
    }

    Ok(DnsQueryResult {
        success: true,
        records,
        error: None,
    })
}

// ============ IP 信息查询 ============

#[derive(Debug, Serialize, Deserialize)]
pub struct IpInfo {
    pub ip: String,
    pub country: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub isp: Option<String>,
    pub timezone: Option<String>,
    pub local_ip: Option<String>,
}

pub async fn get_ip_info(ip: Option<String>) -> Result<IpInfo, String> {
    // 获取本机 IP
    let local_ip = match local_ip_address::local_ip() {
        Ok(ip) => Some(ip.to_string()),
        Err(_) => None,
    };

    let target_ip = if let Some(ip) = ip {
        normalize_host(&ip)?
    } else {
        // 查询公网 IP
        match reqwest::get("https://api.ipify.org?format=text").await {
            Ok(response) => match response.text().await {
                Ok(ip) => ip,
                Err(e) => return Err(format!("获取公网 IP 失败: {}", e)),
            },
            Err(e) => return Err(format!("获取公网 IP 失败: {}", e)),
        }
    };

    // 查询 IP 信息（使用免费 API）
    let url = format!("http://ip-api.com/json/{}?lang=zh-CN", target_ip);
    match reqwest::get(&url).await {
        Ok(response) => match response.json::<serde_json::Value>().await {
            Ok(data) => {
                if data["status"].as_str() == Some("fail") {
                    return Err(data["message"]
                        .as_str()
                        .unwrap_or("IP 信息查询失败")
                        .to_string());
                }
                Ok(IpInfo {
                    ip: data["query"].as_str().unwrap_or(&target_ip).to_string(),
                    country: data["country"].as_str().map(|s| s.to_string()),
                    region: data["regionName"].as_str().map(|s| s.to_string()),
                    city: data["city"].as_str().map(|s| s.to_string()),
                    isp: data["isp"].as_str().map(|s| s.to_string()),
                    timezone: data["timezone"].as_str().map(|s| s.to_string()),
                    local_ip,
                })
            }
            Err(e) => Err(format!("解析 IP 信息失败: {}", e)),
        },
        Err(e) => Err(format!("查询 IP 信息失败: {}", e)),
    }
}

// ============ 端口扫描 ============

#[derive(Debug, Serialize, Deserialize)]
pub struct PortScanResult {
    pub port: u16,
    pub open: bool,
    pub service: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalPortInfo {
    pub protocol: String,
    pub local_address: String,
    pub port: u16,
    pub pid: u32,
    pub process_name: Option<String>,
    pub process_path: Option<String>,
    pub state: Option<String>,
    pub service: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LocalPortRaw {
    protocol: String,
    local_address: String,
    port: u16,
    pid: u32,
    process_name: Option<String>,
    process_path: Option<String>,
    state: Option<String>,
}

pub async fn scan_port(host: String, port: u16, timeout_ms: u64) -> Result<PortScanResult, String> {
    let host = normalize_host(&host)?;
    let addr = match host.parse::<IpAddr>() {
        Ok(IpAddr::V6(_)) => format!("[{}]:{}", host, port),
        _ => format!("{}:{}", host, port),
    };
    let timeout = Duration::from_millis(timeout_ms);

    let open = match tokio::time::timeout(timeout, tokio::net::TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => true,
        _ => false,
    };

    let service = if open { get_service_name(port) } else { None };

    Ok(PortScanResult {
        port,
        open,
        service,
    })
}

pub async fn list_local_ports() -> Result<Vec<LocalPortInfo>, String> {
    tokio::task::spawn_blocking(list_local_ports_blocking)
        .await
        .map_err(|e| format!("读取本机端口失败: {}", e))?
}

fn list_local_ports_blocking() -> Result<Vec<LocalPortInfo>, String> {
    if cfg!(target_os = "windows") {
        list_windows_local_ports()
    } else {
        list_unix_local_ports()
    }
}

fn list_windows_local_ports() -> Result<Vec<LocalPortInfo>, String> {
    let script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function New-PortRow($protocol, $address, $port, $pid, $state) {
  $name = $null
  $path = $null
  $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($process) {
    $name = $process.ProcessName
    try { $path = $process.Path } catch { $path = $null }
  }
  [PSCustomObject]@{
    protocol = $protocol
    local_address = [string]$address
    port = [int]$port
    pid = [int]$pid
    process_name = $name
    process_path = $path
    state = $state
  }
}
$rows = @()
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $rows += New-PortRow 'TCP' $_.LocalAddress $_.LocalPort $_.OwningProcess 'LISTENING'
}
Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object {
  $rows += New-PortRow 'UDP' $_.LocalAddress $_.LocalPort $_.OwningProcess 'UDP'
}
$rows | Sort-Object port, protocol, local_address | ConvertTo-Json -Depth 4
"#;

    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(|e| format!("执行 PowerShell 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8(output.stderr)
            .unwrap_or_else(|e| decode_command_output(e.as_bytes()));
        return Err(if stderr.trim().is_empty() {
            "PowerShell 读取端口失败".to_string()
        } else {
            stderr.trim().to_string()
        });
    }

    let stdout =
        String::from_utf8(output.stdout).unwrap_or_else(|e| decode_command_output(e.as_bytes()));
    parse_local_port_json(&stdout)
}

fn list_unix_local_ports() -> Result<Vec<LocalPortInfo>, String> {
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg("command -v ss >/dev/null 2>&1 && ss -lntup || netstat -lntup 2>/dev/null")
        .output()
        .map_err(|e| format!("读取本机端口失败: {}", e))?;

    if !output.status.success() {
        return Err("当前系统缺少 ss/netstat，无法读取本机端口".to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut rows = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 || line.starts_with("Netid") || line.starts_with("Proto") {
            continue;
        }
        let protocol = parts[0].to_uppercase();
        let local = parts
            .iter()
            .find(|part| part.contains(':') && !part.contains("users:"))
            .copied()
            .unwrap_or("");
        let Some((address, port_text)) = local.rsplit_once(':') else {
            continue;
        };
        let Ok(port) = port_text.parse::<u16>() else {
            continue;
        };
        rows.push(LocalPortInfo {
            protocol,
            local_address: address.trim_matches('[').trim_matches(']').to_string(),
            port,
            pid: 0,
            process_name: None,
            process_path: None,
            state: Some("LISTENING".to_string()),
            service: get_service_name(port),
        });
    }
    rows.sort_by_key(|item| (item.port, item.protocol.clone(), item.local_address.clone()));
    Ok(rows)
}

fn parse_local_port_json(stdout: &str) -> Result<Vec<LocalPortInfo>, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let value: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("解析本机端口失败: {}", e))?;
    let values = match value {
        serde_json::Value::Array(items) => items,
        serde_json::Value::Null => Vec::new(),
        item => vec![item],
    };

    let mut rows = Vec::new();
    for item in values {
        let raw: LocalPortRaw =
            serde_json::from_value(item).map_err(|e| format!("解析本机端口字段失败: {}", e))?;
        rows.push(LocalPortInfo {
            service: get_service_name(raw.port),
            protocol: raw.protocol,
            local_address: raw.local_address,
            port: raw.port,
            pid: raw.pid,
            process_name: raw.process_name,
            process_path: raw.process_path,
            state: raw.state,
        });
    }

    rows.sort_by_key(|item| (item.port, item.protocol.clone(), item.local_address.clone()));
    Ok(rows)
}

pub async fn kill_process(pid: u32) -> Result<(), String> {
    tokio::task::spawn_blocking(move || kill_process_blocking(pid))
        .await
        .map_err(|e| format!("结束进程失败: {}", e))?
}

fn kill_process_blocking(pid: u32) -> Result<(), String> {
    if pid == 0 || pid == 4 {
        return Err("不能结束系统核心进程".to_string());
    }
    if pid == std::process::id() {
        return Err("不能结束当前应用自身进程".to_string());
    }

    let output = if cfg!(target_os = "windows") {
        std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .output()
    } else {
        std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output()
    }
    .map_err(|e| format!("执行结束进程命令失败: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = decode_command_output(&output.stderr);
        let stdout = decode_command_output(&output.stdout);
        Err(if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            "结束进程失败，可能需要管理员权限".to_string()
        })
    }
}

pub async fn reveal_process_path(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || reveal_process_path_blocking(path))
        .await
        .map_err(|e| format!("打开程序位置失败: {}", e))?
}

fn reveal_process_path_blocking(path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("该进程没有可用的程序路径".to_string());
    }
    let file_path = Path::new(path);
    if !file_path.exists() {
        return Err("程序路径不存在或无权访问".to_string());
    }

    let mut command = if cfg!(target_os = "windows") {
        let mut command = std::process::Command::new("explorer");
        command.arg(format!("/select,{}", path));
        command
    } else if cfg!(target_os = "macos") {
        let mut command = std::process::Command::new("open");
        command.arg("-R").arg(path);
        command
    } else {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(file_path.parent().unwrap_or_else(|| Path::new(".")));
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开程序位置失败: {}", e))
}

// 获取常见端口的服务名称
fn get_service_name(port: u16) -> Option<String> {
    match port {
        21 => Some("FTP".to_string()),
        22 => Some("SSH".to_string()),
        23 => Some("Telnet".to_string()),
        25 => Some("SMTP".to_string()),
        53 => Some("DNS".to_string()),
        80 => Some("HTTP".to_string()),
        110 => Some("POP3".to_string()),
        143 => Some("IMAP".to_string()),
        443 => Some("HTTPS".to_string()),
        1080 => Some("SOCKS Proxy".to_string()),
        1433 => Some("SQL Server".to_string()),
        1521 => Some("Oracle".to_string()),
        2375 => Some("Docker API".to_string()),
        2376 => Some("Docker TLS".to_string()),
        3000 => Some("Node/React/Next".to_string()),
        3001 => Some("Node Dev".to_string()),
        3306 => Some("MySQL".to_string()),
        3389 => Some("RDP".to_string()),
        4200 => Some("Angular Dev".to_string()),
        5000 => Some("Flask/Vite Preview".to_string()),
        5173 => Some("Vite Dev".to_string()),
        5672 => Some("RabbitMQ".to_string()),
        5432 => Some("PostgreSQL".to_string()),
        6379 => Some("Redis".to_string()),
        8000 => Some("Dev Server".to_string()),
        8080 => Some("HTTP-Proxy".to_string()),
        8081 => Some("Dev Server".to_string()),
        8443 => Some("HTTPS Dev".to_string()),
        9000 => Some("MinIO/PHP-FPM".to_string()),
        9001 => Some("MinIO Console".to_string()),
        9200 => Some("Elasticsearch".to_string()),
        9300 => Some("Elasticsearch Node".to_string()),
        15672 => Some("RabbitMQ Console".to_string()),
        27017 => Some("MongoDB".to_string()),
        _ => None,
    }
}

// ============ Traceroute（路由追踪）============

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteHop {
    pub hop: u32,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub latencies: Vec<Option<f64>>,
    pub latency: Option<f64>,
    pub best_latency: Option<f64>,
    pub worst_latency: Option<f64>,
    pub jitter: Option<f64>,
    pub packet_loss: f64,
    pub timeout: bool,
    pub raw_line: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteResult {
    pub target: String,
    pub resolved_ip: Option<String>,
    pub hops: Vec<TracerouteHop>,
    pub raw_output: String,
    pub command: String,
    pub reached: bool,
    pub total_hops: u32,
    pub timeout_count: u32,
    pub avg_latency: Option<f64>,
    pub max_latency: Option<f64>,
}

pub async fn traceroute(
    host: String,
    max_hops: u32,
    timeout_ms: u64,
) -> Result<TracerouteResult, String> {
    use std::process::Command;
    let host = normalize_host(&host)?;
    let max_hops = max_hops.clamp(1, 64);
    let timeout_ms = timeout_ms.clamp(1000, 30000);

    let (output, command_line) = if cfg!(target_os = "windows") {
        let args = vec![
            "-d".to_string(),
            "-h".to_string(),
            max_hops.to_string(),
            "-w".to_string(),
            timeout_ms.to_string(),
            host.clone(),
        ];
        match Command::new("tracert").args(&args).output() {
            Ok(output) => output,
            Err(e) => return Err(format!("执行 tracert 失败: {}", e)),
        }
        .pipe(|output| (output, format!("tracert {}", args.join(" "))))
    } else {
        let timeout_secs = ((timeout_ms + 999) / 1000).max(1).to_string();
        let args = vec![
            "-n".to_string(),
            "-m".to_string(),
            max_hops.to_string(),
            "-w".to_string(),
            timeout_secs,
            host.clone(),
        ];
        match Command::new("traceroute").args(&args).output() {
            Ok(output) => output,
            Err(e) => return Err(format!("执行 traceroute 失败: {}", e)),
        }
        .pipe(|output| (output, format!("traceroute {}", args.join(" "))))
    };

    let stdout = decode_command_output(&output.stdout);
    let stderr = decode_command_output(&output.stderr);
    let output_str = if stderr.trim().is_empty() {
        stdout
    } else if stdout.trim().is_empty() {
        stderr
    } else {
        format!("{}\n{}", stdout, stderr)
    };

    let hops = parse_traceroute_output(&output_str);
    if hops.is_empty() {
        return Err(format!("未能解析到任何路由信息。原始输出:\n{}", output_str));
    }

    let timeout_count = hops.iter().filter(|hop| hop.timeout).count() as u32;
    let resolved_ip = extract_traceroute_target_ip(&output_str);
    let reached = hops
        .last()
        .and_then(|hop| hop.ip.as_deref())
        .map(|ip| {
            resolved_ip
                .as_deref()
                .map(|target_ip| ip.eq_ignore_ascii_case(target_ip))
                .unwrap_or_else(|| {
                    host.parse::<IpAddr>()
                        .map(|host_ip| ip.eq_ignore_ascii_case(&host_ip.to_string()))
                        .unwrap_or(false)
                })
        })
        .unwrap_or(false);
    let latencies = hops
        .iter()
        .filter_map(|hop| hop.latency)
        .collect::<Vec<_>>();
    let avg_latency = average(&latencies);
    let max_latency = latencies.iter().copied().reduce(f64::max);
    let resolved_ip = resolved_ip.or_else(|| {
        hops.last()
            .and_then(|hop| hop.ip.clone())
            .filter(|ip| reached || host.parse::<IpAddr>().is_ok() && ip == &host)
    });
    Ok(TracerouteResult {
        target: host,
        resolved_ip,
        total_hops: hops.len() as u32,
        timeout_count,
        avg_latency,
        max_latency,
        reached,
        raw_output: output_str,
        command: command_line,
        hops,
    })
}

fn parse_traceroute_output(output: &str) -> Vec<TracerouteHop> {
    output
        .lines()
        .filter_map(parse_traceroute_hop_line)
        .collect::<Vec<_>>()
}

fn parse_traceroute_hop_line(raw_line: &str) -> Option<TracerouteHop> {
    let line = raw_line.trim();
    if line.is_empty() {
        return None;
    }
    let mut parts = line.split_whitespace();
    let hop = parts.next()?.parse::<u32>().ok()?;
    let star_count = line.matches('*').count();
    let ip = extract_last_ip(line);
    let hostname = extract_hostname(line, ip.as_deref());
    let latencies = extract_traceroute_latencies(line);
    let successful = latencies
        .iter()
        .filter_map(|value| *value)
        .collect::<Vec<_>>();
    let latency = average(&successful);
    let best_latency = successful.iter().copied().reduce(f64::min);
    let worst_latency = successful.iter().copied().reduce(f64::max);
    let jitter = match (best_latency, worst_latency) {
        (Some(best), Some(worst)) => Some((worst - best).max(0.0)),
        _ => None,
    };
    let probe_count = latencies
        .len()
        .max(star_count)
        .max(if cfg!(target_os = "windows") { 3 } else { 1 });
    let lost_count = latencies
        .iter()
        .filter(|value| value.is_none())
        .count()
        .max(star_count);
    let timeout = ip.is_none() && successful.is_empty();
    Some(TracerouteHop {
        hop,
        ip: ip.clone(),
        hostname,
        latencies,
        latency,
        best_latency,
        worst_latency,
        jitter,
        packet_loss: ((lost_count as f64 / probe_count as f64) * 10000.0).round() / 100.0,
        timeout,
        raw_line: line.to_string(),
    })
}

fn extract_last_ip(line: &str) -> Option<String> {
    line.split_whitespace().rev().find_map(|part| {
        let clean = part.trim_matches(|c| matches!(c, '[' | ']' | '(' | ')' | ','));
        clean.parse::<IpAddr>().ok().map(|ip| ip.to_string())
    })
}

fn extract_hostname(line: &str, ip: Option<&str>) -> Option<String> {
    let ip = ip?;
    let bracket = format!("[{}]", ip);
    if let Some(index) = line.find(&bracket) {
        let before = line[..index].trim();
        return before
            .split_whitespace()
            .last()
            .filter(|value| value.parse::<u32>().is_err())
            .map(|value| value.to_string());
    }
    None
}

fn extract_traceroute_latencies(line: &str) -> Vec<Option<f64>> {
    let tokens = line.split_whitespace().collect::<Vec<_>>();
    let mut latencies = Vec::new();
    let mut index = 1usize;
    while index < tokens.len() {
        let token = tokens[index];
        if token == "*" {
            latencies.push(None);
            index += 1;
            continue;
        }
        let lower = token.to_lowercase();
        if lower.ends_with("ms") || lower.ends_with("毫秒") {
            if let Some(value) = parse_latency_token(&lower) {
                latencies.push(Some(value));
            }
            index += 1;
            continue;
        }
        if index + 1 < tokens.len() {
            let next = tokens[index + 1].to_lowercase();
            if next == "ms" || next == "毫秒" {
                let normalized = token.trim_start_matches('<').replace(',', ".");
                if let Ok(value) = normalized.parse::<f64>() {
                    latencies.push(Some(value.max(1.0)));
                    index += 2;
                    continue;
                }
            }
        }
        index += 1;
    }
    latencies
}

fn parse_latency_token(token: &str) -> Option<f64> {
    let value = token
        .trim_start_matches('<')
        .trim_end_matches("ms")
        .trim_end_matches("毫秒")
        .replace(',', ".");
    value.parse::<f64>().ok().map(|latency| latency.max(1.0))
}

fn extract_traceroute_target_ip(output: &str) -> Option<String> {
    for line in output.lines().take(8) {
        for token in line.split_whitespace().rev() {
            let clean = token.trim_matches(|c| matches!(c, '[' | ']' | '(' | ')' | ',' | '.'));
            if let Ok(ip) = clean.parse::<IpAddr>() {
                return Some(ip.to_string());
            }
        }
    }
    None
}

fn average(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        None
    } else {
        Some(values.iter().sum::<f64>() / values.len() as f64)
    }
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}

impl<T> Pipe for T {}
