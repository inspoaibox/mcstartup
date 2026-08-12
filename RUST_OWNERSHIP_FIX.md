# Rust 所有权错误修复

## 🐛 错误信息

```
error[E0505]: cannot move out of `resp` because it is borrowed
  --> src\commands.rs:2873:16
   |
2855 |     let resp = req.send().await.map_err(|e| e.to_string())?;
   |         ---- binding `resp` declared here
...
2867 |     let content_type = resp
   |                        ---- borrow of `resp` occurs here
...
2873 |     let text = resp.text().await.map_err(|e| e.to_string())?;
   |                ^^^^ move out of `resp` occurs here
...
2876 |     if !content_type.contains("application/json") && !content_type.contains("text/json") {
   |         ------------ borrow later used here
```

## 🔍 问题分析

### **Rust 所有权规则**

1. **借用（Borrow）**：通过引用访问数据，不获取所有权
2. **移动（Move）**：转移所有权，原变量失效
3. **规则**：不能在借用仍然有效时移动被借用的值

### **问题代码**

```rust
// 第 2867 行：借用 resp 获取 headers
let content_type = resp
    .headers()                    // 不可变借用 &resp
    .get("content-type")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("");               // 返回 &str（生命周期绑定到 resp）

// 第 2873 行：尝试移动 resp
let text = resp.text().await...   // ❌ 消耗 resp 的所有权

// 第 2876 行：使用 content_type
if !content_type.contains(...)    // ❌ content_type 仍然引用已移动的 resp
```

### **为什么会报错？**

1. `resp.headers()` 返回 `&HeaderMap`（借用）
2. `.get("content-type")` 返回 `Option<&HeaderValue>`（借用）
3. `.to_str().ok()` 返回 `Option<&str>`（借用）
4. `.unwrap_or("")` 返回 `&str`（生命周期绑定到 `resp`）
5. `content_type` 是 `&str` 类型，引用 `resp` 内部的数据
6. `resp.text()` 会**消耗** `resp` 的所有权
7. 之后使用 `content_type` 时，它引用的 `resp` 已经不存在了

## ✅ 修复方案

### **核心思路**

在调用 `resp.text()` **之前**，将 `content_type` 从借用转换为**拥有值**。

### **修复代码**

```rust
// 提取 Content-Type 的拥有值（在消耗 resp 之前）
let content_type = resp
    .headers()
    .get("content-type")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_string();  // ✅ 转换为 String，获取所有权

// 现在可以安全地消耗 resp
let text = resp.text().await.map_err(|e| e.to_string())?;

// content_type 是独立的 String，不依赖 resp
if !content_type.contains("application/json") && !content_type.contains("text/json") {
    // ...
}
```

### **关键改动**

```diff
  let content_type = resp
      .headers()
      .get("content-type")
      .and_then(|v| v.to_str().ok())
-     .unwrap_or("");
+     .unwrap_or("")
+     .to_string();  // 转换为 String，获取所有权
```

## 📊 类型对比

| 修复前                   | 修复后                 |
| ------------------------ | ---------------------- |
| `content_type: &str`     | `content_type: String` |
| 借用 `resp` 内部数据     | 拥有独立的数据         |
| 生命周期绑定到 `resp`    | 独立的生命周期         |
| ❌ 不能在之后移动 `resp` | ✅ 可以移动 `resp`     |

## 🎓 Rust 所有权知识点

### **1. 借用 vs 所有权**

```rust
// 借用（Borrow）
let s = String::from("hello");
let r = &s;              // r 借用 s
println!("{}", r);       // ✅ 可以使用 r
println!("{}", s);       // ✅ s 仍然有效

// 移动（Move）
let s = String::from("hello");
let r = s;               // s 的所有权移动到 r
println!("{}", r);       // ✅ 可以使用 r
// println!("{}", s);    // ❌ s 已失效
```

### **2. 借用规则**

```rust
let mut s = String::from("hello");

// 规则 1：可以有多个不可变借用
let r1 = &s;
let r2 = &s;
println!("{} {}", r1, r2);  // ✅

// 规则 2：不可变借用期间不能移动
let r = &s;
// let s2 = s;              // ❌ 不能移动
println!("{}", r);

// 规则 3：不可变借用期间不能可变借用
let r = &s;
// let r_mut = &mut s;      // ❌ 不能可变借用
println!("{}", r);
```

### **3. 生命周期**

```rust
fn get_str(s: &String) -> &str {
    &s[..]  // 返回的 &str 生命周期绑定到 s
}

let s = String::from("hello");
let r = get_str(&s);
// drop(s);                 // ❌ 不能释放 s，因为 r 还在使用
println!("{}", r);
```

### **4. 转换为拥有值**

```rust
// 方法 1：to_string()
let borrowed: &str = "hello";
let owned: String = borrowed.to_string();

// 方法 2：to_owned()
let borrowed: &str = "hello";
let owned: String = borrowed.to_owned();

// 方法 3：String::from()
let borrowed: &str = "hello";
let owned: String = String::from(borrowed);

// 方法 4：clone()（对于实现了 Clone 的类型）
let borrowed: &String = &String::from("hello");
let owned: String = borrowed.clone();
```

## 🔧 其他可能的修复方案

### **方案 1：使用 clone()**

```rust
let content_type = resp
    .headers()
    .get("content-type")
    .and_then(|v| v.to_str().ok())
    .map(|s| s.to_string())  // 转换为 String
    .unwrap_or_default();    // 返回空 String
```

### **方案 2：先获取 text，再检查 content_type**

```rust
// 先提取 content_type 字符串
let content_type_str = resp
    .headers()
    .get("content-type")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_string();

// 再获取 text
let text = resp.text().await.map_err(|e| e.to_string())?;

// 检查
if !content_type_str.contains("application/json") {
    // ...
}
```

### **方案 3：使用 Option 延迟检查**

```rust
// 先获取 text
let text = resp.text().await.map_err(|e| e.to_string())?;

// 再检查 text 内容（不依赖 content_type）
if text.trim_start().to_lowercase().starts_with("<!doctype") {
    return Err("服务器返回了 HTML 页面".to_string());
}
```

## ✅ 验证结果

```bash
$ cargo check
   Compiling mcstartup v0.1.0
warning: unused import: `Worksheet`
warning: unused import: `Format`
warning: unused import: `Worksheet`
warning: constant `MANUAL_INPUT_SIZE` is never used
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 45s
```

✅ **编译成功**，只有一些未使用导入的警告（不影响功能）。

## 📚 参考资料

- [The Rust Programming Language - Ownership](https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html)
- [Rust by Example - Borrowing](https://doc.rust-lang.org/rust-by-example/scope/borrow.html)
- [Rust Error E0505](https://doc.rust-lang.org/error-index.html#E0505)

---

**修复完成时间**：2026-04-24  
**错误类型**：E0505 - Cannot move out of borrowed content  
**修复方法**：将借用转换为拥有值（`.to_string()`）
