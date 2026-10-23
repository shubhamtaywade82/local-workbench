// Preload script: the only code that runs with access to both the page and
// ipcRenderer. It exposes a fixed set of functions and nothing else. Every
// call is validated again in the main process.

import { contextBridge, ipcRenderer } from "electron";
import {
  DESKTOP_CHANNELS,
  DESKTOP_GLOBAL,
  type DesktopBridge,
  type DesktopCommand,
  type DesktopFsRequest,
  type DesktopFsResult,
  type DesktopLaunchTarget,
} from "../src/lib/desktop/contract";

const commandListeners = new Set<(command: DesktopCommand) => void>();
ipcRenderer.on(DESKTOP_CHANNELS.command, (_event, command: DesktopCommand) => {
  for (const listener of commandListeners) listener(command);
});

const bridge: DesktopBridge = {
  getLaunchTarget: (): Promise<DesktopLaunchTarget | null> => ipcRenderer.invoke(DESKTOP_CHANNELS.launchTarget),
  chooseWorkspace: (): Promise<DesktopLaunchTarget | null> => ipcRenderer.invoke(DESKTOP_CHANNELS.chooseWorkspace),
  fs: (request: DesktopFsRequest): Promise<DesktopFsResult> => ipcRenderer.invoke(DESKTOP_CHANNELS.fs, request),
  onCommand: (listener: (command: DesktopCommand) => void): void => {
    commandListeners.add(listener);
  },
};

contextBridge.exposeInMainWorld(DESKTOP_GLOBAL, bridge);
