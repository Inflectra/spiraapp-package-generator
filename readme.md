# SpiraApp package generator
This repo takes a SpiraApp manifest.yaml describing a SpiraApp and its associated (and referenced) files, and converts it into a valid SpiraApp package file. 

The package file is automatically given the correct name based on the SpiraApp's guid. As part of the packaging process the SpiraApp is validated in a number of ways to ensure that will be able to be safely loaded into Spira.

## Setup

- Clone this repo
- Open the terminal and navigate to the directory where this repo lives
- Run `npm install` to install the dependencies
- Copy `.env.example` to `.env` and fill in your Spira credentials (required for automation only)

## Building a SpiraApp Package

To create a new bundle file manually:

- Run `npm run build` and specify the input and output parameters
- For example: `npm run build --input="C:\MySpiraApp" --output="C:\BundleStorage"`
- The --input parameter is a file path to the folder that the manifest.yaml is in
- The --output parameter is a file path to the folder to save the .spiraapp file to
- If you want to build the bundle for debug purposes and not minify any JS code add `--debug` to the command

If there are any errors in the manifest these will be logged in the console.

## Automated Build and Deployment

The `bundle-automation.js` script automates the full workflow: building the package, uploading it to Spira, and enabling it system-wide and/or for specific projects.

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
npm run automate -- --input="C:\MySpiraApp"
```

The script will prompt you to choose a mode:

1. **Build, upload and enable** - Builds the package, uploads it to Spira, enables it system-wide, and enables it for projects specified in `SPIRA_ENABLE_PROJECT_IDS`
2. **Enable only** - Enables an already-uploaded SpiraApp for projects specified in `SPIRA_ENABLE_PROJECT_IDS` (no build or upload)
3. **Disable only** - Disables the SpiraApp for projects specified in `SPIRA_DISABLE_PROJECT_IDS`

You can skip the prompt by using command-line flags:

```bash
# Enable only (no build/upload)
npm run automate -- --input="C:\MySpiraApp" --enable

# Disable only
npm run automate -- --input="C:\MySpiraApp" --disable
```

### What the Automation Does

- Automatically increments the patch version in manifest.yaml (e.g., 1.0 → 1.1)
- Builds the .spiraapp package file
- Logs into your Spira instance using Playwright browser automation
- Enables Developer Mode in Spira (if not already enabled)
- Uploads the .spiraapp file to the SpiraApps administration page
- Activates the SpiraApp system-wide
- Enables or disables the SpiraApp for specific projects based on environment variables

**Note**: Inflectra will never ask you for your spiraapp file, only ever the source code that is used to generate it 
