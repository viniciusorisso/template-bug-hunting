import type {
  ParticipantSession,
  Room,
  RoomActivityItem,
  RoomSummary,
  SubmissionStatus
} from "../types.js";

type CreateRoomInput = {
  id: string;
  name: string;
  passwordHash: string;
  roomCode: string;
  createdAt: string;
};

type RecordActivityInput = {
  roomCode: string;
  challengeId: string;
  bugId?: string;
  status: SubmissionStatus;
  submittedBy: string;
  submittedAt: string;
  proposedFix: string;
};

export class InMemoryAdminStore {
  private passwordHash: string | null = null;

  isConfigured(): boolean {
    return this.passwordHash !== null;
  }

  configure(passwordHash: string): boolean {
    if (this.passwordHash !== null) {
      return false;
    }

    this.passwordHash = passwordHash;
    return true;
  }

  authenticate(passwordHash: string): boolean {
    return this.passwordHash !== null && this.passwordHash === passwordHash;
  }
}

export class InMemoryRoomStore {
  private rooms = new Map<string, Room>();
  private participants = new Map<string, ParticipantSession>();
  private activity = new Map<string, RoomActivityItem[]>();

  listRooms(): RoomSummary[] {
    return [...this.rooms.values()].map(({ passwordHash: _passwordHash, ...room }) => room);
  }

  createRoom(input: CreateRoomInput): Room {
    const room: Room = {
      id: input.id,
      name: input.name,
      passwordHash: input.passwordHash,
      roomCode: input.roomCode,
      status: "active",
      createdAt: input.createdAt
    };

    this.rooms.set(room.roomCode, room);
    return room;
  }

  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode);
  }

  getRoomSummary(roomCode: string): RoomSummary | undefined {
    const room = this.rooms.get(roomCode);

    if (!room) {
      return undefined;
    }

    const { passwordHash: _passwordHash, ...summary } = room;
    return summary;
  }

  deleteRoom(roomCode: string, deletedAt: string): boolean {
    const room = this.rooms.get(roomCode);

    if (!room || room.status === "deleted") {
      return false;
    }

    this.rooms.set(roomCode, {
      ...room,
      status: "deleted",
      deletedAt
    });

    return true;
  }

  joinRoom(roomCode: string, participant: ParticipantSession): ParticipantSession | null {
    const room = this.rooms.get(roomCode);

    if (!room || room.status !== "active") {
      return null;
    }

    this.participants.set(participant.id, participant);
    return participant;
  }

  getParticipant(participantId: string): ParticipantSession | undefined {
    return this.participants.get(participantId);
  }

  listActivity(roomCode: string): RoomActivityItem[] {
    return this.activity.get(roomCode) ?? [];
  }

  recordActivity(input: RecordActivityInput): RoomActivityItem {
    const activityItem: RoomActivityItem = {
      id: `${input.roomCode}:${this.listActivity(input.roomCode).length + 1}`,
      roomCode: input.roomCode,
      challengeId: input.challengeId,
      bugId: input.bugId,
      status: input.status,
      submittedBy: input.submittedBy,
      submittedAt: input.submittedAt,
      proposedFix: input.proposedFix
    };

    const current = this.activity.get(input.roomCode) ?? [];
    this.activity.set(input.roomCode, [...current, activityItem]);
    return activityItem;
  }
}
