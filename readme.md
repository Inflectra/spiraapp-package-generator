# SpiraApp package generator
This repo takes a SpiraApp manifest.yaml describing a SpiraApp and its associated (and referenced) files, and converts it into a valid SpiraApp package file. 

The package file is automatically given the correct name based on the SpiraApp's guid. As part of the packaging process the SpiraApp is validated in a number of ways to ensure that will be able to be safely loaded into Spira.

To create a new bundle file:

- clone this repo
- open the terminal
- navigate to the directory where this repo lives
- run `npm install` to install the (minimal) dependencies
- run `npm run build` and specify the input and output parameters
- for example: `npm run build --input="C:\MySpiraApp" --output="C:\BundleStorage"`
- the --input parameter is a file path to the folder that the manifest.yaml is in
- the --output parameter is a file path to the folder to save the .spiraapp file to
- if you want to build the bundle for debug purposes and not minify any JS code add `--debug` to the command

If there are any errors in the manifest these will be logged in the console.

**Note**: Inflectra will never ask you for your spiraapp file, only ever the source code that is used to generate it 
