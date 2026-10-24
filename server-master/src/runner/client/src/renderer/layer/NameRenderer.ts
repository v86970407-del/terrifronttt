import type {GameGLContext} from "../GameGLContext";
import type {GameFont, GameTextEntry} from "../GameFont";
import {playerNameRenderingManager} from "../manager/PlayerNameRenderingManager";
import {playerManager} from "../../game/player/PlayerManager";
import {gameRenderer, rendererContextGameplay, renderingContextInit} from "../GameRenderer";
import {BaseRendererLayer} from "./BaseRendererLayer";
import {mapFontData} from "../shader/ShaderManager";
import {mapNavigationHandler} from "../../game/action/MapNavigationHandler";
import {formatTroops} from "../../util/StringFormatter";
import {getCountryFlagURL} from "../../util/CountryFlag";
import {getSetting} from "../../util/settings/UserSettingManager";
import {gameQuitRegistry} from "../../game/Game";

//@module renderer

class NameRenderer extends BaseRendererLayer {
	private font: GameFont;
	private flagLayer: HTMLDivElement | undefined;
	private flagImages = new Map<number, HTMLImageElement>();

	clearCountryFlags(): void {
		this.flagLayer?.remove();
		this.flagLayer = undefined;
		this.flagImages.clear();
	}

	setup(context: GameGLContext) {
		mapFontData(context).then(font => this.font = font).catch(() => {});
	}

	render(context: GameGLContext): void {
		if (!this.font) return;
		const xMin = mapNavigationHandler.getMapX(0);
		const xMax = mapNavigationHandler.getMapX(context.raw.canvas.width);
		const yMin = mapNavigationHandler.getMapY(0);
		const yMax = mapNavigationHandler.getMapY(context.raw.canvas.height);
		const toDraw: GameTextEntry[] = [];
		const flaggedPlayers: {id: number, flag: string, x: number, y: number, size: number, nameLayout: ReturnType<GameFont["getTextLayout"]>}[] = [];
		for (let i = 0; i < playerNameRenderingManager.playerData.length; i++) {
			const player = playerManager.getPlayer(i);
			if (player && player.isAlive()) {
				const data = playerNameRenderingManager.playerData[i];
				if (data.size * mapNavigationHandler.zoom < 1 || data.nameX + data.size + 1 < xMin || data.nameX + 1 > xMax || data.nameY + data.size + 1 < yMin || data.nameY + 1 > yMax) {
					continue;
				}
				const nameEntry: GameTextEntry = {
					string: player.name,
					x: data.nameX,
					y: data.nameY - data.size * 0.18,
					size: data.size,
					baselineBottom: true,
					maxHeight: data.size * 0.28
				};
				const hasCountryFlag = !getSetting("disable-flags") && Boolean(getCountryFlagURL(player.countryFlag));
				toDraw.push(nameEntry);
				toDraw.push({
					string: formatTroops(player.getTroops()),
					x: data.nameX,
					y: data.nameY + data.size * (hasCountryFlag ? 0.68 : 0.4),
					size: data.size,
					maxHeight: data.size * 0.28
				});
				if (hasCountryFlag) {
					flaggedPlayers.push({
						id: player.id,
						flag: player.countryFlag,
						x: data.nameX,
						y: data.nameY,
						size: data.size,
						nameLayout: this.font.getTextLayout(nameEntry)
					});
				}
			}
		}
		this.font.drawText(toDraw);
		this.renderCountryFlags(flaggedPlayers);
	}

	private renderCountryFlags(players: {id: number, flag: string, x: number, y: number, size: number, nameLayout: ReturnType<GameFont["getTextLayout"]>}[]): void {
		if (!this.flagLayer) {
			this.flagLayer = document.createElement("div");
			this.flagLayer.classList.add("country-flag-layer");
			this.flagLayer.setAttribute("aria-hidden", "true");
			Object.assign(this.flagLayer.style, {
				position: "fixed",
				inset: "0",
				overflow: "hidden",
				pointerEvents: "none",
				zIndex: "0"
			});
			document.body.appendChild(this.flagLayer);
		}

		const visible = new Set<number>();
		for (const player of players) {
			const url = getCountryFlagURL(player.flag);
			if (!url) continue;
			visible.add(player.id);
			let image = this.flagImages.get(player.id);
			if (!image) {
				image = document.createElement("img");
				image.alt = "";
				image.draggable = false;
				Object.assign(image.style, {
					position: "absolute",
					maxWidth: "none",
					imageRendering: "pixelated"
				});
				this.flagImages.set(player.id, image);
				this.flagLayer.appendChild(image);
			}
			if (image.dataset["flag"] !== player.flag) {
				image.dataset["flag"] = player.flag;
				delete image.dataset["failed"];
				image.src = url;
				image.onerror = () => {
					image!.dataset["failed"] = "true";
					image!.hidden = true;
					console.warn(`Failed to load country flag "${player.flag}" from PixelFlags.`);
				};
			}

			const zoom = mapNavigationHandler.zoom;
			const height = player.nameLayout.height * zoom * 0.8;
			const aspectRatio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 32 / 18;
			const width = height * aspectRatio;
			const x = mapNavigationHandler.x + (player.x + player.size / 2) * zoom - width / 2;
			const y = mapNavigationHandler.y + (player.y + player.size / 2) * zoom - height / 2;
			image.hidden = image.dataset["failed"] === "true" || x > window.innerWidth || y > window.innerHeight || x + width < 0 || y + height < 0;
			image.style.width = `${width}px`;
			image.style.height = `${height}px`;
			image.style.transform = `translate3d(${x}px, ${y}px, 0)`;
		}

		for (const [id, image] of this.flagImages) {
			if (!visible.has(id)) image.hidden = true;
		}
	}
}

export const nameRenderer = new NameRenderer();

renderingContextInit.register(id => id === rendererContextGameplay && gameRenderer.registerLayer(nameRenderer, 15));
gameQuitRegistry.register(() => {
	nameRenderer.clearCountryFlags();
});