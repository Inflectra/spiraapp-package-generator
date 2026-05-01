# SpiraApp Package Generator

This repo takes a SpiraApp `manifest.yaml` and its associated files and converts them into a valid `.spiraapp` package file. It also includes an optional automation script that can build, upload, and manage SpiraApps on a Spira instance using browser automation.

---

## Table of Contents

- [Setup](#setup)
- [Building a Package Manually (index.js)](#building-a-package-manually)
- [Automation Script (bundle-automation.js)](#automation-script)
  - [Environment Configuration](#environment-configuration)
  - [Running the Script](#running-the-script)
  - [Available Flags](#available-flags)
  - [What Each Mode Does](#what-each-mode-does)
  - [Important Notes](#important-notes)

---

## Setup

1. Clone this repo
2. Open a terminal in the repo directory
3. Run `npm install` to install dependencies
4. If using the automation script, copy `.env.example` to `.env` and fill in your Spira credentials

---

## Building a Package Manually

The `index.js` script packages a SpiraApp source folder into a `.spiraapp` file. Use this if you only want to build — no Spira instance or credentials required.

```bash
npm run build --input=/path/to/SpiraApp --output=/path/to/output
```

**Example:**
```bash
npm run build --input=/Users/yourname/MySpiraApp --output=/Users/yourname/Bundles
```

- `--input` — path to the folder containing `manifest.yaml` (required)
- `--output` — path to the folder where the `.spiraapp` file will be saved (required)
- `--debug` — disables JS minification, useful for inspecting the output:
  ```bash
  npm run build --input=/path/to/SpiraApp --output=/path/to/output --debug
  ```

The package file is named automatically using the SpiraApp's `guid` from `manifest.yaml`. Any validation errors in the manifest are printed to the console.

> **Note:** Inflectra will never ask you for your `.spiraapp` file — only ever the source code used to generate it.

---

## Automation Script

`bundle-automation.js` automates the full development workflow: building the package, uploading it to a Spira instance, and managing its activation state. It uses Playwright to drive a browser session against your Spira instance.

This script is designed for developers who want to quickly iterate and test SpiraApps without manually uploading through the UI each time.

### Environment Configuration

Copy `.env.example` to `.env` and fill in your values:

| Variable | Required | Default | Description |
|---|---|---|---|
| `SPIRA_BASE_URL` | Yes | — | Base URL of your Spira instance |
| `SPIRA_USERNAME` | Yes | — | Your Spira username |
| `SPIRA_PASSWORD` | Yes | — | Your Spira password |
| `SPIRA_ENABLE_PROJECT_IDS` | No | _(none)_ | Comma-separated project IDs to enable the SpiraApp for |
| `SPIRA_DISABLE_PROJECT_IDS` | No | _(none)_ | Comma-separated project IDs to disable the SpiraApp for |
| `PLAYWRIGHT_HEADLESS` | No | `true` | Set to `false` to run the browser in headed mode (visible window). Default is headless (no visible browser). |
| `SPIRA_ENABLE_DEV_MODE` | No | `false` | Set to `true` to enable Developer Mode in Spira General Settings before uploading. Only needed the first time or if Developer Mode has been turned off. |
| `SPIRA_INCREMENT_VERSION` | No | `false` | Set to `true` to auto-increment the patch version in `manifest.yaml` before each build (e.g. `1.0` → `1.1`). Default is off — the version in `manifest.yaml` is used as-is. |

### Running the Script

```bash
node bundle-automation.js --input=/path/to/SpiraApp
```

**Example:**
```bash
node bundle-automation.js --input=/Users/yourname/MySpiraApp
```

Without any mode flags, the script prompts you to choose what to do:

```
What would you like to do?
  1. Build, upload and enable
  2. Enable only (no build/upload)
  3. Disable only
```

### Available Flags

You can skip the prompt by passing a flag directly:

```bash
# Build, upload, and enable system-wide (default of full workflow)
node bundle-automation.js --input=/path/to/SpiraApp
# then choose option 1 at the prompt

# Build and upload only — no system-wide activation
node bundle-automation.js --input=/path/to/SpiraApp --upload

# Enable only (no build or upload)
node bundle-automation.js --input=/path/to/SpiraApp --enable

# Disable only
node bundle-automation.js --input=/path/to/SpiraApp --disable
```

### What Each Mode Does

**Build, upload and enable (default / option 1)**
1. Optionally bumps the patch version in `manifest.yaml` (if `SPIRA_INCREMENT_VERSION=true`)
2. Builds the `.spiraapp` package file
3. Logs into Spira using browser automation
4. Optionally enables Developer Mode (if `SPIRA_ENABLE_DEV_MODE=true`)
5. Uploads the `.spiraapp` file to the SpiraApps administration page
6. Activates the SpiraApp system-wide (if not already active)
7. Enables the SpiraApp for any projects listed in `SPIRA_ENABLE_PROJECT_IDS`

**Build and upload only (`--upload`)**

Same as above but stops after step 5 — the SpiraApp is uploaded but not activated system-wide. Use this when you want to control activation separately.

**Enable only (`--enable`)**

Logs into Spira and enables the SpiraApp for the projects listed in `SPIRA_ENABLE_PROJECT_IDS`. No build or upload is performed.

**Disable only (`--disable`)**

Logs into Spira and disables the SpiraApp for the projects listed in `SPIRA_DISABLE_PROJECT_IDS`. No build or upload is performed.

### Important Notes

**Activation is enabled/disabled — it does not toggle**

Running the enable/activate script when the SpiraApp is already enabled will not disable it. The script checks the current state first and only acts if a change is needed.

Likewise, running the disable script when the SpiraApp is already disabled will not re-enable it.

To disable a SpiraApp, you must explicitly run the disable script (`--disable`). Running the enable script again will not undo it, and vice versa. The two operations are fully independent.

**Developer Mode**

Developer Mode only needs to be enabled once per Spira instance. After that, you can leave `SPIRA_ENABLE_DEV_MODE` unset (or set to `false`) to skip that step on every subsequent run, making the workflow faster.

**Version incrementing**

By default, the version in `manifest.yaml` is not changed. Set `SPIRA_INCREMENT_VERSION=true` if you want the patch version bumped automatically before each build. Note that Spira does not require a version change to replace an uploaded SpiraApp — the upload will overwrite the existing package regardless.

**Headless mode**

By default the browser runs in headed mode (you can see it). Set `PLAYWRIGHT_HEADLESS=true` to run silently. In headless mode, errors are still reported to the terminal with clear, actionable messages.
