import * as vscode from 'vscode';

// Regex fallback patterns, used only when no language server provides document
// symbols. Capture group 1 is the indentation, group 2 the symbol name.
const CLASS_DEF_RE = /^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)/;
const FUNC_DEF_RE = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/;

type SymbolKind = 'class' | 'function' | 'method';

class PythonSymbolCodeLens extends vscode.CodeLens {
  constructor(
    range: vscode.Range,
    public readonly uri: vscode.Uri,
    public readonly name: string,
    public readonly kind: SymbolKind,
    // True when the symbol came from the language server's document-symbol
    // provider (semantic) rather than the regex fallback. Semantic references
    // are trusted as-is; regex-derived ones get heuristic post-filtering.
    public readonly semantic: boolean
  ) {
    super(range);
  }
}

interface ResolveCacheEntry {
  version: number;
  commands: Map<string, vscode.Command | null>;
}

// One frame per enclosing `class`/`def` block (regex fallback only), keyed by
// indentation, used to tell a method from a nested/plain function.
interface BlockFrame {
  indent: number;
  kind: 'class' | 'def';
}

export class PythonReferenceProvider implements vscode.CodeLensProvider {

  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  // Optional diagnostic sink. When provided (by activate), debug lines go to a
  // dedicated Output channel instead of the shared Debug Console.
  constructor(private readonly log?: vscode.LogOutputChannel) {}

  // Per-document cache of resolved commands, keyed by document version so it is
  // invalidated automatically on edits and explicitly on settings changes.
  private readonly resolveCache = new Map<string, ResolveCacheEntry>();

  /** Ask VS Code to re-resolve all CodeLenses (e.g. after a settings change). */
  public refresh(): void {
    this.resolveCache.clear();
    this._onDidChangeCodeLenses.fire();
  }

  public dispose(): void {
    this._onDidChangeCodeLenses.dispose();
    this.resolveCache.clear();
  }

  public async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    if (token.isCancellationRequested) { return []; }

    const cfg = vscode.workspace.getConfiguration('pythonReferenceCounter');
    const enableFor = cfg.get<'both' | 'classes' | 'functions'>('enableFor', 'both');
    const wants = (kind: SymbolKind) =>
      enableFor === 'both' || (kind === 'class' ? enableFor === 'classes' : enableFor === 'functions');

    // Preferred path: ask the language server for semantic document symbols.
    const semantic = await this.collectSemanticLenses(document, wants, token);
    if (semantic) { return semantic; }

    // Fallback path: regex scan (no language server available).
    return this.collectRegexLenses(document, wants, token);
  }

  // --- Semantic symbol collection (executeDocumentSymbolProvider) ---

  private async collectSemanticLenses(
    document: vscode.TextDocument,
    wants: (kind: SymbolKind) => boolean,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[] | null> {
    let symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined;
    try {
      symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
      );
    } catch (e) {
      this.logDebug('document symbol provider failed', e);
      return null;
    }
    if (!symbols || symbols.length === 0 || token.isCancellationRequested) { return null; }

    const lenses: vscode.CodeLens[] = [];
    this.walkSymbols(symbols, document, wants, lenses);
    return lenses;
  }

  private walkSymbols(
    symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[],
    document: vscode.TextDocument,
    wants: (kind: SymbolKind) => boolean,
    out: vscode.CodeLens[]
  ): void {
    for (const sym of symbols) {
      const kind = this.mapSymbolKind(sym.kind);
      const isDocSymbol = (sym as vscode.DocumentSymbol).selectionRange !== undefined;
      // DocumentSymbol.selectionRange is the name range (ideal anchor for the
      // reference query); SymbolInformation only exposes a coarse location.
      const range = isDocSymbol
        ? (sym as vscode.DocumentSymbol).selectionRange
        : (sym as vscode.SymbolInformation).location.range;

      if (kind && wants(kind)) {
        out.push(new PythonSymbolCodeLens(range, document.uri, sym.name, kind, true));
      }
      if (isDocSymbol) {
        const children = (sym as vscode.DocumentSymbol).children;
        if (children && children.length) {
          this.walkSymbols(children, document, wants, out);
        }
      }
    }
  }

  private mapSymbolKind(kind: vscode.SymbolKind): SymbolKind | null {
    switch (kind) {
      case vscode.SymbolKind.Class:
        return 'class';
      case vscode.SymbolKind.Method:
      case vscode.SymbolKind.Constructor:
        return 'method';
      case vscode.SymbolKind.Function:
        return 'function';
      default:
        return null;
    }
  }

  // --- Regex fallback symbol collection ---

  private collectRegexLenses(
    document: vscode.TextDocument,
    wants: (kind: SymbolKind) => boolean,
    token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const lines = document.getText().split(/\r?\n/);
    const blockStack: BlockFrame[] = [];
    let stringDelimiter: '"""' | "'''" | null = null;

    for (let i = 0; i < lines.length; i++) {
      if (token.isCancellationRequested) { break; }
      const line = lines[i];

      const wasInString = stringDelimiter !== null;
      stringDelimiter = this.updateStringState(line, stringDelimiter);
      if (wasInString) { continue; } // whole line was inside a multi-line string

      const classMatch = CLASS_DEF_RE.exec(line);
      const funcMatch = !classMatch ? FUNC_DEF_RE.exec(line) : null;
      const match = classMatch ?? funcMatch;
      if (!match) { continue; }

      const indent = match[1].length;
      while (blockStack.length > 0 && blockStack[blockStack.length - 1].indent >= indent) {
        blockStack.pop();
      }
      const enclosing = blockStack[blockStack.length - 1];

      if (classMatch) {
        blockStack.push({ indent, kind: 'class' });
        if (!wants('class')) { continue; }
        const name = classMatch[2];
        const idx = classMatch[0].length - name.length;
        lenses.push(new PythonSymbolCodeLens(this.nameRange(i, idx, name), document.uri, name, 'class', false));
      } else if (funcMatch) {
        blockStack.push({ indent, kind: 'def' });
        const name = funcMatch[2];
        const kind: SymbolKind = enclosing?.kind === 'class' ? 'method' : 'function';
        if (!wants(kind)) { continue; }
        const idx = funcMatch[0].length - name.length;
        lenses.push(new PythonSymbolCodeLens(this.nameRange(i, idx, name), document.uri, name, kind, false));
      }
    }
    return lenses;
  }

  private nameRange(line: number, startChar: number, name: string): vscode.Range {
    return new vscode.Range(new vscode.Position(line, startChar), new vscode.Position(line, startChar + name.length));
  }

  // Heuristic triple-quote tracker (regex fallback only). Returns the delimiter
  // still open at end of line, or null. Intentionally simple: ignores escapes
  // and quotes embedded in single-line strings.
  private updateStringState(line: string, current: '"""' | "'''" | null): '"""' | "'''" | null {
    let state = current;
    for (let i = 0; i < line.length; i++) {
      const triple = line.slice(i, i + 3);
      if (state === null) {
        if (triple === '"""' || triple === "'''") {
          state = triple as '"""' | "'''";
          i += 2;
        }
      } else if (triple === state) {
        state = null;
        i += 2;
      }
    }
    return state;
  }

  // --- Resolve ---

  public async resolveCodeLens(codeLens: vscode.CodeLens, token: vscode.CancellationToken): Promise<vscode.CodeLens> {
    if (!(codeLens instanceof PythonSymbolCodeLens) || token.isCancellationRequested) { return codeLens; }

    const posKey = `${codeLens.range.start.line}:${codeLens.range.start.character}`;
    const cached = this.getCachedCommand(codeLens.uri, posKey);
    if (cached !== undefined) {
      if (cached) { codeLens.command = cached; }
      return codeLens;
    }

    try {
      const cfg = vscode.workspace.getConfiguration('pythonReferenceCounter');
      const showZero = cfg.get<boolean>('showZeroReferences', true);
      const enableFallback = cfg.get<boolean>('enableFallbackWorkspaceScan', true);

      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        codeLens.uri,
        codeLens.range.start
      ) || [];

      // A working language server (e.g. Pylance) always returns at least the
      // declaration, so a non-empty result means references were resolved
      // semantically and should be trusted as-is — no expensive text scan.
      const languageServerResolved = locations.length > 0;
      let refs = this.dedupe(locations);

      // Trust semantic references; only post-filter the heuristic regex path.
      if (codeLens.kind === 'method' && !codeLens.semantic) {
        refs = await this.filterMethodReferences(refs, codeLens.name, token);
      }

      // The definition itself is never counted (matches the "N references"
      // convention used by PyCharm and VS Code's own reference CodeLens).
      refs = refs.filter(loc => !this.isDefinitionLocation(loc, codeLens));

      // Fallback only when no language server resolved the symbol at all (no
      // Python extension installed, or it has not indexed yet). This avoids
      // opening the whole workspace — and the false positives that come with a
      // naive text scan — whenever a real server is doing the work.
      if (enableFallback && !languageServerResolved && !token.isCancellationRequested) {
        try {
          const fallbackRefs = await this.fallbackWorkspaceSearch(codeLens, token);
          if (fallbackRefs.length > refs.length) {
            refs = fallbackRefs;
          }
        } catch (e) {
          this.logDebug('fallback scan failed', e);
        }
      }

      const count = refs.length;
      if (!showZero && count === 0) {
        this.setCachedCommand(codeLens.uri, posKey, null);
        return codeLens;
      }

      const command: vscode.Command = {
        title: `${count} reference${count === 1 ? '' : 's'}`,
        command: 'editor.action.showReferences',
        arguments: [codeLens.uri, codeLens.range.start, refs]
      };
      codeLens.command = command;
      this.setCachedCommand(codeLens.uri, posKey, command);
    } catch (err) {
      this.logDebug('resolve error', err);
      // Provide a valid (no-op) command so clicking the lens doesn't error.
      codeLens.command = { title: '? references', command: 'editor.action.showReferences', arguments: [codeLens.uri, codeLens.range.start, []] };
    }
    return codeLens;
  }

  private dedupe(locations: vscode.Location[]): vscode.Location[] {
    const seen = new Set<string>();
    const out: vscode.Location[] = [];
    for (const loc of locations) {
      const key = `${loc.uri.toString()}:${loc.range.start.line}:${loc.range.start.character}`;
      if (seen.has(key)) { continue; }
      seen.add(key);
      out.push(loc);
    }
    return out;
  }

  private isDefinitionLocation(loc: vscode.Location, lens: PythonSymbolCodeLens): boolean {
    return loc.uri.toString() === lens.uri.toString() && loc.range.start.isEqual(lens.range.start);
  }

  // --- Resolve cache helpers ---

  private documentVersion(uri: vscode.Uri): number | undefined {
    const key = uri.toString();
    return vscode.workspace.textDocuments.find(d => d.uri.toString() === key)?.version;
  }

  private getCachedCommand(uri: vscode.Uri, posKey: string): vscode.Command | null | undefined {
    const version = this.documentVersion(uri);
    if (version === undefined) { return undefined; }
    const entry = this.resolveCache.get(uri.toString());
    if (!entry || entry.version !== version) { return undefined; }
    return entry.commands.has(posKey) ? entry.commands.get(posKey)! : undefined;
  }

  private setCachedCommand(uri: vscode.Uri, posKey: string, command: vscode.Command | null): void {
    const version = this.documentVersion(uri);
    if (version === undefined) { return; }
    const key = uri.toString();
    let entry = this.resolveCache.get(key);
    if (!entry || entry.version !== version) {
      entry = { version, commands: new Map() };
      this.resolveCache.set(key, entry);
    }
    entry.commands.set(posKey, command);
  }

  // --- Method reference heuristics (regex fallback path) ---

  private async filterMethodReferences(references: vscode.Location[], methodName: string, token: vscode.CancellationToken): Promise<vscode.Location[]> {
    const filtered: vscode.Location[] = [];
    const docCache = new Map<string, vscode.TextDocument>();

    for (const ref of references) {
      if (token.isCancellationRequested) { break; }
      try {
        const key = ref.uri.toString();
        let doc = docCache.get(key);
        if (!doc) {
          doc = await vscode.workspace.openTextDocument(ref.uri);
          docCache.set(key, doc);
        }
        const lineText = doc.lineAt(ref.range.start.line).text;
        if (this.isValidMethodReference(lineText, ref.range.start.character, methodName)) {
          filtered.push(ref);
        }
      } catch {
        // If we fail to read a document, conservatively keep the reference.
        filtered.push(ref);
      }
    }
    return filtered;
  }

  private isValidMethodReference(lineText: string, startChar: number, methodName: string): boolean {
    const beforeChar = startChar > 0 ? lineText[startChar - 1] : '';
    // Only treat attribute access (object.method) as a call-site candidate.
    if (beforeChar !== '.') { return false; }

    const trimmed = lineText.trimStart();
    if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
      const defMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)/);
      if (defMatch && defMatch[1] === methodName) { return false; }
    }
    if (trimmed.startsWith('class ')) { return false; }
    return true;
  }

  // Naive workspace-wide text search, used only when the official reference
  // provider yields no (or only local) results. Regex-based, so it may over-count
  // in strings; it does skip obvious line comments. Uses stable findFiles APIs.
  private async fallbackWorkspaceSearch(lens: PythonSymbolCodeLens, token: vscode.CancellationToken): Promise<vscode.Location[]> {
    const results: vscode.Location[] = [];
    const exclude = '**/{.venv,venv,site-packages,dist,build,__pycache__,node_modules,.git}/**';
    const files = await vscode.workspace.findFiles('**/*.py', exclude);
    if (token.isCancellationRequested) { return results; }

    const escaped = lens.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRe = new RegExp(`\\b${escaped}\\b`, 'g');

    for (const uri of files) {
      if (token.isCancellationRequested) { break; }
      let doc: vscode.TextDocument;
      try {
        doc = await vscode.workspace.openTextDocument(uri);
      } catch {
        continue;
      }
      const sameFile = uri.toString() === lens.uri.toString();
      const text = doc.getText();
      wordRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = wordRe.exec(text)) !== null) {
        const start = doc.positionAt(match.index);
        const lineText = doc.lineAt(start.line).text;
        const before = lineText.slice(0, start.character);

        // Skip occurrences that appear after a `#` comment marker on the line.
        if (before.includes('#')) { continue; }
        // Never count the definition itself.
        if (sameFile && start.isEqual(lens.range.start)) { continue; }
        if (this.isDefinitionOf(before, lineText, start.character, lens.name)) { continue; }
        if (lens.kind === 'method' && !this.isValidMethodReference(lineText, start.character, lens.name)) {
          continue;
        }

        const end = new vscode.Position(start.line, start.character + lens.name.length);
        results.push(new vscode.Location(uri, new vscode.Range(start, end)));
      }
    }
    return this.dedupe(results);
  }

  // True when the name at this position is the symbol being *defined* on the line
  // (directly following `def `/`class `), not a reference to it.
  private isDefinitionOf(before: string, lineText: string, startChar: number, name: string): boolean {
    return /(?:^|\s)(?:async\s+def|def|class)\s+$/.test(before) && lineText.startsWith(name, startChar);
  }

  private logDebug(message: string, err?: unknown): void {
    // LogOutputChannel honours the user's log-level setting, so this is quiet by
    // default and never pollutes the shared Debug Console.
    this.log?.debug(err === undefined ? message : `${message}: ${String(err)}`);
  }
}


// Known Python extensions that provide a semantic reference/symbol server.
const PYTHON_SERVER_EXTENSIONS = ['ms-python.python', 'ms-python.vscode-pylance'];
const SERVER_HINT_DISMISSED_KEY = 'pythonReferenceCounter.serverHintDismissed';

// Entry function called when the extension is activated.
export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Python Reference Counter', { log: true });
  log.info('Python Reference Counter activated');

  const selector = { language: 'python', scheme: 'file' };
  const provider = new PythonReferenceProvider(log);
  context.subscriptions.push(
    log,
    provider,
    vscode.languages.registerCodeLensProvider(selector, provider)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('pythonReferenceCounter')) {
        provider.refresh();
      }
    })
  );

  // A semantic server (Pylance) makes counts accurate and avoids the slow text
  // scan, so nudge — once — toward installing it when none is present.
  maybeRecommendPythonServer(context, provider);
}

function hasPythonLanguageServer(): boolean {
  return PYTHON_SERVER_EXTENSIONS.some(id => vscode.extensions.getExtension(id) !== undefined);
}

async function maybeRecommendPythonServer(context: vscode.ExtensionContext, provider: PythonReferenceProvider): Promise<void> {
  if (hasPythonLanguageServer() || context.globalState.get<boolean>(SERVER_HINT_DISMISSED_KEY)) {
    return;
  }

  // Re-check once new extensions finish loading, then refresh lenses so counts
  // upgrade to semantic results automatically if a server appears.
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      if (hasPythonLanguageServer()) { provider.refresh(); }
    })
  );

  const install = 'Install Python extension';
  const dontShow = "Don't show again";
  const choice = await vscode.window.showInformationMessage(
    'Python Reference Counter is most accurate and fastest with a Python language server. Install the official Python extension (Pylance) for semantic reference counts?',
    install,
    dontShow
  );
  if (choice === install) {
    await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-python.python');
  } else if (choice === dontShow) {
    await context.globalState.update(SERVER_HINT_DISMISSED_KEY, true);
  }
}

// Called when the extension is deactivated. The output channel and providers are
// disposed automatically via context.subscriptions.
export function deactivate() {
  // No-op: cleanup is handled by registered disposables.
}
