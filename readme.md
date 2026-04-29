# SpiraApp package generator
This repo takes a SpiraApp manifest.yaml describing a SpiraApp and its associated (and referenced) files, and converts it into a valid SpiraApp package file. 

The package file is automatically given the correct name based on the SpiraApp's guid. As part of the packaging process the SpiraApp is validated in a number of ways to ensure that will be able to be safely loaded into Spira.

## Setup

- Clone this repo
- Open the terminal and navigate to the directory where this repo lives
- Run `npm install` to install the dependencies
- [For Automation Only] Copy `.env.example` to `.env` and fill in your Spira credentials

## Building a SpiraApp Package

To create new bundle file manually:

```bash
npm run build --input=/path/to/SpiraApp --output=/path/to/output
```

**Example:**
```bash
npm run build --input=/Users/yourname/MySpiraApp --output=/Users/yourname/Bundles
```

- The `--input` parameter is the path to the folder containing `manifest.yaml`
- The `--output` parameter is the path to the folder where the `.spiraapp` file will be saved
- If you want to build for debug purposes (no JS minification), add the `--debug` flag:
  ```bash
  npm run build --input=/path/to/SpiraApp --output=/path/to/output --debug
  ```

If there are any errors in the manifest, they will be logged in the console.

---

## Developer Automation: Build, Upload, and Deploy

The `bundle-automation.js` script automates the full development workflow: building the package, uploading it to Spira, and enabling it system-wide and/or for specific projects. This is designed for developers who want to quickly iterate and test their SpiraApps.

### Environment Configuration

Create a `.env` file in the repo root with the following variables:

```
SPIRA_BASE_URL=https://your-spira-instance.example.com
SPIRA_USERNAME=your_username
SPIRA_PASSWORD=your_password
SPIRA_ENABLE_PROJECT_IDS=1,2,3
SPIRA_DISABLE_PROJECT_IDS=4,5
```

- `SPIRA_BASE_URL` - The base URL of your Spira instance (required)
- `SPIRA_USERNAME` - Your Spira username (required)
- `SPIRA_PASSWORD` - Your Spira password (required)
- `SPIRA_ENABLE_PROJECT_IDS` - Comma-separated project IDs to enable the SpiraApp for (optional)
- `SPIRA_DISABLE_PROJECT_IDS` - Comma-separated project IDs to disable the SpiraApp for (optional)

### Usage

Run the automation script:

```bash
node bundle-automation.js --input=/path/to/SpiraApp
```

**Example:**
```bash
node bundle-automation.js --input=/Users/yourname/MySpiraApp
```

The script will prompt you to choose a mode:

1. **Build, upload and enable** - Builds the package, uploads it to Spira, enables it system-wide, and enables it for projects specified in `SPIRA_ENABLE_PROJECT_IDS`
2. **Enable only** - Enables an already-uploaded SpiraApp for projects specified in `SPIRA_ENABLE_PROJECT_IDS` (no build or upload)
3. **Disable only** - Disables the SpiraApp for projects specified in `SPIRA_DISABLE_PROJECT_IDS`

You can skip the prompt by using command-line flags:

```bash
# Enable only (no build/upload)
node bundle-automation.js --input=/path/to/SpiraApp --enable

# Disable only
node bundle-automation.js --input=/path/to/SpiraApp --disable
```

### What the Automation Does

1. Automatically increments the patch version in manifest.yaml (e.g., 1.0 → 1.1)
2. Builds the .spiraapp package file
3. Logs into your Spira instance using Playwright browser automation (headless)
4. Enables Developer Mode in Spira (if not already enabled)
5. Uploads the .spiraapp file to the SpiraApps administration page
6. Activates the SpiraApp system-wide
7. Enables or disables the SpiraApp for specific projects based on environment variables

**Note**: Inflectra will never ask you for your spiraapp file, only ever the source code that is used to generate it 
