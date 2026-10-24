import {readFileSync, writeFileSync} from "fs";
import path from "path";
import {PNG} from "pngjs";
import {encodeMap, type RawMapData, type TileType} from "../src/map/codec/MapCodec";

interface PaletteTile {
	color: string;
	name: string;
	colorBase: string;
	colorVariant: number;
	conquerable: boolean;
	navigable: boolean;
	expansionCost?: number;
	expansionTime?: number;
}

interface MapPalette {
	tiles: PaletteTile[];
}

const tileTypes: TileType[] = [
	{name: "Water", colorBase: "water", colorVariant: 4, conquerable: false, navigable: true, expansionTime: 0, expansionCost: 0},
	{name: "Water", colorBase: "water", colorVariant: 6, conquerable: false, navigable: true, expansionTime: 0, expansionCost: 0},
	{name: "Water", colorBase: "water", colorVariant: 12, conquerable: false, navigable: true, expansionTime: 0, expansionCost: 0},
	{name: "Water", colorBase: "water", colorVariant: 14, conquerable: false, navigable: true, expansionTime: 0, expansionCost: 0},
	{name: "Land", colorBase: "mountain", colorVariant: 5, conquerable: true, navigable: false, expansionTime: 80, expansionCost: 80},
	{name: "Land", colorBase: "mountain", colorVariant: 9, conquerable: true, navigable: false, expansionTime: 70, expansionCost: 70},
	{name: "Land", colorBase: "grass", colorVariant: 9, conquerable: true, navigable: false, expansionTime: 60, expansionCost: 60},
	{name: "Land", colorBase: "grass", colorVariant: 6, conquerable: true, navigable: false, expansionTime: 50, expansionCost: 50}
];

interface DecodedImage {
	width: number;
	height: number;
	data: Uint8Array;
}

export function imageToMapData(image: DecodedImage): RawMapData {
	const {width, height, data} = image;
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535) {
		throw new Error(`Image dimensions must be between 1 and 65535 pixels; received ${width}x${height}`);
	}
	if (data.length !== width * height * 4) {
		throw new Error("Image pixel data does not match its dimensions");
	}

	const tiles = new Uint16Array(width * height);
	for (let i = 0; i < tiles.length; i++) {
		const offset = i * 4;
		const red = data[offset];
		const green = data[offset + 1];
		const blue = data[offset + 2];
		const alpha = data[offset + 3];
		const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
		const isBlue = blue > red + 28 && blue > green + 18 && blue > red * 1.15;

		if (alpha < 128 || luminance <= 125 || isBlue) {
			tiles[i] = luminance < 17 ? 0 : luminance < 60 ? 1 : luminance < 103 ? 2 : 3;
		} else {
			tiles[i] = luminance < 170 ? 4 : luminance < 204 ? 5 : luminance < 238 ? 6 : 7;
		}
	}

	return {width, height, tiles, types: tileTypes};
}

export function paletteImageToMapData(image: PNG, palette: MapPalette): RawMapData {
	const {width, height, data} = image;
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535) {
		throw new Error(`Image dimensions must be between 1 and 65535 pixels; received ${width}x${height}`);
	}
	if (!palette.tiles.length || palette.tiles.length > 65535) {
		throw new Error("Palette must contain between 1 and 65535 tile types");
	}

	const colorToType = new Map<number, number>();
	const types: TileType[] = palette.tiles.map((tile, index) => {
		const match = /^#([0-9a-f]{6})$/i.exec(tile.color);
		if (!match) throw new Error(`Invalid palette color: ${tile.color}`);
		const color = parseInt(match[1], 16);
		if (colorToType.has(color)) throw new Error(`Duplicate palette color: ${tile.color}`);
		colorToType.set(color, index);
		return {
			name: tile.name,
			colorBase: tile.colorBase,
			colorVariant: tile.colorVariant,
			conquerable: tile.conquerable,
			navigable: tile.navigable,
			expansionTime: tile.expansionTime ?? 50,
			expansionCost: tile.expansionCost ?? 50
		};
	});

	const tiles = new Uint16Array(width * height);
	for (let pixel = 0; pixel < tiles.length; pixel++) {
		const offset = pixel * 4;
		const alpha = data[offset + 3];
		const color = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
		const type = alpha < 128
			? palette.tiles.findIndex(tile => tile.name.toLowerCase() === "water")
			: colorToType.get(color);
		if (type === undefined || type < 0) {
			const hexColor = `#${color.toString(16).padStart(6, "0").toUpperCase()}`;
			throw new Error(`Image contains color ${hexColor} that is not in the supplied palette`);
		}
		tiles[pixel] = type;
	}

	return {width, height, tiles, types};
}

function printUsage(): void {
	console.error("Usage: npm run convert-image-map -- <input.png> [output.map] [palette.json]");
	console.error("Blue or dark pixels become water; brighter land pixels become grass or mountain tiles.");
}

function main(): void {
	const args = process.argv.slice(2);
	let paletteJsonPath: string | undefined;
	let invalidPaletteArgument = false;
	if (args[2] === "--palette-json") {
		paletteJsonPath = args[3];
		invalidPaletteArgument = !paletteJsonPath;
		args.splice(2, 2);
	} else if (args[2]?.startsWith("--palette-json=")) {
		paletteJsonPath = args[2].slice("--palette-json=".length);
		invalidPaletteArgument = !paletteJsonPath;
		args.splice(2, 1);
	} else if (args[2]) {
		paletteJsonPath = args[2];
		args.splice(2, 1);
	}

	const [inputPath, outputPath, ...extraArgs] = args;
	if (!inputPath || invalidPaletteArgument || extraArgs.length > 0) {
		printUsage();
		process.exitCode = 2;
		return;
	}

	const resolvedInput = path.resolve(inputPath);
	const defaultOutput = path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}.map`);
	const resolvedOutput = path.resolve(outputPath ?? defaultOutput);
	const image = PNG.sync.read(readFileSync(resolvedInput));
	const resolvedPaletteJson = paletteJsonPath ? path.resolve(paletteJsonPath) : undefined;
	const palette = resolvedPaletteJson
		? JSON.parse(readFileSync(resolvedPaletteJson, "utf8")) as MapPalette
		: undefined;
	const map = palette ? paletteImageToMapData(image, palette) : imageToMapData(image);
	const encoded = encodeMap(map);
	writeFileSync(resolvedOutput, encoded);
	console.log(`Converted ${map.width}x${map.height} image to ${resolvedOutput} (${encoded.length} bytes)`);
	if (resolvedPaletteJson) console.log(`Used palette: ${resolvedPaletteJson}`);
}

if (process.argv[1] && /^convert-image-map\.(?:ts|js)$/.test(path.basename(process.argv[1]))) {
	main();
}
