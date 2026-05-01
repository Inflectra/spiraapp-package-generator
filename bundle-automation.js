#!/usr/bin/env node
'use strict';

// Clear any npm_config_* env vars that may have been set by a previous
// `npm run build` invocation — they would interfere with index.js path logic
delete process.env.npm_config_input;
delete process.env.npm_config_output;
delete process.env.npm_config_debug;

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const yaml = require('js-yaml');
const { chromium } = require('playwright');

// Helper: normalize base URL by removing trailing slashes
function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

// Helper: read and parse manifest.yaml
function readManifest(inputFolder) {
  const manifestPath = path.join(inputFolder, 'manifest.yaml');
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  return { manifest: yaml.load(raw), manifestPath, raw };
}

/**
 * Parse CLI arguments and validate the --input folder.
 *
 * Accepts:
 *   --input=<value>
 *   --input <value>
 *   --upload  (optional flag; sets uploadOnly: true)
 *
 * @param {string[]} argv - process.argv (or equivalent)
 * @returns {{ inputFolder: string, uploadOnly: boolean }}
 */
function parseArgs(argv) {
  let inputFolder = null;
  let uploadOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith('--input=')) {
      inputFolder = arg.slice('--input='.length);
      continue;
    }

    if (arg === '--input' && i + 1 < argv.length) {
      inputFolder = argv[i + 1];
      i++; // skip the next arg (the value)
      continue;
    }

    if (arg === '--upload') {
      uploadOnly = true;
      continue;
    }
  }

  if (!inputFolder || inputFolder.trim() === '') {
    process.stderr.write(
      'Error: --input argument is required and must not be empty.\n' +
      'Usage: node bundle-automation.js --input=<path-to-folder>\n'
    );
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputFolder);
  const manifestPath = path.join(resolvedInput, 'manifest.yaml');

  if (!fs.existsSync(manifestPath)) {
    process.stderr.write(
      `Error: manifest.yaml not found in input folder: ${resolvedInput}\n` +
      'Ensure the --input folder contains a valid manifest.yaml file.\n'
    );
    process.exit(1);
  }

  return { inputFolder: resolvedInput, uploadOnly };
}

/**
 * Derive the output folder by appending "Bundle" to the input folder name.
 *
 * @param {string} inputFolder - absolute path to the input folder
 * @returns {string} sibling directory with "Bundle" appended to the name
 * @example
 * deriveOutputFolder('/path/to/AIConnect') // → '/path/to/AIConnectBundle'
 */
function deriveOutputFolder(inputFolder) {
  return path.join(path.dirname(inputFolder), path.basename(inputFolder) + 'Bundle');
}

/**
 * Load environment variables from .env and validate required vars.
 *
 * Required vars: SPIRA_BASE_URL, SPIRA_USERNAME, SPIRA_PASSWORD
 * Prints each missing variable name to stderr and exits with code 1 if any are absent.
 * Never logs the password value.
 *
 * @returns {{ baseUrl: string, username: string, password: string }}
 */
function loadEnv() {
  if (!process.env.DOTENV_SKIP) {
    dotenv.config({ path: path.resolve(__dirname, '.env') });
  }

  const required = ['SPIRA_BASE_URL', 'SPIRA_USERNAME', 'SPIRA_PASSWORD'];
  const missing = required.filter((key) => !process.env[key] || process.env[key].trim() === '');

  if (missing.length > 0) {
    process.stderr.write('\nError: Missing required environment variables:\n');
    for (const key of missing) {
      process.stderr.write(`  - ${key}\n`);
    }
    process.stderr.write('\nPlease ensure your .env file contains all required variables.\n');
    process.stderr.write('See .env.example for reference.\n\n');
    process.exit(1);
  }

  return {
    baseUrl: process.env.SPIRA_BASE_URL,
    username: process.env.SPIRA_USERNAME,
    password: process.env.SPIRA_PASSWORD,
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    enableDevMode: process.env.SPIRA_ENABLE_DEV_MODE === 'true',
    incrementVersion: process.env.SPIRA_INCREMENT_VERSION === 'true',
    enableProjectIds: process.env.SPIRA_ENABLE_PROJECT_IDS
      ? process.env.SPIRA_ENABLE_PROJECT_IDS.split(',').map(id => id.trim()).filter(Boolean)
      : [],
    disableProjectIds: process.env.SPIRA_DISABLE_PROJECT_IDS
      ? process.env.SPIRA_DISABLE_PROJECT_IDS.split(',').map(id => id.trim()).filter(Boolean)
      : [],
  };
}

/**
 * Auto-increment the patch version in manifest.yaml.
 * e.g. 1.0 → 1.1, 1.9 → 1.10, 2.5 → 2.6
 *
 * @param {string} manifestPath - absolute path to manifest.yaml
 * @param {string} raw - raw YAML content
 * @param {object} manifest - parsed manifest object
 * @returns {string} the new version string
 */
function bumpVersion(manifestPath, raw, manifest) {
  const current = String(manifest.version);
  const parts = current.split('.');
  const major = parts[0] || '1';
  const minor = parseInt(parts[1] || '0', 10);
  const newVersion = `${major}.${minor + 1}`;

  const updated = raw.replace(/^version:\s*.+$/m, `version: ${newVersion}`);
  fs.writeFileSync(manifestPath, updated, 'utf-8');
  console.log(`Version bumped: ${current} → ${newVersion}`);
  return newVersion;
}

/**
 * Run the index.js build process for the given input/output folders.
 *
 * Strategy:
 *  1. Create outputFolder if it does not exist.
 *  2. Set npm_config_input / npm_config_output env vars (with trailing slash).
 *  3. Intercept console.log to capture build output and detect "Error:" lines.
 *  4. Bust the require cache for index.js so it re-executes fresh (it auto-calls
 *     exports.package() at require time, which is the build trigger).
 *  5. Restore console.log and env vars.
 *  6. If errors were captured, print to stderr and exit(1).
 *  7. Scan outputFolder for the produced {guid}.spiraapp file; throw if not found.
 *  8. Read manifest.yaml to get appName.
 *  9. Return { spiraappPath, appName }.
 *
 * @param {string} inputFolder  - absolute path to the SpiraApp source folder
 * @param {string} outputFolder - absolute path to the destination folder
 * @param {boolean} [incrementVersion=false] - when true, bumps the patch version in manifest.yaml before building
 * @returns {{ spiraappPath: string, appName: string }}
 */
function runBuild(inputFolder, outputFolder, incrementVersion = false) {
  // 1. Ensure output folder exists
  fs.mkdirSync(outputFolder, { recursive: true });

  const resolvedInput  = path.resolve(inputFolder);
  const resolvedOutput = path.resolve(outputFolder);

  // Optionally auto-increment version in manifest.yaml before building
  const { manifest, manifestPath, raw } = readManifest(resolvedInput);
  if (incrementVersion) {
    bumpVersion(manifestPath, raw, manifest);
  }

  // 2. Temporarily set env vars (index.js reads these at module load time)
  const prevInput  = process.env.npm_config_input;
  const prevOutput = process.env.npm_config_output;
  process.env.npm_config_input  = resolvedInput  + '/';
  process.env.npm_config_output = resolvedOutput + '/';

  // 3. Intercept console.log to capture build output
  const capturedLines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    const line = args.join(' ');
    capturedLines.push(line);
    originalLog(...args);
  };

  try {
    // 4. Bust require cache so index.js re-executes fresh each call
    const indexPath = require.resolve('./index.js');
    delete require.cache[indexPath];
    require('./index.js'); // auto-calls exports.package() at load time
  } finally {
    // 5. Restore console.log and env vars
    console.log = originalLog;

    if (prevInput === undefined) {
      delete process.env.npm_config_input;
    } else {
      process.env.npm_config_input = prevInput;
    }
    if (prevOutput === undefined) {
      delete process.env.npm_config_output;
    } else {
      process.env.npm_config_output = prevOutput;
    }
  }

  // 6. Check captured output for error lines
  const errorLines = capturedLines.filter(line => line.includes('Error:'));
  if (errorLines.length > 0) {
    for (const line of errorLines) {
      process.stderr.write(line + '\n');
    }
    process.exit(1);
  }

  // 7. Scan outputFolder for the produced .spiraapp file
  const files = fs.readdirSync(resolvedOutput);
  const spiraappFile = files.find(f => f.endsWith('.spiraapp'));
  if (!spiraappFile) {
    throw new Error(`Build completed but no .spiraapp file found in: ${resolvedOutput}`);
  }

  return { 
    spiraappPath: path.join(resolvedOutput, spiraappFile), 
    appName: manifest.name 
  };
}

/**
 * Log in to the Spira instance.
 *
 * Navigates to {baseUrl}/Login.aspx, fills credentials, submits the form,
 * and verifies the login succeeded. Throws a descriptive error (without
 * printing the password) if login fails.
 *
 * @param {import('playwright').Page} page
 * @param {{ baseUrl: string, username: string, password: string }} config
 */
async function login(page, config) {
  const base = normalizeBaseUrl(config.baseUrl);
  await page.goto(`${base}/Login.aspx`);

  // Fill credentials and submit
  await page.fill('input[name="txtUserName"], input[id*="UserName"], input[type="text"]', config.username);
  await page.fill('input[name="txtPassword"], input[id*="Password"], input[type="password"]', config.password);
  await page.click('input[type="submit"], button[type="submit"]');

  // Wait for navigation to settle - Spira may redirect to last visited page
  await page.waitForLoadState('networkidle');

  // Handle "sign out other sessions" dialog — Spira shows this when the account
  // is already logged in elsewhere. The page renders an <a> tag with a known ID
  // that triggers __doPostBack to sign off other locations.
  try {
    const signOffBtn = page.locator('#cplMainContent_btnSignOffOthers');
    const visible = await signOffBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (visible) {
      await signOffBtn.click();
      await page.waitForLoadState('networkidle');
    }
  } catch {
    // No sign-out dialog appeared — continue normally
  }

  // Detect failure: error element visible OR URL still contains "Login"
  const currentUrl = page.url();
  const errorVisible = await page.locator(
    '.ErrorMessage, .error-message, [id*="Error"], [class*="error"]'
  ).isVisible().catch(() => false);

  if (errorVisible || currentUrl.includes('Login')) {
    throw new Error(
      `Login failed for user "${config.username}". ` +
      'Check credentials and Spira instance availability. ' +
      'If a "sign out other sessions" dialog appeared and was not handled, try running again.'
    );
  }

  // Wait a bit longer to ensure any post-login redirects have completed
  // This prevents race conditions where Spira redirects to the last visited page
  await page.waitForTimeout(2000);
}

/**
 * Ensure Developer Mode is enabled in Spira General Settings.
 *
 * Navigates to the General Settings admin page, checks the Developer Mode
 * checkbox/toggle, enables it if not already on, and saves. If already
 * enabled, proceeds without modifying the setting.
 *
 * @param {import('playwright').Page} page
 * @param {{ baseUrl: string }} config
 */
async function enableDeveloperMode(page, config) {
  await page.goto(`${normalizeBaseUrl(config.baseUrl)}/Administration/GeneralSettings.aspx`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  // Locate the Developer Mode checkbox by its known id
  const devModeCheckbox = page.locator('#cplMainContent_cplAdministrationContent_chkSpiraAppDeveloperMode');

  const isChecked = await devModeCheckbox.isChecked();

  if (!isChecked) {
    // Use dispatchEvent to bypass the overlapping DataLabel div
    await devModeCheckbox.dispatchEvent('click');
  }

  // Always save — ensures the setting is persisted regardless of prior state
  const saveBtn = page.locator('input[type="submit"], button[type="submit"]').first();
  await saveBtn.click();
  await page.waitForLoadState('networkidle');
}

/**
 * Upload a .spiraapp file to the SpiraApps administration page.
 *
 * Navigates to the SpiraApps admin page and targets ONLY the file input
 * that accepts `.spiraapp` files (identified by its `accept` attribute or
 * surrounding label), then triggers the upload.
 *
 * @param {import('playwright').Page} page
 * @param {string} spiraappPath - absolute path to the .spiraapp file
 * @param {{ baseUrl: string }} config - environment configuration
 */
async function uploadSpiraApp(page, spiraappPath, config) {
  const spiraAppsUrl = `${normalizeBaseUrl(config.baseUrl)}/Administration/SpiraApps.aspx`;

  // Navigate with waitUntil 'domcontentloaded' to be more resilient to redirects
  await page.goto(spiraAppsUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  // Target the .spiraapp file input by its known name attribute
  const fileInput = page.locator('input[name*="inputFileSpiraAppPackage"]');
  await fileInput.setInputFiles(spiraappPath);

  // Click the upload button
  await page.locator('#btnInstallSpiraAppPackage').click();

  // Wait for the upload to complete
  await page.waitForLoadState('networkidle');
}

/**
 * Verify that the uploaded SpiraApp appears in the SpiraApps list.
 *
 * Polls the list for up to 30 seconds. Throws a descriptive error if the
 * app does not appear within the timeout.
 *
 * @param {import('playwright').Page} page
 * @param {string} appName - the SpiraApp name to look for
 */
async function verifyUpload(page, appName) {
  try {
    // Wait for the app name to appear in the DOM — handles JS-rendered lists
    await page.waitForSelector(`text=${appName}`, { timeout: 30_000 });
  } catch {
    throw new Error(
      `SpiraApp "${appName}" did not appear in the SpiraApps list within 30 seconds. ` +
      'The upload may have failed or the app name in manifest.yaml does not match the UI.'
    );
  }
}

/**
 * Activate the SpiraApp system-wide via its Power Toggle.
 *
 * Locates the row for `appName`, checks the toggle state, clicks it if
 * disabled, and confirms the app is shown as enabled before returning.
 *
 * @param {import('playwright').Page} page
 * @param {string} appName - the SpiraApp name to activate
 */
async function activateSpiraApp(page, appName) {
  // AG Grid renders rows dynamically after page load
  // Wait for networkidle then give the grid extra time to render
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Wait for the specific row containing our app name to appear
  const appRow = page.locator('div[role="row"]').filter({ hasText: appName });
  await appRow.waitFor({ timeout: 30_000 });

  // Check if already active — inactive rows show fa-times icon
  const isInactive = await appRow.locator('i.fa-times').isVisible().catch(() => false);

  if (isInactive) {
    // Get plugin ID from the activate button's onclick e.g. activateSpiraApp(6)
    const activateBtn = appRow.locator('button[onclick*="activateSpiraApp"]');
    const onclickAttr = await activateBtn.getAttribute('onclick');
    const pluginId = onclickAttr.match(/activateSpiraApp\((\d+)\)/)?.[1];

    if (!pluginId) {
      throw new Error(`Could not determine plugin ID for SpiraApp "${appName}"`);
    }

    // Call the page's own JS function directly — bypasses any DOM overlay issues
    await page.evaluate((id) => window.activateSpiraApp(id), parseInt(pluginId, 10));
    await page.waitForLoadState('networkidle');

    // Confirm now active (fa-times should be gone)
    await page.waitForTimeout(1000);
    const stillInactive = await appRow.locator('i.fa-times').isVisible().catch(() => false);
    if (stillInactive) {
      throw new Error(`Failed to activate SpiraApp "${appName}" — toggle did not switch.`);
    }
  }

  console.log(`SpiraApp "${appName}" is now active.`);
}

/**
 * Toggle SpiraApp for a specific product (enable or disable).
 *
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 * @param {string} projectId
 * @param {string} appName
 * @param {boolean} enable - true to enable, false to disable
 */
async function toggleForProduct(page, baseUrl, projectId, appName, enable) {
  const action = enable ? 'Enabling' : 'Disabling';
  const linkSelector = enable ? 'a[id*="lnkActivate_"]' : 'a[id*="lnkDeactivate"]';
  const alreadyState = enable ? 'enabled' : 'disabled';

  console.log(`${action} SpiraApp for project ${projectId}...`);
  await page.goto(`${normalizeBaseUrl(baseUrl)}/${projectId}/Administration/SpiraApps.aspx`);
  await page.waitForLoadState('networkidle');

  const links = page.locator(linkSelector);
  const count = await links.count();

  if (count === 0) {
    console.log(`SpiraApp "${appName}" already ${alreadyState} for project ${projectId}.`);
    return;
  }

  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const row = link.locator('xpath=ancestor::tr').first();
    const rowText = await row.innerText().catch(() => '');
    if (rowText.includes(appName)) {
      await link.dispatchEvent('click');
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle');
      console.log(`SpiraApp "${appName}" ${alreadyState} for project ${projectId}.`);
      return;
    }
  }

  console.log(`SpiraApp "${appName}" already ${alreadyState} for project ${projectId}.`);
}

/**
 * Translate a raw Playwright or network error into a clean, actionable message.
 * Strips internal stack noise and adds context so headless failures are diagnosable.
 *
 * @param {Error} err - the caught error
 * @param {string} [context] - optional label for where the error occurred
 * @returns {string} human-readable error message (never contains the password)
 */
function formatError(err, context) {
  const prefix = context ? `[${context}] ` : '';
  const msg = err && err.message ? err.message : String(err);

  // Playwright timeout
  if (msg.includes('Timeout') || msg.includes('timeout')) {
    return `${prefix}Timed out waiting for the page to respond. ` +
      'Check that the Spira instance is reachable and the URL is correct.';
  }
  // Network / navigation failures
  if (msg.includes('net::ERR') || msg.includes('NS_ERROR') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return `${prefix}Could not reach the Spira instance. ` +
      'Verify SPIRA_BASE_URL is correct and the server is accessible.';
  }
  // Browser process crash
  if (msg.includes('Target closed') || msg.includes('Session closed') || msg.includes('browser has been closed')) {
    return `${prefix}The browser closed unexpectedly. ` +
      'This can happen if the system is low on memory or the Spira page crashed.';
  }
  // Element not found / selector failures
  if (msg.includes('waiting for selector') || msg.includes('locator.') || msg.includes('strict mode violation')) {
    return `${prefix}Could not find an expected element on the page. ` +
      'The Spira UI may have changed or the page did not load correctly.';
  }
  // Pass through messages that are already descriptive (thrown by our own helpers)
  return `${prefix}${msg}`;
}

/**
 * Run browser automation with a callback function.
 * Handles browser launch, login, cleanup, and graceful error reporting.
 *
 * @param {object} config - environment configuration
 * @param {Function} callback - async function that receives the page object
 */
async function withBrowser(config, callback) {
  let browser;
  try {
    browser = await chromium.launch({ headless: config.headless });
  } catch (err) {
    throw new Error(formatError(err, 'browser launch'));
  }

  try {
    const page = await browser.newPage();

    // Set generous timeouts for slow Spira instances (90 seconds)
    page.setDefaultNavigationTimeout(90000);
    page.setDefaultTimeout(90000);

    // Capture uncaught page errors and console errors in headless mode
    if (config.headless) {
      page.on('pageerror', (err) => {
        process.stderr.write(`[page error] ${err.message}\n`);
      });
    }

    await login(page, config);
    await page.waitForTimeout(1000);
    await callback(page);
  } catch (err) {
    // Re-throw with a clean message — formatError preserves already-clean messages
    throw new Error(formatError(err));
  } finally {
    await browser.close().catch(() => {}); // always close, ignore double-close errors
  }
}

/**
 * Run the full automation: build, upload, and optionally activate.
 *
 * @param {object} config - environment configuration
 * @param {string} spiraappPath - absolute path to the .spiraapp file
 * @param {string} appName - SpiraApp name from manifest.yaml
 * @param {boolean} [uploadOnly=false] - when true, skip system-wide activation
 */
async function runAutomation(config, spiraappPath, appName, uploadOnly = false) {
  await withBrowser(config, async (page) => {
    if (config.enableDevMode === true) {
      await enableDeveloperMode(page, config);
    }
    await uploadSpiraApp(page, spiraappPath, config);
    await verifyUpload(page, appName);

    if (uploadOnly === false) {
      await activateSpiraApp(page, appName);

      for (const projectId of config.enableProjectIds) {
        await toggleForProduct(page, config.baseUrl, projectId, appName, true);
      }
    } else {
      console.log(`SpiraApp "${appName}" has been built and uploaded successfully (activation skipped).`);
    }
  });
}

async function runEnableOnly(config, appName) {
  await withBrowser(config, async (page) => {
    for (const projectId of config.enableProjectIds) {
      await toggleForProduct(page, config.baseUrl, projectId, appName, true);
    }
  });
}

async function runDisableOnly(config, appName) {
  await withBrowser(config, async (page) => {
    for (const projectId of config.disableProjectIds) {
      await toggleForProduct(page, config.baseUrl, projectId, appName, false);
    }
  });
}

module.exports = { 
  parseArgs, 
  deriveOutputFolder, 
  loadEnv, 
  bumpVersion, 
  runBuild, 
  login, 
  enableDeveloperMode, 
  uploadSpiraApp, 
  verifyUpload, 
  activateSpiraApp, 
  runAutomation, 
  runEnableOnly, 
  runDisableOnly, 
  toggleForProduct,
  normalizeBaseUrl,
  readManifest,
  formatError
};

if (require.main === module) {
  const readline = require('readline');

  function prompt(question) {
    return new Promise(resolve => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
    });
  }

  async function main() {
    const config = loadEnv();
    const { inputFolder } = parseArgs(process.argv);
    const { manifest } = readManifest(inputFolder);
    const appName = manifest.name;

    // Determine mode from flags or prompt
    let mode;
    
    if (process.argv.includes('--disable')) {
      mode = '4';
    } else if (process.argv.includes('--enable')) {
      mode = '3';
    } else if (process.argv.includes('--upload')) {
      // --upload flag: run build + upload only (mode 2)
      mode = '2';
    } else {
      process.stdout.write('\nWhat would you like to do?\n');
      process.stdout.write('  1. Build, upload and enable\n');
      process.stdout.write('  2. Build and upload only (no activation)\n');
      process.stdout.write('  3. Enable only (no build/upload)\n');
      process.stdout.write('  4. Disable only\n\n');
      mode = await prompt('Enter 1, 2, 3 or 4: ');
    }

    if (mode === '1') {
      const outputFolder = deriveOutputFolder(inputFolder);
      const { spiraappPath, appName: builtAppName } = runBuild(inputFolder, outputFolder, config.incrementVersion);
      await runAutomation(config, spiraappPath, builtAppName, false);
      process.stdout.write(`\nDone! SpiraApp "${builtAppName}" has been built, uploaded, and enabled.\n`);
    } else if (mode === '2') {
      const outputFolder = deriveOutputFolder(inputFolder);
      const { spiraappPath, appName: builtAppName } = runBuild(inputFolder, outputFolder, config.incrementVersion);
      await runAutomation(config, spiraappPath, builtAppName, true);
      process.stdout.write(`\nDone! SpiraApp "${builtAppName}" has been built and uploaded.\n`);
    } else if (mode === '3') {
      await runEnableOnly(config, appName);
      process.stdout.write(`\nDone! SpiraApp "${appName}" has been enabled for projects: ${config.enableProjectIds.join(', ')}\n`);
    } else if (mode === '4') {
      await runDisableOnly(config, appName);
      process.stdout.write(`\nDone! SpiraApp "${appName}" has been disabled for projects: ${config.disableProjectIds.join(', ')}\n`);
    } else {
      process.stderr.write('Invalid choice. Please enter 1, 2, 3 or 4.\n');
      process.exit(1);
    }

    process.exit(0);
  }

  main().catch(err => {
    const msg = formatError(err);
    process.stderr.write(`\nError: ${msg}\n`);
    process.exit(1);
  });
}
