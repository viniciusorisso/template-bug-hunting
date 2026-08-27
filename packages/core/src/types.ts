export type Difficulty = "easy" | "medium" | "hard";

export type SubmissionStatus = "solved" | "partial" | "duplicate" | "incorrect";

export type CodeRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type BugPatch = {
  range: CodeRange;
  replacement: string;
};

export type HintLevel = 1 | 2;

export type BugHint = {
  level: HintLevel;
  message: string;
};

export type ResolvedBugDiff = {
  bugId: string;
  originalRange: CodeRange;
  appliedRange: CodeRange;
  beforeText: string;
  afterText: string;
  resolvedLineIds: string[];
};

export type SubmissionAttempt = {
  challengeId: string;
  bugId?: string;
  selection: CodeRange;
  proposedFix: string;
  originalText?: string;
  editedText?: string;
  serverDiff?: ServerDiff;
  status: SubmissionStatus;
  createdAt: string;
};

export type EditorChangeOperation = {
  type: "replace" | "insert" | "delete";
  originalStartLine: number;
  originalEndLine: number;
  replacementText: string;
};

export type ServerDiff = {
  operations: EditorChangeOperation[];
  addedLines: number;
  removedLines: number;
};

export type SubmitBugEditorRequest = {
  schemaVersion: 1;
  challengeId: string;
  sessionId: string;
  roomCode?: string;
  participantName?: string;
  file: { path: string; language: "typescript"; sourceVersion: string; originalText: string; editedText: string };
  selection: CodeRange;
  clientChanges: { operations: EditorChangeOperation[]; clientDiff?: string };
};

export type SessionProgress = {
  sessionId: string;
  challengeId: string;
  solvedBugIds: string[];
  attempts: SubmissionAttempt[];
};

export type HintState = {
  sessionId: string;
  challengeId: string;
  roomCode?: string;
  consumedHintsByBug: Record<string, HintLevel[]>;
};

export type BugValidationTestId =
  | "CHECKOUT_001_USER_ID_GUARD"
  | "CHECKOUT_002_ITEM_LOOP_BOUNDARY"
  | "CHECKOUT_003_COUPON_CODE_NORMALIZATION"
  | "CHECKOUT_004_EXPIRATION_DIRECTION"
  | "CHECKOUT_005_OPTIONAL_PLAN_RULE"
  | "CHECKOUT_006_MAX_USES_BOUNDARY"
  | "CHECKOUT_007_ASSIGNMENT_IN_CONDITION"
  | "CHECKOUT_008_MONEY_ROUNDING"
  | "CHECKOUT_009_INPUT_MUTATION"
  | "CHECKOUT_010_TAX_ROUNDING"
  | "PROFILE_001_ID_NON_NULL_ASSERTION"
  | "PROFILE_002_EMAIL_NON_NULL_ASSERTION"
  | "PROFILE_003_READONLY_ASSERTION_ALIAS"
  | "PROFILE_004_READONLY_ROLE_MUTATION"
  | "PROFILE_005_SHARED_DEFAULT_SHORTCUTS"
  | "PROFILE_006_PREFERENCES_ASSERTION"
  | "PROFILE_007_METADATA_ASSERTION"
  | "PROFILE_008_NOTIFICATION_EXHAUSTIVENESS";

export type BugDefinition = {
  id: string;
  title: string;
  category: string;
  difficulty: Difficulty;
  expectedRange: CodeRange;
  testId: BugValidationTestId;
  expectedFix: string;
  technicalBasis: string;
  patch: BugPatch;
  hints: BugHint[];
};

export type ChallengeDefinition = {
  id: string;
  title: string;
  description: string;
  language: "typescript";
  source: string;
  bugs: BugDefinition[];
};

/**
 * Dados de um bug que podem ser enviados ao jogador antes da resolucao.
 * Os detalhes usados para validar ou aplicar a correcao permanecem privados
 * no catalogo do servidor.
 */
export type PublicBugDefinition = Pick<BugDefinition, "id" | "title" | "category" | "difficulty">;

/** Contrato seguro do challenge consumido pelo cliente. */
export type PublicChallengeDefinition = Omit<ChallengeDefinition, "bugs"> & {
  bugs: PublicBugDefinition[];
};

export type ChallengeStateResponse = {
  challengeId: string;
  baseSource: string;
  resolvedBugOrder: string[];
  resolvedBugDiffs: Record<string, ResolvedBugDiff>;
  resolvedBugTechnicalBases?: Record<string, string>;
  displayedSource: string;
};

export type ValidationContext = {
  bug: BugDefinition;
  selection: CodeRange;
  proposedFix: string;
  normalizedFix: string;
  sessionProgress: SessionProgress;
};

export type ValidationResult = {
  status: Exclude<SubmissionStatus, "duplicate">;
  feedback: string;
};

export type SubmitBugRequest = {
  challengeId: string;
  sessionId: string;
  selection: CodeRange;
  proposedFix: string;
  originalText?: string;
  roomCode?: string;
  participantName?: string;
  editedText?: string;
  serverDiff?: ServerDiff;
};

export type SubmitBugResponse = {
  accepted: boolean;
  status: SubmissionStatus;
  bugId?: string;
  feedback: string;
  technicalBasis?: string;
  resolvedBugIds: string[];
  resolvedBugDiff?: ResolvedBugDiff;
  serverDiff?: ServerDiff;
  conflict?: boolean;
};

export type RequestHintPayload = {
  challengeId: string;
  sessionId: string;
  roomCode?: string;
};

export type RequestHintResponse = {
  challengeId: string;
  roomCode?: string;
  bugId: string;
  difficulty: Difficulty;
  hintLevel: HintLevel;
  message: string;
  category: string;
};

export type ResolvedBugEvent = {
  type: "bug.resolved";
  challengeId: string;
  sessionId: string;
  bugId: string;
  title: string;
  resolvedAt: string;
  diff: ResolvedBugDiff;
  shortDescription: string;
};

export type RoomStatus = "active" | "deleted";

export type RoomExecutionSettings = {
  allowTypecheck?: boolean;
  allowRuntimeExecution?: boolean;
};

export type Room = {
  id: string;
  name: string;
  roomCode: string;
  challengeId: string;
  passwordHash: string;
  status: RoomStatus;
  createdAt: string;
  deletedAt?: string;
  executionSettings?: RoomExecutionSettings;
};

export type RoomSummary = Omit<Room, "passwordHash">;

export type ParticipantSession = {
  id: string;
  roomCode: string;
  displayName: string;
  joinedAt: string;
};

export type RoomActivityItem = {
  id: string;
  roomCode: string;
  challengeId: string;
  bugId?: string;
  status: SubmissionStatus;
  submittedBy: string;
  submittedAt: string;
  submittedCode?: string;
};

export type RoomActivityResponse = {
  roomCode: string;
  items: RoomActivityItem[];
};

export type RoomActivityEvent = {
  type: "room.activity";
  roomCode: string;
  item: Omit<RoomActivityItem, "submittedCode">;
};

export type RoomExecutionSettingsEvent = {
  type: "room.execution-settings";
  roomCode: string;
  challengeId: string;
  executionSettings: Required<RoomExecutionSettings>;
};

export type AdminStatusResponse = {
  configured: boolean;
  username?: string;
};

export type AdminAuthRequest = {
  username?: string;
  password: string;
};

export type AdminAuthResponse = {
  token: string;
  username: string;
};

export type CreateRoomRequest = {
  name: string;
  password: string;
  challengeId: string;
};

export type JoinRoomRequest = {
  roomCode: string;
  displayName: string;
};

export type JoinRoomResponse = {
  participantSessionId: string;
  roomCode: string;
  roomName: string;
  challengeId: string;
  challengeTitle: string;
  displayName: string;
  executionSettings?: RoomExecutionSettings;
};

export type UpdateRoomExecutionSettingsRequest = {
  allowTypecheck?: boolean;
  allowRuntimeExecution?: boolean;
};

export type RoomExecutionSettingsResponse = {
  roomCode: string;
  challengeId: string;
  executionSettings: Required<RoomExecutionSettings>;
};

export type RoomTypecheckRequest = {
  participantSessionId: string;
  challengeId: string;
  source: string;
};

export type TypecheckDiagnostic = {
  code?: string;
  message: string;
  file: string;
  line: number;
  column: number;
  category: "error" | "warning" | "message";
};

export type RoomTypecheckResponse = {
  ok: boolean;
  diagnostics: TypecheckDiagnostic[];
  rawOutput: string;
  durationMs: number;
};

export type RoomRunRequest = {
  participantSessionId: string;
  challengeId: string;
  source: string;
};

export type RoomRunTerminationReason = "completed" | "timeout" | "runtime_error" | "sandbox_violation";

export type RoomRunResponse = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  terminationReason?: RoomRunTerminationReason;
};
