/**
 * Type declarations for the transferables library
 * This resolves the TypeScript module resolution issue with the library's exports
 */
declare module 'transferables' {
  export type TypeTransferable =
    | ArrayBuffer
    | MessagePort
    | ReadableStream
    | WritableStream
    | TransformStream
    | ImageBitmap
    | OffscreenCanvas
    | RTCDataChannel

  export function getTransferables(
    obj: unknown,
    streams?: boolean,
    maxCount?: number
  ): TypeTransferable[]

  export function hasTransferables(obj: unknown, streams?: boolean, maxCount?: number): boolean

  export function isTransferable(obj: unknown): obj is TypeTransferable
}
