import {getDefaultMapIds} from "../../map/MapRegistry";
import {getSetting, getSettingObject, registerSettingListener} from "../../util/settings/UserSettingManager";
import {GameModeIds} from "../../network/protocol/util/GameTypeIds";
import {registerClickListener} from "../UIEventResolver";
import {loadValidatedInput} from "../type/ValidatedInput";
import {showPanel} from "../type/UIPanel";
import {hideAllUIElements, loadStaticElement, showUIElement} from "../UIManager";
import {t} from "../../util/Lang";
import {buildButton, displayAlert} from "../type/TextNode";
import {buildContainer} from "../type/ContentField";
import {gameLoadFailRegistry, tryStartGame} from "../../game/GameLoader";
import {closeMultiplayerLobby, openMultiplayerLobby} from "./MultiplayerLobby";
import buttonSoundUrl from "../../../resources/assets/button-sound.ogg";
import {getCountryFlagURL} from "../../util/CountryFlag";

//@module ui

loadStaticElement("MainMenu")

const buttonSound = new Audio(buttonSoundUrl);
buttonSound.preload = "auto";
function playButtonSound(event: Event): void {
	if (!(event.target instanceof Element)) return;
	const button = event.target.closest("button");
	if (!button || (!button.closest("#MainMenuContainer") && !button.closest("#defaultPanel"))) return;
	buttonSound.currentTime = 0;
	void buttonSound.play().catch(error => console.warn("Failed to play homepage button sound.", error));
}

document.addEventListener("pointerdown", playButtonSound, true);
document.addEventListener("keydown", event => {
	if (event instanceof KeyboardEvent && (event.key === "Enter" || event.key === " ")) {
		playButtonSound(event);
	}
}, true);

const homeScreenLogo = document.getElementById("homeScreenLogo");
if (!(homeScreenLogo instanceof HTMLImageElement)) {
	console.error("Home screen logo element was not found.");
} else {
	const logLogoLoadError = () => console.error("Failed to load home screen logo.", {
		src: homeScreenLogo.src,
		currentSrc: homeScreenLogo.currentSrc,
		complete: homeScreenLogo.complete,
		naturalWidth: homeScreenLogo.naturalWidth,
		naturalHeight: homeScreenLogo.naturalHeight
	});
	homeScreenLogo.addEventListener("error", logLogoLoadError);
	if (homeScreenLogo.complete && homeScreenLogo.naturalWidth === 0) {
		logLogoLoadError();
	} else {
		homeScreenLogo.addEventListener("load", () => console.info("Home screen logo loaded.", {
			currentSrc: homeScreenLogo.currentSrc,
			naturalWidth: homeScreenLogo.naturalWidth,
			naturalHeight: homeScreenLogo.naturalHeight
		}), {once: true});
	}
}

const btnStartMultiplayer: HTMLButtonElement = (window.document.getElementById("btnStartMultiplayer") as HTMLButtonElement);
const btnStartSingleplayer: HTMLButtonElement = (window.document.getElementById("btnStartSingleplayer") as HTMLButtonElement);
const btnThemeToggle: HTMLButtonElement = (window.document.getElementById("btnThemeToggle") as HTMLButtonElement);
const countryFlagButtonPreview = document.getElementById("countryFlagButtonPreview") as HTMLImageElement;
const countryFlagButtonText = document.querySelector<HTMLSpanElement>("#btnShowFlags span")!;
const homeMenuCenter: HTMLDivElement = document.getElementsByClassName("home-menu-center")[0] as HTMLDivElement;
const homeMenuMainView: HTMLDivElement = document.getElementById("homeMenuMainView") as HTMLDivElement;
const homeMenuThemeView: HTMLDivElement = document.getElementById("homeMenuThemeView") as HTMLDivElement;
const homeMenuFlagView: HTMLDivElement = document.getElementById("homeMenuFlagView") as HTMLDivElement;
const homeMenuFlagCatalog: HTMLDivElement = document.getElementById("homeMenuFlagCatalog") as HTMLDivElement;
const themePreviewImage: HTMLSpanElement = document.getElementById("themePreviewImage") as HTMLSpanElement;
const themePreviewName: HTMLSpanElement = document.getElementById("themePreviewName") as HTMLSpanElement;
const themePreviewSelected: HTMLSpanElement = document.getElementById("themePreviewSelected") as HTMLSpanElement;
const btnSelectTheme: HTMLButtonElement = document.getElementById("btnSelectTheme") as HTMLButtonElement;
const btnShowFlags: HTMLButtonElement = document.getElementById("btnShowFlags") as HTMLButtonElement;

const themeChoices = [
	{id: "pastel", name: "Pastel Theme", imageClass: "home-menu-theme-preview-pastel"},
	{id: "classic", name: "Classic Theme", imageClass: "home-menu-theme-preview-classic"}
] as const;
let displayedThemeIndex = Math.max(0, themeChoices.findIndex(theme => theme.id === getSetting("theme").id));

function updateThemePreview() {
	const theme = themeChoices[displayedThemeIndex];
	const isSelected = getSetting("theme").id === theme.id;
	themePreviewImage.className = `home-menu-theme-preview-image ${theme.imageClass}`;
	themePreviewImage.setAttribute("aria-label", theme.name);
	themePreviewName.textContent = theme.name;
	themePreviewSelected.hidden = !isSelected;
	btnSelectTheme.setAttribute("aria-pressed", String(isSelected));
}

function showThemePicker() {
	homeMenuMainView.hidden = true;
	homeMenuThemeView.hidden = false;
	homeMenuCenter.classList.add("home-menu-theme-picker-active");
	displayedThemeIndex = Math.max(0, themeChoices.findIndex(theme => theme.id === getSetting("theme").id));
	updateThemePreview();
}

function hideThemePicker() {
	homeMenuThemeView.hidden = true;
	homeMenuMainView.hidden = false;
	homeMenuCenter.classList.remove("home-menu-theme-picker-active");
}

type CountryFlagOption = {slug: string, name: string};
let countryFlags: CountryFlagOption[] = [];
let countryFlagsLoaded = false;
let countryFlagsFailed = false;

function updateCountryFlagButton(slug: string): void {
	const flagUrl = getCountryFlagURL(slug);
	countryFlagButtonPreview.hidden = !flagUrl;
	countryFlagButtonText.hidden = Boolean(flagUrl);
	if (flagUrl) {
		countryFlagButtonPreview.src = flagUrl;
		countryFlagButtonPreview.alt = `${countryFlags.find(flag => flag.slug === slug)?.name ?? "Selected"} flag`;
	} else {
		countryFlagButtonPreview.removeAttribute("src");
		countryFlagButtonPreview.alt = "";
	}
}

function selectCountryFlag(slug: string): void {
	getSettingObject("country-flag-none").set(!slug).save();
	getSettingObject("country-flag").set(slug).save();
	updateCountryFlagButton(slug);
	hideFlagPicker();
}

function renderFlagCatalog(): void {
	homeMenuFlagCatalog.replaceChildren();
	if (!countryFlagsLoaded) {
		const status = document.createElement("p");
		status.className = "home-menu-flag-status";
		status.textContent = countryFlagsFailed
			? "Could not load flags. Please try again later."
			: "Loading flags...";
		homeMenuFlagCatalog.appendChild(status);
		return;
	}

	const noFlag = document.createElement("button");
	noFlag.type = "button";
	noFlag.className = "home-menu-flag-card home-menu-flag-card-none";
	noFlag.textContent = "No flag";
	noFlag.setAttribute("aria-pressed", String(getSetting("country-flag-none")));
	noFlag.addEventListener("click", () => selectCountryFlag(""));
	homeMenuFlagCatalog.appendChild(noFlag);

	const search = document.createElement("input");
	search.type = "search";
	search.className = "home-menu-flag-search";
	search.placeholder = "Search flags";
	search.setAttribute("aria-label", "Search flags");
	homeMenuFlagCatalog.appendChild(search);

	const cards: {element: HTMLButtonElement, name: string}[] = [];
	for (const flag of countryFlags) {
		const card = document.createElement("button");
		card.type = "button";
		card.className = "home-menu-flag-card";
		card.setAttribute("aria-label", flag.name);
		card.setAttribute("aria-pressed", String(getSetting("country-flag") === flag.slug));

		const image = document.createElement("img");
		image.className = "home-menu-flag-image";
		image.src = getCountryFlagURL(flag.slug)!;
		image.alt = "";
		image.draggable = false;

		const name = document.createElement("span");
		name.className = "home-menu-flag-name";
		name.textContent = flag.name;
		card.append(image, name);
		card.addEventListener("click", () => selectCountryFlag(flag.slug));
		homeMenuFlagCatalog.appendChild(card);
		cards.push({element: card, name: flag.name.toLocaleLowerCase()});
	}

	const noResults = document.createElement("p");
	noResults.className = "home-menu-flag-status";
	noResults.textContent = "No matching flags.";
	noResults.hidden = true;
	homeMenuFlagCatalog.appendChild(noResults);
	search.addEventListener("input", () => {
		const query = search.value.trim().toLocaleLowerCase();
		let visibleCount = 0;
		for (const card of cards) {
			card.element.hidden = !card.name.includes(query);
			if (!card.element.hidden) visibleCount++;
		}
		noResults.hidden = visibleCount > 0;
	});
}

function showFlagPicker(): void {
	homeMenuMainView.hidden = true;
	homeMenuThemeView.hidden = true;
	homeMenuFlagView.hidden = false;
	homeMenuCenter.classList.add("home-menu-theme-picker-active", "home-menu-flag-picker-active");
	renderFlagCatalog();
}

function hideFlagPicker(): void {
	homeMenuFlagView.hidden = true;
	homeMenuMainView.hidden = false;
	homeMenuCenter.classList.remove("home-menu-flag-picker-active");
	if (homeMenuThemeView.hidden) {
		homeMenuCenter.classList.remove("home-menu-theme-picker-active");
	}
}

const playerNameValidationExp: RegExp = /^[a-zA-Z0-9\u00A0-\u00FF\u0100-\u024F\u1E00-\u1EFF\-_. ({)}<>]*$/;

async function loadCountryFlags(): Promise<void> {
	try {
		const response = await fetch("https://r74n.com/pixelflags/");
		if (!response.ok) throw new Error(`PixelFlags returned HTTP ${response.status}`);
		const page = new DOMParser().parseFromString(await response.text(), "text/html");
		const countryHeading = page.querySelector("#country");
		let countryTable = countryHeading?.nextElementSibling ?? null;
		while (countryTable && countryTable.tagName !== "TABLE" && !/^H[1-6]$/.test(countryTable.tagName)) {
			countryTable = countryTable.nextElementSibling;
		}
		const rows = countryTable?.tagName === "TABLE"
			? countryTable.querySelectorAll<HTMLTableRowElement>("tr[id]")
			: [];
		if (rows.length === 0) throw new Error("PixelFlags country list was not found");

		for (const row of rows) {
			const slug = row.id;
			const name = row.querySelector("td:nth-child(2)")?.textContent?.trim();
			if (!getCountryFlagURL(slug) || !name) continue;
			countryFlags.push({slug, name});
		}
		countryFlags.sort((a, b) => a.name.localeCompare(b.name));
		const savedFlag = getSetting("country-flag");
		if (!getSetting("country-flag-none") && !countryFlags.some(flag => flag.slug === savedFlag)) {
			const randomFlag = countryFlags[Math.floor(Math.random() * countryFlags.length)];
			if (randomFlag) {
				getSettingObject("country-flag").set(randomFlag.slug).save();
			}
		}
		countryFlagsLoaded = true;
		updateCountryFlagButton(getSetting("country-flag"));
		if (!homeMenuFlagView.hidden) renderFlagCatalog();
	} catch (error) {
		countryFlagsFailed = true;
		console.error("Failed to load country flags from PixelFlags.", error);
		if (!homeMenuFlagView.hidden) renderFlagCatalog();
	}
}

void loadCountryFlags();
updateCountryFlagButton(getSetting("country-flag-none") ? "" : getSetting("country-flag"));

registerClickListener("btnStartMultiplayer", () => openMultiplayerLobby());
registerClickListener("btnOpenSettings", () => showUIElement("SettingsPanel"));
registerClickListener("btnShowThemes", showThemePicker);
registerClickListener("btnBackFromThemes", hideThemePicker);
registerClickListener(btnShowFlags, showFlagPicker);
registerClickListener("btnBackFromFlags", hideFlagPicker);
registerClickListener("btnPreviousTheme", () => {
	displayedThemeIndex = (displayedThemeIndex - 1 + themeChoices.length) % themeChoices.length;
	updateThemePreview();
});
registerClickListener("btnNextTheme", () => {
	displayedThemeIndex = (displayedThemeIndex + 1) % themeChoices.length;
	updateThemePreview();
});
registerClickListener(btnSelectTheme, () => {
	getSettingObject("theme").select(themeChoices[displayedThemeIndex].id).save();
	updateThemePreview();
});

registerSettingListener("theme", updateThemePreview);

btnThemeToggle.addEventListener("click", () => {
	getSettingObject("dark-mode").set(!getSetting("dark-mode")).save();
});

registerSettingListener("dark-mode", isDark => {
	if (isDark) {
		document.documentElement.dataset["menuTheme"] = "dark";
	} else {
		delete document.documentElement.dataset["menuTheme"];
	}
	btnThemeToggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} theme`);
	window.dispatchEvent(new Event("menu-theme-change"));
});

registerClickListener("btnStartSingleplayer", () => {
	showPanel(t("menu.map.select"), buildContainer("grid", "grid-3col").setContent(...getDefaultMapIds().sort((a, b) => a[1].name.localeCompare(b[1].name)).map(map =>
		buildButton(map[1].name).onClick(() => tryStartGame(map[0], GameModeIds.FFA, 23452345, [{name: getSetting("player-name"), countryFlag: getSetting("country-flag")}], 0, true)))
	));
});

gameLoadFailRegistry.register(() => {
	closeMultiplayerLobby();
	hideAllUIElements();
	showUIElement("MainMenu");
	displayAlert("danger", t("game.load.fail"), "slow")
});

loadValidatedInput("playerNameInput", "playerNameInputValidation")
	.onInput((_value, valid) => {
		btnStartMultiplayer.disabled = !valid;
		btnStartSingleplayer.disabled = !valid;
	})
	.mutate(value => value.trim())
	.addRule("Name contains invalid characters.", value => playerNameValidationExp.test(value))
	.addRule("Name is too short (must be at least 3 characters).", value => value.length >= 3)
	.addRule("Name is too long (32 characters maximum).", value => value.length <= 32)
	.linkSetting(getSettingObject("player-name"), false);