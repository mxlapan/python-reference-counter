# 更新日志

[English](./CHANGELOG.md) | **简体中文**

本文件记录本项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
并(在适用范围内)遵循 [语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [2.0.1] - 2026-07-11
### 修复
- 修复 WSL/macOS 下左侧文件资源管理器快速闪动的问题。此前"无语言服务器兜底扫描"会对工作区每个 `.py` 文件、且每个符号都各扫一遍并打开文档；同时它在语言服务器(Pylance)仍在建立索引(引用查询会短暂返回空)时也会触发。现在仅在确实没有安装 Python 语言服务器时才扫描，改用 `fs.readFile` 读取字节而非打开文档，并在同一文件的多个符号间共享一次短时缓存的扫描
- 修复语言服务器索引期间计数不准的问题。已安装但尚未就绪的服务器不再回退到会高估的正则文本扫描；此时计数不写入缓存，并安排有上限的重新解析，在索引完成后自动纠正(无需手动编辑文件)
- 当激活后启用/禁用 Python 语言服务器时刷新 CodeLens，使计数自动升级为语义结果(或回退)

## [2.0.0] - 2026-05-30
### 新增
- 新增 `pythonReferenceCounter.enableFallbackWorkspaceScan` 设置(默认 `true`),用于控制"无语言服务器时的文本扫描兜底"
- 新增 `pythonReferenceCounter.enableFor` 设置(`both` | `classes` | `functions`,默认 `both`),取代原先分开的类/函数两个开关

### 移除(破坏性变更)
- 移除 `pythonReferenceCounter.enableForClasses` 与 `pythonReferenceCounter.enableForFunctions`——改用单个 `enableFor` 设置
- 移除 `pythonReferenceCounter.includeDefinition`:现在始终将定义本身排除在计数之外,符合 PyCharm 与 VS Code 自带引用 CodeLens 的"N references"约定

### 修复
- 对于短名称(如 `def f`),CodeLens 现在指向符号名本身而非关键字,因此引用解析能正常工作
- 设置变更现在会通过 `onDidChangeCodeLenses` 立即刷新 CodeLens(此前无参的 `executeCodeLensProvider` 调用不起作用)
- 重写了兜底工作区扫描,改用稳定的 `findFiles` API 并正确处理异步(此前的 `findTextInFiles` 是 proposed API,在正式版 VS Code 中会静默失效或卡死)
- 出错时的兜底 CodeLens 不再携带空命令字符串
- 诊断日志改用专用的输出通道(Output ▸ "Python Reference Counter"),不再写入共享的调试控制台

### 性能与准确度
- 朴素的工作区文本扫描现在仅在语言服务器对某符号未解析出任何结果时(无 Python 扩展,或尚未建立索引)才运行。此前只要引用看起来都在本文件内,就可能打开每个 `.py` 文件;现在直接信任 Pylance 的语义结果,既省去 I/O 开销,也消除了注释/字符串造成的误计
- 检测到未安装 Python 语言服务器时,会(仅一次)提示安装官方 Python 扩展;若之后出现了服务器,会自动刷新计数

### 变更
- 符号检测现在优先使用 `vscode.executeDocumentSymbolProvider`(语义化:精确名称范围、正确的类/函数/方法类型),仅在没有语言服务器响应时回退到正则扫描
- 引用计数会去重;方法的点号过滤仅在正则回退路径上应用(语义引用原样信任)
- 解析出的计数按文档版本缓存(编辑或设置变更时清除),以保持滚动流畅
- 正则回退:通过外层代码块区分方法与嵌套/普通函数,并跳过三引号字符串中的 `class`/`def` 文本;工作区兜底扫描会跳过行注释
- 将 `@vscode/vsce` 移至 `devDependencies`,使其不被打包进发布的 VSIX
- `.vscodeignore` 不再打包编译后的测试、source map 或 `.vscode-test.mjs`
- 将 `@vscode/vsce` 升级到 ^3.9.1 并钉死已修复的传递依赖;`npm audit` 报告 0 个漏洞
- 校正 README 的环境要求/限制说明,使其与实际行为一致

## [1.0.0] - 2025-08-08
### 新增
- 首次发布
- 为 Python 函数、方法、类提供 CodeLens 引用计数
- 针对方法调用点的智能过滤(排除定义 / 类头部)
- 设置项:showZeroReferences、includeDefinition、enableForClasses、enableForFunctions、enableFallbackWorkspaceScan

---

[2.0.1]: https://github.com/maxim-lapan/python-reference-counter/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/maxim-lapan/python-reference-counter/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/maxim-lapan/python-reference-counter/releases/tag/v1.0.0
