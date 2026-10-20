# GitHub 发布准备

## 仓库信息

可直接复制到 GitHub 仓库设置：

- **Repository name**：`bind_sheet`
- **Description**：Vue 3 纯前端 Excel 报表设计器，支持拖拽字段绑定、可移动明细区域、模板管理、数据预览与 XLSX 导出。
- **Website**：https://fangge-report-preview-20261020.spiffylemur4.chatgpt.site
- **Topics**：`vue3`、`typescript`、`vite`、`univer`、`exceljs`、`report-designer`、`data-binding`、`xlsx`

## 当前 Git 状态

整理前的功能基线：

- 当前分支：`main`。
- 最新功能提交：`8e3fe5a`。
- 历史共 4 条提交，均已按实际差异整理在 [CHANGELOG.md](../CHANGELOG.md)。
- 2026-10-20 检查时没有配置 Git remote；本次未添加远程地址、重写历史、打标签或推送。
- 现有 `.openai/hosting.json` 是当前 Sites 站点的部署声明，本地运行不依赖它；普通静态托管只需 `dist/`。

这是一份发布前的状态记录，后续提交后以 `git status` 和 `git log` 为准。

## 提交文档整理

先在本机检查本次文档差异：

```bash
git status --short
git diff --stat
git diff -- README.md docs/preview.png docs/quick-create.png
git diff --check
```

`CHANGELOG.md` 和本文件是新增文件，可直接打开检查内容。

确认后自行提交：

```bash
git add README.md CHANGELOG.md docs/GITHUB_PUBLISH.md docs/preview.png docs/quick-create.png
git commit -m "docs: 整理项目介绍、变更记录与 GitHub 发布说明"
```

## 上传已有本地仓库

在 GitHub 新建空仓库；初始化 README、LICENSE 或 `.gitignore` 可留给本地项目统一管理。

把下面的 `YOUR_USERNAME` 替换为自己的 GitHub 用户名，再在项目目录执行：

```bash
git remote -v
git remote add origin https://github.com/YOUR_USERNAME/bind_sheet.git
git push -u origin main
```

以上命令适用于当前没有 `origin` 的情况。如果执行时已经配置了远程地址，先确认其指向的仓库，再决定保留或调整。

## 可选的首个 Release 文案

**建议标签**：`v1.0.0`，与当前 `package.json` 一致；当前尚未创建该标签。

**建议标题**：`bind_sheet v1.0.0 · Vue 3 纯前端报表设计器`

**说明正文**：

> 支持从 Mock 数据源拖拽字段到 Excel 表格，设计并保存可复用的报表模板，再生成数据预览和下载 XLSX。
>
> - 单值、明细、数值合计三种绑定方式。
> - 自定义并整行移动明细区域，支持撤销和重做。
> - 快速建表、模板库、自动草稿和刷新恢复。
> - 统一数据服务，方便后续替换为后端接口。
> - 86 项测试通过，已验证类型检查、生产构建及浏览器下载文件重读。
>
> 当前面向桌面浏览器，支持一张工作表和一个单行明细区域；暂不包含文件上传、分组交叉表及任意 Excel 公式兼容。

## 后续提交约定

建议每条提交围绕一个明确的改动，标题使用以下格式：

```text
feat: 增加新功能
fix: 修复用户可复现的问题
docs: 更新说明与示例
test: 补充验证
refactor: 调整实现结构
chore: 更新构建或项目配置
```

目前没有 `LICENSE` 文件。本次未代选许可证；可在发布前按自己的授权意图补充。
