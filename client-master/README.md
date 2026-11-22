<p align="center">
<a href="https://discord.gg/upAywr74ff"><img src="https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white&labelColor=2B3137" alt="Discord"></a>
</p>

## About

TerriFront is a real-time strategy game that is played in the browser. Still early in development (closed beta).

Multiplayer is not finished yet and is hidden from the main menu. Singleplayer is playable, and the Servers tab can
connect to a TerriFront-compatible server by address.

## Contributing

The project is fully open-source and contributions are very welcome.
Exact details on how to contribute can be found in the [CONTRIBUTING.md](CONTRIBUTING.md) file.

## Building

To build the project, you will need to have Node.js (>= 20) and npm installed. You can download them
from [here](https://nodejs.org/).

See the repository root README for the full layout and Railway deployment. In short:

```bash
cd client-master
```

Before building the project, you will need to install the dependencies. You can do this by running the following command
in the project directory:

```bash
npm ci
```

You might need to rerun these commands if you update the repository.

To develop the project locally, you can run the following command:

```bash
npm run dev
```

This will start a development server on `http://localhost:8080/` that will automatically reload when you make changes to
the code. Note that internal servers of IDEs like WebStorm do not work correctly with this project.

For a production build and to serve it locally (this is what Railway runs):

```bash
npm run build-prod
npm start        # http://localhost:8080
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
