# v2.0 独立 Chrome 工作台架构

## 目标

插件不再把大型 UI 注入网易邮箱。点击扩展图标直接打开 `chrome-extension://<id>/app.html`。

## 三层职责

- `app.html / app.js / app.css`：完整用户工作台。导入、来源分类、核验、附件管理、排程、联系人、批量选择均在扩展页面完成。
- `background.js`：连接中枢。发现/切换网易邮箱标签页、读取邮箱状态、转发执行命令、维护附件临时仓库访问。
- `executor.js`：网易邮箱页面中的无 UI 执行器。只负责打开写信、填写字段、上传附件、设置定时、存草稿并返回业务证据。

## 附件桥

独立页面选择的 `File` 不直接通过 runtime message 传输。`file-vault.js` 将文件暂存到扩展 origin 的 IndexedDB；执行器按 256 KiB 分块经 background 读取，重建 `File` 后交给网易真实 file input。每封草稿结束后工作台删除本次临时文件。

## 数据兼容

- `chrome.storage.local` 的联系人和单封表单键保持不变。
- 原先位于 `mail.163.com` localStorage 的排程规则通过 `NMDA_LEGACY_PREFS` 在首次运行时迁移。

## 安全边界

仍然只创建/保存草稿，不自动点击发送。每封批量任务必须获得网易页面新的“草稿保存/定时设置成功”证据后才进入下一封。
