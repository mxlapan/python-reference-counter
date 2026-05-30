## Python 引用计数器 (Python Reference Counter)

[English](./README.md) | **简体中文**

一个轻量级的 CodeLens 提供器,在 Python 的函数 / 方法 / 类定义上方显示它在工作区中被引用的次数(类似 PyCharm 风格)。点击该提示即可打开内置的引用面板进行跳转。

### ✨ 功能特性
* 按符号统计函数 / 方法 / 类的引用次数
* 通过语言服务器的文档符号(document-symbol)提供器进行**语义化**符号检测;当没有语言服务器时回退到正则扫描
* 引用结果会去重,并默认排除定义本身,使计数更准确
* 引用解析延迟到 CodeLens 出现在视口时才进行,并按文档版本缓存,因此滚动保持流畅
* 检测到没有 Python 语言服务器时,会(仅一次)提示安装官方 Python 扩展;一旦其加载完成,计数会自动升级为语义结果
* 统计范围可选:仅类、仅函数/方法、或两者都统计
* 可选:当引用数为零时隐藏 CodeLens

### ⚙️ 设置项
所有设置均位于 `pythonReferenceCounter` 命名空间下:

| 设置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `pythonReferenceCounter.showZeroReferences` | boolean | `true` | 即使引用数为零也显示 CodeLens |
| `pythonReferenceCounter.enableFor` | enum | `both` | 为哪些符号显示 CodeLens:`both`(两者)、`classes`(仅类)、`functions`(函数 + 方法) |
| `pythonReferenceCounter.enableFallbackWorkspaceScan` | boolean | `true` | **仅**在没有任何 Python 语言服务器解析到符号时(扩展缺失或尚在建立索引)启用的兜底方案:对整个工作区做朴素文本搜索。速度较慢且可能多计;只要语言服务器返回了结果就会跳过此扫描 |

### 📦 环境要求
* VS Code >= 1.102.0
* **推荐:** 官方 [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python) 扩展(内置 Pylance)。它通过 `vscode.executeDocumentSymbolProvider` / `vscode.executeReferenceProvider` 提供本扩展所读取的语义化符号与引用数据——这正是让计数**既准确又快速**的关键。本扩展会检测是否缺少 Python 服务器,并(仅一次)提示安装。
* 若没有任何 Python 语言服务器,本扩展仍可在降级模式下工作:用正则扫描查找定义,并用可选的工作区文本扫描估算计数(更慢、更不准确)。

### 🚀 使用方法
1. 安装本扩展
2. 打开一个 Python 文件
3. 将光标移近函数 / 类所在行,或将其滚动到可见区域——会出现类似 `3 references` 的 CodeLens
4. 点击该提示打开引用面板
5. 通过 设置 > 扩展 > Python Reference Counter 调整行为

### 🧠 工作原理(简述)
1. 提供阶段:`vscode.executeDocumentSymbolProvider` 语义化地枚举类 / 函数 / 方法(精确的名称范围、正确的类型)。若没有语言服务器响应,则改用轻量正则扫描。每个符号生成一个占位 CodeLens。
2. 解析阶段:当某个 CodeLens 可见时,`vscode.executeReferenceProvider` 返回其引用并去重。对于正则回退路径,方法引用会被进一步过滤为真实调用点(前面带 `.`);语义引用则原样信任。
3. 较慢的工作区文本扫描**仅**在语言服务器对某符号未解析出任何结果时(无服务器,或尚未建立索引)才运行。当服务器返回结果时直接采用——不会全工作区打开文件。
4. 定义本身始终不计入引用数(符合"N references"约定);零计数隐藏按用户设置应用,最终计数会按当前文档版本进行缓存。

### 📌 限制 / 说明
* 仅静态分析——无法检测通过 `getattr`、反射、元编程产生的动态用法
* 方法检测依赖 `.method` 调用启发式;非常特殊的格式可能降低准确度
* 兜底的工作区扫描(仅在无语言服务器解析时使用)是纯文本匹配,可能把注释或字符串中的同名词多计进去
* 单独成行的装饰器不影响检测;跨多行的 `def(...)` 签名以其起始行进行匹配

### 🗒️ 更新日志
见 [CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)(英文:[CHANGELOG.md](./CHANGELOG.md))——当前版本:2.0.0

### 🤝 参与贡献
欢迎提交 Issue 与 PR:请在 Issue 中描述改进点或不准确之处,并附上最小可复现示例。

### 🧪 测试
`npm test` 会(经由 `pretest`)先编译 + lint,然后运行 VS Code 集成测试:
```bash
npm install
npm test
```
> 注意:当另一个 VS Code 实例正在运行时,VS Code 测试运行器无法启动——请先关闭它。

### 许可证
MIT

祝编码愉快!🎉
