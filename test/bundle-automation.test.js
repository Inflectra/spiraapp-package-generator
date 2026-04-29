'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseArgs, deriveOutputFolder, loadEnv, bumpVersion, readManifest } = require('../bundle-automation.js');

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
