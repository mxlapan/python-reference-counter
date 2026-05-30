import * as assert from 'assert';
import * as vscode from 'vscode';
import { PythonReferenceProvider } from '../extension';

// NOTE: These tests cover lightweight parsing logic (definition recognition,
// method vs. function classification, string skipping, name positioning)
// without invoking the real reference provider.

suite('PythonReferenceProvider parsing', () => {
	const provider = new PythonReferenceProvider();

	function createDoc(text: string): vscode.TextDocument {
		// Minimal in-memory TextDocument sufficient for provideCodeLenses.
		return new (class implements vscode.TextDocument {
			uri = vscode.Uri.file('/fake.py');
			fileName = 'fake.py';
			isUntitled = false; languageId = 'python'; version = 1; isDirty = false; isClosed = false;
			encoding = 'utf8';
			eol = vscode.EndOfLine.LF; lineCount = text.split('\n').length;
			save(): Thenable<boolean> { return Promise.resolve(true); }
			lineAt(line: number | vscode.Position): vscode.TextLine {
				const n = typeof line === 'number' ? line : line.line;
				const l = text.split('\n')[n];
				return {
					lineNumber: n,
					text: l,
					range: new vscode.Range(new vscode.Position(n, 0), new vscode.Position(n, l.length)),
					rangeIncludingLineBreak: new vscode.Range(new vscode.Position(n, 0), new vscode.Position(n, l.length)),
					firstNonWhitespaceCharacterIndex: l.length - l.trimStart().length,
					isEmptyOrWhitespace: l.trim().length === 0,
				};
			}
			offsetAt(pos: vscode.Position): number {
				const lines = text.split('\n');
				let off = 0;
				for (let i = 0; i < pos.line; i++) { off += lines[i].length + 1; }
				return off + pos.character;
			}
			positionAt(offset: number): vscode.Position {
				const lines = text.split('\n');
				let off = 0;
				for (let i = 0; i < lines.length; i++) {
					if (off + lines[i].length >= offset) { return new vscode.Position(i, offset - off); }
					off += lines[i].length + 1;
				}
				return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
			}
			getText(range?: vscode.Range): string {
				if (!range) { return text; }
				return text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
			}
			getWordRangeAtPosition(): vscode.Range | undefined { return undefined; }
			validateRange(r: vscode.Range): vscode.Range { return r; }
			validatePosition(p: vscode.Position): vscode.Position { return p; }
		})();
	}

	const token = () => new vscode.CancellationTokenSource().token;
	// PythonSymbolCodeLens is not exported; read its public fields structurally.
	const kindOf = (l: vscode.CodeLens) => (l as unknown as { kind: string }).kind;
	const nameOf = (l: vscode.CodeLens) => (l as unknown as { name: string }).name;

	test('detects class, function and method', async () => {
		const doc = createDoc(['class A:', '    def m(self):', '', 'def top():'].join('\n'));
		const lenses = await provider.provideCodeLenses(doc, token());
		assert.strictEqual(lenses.length, 3);
		const byName = new Map(lenses.map(l => [nameOf(l), kindOf(l)]));
		assert.strictEqual(byName.get('A'), 'class');
		assert.strictEqual(byName.get('m'), 'method');
		assert.strictEqual(byName.get('top'), 'function');
	});

	test('nested function inside a method is a function, not a method', async () => {
		const source = [
			'class A:',
			'    def helper(self):',
			'        def inner():',
			'            pass',
			'def top():',
			'    pass',
		].join('\n');
		const lenses = await provider.provideCodeLenses(createDoc(source), token());
		const byName = new Map(lenses.map(l => [nameOf(l), kindOf(l)]));
		assert.strictEqual(byName.get('helper'), 'method');
		assert.strictEqual(byName.get('inner'), 'function');
		assert.strictEqual(byName.get('top'), 'function');
	});

	test('ignores class/def text inside triple-quoted strings', async () => {
		const source = [
			'def real():',
			'    """',
			'    class Fake:',
			'    def fake():',
			'    """',
			'    pass',
		].join('\n');
		const lenses = await provider.provideCodeLenses(createDoc(source), token());
		assert.deepStrictEqual(lenses.map(nameOf), ['real']);
	});

	test('positions the lens on the symbol name, not the keyword (short names)', async () => {
		const doc = createDoc('def f():');
		const [lens] = await provider.provideCodeLenses(doc, token());
		assert.strictEqual(lens.range.start.character, 4, 'should point at "f", not the "f" in "def"');
		assert.strictEqual(doc.getText(lens.range), 'f');
	});

	test('handles async def and reports name correctly', async () => {
		const doc = createDoc('    async def fetch(self):');
		const [lens] = await provider.provideCodeLenses(doc, token());
		assert.strictEqual(nameOf(lens), 'fetch');
		assert.strictEqual(kindOf(lens), 'function'); // no enclosing class in this snippet
		assert.strictEqual(doc.getText(lens.range), 'fetch');
	});

	test('respects enable toggles indirectly via empty config defaults', async () => {
		// Both classes and functions enabled by default -> 2 lenses.
		const doc = createDoc(['class A:', 'def b():'].join('\n'));
		const lenses = await provider.provideCodeLenses(doc, token());
		assert.strictEqual(lenses.length, 2);
	});
});
