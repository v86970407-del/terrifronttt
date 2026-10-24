const PIXEL_FLAGS_BASE_URL = "https://r74n.com/pixelflags/png/country/";

export function getCountryFlagURL(slug: string): string | undefined {
	if (!/^[a-z0-9_]{1,48}$/.test(slug)) return undefined;
	return `${PIXEL_FLAGS_BASE_URL}${slug}.png`;
}
