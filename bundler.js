const yaml = require('js-yaml');
const fs   = require('fs');
const UglifyJS = require("uglify-js");

const FILE_PREFIX = "file://";
const SPIRA_APP_EXTENSION = "spiraapp";
const PROPERTIES_WITH_FILES = ["code", "css", "template"];

/* EXAMPLE USAGE
if your code is in a folder C:\work-in-progress
and your Spira app bundle folder is in: C:\git\SpiraTeam\SpiraTest\SpiraAppBundles
then run the following to build your app and save the bundle file in the right place
npm run build --input="C:\work-in-progress" --output="C:\git\SpiraTeam\SpiraTest\SpiraAppBundles"

If testing add the --debug flag to the command (this will NOT minify the code)

*/

function init() {
    let fsWait = false;
    const inputFolder = process.env.npm_config_input ? (process.env.npm_config_input + "/") : "";
    const outputFolder = process.env.npm_config_output ? (process.env.npm_config_output + "/") : "";
    
    if (process.argv.includes('bundle')) {
        if (!fs.existsSync(`${inputFolder}manifest.yaml`)) {
            console.log('Error: no manifest file found in', inputFolder);
            return;
        }
        const manifest = yaml.load(fs.readFileSync(`${inputFolder}manifest.yaml`));

        const hasErrors = validateManifest(manifest);
        if (hasErrors == 0) {
            const bundle = createBundle(manifest, inputFolder);
            saveFile(bundle, outputFolder);
        } else {
            console.log('SpiraApp bundle NOT created due to errors in the manifest. Please fix and try again.')
        }
    }
}
init();

// Validates a manifest's keys to make sure all required keys are present, and no invalid keys are used. Does not validate contents
// Returns a count of the number of errors found
// @param: manifest: the manifest file converted to JSON
function validateManifest(manifest) {
    const rootProps = ["guid", "name", "caption", "summary", "description", "productSummary", "productDescription", "author", "license", "copyright", "url", "icon", "version", "menus", "pageContents", "pageColumns", "dashboards", "settingGroups", "settings", "productSettings"];
    const rootPropsRequired = ["guid", "name", "version"];
    

    const menuProps = ["pageId", "caption", "icon", "isActive", "entries"];
    const menuPropsRequired = ["pageId", "caption"];
    const menuEntryProps = ["name", "caption", "tooltip", "icon", "actionTypeId", "action", "isActive"];
    const menuEntryPropsRequired = ["name", "caption", "actionTypeId", "action"];
    
    const pageContentProps = ["pageId", "name", "code", "css"];
    const pageContentPropsRequired = ["pageId", "name", "code"];
    
    const pageColumnProps = ["pageId", "name", "caption", "template"];
    const pageColumnPropsRequired = ["pageId", "name", "caption", "template"];
    
    const dashboardProps = ["dashboardTypeId", "name", "isActive", "description", "code"];
    const dashboardPropsRequired = ["dashboardTypeId", "name"];
    
    const settingGroupProps = ["name", "caption", "description"];
    const settingGroupPropsRequired = ["name", "caption"];
    
    const settingProps = ["settingTypeId", "name", "caption", "placeholder", "tooltip", "isSecure", "position", "settingGroup"];
    const settingPropsRequired = ["settingTypeId", "name", "caption"];
    
    const productSettingProps = ["settingTypeId", "name", "caption", "placeholder", "tooltip", "isSecure", "position", "settingGroup", "artifactTypeId"];
    const productSettingPropsRequired = ["settingTypeId", "name", "caption"];

    let hasErrors = 0;
    
    hasErrors += checkObjectKeys("root", manifest, rootProps, rootPropsRequired, null, null, null);

    if (manifest.hasOwnProperty("menus") && Array.isArray(manifest.menus)) {
        manifest.menus.forEach(menu => {
            hasErrors += checkObjectKeys("menus", menu, menuProps, menuPropsRequired, "entries", menuEntryProps, menuEntryPropsRequired);
        })
    }

    if (manifest.hasOwnProperty("pageContents") && Array.isArray(manifest.pageContents)) {
        manifest.pageContents.forEach(pageContent => {
            hasErrors += checkObjectKeys("pageContents", pageContent, pageContentProps, pageContentPropsRequired, null, null, null);
        })
    }

    if (manifest.hasOwnProperty("pageColumns") && Array.isArray(manifest.pageColumns)) {
        manifest.pageColumns.forEach(pageColumn => {
            hasErrors += checkObjectKeys("pageColumns", pageColumn, pageColumnProps, pageColumnPropsRequired, null, null, null);
        })
    }

    if (manifest.hasOwnProperty("dashboards") && Array.isArray(manifest.dashboards)) {
        manifest.dashboards.forEach(dashboard => {
            hasErrors += checkObjectKeys("dashboards", dashboard, dashboardProps, dashboardPropsRequired, null, null, null);
        })
    }

    if (manifest.hasOwnProperty("settingGroups") && Array.isArray(manifest.settingGroups)) {
        manifest.settingGroups.forEach(settingGroup => {
            hasErrors += checkObjectKeys("settingGroups", settingGroup, settingGroupProps, settingGroupPropsRequired, null, null, null);
        })
    }

    if (manifest.hasOwnProperty("settings") && Array.isArray(manifest.settings)) {
        manifest.settings.forEach(setting => {
            hasErrors += checkObjectKeys("settings", setting, settingProps, settingPropsRequired, null, null, null);
        })
    }

    if (manifest.hasOwnProperty("productSettings") && Array.isArray(manifest.productSettings)) {
        manifest.productSettings.forEach(productSetting => {
            hasErrors += checkObjectKeys("productSettings", productSetting, productSettingProps, productSettingPropsRequired, null, null, null);
        })
    }

    return hasErrors;
}

// Checks a specific part of the manifest against provided data
// Returns a count of the number of errors found
// @param description: string = reference name of the part of the manifest being checked (used for logging)
// @param obj: object = the part of the manifest to check
// @param validKeys: array of strings = all accepted keys for this part of the manifest (matches the data object in Spira)
// @param validKeysRequired: array of strings = all required keys for this part of the manifest
// @param nestedKey: string = the key in the obj that is actually a nested array that also needs to be checked
// @param nestedValidKeys: array of strings = all accepted keys for this part of the manifest (matches the data object in Spira)
// @param nestedValidKeysRequired: array of strings = all required keys for this part of the manifest
function checkObjectKeys(description, obj, validKeys, validKeysRequired, nestedKey, nestedValidKeys, nestedValidKeysRequired) {
    let hasErrors = 0;
    //verify that each key in the obj is an allowed/valid key
    for (const [key, value] of Object.entries(obj)) {
        //If the key is not valid, increment the error count
        if (!validKeys.includes(key)) {
            console.log(`Error in ${description}: Key ${key} is not allowed`);
            hasErrors++;
        //If the key has nested items inside, verify those
        } else if (nestedKey && key == nestedKey && Array.isArray(obj[key])) {
            obj[key].forEach(nest => {
                hasErrors += checkObjectKeys(`nest of ${description}`, nest, nestedValidKeys, nestedValidKeysRequired, null, null, null);
            })
        }
    }

    //Make sure all required keys are present and have a value
    validKeysRequired.forEach(key => {
        if (!Object.keys(obj).includes(key)) {
            console.log(`Error in ${description}: Required key ${key} not found`);
            hasErrors++;
        }
    })
    return hasErrors;
}

// Creates a bundle file from a json manifest, including all referenced external files
// @param: manifest: the manifest file converted to JSON
// @param inputFolder: the inputFolder to look in for the file - from the cli params
function createBundle(manifest, inputFolder) {
    const isMinify = process.env.npm_config_debug ? false : true;

    let output = manifest;
    
    //find any file reference and replace
    //allowed in pageContents, pageColumns, custom dashboards
    //pageContents
    if (manifest.hasOwnProperty("pageContents") && Array.isArray(manifest.pageContents)) {
        output.pageContents = manifest.pageContents.map(pageContent => {
            for (const prop in pageContent) {
                pageContent[prop] = insertFile(prop, pageContent[prop], inputFolder, isMinify);
            }
            return pageContent;
        });
    }

    //pageColumns
    if (manifest.hasOwnProperty("pageColumns") && Array.isArray(manifest.pageColumns)) {
        output.pageColumns = manifest.pageColumns.map(pageColumn => {
            for (const prop in pageColumn) {
                pageColumn[prop] = insertFile(prop, pageColumn[prop], inputFolder, isMinify);
            }
            return pageColumn;
        });
    }

    //dashboards
    if (manifest.hasOwnProperty("dashboards") && Array.isArray(manifest.dashboards)) {
        output.dashboards = manifest.dashboards.map(dashboard => {
            for (const prop in dashboard) {
                dashboard[prop] = insertFile(prop, dashboard[prop], inputFolder, isMinify);
            }
            return dashboard;
        });
    }
    return output;
}

// If the param references another file then get the contents, prepare it for bundling and return it
// @param prop: the property name so we can check if it needs to be a file
// @param value: the string with the relative path to the file
// @param folderPath: string = the root folder to look in for the file - from the cli params
// @param isMinify: bool = whether to minify or not (do not if in debug mode) - from the cli params
function insertFile(prop, value, folderPath, isMinify) {
    const valueIsString = typeof value === 'string' || value instanceof String;
    const doesPropSupportFile = PROPERTIES_WITH_FILES.includes(prop);
    if (doesPropSupportFile && valueIsString && value.startsWith(FILE_PREFIX)) {
        const fileName = value.replace(FILE_PREFIX, "");
        const extension = fileName.split('.').pop();
        // use the readFileSync() function and pass the path to the file
        const buffer = fs.readFileSync(`${folderPath}${fileName}`);

        // use the toString() method to convert buffer into String
        const fileContents = buffer.toString();
        
        let contentToBundle = fileContents;
        // if we are minifying check if this is a js file
        if (isMinify && extension == "js") {
            // attempt to minify - if there is an error, use the original file contents
            const minified = UglifyJS.minify(fileContents);
            contentToBundle = !minified.error ? minified.code : fileContents;
        }

        // base64 encode the file contents
        const contentsBuffer = Buffer.from(contentToBundle);
        const contentsBase64 = contentsBuffer.toString("base64");
        return contentsBase64;
    } else {
        return value;
    }
}

// Saves the final bundle to the designated folder with the correct name and extension
// @param bundle: object = the final bundle object with all files embedded
// @param outputFolder: string = the outputFolder to save the file - from the cli params
function saveFile(bundle, outputFolder) {
    //Create base 64 encoded version of the object
    const finalString = JSON.stringify(bundle);
    const finalBuffer = Buffer.from(finalString);
    const finalBase64 = finalBuffer.toString("base64");
    //Write file
    fs.writeFile(`${outputFolder}${bundle.guid}.${SPIRA_APP_EXTENSION}`, finalBase64, (err) => {
        // throws an error, you could also catch it here
        if (err) throw err;
        console.log(`Successfully created "${bundle.name}" bundle - saved to ${outputFolder}${bundle.guid}.${SPIRA_APP_EXTENSION}`);
    });
}