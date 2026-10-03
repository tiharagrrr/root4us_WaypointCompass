/**
 * UUIDv7 made on the device. Time-ordered, so a batch sorts the way it was tapped even if
 * deviceSeq is lost, and unique per tap: reusing one would make the server treat a second,
 * different action as a replay of the first (specs/sync/spec.md).
 */
export const uuidv7 = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  const ms = Date.now()
  bytes[0] = (ms / 2 ** 40) & 0xff
  bytes[1] = (ms / 2 ** 32) & 0xff
  bytes[2] = (ms / 2 ** 24) & 0xff
  bytes[3] = (ms / 2 ** 16) & 0xff
  bytes[4] = (ms / 2 ** 8) & 0xff
  bytes[5] = ms & 0xff

  // Version 7, variant 2.
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
