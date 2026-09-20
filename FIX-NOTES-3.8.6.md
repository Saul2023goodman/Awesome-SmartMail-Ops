# v3.8.6 — Batch Follow-up + Monitoring Scroll Fix

## 业务重构

邮件监测仍然只负责读取邮箱事实、判断 Follow-up eligibility 与准备派生任务。执行仍统一进入“选择与排期”。

本版新增批量生成 Follow-up Task：

- 只有已经到期、当前没有同 sequence Follow-up Task、且没有有效回复/模糊回复/联系保护阻断的线程可被批量选择。
- “等待中”线程不能通过批量生成绕过 delay policy；提前跟进仍然只保留单条人工操作。
- 支持逐条勾选、选择当前筛选结果中的全部可生成项、清除选择。
- 批量生成只创建 Derived Follow-up Tasks，不自动确认、不自动加入排期、不自动发送。
- Core 提供 `createFollowUpTasks()` 单次批量写入，避免大量任务时反复复制 operation store。

## Scrolling 修复

全局 UI 系统为了其他工作区的单视口布局设置了 `.nmda-page { overflow:hidden !important; }`，覆盖了邮件监测页面原先的滚动声明。

本版仅对 `.nmda-monitor-page` 建立独立滚动所有权：

- `overflow-y:auto !important`
- `overflow-x:hidden !important`
- 保持其他工作区的单视口规则不变
- 监测列表较长时页面可正常滚动

## 不变的边界

- 邮箱仍然只在人工点击“读取邮箱/完整读取”时访问。
- Follow-up Task 生成后仍需编辑正文、确认 exact version，再加入“选择与排期”。
- 有效回复、模糊回复、Do Not Contact、暂停 Follow-up 等硬边界不会被批量操作绕过。
