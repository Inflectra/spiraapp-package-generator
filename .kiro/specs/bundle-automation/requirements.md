# Requirements Document

## Introduction

The bundle-automation script automates the full end-to-end workflow of building a SpiraApp package and deploying it to a Spira instance. It accepts an input folder path, derives the output folder automatically, runs the existing build process to produce a `.spiraapp` file, and then uses Playwright browser automation to log in to Spira, enable developer mode, upload the package, and activate the SpiraApp system-wide. Credentials and the Spira base URL are loaded from a `.env` file.

## Glossary

- **Script**: The `bundle-automation.js` Node.js script being specified.
- **Input_Folder**: The file system path to the folder containing the SpiraApp source files and `manifest.yaml`, supplied via `--input` CLI argument.
- **Output_Folder**: The auto-derived output directory, formed by appending `"Bundle"` to the Input_Folder name (e.g. `/path/to/AIConnect` → `/path/to/AIConnectBundle`).
- **Build_Process**: The packaging logic from `index.js` that reads `manifest.yaml`, validates it, inlines referenced files, and writes a `.spiraapp` file.
- **SpiraApp_File**: The `.spiraapp` package file produced by the Build_Process, named `{guid}.spiraapp`.
- **Spira_Instance**: The Spira web application reachable at `SPIRA_BASE_URL`.
- **Browser_Session**: The Playwright-controlled Chromium browser session used to interact with the Spira_Instance.
- **Developer_Mode**: The Spira system administration setting that must be enabled before SpiraApps can be uploaded.
- **Env_File**: The `.env` file in the repository root containing `SPIRA_BASE_URL`, `SPIRA_USERNAME`, and `SPIRA_PASSWORD`.
- **Power_Toggle**: The UI control on the SpiraApps administration page that enables or disables a SpiraApp system-wide.

---

## Requirements

### Requirement 1: CLI Argument Parsing

**User Story:** As a developer, I want to run the script with a single `--input` argument, so that I can trigger the full build-and-deploy workflow without manually specifying an output path.

#### Acceptance Criteria

1. WHEN the Script is invoked with `--input="<path>"`, THE Script SHALL parse the value of `--input` as the Input_Folder path.
2. IF the `--input` argument is absent or empty, THEN THE Script SHALL print a descriptive error message to stderr and exit with a non-zero exit code.
3. IF the Input_Folder does not contain a `manifest.yaml` file, THEN THE Script SHALL print a descriptive error message to stderr and exit with a non-zero exit code.

---

### Requirement 2: Output Folder Derivation

**User Story:** As a developer, I want the output folder to be derived automatically from the input folder name, so that I do not need to specify it manually.

#### Acceptance Criteria

1. WHEN the Input_Folder path is parsed, THE Script SHALL derive the Output_Folder by appending the string `"Bundle"` to the final directory name of the Input_Folder (e.g. `/path/to/AIConnect` → `/path/to/AIConnectBundle`).
2. IF the Output_Folder does not exist, THEN THE Script SHALL create it before writing any files.
3. THE Script SHALL use the derived Output_Folder as the destination for the SpiraApp_File produced by the Build_Process.

---

### Requirement 3: Build Process Execution

**User Story:** As a developer, I want the script to run the same build logic as `npm run build`, so that a valid `.spiraapp` file is produced without requiring a separate manual step.

#### Acceptance Criteria

1. WHEN the Input_Folder and Output_Folder are resolved, THE Script SHALL execute the Build_Process using the Input_Folder as source and the Output_Folder as destination.
2. IF the Build_Process reports one or more validation errors, THEN THE Script SHALL print the errors to stderr and exit with a non-zero exit code without proceeding to browser automation.
3. WHEN the Build_Process completes successfully, THE Script SHALL resolve the path of the generated SpiraApp_File within the Output_Folder before proceeding.

---

### Requirement 4: Environment Configuration Loading

**User Story:** As a developer, I want credentials and the Spira URL to be loaded from a `.env` file, so that sensitive values are never hard-coded or passed on the command line.

#### Acceptance Criteria

1. WHEN the Script starts, THE Script SHALL load environment variables from the Env_File using `dotenv` before any browser automation begins.
2. IF any of `SPIRA_BASE_URL`, `SPIRA_USERNAME`, or `SPIRA_PASSWORD` are missing from the environment after loading, THEN THE Script SHALL print a descriptive error message identifying the missing variable(s) and exit with a non-zero exit code.
3. THE Script SHALL treat `SPIRA_PASSWORD` as a sensitive value and SHALL NOT print it to stdout or stderr at any point during execution.

---

### Requirement 5: Spira Login

**User Story:** As a developer, I want the script to log in to the Spira instance automatically, so that subsequent administration steps can be performed without manual intervention.

#### Acceptance Criteria

1. WHEN browser automation begins, THE Script SHALL open a Browser_Session and navigate to the Spira_Instance login page derived from `SPIRA_BASE_URL`.
2. WHEN the login page is loaded, THE Script SHALL enter `SPIRA_USERNAME` into the username field and `SPIRA_PASSWORD` into the password field, then submit the login form.
3. IF login fails (e.g. invalid credentials or unreachable URL), THEN THE Script SHALL close the Browser_Session, print a descriptive error message to stderr, and exit with a non-zero exit code.

---

### Requirement 6: Developer Mode Activation

**User Story:** As a developer, I want the script to ensure developer mode is enabled in Spira, so that SpiraApp uploads are permitted.

#### Acceptance Criteria

1. WHEN the Browser_Session is authenticated, THE Script SHALL navigate to the System Administration > General Settings page.
2. WHEN the General Settings page is loaded, THE Script SHALL check the current state of the Developer Mode setting.
3. IF Developer Mode is not already enabled, THEN THE Script SHALL enable it and save the settings before proceeding.
4. IF Developer Mode is already enabled, THEN THE Script SHALL proceed without modifying the setting.

---

### Requirement 7: SpiraApp Upload

**User Story:** As a developer, I want the script to upload the generated `.spiraapp` file to Spira automatically, so that the latest build is deployed without manual file handling.

#### Acceptance Criteria

1. WHEN Developer Mode is confirmed active, THE Script SHALL navigate to the System Administration > SpiraApps page.
2. WHEN the SpiraApps page is loaded, THE Script SHALL identify the file upload input that accepts `.spiraapp` files (not the `.spira` upload control) and use it to upload the SpiraApp_File.
3. WHEN the upload completes, THE Script SHALL verify that the uploaded SpiraApp appears in the SpiraApps list before proceeding.
4. IF the upload fails or the SpiraApp does not appear in the list within 30 seconds, THEN THE Script SHALL print a descriptive error message to stderr and exit with a non-zero exit code.

---

### Requirement 8: SpiraApp System-Wide Activation

**User Story:** As a developer, I want the script to enable the uploaded SpiraApp system-wide automatically, so that it is immediately available without a separate manual toggle.

#### Acceptance Criteria

1. WHEN the uploaded SpiraApp appears in the SpiraApps list, THE Script SHALL locate the Power_Toggle for that SpiraApp.
2. IF the Power_Toggle is in the disabled state, THEN THE Script SHALL click it to enable the SpiraApp system-wide.
3. IF the Power_Toggle is already in the enabled state, THEN THE Script SHALL proceed without clicking it.
4. WHEN the Power_Toggle is activated, THE Script SHALL confirm the SpiraApp is shown as enabled in the SpiraApps list before closing the Browser_Session.

---

### Requirement 9: Browser Session Cleanup

**User Story:** As a developer, I want the browser session to be closed cleanly after the workflow completes or fails, so that no orphaned browser processes are left running.

#### Acceptance Criteria

1. WHEN the full workflow completes successfully, THE Script SHALL close the Browser_Session and print a success message to stdout.
2. IF any unhandled error occurs during browser automation, THEN THE Script SHALL close the Browser_Session before exiting with a non-zero exit code.
3. THE Script SHALL close the Browser_Session regardless of whether the workflow succeeded or failed.
