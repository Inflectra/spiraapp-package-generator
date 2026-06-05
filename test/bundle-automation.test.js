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
  validateSpiraUrl,
  assertSpiraResponse,
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

// ─── assertSpiraResponse ─────────────────────────────────────────────────────

describe('assertSpiraResponse', () => {
  test('does not throw for 200 with text/html content-type', () => {
    assert.doesNotThrow(() => assertSpiraResponse(200, 'text/html; charset=utf-8'));
  });

  test('does not throw for 301 redirect with html', () => {
    assert.doesNotThrow(() => assertSpiraResponse(301, 'text/html'));
  });

  test('throws for HTTP 404', () => {
    assert.throws(
      () => assertSpiraResponse(404, 'text/html'),
      (err) => err.message.includes('HTTP 404') && err.message.includes('SPIRA_BASE_URL')
    );
  });

  test('throws for HTTP 503', () => {
    assert.throws(
      () => assertSpiraResponse(503, 'text/html'),
      (err) => err.message.includes('HTTP 503') && err.message.includes('SPIRA_BASE_URL')
    );
  });

  test('throws for any 4xx status', () => {
    assert.throws(
      () => assertSpiraResponse(403, 'text/html'),
      (err) => err.message.includes('HTTP 403')
    );
  });

  test('throws for any 5xx status', () => {
    assert.throws(
      () => assertSpiraResponse(500, 'text/html'),
      (err) => err.message.includes('HTTP 500')
    );
  });

  test('throws for non-HTML content-type', () => {
    assert.throws(
      () => assertSpiraResponse(200, 'application/json'),
      (err) => err.message.includes('not HTML') && err.message.includes('SPIRA_BASE_URL')
    );
  });

  test('does not throw when content-type is empty string', () => {
    assert.doesNotThrow(() => assertSpiraResponse(200, ''));
  });
});

// ─── validateSpiraUrl ────────────────────────────────────────────────────────

describe('validateSpiraUrl', () => {
  test('throws for malformed URL', async () => {
    await assert.rejects(
      () => validateSpiraUrl('not-a-url'),
      (err) => err.message.includes('not a valid URL')
    );
  });

  test('throws for non-http protocol', async () => {
    await assert.rejects(
      () => validateSpiraUrl('ftp://example.com'),
      (err) => err.message.includes('not a valid URL')
    );
  });

  test('throws for unreachable host', async () => {
    await assert.rejects(
      () => validateSpiraUrl('http://this-host-does-not-exist-xyz123.invalid'),
      (err) => err.message.includes('Could not reach Spira instance')
    );
  });
});

// ─── Mock Helpers ────────────────────────────────────────────────────────────

const {
  login,
  enableDeveloperMode,
  uploadSpiraApp,
  verifyUpload,
  activateSpiraApp,
  toggleForProduct,
} = require('../bundle-automation.js');

/**
 * Create a mock Playwright page object.
 * Override specific methods per test via the `overrides` parameter.
 */
function createMockPage(overrides = {}) {
  const locatorObj = {
    isVisible: async () => false,
    isChecked: async () => false,
    click: async () => {},
    dispatchEvent: async () => {},
    setInputFiles: async () => {},
    fill: async () => {},
    first: () => locatorObj,
    filter: () => locatorObj,
    waitFor: async () => {},
    nth: () => locatorObj,
    count: async () => 0,
    getAttribute: async () => '',
    innerText: async () => '',
    locator: () => locatorObj,
    ...overrides.locator,
  };

  return {
    goto: async () => ({ status: () => 200, headers: () => ({ 'content-type': 'text/html' }) }),
    fill: async () => {},
    click: async () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    waitForSelector: async () => {},
    url: () => 'https://example.com/Dashboard.aspx',
    locator: () => locatorObj,
    setDefaultNavigationTimeout: () => {},
    setDefaultTimeout: () => {},
    on: () => {},
    evaluate: async () => {},
    ...overrides,
  };
}

// ─── login ───────────────────────────────────────────────────────────────────

describe('login', () => {
  const config = { baseUrl: 'https://example.com', username: 'admin', password: 'secret' };

  test('succeeds when page navigates away from Login', async () => {
    const page = createMockPage();
    await assert.doesNotReject(() => login(page, config));
  });

  test('throws when response status is 404', async () => {
    const page = createMockPage({
      goto: async () => ({ status: () => 404, headers: () => ({ 'content-type': 'text/html' }) }),
    });
    await assert.rejects(
      () => login(page, config),
      (err) => err.message.includes('HTTP 404')
    );
  });

  test('throws when response status is 503', async () => {
    const page = createMockPage({
      goto: async () => ({ status: () => 503, headers: () => ({ 'content-type': 'text/html' }) }),
    });
    await assert.rejects(
      () => login(page, config),
      (err) => err.message.includes('HTTP 503')
    );
  });

  test('throws when URL still contains Login after submit', async () => {
    const page = createMockPage({
      url: () => 'https://example.com/Login.aspx',
    });
    await assert.rejects(
      () => login(page, config),
      (err) => err.message.includes('Login failed')
    );
  });

  test('throws when error element is visible on page', async () => {
    const page = createMockPage({
      url: () => 'https://example.com/Login.aspx',
      locator: () => ({
        isVisible: async () => true,
        isChecked: async () => false,
        click: async () => {},
        dispatchEvent: async () => {},
        first: function() { return this; },
        filter: function() { return this; },
        locator: function() { return this; },
      }),
    });
    await assert.rejects(
      () => login(page, config),
      (err) => err.message.includes('Login failed')
    );
  });

  test('handles sign-out-others dialog when visible', async () => {
    let signOffClicked = false;
    const signOffLocator = {
      isVisible: async () => true,
      click: async () => { signOffClicked = true; },
    };

    const page = createMockPage({
      locator: (selector) => {
        if (selector === '#cplMainContent_btnSignOffOthers') {
          return signOffLocator;
        }
        return { isVisible: async () => false };
      },
    });

    await login(page, config);
    assert.equal(signOffClicked, true, 'Should have clicked the sign-off button');
  });
});

// ─── enableDeveloperMode ─────────────────────────────────────────────────────

describe('enableDeveloperMode', () => {
  const config = { baseUrl: 'https://example.com' };

  test('clicks checkbox when not already checked', async () => {
    let dispatched = false;
    let saved = false;

    const page = createMockPage({
      locator: (selector) => {
        if (selector.includes('chkSpiraAppDeveloperMode')) {
          return {
            isChecked: async () => false,
            dispatchEvent: async () => { dispatched = true; },
          };
        }
        return {
          first: () => ({ click: async () => { saved = true; } }),
        };
      },
    });

    await enableDeveloperMode(page, config);
    assert.equal(dispatched, true, 'Should dispatch click on unchecked checkbox');
    assert.equal(saved, true, 'Should click save button');
  });

  test('does not click checkbox when already checked', async () => {
    let dispatched = false;
    let saved = false;

    const page = createMockPage({
      locator: (selector) => {
        if (selector.includes('chkSpiraAppDeveloperMode')) {
          return {
            isChecked: async () => true,
            dispatchEvent: async () => { dispatched = true; },
          };
        }
        return {
          first: () => ({ click: async () => { saved = true; } }),
        };
      },
    });

    await enableDeveloperMode(page, config);
    assert.equal(dispatched, false, 'Should NOT dispatch click on already-checked checkbox');
    assert.equal(saved, true, 'Should still click save button');
  });
});

// ─── uploadSpiraApp ──────────────────────────────────────────────────────────

describe('uploadSpiraApp', () => {
  const config = { baseUrl: 'https://example.com' };

  test('sets input files and clicks upload button', async () => {
    let filesSet = null;
    let uploadClicked = false;

    const page = createMockPage({
      locator: (selector) => {
        if (selector.includes('inputFileSpiraAppPackage')) {
          return { setInputFiles: async (f) => { filesSet = f; } };
        }
        if (selector === '#btnInstallSpiraAppPackage') {
          return { click: async () => { uploadClicked = true; } };
        }
        return { setInputFiles: async () => {}, click: async () => {} };
      },
    });

    await uploadSpiraApp(page, '/path/to/app.spiraapp', config);
    assert.equal(filesSet, '/path/to/app.spiraapp');
    assert.equal(uploadClicked, true);
  });
});

// ─── verifyUpload ────────────────────────────────────────────────────────────

describe('verifyUpload', () => {
  test('resolves when waitForSelector succeeds', async () => {
    const page = createMockPage();
    await assert.doesNotReject(() => verifyUpload(page, 'MyApp'));
  });

  test('throws descriptive error when app does not appear', async () => {
    const page = createMockPage({
      waitForSelector: async () => { throw new Error('Timeout'); },
    });
    await assert.rejects(
      () => verifyUpload(page, 'MyApp'),
      (err) => err.message.includes('did not appear') && err.message.includes('MyApp')
    );
  });
});

// ─── activateSpiraApp ────────────────────────────────────────────────────────

describe('activateSpiraApp', () => {
  test('does nothing when app is already active', async () => {
    let evaluated = false;
    const rowLocator = {
      waitFor: async () => {},
      locator: () => ({ isVisible: async () => false }),
    };

    const page = createMockPage({
      locator: () => ({ filter: () => rowLocator }),
      evaluate: async () => { evaluated = true; },
    });

    await activateSpiraApp(page, 'MyApp');
    assert.equal(evaluated, false, 'Should not call evaluate when already active');
  });

  test('activates when app is inactive', async () => {
    let evaluatedWith = null;
    const rowLocator = {
      waitFor: async () => {},
      locator: (sel) => {
        if (sel === 'i.fa-times') {
          return { isVisible: async () => evaluatedWith !== null ? false : true };
        }
        if (sel.includes('activateSpiraApp')) {
          return { getAttribute: async () => 'activateSpiraApp(42)' };
        }
        return { isVisible: async () => false };
      },
    };

    const page = createMockPage({
      locator: () => ({ filter: () => rowLocator }),
      evaluate: async (fn, id) => { evaluatedWith = id; },
    });

    await activateSpiraApp(page, 'MyApp');
    assert.equal(evaluatedWith, 42);
  });

  test('throws when plugin ID cannot be determined', async () => {
    const rowLocator = {
      waitFor: async () => {},
      locator: (sel) => {
        if (sel === 'i.fa-times') {
          return { isVisible: async () => true };
        }
        if (sel.includes('activateSpiraApp')) {
          return { getAttribute: async () => 'someOtherFunction()' };
        }
        return { isVisible: async () => false };
      },
    };

    const page = createMockPage({
      locator: () => ({ filter: () => rowLocator }),
    });

    await assert.rejects(
      () => activateSpiraApp(page, 'MyApp'),
      (err) => err.message.includes('Could not determine plugin ID')
    );
  });
});

// ─── toggleForProduct ────────────────────────────────────────────────────────

describe('toggleForProduct', () => {
  test('logs already enabled when no activate links found', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    const page = createMockPage({
      locator: () => ({ count: async () => 0 }),
    });

    await toggleForProduct(page, 'https://example.com', '3', 'MyApp', true);
    console.log = originalLog;

    assert.ok(logs.some(l => l.includes('already enabled')));
  });

  test('logs already disabled when no deactivate links found', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    const page = createMockPage({
      locator: () => ({ count: async () => 0 }),
    });

    await toggleForProduct(page, 'https://example.com', '3', 'MyApp', false);
    console.log = originalLog;

    assert.ok(logs.some(l => l.includes('already disabled')));
  });

  test('clicks the matching link when app row is found', async () => {
    let dispatched = false;
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    const linkLocator = {
      count: async () => 1,
      nth: () => ({
        locator: () => ({
          first: () => ({ innerText: async () => 'MyApp v1.0' }),
        }),
        dispatchEvent: async () => { dispatched = true; },
      }),
    };

    const page = createMockPage({
      locator: () => linkLocator,
    });

    await toggleForProduct(page, 'https://example.com', '3', 'MyApp', true);
    console.log = originalLog;

    assert.equal(dispatched, true, 'Should dispatch click on matching link');
    assert.ok(logs.some(l => l.includes('enabled') && l.includes('project 3')));
  });
});
