/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'mammoth/mammoth.browser' {
  interface Mammoth {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: { type: string; message: string }[] }>
  }
  const mammoth: Mammoth
  export default mammoth
}
