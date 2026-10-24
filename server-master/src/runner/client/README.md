<p align="center">
    <a href="http://warfront.io"><img src="https://raw.githubusercontent.com/WarFrontIO/client/master/resources/themes/wf-logo-pastel.png" alt="WarFront.io Logo" width="150"></a>
</p>

<p align="center">
<a href="https://discord.gg/tvgfpeCGaD"><img src="https://img.shields.io/discord/1085091019265159198?logo=discord&label=discord&color=%235865F2&labelColor=%232B3137" alt="Discord"></a>
<a href="https://github.com/WarFrontIO/client/actions/workflows/ci.yml"><img src="https://github.com/WarFrontIO/client/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

## About

WarFront.io is a real-time strategy game that is played in the browser. Still early in development.

You can find the game at [warfront.io](https://warfront.io). Development builds can be found at [dev.warfront.io](https://dev.warfront.io).

## Contributing

The project is fully open-source and contributions are very welcome.
Exact details on how to contribute can be found in the [CONTRIBUTING.md](CONTRIBUTING.md) file.

## Building

To build the project, you will need to have Node.js (>= 20) and npm installed. You can download them
from [here](https://nodejs.org/).

First, clone the repository:

```bash
git clone https://github.com/WarFrontIO/client.git warfront-client
cd warfront-client
```

Before building the project, you will need to install the dependencies. You can do this by running the following command
in the project directory:

```bash
git submodule update --init --recursive
npm ci
```

You might need to rerun these commands if you update the repository.

To develop the project locally, you can run the following command:

```bash
npm run dev
```

This will start a development server on `http://localhost:8080/` that will automatically reload when you make changes to
the code. Note that internal servers of IDEs like WebStorm do not work correctly with this project.

For a production build, you can run the following command:

```bash
npm run build-prod
```

## Converting an image into a map

The image converter turns a PNG into the game's encoded `.map` format using the existing map codec:

```bash
npm run convert-image-map -- input.png output.map
npm run convert-image-map -- recolored.png output.map palette.json
```

The output path is optional; by default, the script writes a `.map` file beside the input. Blue pixels,
dark pixels, and transparent pixels are interpreted as water. Other pixels are classified by brightness
into grass and mountain tile variants, so use an image with blue water and shaded terrain for best results.
Pass a palette JSON path as the third argument with a palette-recolored image to preserve the exact palette tile types and ocean depths.

## Converting an image to the map palette

To keep an image while recoloring it to the tile colors used by the Europe or World map, use the separate
palette converter. It writes a recolored PNG and a JSON tile palette:

```bash
npm run convert-image-palette -- input.png
npm run convert-image-palette -- input.png output.png output.json europe
```

The default palette is World. If output paths are omitted, the script writes `<input>-palette.png` and
`<input>-palette.json` beside the input image. Blue and transparent pixels use water colors; other pixels
use land colors, with the closest palette shade selected by brightness. Ocean depth shades are generated
from distance to the nearest land pixel, since a flat-color source ocean does not contain bathymetry data.
