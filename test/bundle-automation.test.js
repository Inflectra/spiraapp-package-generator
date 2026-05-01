'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  parseArgs,
  deriveOutputFolder,
  loadEnv,
  bumpVersion,
  readManifest,
  normalizeBaseUrl,
  formatError,
  runBuild,
} = require('../bundle-automation.js');

// ─── parseArgs ───────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spira-test-'));
    fs.writeFileSync(path.join(tmpDir, 'manifest.yaml'), 'name: Test\nversion: 1.0\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns inputFolder when --input=<value> is provided', () => {
    const result = parseArgs(['node', 'script.js', `--input=${tmpDir}`]);
    assert.equal(result.inputFolder, path.resolve(tmpDir));
  });

  test('returns inputFolder when --input <value> is provided', () => {
    const result = parseArgs(['node', 'script.js', '--input', tmpDir]);
    assert.equal(result.inputFolder, path.resolve(tmpDir));
  });

  test('exits with code 1 when --input is missing', () => {
    const originalExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; throw new Error('exit'); };
    try {
      parseArgs(['node', 'script.js']);
    } catch {}
    process.exit = originalExit;
    assert.equal(exitCode, 1);
  });

  test('exits with code 1 when --input is empty', () => {
    const originalExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; throw new Error('exit'); };
    try {
      parseArgs(['node', 'script.js', '--input=']);
    } catch {}
    process.exit = originalExit;
    assert.equal(exitCode, 1);
  });

  test('exits with code 1 when manifest.yaml is missing', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spira-empty-'));
    const originalExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; throw new Error('exit'); };
    try {
      parseArgs(['node', 'script.js', `--input=${emptyDir}`]);
    } catch {}
    process.exit = originalExit;
    fs.rmSync(emptyDir, { recursive: true, force: true });
    assert.equal(exitCode, 1);
  });

  test('returns uploadOnly: false when --upload flag is absent', () => {
    const result = parseArgs(['node', 'script.js', `--input=${tmpDir}`]);
    assert.equal(result.uploadOnly, false);
  });

  test('returns uploadOnly: true when --upload flag is present', () => {
    const result = parseArgs(['node', 'script.js', `--input=${tmpDir}`, '--upload']);
    assert.equal(result.uploadOnly, true);
  });

  test('returns uploadOnly: true when --upload appears before --input', () => {
    const result = parseArgs(['node', 'script.js', '--upload', `--input=${tmpDir}`]);
    assert.equal(result.uploadOnly, true);
  });

  test('returns both inputFolder and uploadOnly in result', () => {
    const result = parseArgs(['node', 'script.js', `--input=${tmpDir}`, '--upload']);
    assert.equal(result.inputFolder, path.resolve(tmpDir));
    assert.equal(result.uploadOnly, true);
  });
});

// ─── deriveOutputFolder ───────────────────────────────────────────────────────

describe('deriveOutputFolder', () => {
  test('appends Bundle to folder name', () => {
    const result = deriveOutputFolder('/path/to/AIConnect');
    assert.equal(result, '/path/to/AIConnectBundle');
  });

  test('works with trailing slash stripped by path.resolve', () => {
    const input = path.resolve('/path/to/MyApp');
    const result = deriveOutputFolder(input);
    assert.equal(result, path.join('/path/to', 'MyAppBundle'));
  });

  test('works with nested paths', () => {
    const result = deriveOutputFolder('/a/b/c/MySpiraApp');
    assert.equal(result, '/a/b/c/MySpiraAppBundle');
  });

  test('result equals path.join(dirname, basename + Bundle)', () => {
    const input = '/users/dev/projects/CoolApp';
    const expected = path.join(path.dirname(input), path.basename(input) + 'Bundle');
    assert.equal(deriveOutputFolder(input), expected);
  });
});

// ─── loadEnv ─────────────────────────────────────────────────────────────────

describe('loadEnv', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.DOTENV_SKIP = '1';
    delete process.env.SPIRA_BASE_URL;
    delete process.env.SPIRA_USERNAME;
    delete process.env.SPIRA_PASSWORD;
    delete process.env.SPIRA_ENABLE_PROJECT_IDS;
    delete process.env.SPIRA_DISABLE_PROJECT_IDS;
    delete process.env.PLAYWRIGHT_HEADLESS;
    delete process.env.SPIRA_ENABLE_DEV_MODE;
    delete process.env.SPIRA_INCREMENT_VERSION;
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => delete process.env[k]);
    Object.assign(process.env, originalEnv);
  });

  test('returns config when all required vars are present', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    const config = loadEnv();
    assert.equal(config.baseUrl, 'https://example.com');
    assert.equal(config.username, 'admin');
    assert.equal(config.password, 'secret');
  });

  test('exits with code 1 when SPIRA_BASE_URL is missing', () => {
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    const originalExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; throw new Error('exit'); };
    try { loadEnv(); } catch {}
    process.exit = originalExit;
    assert.equal(exitCode, 1);
  });

  test('exits with code 1 when SPIRA_USERNAME is missing', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_PASSWORD = 'secret';
    const originalExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; throw new Error('exit'); };
    try { loadEnv(); } catch {}
    process.exit = originalExit;
    assert.equal(exitCode, 1);
  });

  test('exits with code 1 when SPIRA_PASSWORD is missing', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    const originalExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; throw new Error('exit'); };
    try { loadEnv(); } catch {}
    process.exit = originalExit;
    assert.equal(exitCode, 1);
  });

  test('password value never appears in stderr', () => {
    const secretPassword = 'super-secret-password-xyz';
    // Only set password, missing base URL will trigger error
    process.env.SPIRA_PASSWORD = secretPassword;
    process.env.SPIRA_USERNAME = 'admin';
    // SPIRA_BASE_URL intentionally missing
    const chunks = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { chunks.push(chunk); return true; };
    const originalExit = process.exit;
    process.exit = () => { throw new Error('exit'); };
    try { loadEnv(); } catch {}
    process.stderr.write = originalWrite;
    process.exit = originalExit;
    const output = chunks.join('');
    assert.ok(!output.includes(secretPassword), 'Password should not appear in stderr');
  });

  test('parses SPIRA_ENABLE_PROJECT_IDS as array', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    process.env.SPIRA_ENABLE_PROJECT_IDS = '3, 17, 42';
    const config = loadEnv();
    assert.deepEqual(config.enableProjectIds, ['3', '17', '42']);
  });

  test('returns empty arrays when project ID vars are not set', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    // Explicitly unset these
    delete process.env.SPIRA_ENABLE_PROJECT_IDS;
    delete process.env.SPIRA_DISABLE_PROJECT_IDS;
    const config = loadEnv();
    assert.deepEqual(config.enableProjectIds, []);
    assert.deepEqual(config.disableProjectIds, []);
  });

  test('returns headless: true when PLAYWRIGHT_HEADLESS is not set', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    const config = loadEnv();
    assert.equal(config.headless, true);
  });

  test('returns headless: true when PLAYWRIGHT_HEADLESS is "true"', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    process.env.PLAYWRIGHT_HEADLESS = 'true';
    const config = loadEnv();
    assert.equal(config.headless, true);
  });

  test('returns headless: false when PLAYWRIGHT_HEADLESS is "false"', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    process.env.PLAYWRIGHT_HEADLESS = 'false';
    const config = loadEnv();
    assert.equal(config.headless, false);
  });

  test('returns enableDevMode: false when SPIRA_ENABLE_DEV_MODE is not set', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    const config = loadEnv();
    assert.equal(config.enableDevMode, false);
  });

  test('returns enableDevMode: true when SPIRA_ENABLE_DEV_MODE is "true"', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    process.env.SPIRA_ENABLE_DEV_MODE = 'true';
    const config = loadEnv();
    assert.equal(config.enableDevMode, true);
  });

  test('returns incrementVersion: false when SPIRA_INCREMENT_VERSION is not set', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    const config = loadEnv();
    assert.equal(config.incrementVersion, false);
  });

  test('returns incrementVersion: true when SPIRA_INCREMENT_VERSION is "true"', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    process.env.SPIRA_INCREMENT_VERSION = 'true';
    const config = loadEnv();
    assert.equal(config.incrementVersion, true);
  });

  test('returns incrementVersion: false when SPIRA_INCREMENT_VERSION is "false"', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    process.env.SPIRA_INCREMENT_VERSION = 'false';
    const config = loadEnv();
    assert.equal(config.incrementVersion, false);
  });

  test('names all missing required vars in stderr', () => {
    // All three missing — all three names should appear in stderr
    const chunks = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { chunks.push(chunk); return true; };
    const originalExit = process.exit;
    process.exit = () => { throw new Error('exit'); };
    try { loadEnv(); } catch {}
    process.stderr.write = originalWrite;
    process.exit = originalExit;
    const output = chunks.join('');
    assert.ok(output.includes('SPIRA_BASE_URL'), 'stderr should name SPIRA_BASE_URL');
    assert.ok(output.includes('SPIRA_USERNAME'), 'stderr should name SPIRA_USERNAME');
    assert.ok(output.includes('SPIRA_PASSWORD'), 'stderr should name SPIRA_PASSWORD');
  });

  test('parses SPIRA_DISABLE_PROJECT_IDS as array', () => {
    process.env.SPIRA_BASE_URL = 'https://example.com';
    process.env.SPIRA_USERNAME = 'admin';
    process.env.SPIRA_PASSWORD = 'secret';
    process.env.SPIRA_DISABLE_PROJECT_IDS = '5, 10';
    const config = loadEnv();
    assert.deepEqual(config.disableProjectIds, ['5', '10']);
  });
});

// ─── bumpVersion ─────────────────────────────────────────────────────────────

describe('bumpVersion', () => {
  let tmpDir;
  let manifestPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spira-bump-'));
    manifestPath = path.join(tmpDir, 'manifest.yaml');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('bumps 1.0 to 1.1', () => {
    fs.writeFileSync(manifestPath, 'name: Test\nversion: 1.0\n');
    const { manifest, raw } = readManifest(tmpDir);
    const newVersion = bumpVersion(manifestPath, raw, manifest);
    assert.equal(newVersion, '1.1');
    assert.ok(fs.readFileSync(manifestPath, 'utf-8').includes('version: 1.1'));
  });

  test('bumps 1.9 to 1.10', () => {
    fs.writeFileSync(manifestPath, 'name: Test\nversion: 1.9\n');
    const { manifest, raw } = readManifest(tmpDir);
    const newVersion = bumpVersion(manifestPath, raw, manifest);
    assert.equal(newVersion, '1.10');
  });

  test('bumps 2.5 to 2.6', () => {
    fs.writeFileSync(manifestPath, 'name: Test\nversion: 2.5\n');
    const { manifest, raw } = readManifest(tmpDir);
    const newVersion = bumpVersion(manifestPath, raw, manifest);
    assert.equal(newVersion, '2.6');
  });

  test('handles integer version (1 → 1.1)', () => {
    fs.writeFileSync(manifestPath, 'name: Test\nversion: 1\n');
    const { manifest, raw } = readManifest(tmpDir);
    const newVersion = bumpVersion(manifestPath, raw, manifest);
    assert.equal(newVersion, '1.1');
  });

  test('preserves other manifest fields', () => {
    fs.writeFileSync(manifestPath, 'name: My App\nguid: abc-123\nversion: 1.0\nauthor: Dev\n');
    const { manifest, raw } = readManifest(tmpDir);
    bumpVersion(manifestPath, raw, manifest);
    const content = fs.readFileSync(manifestPath, 'utf-8');
    assert.ok(content.includes('name: My App'));
    assert.ok(content.includes('guid: abc-123'));
    assert.ok(content.includes('author: Dev'));
  });
});

// ─── normalizeBaseUrl ─────────────────────────────────────────────────────────

describe('normalizeBaseUrl', () => {
  test('removes a single trailing slash', () => {
    assert.equal(normalizeBaseUrl('https://example.com/'), 'https://example.com');
  });

  test('removes multiple trailing slashes', () => {
    assert.equal(normalizeBaseUrl('https://example.com///'), 'https://example.com');
  });

  test('leaves URL without trailing slash unchanged', () => {
    assert.equal(normalizeBaseUrl('https://example.com'), 'https://example.com');
  });

  test('preserves path segments', () => {
    assert.equal(normalizeBaseUrl('https://example.com/spira/'), 'https://example.com/spira');
  });

  test('preserves path segments without trailing slash', () => {
    assert.equal(normalizeBaseUrl('https://example.com/spira'), 'https://example.com/spira');
  });
});

// ─── readManifest ─────────────────────────────────────────────────────────────

describe('readManifest', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spira-manifest-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns manifest object, manifestPath, and raw string', () => {
    fs.writeFileSync(path.join(tmpDir, 'manifest.yaml'), 'name: MyApp\nversion: 1.0\n');
    const result = readManifest(tmpDir);
    assert.equal(result.manifest.name, 'MyApp');
    assert.equal(result.manifest.version, 1.0);
    assert.equal(result.manifestPath, path.join(tmpDir, 'manifest.yaml'));
    assert.ok(typeof result.raw === 'string');
    assert.ok(result.raw.includes('name: MyApp'));
  });

  test('throws when manifest.yaml does not exist', () => {
    assert.throws(() => readManifest(tmpDir), /ENOENT/);
  });

  test('parses guid field correctly', () => {
    fs.writeFileSync(path.join(tmpDir, 'manifest.yaml'), 'name: Test\nguid: abc-123\nversion: 1.0\n');
    const { manifest } = readManifest(tmpDir);
    assert.equal(manifest.guid, 'abc-123');
  });
});

// ─── formatError ─────────────────────────────────────────────────────────────

describe('formatError', () => {
  test('returns clean message for timeout errors', () => {
    const err = new Error('Timeout 30000ms exceeded');
    const result = formatError(err);
    assert.ok(result.includes('Timed out'), `expected timeout message, got: ${result}`);
    assert.ok(result.includes('Spira instance is reachable'));
  });

  test('returns clean message for ECONNREFUSED', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:443');
    const result = formatError(err);
    assert.ok(result.includes('Could not reach'), `expected network message, got: ${result}`);
    assert.ok(result.includes('SPIRA_BASE_URL'));
  });

  test('returns clean message for ENOTFOUND', () => {
    const err = new Error('getaddrinfo ENOTFOUND bad-host.example.com');
    const result = formatError(err);
    assert.ok(result.includes('Could not reach'));
  });

  test('returns clean message for net::ERR errors', () => {
    const err = new Error('net::ERR_CONNECTION_REFUSED');
    const result = formatError(err);
    assert.ok(result.includes('Could not reach'));
  });

  test('returns clean message for Target closed', () => {
    const err = new Error('Target closed');
    const result = formatError(err);
    assert.ok(result.includes('browser closed unexpectedly'));
  });

  test('returns clean message for Session closed', () => {
    const err = new Error('Session closed. Most likely the page has been closed.');
    const result = formatError(err);
    assert.ok(result.includes('browser closed unexpectedly'));
  });

  test('returns clean message for selector/locator errors', () => {
    const err = new Error('waiting for selector "#someElement" failed');
    const result = formatError(err);
    assert.ok(result.includes('Could not find an expected element'));
  });

  test('passes through already-descriptive messages unchanged', () => {
    const err = new Error('Login failed for user "admin". Check credentials and Spira instance availability.');
    const result = formatError(err);
    assert.ok(result.includes('Login failed for user'));
  });

  test('includes context prefix when context is provided', () => {
    const err = new Error('Timeout 5000ms exceeded');
    const result = formatError(err, 'browser launch');
    assert.ok(result.startsWith('[browser launch]'), `expected prefix, got: ${result}`);
  });

  test('handles null/undefined error gracefully', () => {
    const result = formatError(null);
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  test('handles error with no message property', () => {
    const result = formatError({ toString: () => 'some string error' });
    assert.ok(typeof result === 'string');
  });
});

// ─── runBuild ─────────────────────────────────────────────────────────────────

describe('runBuild', () => {
  let inputDir;
  let outputDir;

  beforeEach(() => {
    inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spira-input-'));
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spira-output-'));
    // Write a minimal valid manifest
    fs.writeFileSync(path.join(inputDir, 'manifest.yaml'), [
      'guid: "12345678-1234-1234-1234-123456789012"',
      'name: TestApp',
      'version: 1.0',
    ].join('\n') + '\n');
  });

  afterEach(() => {
    fs.rmSync(inputDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  test('does NOT bump version when incrementVersion is false (default)', () => {
    const originalVersion = fs.readFileSync(path.join(inputDir, 'manifest.yaml'), 'utf-8');
    // runBuild will call index.js which may fail without full manifest — just check version not bumped
    try {
      runBuild(inputDir, outputDir, false);
    } catch {}
    const afterVersion = fs.readFileSync(path.join(inputDir, 'manifest.yaml'), 'utf-8');
    assert.equal(originalVersion, afterVersion, 'manifest.yaml should not be modified when incrementVersion is false');
  });

  test('bumps version when incrementVersion is true', () => {
    try {
      runBuild(inputDir, outputDir, true);
    } catch {}
    const content = fs.readFileSync(path.join(inputDir, 'manifest.yaml'), 'utf-8');
    assert.ok(content.includes('version: 1.1'), `expected version 1.1, got: ${content}`);
  });

  test('creates outputFolder if it does not exist', () => {
    const newOutputDir = path.join(os.tmpdir(), `spira-new-output-${Date.now()}`);
    assert.ok(!fs.existsSync(newOutputDir), 'output dir should not exist before runBuild');
    try {
      runBuild(inputDir, newOutputDir, false);
    } catch {}
    assert.ok(fs.existsSync(newOutputDir), 'output dir should be created by runBuild');
    fs.rmSync(newOutputDir, { recursive: true, force: true });
  });
});
