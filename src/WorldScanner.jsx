import { useState, useCallback, useEffect, useRef } from "react";
import { colors, typography, radius, shadows, animation, space } from "./theme.js";
import { Button, Panel } from "./components/ui.jsx";
import { runWorldScan, retryFailedPatches, verifyCompletedPatches, getWorldScanProgress, generatePatchGrid } from "./worldScanOrchestrator.js";
import { checkStorageQuota, requestPersistentStorage, getScanStats } from "./worldScanStore.js";
import { acquireWakeLock, releaseWakeLock, isWakeLockActive } from "./wakeLock.js";

// ════════════════════════════════════════════════════════════════
// World Scanner — dedicated mode for planet-wide terrain scanning
// ════════════════════════════════════════════════════════════════

const RESOLUTIONS = [
  { id: "10km", cellKm: 10, label: "10 km (Strategic)", patchDeg: 3, desc: "~1.7M land cells, ~68 MB, 18-30 hours" },
  { id: "0.5km", cellKm: 0.5, label: "0.5 km (Tactical)", patchDeg: 1, desc: "~690M land cells, ~16 GB, 1-2 weeks" },
];

export default function WorldScanner({ onBack }) {
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const [scanning, setScanning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [progress, setProgress] = useState(null);
  const [status, setStatus] = useState("");
  const [log, setLog] = useState([]);
  const [storageInfo, setStorageInfo] = useState(null);
  const [scanStats, setScanStats] = useState({});
  const stopRef = useRef(false);
  const logEndRef = useRef(null);

  // Load storage quota and scan stats on mount and periodically
  useEffect(() => {
    async function loadStats() {
      const quota = await checkStorageQuota();
      setStorageInfo(quota);
      const stats10 = await getWorldScanProgress(10);
      const stats05 = await getWorldScanProgress(0.5);
      setScanStats({ "10km": stats10, "0.5km": stats05 });
    }
    loadStats();
    const interval = setInterval(loadStats, scanning ? 10000 : 30000);
    return () => clearInterval(interval);
  }, [scanning]);

  // Auto-scroll log
  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const addLog = useCallback((msg) => {
    setLog(prev => [...prev.slice(-200), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const startScan = useCallback(async () => {
    setShowConfirm(false);
    setScanning(true);
    setPaused(false);
    stopRef.current = false;
    setLog([]);

    // Request persistent storage so browser doesn't evict our data
    const persisted = await requestPersistentStorage();
    addLog(persisted ? "Persistent storage granted" : "Persistent storage not available — data may be evicted by browser");

    // Acquire wake lock
    const locked = await acquireWakeLock();
    addLog(locked ? "Wake lock acquired — computer will not sleep" : "Wake lock failed — disable system sleep manually");

    addLog(`Starting ${resolution.label} world scan...`);

    try {
      await runWorldScan(resolution.cellKm, {
        onPatchStart: (id, done, total) => {
          setStatus(`Scanning ${id} (${done}/${total})`);
        },
        onPatchComplete: (id, cellCount) => {
          addLog(`${id}: ${cellCount} cells`);
        },
        onPatchError: (id, error, retries) => {
          addLog(`FAIL ${id}: ${error} (retry ${retries})`);
        },
        onProgress: (p) => setProgress(p),
        onStatus: (msg) => setStatus(msg),
        onDone: (result) => {
          addLog(`Scan complete: ${result.completed} done, ${result.failed} failed, ${result.skipped} skipped`);
          setStatus(`Done: ${result.completed}/${result.total} patches`);
        },
        shouldStop: () => stopRef.current,
      });
    } catch (err) {
      addLog(`Scan error: ${err.message}`);
      setStatus(`Error: ${err.message}`);
    }

    await releaseWakeLock();
    setScanning(false);
  }, [resolution, addLog]);

  const pauseScan = useCallback(() => {
    stopRef.current = true;
    setPaused(true);
    addLog("Pause requested — will stop after current patch");
  }, [addLog]);

  const handleRetryFailed = useCallback(async () => {
    setScanning(true);
    stopRef.current = false;
    addLog("Retrying failed patches...");

    const locked = await acquireWakeLock();
    if (locked) addLog("Wake lock re-acquired");

    await retryFailedPatches(resolution.cellKm, {
      onPatchStart: (id, done, total) => setStatus(`Retry ${id} (${done}/${total})`),
      onPatchComplete: (id, cellCount) => addLog(`Retry OK: ${id} (${cellCount} cells)`),
      onPatchError: (id, error, retries) => addLog(`Retry FAIL: ${id}: ${error}`),
      onProgress: (p) => setProgress(p),
      onStatus: (msg) => setStatus(msg),
      onDone: (result) => {
        addLog(`Retry complete: ${result.completed} done, ${result.failed} still failed`);
      },
      shouldStop: () => stopRef.current,
    });

    await releaseWakeLock();
    setScanning(false);
  }, [resolution, addLog]);

  const handleVerify = useCallback(async () => {
    addLog("Running verification pass...");
    const gaps = await verifyCompletedPatches(resolution.cellKm, {
      onStatus: (msg) => addLog(`Verify: ${msg}`),
      onProgress: (p) => setStatus(`Verifying ${p.current}/${p.total}`),
    });
    addLog(`Verification complete: ${gaps.length} patches need re-scanning`);
  }, [resolution, addLog]);

  const stats = scanStats[resolution.id] || {};
  const pct = stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(1) : 0;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      fontFamily: typography.fontFamily, color: colors.text.primary,
      padding: space[4], gap: space[4], overflow: "auto",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: space[3] }}>
        <div style={{ fontSize: typography.heading.lg, fontWeight: typography.weight.bold }}>
          World Scanner
        </div>
        <div style={{
          fontSize: typography.body.xs, color: colors.text.muted,
          padding: "2px 8px", borderRadius: radius.sm,
          background: colors.bg.surface, border: `1px solid ${colors.border.subtle}`,
        }}>
          {scanning ? "SCANNING" : stats.completed > 0 ? `${pct}%` : "READY"}
        </div>
      </div>

      <div style={{ display: "flex", gap: space[4], flex: 1, minHeight: 0 }}>
        {/* Left panel: controls */}
        <div style={{ width: 340, display: "flex", flexDirection: "column", gap: space[3], flexShrink: 0 }}>
          {/* Resolution selector */}
          <div style={{
            background: colors.bg.raised, borderRadius: radius.lg,
            border: `1px solid ${colors.border.subtle}`, padding: space[3],
          }}>
            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], textTransform: "uppercase", letterSpacing: 1 }}>
              Resolution
            </div>
            {RESOLUTIONS.map(r => (
              <div key={r.id}
                onClick={() => !scanning && setResolution(r)}
                style={{
                  padding: `${space[2]}px ${space[3]}px`,
                  borderRadius: radius.md,
                  cursor: scanning ? "default" : "pointer",
                  background: resolution.id === r.id ? `${colors.accent.cyan}15` : "transparent",
                  border: `1px solid ${resolution.id === r.id ? colors.accent.cyan + "40" : "transparent"}`,
                  marginBottom: space[1],
                  transition: `all ${animation.fast}`,
                  opacity: scanning && resolution.id !== r.id ? 0.4 : 1,
                }}
              >
                <div style={{ fontSize: typography.body.md, fontWeight: typography.weight.semibold, color: resolution.id === r.id ? colors.accent.cyan : colors.text.primary }}>
                  {r.label}
                </div>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginTop: 2 }}>
                  {r.desc}
                </div>
              </div>
            ))}
          </div>

          {/* Storage info */}
          {storageInfo && (
            <div style={{
              background: colors.bg.raised, borderRadius: radius.lg,
              border: `1px solid ${colors.border.subtle}`, padding: space[3],
            }}>
              <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], textTransform: "uppercase", letterSpacing: 1 }}>
                Storage
              </div>
              <div style={{ fontSize: typography.body.sm, color: colors.text.secondary }}>
                Used: {formatBytes(storageInfo.usage)} / {formatBytes(storageInfo.quota)}
              </div>
              <div style={{
                height: 4, borderRadius: 2, background: colors.bg.surface, marginTop: space[1],
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", borderRadius: 2,
                  width: `${Math.min(100, storageInfo.percentUsed)}%`,
                  background: storageInfo.percentUsed > 80 ? colors.accent.red : colors.accent.cyan,
                }} />
              </div>
            </div>
          )}

          {/* Scan progress */}
          {stats.total > 0 && (
            <div style={{
              background: colors.bg.raised, borderRadius: radius.lg,
              border: `1px solid ${colors.border.subtle}`, padding: space[3],
            }}>
              <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], textTransform: "uppercase", letterSpacing: 1 }}>
                {resolution.label} Progress
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: typography.body.sm }}>
                <span style={{ color: colors.accent.green }}>Done: {stats.completed}</span>
                <span style={{ color: colors.accent.red }}>Failed: {stats.failed}</span>
                <span style={{ color: colors.text.muted }}>Total: {stats.total}</span>
              </div>
              <div style={{
                height: 6, borderRadius: 3, background: colors.bg.surface, marginTop: space[2],
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${colors.accent.green}, ${colors.accent.cyan})`,
                  transition: `width ${animation.slow}`,
                }} />
              </div>
              <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginTop: space[1] }}>
                {stats.totalCells?.toLocaleString()} cells scanned
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            {!scanning ? (
              <>
                <Button onClick={() => setShowConfirm(true)} variant="primary" size="lg">
                  {stats.completed > 0 ? "Resume Scan" : "Start World Scan"}
                </Button>
                {stats.failed > 0 && (
                  <Button onClick={handleRetryFailed} variant="secondary">
                    Retry {stats.failed} Failed Patches
                  </Button>
                )}
                {stats.completed > 0 && (
                  <Button onClick={handleVerify} variant="secondary">
                    Verify Data Integrity
                  </Button>
                )}
              </>
            ) : (
              <Button onClick={pauseScan} variant="danger" size="lg">
                Pause Scan
              </Button>
            )}
          </div>
        </div>

        {/* Right panel: world map + log */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: space[3], minWidth: 0 }}>
          {/* World map visualization showing patch status */}
          <WorldPatchMap resolution={resolution} scanStats={scanStats} />

          {/* Status bar */}
          {status && (
            <div style={{
              padding: `${space[1]}px ${space[3]}px`,
              background: colors.bg.raised, borderRadius: radius.md,
              border: `1px solid ${colors.border.subtle}`,
              fontSize: typography.body.sm, color: colors.text.secondary,
              fontFamily: typography.monoFamily,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {status}
            </div>
          )}

          {/* Log */}
          <div style={{
            flex: 1, minHeight: 150,
            background: colors.bg.input, borderRadius: radius.lg,
            border: `1px solid ${colors.border.subtle}`,
            padding: space[2], overflow: "auto",
            fontFamily: typography.monoFamily, fontSize: typography.body.xs,
            color: colors.text.muted, lineHeight: 1.6,
          }}>
            {log.length === 0 && (
              <div style={{ color: colors.text.disabled, padding: space[2] }}>
                Select a resolution and start scanning. Progress will appear here.
              </div>
            )}
            {log.map((line, i) => (
              <div key={i} style={{
                color: line.includes("FAIL") ? colors.accent.red :
                       line.includes("OK") || line.includes("complete") ? colors.accent.green :
                       colors.text.muted,
              }}>
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      {showConfirm && (
        <ConfirmDialog
          resolution={resolution}
          stats={stats}
          onConfirm={startScan}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}

// ── World Patch Map ──────────────────────────────────────────
// Simple equirectangular projection showing patch status

function WorldPatchMap({ resolution, scanStats }) {
  const canvasRef = useRef(null);
  const stats = scanStats[resolution.id];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;

    // Clear
    ctx.fillStyle = colors.bg.input;
    ctx.fillRect(0, 0, w, h);

    // Draw world outline
    ctx.strokeStyle = colors.border.subtle;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);

    if (!stats || !stats.total) {
      // Draw grid lines for empty state
      ctx.strokeStyle = colors.border.subtle + "40";
      ctx.lineWidth = 0.5;
      // Latitude lines every 30 degrees
      for (let lat = -60; lat <= 60; lat += 30) {
        const y = ((90 - lat) / 180) * h;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      // Longitude lines every 30 degrees
      for (let lng = -150; lng <= 150; lng += 30) {
        const x = ((lng + 180) / 360) * w;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }

      ctx.fillStyle = colors.text.disabled;
      ctx.font = `${11}px ${typography.fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText("No scan data — start a scan to see progress", w / 2, h / 2);
      return;
    }

    // Draw patches from manifest data
    // We'll reconstruct patch positions from their IDs
    const patchDeg = resolution.patchDeg;
    const latRange = 170; // -85 to 85
    const lngRange = 360;

    // For performance with many patches, batch by status color
    const statusColors = {
      complete: colors.accent.green + "60",
      in_progress: colors.accent.amber + "90",
      failed: colors.accent.red + "80",
      pending: colors.bg.surface,
    };

    // Generate all patches and their status
    const patches = generatePatchGrid(resolution.cellKm);
    for (const patch of patches) {
      const entry = stats.total > 0 ? "complete" : "pending"; // Simplified — real impl reads manifest
      const pxX = ((patch.bbox.west + 180) / lngRange) * w;
      const pxY = ((85 - patch.bbox.north) / latRange) * h;
      const pxW = (patchDeg / lngRange) * w;
      const pH = (patchDeg / latRange) * h;

      ctx.fillStyle = statusColors.pending;
      ctx.fillRect(pxX, pxY, pxW, pH);
    }

    // Overlay with actual status data from manifest (if available)
    // This is a simplified visualization — a full implementation would
    // read the manifest and color each patch individually
    if (stats.completed > 0) {
      ctx.fillStyle = colors.text.secondary;
      ctx.font = `${12}px ${typography.fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText(
        `${stats.completed}/${stats.total} patches complete (${((stats.completed / stats.total) * 100).toFixed(1)}%)`,
        w / 2, h - 10
      );
    }
  }, [resolution, stats]);

  return (
    <div style={{
      background: colors.bg.raised, borderRadius: radius.lg,
      border: `1px solid ${colors.border.subtle}`, padding: space[2],
      minHeight: 200,
    }}>
      <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], textTransform: "uppercase", letterSpacing: 1 }}>
        World Coverage — {resolution.label}
      </div>
      <canvas
        ref={canvasRef}
        width={720}
        height={360}
        style={{ width: "100%", height: "auto", borderRadius: radius.md, display: "block" }}
      />
    </div>
  );
}

// ── Confirmation Dialog ──────────────────────────────────────

function ConfirmDialog({ resolution, stats, onConfirm, onCancel }) {
  const isResume = stats && stats.completed > 0;
  const patches = generatePatchGrid(resolution.cellKm);
  const remaining = isResume ? patches.length - (stats.completed || 0) : patches.length;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
    }}
    onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        width: 480, padding: space[6],
        background: colors.bg.raised, borderRadius: radius.xl,
        border: `1px solid ${colors.border.default}`,
        boxShadow: shadows.lg,
      }}>
        <div style={{ fontSize: typography.heading.md, fontWeight: typography.weight.bold, marginBottom: space[3] }}>
          {isResume ? "Resume World Scan" : "Start World Scan"}
        </div>

        <div style={{ fontSize: typography.body.md, color: colors.text.secondary, lineHeight: 1.7, marginBottom: space[4] }}>
          <div style={{ marginBottom: space[2] }}>
            <strong style={{ color: colors.text.primary }}>{resolution.label}</strong>
          </div>
          <div>Total patches: <strong>{patches.length.toLocaleString()}</strong></div>
          {isResume && <div>Already complete: <strong>{stats.completed.toLocaleString()}</strong></div>}
          <div>Remaining: <strong>{remaining.toLocaleString()}</strong></div>
          <div style={{ marginTop: space[2] }}>{resolution.desc}</div>
        </div>

        {/* Warning */}
        <div style={{
          padding: space[3], borderRadius: radius.md,
          background: `${colors.accent.amber}10`,
          border: `1px solid ${colors.accent.amber}30`,
          marginBottom: space[4],
          fontSize: typography.body.sm, color: colors.accent.amber, lineHeight: 1.6,
        }}>
          This scan will run continuously and may take many hours to days.
          Keep this browser tab open and your computer awake.
          The scan can be paused and resumed at any time.
        </div>

        <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm}>
            {isResume ? "Resume" : "Start Scan"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Utilities ────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
