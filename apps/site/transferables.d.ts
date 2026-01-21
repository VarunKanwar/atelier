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
