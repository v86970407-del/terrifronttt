import {randomBytes} from "crypto";
import {GameModeIds} from "../network/protocol/util/GameTypeIds";
import {GameQueueUpdatePacket} from "../network/protocol/packet/game/GameQueueUpdatePacket";
import {sendPacket, type NetworkClient} from "../network/Client.ts";
import {Game} from "./Game";

const LOBBY_COUNT = 3;
const LOBBY_CAPACITY = 30;
const LOBBY_INTERVAL = 30_000;
const MAP_ROTATION = [
	{id: "N858Os", name: "Europe"},
	{id: "zBgFOr", name: "World"},
	{id: "local-white-sea", name: "White Sea"}
] as const;

let gameQueue: ScheduledGame[] = [];
const lobbyClients = new Set<NetworkClient>();
let nextMapIndex = 0;

function createLobbyId(): number {
	let id: number;
	do {
		id = randomBytes(3).readUIntBE(0, 3);
	} while (id === 0 || gameQueue.some(game => game.id === id));
	return id;
}

export class ScheduledGame {
	readonly id: number;
	readonly launchAt: number;
	readonly mapId: string;
	readonly mapName: string;
	private readonly players: NetworkClient[] = [];

	constructor() {
		this.id = createLobbyId();
		this.launchAt = (gameQueue[gameQueue.length - 1]?.launchAt ?? Date.now()) + LOBBY_INTERVAL;
		const map = MAP_ROTATION[nextMapIndex % MAP_ROTATION.length]!;
		this.mapId = map.id;
		this.mapName = map.name;
		nextMapIndex++;
	}

	addPlayer(player: NetworkClient): boolean {
		if (this.players.includes(player)) return true;
		if (this.players.length >= LOBBY_CAPACITY) return false;
		this.players.push(player);
		player.data.game = this;
		player.data.clientId = undefined;
		return true;
	}

	removePlayer(player: NetworkClient): void {
		const index = this.players.indexOf(player);
		if (index !== -1) {
			this.players.splice(index, 1);
		}
		if (player.data.game === this) {
			player.data.game = undefined;
			player.data.clientId = undefined;
		}
	}

	isFull(): boolean {
		return this.players.length >= LOBBY_CAPACITY;
	}

	hasPlayer(player: NetworkClient): boolean {
		return this.players.includes(player);
	}

	start(): void {
		if (gameQueue[0] !== this) return;
		gameQueue.shift();
		const players = this.players.splice(0);
		if (players.length > 0) {
			new Game(players, this.mapId);
		}
		ensureLobbyCount();
	}

	getPlayerCount(): number {
		return this.players.length;
	}

	getPlayers(): readonly NetworkClient[] {
		return this.players;
	}

	getTimeRemaining(now: number): number {
		return Math.max(0, Math.ceil((this.launchAt - now) / 1000));
	}
}

function ensureLobbyCount(): void {
	while (gameQueue.length < LOBBY_COUNT) {
		gameQueue.push(new ScheduledGame());
	}
}

export function registerLobbyClient(player: NetworkClient): void {
	lobbyClients.add(player);
}

export function unregisterLobbyClient(player: NetworkClient): void {
	lobbyClients.delete(player);
}

export function joinGame(player: NetworkClient, gameId: number): boolean {
	const target = gameQueue.find(game => game.id === gameId);
	if (!target || target.isFull()) return false;
	if (player.data.game === target) return true;
	if (player.data.game instanceof Game) return false;
	if (player.data.game instanceof ScheduledGame) {
		player.data.game.removePlayer(player);
	}
	return target.addPlayer(player);
}

function updateLobbies(): void {
	const now = Date.now();
	while (gameQueue[0] && gameQueue[0]!.launchAt <= now) {
		gameQueue[0]!.start();
	}
	ensureLobbyCount();

	for (const client of lobbyClients) {
		if (client.data.game instanceof Game) continue;
		for (let index = 0; index < gameQueue.length; index++) {
			const game = gameQueue[index]!;
			sendPacket(client, new GameQueueUpdatePacket(
				game.id,
				game.mapName,
				GameModeIds.FFA,
				game.getPlayerCount(),
				LOBBY_CAPACITY,
				game.getTimeRemaining(now),
				index,
				game.hasPlayer(client)
			));
		}
	}
}

ensureLobbyCount();
setInterval(updateLobbies, 1000);
