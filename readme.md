# SpiraApp bundler and validator
This script is designed for taking a yaml manifest describing a SpiraApp and its associated (and referenced) files, and converting it to a valid SpiraApp bundle file. 

The bundle file is automatically given the correct name based on its guid.

To create a new bundle file:

- open the terminal
- navigate to this directory
- run `npm run build` and specify the input and output parameters 
- for example: `npm run build --input="C:\MySpiraApp" --output="C:\BundleStorage"`
- the --input parameter is a file path to the folder that the manifest.yaml is in
- the --output parameter is a file path to the folder to save the .spiraapp file to
- if you want to build the bundle for debug purposes and not minify any JS code add `--debug` to the command

If there are any errors in the manifest these will be logged in the console.