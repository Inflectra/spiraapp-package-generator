'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

// index.js has a side effect (calls exports.package() at load time).
// Suppress the console output and tolerate the missing manifest error.
const originalLog = console.log;
console.log = () => {};
let formatEsbuildError;
try {
  ({ formatEsbuildError } = require('../index.js'));
} finally {
  console.log = originalLog;
}

// ─── Property 8: Error format matches exact pattern ──────────────────────────
// Feature: 2025-08-18-tsx-babel-bundling, Property 8: Error format matches exact pattern

describe('formatEsbuildError - Property 8: Error format matches exact pattern', () => {
  /**
   * Validates: Requirements 3.1, 3.4, 3.5
   *
   * For any esbuild error with a non-null location (containing a filename,
   * line number > 0, column number >= 0, and description text), the formatted
   * error message SHALL match the pattern:
   * "Error in <filename> (line <N>, col <M>): <description>"
   */
  test('output always matches "Error in <filename> (line <N>, col <M>): <description>" when location is present', () => {
    fc.assert(
      fc.property(
        // Random filename with .tsx extension (non-empty base)
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\n') && !s.includes('\r')).map(s => s + '.tsx'),
        // Line number > 0
        fc.integer({ min: 1, max: 100000 }),
        // Column number >= 0
        fc.integer({ min: 0, max: 100000 }),
        // Description text (non-empty, no newlines for clean formatting)
        fc.string({ minLength: 1, maxLength: 200 }).filter(s => !s.includes('\n') && !s.includes('\r')),
        (fileName, line, column, description) => {
          const error = {
            text: description,
            location: { line, column }
          };

          const result = formatEsbuildError(fileName, error);
          const expected = `Error in ${fileName} (line ${line}, col ${column}): ${description}`;

          assert.equal(result, expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 1: TSX compilation produces valid JavaScript ───────────────────
// Feature: 2025-08-18-tsx-babel-bundling, Property 1: TSX compilation produces valid JavaScript

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Import compileTsx (suppress console output during require - already done above)
const originalLog2 = console.log;
console.log = () => {};
let compileTsx;
try {
  ({ compileTsx } = require('../index.js'));
} finally {
  console.log = originalLog2;
}

// ─── Property 2: Multi-file imports produce single self-contained output ─────
// Feature: 2025-08-18-tsx-babel-bundling, Property 2: Multi-file imports produce single self-contained output

describe('compileTsx - Property 2: Multi-file imports produce single self-contained output', () => {
  /**
   * Validates: Requirements 1.5, 5.3
   *
   * For any TSX entry point that imports from one or more relative-path modules,
   * compiling it with compileTsx SHALL produce a single string containing the
   * implementation from all imported modules, with no remaining import or require
   * statements for those relative modules.
   */

  // Generator for valid JS identifiers (used as function names and module names)
  const identArb = fc.stringMatching(/^[a-z][a-zA-Z]{1,7}$/);

  // Generator for a unique list of helper module descriptors
  const helperModulesArb = fc.array(
    fc.tuple(identArb, identArb),
    { minLength: 1, maxLength: 4 }
  ).map(pairs => {
    // Deduplicate module names and function names
    const seen = new Set();
    return pairs.filter(([modName, fnName]) => {
      const key = `${modName}-${fnName}`;
      if (seen.has(modName) || seen.has(fnName)) return false;
      seen.add(modName);
      seen.add(fnName);
      return true;
    });
  }).filter(arr => arr.length >= 1);

  test('compiled output contains all helper implementations and no relative import/require statements', () => {
    fc.assert(
      fc.property(helperModulesArb, (helpers) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsx-prop2-'));

        try {
          // Write helper modules — each exports a function that assigns to globalThis
          // using a unique marker string we can search for in the output
          for (const [modName, fnName] of helpers) {
            const marker = `__marker_${fnName}__`;
            const helperSource = [
              `export function ${fnName}(): string {`,
              `  return "${marker}";`,
              `}`,
            ].join('\n');
            fs.writeFileSync(path.join(tmpDir, `${modName}.tsx`), helperSource, 'utf8');
          }

          // Write entry point that imports all helpers and uses them via globalThis
          const imports = helpers.map(([modName, fnName]) =>
            `import { ${fnName} } from "./${modName}";`
          ).join('\n');

          const usages = helpers.map(([, fnName]) =>
            `(globalThis as any).${fnName} = ${fnName}();`
          ).join('\n');

          const entrySource = [imports, usages].join('\n');
          const entryPath = path.join(tmpDir, 'entry.tsx');
          fs.writeFileSync(entryPath, entrySource, 'utf8');

          // Compile the entry point
          const result = compileTsx(entryPath);

          // Should compile without errors
          assert.equal(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors)}`);
          assert.ok(result.code.length > 0, 'Output code should not be empty');

          const output = result.code;

          // All helper function marker strings must be present in the bundled output
          for (const [, fnName] of helpers) {
            const marker = `__marker_${fnName}__`;
            assert.ok(
              output.includes(marker),
              `Output should contain marker "${marker}" from helper function ${fnName}. Output start: ${output.substring(0, 300)}`
            );
          }

          // No remaining relative import statements (ESM style)
          // Match: import ... from "./..." or import ... from '../...'
          assert.ok(
            !/\bimport\b[^;]*from\s+['"]\.\.?\//.test(output),
            `Output should not contain relative ESM import statements. Output start: ${output.substring(0, 300)}`
          );

          // No remaining relative require statements (CJS style)
          // Match: require("./...") or require('../...')
          assert.ok(
            !/\brequire\s*\(\s*['"]\.\.?\//.test(output),
            `Output should not contain relative require statements. Output start: ${output.substring(0, 300)}`
          );
        } finally {
          // Cleanup temp directory
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('compileTsx - Property 1: TSX compilation produces valid JavaScript', () => {
  /**
   * Validates: Requirements 1.1, 1.2, 1.3
   *
   * For any valid TSX source file containing TypeScript type annotations and/or
   * JSX expressions, compileTsx SHALL produce output that:
   * - Contains no TypeScript-specific syntax (interface/type declarations)
   * - Contains no raw JSX syntax
   * - Contains React.createElement calls where JSX was present
   */

  // Generator for random identifiers (valid JS/TS identifiers)
  const identifierArb = fc.string({ minLength: 1, maxLength: 8 })
    .filter(s => /^[a-zA-Z]/.test(s))
    .map(s => s.replace(/[^a-zA-Z0-9]/g, 'a'));

  // Generator for random property names
  const propNameArb = fc.constantFrom('x', 'y', 'name', 'value', 'count', 'label', 'id', 'data');

  // Generator for random TS type annotations
  const typeAnnotationArb = fc.constantFrom(
    'string', 'number', 'boolean', 'any', 'void', 'null', 'undefined'
  );

  // Generator for a TypeScript interface declaration
  const interfaceDeclArb = fc.tuple(identifierArb, propNameArb, typeAnnotationArb)
    .map(([name, prop, type]) => `interface ${name} { ${prop}: ${type}; }`);

  // Generator for a TypeScript type alias declaration
  const typeAliasDeclArb = fc.tuple(identifierArb, typeAnnotationArb)
    .map(([name, type]) => `type ${name} = ${type};`);

  // Generator for simple JSX expressions
  const jsxElementArb = fc.constantFrom(
    '<div>hello</div>',
    '<span>world</span>',
    '<p>text</p>',
    '<div><span>nested</span></div>',
    '<h1>title</h1>'
  );

  // Generator for a complete valid TSX source file
  // We assign the JSX to a global variable so esbuild doesn't tree-shake it away
  const tsxSourceArb = fc.tuple(
    fc.array(interfaceDeclArb, { minLength: 1, maxLength: 3 }),
    fc.array(typeAliasDeclArb, { minLength: 0, maxLength: 2 }),
    jsxElementArb,
    identifierArb
  ).map(([interfaces, typeAliases, jsx, fnName]) => {
    const ifaceLines = interfaces.join('\n');
    const typeLines = typeAliases.join('\n');
    // Use globalThis assignment to prevent tree-shaking of the JSX output
    return [
      ifaceLines,
      typeLines,
      `function ${fnName}() {`,
      `  return (${jsx});`,
      `}`,
      `(globalThis as any).render = ${fnName};`,
    ].join('\n');
  });

  let tmpDir;

  test('compiled output has no TS syntax, no raw JSX, and contains React.createElement', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsx-prop1-'));

    fc.assert(
      fc.property(tsxSourceArb, (source) => {
        const filePath = path.join(tmpDir, 'test.tsx');
        fs.writeFileSync(filePath, source, 'utf8');

        try {
          const result = compileTsx(filePath);

          // Should compile without errors
          assert.equal(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors)}`);
          assert.ok(result.code.length > 0, 'Output code should not be empty');

          const output = result.code;

          // No TypeScript interface declarations remaining
          // Match "interface" as a declaration keyword (preceded by start-of-line or semicolon/brace, not as part of another word)
          assert.ok(
            !/\binterface\s+[A-Z]/.test(output),
            `Output should not contain interface declarations. Found in: ${output.substring(0, 200)}`
          );

          // No TypeScript type alias declarations remaining
          // Match "type <Identifier> =" pattern (not "typeof" or "type" in strings)
          assert.ok(
            !/\btype\s+[A-Z]\w*\s*=/.test(output),
            `Output should not contain type alias declarations. Found in: ${output.substring(0, 200)}`
          );

          // No raw JSX angle bracket syntax like <div> or <Component
          // The compiled output is an IIFE, so < can appear in comparisons.
          // JSX tags start with < followed by a letter (uppercase or lowercase tag name)
          // In compiled output, these should be replaced with React.createElement
          assert.ok(
            !/<[a-z][a-z0-9]*[\s>]/.test(output) && !/<[a-z][a-z0-9]*\/>/.test(output),
            `Output should not contain raw JSX HTML tags. Found in: ${output.substring(0, 200)}`
          );

          // Output MUST contain React.createElement since JSX was present
          assert.ok(
            output.includes('React.createElement'),
            `Output should contain React.createElement calls since source had JSX. Output: ${output.substring(0, 200)}`
          );
        } finally {
          // Cleanup temp file
          try { fs.unlinkSync(filePath); } catch {}
        }
      }),
      { numRuns: 100 }
    );

    // Cleanup temp directory
    try { fs.rmdirSync(tmpDir); } catch {}
  });
});


// ─── Property 3: Bare specifiers are treated as external ─────────────────────
// Feature: 2025-08-18-tsx-babel-bundling, Property 3: Bare specifiers are treated as external

describe('compileTsx - Property 3: Bare specifiers are treated as external', () => {
  /**
   * Validates: Requirements 4.5
   *
   * For any TSX file that imports from a bare specifier (a module name not
   * starting with `.` or `/`), compiling it with compileTsx SHALL NOT fail
   * with an unresolved import error, and the output SHALL contain a reference
   * to that external module (via `require` in the IIFE wrapper) rather than
   * inlining its contents.
   */

  // Generator for valid npm package-like bare specifier names
  // Covers: simple names (lodash), hyphenated (my-lib), and scoped (@scope/pkg)
  const simplePackageNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}[a-z0-9]$/)
    .filter(s => s.length >= 2 && !s.includes('--'));

  const scopedPackageNameArb = fc.tuple(
    fc.stringMatching(/^[a-z][a-z0-9-]{0,6}[a-z0-9]$/),
    fc.stringMatching(/^[a-z][a-z0-9-]{0,6}[a-z0-9]$/)
  ).map(([scope, pkg]) => `@${scope}/${pkg}`);

  const bareSpecifierArb = fc.oneof(simplePackageNameArb, scopedPackageNameArb);

  test('bare specifier imports compile without errors and produce require() calls in output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsx-prop3-'));

    try {
      fc.assert(
        fc.property(bareSpecifierArb, (moduleName) => {
          // Create a TSX file that imports from the bare specifier
          // Use the import in a way that prevents tree-shaking
          const source = [
            `import ext from '${moduleName}';`,
            `(globalThis as any).result = ext;`,
          ].join('\n');

          const filePath = path.join(tmpDir, 'test-bare.tsx');
          fs.writeFileSync(filePath, source, 'utf8');

          const result = compileTsx(filePath);

          // Compilation must succeed (no errors)
          assert.equal(
            result.errors.length, 0,
            `Compilation should not fail for bare specifier "${moduleName}". Errors: ${JSON.stringify(result.errors)}`
          );
          assert.ok(result.code.length > 0, 'Output code should not be empty');

          // Output must contain a require() call for the bare specifier
          // esbuild IIFE format with packages:'external' emits require("moduleName")
          const requirePattern = `require("${moduleName}")`;
          assert.ok(
            result.code.includes(requirePattern),
            `Output should contain ${requirePattern} for external bare specifier. Output start: ${result.code.substring(0, 400)}`
          );

          // The module's source should NOT be inlined — since it's external,
          // there should be no function body from the module, just the require call.
          // We verify by checking that there's no "module.exports" or large inlined block
          // beyond what the IIFE wrapper itself provides.
          // A simpler check: the output should not contain a second IIFE wrapping the external module.
          // The key invariant is that require() is present — already checked above.
        }),
        { numRuns: 100 }
      );
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});


// ─── Property 5: Warning logged if and only if file:// pattern present in TSX output ─
// Feature: 2025-08-18-tsx-babel-bundling, Property 5: Warning logged if and only if file:// pattern present in TSX output

const { execFileSync } = require('node:child_process');

describe('injectFile TSX branch - Property 5: Warning logged iff file:// pattern present', () => {
  /**
   * Validates: Requirements 2.2
   *
   * For any compiled TSX output string, a warning SHALL be logged to the console
   * if and only if the string contains one or more matches of FILENAME_WITH_PREFIX_REGEX.
   *
   * Strategy: Generate TSX source files that produce output with and without
   * file:// patterns (via string literals that survive compilation). Run the full
   * bundler pipeline via subprocess and check captured stdout for warnings.
   */

  // The regex used by the bundler to detect file:// patterns
  const FILENAME_WITH_PREFIX_REGEX = /file:\/\/[^/\\]+?\.\w+/g;

  // Generator for valid filenames matching the file:// pattern (no slashes, has extension)
  const filePatternNameArb = fc.tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
    fc.constantFrom('js', 'tsx', 'css', 'html', 'json', 'ts')
  ).map(([base, ext]) => `file://${base}.${ext}`);

  // Generator for safe string content that does NOT match the file:// regex
  const safeStringArb = fc.constantFrom(
    'hello world',
    'no pattern here',
    'just a regular string',
    'https://example.com/page',
    'file:// missing-dot-extension',
    '12345',
    'React component output'
  );

  // Generator that produces TSX source code embedding a string literal
  // The string literal survives esbuild compilation inside the IIFE
  const tsxWithPatternArb = filePatternNameArb.map(pattern =>
    `(globalThis as any).data = "${pattern}";`
  );

  const tsxWithoutPatternArb = safeStringArb.map(safe =>
    `(globalThis as any).data = "${safe}";`
  );

  // Combined generator: randomly produces TSX with or without file:// patterns
  const tsxSourceArb = fc.oneof(tsxWithPatternArb, tsxWithoutPatternArb);

  test('warning is logged iff compiled output contains file:// pattern matching FILENAME_WITH_PREFIX_REGEX', () => {
    fc.assert(
      fc.property(tsxSourceArb, (tsxSource) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsx-prop5-'));
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsx-prop5-out-'));

        try {
          // Write the TSX source file
          fs.writeFileSync(path.join(tmpDir, 'app.tsx'), tsxSource, 'utf8');

          // Write a minimal manifest that references the TSX file
          const manifest = [
            'guid: "12345678-1234-1234-1234-123456789012"',
            'name: TestApp',
            'version: 1.0',
            'description: "file://app.tsx"',
          ].join('\n');
          fs.writeFileSync(path.join(tmpDir, 'manifest.yaml'), manifest, 'utf8');

          // Compile with compileTsx to determine expected behavior
          const compiled = compileTsx(path.join(tmpDir, 'app.tsx'));
          assert.equal(compiled.errors.length, 0, `Compilation should succeed: ${JSON.stringify(compiled.errors)}`);

          const regexMatches = compiled.code.match(FILENAME_WITH_PREFIX_REGEX);
          const shouldWarn = regexMatches !== null && regexMatches.length > 0;

          // Run the bundler as a subprocess to capture actual console output
          let stdout = '';
          try {
            stdout = execFileSync('node', ['index.js'], {
              cwd: path.resolve(__dirname, '..'),
              env: {
                ...process.env,
                npm_config_input: tmpDir,
                npm_config_output: outputDir,
                npm_config_debug: 'true', // skip minification for cleaner output
              },
              encoding: 'utf8',
              timeout: 10000,
            });
          } catch (e) {
            // execFileSync throws on non-zero exit, but we can still read stdout
            stdout = e.stdout || '';
          }

          const warningLogged = stdout.includes('Warning: file:// pattern found in compiled TSX output');

          // The biconditional: warning logged iff regex matches
          assert.equal(
            warningLogged,
            shouldWarn,
            shouldWarn
              ? `Expected warning for pattern in output but got none. Output start: ${compiled.code.substring(0, 200)}`
              : `Unexpected warning when no file:// pattern present. Stdout: ${stdout.substring(0, 300)}`
          );
        } finally {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch {}
        }
      }),
      { numRuns: 100 }
    );
  });
});
