import type {PacketTransferContext} from "../../DataTransferContext";
import {BasePacket} from "../BasePacket";

export const GAME_TICK_INTERVAL_MS = 500;
export const SPAWN_BUNDLE_COUNT = 20;
export const SPAWN_PHASE_DURATION_MS = GAME_TICK_INTERVAL_MS * (SPAWN_BUNDLE_COUNT + 1);

export class SpawnBundlePacket extends BasePacket<SpawnBundlePacket> {
	/**
	 * Creates a new spawn bundle packet.
	 * @param spawnPositions The spawn positions
	 * @param time The time left until the game starts, in milliseconds
	 */
	constructor(
		public readonly spawnPositions: { player: number, position: number }[],
		public readonly time: number
	) {super()}

	buildTransferContext(transfer: PacketTransferContext<SpawnBundlePacket>): void {
		//TODO: This should use server-side player count and map size
		transfer.array("spawnPositions", 1024).object(transfer => {
			transfer.number("player", 10);
			transfer.number("position", 32);
		});
		transfer.number("time", 14);
	}
}