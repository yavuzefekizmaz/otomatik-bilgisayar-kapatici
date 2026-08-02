const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const si = require('systeminformation');
const { exec } = require('child_process');

let mainWindow;
let monitoringInterval = null;
let previousRxBytes = 0;
let previousTimestamp = 0;
let lowSpeedStartTime = null;
let isMonitoring = false;
let monitoringConfig = {
    interfaceName: '',
    thresholdKBs: 100,
    durationSeconds: 120
};

// Üssel hareketli ortalama (EMA) - daha hızlı tepki
let emaSpeed = 0;
const EMA_ALPHA = 0.7; // 0.7 = yeni değerlere daha fazla ağırlık (daha az yumuşatma)

// Son bilinen geçerli hız (0 olmaması için)
let lastKnownSpeed = 0;
let zeroCount = 0; // Kaç kez 0 geldiğini say

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        frame: false,
        transparent: false,
        backgroundColor: '#0a0a0f',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        },
        icon: path.join(__dirname, 'assets', 'icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    // Uncomment for debugging
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ==================== ÜSSEL HAREKETLİ ORTALAMA (EMA) ====================

function calculateEMA(newValue) {
    // Negatif değerleri filtrele
    if (newValue < 0) {
        return lastKnownSpeed > 0 ? lastKnownSpeed : emaSpeed;
    }

    // Eğer değer 0 ise ve son değer yüksekse, muhtemelen önbellek sorunu
    if (newValue === 0 || newValue < 1) {
        zeroCount++;
        // Art arda 3'ten fazla 0 gelmezse, son bilinen hızı kullan
        if (zeroCount < 3 && lastKnownSpeed > 10) {
            return lastKnownSpeed;
        }
    } else {
        zeroCount = 0;
    }

    // İlk değer için doğrudan ata
    if (emaSpeed === 0) {
        emaSpeed = newValue;
    } else {
        // EMA hesapla: yeni_ema = alpha * yeni_değer + (1-alpha) * eski_ema
        emaSpeed = EMA_ALPHA * newValue + (1 - EMA_ALPHA) * emaSpeed;
    }

    // Son bilinen geçerli hızı güncelle
    if (emaSpeed > 0) {
        lastKnownSpeed = emaSpeed;
    }

    return emaSpeed;
}

// ==================== IPC HANDLERS ====================

// Get all network interfaces
ipcMain.handle('get-network-interfaces', async () => {
    try {
        const networkInterfaces = await si.networkInterfaces();
        // Filter to only show active interfaces with IP addresses
        const activeInterfaces = networkInterfaces.filter(iface =>
            iface.ip4 && iface.ip4 !== '' && !iface.internal
        );
        return activeInterfaces.map(iface => ({
            name: iface.iface,
            type: iface.type,
            ip: iface.ip4,
            speed: iface.speed
        }));
    } catch (error) {
        console.error('Error getting network interfaces:', error);
        return [];
    }
});

// Start monitoring
ipcMain.handle('start-monitoring', async (event, config) => {
    if (isMonitoring) {
        return { success: false, message: 'Already monitoring' };
    }

    monitoringConfig = {
        interfaceName: config.interfaceName,
        thresholdKBs: config.thresholdKBs || 100,
        durationSeconds: config.durationSeconds || 120
    };

    isMonitoring = true;
    previousRxBytes = 0;
    previousTimestamp = Date.now();
    lowSpeedStartTime = null;
    speedHistory = []; // Geçmişi temizle

    // Get initial bytes
    try {
        const stats = await si.networkStats(monitoringConfig.interfaceName);
        if (stats && stats.length > 0) {
            previousRxBytes = stats[0].rx_bytes;
            previousTimestamp = Date.now();
        }
    } catch (error) {
        console.error('Error getting initial network stats:', error);
    }

    // Start monitoring loop (every 1 second)
    monitoringInterval = setInterval(async () => {
        try {
            const stats = await si.networkStats(monitoringConfig.interfaceName);
            if (stats && stats.length > 0) {
                const currentRxBytes = stats[0].rx_bytes;
                const currentTimestamp = Date.now();

                // Geçen süreyi hesapla (saniye cinsinden)
                const elapsedSeconds = (currentTimestamp - previousTimestamp) / 1000;

                // Byte farkını hesapla
                const bytesDiff = currentRxBytes - previousRxBytes;

                // Saniye başına byte (gerçek zaman bazlı)
                let rawBytesPerSecond = 0;
                if (elapsedSeconds > 0 && bytesDiff >= 0) {
                    rawBytesPerSecond = bytesDiff / elapsedSeconds;
                }

                const rawKbPerSecond = rawBytesPerSecond / 1024;

                // Hareketli ortalama uygula
                const smoothedKbPerSecond = calculateEMA(rawKbPerSecond);
                const smoothedMbPerSecond = smoothedKbPerSecond / 1024;
                // Mbit/s = bytes * 8 / 1000000 (bit cinsinden)
                const smoothedMbitPerSecond = (smoothedKbPerSecond * 1024 * 8) / 1000000;

                previousRxBytes = currentRxBytes;
                previousTimestamp = currentTimestamp;

                // Send speed update to renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('speed-update', {
                        bytesPerSecond: smoothedKbPerSecond * 1024,
                        kbPerSecond: Math.max(0, smoothedKbPerSecond),
                        mbPerSecond: Math.max(0, smoothedMbPerSecond),
                        mbitPerSecond: Math.max(0, smoothedMbitPerSecond),
                        rawKbPerSecond: rawKbPerSecond, // Debug için ham değer
                        timestamp: Date.now()
                    });

                    // Trigger kontrolü için yumuşatılmış değeri kullan
                    checkTriggerCondition(smoothedKbPerSecond);
                }
            }
        } catch (error) {
            console.error('Error in monitoring loop:', error);
        }
    }, 1000);

    return { success: true, message: 'Monitoring started' };
});

// Stop monitoring
ipcMain.handle('stop-monitoring', async () => {
    stopMonitoring();
    return { success: true, message: 'Monitoring stopped' };
});

// Execute shutdown
ipcMain.handle('execute-shutdown', async () => {
    console.log('🔴 KAPANIYOR... (Test modu - gerçek shutdown devre dışı)');

    // ⚠️ GÜVENLİK: Test sırasında shutdown komutu devre dışı
    // Gerçek kullanım için aşağıdaki satırları aktif edin:

    // exec('shutdown /s /t 0', (error) => {
    //     if (error) {
    //         console.error('Shutdown error:', error);
    //         return { success: false, message: error.message };
    //     }
    // });

    return { success: true, message: 'Test modu - Shutdown simüle edildi' };
});

// Window controls
ipcMain.handle('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.handle('window-close', () => {
    if (mainWindow) mainWindow.close();
});

// ==================== HELPER FUNCTIONS ====================

function stopMonitoring() {
    isMonitoring = false;
    lowSpeedStartTime = null;

    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
}

function checkTriggerCondition(currentSpeedKBs) {
    const threshold = monitoringConfig.thresholdKBs;
    const requiredDuration = monitoringConfig.durationSeconds * 1000; // Convert to ms

    if (currentSpeedKBs < threshold) {
        // Speed is below threshold
        if (lowSpeedStartTime === null) {
            lowSpeedStartTime = Date.now();
        } else {
            const elapsedTime = Date.now() - lowSpeedStartTime;

            if (elapsedTime >= requiredDuration) {
                // Trigger condition met!
                console.log('Trigger condition met! Starting countdown...');
                lowSpeedStartTime = null; // Reset

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('trigger-countdown');
                }

                // Stop monitoring while countdown is active
                stopMonitoring();
            }
        }
    } else {
        // Speed is above threshold, reset timer
        lowSpeedStartTime = null;
    }
}
