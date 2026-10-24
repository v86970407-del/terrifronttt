import type {PacketTransferContext} from "../../DataTransferContext";
import {BasePacket} from "../BasePacket";

export class LobbyJoinPacket extends BasePacket<LobbyJoinPacket> {
	constructor(public readonly gameId: number) {super()}

	buildTransferContext(transfer: PacketTransferContext<LobbyJoinPacket>): void {
		transfer.number("gameId", 24);
	}
}
