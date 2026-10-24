import {gameInitRegistry, gameQuitRegistry, gameStartRegistry} from "../../game/Game";
import {isLocalGame} from "../../game/GameData";
import {languageChangeRegistry, t} from "../../util/Lang";
import {SPAWN_PHASE_DURATION_MS} from "../../network/protocol/packet/game/SpawnBundlePacket";
import {spawnTimerSyncRegistry} from "../../event/SpawnTimerSyncEvent";
import {resolveElement} from "../UIElement";

//@module ui

/**
 * Length of the spawn phase in multiplayer games, in milliseconds.
 *
 * This matches the server's spawn-bundle and game-tick schedule.
 */
const timer = resolveElement("spawnTimer");
const label = resolveElement("spawnTimerLabel");
const time = resolveElement("spawnTimerTime");

let frame = 0;
let endTime = 0;
let duration = SPAWN_PHASE_DURATION_MS;
let shownSeconds = -1;

function renderLabel() {
	label.textContent = t("game.spawn.title");
	if (shownSeconds >= 0) renderSeconds(shownSeconds);
}

function renderSeconds(seconds: number) {
	const text = t("game.spawn.remaining", {seconds});
	time.textContent = text;
	timer.setAttribute("aria-valuetext", text);
}

function update() {
	// Based on the wall clock instead of game ticks, the game ticker does not run during the spawn phase
	const remaining = Math.max(0, endTime - performance.now());
	const progress = Math.min(1, Math.max(0, 1 - remaining / duration));
	timer.style.setProperty("--spawn-progress", `${progress * 100}%`);

	const seconds = Math.ceil(remaining / 1000);
	if (seconds !== shownSeconds) {
		shownSeconds = seconds;
		renderSeconds(seconds);
		timer.setAttribute("aria-valuenow", String(Math.round(progress * duration / 1000)));
	}

	// Once the countdown is over the bar stays full until the server starts the game
	frame = remaining > 0 ? requestAnimationFrame(update) : 0;
}

/**
 * Shows the spawn timer and starts counting down.
 * @param durationMs The length of the spawn phase in milliseconds
 */
export function startSpawnTimer(durationMs: number = SPAWN_PHASE_DURATION_MS) {
	stopSpawnTimer();
	duration = durationMs;
	endTime = performance.now() + durationMs;
	shownSeconds = -1;
	timer.setAttribute("aria-valuemax", String(Math.round(durationMs / 1000)));
	timer.hidden = false;
	update();
}

/**
 * Corrects the spawn timer if the server reports how much time is left.
 * @param remainingMs The time left until the game starts in milliseconds
 */
export function syncSpawnTimer(remainingMs: number) {
	if (timer.hidden) return;
	endTime = performance.now() + Math.min(duration, Math.max(0, remainingMs));
	if (!frame) update();
}

/**
 * Hides the spawn timer and stops counting down.
 */
export function stopSpawnTimer() {
	if (frame) cancelAnimationFrame(frame);
	frame = 0;
	timer.hidden = true;
}

// Local games have no countdown: the spawn phase ends as soon as the player picks a spot
gameInitRegistry.register(() => {
	if (isLocalGame) stopSpawnTimer();
	else startSpawnTimer();
});
gameStartRegistry.register(stopSpawnTimer);
gameQuitRegistry.register(stopSpawnTimer);
languageChangeRegistry.register(renderLabel);
spawnTimerSyncRegistry.register(syncSpawnTimer);
renderLabel();
