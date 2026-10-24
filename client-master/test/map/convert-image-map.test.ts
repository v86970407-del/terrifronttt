import {deepEqual, throws} from "node:assert";
import {describe, test} from "node:test";
import {decodeMap, encodeMap} from "../../src/map/codec/MapCodec";
import {imageToMapData, paletteImageToMapData} from "../../scripts/convert-image-map";

function rgba(red: number, green: number, blue: number): number[] {
	return [red, green, blue, 255];
}

describe("imageToMapData", () => {
	test("classifies blue and dark pixels as water and shaded land by brightness", () => {
		const image = {
			width: 3,
			height: 2,
			data: new Uint8Array([
				...rgba(0, 0, 80),
				...rgba(119, 119, 119),
				...rgba(0, 0, 255),
				...rgba(153, 153, 153),
				...rgba(187, 187, 187),
				...rgba(255, 255, 255)
			])
		};

		const map = imageToMapData(image);
		deepEqual(Array.from(map.tiles), [0, 3, 1, 4, 5, 7]);
		deepEqual(Array.from(decodeMap(encodeMap(map)).tiles), [0, 2, 1, 3, 4, 5]);
	});

	test("rejects images with unsupported dimensions", () => {
		throws(() => imageToMapData({width: 0, height: 1, data: new Uint8Array()}), /dimensions/);
	});
});

describe("paletteImageToMapData", () => {
	const palette = {
		tiles: [
			{color: "#000000", name: "Water", colorBase: "water", colorVariant: 4, conquerable: false, navigable: true},
			{color: "#FFFFFF", name: "Land", colorBase: "grass", colorVariant: 6, conquerable: true, navigable: false}
		]
	};

	test("keeps tile types from the supplied palette and encodes them correctly", () => {
		const image = {
			width: 2,
			height: 2,
			data: new Uint8Array([
				0, 0, 0, 255,
				255, 255, 255, 255,
				0, 0, 0, 255,
				255, 255, 255, 255
			])
		};
		const map = paletteImageToMapData(image, palette);
		deepEqual(Array.from(map.tiles), [0, 1, 0, 1]);
		deepEqual(map.types.map(type => type.colorBase), ["water", "grass"]);
		const decoded = decodeMap(encodeMap(map));
		deepEqual([decoded.width, decoded.height], [2, 2]);
		deepEqual(decoded.types.map(type => type.colorBase), ["water", "grass"]);
	});

	test("rejects image colors not defined in the palette", () => {
		throws(() => paletteImageToMapData({
			width: 1,
			height: 1,
			data: new Uint8Array([30, 30, 30, 255])
		}, palette), /not in the supplied palette/);
	});
});
