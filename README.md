# NetEase Mail Draft Assistant v2.0 · Standalone Workspace

这是一次架构级迁移：**插件 UI 不再注入网易邮箱页面**。点击 Chrome 扩展图标后，直接打开独立的 `chrome-extension://<id>/app.html` 工作台；网易邮箱标签页只运行无界面的 `executor.js`。

## 使用方式

1. 在 `chrome://extensions` 开启“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择本目录。
3. 点击扩展图标，Chrome 会打开独立工作台。
4. 右上角会显示网易邮箱连接状态；未连接时点击“打开网易邮箱”，完成登录。
5. 所有资料导入、来源确认、邮件核验、附件管理、排程、联系人和批量选择都在独立工作台完成。
6. 点击“创建草稿”后，工作台把任务交给 background，再由网易邮箱页中的 executor 操作真实写信界面并等待“保存草稿/定时设置成功”的新证据。

> 安全边界保持不变：只创建并保存草稿，不自动点击“发送”。

## v2 架构

```text
app.html / app.js / app.css
        │
        │ chrome.runtime messaging
        ▼
background.js
  ├─ 网易标签页发现 / 切换
  ├─ 已发送 / 草稿箱读取
  └─ 临时附件读取
        │
        ▼
executor.js  (only script injected into mail.163.com)
  ├─ 打开写信
  ├─ 收件人 / 主题 / 正文
  ├─ 附件
  ├─ 定时
  └─ 存草稿 + 成功证据
```

### 附件为什么需要 `file-vault.js`

独立工作台里的 `File` 对象不能可靠地直接通过 Chrome runtime message 传给网页 content script。v2 将用户选中的附件临时写入扩展 origin 的 IndexedDB；executor 通过 background 以 256 KiB 分块读取，重建真实 `File` 后交给网易附件 input。单封任务结束即清理本次临时文件。

### 数据兼容

- 联系人和单封表单继续使用原来的 `chrome.storage.local` 键，升级后不会因为 UI 宿主改变而丢失。
- 原来存放在 `mail.163.com` localStorage 的排程偏好会在首次连接旧版页面时尝试一次迁移。

## 自动 UI QA

```bash
python3 qa/ui_audit.py
# 或
./qa/run_qa.sh
```

QA 会加载真实 app UI / 导入解析栈，自动导入 Word + Excel + PDF 样本，并在 1440×900、1280×800、1100×760、920×720、820×700 五档窗口截图和检查弹窗越界、控件越界、工作台尺寸与嵌套滚动。

当前 v2 基线：**20 项来源识别回归通过，三类测试文件真实导入通过，五档窗口 P0/P1 布局告警为 0。**

详细架构见 `docs/STANDALONE-WORKSPACE-v2.0.md`。
