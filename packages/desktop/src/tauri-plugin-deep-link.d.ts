declare module "@tauri-apps/plugin-deep-link" {
  type Unlisten = () => void

  export function getCurrent(): Promise<string[] | null>
  export function onOpenUrl(handler: (urls: string[]) => void): Promise<Unlisten>
}
