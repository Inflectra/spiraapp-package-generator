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
const { chromium } = require('playwright');

/**
 * Parse CLI arguments and validate the --input folder.
 *
 * Accepts:
 *   --input=<value>
 *   --input <value>
 *
 * @param {string[]} argv - process.argv (or equivalent)
 * @returns {{ inputFolder: string }}
 */
function parseArgs(argv) {
  let inputFolder = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith('--input=')) {
      inputFolder = arg.slice('--input='.length);
      break;
    }

    if (arg === '--input' && i + 1 < argv.length) {
      inputFolder = argv[i + 1];
      break;
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

  return { inputFolder: resolvedInput };
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
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    for (const key of missing) {
      process.stderr.write(`Error: Missing required environment variable: ${key}\n`);
    }
    process.exit(1);
  }

  return {
    baseUrl: process.env.SPIRA_BASE_URL,
    username: process.env.SPIRA_USERNAME,
    password: process.env.SPIRA_PASSWORD,
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
 * @returns {string} the new version string
 */
function bumpVersion(manifestPath) {
  const yaml = require('js-yaml');
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = yaml.load(raw);

  const current = String(manifest.version);
  const parts = current.split('.');
  const major = parts[0] || '1';
  const minor = parseInt(parts[1] || '0', 10);
  const newVersion = `${major}.${minor + 1}`;

  // Replace the version line in the raw file to preserve formatting/comments
  const updated = raw.replace(
    /^version:\s*.+$/m,
    `version: ${newVersion}`
  );
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
 * @returns {{ spiraappPath: string, appName: string }}
 */
function runBuild(inputFolder, outputFolder) {
  const yaml = require('js-yaml');

  // 1. Ensure output folder exists
  fs.mkdirSync(outputFolder, { recursive: true });

  const resolvedInput  = path.resolve(inputFolder);
  const resolvedOutput = path.resolve(outputFolder);

  // Auto-increment version in manifest.yaml before building
  const manifestPath = path.join(resolvedInput, 'manifest.yaml');
  bumpVersion(manifestPath);

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
  const spiraappPath = path.join(resolvedOutput, spiraappFile);

  // 8. Read manifest.yaml to get appName (manifestPath already defined above)
  const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf-8'));
  const appName = manifest.name;

  // 9. Return result
  return { spiraappPath, appName };
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
  // Normalise trailing slash then build login URL
  const base = config.baseUrl.replace(/\/+$/, '');
  const loginUrl = `${base}/Login.aspx`;

  await page.goto(loginUrl);

  // Fill credentials and submit
  await page.fill('input[name="txtUserName"], input[id*="UserName"], input[type="text"]', config.username);
  await page.fill('input[name="txtPassword"], input[id*="Password"], input[type="password"]', config.password);
  await page.click('input[type="submit"], button[type="submit"]');

  // Wait for navigation to settle
  await page.waitForLoadState('networkidle');

  // Handle "sign out other sessions" dialog if it appears
  const signOutBtn = page.locator('input[type="submit"], button[type="submit"]').filter({ hasText: /sign out|logout|ok|yes|continue/i });
  const hasSignOutDialog = await signOutBtn.isVisible().catch(() => false);
  if (hasSignOutDialog) {
    await signOutBtn.first().click();
    await page.waitForLoadState('networkidle');
  }

  // Detect failure: error element visible OR URL still contains "Login"
  const currentUrl = page.url();
  const errorVisible = await page.locator(
    '.ErrorMessage, .error-message, [id*="Error"], [class*="error"]'
  ).isVisible().catch(() => false);

  if (errorVisible || currentUrl.includes('Login')) {
    throw new Error(
      `Login failed for user "${config.username}" at ${loginUrl}. ` +
      'Check your credentials and that the Spira instance is reachable.'
    );
  }
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
  const base = config.baseUrl.replace(/\/+$/, '');
  await page.goto(`${base}/Administration/GeneralSettings.aspx`);
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
 */
async function uploadSpiraApp(page, spiraappPath) {
  // Derive the base URL from the current page URL
  const currentUrl = new URL(page.url());
  const pathParts = currentUrl.pathname.split('/').filter(Boolean);
  const adminIdx = pathParts.indexOf('Administration');
  const basePath = adminIdx > 0
    ? '/' + pathParts.slice(0, adminIdx).join('/')
    : '';
  const spiraAppsUrl = `${currentUrl.protocol}//${currentUrl.host}${basePath}/Administration/SpiraApps.aspx`;

  await page.goto(spiraAppsUrl);
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
 * Enable the SpiraApp for a specific product via Product Admin > SpiraApps.
 *
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 * @param {string} projectId
 * @param {string} appName
 */
async function enableForProduct(page, baseUrl, projectId, appName) {
  const base = baseUrl.replace(/\/+$/, '');
  const url = `${base}/${projectId}/Administration/SpiraApps.aspx`;

  console.log(`Enabling SpiraApp for project ${projectId}...`);
  await page.goto(url);
  await page.waitForLoadState('networkidle');

  // Find all activate links — use $ to match end of id segment to avoid matching lnkDeactivate
  const activateLinks = page.locator('a[id*="lnkActivate_"]');
  const count = await activateLinks.count();

  if (count === 0) {
    console.log(`SpiraApp "${appName}" already enabled for project ${projectId}.`);
    return;
  }

  // Find the activate link whose ancestor row contains the app name
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const link = activateLinks.nth(i);
    const row = link.locator('xpath=ancestor::tr').first();
    const rowText = await row.innerText().catch(() => '');
    if (rowText.includes(appName)) {
      // Use dispatchEvent to simulate a real click — avoids strict mode issues
      // with ASP.NET's __doPostBack when called via page.evaluate
      await link.dispatchEvent('click');
      // Wait for the full ASP.NET postback to complete
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle');
      clicked = true;
      break;
    }
  }

  if (clicked) {
    console.log(`SpiraApp "${appName}" enabled for project ${projectId}.`);
  } else {
    console.log(`SpiraApp "${appName}" already enabled for project ${projectId}.`);
  }
}

/**
 * Disable the SpiraApp for a specific product.
 *
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 * @param {string} projectId
 * @param {string} appName
 */
async function disableForProduct(page, baseUrl, projectId, appName) {
  const base = baseUrl.replace(/\/+$/, '');
  const url = `${base}/${projectId}/Administration/SpiraApps.aspx`;

  console.log(`Disabling SpiraApp for project ${projectId}...`);
  await page.goto(url);
  await page.waitForLoadState('networkidle');

  // Find all deactivate links
  const deactivateLinks = page.locator('a[id*="lnkDeactivate"]');
  const count = await deactivateLinks.count();

  if (count === 0) {
    console.log(`SpiraApp "${appName}" already disabled for project ${projectId}.`);
    return;
  }

  let clicked = false;
  for (let i = 0; i < count; i++) {
    const link = deactivateLinks.nth(i);
    const row = link.locator('xpath=ancestor::tr').first();
    const rowText = await row.innerText().catch(() => '');
    if (rowText.includes(appName)) {
      await link.dispatchEvent('click');
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle');
      clicked = true;
      break;
    }
  }

  if (clicked) {
    console.log(`SpiraApp "${appName}" disabled for project ${projectId}.`);
  } else {
    console.log(`SpiraApp "${appName}" already disabled for project ${projectId}.`);
  }
}

/**
 * Run the full Playwright automation sequence: login, enable developer mode,
 * upload the SpiraApp, verify the upload, and activate it system-wide.
 *
 * Launches a non-headless Chromium browser so developers can observe the
 * automation. The browser is always closed in the `finally` block regardless
 * of success or failure.
 *
 * @param {{ baseUrl: string, username: string, password: string }} config
 * @param {string} spiraappPath - absolute path to the .spiraapp file
 * @param {string} appName - SpiraApp name (from manifest.yaml)
 */
async function runAutomation(config, spiraappPath, appName) {
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    await login(page, config);
    await enableDeveloperMode(page, config);
    await uploadSpiraApp(page, spiraappPath);
    await verifyUpload(page, appName);
    await activateSpiraApp(page, appName);

    for (const projectId of config.enableProjectIds) {
      await enableForProduct(page, config.baseUrl, projectId, appName);
    }
  } finally {
    await browser.close();
  }
}

async function runEnableOnly(config, appName) {
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    await login(page, config);
    await page.waitForTimeout(1000);
    for (const projectId of config.enableProjectIds) {
      await enableForProduct(page, config.baseUrl, projectId, appName);
    }
  } finally {
    await browser.close();
  }
}

async function runDisableOnly(config, appName) {
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    await login(page, config);
    await page.waitForTimeout(1000);
    for (const projectId of config.disableProjectIds) {
      await disableForProduct(page, config.baseUrl, projectId, appName);
    }
  } finally {
    await browser.close();
  }
}

module.exports = { parseArgs, deriveOutputFolder, loadEnv, bumpVersion, runBuild, login, enableDeveloperMode, uploadSpiraApp, verifyUpload, activateSpiraApp, runAutomation, runEnableOnly, runDisableOnly, enableForProduct, disableForProduct };

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

    // Determine mode from flags or prompt
    const args = process.argv;
    let mode;
    if (args.includes('--disable')) {
      mode = '3';
    } else if (args.includes('--enable')) {
      mode = '2';
    } else {
      process.stdout.write('\nWhat would you like to do?\n');
      process.stdout.write('  1. Build, upload and enable\n');
      process.stdout.write('  2. Enable only (no build/upload)\n');
      process.stdout.write('  3. Disable only\n\n');
      mode = await prompt('Enter 1, 2 or 3: ');
    }

    // Read app name from manifest for modes 2 and 3
    const yaml = require('js-yaml');
    const manifestPath = require('path').join(inputFolder, 'manifest.yaml');
    const manifest = yaml.load(require('fs').readFileSync(manifestPath, 'utf-8'));
    const appName = manifest.name;

    if (mode === '1') {
      const outputFolder = deriveOutputFolder(inputFolder);
      const { spiraappPath, appName: builtAppName } = runBuild(inputFolder, outputFolder);
      await runAutomation(config, spiraappPath, builtAppName);
      process.stdout.write(`\nDone! SpiraApp "${builtAppName}" has been built, uploaded, and enabled.\n`);
    } else if (mode === '2') {
      await runEnableOnly(config, appName);
      process.stdout.write(`\nDone! SpiraApp "${appName}" has been enabled for projects: ${config.enableProjectIds.join(', ')}\n`);
    } else if (mode === '3') {
      await runDisableOnly(config, appName);
      process.stdout.write(`\nDone! SpiraApp "${appName}" has been disabled for projects: ${config.disableProjectIds.join(', ')}\n`);
    } else {
      process.stderr.write('Invalid choice. Please enter 1, 2 or 3.\n');
      process.exit(1);
    }

    process.exit(0);
  }

  main().catch(err => {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  });
}
