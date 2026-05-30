## Python Reference Counter

**English** | [简体中文](./README.zh-CN.md)

Light‑weight CodeLens provider that shows how many times a Python function / method / class is referenced in your workspace (PyCharm style). Click the indicator to open the built‑in references panel and navigate.

### ✨ Features
* Function / method / class reference counting (per symbol)
* Semantic symbol detection via the language server's document‑symbol provider, with a regex scan as fallback when no server is available
* Counts are de‑duplicated and the definition is excluded by default for accurate totals
* Reference resolution is deferred until a CodeLens is revealed and cached per document version, so scrolling stays fast
* Detects when no Python language server is present and offers (once) to install the official Python extension, then upgrades counts automatically once it loads
* Scope counting to classes only, functions/methods only, or both
* Optionally hide CodeLens when count is zero

### ⚙️ Settings
All settings are under `pythonReferenceCounter` namespace:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pythonReferenceCounter.showZeroReferences` | boolean | `true` | Show CodeLens even for zero references |
| `pythonReferenceCounter.enableFor` | enum | `both` | Which symbols get CodeLens: `both`, `classes`, or `functions` (functions + methods) |
| `pythonReferenceCounter.enableFallbackWorkspaceScan` | boolean | `true` | Safety net used **only** when no Python language server resolves a symbol (extension missing or still indexing): a naive full-workspace text search. Slower and may over-count; skipped entirely when the server returns results |

### 📦 Requirements
* VS Code >= 1.102.0
* **Recommended:** the official [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python) extension (bundles Pylance). It provides the semantic symbol and reference data this extension reads via `vscode.executeDocumentSymbolProvider` / `vscode.executeReferenceProvider` — this is what makes counts both accurate and fast. The extension detects when no Python server is present and offers to install it (once).
* Without any Python language server, the extension still works in a degraded mode: a regex scan finds definitions and an optional workspace text scan estimates counts (slower, less accurate).

### 🚀 Usage
1. Install the extension
2. Open a Python file
3. Hover near a function / class line or scroll it into view – a CodeLens like `3 references` appears
4. Click the lens to open the references panel
5. Adjust behavior via Settings > Extensions > Python Reference Counter

### 🧠 How It Works (Brief)
1. Provide phase: `vscode.executeDocumentSymbolProvider` enumerates classes / functions / methods semantically (exact name ranges, correct kinds). If no language server responds, a cheap regex scan is used instead. Each symbol becomes a placeholder CodeLens.
2. Resolve phase: when a lens becomes visible, `vscode.executeReferenceProvider` returns the references, which are de‑duplicated. For the regex fallback, method references are additionally post‑filtered to true call sites (preceded by `.`); semantic references are trusted as‑is.
3. The slow workspace text scan runs **only** when the language server resolves nothing for a symbol (no server, or not yet indexed). When the server returns results they are used directly — no whole‑workspace file opening.
4. The definition itself is always excluded from the count (matching the "N references" convention); zero‑count hiding is applied per user settings, and the resulting count is cached for the current document version.

### 📌 Limitations / Notes
* Static analysis only—dynamic usages via `getattr`, reflection, metaprogramming not detected
* Method detection relies on a `.method` call heuristic; very unusual formatting may reduce accuracy
* The fallback workspace scan (used only when no language server resolves a symbol) is plain text matching and may over‑count occurrences inside comments or strings
* Decorators on their own lines do not affect detection; multi‑line `def(...)` signatures are matched by their opening line

### 🗒️ Changelog
See [CHANGELOG.md](./CHANGELOG.md) — current version: 2.0.0

### 🤝 Contributing
Issues & PRs welcome: open an issue describing improvement or inaccuracy with a minimal reproduction.

### 🧪 Testing
`npm test` runs compile + lint (via `pretest`) and then the VS Code integration tests:
```bash
npm install
npm test
```
> Note: the VS Code test runner cannot launch while another instance of VS Code is open — close it first.

### License
MIT

Enjoy coding! 🎉
