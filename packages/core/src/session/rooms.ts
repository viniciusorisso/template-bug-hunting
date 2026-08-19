import type {
  ParticipantSession,
  Room,
  RoomActivityItem,
  RoomExecutionSettings,
  RoomSummary,
  SubmissionStatus
} from "../types.js";

export type AdminCredentials = {
  username: string;
  passwordHash: string;
};

export type AdminStoreSnapshot = {
  configured: boolean;
  username?: string;
};

export type RoomStoreSnapshot = {
  rooms: Room[];
  participants: ParticipantSession[];
  activity: Record<string, RoomActivityItem[]>;
};

type CreateRoomInput = {
  id: string;
  name: string;
  passwordHash: string;
  roomCode: string;
  challengeId: string;
  createdAt: string;
  executionSettings?: RoomExecutionSettings;
};

type RecordActivityInput = {
  roomCode: string;
  challengeId: string;
  bugId?: string;
  status: SubmissionStatus;
  submittedBy: string;
  submittedAt: string;
};

export class InMemoryAdminStore {
  constructor(private credentials: AdminCredentials | null = null) {}

  isConfigured(): boolean {
    return this.credentials !== null;
  }

  getUsername(): string | undefined {
    return this.credentials?.username;
  }

  authenticate(username: string, passwordHash: string): boolean {
    return this.credentials?.username === username && this.credentials.passwordHash === passwordHash;
  }

  snapshot(): AdminStoreSnapshot {
    return {
      configured: this.isConfigured(),
      username: this.credentials?.username
    };
  }
}

export class InMemoryRoomStore {
  private rooms = new Map<string, Room>();
  private participants = new Map<string, ParticipantSession>();
  private activity = new Map<string, RoomActivityItem[]>();

  constructor(initial: Partial<RoomStoreSnapshot> = {}) {
    for (const room of initial.rooms ?? []) {
      this.rooms.set(room.roomCode, room);
    }

    for (const participant of initial.participants ?? []) {
      this.participants.set(participant.id, participant);
    }

    for (const [roomCode, items] of Object.entries(initial.activity ?? {})) {
      this.activity.set(roomCode, items);
    }
  }

  listRooms(): RoomSummary[] {
    return [...this.rooms.values()].map(({ passwordHash: _passwordHash, ...room }) => room);
  }

  createRoom(input: CreateRoomInput): Room {
    const room: Room = {
      id: input.id,
      name: input.name,
      passwordHash: input.passwordHash,
      roomCode: input.roomCode,
      challengeId: input.challengeId,
      status: "active",
      createdAt: input.createdAt,
      executionSettings: normalizeExecutionSettings(input.executionSettings)
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

  updateExecutionSettings(roomCode: string, settings: RoomExecutionSettings): RoomSummary | undefined {
    const room = this.rooms.get(roomCode);

    if (!room) {
      return undefined;
    }

    this.rooms.set(roomCode, {
      ...room,
      executionSettings: normalizeExecutionSettings({
        ...room.executionSettings,
        ...settings
      })
    });

    return this.getRoomSummary(roomCode);
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
      submittedAt: input.submittedAt
    };

    const current = this.activity.get(input.roomCode) ?? [];
    this.activity.set(input.roomCode, [...current, activityItem]);
    return activityItem;
  }

  snapshot(): RoomStoreSnapshot {
    return {
      rooms: [...this.rooms.values()],
      participants: [...this.participants.values()],
      activity: Object.fromEntries(this.activity.entries())
    };
  }
}

function normalizeExecutionSettings(settings: RoomExecutionSettings | undefined): Required<RoomExecutionSettings> {
  return {
    allowTypecheck: settings?.allowTypecheck ?? false,
    allowRuntimeExecution: settings?.allowRuntimeExecution ?? false
  };
}
