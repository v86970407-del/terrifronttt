import type {TileType} from "../map/codec/MapCodec";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- This is used in generated code
import {HSLColor} from "../util/HSLColor";
import {getSettingObject} from "../util/settings/UserSettingManager";

//@module ui

/**
 * All colors, fonts, and other theme-related properties should be passed through a theme object.
 * This allows for easy customization of the game's appearance.
 */
export type GameTheme = {
	readonly id: string;
	toString(): string;

	/**
	 * Get the color of a territory.
	 * @param color base player color
	 * @returns the color of the territory
	 */
	getTerritoryColor(color: HSLColor): HSLColor;

	/**
	 * Get the border color of a territory.
	 * @param color base player color
	 * @returns the border color of the territory
	 */
	getBorderColor(color: HSLColor): HSLColor;

	/**
	 * Get the color of a tile.
	 * @param tile the type of the tile
	 * @returns the color of the tile
	 */
	getTileColor(tile: TileType): HSLColor;

	/**
	 * Get the color of the background.
	 * @returns the color of the background
	 */
	getBackgroundColor(): HSLColor;

	/**
	 * Get the font of the game.
	 * @returns the font of the game
	 */
	getFont(): string;

	/**
	 * Get the list of shaders to use.
	 * @returns the list of shaders to use
	 * @internal
	 */
	getShaderArgs(): {name: string, args: {[key: string]: unknown}}[];
}

export function isDarkMode(theme?: GameTheme): boolean {
	return document.documentElement.dataset["menuTheme"] === "dark" && (!theme || theme.id === "pastel");
}

export function toDarkPastelColor(color: HSLColor, surface: "map" | "territory" | "border" | "background" | "detail", colorBase?: string): HSLColor {
	switch (surface) {
		case "map":
			if (colorBase === "grass") return color.withHue(140).withSaturation(0.34).withLightness(0.27 + color.l * 0.035);
			if (colorBase === "mountain") return color.withHue(150).withSaturation(0.16).withLightness(0.32 + color.l * 0.07);
			if (colorBase === "water") return color.withHue(198).withSaturation(0.44).withLightness(0.2 + color.l * 0.09);
			return color.withSaturation(Math.min(color.s * 0.65, 0.5)).withLightness(0.14 + color.l * 0.2);
		case "territory":
			return color.withSaturation(Math.min(color.s * 0.8, 0.6)).withLightness(0.38 + color.l * 0.12);
		case "border":
			return color.withSaturation(Math.min(color.s * 0.8, 0.65)).withLightness(0.46 + color.l * 0.1);
		case "background":
			return color.withSaturation(Math.min(color.s, 0.5)).withLightness(0.18);
		case "detail":
			return color.withSaturation(Math.min(color.s * 0.75, 0.55)).withLightness(0.42 + color.l * 0.12);
	}
}

const registry: Record<string, GameTheme> = {};

/**
 * Registers a theme.
 * @param id the name of the theme
 * @param theme the theme
 */
export function registerTheme(id: string, theme: Omit<GameTheme, "id">) {
	registry[id] = {
		id,
		...theme,
		toString: function (this: GameTheme) {
			return this.id
		},
	}
}

/**
 * Retrieves a theme from the registry by its name.
 * @param id the name of the theme
 * @returns the theme
 */
export function getTheme(id: string): GameTheme {
	const theme = registry[id];
	if (!theme) {
		throw new Error(`Theme ${id} not found`);
	}
	return theme;
}

// The following lines are filled in by the build process
// BUILD_THEMES_REGISTER
// End of theme register block

getSettingObject("theme").fillOptions(registry);