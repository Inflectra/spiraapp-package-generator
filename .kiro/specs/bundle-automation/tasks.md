# Implementation Plan: bundle-automation

## Overview

Implement `bundle-automation.js` as a single-file Node.js CLI script that wraps the existing `index.js` build logic and drives a Playwright browser session to deploy the produced `.spiraapp` file to a Spira instance. The implementation proceeds in layers: pure utility functions first, then the build runner, then browser automation, then wiring everything together.

## Tasks

- [x] 1. Project setup and environment scaffolding
  - Add `playwright`, `dotenv`, and `fast-check` to `package.json` dependencies (move `playwright` and `dotenv` from `devDependencies` to `dependencies`; add `fast-check` as a `devDependency`)
  - Add a `test` script to `package.json`: `"test": "node --test"`
  - Add `.env` to `.gitignore`
  - Create `.env.example` in the repo root with placeholder values for `SPIRA_BASE_URL`, `SPIRA_USERNAME`, and `SPIRA_PASSWORD`
  - Create the empty `bundle-automation.js` file in the repo root
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 2. Implement CLI argument parsing and output folder derivation
  - [x] 2.1 Implement `parseArgs(argv)` in `bundle-automation.js`
    - Parse `--input=<value>` or `--input <value>` from `argv`
    - Print descriptive message to stderr and call `process.exit(1)` if `--input` is absent or empty
    - Print descriptive message to stderr and call `process.exit(1)` if `manifest.yaml` is not found in the resolved input folder
    - Export or expose the function for testing
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 2.2 Write property test for `parseArgs` — Property 2
    - **Property 2: Missing or empty `--input` always exits non-zero**
    - Generate `argv` arrays that omit `--input` or supply it with an empty value; assert non-zero exit and non-empty stderr
    - **Validates: Requirements 1.2**

  - [ ]* 2.3 Write property test for `parseArgs` — Property 3
    - **Property 3: Missing manifest always exits non-zero**
    - Generate input folder paths that resolve to directories without `manifest.yaml`; assert non-zero exit and descriptive stderr
    - **Validates: Requirements 1.3**

  - [x] 2.4 Implement `deriveOutputFolder(inputFolder)` in `bundle-automation.js`
    - Use `path.basename` and `path.dirname` to construct `<name>Bundle` sibling directory
    - Export or expose the function for testing
    - _Requirements: 2.1_

  - [ ]* 2.5 Write property test for `deriveOutputFolder` — Property 1
    - **Property 1: Output folder name derivation**
    - Generate arbitrary valid path strings; assert result equals `path.join(path.dirname(p), path.basename(p) + 'Bundle')`
    - **Validates: Requirements 2.1**

- [ ] 3. Implement environment loader
  - [x] 3.1 Implement `loadEnv()` in `bundle-automation.js`
    - Call `dotenv.config()` to load `.env`
    - Check for `SPIRA_BASE_URL`, `SPIRA_USERNAME`, `SPIRA_PASSWORD`; print each missing variable name to stderr and call `process.exit(1)` if any are absent
    - Return `{ baseUrl, username, password }` — never log the password value
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 3.2 Write property test for `loadEnv` — Property 4
    - **Property 4: Any missing env var exits non-zero and names it**
    - Generate all non-empty subsets of the three required vars as missing; assert exit non-zero and each missing var name appears in stderr
    - **Validates: Requirements 4.2**

  - [ ]* 3.3 Write property test for password redaction — Property 5
    - **Property 5: Password value never appears in output**
    - Generate arbitrary password strings; run `loadEnv` and error paths; assert the password value never appears in any captured stdout or stderr
    - **Validates: Requirements 4.3**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement build runner
  - [x] 5.1 Implement `runBuild(inputFolder, outputFolder)` in `bundle-automation.js`
    - Create `outputFolder` with `fs.mkdirSync` if it does not exist (satisfies Requirement 2.2)
    - Temporarily set `process.env.npm_config_input` and `process.env.npm_config_output` to the resolved paths (with trailing slash) before invoking the build logic
    - Require and call `exports.package` from `index.js`; capture console output to detect error messages
    - Restore or delete the temporary env vars after the call
    - Scan `outputFolder` for the produced `{guid}.spiraapp` file; throw if not found
    - Return `{ spiraappPath, appName }` where `appName` is read from `manifest.yaml`
    - Print build errors to stderr and call `process.exit(1)` if the build reports errors
    - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.3_

  - [ ]* 5.2 Write property test for build error gating — Property 6
    - **Property 6: Build errors prevent browser launch**
    - Generate manifests with injected validation errors; assert script exits non-zero and `playwright.chromium.launch()` is never called
    - **Validates: Requirements 3.2**

- [x] 6. Implement Playwright automation helpers
  - [x] 6.1 Implement `login(page, config)` helper
    - Navigate to the login page derived from `config.baseUrl`
    - Fill username and password fields and submit the form
    - Detect login failure (e.g. error element visible or redirect did not occur); throw a descriptive error if login fails
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 6.2 Write property test for login URL derivation — Property 8
    - **Property 8: Login URL correctly derived from base URL**
    - Generate base URLs with/without trailing slashes and various path prefixes; assert constructed login URL starts with the normalised base URL and ends with the expected login path segment
    - **Validates: Requirements 5.1**

  - [x] 6.3 Implement `enableDeveloperMode(page, config)` helper
    - Navigate to the System Administration > General Settings page
    - Check the current state of the Developer Mode toggle
    - If not already enabled, enable it and save; otherwise proceed without modifying
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 6.4 Implement `uploadSpiraApp(page, spiraappPath)` helper
    - Navigate to the System Administration > SpiraApps page
    - Locate the `.spiraapp` file upload input (not the `.spira` control) and set the file path
    - Trigger the upload and wait for the network/UI response
    - _Requirements: 7.1, 7.2_

  - [x] 6.5 Implement `verifyUpload(page, appName)` helper
    - Poll the SpiraApps list for the uploaded app by name with a 30-second timeout
    - Throw a descriptive error if the app does not appear within the timeout
    - _Requirements: 7.3, 7.4_

  - [x] 6.6 Implement `activateSpiraApp(page, appName)` helper
    - Locate the Power Toggle for the SpiraApp by name
    - Click the toggle if it is in the disabled state; skip if already enabled
    - Confirm the SpiraApp is shown as enabled before returning
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 7. Implement `runAutomation` and top-level wiring
  - [x] 7.1 Implement `runAutomation(config, spiraappPath, appName)` in `bundle-automation.js`
    - Launch a Playwright Chromium browser session
    - Call `login`, `enableDeveloperMode`, `uploadSpiraApp`, `verifyUpload`, `activateSpiraApp` in sequence
    - Wrap the entire sequence in `try/finally` so `browser.close()` is always called regardless of success or failure
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]* 7.2 Write property test for browser session cleanup — Property 7
    - **Property 7: Browser session always closed on exit**
    - Simulate errors thrown at various points in the automation flow; assert `browser.close()` is always called before process exit
    - **Validates: Requirements 9.2, 9.3**

  - [x] 7.3 Wire the main entry point in `bundle-automation.js`
    - Call `parseArgs`, `loadEnv`, `deriveOutputFolder`, `runBuild`, then `runAutomation` in sequence
    - Wrap the top-level call in a `try/catch` that prints unhandled errors to stderr and calls `process.exit(1)`
    - Print a success message to stdout and call `process.exit(0)` on completion
    - Guard the main invocation so the file can be `require`d in tests without auto-executing
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 9.1_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use `fast-check` with Node's built-in `node:test` runner (minimum 100 iterations each)
- Unit tests use Node's built-in `node:test` and `assert` modules
- `index.js` is invoked via its exported `package` function with env vars set temporarily — no subprocess spawning needed
