# Changelog

**English** | [简体中文](./CHANGELOG.zh-CN.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres (as applicable) to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] - 2026-07-11
### Fixed
- Explorer file tree no longer flickers on WSL/macOS. The no-server fallback used to open every workspace `.py` file, once per symbol, and it fired while a real language server (Pylance) was merely still indexing (reference queries momentarily return empty). It now runs only when there is genuinely no Python language server installed, reads file bytes via `fs.readFile` instead of opening documents, and shares a short-lived scan across a file's symbols
- Inaccurate counts while a language server is indexing. Present-but-not-yet-ready servers no longer fall through to the over-counting regex text scan; the count is left uncached and a bounded re-resolve corrects it automatically once indexing finishes (no manual edit needed)
- Refresh CodeLenses when a Python language server is enabled/disabled after activation, so counts upgrade to (or fall back from) semantic results automatically

## [2.0.0] - 2026-05-30
### Added
- `pythonReferenceCounter.enableFallbackWorkspaceScan` setting (default `true`) to control the no-language-server text-scan safety net
- `pythonReferenceCounter.enableFor` setting (`both` | `classes` | `functions`, default `both`) replacing the separate class/function toggles

### Removed (breaking)
- Removed `pythonReferenceCounter.enableForClasses` and `pythonReferenceCounter.enableForFunctions` — use the single `enableFor` setting instead
- Removed `pythonReferenceCounter.includeDefinition`: the definition is now always excluded from the count, matching the "N references" convention used by PyCharm and VS Code's own reference CodeLens

### Fixed
- CodeLens now points at the symbol name instead of the keyword for short names (e.g. `def f`), so reference resolution works for them
- Settings changes now refresh CodeLenses immediately via `onDidChangeCodeLenses` (previously the no-arg `executeCodeLensProvider` call did nothing)
- Rewrote the fallback workspace scan to use the stable `findFiles` API with correct async handling (the previous `findTextInFiles` path was a proposed API that silently failed / could hang in released VS Code)
- Error fallback lens no longer carries an empty command string
- Diagnostic logging now uses a dedicated output channel (Output ▸ "Python Reference Counter") instead of writing to the shared Debug Console

### Performance & accuracy
- The naive workspace text scan now runs only when the language server resolves nothing for a symbol (no Python extension, or not yet indexed). Previously it could open every `.py` file whenever references looked local-only; now semantic results from Pylance are trusted directly, removing both the I/O cost and the false positives from comments/strings
- Detects when no Python language server is installed and offers (once) to install the official Python extension; refreshes counts automatically if a server appears later

### Changed
- Symbol detection now prefers `vscode.executeDocumentSymbolProvider` (semantic: exact name ranges and correct class/function/method kinds), falling back to the regex scan only when no language server responds
- Reference counts are de-duplicated; method dot-filtering is applied only on the regex fallback path (semantic references are trusted as-is)
- Resolved counts are cached per document version (cleared on edits and settings changes) to keep scrolling responsive
- Regex fallback: classifies methods vs. nested/plain functions via enclosing block and skips `class`/`def` text inside triple-quoted strings; workspace fallback scan skips line comments
- Moved `@vscode/vsce` to `devDependencies` so it is not bundled into the published VSIX
- `.vscodeignore` no longer ships compiled tests, source maps, or `.vscode-test.mjs`
- Bumped `@vscode/vsce` to ^3.9.1 and pinned patched transitive deps; `npm audit` reports 0 vulnerabilities
- README requirements/limitations clarified to match actual behavior

## [1.0.0] - 2025-08-08
### Added
- Initial release
- CodeLens reference counts for Python functions, methods, and classes
- Smart filtering for method call sites (exclude definitions / class headers)
- Settings: showZeroReferences, includeDefinition, enableForClasses, enableForFunctions, enableFallbackWorkspaceScan

---

[2.0.1]: https://github.com/maxim-lapan/python-reference-counter/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/maxim-lapan/python-reference-counter/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/maxim-lapan/python-reference-counter/releases/tag/v1.0.0