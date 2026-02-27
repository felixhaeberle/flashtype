import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("flashtypeDesktop", {
	platform: process.platform,
});
