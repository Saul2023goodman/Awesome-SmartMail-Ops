# v2 Standalone UI QA

该 QA 针对独立 `app.html` 工作台，而不是旧版网易页面内悬浮 UI。

运行：

```bash
python3 qa/ui_audit.py
```

它会：

- 对 `app.js / background.js / executor.js / file-vault.js` 和业务脚本执行 JS 语法检查；
- 运行现有 20 项来源角色 / 邮件帧 / 来源隔离回归；
- 加载真实 `app.css + app-shell.css + app.js`；
- 真实导入 QA Word / Excel / PDF 文件；
- 自动进入“确认文件用途”流程；
- 对 1440×900、1280×800、1100×760、920×720、820×700 自动截图；
- 检查独立工作台是否默认全屏、旧 launcher 是否残留、fixed modal 是否仍被 containment 截断、对话框/控件是否越界、是否出现同支路嵌套纵向滚动。

`qa/reports/ui-audit.md` 是人读报告，`qa/reports/ui-audit.json` 可用于后续自动比较。

受当前沙箱浏览器策略限制，QA host 不能导航到本地/extension origin，因此附件仓库在这里验证 API 装载和静态结构；真正的 IndexedDB 存储发生在用户 Chrome 的 `chrome-extension://` origin。真实网易草稿执行仍需用户已登录的 `mail.163.com` 标签页。
