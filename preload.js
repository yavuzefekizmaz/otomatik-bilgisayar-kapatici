const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Network interfaces
    getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),

    // Monitoring controls
    startMonitoring: (config) => ipcRenderer.invoke('start-monitoring', config),
    stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),

    // Shutdown
    executeShutdown: () => ipcRenderer.invoke('execute-shutdown'),

    // Window controls
    minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
    closeWindow: () => ipcRenderer.invoke('window-close'),

    // Event listeners
    onSpeedUpdate: (callback) => {
        ipcRenderer.on('speed-update', (event, data) => callback(data));
    },

    onTriggerCountdown: (callback) => {
        ipcRenderer.on('trigger-countdown', () => callback());
    },

    // Remove listeners
    removeSpeedUpdateListener: () => {
        ipcRenderer.removeAllListeners('speed-update');
    },

    removeTriggerCountdownListener: () => {
        ipcRenderer.removeAllListeners('trigger-countdown');
    }
});
