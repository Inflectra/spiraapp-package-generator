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
    
    if (process.argv.includes('bundle')) {
        createBundle();
    }
}
init();


function createBundle() {
    const inputFolder = process.env.npm_config_input ? (process.env.npm_config_input + "/") : "";
    const outputFolder = process.env.npm_config_output ? (process.env.npm_config_output + "/") : "";
    const isMinify = process.env.npm_config_debug ? false : true;
    
    if (!fs.existsSync(`${inputFolder}manifest.yaml`)) {
        console.log('Error: no manifest file found in', inputFolder);
        return;
    }

    const raw = yaml.load(fs.readFileSync(`${inputFolder}manifest.yaml`));
    let final = raw;
    
    //find any file reference and replace
    //allowed in menu entries, pageContents, pageColumns, custom dashboards

    //menu entries
    if (raw.hasOwnProperty("menus") && Array.isArray(raw.menus)) {
        final.menus = raw.menus.map(menu => {
            if (raw.hasOwnProperty("entries") && Array.isArray(menu.entries)) { 
                menu.entries = menu.entries.map(entry => {
                    for (const prop in entry) {
                        entry[prop] = insertFile(prop, entry[prop], inputFolder, isMinify);
                    }
                    return entry;
                });
            }
            return menu;
        });
    }

    //pageContents
    if (raw.hasOwnProperty("pageContents") && Array.isArray(raw.pageContents)) {
        final.pageContents = raw.pageContents.map(pageContent => {
            for (const prop in pageContent) {
                pageContent[prop] = insertFile(prop, pageContent[prop], inputFolder, isMinify);
            }
            return pageContent;
        });
    }

    //pageColumns
    if (raw.hasOwnProperty("pageColumns") && Array.isArray(raw.pageColumns)) {
        final.pageColumns = raw.pageColumns.map(pageColumn => {
            for (const prop in pageColumn) {
                pageColumn[prop] = insertFile(prop, pageColumn[prop], inputFolder, isMinify);
            }
            return pageColumn;
        });
    }

    //dashboards
    if (raw.hasOwnProperty("dashboards") && Array.isArray(raw.dashboards)) {
        final.dashboards = raw.dashboards.map(dashboard => {
            for (const prop in dashboard) {
                dashboard[prop] = insertFile(prop, dashboard[prop], inputFolder, isMinify);
            }
            return dashboard;
        });
    }

    //Create base 64 encoded version of the object
    const finalString = JSON.stringify(final);
    const finalBuffer = Buffer.from(finalString);
    const finalBase64 = finalBuffer.toString("base64");
    //Write file
    fs.writeFile(`${outputFolder}${raw.guid}.${SPIRA_APP_EXTENSION}`, finalBase64, (err) => {
        // throws an error, you could also catch it here
        if (err) throw err;
        console.log(`Successfully created "${raw.name}" bundle - saved to ${outputFolder}${raw.guid}.${SPIRA_APP_EXTENSION}`);
    });
    
}

// @param prop: the property name so we can check if it needs to be a file
// @param value: the string with the relative path to the file
// @param folderPath: the root folder to look in for the file - from the cli params
// @param isMinify: whether to minify or not (do not if in debug mode) - from the cli params
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