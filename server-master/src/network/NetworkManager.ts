import {PacketRegistry} from "./protocol/PacketRegistry";
import {disconnect, type NetworkClient, type WebSocketData} from "./Client.ts";
import {SocketErrorCodes} from "./protocol/util/SocketErrorCodes";
import {port} from "../util/Conf";
import {deserializePacket} from "./protocol/DataTransferContext";
import {serve} from "bun";
import {LobbyJoinPacket} from "./protocol/packet/game/LobbyJoinPacket";
import {joinGame} from "../game/GameQueue";

export const packetRegistry = new PacketRegistry<NetworkClient>(_id => ws => disconnect(ws, SocketErrorCodes.BAD_PACKET));

packetRegistry.handle(LobbyJoinPacket, function (ws) {
	if (!ws.data.handshake) return;
	joinGame(ws, this.gameId);
});

serve<WebSocketData, {}>({
	port,
	fetch(req, server) {
		if (server.upgrade(req, {data: {handshake: false}})) return;
		return new Response("Upgrade failed", {status: 500});
	},
	websocket: {
		message(ws, message) {
			try {
				deserializePacket(message as Uint8Array, packetRegistry).handle(ws);
			} catch (e) {
				disconnect(ws, SocketErrorCodes.BAD_MESSAGE);
			}
		},
		close(ws) {
			disconnect(ws, SocketErrorCodes.NO_ERROR)
		}
	}
});
console.log("Listening on port " + port);

require("../game/GamePacketHandler");