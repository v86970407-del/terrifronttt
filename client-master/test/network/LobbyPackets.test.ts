import {describe, test} from "node:test";
import {deepEqual, equal} from "node:assert";
import {deserializePacket} from "../../src/network/protocol/DataTransferContext";
import {PacketRegistry} from "../../src/network/protocol/PacketRegistry";
import {GameQueueUpdatePacket} from "../../src/network/protocol/packet/game/GameQueueUpdatePacket";
import {LobbyJoinPacket} from "../../src/network/protocol/packet/game/LobbyJoinPacket";
import {SpawnBundlePacket} from "../../src/network/protocol/packet/game/SpawnBundlePacket";

describe("lobby packets", () => {
	test("round-trips lobby details and membership state", () => {
		const registry = new PacketRegistry<void>();
		let received: number[] | undefined;
		registry.handle(GameQueueUpdatePacket, function () {
			received = [
				this.gameId,
				this.playerCount,
				this.maxPlayers,
				this.time,
				this.position,
				Number(this.joined)
			];
			equal(this.map, "Europe");
			equal(this.mode, 0);
		});

		const packet = new GameQueueUpdatePacket(123456, "Europe", 0, 4, 30, 57, 2, true);
		const serialized = packet.transferContext.serialize(packet, registry);
		deserializePacket(serialized, registry).handle(undefined);
		deepEqual(received, [123456, 4, 30, 57, 2, 1]);
	});

	test("round-trips a lobby join request", () => {
		const registry = new PacketRegistry<void>();
		let receivedId: number | undefined;
		registry.handle(LobbyJoinPacket, function () {
			receivedId = this.gameId;
		});

		const packet = new LobbyJoinPacket(654321);
		const serialized = packet.transferContext.serialize(packet, registry);
		deserializePacket(serialized, registry).handle(undefined);
		equal(receivedId, 654321);
	});

	test("round-trips spawn positions and remaining spawn time", () => {
		const registry = new PacketRegistry<void>();
		let receivedTime: number | undefined;
		registry.handle(SpawnBundlePacket, function () {
			equal(this.spawnPositions.length, 1);
			equal(this.spawnPositions[0].player, 2);
			equal(this.spawnPositions[0].position, 12345);
			receivedTime = this.time;
		});

		const packet = new SpawnBundlePacket([{player: 2, position: 12345}], 10000);
		const serialized = packet.transferContext.serialize(packet, registry);
		deserializePacket(serialized, registry).handle(undefined);
		equal(receivedTime, 10000);
	});
});
