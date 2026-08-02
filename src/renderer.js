// ==================== GLOBAL STATE ====================
let isMonitoring = false;
let speedChart = null;
let speedData = [];
let timeLabels = [];
let countdownTimer = null;
let countdownValue = 60;
let lowSpeedStartTime = null;

// Kalibrasyon için
let isCalibrating = false;
let calibrationReadings = [];
let calibrationTimer = null;

// ==================== DOM ELEMENTS ====================
const elements = {
    // Speed display
    speedNumber: document.getElementById('speed-number'),
    speedUnit: document.getElementById('speed-unit'),
    speedKbs: document.getElementById('speed-kbs'),

    // Interface selector
    interfaceSelect: document.getElementById('interface-select'),
    refreshBtn: document.getElementById('btn-refresh-interfaces'),

    // Calibration
    calibrateBtn: document.getElementById('btn-calibrate'),
    calibrationStatus: document.getElementById('calibration-status'),
    calibrationModal: document.getElementById('calibration-modal'),
    calibrationReading: document.getElementById('calibration-reading'),
    calibrationProgressBar: document.getElementById('calibration-progress-bar'),
    calibrationTimerText: document.getElementById('calibration-timer'),

    // Config inputs
    thresholdInput: document.getElementById('threshold-input'),
    durationInput: document.getElementById('duration-input'),

    // Status
    statusIndicator: document.getElementById('status-indicator'),
    statusText: document.getElementById('status-text'),
    triggerProgressContainer: document.getElementById('trigger-progress-container'),
    triggerProgress: document.getElementById('trigger-progress'),
    progressTime: document.getElementById('progress-time'),

    // Control
    monitorBtn: document.getElementById('btn-monitor'),

    // Countdown modal
    countdownModal: document.getElementById('countdown-modal'),
    countdownNumber: document.getElementById('countdown-number'),
    countdownProgressBar: document.getElementById('countdown-progress-bar'),
    cancelBtn: document.getElementById('btn-cancel-shutdown'),

    // Window controls
    btnMinimize: document.getElementById('btn-minimize'),
    btnMaximize: document.getElementById('btn-maximize'),
    btnClose: document.getElementById('btn-close')
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    initChart();
    await loadNetworkInterfaces();
    setupEventListeners();
    setupIpcListeners();
});

// ==================== CHART SETUP ====================
function initChart() {
    const ctx = document.getElementById('speed-chart').getContext('2d');

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 180);
    gradient.addColorStop(0, 'rgba(0, 255, 136, 0.25)');
    gradient.addColorStop(0.5, 'rgba(0, 255, 136, 0.08)');
    gradient.addColorStop(1, 'rgba(0, 255, 136, 0)');

    // Initialize with 60 empty data points
    for (let i = 0; i < 60; i++) {
        speedData.push(0);
        timeLabels.push('');
    }

    speedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: 'İndirme Hızı',
                data: speedData,
                borderColor: '#00ff88',
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: '#00ff88',
                pointHoverBorderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 200
            },
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(20, 20, 30, 0.95)',
                    titleColor: '#00ff88',
                    bodyColor: '#ffffff',
                    borderColor: 'rgba(0, 255, 136, 0.2)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            const value = context.parsed.y;
                            // KB/s'den Mbit/s'ye çevir: KB * 8 / 1000 = Mbit
                            const mbit = (value * 8) / 1000;
                            if (mbit >= 1) {
                                return `${mbit.toFixed(2)} Mbit/s`;
                            }
                            return `${(mbit * 1000).toFixed(0)} Kbit/s`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: false
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#64748b',
                        font: {
                            family: 'Rajdhani',
                            size: 11
                        },
                        callback: function (value) {
                            // KB/s'den Mbit/s'ye çevir
                            const mbit = (value * 8) / 1000;
                            if (mbit >= 1) {
                                return mbit.toFixed(1) + ' Mbit/s';
                            }
                            return (mbit * 1000).toFixed(0) + ' Kbit/s';
                        }
                    }
                }
            }
        }
    });
}

function updateChart(kbPerSecond) {
    speedData.shift();
    speedData.push(Math.max(0, kbPerSecond));
    speedChart.update('none');
}

// ==================== NETWORK INTERFACES ====================
async function loadNetworkInterfaces() {
    try {
        const interfaces = await window.electronAPI.getNetworkInterfaces();

        elements.interfaceSelect.innerHTML = '';

        if (interfaces.length === 0) {
            elements.interfaceSelect.innerHTML = '<option value="">Arayüz bulunamadı</option>';
            return;
        }

        interfaces.forEach((iface, index) => {
            const option = document.createElement('option');
            option.value = iface.name;
            option.textContent = `${iface.name} (${iface.type || 'Bilinmiyor'}) - ${iface.ip}`;
            if (index === 0) option.selected = true;
            elements.interfaceSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Ağ arayüzleri yüklenirken hata:', error);
        elements.interfaceSelect.innerHTML = '<option value="">Hata oluştu</option>';
    }
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    // Monitor button
    elements.monitorBtn.addEventListener('click', toggleMonitoring);

    // Refresh interfaces
    elements.refreshBtn.addEventListener('click', loadNetworkInterfaces);

    // Calibrate button
    elements.calibrateBtn.addEventListener('click', startCalibration);

    // Cancel shutdown
    elements.cancelBtn.addEventListener('click', cancelShutdown);

    // Window controls
    elements.btnMinimize.addEventListener('click', () => window.electronAPI.minimizeWindow());
    elements.btnMaximize.addEventListener('click', () => window.electronAPI.maximizeWindow());
    elements.btnClose.addEventListener('click', () => window.electronAPI.closeWindow());
}

// ==================== IPC LISTENERS ====================
function setupIpcListeners() {
    // Speed updates from main process
    window.electronAPI.onSpeedUpdate((data) => {
        updateSpeedDisplay(data);
        updateChart(data.kbPerSecond);

        // Kalibrasyon sırasında değerleri topla
        if (isCalibrating) {
            calibrationReadings.push(data.kbPerSecond);
            elements.calibrationReading.textContent = `${data.kbPerSecond.toFixed(0)} KB/s`;
        }

        if (!isCalibrating) {
            checkLowSpeedProgress(data.kbPerSecond);
        }
    });

    // Trigger countdown from main process
    window.electronAPI.onTriggerCountdown(() => {
        showCountdownModal();
    });
}

// ==================== CALIBRATION ====================
async function startCalibration() {
    const interfaceName = elements.interfaceSelect.value;

    if (!interfaceName) {
        alert('Lütfen bir ağ arayüzü seçin');
        return;
    }

    // Önce izlemeyi başlat
    if (!isMonitoring) {
        const config = {
            interfaceName: interfaceName,
            thresholdKBs: 999999, // Çok yüksek eşik - tetikleme olmasın
            durationSeconds: 600
        };
        await window.electronAPI.startMonitoring(config);
    }

    isCalibrating = true;
    calibrationReadings = [];

    // Modal'ı göster
    elements.calibrationModal.classList.add('visible');

    let secondsLeft = 10;
    let progressPercent = 0;

    elements.calibrationProgressBar.style.width = '0%';
    elements.calibrationTimerText.textContent = `${secondsLeft} saniye kaldı...`;

    calibrationTimer = setInterval(() => {
        secondsLeft--;
        progressPercent = ((10 - secondsLeft) / 10) * 100;

        elements.calibrationProgressBar.style.width = `${progressPercent}%`;
        elements.calibrationTimerText.textContent = `${secondsLeft} saniye kaldı...`;

        if (secondsLeft <= 0) {
            finishCalibration();
        }
    }, 1000);
}

function finishCalibration() {
    clearInterval(calibrationTimer);
    isCalibrating = false;

    // Modal'ı kapat
    elements.calibrationModal.classList.remove('visible');

    // İzlemeyi durdur (kalibrasyon için başlatıldıysa)
    if (!isMonitoring) {
        window.electronAPI.stopMonitoring();
    }

    if (calibrationReadings.length < 3) {
        elements.calibrationStatus.textContent = '⚠️ Yeterli veri toplanamadı';
        return;
    }

    // Ortalama ve maksimum değerleri hesapla
    const avgSpeed = calibrationReadings.reduce((a, b) => a + b, 0) / calibrationReadings.length;
    const maxSpeed = Math.max(...calibrationReadings);

    // Eşik değerini hesapla: maksimum + %50 güvenlik marjı
    // Bu, arka plan trafiğinin üzerinde bir değer olacak
    const suggestedThreshold = Math.ceil(maxSpeed * 1.5);

    // Eşik değerini ayarla
    elements.thresholdInput.value = suggestedThreshold;

    // Kullanıcıya bilgi ver
    elements.calibrationStatus.textContent = `✅ Arka plan: ~${avgSpeed.toFixed(0)} KB/s → Eşik: ${suggestedThreshold} KB/s`;

    // Birkaç saniye sonra status'u temizle
    setTimeout(() => {
        elements.calibrationStatus.textContent = '';
    }, 5000);
}

// ==================== MONITORING CONTROL ====================
async function toggleMonitoring() {
    if (isMonitoring) {
        await stopMonitoring();
    } else {
        await startMonitoring();
    }
}

async function startMonitoring() {
    const interfaceName = elements.interfaceSelect.value;

    if (!interfaceName) {
        alert('Lütfen bir ağ arayüzü seçin');
        return;
    }

    const config = {
        interfaceName: interfaceName,
        thresholdKBs: parseInt(elements.thresholdInput.value) || 100,
        durationSeconds: parseInt(elements.durationInput.value) || 120
    };

    const result = await window.electronAPI.startMonitoring(config);

    if (result.success) {
        isMonitoring = true;
        lowSpeedStartTime = null;
        updateMonitoringUI(true);
    }
}

async function stopMonitoring() {
    await window.electronAPI.stopMonitoring();
    isMonitoring = false;
    lowSpeedStartTime = null;
    updateMonitoringUI(false);
    hideTriggerProgress();
}

function updateMonitoringUI(active) {
    if (active) {
        elements.monitorBtn.classList.add('active');
        elements.monitorBtn.querySelector('.btn-icon').textContent = '■';
        elements.monitorBtn.querySelector('.btn-text').textContent = 'İZLEMEYİ DURDUR';
        elements.statusIndicator.classList.add('active');
        elements.statusIndicator.classList.remove('warning');
        elements.statusText.textContent = 'İZLENİYOR';

        // Disable config inputs
        elements.thresholdInput.disabled = true;
        elements.durationInput.disabled = true;
        elements.interfaceSelect.disabled = true;
        elements.calibrateBtn.disabled = true;
        elements.calibrateBtn.style.opacity = '0.5';
    } else {
        elements.monitorBtn.classList.remove('active');
        elements.monitorBtn.querySelector('.btn-icon').textContent = '▶';
        elements.monitorBtn.querySelector('.btn-text').textContent = 'İZLEMEYİ BAŞLAT';
        elements.statusIndicator.classList.remove('active', 'warning');
        elements.statusText.textContent = 'BEKLEMEDE';

        // Enable config inputs
        elements.thresholdInput.disabled = false;
        elements.durationInput.disabled = false;
        elements.interfaceSelect.disabled = false;
        elements.calibrateBtn.disabled = false;
        elements.calibrateBtn.style.opacity = '1';
    }
}

// ==================== SPEED DISPLAY ====================
function updateSpeedDisplay(data) {
    const { kbPerSecond, mbitPerSecond } = data;

    // Mbit/s olarak göster
    if (mbitPerSecond !== undefined) {
        if (mbitPerSecond >= 1) {
            elements.speedNumber.textContent = mbitPerSecond.toFixed(2);
            elements.speedUnit.textContent = 'Mbit/s';
        } else {
            // 1 Mbit altında Kbit olarak göster
            const kbitPerSecond = mbitPerSecond * 1000;
            elements.speedNumber.textContent = kbitPerSecond.toFixed(0);
            elements.speedUnit.textContent = 'Kbit/s';
        }
    } else {
        // Fallback: MB/s hesapla ve Mbit'e çevir
        const mbit = (kbPerSecond * 8) / 1000;
        elements.speedNumber.textContent = mbit.toFixed(2);
        elements.speedUnit.textContent = 'Mbit/s';
    }

    elements.speedKbs.textContent = kbPerSecond.toFixed(0);
}

// ==================== LOW SPEED PROGRESS ====================
function checkLowSpeedProgress(kbPerSecond) {
    if (!isMonitoring) return;

    const threshold = parseInt(elements.thresholdInput.value) || 100;
    const duration = parseInt(elements.durationInput.value) || 120;

    if (kbPerSecond < threshold) {
        if (lowSpeedStartTime === null) {
            lowSpeedStartTime = Date.now();
        }

        const elapsed = (Date.now() - lowSpeedStartTime) / 1000;
        const progress = Math.min((elapsed / duration) * 100, 100);

        showTriggerProgress(elapsed, duration, progress);

        elements.statusIndicator.classList.add('warning');
        elements.statusText.textContent = 'DÜŞÜK HIZ';
    } else {
        lowSpeedStartTime = null;
        hideTriggerProgress();

        elements.statusIndicator.classList.remove('warning');
        elements.statusText.textContent = 'İZLENİYOR';
    }
}

function showTriggerProgress(elapsed, duration, progress) {
    elements.triggerProgressContainer.style.display = 'block';
    elements.triggerProgress.style.width = `${progress}%`;
    elements.progressTime.textContent = `${Math.floor(elapsed)}sn / ${duration}sn`;
}

function hideTriggerProgress() {
    elements.triggerProgressContainer.style.display = 'none';
    elements.triggerProgress.style.width = '0%';
}

// ==================== COUNTDOWN MODAL ====================
function showCountdownModal() {
    countdownValue = 60;
    elements.countdownModal.classList.add('visible');
    elements.countdownNumber.textContent = countdownValue;
    elements.countdownProgressBar.style.width = '100%';

    countdownTimer = setInterval(() => {
        countdownValue--;
        elements.countdownNumber.textContent = countdownValue;
        elements.countdownProgressBar.style.width = `${(countdownValue / 60) * 100}%`;

        if (countdownValue <= 0) {
            clearInterval(countdownTimer);
            executeShutdown();
        }
    }, 1000);
}

function hideCountdownModal() {
    elements.countdownModal.classList.remove('visible');
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

function cancelShutdown() {
    hideCountdownModal();
    lowSpeedStartTime = null;
    hideTriggerProgress();
    startMonitoring();
}

async function executeShutdown() {
    hideCountdownModal();
    await window.electronAPI.executeShutdown();

    // Test modunda uyarı göster
    alert('🧪 TEST MODU: Bilgisayar kapatılmadı!\n\nGerçek kullanım için main.js dosyasındaki shutdown komutunu aktif edin.');
}
