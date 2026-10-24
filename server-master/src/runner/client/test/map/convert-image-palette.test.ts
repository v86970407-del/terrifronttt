import {deepEqual, throws} from "node:assert";
import {describe, test} from "node:test";
import {recolorImage} from "../../scripts/convert-image-palette";

const palette = {
	tiles: [
		{color: "#000000", name: "Water", colorBase: "water", colorVariant: 4, conquerable: false, navigable: true},
		{color: "#222222", name: "Water", colorBase: "water", colorVariant: 6, conquerable: false, navigable: true},
		{color: "#555555", name: "Water", colorBase: "water", colorVariant: 12, conquerable: false, navigable: true},
		{color: "#777777", name: "Water", colorBase: "water", colorVariant: 14, conquerable: false, navigable: true},
		{color: "#999999", name: "Land", colorBase: "mountain", colorVariant: 5, conquerable: true, navigable: false}
	]
};

describe("recolorImage", () => {
	test("adds multiple ocean depth shades based on distance from land", () => {
		const width = 9;
		const height = 9;
		const data = new Uint8Array(width * height * 4);
		for (let pixel = 0; pixel < width * height; pixel++) {
			data.set([0, 0, 106, 255], pixel * 4);
		}
		data.set([255, 255, 255, 255], 4 * (4 * width + 4));

		const image = recolorImage({width, height, data}, palette);
		deepEqual(Array.from(image.data.slice(4 * (4 * width + 5), 4 * (4 * width + 5) + 3)), [119, 119, 119]);
		deepEqual(Array.from(image.data.slice(0, 3)), [0, 0, 0]);
		const waterColors = new Set<string>();
		for (let pixel = 0; pixel < width * height; pixel++) {
			if (pixel === 4 * width + 4) continue;
			waterColors.add(Array.from(image.data.slice(pixel * 4, pixel * 4 + 3)).join(","));
		}
		deepEqual(waterColors.size, 4);
	});

	test("maps blue pixels to water shades and land pixels to land shades", () => {
		const image = recolorImage({
			width: 3,
			height: 1,
			data: new Uint8Array([
				0, 0, 106, 255,
				100, 100, 100, 255,
				0, 0, 0, 0
			])
		}, palette);

		deepEqual(Array.from(image.data), [
			0, 0, 0, 255,
			153, 153, 153, 255,
			0, 0, 0, 0
		]);
	});

	test("rejects an incomplete palette", () => {
		throws(() => recolorImage({
			width: 1,
			height: 1,
			data: new Uint8Array([0, 0, 0, 255])
		}, {tiles: []}), /water tile and one land tile/);
	});
});
