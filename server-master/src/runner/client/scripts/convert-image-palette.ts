import {readFileSync, writeFileSync} from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {PNG} from "pngjs";

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

interface DecodedImage {
	width: number;
	height: number;
	data: Uint8Array;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export function recolorImage(image: DecodedImage, palette: MapPalette): DecodedImage {
	const {width, height, data} = image;
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
		throw new Error(`Image dimensions must be positive integers; received ${width}x${height}`);
	}
	if (data.length !== width * height * 4) {
		throw new Error("Image pixel data does not match its dimensions");
	}

	const waterColors = palette.tiles.filter(tile => tile.name.toLowerCase() === "water").map(tile => parseColor(tile.color));
	const landColors = palette.tiles.filter(tile => tile.name.toLowerCase() !== "water").map(tile => parseColor(tile.color));
	if (waterColors.length === 0 || landColors.length === 0) {
		throw new Error("Palette must contain at least one water tile and one land tile");
	}
	waterColors.sort((a, b) => a[0] - b[0]);

	const waterMask = new Uint8Array(width * height);
	const distances = new Float32Array(width * height);
	const maximumDistance = width + height;
	distances.fill(maximumDistance);
	let hasLand = false;
	for (let pixel = 0; pixel < waterMask.length; pixel++) {
		const offset = pixel * 4;
		const red = data[offset];
		const green = data[offset + 1];
		const blue = data[offset + 2];
		const isWater = data[offset + 3] < 128 || (blue > red + 28 && blue > green + 18 && blue > red * 1.15);
		if (isWater) {
			waterMask[pixel] = 1;
		} else {
			distances[pixel] = 0;
			hasLand = true;
		}
	}

	if (hasLand) {
		calculateLandDistances(distances, width, height);
	}
	let deepestWaterDistance = 0;
	for (let pixel = 0; pixel < waterMask.length; pixel++) {
		if (waterMask[pixel]) deepestWaterDistance = Math.max(deepestWaterDistance, distances[pixel]);
	}

	const output = new Uint8Array(data.length);
	for (let pixel = 0; pixel < waterMask.length; pixel++) {
		const offset = pixel * 4;
		const red = data[offset];
		const green = data[offset + 1];
		const blue = data[offset + 2];
		const alpha = data[offset + 3];
		let color: [number, number, number];
		if (waterMask[pixel]) {
			const depth = deepestWaterDistance === 0 ? 1 : distances[pixel] / deepestWaterDistance;
			const depthBand = Math.min(waterColors.length - 1, Math.floor(depth * waterColors.length));
			color = waterColors[waterColors.length - 1 - depthBand];
		} else {
			color = closestGrayColor((red * 299 + green * 587 + blue * 114) / 1000, landColors);
		}
		output[offset] = color[0];
		output[offset + 1] = color[1];
		output[offset + 2] = color[2];
		output[offset + 3] = alpha;
	}

	return {width, height, data: output};
}

function calculateLandDistances(distances: Float32Array, width: number, height: number): void {
	const diagonalStep = Math.SQRT2;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const pixel = y * width + x;
			let distance = distances[pixel];
			if (x > 0) distance = Math.min(distance, distances[pixel - 1] + 1);
			if (y > 0) {
				distance = Math.min(distance, distances[pixel - width] + 1);
				if (x > 0) distance = Math.min(distance, distances[pixel - width - 1] + diagonalStep);
				if (x < width - 1) distance = Math.min(distance, distances[pixel - width + 1] + diagonalStep);
			}
			distances[pixel] = distance;
		}
	}

	for (let y = height - 1; y >= 0; y--) {
		for (let x = width - 1; x >= 0; x--) {
			const pixel = y * width + x;
			let distance = distances[pixel];
			if (x < width - 1) distance = Math.min(distance, distances[pixel + 1] + 1);
			if (y < height - 1) {
				distance = Math.min(distance, distances[pixel + width] + 1);
				if (x > 0) distance = Math.min(distance, distances[pixel + width - 1] + diagonalStep);
				if (x < width - 1) distance = Math.min(distance, distances[pixel + width + 1] + diagonalStep);
			}
			distances[pixel] = distance;
		}
	}
}

function parseColor(color: string): [number, number, number] {
	const match = /^#([0-9a-f]{6})$/i.exec(color);
	if (!match) {
		throw new Error(`Invalid palette color: ${color}`);
	}
	const value = match[1];
	return [
		parseInt(value.slice(0, 2), 16),
		parseInt(value.slice(2, 4), 16),
		parseInt(value.slice(4, 6), 16)
	];
}

function closestGrayColor(luminance: number, colors: [number, number, number][]): [number, number, number] {
	return colors.reduce((closest, color) =>
		Math.abs(color[0] - luminance) < Math.abs(closest[0] - luminance) ? color : closest
	);
}

function printUsage(): void {
	console.error("Usage: npm run convert-image-palette -- <input.png> [output.png] [output.json] [europe|world]");
	console.error("By default, outputs <input>-palette.png and <input>-palette.json using the World palette.");
	console.error("Ocean shades are generated from distance to land because source images do not contain depth data.");
}

function main(): void {
	const [inputPath, outputImagePath, outputJsonPath, paletteArgument, ...extraArgs] = process.argv.slice(2);
	const paletteName = paletteArgument ?? "world";
	if (!inputPath || extraArgs.length > 0 || !["europe", "world"].includes(paletteName.toLowerCase())) {
		printUsage();
		process.exitCode = 2;
		return;
	}

	const palettePath = path.resolve(scriptDirectory, `../resources/maps/${paletteName.toLowerCase()}.json`);
	const palette = JSON.parse(readFileSync(palettePath, "utf8")) as MapPalette;
	const resolvedInput = path.resolve(inputPath);
	const defaultBase = `${path.basename(inputPath, path.extname(inputPath))}-palette`;
	const defaultImagePath = path.join(path.dirname(inputPath), `${defaultBase}.png`);
	const defaultJsonPath = path.join(path.dirname(inputPath), `${defaultBase}.json`);
	const resolvedImage = path.resolve(outputImagePath ?? defaultImagePath);
	const resolvedJson = path.resolve(outputJsonPath ?? defaultJsonPath);
	const image = PNG.sync.read(readFileSync(resolvedInput));
	const recolored = recolorImage(image, palette);
	const outputPng = new PNG({width: recolored.width, height: recolored.height});
	outputPng.data.set(recolored.data);
	writeFileSync(resolvedImage, PNG.sync.write(outputPng));
	writeFileSync(resolvedJson, `${JSON.stringify(palette, null, 2)}\n`);
	console.log(`Recolored ${recolored.width}x${recolored.height} image using the ${paletteName} palette.`);
	console.log(`PNG: ${resolvedImage}`);
	console.log(`JSON: ${resolvedJson}`);
}

if (process.argv[1] && /^convert-image-palette\.(?:ts|js)$/.test(path.basename(process.argv[1]))) {
	main();
}
