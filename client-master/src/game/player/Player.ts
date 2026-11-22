import type {HSLColor} from "../../util/HSLColor";
import {gameMode} from "../GameData";

/**
 * Income is paid out once every this many game ticks.
 */
export const INCOME_INTERVAL_TICKS = 10;

export class Player {
	readonly id: number;
	readonly name: string;
	readonly countryFlag: string;
	readonly baseColor: HSLColor;
	private troops: number = 1000;
	private territorySize: number = 0;
	private alive: boolean = true;

	constructor(id: number, name: string, baseColor: HSLColor, countryFlag: string = "") {
		this.id = id;
		this.name = name;
		this.countryFlag = countryFlag;
		this.baseColor = gameMode.processPlayerColor(id, baseColor);
	}

	/**
	 * Add a tile to the player's territory.
	 * WARNING: Make sure to call this method AFTER updating the territory manager.
	 * @param _tile The tile to add
	 * @internal
	 */
	addTile(_tile: number): void {
		this.territorySize++;
	}

	/**
	 * Remove a tile from the player's territory.
	 * WARNING: Make sure to call this method AFTER updating the territory manager.
	 * @param _tile The tile to remove
	 * @internal
	 */
	removeTile(_tile: number): void {
		this.territorySize--;

		if (this.territorySize === 0 && !gameMode.keepAlive(this)) {
			this.alive = false;
		}
	}

	/**
	 * Process one tick worth of income.
	 */
	income() {
		this.addTroops(this.incomeAmount());
	}

	/**
	 * @returns The raw amount of troops one income payout would add (before the troop cap).
	 */
	private incomeAmount(): number {
		return Math.max(1, Math.floor(this.territorySize / 10) + Math.floor(Math.pow(3 / 5, 1 - Math.log(this.troops + 1) / Math.LN2)));
	}

	/**
	 * @returns The amount of troops the next income payout will actually add (0 when the troop cap is reached).
	 */
	getIncome(): number {
		return Math.max(0, Math.min(this.incomeAmount(), this.territorySize * 100 - this.troops));
	}

	/**
	 * @returns The amount of troops the player has.
	 */
	getTroops(): number {
		return this.troops;
	}

	/**
	 * Add troops to the player.
	 * Troops will be capped at 100 times the territory size.
	 * @param amount The amount of troops to add.
	 */
	addTroops(amount: number) {
		this.troops = Math.min(this.territorySize * 100, this.troops + amount);
	}

	/**
	 * Remove troops from the player.
	 * @param amount The amount of troops to remove.
	 */
	removeTroops(amount: number) {
		this.troops = Math.max(0, this.troops - amount);
	}

	/**
	 * @returns The size of the player's territory (in tiles).
	 */
	getTerritorySize(): number {
		return this.territorySize;
	}

	/**
	 * @returns True if the player is alive, false otherwise.
	 */
	isAlive(): boolean {
		return this.alive;
	}
}