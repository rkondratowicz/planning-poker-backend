const roomIdPattern = /^([a-z0-9]{4,32}-)*[a-z0-9]{4,32}$/;

export function validateRoomId(roomId: string, maxLength: number): string | null {
  if (roomId.length === 0) {
    return "room is required";
  }
  if (roomId.length > maxLength) {
    return "room is too long";
  }
  if (!roomIdPattern.test(roomId)) {
    return "Invalid room id";
  }
  return null;
}

export function validateName(rawName: string, maxLength: number): string | null {
  const name = rawName.trim();
  if (name.length === 0) {
    return "name is required";
  }
  if (name.length > maxLength) {
    return "name is too long";
  }
  return null;
}

export function validateDeck(rawDeck: string, maxLength: number): string | null {
  const deckValue = rawDeck.trim();
  if (deckValue.length > maxLength) {
    return "deck is too long";
  }
  return null;
}
