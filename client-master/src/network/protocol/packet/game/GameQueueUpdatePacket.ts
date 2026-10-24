import type {PacketTransferContext} from "../../DataTransferContext";
import type {GameModeIds} from "../../util/GameTypeIds";
import {BasePacket} from "../BasePacket";
import {gameModeIdLength} from "../../util/GameTypeIds";

export class GameQueueUpdatePacket extends BasePacket<GameQueueUpdatePacket> {
	/**
	 * Creates a new game queue update packet.
	 * @param gameId The lobby ID
	 * @param map The map name
	 * @param mode The game mode
	 * @param playerCount The number of players in the lobby
	 * @param maxPlayers The lobby capacity
	 * @param time The time until the game starts
	 * @param position The lobby's position in the rotation
	 * @param joined Whether the receiving player is in this lobby
	 */
	constructor(
		public readonly gameId: number,
		public readonly map: string,
		public readonly mode: GameModeIds,
		public readonly playerCount: number,
		public readonly maxPlayers: number,
		public readonly time: number,
		public readonly position: number,
		public readonly joined: boolean
	) {super()}

	buildTransferContext(transfer: PacketTransferContext<GameQueueUpdatePacket>): void {
		transfer.number("gameId", 24);
		transfer.string("map", 32);
		transfer.number("mode", gameModeIdLength);
		transfer.number("playerCount", 6);
		transfer.number("maxPlayers", 6);
		transfer.number("time", 7);
		transfer.number("position", 2);
		transfer.boolean("joined");
	}
}