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
    convertToHtml(
      input: { arrayBuffer: ArrayBuffer },
      options?: { convertImage?: unknown }
    ): Promise<{ value: string; messages: { type: string; message: string }[] }>
    images: {
      imgElement(
        handler: (image: { contentType: string; read(encoding: 'base64'): Promise<string> }) => Promise<{ src: string }>
      ): unknown
    }
  }
  const mammoth: Mammoth
  export default mammoth
}
