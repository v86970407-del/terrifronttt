import {gameTicker} from "../../game/GameTicker";
import {formatTime, formatTroops} from "../../util/StringFormatter";
import {getSetting, registerSettingListener} from "../../util/settings/UserSettingManager";
import {blockInteraction, registerClickListener, registerDragListener} from "../UIEventResolver";
import {hideAllUIElements, loadStaticElement, showUIElement} from "../UIManager";
import {interactionManager} from "../../event/InteractionManager";
import {resolveElement} from "../UIElement";
import {mapActionHandler} from "../../game/action/MapActionHandler";
import {gameResultRegistry, gameInitRegistry, gameStartRegistry} from "../../game/Game";
import {clientPlayer} from "../../game/player/PlayerManager";
import {INCOME_INTERVAL_TICKS} from "../../game/player/Player";
import {territoryManager} from "../../game/TerritoryManager";
import {playerManager} from "../../game/player/PlayerManager";
import {showPanel} from "../type/UIPanel";
import {t} from "../../util/Lang";
import {buildButton, buildTextNode} from "../type/TextNode";
import {getCountryFlagURL} from "../../util/CountryFlag";

//@module ui

loadStaticElement("GameHud");

registerClickListener("openSettings", () => showUIElement("SettingsPanel"));
registerClickListener("exitGame", () => window.location.reload());

const gameClock: HTMLElement = (window.document.getElementById("gameClock") as HTMLElement);
gameTicker.registry.register(() => gameClock.innerHTML = formatTime(gameTicker.getElapsedTime()));
registerSettingListener("hud-clock", show => gameClock.style.display = show ? "inherit" : "none");
registerSettingListener("disable-custom-cursor", disable => {
	if (disable) {
		document.documentElement.dataset["disableCustomCursor"] = "true";
	} else {
		delete document.documentElement.dataset["disableCustomCursor"];
	}
});

interactionManager.draggable.add(resolveElement("GameHudContainer"));

const slider: HTMLElement = resolveElement("sliderAttackStrength");
interactionManager.draggable.add(slider);
const updateValue = (x: number) => setSliderValue((x - slider.getBoundingClientRect().left) / slider.getBoundingClientRect().width);

registerClickListener(slider, updateValue, true, true);
registerDragListener(slider, updateValue, updateValue, () => {});

const hiddenSlider: HTMLInputElement = resolveElement("sliderAttackHidden") as HTMLInputElement;
hiddenSlider.onchange = () => setSliderValue(parseInt(hiddenSlider.value) / 100);

const numberDisplay: HTMLElement = resolveElement("sliderAttackNumber");
const troopCountElement: HTMLElement = resolveElement("selectorTroopCount");
const SLIDER_STEP = 0.05;
let sliderValue = 0.5;
function setSliderValue(value: number) {
	if (value < 0) value = 0;
	if (value > 1) value = 1;
	sliderValue = value;
	slider.style.setProperty("--value", `${value * 100}%`);
	hiddenSlider.value = (value * 100).toString();

	mapActionHandler.setPower(value * 1000);
	refreshSelector();
}

/**
 * The bar shows how many troops the selected share sends, followed by that share in brackets.
 */
function refreshSelector() {
	troopCountElement.textContent = formatTroops(Math.floor((clientPlayer?.getTroops() ?? 0) * sliderValue));
	const percent = Math.round(sliderValue * 1000) / 10;
	numberDisplay.textContent = `(${percent.toString().replace(".", ",")}%)`;
}

// - / + buttons move the slider one notch, snapping to the 5% grid
const stepSlider = (direction: number) => setSliderValue(Math.round(sliderValue / SLIDER_STEP + direction) * SLIDER_STEP);
resolveElement("selectorMinus").addEventListener("click", () => stepSlider(-1));
resolveElement("selectorPlus").addEventListener("click", () => stepSlider(1));

gameTicker.registry.register(refreshSelector);

gameInitRegistry.register(() => {
	hideAllUIElements();
	showUIElement("GameHud");
	setSliderValue(0.5);
	refreshResources();
});

// Resource panel: troops, income per tick and a few empire stats
resolveElement("resourcePlayersLabel").textContent = t("game.resources.players");
resolveElement("resourceMapLabel").textContent = t("game.resources.map");
resolveElement("resourceInterestLabel").textContent = t("game.resources.interest");
const resourcePanel = resolveElement("resourcePanel");
const resourceTroops = resolveElement("resourceTroops");
const resourceRate = resolveElement("resourceRate");
const resourcePlayers = resolveElement("resourcePlayers");
const resourceMap = resolveElement("resourceMap");
const resourceInterest = resolveElement("resourceInterest");

function setText(element: HTMLElement, text: string) {
	if (element.textContent !== text) element.textContent = text;
}

function refreshResources() {
	const player = clientPlayer;
	if (!player) return;
	const troops = player.getTroops();
	const perTick = player.getIncome() / INCOME_INTERVAL_TICKS;

	const troopText = formatTroops(troops);
	setText(resourceTroops, troopText);
	resourceTroops.classList.toggle("resource-troops-long", troopText.length > 9);
	setText(resourceRate, `(+${perTick.toFixed(2)}/tick)`);

	const players = playerManager.getPlayers();
	setText(resourcePlayers, `${players.filter(p => p.isAlive()).length}/${players.length}`);
	const conquerable = territoryManager.conquerableTiles;
	const mapShare = conquerable > 0 ? player.getTerritorySize() / conquerable * 100 : 0;
	setText(resourceMap, `${mapShare.toFixed(mapShare < 1 ? 3 : 2)}%`);
	setText(resourceInterest, `${(troops > 0 ? perTick / troops * 100 : 0).toFixed(2)}%`);
}

gameTicker.registry.register(() => {
	if (gameTicker.getTickCount() % 2 === 0) refreshResources();
});
blockInteraction(resourcePanel);

blockInteraction(gameClock);
blockInteraction(resolveElement("selectorContainer"));

const leaderboard = resolveElement("leaderboard");
blockInteraction(leaderboard);
const leaderboardToggle = resolveElement("leaderboardToggle") as HTMLButtonElement;
const leaderboardContent = resolveElement("leaderboardContent");
const leaderboardRows = resolveElement("leaderboardRows");
const leaderboardViewport = resolveElement("leaderboardViewport");
const numberFormat = new Intl.NumberFormat();
resolveElement("leaderboardTitle").textContent = t("game.leaderboard.title").toLocaleUpperCase();
leaderboard.setAttribute("aria-label", t("game.leaderboard.title"));
leaderboardRows.setAttribute("aria-label", t("game.leaderboard.players"));

leaderboardToggle.addEventListener("click", () => {
	const expanded = leaderboardToggle.getAttribute("aria-expanded") === "true";
	leaderboardToggle.setAttribute("aria-expanded", String(!expanded));
	leaderboardContent.hidden = expanded;
});

function updateLeaderboard() {
	const players = playerManager.getPlayers()
		.map(player => ({player, land: player.getTerritorySize()}))
		.sort((a, b) => b.land - a.land || a.player.id - b.player.id)
		.map((entry, index) => ({...entry, rank: index + 1}));
	const clientRank = players.findIndex(entry => entry.player.id === clientPlayer.id);
	if (clientRank < 0) return;

	const signature = players.map(entry => `${entry.player.id}:${entry.land}:${entry.player.name}:${entry.player.countryFlag}`).join("|");
	if (signature === lastLeaderboardSignature) return;
	lastLeaderboardSignature = signature;

	const visiblePlayers = clientRank >= 10
		? [...players.slice(0, 9), players[clientRank]]
		: players.slice(0, 10);
	const remainingPlayers = clientRank >= 10
		? players.slice(9).filter(entry => entry.player.id !== clientPlayer.id)
		: players.slice(10);
	leaderboardEntries = [...visiblePlayers, ...remainingPlayers];
	renderLeaderboardRows();
}

function renderLeaderboardRows() {
	const rowHeight = 24;
	const topLand = Math.max(1, leaderboardEntries[0]?.land ?? 1);
	const visibleRows = Math.ceil(leaderboardViewport.clientHeight / rowHeight);
	const firstRow = Math.max(0, Math.floor(leaderboardViewport.scrollTop / rowHeight) - 2);
	const lastRow = Math.min(leaderboardEntries.length, firstRow + visibleRows + 4);
	leaderboardRows.style.height = `${leaderboardEntries.length * rowHeight}px`;
	const rows = leaderboardEntries.slice(firstRow, lastRow).map((entry, index) => {
		const row = document.createElement("li");
		row.classList.add("leaderboard-row");
		row.style.top = `${(firstRow + index) * rowHeight}px`;
		row.style.setProperty("--share", String(Math.round(entry.land / topLand * 100)));
		if (entry.rank <= 3) row.setAttribute("data-podium", String(entry.rank));
		row.setAttribute("aria-posinset", String(firstRow + index + 1));
		row.setAttribute("aria-setsize", String(leaderboardEntries.length));
		if (entry.player.id === clientPlayer.id) {
			row.classList.add("leaderboard-row-current");
			row.setAttribute("aria-current", "true");
		}

		const rankCell = document.createElement("span");
		rankCell.classList.add("leaderboard-rank");
		rankCell.textContent = String(entry.rank);

		const nameCell = document.createElement("span");
		nameCell.classList.add("leaderboard-player");
		const flagUrl = getSetting("disable-flags") ? undefined : getCountryFlagURL(entry.player.countryFlag);
		if (flagUrl) {
			const flag = document.createElement("img");
			flag.classList.add("leaderboard-flag");
			flag.src = flagUrl;
			flag.alt = "";
			flag.draggable = false;
			nameCell.appendChild(flag);
		}
		const name = document.createElement("span");
		name.classList.add("leaderboard-player-name");
		name.textContent = entry.player.name;
		nameCell.appendChild(name);

		const landCell = document.createElement("span");
		landCell.classList.add("leaderboard-land");
		landCell.textContent = numberFormat.format(entry.land);

		row.append(rankCell, nameCell, landCell);
		return row;
	});

	leaderboardRows.replaceChildren(...rows);
}

let leaderboardEntries: {player: typeof clientPlayer, land: number, rank: number}[] = [];
let lastLeaderboardSignature = "";
gameStartRegistry.register(updateLeaderboard);
gameTicker.registry.register(() => {
	if (gameTicker.getTickCount() % 20 === 0) updateLeaderboard();
});
leaderboardViewport.addEventListener("scroll", renderLeaderboardRows, {passive: true});
registerSettingListener("disable-flags", () => {
	lastLeaderboardSignature = "";
	if (leaderboardEntries.length > 0) updateLeaderboard();
});

gameResultRegistry.register(result => {
	showPanel(t("game.result.title"),
		buildTextNode(result.getWinnerString()),
		buildButton(t("game.action.leave"), "danger", "btn-block").onClick(() => window.location.reload())
	);
})