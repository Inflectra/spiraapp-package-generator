const yaml = require('js-yaml');
const fs   = require('fs');
const UglifyJS = require("uglify-js");

const FILE_PREFIX = "file://";
const SVG_IMAGE_PREFIX = `data:image/svg+xml;base64,`;
const SVG_EXTENSION = "svg";
const SPIRA_APP_EXTENSION = "spiraapp";
const PROPERTIES_WITH_FILES = ["code", "css", "template", "icon"];
const PROPERTIES_WITH_SVG_IMAGE = ["icon"];

const typeEnums = {
    boolean: 1,
    int: 2,
    decimal: 3,
    string: 4,
    array: 5
};

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
    const PAGE_ID_MIN = 1;
    const PAGE_ID_MAX = 20;
    const DASHBOARD_TYPE_ID_MIN = 1;
    const DASHBOARD_TYPE_ID_MAX = 6;
    const SETTING_TYPE_ID_MIN = 1;
    const SETTING_TYPE_ID_MAX = 9;
    const ACTION_TYPE_ID_MIN = 1;
    const ACTION_TYPE_ID_MAX = 2;

    const rootProps = [
        { name: "guid",               required: true,  type: typeEnums.string, max: 64 },
        { name: "name",               required: true,  type: typeEnums.string, max: 255 }, 
        { name: "caption",            required: false, type: typeEnums.string, max: 255 }, 
        { name: "summary",            required: false, type: typeEnums.string, max: 255 }, 
        { name: "description",        required: false, type: typeEnums.string, max: false }, 
        { name: "productSummary",     required: false, type: typeEnums.string, max: 255 }, 
        { name: "productDescription", required: false, type: typeEnums.string, max: false }, 
        { name: "author",             required: false, type: typeEnums.string, max: 128 }, 
        { name: "license",            required: false, type: typeEnums.string, max: false }, 
        { name: "copyright",          required: false, type: typeEnums.string, max: 128 }, 
        { name: "url",                required: false, type: typeEnums.string, max: 256 }, 
        { name: "icon",               required: false, type: typeEnums.string, max: false }, 
        { name: "version",            required: true,  type: typeEnums.decimal, min: 0, max: false }, 
        { name: "menus",              required: false, type: typeEnums.array }, 
        { name: "pageContents",       required: false, type: typeEnums.array }, 
        { name: "pageColumns",        required: false, type: typeEnums.array }, 
        { name: "dashboards",         required: false, type: typeEnums.array }, 
        { name: "settingGroups",      required: false, type: typeEnums.array }, 
        { name: "settings",           required: false, type: typeEnums.array }, 
        { name: "productSettings",    required: false, type: typeEnums.array }
    ];
    const menuProps = [
        { name: "pageId",   required: true,  type: typeEnums.int,    min: PAGE_ID_MIN, max: PAGE_ID_MAX },
        { name: "caption",  required: true,  type: typeEnums.string, max: 255 },
        { name: "icon",     required: false, type: typeEnums.string, max: 255 },
        { name: "isActive", required: false, type: typeEnums.boolean }, 
        { name: "entries",  required: false, type: typeEnums.array }
    ];
    const menuEntryProps = [
        { name: "name",         required: true,  type: typeEnums.string, max: 50 },
        { name: "caption",      required: true,  type: typeEnums.string, max: 128 },
        { name: "tooltip",      required: false, type: typeEnums.string, max: 255 },
        { name: "icon",         required: false, type: typeEnums.string, max: 255 },
        { name: "actionTypeId", required: true,  type: typeEnums.int, min: ACTION_TYPE_ID_MIN, max: ACTION_TYPE_ID_MAX },
        { name: "action",       required: true,  type: typeEnums.string, max: 255 },
        { name: "isActive",     required: false, type: typeEnums.boolean }
    ];
    const pageContentProps = [
        { name: "pageId", required: true,  type: typeEnums.int,    min: PAGE_ID_MIN, max: PAGE_ID_MAX },
        { name: "name",   required: true,  type: typeEnums.string, max: 128 },
        { name: "code",   required: true,  type: typeEnums.string, max: false },
        { name: "css",    required: false, type: typeEnums.string, max: false }
    ];
    const pageColumnProps = [
        { name: "pageId",   required: true, type: typeEnums.int,    min: PAGE_ID_MIN, max: PAGE_ID_MAX },   
        { name: "name",     required: true, type: typeEnums.string, max: 50 },   
        { name: "caption",  required: true, type: typeEnums.string, max: 50 },    
        { name: "template", required: true, type: typeEnums.string, max: false },
    ];
    const dashboardProps = [
        { name: "dashboardTypeId", required: false, type: typeEnums.int,    min: DASHBOARD_TYPE_ID_MIN, max: DASHBOARD_TYPE_ID_MAX },  
        { name: "name",            required: true,  type: typeEnums.string, max: 128 },  
        { name: "isActive",        required: false, type: typeEnums.boolean },  
        { name: "description",     required: false, type: typeEnums.string, max: false },   
        { name: "code",            required: false, type: typeEnums.string, max: false }
    ];
    const settingGroupProps = [
        { name: "name",        required: true,  type: typeEnums.string, max: 50 },     
        { name: "caption",     required: true,  type: typeEnums.string, max: 255 },  
        { name: "description", required: false, type: typeEnums.string, max: false }
    ];
    const settingProps = [
        { name: "settingTypeId", required: true,  type: typeEnums.int,    min: SETTING_TYPE_ID_MIN, max: SETTING_TYPE_ID_MAX },    
        { name: "name",          required: true,  type: typeEnums.string, max: 255 },    
        { name: "caption",       required: true,  type: typeEnums.string, max: 50 },     
        { name: "placeholder",   required: false, type: typeEnums.string, max: 255 },  
        { name: "tooltip",       required: false, type: typeEnums.string, max: 255 },   
        { name: "isSecure",      required: false, type: typeEnums.boolean },   
        { name: "position",      required: false, type: typeEnums.int, min: 1, max: false },   
        { name: "settingGroup",  required: false, type: typeEnums.string, max: 50 }
    ];   
    const productSettingProps = [
        { name: "settingTypeId",  required: true,  type: typeEnums.int,    min: SETTING_TYPE_ID_MIN, max: SETTING_TYPE_ID_MAX },    
        { name: "name",           required: true,  type: typeEnums.string, max: 255 },    
        { name: "caption",        required: true,  type: typeEnums.string, max: 50 },     
        { name: "placeholder",    required: false, type: typeEnums.string, max: 255 },  
        { name: "tooltip",        required: false, type: typeEnums.string, max: 255 },   
        { name: "isSecure",       required: false, type: typeEnums.boolean },   
        { name: "position",       required: false, type: typeEnums.int,    min: 1, max: false },   
        { name: "settingGroup",   required: false, type: typeEnums.string, max: 50 },   
        { name: "artifactTypeId", required: false, type: typeEnums.int,    min: -1000, max: false }
    ];

    let hasErrors = 0;
    
    hasErrors += checkObjectForErrors("root", manifest, rootProps, null, null);

    if (manifest.hasOwnProperty("menus") && Array.isArray(manifest.menus)) {
        manifest.menus.forEach(menu => {
            hasErrors += checkObjectForErrors("menus", menu, menuProps, "entries", menuEntryProps);
        })
    }

    if (manifest.hasOwnProperty("pageContents") && Array.isArray(manifest.pageContents)) {
        manifest.pageContents.forEach(pageContent => {
            hasErrors += checkObjectForErrors("pageContents", pageContent, pageContentProps, null, null);
        })
    }

    if (manifest.hasOwnProperty("pageColumns") && Array.isArray(manifest.pageColumns)) {
        manifest.pageColumns.forEach(pageColumn => {
            hasErrors += checkObjectForErrors("pageColumns", pageColumn, pageColumnProps, null, null);
        })
    }

    if (manifest.hasOwnProperty("dashboards") && Array.isArray(manifest.dashboards)) {
        manifest.dashboards.forEach(dashboard => {
            hasErrors += checkObjectForErrors("dashboards", dashboard, dashboardProps, null, null);
        })
    }

    if (manifest.hasOwnProperty("settingGroups") && Array.isArray(manifest.settingGroups)) {
        manifest.settingGroups.forEach(settingGroup => {
            hasErrors += checkObjectForErrors("settingGroups", settingGroup, settingGroupProps, null, null);
        })
    }

    if (manifest.hasOwnProperty("settings") && Array.isArray(manifest.settings)) {
        manifest.settings.forEach(setting => {
            hasErrors += checkObjectForErrors("settings", setting, settingProps, null, null);
        })
    }

    if (manifest.hasOwnProperty("productSettings") && Array.isArray(manifest.productSettings)) {
        manifest.productSettings.forEach(productSetting => {
            hasErrors += checkObjectForErrors("productSettings", productSetting, productSettingProps, null, null);
        })
    }

    return hasErrors;
}

// Checks a specific part of the manifest against the props and requirement for that data structure
// Returns a count of the number of errors found
// @param description: string = reference name of the part of the manifest being checked (used for logging)
// @param obj: object = the part of the manifest to check
// @param objectProps: array of objects that describe the data object (matches that in Spira)
// @param nestedKey: string = the key in the obj that is actually a nested array that also needs to be checked
// @param nestedObjectProps: array of objects that describe the NESTED data object (matches that in Spira)
function checkObjectForErrors(description, obj, objectProps, nestedKey, nestedObjectProps) {
    const validKeyNames = objectProps.map(prop => prop.name);
    const requiredKeyNames = objectProps.filter(prop => prop.required).map(prop => prop.name);
    
    let hasErrors = 0;

    //verify that each key in the obj is valid
    for (const [key, value] of Object.entries(obj)) {
        //If the key is not valid, increment the error count
        if (!validKeyNames.includes(key)) {
            console.log(`Error in ${description}: Key ${key} is not allowed`);
            hasErrors++;
        //If the key is valid, perform further checks
        } else { 
            //Check that the values for each key are valid and within bounds
            const keyProps = objectProps.filter(prop => prop.name == key)[0];
            hasErrors += checkValueForErrors(`${key} of ${description}`, value, keyProps.type, keyProps.min, keyProps.max);            

            //If the key has nested items inside, verify those
            if (nestedKey && key == nestedKey && Array.isArray(obj[key])) {
                obj[key].forEach(nest => {
                    hasErrors += checkObjectForErrors(`nest of ${description}`, nest, nestedObjectProps, null, null, null, null);
                })
            }
        }
    }

    //Make sure all required keys are present and have a value
    requiredKeyNames.forEach(key => {
        if (!Object.keys(obj).includes(key)) {
            console.log(`Error in ${description}: Required key ${key} not found`);
            hasErrors++;
        }
    })

    return hasErrors;
}

// Checks a specific value against the props for that data type to make sure it correct format and length
// Returns a count of the number of errors found
// @param description: string = reference name of the part of the manifest being checked (used for logging)
// @param val: value = the value to check
// @param typeEnum: the typeEnums for the key the value maps to
// @param min: int for the minimum number or length of string
// @param max: int for the maximum number or length of string
function checkValueForErrors(description, value, type, min, max) {
    let hasErrors = 0;
    switch (type) {
        case typeEnums.boolean:
            if (value !== true && value !== false) {
                console.log(`Error in ${description}: boolean expected, but got ${value}`);
                hasErrors++;
            }
            break;
        case typeEnums.int:
            if (Number.isInteger(value)) {
                if (value < min || (max && value > max) ) {
                    console.log(`Error in ${description}: ${value} was not in the allowed range of ${min} to ${max}`);
                hasErrors++;
                }
            } else {
                console.log(`Error in ${description}: int expected, but got ${value}`);
                hasErrors++;
            }
            break;
        case typeEnums.decimal:
            if (Number.parseFloat(value)) {
                if (value < min || (max && value > max) ) {
                    console.log(`Error in ${description}: ${value} was not in the allowed range of ${min} to ${max}`);
                hasErrors++;
                }
            } else {
                console.log(`Error in ${description}: decimal expected, but got ${value}`);
                hasErrors++;
            }
            break;
        case typeEnums.string:
            //Check for a max value - if there is none let any string through
            if (max && value.length > max) {
                console.log(`Error in ${description}: the string is too long - it must be at most ${max} characters`);
                hasErrors++;
            }
        //No need to check arrays - they are handled as nested objects
        case typeEnums.array:
            break;
    }

    return hasErrors;
}


// Creates a bundle file from a json manifest, including all referenced external files
// @param: manifest: the manifest file converted to JSON
// @param inputFolder: the inputFolder to look in for the file - from the cli params
function createBundle(manifest, inputFolder) {
    const isMinify = process.env.npm_config_debug ? false : true;

    let output = manifest;

    //find any file reference and replace
    //allowed in rootProps pageContents, pageColumns, custom dashboards, menus, and menu entries
    //rootProps (icon only)
    output.icon = insertFileInProp("icon", manifest.icon, inputFolder, false);
    
    //pageContents
    if (manifest.hasOwnProperty("pageContents") && Array.isArray(manifest.pageContents)) {
        output.pageContents = manifest.pageContents.map(pageContent => {
            for (const prop in pageContent) {
                pageContent[prop] = insertFileInProp(prop, pageContent[prop], inputFolder, isMinify);
            }
            return pageContent;
        });
    }

    //menus
    if (manifest.hasOwnProperty("menus") && Array.isArray(manifest.menus)) {
        output.menus = manifest.menus.map(menu => {
            for (const prop in menu) {
                menu[prop] = insertFileInProp(prop, menu[prop], inputFolder, isMinify);

                //menu entries
                if (menu.hasOwnProperty("entries") && Array.isArray(menu.entries)) {
                    menu.entries = menu.entries.map(entry => {
                        for (const prop in entry) {
                            entry[prop] = insertFileInProp(prop, entry[prop], inputFolder, isMinify);
                        }
                        return entry;
                    });
                }
            }
            return menu;
        });
    }

    //pageColumns
    if (manifest.hasOwnProperty("pageColumns") && Array.isArray(manifest.pageColumns)) {
        output.pageColumns = manifest.pageColumns.map(pageColumn => {
            for (const prop in pageColumn) {
                pageColumn[prop] = insertFileInProp(prop, pageColumn[prop], inputFolder, isMinify);
            }
            return pageColumn;
        });
    }

    //dashboards
    if (manifest.hasOwnProperty("dashboards") && Array.isArray(manifest.dashboards)) {
        output.dashboards = manifest.dashboards.map(dashboard => {
            for (const prop in dashboard) {
                dashboard[prop] = insertFileInProp(prop, dashboard[prop], inputFolder, isMinify);
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
function insertFileInProp(prop, value, folderPath, isMinify) {
    const valueIsString = typeof value === 'string' || value instanceof String;
    const doesPropSupportFile = PROPERTIES_WITH_FILES.includes(prop);
    //If the specific prop does not support files or the value is empty, or does not start with a file path then do nothing
    if (doesPropSupportFile && valueIsString && value.startsWith(FILE_PREFIX)) {
        //Extract the filename from the raw value
        const fileName = value.replace(FILE_PREFIX, "");
        const extension = fileName.split('.').pop();

        // use the readFileSync() function and pass the path to the file
        const buffer = fs.readFileSync(`${folderPath}${fileName}`, 'utf-8');
        // use the toString() method to convert buffer into String
        const fileContents = buffer.toString();
        let finalContents = fileContents;

        //if the property is an svg then we encode the contents and put it into the correct syntax
        if (PROPERTIES_WITH_SVG_IMAGE.includes(prop) && extension == SVG_EXTENSION) {
            const rawContentsBuffer = Buffer.from(fileContents);
            // base64 encode the file contents
            finalContents = `"${SVG_IMAGE_PREFIX}${rawContentsBuffer.toString("base64")}"`;
        // if we are minifying check if this is a js file
        } else if (isMinify && extension == "js") {
            // attempt to minify - if there is an error, use the original file contents
            const minified = UglifyJS.minify(fileContents);
            finalContents = !minified.error ? minified.code : fileContents;
        }

        // base64 encode the file contents in full
        const contentsBuffer = Buffer.from(finalContents);
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